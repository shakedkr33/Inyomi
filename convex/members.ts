import { v } from 'convex/values';
import { buildCanonicalFamilyMembers } from '../lib/canonicalFamilyMembers';
import { hasCreatorOrphanFallbackAuthority } from '../lib/creatorOrphanAuthority';
import { filterPendingPhoneMatchCandidates } from '../lib/pendingPhoneMatches';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

// ── Phone normalization ───────────────────────────────────────────────────────
// Mirrors lib/phoneUtils.ts — duplicated because Convex cannot import client libs.
function normalizeToE164(phone: string): string | null {
  const stripped = phone.replace(/[\s\-()]/g, '');
  if (stripped.startsWith('+972')) return stripped;
  if (stripped.startsWith('972')) return `+${stripped}`;
  if (stripped.startsWith('0')) return `+972${stripped.slice(1)}`;
  if (stripped.startsWith('5')) return `+972${stripped}`;
  return null;
}

// FIXED: maskPhone mirrors lib/utils/contactPhone.ts — shows first 3 + last 3 digits
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  const prefix = digits.slice(0, 3);
  const suffix = digits.slice(-3);
  const midLen = Math.max(0, digits.length - 6);
  return `${prefix}-${'X'.repeat(midLen)}${suffix}`;
}

// FIXED: phone numbers converted to local Israeli format before masking
// E.164 (+972XXXXXXXXX) → local (0XXXXXXXXX) so mask shows 05X-XXXX not 972-XXXXXX
function e164ToLocal(phone: string): string {
  if (phone.startsWith('+972')) return '0' + phone.slice(4);
  if (phone.startsWith('972')) return '0' + phone.slice(3);
  return phone;
}

// ── Backward-compat kind inference ───────────────────────────────────────────
// FIXED: backward-compat kind inference for rows created before the kind field existed
// Use resolveKind() everywhere — never inline this logic.
export function resolveKind(member: {
  kind?: 'access' | 'entity';
  displayName?: string;
  userId?: string;
}): 'access' | 'entity' {
  if (member.kind) return member.kind;
  // Pre-kind rows: access rows have userId + no displayName; everything else is entity
  if (!member.displayName && member.userId) return 'access';
  return 'entity';
}

// ── resolveMySpaceId ──────────────────────────────────────────────────────────
// FIXED: single shared spaceId resolver used by updateMyProfile and listMyFamilyContacts.
// Both functions previously used different lookup strategies (defaultSpaceId vs members table),
// causing them to resolve different spaceIds for the same user and silently writing entity rows
// to the wrong space.
export async function resolveMySpaceId(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
): Promise<Id<'spaces'> | null> {
  const rows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();

  // Priority 1 — member access row in a space where this user also has a matched entity row.
  // This covers the normal post-invite state AND guards against stale access rows that point
  // to a different (empty) space: we only pick an access row whose spaceId matches at least
  // one entity row for this user, confirming the admin wrote real data there.
  const entitySpaceIds = new Set(
    rows.filter((r) => resolveKind(r) === 'entity').map((r) => r.spaceId)
  );
  const memberAccessInEntitySpace = rows.find(
    (r) =>
      r.role === 'member' &&
      resolveKind(r) === 'access' &&
      entitySpaceIds.has(r.spaceId)
  );
  if (memberAccessInEntitySpace) return memberAccessInEntitySpace.spaceId;

  // Priority 2 — any member access row (invited into a family space, no entity row yet).
  // Handles the window between invite acceptance and the admin writing entity rows.
  const memberRow = rows.find(
    (r) => r.role === 'member' && resolveKind(r) === 'access'
  );
  if (memberRow) return memberRow.spaceId;

  // Priority 3 — matched entity row: phone-matched but no access row created yet.
  // Legacy path for users who joined before the matchOnPhone fix.
  const entityRow = rows.find((r) => resolveKind(r) === 'entity');
  if (entityRow) return entityRow.spaceId;

  // Priority 4 — admin access row: creator of their own personal/family space.
  const adminRow = rows.find(
    (r) => r.role === 'admin' && resolveKind(r) === 'access'
  );
  return adminRow?.spaceId ?? null;
}

const PERMISSION_DENIED =
  'אין לך הרשאה לבצע פעולה זו. אפשר לפנות למנהל/ת המשפחה.';
const ALREADY_IN_ACTIVE_FAMILY =
  'כבר יש לך פרופיל משפחתי פעיל. יש לצאת ממנו לפני הצטרפות למשפחה אחרת.';

// ── isFullyJoined — Family Membership Lifecycle Phase 1 invariant ──────────
/**
 * Server-derived invariant: true only when `entity` represents a REAL,
 * fully-completed family membership — never a discovery-only phone match,
 * never a selected-but-not-yet-joined pending match (see
 * `pendingMatchMemberId` / acceptPendingPhoneMatch), and never a corrupted
 * userId/matchedUserId mismatch.
 *
 * ALL of the following must hold:
 *   1. kind resolves to 'entity' (never 'access')
 *   2. entity.userId is set
 *   3. entity.matchedUserId is set
 *   4. entity.userId === entity.matchedUserId (strict — no mismatch)
 *   5. entity.inviteStatus === 'joined'
 *   6. the matched user's onboardingCompleted === true
 *   7. a valid kind:'access' row exists for that user in the SAME spaceId
 *
 * Used by listMyFamilyContacts (exposed to clients as `isFullyJoined` on
 * each member) and internally by executeFamilyJoin's idempotency check.
 */
export async function computeIsFullyJoined(
  ctx: QueryCtx | MutationCtx,
  entity: Pick<
    Doc<'members'>,
    'kind' | 'displayName' | 'userId' | 'matchedUserId' | 'inviteStatus' | 'spaceId'
  >
): Promise<boolean> {
  if (resolveKind(entity) !== 'entity') return false;
  if (!entity.userId || !entity.matchedUserId) return false;
  if (entity.userId !== entity.matchedUserId) return false;
  if (entity.inviteStatus !== 'joined') return false;

  const joinedUser = await ctx.db.get(entity.userId);
  if (!joinedUser || joinedUser.onboardingCompleted !== true) return false;

  const accessRow = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', entity.userId as Id<'users'>))
    .filter((q) => q.eq(q.field('spaceId'), entity.spaceId))
    .filter((q) => q.eq(q.field('kind'), 'access'))
    .first();

  return accessRow !== null;
}

// ── isSelectableForPicker — participant/assignee picker regression guard ───
/**
 * Canonical picker-visibility rule (do NOT filter by isFullyJoined alone —
 * that would incorrectly hide manual/local profiles with no phone number).
 *
 *   - local/manual profile with no selectedPhoneNumber -> selectable
 *   - phone contact that is not fully joined -> NOT selectable
 *   - fully joined real user -> selectable
 */
export function computeIsSelectableForPicker(
  entity: Pick<Doc<'members'>, 'selectedPhoneNumber'>,
  fullyJoined: boolean
): boolean {
  return !entity.selectedPhoneNumber || fullyJoined;
}

// ── assertNoActiveFamilyMembership — one-active-family guard ───────────────
/**
 * Throws if `userId` already has a kind:'access' row in a space whose
 * `type !== 'personal'` — i.e. they are already a member, admin, OR owner
 * of an active family/couple/business space. A personal-space admin row
 * is always allowed through (that is the expected pre-join state).
 *
 * Must be called as the LAST check before executeFamilyJoin's final
 * writes, inside the same mutation transaction, so the check and the
 * writes are atomic.
 */
