import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { insertCommunityActivity } from './communityActivities';
import { saveCommunityEventToPersonalCalendar } from './communityEventCalendarHelpers';
import { isActiveCommunityMember } from './communityMemberUtils';
import { createUserNotifications } from './userNotifications';

// ─────────────────────────────────────────────────────────────
// Helper: manager check usable from both queries and mutations
// ─────────────────────────────────────────────────────────────
async function isEventTaskManager(
  ctx: QueryCtx | MutationCtx,
  event: { createdBy: Id<'users'>; communityId?: Id<'communities'> },
  userId: Id<'users'>
): Promise<boolean> {
  if (event.createdBy === userId) return true;
  if (!event.communityId) return false;
  const membership = await getCommunityMembership(
    ctx,
    event.communityId,
    userId
  );
  return (
    isActiveCommunityMember(membership) &&
    (membership.role === 'owner' || membership.role === 'admin')
  );
}

// ─────────────────────────────────────────────────────────────
// Shared pure counting logic — Stage 1C
//
// Extracted so it can be unit-tested without a Convex test harness (no
// ctx/db access) and so getTaskCountsByCommunity and getTaskCountsForEvents
// can never drift apart on what the X/Y counters mean. Semantics are
// unchanged from the pre-Stage-1C implementation.
// ─────────────────────────────────────────────────────────────
export type EventTaskCountSummary = {
  total: number;
  assigned: number;
  totalTasksCount: number;
  assignedTasksCount: number;
  myAssignedTasks: Array<{ id: Id<'eventTasks'>; title: string }>;
  hasMyAssignedTasks: boolean;
};

export function summarizeEventTaskCounts(
  eventStatus: string | undefined,
  tasks: Array<{
    _id: Id<'eventTasks'>;
    title: string;
    completed?: boolean;
    assignedToUserId?: Id<'users'>;
    assignedToManual?: string;
  }>,
  viewerUserId: Id<'users'>
): EventTaskCountSummary {
  const activeTasks =
    eventStatus === 'cancelled'
      ? []
      : tasks.filter((task) => task.completed !== true);
  const assignedTasksCount = activeTasks.filter(
    (t) => t.assignedToUserId || t.assignedToManual?.trim()
  ).length;
  const myAssignedTasks = activeTasks
    .filter((t) => t.assignedToUserId === viewerUserId)
    .map((t) => ({ id: t._id, title: t.title }));
  return {
    total: activeTasks.length,
    assigned: assignedTasksCount,
    totalTasksCount: activeTasks.length,
    assignedTasksCount,
    myAssignedTasks,
    hasMyAssignedTasks: myAssignedTasks.length > 0,
  };
}

// ─────────────────────────────────────────────────────────────
// סיכום משימות לפי קהילה (לתצוגת כרטיסי אירועים — ללא N+1)
//
// STAGE 1C NOTE: superseded by getTaskCountsForEvents below, which accepts
// only the event IDs a screen is actually rendering instead of scanning
// every event (and every event's tasks) in the whole community. No caller
// in the app uses this function anymore as of Stage 1C. It is kept
// in place rather than deleted — removing unused code is explicitly out of
// scope for Stage 1C (a dedicated cleanup stage should remove this).
// Do not add new callers of this function; use getTaskCountsForEvents.
// ─────────────────────────────────────────────────────────────
export const getTaskCountsByCommunity = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return {};

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) return {};

    const events = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) => q.eq('communityId', communityId))
      .collect();

    const counts: Record<string, EventTaskCountSummary> = {};

    await Promise.all(
      events.map(async (ev) => {
        const tasks = await ctx.db
          .query('eventTasks')
          .withIndex('by_event', (q) => q.eq('eventId', ev._id))
          .collect();
        counts[ev._id] = summarizeEventTaskCounts(ev.status, tasks, userId);
      })
    );

    return counts;
  },
});

const eventTaskCountSummaryValidator = v.object({
  total: v.number(),
  assigned: v.number(),
  totalTasksCount: v.number(),
  assignedTasksCount: v.number(),
  myAssignedTasks: v.array(
    v.object({ id: v.id('eventTasks'), title: v.string() })
  ),
  hasMyAssignedTasks: v.boolean(),
});

