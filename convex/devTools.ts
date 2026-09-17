// ============================================================================
// devTools.ts — DEV/QA TOOL ONLY
// ============================================================================
//
// resetQaUser: a fail-closed, dev-only internalMutation that resets exactly
// ONE allowlisted QA phone/user so the same phone can go through onboarding
// again from a truly fresh server state, without ever touching another
// user's spaces, profile/contact data, or shared content.
//
// This file must NEVER export a public `mutation` or `query` — only
// `internalMutation`. It is not reachable from any client and can only be
// invoked from the Convex dashboard's "Run function" panel (with the
// internal function's full name) or from another backend function/script.
//
// SAFETY MODEL (fail-closed):
//   - Two independent env-var guards must BOTH pass before any lookup even
//     starts: QA_RESET_ENABLED === 'true' (dedicated dev/test-only opt-in —
//     deliberately NOT inferred from CONVEX_CLOUD_URL) and the requested
//     phone must appear in QA_RESET_ALLOWED_PHONES. Failing either THROWS —
//     there is no dry-run bypass for these two guards.
//   - Everything past that point is read-only investigation. Any ambiguity
//     (user not found / multiple users / auth account mismatch / a QA-owned
//     space shared with another real user / QA-authored content living
//     outside the QA-owned space) becomes a blocker string and
//     safeToExecute: false. No "best effort" partial cleanup is ever
//     attempted for an unexpected state.
//   - Live mutation ONLY happens when dryRun === false AND execute === true
//     AND safeToExecute === true. dryRun defaults to true.
//   - Deletion order: (1) reset external matched entity rows + familyContacts
//     mirrors on OTHER users — never deleted, only specific fields cleared;
//     (2) remove the QA user's own kind:'access' rows from spaces they don't
//     own; (3) cancel + delete the QA user's scheduledReminders; (4) delete
//     the QA-owned onboarding space and everything scoped to it; (5) delete
//     every other QA-user-scoped personal table; (6) delete auth dependents
//     (refresh tokens → verification codes → verifiers → sessions →
//     accounts → rate limit row); (7) delete the `users` row LAST.
//
// See lib/qaReset.ts for the pure, independently-unit-tested planning/safety
// helpers this handler calls into — this file only performs the actual
// ctx.db reads/writes and orchestrates them in the order above.
// ============================================================================

import { v } from 'convex/values';
import {
  checkAuthAccountOwnership,
  checkUsersLookup,
  computeSafeToExecute,
  evaluateOwnedSpacesSafety,
  externalEntityResetPlanIsNoop,
  findRowsOutsideOwnedSpaces,
  isPhoneAllowlisted,
  normalizeQaPhone,
  parseQaResetAllowlist,
  planExternalEntityReset,
  planFamilyContactsReset,
  resolveExecutionMode,
} from '../lib/qaReset';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation } from './_generated/server';
import { resolveKind } from './members';

const externalEntityRowReportValidator = v.object({
  memberId: v.id('members'),
  spaceId: v.id('spaces'),
  displayName: v.optional(v.string()),
  currentInviteStatus: v.optional(
    v.union(v.literal('none'), v.literal('invited'), v.literal('joined'))
  ),
  willClearMatchedUserId: v.boolean(),
  willClearUserId: v.boolean(),
  willResetInviteStatusToNone: v.boolean(),
  willRemoveAccessRow: v.boolean(),
});

const ownedSpaceReportValidator = v.object({
  spaceId: v.id('spaces'),
  spaceName: v.string(),
  otherAccessUserIds: v.array(v.id('users')),
  deletable: v.boolean(),
});

