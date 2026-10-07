// ============================================================================
// accountDeletion.ts — production account-deletion engine
// ============================================================================
//
// `runAccountDeletion` is called by `deleteMyAccount` (convex/users.ts) —
// the ONLY public entry point — after it has resolved the caller's userId
// via `getAuthUserId(ctx)` (never the raw, composite Convex Auth Phone OTP
// `identity.subject`).
//
// ARCHITECTURE (single atomic Convex mutation, per the approved plan):
//   1. authenticate                     — done by the caller (users.ts)
//   2. read/plan everything             — `buildAccountDeletionPlan` below,
//                                          zero writes
//   3. evaluate blockers                — throws before any write if unsafe
//   4. evaluate transaction-size safety — throws before any write if unsafe
//   5. destructive writes               — §§ WRITES below
//   6. verify cleanup                   — re-queries via indexes, throws on
//                                          ANY residual reference
//   7. delete Auth state                — dependents → parents
//   8. delete the `users` row LAST
//
// PLAN/EXECUTE SPLIT (read-only preview support): step 2 above is fully
// factored out into `buildAccountDeletionPlan(ctx, userId)` — a read-only
// function that performs every read, every ownership/ownerScope/assignment
// classification, and the transaction-size estimate, but returns the
// result instead of throwing or writing. `runAccountDeletion` (this file)
// and `previewAccountDeletion` (convex/accountDeletionPreview.ts) BOTH
// call this exact same function — there is only ever one implementation of
// the planning/classification rules, so preview and execution cannot
// drift. `runAccountDeletion` additionally performs the blocker/size-gate
// throws and the destructive writes; the preview only shapes the plan
// into a read-only summary via `buildAccountDeletionPreview` below and
// never calls `ctx.db.patch/insert/delete` or `ctx.scheduler.cancel`.
//
// Convex transactions are all-or-nothing: throwing ANYWHERE (including
// during verification) rolls back every write performed above, so success
// is never reported after partial cleanup.
//
// SCOPE (see AGENTS.md / the approved account-deletion spec for full
// rationale — summarized here):
//   - Family-space ownership: if the deleting user owns a family/personal
//     space that still has another real joined user (a surviving
//     kind:'access' row for a different user), the ENTIRE deletion is
//     blocked. No automatic ownership transfer. A sole-owned space is
//     deleted along with all of its space-scoped content (events,
//     eventTasks, tasks, birthdays, members — manual/pet entity profiles
//     included).
//   - Community ownership (UPDATED — automatic successor transfer, see
//     lib/accountDeletion.ts `planCommunityOwnershipTransfer` for the one
//     implementation of this rule): owning a community with another
//     eligible real joined member NO LONGER blocks deletion. Ownership is
//     transferred deterministically to the earliest-joined OTHER active
//     admin, or (if no admin exists) the earliest-joined OTHER active
//     member — never by array/query order, never randomly. The new owner
//     receives a durable in-app notification plus a best-effort push. A
//     sole-owned community (active or archived, no eligible other real
//     joined member) keeps the existing HARD-DELETE behavior, deleting
//     all of its community-scoped content — this remains the deliberate,
//     narrow exception to "shared content survives" because nobody else
//     can be affected. Membership data too inconsistent to determine a
//     safe successor (e.g. an active membership with no real backing
//     user, or more than one active 'owner' row) BLOCKS the entire
//     deletion rather than guessing — fail-closed, same philosophy as the
//     legacy ownerScope classification below. Pending/left/inactive
//     members are never eligible successors and never block.
//   - Shared family/community content everywhere else survives
//     unconditionally: an event/task the deleting user created is
//     deleted ONLY when it is genuinely personal (ownerScope === 'personal'
//     — the classification functions guarantee zero other party is
//     attached to personal content). Family/community-scoped content is
//     preserved and `createdBy` is kept as a historical reference —
//     NEVER reassigned. Legacy (pre-ownerScope) records are classified
//     deterministically via the existing backfill classifiers; a genuinely
//     ambiguous legacy record blocks the ENTIRE deletion rather than being
//     guessed at.
//   - Every active account-based assignment reference to the deleted user
//     is cleaned to zero: tasks.assignedTo / tasks.assignedToUserIds (with
//     leaveTask-style promotion of the next remaining assignee — never
//     re-introducing the deleted user via a creator fallback when the
//     creator IS the deleted user) and eventTasks.assignedToUserId /
//     eventTasks.assignedByUserId. A post-write verification pass THROWS
//     (rolling back everything) if any reference survives.
//   - External family entities (rows in OTHER users' spaces linked to this
//     account) are PRESERVED — never deleted — with only the link fields
//     cleared (matchedUserId / userId / inviteStatus), so the exact same
//     phone can be discovery-matched again after re-registration. The
//     corresponding kind:'access' membership row (in that other space) IS
//     removed, and the affected owner's familyContacts mirror blob is
//     patched using the same safe, already-unit-tested semantics as the
//     QA reset tool (lib/qaReset.ts `planExternalEntityReset` /
//     `planFamilyContactsReset` — reused directly, not reimplemented).
//   - All other user-scoped personal tables are fully wiped (see the
//     WRITES §13 section below for the complete, schema-derived list).
// ============================================================================

import {
  ACCOUNT_DELETION_MAX_PLANNED_WRITES,
  type AccountDeletionPreview,
  type CommunityOwnershipTransferAction,
  type CommunitySuccessorRole,
  estimateAccountDeletionWriteCount,
  evaluateAccountDeletionTransactionSize,
  isAccountDeletionSafeToExecute,
  isTaskStrandedInDeletingUsersTrash,
  planCommunityMemberProfileRemap,
  planCommunityOwnershipTransfer,
  planEventResidualReferenceCleanup,
  planFamilyMemberIdRemap,
  planOwnedContentDisposition,
  planOwnedSpaceDeletion,
  planTaskAssignmentCleanup,
  planTaskMemberIdRemap,
  type ResolvedOwnerScope,
  summarizeAccountDeletionPreview,
  verifyNoResidualCommunityMemberProfileReferences,
  verifyNoResidualDeletedByReference,
  verifyNoResidualEventReferences,
  verifyNoResidualEventTaskAssignment,
  verifyNoResidualTaskAssignment,
  verifyNoResidualTaskMemberReferences,
} from '../lib/accountDeletion';
import {
  externalEntityResetPlanIsNoop,
  normalizeQaPhone as normalizePhoneToE164,
  planExternalEntityReset,
  planFamilyContactsReset,
} from '../lib/qaReset';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { isActiveCommunityMember } from './communityMemberUtils';
import { resolveKind } from './members';
import {
  classifyEventForBackfill,
  classifyTaskForBackfill,
} from './ownerScope';
import { createUserNotifications } from './userNotifications';

/** New-owner notification copy for an automatic community ownership transfer (see §10 of the approved account-deletion spec). */
const COMMUNITY_OWNERSHIP_TRANSFER_NOTIFICATION_TITLE =
  'הבעלות על הקהילה הועברה אליך';
function communityOwnershipTransferNotificationBody(
  communityName: string
): string {
  return `כעת יש לך הרשאת בעלות וניהול מלאה בקהילה "${communityName}". העברת הבעלות בוצעה אוטומטית בעקבות מחיקת חשבון.`;
}
const COMMUNITY_OWNERSHIP_TRANSFER_PUSH_TYPE =
  'community_ownership_transferred';

/** Minimal shape this handler needs from a familyContacts blob entry. */
interface FamilyContactBlobEntry {
  selectedPhoneNumber?: string;
  matchedUserId?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
  [key: string]: unknown;
}

export interface AccountDeletionSummary {
  userId: Id<'users'>;
  deletedSpaceIds: Id<'spaces'>[];
  deletedCommunityIds: Id<'communities'>[];
  transferredCommunityIds: Id<'communities'>[];
  deletedEventCount: number;
  deletedTaskCount: number;
  cleanedTaskAssignmentCount: number;
  cleanedEventTaskAssignmentCount: number;
  resetExternalEntityCount: number;
  removedExternalAccessRowCount: number;
  removedCommunityMembershipCount: number;
  eventSharedUserRefsRemoved: number;
  eventSharedFamilyMemberRefsRemapped: number;
  taskMemberRefsRemapped: number;
  communityMemberProfileRefsRemapped: number;
  softDeletedTasksResolved: number;
  plannedWriteCount: number;
}

/** Resolves a record's effective ownerScope, deterministically classifying legacy (undefined) records. Never guesses — returns 'ambiguous' when the signal is insufficient. */
function resolveEventScope(
  event: Doc<'events'>
): ResolvedOwnerScope | 'ambiguous' {
  if (event.ownerScope) return event.ownerScope;
  return classifyEventForBackfill({
    communityId: event.communityId,
    source: event.source,
    allFamily: event.allFamily,
    sharedWithFamilyMemberIds: event.sharedWithFamilyMemberIds,
    sharedWithUserIds: event.sharedWithUserIds,
    createdBy: event.createdBy,
  });
}

function resolveTaskScope(
  task: Doc<'tasks'>
): ResolvedOwnerScope | 'ambiguous' {
  if (task.ownerScope) return task.ownerScope;
  return classifyTaskForBackfill({
    communityId: task.communityId,
    sourceType: task.sourceType,
    createdBy: task.createdBy,
    assignedTo: task.assignedTo,
    assignedToUserIds: task.assignedToUserIds,
    assignedToMemberIds: task.assignedToMemberIds,
  });
}