export async function assertNoActiveFamilyMembership(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<void> {
  const rows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();

  const accessRows = rows.filter((r) => resolveKind(r) === 'access');
  for (const row of accessRows) {
    const space = await ctx.db.get(row.spaceId);
    if (space && space.type !== 'personal') {
      throw new Error(ALREADY_IN_ACTIVE_FAMILY);
    }
  }
}

// ── executeFamilyJoin — shared final join transaction ──────────────────────
/**
 * The ONLY code path that may grant real family membership. Used by both:
 *   - finishOnboarding's claimed path (brand-new user completing identity)
 *   - completeExistingUserFamilyJoin (already-onboarded user)
 *
 * Re-verifies everything server-side (never trusts that a prior
 * acceptPendingPhoneMatch call was sufficient) and performs the
 * active-family guard atomically immediately before the final writes.
 *
 * NOTE (Phase 1 scope): this does NOT yet migrate the joining user's
 * personal events/tasks/captures into the family space — that is Phase 3
 * (migratePersonalData), not yet implemented. Personal data created before
 * this join remains in the user's personal space until Phase 3 ships.
 */
export async function executeFamilyJoin(
  ctx: MutationCtx,
  userId: Id<'users'>,
  memberId: Id<'members'>
): Promise<Id<'spaces'>> {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error('משתמש לא נמצא');

  const entity = await ctx.db.get(memberId);
  if (!entity) throw new Error('פרופיל לא נמצא');
  if (resolveKind(entity) !== 'entity') throw new Error(PERMISSION_DENIED);
  if (entity.matchedUserId !== userId) throw new Error(PERMISSION_DENIED);
  // Never re-join an entity already fully/partially claimed by someone else.
  if (entity.userId !== undefined && entity.userId !== userId) {
    throw new Error(PERMISSION_DENIED);
  }

  const spaceId = entity.spaceId;
  const space = await ctx.db.get(spaceId);
  if (!space) throw new Error('המרחב לא נמצא');

  // PRODUCT RULE / FINAL SERVER-SIDE INTEGRITY BOUNDARY: a personal space is
  // NEVER a phone-join target. This is the last gate before any join write
  // — executeFamilyJoin is the ONLY code path that may grant real family
  // membership (see doc comment above), so this check must never be
  // skippable by a stale client, a manipulated call, an old pending id, or
  // a legacy matchedUserId stamped on a personal-space entity before this
  // invariant existed. Re-validated here independently of
  // acceptPendingPhoneMatch/getPendingPhoneMatches — never trusts that an
  // earlier step already enforced it.
  if (space.type === 'personal') throw new Error(PERMISSION_DENIED);

  // Active-family guard — atomic, immediately before final writes.
  await assertNoActiveFamilyMembership(ctx, userId);

  const existingAccessRow = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .filter((q) => q.eq(q.field('spaceId'), spaceId))
    .filter((q) => q.eq(q.field('kind'), 'access'))
    .first();

  if (!existingAccessRow) {
    await ctx.db.patch(memberId, {
      userId,
      inviteStatus: 'joined',
    });
    await ctx.db.insert('members', {
      userId,
      spaceId,
      role: 'member',
      kind: 'access',
      joinedAt: Date.now(),
    });
  }

  await ctx.db.patch(userId, {
    defaultSpaceId: spaceId,
    pendingMatchMemberId: undefined,
  });

  // Owner familyContacts mirror — reflects real joined state now that
  // access has actually been granted (never stamped earlier).
  const userPhone = user.phone;
  const normalizedUserPhone = userPhone ? normalizeToE164(userPhone) : null;
  if (space.ownerId && normalizedUserPhone) {
    const owner = await ctx.db.get(space.ownerId);
    const contacts = owner?.familyContacts;
    if (owner && Array.isArray(contacts)) {
      let changed = false;
      const updated = (contacts as FamilyContactEntry[]).map((entry) => {
        if (!entry.selectedPhoneNumber) return entry;
        const entryNorm = normalizeToE164(entry.selectedPhoneNumber);
        if (entryNorm === normalizedUserPhone) {
          changed = true;
          return {
            ...entry,
            matchedUserId: userId,
            inviteStatus: 'joined' as const,
          };
        }
        return entry;
      });
      if (changed) {
        await ctx.db.patch(owner._id, { familyContacts: updated });
      }
    }
  }

  return spaceId;
}

// ── isEntityClaimedByOtherUser — Phase 1 claimed-name protection ────────────
/**
 * Pure predicate: true when `entity` is a joined, claimed profile that
 * belongs to a real authenticated user OTHER than `callerUserId`.
 * Retained for legacy consumers; owner profile management no longer uses
 * this predicate to prohibit edits to the family display label.
 */
export function isEntityClaimedByOtherUser(
  entity: { userId?: Id<'users'>; inviteStatus?: string },
  callerUserId: Id<'users'>
): boolean {
  return (
    entity.inviteStatus === 'joined' &&
    entity.userId !== undefined &&
    entity.userId !== callerUserId
  );
}

type FamilyContactEntry = {
  id: string;
  selectedPhoneNumber?: string;
  inviteStatus?: string;
  matchedUserId?: string;
  [key: string]: unknown;
};

// ── matchOnPhone ──────────────────────────────────────────────────────────────
/**
 * HARDENED (Stage 2B+3 security cutover): matchOnPhone is now DISCOVERY-ONLY.
 *
 * SECURITY INVARIANT: a phone match alone must NEVER produce access or
 * joined status. Previously this internalMutation auto-granted access
 * (stamped entity.userId, set inviteStatus:'joined', and created a
 * kind:'access' row) purely from a phone match with no user confirmation.
 * That auto-join is the security issue this cutover removes.
 *
 * New behavior: only stamps `matchedUserId` on the matching entity row (or
 * rows, for multiple matches — each is marked independently, none receive
 * access). This is discovery linkage only — it lets getPendingPhoneMatches
 * surface the match to the user, who must then explicitly confirm via
 * acceptPendingPhoneMatch (below) before any access is granted.
 *
 * Called via ctx.runMutation from convexAuth's createOrUpdateUser callback.
 * The auth callback ctx is scoped to auth tables only; this internalMutation has
 * the full app DataModel including the by_phone index.
 */
export const matchOnPhone = internalMutation({
  args: {
    userId: v.id('users'),
    phone: v.string(),
  },
  handler: async (ctx, { userId, phone }) => {
    const normalizedPhone = normalizeToE164(phone);
    if (!normalizedPhone) return;

    const matchingMembers = await ctx.db
      .query('members')
      .withIndex('by_phone', (q) =>
        q.eq('selectedPhoneNumber', normalizedPhone)
      )
      .collect();

    // PRODUCT RULE: a personal space is NEVER a phone-join target. Entities
    // may legitimately live in a personal space for organizational/display
    // purposes (assignments, birthdays, sharing) but must never be stamped
    // as a discovery match — doing so would let
    // getPendingPhoneMatches/acceptPendingPhoneMatch/executeFamilyJoin
    // surface or finalize a "join" into someone else's personal space. If
    // the space is missing entirely, preserve prior safe behavior by simply
    // not matching it (ctx.db.get returns null for a deleted space, so
    // `space?.type` is undefined and the exclusion does not apply — same as
    // before this change).
    //
    // `affectedSpaceIds` tracks only the spaces actually stamped above, so
    // the familyContacts mirror below (which is keyed by space, not by
    // member row) never touches the owner's mirror for a personal-space
    // entity — this prevents a personal space's owner (who may also own an
    // unrelated eligible family space) from having their family mirror
    // entry silently marked matchedUserId from a skipped personal-space
    // candidate, which could otherwise mask the legitimate family-space
    // match in a later redundant pass (item 8 of the fix spec).
    const affectedSpaceIds = new Set<Id<'spaces'>>();
    for (const member of matchingMembers) {
      if (member.matchedUserId) continue; // already matched — do not overwrite

      const space = await ctx.db.get(member.spaceId);
      if (space && space.type === 'personal') continue;

      affectedSpaceIds.add(member.spaceId);

      // SECURITY (Stage 2B+3): discovery linkage ONLY — matchedUserId is the
      // sole write here. userId, inviteStatus, and the access row are
      // intentionally NOT written. Access is only granted after the user
      // explicitly confirms via acceptPendingPhoneMatch.
      await ctx.db.patch(member._id, {
        matchedUserId: userId,
      });
    }

    // Also update the familyContacts blob on each affected space owner so
    // OnboardingContext hydration (getMyProfile) still works without a
    // migration. SECURITY (Stage 2B+3): mirrors matchedUserId ONLY — never
    // inviteStatus:'joined', since a phone match alone must never imply
    // joined/access status in this mirror either. Only iterates
    // `affectedSpaceIds` (never a personal space) — see comment above.
    for (const spaceId of affectedSpaceIds) {
      const space = await ctx.db.get(spaceId);
      if (!space?.ownerId) continue;
      const owner = await ctx.db.get(space.ownerId);
      if (!owner) continue;
      const contacts = owner.familyContacts;
      if (!contacts || !Array.isArray(contacts)) continue;
      let changed = false;
      const updated = (contacts as FamilyContactEntry[]).map((entry) => {
        if (entry.matchedUserId) return entry;
        if (!entry.selectedPhoneNumber) return entry;
        const entryNorm = normalizeToE164(entry.selectedPhoneNumber);
        if (entryNorm === normalizedPhone) {
          changed = true;
          return { ...entry, matchedUserId: userId };
        }
        return entry;
      });
      if (changed) {
        await ctx.db.patch(owner._id, { familyContacts: updated });
      }
    }
  },
});

// ── getPendingPhoneMatches (Stage 2A foundation) ────────────────────────────
/**
 * Stage 2A foundation ONLY — read-only discovery query.
 *
 * Returns all pending phone matches for the caller as a plural array of
 * minimal-safe-metadata objects. Does NOT auto-select a single match, does
 * NOT grant access, and does NOT modify any data.
 *
 * matchOnPhone (above) still auto-grants access today and is intentionally
 * left unmodified in Stage 2A — see the Stage 2B+3 plan for the hardening
 * pass that will replace matchOnPhone's auto-join with a confirmation flow
 * built on top of this query. This query exists purely as a safe discovery
 * foundation so that future confirmation UI can be built without changing
 * matchOnPhone's current behavior yet.
 *
 * Authorization convention: mirrors listMyFamilyContacts / getMySpaceRole /
 * getSpaceAdminId / getMyResolvedSpaceId in this file — returns [] for an
 * unauthenticated caller rather than throwing.
 *
 * Filtering (all required, defense-in-depth):
 *   - candidate row must resolve to kind === 'entity' (never 'access')
 *   - candidate row's matchedUserId === current userId
 *   - candidate row has a selectedPhoneNumber
 *   - normalized candidate phone === normalized current-user phone
 *     (re-verified here independently of the by_phone index lookup)
 *   - excluded if the current user already has a kind:'access' row in that
 *     same space
 *   - excluded if the space is missing/deleted
 *
 * Response shape is intentionally minimal: memberId, spaceName,
 * displayName, and memberNames only. spaceId is deliberately NOT
 * returned — the client does not need it for rendering, and the accept
 * mutation takes only memberId and derives/re-verifies spaceId
 * server-side from the entity row itself. Never returns phone numbers,
 * other users' ids, permissions, or any other private space content.
 *
 * memberNames (Part 3 UX correction): the display names of every OTHER
 * 'entity' row in the matched space (never 'access' rows, so an admin's
 * own account row is never listed here as a bare name+phone) — lets the
 * confirmation screen show the whole existing family being matched, not
 * just the single matched entity. Uses the same canonical-name resolution
 * as listMyFamilyContacts: a real claimed user's own current fullName, or
 * the stored displayName for an unclaimed/manual profile. Never fabricates
 * a surname and never includes a phone number.
 */
export const getPendingPhoneMatches = query({
  args: {},
  returns: v.array(
    v.object({
      memberId: v.id('members'),
      spaceName: v.string(),
      displayName: v.optional(v.string()),
      memberNames: v.array(v.string()),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const user = await ctx.db.get(userId);
    const userPhone = user?.phone;
    if (!userPhone) return [];

    const normalizedUserPhone = normalizeToE164(userPhone);
    if (!normalizedUserPhone) return [];

    // Same index matchOnPhone uses — scopes candidates to rows that carry
    // the caller's own (already-normalized) phone number.
    const candidateRows = await ctx.db
      .query('members')
      .withIndex('by_phone', (q) =>
        q.eq('selectedPhoneNumber', normalizedUserPhone)
      )
      .collect();

    if (candidateRows.length === 0) return [];

    const myRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const accessSpaceIds = new Set(
      myRows.filter((r) => resolveKind(r) === 'access').map((r) => r.spaceId)
    );

    const candidateSpaceIds = [...new Set(candidateRows.map((r) => r.spaceId))];
    const existingSpaceIds = new Set<Id<'spaces'>>();
    // PRODUCT RULE: a personal space is NEVER a phone-join target. Collected
    // here (independently of matchOnPhone) so this query enforces the
    // invariant itself rather than relying solely on matchOnPhone having
    // already skipped the stamp — a legacy/pre-fix matchedUserId stamped on
    // a personal-space entity before this change must still never surface
    // here.
    const personalSpaceIds = new Set<Id<'spaces'>>();
    const spaceNameById = new Map<Id<'spaces'>, string>();
    for (const spaceId of candidateSpaceIds) {
      const space = await ctx.db.get(spaceId);
      if (space) {
        existingSpaceIds.add(spaceId);
        spaceNameById.set(spaceId, space.name);
        if (space.type === 'personal') personalSpaceIds.add(spaceId);
      }
    }

    const safeCandidates = filterPendingPhoneMatchCandidates({
      currentUserId: userId,
      normalizedUserPhone,
      candidateRows,
      accessSpaceIds,
      personalSpaceIds,
      existingSpaceIds,
      resolveKind,
      normalizeToE164,
    });

    // Part 3 UX correction: resolve every OTHER entity's display name in
    // each safe candidate's space so the confirmation screen can show the
    // whole existing family, not just the single matched entity. Never
    // returns 'access' rows (never a bare admin userId+phone) and never
    // includes phone numbers.
    const memberNamesBySpaceId = new Map<Id<'spaces'>, string[]>();
    for (const spaceId of new Set(safeCandidates.map((r) => r.spaceId))) {
      const spaceRows = await ctx.db
        .query('members')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect();
      const names: string[] = [];
      for (const row of spaceRows) {
        if (resolveKind(row) !== 'entity') continue;
        let name = row.displayName?.trim();
        if (!name && row.matchedUserId) {
          const matchedUser = await ctx.db.get(row.matchedUserId);
          name = (
            matchedUser as { fullName?: string } | null
          )?.fullName?.trim();
        }
        if (name) names.push(name);
      }
      memberNamesBySpaceId.set(spaceId, names);
    }

    return safeCandidates.map((row) => ({
      memberId: row._id,
      spaceName: spaceNameById.get(row.spaceId) ?? '',
      displayName: row.displayName,
      memberNames: memberNamesBySpaceId.get(row.spaceId) ?? [],
    }));
  },
});

// ── acceptPendingPhoneMatch (Family Membership Lifecycle Phase 1) ──────────
/**
 * SELECTION ONLY. This is a deliberate hardening of the original Stage
 * 2B+3 design: accepting a phone match used to grant real access
 * immediately (create a kind:'access' row + patch entity.userId +
 * inviteStatus:'joined'). That is exactly the premature-join pattern the
 * Family Membership Lifecycle plan exists to eliminate — a phone match
 * (even an explicitly confirmed one) must never by itself imply active
 * membership.
 *
 * New behavior: re-verifies the full match chain (identical checks to the
 * previous version) and, if valid, stamps ONLY `user.pendingMatchMemberId`
 * + `user.phoneMatchResolvedAt`. No entity row is touched. No access row
 * is created. No familyContacts mirror write. Real membership is granted
 * later, and only, by executeFamilyJoin — invoked either by
 * finishOnboarding's claimed path (brand-new user) or by
 * completeExistingUserFamilyJoin (already-onboarded user).
 *
 * Full verification chain (all required):
 *   1. authenticated user exists
 *   2. authenticated user has a verified stored phone
 *   3. the member/entity row exists
 *   4. the row is actually an entity row, never an access row
 *   5. entity.matchedUserId === authenticated userId
 *   6. entity.selectedPhoneNumber exists
 *   7-9. normalize both phones and re-verify they are equal
 *   10. the entity's space still exists
 *   11. the entity is not already claimed (userId) by a DIFFERENT user
 *
 * Security: selecting ONE of multiple matches only records intent to
 * continue toward that one space. Remaining matched entities are left
 * untouched.
 */
export const acceptPendingPhoneMatch = mutation({
  args: {
    memberId: v.id('members'),
  },
  returns: v.object({ spaceId: v.id('spaces') }),
  handler: async (ctx, { memberId }) => {
    // 1. authenticated user exists
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    // 2. authenticated user has a verified stored phone
    const userPhone = user.phone;
    if (!userPhone) throw new Error(PERMISSION_DENIED);
    // 7. normalize authenticated user phone
    const normalizedUserPhone = normalizeToE164(userPhone);
    if (!normalizedUserPhone) throw new Error(PERMISSION_DENIED);

    // 3. the member/entity row exists
    const entity = await ctx.db.get(memberId);
    if (!entity) throw new Error('פרופיל לא נמצא');

    // 4. the row is actually an entity row, never an access row
    if (resolveKind(entity) !== 'entity') throw new Error(PERMISSION_DENIED);

    // 5. entity.matchedUserId === authenticated userId
    if (entity.matchedUserId !== userId) throw new Error(PERMISSION_DENIED);

    // 6. entity.selectedPhoneNumber exists
    if (!entity.selectedPhoneNumber) throw new Error(PERMISSION_DENIED);

    // 8. normalize entity selectedPhoneNumber
    const normalizedEntityPhone = normalizeToE164(entity.selectedPhoneNumber);
    if (!normalizedEntityPhone) throw new Error(PERMISSION_DENIED);

    // 9. phones are equal
    if (normalizedEntityPhone !== normalizedUserPhone) {
      throw new Error(PERMISSION_DENIED);
    }

    // 10. entity's space exists
    const spaceId = entity.spaceId;
    const space = await ctx.db.get(spaceId);
    if (!space) throw new Error('המרחב לא נמצא');

    // 12. PRODUCT RULE: a personal space is NEVER a phone-join target.
    // Re-validated here independently of matchOnPhone/getPendingPhoneMatches
    // — this mutation must never trust that the client only ever sends a
    // memberId it received from the already-filtered pending list. A stale
    // client, a manipulated call, or a legacy matchedUserId stamped before
    // this invariant existed must all be rejected the same way, with a
    // user-safe error that reveals no internal ids.
    if (space.type === 'personal') throw new Error(PERMISSION_DENIED);

    // 11. not already claimed by a different real user.
    if (entity.userId !== undefined && entity.userId !== userId) {
      throw new Error(PERMISSION_DENIED);
    }

    // SELECTION ONLY — no access/entity/mirror writes here. See doc
    // comment above.
    await ctx.db.patch(userId, {
      pendingMatchMemberId: memberId,
      phoneMatchResolvedAt: Date.now(),
    });

    return { spaceId };
  },
});

// ── completeExistingUserFamilyJoin (Family Membership Lifecycle Phase 1) ───
/**
 * Completes the join for an ALREADY-ONBOARDED user who previously selected
 * a pending match via acceptPendingPhoneMatch. finishOnboarding's claimed
 * path is the equivalent for a brand-new user still completing identity —
 * both delegate to the same executeFamilyJoin transaction.
 *
 * Requires:
 *   - the caller is authenticated and onboardingCompleted === true
 *     (a not-yet-onboarded user must go through finishOnboarding instead —
 *     this mutation intentionally refuses them to avoid two divergent
 *     completion paths)
 *   - `memberId` matches the user's own `pendingMatchMemberId` exactly
 *     (never trusts an arbitrary client-supplied memberId beyond that it
 *     matches the server-recorded selection)
 *
 * executeFamilyJoin re-verifies the match and re-applies the one-active-
 * family guard atomically before granting access.
 */
export const completeExistingUserFamilyJoin = mutation({
  args: {
    memberId: v.id('members'),
  },
  returns: v.object({ spaceId: v.id('spaces') }),
  handler: async (ctx, { memberId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    if (!user.onboardingCompleted) throw new Error(PERMISSION_DENIED);
    if (!user.pendingMatchMemberId || user.pendingMatchMemberId !== memberId) {
      throw new Error(PERMISSION_DENIED);
    }

    const spaceId = await executeFamilyJoin(ctx, userId, memberId);
    return { spaceId };
  },
});

// ── getMyPendingFamilyPreview (Family Membership Lifecycle Phase 1) ────────
/**
 * Server-driven, minimal-safe preview of the family the caller has
 * SELECTED (via acceptPendingPhoneMatch) but not yet joined. Reads only
 * from `user.pendingMatchMemberId` — never trusts a client-supplied
 * memberId/spaceId — so the client can render a read-only "this is the
 * family you're about to join" card before the explicit Join/Confirm step
 * (completeExistingUserFamilyJoin or finishOnboarding's claimed path).
 *
 * `otherFamilyMembers` deliberately EXCLUDES the pending entity itself
 * (the joining user's own not-yet-joined profile) — never show the
 * joining user's own card back to themselves. Returns
 * displayName/color/memberType per member plus two SAFE booleans
 * (`hasPhoneNumber`, `isConnected`) — never the actual phone digits or
 * any other user's id. These booleans exist so the client can render the
 * same manual/contact/connected distinction used everywhere else in the
 * app (see allServerMembers in app/(authenticated)/family-profile.tsx,
 * which derives sourceType from selectedPhoneNumber the same way) —
 * without that distinction, the preview previously had no reliable
 * signal and every row was mislabeled "פרופיל ידני" (QA fix).
 */
export const getMyPendingFamilyPreview = query({
  args: {},
  returns: v.union(
    v.object({
      spaceName: v.string(),
      otherFamilyMembers: v.array(
        v.object({
          displayName: v.optional(v.string()),
          color: v.optional(v.string()),
          memberType: v.union(v.literal('person'), v.literal('pet')),
          hasPhoneNumber: v.boolean(),
          isConnected: v.boolean(),
        })
      ),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    const pendingMemberId = user?.pendingMatchMemberId;
    if (!pendingMemberId) return null;

    const entity = await ctx.db.get(pendingMemberId);
    if (!entity) return null;
    if (resolveKind(entity) !== 'entity') return null;
    if (entity.matchedUserId !== userId) return null;

    const space = await ctx.db.get(entity.spaceId);
    if (!space) return null;

    const spaceRows = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', entity.spaceId))
      .collect();

    const otherFamilyMembers = await Promise.all(
      spaceRows
        .filter((row) => resolveKind(row) === 'entity' && row._id !== pendingMemberId)
        .map(async (row) => {
          let displayName = row.displayName?.trim() || undefined;
          if (!displayName && row.matchedUserId) {
            const matchedUser = await ctx.db.get(row.matchedUserId);
            displayName =
              (matchedUser as { fullName?: string } | null)?.fullName?.trim() ||
              undefined;
          }
          return {
            displayName,
            color: row.color,
            memberType: (row.memberType ?? 'person') as 'person' | 'pet',
            hasPhoneNumber: Boolean(row.selectedPhoneNumber),
            isConnected: Boolean(row.matchedUserId),
          };
        })
    );

    return { spaceName: space.name, otherFamilyMembers };
  },
});

// ── hasPendingMatchMemberId (Family Membership Lifecycle Phase 1) ──────────
/**
 * Lightweight routing/UI signal: does the caller currently have a
 * SELECTED (not-yet-joined) pending match? Distinct from
 * getPendingPhoneMatches (which surfaces UNRESOLVED discovery-only
 * matches the user hasn't picked from yet) — see the two-concept split in
 * the approved plan. Never exposes the memberId itself here; callers that
 * need the actual preview use getMyPendingFamilyPreview.
 */
export const hasPendingMatchMemberId = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    const user = await ctx.db.get(userId);
    return user?.pendingMatchMemberId !== undefined;
  },
});

// ── undoClaimedFamilyMatch (Family Membership Lifecycle Phase 1) ───────────
/**
 * "Change your mind" affordance for the mandatory Profile Setup / pending-
 * family-preview screens. Since acceptPendingPhoneMatch (above) no longer
 * grants any access — it only records a selection — undoing it is now
 * simply clearing that selection so getPendingPhoneMatches can surface the
 * match again immediately. There is no access row or entity patch to
 * unwind, because none was ever created by selection alone.
 *
 * Refuses to run once onboardingCompleted is true — by that point any
 * join is final and was performed by executeFamilyJoin, not by mere
 * selection, so this mutation has nothing it is entitled to undo. Safe
 * no-op if the caller has no pending selection at all.
 */
export const undoClaimedFamilyMatch = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    if (user.onboardingCompleted) {
      throw new Error(PERMISSION_DENIED);
    }

    if (!user.pendingMatchMemberId) return null; // nothing to undo — safe no-op

    await ctx.db.patch(userId, {
      pendingMatchMemberId: undefined,
      phoneMatchResolvedAt: undefined,
    });

    return null;
  },
});

