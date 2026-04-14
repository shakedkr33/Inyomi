import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ─────────────────────────────────────────────────────────────
// שליפת אירוע יחיד לפי מזהה
// ─────────────────────────────────────────────────────────────
export const getById = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    return await ctx.db.get(eventId);
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת אירועי קהילה עם cursor pagination (לביצועים)
// ─────────────────────────────────────────────────────────────
export const listByCommunityPaged = query({
  args: {
    communityId: v.id('communities'),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
    fromTime: v.optional(v.number()),
    toTime: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, cursor, numItems, fromTime, toTime }) => {
    const from = fromTime ?? 0;
    const to = toTime ?? 9_999_999_999_999; // far future
    return await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q
          .eq('communityId', communityId)
          .gte('startTime', from)
          .lte('startTime', to)
      )
      .paginate({ cursor, numItems: numItems ?? 20 });
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת כל אירועי קהילה לפי communityId
// ─────────────────────────────────────────────────────────────
export const listByCommunity = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    return await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) => q.eq('communityId', communityId))
      .order('asc')
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת אירועים לפי טווח תאריכים
// ─────────────────────────────────────────────────────────────
export const listByDateRange = query({
  args: {
    spaceId: v.id('spaces'),
    from: v.number(), // Unix timestamp (ms) – תחילת טווח
    to: v.number(), // Unix timestamp (ms) – סוף טווח
  },
  handler: async (ctx, { spaceId, from, to }) => {
    // TODO: לחבר לאימות – לוודא שהמשתמש הנוכחי שייך ל-spaceId
    return await ctx.db
      .query('events')
      .withIndex('by_space_and_time', (q) =>
        q.eq('spaceId', spaceId).gte('startTime', from).lte('startTime', to)
      )
      .order('asc')
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────
// יצירת אירוע חדש
// ─────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    allDay: v.optional(v.boolean()),
    spaceId: v.optional(v.id('spaces')),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    locationUrl: v.optional(v.string()),
    onlineUrl: v.optional(v.string()),
    groupId: v.optional(v.id('spaces')),
    sharedWithUserIds: v.optional(v.array(v.id('users'))),
    communityId: v.optional(v.id('communities')),
    requiresRsvp: v.optional(v.boolean()),
    // FIXED: added family sharing fields to create mutation
    allFamily: v.optional(v.boolean()),
    sharedWithFamilyMemberIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    return await ctx.db.insert('events', {
      ...args,
      isAiGenerated: false,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────
// עדכון אירוע קיים
// ─────────────────────────────────────────────────────────────
export const update = mutation({
  args: {
    id: v.id('events'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    locationUrl: v.optional(v.string()),
    onlineUrl: v.optional(v.string()),
    groupId: v.optional(v.id('spaces')),
    sharedWithUserIds: v.optional(v.array(v.id('users'))),
    requiresRsvp: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('אירוע לא נמצא');
    if (existing.createdBy !== userId)
      throw new Error('אין הרשאה לערוך את האירוע');

    await ctx.db.patch(id, fields);
  },
});

// ─────────────────────────────────────────────────────────────
// ביטול אירוע (מאומת — רק יוצר האירוע, לא מוחק)
// ─────────────────────────────────────────────────────────────
export const cancelEvent = mutation({
  args: {
    eventId: v.id('events'),
    cancelReason: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, cancelReason }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.createdBy !== userId) throw new Error('אין הרשאה');

    await ctx.db.patch(eventId, {
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancelReason,
    });

    // TODO push notification:
    // notify all participants that the event was cancelled
    // include event.title and cancelReason if provided
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת אירועים שבוטלו לאחר 14 ימים
// ─────────────────────────────────────────────────────────────
export const deleteCancelledEventsPastGracePeriod = mutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query('events')
      .filter((q) =>
        q.and(
          q.eq(q.field('status'), 'cancelled'),
          q.lt(q.field('cancelledAt'), cutoff)
        )
      )
      .collect();
    for (const ev of old) {
      await ctx.db.delete(ev._id);
    }
    return { deleted: old.length };
  },
});
// TODO cleanup job: call deleteCancelledEventsPastGracePeriod on a schedule.
// Do NOT call this mutation from the UI in this step.

// ─────────────────────────────────────────────────────────────
// מחיקת אירוע (מאומת — רק יוצר האירוע)
// ─────────────────────────────────────────────────────────────
export const deleteEvent = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.createdBy !== userId) throw new Error('אין הרשאה');
    await ctx.db.delete(eventId);
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת אירוע
// ─────────────────────────────────────────────────────────────
export const remove = mutation({
  args: { id: v.id('events') },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('לא מחובר למערכת');

    // TODO: לוודא שהמשתמש הנוכחי הוא יוצר האירוע
    // TODO: למחוק גם eventRsvps קשורים לפני מחיקת האירוע
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('אירוע לא נמצא');

    await ctx.db.delete(id);
  },
});

// ─────────────────────────────────────────────────────────────
// אירועי קהילות עבור תאריך נבחר — לדף הבית
// מחזיר את כל האירועים בקהילות של המשתמש הנוכחי בטווח הזמן
// ─────────────────────────────────────────────────────────────
export const listCommunityEventsForDate = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const activeMembers = memberships.filter((m) => m.status !== 'left');

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

        return events
          .filter((ev) => ev.status !== 'cancelled')
          .map((ev) => ({
            _id: ev._id,
            title: ev.title,
            startTime: ev.startTime,
            endTime: ev.endTime,
            allDay: ev.allDay ?? false,
            communityId,
            communityName: community.name,
            location: ev.location,
          }));
      })
    );

    return results.flat();
  },
});
