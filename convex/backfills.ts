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