// ── declinePhoneMatches (Stage 2B+3) ────────────────────────────────────────
/**
 * Records that the user explicitly declined all pending phone matches
 * during onboarding, in favor of setting up their own separate profile.
 *
 * Grants NO access, modifies no entity rows, creates no space. Safe to
 * call repeatedly (idempotent) — after the first call, subsequent calls
 * are no-ops.
 */
export const declinePhoneMatches = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    if (!user.phoneMatchResolvedAt) {
      await ctx.db.patch(userId, { phoneMatchResolvedAt: Date.now() });
    }

    return null;
  },
});

// ── listMyFamilyContacts ──────────────────────────────────────────────────────
/**
 * FIXED: now uses by_kind index instead of brittle displayName !== undefined heuristic.
 *
 * Returns all 'entity' rows for the caller's space — both phone-based contacts
 * and manual members. The by_kind compound index makes this O(entities) not O(space).
 *
 * Backward-compat: rows without a kind field are resolved via resolveKind().
 * The backfillKind mutation (below) can stamp kind on old rows in one pass.
 */
export const listMyFamilyContacts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { selfEntityId: null, members: [] };

    // FIXED: use shared resolveMySpaceId so this function and updateMyProfile
    // always resolve the same spaceId for the same user.
    const spaceId = await resolveMySpaceId(ctx, userId);

    if (!spaceId) return { selfEntityId: null, members: [] };
    const callerRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    if (!callerRows.some((row) => row.spaceId === spaceId && resolveKind(row) === 'access')) {
      return { selfEntityId: null, members: [] };
    }

    // Primary path: use by_kind index for rows that have kind stamped
    const indexedEntities = await ctx.db
      .query('members')
      .withIndex('by_kind', (q) =>
        q.eq('spaceId', spaceId).eq('kind', 'entity')
      )
      .collect();

    // Fallback path: rows without kind field — resolve inline for backward-compat
    // (will be empty after backfillKind runs once)
    const allRows = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();

    const unstampedEntities = allRows.filter(
      (r) => r.kind === undefined && resolveKind(r) === 'entity'
    );

    // Merge, deduplicate by _id
    const seen = new Set(indexedEntities.map((r) => r._id));
    const entities = [
      ...indexedEntities,
      ...unstampedEntities.filter((r) => !seen.has(r._id)),
    ];

    // FIXED: listMyFamilyContacts now returns selfEntityId to enable client-side self-exclusion.
    const selfEntityRow = entities.find(
      (r) => r.matchedUserId === userId || r.userId === userId
    );

    // FIXED: admin user now appears in family list for member users.
    // The space admin has a kind='access' row, not a kind='entity' row, so they are
    // never returned by the entity query. For non-admin viewers we fetch the admin's
    // access row and their user record to build a synthetic member entry.
    const space = await ctx.db.get(spaceId);
    const adminAccessRow = allRows.find((row) =>
      resolveKind(row) === 'access' && row.userId === space?.ownerId
    );

    // FIXED: admin entry now includes phone from users record, shown as linked user not manual
    let adminEntry: {
      _id: Id<'members'>;
      displayName: string;
      color: string;
      selectedPhoneNumber: string | undefined;
      maskedPhone: string | undefined;
      matchedUserId: Id<'users'> | undefined;
      linkedUserId: Id<'users'> | undefined;
      inviteStatus: 'joined';
      memberType: 'person';
      isFullyJoined: true;
      isSelectableForPicker: true;
    } | null = null;

    if (adminAccessRow && adminAccessRow.userId !== userId) {
      const adminUser = adminAccessRow.userId
        ? await ctx.db.get(adminAccessRow.userId)
        : null;
      if (adminUser) {
        const adminPhone =
          (adminUser as unknown as { phone?: string }).phone ?? undefined;
        // FIXED: phone numbers converted to local Israeli format before masking
        const adminPhoneLocal = adminPhone
          ? e164ToLocal(adminPhone)
          : undefined;
        adminEntry = {
          _id: adminAccessRow._id,
          displayName:
            (adminUser as unknown as { fullName?: string }).fullName ??
            'מנהל/ת המשפחה',
          color:
            (adminUser as unknown as { profileColor?: string }).profileColor ??
            '#36a9e2',
          selectedPhoneNumber: adminPhone,
          maskedPhone: adminPhoneLocal ? maskPhone(adminPhoneLocal) : undefined,
          matchedUserId: adminAccessRow.userId,
          linkedUserId: adminAccessRow.userId,
          inviteStatus: 'joined',
          memberType: 'person',
          isFullyJoined: true,
          isSelectableForPicker: true,
        };
      }
    }

    // ── FIX 9 FOLLOW-UP: canonical Self profile normalization ────────────
    // Joined family members already have an 'entity' row for themselves
    // (via matchOnPhone) — that row IS their canonical Self and is already
    // included in `entities`/`enrichedEntities` below, so no synthesis is
    // needed. The space admin has no such entity row (only their own
    // 'access' row), so without normalization their own profile is
    // entirely absent from this list — this is the confirmed root cause of
    // the admin's profile missing from the Community association picker
    // and Calendar profile filter.
    //
    // We build a synthetic Self candidate from the viewer's OWN access row
    // + user record — using the exact same representation shape as
    // `adminEntry` above (which shows the admin to OTHER family members) —
    // but this is not a role-based special case: any access-kind viewer
    // without an entity row gets the same synthesis. `buildCanonicalFamilyMembers`
    // only injects it when `selfEntityRow` is null, so Self can never be
    // duplicated.
    let syntheticSelfCandidate: typeof adminEntry = null;
    if (!selfEntityRow) {
      const myAccessRow = allRows.find(
        (r) => r.userId === userId && resolveKind(r) === 'access'
      );
      if (myAccessRow) {
        const me = await ctx.db.get(userId);
        if (me) {
          const myPhone =
            (me as unknown as { phone?: string }).phone ?? undefined;
          const myPhoneLocal = myPhone ? e164ToLocal(myPhone) : undefined;
          syntheticSelfCandidate = {
            _id: myAccessRow._id,
            displayName:
              (me as unknown as { fullName?: string }).fullName ??
              'הפרופיל שלי',
            color:
              (me as unknown as { profileColor?: string }).profileColor ??
              '#36a9e2',
            selectedPhoneNumber: myPhone,
            maskedPhone: myPhoneLocal ? maskPhone(myPhoneLocal) : undefined,
            matchedUserId: userId,
            linkedUserId: userId,
            inviteStatus: 'joined',
            memberType: 'person',
            isFullyJoined: true,
            isSelectableForPicker: true,
          };
        }
      }
    }

    const enrichedEntities = await Promise.all(
      entities.map(async (m) => {
        const localPhone = m.selectedPhoneNumber
          ? e164ToLocal(m.selectedPhoneNumber)
          : undefined;
        let displayName = m.displayName?.trim() || undefined;
        if (!displayName && m.matchedUserId) {
          const user = await ctx.db.get(m.matchedUserId);
          displayName =
            (user as { fullName?: string } | null)?.fullName?.trim() ||
            undefined;
        }
        // Family Membership Lifecycle Phase 1 — server-derived invariants.
        // See computeIsFullyJoined/computeIsSelectableForPicker doc
        // comments above. isSelectableForPicker (never isFullyJoined
        // alone) is the canonical picker-visibility rule — manual/local
        // profiles with no phone remain selectable.
        const fullyJoined = await computeIsFullyJoined(ctx, m);
        const selectableForPicker = computeIsSelectableForPicker(
          m,
          fullyJoined
        );
        return {
          _id: m._id,
          selectedPhoneNumber: m.selectedPhoneNumber,
          maskedPhone: localPhone ? maskPhone(localPhone) : undefined,
          matchedUserId: m.matchedUserId,
          linkedUserId: fullyJoined && m.memberType !== 'pet' ? m.userId : undefined,
          inviteStatus: m.inviteStatus,
          displayName,
          color: m.color,
          // Rows without memberType were created before this field existed — treat as 'person'.
          memberType: (m.memberType ?? 'person') as 'person' | 'pet',
          isFullyJoined: fullyJoined,
          isSelectableForPicker: selectableForPicker,
        };
      })
    );

    // Canonical merge: injects the synthetic Self candidate exactly once
    // (only when no real entity row already represents the viewer), keeps
    // the unrelated `adminEntry` (Self of ANOTHER user, shown to non-admin
    // viewers) fully independent, and resolves ONE canonical Self id used
    // consistently for both display and default-to-self association
    // matching (see lib/calendarProfileFilter.ts).
    const { selfId: canonicalSelfId, members: finalMembers } =
      buildCanonicalFamilyMembers({
        entities: enrichedEntities,
        selfEntityId: selfEntityRow?._id ?? null,
        syntheticSelfCandidate,
        otherAccessEntry: adminEntry,
      });

    const selfEntity = selfEntityRow
      ? {
          _id: selfEntityRow._id,
          displayName: selfEntityRow.displayName,
          color: selfEntityRow.color,
          matchedUserId: selfEntityRow.matchedUserId,
        }
      : syntheticSelfCandidate
        ? {
            _id: syntheticSelfCandidate._id,
            displayName: syntheticSelfCandidate.displayName,
            color: syntheticSelfCandidate.color,
            matchedUserId: syntheticSelfCandidate.matchedUserId,
          }
        : null;

    return {
      selfEntityId: canonicalSelfId,
      selfEntity,
      members: finalMembers,
    };
  },
});