// ============================================================================
// buildAccountDeletionPlan — the ONLY implementation of the planning rules.
// ============================================================================
//
// Pure read-only investigation: authenticates nothing itself (the caller
// already resolved userId), performs every read needed to decide what would
// happen, computes blockers + the transaction-size estimate, and returns
// everything a caller needs either to (a) execute the deletion, or (b)
// render a read-only preview. NEVER calls ctx.db.patch/insert/delete or
// ctx.scheduler.cancel — accepts a QueryCtx-compatible ctx (a MutationCtx
// also satisfies this, since GenericDatabaseWriter extends
// GenericDatabaseReader), so `previewAccountDeletion` (an internalQuery,
// which cannot write even if it tried) can call it directly.
export async function buildAccountDeletionPlan(
  ctx: QueryCtx,
  userId: Id<'users'>
) {
  const user = await ctx.db.get(userId);
  if (!user) {
    // Resolved a userId, but the row is gone/corrupted. Never report
    // success and never render a preview for a non-existent user — THROW.
    throw new Error('לא ניתן לאתר את חשבון המשתמש למחיקה');
  }

  const blockers: string[] = [];
  const warnings: string[] = [];

  // ══════════════════════════════════════════════════════════════════════
  // READ/PLAN — zero writes anywhere in this function.
  // ══════════════════════════════════════════════════════════════════════

  // ── 1. Family/personal space ownership safety (§1) ─────────────────────
  const ownedSpaces = await ctx.db
    .query('spaces')
    .withIndex('by_owner', (q) => q.eq('ownerId', userId))
    .collect();

  const ownedSpaceMembersBySpace = new Map<Id<'spaces'>, Doc<'members'>[]>();
  const ownedSpaceOwnershipInfos: {
    spaceId: Id<'spaces'>;
    spaceName: string;
    otherAccessUserIds: Id<'users'>[];
  }[] = [];
  for (const space of ownedSpaces) {
    const spaceMembers = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', space._id))
      .collect();
    ownedSpaceMembersBySpace.set(space._id, spaceMembers);
    const otherAccessUserIds = spaceMembers
      .filter(
        (m) =>
          resolveKind(m) === 'access' &&
          m.userId !== undefined &&
          m.userId !== userId
      )
      .map((m) => m.userId as Id<'users'>);
    ownedSpaceOwnershipInfos.push({
      spaceId: space._id,
      spaceName: space.name,
      otherAccessUserIds,
    });

    const entitiesMatchedToOthers = spaceMembers.filter(
      (m) =>
        resolveKind(m) === 'entity' &&
        m.matchedUserId !== undefined &&
        m.matchedUserId !== userId
    );
    if (entitiesMatchedToOthers.length > 0) {
      warnings.push(
        `מרחב "${space.name}" כולל ${entitiesMatchedToOthers.length} פרופיל/ים המקושרים לגילוי טלפוני עבור משתמש/ים אחרים — מחיקת המרחב מסירה את ההתאמה הממתינה עבורם (תוצאה צפויה של מחיקת מרחב בבעלות בלעדית, לא פגיעה בנתונים שלהם).`
      );
    }
  }
  const spacePlan = planOwnedSpaceDeletion(ownedSpaceOwnershipInfos);
  blockers.push(...spacePlan.blockers);
  const deletableSpaceIds = new Set(
    spacePlan.deletableSpaceIds as Id<'spaces'>[]
  );

  // ── 2. Community ownership — automatic successor transfer (§2, updated
  //      product rule: owning a community with another eligible real
  //      joined member no longer blocks deletion — ownership transfers
  //      deterministically instead; see lib/accountDeletion.ts
  //      `planCommunityOwnershipTransfer` for the single implementation
  //      of this rule). ────────────────────────────────────────────────────
  const ownedCommunities = await ctx.db
    .query('communities')
    .withIndex('by_owner', (q) => q.eq('ownerId', userId))
    .collect();

  const ownedCommunityMembersByCommunity = new Map<
    Id<'communities'>,
    Doc<'communityMembers'>[]
  >();
  for (const community of ownedCommunities) {
    const members = await ctx.db
      .query('communityMembers')
      .withIndex('by_community', (q) => q.eq('communityId', community._id))
      .collect();
    ownedCommunityMembersByCommunity.set(community._id, members);
  }

  // Batch-fetch every OTHER user referenced by an active membership row
  // across all owned communities once, rather than re-fetching the same
  // user doc per community. `null` in the map means the user row no
  // longer exists — the exact "broken active linkage" signal
  // `planCommunityOwnershipTransfer` fails closed on.
  const otherActiveMemberUserIds = new Set<Id<'users'>>();
  for (const members of ownedCommunityMembersByCommunity.values()) {
    for (const m of members) {
      if (m.userId !== userId && isActiveCommunityMember(m)) {
        otherActiveMemberUserIds.add(m.userId);
      }
    }
  }
  const otherActiveMemberUsersById = new Map<
    Id<'users'>,
    Doc<'users'> | null
  >();
  for (const otherUserId of otherActiveMemberUserIds) {
    otherActiveMemberUsersById.set(otherUserId, await ctx.db.get(otherUserId));
  }

  interface OwnedCommunityPlanEntry {
    communityId: Id<'communities'>;
    communityName: string;
    archived: boolean;
    action: CommunityOwnershipTransferAction;
    eligibleSuccessorCount: number;
    successor: {
      membershipId: Id<'communityMembers'>;
      userId: Id<'users'>;
      role: CommunitySuccessorRole;
      joinedAt: number | undefined;
      name: string | null;
    } | null;
    reason: string | null;
    /** The deleting owner's OWN communityMembers row in this community — removed during the write phase for both 'transfer' (explicitly) and 'hardDelete' (via the existing cascade). Always defined in practice (the owner always has a membership row), kept optional defensively. */
    ownerMembershipId: Id<'communityMembers'> | null;
  }

  const ownedCommunityPlanEntries: OwnedCommunityPlanEntry[] = [];
  for (const community of ownedCommunities) {
    const members = ownedCommunityMembersByCommunity.get(community._id) ?? [];
    const ownerMembership = members.find((m) => m.userId === userId) ?? null;
    const membershipInputs = members
      .filter((m) => m.userId !== userId)
      .map((m) => {
        const active = isActiveCommunityMember(m);
        const userExists = active
          ? (otherActiveMemberUsersById.get(m.userId) ?? null) !== null
          : true; // irrelevant for non-active rows — never inspected by the planner
        return {
          membershipId: m._id,
          userId: m.userId,
          role: m.role,
          active,
          userExists,
          joinedAt: m.joinedAt,
          creationTime: m._creationTime,
        };
      });

    const transferPlan = planCommunityOwnershipTransfer(
      community.name,
      userId,
      membershipInputs
    );

    const successor = transferPlan.successor
      ? {
          membershipId: transferPlan.successor
            .membershipId as Id<'communityMembers'>,
          userId: transferPlan.successor.userId as Id<'users'>,
          role: transferPlan.successor.role,
          joinedAt: transferPlan.successor.joinedAt,
          name:
            otherActiveMemberUsersById.get(
              transferPlan.successor.userId as Id<'users'>
            )?.fullName ?? null,
        }
      : null;

    ownedCommunityPlanEntries.push({
      communityId: community._id,
      communityName: community.name,
      archived: community.archived === true,
      action: transferPlan.action,
      eligibleSuccessorCount: transferPlan.eligibleSuccessorCount,
      successor,
      reason: transferPlan.blockerReason,
      ownerMembershipId: ownerMembership?._id ?? null,
    });

    if (transferPlan.action === 'blocked' && transferPlan.blockerReason) {
      blockers.push(transferPlan.blockerReason);
    }
  }

  const hardDeletableCommunityIds = new Set(
    ownedCommunityPlanEntries
      .filter((e) => e.action === 'hardDelete')
      .map((e) => e.communityId)
  );
  const communityTransferEntries = ownedCommunityPlanEntries.filter(
    (
      e
    ): e is OwnedCommunityPlanEntry & {
      successor: NonNullable<OwnedCommunityPlanEntry['successor']>;
    } => e.action === 'transfer' && e.successor !== null
  );

  // ── 3. Owned events/tasks — ownerScope disposition (§3/§4) ──────────────
  // Precedence: content inside a space/community that is itself being
  // wholly destroyed (deletableSpaceIds / hardDeletableCommunityIds) is
  // swept by that cascade regardless of ownerScope — there is no one left
  // to preserve it for (this is the explicit, narrow exception documented
  // in §1: "Manual profiles / children / pets in that sole-user owned
  // space may be deleted with the space"). ownerScope disposition below
  // applies ONLY to content living outside any space/community being
  // destroyed.
  const createdEvents = await ctx.db
    .query('events')
    .withIndex('by_creator', (q) => q.eq('createdBy', userId))
    .collect();
  const personalEventsToDelete: Doc<'events'>[] = [];
  for (const event of createdEvents) {
    if (event.communityId && hardDeletableCommunityIds.has(event.communityId))
      continue;
    if (event.spaceId && deletableSpaceIds.has(event.spaceId)) continue;
    const scope = resolveEventScope(event);
    const disposition = planOwnedContentDisposition(scope);
    if (disposition.blocked) {
      blockers.push(
        `לא ניתן לסווג באופן חד-משמעי אירוע ישן (${event._id}) שנוצר על ידך — לא ניתן להמשיך במחיקת החשבון מבלי לנחש. יש לפנות לתמיכה.`
      );
      continue;
    }
    if (disposition.disposition === 'delete') {
      personalEventsToDelete.push(event);
    }
    // 'preserve' → leave completely untouched; createdBy remains as a
    // historical reference and is never reassigned.
  }

  const createdTasks = await ctx.db
    .query('tasks')
    .withIndex('by_creator', (q) => q.eq('createdBy', userId))
    .collect();
  const personalTasksToDelete: Doc<'tasks'>[] = [];
  for (const task of createdTasks) {
    if (task.communityId && hardDeletableCommunityIds.has(task.communityId))
      continue;
    if (task.spaceId && deletableSpaceIds.has(task.spaceId)) continue;
    const scope = resolveTaskScope(task);
    const disposition = planOwnedContentDisposition(scope);
    if (disposition.blocked) {
      blockers.push(
        `לא ניתן לסווג באופן חד-משמעי משימה ישנה (${task._id}) שנוצרה על ידך — לא ניתן להמשיך במחיקת החשבון מבלי לנחש. יש לפנות לתמיכה.`
      );
      continue;
    }
    if (disposition.disposition === 'delete') {
      personalTasksToDelete.push(task);
    }
  }

  // ── 4. Reachable spaces/communities — discovered BEFORE any membership
  //      cleanup, used for the bounded assignedToUserIds discovery (§11)
  //      and for community-membership cleanup (§12). ─────────────────────
  const myMemberRows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  const reachableSpaceIds = new Set(
    myMemberRows
      .filter((m) => resolveKind(m) === 'access')
      .map((m) => m.spaceId)
  );
  const myCommunityMemberships = await ctx.db
    .query('communityMembers')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  const reachableCommunityIds = new Set(
    myCommunityMemberships.map((m) => m.communityId)
  );

  // ── 5. Task assignment discovery (§9/§11) — union of: created-by-user
  //      (already fetched above), assignedTo === userId (indexed,
  //      complete/non-bounded), and every task in a reachable space or
  //      community (bounded — assignedToUserIds is an array and cannot be
  //      indexed; per §11 this bounded strategy, never a full table scan,
  //      is the mandated discovery approach). ─────────────────────────────
  const taskById = new Map<Id<'tasks'>, Doc<'tasks'>>();
  for (const task of createdTasks) taskById.set(task._id, task);

  const assignedToMeTasks = await ctx.db
    .query('tasks')
    .withIndex('by_assigned', (q) => q.eq('assignedTo', userId))
    .collect();
  for (const task of assignedToMeTasks) taskById.set(task._id, task);

  for (const spaceId of reachableSpaceIds) {
    const spaceTasks = await ctx.db
      .query('tasks')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    for (const task of spaceTasks) taskById.set(task._id, task);
  }
  for (const communityId of reachableCommunityIds) {
    const communityTasks = await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .collect();
    for (const task of communityTasks) taskById.set(task._id, task);
  }

  // ── 6. Owned-space/community cascade content discovery ─────────────────
  const cascadeEventIds = new Set<Id<'events'>>();
  const cascadeTaskIds = new Set<Id<'tasks'>>();

  const ownedSpaceEventsBySpace = new Map<Id<'spaces'>, Doc<'events'>[]>();
  const ownedSpaceTasksBySpace = new Map<Id<'spaces'>, Doc<'tasks'>[]>();
  const ownedSpaceBirthdaysBySpace = new Map<
    Id<'spaces'>,
    Doc<'birthdays'>[]
  >();
  for (const spaceId of deletableSpaceIds) {
    const events = await ctx.db
      .query('events')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    ownedSpaceEventsBySpace.set(spaceId, events);
    for (const e of events) cascadeEventIds.add(e._id);

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    ownedSpaceTasksBySpace.set(spaceId, tasks);
    for (const t of tasks) cascadeTaskIds.add(t._id);

    const birthdays = await ctx.db
      .query('birthdays')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    ownedSpaceBirthdaysBySpace.set(spaceId, birthdays);
  }

  const communityEventsById = new Map<Id<'communities'>, Doc<'events'>[]>();
  const communityTasksById = new Map<Id<'communities'>, Doc<'tasks'>[]>();
  const communityMembersToDeleteById = new Map<
    Id<'communities'>,
    Doc<'communityMembers'>[]
  >();
  const communityActivitiesById = new Map<
    Id<'communities'>,
    Doc<'communityActivities'>[]
  >();
  for (const communityId of hardDeletableCommunityIds) {
    const events = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) => q.eq('communityId', communityId))
      .collect();
    communityEventsById.set(communityId, events);
    for (const e of events) cascadeEventIds.add(e._id);

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .collect();
    communityTasksById.set(communityId, tasks);
    for (const t of tasks) cascadeTaskIds.add(t._id);

    const members =
      ownedCommunityMembersByCommunity.get(communityId) ??
      (await ctx.db
        .query('communityMembers')
        .withIndex('by_community', (q) => q.eq('communityId', communityId))
        .collect());
    communityMembersToDeleteById.set(communityId, members);

    const activities = await ctx.db
      .query('communityActivities')
      .withIndex('by_community_createdAt', (q) =>
        q.eq('communityId', communityId)
      )
      .collect();
    communityActivitiesById.set(communityId, activities);
  }

  for (const task of personalTasksToDelete) taskById.delete(task._id);
  const tasksToDeleteIds = new Set<Id<'tasks'>>([
    ...personalTasksToDelete.map((t) => t._id),
    ...cascadeTaskIds,
  ]);
  const eventsToDeleteIds = new Set<Id<'events'>>([
    ...personalEventsToDelete.map((e) => e._id),
    ...cascadeEventIds,
  ]);

  // Precompute linkedEvents rows for every event being hard-deleted, so the
  // write phase can tombstone them (mirrors deleteEvent's existing
  // sourceStatus:'deleted' behavior in convex/events.ts) without issuing a
  // fresh, unplanned read mid-write — and so their count is included in the
  // transaction-size preflight below.
  const linkedEventsByEventId = new Map<Id<'events'>, Doc<'linkedEvents'>[]>();
  for (const eventId of eventsToDeleteIds) {
    const linked = await ctx.db
      .query('linkedEvents')
      .withIndex('by_source', (q) => q.eq('sourceEventId', eventId))
      .collect();
    if (linked.length > 0) linkedEventsByEventId.set(eventId, linked);
  }

  // Tasks that must have their account-based assignment references
  // cleaned (never deleted — they are preserved family/community content).
  const tasksNeedingAssignmentCleanup: Doc<'tasks'>[] = [];
  for (const [taskId, task] of taskById) {
    if (tasksToDeleteIds.has(taskId)) continue;
    const wouldChange =
      task.assignedTo === userId ||
      (task.assignedToUserIds ?? []).includes(userId);
    if (wouldChange) tasksNeedingAssignmentCleanup.push(task);
  }

  // ── 7. eventTasks assignment discovery (§9/§10) — complete, indexed,
  //      non-bounded (unlike assignedToUserIds, these fields are not
  //      arrays, so a dedicated index gives full coverage). ──────────────
  const eventTaskById = new Map<Id<'eventTasks'>, Doc<'eventTasks'>>();
  const assignedEventTasks = await ctx.db
    .query('eventTasks')
    .withIndex('by_assigned_user', (q) => q.eq('assignedToUserId', userId))
    .collect();
  for (const row of assignedEventTasks) eventTaskById.set(row._id, row);
  const assignedByEventTasks = await ctx.db
    .query('eventTasks')
    .withIndex('by_assigned_by', (q) => q.eq('assignedByUserId', userId))
    .collect();
  for (const row of assignedByEventTasks) eventTaskById.set(row._id, row);

  const eventTasksNeedingCleanup: Doc<'eventTasks'>[] = [];
  for (const row of eventTaskById.values()) {
    if (eventsToDeleteIds.has(row.eventId)) continue; // deleted via cascade
    eventTasksNeedingCleanup.push(row);
  }

  // ── 8. External family entity detach (§6/§7/§8) ─────────────────────────
  const externalEntityCandidates = (
    await ctx.db
      .query('members')
      .withIndex('by_matched_user', (q) => q.eq('matchedUserId', userId))
      .collect()
  ).filter((row) => !deletableSpaceIds.has(row.spaceId));

  const externalAccessRows = myMemberRows.filter(
    (m) => resolveKind(m) === 'access' && !deletableSpaceIds.has(m.spaceId)
  );
  const externalAccessSpaceIdSet = new Set(
    externalAccessRows.map((r) => r.spaceId)
  );

  const externalEntityPlans = externalEntityCandidates.map((row) => ({
    row,
    plan: planExternalEntityReset(
      row,
      userId,
      externalAccessSpaceIdSet.has(row.spaceId)
    ),
  }));

  const affectedFamilyContactsSpaceIds = new Set(
    externalEntityCandidates.map((r) => r.spaceId)
  );
  const familyContactsOwnersAffected: Id<'users'>[] = [];
  for (const spaceId of affectedFamilyContactsSpaceIds) {
    const space = await ctx.db.get(spaceId);
    if (space?.ownerId) familyContactsOwnersAffected.push(space.ownerId);
  }

  // ── 8b. Residual-reference cleanup — DATA INTEGRITY WAVE ────────────────
  //
  // `externalAccessRows` (deleted below) are the deleting user's OWN
  // kind:'access' rows in spaces they don't own; `externalEntityCandidates`
  // (preserved/detached above, never deleted) are the matching kind:'entity'
  // rows representing the SAME person in the SAME space. Any OTHER record
  // that stored the now-to-be-deleted access row's `_id` as "this family
  // member" must be remapped to the surviving entity row's `_id` — fail
  // closed (blocks the whole deletion) whenever a space has zero or more
  // than one candidate target, per the approved remap-safety rules.
  const memberIdRemapPlan = planFamilyMemberIdRemap(
    externalAccessRows.map((r) => ({ memberId: r._id, spaceId: r.spaceId })),
    externalEntityCandidates.map((r) => ({
      memberId: r._id,
      spaceId: r.spaceId,
    }))
  );
  blockers.push(...memberIdRemapPlan.blockers);
  const deletedAccessMemberIds = new Set(
    externalAccessRows.map((r) => r._id as string)
  );

  // Preserved (non-community) events anywhere may reference the deleting
  // user in `sharedWithUserIds` or a deleted access-member id in
  // `sharedWithFamilyMemberIds` — sharing is NOT confined to a space the
  // sharer/viewer has access to (see convex/events.ts
  // `shouldIncludeCategory2Event`'s documented cross-space precedent), so
  // this cannot be safely bounded to `reachableSpaceIds` alone. Community
  // events never use either field (same file), so this index-scoped scan
  // (`communityId === undefined`) covers exactly the domain that can ever
  // need this cleanup — never a scan across community events too.
  const personalEventCandidates = await ctx.db
    .query('events')
    .withIndex('by_community_date', (q) => q.eq('communityId', undefined))
    .collect();
  const eventsNeedingResidualReferenceCleanup: Doc<'events'>[] = [];
  for (const event of personalEventCandidates) {
    if (eventsToDeleteIds.has(event._id)) continue; // deleted via cascade/personal-delete below
    const hasUserShare = (event.sharedWithUserIds ?? []).includes(userId);
    const hasMemberRef = (event.sharedWithFamilyMemberIds ?? []).some((id) =>
      deletedAccessMemberIds.has(id)
    );
    if (hasUserShare || hasMemberRef) {
      eventsNeedingResidualReferenceCleanup.push(event);
    }
  }

  // Tasks needing a member-id remap — bounded to `taskById` (already reads
  // every task in `reachableSpaceIds` ∪ `reachableCommunityIds` ∪
  // created-by-user ∪ assigned-to-user), which is a strict superset of the
  // spaceIds `externalAccessRows` can ever live in (those rows ARE a subset
  // of the same `myMemberRows` that seeds `reachableSpaceIds`) — no
  // additional read is required to find every possible reference.
  const tasksNeedingMemberIdRemap: Doc<'tasks'>[] = [];
  for (const [taskId, task] of taskById) {
    if (tasksToDeleteIds.has(taskId)) continue;
    const singularHit =
      task.assignedToMemberId !== undefined &&
      deletedAccessMemberIds.has(task.assignedToMemberId);
    const arrayHit = (task.assignedToMemberIds ?? []).some((id) =>
      deletedAccessMemberIds.has(id)
    );
    if (singularHit || arrayHit) tasksNeedingMemberIdRemap.push(task);
  }

  // communityMembers.associatedProfileIds ALWAYS stores member ids from the
  // ROW OWNER's own resolved space (server-enforced in
  // convex/communities.ts `setAssociatedProfiles` — `memberRow.spaceId !==
  // spaceId` throws), so a deleted access-member id can only ever appear on
  // a communityMembers row belonging to ANOTHER real user who ALSO has a
  // kind:'access' row in that exact space. Bounded to those specific
  // spaces/users only — never a full table scan.
  const otherUsersInAffectedSpaces = new Set<Id<'users'>>();
  for (const spaceId of externalAccessSpaceIdSet) {
    const spaceMembers = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    for (const m of spaceMembers) {
      if (
        resolveKind(m) === 'access' &&
        m.userId !== undefined &&
        m.userId !== userId
      ) {
        otherUsersInAffectedSpaces.add(m.userId);
      }
    }
  }
  const communityMembershipsNeedingProfileRemap: Doc<'communityMembers'>[] = [];
  for (const otherUserId of otherUsersInAffectedSpaces) {
    const rows = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', otherUserId))
      .collect();
    for (const row of rows) {
      if (
        (row.associatedProfileIds ?? []).some((id) =>
          deletedAccessMemberIds.has(id)
        )
      ) {
        communityMembershipsNeedingProfileRemap.push(row);
      }
    }
  }

  // tasks.deletedBy (personal trash) — see lib/accountDeletion.ts
  // `isTaskStrandedInDeletingUsersTrash` doc comment for why hard-deleting
  // (never clearing deletedBy, never restoring) is the only safe outcome.
  const myTrashedTasks = (
    await ctx.db
      .query('tasks')
      .withIndex('by_deleted_by', (q) => q.eq('deletedBy', userId))
      .collect()
  ).filter(
    (t) =>
      isTaskStrandedInDeletingUsersTrash(t, userId) &&
      !tasksToDeleteIds.has(t._id)
  );

  // ── 9. Non-owned community memberships to remove (§12) ──────────────────
  const nonOwnedMembershipsToRemove = myCommunityMemberships.filter(
    (m) => !ownedCommunities.some((c) => c._id === m.communityId)
  );

  // ── 10. Scheduled reminders (§14) — no by_user index, full scan is the
  //       documented, precedented exception (mirrors convex/devTools.ts). ─
  const allScheduledReminders = await ctx.db
    .query('scheduledReminders')
    .collect();
  const myScheduledReminders = allScheduledReminders.filter(
    (r) => r.userId === userId
  );

  // ── 11. User-scoped personal tables (§13) — safe to fully delete. ──────
  const userScopedTables = {
    pushTokens: await ctx.db
      .query('pushTokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
    googleImportStatus: await ctx.db
      .query('googleImportStatus')
      .withIndex('by_user_provider', (q) => q.eq('userId', userId))
      .collect(),
    eventCopyRegistry: await ctx.db
      .query('eventCopyRegistry')
      .withIndex('by_owner_external_id', (q) => q.eq('createdBy', userId))
      .collect(),
    savedCommunityEvents: await ctx.db
      .query('savedCommunityEvents')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
    communityEventPersonalCalendarOptOuts: await ctx.db
      .query('communityEventPersonalCalendarOptOuts')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
    personalEventCalendarOptOuts: await ctx.db
      .query('personalEventCalendarOptOuts')
      .withIndex('by_user_event', (q) => q.eq('userId', userId))
      .collect(),
    userCalendarEntries: await ctx.db
      .query('userCalendarEntries')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
    eventRsvps: await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
    taskParticipantSettings: await ctx.db
      .query('taskParticipantSettings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
    linkedEvents: await ctx.db
      .query('linkedEvents')
      .withIndex('by_recipient', (q) => q.eq('savedByUserId', userId))
      .collect(),
    shareLinks: await ctx.db
      .query('shareLinks')
      .withIndex('by_creator', (q) => q.eq('createdBy', userId))
      .collect(),
    userNotifications: await ctx.db
      .query('userNotifications')
      .withIndex('by_recipient_created', (q) => q.eq('recipientUserId', userId))
      .collect(),
    notificationLog: await ctx.db
      .query('notificationLog')
      .withIndex('by_recipient', (q) => q.eq('recipientUserId', userId))
      .collect(),
    dailyMoods: await ctx.db
      .query('dailyMoods')
      .withIndex('by_user_date', (q) => q.eq('userId', userId))
      .collect(),
    subscriptions: await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
    // Captures have no sharing concept at all — always personal (see
    // convex/ownerScope.ts `stampCaptureOwnerScope`) — safe to delete
    // fully regardless of which space they live in.
    captures: await ctx.db
      .query('captures')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
  } as const;

  warnings.push(
    'communityActivities.actorUserId is never scanned or touched for non-hard-deleted communities (no index on actorUserId) — historical activity log entries authored by the deleted user, if any, are left with a dangling reference (matches the existing devTools.ts QA-reset precedent).'
  );

  // ── 12. Auth investigation (§16) ────────────────────────────────────────
  const authAccounts = await ctx.db
    .query('authAccounts')
    .withIndex('userIdAndProvider', (q) => q.eq('userId', userId))
    .collect();
  const authSessions = await ctx.db
    .query('authSessions')
    .withIndex('userId', (q) => q.eq('userId', userId))
    .collect();
  const sessionIds = new Set(authSessions.map((s) => s._id));

  const authRefreshTokens: Doc<'authRefreshTokens'>[] = [];
  for (const session of authSessions) {
    const tokens = await ctx.db
      .query('authRefreshTokens')
      .withIndex('sessionId', (q) => q.eq('sessionId', session._id))
      .collect();
    authRefreshTokens.push(...tokens);
  }

  const authVerificationCodes: Doc<'authVerificationCodes'>[] = [];
  for (const account of authAccounts) {
    const codes = await ctx.db
      .query('authVerificationCodes')
      .withIndex('accountId', (q) => q.eq('accountId', account._id))
      .collect();
    authVerificationCodes.push(...codes);
  }

  // authVerifiers has no index on sessionId (only "signature") — this app
  // uses Phone OTP + a Credentials apple-review bypass, never OAuth/PKCE,
  // so this table is expected to be empty in practice. Full scan mirrors
  // the documented convex/devTools.ts precedent.
  const authVerifiers = (await ctx.db.query('authVerifiers').collect()).filter(
    (row) => row.sessionId !== undefined && sessionIds.has(row.sessionId)
  );

  const normalizedPhone = user.phone ? normalizePhoneToE164(user.phone) : null;
  const authRateLimitRow = normalizedPhone
    ? await ctx.db
        .query('authRateLimits')
        .withIndex('identifier', (q) => q.eq('identifier', normalizedPhone))
        .unique()
    : null;

  // ══════════════════════════════════════════════════════════════════════
  // Transaction-size estimate — still zero writes. The caller (either
  // runAccountDeletion or previewAccountDeletion) decides what to do with
  // `blockers`/`sizeCheck` — this function never throws for either.
  // ══════════════════════════════════════════════════════════════════════
  const plannedCounts: Record<string, number> = {
    ownedSpaces: deletableSpaceIds.size,
    ownedCommunities: hardDeletableCommunityIds.size,
    personalEvents: personalEventsToDelete.length,
    personalTasks: personalTasksToDelete.length,
    cascadeEvents: cascadeEventIds.size,
    cascadeTasks: cascadeTaskIds.size,
    linkedEventTombstones: [...linkedEventsByEventId.values()].reduce(
      (sum, rows) => sum + rows.length,
      0
    ),
    taskAssignmentCleanups: tasksNeedingAssignmentCleanup.length,
    eventTaskAssignmentCleanups: eventTasksNeedingCleanup.length,
    externalEntityResets: externalEntityPlans.filter(
      ({ plan }) => !externalEntityResetPlanIsNoop(plan)
    ).length,
    externalAccessRowRemovals: externalAccessRows.length,
    communityMembershipRemovals: nonOwnedMembershipsToRemove.length,
    // Automatic community ownership transfer (§2/§5/§9/§10, updated rule):
    // per transferred community — 1 community.ownerId patch, 1 successor
    // membership role patch, 1 deleting-owner membership row delete, 1
    // durable in-app notification insert, 1 best-effort push scheduling
    // call (ctx.scheduler.runAfter also counts as a write).
    communityOwnershipTransfers: communityTransferEntries.length,
    communityMembershipRoleUpdates: communityTransferEntries.length,
    communityOwnerMembershipRemovalsOnTransfer: communityTransferEntries.filter(
      (e) => e.ownerMembershipId !== null
    ).length,
    communityTransferNotifications: communityTransferEntries.length,
    communityTransferPushSchedules: communityTransferEntries.length,
    scheduledReminders: myScheduledReminders.length,
    authAccounts: authAccounts.length,
    authSessions: authSessions.length,
    authRefreshTokens: authRefreshTokens.length,
    authVerificationCodes: authVerificationCodes.length,
    authVerifiers: authVerifiers.length,
    authRateLimit: authRateLimitRow ? 1 : 0,
    usersRow: 1,
    eventResidualReferenceCleanups:
      eventsNeedingResidualReferenceCleanup.length,
    taskMemberIdRemaps: tasksNeedingMemberIdRemap.length,
    communityMemberProfileRemaps:
      communityMembershipsNeedingProfileRemap.length,
    softDeletedTaskHardDeletes: myTrashedTasks.length,
  };
  for (const [table, rows] of Object.entries(userScopedTables)) {
    plannedCounts[table] = rows.length;
  }
  for (const spaceId of deletableSpaceIds) {
    plannedCounts.ownedSpaceMembers =
      (plannedCounts.ownedSpaceMembers ?? 0) +
      (ownedSpaceMembersBySpace.get(spaceId)?.length ?? 0);
    plannedCounts.ownedSpaceBirthdays =
      (plannedCounts.ownedSpaceBirthdays ?? 0) +
      (ownedSpaceBirthdaysBySpace.get(spaceId)?.length ?? 0);
  }
  for (const communityId of hardDeletableCommunityIds) {
    plannedCounts.communityMembersRows =
      (plannedCounts.communityMembersRows ?? 0) +
      (communityMembersToDeleteById.get(communityId)?.length ?? 0);
    plannedCounts.communityActivitiesRows =
      (plannedCounts.communityActivitiesRows ?? 0) +
      (communityActivitiesById.get(communityId)?.length ?? 0);
  }
  // eventTasks belonging to cascade-deleted events are counted once the
  // per-event rows are actually read during the write phase below — the
  // preflight estimate here uses the assignment-cleanup count plus a
  // per-event read already performed for cascade discovery, so it is not
  // double counted against the true destructive-write volume.

  const plannedWriteCount = estimateAccountDeletionWriteCount(plannedCounts);
  const sizeCheck = evaluateAccountDeletionTransactionSize(plannedWriteCount);

  return {
    userId,
    user,
    blockers,
    warnings,
    ownedSpaces,
    ownedSpaceMembersBySpace,
    ownedSpaceOwnershipInfos,
    deletableSpaceIds,
    ownedCommunities,
    ownedCommunityMembersByCommunity,
    ownedCommunityPlanEntries,
    communityTransferEntries,
    hardDeletableCommunityIds,
    createdEvents,
    personalEventsToDelete,
    createdTasks,
    personalTasksToDelete,
    myMemberRows,
    reachableSpaceIds,
    myCommunityMemberships,
    reachableCommunityIds,
    taskById,
    cascadeEventIds,
    cascadeTaskIds,
    ownedSpaceEventsBySpace,
    ownedSpaceTasksBySpace,
    ownedSpaceBirthdaysBySpace,
    communityEventsById,
    communityTasksById,
    communityMembersToDeleteById,
    communityActivitiesById,
    tasksToDeleteIds,
    eventsToDeleteIds,
    linkedEventsByEventId,
    tasksNeedingAssignmentCleanup,
    eventTaskById,
    eventTasksNeedingCleanup,
    externalEntityCandidates,
    externalAccessRows,
    externalAccessSpaceIdSet,
    externalEntityPlans,
    affectedFamilyContactsSpaceIds,
    familyContactsOwnersAffected,
    memberIdRemapPlan,
    deletedAccessMemberIds,
    eventsNeedingResidualReferenceCleanup,
    tasksNeedingMemberIdRemap,
    communityMembershipsNeedingProfileRemap,
    myTrashedTasks,
    nonOwnedMembershipsToRemove,
    myScheduledReminders,
    userScopedTables,
    authAccounts,
    authSessions,
    authRefreshTokens,
    authVerificationCodes,
    authVerifiers,
    normalizedPhone,
    authRateLimitRow,
    plannedCounts,
    plannedWriteCount,
    sizeCheck,
  };
}

/** The full read-only plan produced by `buildAccountDeletionPlan`. */
export type AccountDeletionPlan = Awaited<
  ReturnType<typeof buildAccountDeletionPlan>
>;

interface ContentDispositionTally {
  personal: number;
  family: number;
  community: number;
  legacy: number;
  ambiguous: number;
}

/**
 * Re-applies the EXACT same skip conditions and classification calls
 * (`resolveEventScope` / `planOwnedContentDisposition`) as the real
 * planning loop above, purely to tally counts for the read-only preview.
 * This is not a second implementation of the disposition RULE — it calls
 * the identical pure functions — it only adds reporting-only bookkeeping
 * on top of data already read by `buildAccountDeletionPlan`.
 */
function tallyCreatedEventDisposition(
  plan: AccountDeletionPlan
): ContentDispositionTally {
  const tally: ContentDispositionTally = {
    personal: 0,
    family: 0,
    community: 0,
    legacy: 0,
    ambiguous: 0,
  };
  for (const event of plan.createdEvents) {
    if (
      event.communityId &&
      plan.hardDeletableCommunityIds.has(event.communityId)
    )
      continue;
    if (event.spaceId && plan.deletableSpaceIds.has(event.spaceId)) continue;
    if (event.ownerScope === undefined) tally.legacy += 1;
    const scope = resolveEventScope(event);
    const disposition = planOwnedContentDisposition(scope);
    if (disposition.blocked) {
      tally.ambiguous += 1;
      continue;
    }
    if (disposition.disposition === 'delete') tally.personal += 1;
    else if (scope === 'family') tally.family += 1;
    else if (scope === 'community') tally.community += 1;
  }
  return tally;
}

/** Same rationale as `tallyCreatedEventDisposition`, for tasks. */
function tallyCreatedTaskDisposition(
  plan: AccountDeletionPlan
): ContentDispositionTally {
  const tally: ContentDispositionTally = {
    personal: 0,
    family: 0,
    community: 0,
    legacy: 0,
    ambiguous: 0,
  };
  for (const task of plan.createdTasks) {
    if (
      task.communityId &&
      plan.hardDeletableCommunityIds.has(task.communityId)
    )
      continue;
    if (task.spaceId && plan.deletableSpaceIds.has(task.spaceId)) continue;
    if (task.ownerScope === undefined) tally.legacy += 1;
    const scope = resolveTaskScope(task);
    const disposition = planOwnedContentDisposition(scope);
    if (disposition.blocked) {
      tally.ambiguous += 1;
      continue;
    }
    if (disposition.disposition === 'delete') tally.personal += 1;
    else if (scope === 'family') tally.family += 1;
    else if (scope === 'community') tally.community += 1;
  }
  return tally;
}

// ============================================================================
// buildAccountDeletionPreview — shapes an AccountDeletionPlan into the
// read-only preview summary. Zero ctx access (pure over the plan object),
// zero writes. Called only by convex/accountDeletionPreview.ts.
// ============================================================================
export function buildAccountDeletionPreview(
  plan: AccountDeletionPlan
): AccountDeletionPreview {
  const eventTally = tallyCreatedEventDisposition(plan);
  const taskTally = tallyCreatedTaskDisposition(plan);

  const tasksAssignedToClearCount = plan.tasksNeedingAssignmentCleanup.filter(
    (t) => t.assignedTo === plan.userId
  ).length;
  const tasksAssignedToUserIdsClearCount =
    plan.tasksNeedingAssignmentCleanup.filter((t) =>
      (t.assignedToUserIds ?? []).includes(plan.userId)
    ).length;
  const eventTasksAssignedToUserIdClearCount =
    plan.eventTasksNeedingCleanup.filter(
      (row) => row.assignedToUserId === plan.userId
    ).length;
  const eventTasksAssignedByUserIdClearCount =
    plan.eventTasksNeedingCleanup.filter(
      (row) => row.assignedByUserId === plan.userId
    ).length;
  // Entity/member-based assignments (assignedToMemberId/assignedToMemberIds)
  // are intentionally NEVER touched by the production planner — this tally
  // is purely informational, derived from tasks already read into
  // `taskById` during discovery, excluding tasks that are themselves being
  // deleted (their assignment fields are moot).
  const survivingMemberAssignmentCount = [...plan.taskById.values()].filter(
    (t) =>
      !plan.tasksToDeleteIds.has(t._id) &&
      (t.assignedToMemberId !== undefined ||
        (t.assignedToMemberIds ?? []).length > 0)
  ).length;

  const externalEntityDetachCount = plan.externalEntityPlans.filter(
    ({ plan: entityPlan }) => !externalEntityResetPlanIsNoop(entityPlan)
  ).length;

  const userScopedCounts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(plan.userScopedTables)) {
    userScopedCounts[table] = rows.length;
  }
  userScopedCounts.scheduledReminders = plan.myScheduledReminders.length;

  return summarizeAccountDeletionPreview({
    blockers: plan.blockers,
    plannedWriteCount: plan.plannedWriteCount,
    writeSafetyLimit: ACCOUNT_DELETION_MAX_PLANNED_WRITES,
    sizeSafe: plan.sizeCheck.safe,
    spaces: plan.ownedSpaceOwnershipInfos.map((info) => ({
      spaceId: info.spaceId,
      spaceName: info.spaceName,
      deletable: plan.deletableSpaceIds.has(info.spaceId),
      otherJoinedUserCount: info.otherAccessUserIds.length,
    })),
    communities: plan.ownedCommunityPlanEntries.map((entry) => ({
      communityId: entry.communityId,
      communityName: entry.communityName,
      archived: entry.archived,
      action: entry.action,
      eligibleSuccessorCount: entry.eligibleSuccessorCount,
      selectedSuccessorRole: entry.successor?.role ?? null,
      selectedSuccessorJoinedAt: entry.successor?.joinedAt ?? null,
      selectedSuccessorName: entry.successor?.name ?? null,
      reason: entry.reason,
    })),
    nonOwnedCommunityMembershipCount: plan.nonOwnedMembershipsToRemove.length,
    personalEventDeleteCount: plan.personalEventsToDelete.length,
    personalTaskDeleteCount: plan.personalTasksToDelete.length,
    familyEventPreserveCount: eventTally.family,
    familyTaskPreserveCount: taskTally.family,
    communityEventPreserveCount: eventTally.community,
    communityTaskPreserveCount: taskTally.community,
    legacyOwnerScopeEventCount: eventTally.legacy,
    legacyOwnerScopeTaskCount: taskTally.legacy,
    ambiguousRecordCount: eventTally.ambiguous + taskTally.ambiguous,
    tasksAssignedToClearCount,
    tasksAssignedToUserIdsClearCount,
    eventTasksAssignedToUserIdClearCount,
    eventTasksAssignedByUserIdClearCount,
    survivingMemberAssignmentCount,
    externalEntityDetachCount,
    externalAccessRowRemovalCount: plan.externalAccessRows.length,
    externalEntityAffectedSpaceCount: plan.affectedFamilyContactsSpaceIds.size,
    userScopedCounts,
    authRefreshTokenCount: plan.authRefreshTokens.length,
    authSessionCount: plan.authSessions.length,
    authAccountCount: plan.authAccounts.length,
    authVerificationCodeCount: plan.authVerificationCodes.length,
    authVerifierCount: plan.authVerifiers.length,
    authRateLimitRowCount: plan.authRateLimitRow ? 1 : 0,
    eventSharedUserRefsRemoved:
      plan.eventsNeedingResidualReferenceCleanup.filter((e) =>
        (e.sharedWithUserIds ?? []).includes(plan.userId)
      ).length,
    eventSharedFamilyMemberRefsRemapped:
      plan.eventsNeedingResidualReferenceCleanup.filter((e) =>
        (e.sharedWithFamilyMemberIds ?? []).some((id) =>
          plan.deletedAccessMemberIds.has(id)
        )
      ).length,
    taskMemberRefsRemapped: plan.tasksNeedingMemberIdRemap.length,
    communityMemberProfileRefsRemapped:
      plan.communityMembershipsNeedingProfileRemap.length,
    softDeletedTasksResolved: plan.myTrashedTasks.length,
    unsafeMemberReferenceRemapCount: plan.memberIdRemapPlan.blockers.length,
  });
}

