import { v } from 'convex/values';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';

// ─────────────────────────────────────────────────────────────
// Helper: מחזיר את המשתמש המחובר (query ו-mutation)
// ─────────────────────────────────────────────────────────────
async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('לא מחובר למערכת');

  const user = await ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', identity.email ?? ''))
    .unique();
  if (!user) throw new Error('משתמש לא נמצא');

  return user;
}

// Helper: מחזיר משתמש + spaceId ראשי (mutations בלבד)
async function requireUserWithSpace(ctx: MutationCtx) {
  const user = await requireUser(ctx);

  const membership = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .first();
  if (!membership) throw new Error('לא נמצא מרחב למשתמש');

  return { user, spaceId: membership.spaceId };
}

// ─────────────────────────────────────────────────────────────
// יצירת קהילה חדשה
// ─────────────────────────────────────────────────────────────
export const createCommunity = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { name, description }) => {
    const { user, spaceId } = await requireUserWithSpace(ctx);

    // קוד הזמנה: base36 אקראי + timestamp (ייחודי ומהיר לאימות)
    const inviteCode =
      Math.random().toString(36).slice(2, 8).toUpperCase() +
      Date.now().toString(36).toUpperCase();

    const communityId = await ctx.db.insert('communities', {
      ownerId: user._id,
      spaceId,
      name: name.trim(),
      description: description?.trim() ?? '',
      avatarColor: '#36a9e2', // TODO: לאפשר בחירת צבע ב-UI
      inviteCode,
      createdAt: Date.now(),
    });

    // מוסיף את היוצר כ-owner
    await ctx.db.insert('communityMembers', {
      communityId,
      userId: user._id,
      spaceId,
      role: 'owner',
      createdAt: Date.now(),
    });

    return communityId;
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת כל הקהילות של המשתמש הנוכחי
// ─────────────────────────────────────────────────────────────
export const listMyCommunities = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', identity.email ?? ''))
      .unique();
    if (!user) return [];

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();

    const results = await Promise.all(
      memberships.map(async (m) => {
        const community = await ctx.db.get(m.communityId);
        if (!community) return null;
        return { community, role: m.role };
      })
    );

    // מסנן רשומות שהקהילה נמחקה
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

// ─────────────────────────────────────────────────────────────
// פרטי קהילה + רשימת חברים
// ─────────────────────────────────────────────────────────────
export const getCommunityById = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    // TODO: הרשאות – רק חברי קהילה יכולים לראות
    const community = await ctx.db.get(communityId);
    if (!community) return null;

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .collect();

    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          userId: m.userId,
          name: user?.fullName ?? 'משתמש לא ידוע',
          role: m.role,
        };
      })
    );

    return { community, members };
  },
});

// ─────────────────────────────────────────────────────────────
// הצטרפות לקהילה לפי קוד הזמנה
// ─────────────────────────────────────────────────────────────
export const joinByInviteCode = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const { user, spaceId } = await requireUserWithSpace(ctx);

    // מציאת הקהילה לפי קוד
    const community = await ctx.db
      .query('communities')
      .withIndex('by_inviteCode', (q) => q.eq('inviteCode', inviteCode.toUpperCase()))
      .unique();
    if (!community) throw new Error('קוד הזמנה לא תקין');

    // בדיקת חברות קיימת
    const existing = await ctx.db
      .query('communityMembers')
      .withIndex('by_community', (q) => q.eq('communityId', community._id))
      .filter((q) => q.eq(q.field('userId'), user._id))
      .unique();

    if (existing) {
      return { success: true, communityId: community._id, alreadyMember: true };
    }

    await ctx.db.insert('communityMembers', {
      communityId: community._id,
      userId: user._id,
      spaceId,
      role: 'member',
      createdAt: Date.now(),
    });

    return { success: true, communityId: community._id, alreadyMember: false };
  },
});

// ─────────────────────────────────────────────────────────────
// עזיבת קהילה
// ─────────────────────────────────────────────────────────────
export const leaveCommunity = mutation({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    // TODO: הרשאות – owner לא יכול לעזוב לפני העברת בעלות
    const user = await requireUser(ctx);

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .filter((q) => q.eq(q.field('userId'), user._id))
      .unique();

    if (!membership) throw new Error('המשתמש אינו חבר בקהילה זו');

    await ctx.db.delete(membership._id);
  },
});
