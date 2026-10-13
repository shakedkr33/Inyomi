import type { PersonalHomeParticipants } from '../lib/personalHomeParticipants';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { isVerifiedProfile } from './personalEventEditing';

/** Call only after event-read authorization. RSVP never determines membership here. */
export async function resolvePersonalHomeParticipants(
  ctx: QueryCtx,
  event: Doc<'events'>
): Promise<PersonalHomeParticipants> {
  const users = new Set<Id<'users'>>([
    event.createdBy,
    ...(event.sharedWithUserIds ?? []),
  ]);
  const familyColors = new Map<Id<'users'>, string>();
  const manual = new Map<string, { id: string; name: string; color: string }>();
  const representedProfiles = new Set<string>();
  for (const id of event.sharedWithFamilyMemberIds ?? []) {
    const memberId = ctx.db.normalizeId('members', id);
    const row = memberId ? await ctx.db.get(memberId) : null;
    if (!row) continue;
    representedProfiles.add(id);
    if (row.userId && (await isVerifiedProfile(ctx, row))) {
      users.add(row.userId);
      if (row.color) familyColors.set(row.userId, row.color);
    } else {
      manual.set(id, {
        id: `profile:${id}`,
        name: row.displayName?.trim() || 'משתתף/ת',
        color: row.color ?? '#94a3b8',
      });
    }
  }
  for (const participant of event.participantDetails ?? []) {
    // Display metadata can decorate an explicitly invited account, never invent one.
    if (participant.userId && users.has(participant.userId)) {
      if (!familyColors.has(participant.userId))
        familyColors.set(participant.userId, participant.color);
      continue;
    }
    if (representedProfiles.has(participant.id)) continue;
    manual.set(participant.id, {
      id: `profile:${participant.id}`,
      name: participant.name.trim() || 'משתתף/ת',
      color: participant.color,
    });
  }
  const profiles = await Promise.all(
    [...users].map(async (userId) => {
      const user = await ctx.db.get(userId);
      return {
        id: `user:${userId}`,
        userId,
        // Same account identity/name/color as personal details' invitee rows.
        name: user?.fullName?.trim() || 'חשבון לא זמין',
        color: user?.profileColor ?? familyColors.get(userId) ?? '#94a3b8',
      };
    })
  );
  const representedInvitees =
    [...users].filter((id) => id !== event.createdBy).length + manual.size;
  return {
    profiles: [...profiles, ...manual.values()],
    // Legacy names without account/profile identity keep their overflow representation.
    extraCount: Math.max(
      0,
      (event.participants?.length ?? 0) - representedInvitees
    ),
  };
}
