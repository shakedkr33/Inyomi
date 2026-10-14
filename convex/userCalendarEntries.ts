import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

export const addToCalendar = mutation({
  args: {
    eventId: v.id('events'),
    source: v.union(
      v.literal('manual_add'),
      v.literal('auto_add'),
      v.literal('rsvp_yes'),
      v.literal('rsvp_maybe')
    ),
  },
  returns: v.id('userCalendarEntries'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error('Event not found');
    if (!event.communityId) throw new Error('Event has no communityId');

    const existing = await ctx.db
      .query('userCalendarEntries')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', userId).eq('eventId', args.eventId)
      )
      .unique();

    const now = Date.now();

    if (existing) {
      if (existing.status === 'active') {
        return existing._id;
      }
      await ctx.db.patch(existing._id, {
        status: 'active',
        source: args.source,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('userCalendarEntries', {
      userId,
      eventId: args.eventId,
      communityId: event.communityId,
      source: args.source,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const removeFromCalendar = mutation({
  args: {
    eventId: v.id('events'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const existing = await ctx.db
      .query('userCalendarEntries')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', userId).eq('eventId', args.eventId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: 'removed',
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

export const isEventInMyCalendar = query({
  args: {
    eventId: v.id('events'),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const entry = await ctx.db
      .query('userCalendarEntries')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', userId).eq('eventId', args.eventId)
      )
      .unique();

    return entry?.status === 'active';
  },
});

export const getMyCalendarEventIds = query({
  args: {
    communityId: v.optional(v.id('communities')),
  },
  returns: v.array(v.id('events')),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    if (args.communityId) {
      const communityId = args.communityId;
      const entries = await ctx.db
        .query('userCalendarEntries')
        .withIndex('by_user_community', (q) =>
          q.eq('userId', userId).eq('communityId', communityId)
        )
        .collect();
      return entries.filter((e) => e.status === 'active').map((e) => e.eventId);
    }

    const entries = await ctx.db
      .query('userCalendarEntries')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    return entries.filter((e) => e.status === 'active').map((e) => e.eventId);
  },
});
