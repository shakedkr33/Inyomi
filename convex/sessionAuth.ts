import {
  getAuthSessionId,
  getAuthUserId as getTokenUserId,
} from '@convex-dev/auth/server';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

/**
 * Application authentication boundary, not resource authorization.
 * Convex verifies JWT signature/issuer/audience/expiry. Convex Auth's supported
 * helpers extract its user/session IDs; neither helper validates live records.
 * Read both in the caller's query/mutation transaction (no cross-request cache).
 * https://labs.convex.dev/auth/advanced#session-validity
 */
export async function getAuthUserId(
  ctx: Pick<QueryCtx, 'auth' | 'db'>
): Promise<Id<'users'> | null> {
  const userId = await getTokenUserId(ctx);
  const sessionId = await getAuthSessionId(ctx);
  if (!userId || !sessionId) return null;

  const session = await ctx.db.get(sessionId);
  if (
    !session ||
    session.userId !== userId ||
    !Number.isFinite(session.expirationTime) ||
    session.expirationTime <= Date.now()
  ) {
    return null;
  }
  const user = await ctx.db.get(userId);
  return user && user.isActive !== false ? userId : null;
}
