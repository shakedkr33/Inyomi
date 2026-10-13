import { hasAccessRowForSpace } from '../lib/spaceAccess';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

type PersonalEventAccess = Pick<
  Doc<'events'>,
  | 'createdBy'
  | 'spaceId'
  | 'allFamily'
  | 'sharedWithUserIds'
  | 'sharedWithFamilyMemberIds'
>;

/** Read permission only: cancellation, calendar opt-outs and trash are separate filters.
 * Callers must handle community events through active community membership.
 * ownerScope and Google provenance describe ownership, not permission grants.
 */
export function canReadPersonalEventWithMembers(
  event: PersonalEventAccess,
  userId: Id<'users'>,
  viewerMembers: readonly Doc<'members'>[]
): boolean {
  if (event.createdBy === userId) return true;
  if (event.sharedWithUserIds?.includes(userId)) return true;

  // Never treat a discovery-only matchedUserId as an accepted sharing identity.
  const ownRows = viewerMembers.filter((row) => row.userId === userId);
  if (
    event.sharedWithFamilyMemberIds?.some((id) =>
      ownRows.some((row) => row._id === id)
    )
  ) {
    return true;
  }
  return (
    event.allFamily === true &&
    event.spaceId !== undefined &&
    hasAccessRowForSpace(ownRows, event.spaceId)
  );
}

export async function canReadPersonalEvent(
  ctx: QueryCtx,
  event: PersonalEventAccess,
  userId: Id<'users'>
): Promise<boolean> {
  if (event.createdBy === userId || event.sharedWithUserIds?.includes(userId))
    return true;
  const rows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  return canReadPersonalEventWithMembers(event, userId, rows);
}
