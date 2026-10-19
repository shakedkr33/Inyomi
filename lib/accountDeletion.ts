// ============================================================================
// accountDeletion.ts — pure planning/safety helpers for
// convex/accountDeletion.ts (production account-deletion engine)
// ============================================================================
//
// This repo has no Convex mutation test harness (see
// tests/convex/qaResetUser.test.ts's documented precedent). Given that
// constraint:
//
//   - Every safety-critical planning/decision function here is pure (no
//     ctx/db access, no network calls, no randomness, no wall-clock reads)
//     so it can be fully unit-tested without a live Convex backend.
//   - Invariants that require inspecting the actual shipped mutation body
//     (guard ordering, deletion-order, no destructive writes before
//     blockers pass, users row deleted last, etc.) are verified via source
//     inspection of the real convex/accountDeletion.ts / convex/users.ts
//     files — the same pattern already used by
//     tests/convex/qaResetUser.test.ts and
//     tests/convex/usersAccessControlWave1.test.ts.
//
// Fail-closed philosophy (mirrors lib/qaReset.ts): these helpers never
// attempt a "best effort" cleanup for an ambiguous or unexpected state. If
// a caller's input represents something outside the known-safe scenarios,
// the corresponding function produces a blocker rather than a destructive
// decision.
// ============================================================================

// ── Transaction-size preflight ──────────────────────────────────────────────

/**
 * Conservative safety ceiling for the total number of destructive writes
 * (deletes + patches) a single deleteMyAccount transaction may perform.
 *
 * Convex's documented per-mutation transaction limits (see
 * node_modules/convex's bundled limits) are 16,384 total document writes
 * and 32,768 total document reads per transaction. This threshold is set
 * to roughly 25% of the write ceiling: every planned write in this engine
 * is preceded by at least one read (often several, e.g. reading an event
 * before deleting its eventTasks), and the engine also performs a
 * post-write verification-read pass — so the effective read budget is the
 * real constraint in practice, not the write ceiling itself. A 4x margin
 * against the write ceiling keeps the actual (write + read + verification)
 * footprint comfortably inside both limits for any deletion this
 * preflight allows through.
 */
export const ACCOUNT_DELETION_MAX_PLANNED_WRITES = 4000;

export interface AccountDeletionTransactionSizeResult {
  safe: boolean;
  blocker: string | null;
}

/** Sums a plannedCounts-style record into a single total write estimate. */
export function estimateAccountDeletionWriteCount(
  plannedCounts: Readonly<Record<string, number>>
): number {
  return Object.values(plannedCounts).reduce((sum, n) => sum + n, 0);
}

/**
 * BLOCKS (does not attempt) an account deletion whose planned destructive
 * write volume exceeds the safe ceiling, rather than starting a large
 * deletion and hoping it completes within Convex's transaction limits.
 */
export function evaluateAccountDeletionTransactionSize(
  plannedWriteCount: number
): AccountDeletionTransactionSizeResult {
  if (plannedWriteCount > ACCOUNT_DELETION_MAX_PLANNED_WRITES) {
    return {
      safe: false,
      blocker: `לא ניתן למחוק את החשבון באופן מיידי: היקף המחיקה המתוכנן (${plannedWriteCount} רשומות) חורג מהסף הבטוח (${ACCOUNT_DELETION_MAX_PLANNED_WRITES}). נא לפנות לתמיכה.`,
    };
  }
  return { safe: true, blocker: null };
}

/** Safe to execute live iff there are zero blockers. */
export function isAccountDeletionSafeToExecute(
  blockers: readonly string[]
): boolean {
  return blockers.length === 0;
}

// ── Family space ownership blocker (§1) ─────────────────────────────────────

export interface FamilySuccessorCandidate {
  accessMembershipId: string;
  linkedProfileId: string;
  userId: string;
  joinedAt: number | undefined;
  creationTime: number;
}

/**
 * Total deterministic membership order: valid joinedAt (earliest first),
 * then missing/invalid joinedAt, then creation time, then membership id.
 */
function compareFamilySuccessorCandidates(
  a: FamilySuccessorCandidate,
  b: FamilySuccessorCandidate
): number {
  const aJoinedAt = isValidTimestamp(a.joinedAt) ? a.joinedAt : null;
  const bJoinedAt = isValidTimestamp(b.joinedAt) ? b.joinedAt : null;
  const aHasJoinedAt = aJoinedAt !== null;
  const bHasJoinedAt = bJoinedAt !== null;
  if (aHasJoinedAt !== bHasJoinedAt) return aHasJoinedAt ? -1 : 1;
  if (aJoinedAt !== null && bJoinedAt !== null && aJoinedAt !== bJoinedAt) {
    return aJoinedAt - bJoinedAt;
  }
  if (a.creationTime !== b.creationTime) {
    return a.creationTime - b.creationTime;
  }
  if (a.accessMembershipId === b.accessMembershipId) return 0;
  return a.accessMembershipId < b.accessMembershipId ? -1 : 1;
}

export function selectFamilySuccessor(
  candidates: readonly FamilySuccessorCandidate[]
): FamilySuccessorCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) =>
    compareFamilySuccessorCandidates(current, best) < 0 ? current : best
  );
}

export type FamilyOwnershipAction = 'transfer' | 'hardDelete' | 'blocked';

