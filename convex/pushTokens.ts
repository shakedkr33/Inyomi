import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

export const registerPushToken = mutation({
  args: {
    token: v.string(),
    platform: v.union(v.literal('ios'), v.literal('android')),
    deviceId: v.optional(v.string()),
    expectedUserId: v.optional(v.id('users')),
  },
  returns: v.id('pushTokens'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    // Live user/session validation is centralized; preserve the caller's
    // expected identity check for account-switch registration races.
    if (args.expectedUserId !== undefined && args.expectedUserId !== userId) {
      throw new Error('Not authenticated');
    }

    const now = Date.now();

    const existing = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        isActive: true,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('pushTokens', {
      userId,
      token: args.token,
      platform: args.platform,
      deviceId: args.deviceId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const unregisterPushToken = mutation({
  args: {
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const existing = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();

    if (existing && existing.userId === userId) {
      await ctx.db.patch(existing._id, {
        isActive: false,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});
