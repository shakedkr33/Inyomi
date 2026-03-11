import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('לא מחובר למערכת');

    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', identity.email ?? ''))
      .unique();
    if (!user) throw new Error('משתמש לא נמצא');

    // TODO: לוודא ש-moodValue הוא בין 0 ל-4
    const existing = await ctx.db
      .query('dailyMoods')
      .withIndex('by_user_date', (q) =>
        q.eq('userId', user._id).eq('date', date)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { moodValue, note });
    } else {
      await ctx.db.insert('dailyMoods', {
        userId: user._id,
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', identity.email ?? ''))
      .unique();
    if (!user) return null;

    return await ctx.db
      .query('dailyMoods')
      .withIndex('by_user_date', (q) =>
        q.eq('userId', user._id).eq('date', date)
      )
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', identity.email ?? ''))
      .unique();
    if (!user) return [];

    // TODO: לממש שליפה יעילה עם index range על date
    const all = await ctx.db
      .query('dailyMoods')
      .withIndex('by_user_date', (q) => q.eq('userId', user._id))
      .collect();

    return all.filter((m) => m.date >= fromDate && m.date <= toDate);
  },
});
