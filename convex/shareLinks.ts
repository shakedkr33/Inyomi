// FIXED: share link management for personal event sharing
//        one active link per event — createShareLink self-heals legacy duplicates
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

// ─── Token generation ─────────────────────────────────────────────────────────
// 24-char alphanumeric — same pattern as communities.inviteCode
// 62^24 ≈ 10^43 combinations; sufficient for MVP
function generateToken(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// יצירה / שליפה של לינק שיתוף לאירוע (אחד פעיל לכל אירוע)
// Self-heal: if multiple active links exist (legacy bug), keep the oldest,
// revoke the rest deterministically.
// ─────────────────────────────────────────────────────────────
export const createShareLink = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event || event.deletedAt !== undefined)
      throw new Error('אירוע לא נמצא');
    if (event.createdBy !== userId)
      throw new Error('אין הרשאה ליצור לינק לאירוע זה');

    // Fetch all links for this event to handle potential legacy duplicates
    const allLinks = await ctx.db
      .query('shareLinks')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();

    const activeLinks = allLinks.filter((l) => !l.revoked);

    if (activeLinks.length === 1) {
      // Happy path — single active link already exists
      return { token: activeLinks[0].token };
    }

    if (activeLinks.length > 1) {
      // Self-heal: keep the oldest, revoke the rest
      const sorted = [...activeLinks].sort((a, b) => a.createdAt - b.createdAt);
      const [keep, ...extras] = sorted;
      for (const extra of extras) {
        await ctx.db.patch(extra._id, { revoked: true });
      }
      return { token: keep.token };
    }

    // No active link — create a new one
    const token = generateToken();
    await ctx.db.insert('shareLinks', {
      eventId,
      token,
      createdBy: userId,
      revoked: false,
      createdAt: Date.now(),
    });
    return { token };
  },
});

// ─────────────────────────────────────────────────────────────
// ביטול לינק שיתוף (מנטרל את הלינק — אינו משפיע על אירועים שכבר נשמרו)
// ─────────────────────────────────────────────────────────────
export const revokeShareLink = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.createdBy !== userId) throw new Error('אין הרשאה');

    const activeLinks = await ctx.db
      .query('shareLinks')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .filter((q) => q.eq(q.field('revoked'), false))
      .collect();

    for (const link of activeLinks) {
      await ctx.db.patch(link._id, { revoked: true });
    }
  },
});

// ─────────────────────────────────────────────────────────────
// תצוגה מקדימה של אירוע משותף (ללא צורך בהתחברות)
// חושף רק 4 שדות ציבוריים: כותרת, תאריך, שעה, מיקום
// ─────────────────────────────────────────────────────────────
export const getSharePreview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first();

    if (!link || link.revoked) {
      return { status: 'revoked' as const };
    }

    const event = await ctx.db.get(link.eventId);
    if (!event || event.deletedAt !== undefined) {
      return { status: 'not_found' as const };
    }

    const owner = await ctx.db.get(link.createdBy);
    // Owner label: fullName → last 4 digits of phone → null
    const ownerName =
      owner?.fullName?.trim() ||
      (owner?.phone ? `...${owner.phone.slice(-4)}` : null);

    return {
      status: 'ok' as const,
      eventId: event._id,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      allDay: event.allDay ?? false,
      location: event.location ?? null,
      eventStatus: event.status ?? 'active',
      ownerName,
      ownerUserId: link.createdBy,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת לינק השיתוף הפעיל של בעל האירוע (מאומת — לשימוש ב-UI של הבעלים)
// ─────────────────────────────────────────────────────────────
export const getMyShareLink = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Same management permission as createShareLink and revokeShareLink.
    const event = await ctx.db.get(eventId);
    if (!event || event.deletedAt !== undefined || event.createdBy !== userId)
      return null;

    const link = await ctx.db
      .query('shareLinks')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .filter((q) => q.eq(q.field('revoked'), false))
      .first();

    return link ? { token: link.token, createdAt: link.createdAt } : null;
  },
});
