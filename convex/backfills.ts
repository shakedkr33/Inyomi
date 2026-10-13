// ============================================================================
// backfills.ts — Family Membership Lifecycle Phase 0
// ============================================================================
//
// Pre-launch ownerScope backfill infrastructure. Two separate functions,
// deliberately never combined into one:
//
//   1. backfillOwnerScope (internalMutation) — DETERMINISTIC ONLY. Stamps
//      ownerScope on existing events/tasks/captures rows ONLY when
//      convex/ownerScope.ts's classify*ForBackfill helpers return a
//      definite answer. Rows it cannot classify are left untouched
//      (ownerScope stays undefined) — never guessed, never destructive.
//
//   2. reportAmbiguousOwnerScope (internalQuery) — READ-ONLY. Returns the
//      full list of rows that backfillOwnerScope could not classify, so
//      the product owner can review and resolve them manually before any
//      further migration relies on ownerScope being fully populated.
//
// Neither function is called from application code. Run from the Convex
// dashboard → Functions, or via `npx convex run backfills:reportAmbiguousOwnerScope`
// / `npx convex run backfills:backfillOwnerScope` for local/dev verification.
// Both are idempotent and safe to run multiple times.

import { v } from 'convex/values';
import {
  APPROVED_LEGACY_EVENT_IDS,
  buildLegacyEventMigrationPlan,
  buildOwnerScopePatch,
  evaluateLegacyEventForMigration,
} from '../lib/legacyEventOwnerScopeMigration';
import {
  checkUsersLookup,
  isPhoneAllowlisted,
  normalizeQaPhone,
  parseQaResetAllowlist,
  resolveExecutionMode,
} from '../lib/qaReset';
import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import {
  classifyCaptureForBackfill,
  classifyEventForBackfill,
  classifyTaskForBackfill,
} from './ownerScope';