// ============================================================================
// runAccountDeletion — the production execution path. Calls
// buildAccountDeletionPlan (the SAME function previewAccountDeletion uses),
// then throws on any blocker/size-safety failure, then performs every
// destructive write, verifies cleanup, cleans Auth state, and deletes the
// `users` row LAST.
// ============================================================================
export async function runAccountDeletion(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<AccountDeletionSummary> {
  const plan = await buildAccountDeletionPlan(ctx, userId);

  // ══════════════════════════════════════════════════════════════════════
  // BLOCKER / TRANSACTION-SIZE GATES — zero writes performed above.
  // ══════════════════════════════════════════════════════════════════════
  if (!isAccountDeletionSafeToExecute(plan.blockers)) {
    throw new Error(plan.blockers.join('\n'));
  }
  if (!plan.sizeCheck.safe) {
    throw new Error(
      plan.sizeCheck.blocker ?? 'Deletion too large to execute safely.'
    );
  }

  const {
    deletableSpaceIds,
    hardDeletableCommunityIds,
    communityTransferEntries,
    personalEventsToDelete,
    personalTasksToDelete,
    tasksNeedingAssignmentCleanup,
    eventTasksNeedingCleanup,
    externalEntityPlans,
    externalAccessRows,
    familyContactsOwnersAffected,
    memberIdRemapPlan,
    deletedAccessMemberIds,
    eventsNeedingResidualReferenceCleanup,
    tasksNeedingMemberIdRemap,
    communityMembershipsNeedingProfileRemap,
    myTrashedTasks,
    nonOwnedMembershipsToRemove,
    myScheduledReminders,
    userScopedTables,
    ownedSpaceEventsBySpace,
    ownedSpaceTasksBySpace,
    ownedSpaceBirthdaysBySpace,
    ownedSpaceMembersBySpace,
    communityEventsById,
    communityTasksById,
    communityMembersToDeleteById,
    communityActivitiesById,
    linkedEventsByEventId,
    eventsToDeleteIds,
    authRefreshTokens,
    authVerificationCodes,
    authVerifiers,
    authSessions,
    authAccounts,
    authRateLimitRow,
    normalizedPhone,
    plannedWriteCount,
  } = plan;

  // ══════════════════════════════════════════════════════════════════════
  // WRITES — every guard above passed. From here on this mutation performs
  // destructive writes. If ANYTHING below throws, Convex rolls back the
  // ENTIRE transaction (including everything already written here).
  // ══════════════════════════════════════════════════════════════════════

  // ── A. External family entity rows — patched, NEVER deleted (§6/§7). ───
  let resetExternalEntityCount = 0;
  for (const { row, plan: entityPlan } of externalEntityPlans) {
    if (externalEntityResetPlanIsNoop(entityPlan)) continue;
    const patch: Record<string, unknown> = {};
    if (entityPlan.clearMatchedUserId) patch.matchedUserId = undefined;
    if (entityPlan.clearUserId) patch.userId = undefined;
    if (entityPlan.resetInviteStatusToNone) patch.inviteStatus = 'none';
    await ctx.db.patch(row._id, patch);
    resetExternalEntityCount += 1;
  }

  // ── B. familyContacts mirrors on external space owners (§6). ────────────
  for (const ownerId of new Set(familyContactsOwnersAffected)) {
    const owner = await ctx.db.get(ownerId);
    if (!owner || !Array.isArray(owner.familyContacts)) continue;
    const { updated, changed } = planFamilyContactsReset(
      owner.familyContacts as FamilyContactBlobEntry[],
      normalizedPhone ?? '',
      userId,
      normalizePhoneToE164
    );
    if (changed) {
      await ctx.db.patch(owner._id, { familyContacts: updated });
    }
  }

  // ── C. Remove the deleting user's own kind:'access' rows from spaces
  //      they don't own (§6 — "remove corresponding kind:'access' row"). ──
  for (const row of externalAccessRows) {
    await ctx.db.delete(row._id);
  }

  // ── D. Task assignment cleanup (§9/§11) — preserved tasks only. ─────────
  let cleanedTaskAssignmentCount = 0;
  const patchedTaskAssignments: Doc<'tasks'>[] = [];
  for (const task of tasksNeedingAssignmentCleanup) {
    const cleanup = planTaskAssignmentCleanup(task, userId);
    if (!cleanup.changed) {
      patchedTaskAssignments.push(task);
      continue;
    }
    await ctx.db.patch(task._id, {
      assignedTo: cleanup.assignedTo as Id<'users'> | undefined,
      assignedToUserIds: cleanup.assignedToUserIds as Id<'users'>[] | undefined,
      updatedAt: Date.now(),
    });
    patchedTaskAssignments.push({
      ...task,
      assignedTo: cleanup.assignedTo as Id<'users'> | undefined,
      assignedToUserIds: cleanup.assignedToUserIds as Id<'users'>[] | undefined,
    });
    cleanedTaskAssignmentCount += 1;
  }

  // ── E. eventTasks assignment cleanup (§9/§10). ──────────────────────────
  let cleanedEventTaskAssignmentCount = 0;
  const patchedEventTasks: Doc<'eventTasks'>[] = [];
  for (const row of eventTasksNeedingCleanup) {
    const patch: Partial<Doc<'eventTasks'>> = {};
    if (row.assignedToUserId === userId) patch.assignedToUserId = undefined;
    if (row.assignedByUserId === userId) patch.assignedByUserId = undefined;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(row._id, patch);
      cleanedEventTaskAssignmentCount += 1;
    }
    patchedEventTasks.push({ ...row, ...patch });
  }

  // ── D2. Preserved events — sharedWithUserIds cleanup + member-id remap
  //      (data-integrity wave: see lib/accountDeletion.ts
  //      `planEventResidualReferenceCleanup`). ─────────────────────────────
  let eventSharedUserRefsRemoved = 0;
  let eventSharedFamilyMemberRefsRemapped = 0;
  const patchedResidualEvents: Doc<'events'>[] = [];
  for (const event of eventsNeedingResidualReferenceCleanup) {
    const cleanup = planEventResidualReferenceCleanup(
      event,
      userId,
      memberIdRemapPlan.remap
    );
    if (!cleanup.changed) {
      patchedResidualEvents.push(event);
      continue;
    }
    if ((event.sharedWithUserIds ?? []).includes(userId)) {
      eventSharedUserRefsRemoved += 1;
    }
    if (
      (event.sharedWithFamilyMemberIds ?? []).some((id) =>
        memberIdRemapPlan.remap.has(id)
      )
    ) {
      eventSharedFamilyMemberRefsRemapped += 1;
    }
    await ctx.db.patch(event._id, {
      sharedWithUserIds: cleanup.sharedWithUserIds as Id<'users'>[] | undefined,
      sharedWithFamilyMemberIds: cleanup.sharedWithFamilyMemberIds,
    });
    patchedResidualEvents.push({
      ...event,
      sharedWithUserIds: cleanup.sharedWithUserIds as Id<'users'>[] | undefined,
      sharedWithFamilyMemberIds: cleanup.sharedWithFamilyMemberIds,
    });
  }

  // ── D3. Preserved tasks — assignedToMemberId/assignedToMemberIds remap
  //      (data-integrity wave). ───────────────────────────────────────────
  let taskMemberRefsRemapped = 0;
  const patchedMemberRemapTasks: Doc<'tasks'>[] = [];
  for (const task of tasksNeedingMemberIdRemap) {
    const remap = planTaskMemberIdRemap(task, memberIdRemapPlan.remap);
    if (!remap.changed) {
      patchedMemberRemapTasks.push(task);
      continue;
    }
    await ctx.db.patch(task._id, {
      assignedToMemberId: remap.assignedToMemberId as Id<'members'> | undefined,
      assignedToMemberIds: remap.assignedToMemberIds as
        | Id<'members'>[]
        | undefined,
      updatedAt: Date.now(),
    });
    patchedMemberRemapTasks.push({
      ...task,
      assignedToMemberId: remap.assignedToMemberId as Id<'members'> | undefined,
      assignedToMemberIds: remap.assignedToMemberIds as
        | Id<'members'>[]
        | undefined,
    });
    taskMemberRefsRemapped += 1;
  }

  // ── D4. communityMembers.associatedProfileIds remap (data-integrity
  //      wave). ────────────────────────────────────────────────────────────
  let communityMemberProfileRefsRemapped = 0;
  const patchedCommunityMemberships: Doc<'communityMembers'>[] = [];
  for (const membership of communityMembershipsNeedingProfileRemap) {
    const remap = planCommunityMemberProfileRemap(
      membership,
      memberIdRemapPlan.remap
    );
    if (!remap.changed) {
      patchedCommunityMemberships.push(membership);
      continue;
    }
    await ctx.db.patch(membership._id, {
      associatedProfileIds: remap.associatedProfileIds as
        | Id<'members'>[]
        | undefined,
    });
    patchedCommunityMemberships.push({
      ...membership,
      associatedProfileIds: remap.associatedProfileIds as
        | Id<'members'>[]
        | undefined,
    });
    communityMemberProfileRefsRemapped += 1;
  }

  // ── D5. Soft-deleted tasks stranded in the deleting user's own trash —
  //      hard-deleted (see lib/accountDeletion.ts
  //      `isTaskStrandedInDeletingUsersTrash` doc comment). ────────────────
  let softDeletedTasksResolved = 0;
  for (const task of myTrashedTasks) {
    await ctx.db.delete(task._id);
    softDeletedTasksResolved += 1;
  }

  // ── F. Non-owned community memberships (§12) — assignment cleanup for
  //      that community already happened in D/E above (discovery was
  //      performed before this point). ────────────────────────────────────
  for (const membership of nonOwnedMembershipsToRemove) {
    await ctx.db.delete(membership._id);
  }

  // ── F2. Automatic community ownership transfer (§2/§5/§9/§10, updated
  //      product rule) — for every owned community with an eligible
  //      other real joined member: promote the deterministically-selected
  //      successor's membership row to 'owner', point the community's
  //      ownerId at them, remove the deleting owner's own membership row,
  //      and notify the new owner. The community itself, its content
  //      (events/tasks/settings/archived state), and every OTHER
  //      member/admin are left completely untouched — `createdBy` on
  //      historical content is never rewritten (see
  //      lib/creatorOrphanAuthority.ts for how orphaned-creator authority
  //      is already handled separately). The in-app notification row is
  //      the durable source of truth; `ctx.scheduler.runAfter(0, ...)`
  //      only actually fires `sendPush` AFTER this mutation commits — so
  //      a push failure (missing token, dead token, network error) can
  //      NEVER roll back this otherwise-valid account deletion (see
  //      convex/pushNotifications.ts `sendPush` — an internalAction, and
  //      thus never inlined into this mutation's transaction). ──────────
  const transferredCommunityIds: Id<'communities'>[] = [];
  for (const entry of communityTransferEntries) {
    await ctx.db.patch(entry.communityId, { ownerId: entry.successor.userId });
    await ctx.db.patch(entry.successor.membershipId, { role: 'owner' });
    if (entry.ownerMembershipId) {
      await ctx.db.delete(entry.ownerMembershipId);
    }

    const transferScreen = `/(authenticated)/community/${entry.communityId}`;
    await createUserNotifications(ctx, {
      recipientUserIds: [entry.successor.userId],
      pushType: COMMUNITY_OWNERSHIP_TRANSFER_PUSH_TYPE,
      title: COMMUNITY_OWNERSHIP_TRANSFER_NOTIFICATION_TITLE,
      body: communityOwnershipTransferNotificationBody(entry.communityName),
      screen: transferScreen,
    });
    await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
      recipientUserIds: [entry.successor.userId],
      pushType: COMMUNITY_OWNERSHIP_TRANSFER_PUSH_TYPE,
      title: COMMUNITY_OWNERSHIP_TRANSFER_NOTIFICATION_TITLE,
      body: communityOwnershipTransferNotificationBody(entry.communityName),
      data: { screen: transferScreen },
      channelId: 'communities',
    });

    transferredCommunityIds.push(entry.communityId);
  }

  // ── G. Cancel + delete scheduled reminders (§14). ───────────────────────
  for (const reminder of myScheduledReminders) {
    if (reminder.status === 'pending') {
      await ctx.scheduler.cancel(reminder.scheduledFunctionId);
    }
    await ctx.db.delete(reminder._id);
  }

  // ── H. Delete personal-scope events/tasks created by the user (§3/§4),
  //      plus their eventTasks. Mirrors deleteEvent's existing linkedEvents
  //      tombstone behavior (convex/events.ts) — a recipient who saved a
  //      share-link to one of these personal events falls back to their
  //      snapshot rather than being left pointing at a deleted event. ─────
  let deletedEventCount = 0;
  for (const event of personalEventsToDelete) {
    const eTasks = await ctx.db
      .query('eventTasks')
      .withIndex('by_event', (q) => q.eq('eventId', event._id))
      .collect();
    for (const et of eTasks) await ctx.db.delete(et._id);

    const linked = linkedEventsByEventId.get(event._id) ?? [];
    for (const row of linked) {
      await ctx.db.patch(row._id, { sourceStatus: 'deleted' });
    }

    await ctx.db.delete(event._id);
    deletedEventCount += 1;
  }
  let deletedTaskCount = 0;
  for (const task of personalTasksToDelete) {
    await ctx.db.delete(task._id);
    deletedTaskCount += 1;
  }

  // ── I. Delete every other user-scoped personal table (§13). ─────────────
  for (const rows of Object.values(userScopedTables)) {
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  }

  // ── J. Hard-delete sole-owned communities and all community-scoped data
  //      (§2) — leaf records before root records. ─────────────────────────
  for (const communityId of hardDeletableCommunityIds) {
    const events = communityEventsById.get(communityId) ?? [];
    for (const event of events) {
      const eTasks = await ctx.db
        .query('eventTasks')
        .withIndex('by_event', (q) => q.eq('eventId', event._id))
        .collect();
      for (const et of eTasks) await ctx.db.delete(et._id);

      const saved = await ctx.db
        .query('savedCommunityEvents')
        .withIndex('by_event', (q) => q.eq('eventId', event._id))
        .collect();
      for (const s of saved) await ctx.db.delete(s._id);

      const calendarEntries = await ctx.db
        .query('userCalendarEntries')
        .withIndex('by_event', (q) => q.eq('eventId', event._id))
        .collect();
      for (const c of calendarEntries) await ctx.db.delete(c._id);

      const rsvps = await ctx.db
        .query('eventRsvps')
        .withIndex('by_event_user', (q) => q.eq('eventId', event._id))
        .collect();
      for (const r of rsvps) await ctx.db.delete(r._id);

      const optOuts = await ctx.db
        .query('personalEventCalendarOptOuts')
        .withIndex('by_event_user', (q) => q.eq('eventId', event._id))
        .collect();
      for (const o of optOuts) await ctx.db.delete(o._id);

      const linked = linkedEventsByEventId.get(event._id) ?? [];
      for (const row of linked) {
        await ctx.db.patch(row._id, { sourceStatus: 'deleted' });
      }

      await ctx.db.delete(event._id);
      deletedEventCount += 1;
    }

    const tasks = communityTasksById.get(communityId) ?? [];
    for (const task of tasks) {
      await ctx.db.delete(task._id);
      deletedTaskCount += 1;
    }

    const members = communityMembersToDeleteById.get(communityId) ?? [];
    for (const m of members) {
      await ctx.db.delete(m._id);
    }

    const activities = communityActivitiesById.get(communityId) ?? [];
    for (const a of activities) await ctx.db.delete(a._id);

    await ctx.db.delete(communityId);
  }

  // ── K. Delete sole-owned family/personal spaces and all space-scoped
  //      data (§1/§15) — leaf records before root records. ────────────────
  for (const spaceId of deletableSpaceIds) {
    const events = ownedSpaceEventsBySpace.get(spaceId) ?? [];
    for (const event of events) {
      const eTasks = await ctx.db
        .query('eventTasks')
        .withIndex('by_event', (q) => q.eq('eventId', event._id))
        .collect();
      for (const et of eTasks) await ctx.db.delete(et._id);

      const linked = linkedEventsByEventId.get(event._id) ?? [];
      for (const row of linked) {
        await ctx.db.patch(row._id, { sourceStatus: 'deleted' });
      }

      await ctx.db.delete(event._id);
      deletedEventCount += 1;
    }

    const tasks = ownedSpaceTasksBySpace.get(spaceId) ?? [];
    for (const task of tasks) {
      await ctx.db.delete(task._id);
      deletedTaskCount += 1;
    }

    const birthdays = ownedSpaceBirthdaysBySpace.get(spaceId) ?? [];
    for (const b of birthdays) await ctx.db.delete(b._id);

    const members = ownedSpaceMembersBySpace.get(spaceId) ?? [];
    for (const m of members) await ctx.db.delete(m._id);

    await ctx.db.delete(spaceId);
  }

  // ══════════════════════════════════════════════════════════════════════
  // VERIFY CLEANUP (§9/§11) — throws (rolling back everything above) if
  // ANY account-based reference to the deleted user still survives.
  // ══════════════════════════════════════════════════════════════════════
  const residualAssignedTasks = await ctx.db
    .query('tasks')
    .withIndex('by_assigned', (q) => q.eq('assignedTo', userId))
    .collect();
  if (residualAssignedTasks.length > 0) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו משימות המשויכות למשתמש שנמחק (assignedTo).'
    );
  }
  if (!verifyNoResidualTaskAssignment(patchedTaskAssignments, userId)) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו הפניות assignedToUserIds למשתמש שנמחק.'
    );
  }
  const residualEventTasksAssigned = await ctx.db
    .query('eventTasks')
    .withIndex('by_assigned_user', (q) => q.eq('assignedToUserId', userId))
    .collect();
  const residualEventTasksAssignedBy = await ctx.db
    .query('eventTasks')
    .withIndex('by_assigned_by', (q) => q.eq('assignedByUserId', userId))
    .collect();
  const remainingResidualEventTasks = [
    ...residualEventTasksAssigned,
    ...residualEventTasksAssignedBy,
  ].filter((row) => !eventsToDeleteIds.has(row.eventId));
  if (
    remainingResidualEventTasks.length > 0 ||
    !verifyNoResidualEventTaskAssignment(patchedEventTasks, userId)
  ) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו הפניות assignedToUserId/assignedByUserId ב-eventTasks למשתמש שנמחק.'
    );
  }
  const residualMatchedEntities = await ctx.db
    .query('members')
    .withIndex('by_matched_user', (q) => q.eq('matchedUserId', userId))
    .collect();
  if (residualMatchedEntities.length > 0) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו פרופילי משפחה חיצוניים המקושרים למשתמש שנמחק.'
    );
  }
  const residualMemberRows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  if (residualMemberRows.length > 0) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו רשומות חברות (members) עבור המשתמש שנמחק.'
    );
  }
  // Community ownership transfer (§2/§5, updated rule) safety net: after
  // transfers (owner row explicitly deleted), non-owned removals (§12),
  // and hard-delete cascades (all member rows deleted with the
  // community), ZERO communityMembers rows for the deleted user may
  // survive anywhere.
  const residualCommunityMemberRows = await ctx.db
    .query('communityMembers')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  if (residualCommunityMemberRows.length > 0) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו רשומות חברות בקהילה (communityMembers) עבור המשתמש שנמחק.'
    );
  }

  // ── Residual-reference verification (data-integrity wave) ─────────────
  if (
    !verifyNoResidualEventReferences(
      patchedResidualEvents,
      userId,
      deletedAccessMemberIds
    )
  ) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו הפניות sharedWithUserIds/sharedWithFamilyMemberIds למשתמש שנמחק או לחבר משפחה שנמחק.'
    );
  }
  if (
    !verifyNoResidualTaskMemberReferences(
      patchedMemberRemapTasks,
      deletedAccessMemberIds
    )
  ) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו הפניות assignedToMemberId/assignedToMemberIds לחבר משפחה שנמחק.'
    );
  }
  if (
    !verifyNoResidualCommunityMemberProfileReferences(
      patchedCommunityMemberships,
      deletedAccessMemberIds
    )
  ) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו הפניות associatedProfileIds לחבר משפחה שנמחק.'
    );
  }
  const residualDeletedByTasks = await ctx.db
    .query('tasks')
    .withIndex('by_deleted_by', (q) => q.eq('deletedBy', userId))
    .collect();
  if (
    residualDeletedByTasks.length > 0 ||
    !verifyNoResidualDeletedByReference(myTrashedTasks, userId)
  ) {
    throw new Error(
      'אימות מחיקת החשבון נכשל: נותרו משימות עם deletedBy של המשתמש שנמחק.'
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // Auth cleanup (§16) — dependents before parents.
  // ══════════════════════════════════════════════════════════════════════
  for (const token of authRefreshTokens) {
    await ctx.db.delete(token._id);
  }
  for (const code of authVerificationCodes) {
    await ctx.db.delete(code._id);
  }
  for (const verifier of authVerifiers) {
    await ctx.db.delete(verifier._id);
  }
  for (const session of authSessions) {
    await ctx.db.delete(session._id);
  }
  for (const account of authAccounts) {
    await ctx.db.delete(account._id);
  }
  if (authRateLimitRow) {
    await ctx.db.delete(authRateLimitRow._id);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Delete the users row LAST.
  // ══════════════════════════════════════════════════════════════════════
  await ctx.db.delete(userId);

  const removedCommunityMembershipCount =
    nonOwnedMembershipsToRemove.length +
    [...communityMembersToDeleteById.values()].reduce(
      (sum, rows) => sum + rows.length,
      0
    ) +
    communityTransferEntries.filter((e) => e.ownerMembershipId !== null).length;

  return {
    userId,
    deletedSpaceIds: [...deletableSpaceIds],
    deletedCommunityIds: [...hardDeletableCommunityIds],
    transferredCommunityIds,
    deletedEventCount,
    deletedTaskCount,
    cleanedTaskAssignmentCount,
    cleanedEventTaskAssignmentCount,
    resetExternalEntityCount,
    removedExternalAccessRowCount: externalAccessRows.length,
    removedCommunityMembershipCount,
    eventSharedUserRefsRemoved,
    eventSharedFamilyMemberRefsRemapped,
    taskMemberRefsRemapped,
    communityMemberProfileRefsRemapped,
    softDeletedTasksResolved,
    plannedWriteCount,
  };
}

export { ACCOUNT_DELETION_MAX_PLANNED_WRITES };
