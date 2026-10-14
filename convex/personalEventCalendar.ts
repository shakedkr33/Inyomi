import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation } from './_generated/server';
import { resolveKind, resolveMySpaceId } from './members';
import { getAuthUserId } from './sessionAuth';

// ─────────────────────────────────────────────────────────────
// Private helpers — mirror the logic in eventRsvps.ts so both
// files share the same security meaning for selfEntityId without
// creating an exportable public function.
// ─────────────────────────────────────────────────────────────

async function getViewerSelfFamilyMemberId(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<Id<'members'> | null> {
  const spaceId = await resolveMySpaceId(ctx, userId);
  if (!spaceId) return null;

  const indexedEntities = await ctx.db
    .query('members')
    .withIndex('by_kind', (q) => q.eq('spaceId', spaceId).eq('kind', 'entity'))
    .collect();

  const allRows = await ctx.db
    .query('members')
    .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
    .collect();

  const unstampedEntities = allRows.filter(
    (r) => r.kind === undefined && resolveKind(r) === 'entity'
  );

  const seen = new Set(indexedEntities.map((r) => r._id));
  const entities = [
    ...indexedEntities,
    ...unstampedEntities.filter((r) => !seen.has(r._id)),
  ];

  const selfEntityRow = entities.find(
    (r) => r.matchedUserId === userId || r.userId === userId
  );

  return selfEntityRow?._id ?? null;
}

// ─────────────────────────────────────────────────────────────
// removePersonalEventFromMyCalendar
// Opts the current user out of a personal invited event so it
// stops appearing in their calendar/home.
//
// Allowed when:
//   - event is cancelled (any invitee may remove it), OR
//   - invitee's own RSVP status is 'no'
// ─────────────────────────────────────────────────────────────
export const removePersonalEventFromMyCalendar = mutation({
  args: {
    eventId: v.id('events'),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');

    if (event.communityId) {
      throw new Error('אין הרשאה לבצע פעולה זו על אירוע קהילה');
    }

    if (event.createdBy === userId) {
      throw new Error('יוצר האירוע לא יכול להסיר אותו מהיומן בדרך זו');
    }

    // Verify the current user is actually an invitee.
    const sharedWithUserIds = (event.sharedWithUserIds ?? []) as string[];
    const sharedWithFamilyMemberIds = event.sharedWithFamilyMemberIds ?? [];

    const isInUserIds = sharedWithUserIds.includes(userId as string);

    const viewerSelfEntityId = await getViewerSelfFamilyMemberId(ctx, userId);
    const isInFamilyMemberIds =
      viewerSelfEntityId !== null &&
      sharedWithFamilyMemberIds.includes(viewerSelfEntityId as string);

    if (!isInUserIds && !isInFamilyMemberIds) {
      throw new Error('אין הרשאה להסיר אירוע זה מהיומן');
    }

    // Determine reason and validate invitee is allowed to opt-out.
    const isCancelled = event.status === 'cancelled';

    if (!isCancelled) {
      // Active event: only allowed if invitee's RSVP is 'no'.
      const rsvpRow = await ctx.db
        .query('eventRsvps')
        .withIndex('by_event_user', (q) =>
          q.eq('eventId', eventId).eq('userId', userId)
        )
        .unique();

      if (rsvpRow?.status !== 'no') {
        throw new Error('ניתן להסיר אירוע פעיל מהיומן רק לאחר סימון "לא אגיע"');
      }
    }

    const reason: 'cancelled' | 'declined' = isCancelled
      ? 'cancelled'
      : 'declined';

    // Idempotent: return success if already opted out.
    const existing = await ctx.db
      .query('personalEventCalendarOptOuts')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', userId).eq('eventId', eventId)
      )
      .unique();

    if (existing) {
      return { success: true as const };
    }

    await ctx.db.insert('personalEventCalendarOptOuts', {
      eventId,
      userId,
      createdAt: Date.now(),
      reason,
    });

    return { success: true as const };
  },
});