// ─────────────────────────────────────────────────────────────
// סיכום משימות לפי אירועים גלויים (Stage 1C)
//
// Focused replacement for getTaskCountsByCommunity: accepts exactly the
// event IDs the caller is currently rendering (e.g. a tab's ~8 loaded
// event cards, or a paginated list's accumulated pages) and only loads
// those events/tasks — never scans the rest of the community.
//
// Access control: each eventId is checked independently — the underlying
// event must exist, belong to a community, and the caller must be an
// active member of that community. Unknown, inaccessible, or non-community
// event IDs are silently omitted from the result (no error, no count),
// so this cannot be used to probe for the existence of events the caller
// isn't otherwise allowed to see.
//
// Count semantics (total/assigned/myAssignedTasks/hasMyAssignedTasks) are
// byte-for-byte identical to getTaskCountsByCommunity — see
// summarizeEventTaskCounts. This stage only bounds *which* events are
// scanned, not what the numbers mean.
// ─────────────────────────────────────────────────────────────
export const getTaskCountsForEvents = query({
  args: { eventIds: v.array(v.id('events')) },
  returns: v.record(v.id('events'), eventTaskCountSummaryValidator),
  handler: async (ctx, { eventIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || eventIds.length === 0) return {};

    // Dedupe defensively — callers may reference the same event from more
    // than one visible section (e.g. "my events" + "recently cancelled").
    const uniqueEventIds = [...new Set(eventIds)];
    const counts: Record<string, EventTaskCountSummary> = {};

    await Promise.all(
      uniqueEventIds.map(async (eventId) => {
        const event = await ctx.db.get(eventId);
        if (!event || !event.communityId) return;

        const membership = await getCommunityMembership(
          ctx,
          event.communityId,
          userId
        );
        if (!isActiveCommunityMember(membership)) return;

        const tasks = await ctx.db
          .query('eventTasks')
          .withIndex('by_event', (q) => q.eq('eventId', eventId))
          .collect();

        counts[eventId] = summarizeEventTaskCounts(event.status, tasks, userId);
      })
    );

    return counts;
  },
});

async function getCommunityMembership(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<'communities'>,
  userId: Id<'users'>
) {
  return await ctx.db
    .query('communityMembers')
    .withIndex('by_community_user', (q) =>
      q.eq('communityId', communityId).eq('userId', userId)
    )
    .unique();
}

async function getUserDisplayName(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
): Promise<string> {
  const user = await ctx.db.get(userId);
  return user?.fullName?.trim() || 'משתמש';
}

/**
 * Returns true when the user can manage (create/update/delete) tasks on an event.
 * Rules:
 *   - Personal event: only the creator.
 *   - Community event: creator OR active community owner/admin.
 */
async function canManageEventTasks(
  ctx: MutationCtx,
  event: { createdBy: Id<'users'>; communityId?: Id<'communities'> },
  userId: Id<'users'>
): Promise<boolean> {
  return isEventTaskManager(ctx, event, userId);
}

// ─────────────────────────────────────────────────────────────
// Batch query for Home: authorized tasks per community event
// ─────────────────────────────────────────────────────────────

const homeEventTaskShape = v.object({
  _id: v.id('eventTasks'),
  title: v.string(),
  completed: v.boolean(),
  completedAt: v.optional(v.number()),
  order: v.optional(v.number()),
  assignedToUserId: v.optional(v.id('users')),
  assignedToManual: v.optional(v.string()),
  assigneeDisplay: v.optional(v.string()),
  isAssignedToCurrentUser: v.boolean(),
});