/** @deprecated use listMyFamilyContacts */
export const listMyInvitedContacts = listMyFamilyContacts;

// ── getSpaceAdminId ───────────────────────────────────────────────────────────
// FIXED: returns the userId of the admin access-row for the caller's space.
// Used by family-profile.tsx to identify which entity row (if any) belongs to
// the admin so the "מנהל/ת המשפחה" badge can be shown on the correct card.
export const getSpaceAdminId = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // FIXED: use shared resolveMySpaceId for consistent space resolution
    const spaceId = await resolveMySpaceId(ctx, userId);
    if (!spaceId) return null;

    const spaceRows = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();

    if (!spaceRows.some((row) => row.userId === userId && resolveKind(row) === 'access')) return null;
    return (await ctx.db.get(spaceId))?.ownerId ?? null;
  },
});

// ── getMyRoleInSpace (exported query) ────────────────────────────────────────
// FIXED: added public query for role checks from client code if needed
export const getMySpaceRole = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // FIXED: use shared resolveMySpaceId for consistent space resolution
    const rows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const memberRow = rows.find(
      (r) => r.role === 'member' && resolveKind(r) === 'access'
    );
    const adminRow = rows.find(
      (r) => r.role === 'admin' && resolveKind(r) === 'access'
    );
    const spaceRow = memberRow ?? adminRow;
    if (!spaceRow) return null;

    return {
      spaceId: spaceRow.spaceId,
      role: spaceRow.role,
      isOwner: (await ctx.db.get(spaceRow.spaceId))?.ownerId === userId,
    };
  },
});

