/**
 * Profile circles data for Home and Calendar cards.
 *
 * Community events: "גם הוסיפו ליומן" — family members from the same space
 * who also added the same community event to their personal calendar.
 */
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { resolveKind, resolveMySpaceId } from './members';
import { getAuthUserId } from './sessionAuth';

export type ProfileCircle = {
  id: string;
  name: string;
  color: string;
};

// ─── Shared helper ────────────────────────────────────────────────────────────

async function buildFamilyProfiles(
  ctx: QueryCtx,
  userId: Id<'users'>,
  spaceId: Id<'spaces'>
): Promise<{
  familyUserIds: Set<string>;
  profileByUserId: Map<string, ProfileCircle>;
}> {
  const allRows = await ctx.db
    .query('members')
    .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
    .collect();

  const familyUserIds = new Set<string>();
  for (const row of allRows) {
    if (!row.userId || row.userId === userId) continue;
    if (resolveKind(row) !== 'access') continue;
    familyUserIds.add(row.userId as string);
  }

  const entityRows = allRows.filter((r) => resolveKind(r) === 'entity');
  const profileByUserId = new Map<string, ProfileCircle>();

  for (const uid of familyUserIds) {
    const entity = entityRows.find(
      (r) => r.matchedUserId === uid || r.userId === uid
    );
    if (entity?.displayName) {
      profileByUserId.set(uid, {
        id: uid,
        name: entity.displayName,
        color: entity.color ?? '#36a9e2',
      });
    } else {
      const user = await ctx.db.get(uid as Id<'users'>);
      if (user) {
        const userName = (user as { fullName?: string }).fullName?.trim();
        if (userName) {
          profileByUserId.set(uid, {
            id: uid,
            name: userName,
            color:
              (user as { profileColor?: string }).profileColor ?? '#36a9e2',
          });
        }
      }
    }
  }

  return { familyUserIds, profileByUserId };
}

// ─── Query: per specific event IDs (Home screen daily view) ───────────────────

/**
 * For each given community event ID, returns the family members (same space)
 * who have an active "saved to my calendar" record for that event.
 *
 * Excludes the current user. Excludes non-family community members.
 * Reactive: updates automatically when savedCommunityEvents changes.
 */
export const getFamilyAlsoAddedCommunityEvents = query({
  args: { eventIds: v.array(v.id('events')) },
  handler: async (ctx, { eventIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || eventIds.length === 0) {
      return {} as Record<string, ProfileCircle[]>;
    }

    const spaceId = await resolveMySpaceId(ctx, userId);
    if (!spaceId) return {} as Record<string, ProfileCircle[]>;

    const { familyUserIds, profileByUserId } = await buildFamilyProfiles(
      ctx,
      userId,
      spaceId
    );

    if (familyUserIds.size === 0) return {} as Record<string, ProfileCircle[]>;

    const result: Record<string, ProfileCircle[]> = {};

    for (const eventId of eventIds) {
      const saves = await ctx.db
        .query('savedCommunityEvents')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect();

      const profiles: ProfileCircle[] = [];
      for (const save of saves) {
        if (save.removedAt !== undefined) continue;
        if (save.userId === userId) continue;
        if (!familyUserIds.has(save.userId as string)) continue;
        const profile = profileByUserId.get(save.userId as string);
        if (profile) profiles.push(profile);
      }

      if (profiles.length > 0) {
        result[eventId as string] = profiles;
      }
    }

    return result;
  },
});

// ─── Query: all family saves (Calendar timeline — wide date range) ────────────

/**
 * Returns ALL active community-event saves by family members, keyed by eventId.
 * Used by the Calendar timeline (wide date range, many events) to avoid an
 * N+1 per-event query: iterates per family member, not per event.
 *
 * Result: eventId → ProfileCircle[]
 * Only family members with actual accounts; excludes the current user.
 */
export const getFamilyAllSavedCommunityEvents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return {} as Record<string, ProfileCircle[]>;

    const spaceId = await resolveMySpaceId(ctx, userId);
    if (!spaceId) return {} as Record<string, ProfileCircle[]>;

    const { familyUserIds, profileByUserId } = await buildFamilyProfiles(
      ctx,
      userId,
      spaceId
    );

    if (familyUserIds.size === 0) return {} as Record<string, ProfileCircle[]>;

    const result: Record<string, ProfileCircle[]> = {};

    // Query by family member (O(family_size) DB calls) not by event
    for (const uid of familyUserIds) {
      const saves = await ctx.db
        .query('savedCommunityEvents')
        .withIndex('by_user', (q) => q.eq('userId', uid as Id<'users'>))
        .collect();

      const profile = profileByUserId.get(uid);
      if (!profile) continue;

      for (const save of saves) {
        if (save.removedAt !== undefined) continue;
        const eid = save.eventId as string;
        if (!result[eid]) result[eid] = [];
        if (!result[eid].some((p) => p.id === uid)) {
          result[eid].push(profile);
        }
      }
    }

    return result;
  },
});
