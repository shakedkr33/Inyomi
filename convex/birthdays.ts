import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { hasAccessRowForSpace } from '../lib/spaceAccess';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';

const PERMISSION_DENIED = 'אין הרשאה לגשת למרחב זה';

// ── requireSpaceAccess ────────────────────────────────────────────────────────
// SECURITY FIX: listUpcoming/create/remove previously trusted a
// client-supplied spaceId with no server-side membership check at all
// (a client could pass ANY spaceId and read/write/delete that space's
// birthdays). This verifies the authenticated caller has a real
// access-kind `members` row (admin OR member) for the requested space —
// a client-provided spaceId alone is never sufficient authorization.
async function requireSpaceAccess(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  spaceId: Id<'spaces'>
): Promise<void> {
  const rows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();

  if (!hasAccessRowForSpace(rows, spaceId)) {
    throw new Error(PERMISSION_DENIED);
  }
}

// ─────────────────────────────────────────────────────────────
// שליפת ימי הולדת קרובים (בתוך X ימים מהיום)
// ─────────────────────────────────────────────────────────────
export const listUpcoming = query({
  args: {
    spaceId: v.id('spaces'),
    daysAhead: v.number(), // למשל: 30 = חודש קדימה
  },
  handler: async (ctx, { spaceId, daysAhead }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    // SECURITY: verify the caller actually belongs to this space before
    // returning any birthday data for it.
    await requireSpaceAccess(ctx, userId, spaceId);

    const all = await ctx.db
      .query('birthdays')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();

    // TODO: לממש חישוב "ימי הולדת קרובים" שמתחשב גם בשנה הבאה
    // (למשל: יום הולדת ב-03-01 נחשב "קרוב" גם ב-דצמבר)
    const today = new Date();
    const todayMMDD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const cutoff = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const cutoffMMDD = `${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

    return all.filter((b) => {
      const mmdd = b.date.slice(5); // "YYYY-MM-DD" → "MM-DD"
      if (cutoffMMDD >= todayMMDD) {
        return mmdd >= todayMMDD && mmdd <= cutoffMMDD;
      }
      // חוצה שנה (דצמבר → ינואר)
      return mmdd >= todayMMDD || mmdd <= cutoffMMDD;
    });
  },
});

// ─────────────────────────────────────────────────────────────
// הוספת יום הולדת חדש
// ─────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    name: v.string(),
    date: v.string(), // YYYY-MM-DD
    spaceId: v.id('spaces'),
    userId: v.optional(v.id('users')),
    notes: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error('לא מחובר למערכת');
    // SECURITY: verify the caller belongs to the requested space before
    // allowing a birthday to be created in it.
    await requireSpaceAccess(ctx, authUserId, args.spaceId);

    // SECURITY: createdBy is always derived from the authenticated caller
    // server-side — the args validator does not even accept a client
    // `createdBy` field, so this can never be spoofed.
    return await ctx.db.insert('birthdays', {
      ...args,
      createdBy: authUserId,
      createdAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת יום הולדת
// ─────────────────────────────────────────────────────────────
export const remove = mutation({
  args: { id: v.id('birthdays') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('יום הולדת לא נמצא');

    // SECURITY: the caller must belong to this birthday's space...
    await requireSpaceAccess(ctx, userId, existing.spaceId);

    // ...and only the creator may delete it. This mirrors this repo's
    // existing creator-only deletion convention for personal content
    // (see events.deleteEvent) — there is no admin-override delete rule
    // for birthdays elsewhere in this codebase, so none is introduced here.
    if (existing.createdBy !== userId) {
      throw new Error(PERMISSION_DENIED);
    }

    await ctx.db.delete(id);
  },
});