// ── getMyResolvedSpaceId ──────────────────────────────────────────────────────
// Returns the same spaceId that listByDateRange (and all calendar queries) use —
// the result of resolveMySpaceId's 4-priority algorithm.
//
// This replaces api.users.getMySpace (which used a naive .first() and returned
// whichever members row happened to come first — wrong for users with multiple rows).
// Using this query for personal event creation ensures the event lands in the
// same space that the calendar and home queries read from.
export const getMyResolvedSpaceId = query({
  args: {},
  returns: v.union(v.id('spaces'), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await resolveMySpaceId(ctx, userId);
  },
});

// ── hasCreatorOrphanAuthority ────────────────────────────────────────────────
/**
 * DB-backed wrapper around `hasCreatorOrphanFallbackAuthority`
 * (lib/creatorOrphanAuthority.ts) — resolves `creatorExists` and
 * `callerIsSpaceAdmin` from ctx.db, then delegates the actual decision to
 * that pure helper. See its doc comment for the full invariant list.
 *
 * Used by the narrow family event/task authorization fallback (events.ts
 * `update`/`cancelEvent`/`deleteEvent`/`softDeletePersonalEvent`, tasks.ts
 * `update`'s full-edit-right calculation, `softDeleteTask`'s delete
 * eligibility, and the subtask mutations' shared edit-access gate) so that
 * content whose creator has been deleted (see convex/accountDeletion.ts)
 * remains manageable by the family space's actual admin authority, without
 * ever broadening permissions for a live creator or granting authority to
 * ordinary family members.
 */
