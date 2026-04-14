import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';

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
  const memberRow = rows.find((r) => r.role === 'member' && resolveKind(r) === 'access');
  const adminRow = rows.find((r) => r.role === 'admin' && resolveKind(r) === 'access');
  const spaceRow = memberRow ?? adminRow;
  return spaceRow?.spaceId ?? null;
}

const PERMISSION_DENIED =
  'אין לך הרשאה לבצע פעולה זו. אפשר לפנות למנהל/ת המשפחה.';

type FamilyContactEntry = {
  id: string;
  selectedPhoneNumber?: string;
  inviteStatus?: string;
  matchedUserId?: string;
  [key: string]: unknown;
};

// ── matchOnPhone ──────────────────────────────────────────────────────────────
/**
 * FIXED: phone-based family member matching using by_phone index on members table.
 * FIXED: matchOnPhone no longer changes kind when stamping userId on an entity row.
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

    for (const member of matchingMembers) {
      if (member.matchedUserId) continue; // already matched — do not overwrite
      // FIXED: kind is intentionally NOT patched here — entity rows stay 'entity'
      // even after receiving a userId via phone match. resolveKind() handles the
      // access/entity distinction for queries; stamping kind:'access' here would
      // grant the matched user implicit space access they never requested.
      await ctx.db.patch(member._id, {
        matchedUserId: userId,
        userId: userId,
        inviteStatus: 'joined',
      });

      // FIXED: matchOnPhone now creates access membership row for matched user in family space
      // Without this, the matched user has no access row in the inviter's space,
      // so listMyFamilyContacts finds their own (empty) space instead of the inviter's space.
      const existingAccessRow = await ctx.db
        .query('members')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .filter((q) => q.eq(q.field('spaceId'), member.spaceId))
        .filter((q) => q.eq(q.field('kind'), 'access'))
        .first();

      if (!existingAccessRow) {
        await ctx.db.insert('members', {
          userId: userId,
          spaceId: member.spaceId,
          role: 'member',
          kind: 'access',
          joinedAt: Date.now(),
        });
      }
    }

    // Also update the familyContacts blob on each affected space owner so
    // OnboardingContext hydration (getMyProfile) still works without a migration.
    const affectedSpaceIds = [...new Set(matchingMembers.map((m) => m.spaceId))];
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
          return { ...entry, matchedUserId: userId, inviteStatus: 'joined' };
        }
        return entry;
      });
      if (changed) {
        await ctx.db.patch(owner._id, { familyContacts: updated });
      }
    }
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
    console.log('[DEBUG] listMyFamilyContacts userId:', userId);
    if (!userId) return { selfEntityId: null, members: [] };

    // FIXED: use shared resolveMySpaceId so this function and updateMyProfile
    // always resolve the same spaceId for the same user.
    const spaceId = await resolveMySpaceId(ctx, userId);
    console.log('[DEBUG] listMyFamilyContacts spaceId:', spaceId);

    if (!spaceId) return { selfEntityId: null, members: [] };

    const allRowsInSpace = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    console.log('[DEBUG] ALL rows in space (no filter):', JSON.stringify(allRowsInSpace.map(r => ({
      _id: r._id,
      kind: r.kind,
      role: r.role,
      displayName: r.displayName,
      userId: r.userId,
    }))));
    console.log('[DEBUG YANIV] ALL rows in Yaniv space:', JSON.stringify(
      allRowsInSpace.map(r => ({ _id: r._id, kind: r.kind, role: r.role, displayName: r.displayName }))
    ));

    // Primary path: use by_kind index for rows that have kind stamped
    const indexedEntities = await ctx.db
      .query('members')
      .withIndex('by_kind', (q) =>
        q.eq('spaceId', spaceId).eq('kind', 'entity')
      )
      .collect();

    console.log('[DEBUG YANIV] by_kind entity rows:', indexedEntities.length);
    console.log('[DEBUG YANIV] entity rows detail:', JSON.stringify(
      indexedEntities.map(r => ({ _id: r._id, displayName: r.displayName, kind: r.kind, spaceId: r.spaceId }))
    ));

    // Fallback path: rows without kind field — resolve inline for backward-compat
    // (will be empty after backfillKind runs once)
    const allRows = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    console.log('[DEBUG] all rows in space:', JSON.stringify(allRows.map(r => ({ _id: r._id, kind: r.kind, role: r.role, displayName: r.displayName }))));

    const unstampedEntities = allRows.filter(
      (r) => r.kind === undefined && resolveKind(r) === 'entity'
    );

    // Merge, deduplicate by _id
    const seen = new Set(indexedEntities.map((r) => r._id));
    const entities = [
      ...indexedEntities,
      ...unstampedEntities.filter((r) => !seen.has(r._id)),
    ];

    console.log('[DEBUG] entity rows found:', entities.length);

    // FIXED: listMyFamilyContacts now returns selfEntityId to enable client-side self-exclusion.
    const selfEntityRow = entities.find(
      (r) => r.matchedUserId === userId || r.userId === userId
    );

    // FIXED: admin user now appears in family list for member users.
    // The space admin has a kind='access' row, not a kind='entity' row, so they are
    // never returned by the entity query. For non-admin viewers we fetch the admin's
    // access row and their user record to build a synthetic member entry.
    const adminAccessRow = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .filter((q) => q.eq(q.field('role'), 'admin'))
      .filter((q) => q.eq(q.field('kind'), 'access'))
      .first();

    // FIXED: admin entry now includes phone from users record, shown as linked user not manual
    let adminEntry: {
      _id: Id<'members'>;
      displayName: string;
      color: string;
      selectedPhoneNumber: string | undefined;
      maskedPhone: string | undefined;
      matchedUserId: Id<'users'> | undefined;
      inviteStatus: 'joined';
    } | null = null;

    if (adminAccessRow && adminAccessRow.userId !== userId) {
      const adminUser = adminAccessRow.userId
        ? await ctx.db.get(adminAccessRow.userId)
        : null;
      if (adminUser) {
        const adminPhone = (adminUser as unknown as { phone?: string }).phone ?? undefined;
        // FIXED: phone numbers converted to local Israeli format before masking
        const adminPhoneLocal = adminPhone ? e164ToLocal(adminPhone) : undefined;
        adminEntry = {
          _id: adminAccessRow._id,
          displayName: (adminUser as unknown as { fullName?: string }).fullName ?? 'מנהל/ת המשפחה',
          color: (adminUser as unknown as { profileColor?: string }).profileColor ?? '#36a9e2',
          selectedPhoneNumber: adminPhone,
          maskedPhone: adminPhoneLocal ? maskPhone(adminPhoneLocal) : undefined,
          matchedUserId: adminAccessRow.userId,
          inviteStatus: 'joined',
        };
      }
    }

    return {
      selfEntityId: selfEntityRow?._id ?? null,
      members: [
        ...(adminEntry ? [adminEntry] : []),
        // FIXED: e164ToLocal applied to all entity rows, not just admin entry
        ...entities.map((m) => {
          const localPhone = m.selectedPhoneNumber
            ? e164ToLocal(m.selectedPhoneNumber)
            : undefined;
          return {
            _id: m._id,
            selectedPhoneNumber: m.selectedPhoneNumber,
            maskedPhone: localPhone ? maskPhone(localPhone) : undefined,
            matchedUserId: m.matchedUserId,
            inviteStatus: m.inviteStatus,
            displayName: m.displayName,
            color: m.color,
          };
        }),
      ],
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

    const spaceAdminRow = spaceRows.find(
      (r) => resolveKind(r) === 'access' && r.role === 'admin'
    );

    return spaceAdminRow?.userId ?? null;
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
    };
  },
});

// ── requireSpaceAdmin ─────────────────────────────────────────────────────────
// FIXED: permission guard helper for admin-only mutations
// Throws PERMISSION_DENIED if the caller is not an admin-kind access row for the space.
async function requireSpaceAdmin(ctx: MutationCtx, spaceId: string): Promise<void> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error(PERMISSION_DENIED);

  const rows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();

  const accessRow = rows.find(
    (r) =>
      r.spaceId === spaceId &&
      resolveKind(r) === 'access' &&
      r.role === 'admin'
  );

  if (!accessRow) throw new Error(PERMISSION_DENIED);
}

// ── Admin-guarded mutations ───────────────────────────────────────────────────

/**
 * FIXED: admin permission guard — only space admins can rename their space.
 * Demonstrates the guard pattern; expand to other admin operations as needed.
 */
