import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

// ─────────────────────────────────────────────────────────────
// שמירה/עדכון מצב רוח יומי (upsert)
// ─────────────────────────────────────────────────────────────
export const upsertMood = mutation({
  args: {
    date: v.string(), // YYYY-MM-DD
    moodValue: v.number(), // 0–4 (מתאים לסדר carousel: 😤 מתסכל → 😊 מעולה)
    note: v.optional(v.string()),
  },
  handler: async (ctx, { date, moodValue, note }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    // TODO: לוודא ש-moodValue הוא בין 0 ל-4
    const existing = await ctx.db
      .query('dailyMoods')
      .withIndex('by_user_date', (q) => q.eq('userId', userId).eq('date', date))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { moodValue, note });
    } else {
      await ctx.db.insert('dailyMoods', {
        userId,
        date,
        moodValue,
        note,
        createdAt: Date.now(),
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת מצב רוח לתאריך ספציפי
// ─────────────────────────────────────────────────────────────
export const getMoodForDate = query({
  args: { date: v.string() }, // YYYY-MM-DD
  handler: async (ctx, { date }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query('dailyMoods')
      .withIndex('by_user_date', (q) => q.eq('userId', userId).eq('date', date))
      .unique();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת מצב רוח לטווח תאריכים (לגרף / היסטוריה)
// ─────────────────────────────────────────────────────────────
export const listMoodHistory = query({
  args: {
    fromDate: v.string(), // YYYY-MM-DD
    toDate: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, { fromDate, toDate }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // TODO: לממש שליפה יעילה עם index range על date
    const all = await ctx.db
      .query('dailyMoods')
      .withIndex('by_user_date', (q) => q.eq('userId', userId))
      .collect();

    return all.filter((m) => m.date >= fromDate && m.date <= toDate);
  },
});