export async function hasCreatorOrphanAuthority(
  ctx: QueryCtx | MutationCtx,
  params: {
    createdBy: Id<'users'>;
    spaceId?: Id<'spaces'>;
    communityId?: Id<'communities'>;
    callerId: Id<'users'>;
  }
): Promise<boolean> {
  if (params.communityId !== undefined) return false;
  if (!params.spaceId) return false;

  const creator = await ctx.db.get(params.createdBy);
  const creatorExists = creator !== null;
  if (creatorExists) return false;

  const callerRows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', params.callerId))
    .collect();
  const callerIsSpaceAdmin = callerRows.some(
    (row) =>
      row.spaceId === params.spaceId &&
      resolveKind(row) === 'access' &&
      row.role === 'admin'
  );

  return hasCreatorOrphanFallbackAuthority({
    creatorExists,
    isCommunityContent: params.communityId !== undefined,
    hasSpace: true,
    callerIsSpaceAdmin,
  });
}

// Profile management belongs to the space owner, not an arbitrary admin row.
export async function requireSpaceOwner(
  ctx: MutationCtx,
  spaceId: Id<'spaces'>
): Promise<void> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error(PERMISSION_DENIED);
  const space = await ctx.db.get(spaceId);
  const rows = await ctx.db.query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId)).collect();
  if (space?.ownerId !== userId || !rows.some(
    (row) => row.spaceId === spaceId && resolveKind(row) === 'access'
  )) throw new Error(PERMISSION_DENIED);
}