export interface OwnedSpaceOwnershipInfo {
  spaceId: string;
  spaceName: string;
  /** Informational list of every OTHER user id on a kind:'access' row. */
  otherAccessUserIds: readonly string[];
  eligibleSuccessors: readonly FamilySuccessorCandidate[];
  hasAmbiguousActiveMembership: boolean;
}

export interface OwnedSpaceDeletionPlan {
  deletableSpaceIds: string[];
  transfers: {
    spaceId: string;
    successor: FamilySuccessorCandidate;
  }[];
  decisions: {
    spaceId: string;
    action: FamilyOwnershipAction;
    successor: FamilySuccessorCandidate | null;
    blockerReason: string | null;
  }[];
  blockers: string[];
}

/**
 * Selects an eligible linked successor when one exists. A space is closed
 * only when there is neither an eligible successor nor an ambiguous active
 * account membership. Invalid/deleted/inactive accounts never inherit.
 */
export function planOwnedSpaceDeletion(
  spaces: readonly OwnedSpaceOwnershipInfo[]
): OwnedSpaceDeletionPlan {
  const deletableSpaceIds: string[] = [];
  const transfers: OwnedSpaceDeletionPlan['transfers'] = [];
  const decisions: OwnedSpaceDeletionPlan['decisions'] = [];
  const blockers: string[] = [];
  for (const space of spaces) {
    const successor = selectFamilySuccessor(space.eligibleSuccessors);
    if (successor) {
      transfers.push({ spaceId: space.spaceId, successor });
      decisions.push({
        spaceId: space.spaceId,
        action: 'transfer',
        successor,
        blockerReason: null,
      });
    } else if (space.hasAmbiguousActiveMembership) {
      const blockerReason = `לא ניתן להשלים בבטחה את העברת הבעלות או סגירת המרחב "${space.spaceName}": נתוני הקישור לחשבון החבר אינם חד-משמעיים. יש לפנות לתמיכה.`;
      blockers.push(blockerReason);
      decisions.push({
        spaceId: space.spaceId,
        action: 'blocked',
        successor: null,
        blockerReason,
      });
    } else {
      deletableSpaceIds.push(space.spaceId);
      decisions.push({
        spaceId: space.spaceId,
        action: 'hardDelete',
        successor: null,
        blockerReason: null,
      });
    }
  }
  return { deletableSpaceIds, transfers, decisions, blockers };
}

// ── Community ownership — automatic successor transfer (§2, updated) ───────
//
// APPROVED PRODUCT RULE CHANGE: owning a community with another eligible
// real joined member no longer BLOCKS account deletion. Instead,
// ownership is transferred automatically and deterministically to a
// successor. A sole-owned community (no other eligible real joined
// member) keeps the existing hard-delete behavior unchanged. Deletion is
// still blocked — fail-closed, never guessed — when the membership data
// for an owned community is too inconsistent to determine a safe
// successor (e.g. an active membership row with no real backing user, or
// more than one active 'owner' row).

export type CommunitySuccessorRole = 'admin' | 'member';

export interface CommunitySuccessorCandidate {
  membershipId: string;
  userId: string;
  role: CommunitySuccessorRole;
  /** communityMembers.joinedAt — may be missing/invalid for legacy/malformed input; schema currently requires it, but this stays defensive. */
  joinedAt: number | undefined;
  /** communityMembers._creationTime — first deterministic fallback when joinedAt is missing or tied. */
  creationTime: number;
}

