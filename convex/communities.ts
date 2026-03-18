import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** מייצר קוד הזמנה ייחודי בן 8 תווים (A-Z, 0-9), עם בדיקת ייחודיות */
async function generateUniqueInviteCode(ctx: MutationCtx): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = Array.from(
      { length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    const existing = await ctx.db
      .query('communities')
      .withIndex('by_invite_code', (q) => q.eq('inviteCode', code))
      .unique();
    if (!existing) return code;
  }
  // Fallback: timestamp suffix
  return (
    Math.random().toString(36).slice(2, 6).toUpperCase() +
    Date.now().toString(36).toUpperCase().slice(-4)
  );
}

// ─────────────────────────────────────────────────────────────
// יצירת קהילה חדשה
// ─────────────────────────────────────────────────────────────
export const createCommunity = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { name, description, tags }) => {
    // TODO: auth – validate that user has an active space
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const inviteCode = await generateUniqueInviteCode(ctx);

    const communityId = await ctx.db.insert('communities', {
      name: name.trim(),
      description: description?.trim(),
      ownerId: user._id,
      tags: tags ?? [],
      inviteCode,
      createdAt: Date.now(),
      archived: false,
      pinnedByUserIds: [], // deprecated, kept for schema compat
    });

    await ctx.db.insert('communityMembers', {
      communityId,
      userId: user._id,
      role: 'owner',
      pinned: true,
      notificationsEnabled: true,
      joinedAt: Date.now(),
    });

    const community = await ctx.db.get(communityId);
    return community;
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת קהילה בודדת לפי ID (כולל memberCount ו-inviteCode)
// ─────────────────────────────────────────────────────────────
export const getCommunity = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const community = await ctx.db.get(communityId);
    if (!community || community.archived) return null;

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .collect();

    const membership = memberships.find((m) => m.userId === userId);

    return {
      ...community,
      memberCount: memberships.length,
      myRole: membership?.role ?? null,
      myNotificationsEnabled: membership?.notificationsEnabled ?? true,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת הקהילות של המשתמש הנוכחי
// ─────────────────────────────────────────────────────────────
export const listMyCommunities = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user) return [];

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();

    const rows = await Promise.all(
      memberships.map(async (m) => {
        const community = await ctx.db.get(m.communityId);
        if (!community || community.archived) return null;
        return {
          community,
          role: m.role,
          pinned: m.pinned,
        };
      })
    );

    const filtered = rows.filter((r): r is NonNullable<typeof r> => r !== null);

    // מיון: pinned ראשון, אחר כך createdAt יורד
    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.community.createdAt - a.community.createdAt;
    });
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת קהילה לפי ID (ללא בדיקת חברות — לשימוש ב-calendar filter)
// ─────────────────────────────────────────────────────────────
export const getById = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    return await ctx.db.get(communityId);
  },
});

// ─────────────────────────────────────────────────────────────
// חיפוש קהילה לפי קוד הזמנה (למסך ה-join)
// ─────────────────────────────────────────────────────────────
export const getCommunityByInviteCode = query({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const community = await ctx.db
      .query('communities')
      .withIndex('by_invite_code', (q) =>
        q.eq('inviteCode', inviteCode.toUpperCase().trim())
      )
      .unique();

    if (!community || community.archived) return null;

    const memberCount = (
      await ctx.db
        .query('communityMembers')
        .withIndex('by_community', (q) => q.eq('communityId', community._id))
        .collect()
    ).length;

    return {
      name: community.name,
      description: community.description,
      tags: community.tags,
      memberCount,
      _id: community._id,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// הצטרפות לקהילה לפי קוד הזמנה
// ─────────────────────────────────────────────────────────────
export const joinCommunityByCode = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    // TODO: auth – rate limit join attempts
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const community = await ctx.db
      .query('communities')
      .withIndex('by_invite_code', (q) =>
        q.eq('inviteCode', inviteCode.toUpperCase().trim())
      )
      .unique();

    if (!community || community.archived) {
      throw new Error('קהילה לא קיימת');
    }

    // בדיקה אם כבר חבר
    const existing = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', community._id).eq('userId', user._id)
      )
      .unique();

    if (existing) {
      return { status: 'already_member' as const, communityId: community._id };
    }

    await ctx.db.insert('communityMembers', {
      communityId: community._id,
      userId: user._id,
      role: 'member',
      pinned: false,
      notificationsEnabled: true,
      joinedAt: Date.now(),
    });

    return { status: 'joined' as const, communityId: community._id };
  },
});

// ─────────────────────────────────────────────────────────────
// הצמדה / ביטול הצמדה (לפי communityMembers.pinned)
// ─────────────────────────────────────────────────────────────
export const togglePinned = mutation({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', user._id)
      )
      .unique();

    if (!membership) throw new Error('המשתמש אינו חבר בקהילה');

    const newPinned = !membership.pinned;
    await ctx.db.patch(membership._id, { pinned: newPinned });
    return newPinned;
  },
});