const resetQaUserReturns = v.object({
  normalizedPhone: v.string(),
  allowlisted: v.boolean(),
  environmentEnabled: v.boolean(),
  isDryRun: v.boolean(),
  qaUserId: v.union(v.id('users'), v.null()),
  authAccountsFound: v.number(),
  authSessionsFound: v.number(),
  authRefreshTokensFound: v.number(),
  authVerificationCodesFound: v.number(),
  authVerifiersFound: v.number(),
  authRateLimitFound: v.boolean(),
  ownedSpaces: v.array(ownedSpaceReportValidator),
  externalAccessRowSpaceIds: v.array(v.id('spaces')),
  externalMatchedEntityRows: v.array(externalEntityRowReportValidator),
  familyContactsOwnersAffected: v.array(v.id('users')),
  plannedCounts: v.record(v.string(), v.number()),
  actualDeletionCounts: v.record(v.string(), v.number()),
  actualResetCounts: v.record(v.string(), v.number()),
  blockers: v.array(v.string()),
  warnings: v.array(v.string()),
  safeToExecute: v.boolean(),
  executed: v.boolean(),
  completed: v.boolean(),
});

/** Minimal shape this handler needs from a familyContacts blob entry. */
interface FamilyContactBlobEntry {
  selectedPhoneNumber?: string;
  matchedUserId?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
  [key: string]: unknown;
}