export const renameSpace = mutation({
  args: {
    spaceId: v.id('spaces'),
    name: v.string(),
  },
  handler: async (ctx, { spaceId, name }) => {
    await requireSpaceAdmin(ctx, spaceId);
    await ctx.db.patch(spaceId, { name });
  },
});

/**
 * FIXED: admin permission guard — only space admins can remove entity rows.
 * Client family-profile screen uses this when deleting a family member.
 */
export const removeEntityMember = mutation({
  args: {
    memberId: v.id('members'),
  },
  handler: async (ctx, { memberId }) => {
    console.log('[CONVEX DELETE] memberId received:', memberId);
    const row = await ctx.db.get(memberId);
    if (!row) throw new Error('פרופיל לא נמצא');
    if (resolveKind(row) !== 'entity') throw new Error(PERMISSION_DENIED);
    await requireSpaceAdmin(ctx, row.spaceId);
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
      const contacts = (user as unknown as { familyContacts?: unknown }).familyContacts;
      if (!Array.isArray(contacts) || contacts.length === 0) continue;

      // Find this user's admin access row to get their spaceId
      const adminRow = allMemberRows.find(
        (r) => r.userId === user._id && r.role === 'admin' && resolveKind(r) === 'access'
      );
      if (!adminRow?.spaceId) continue;

      const spaceId = adminRow.spaceId;
      const existingInSpace = allMemberRows.filter((r) => r.spaceId === spaceId);

      usersProcessed++;

      for (const contact of contacts as Array<Record<string, unknown>>) {
        const isManual = !contact.selectedPhoneNumber;

        if (isManual) {
          const displayName = (contact.name ?? contact.displayName) as string | undefined;
          if (!displayName) continue;
          const exists = existingInSpace.find(
            (m) => resolveKind(m) === 'entity' && !m.selectedPhoneNumber && m.displayName === displayName
          );
          if (exists) { alreadyExisted++; continue; }
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
          const normalizedPhone = normalizeToE164(contact.selectedPhoneNumber as string);
          if (!normalizedPhone) continue;
          const exists = existingInSpace.find(
            (m) => resolveKind(m) === 'entity' && m.selectedPhoneNumber === normalizedPhone
          );
          if (exists) { alreadyExisted++; continue; }
          const matchedId = contact.matchedUserId as Id<'users'> | undefined;
          const displayName = (contact.name ?? contact.displayName) as string | undefined;
          await ctx.db.insert('members', {
            spaceId,
            role: 'member',
            kind: 'entity',
            joinedAt: now,
            displayName,
            color: contact.color as string | undefined,
            selectedPhoneNumber: normalizedPhone,
            inviteStatus: (contact.inviteStatus as 'none' | 'invited' | 'joined') ?? 'none',
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
