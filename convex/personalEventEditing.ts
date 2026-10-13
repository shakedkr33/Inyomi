import type { Infer } from 'convex/values';
import { hasAccessRowForSpace } from '../lib/spaceAccess';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { canReadPersonalEvent } from './eventAccess';
import { computeIsFullyJoined, resolveKind } from './members';

export {
  participantDetail,
  personalTaskChange,
} from './personalEventValidators';

import type {
  participantDetail,
  personalTaskChange,
} from './personalEventValidators';

type TaskChange = Infer<typeof personalTaskChange>;

export async function isVerifiedProfile(
  ctx: MutationCtx | QueryCtx,
  row: Doc<'members'>
) {
  return Boolean(
    row.userId &&
      row.memberType !== 'pet' &&
      (resolveKind(row) === 'access' || (await computeIsFullyJoined(ctx, row)))
  );
}

export async function assertPersonalAssignee(
  ctx: MutationCtx,
  event: Doc<'events'>,
  userId: Id<'users'>
) {
  let linkedInvite =
    event.createdBy === userId ||
    event.sharedWithUserIds?.includes(userId) === true;
  if (!linkedInvite)
    for (const id of event.sharedWithFamilyMemberIds ?? []) {
      const memberId = ctx.db.normalizeId('members', id);
      const row = memberId ? await ctx.db.get(memberId) : null;
      if (row?.userId === userId && (await isVerifiedProfile(ctx, row)))
        linkedInvite = true;
    }
  if (
    !linkedInvite ||
    !(await ctx.db.get(userId)) ||
    !(await canReadPersonalEvent(ctx, { ...event, allFamily: false }, userId))
  ) {
    throw new Error('ניתן להקצות רק ליוצרי האירוע או לחשבונות שהוזמנו במפורש');
  }
}

export async function validatePersonalInvitations(
  ctx: MutationCtx,
  creator: Id<'users'>,
  next: {
    sharedWithUserIds?: Id<'users'>[];
    sharedWithFamilyMemberIds?: string[];
    participantDetails?: Infer<typeof participantDetail>[];
  },
  previous?: Doc<'events'>
) {
  if (
    next.sharedWithUserIds === undefined &&
    next.sharedWithFamilyMemberIds === undefined &&
    next.participantDetails === undefined
  )
    return;
  const ownRows = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', creator))
    .collect();
  const accessSpaces = new Set(
    ownRows
      .filter((row) => hasAccessRowForSpace(ownRows, row.spaceId))
      .map((row) => row.spaceId)
  );
  const knownLinkedUsers = new Set<Id<'users'>>([creator]);
  for (const spaceId of accessSpaces) {
    const rows = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    for (const row of rows)
      if (row.userId && (await isVerifiedProfile(ctx, row)))
        knownLinkedUsers.add(row.userId);
  }
  for (const userId of next.sharedWithUserIds ??
    previous?.sharedWithUserIds ??
    []) {
    if (
      !previous?.sharedWithUserIds?.includes(userId) &&
      (!knownLinkedUsers.has(userId) || !(await ctx.db.get(userId)))
    ) {
      throw new Error('לא ניתן להזמין חשבון ללא קישור מאומת');
    }
  }
  for (const id of next.sharedWithFamilyMemberIds ??
    previous?.sharedWithFamilyMemberIds ??
    []) {
    if (previous?.sharedWithFamilyMemberIds?.includes(id)) continue;
    const memberId = ctx.db.normalizeId('members', id);
    const row = memberId ? await ctx.db.get(memberId) : null;
    if (
      !row ||
      !(await isVerifiedProfile(ctx, row)) ||
      !accessSpaces.has(row.spaceId)
    )
      throw new Error('אין הרשאה לבחור פרופיל זה');
  }
  for (const p of next.participantDetails ?? []) {
    if (!p.userId) continue;
    if (
      previous?.participantDetails?.some(
        (old) => JSON.stringify(old) === JSON.stringify(p)
      )
    )
      continue;
    if (p.source === 'contact' || p.source === 'legacy')
      throw new Error('איש קשר אינו חשבון מאומת');
    if (
      !(next.sharedWithUserIds ?? previous?.sharedWithUserIds ?? []).includes(
        p.userId
      ) &&
      !(
        p.source === 'family' &&
        (
          next.sharedWithFamilyMemberIds ??
          previous?.sharedWithFamilyMemberIds ??
          []
        ).includes(p.id)
      )
    )
      throw new Error('חסרה הזמנה מפורשת לחשבון');
    if (p.source === 'family') {
      const memberId = ctx.db.normalizeId('members', p.id);
      const row = memberId ? await ctx.db.get(memberId) : null;
      if (!row || row.userId !== p.userId || row.memberType === 'pet')
        throw new Error('קישור הפרופיל לחשבון אינו תקף');
    }
  }
}

