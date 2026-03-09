import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ─────────────────────────────────────────────────────────────
// שליפת תזכורות שהושלמו לאחרונה לקהילה (עד 30 יום)
// ─────────────────────────────────────────────────────────────
export const listCompletedCommunityReminders = query({
  args: {
    communityId: v.id('communities'),
    since: v.number(),
  },
  handler: async (ctx, { communityId, since }) => {
    return await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .filter((q) =>
        q.and(
          q.eq(q.field('completed'), true),
          q.gte(q.field('completedAt'), since)
        )
      )
      .order('desc')
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת תזכורות קהילה עם cursor pagination (לביצועים)
// ─────────────────────────────────────────────────────────────
export const listCommunityRemindersPaged = query({
  args: {
    communityId: v.id('communities'),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, cursor, numItems }) => {
    return await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .filter((q) => q.eq(q.field('completed'), false))
      .paginate({ cursor, numItems: numItems ?? 20 });
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימות פתוחות לפי קהילה
// ─────────────────────────────────────────────────────────────
export const listByCommunity = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    return await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .filter((q) => q.eq(q.field('completed'), false))
      .order('asc')
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת כל המשימות של space (עם תאריך)
// ─────────────────────────────────────────────────────────────
export const listBySpace = query({
  args: { spaceId: v.id('spaces') },
  handler: async (ctx, { spaceId }) => {
    // TODO: לחבר לאימות – לוודא שהמשתמש שייך ל-spaceId
    return await ctx.db
      .query('tasks')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .filter((q) => q.neq(q.field('dueDate'), undefined))
      .order('asc')
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימות ללא תאריך (undated tasks)
// ─────────────────────────────────────────────────────────────
export const listUndated = query({
  args: { spaceId: v.id('spaces') },
  handler: async (ctx, { spaceId }) => {
    // TODO: לחבר לאימות – לוודא שהמשתמש שייך ל-spaceId
    return await ctx.db
      .query('tasks')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .filter((q) => q.eq(q.field('dueDate'), undefined))
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────
// יצירת משימה חדשה
// ─────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.optional(v.number()), // undefined = ללא תאריך
    spaceId: v.optional(v.id('spaces')),
    assignedTo: v.optional(v.id('users')),
    category: v.optional(v.string()),
    communityId: v.optional(v.id('communities')),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    return await ctx.db.insert('tasks', {
      ...args,
      spaceId: args.spaceId ?? undefined,
      completed: false,
      isAiGenerated: false,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────
// החלפת מצב השלמה (toggle)
// ─────────────────────────────────────────────────────────────
export const toggleCompleted = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');

    const nowCompleted = !task.completed;
    await ctx.db.patch(id, {
      completed: nowCompleted,
      completedAt: nowCompleted ? Date.now() : undefined,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימה בודדת לפי ID (לדף עריכה)
// ─────────────────────────────────────────────────────────────
export const getById = query({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    // TODO: לאמת שהמשתמש הנוכחי שייך ל-space של המשימה
    return await ctx.db.get(id);
  },
});

// ─────────────────────────────────────────────────────────────
// עדכון שדות משימה קיימת
// ─────────────────────────────────────────────────────────────
export const update = mutation({
  args: {
    id: v.id('tasks'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    assignedTo: v.optional(v.id('users')),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    const patch = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, patch);
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת משימה
// ─────────────────────────────────────────────────────────────
export const remove = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    await ctx.db.delete(id);
  },
});
