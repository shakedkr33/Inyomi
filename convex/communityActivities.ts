import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { query } from './_generated/server';
import { isActiveCommunityMember } from './communityMemberUtils';
import { getAuthUserId } from './sessionAuth';

const communityActivityTypeValidator = v.union(
  v.literal('event_created'),
  v.literal('event_updated'),
  v.literal('event_cancelled'),
  v.literal('reminder_created'),
  v.literal('task_assigned'),
  v.literal('task_completed'),
  v.literal('member_joined'),
  v.literal('community_updated')
);

const communityActivityEntityTypeValidator = v.union(
  v.literal('event'),
  v.literal('reminder'),
  v.literal('task'),
  v.literal('community'),
  v.literal('member')
);

export type CommunityActivityType =
  | 'event_created'
  | 'event_updated'
  | 'event_cancelled'
  | 'reminder_created'
  | 'task_assigned'
  | 'task_completed'
  | 'member_joined'
  | 'community_updated';

export type CommunityActivityEntityType =
  | 'event'
  | 'reminder'
  | 'task'
  | 'community'
  | 'member';

export async function insertCommunityActivity(
  ctx: MutationCtx,
  args: {
    communityId: Id<'communities'>;
    actorUserId?: Id<'users'>;
    type: CommunityActivityType;
    entityType?: CommunityActivityEntityType;
    entityId?: string;
    title: string;
    description?: string;
  }
): Promise<Id<'communityActivities'>> {
  return await ctx.db.insert('communityActivities', {
    communityId: args.communityId,
    actorUserId: args.actorUserId,
    type: args.type,
    entityType: args.entityType,
    entityId: args.entityId,
    title: args.title,
    description: args.description,
    createdAt: Date.now(),
  });
}

export const listCommunityActivities = query({
  args: {
    communityId: v.id('communities'),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.id('communityActivities'),
      type: communityActivityTypeValidator,
      title: v.string(),
      description: v.optional(v.string()),
      actorDisplayName: v.optional(v.string()),
      createdAt: v.number(),
      entityType: v.optional(communityActivityEntityTypeValidator),
      entityId: v.optional(v.string()),
    })
  ),
  handler: async (ctx, { communityId, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', userId)
      )
      .unique();

    if (!isActiveCommunityMember(membership)) return [];

    const safeLimit = Math.min(Math.max(limit ?? 50, 1), 50);
    const activities = await ctx.db
      .query('communityActivities')
      .withIndex('by_community_createdAt', (q) =>
        q.eq('communityId', communityId)
      )
      .order('desc')
      .take(safeLimit);

    const actorIds = [
      ...new Set(
        activities
          .map((activity) => activity.actorUserId)
          .filter((id): id is Id<'users'> => id !== undefined)
      ),
    ];

    const actors = await Promise.all(actorIds.map((id) => ctx.db.get(id)));
    const actorNameById = new Map(
      actors
        .filter((user): user is Doc<'users'> => user !== null)
        .map((user) => [user._id, user.fullName?.trim() || 'משתמש'])
    );

    return activities.map((activity) => ({
      id: activity._id,
      type: activity.type,
      title: activity.title,
      description: activity.description,
      actorDisplayName:
        activity.actorUserId !== undefined
          ? actorNameById.get(activity.actorUserId)
          : undefined,
      createdAt: activity.createdAt,
      entityType: activity.entityType,
      entityId: activity.entityId,
    }));
  },
});
