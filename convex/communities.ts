import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { insertCommunityActivity } from './communityActivities';
import {
  effectiveMemberStatus,
  isActiveCommunityMember,
} from './communityMemberUtils';
import { shouldSkipMarkCommunityViewed } from '../lib/communityViewedIdempotency';
import { resolveMySpaceId } from './members';
import { createUserNotifications } from './userNotifications';

async function requireOwnerOrAdminActive(
  ctx: MutationCtx,
  communityId: Id<'communities'>,
  userId: Id<'users'>
): Promise<void> {
  const membership = await ctx.db
    .query('communityMembers')
    .withIndex('by_community_user', (q) =>
      q.eq('communityId', communityId).eq('userId', userId)
    )
    .unique();
  if (
    !membership ||
    !isActiveCommunityMember(membership) ||
    (membership.role !== 'owner' && membership.role !== 'admin')
  ) {
    throw new Error('אין הרשאה');
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** מייצר קוד הזמנה ייחודי בן 6 ספרות, עם בדיקת ייחודיות */
async function generateUniqueInviteCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const existing = await ctx.db
      .query('communities')
      .withIndex('by_invite_code', (q) => q.eq('inviteCode', code))
      .unique();
    if (!existing) return code;
  }
  // Fallback with timestamp tail, still numeric and human-friendly
  return String(Date.now()).slice(-6);
}

const UPCOMING_EVENTS_SCAN_CAP = 48;

/** Events table has createdAt; no updatedAt — use createdAt for "new since visit". */
async function computeHasNewEventsSinceVisit(
  ctx: QueryCtx,
  communityId: Id<'communities'>,
  lastViewedAt: number | undefined
): Promise<boolean> {
  if (lastViewedAt === undefined) return false;
  const hit = await ctx.db
    .query('events')
    .withIndex('by_community_date', (q) => q.eq('communityId', communityId))
    .filter((q) =>
      q.and(
        q.neq(q.field('status'), 'cancelled'),
        q.gt(q.field('createdAt'), lastViewedAt)
      )
    )
    .first();
  return hit !== null;
}

async function getCommunityListExtras(
  ctx: QueryCtx,
  communityId: Id<'communities'>,
  viewerNow: number | undefined,
  lastViewedAt: number | undefined,
  opts: {
    /** Resolved viewer membership (legacy rows without status count as active). */
    viewerMemberStatus: ReturnType<typeof effectiveMemberStatus>;
    isManager: boolean;
  }
): Promise<{
  membersCount: number;
  nextActivity: {
    id: Id<'events'>;
    title: string;
    startsAt: number;
    status?: 'active' | 'cancelled';
    allDay?: boolean;
  } | null;
  hasNewEvents: boolean;
  pendingMembersCount: number;
}> {
  const allMembers = await ctx.db
    .query('communityMembers')
    .withIndex('by_community', (q) => q.eq('communityId', communityId))
    .collect();

  const membersCount = allMembers.filter((m) =>
    isActiveCommunityMember(m)
  ).length;

  const pendingMembersCount = opts.isManager
    ? allMembers.filter((m) => m.status === 'pending').length
    : 0;

  const viewerPending = opts.viewerMemberStatus === 'pending';

  let nextActivity: {
    id: Id<'events'>;
    title: string;
    startsAt: number;
    status?: 'active' | 'cancelled';
    allDay?: boolean;
  } | null = null;

  if (!viewerPending && viewerNow !== undefined && Number.isFinite(viewerNow)) {
    const upcoming = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q.eq('communityId', communityId).gte('startTime', viewerNow)
      )
      .filter((q) => q.neq(q.field('status'), 'cancelled'))
      .order('asc')
      .take(UPCOMING_EVENTS_SCAN_CAP);

    const next = upcoming[0] ?? null;
    nextActivity = next
      ? {
          id: next._id,
          title: next.title,
          startsAt: next.startTime,
          ...(next.status !== undefined ? { status: next.status } : {}),
          ...(next.allDay === true ? { allDay: true as const } : {}),
        }
      : null;
  }

  const hasNewEvents = viewerPending
    ? false
    : await computeHasNewEventsSinceVisit(ctx, communityId, lastViewedAt);

  return {
    membersCount,
    nextActivity,
    hasNewEvents,
    pendingMembersCount,
  };
}