function isValidTimestamp(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Deterministic ordering used to pick a single successor out of a pool of
 * same-priority (all-admin or all-member) candidates:
 *   1. earliest valid `joinedAt` (when BOTH candidates have one and they
 *      differ)
 *   2. earliest `_creationTime` (fallback when joinedAt is missing on
 *      either side, or tied)
 *   3. lexicographically smallest `membershipId` (final deterministic
 *      tie-breaker — never array/query return order, never randomness)
 */
function compareCommunitySuccessorCandidates(
  a: CommunitySuccessorCandidate,
  b: CommunitySuccessorCandidate
): number {
  if (
    isValidTimestamp(a.joinedAt) &&
    isValidTimestamp(b.joinedAt) &&
    a.joinedAt !== b.joinedAt
  ) {
    return a.joinedAt - b.joinedAt;
  }
  if (a.creationTime !== b.creationTime) {
    return a.creationTime - b.creationTime;
  }
  if (a.membershipId === b.membershipId) return 0;
  return a.membershipId < b.membershipId ? -1 : 1;
}

/**
 * Selects the single deterministic successor out of an already-eligible
 * candidate pool (real joined user, not the deleting owner, not
 * pending/left/inactive, not community-blocked-on-data — the caller
 * builds this list from `planCommunityOwnershipTransfer` below).
 *
 * Priority 1: an OTHER eligible admin — earliest joined wins (tie-broken
 * deterministically, never by array order).
 * Priority 2 (no eligible admin): the eligible member with the earliest
 * joined date (same deterministic tie-break).
 */
export function selectCommunitySuccessor(
  candidates: readonly CommunitySuccessorCandidate[]
): CommunitySuccessorCandidate | null {
  if (candidates.length === 0) return null;
  const admins = candidates.filter((c) => c.role === 'admin');
  const pool = admins.length > 0 ? admins : candidates;
  return pool.reduce((best, current) =>
    compareCommunitySuccessorCandidates(current, best) < 0 ? current : best
  );
}

export interface OwnedCommunitySuccessorMembershipInput {
  membershipId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  /** Resolved active/joined status — the caller passes the SAME semantics as `isActiveCommunityMember` (convex/communityMemberUtils.ts); pending/left rows are `false`. */
  active: boolean;
  /** True iff the referenced user account still exists (`ctx.db.get(userId) !== null`). Irrelevant for non-active rows. */
  userExists: boolean;
  joinedAt: number | undefined;
  creationTime: number;
}

export type CommunityOwnershipTransferAction =
  | 'transfer'
  | 'hardDelete'
  | 'blocked';

export interface CommunityOwnershipTransferPlan {
  action: CommunityOwnershipTransferAction;
  successor: CommunitySuccessorCandidate | null;
  /** Count of OTHER real, active, existing-user members considered for succession (before role-priority narrowing). */
  eligibleSuccessorCount: number;
  /** Non-null only when action === 'blocked' — a calm, id-free, community-name-only message (never a Convex id or internal field/table name). */
  blockerReason: string | null;
}

/**
 * Plans the successor-transfer decision for ONE owned community, given
 * every OTHER membership row (the deleting owner's own row is expected to
 * already be excluded by the caller, or is harmlessly ignored here too).
 *
 *   - Zero eligible other real joined members → 'hardDelete' (existing
 *     safe sole-owner behavior, unchanged).
 *   - One or more eligible other real joined members → 'transfer', with a
 *     single deterministic successor selected via
 *     `selectCommunitySuccessor`.
 *   - Data inconsistent enough that safe transfer cannot be determined
 *     (an active membership with no real backing user, or more than one
 *     active 'owner' row) → 'blocked'. Never silently hard-deletes a
 *     community that appears to still have another genuine joined user.
 */
export function planCommunityOwnershipTransfer(
  communityName: string,
  deletingUserId: string,
  memberships: readonly OwnedCommunitySuccessorMembershipInput[]
): CommunityOwnershipTransferPlan {
  const others = memberships.filter((m) => m.userId !== deletingUserId);
  const othersActive = others.filter((m) => m.active);

  // Fail-closed: more than one active 'owner' row is an ownership
  // invariant violation — do not guess which one is "real".
  const otherActiveOwnerRows = othersActive.filter((m) => m.role === 'owner');
  // Fail-closed: an active membership row with no real backing user makes
  // the true "other genuine joined member" count unknowable.
  const hasBrokenActiveLinkage = othersActive.some((m) => !m.userExists);

  if (otherActiveOwnerRows.length > 0 || hasBrokenActiveLinkage) {
    return {
      action: 'blocked',
      successor: null,
      eligibleSuccessorCount: 0,
      blockerReason: `לא ניתן להעביר באופן בטוח את הבעלות על הקהילה "${communityName}": נתוני החברות בקהילה אינם עקביים. יש לפנות לתמיכה.`,
    };
  }

  const eligible = othersActive.filter(
    (m) => m.userExists && (m.role === 'admin' || m.role === 'member')
  );

  if (eligible.length === 0) {
    return {
      action: 'hardDelete',
      successor: null,
      eligibleSuccessorCount: 0,
      blockerReason: null,
    };
  }

  const candidates: CommunitySuccessorCandidate[] = eligible.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    role: m.role as CommunitySuccessorRole,
    joinedAt: m.joinedAt,
    creationTime: m.creationTime,
  }));

  return {
    action: 'transfer',
    successor: selectCommunitySuccessor(candidates),
    eligibleSuccessorCount: candidates.length,
    blockerReason: null,
  };
}

// ── Legacy ownerScope disposition (§3/§4) ───────────────────────────────────

export type ResolvedOwnerScope = 'personal' | 'family' | 'community';
export type OwnerScopeDisposition = 'delete' | 'preserve';

export interface OwnedContentDispositionResult {
  disposition: OwnerScopeDisposition;
  /** True when the record's scope could not be determined safely/deterministically. */
  blocked: boolean;
}

/**
 * Maps a resolved ownerScope (populated field value OR a deterministic
 * legacy-backfill classification — see convex/ownerScope.ts
 * `classifyEventForBackfill` / `classifyTaskForBackfill`) to a disposition.
 *
 *   - 'personal' → delete (belongs solely to the deleting user; the
 *     classification functions guarantee zero other party is attached to
 *     personal-scoped content — no sharing, no other assignee).
 *   - 'family' / 'community' → preserve (shared content survives account
 *     deletion regardless of who created it — `createdBy` is kept as a
 *     historical reference and is NEVER reassigned).
 *   - `null` (ambiguous legacy record — classification returned
 *     'ambiguous') → preserve AND blocked: the entire deletion refuses to
 *     proceed rather than guessing.
 */
export function planOwnedContentDisposition(
  scope: ResolvedOwnerScope | 'ambiguous'
): OwnedContentDispositionResult {
  if (scope === 'ambiguous') {
    return { disposition: 'preserve', blocked: true };
  }
  if (scope === 'personal') {
    return { disposition: 'delete', blocked: false };
  }
  return { disposition: 'preserve', blocked: false };
}

// ── Task assignment cleanup (§9/§11) ────────────────────────────────────────

export interface TaskAssignmentCleanupInput {
  createdBy: string;
  assignedTo?: string;
  assignedToUserIds?: readonly string[];
}

export interface TaskAssignmentCleanupResult {
  assignedTo: string | undefined;
  assignedToUserIds: string[] | undefined;
  /** True when the patch actually changes assignedTo and/or assignedToUserIds. */
  changed: boolean;
}

