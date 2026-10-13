import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { isActiveCommunityMember } from './communityMemberUtils';
import { canReadPersonalEvent } from './eventAccess';

function assertEventAcceptsRsvp(
  event: Pick<Doc<'events'>, 'status' | 'deletedAt'>
): void {
  if (event.status === 'cancelled') throw new Error('האירוע בוטל');
  if (event.deletedAt !== undefined) throw new Error('האירוע נמחק');
}

async function getCommunityMembership(
  ctx: MutationCtx | QueryCtx,
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

// ─────────────────────────────────────────────────────────────
// יצירה/עדכון RSVP לאירוע (upsert)
// ─────────────────────────────────────────────────────────────
export const upsertRsvp = mutation({
  args: {
    eventId: v.id('events'),
    status: v.union(
      v.literal('yes'),
      v.literal('no'),
      v.literal('maybe'),
      v.literal('none')
    ),
  },
  handler: async (ctx, { eventId, status }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');

    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('אין הרשאה לעדכן אישור הגעה');
      }
    } else {
      // Match RSVP reads: explicit invitation, not allFamily or a phone match.
      if (
        !(await canReadPersonalEvent(
          ctx,
          { ...event, allFamily: false },
          userId
        ))
      ) {
        throw new Error('אין הרשאה לעדכן אישור הגעה');
      }
    }

    assertEventAcceptsRsvp(event);

    if (status === 'no') {
      const assignedTasks = await ctx.db
        .query('eventTasks')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect();
      const hasAssignedTask = assignedTasks.some(
        (task) => task.assignedToUserId === userId
      );
      if (hasAssignedTask) {
        throw new ConvexError({
          code: 'RSVP_NO_BLOCKED_BY_ACTIVE_TASK',
          message: 'לא ניתן לסמן אי הגעה בזמן שיש לך משימה באירוע',
        });
      }
    }

    const existing = await ctx.db
      .query('eventRsvps')
      .withIndex('by_event_user', (q) =>
        q.eq('eventId', eventId).eq('userId', userId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { status, updatedAt: Date.now() });
    } else {
      await ctx.db.insert('eventRsvps', {
        eventId,
        userId,
        status,
        updatedAt: Date.now(),
      });
    }
  },
});

export const setRsvpNoAndUnclaimMyEventTasks = mutation({
  args: { eventId: v.id('events') },
  returns: v.object({
    unclaimedTasks: v.number(),
    rsvpStatus: v.literal('no'),
  }),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');

    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('אין הרשאה לעדכן אישור הגעה');
      }
    } else {
      // Match RSVP reads: explicit invitation, not allFamily or a phone match.
      if (
        !(await canReadPersonalEvent(
          ctx,
          { ...event, allFamily: false },
          userId
        ))
      ) {
        throw new Error('אין הרשאה לעדכן אישור הגעה');
      }
    }

    assertEventAcceptsRsvp(event);

    const eventTasks = await ctx.db
      .query('eventTasks')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const myAssignedTasks = eventTasks.filter(
      (task) => task.assignedToUserId === userId
    );

    for (const task of myAssignedTasks) {
      await ctx.db.patch(task._id, {
        assignedToUserId: undefined,
        assignedToManual: undefined,
      });
    }

    const existing = await ctx.db
      .query('eventRsvps')
      .withIndex('by_event_user', (q) =>
        q.eq('eventId', eventId).eq('userId', userId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { status: 'no', updatedAt: Date.now() });
    } else {
      await ctx.db.insert('eventRsvps', {
        eventId,
        userId,
        status: 'no',
        updatedAt: Date.now(),
      });
    }

    return {
      unclaimedTasks: myAssignedTasks.length,
      rsvpStatus: 'no' as const,
    };
  },
});

export const hasMyAssignedEventTasksForEvent = query({
  args: { eventId: v.id('events') },
  returns: v.object({
    hasAssignedTasks: v.boolean(),
    count: v.number(),
  }),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { hasAssignedTasks: false, count: 0 };

    const event = await ctx.db.get(eventId);
    if (!event) return { hasAssignedTasks: false, count: 0 };
    if (event.status === 'cancelled') {
      return { hasAssignedTasks: false, count: 0 };
    }

    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        return { hasAssignedTasks: false, count: 0 };
      }
    } else if (event.createdBy !== userId) {
      return { hasAssignedTasks: false, count: 0 };
    }

    const eventTasks = await ctx.db
      .query('eventTasks')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const count = eventTasks.filter(
      (task) => task.assignedToUserId === userId && task.completed !== true
    ).length;

    return { hasAssignedTasks: count > 0, count };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת כל ה-RSVPs של המשתמש הנוכחי (לכל האירועים)