/** Fail closed until a safe personal-data migration on removal is implemented.
 * Matching identifiers are used only to BLOCK deletion, never to revoke access.
 */
export async function assertProfileCanBeRemoved(
  ctx: MutationCtx,
  row: Doc<'members'>
): Promise<void> {
  const space = await ctx.db.get(row.spaceId);
  if (row.userId === space?.ownerId || row.matchedUserId === space?.ownerId) {
    throw new Error('לא ניתן להסיר את פרופיל הבעלות על המרחב');
  }
  const rows = await ctx.db.query('members')
    .withIndex('by_space', (q) => q.eq('spaceId', row.spaceId)).collect();
  if (row.inviteStatus === 'joined' || rows.some((member) =>
    resolveKind(member) === 'access' && member.userId !== undefined &&
    (member.userId === row.userId || member.userId === row.matchedUserId)
  )) {
    throw new Error('הסרת חשבון מחובר וביטול הגישה למשפחה עדיין אינם זמינים');
  }
}

// ── Admin-guarded mutations ───────────────────────────────────────────────────

/**
 * FIXED: admin permission guard — only the space owner can rename their space.
 * Demonstrates the guard pattern; expand to other admin operations as needed.
 */
export const renameSpace = mutation({
  args: {
    spaceId: v.id('spaces'),
    name: v.string(),
  },
  handler: async (ctx, { spaceId, name }) => {
    await requireSpaceOwner(ctx, spaceId);
    await ctx.db.patch(spaceId, { name });
  },
});

/**
 * FIXED: admin permission guard — only the space owner can remove unconnected entity rows.
 * Client family-profile screen uses this when deleting a family member.
 */
export const removeEntityMember = mutation({
  args: {
    memberId: v.id('members'),
  },
  handler: async (ctx, { memberId }) => {
    if (!(await getAuthUserId(ctx))) throw new Error(PERMISSION_DENIED);
    const row = await ctx.db.get(memberId);
    if (!row) throw new Error('פרופיל לא נמצא');
    if (resolveKind(row) !== 'entity') throw new Error(PERMISSION_DENIED);
    await requireSpaceOwner(ctx, row.spaceId);
    await assertProfileCanBeRemoved(ctx, row);
    await ctx.db.delete(memberId);
  },
});

// ── backfillAccessRows — idempotent, manual dashboard run only ───────────────
/**
 * FIXED: one-time backfill to create missing access rows for users who were
 * matched via matchOnPhone before the access-row creation logic was added.
 *
 * For every entity row that has matchedUserId set, checks whether that user
 * already has a kind='access' row in the same space. If not, creates one with
 * role='member'. Safe to run multiple times (idempotent).
 *
 * Run from Convex dashboard → Functions → members:backfillAccessRows → Run.
 * Do NOT call from application code.
 */
export const backfillAccessRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('members').collect();
    const matchedEntities = all.filter(
      (r) => resolveKind(r) === 'entity' && r.matchedUserId != null
    );

    let created = 0;
    let alreadyExisted = 0;

    for (const entity of matchedEntities) {
      const userId = entity.matchedUserId!;
      const existing = all.find(
        (r) =>
          r.userId === userId &&
          r.spaceId === entity.spaceId &&
          resolveKind(r) === 'access'
      );
      if (existing) {
        alreadyExisted++;
        continue;
      }
      await ctx.db.insert('members', {
        userId,
        spaceId: entity.spaceId,
        role: 'member',
        kind: 'access',
        joinedAt: Date.now(),
      });
      created++;
    }

    return {
      matchedEntitiesScanned: matchedEntities.length,
      accessRowsCreated: created,
      alreadyExisted,
    };
  },
});

// ── backfillEntityRows — idempotent, manual dashboard run only ───────────────
/**
 * FIXED: backfillEntityRows writes existing familyContacts blob to members table.
 * Users who saved family contacts before the members-table sync existed (or before
 * defaultSpaceId was stamped) have a populated familyContacts blob on their user
 * record but zero entity rows in the members table.
 *
 * This mutation:
 *  - Scans all users with a non-empty familyContacts array
 *  - Finds their spaceId via their admin access row in the members table
 *  - Writes each familyContact as a kind='entity' members row if one doesn't exist
 *  - Dedupes: contact rows by normalizedPhone, manual rows by displayName
 *
 * Safe to run multiple times (idempotent).
 * Run from Convex dashboard → Functions → members:backfillEntityRows → Run.
 * Do NOT call from application code.
 */