/**
 * Removes `deletedUserId` from a preserved (family/community-scope) task's
 * assignment fields, mirroring the existing `leaveTask` write semantics
 * (convex/tasks.ts) — filter the deleted user out of `assignedToUserIds`,
 * and if they were the primary `assignedTo`, promote the next remaining
 * assignee.
 *
 * UNLIKE `leaveTask`, this guards against re-introducing the deleted user:
 * `leaveTask`'s fallback-to-creator (`newUserIds[0] ?? task.createdBy`) is
 * only safe there because the creator can never be the user who is
 * leaving. Here the creator MAY be the exact same account being deleted
 * (e.g. a family task the deleted user both created and was assigned to),
 * so the creator fallback is only used when the creator is a DIFFERENT,
 * surviving user. If no valid remaining assignee exists at all,
 * `assignedTo` becomes `undefined` (leaving the task legitimately
 * unassigned) rather than silently resurrecting the deleted user's id.
 */
export function planTaskAssignmentCleanup(
  task: TaskAssignmentCleanupInput,
  deletedUserId: string
): TaskAssignmentCleanupResult {
  const originalUserIds = task.assignedToUserIds ?? [];
  const newUserIds = originalUserIds.filter((id) => id !== deletedUserId);

  let newAssignedTo = task.assignedTo;
  if (task.assignedTo === deletedUserId) {
    const [fallbackAssignee] = newUserIds;
    if (fallbackAssignee !== undefined) {
      newAssignedTo = fallbackAssignee;
    } else if (task.createdBy !== deletedUserId) {
      newAssignedTo = task.createdBy;
    } else {
      newAssignedTo = undefined;
    }
  }

  const changed =
    newAssignedTo !== task.assignedTo ||
    newUserIds.length !== originalUserIds.length;

  return {
    assignedTo: newAssignedTo,
    assignedToUserIds: newUserIds.length > 0 ? newUserIds : undefined,
    changed,
  };
}

/**
 * Post-cleanup verification pass (§11): true only if NONE of the given
 * (already-patched, in-memory) tasks still reference `deletedUserId` in
 * either `assignedTo` or `assignedToUserIds`. The caller throws (rolling
 * back the whole transaction) when this returns false — never reports
 * success after partial cleanup.
 */
export function verifyNoResidualTaskAssignment(
  tasks: readonly TaskAssignmentCleanupInput[],
  deletedUserId: string
): boolean {
  return tasks.every(
    (task) =>
      task.assignedTo !== deletedUserId &&
      !(task.assignedToUserIds ?? []).includes(deletedUserId)
  );
}

// ── Preserved event sharing residual-reference cleanup ─────────────────────
//
// events.sharedWithUserIds / events.sharedWithFamilyMemberIds are string
// arrays with NO dedicated index, and — per convex/events.ts
// `shouldIncludeCategory2Event` — sharing is deliberately NOT confined to a
// space the sharer/viewer has access to (cross-space personal-event sharing
// is an existing, supported feature). So a preserved (non-deleted) personal
// event anywhere may still reference the deleting user's id or one of their
// deleted family-member (`kind:'access'`) row ids. This section cleans both
// in a single pass per event.

export interface EventResidualReferenceCleanupInput {
  sharedWithUserIds?: readonly string[];
  sharedWithFamilyMemberIds?: readonly string[];
}

export interface EventResidualReferenceCleanupResult {
  sharedWithUserIds: string[] | undefined;
  sharedWithFamilyMemberIds: string[] | undefined;
  /** True when either field actually changes. */
  changed: boolean;
}

/**
 * Removes `deletedUserId` from `sharedWithUserIds` and remaps any
 * `sharedWithFamilyMemberIds` entry found in `memberIdRemap` to its safe
 * surviving target (see `planFamilyMemberIdRemap` below), deduplicating the
 * result. Every OTHER invitee/member id is preserved untouched, and array
 * order is otherwise preserved. An array that becomes empty is represented
 * as `undefined` — mirroring `planTaskAssignmentCleanup`'s existing
 * convention for `assignedToUserIds` in this same file.
 */
export function planEventResidualReferenceCleanup(
  event: EventResidualReferenceCleanupInput,
  deletedUserId: string,
  memberIdRemap: ReadonlyMap<string, string>
): EventResidualReferenceCleanupResult {
  const originalUserIds = event.sharedWithUserIds ?? [];
  const newUserIds = originalUserIds.filter((id) => id !== deletedUserId);
  const userIdsChanged = newUserIds.length !== originalUserIds.length;

  const originalMemberIds = event.sharedWithFamilyMemberIds ?? [];
  const seen = new Set<string>();
  const newMemberIds: string[] = [];
  let memberIdsChanged = false;
  for (const id of originalMemberIds) {
    const mapped = memberIdRemap.get(id) ?? id;
    if (mapped !== id) memberIdsChanged = true;
    if (seen.has(mapped)) {
      memberIdsChanged = true; // dedup collapse still counts as a change
      continue;
    }
    seen.add(mapped);
    newMemberIds.push(mapped);
  }

  return {
    sharedWithUserIds: newUserIds.length > 0 ? newUserIds : undefined,
    sharedWithFamilyMemberIds:
      newMemberIds.length > 0 ? newMemberIds : undefined,
    changed: userIdsChanged || memberIdsChanged,
  };
}

