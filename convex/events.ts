// FIXED: added generateUploadUrl, getAttachmentUrl, and attachment support to create + update
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ─── Attachment arg validator ──────────────────────────────────────────────────
// uploadedBy and uploadedAt are NOT accepted from the client — the handler
// stamps them using the authenticated userId and server time.
const attachmentObject = v.object({
  storageId: v.id('_storage'),
  originalName: v.string(),
  displayName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
});

// ─────────────────────────────────────────────────────────────
// יצירת URL להעלאת קובץ ל-Convex Storage
// ─────────────────────────────────────────────────────────────
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    return await ctx.storage.generateUploadUrl();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת URL לצפייה בקובץ מ-Convex Storage
// ─────────────────────────────────────────────────────────────
export const getAttachmentUrl = query({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});

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
      .filter((q) => q.neq(q.field('status'), 'cancelled'))
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
      .filter((q) => q.neq(q.field('status'), 'cancelled'))
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
    isRecurring: v.optional(v.boolean()),
    recurringPattern: v.optional(v.string()),
    spaceId: v.optional(v.id('spaces')),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    locationUrl: v.optional(v.string()),
    onlineUrl: v.optional(v.string()),
    groupId: v.optional(v.id('spaces')),
    // FIXED: persist personal event participants collected in EventScreen
    participants: v.optional(v.array(v.string())),
    sharedWithUserIds: v.optional(v.array(v.id('users'))),
    communityId: v.optional(v.id('communities')),
    requiresRsvp: v.optional(v.boolean()),
    // FIXED: added family sharing fields to create mutation
    allFamily: v.optional(v.boolean()),
    sharedWithFamilyMemberIds: v.optional(v.array(v.string())),
    // FIXED: file attachments (max 2 enforced here)
    attachments: v.optional(v.array(attachmentObject)),
    // Reminder offsets in minutes before event start
    reminders: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    if (args.attachments && args.attachments.length > 2) {
      throw new Error('לא ניתן לצרף יותר מ-2 קבצים לאירוע');
    }

    const now = Date.now();
    // Stamp uploadedBy and uploadedAt server-side — not trusted from client
    const stamped = args.attachments?.map((a) => ({
      ...a,
      uploadedBy: userId,
      uploadedAt: now,
    }));

    return await ctx.db.insert('events', {
      ...args,
      attachments: stamped,
      isAiGenerated: false,
      createdBy: userId,
      createdAt: now,
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
    isRecurring: v.optional(v.boolean()),
    recurringPattern: v.optional(v.string()),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    locationUrl: v.optional(v.string()),
    onlineUrl: v.optional(v.string()),
    groupId: v.optional(v.id('spaces')),
    // FIXED: allow edit flows to preserve/update existing event sharing fields
    participants: v.optional(v.array(v.string())),
    sharedWithUserIds: v.optional(v.array(v.id('users'))),
    allFamily: v.optional(v.boolean()),
    sharedWithFamilyMemberIds: v.optional(v.array(v.string())),
    requiresRsvp: v.optional(v.boolean()),
    // FIXED: file attachments (max 2; backend diffs and deletes removed files from storage)
    attachments: v.optional(v.array(attachmentObject)),
    // Reminder offsets in minutes before event start
    reminders: v.optional(v.array(v.number())),
  },
  handler: async (ctx, { id, attachments, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('אירוע לא נמצא');
    if (existing.createdBy !== userId)
      throw new Error('אין הרשאה לערוך את האירוע');

    let stampedAttachments: typeof existing.attachments | undefined;
    if (attachments !== undefined) {
      if (attachments.length > 2) {
        throw new Error('לא ניתן לצרף יותר מ-2 קבצים לאירוע');
      }

      // Delete from storage any file present in the old list but absent from the new list
      const newIds = new Set(attachments.map((a) => a.storageId));
      for (const old of existing.attachments ?? []) {
        if (!newIds.has(old.storageId)) {
          await ctx.storage.delete(old.storageId);
        }
      }

      const now = Date.now();
      // Build a lookup of existing metadata so we can preserve uploadedBy/uploadedAt
      const existingByStorageId = new Map(
        (existing.attachments ?? []).map((a) => [a.storageId, a])
      );

      stampedAttachments = attachments.map((a) => {
        const prev = existingByStorageId.get(a.storageId);
        return {
          ...a,
          uploadedBy: prev?.uploadedBy ?? userId,
          uploadedAt: prev?.uploadedAt ?? now,
        };
      });
    }

    await ctx.db.patch(id, {
      ...fields,
      ...(stampedAttachments !== undefined
        ? { attachments: stampedAttachments }
        : {}),
    });
  },
});

// ─────────────────────────────────────────────────────────────
// ביטול אירוע (מאומת — רק יוצר האירוע, לא מוחק)
// FIXED: also patches all linkedEvents sourceStatus → 'cancelled'
// ─────────────────────────────────────────────────────────────
export const cancelEvent = mutation({
  args: {
    eventId: v.id('events'),
    cancelReason: v.optional(v.string()),
    cancelledBy: v.optional(v.id('users')),
  },
  handler: async (ctx, { eventId, cancelReason, cancelledBy }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.createdBy !== userId) throw new Error('אין הרשאה');

    await ctx.db.patch(eventId, {
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancelledBy: cancelledBy ?? userId,
      cancelReason,
    });

    // Propagate cancellation to all linked events saved by recipients
    const linked = await ctx.db
      .query('linkedEvents')
      .withIndex('by_source', (q) => q.eq('sourceEventId', eventId))
      .collect();
    for (const row of linked) {
      if (row.sourceStatus !== 'cancelled') {
        await ctx.db.patch(row._id, { sourceStatus: 'cancelled' });
      }
    }

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
// FIXED: patches all linkedEvents sourceStatus → 'deleted' before deleting
//        so recipients see a tombstone with last-known snapshot data
// ─────────────────────────────────────────────────────────────
export const deleteEvent = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.createdBy !== userId) throw new Error('אין הרשאה');

    // Patch linked events before deleting — recipients will fall back to snapshot
    const linked = await ctx.db
      .query('linkedEvents')
      .withIndex('by_source', (q) => q.eq('sourceEventId', eventId))
      .collect();
    for (const row of linked) {
      await ctx.db.patch(row._id, { sourceStatus: 'deleted' });
    }

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