export const backfillEntityRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allUsers = await ctx.db.query('users').collect();
    const allMemberRows = await ctx.db.query('members').collect();

    let usersProcessed = 0;
    let entityRowsCreated = 0;
    let alreadyExisted = 0;
    const now = Date.now();

    for (const user of allUsers) {
      const contacts = (user as unknown as { familyContacts?: unknown })
        .familyContacts;
      if (!Array.isArray(contacts) || contacts.length === 0) continue;

      // Find this user's admin access row to get their spaceId
      const adminRow = allMemberRows.find(
        (r) =>
          r.userId === user._id &&
          r.role === 'admin' &&
          resolveKind(r) === 'access'
      );
      if (!adminRow?.spaceId) continue;

      const spaceId = adminRow.spaceId;
      const existingInSpace = allMemberRows.filter(
        (r) => r.spaceId === spaceId
      );

      usersProcessed++;

      for (const contact of contacts as Array<Record<string, unknown>>) {
        const isManual = !contact.selectedPhoneNumber;

        if (isManual) {
          const displayName = (contact.name ?? contact.displayName) as
            | string
            | undefined;
          if (!displayName) continue;
          const exists = existingInSpace.find(
            (m) =>
              resolveKind(m) === 'entity' &&
              !m.selectedPhoneNumber &&
              m.displayName === displayName
          );
          if (exists) {
            alreadyExisted++;
            continue;
          }
          await ctx.db.insert('members', {
            spaceId,
            role: 'member',
            kind: 'entity',
            joinedAt: now,
            displayName,
            color: contact.color as string | undefined,
            inviteStatus: 'none',
          });
          entityRowsCreated++;
        } else {
          const normalizedPhone = normalizeToE164(
            contact.selectedPhoneNumber as string
          );
          if (!normalizedPhone) continue;
          const exists = existingInSpace.find(
            (m) =>
              resolveKind(m) === 'entity' &&
              m.selectedPhoneNumber === normalizedPhone
          );
          if (exists) {
            alreadyExisted++;
            continue;
          }
          const matchedId = contact.matchedUserId as Id<'users'> | undefined;
          const displayName = (contact.name ?? contact.displayName) as
            | string
            | undefined;
          await ctx.db.insert('members', {
            spaceId,
            role: 'member',
            kind: 'entity',
            joinedAt: now,
            displayName,
            color: contact.color as string | undefined,
            selectedPhoneNumber: normalizedPhone,
            inviteStatus:
              (contact.inviteStatus as 'none' | 'invited' | 'joined') ?? 'none',
            matchedUserId: matchedId,
            userId: matchedId,
          });
          entityRowsCreated++;
        }
      }
    }

    return { usersProcessed, entityRowsCreated, alreadyExisted };
  },
});

// ── backfillKind — idempotent, manual dashboard run only ─────────────────────
/**
 * FIXED: one-time backfill to stamp kind on all rows created before the field existed.
 *
 * Safe to run multiple times (idempotent — skips rows that already have kind).
 * Run from Convex dashboard → Functions → members:backfillKind → Run.
 * Do NOT call from application code.
 *
 * Returns a summary of how many rows were stamped in each category.
 */
export const backfillKind = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('members').collect();
    let accessStamped = 0;
    let entityStamped = 0;
    let alreadySet = 0;

    for (const row of all) {
      if (row.kind !== undefined) {
        alreadySet++;
        continue;
      }
      const inferred = resolveKind(row);
      await ctx.db.patch(row._id, { kind: inferred });
      if (inferred === 'access') accessStamped++;
      else entityStamped++;
    }

    return {
      total: all.length,
      alreadySet,
      accessStamped,
      entityStamped,
    };
  },
});

// ── dedupeEntityRows — idempotent, manual dashboard run only ─────────────────
/**
 * FIXED: dedupeEntityRows removes existing duplicate entity rows created before
 * the הפוך לאיש קשר patch-vs-insert fix was applied.
 *
 * For each space, groups entity rows by displayName. When a group has >1 row:
 *  - Keeps the row that has selectedPhoneNumber (the contact-sourced one).
 *  - If multiple rows have a phone, keeps the most recently created (_creationTime desc).
 *  - Deletes all other rows in the group.
 *
 * Safe to run multiple times (idempotent).
 * Run from Convex dashboard → Functions → members:dedupeEntityRows → Run.
 * Do NOT call from application code.
 */
export const dedupeEntityRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('members').collect();
    const entities = all.filter((r) => resolveKind(r) === 'entity');

    // Group by spaceId + displayName
    const groups = new Map<string, typeof entities>();
    for (const row of entities) {
      if (!row.displayName) continue;
      const key = `${row.spaceId}::${row.displayName}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    let duplicatesFound = 0;
    let duplicatesRemoved = 0;

    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      duplicatesFound += group.length - 1;

      // Prefer the row with a phone; among ties, prefer most recent
      group.sort((a, b) => {
        if (a.selectedPhoneNumber && !b.selectedPhoneNumber) return -1;
        if (!a.selectedPhoneNumber && b.selectedPhoneNumber) return 1;
        return b._creationTime - a._creationTime;
      });

      const [keep, ...remove] = group;
      // Ensure the keeper has kind stamped
      if (!keep.kind) await ctx.db.patch(keep._id, { kind: 'entity' });

      for (const dup of remove) {
        await ctx.db.delete(dup._id);
        duplicatesRemoved++;
      }
    }

    return { duplicatesFound, duplicatesRemoved };
  },
});

// ── fixMemberAccessSpace ──────────────────────────────────────────────────────
// One-time dashboard mutation: moves a member's access row from a stale space
// to the correct family space. Call via Convex dashboard — NOT from app code.
export const fixMemberAccessSpace = internalMutation({
  args: {
    userId: v.id('users'),
    fromSpaceId: v.id('spaces'),
    toSpaceId: v.id('spaces'),
  },
  handler: async (ctx, { userId, fromSpaceId, toSpaceId }) => {
    const rows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const accessRow = rows.find(
      (r) =>
        r.spaceId === fromSpaceId &&
        r.role === 'member' &&
        resolveKind(r) === 'access'
    );

    if (!accessRow) {
      console.log(
        '[FIX SPACE] No access row found in fromSpaceId for user',
        userId
      );
      return { fixed: false };
    }

    const existingInTarget = rows.find(
      (r) =>
        r.spaceId === toSpaceId &&
        r.role === 'member' &&
        resolveKind(r) === 'access'
    );

    if (existingInTarget) {
      // Already has access to toSpaceId — delete the stale fromSpaceId access row.
      await ctx.db.delete(accessRow._id);
      console.log(
        '[FIX SPACE] Deleted stale access row',
        accessRow._id,
        'user already in toSpaceId'
      );
      return { fixed: true, action: 'deleted_stale' };
    }

    // Move: patch the access row's spaceId to the correct family space.
    await ctx.db.patch(accessRow._id, { spaceId: toSpaceId });
    console.log(
      '[FIX SPACE] Moved access row',
      accessRow._id,
      'from',
      fromSpaceId,
      '→',
      toSpaceId
    );
    return { fixed: true, action: 'patched' };
  },
});