// ── sharedWithUserIds-only cleanup (post-deletion repair tool) ──────────────
//
// A strict SUBSET of `planEventResidualReferenceCleanup` above: removes
// `deletedUserId` from `sharedWithUserIds` and NEVER reads or returns
// `sharedWithFamilyMemberIds`. Used exclusively by the one-time,
// guarded, dev/QA-only repair tool (`convex/devTools.ts`
// `repairAccountDeletionResidualReferences`) for accounts that were
// deleted BEFORE the residual-reference cleanup wave existed.
//
// That repair tool intentionally does NOT remap `sharedWithFamilyMemberIds`
// / `tasks.assignedToMemberId(s)` / `communityMembers.associatedProfileIds`
// — unlike the live `deleteMyAccount` transaction, the repair tool has no
// reliable way to know the EXACT deleted access-row id for an
// already-deleted account (it no longer exists anywhere), so it cannot
// safely distinguish "the one id that belongs to this deletion" from any
// OTHER pre-existing dangling member id that happens to already be in the
// same space for an unrelated reason. Guessing among dangling ids risks
// silently attaching unrelated content (someone else's events/tasks) to
// the wrong surviving family profile — this helper's narrow scope exists
// specifically to make that mistake structurally impossible to introduce
// via this code path.

export interface EventSharedUserIdsCleanupInput {
  sharedWithUserIds?: readonly string[];
}

export interface EventSharedUserIdsCleanupResult {
  sharedWithUserIds: string[] | undefined;
  changed: boolean;
}

/** Removes `deletedUserId` from `sharedWithUserIds` only — see doc comment above. */
export function planEventSharedUserIdsCleanup(
  event: EventSharedUserIdsCleanupInput,
  deletedUserId: string
): EventSharedUserIdsCleanupResult {
  const original = event.sharedWithUserIds ?? [];
  const next = original.filter((id) => id !== deletedUserId);
  return {
    sharedWithUserIds: next.length > 0 ? next : undefined,
    changed: next.length !== original.length,
  };
}

/**
 * Post-write verification: true only if NONE of the given (already-patched,
 * in-memory) events still reference `deletedUserId` in `sharedWithUserIds`
 * or any id in `deletedMemberIds` in `sharedWithFamilyMemberIds`.
 */
export function verifyNoResidualEventReferences(
  events: readonly EventResidualReferenceCleanupInput[],
  deletedUserId: string,
  deletedMemberIds: ReadonlySet<string>
): boolean {
  return events.every(
    (e) =>
      !(e.sharedWithUserIds ?? []).includes(deletedUserId) &&
      !(e.sharedWithFamilyMemberIds ?? []).some((id) =>
        deletedMemberIds.has(id)
      )
  );
}

// ── Family member-id remap (deleted kind:'access' row → surviving detached
//    kind:'entity' row, same person, same space) ────────────────────────────
//
// When account deletion removes a user's `kind:'access'` row from a space
// they don't own, the corresponding `kind:'entity'` row for that SAME
// person in that SAME space is preserved (only detached — matchedUserId /
// userId cleared, see `planExternalEntityReset`). Any OTHER record that
// referenced the now-deleted access row's `_id` as "this family member"
// must be remapped to the surviving entity row's `_id` instead — never left
// dangling, and never silently dropped when a safe target exists.

export interface MemberRemapRow {
  memberId: string;
  spaceId: string;
}

export interface MemberIdRemapPlanResult {
  /** deleted access row _id → surviving entity row _id, one entry per SAFE remap. */
  remap: Map<string, string>;
  /** One entry per access row that could NOT be safely remapped (zero or multiple candidate targets) — blocks the entire deletion. */
  blockers: string[];
}

/**
 * Fail-closed 1:1 remap: for each `source` (a deleted access row), finds
 * every `target` (a surviving detached entity row) in the SAME spaceId.
 * Exactly one candidate → safe remap. Zero or multiple candidates → a
 * blocker (never guessed by query order, never guessed by name). Both
 * `sources` and `targets` are expected to already be scoped to the SAME
 * deleting user/person (the caller filters both lists by that invariant
 * before calling this) — this function only enforces the same-space,
 * exactly-one-target rule.
 */
export function planFamilyMemberIdRemap(
  sources: readonly MemberRemapRow[],
  targets: readonly MemberRemapRow[]
): MemberIdRemapPlanResult {
  const remap = new Map<string, string>();
  const blockers: string[] = [];

  const targetsBySpace = new Map<string, MemberRemapRow[]>();
  for (const target of targets) {
    const list = targetsBySpace.get(target.spaceId) ?? [];
    list.push(target);
    targetsBySpace.set(target.spaceId, list);
  }

  for (const source of sources) {
    const candidates = targetsBySpace.get(source.spaceId) ?? [];
    if (candidates.length === 0) {
      blockers.push(
        'לא ניתן לאתר באופן חד-משמעי פרופיל משפחה שורד עבור חבר משפחה שהחשבון שלו נמחק — לא ניתן להמשיך במחיקת החשבון מבלי לנחש את הקישור הנכון. יש לפנות לתמיכה.'
      );
      continue;
    }
    if (candidates.length > 1) {
      blockers.push(
        'נמצאו מספר פרופילי משפחה אפשריים עבור חבר משפחה שהחשבון שלו נמחק — לא ניתן להמשיך במחיקת החשבון מבלי לנחש איזה מהם נכון. יש לפנות לתמיכה.'
      );
      continue;
    }
    remap.set(source.memberId, candidates[0].memberId);
  }

  return { remap, blockers };
}