// ─────────────────────────────────────────────────────────────
export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת RSVP של משתמש ספציפי לאירוע
// ─────────────────────────────────────────────────────────────
export const getRsvpForUser = query({
  args: {
    eventId: v.id('events'),
    userId: v.id('users'),
  },
  handler: async (ctx, { eventId, userId }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return null;
    const event = await ctx.db.get(eventId);
    if (!event) return null;

    // Match listByEvent: active community members see event RSVPs;
    // personal-event creators see all, while invitees see only their own.
    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        viewerId
      );
      if (!isActiveCommunityMember(membership)) return null;
    } else if (event.createdBy !== viewerId) {
      if (userId !== viewerId) return null;
      // RSVP readers must be explicit invitees; allFamily alone is not an
      // RSVP invitation. A pending phone match is not a sharing identity.
      if (
        !(await canReadPersonalEvent(
          ctx,
          { ...event, allFamily: false },
          viewerId
        ))
      )
        return null;
    }
    return await ctx.db
      .query('eventRsvps')
      .withIndex('by_event_user', (q) =>
        q.eq('eventId', eventId).eq('userId', userId)
      )
      .unique();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת כל ה-RSVPs לאירוע + שם תצוגה (רק למשתמשים מורשים לראות את האירוע)
// ─────────────────────────────────────────────────────────────
export const listByEvent = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const event = await ctx.db.get(eventId);
    if (!event) {
      return [];
    }

    const isCreator = event.createdBy === userId;

    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        return [];
      }
    } else if (!isCreator) {
      if (
        !(await canReadPersonalEvent(
          ctx,
          { ...event, allFamily: false },
          userId
        ))
      ) {
        return [];
      }
    }

    const rows = await ctx.db
      .query('eventRsvps')
      .withIndex('by_event_user', (q) => q.eq('eventId', eventId))
      .collect();

    // Invitees (non-creator) on personal events see only their own RSVP row.
    const visibleRows =
      !event.communityId && !isCreator
        ? rows.filter((r) => r.userId === userId)
        : rows;

    const enriched = await Promise.all(
      visibleRows.map(async (r) => {
        const u = await ctx.db.get(r.userId);
        const displayName =
          (u?.fullName && u.fullName.trim()) ||
          (u?.phone && u.phone.trim()) ||
          'משתמש';
        return { ...r, displayName };
      })
    );

    return enriched;
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת מוזמנים לאירוע אישי עם סטטוס RSVP (ליוצר בלבד)
// ─────────────────────────────────────────────────────────────
export const getInviteesWithRsvp = query({
  args: { eventId: v.id('events') },
  returns: v.array(
    v.object({
      userId: v.id('users'),
      fullName: v.string(),
      profileColor: v.union(v.string(), v.null()),
      status: v.union(
        v.literal('yes'),
        v.literal('maybe'),
        v.literal('none'),
        v.literal('no')
      ),
    })
  ),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const event = await ctx.db.get(eventId);
    if (!event) return [];

    if (event.createdBy !== userId) {
      throw new Error('רק יוצר האירוע יכול לצפות ברשימת המוזמנים');
    }

    const inviteeIds = (event.sharedWithUserIds ?? []) as Id<'users'>[];
    if (inviteeIds.length === 0) return [];

    const statusOrder: Record<string, number> = {
      yes: 0,
      maybe: 1,
      none: 2,
      no: 3,
    };

    const results = await Promise.all(
      inviteeIds.map(async (inviteeUserId) => {
        const user = await ctx.db.get(inviteeUserId);
        const rsvpRow = await ctx.db
          .query('eventRsvps')
          .withIndex('by_event_user', (q) =>
            q.eq('eventId', eventId).eq('userId', inviteeUserId)
          )
          .unique();

        const fullName =
          (user?.fullName && user.fullName.trim()) ||
          (user?.phone && user.phone.trim()) ||
          'משתמש';

        const profileColor =
          (user as { profileColor?: string } | null)?.profileColor ?? null;

        const status: 'yes' | 'maybe' | 'none' | 'no' =
          (rsvpRow?.status as 'yes' | 'maybe' | 'none' | 'no') ?? 'none';

        return { userId: inviteeUserId, fullName, profileColor, status };
      })
    );

    return results.sort(
      (a, b) => (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2)
    );
  },
});
