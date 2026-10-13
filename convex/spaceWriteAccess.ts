import { hasAccessRowForSpace } from '../lib/spaceAccess';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

/** Membership grants writes; ownership, entity profiles and sharing do not. */
export async function requireSpaceWriteAccess(
  ctx: MutationCtx,
  userId: Id<'users'>,
  spaceId: Id<'spaces'>
): Promise<void> {
  const rows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  if (!hasAccessRowForSpace(rows, spaceId)) {
    throw new Error('אין הרשאה ליצור תוכן במרחב זה');
  }
  // Spaces have no archived/active flag; existence is their lifecycle check.
  if (!(await ctx.db.get(spaceId))) throw new Error('המרחב לא נמצא');
}