/** Replaces every id found in `remap` and deduplicates the result, preserving stable order and leaving unrelated ids untouched. */
export function remapMemberIdArray(
  ids: readonly string[] | undefined,
  remap: ReadonlyMap<string, string>
): { ids: string[] | undefined; changed: boolean } {
  const original = ids ?? [];
  const seen = new Set<string>();
  const next: string[] = [];
  let changed = false;
  for (const id of original) {
    const mapped = remap.get(id) ?? id;
    if (mapped !== id) changed = true;
    if (seen.has(mapped)) {
      changed = true;
      continue;
    }
    seen.add(mapped);
    next.push(mapped);
  }
  return { ids: next.length > 0 ? next : undefined, changed };
}

/** Replaces a single member id if it is a remap source; leaves it untouched otherwise. */
export function remapMemberIdSingular(
  id: string | undefined,
  remap: ReadonlyMap<string, string>
): { id: string | undefined; changed: boolean } {
  if (id === undefined) return { id: undefined, changed: false };
  const mapped = remap.get(id) ?? id;
  return { id: mapped, changed: mapped !== id };
}

// ── Task assignedToMemberId / assignedToMemberIds remap ─────────────────────

export interface TaskMemberIdRemapInput {
  assignedToMemberId?: string;
  assignedToMemberIds?: readonly string[];
}

export interface TaskMemberIdRemapResult {
  assignedToMemberId: string | undefined;
  assignedToMemberIds: string[] | undefined;
  changed: boolean;
}

/** Applies `remap` to both the singular and array member-assignment fields of a task. */
export function planTaskMemberIdRemap(
  task: TaskMemberIdRemapInput,
  remap: ReadonlyMap<string, string>
): TaskMemberIdRemapResult {
  const singular = remapMemberIdSingular(task.assignedToMemberId, remap);
  const array = remapMemberIdArray(task.assignedToMemberIds, remap);
  return {
    assignedToMemberId: singular.id,
    assignedToMemberIds: array.ids,
    changed: singular.changed || array.changed,
  };
}

/** Post-write verification for tasks' member-assignment fields. */
export function verifyNoResidualTaskMemberReferences(
  tasks: readonly TaskMemberIdRemapInput[],
  deletedMemberIds: ReadonlySet<string>
): boolean {
  return tasks.every(
    (t) =>
      (t.assignedToMemberId === undefined ||
        !deletedMemberIds.has(t.assignedToMemberId)) &&
      !(t.assignedToMemberIds ?? []).some((id) => deletedMemberIds.has(id))
  );
}

// ── communityMembers.associatedProfileIds remap ─────────────────────────────

export interface CommunityMemberProfileRemapInput {
  associatedProfileIds?: readonly string[];
}

export interface CommunityMemberProfileRemapResult {
  associatedProfileIds: string[] | undefined;
  changed: boolean;
}

/** Applies `remap` to a communityMembers row's associatedProfileIds array. */
export function planCommunityMemberProfileRemap(
  membership: CommunityMemberProfileRemapInput,
  remap: ReadonlyMap<string, string>
): CommunityMemberProfileRemapResult {
  const array = remapMemberIdArray(membership.associatedProfileIds, remap);
  return { associatedProfileIds: array.ids, changed: array.changed };
}

/** Post-write verification for communityMembers.associatedProfileIds. */
export function verifyNoResidualCommunityMemberProfileReferences(
  memberships: readonly CommunityMemberProfileRemapInput[],
  deletedMemberIds: ReadonlySet<string>
): boolean {
  return memberships.every(
    (m) =>
      !(m.associatedProfileIds ?? []).some((id) => deletedMemberIds.has(id))
  );
}

// ── tasks.deletedBy (personal trash) resolution ─────────────────────────────
//
// Per convex/tasks.ts: `deletedBy` marks WHOSE personal trash a soft-deleted
// task sits in — `restoreTask` only allows `task.deletedBy === callerUserId`
// to restore it, and `listRecentlyDeleted` only ever surfaces
// `deletedBy === callerUserId` rows. So a task already soft-deleted into the
// DELETING user's own trash (`deletedAt` set AND `deletedBy ===
// deletingUserId`) can never be seen or restored by anyone else — it is
// already fully excluded from every active-content query (which filters on
// `deletedAt === undefined`). Deleting an account cannot resurrect it (it
// stays soft-deleted for everyone else regardless), so hard-deleting this
// specific row is the only way to guarantee no surviving row keeps
// `deletedBy === deletingUserId`, and — unlike clearing `deletedBy` — it
// cannot make the task reappear as active content for anyone.

/** True iff `task` is soft-deleted into `deletingUserId`'s own personal trash — safe to hard-delete during account deletion. */
export function isTaskStrandedInDeletingUsersTrash(
  task: { deletedAt?: number; deletedBy?: string },
  deletingUserId: string
): boolean {
  return task.deletedAt !== undefined && task.deletedBy === deletingUserId;
}

/** Post-write verification: true only if no surviving task still has `deletedBy === deletedUserId`. */
export function verifyNoResidualDeletedByReference(
  tasks: readonly { deletedBy?: string }[],
  deletedUserId: string
): boolean {
  return tasks.every((t) => t.deletedBy !== deletedUserId);
}

// ── eventTasks assignment verification (§9/§10) ─────────────────────────────