export const listEventTasksForHome = query({
  args: { eventIds: v.array(v.id('events')) },
  returns: v.array(
    v.object({
      eventId: v.id('events'),
      canManageTasks: v.boolean(),
      tasksVisibleToParticipants: v.boolean(),
      tasks: v.array(homeEventTaskShape),
    })
  ),
  handler: async (ctx, { eventIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const results = await Promise.all(
      eventIds.map(async (eventId) => {
        const event = await ctx.db.get(eventId);
        if (!event || !event.communityId) return null;
        if (event.status === 'cancelled') return null;

        const membership = await getCommunityMembership(
          ctx,
          event.communityId,
          userId
        );
        if (!isActiveCommunityMember(membership)) return null;

        const canManage = await isEventTaskManager(ctx, event, userId);
        const tasksVisibleToParticipants =
          event.tasksVisibleToParticipants === true;

        const allTasks = await ctx.db
          .query('eventTasks')
          .withIndex('by_event', (q) => q.eq('eventId', eventId))
          .collect();

        // Server-side visibility contract
        const authorizedTasks =
          canManage || tasksVisibleToParticipants
            ? allTasks
            : allTasks.filter((t) => t.assignedToUserId === userId);

        if (authorizedTasks.length === 0) return null;

        // Enrich with assignee display
        const enriched = await Promise.all(
          authorizedTasks.map(async (t) => {
            let assigneeDisplay: string | undefined;
            if (t.assignedToUserId) {
              const user = await ctx.db.get(t.assignedToUserId);
              assigneeDisplay =
                (user as { fullName?: string } | null)?.fullName ?? undefined;
            } else if (t.assignedToManual?.trim()) {
              assigneeDisplay = t.assignedToManual.trim();
            }
            return {
              _id: t._id,
              title: t.title,
              completed: t.completed ?? false,
              completedAt: t.completedAt,
              order: t.order,
              assignedToUserId: t.assignedToUserId,
              assignedToManual: t.assignedToManual,
              assigneeDisplay,
              isAssignedToCurrentUser: t.assignedToUserId === userId,
            };
          })
        );

        // Sort: members with full visibility → mine first, then unassigned, then others.
        // Managers and members with only their own tasks → source order.
        const sorted =
          !canManage && tasksVisibleToParticipants
            ? enriched.sort((a, b) => {
                const rankA = a.isAssignedToCurrentUser
                  ? 0
                  : !a.assignedToUserId && !a.assignedToManual
                    ? 1
                    : 2;
                const rankB = b.isAssignedToCurrentUser
                  ? 0
                  : !b.assignedToUserId && !b.assignedToManual
                    ? 1
                    : 2;
                if (rankA !== rankB) return rankA - rankB;
                return (a.order ?? 0) - (b.order ?? 0);
              })
            : enriched.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        return {
          eventId,
          canManageTasks: canManage,
          tasksVisibleToParticipants,
          tasks: sorted,
        };
      })
    );

    return results.filter(
      (r): r is NonNullable<typeof r> => r !== null
    );
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימות אירוע (כולל assignee display)
// ─────────────────────────────────────────────────────────────
export const listByEvent = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const event = await ctx.db.get(eventId);
    if (!event) return [];

    let canManageTasks = false;

    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) return [];

      canManageTasks =
        event.createdBy === userId ||
        membership.role === 'owner' ||
        membership.role === 'admin';
    } else if (event.createdBy !== userId) {
      return [];
    } else {
      canManageTasks = true;
    }

    const tasks = await ctx.db
      .query('eventTasks')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();

    // When visibility is disabled and the user is not a manager, return only
    // tasks assigned to the current user (never hide a member's own tasks).
    const filteredTasks =
      !canManageTasks && event.tasksVisibleToParticipants !== true
        ? tasks.filter((t) => t.assignedToUserId === userId)
        : tasks;

    const enriched = await Promise.all(
      filteredTasks.map(async (t) => {
        let assigneeDisplay: string | undefined;
        if (t.assignedToUserId) {
          const user = await ctx.db.get(t.assignedToUserId);
          assigneeDisplay =
            (user as { fullName?: string } | null)?.fullName ?? undefined;
        } else if (t.assignedToManual?.trim()) {
          assigneeDisplay = t.assignedToManual.trim();
        }
        return { ...t, assigneeDisplay };
      })
    );

    return enriched.sort((a, b) => {
      const oa = a.order ?? 0;
      const ob = b.order ?? 0;
      if (oa !== ob) return oa - ob;
      return a._creationTime - b._creationTime;
    });
  },
});

