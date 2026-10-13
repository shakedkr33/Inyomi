import type { Id } from '../convex/_generated/dataModel';
import { resolvePersonalTaskAssignmentDiff } from './eventTaskAssignmentDiff';
import type { EventData, EventTask, Participant } from './types/event';

export function personalAssignmentChoices(
  creator: Id<'users'> | null | undefined,
  participants: Participant[]
): Participant[] {
  if (!creator) return [];
  const choices: Participant[] = [
    {
      id: creator,
      userId: creator,
      name: 'אני',
      color: '#36a9e2',
      source: 'user',
    },
  ];
  for (const participant of participants) {
    if (
      participant.userId &&
      participant.assignmentEligible !== false &&
      !choices.some((p) => p.userId === participant.userId)
    )
      choices.push({ ...participant, id: participant.userId });
  }
  return choices;
}

export function participantDetails(participants: Participant[]) {
  return participants.map(({ id, name, color, source, userId }) => ({
    id,
    name,
    color,
    source: source ?? 'legacy',
    ...(userId ? { userId } : {}),
  }));
}

export function personalTaskEdits(
  tasks: EventTask[],
  original: readonly {
    _id: Id<'eventTasks'>;
    title: string;
    completed: boolean;
    order?: number;
    assignedToUserId?: Id<'users'>;
    assignedToManual?: string;
  }[] = []
) {
  const changes: Array<{
    id?: Id<'eventTasks'>;
    title?: string;
    completed?: boolean;
    order?: number;
    assignee?: Id<'users'> | null;
  }> = [];
  const orderChanged =
    tasks.length !== original.length ||
    tasks.some((task, index) => original[index]?._id !== task.id);
  tasks.forEach((task, order) => {
    const old = original.find((t) => t._id === task.id);
    const change: (typeof changes)[number] = old
      ? { id: old._id }
      : { title: task.title.trim(), completed: task.completed, order };
    if (old) {
      if (old.title !== task.title.trim()) change.title = task.title.trim();
      if (old.completed !== task.completed) change.completed = task.completed;
      if (orderChanged && old.order !== order) change.order = order;
    }
    // Form identity is an account ID, never a display name. Undefined means
    // untouched; legacy/manual/unresolved assignments survive unrelated edits.
    const selected = task.assignedParticipantIds?.[0];
    if (old) {
      const diff = resolvePersonalTaskAssignmentDiff(
        {
          ...task,
          assigneeId:
            old.assignedToUserId ??
            (old.assignedToManual ? `legacy-task:${old._id}` : undefined),
        },
        old,
        selected ? [{ id: selected, userId: selected, name: '' }] : []
      );
      if (diff.changed)
        change.assignee =
          diff.assignee?.type === 'user'
            ? (diff.assignee.userId as Id<'users'>)
            : null;
    } else if (task.assignedParticipantIds !== undefined) {
      change.assignee = selected ? (selected as Id<'users'>) : null;
    }
    if (!old || Object.keys(change).length > 1) changes.push(change);
  });
  return {
    personalTaskChanges: changes,
    deletedPersonalTaskIds: original
      .filter((t) => !tasks.some((next) => next.id === t._id))
      .map((t) => t._id),
  };
}

// Both carousel and sheet use this state transition. Other invitations and
// unresolvable historical profiles are preserved, and allFamily is untouched.
export function selectFamilyParticipants(
  event: EventData,
  ids: string[],
  family: readonly {
    _id: string;
    displayName?: string;
    color?: string;
    linkedUserId?: Id<'users'>;
  }[]
): Partial<EventData> {
  const removed = [
    ...new Set([
      ...(event.sharedWithFamilyMemberIds ?? []),
      ...event.participants
        .filter((p) => p.source === 'family')
        .map((p) => p.id),
    ]),
  ].filter((id) => !ids.includes(id));
  const removedUsers = new Set<string>(
    event.participants
      .filter((p) => removed.includes(p.id))
      .flatMap((p) => (p.userId ? [p.userId] : []))
  );
  const kept = event.participants.filter((p) => !removed.includes(p.id));
  const participants = [...kept];
  for (const id of ids) {
    if (participants.some((p) => p.id === id)) continue;
    const profile = family.find((p) => p._id === id);
    if (profile)
      participants.push({
        id,
        name: profile.displayName ?? '',
        color: profile.color ?? '#36a9e2',
        source: 'family',
        userId: profile.linkedUserId,
      });
  }
  const sharedWithUserIds = [
    ...new Set([
      ...(event.sharedWithUserIds ?? []).filter(
        (id) =>
          !removedUsers.has(id) || participants.some((p) => p.userId === id)
      ),
      ...participants
        .filter((p) => !event.participants.some((old) => old.id === p.id))
        .flatMap((p) => (p.userId ? [p.userId] : [])),
    ]),
  ];
  return {
    participants,
    sharedWithFamilyMemberIds: ids.filter(
      (id) =>
        event.sharedWithFamilyMemberIds?.includes(id) ||
        (!event.participants.some((p) => p.id === id) &&
          family.some((p) => p._id === id && p.linkedUserId))
    ),
    sharedWithUserIds,
  };
}