export interface EventTaskAssignmentLike {
  assignedToUserId?: string;
  assignedByUserId?: string;
}

/**
 * Post-cleanup verification pass for eventTasks: true only if NONE of the
 * given (already-patched, in-memory) eventTasks rows still reference
 * `deletedUserId` as assignee or assigner.
 */
export function verifyNoResidualEventTaskAssignment(
  eventTasks: readonly EventTaskAssignmentLike[],
  deletedUserId: string
): boolean {
  return eventTasks.every(
    (row) =>
      row.assignedToUserId !== deletedUserId &&
      row.assignedByUserId !== deletedUserId
  );
}

// ============================================================================
// Read-only account-deletion PREVIEW shaping (see convex/accountDeletion.ts
// `buildAccountDeletionPreview` / convex/accountDeletionPreview.ts
// `previewAccountDeletion`).
// ============================================================================
//
// `summarizeAccountDeletionPreview` is the ONLY place that shapes the
// production plan into the structured preview response. It is pure (plain
// data in, plain data out — no ctx, no Convex Doc/Id types) specifically
// so it can be fully unit-tested here without a live Convex backend. It
// never re-derives blockers/dispositions/counts itself — every input
// field is expected to already come straight from the SAME
// `buildAccountDeletionPlan` result that `runAccountDeletion` executes
// against, so preview and execution cannot drift.

export interface AccountDeletionPreviewSpaceInfo {
  spaceId: string;
  spaceName: string;
  action: FamilyOwnershipAction;
  deletable: boolean;
  otherJoinedUserCount: number;
}

export interface AccountDeletionPreviewCommunityInfo {
  communityId: string;
  communityName: string;
  archived: boolean;
  action: CommunityOwnershipTransferAction;
  eligibleSuccessorCount: number;
  selectedSuccessorRole: CommunitySuccessorRole | null;
  selectedSuccessorJoinedAt: number | null;
  selectedSuccessorName: string | null;
  reason: string | null;
}

export interface AccountDeletionPreviewInput {
  blockers: string[];
  plannedWriteCount: number;
  writeSafetyLimit: number;
  /** From evaluateAccountDeletionTransactionSize(plannedWriteCount).safe — NOT recomputed here. */
  sizeSafe: boolean;

  spaces: AccountDeletionPreviewSpaceInfo[];
  communities: AccountDeletionPreviewCommunityInfo[];
  nonOwnedCommunityMembershipCount: number;

  personalEventDeleteCount: number;
  personalTaskDeleteCount: number;
  familyEventPreserveCount: number;
  familyTaskPreserveCount: number;
  communityEventPreserveCount: number;
  communityTaskPreserveCount: number;
  legacyOwnerScopeEventCount: number;
  legacyOwnerScopeTaskCount: number;
  ambiguousRecordCount: number;

  tasksAssignedToClearCount: number;
  tasksAssignedToUserIdsClearCount: number;
  eventTasksAssignedToUserIdClearCount: number;
  eventTasksAssignedByUserIdClearCount: number;
  /** Informational only — assignedToMemberId/assignedToMemberIds are never touched by the real planner. */
  survivingMemberAssignmentCount: number;

  externalEntityDetachCount: number;
  externalAccessRowRemovalCount: number;
  externalEntityAffectedSpaceCount: number;

  userScopedCounts: Record<string, number>;

  authRefreshTokenCount: number;
  authSessionCount: number;
  authAccountCount: number;
  authVerificationCodeCount: number;
  authVerifierCount: number;
  authRateLimitRowCount: number;

  // ── Residual-reference cleanup (data-integrity wave) ──────────────────
  /** events.sharedWithUserIds entries removed for the deleting user across every PRESERVED event. */
  eventSharedUserRefsRemoved: number;
  /** events.sharedWithFamilyMemberIds entries remapped from a deleted access row id to its surviving entity row id. */
  eventSharedFamilyMemberRefsRemapped: number;
  /** tasks.assignedToMemberId / assignedToMemberIds entries remapped. */
  taskMemberRefsRemapped: number;
  /** communityMembers.associatedProfileIds entries remapped. */
  communityMemberProfileRefsRemapped: number;
  /** Soft-deleted tasks stranded in the deleting user's own trash, hard-deleted. */
  softDeletedTasksResolved: number;
  /** Count of deleted access member ids that could NOT be safely remapped (0 or >1 candidate targets) — each contributes a blocker. */
  unsafeMemberReferenceRemapCount: number;
}