// ─────────────────────────────────────────────────────────────
// עדכון פרטי קהילה (owner / admin בלבד)
// ─────────────────────────────────────────────────────────────
export const updateCommunity = mutation({
  args: {
    communityId: v.id('communities'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    color: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, name, description, tags, color }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const community = await ctx.db.get(communityId);
    if (!community) throw new Error('קהילה לא נמצאה');

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', user._id)
      )
      .unique();

    if (
      !membership ||
      (membership.role !== 'owner' && membership.role !== 'admin')
    ) {
      throw new Error('אין הרשאה לעדכן את הקהילה');
    }

    const trimmedName = name !== undefined ? name.trim() : undefined;
    if (trimmedName !== undefined && trimmedName === '') {
      throw new Error('שם הקהילה לא יכול להיות ריק');
    }

    const patch: Record<string, unknown> = {};
    if (trimmedName !== undefined) patch.name = trimmedName;
    if (description !== undefined)
      patch.description = description.trim() || undefined;
    if (tags !== undefined) patch.tags = tags;
    if (color !== undefined) patch.color = color;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(communityId, patch);
    }
  },
});

// ─────────────────────────────────────────────────────────────
// ארכוב קהילה (owner בלבד)
// ─────────────────────────────────────────────────────────────
export const archiveCommunity = mutation({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', user._id)
      )
      .unique();

    if (!membership || membership.role !== 'owner') {
      throw new Error('רק הבעלים יכול לארכב את הקהילה');
    }

    await ctx.db.patch(communityId, { archived: true });
    // TODO: notify members on archive
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקה (ארכוב) של קהילה – owner בלבד
// ─────────────────────────────────────────────────────────────
export const deleteCommunity = mutation({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', user._id)
      )
      .unique();

    if (!membership || membership.role !== 'owner') {
      throw new Error('רק הבעלים יכול למחוק את הקהילה');
    }

    // ארכוב רך – לא מחיקה פיזית
    await ctx.db.patch(communityId, { archived: true });
    // TODO: notify members on deletion
  },
});

// ─────────────────────────────────────────────────────────────
// עזיבת קהילה
// ─────────────────────────────────────────────────────────────
export const leaveCommunity = mutation({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', user._id)
      )
      .unique();

    if (!membership) throw new Error('המשתמש אינו חבר בקהילה זו');

    if (membership.role === 'owner') {
      throw new Error('בעל הקהילה לא יכול לעזוב. יש להעביר בעלות תחילה.');
    }

    await ctx.db.delete(membership._id);
  },
});

// ─────────────────────────────────────────────────────────────
// הסרת חבר מהקהילה (owner בלבד)
// ─────────────────────────────────────────────────────────────
export const removeMember = mutation({
  args: {
    communityId: v.id('communities'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, { communityId, targetUserId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const callerMembership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', userId)
      )
      .unique();

    if (!callerMembership || callerMembership.role !== 'owner') {
      throw new Error('רק בעל הקהילה יכול להסיר חברים');
    }

    if (targetUserId === userId) {
      throw new Error('לא ניתן להסיר את עצמך מהקהילה');
    }

    const targetMembership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', targetUserId)
      )
      .unique();

    if (!targetMembership) {
      throw new Error('החבר אינו נמצא בקהילה זו');
    }

    await ctx.db.delete(targetMembership._id);
  },
});

// ─────────────────────────────────────────────────────────────
// הפעלה/ביטול התראות לקהילה עבור המשתמש הנוכחי
// ─────────────────────────────────────────────────────────────
export const toggleNotifications = mutation({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', userId)
      )
      .unique();

    if (!membership) throw new Error('לא חבר בקהילה זו');

    const newValue = !membership.notificationsEnabled;
    await ctx.db.patch(membership._id, { notificationsEnabled: newValue });
    return { notificationsEnabled: newValue };
  },
});

// ─────────────────────────────────────────────────────────────
// קבלת חברי קהילה (למסך ניהול חברים)
// ─────────────────────────────────────────────────────────────
export const getCommunityMembers = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const community = await ctx.db.get(communityId);
    if (!community || community.archived) return null;

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .collect();

    const activeMembers = memberships.filter((m) => m.status !== 'left');

    const membersWithInfo = await Promise.all(
      activeMembers.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          userId: m.userId,
          role: m.role as 'owner' | 'admin' | 'member',
          joinedAt: m.joinedAt,
          fullName: (user as { fullName?: string } | null)?.fullName ?? 'משתמש',
          email: (user as { email?: string } | null)?.email ?? '',
        };
      })
    );

    return {
      community: {
        name: community.name,
        inviteCode: community.inviteCode,
      },
      members: membersWithInfo,
    };
  },
});