export const backfillOwnerScope = internalMutation({
  args: {},
  returns: v.object({
    events: v.object({
      scanned: v.number(),
      alreadyStamped: v.number(),
      stamped: v.number(),
      ambiguous: v.number(),
    }),
    tasks: v.object({
      scanned: v.number(),
      alreadyStamped: v.number(),
      stamped: v.number(),
      ambiguous: v.number(),
    }),
    captures: v.object({
      scanned: v.number(),
      alreadyStamped: v.number(),
      stamped: v.number(),
      ambiguous: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const events = { scanned: 0, alreadyStamped: 0, stamped: 0, ambiguous: 0 };
    const tasks = { scanned: 0, alreadyStamped: 0, stamped: 0, ambiguous: 0 };
    const captures = {
      scanned: 0,
      alreadyStamped: 0,
      stamped: 0,
      ambiguous: 0,
    };

    const allEvents = await ctx.db.query('events').collect();
    for (const event of allEvents) {
      events.scanned++;
      if (event.ownerScope !== undefined) {
        events.alreadyStamped++;
        continue;
      }
      const classification = classifyEventForBackfill({
        communityId: event.communityId,
        source: event.source,
        allFamily: event.allFamily,
        sharedWithFamilyMemberIds: event.sharedWithFamilyMemberIds,
        sharedWithUserIds: event.sharedWithUserIds,
        createdBy: event.createdBy,
      });
      if (classification === 'ambiguous') {
        events.ambiguous++;
        continue;
      }
      await ctx.db.patch(event._id, { ownerScope: classification });
      events.stamped++;
    }

    const allTasks = await ctx.db.query('tasks').collect();
    for (const task of allTasks) {
      tasks.scanned++;
      if (task.ownerScope !== undefined) {
        tasks.alreadyStamped++;
        continue;
      }
      const classification = classifyTaskForBackfill({
        communityId: task.communityId,
        sourceType: task.sourceType,
        createdBy: task.createdBy,
        assignedTo: task.assignedTo,
        assignedToUserIds: task.assignedToUserIds,
        assignedToMemberIds: task.assignedToMemberIds,
      });
      if (classification === 'ambiguous') {
        tasks.ambiguous++;
        continue;
      }
      await ctx.db.patch(task._id, { ownerScope: classification });
      tasks.stamped++;
    }

    const allCaptures = await ctx.db.query('captures').collect();
    for (const capture of allCaptures) {
      captures.scanned++;
      if (capture.ownerScope !== undefined) {
        captures.alreadyStamped++;
        continue;
      }
      const classification = classifyCaptureForBackfill();
      await ctx.db.patch(capture._id, { ownerScope: classification });
      captures.stamped++;
    }

    return { events, tasks, captures };
  },
});

export const reportAmbiguousOwnerScope = internalQuery({
  args: {},
  returns: v.object({
    events: v.array(
      v.object({
        _id: v.id('events'),
        title: v.string(),
        spaceId: v.optional(v.id('spaces')),
        createdBy: v.id('users'),
        createdAt: v.number(),
      })
    ),
    tasks: v.array(
      v.object({
        _id: v.id('tasks'),
        title: v.string(),
        spaceId: v.optional(v.id('spaces')),
        createdBy: v.id('users'),
        createdAt: v.number(),
      })
    ),
    totalAmbiguous: v.number(),
  }),
  handler: async (ctx) => {
    const allEvents = await ctx.db.query('events').collect();
    const ambiguousEvents = allEvents.filter(
      (event) =>
        event.ownerScope === undefined &&
        classifyEventForBackfill({
          communityId: event.communityId,
          source: event.source,
          allFamily: event.allFamily,
          sharedWithFamilyMemberIds: event.sharedWithFamilyMemberIds,
          sharedWithUserIds: event.sharedWithUserIds,
          createdBy: event.createdBy,
        }) === 'ambiguous'
    );

    const allTasks = await ctx.db.query('tasks').collect();
    const ambiguousTasks = allTasks.filter(
      (task) =>
        task.ownerScope === undefined &&
        classifyTaskForBackfill({
          communityId: task.communityId,
          sourceType: task.sourceType,
          createdBy: task.createdBy,
          assignedTo: task.assignedTo,
          assignedToUserIds: task.assignedToUserIds,
          assignedToMemberIds: task.assignedToMemberIds,
        }) === 'ambiguous'
    );

    return {
      events: ambiguousEvents.map((event) => ({
        _id: event._id,
        title: event.title,
        spaceId: event.spaceId,
        createdBy: event.createdBy,
        createdAt: event.createdAt,
      })),
      tasks: ambiguousTasks.map((task) => ({
        _id: task._id,
        title: task.title,
        spaceId: task.spaceId,
        createdBy: task.createdBy,
        createdAt: task.createdAt,
      })),
      totalAmbiguous: ambiguousEvents.length + ambiguousTasks.length,
    };
  },
});

// ============================================================================
// migrateApprovedLegacyEventOwnerScope — ONE-TIME, INTERNAL, GUARDED
// ============================================================================
//
// This is NOT a loosening of `classifyEventForBackfill`. That classifier
// remains deliberately fail-closed for the general pre-sharing-fields-era
// legacy event population — see convex/ownerScope.ts. This function is the
// smallest possible targeted data correction for EXACTLY the 10 hardcoded,
// manually product-owner-reviewed event ids in
// `lib/legacyEventOwnerScopeMigration.ts`'s `APPROVED_LEGACY_EVENT_IDS`. It
// must never be extended to any other id, and it never touches any field
// other than `ownerScope`.
//
// SAFETY MODEL (mirrors convex/devTools.ts `resetQaUser` exactly):
//   - QA_RESET_ENABLED must be 'true' and the requested phone must appear
//     in QA_RESET_ALLOWED_PHONES — both hard guards THROW, no bypass. The
//     phone resolves the expected reviewed user (never a client-supplied
//     Convex Id) via the same `users.by_phone` + `checkUsersLookup` helpers
//     used by resetQaUser/previewAccountDeletion.
//   - dryRun defaults to true. Live execution requires BOTH an explicit
//     dryRun: false AND execute: true (see lib/qaReset.ts
//     resolveExecutionMode) — flipping only one flag never mutates
//     anything.
//   - EVERY one of the 10 target events is independently re-validated
//     against the reviewed legacy shape on every call — never trusted
//     because "it was reviewed once" (see
//     evaluateLegacyEventForMigration's fail-closed precondition checks).
//   - If ANY of the 10 fails a precondition, the entire batch is refused
//     (`safeToExecute: false`) and ZERO writes are performed — no partial
//     stamping of the remaining records is ever possible.
//   - An event already `ownerScope: 'personal'` is a safe, idempotent
//     no-op (already corrected) — re-running this after a successful
//     execution is always safe. An event that has since become `'family'`
//     or `'community'` is always refused, never overwritten.
// ============================================================================

const legacyEventMigrationItemValidator = v.object({
  eventId: v.string(),
  title: v.string(),
  spaceId: v.optional(v.string()),
  currentOwnerScope: v.optional(
    v.union(v.literal('personal'), v.literal('family'), v.literal('community'))
  ),
  expectedNewOwnerScope: v.literal('personal'),
  eligible: v.boolean(),
  alreadyCorrected: v.boolean(),
  reason: v.optional(v.string()),
});

const migrateApprovedLegacyEventOwnerScopeReturns = v.object({
  normalizedPhone: v.string(),
  allowlisted: v.boolean(),
  environmentEnabled: v.boolean(),
  isDryRun: v.boolean(),
  expectedCreatedBy: v.union(v.id('users'), v.null()),
  safeToExecute: v.boolean(),
  executed: v.boolean(),
  targetCount: v.number(),
  eligibleCount: v.number(),
  blockedCount: v.number(),
  blockers: v.array(v.string()),
  items: v.array(legacyEventMigrationItemValidator),
  patchedCount: v.number(),
});

export const migrateApprovedLegacyEventOwnerScope = internalMutation({
  args: {
    phone: v.string(),
    dryRun: v.optional(v.boolean()),
    execute: v.optional(v.boolean()),
  },
  returns: migrateApprovedLegacyEventOwnerScopeReturns,
  handler: async (ctx, args) => {
    // ── 1. Hard guards — throw, never a soft blocker ───────────────────────
    const environmentEnabled = process.env.QA_RESET_ENABLED === 'true';
    if (!environmentEnabled) {
      throw new Error(
        '[migrateApprovedLegacyEventOwnerScope] QA_RESET_ENABLED is not set to "true" in this Convex deployment. Refusing to run.'
      );
    }

    const normalizedPhone = normalizeQaPhone(args.phone);
    if (!normalizedPhone) {
      throw new Error(
        '[migrateApprovedLegacyEventOwnerScope] Could not normalize the provided phone number to E.164.'
      );
    }

    const allowlist = parseQaResetAllowlist(
      process.env.QA_RESET_ALLOWED_PHONES
    );
    const allowlisted = isPhoneAllowlisted(normalizedPhone, allowlist);
    if (!allowlisted) {
      throw new Error(
        `[migrateApprovedLegacyEventOwnerScope] Phone ${normalizedPhone} is not present in QA_RESET_ALLOWED_PHONES. Refusing to run.`
      );
    }

    const { isDryRun, canExecuteLive } = resolveExecutionMode(args);

    // ── 2. Resolve the exact expected reviewed user (fail closed) ──────────
    const matchingUsers = await ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', normalizedPhone))
      .collect();
    const userLookup = checkUsersLookup(matchingUsers.map((u) => u._id));
    const expectedCreatedBy = userLookup.qaUserId as Id<'users'> | null;

    // ── 3. Re-validate each of the 10 hardcoded target events fresh ────────
    const items = [];
    for (const targetId of APPROVED_LEGACY_EVENT_IDS) {
      const event = await ctx.db.get(targetId as Id<'events'>);
      items.push(
        evaluateLegacyEventForMigration(
          event
            ? {
                _id: event._id,
                title: event.title,
                spaceId: event.spaceId,
                createdBy: event.createdBy,
                communityId: event.communityId,
                source: event.source,
                allFamily: event.allFamily,
                sharedWithFamilyMemberIds: event.sharedWithFamilyMemberIds,
                sharedWithUserIds: event.sharedWithUserIds,
                ownerScope: event.ownerScope,
              }
            : null,
          targetId,
          expectedCreatedBy ?? ''
        )
      );
    }

    const plan = buildLegacyEventMigrationPlan(items);
    const blockers = [...plan.blockers];
    if (!expectedCreatedBy) {
      blockers.unshift(
        userLookup.blocker ??
          'Could not resolve the expected reviewed user for this phone.'
      );
    }
    const safeToExecute = expectedCreatedBy ? plan.safeToExecute : false;

    // ── 4. Dry-run / not-executable exit — ZERO writes performed above ─────
    if (!canExecuteLive || !safeToExecute) {
      return {
        normalizedPhone,
        allowlisted,
        environmentEnabled,
        isDryRun,
        expectedCreatedBy,
        safeToExecute,
        executed: false,
        targetCount: plan.targetCount,
        eligibleCount: plan.eligibleCount,
        blockedCount: plan.blockedCount,
        blockers,
        items: [...plan.items],
        patchedCount: 0,
      };
    }

    // ══════════════════════════════════════════════════════════════════════
    // LIVE EXECUTION — every guard above passed for all 10 targets. Patch
    // ONLY `ownerScope`, and ONLY for items that actually need it.
    // ══════════════════════════════════════════════════════════════════════
    let patchedCount = 0;
    for (const item of plan.items) {
      const patch = buildOwnerScopePatch(item);
      if (!patch) continue;
      await ctx.db.patch(item.eventId as Id<'events'>, patch);
      patchedCount++;
    }

    return {
      normalizedPhone,
      allowlisted,
      environmentEnabled,
      isDryRun,
      expectedCreatedBy,
      safeToExecute,
      executed: true,
      targetCount: plan.targetCount,
      eligibleCount: plan.eligibleCount,
      blockedCount: plan.blockedCount,
      blockers,
      items: [...plan.items],
      patchedCount,
    };
  },
});
