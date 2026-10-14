import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation } from './_generated/server';
import {
  removeCommunityEventFromPersonalCalendar,
  saveCommunityEventToPersonalCalendar,
} from './communityEventCalendarHelpers';
import { isActiveCommunityMember } from './communityMemberUtils';
import { getAuthUserId } from './sessionAuth';

async function getCommunityMembership(
  ctx: MutationCtx,
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

async function getMyActiveAssignedEventTasks(
  ctx: MutationCtx,
  eventId: Id<'events'>,
  userId: Id<'users'>
) {
  const tasks = await ctx.db
    .query('eventTasks')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect();
  return tasks.filter(
    (task) => task.assignedToUserId === userId && task.completed !== true
  );
}

/**
 * Stage 1D: adds a community event back to the viewer's personal calendar —
 * clearing any per-event opt-out and ensuring an active save row exists.
 * This works for BOTH open and RSVP-required events (the RSVP-required case
 * was previously rejected here; it no longer is, since opt-outs are now
 * supported for RSVP-required events too — see removeCommunityEventFromPersonalCalendar).
 * The current UI does not yet expose an "add to calendar" button for
 * RSVP-required events, but the backend must support it so a future UI can
 * call this directly. Does NOT touch RSVP status.
 */
export const addCommunityEventToMyCalendar = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event?.communityId) throw new Error('אירוע לא נמצא');
    if (event.status === 'cancelled')
      throw new Error('לא ניתן להוסיף אירוע שבוטל');

    const membership = await getCommunityMembership(
      ctx,
      event.communityId,
      userId
    );
    if (!isActiveCommunityMember(membership)) {
      throw new Error('אין הרשאה');
    }

    await saveCommunityEventToPersonalCalendar(ctx, {
      userId,
      eventId,
      communityId: event.communityId,
    });
    return { success: true as const };
  },
});

export const removeCommunityEventFromMyCalendar = mutation({
  args: {
    eventId: v.id('events'),
    confirmRemoveWithActiveTask: v.optional(v.boolean()),
  },
  handler: async (ctx, { eventId, confirmRemoveWithActiveTask }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event?.communityId) throw new Error('אירוע לא נמצא');

    const membership = await getCommunityMembership(
      ctx,
      event.communityId,
      userId
    );
    if (!isActiveCommunityMember(membership)) {
      throw new Error('אין הרשאה');
    }

    const assignedTasks =
      event.status === 'cancelled'
        ? []
        : await getMyActiveAssignedEventTasks(ctx, eventId, userId);
    if (assignedTasks.length > 0 && confirmRemoveWithActiveTask !== true) {
      throw new ConvexError({
        code: 'CALENDAR_REMOVE_REQUIRES_ACTIVE_TASK_CONFIRMATION',
        message: 'נדרש אישור להסרת אירוע עם משימה פעילה',
      });
    }

    await removeCommunityEventFromPersonalCalendar(ctx, {
      userId,
      eventId,
    });
    return { success: true as const };
  },
});

export const removeEventFromCalendarAndUnclaim = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event?.communityId) throw new Error('אירוע לא נמצא');

    const membership = await getCommunityMembership(
      ctx,
      event.communityId,
      userId
    );
    if (!isActiveCommunityMember(membership)) {
      throw new Error('אין הרשאה');
    }

    const assignedTasks = await getMyActiveAssignedEventTasks(
      ctx,
      eventId,
      userId
    );
    for (const task of assignedTasks) {
      await ctx.db.patch(task._id, {
        assignedToUserId: undefined,
        assignedToManual: undefined,
      });
    }

    await removeCommunityEventFromPersonalCalendar(ctx, {
      userId,
      eventId,
    });

    return { success: true as const, unclaimedCount: assignedTasks.length };
  },
});