export interface AccountDeletionPreview {
  safeToExecute: boolean;
  blockers: string[];
  plannedWriteCount: number;
  writeSafetyLimit: number;
  spaces: {
    ownedCount: number;
    transferCount: number;
    deletableCount: number;
    blockedCount: number;
    details: AccountDeletionPreviewSpaceInfo[];
  };
  communities: {
    ownedCount: number;
    transferCount: number;
    hardDeletableCount: number;
    blockedCount: number;
    nonOwnedMembershipRemovalCount: number;
    details: AccountDeletionPreviewCommunityInfo[];
  };
  content: {
    personalEventsToDelete: number;
    personalTasksToDelete: number;
    familyEventsPreserved: number;
    familyTasksPreserved: number;
    communityEventsPreserved: number;
    communityTasksPreserved: number;
    legacyOwnerScopeEvents: number;
    legacyOwnerScopeTasks: number;
    ambiguousRecords: number;
  };
  assignments: {
    tasksAssignedToCleared: number;
    tasksAssignedToUserIdsCleared: number;
    eventTasksAssignedToUserIdCleared: number;
    eventTasksAssignedByUserIdCleared: number;
    survivingMemberAssignmentsPreserved: number;
  };
  family: {
    externalEntitiesToDetach: number;
    externalAccessRowsToRemove: number;
    affectedSpaceCount: number;
    /** True iff at least one external entity would remain (preserved, link cleared) for a future same-phone match. */
    samePhoneReMatchEligibleAfterDeletion: boolean;
  };
  userScopedCleanup: Record<string, number>;
  auth: {
    refreshTokens: number;
    sessions: number;
    accounts: number;
    verificationCodes: number;
    verifiers: number;
    rateLimitRows: number;
  };
  residualReferenceCleanup: {
    eventSharedUserRefsRemoved: number;
    eventSharedFamilyMemberRefsRemapped: number;
    taskMemberRefsRemapped: number;
    communityMemberProfileRefsRemapped: number;
    softDeletedTasksResolved: number;
    unsafeMemberReferenceRemaps: number;
  };
}

/**
 * Shapes an already-computed set of plan-derived counts into the
 * structured, read-only account-deletion preview. `safeToExecute` is the
 * single derived boolean callers should gate any "would this succeed?"
 * decision on — it is true iff there are zero blockers AND the
 * transaction-size check passed, exactly mirroring the two guards
 * `runAccountDeletion` checks before performing any write.
 */
export function summarizeAccountDeletionPreview(
  input: AccountDeletionPreviewInput
): AccountDeletionPreview {
  const deletableSpaceCount = input.spaces.filter((s) => s.deletable).length;
  const transferSpaceCount = input.spaces.filter(
    (s) => s.action === 'transfer'
  ).length;
  const blockedSpaceCount = input.spaces.filter(
    (s) => s.action === 'blocked'
  ).length;
  const transferCommunityCount = input.communities.filter(
    (c) => c.action === 'transfer'
  ).length;
  const hardDeletableCommunityCount = input.communities.filter(
    (c) => c.action === 'hardDelete'
  ).length;
  const blockedCommunityCount = input.communities.filter(
    (c) => c.action === 'blocked'
  ).length;

  return {
    safeToExecute: input.blockers.length === 0 && input.sizeSafe,
    blockers: input.blockers,
    plannedWriteCount: input.plannedWriteCount,
    writeSafetyLimit: input.writeSafetyLimit,
    spaces: {
      ownedCount: input.spaces.length,
      transferCount: transferSpaceCount,
      deletableCount: deletableSpaceCount,
      blockedCount: blockedSpaceCount,
      details: input.spaces,
    },
    communities: {
      ownedCount: input.communities.length,
      transferCount: transferCommunityCount,
      hardDeletableCount: hardDeletableCommunityCount,
      blockedCount: blockedCommunityCount,
      nonOwnedMembershipRemovalCount: input.nonOwnedCommunityMembershipCount,
      details: input.communities,
    },
    content: {
      personalEventsToDelete: input.personalEventDeleteCount,
      personalTasksToDelete: input.personalTaskDeleteCount,
      familyEventsPreserved: input.familyEventPreserveCount,
      familyTasksPreserved: input.familyTaskPreserveCount,
      communityEventsPreserved: input.communityEventPreserveCount,
      communityTasksPreserved: input.communityTaskPreserveCount,
      legacyOwnerScopeEvents: input.legacyOwnerScopeEventCount,
      legacyOwnerScopeTasks: input.legacyOwnerScopeTaskCount,
      ambiguousRecords: input.ambiguousRecordCount,
    },
    assignments: {
      tasksAssignedToCleared: input.tasksAssignedToClearCount,
      tasksAssignedToUserIdsCleared: input.tasksAssignedToUserIdsClearCount,
      eventTasksAssignedToUserIdCleared:
        input.eventTasksAssignedToUserIdClearCount,
      eventTasksAssignedByUserIdCleared:
        input.eventTasksAssignedByUserIdClearCount,
      survivingMemberAssignmentsPreserved: input.survivingMemberAssignmentCount,
    },
    family: {
      externalEntitiesToDetach: input.externalEntityDetachCount,
      externalAccessRowsToRemove: input.externalAccessRowRemovalCount,
      affectedSpaceCount: input.externalEntityAffectedSpaceCount,
      samePhoneReMatchEligibleAfterDeletion:
        input.externalEntityDetachCount > 0,
    },
    userScopedCleanup: input.userScopedCounts,
    auth: {
      refreshTokens: input.authRefreshTokenCount,
      sessions: input.authSessionCount,
      accounts: input.authAccountCount,
      verificationCodes: input.authVerificationCodeCount,
      verifiers: input.authVerifierCount,
      rateLimitRows: input.authRateLimitRowCount,
    },
    residualReferenceCleanup: {
      eventSharedUserRefsRemoved: input.eventSharedUserRefsRemoved,
      eventSharedFamilyMemberRefsRemapped:
        input.eventSharedFamilyMemberRefsRemapped,
      taskMemberRefsRemapped: input.taskMemberRefsRemapped,
      communityMemberProfileRefsRemapped:
        input.communityMemberProfileRefsRemapped,
      softDeletedTasksResolved: input.softDeletedTasksResolved,
      unsafeMemberReferenceRemaps: input.unsafeMemberReferenceRemapCount,
    },
  };
}