// ─────────────────────────────────────────────────────────────
// יצירת קהילה חדשה
// ─────────────────────────────────────────────────────────────
export const createCommunity = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    joinApprovalMode: v.optional(
      v.union(v.literal('manual'), v.literal('automatic'))
    ),
  },
  handler: async (ctx, { name, description, tags, joinApprovalMode }) => {
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
      joinApprovalMode: joinApprovalMode ?? 'manual',
    });

    await ctx.db.insert('communityMembers', {
      communityId,
      userId: user._id,
      role: 'owner',
      pinned: true,
      notificationsEnabled: true,
      joinedAt: Date.now(),
      status: 'active',
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
    const membershipStatus = membership
      ? effectiveMemberStatus(membership.status)
      : null;

    if (membershipStatus === null || membershipStatus === 'left') {
      return null;
    }

    const approvedCount = memberships.filter((m) =>
      isActiveCommunityMember(m)
    ).length;

    return {
      ...community,
      memberCount: approvedCount,
      joinApprovalMode: community.joinApprovalMode ?? 'automatic',
      myRole: membership?.role ?? null,
      myMembershipStatus: membershipStatus,
      myNotificationsEnabled: membership?.notificationsEnabled ?? true,
      // Stage 2B: the viewer's PERSONAL auto-add-to-calendar preference for
      // this community (communityMembers.autoAddEventsToCalendar). Exposed
      // here so the community UI can show the REAL current value instead of
      // duplicating local state — see toggleAutoAddEvents below.
      myAutoAddEventsToCalendar: membership?.autoAddEventsToCalendar === true,
      // FIX 9: Profile IDs associated with this community for profile filtering.
      myAssociatedProfileIds: (membership?.associatedProfileIds ??
        []) as string[],
      // Stage 2A: the viewer's PREVIOUS visit timestamp, for the "ראשי" tab's
      // "חדש" event chip (event.createdAt > myLastViewedAt). This is the
      // pre-markCommunityViewed value for the current reactive snapshot —
      // callers that need a STABLE "since my previous visit" reference across
      // this session must capture it once (e.g. on first load, before calling
      // markCommunityViewed) rather than re-reading this field on every
      // re-render, since markCommunityViewed advances it to "now" shortly
      // after the screen mounts. See community/[id].tsx's previousVisitAtRef.
      myLastViewedAt: membership?.lastViewedAt,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת הקהילות של המשתמש הנוכחי
// ─────────────────────────────────────────────────────────────
export const listMyCommunities = query({
  args: {
    /** Clock from the client — do not use Date.now() in the query handler (Convex caching). Optional for backward compatibility. */
    viewerNow: v.optional(v.number()),
  },
  handler: async (ctx, { viewerNow }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user) return [];

    const includeSchedule =
      viewerNow !== undefined && Number.isFinite(viewerNow);

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();

    const rows = await Promise.all(
      memberships.map(async (m) => {
        const community = await ctx.db.get(m.communityId);
        if (!community || community.archived) return null;
        const viewerStatus = effectiveMemberStatus(m.status);
        const isManager = m.role === 'owner' || m.role === 'admin';
        const extras = await getCommunityListExtras(
          ctx,
          community._id,
          includeSchedule ? viewerNow : undefined,
          m.lastViewedAt,
          {
            viewerMemberStatus: viewerStatus,
            isManager,
          }
        );
        return {
          community,
          role: m.role,
          pinned: m.pinned,
          notificationsEnabled: m.notificationsEnabled,
          membersCount: extras.membersCount,
          nextActivity: extras.nextActivity,
          hasNewEvents: extras.hasNewEvents,
          pendingMembersCount: extras.pendingMembersCount,
          membershipStatus: viewerStatus,
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
    ).filter((row) => isActiveCommunityMember(row)).length;

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
      return { status: 'invalid_code' as const };
    }

    const mode = community.joinApprovalMode ?? 'automatic';

    const existing = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', community._id).eq('userId', user._id)
      )
      .unique();

    if (existing) {
      const st = effectiveMemberStatus(existing.status);
      if (st === 'active') {
        return {
          status: 'already_member' as const,
          communityId: community._id,
        };
      }
      if (st === 'pending') {
        return {
          status: 'pending_approval' as const,
          communityId: community._id,
        };
      }
      // left — allow re-request / re-join
      const rowId = existing._id;
      const basePatch = {
        role: 'member' as const,
        pinned: false,
        notificationsEnabled: true,
        joinedAt: Date.now(),
      };
      if (mode === 'automatic') {
        await ctx.db.patch(rowId, { ...basePatch, status: 'active' });
        await insertCommunityActivity(ctx, {
          communityId: community._id,
          actorUserId: user._id,
          type: 'member_joined',
          entityType: 'member',
          entityId: rowId,
          title: `${user.fullName?.trim() || 'משתמש'} הצטרף/ה לקהילה`,
        });
        return { status: 'joined' as const, communityId: community._id };
      }
      await ctx.db.patch(rowId, { ...basePatch, status: 'pending' });

      const allMembersA = await ctx.db
        .query('communityMembers')
        .withIndex('by_community', (q) => q.eq('communityId', community._id))
        .collect();

      const adminRecipientUserIdsA = allMembersA
        .filter(
          (m) =>
            isActiveCommunityMember(m) &&
            (m.role === 'owner' || m.role === 'admin') &&
            m.notificationsEnabled !== false
        )
        .map((m) => m.userId);

      if (adminRecipientUserIdsA.length > 0) {
        const requestTitle = 'בקשת הצטרפות חדשה';
        const requestBody = `${user.fullName?.trim() || 'משתמש'} ביקש/ה להצטרף לקהילת ${community.name}`;
        const requestScreen = `/(authenticated)/community-members/${community._id}`;

        await createUserNotifications(ctx, {
          recipientUserIds: adminRecipientUserIdsA,
          pushType: 'community_join_request_received',
          title: requestTitle,
          body: requestBody,
          screen: requestScreen,
        });

        await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
          recipientUserIds: adminRecipientUserIdsA,
          pushType: 'community_join_request_received',
          title: requestTitle,
          body: requestBody,
          data: { screen: requestScreen },
          channelId: 'communities',
        });
      }

      return {
        status: 'pending_approval' as const,
        communityId: community._id,
      };
    }

    if (mode === 'automatic') {
      await ctx.db.insert('communityMembers', {
        communityId: community._id,
        userId: user._id,
        role: 'member',
        pinned: false,
        notificationsEnabled: true,
        joinedAt: Date.now(),
        status: 'active',
      });
      await insertCommunityActivity(ctx, {
        communityId: community._id,
        actorUserId: user._id,
        type: 'member_joined',
        entityType: 'member',
        title: `${user.fullName?.trim() || 'משתמש'} הצטרף/ה לקהילה`,
      });
      return { status: 'joined' as const, communityId: community._id };
    }

    await ctx.db.insert('communityMembers', {
      communityId: community._id,
      userId: user._id,
      role: 'member',
      pinned: false,
      notificationsEnabled: true,
      joinedAt: Date.now(),
      status: 'pending',
    });

    const allMembersB = await ctx.db
      .query('communityMembers')
      .withIndex('by_community', (q) => q.eq('communityId', community._id))
      .collect();

    const adminRecipientUserIdsB = allMembersB
      .filter(
        (m) =>
          isActiveCommunityMember(m) &&
          (m.role === 'owner' || m.role === 'admin') &&
          m.notificationsEnabled !== false
      )
      .map((m) => m.userId);

    if (adminRecipientUserIdsB.length > 0) {
      const requestTitle = 'בקשת הצטרפות חדשה';
      const requestBody = `${user.fullName?.trim() || 'משתמש'} ביקש/ה להצטרף לקהילת ${community.name}`;
      const requestScreen = `/(authenticated)/community-members/${community._id}`;

      await createUserNotifications(ctx, {
        recipientUserIds: adminRecipientUserIdsB,
        pushType: 'community_join_request_received',
        title: requestTitle,
        body: requestBody,
        screen: requestScreen,
      });

      await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
        recipientUserIds: adminRecipientUserIdsB,
        pushType: 'community_join_request_received',
        title: requestTitle,
        body: requestBody,
        data: { screen: requestScreen },
        channelId: 'communities',
      });
    }

    return {
      status: 'pending_approval' as const,
      communityId: community._id,
    };
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
    if (!isActiveCommunityMember(membership)) {
      throw new Error('ההצטרפות ממתינה לאישור');
    }

    const newPinned = !membership.pinned;
    await ctx.db.patch(membership._id, { pinned: newPinned });
    return newPinned;
  },
});