// Validate every operation before making any task writes. The enclosing events
// mutation commits the event and this plan in one Convex transaction.
export async function preparePersonalTaskChanges(
  ctx: MutationCtx,
  event: Doc<'events'>,
  actor: Id<'users'>,
  changes: TaskChange[] = [],
  deletedIds: Id<'eventTasks'>[] = [],
  previous?: Doc<'events'>
) {
  if (event.communityId) {
    if (changes.length || deletedIds.length)
      throw new Error('פעולה זו זמינה רק באירוע אישי');
    return async () => {};
  }
  if (
    (changes.length || deletedIds.length) &&
    (event.createdBy !== actor ||
      event.status === 'cancelled' ||
      event.deletedAt !== undefined)
  )
    throw new Error('לא ניתן לשנות משימות באירוע זה');
  const tasks = await ctx.db
    .query('eventTasks')
    .withIndex('by_event', (q) => q.eq('eventId', event._id))
    .collect();
  const seen = new Set<string>();
  for (const id of deletedIds) {
    if (seen.has(id) || !tasks.some((t) => t._id === id))
      throw new Error('משימה אינה שייכת לאירוע');
    seen.add(id);
  }
  for (const change of changes) {
    if (change.id) {
      if (seen.has(change.id) || !tasks.some((t) => t._id === change.id))
        throw new Error('משימה אינה שייכת לאירוע');
      seen.add(change.id);
    } else if (!change.title?.trim()) throw new Error('נדרשת כותרת למשימה');
    if (change.assignee)
      await assertPersonalAssignee(ctx, event, change.assignee);
  }
  if (previous)
    for (const task of tasks) {
      // Deletion IDs were validated above; only surviving tasks need resolution.
      if (deletedIds.includes(task._id)) continue;
      const assignee = task.assignedToUserId;
      if (!assignee || assignee === event.createdBy) continue;
      const wasInvited = await canReadPersonalEvent(
        ctx,
        { ...previous, allFamily: false },
        assignee
      );
      const stillInvited = await canReadPersonalEvent(
        ctx,
        { ...event, allFamily: false },
        assignee
      );
      if (wasInvited && !stillInvited) {
        const resolution = changes.find((c) => c.id === task._id);
        if (
          !resolution ||
          resolution.assignee === undefined ||
          resolution.assignee === assignee
        )
          throw new Error(
            'לפני הסרת משתתפים יש להעביר את משימותיהם או לבטל את ההקצאה'
          );
      }
    }
  return async () => {
    for (const id of deletedIds) await ctx.db.delete(id);
    for (const change of changes) {
      const { id, assignee, ...fields } = change;
      const old = tasks.find((t) => t._id === id);
      const assignment =
        assignee !== undefined
          ? {
              assignedToUserId: assignee ?? undefined,
              assignedToManual: undefined,
              assignedByUserId: assignee ? actor : undefined,
              assignedAt: assignee ? Date.now() : undefined,
            }
          : {};
      const completion =
        fields.completed !== undefined && fields.completed !== old?.completed
          ? { completedAt: fields.completed ? Date.now() : undefined }
          : {};
      if (id)
        await ctx.db.patch(id, { ...fields, ...assignment, ...completion });
      else
        await ctx.db.insert('eventTasks', {
          eventId: event._id,
          title: fields.title?.trim() ?? '',
          completed: false,
          assignedToUserId: event.createdBy,
          assignedByUserId: actor,
          assignedAt: Date.now(),
          ...fields,
          ...assignment,
          ...completion,
        });
    }
  };
}
