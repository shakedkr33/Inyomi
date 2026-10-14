import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

export const getOrCreateAppleReviewUser = internalMutation({
  args: {
    phone: v.string(),
  },
  handler: async (ctx, { phone }) => {
    const now = Date.now();

    const existingUser = await ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', phone))
      .unique();

    if (existingUser) {
      if (existingUser.isActive === false) {
        throw new Error('Account is disabled');
      }
      await ctx.db.patch(existingUser._id, {
        phone,
        role: existingUser.role ?? 'user',
        isActive: true,
        onboardingCompleted: true,
        familySetupSkippedAt: existingUser.familySetupSkippedAt ?? now,
        profileSetupCompletedAt: existingUser.profileSetupCompletedAt ?? now,
        updatedAt: now,
      });

      return existingUser._id;
    }

    const userId = await ctx.db.insert('users', {
      phone,
      role: 'user',
      isActive: true,
      onboardingCompleted: true,
      familySetupSkippedAt: now,
      profileSetupCompletedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return userId;
  },
});