// ─────────────────────────────────────────────────────────────
// סימון שהמשתמש נכנס למסך הקהילה (למעקב "אירועים חדשים" ברשימה)
// ─────────────────────────────────────────────────────────────
// Optimization Sprint Fix #1 — defensive idempotency safety net, NOT a
// substitute for the client's focus-based "one mark per visit" lifecycle
// (see app/(authenticated)/community/[id].tsx). Even a single genuine visit
// can otherwise resolve into multiple reactive `getCommunity` snapshots that
// each retrigger this mutation; skipping a redundant write within
// `MARK_COMMUNITY_VIEWED_MIN_INTERVAL_MS` of the previous mark prevents that
// from ever becoming a self-sustaining write→invalidate→write loop, without
// touching any other membership field.
export const markCommunityViewed = mutation({
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

    if (!membership || !isActiveCommunityMember(membership)) {
      return { status: 'skipped' as const };
    }

    const now = Date.now();
    if (shouldSkipMarkCommunityViewed(membership.lastViewedAt, now)) {
      return { status: 'already_marked' as const };
    }

    await ctx.db.patch(membership._id, { lastViewedAt: now });
    return { status: 'marked' as const };
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
      !isActiveCommunityMember(membership) ||
      (membership.role !== 'owner' && membership.role !== 'admin')
    ) {
      throw new Error('אין הרשאה לעדכן את הקהילה');
    }

    const trimmedName = name !== undefined ? name.trim() : undefined;
    if (trimmedName !== undefined && trimmedName === '') {
      throw new Error('שם הקהילה לא יכול להיות ריק');
    }

    const patch: Record<string, unknown> = {};
    if (trimmedName !== undefined && trimmedName !== community.name) {
      patch.name = trimmedName;
    }
    if (description !== undefined) {
      const nextDescription = description.trim() || undefined;
      if (nextDescription !== community.description) {
        patch.description = nextDescription;
      }
    }
    if (
      tags !== undefined &&
      JSON.stringify(tags) !== JSON.stringify(community.tags ?? [])
    ) {
      patch.tags = tags;
    }
    if (color !== undefined && color !== community.color) patch.color = color;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(communityId, patch);
      await insertCommunityActivity(ctx, {
        communityId,
        actorUserId: user._id,
        type: 'community_updated',
        entityType: 'community',
        entityId: communityId,
        title: 'פרטי הקהילה עודכנו',
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────
// מצב אישור הצטרפות (owner / admin בלבד)
// ─────────────────────────────────────────────────────────────
export const updateCommunityJoinApprovalMode = mutation({
  args: {
    communityId: v.id('communities'),
    joinApprovalMode: v.union(v.literal('manual'), v.literal('automatic')),
  },
  handler: async (ctx, { communityId, joinApprovalMode }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const community = await ctx.db.get(communityId);
    if (!community) throw new Error('קהילה לא נמצאה');

    await requireOwnerOrAdminActive(ctx, communityId, userId);

    await ctx.db.patch(communityId, { joinApprovalMode });
    return { success: true as const };
  },
});

// ─────────────────────────────────────────────────────────────
// אישור בקשת הצטרפות (owner / admin)
// ─────────────────────────────────────────────────────────────
export const approvePendingMember = mutation({
  args: {
    communityId: v.id('communities'),
    memberId: v.id('communityMembers'),
  },
  handler: async (ctx, { communityId, memberId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    await requireOwnerOrAdminActive(ctx, communityId, userId);

    const target = await ctx.db.get(memberId);
    if (!target || target.communityId !== communityId) {
      throw new Error('הבקשה לא נמצאה');
    }
    if (effectiveMemberStatus(target.status) !== 'pending') {
      throw new Error('המשתמש אינו ממתין לאישור');
    }

    const community = await ctx.db.get(communityId);
    if (!community) {
      throw new Error('הקהילה לא נמצאה');
    }

    await ctx.db.patch(memberId, { status: 'active' });
    const targetUser = await ctx.db.get(target.userId);
    await insertCommunityActivity(ctx, {
      communityId,
      actorUserId: target.userId,
      type: 'member_joined',
      entityType: 'member',
      entityId: memberId,
      title: `${targetUser?.fullName?.trim() || 'משתמש'} הצטרף/ה לקהילה`,
    });
    const approvedTitle = 'בקשת ההצטרפות אושרה';
    const approvedBody = `אפשר להיכנס עכשיו לקהילת ${community.name}`;
    const approvedScreen = `/(authenticated)/community/${communityId}`;

    await createUserNotifications(ctx, {
      recipientUserIds: [target.userId],
      pushType: 'community_join_approved',
      title: approvedTitle,
      body: approvedBody,
      screen: approvedScreen,
    });
    await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
      recipientUserIds: [target.userId],
      pushType: 'community_join_approved',
      title: approvedTitle,
      body: approvedBody,
      data: { screen: approvedScreen },
      channelId: 'communities',
    });
    return { success: true as const };
  },
});

// ─────────────────────────────────────────────────────────────
// דחיית בקשת הצטרפות (owner / admin)
// ─────────────────────────────────────────────────────────────
export const rejectPendingMember = mutation({
  args: {
    communityId: v.id('communities'),
    memberId: v.id('communityMembers'),
  },
  handler: async (ctx, { communityId, memberId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    await requireOwnerOrAdminActive(ctx, communityId, userId);

    const target = await ctx.db.get(memberId);
    if (!target || target.communityId !== communityId) {
      throw new Error('הבקשה לא נמצאה');
    }
    if (effectiveMemberStatus(target.status) !== 'pending') {
      throw new Error('המשתמש אינו ממתין לאישור');
    }

    await ctx.db.delete(memberId);
    return { success: true as const };
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

    const community = await ctx.db.get(communityId);

    await ctx.db.delete(targetMembership._id);

    if (community) {
      const removedTitle = 'הוסרת מהקהילה';
      const removedBody = `הוסרת מקהילת ${community.name}`;
      const removedScreen = '/(authenticated)/communities';

      await createUserNotifications(ctx, {
        recipientUserIds: [targetUserId],
        pushType: 'community_member_removed',
        title: removedTitle,
        body: removedBody,
        screen: removedScreen,
      });

      await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
        recipientUserIds: [targetUserId],
        pushType: 'community_member_removed',
        title: removedTitle,
        body: removedBody,
        data: { screen: removedScreen },
        channelId: 'communities',
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────
// קידום חבר רגיל למנהל קהילה (owner בלבד)
// ─────────────────────────────────────────────────────────────
export const promoteMemberToAdmin = mutation({
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
      throw new Error('רק בעל הקהילה יכול לקדם מנהלים');
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
    if (!isActiveCommunityMember(targetMembership)) {
      throw new Error('לא ניתן לשנות תפקיד למשתמש הממתין לאישור');
    }
    if (targetMembership.role === 'owner') {
      throw new Error('לא ניתן לשנות את תפקיד בעל הקהילה');
    }
    if (targetMembership.role === 'admin') {
      return { role: 'admin' as const };
    }

    await ctx.db.patch(targetMembership._id, { role: 'admin' });

    const community = await ctx.db.get(communityId);
    if (community) {
      const promotedTitle = 'יש לך הרשאות ניהול בקהילה';
      const promotedBody = `הוענקו לך הרשאות ניהול בקהילת ${community.name}`;
      const promotedScreen = `/(authenticated)/community/${communityId}`;

      await createUserNotifications(ctx, {
        recipientUserIds: [targetUserId],
        pushType: 'community_manager_promoted',
        title: promotedTitle,
        body: promotedBody,
        screen: promotedScreen,
      });

      await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
        recipientUserIds: [targetUserId],
        pushType: 'community_manager_promoted',
        title: promotedTitle,
        body: promotedBody,
        data: { screen: promotedScreen },
        channelId: 'communities',
      });
    }

    return { role: 'admin' as const };
  },
});

// ─────────────────────────────────────────────────────────────
// הורדת מנהל קהילה לחבר רגיל (owner בלבד)
// ─────────────────────────────────────────────────────────────
export const demoteAdminToMember = mutation({
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
      throw new Error('רק בעל הקהילה יכול להסיר מנהלים');
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
    if (!isActiveCommunityMember(targetMembership)) {
      throw new Error('לא ניתן לשנות תפקיד למשתמש הממתין לאישור');
    }
    if (targetMembership.role === 'owner') {
      throw new Error('לא ניתן לשנות את תפקיד בעל הקהילה');
    }
    if (targetMembership.role === 'member') {
      return { role: 'member' as const };
    }

    await ctx.db.patch(targetMembership._id, { role: 'member' });
    return { role: 'member' as const };
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
    if (!isActiveCommunityMember(membership)) {
      throw new Error('ההצטרפות ממתינה לאישור');
    }

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

    const viewerMembership = memberships.find((m) => m.userId === userId);
    if (!viewerMembership || !isActiveCommunityMember(viewerMembership)) {
      return null;
    }

    const canManage =
      viewerMembership.role === 'owner' || viewerMembership.role === 'admin';

    const activeRows = memberships.filter((m) => isActiveCommunityMember(m));
    const pendingRows = canManage
      ? memberships.filter((m) => effectiveMemberStatus(m.status) === 'pending')
      : [];

    const mapMember = async (
      m: (typeof memberships)[number]
    ): Promise<{
      membershipId: Id<'communityMembers'>;
      userId: Id<'users'>;
      role: 'owner' | 'admin' | 'member';
      joinedAt: number;
      fullName: string;
      email: string;
    }> => {
      const user = await ctx.db.get(m.userId);
      return {
        membershipId: m._id,
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        fullName: (user as { fullName?: string } | null)?.fullName ?? 'משתמש',
        email: (user as { email?: string } | null)?.email ?? '',
      };
    };

    const membersWithInfo = await Promise.all(
      activeRows.map((m) => mapMember(m))
    );
    const pendingWithInfo = await Promise.all(
      pendingRows.map((m) => mapMember(m))
    );

    return {
      community: {
        name: community.name,
        inviteCode: community.inviteCode,
        joinApprovalMode: community.joinApprovalMode ?? 'automatic',
      },
      members: membersWithInfo,
      pendingMembers: pendingWithInfo,
      canManage,
    };
  },
});

export const toggleAutoAddEvents = mutation({
  args: {
    communityId: v.id('communities'),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const member = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', args.communityId).eq('userId', userId)
      )
      .unique();

    if (!member || !isActiveCommunityMember(member)) {
      throw new Error('Not a member of this community');
    }

    const next = !(member.autoAddEventsToCalendar === true);
    await ctx.db.patch(member._id, { autoAddEventsToCalendar: next });
    return next;
  },
});

// ─────────────────────────────────────────────────────────────
// FIX 9: Community ↔ Family Profile association
// ─────────────────────────────────────────────────────────────

/**
 * Set the family profiles associated with a community for the current user.
 * This is a personal setting — each user controls their own association independently.
 *
 * Validates that all provided profile IDs belong to the user's own family space
 * and are legitimate members rows.
 */
export const setCommunityProfileAssociation = mutation({
  args: {
    communityId: v.id('communities'),
    profileIds: v.array(v.id('members')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    // Verify active community membership
    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', args.communityId).eq('userId', userId)
      )
      .unique();

    if (!membership || !isActiveCommunityMember(membership)) {
      throw new Error('Not a member of this community');
    }

    // Validate profile IDs: each must belong to the user's own family space
    if (args.profileIds.length > 0) {
      const spaceId = await resolveMySpaceId(ctx, userId);
      if (!spaceId) {
        throw new Error('No family space found');
      }

      for (const profileId of args.profileIds) {
        const memberRow = await ctx.db.get(profileId);
        if (!memberRow) {
          throw new Error('Profile not found');
        }
        if (memberRow.spaceId !== spaceId) {
          throw new Error('Profile does not belong to your family space');
        }
      }
    }

    await ctx.db.patch(membership._id, {
      associatedProfileIds:
        args.profileIds.length > 0 ? args.profileIds : undefined,
    });
    return null;
  },
});

/**
 * Get all community-profile associations for the current user.
 * Returns only communities where the user has set non-empty profile associations.
 * Used by Calendar to build the profile→community mapping for filtering.
 */
export const getMyProfileAssociations = query({
  args: {},
  returns: v.array(
    v.object({
      communityId: v.id('communities'),
      profileIds: v.array(v.id('members')),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const results: {
      communityId: Id<'communities'>;
      profileIds: Id<'members'>[];
    }[] = [];
    for (const m of memberships) {
      if (
        isActiveCommunityMember(m) &&
        m.associatedProfileIds &&
        m.associatedProfileIds.length > 0
      ) {
        results.push({
          communityId: m.communityId,
          profileIds: m.associatedProfileIds,
        });
      }
    }
    return results;
  },
});