// ─────────────────────────────────────────────────────────────
// יצירת משימת אירוע
// ─────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    eventId: v.id('events'),
    title: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, title, order }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (!(await canManageEventTasks(ctx, event, userId)))
      throw new Error('אין הרשאה להוסיף משימות');

    return await ctx.db.insert('eventTasks', {
      eventId,
      title: title.trim(),
      completed: false,
      order: order ?? 0,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// יצירת משימות במקבץ (לאחר יצירת אירוע)
// ─────────────────────────────────────────────────────────────
export const createBatch = mutation({
  args: {
    eventId: v.id('events'),
    tasks: v.array(v.object({ title: v.string() })),
  },
  handler: async (ctx, { eventId, tasks }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (!(await canManageEventTasks(ctx, event, userId)))
      throw new Error('אין הרשאה להוסיף משימות');

    const ids: string[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (!t.title?.trim()) continue;
      const id = await ctx.db.insert('eventTasks', {
        eventId,
        title: t.title.trim(),
        completed: false,
        order: i,
      });
      ids.push(id);
    }
    return ids;
  },
});

// ─────────────────────────────────────────────────────────────
// עדכון כותרת משימה
// ─────────────────────────────────────────────────────────────
export const update = mutation({
  args: {
    id: v.id('eventTasks'),
    title: v.string(),
  },
  handler: async (ctx, { id, title }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');

    const event = await ctx.db.get(task.eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (!(await canManageEventTasks(ctx, event, userId)))
      throw new Error('אין הרשאה לערוך משימות');

    await ctx.db.patch(id, { title: title.trim() });
  },
});

// ─────────────────────────────────────────────────────────────
// החלפת מצב השלמה (חבר קהילה בלבד)
// ─────────────────────────────────────────────────────────────
export const toggleCompleted = mutation({
  args: { id: v.id('eventTasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');
    const event = await ctx.db.get(task.eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.status === 'cancelled') throw new Error('האירוע בוטל');

    if (event.communityId) {
      const communityId = event.communityId;
      if (!communityId) throw new Error('אירוע זה אינו שייך לקהילה');
      const member = await ctx.db
        .query('communityMembers')
        .withIndex('by_community_user', (q) =>
          q.eq('communityId', communityId).eq('userId', userId)
        )
        .unique();
      if (!isActiveCommunityMember(member)) {
        throw new Error('רק חברי הקהילה יכולים לעדכן משימות');
      }

      // Authorization: manager OR task assigned to the authenticated user.
      // Visibility does NOT grant completion permission — viewing and completing are separate.
      const isMgr =
        event.createdBy === userId ||
        member.role === 'owner' ||
        member.role === 'admin';
      const isAssignedToMe = task.assignedToUserId === userId;

      if (!isMgr && !isAssignedToMe) {
        throw new Error('אין הרשאה לשנות מצב משימה זו');
      }
    }

    const nowCompleted = !task.completed;
    await ctx.db.patch(id, {
      completed: nowCompleted,
      completedAt: nowCompleted ? Date.now() : undefined,
    });

    if (event.communityId && nowCompleted) {
      await insertCommunityActivity(ctx, {
        communityId: event.communityId,
        actorUserId: userId,
        type: 'task_completed',
        entityType: 'task',
        entityId: id,
        title: `המשימה הושלמה: ${task.title}`,
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────
// Community Event assignment integrity — pure, unit-testable
//
// Community Event tasks must be account-backed: assignment is restricted to
// ACTIVE members of the SAME community. This function only validates WHO
// may be the *target assignee* — it does not decide who is allowed to
// perform the assignment (that authorization is unchanged, see
// canManageAssignments/isAssignedUser above).
//
// Extracted as a pure function (no ctx/db) so it can be unit-tested the
// same way summarizeEventTaskCounts is above — no Convex test harness
// required. Personal Events (no communityId) are always unrestricted here;
// their manual-assignment behavior is fully preserved.
//
// IMPORTANT: `assignee === null` (clearing an assignment, including a
// legacy manual one) is always allowed — this function must never block
// unassignment, so legacy Community manual assignments stay removable.
// ─────────────────────────────────────────────────────────────
export function assertCommunityTaskAssigneeAllowed(
  event: { communityId?: Id<'communities'> },
  assignee:
    | { type: 'user'; userId: Id<'users'> }
    | { type: 'manual'; name: string }
    | null,
  isTargetActiveMember: boolean
): void {
  if (!event.communityId) return; // Personal Event — unrestricted (manual allowed)
  if (assignee === null) return; // Clearing (incl. legacy manual) always allowed
  if (assignee.type === 'manual') {
    throw new Error('באירוע קהילה ניתן להקצות משימה רק לחברי הקהילה');
  }
  if (!isTargetActiveMember) {
    throw new Error('ניתן להקצות משימה רק לחברי קהילה פעילים');
  }
}

// ─────────────────────────────────────────────────────────────
// WHO may CLEAR (unassign) an event task — independent of
// assertCommunityTaskAssigneeAllowed above, which only governs WHO may be
// the target assignee. Extracted as a pure function (no ctx/db) purely so
// this authorization can be unit-tested directly — see
// tests/convex/eventTaskAssignmentDiff.test.ts — without a Convex test
// harness. `setAssignee` below calls this function verbatim; it is not a
// parallel reimplementation of the authorization.
// ─────────────────────────────────────────────────────────────
export function getTaskAssignmentClearAuthorization(params: {
  canManageAssignments: boolean;
  isAssignedUser: boolean;
  hasManual: boolean;
}): { allowed: true } | { allowed: false; reason: string } {
  if (!params.canManageAssignments && !params.isAssignedUser) {
    return {
      allowed: false,
      reason: 'רק הממונה או יוצר האירוע יכולים לבטל הקצאה',
    };
  }
  if (params.hasManual && !params.canManageAssignments) {
    return {
      allowed: false,
      reason: 'רק יוצר האירוע יכול לשנות הקצאה ידנית',
    };
  }
  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────
// הקצאת משימה או ביטול הקצאה
// assignee: { type: 'user', userId } | { type: 'manual', name } | null
// ─────────────────────────────────────────────────────────────
export const setAssignee = mutation({
  args: {
    id: v.id('eventTasks'),
    assignee: v.union(
      v.object({ type: v.literal('user'), userId: v.id('users') }),
      v.object({ type: v.literal('manual'), name: v.string() }),
      v.null()
    ),
  },
  handler: async (ctx, { id, assignee }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');
    const event = await ctx.db.get(task.eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.status === 'cancelled') throw new Error('האירוע בוטל');

    const hasUserId = !!task.assignedToUserId;
    const hasManual = !!task.assignedToManual?.trim();
    const isAssigned = hasUserId || hasManual;
    let canManageAssignments = event.createdBy === userId;
    const isAssignedUser = task.assignedToUserId === userId;

    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('רק חברי קהילה פעילים יכולים להקצות משימות');
      }
      canManageAssignments =
        canManageAssignments ||
        membership.role === 'owner' ||
        membership.role === 'admin';
    }

    // Community Event integrity check: validates WHO may be the target
    // assignee (must be an active member of this same community). This is
    // independent of — and does not replace — the existing WHO-may-assign
    // authorization above/below. Personal Events are unaffected.
    let isTargetActiveMember = false;
    if (event.communityId && assignee?.type === 'user') {
      const targetMembership = await getCommunityMembership(
        ctx,
        event.communityId,
        assignee.userId
      );
      isTargetActiveMember = isActiveCommunityMember(targetMembership);
    }
    assertCommunityTaskAssigneeAllowed(event, assignee, isTargetActiveMember);

    if (assignee === null) {
      const clearAuthz = getTaskAssignmentClearAuthorization({
        canManageAssignments,
        isAssignedUser,
        hasManual,
      });
      if (!clearAuthz.allowed) throw new Error(clearAuthz.reason);
      await ctx.db.patch(id, {
        assignedToUserId: undefined,
        assignedToManual: undefined,
        assignedByUserId: undefined,
        assignedAt: undefined,
      });
      return;
    }

    if (assignee.type === 'manual') {
      if (!canManageAssignments)
        throw new Error('רק מנהלי האירוע יכולים להקצות שם ידני');
      const manualName = assignee.name.trim();
      if (!manualName) {
        await ctx.db.patch(id, {
          assignedToUserId: undefined,
          assignedToManual: undefined,
          assignedByUserId: undefined,
          assignedAt: undefined,
        });
        return;
      }
      if (
        !task.assignedToUserId &&
        task.assignedToManual?.trim() === manualName
      )
        return;
      await ctx.db.patch(id, {
        assignedToUserId: undefined,
        assignedToManual: manualName,
        assignedByUserId: undefined,
        assignedAt: undefined,
      });
      return;
    }

    if (assignee.type === 'user') {
      if (!canManageAssignments && isAssigned)
        throw new Error('רק יוצר האירוע או הממונה הנוכחי יכולים לשנות הקצאה');
      if (!canManageAssignments && !isAssigned && assignee.userId !== userId)
        throw new Error('משימה לא מוקצית – ניתן להקצות רק את עצמך');
      if (task.assignedToUserId === assignee.userId && !hasManual) return;

      const existingAssignedUserId = task.assignedToUserId;

      const now = Date.now();
      await ctx.db.patch(id, {
        assignedToUserId: assignee.userId,
        assignedToManual: undefined,
        assignedByUserId: userId,
        assignedAt: now,
      });
      if (event.communityId) {
        await saveCommunityEventToPersonalCalendar(ctx, {
          userId: assignee.userId,
          eventId: event._id,
          communityId: event.communityId,
        });
        // For RSVP-required events (the default), auto-RSVP the assignee so the
        // event card appears in their personal Home/Calendar view — mirroring
        // the existing claimEventTask behaviour.
        if (event.requiresRsvp !== false) {
          const existingRsvp = await ctx.db
            .query('eventRsvps')
            .withIndex('by_event_user', (q) =>
              q.eq('eventId', event._id).eq('userId', assignee.userId)
            )
            .unique();
          if (existingRsvp?.status !== 'yes') {
            if (existingRsvp) {
              await ctx.db.patch(existingRsvp._id, {
                status: 'yes',
                updatedAt: Date.now(),
              });
            } else {
              await ctx.db.insert('eventRsvps', {
                eventId: event._id,
                userId: assignee.userId,
                status: 'yes',
                updatedAt: Date.now(),
              });
            }
          }
        }
      }

      if (
        assignee.userId !== userId &&
        existingAssignedUserId !== assignee.userId &&
        event.tasksVisibleToParticipants === true
      ) {
        const assignerName = await getUserDisplayName(ctx, userId);
        const taskAssignedTitle = 'משימה שויכה לך';
        const taskAssignedBody = `המשימה "${task.title}" שויכה לך על ידי ${assignerName}`;
        const taskAssignedScreen = `/(authenticated)/event/${event._id}`;

        await createUserNotifications(ctx, {
          recipientUserIds: [assignee.userId],
          pushType: 'community_task_assigned',
          title: taskAssignedTitle,
          body: taskAssignedBody,
          screen: taskAssignedScreen,
        });

        await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
          recipientUserIds: [assignee.userId],
          pushType: 'community_task_assigned',
          title: taskAssignedTitle,
          body: taskAssignedBody,
          data: { screen: taskAssignedScreen },
          channelId: 'communities',
        });
      }
    }
  },
});

export const updateEventTaskVisibility = mutation({
  args: {
    eventId: v.id('events'),
    tasksVisibleToParticipants: v.boolean(),
  },
  handler: async (ctx, { eventId, tasksVisibleToParticipants }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');

    if (!event.communityId) {
      if (event.createdBy !== userId)
        throw new Error('אין הרשאה לעדכן נראות משימות');
    } else {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      const canManage =
        event.createdBy === userId ||
        membership?.role === 'owner' ||
        membership?.role === 'admin';
      if (!isActiveCommunityMember(membership) || !canManage) {
        throw new Error('אין הרשאה לעדכן נראות משימות');
      }
    }

    await ctx.db.patch(eventId, { tasksVisibleToParticipants });
  },
});

export const claimEventTask = mutation({
  args: { id: v.id('eventTasks') },
  returns: v.object({
    taskId: v.id('eventTasks'),
    wasAddedToCalendar: v.boolean(),
    rsvpChanged: v.union(
      v.literal('set_to_yes'),
      v.literal('unchanged'),
      v.literal('not_applicable')
    ),
  }),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');
    const event = await ctx.db.get(task.eventId);
    if (!event || !event.communityId)
      throw new Error('פעולה זו זמינה רק באירוע קהילתי');
    if (event.status === 'cancelled') throw new Error('האירוע בוטל');
    if (event.startTime <= Date.now()) {
      throw new ConvexError({
        code: 'EVENT_IS_PAST',
        message: 'לא ניתן להשתבץ למשימה באירוע שעבר',
      });
    }

    const membership = await getCommunityMembership(
      ctx,
      event.communityId,
      userId
    );
    if (!isActiveCommunityMember(membership)) {
      throw new Error('רק חברי קהילה פעילים יכולים להשתבץ למשימה');
    }

    const canManage =
      event.createdBy === userId ||
      membership.role === 'owner' ||
      membership.role === 'admin';

    if (!canManage && event.tasksVisibleToParticipants !== true) {
      throw new Error('המשימות אינן גלויות למשתתפים');
    }

    const isAssigned =
      !!task.assignedToUserId || !!task.assignedToManual?.trim();
    if (isAssigned) throw new Error('המשימה כבר הוקצתה');

    const claimNow = Date.now();
    await ctx.db.patch(id, {
      assignedToUserId: userId,
      assignedToManual: undefined,
      assignedByUserId: userId,
      assignedAt: claimNow,
    });

    const { wasAddedToCalendar } = await saveCommunityEventToPersonalCalendar(
      ctx,
      {
        userId,
        eventId: event._id,
        communityId: event.communityId,
      }
    );

    let rsvpChanged: 'set_to_yes' | 'unchanged' | 'not_applicable' =
      'not_applicable';
    if (event.requiresRsvp === true) {
      const existingRsvp = await ctx.db
        .query('eventRsvps')
        .withIndex('by_event_user', (q) =>
          q.eq('eventId', event._id).eq('userId', userId)
        )
        .unique();
      if (existingRsvp?.status === 'yes') {
        rsvpChanged = 'unchanged';
      } else if (existingRsvp) {
        await ctx.db.patch(existingRsvp._id, {
          status: 'yes',
          updatedAt: Date.now(),
        });
        rsvpChanged = 'set_to_yes';
      } else {
        await ctx.db.insert('eventRsvps', {
          eventId: event._id,
          userId,
          status: 'yes',
          updatedAt: Date.now(),
        });
        rsvpChanged = 'set_to_yes';
      }
    }

    const memberName = await getUserDisplayName(ctx, userId);
    await insertCommunityActivity(ctx, {
      communityId: event.communityId,
      actorUserId: userId,
      type: 'task_assigned',
      entityType: 'task',
      entityId: id,
      title: `${memberName} לקח/ה על עצמו/ה: ${task.title}`,
    });

    return { taskId: id, wasAddedToCalendar, rsvpChanged };
  },
});

export const unclaimEventTask = mutation({
  args: { id: v.id('eventTasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');
    const event = await ctx.db.get(task.eventId);
    if (!event || !event.communityId)
      throw new Error('פעולה זו זמינה רק באירוע קהילתי');
    if (event.status === 'cancelled') throw new Error('האירוע בוטל');

    const membership = await getCommunityMembership(
      ctx,
      event.communityId,
      userId
    );
    if (!isActiveCommunityMember(membership)) {
      throw new Error('רק חברי קהילה פעילים יכולים להסיר הקצאה');
    }

    const canManage =
      event.createdBy === userId ||
      membership.role === 'owner' ||
      membership.role === 'admin';

    if (!task.assignedToUserId) throw new Error('המשימה אינה מוקצית למשתמש');
    if (!canManage && task.assignedToUserId !== userId) {
      throw new Error('ניתן להסיר רק הקצאה של עצמך');
    }
    if (task.completed === true) {
      throw new ConvexError({
        code: 'TASK_ALREADY_COMPLETED',
        message: 'לא ניתן לבטל הקצאה של משימה שכבר בוצעה',
      });
    }

    await ctx.db.patch(id, {
      assignedToUserId: undefined,
      assignedToManual: undefined,
      assignedByUserId: undefined,
      assignedAt: undefined,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// משימות מוקצות — לדף הבית (תאריך ספציפי)
// ─────────────────────────────────────────────────────────────
export const listMyAssignedEventTasksForDate = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const activeMembers = memberships.filter((m) => isActiveCommunityMember(m));

    const results = await Promise.all(
      activeMembers.map(async ({ communityId }) => {
        const community = await ctx.db.get(communityId);
        if (!community || community.archived) return [];

        const events = await ctx.db
          .query('events')
          .withIndex('by_community_date', (q) =>
            q
              .eq('communityId', communityId)
              .gte('startTime', from)
              .lte('startTime', to)
          )
          .collect();

        const activeEvents = events.filter((ev) => ev.status !== 'cancelled');

        const taskRows = await Promise.all(
          activeEvents.map(async (ev) => {
            const tasks = await ctx.db
              .query('eventTasks')
              .withIndex('by_event', (q) => q.eq('eventId', ev._id))
              .collect();

            return tasks
              .filter((t) => t.assignedToUserId === userId)
              .map((t) => ({
                _id: t._id,
                title: t.title,
                completed: t.completed ?? false,
                eventId: ev._id,
                eventTitle: ev.title,
                eventStartTime: ev.startTime,
                eventAllDay: ev.allDay ?? false,
                communityId,
                communityName: community.name,
              }));
          })
        );

        return taskRows.flat();
      })
    );

    return results.flat();
  },
});

export const listMyAssignedEventTasks = query({
  args: { from: v.number(), to: v.number() },
  returns: v.array(
    v.object({
      _id: v.id('eventTasks'),
      title: v.string(),
      completed: v.boolean(),
      eventId: v.id('events'),
      eventTitle: v.string(),
      eventStartTime: v.number(),
      eventEndTime: v.number(),
      eventAllDay: v.boolean(),
      communityId: v.id('communities'),
      communityName: v.string(),
    })
  ),
  handler: async (ctx, { from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const activeMembers = memberships.filter((m) => isActiveCommunityMember(m));

    const results = await Promise.all(
      activeMembers.map(async ({ communityId }) => {
        const community = await ctx.db.get(communityId);
        if (!community || community.archived) return [];

        const events = await ctx.db
          .query('events')
          .withIndex('by_community_date', (q) =>
            q
              .eq('communityId', communityId)
              .gte('startTime', from)
              .lte('startTime', to)
          )
          .collect();

        const activeEvents = events.filter((ev) => ev.status !== 'cancelled');

        const taskRows = await Promise.all(
          activeEvents.map(async (ev) => {
            const tasks = await ctx.db
              .query('eventTasks')
              .withIndex('by_event', (q) => q.eq('eventId', ev._id))
              .collect();

            return tasks
              .filter((t) => t.assignedToUserId === userId)
              .map((t) => ({
                _id: t._id,
                title: t.title,
                completed: t.completed ?? false,
                eventId: ev._id,
                eventTitle: ev.title,
                eventStartTime: ev.startTime,
                eventEndTime: ev.endTime,
                eventAllDay: ev.allDay ?? false,
                communityId,
                communityName: community.name,
              }));
          })
        );

        return taskRows.flat();
      })
    );

    return results.flat().sort((a, b) => a.eventStartTime - b.eventStartTime);
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת משימה
// ─────────────────────────────────────────────────────────────
export const remove = mutation({
  args: { id: v.id('eventTasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');

    const event = await ctx.db.get(task.eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (!(await canManageEventTasks(ctx, event, userId)))
      throw new Error('אין הרשאה למחוק משימות');

    await ctx.db.delete(id);
  },
});