export const resetQaUser = internalMutation({
  args: {
    phone: v.string(),
    dryRun: v.optional(v.boolean()),
    execute: v.optional(v.boolean()),
  },
  returns: resetQaUserReturns,
  handler: async (ctx, args) => {
    // ── 1. Hard guards — throw, never a soft blocker ───────────────────────
    const environmentEnabled = process.env.QA_RESET_ENABLED === 'true';
    if (!environmentEnabled) {
      throw new Error(
        '[resetQaUser] QA_RESET_ENABLED is not set to "true" in this Convex deployment. Refusing to run.'
      );
    }

    const normalizedPhone = normalizeQaPhone(args.phone);
    if (!normalizedPhone) {
      throw new Error(
        '[resetQaUser] Could not normalize the provided phone number to E.164.'
      );
    }

    const allowlist = parseQaResetAllowlist(
      process.env.QA_RESET_ALLOWED_PHONES
    );
    const allowlisted = isPhoneAllowlisted(normalizedPhone, allowlist);
    if (!allowlisted) {
      throw new Error(
        `[resetQaUser] Phone ${normalizedPhone} is not present in QA_RESET_ALLOWED_PHONES. Refusing to run.`
      );
    }

    const { isDryRun, canExecuteLive } = resolveExecutionMode(args);

    const blockers: string[] = [];
    const warnings: string[] = [];
    const plannedCounts: Record<string, number> = {};
    const actualDeletionCounts: Record<string, number> = {};
    const actualResetCounts: Record<string, number> = {};

    // ── 2. Resolve the exact QA user (fail closed on ambiguity) ────────────
    const matchingUsers = await ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', normalizedPhone))
      .collect();
    const userLookup = checkUsersLookup(matchingUsers.map((u) => u._id));
    if (userLookup.blocker) blockers.push(userLookup.blocker);
    const qaUserId = userLookup.qaUserId as Id<'users'> | null;

    if (!qaUserId) {
      return {
        normalizedPhone,
        allowlisted,
        environmentEnabled,
        isDryRun,
        qaUserId: null,
        authAccountsFound: 0,
        authSessionsFound: 0,
        authRefreshTokensFound: 0,
        authVerificationCodesFound: 0,
        authVerifiersFound: 0,
        authRateLimitFound: false,
        ownedSpaces: [],
        externalAccessRowSpaceIds: [],
        externalMatchedEntityRows: [],
        familyContactsOwnersAffected: [],
        plannedCounts,
        actualDeletionCounts,
        actualResetCounts,
        blockers,
        warnings,
        safeToExecute: false,
        executed: false,
        completed: false,
      };
    }

    // ── 3. Auth investigation ───────────────────────────────────────────────
    const authAccounts = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', qaUserId))
      .collect();

    const phoneAuthAccount = await ctx.db
      .query('authAccounts')
      .withIndex('providerAndAccountId', (q) =>
        q.eq('provider', 'phone').eq('providerAccountId', normalizedPhone)
      )
      .unique();
    const authAccountBlocker = checkAuthAccountOwnership(
      phoneAuthAccount?.userId ?? null,
      qaUserId
    );
    if (authAccountBlocker) blockers.push(authAccountBlocker);
    if (!phoneAuthAccount) {
      warnings.push(
        'No authAccounts row found for provider "phone" with this exact number — proceeding using the userId-scoped authAccounts set only.'
      );
    }

    const authSessions = await ctx.db
      .query('authSessions')
      .withIndex('userId', (q) => q.eq('userId', qaUserId))
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
    // so this table is expected to be empty in practice. A full scan here
    // mirrors the existing dev-tool convention in this codebase (e.g.
    // backfillKind/backfillEntityRows/dedupeEntityRows in convex/members.ts
    // do full `ctx.db.query('members').collect()` scans) and is scoped to a
    // single admin-triggered call, never a hot path.
    const allAuthVerifiers = await ctx.db.query('authVerifiers').collect();
    const authVerifiers = allAuthVerifiers.filter(
      (row) => row.sessionId !== undefined && sessionIds.has(row.sessionId)
    );

    const authRateLimitRow = await ctx.db
      .query('authRateLimits')
      .withIndex('identifier', (q) => q.eq('identifier', normalizedPhone))
      .unique();

    // ── 4. Owned space safety check ─────────────────────────────────────────
    const ownedSpaces = await ctx.db
      .query('spaces')
      .withIndex('by_owner', (q) => q.eq('ownerId', qaUserId))
      .collect();

    const ownedSpaceAccessInfos: {
      spaceId: Id<'spaces'>;
      spaceName: string;
      otherAccessUserIds: Id<'users'>[];
    }[] = [];
    for (const space of ownedSpaces) {
      const spaceMembers = await ctx.db
        .query('members')
        .withIndex('by_space', (q) => q.eq('spaceId', space._id))
        .collect();
      const otherAccessUserIds = spaceMembers
        .filter(
          (m) =>
            resolveKind(m) === 'access' &&
            m.userId !== undefined &&
            m.userId !== qaUserId
        )
        .map((m) => m.userId as Id<'users'>);
      ownedSpaceAccessInfos.push({
        spaceId: space._id,
        spaceName: space.name,
        otherAccessUserIds,
      });
    }

    const ownedSpaceSafety = evaluateOwnedSpacesSafety(
      ownedSpaceAccessInfos.map((s) => ({
        spaceId: s.spaceId,
        spaceName: s.spaceName,
        otherAccessUserIds: s.otherAccessUserIds,
      }))
    );
    blockers.push(...ownedSpaceSafety.blockers);
    const deletableSpaceIds = new Set(
      ownedSpaceSafety.deletableSpaceIds as Id<'spaces'>[]
    );
    const ownedSpaceIdSet = new Set(ownedSpaces.map((s) => s._id));

    const ownedSpacesReport = ownedSpaceAccessInfos.map((s) => ({
      spaceId: s.spaceId,
      spaceName: s.spaceName,
      otherAccessUserIds: s.otherAccessUserIds,
      deletable: deletableSpaceIds.has(s.spaceId),
    }));

    // ── 5. QA's own member rows: external kind:'access' rows to remove ─────
    const myMemberRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', qaUserId))
      .collect();
    const externalAccessRows = myMemberRows.filter(
      (m) => resolveKind(m) === 'access' && !ownedSpaceIdSet.has(m.spaceId)
    );
    const externalAccessSpaceIdSet = new Set(
      externalAccessRows.map((r) => r.spaceId)
    );

    // ── 6. External matched entity rows (via by_phone — same defense-in-depth
    //      pattern as getPendingPhoneMatches) ───────────────────────────────
    const candidateRows = await ctx.db
      .query('members')
      .withIndex('by_phone', (q) =>
        q.eq('selectedPhoneNumber', normalizedPhone)
      )
      .collect();
    const externalCandidates = candidateRows.filter(
      (row) =>
        resolveKind(row) === 'entity' &&
        !ownedSpaceIdSet.has(row.spaceId) &&
        (row.matchedUserId === qaUserId || row.userId === qaUserId)
    );

    const externalEntityPlans = externalCandidates.map((row) => {
      const hasAccessRowInSameSpace = externalAccessSpaceIdSet.has(row.spaceId);
      const plan = planExternalEntityReset(
        row,
        qaUserId,
        hasAccessRowInSameSpace
      );
      return { row, plan };
    });

    const externalMatchedEntityRowsReport = externalEntityPlans.map(
      ({ row, plan }) => ({
        memberId: row._id,
        spaceId: row.spaceId,
        displayName: row.displayName,
        currentInviteStatus: row.inviteStatus,
        willClearMatchedUserId: plan.clearMatchedUserId,
        willClearUserId: plan.clearUserId,
        willResetInviteStatusToNone: plan.resetInviteStatusToNone,
        willRemoveAccessRow: plan.removeAccessRow,
      })
    );

    const affectedFamilyContactsSpaceIds = new Set(
      externalCandidates.map((r) => r.spaceId)
    );
    const familyContactsOwnersAffected: Id<'users'>[] = [];
    for (const spaceId of affectedFamilyContactsSpaceIds) {
      const space = await ctx.db.get(spaceId);
      if (space?.ownerId) familyContactsOwnersAffected.push(space.ownerId);
    }

    // ── 7. Content-outside-owned-space safety net ──────────────────────────
    // Events/tasks/captures CREATED by the QA user outside their own owned
    // (deletable) space represent real content in a shared space/community
    // that this tool has no safe targeted cleanup rule for. Their presence
    // refuses the entire live reset rather than being silently skipped.
    const qaCreatedEvents = await ctx.db
      .query('events')
      .withIndex('by_creator', (q) => q.eq('createdBy', qaUserId))
      .collect();
    const eventsOutsideOwnedSpace = findRowsOutsideOwnedSpaces(
      qaCreatedEvents.map((e) => ({ id: e._id, spaceId: e.spaceId })),
      deletableSpaceIds
    );
    if (eventsOutsideOwnedSpace.length > 0) {
      blockers.push(
        `QA user created ${eventsOutsideOwnedSpace.length} event(s) outside their own owned space — refusing (would either damage shared content or leave orphaned references).`
      );
    }

    const qaCreatedTasks = await ctx.db
      .query('tasks')
      .withIndex('by_creator', (q) => q.eq('createdBy', qaUserId))
      .collect();
    const tasksOutsideOwnedSpace = findRowsOutsideOwnedSpaces(
      qaCreatedTasks.map((t) => ({ id: t._id, spaceId: t.spaceId })),
      deletableSpaceIds
    );
    if (tasksOutsideOwnedSpace.length > 0) {
      blockers.push(
        `QA user created ${tasksOutsideOwnedSpace.length} task(s) outside their own owned space — refusing (would either damage shared content or leave orphaned references).`
      );
    }

    const qaCaptures = await ctx.db
      .query('captures')
      .withIndex('by_user', (q) => q.eq('userId', qaUserId))
      .collect();
    const capturesOutsideOwnedSpace = findRowsOutsideOwnedSpaces(
      qaCaptures.map((c) => ({ id: c._id, spaceId: c.spaceId })),
      deletableSpaceIds
    );
    if (capturesOutsideOwnedSpace.length > 0) {
      blockers.push(
        `QA user has ${capturesOutsideOwnedSpace.length} capture(s) outside their own owned space — refusing.`
      );
    }

    // Informational-only checks (indexed, cheap) — never block, never touched.
    const assignedTasksElsewhere = (
      await ctx.db
        .query('tasks')
        .withIndex('by_assigned', (q) => q.eq('assignedTo', qaUserId))
        .collect()
    ).filter((t) => !deletableSpaceIds.has(t.spaceId as Id<'spaces'>));
    if (assignedTasksElsewhere.length > 0) {
      warnings.push(
        `QA user is assigned to ${assignedTasksElsewhere.length} task(s) in other spaces/communities (not created by QA) — left untouched; assignedTo will reference a deleted user.`
      );
    }

    const birthdaysAboutQaElsewhere = (
      await ctx.db
        .query('birthdays')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect()
    ).filter((b) => !deletableSpaceIds.has(b.spaceId));
    if (birthdaysAboutQaElsewhere.length > 0) {
      warnings.push(
        `${birthdaysAboutQaElsewhere.length} birthday record(s) in other users' spaces reference the QA user — left untouched (belongs to that space's owner).`
      );
    }

    const communityMemberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', qaUserId))
      .collect();
    if (communityMemberships.length > 0) {
      warnings.push(
        `QA user has ${communityMemberships.length} communityMembers row(s) — community membership cleanup is out of scope for this tool and is left untouched.`
      );
    }
    warnings.push(
      'communityActivities.actorUserId is never scanned or touched (no index on actorUserId) — historical activity log entries authored by the QA user, if any, are left with a dangling reference.'
    );

    // ── 8. QA-user-scoped personal tables (safe to fully delete) ───────────
    const qaScopedTables = {
      pushTokens: await ctx.db
        .query('pushTokens')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect(),
      googleImportStatus: await ctx.db
        .query('googleImportStatus')
        .withIndex('by_user_provider', (q) => q.eq('userId', qaUserId))
        .collect(),
      eventCopyRegistry: await ctx.db
        .query('eventCopyRegistry')
        .withIndex('by_owner_external_id', (q) => q.eq('createdBy', qaUserId))
        .collect(),
      savedCommunityEvents: await ctx.db
        .query('savedCommunityEvents')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect(),
      communityEventPersonalCalendarOptOuts: await ctx.db
        .query('communityEventPersonalCalendarOptOuts')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect(),
      personalEventCalendarOptOuts: await ctx.db
        .query('personalEventCalendarOptOuts')
        .withIndex('by_user_event', (q) => q.eq('userId', qaUserId))
        .collect(),
      userCalendarEntries: await ctx.db
        .query('userCalendarEntries')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect(),
      eventRsvps: await ctx.db
        .query('eventRsvps')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect(),
      taskParticipantSettings: await ctx.db
        .query('taskParticipantSettings')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect(),
      linkedEvents: await ctx.db
        .query('linkedEvents')
        .withIndex('by_recipient', (q) => q.eq('savedByUserId', qaUserId))
        .collect(),
      shareLinks: await ctx.db
        .query('shareLinks')
        .withIndex('by_creator', (q) => q.eq('createdBy', qaUserId))
        .collect(),
      userNotifications: await ctx.db
        .query('userNotifications')
        .withIndex('by_recipient_created', (q) =>
          q.eq('recipientUserId', qaUserId)
        )
        .collect(),
      notificationLog: await ctx.db
        .query('notificationLog')
        .withIndex('by_recipient', (q) => q.eq('recipientUserId', qaUserId))
        .collect(),
      dailyMoods: await ctx.db
        .query('dailyMoods')
        .withIndex('by_user_date', (q) => q.eq('userId', qaUserId))
        .collect(),
      subscriptions: await ctx.db
        .query('subscriptions')
        .withIndex('by_user', (q) => q.eq('userId', qaUserId))
        .collect(),
    } as const;

    // scheduledReminders has no by_user index — full scan, same documented
    // dev-tool convention as authVerifiers above.
    const allScheduledReminders = await ctx.db
      .query('scheduledReminders')
      .collect();
    const qaScheduledReminders = allScheduledReminders.filter(
      (r) => r.userId === qaUserId
    );

    // ── 9. Owned-space content (only for spaces that passed the safety check) ─
    const ownedSpaceEventsBySpace = new Map<Id<'spaces'>, Doc<'events'>[]>();
    const ownedSpaceTasksBySpace = new Map<Id<'spaces'>, Doc<'tasks'>[]>();
    const ownedSpaceBirthdaysBySpace = new Map<
      Id<'spaces'>,
      Doc<'birthdays'>[]
    >();
    const ownedSpaceCapturesBySpace = new Map<
      Id<'spaces'>,
      Doc<'captures'>[]
    >();
    const ownedSpaceMembersBySpace = new Map<Id<'spaces'>, Doc<'members'>[]>();
    const ownedSpaceEventTasksByEvent = new Map<
      Id<'events'>,
      Doc<'eventTasks'>[]
    >();

    let eventTaskCount = 0;
    let eventCount = 0;
    let taskCount = 0;
    let birthdayCount = 0;
    let captureCount = 0;
    let ownedSpaceMemberCount = 0;

    for (const spaceId of deletableSpaceIds) {
      const spaceEvents = await ctx.db
        .query('events')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect();
      ownedSpaceEventsBySpace.set(spaceId, spaceEvents);
      eventCount += spaceEvents.length;
      for (const event of spaceEvents) {
        const eTasks = await ctx.db
          .query('eventTasks')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect();
        ownedSpaceEventTasksByEvent.set(event._id, eTasks);
        eventTaskCount += eTasks.length;
      }

      const spaceTasks = await ctx.db
        .query('tasks')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect();
      ownedSpaceTasksBySpace.set(spaceId, spaceTasks);
      taskCount += spaceTasks.length;

      const spaceBirthdays = await ctx.db
        .query('birthdays')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect();
      ownedSpaceBirthdaysBySpace.set(spaceId, spaceBirthdays);
      birthdayCount += spaceBirthdays.length;

      const spaceCaptures = await ctx.db
        .query('captures')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect();
      ownedSpaceCapturesBySpace.set(spaceId, spaceCaptures);
      captureCount += spaceCaptures.length;

      const spaceMembers = await ctx.db
        .query('members')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect();
      ownedSpaceMembersBySpace.set(spaceId, spaceMembers);
      ownedSpaceMemberCount += spaceMembers.length;

      // Informational: flag entity rows in the QA-owned space that reference
      // ANOTHER real user's discovery/acceptance state — deleting the space
      // will remove that user's pending-match visibility for this space,
      // which is an expected consequence of deleting the space entirely
      // (there is nothing left to join into), not damage to that user's own
      // space/profile data.
      const entitiesMatchedToOthers = spaceMembers.filter(
        (m) =>
          resolveKind(m) === 'entity' &&
          m.matchedUserId !== undefined &&
          m.matchedUserId !== qaUserId
      );
      if (entitiesMatchedToOthers.length > 0) {
        warnings.push(
          `Owned space ${spaceId} contains ${entitiesMatchedToOthers.length} entity row(s) discovery-matched to other real users — deleting the space removes those users' pending match for this space (expected consequence of full space deletion, not data damage to their own space).`
        );
      }
    }

    // ── 10. Assemble planned counts (used for both dry-run + live report) ──
    plannedCounts.events = eventCount;
    plannedCounts.eventTasks = eventTaskCount;
    plannedCounts.tasks = taskCount;
    plannedCounts.birthdays = birthdayCount;
    plannedCounts.captures = captureCount;
    plannedCounts.membersInOwnedSpace = ownedSpaceMemberCount;
    plannedCounts.spaces = deletableSpaceIds.size;
    plannedCounts.membersExternalAccess = externalAccessRows.length;
    plannedCounts.externalEntityRowsReset = externalEntityPlans.filter(
      ({ plan }) => !externalEntityResetPlanIsNoop(plan)
    ).length;
    plannedCounts.familyContactsOwners = familyContactsOwnersAffected.length;
    plannedCounts.scheduledReminders = qaScheduledReminders.length;
    for (const [table, rows] of Object.entries(qaScopedTables)) {
      plannedCounts[table] = rows.length;
    }
    plannedCounts.authAccounts = authAccounts.length;
    plannedCounts.authSessions = authSessions.length;
    plannedCounts.authRefreshTokens = authRefreshTokens.length;
    plannedCounts.authVerificationCodes = authVerificationCodes.length;
    plannedCounts.authVerifiers = authVerifiers.length;
    plannedCounts.authRateLimit = authRateLimitRow ? 1 : 0;
    plannedCounts.usersRow = 1;

    const safeToExecute = computeSafeToExecute(blockers);

    // ── 11. Dry-run / not-executable exit — ZERO writes performed above ────
    if (!canExecuteLive || !safeToExecute) {
      return {
        normalizedPhone,
        allowlisted,
        environmentEnabled,
        isDryRun,
        qaUserId,
        authAccountsFound: authAccounts.length,
        authSessionsFound: authSessions.length,
        authRefreshTokensFound: authRefreshTokens.length,
        authVerificationCodesFound: authVerificationCodes.length,
        authVerifiersFound: authVerifiers.length,
        authRateLimitFound: authRateLimitRow !== null,
        ownedSpaces: ownedSpacesReport,
        externalAccessRowSpaceIds: [...externalAccessSpaceIdSet],
        externalMatchedEntityRows: externalMatchedEntityRowsReport,
        familyContactsOwnersAffected,
        plannedCounts,
        actualDeletionCounts,
        actualResetCounts,
        blockers,
        warnings,
        safeToExecute,
        executed: false,
        completed: false,
      };
    }

    // ══════════════════════════════════════════════════════════════════════
    // LIVE EXECUTION — every guard above passed. From here on this mutation
    // performs writes.
    // ══════════════════════════════════════════════════════════════════════

    // ── A. Reset external matched entity rows (never deleted) ──────────────
    let externalEntityResetCount = 0;
    for (const { row, plan } of externalEntityPlans) {
      if (externalEntityResetPlanIsNoop(plan)) continue;
      const patch: Record<string, unknown> = {};
      if (plan.clearMatchedUserId) patch.matchedUserId = undefined;
      if (plan.clearUserId) patch.userId = undefined;
      if (plan.resetInviteStatusToNone) patch.inviteStatus = 'none';
      await ctx.db.patch(row._id, patch);
      externalEntityResetCount += 1;
    }
    actualResetCounts.externalEntityRows = externalEntityResetCount;

    // ── B. Patch familyContacts mirrors on external space owners ───────────
    let familyContactsPatchedCount = 0;
    for (const ownerId of new Set(familyContactsOwnersAffected)) {
      const owner = await ctx.db.get(ownerId);
      if (!owner || !Array.isArray(owner.familyContacts)) continue;
      const { updated, changed } = planFamilyContactsReset(
        owner.familyContacts as FamilyContactBlobEntry[],
        normalizedPhone,
        qaUserId,
        normalizeQaPhone
      );
      if (changed) {
        await ctx.db.patch(owner._id, { familyContacts: updated });
        familyContactsPatchedCount += 1;
      }
    }
    actualResetCounts.familyContactsOwners = familyContactsPatchedCount;

    // ── C. Remove QA's kind:'access' rows from spaces they don't own ───────
    for (const row of externalAccessRows) {
      await ctx.db.delete(row._id);
    }
    actualDeletionCounts.membersExternalAccess = externalAccessRows.length;

    // ── D. Cancel scheduled functions, then delete scheduledReminders rows ──
    for (const reminder of qaScheduledReminders) {
      if (reminder.status === 'pending') {
        await ctx.scheduler.cancel(reminder.scheduledFunctionId);
      }
      await ctx.db.delete(reminder._id);
    }
    actualDeletionCounts.scheduledReminders = qaScheduledReminders.length;

    // ── E. Delete the QA-owned space(s) and everything scoped to them ──────
    for (const spaceId of deletableSpaceIds) {
      const spaceEvents = ownedSpaceEventsBySpace.get(spaceId) ?? [];
      for (const event of spaceEvents) {
        const eTasks = ownedSpaceEventTasksByEvent.get(event._id) ?? [];
        for (const et of eTasks) {
          await ctx.db.delete(et._id);
        }
        await ctx.db.delete(event._id);
      }

      const spaceTasks = ownedSpaceTasksBySpace.get(spaceId) ?? [];
      for (const task of spaceTasks) {
        await ctx.db.delete(task._id);
      }

      const spaceBirthdays = ownedSpaceBirthdaysBySpace.get(spaceId) ?? [];
      for (const b of spaceBirthdays) {
        await ctx.db.delete(b._id);
      }

      const spaceCaptures = ownedSpaceCapturesBySpace.get(spaceId) ?? [];
      for (const c of spaceCaptures) {
        await ctx.db.delete(c._id);
      }

      const spaceMembers = ownedSpaceMembersBySpace.get(spaceId) ?? [];
      for (const m of spaceMembers) {
        await ctx.db.delete(m._id);
      }

      await ctx.db.delete(spaceId);
    }
    actualDeletionCounts.events = eventCount;
    actualDeletionCounts.eventTasks = eventTaskCount;
    actualDeletionCounts.tasks = taskCount;
    actualDeletionCounts.birthdays = birthdayCount;
    actualDeletionCounts.captures = captureCount;
    actualDeletionCounts.membersInOwnedSpace = ownedSpaceMemberCount;
    actualDeletionCounts.spaces = deletableSpaceIds.size;

    // ── F. Delete every other QA-user-scoped personal table ────────────────
    for (const [table, rows] of Object.entries(qaScopedTables)) {
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      actualDeletionCounts[table] = rows.length;
    }

    // ── G. Auth cleanup (dependents before parents) ─────────────────────────
    for (const token of authRefreshTokens) {
      await ctx.db.delete(token._id);
    }
    actualDeletionCounts.authRefreshTokens = authRefreshTokens.length;

    for (const code of authVerificationCodes) {
      await ctx.db.delete(code._id);
    }
    actualDeletionCounts.authVerificationCodes = authVerificationCodes.length;

    for (const verifier of authVerifiers) {
      await ctx.db.delete(verifier._id);
    }
    actualDeletionCounts.authVerifiers = authVerifiers.length;

    for (const session of authSessions) {
      await ctx.db.delete(session._id);
    }
    actualDeletionCounts.authSessions = authSessions.length;

    for (const account of authAccounts) {
      await ctx.db.delete(account._id);
    }
    actualDeletionCounts.authAccounts = authAccounts.length;

    if (authRateLimitRow) {
      await ctx.db.delete(authRateLimitRow._id);
      actualDeletionCounts.authRateLimit = 1;
    } else {
      actualDeletionCounts.authRateLimit = 0;
    }

    // ── H. Delete the users row LAST ────────────────────────────────────────
    await ctx.db.delete(qaUserId);
    actualDeletionCounts.usersRow = 1;

    return {
      normalizedPhone,
      allowlisted,
      environmentEnabled,
      isDryRun,
      qaUserId,
      authAccountsFound: authAccounts.length,
      authSessionsFound: authSessions.length,
      authRefreshTokensFound: authRefreshTokens.length,
      authVerificationCodesFound: authVerificationCodes.length,
      authVerifiersFound: authVerifiers.length,
      authRateLimitFound: authRateLimitRow !== null,
      ownedSpaces: ownedSpacesReport,
      externalAccessRowSpaceIds: [...externalAccessSpaceIdSet],
      externalMatchedEntityRows: externalMatchedEntityRowsReport,
      familyContactsOwnersAffected,
      plannedCounts,
      actualDeletionCounts,
      actualResetCounts,
      blockers,
      warnings,
      safeToExecute,
      executed: true,
      completed: true,
    };
  },
});
