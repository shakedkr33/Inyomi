import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import EventScreen from '@/lib/components/event/EventScreen';
import { saveCommunityTaskAssignments } from '@/lib/communityTaskAssignmentSave';
import {
  resolveCommunityTaskAssignmentDiff,
  resolvePersonalTaskAssignmentDiff,
} from '@/lib/eventTaskAssignmentDiff';
import type { FamilyMemberChip } from '@/lib/components/event/ParticipantsCard';
import type {
  EventAttachmentDraft,
  EventData,
  EventTask,
  Participant,
  RecurrenceType,
  Reminder,
} from '@/lib/types/event';
import { makeReminder } from '@/lib/types/event';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function offsetsToReminders(offsets: number[] | undefined): Reminder[] {
  if (!offsets || offsets.length === 0) return [makeReminder('hour_before')];
  return offsets.map((offsetMinutes) => {
    if (offsetMinutes === 0)
      return { preset: 'at_event' as const, offsetMinutes };
    if (offsetMinutes === 60)
      return { preset: 'hour_before' as const, offsetMinutes };
    if (offsetMinutes === 1440)
      return { preset: 'day_before' as const, offsetMinutes };
    return {
      preset: 'custom' as const,
      offsetMinutes,
      customValue: offsetMinutes,
      customUnit: 'minutes' as const,
    };
  });
}

function isRecurrenceType(value: unknown): value is RecurrenceType {
  return (
    value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'yearly'
  );
}

type ConvexAttachment = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

async function uploadDraftAttachmentsEdit(
  drafts: EventAttachmentDraft[],
  generateUrl: () => Promise<string>
): Promise<ConvexAttachment[]> {
  const results: ConvexAttachment[] = [];
  for (const draft of drafts) {
    if (draft.storageId && !draft.localUri) {
      results.push({
        storageId: draft.storageId,
        originalName: draft.originalName,
        displayName: draft.displayName,
        mimeType: draft.mimeType,
        sizeBytes: draft.sizeBytes,
      });
      continue;
    }
    if (!draft.localUri) continue;
    const uploadUrl = await generateUrl();
    const response = await fetch(draft.localUri);
    const blob = await response.blob();
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': draft.mimeType },
      body: blob,
    });
    if (!uploadResponse.ok) {
      throw new Error(`העלאת הקובץ נכשלה: ${draft.originalName}`);
    }
    const { storageId } = (await uploadResponse.json()) as {
      storageId: string;
    };
    results.push({
      storageId: storageId as Id<'_storage'>,
      originalName: draft.originalName,
      displayName: draft.displayName,
      mimeType: draft.mimeType,
      sizeBytes: draft.sizeBytes,
    });
  }
  return results;
}

type ConvexEvent = NonNullable<
  ReturnType<typeof useQuery<typeof api.events.getById>>
>;
type ConvexTask = NonNullable<
  ReturnType<typeof useQuery<typeof api.eventTasks.listByEvent>>
>[number];

function convexEventToEventData(
  event: ConvexEvent,
  tasks: ConvexTask[],
  familyMembers: FamilyMemberChip[] = []
): EventData {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);

  const dateMidnight = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate()
  ).getTime();
  const endDateMidnight = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate()
  ).getTime();

  const pad = (n: number) => String(n).padStart(2, '0');
  const startTimeStr = event.allDay
    ? undefined
    : `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const endTimeStr = event.allDay
    ? undefined
    : `${pad(end.getHours())}:${pad(end.getMinutes())}`;

  const savedOffsets = (event as { reminders?: number[] }).reminders;
  const remindersEnabled = Boolean(savedOffsets && savedOffsets.length > 0);
  const reminders = offsetsToReminders(
    remindersEnabled ? savedOffsets : undefined
  );

  const isLink = Boolean(event.onlineUrl?.trim());

  // Restore family sharing fields from the DB event record.
  const eventRecord = event as unknown as {
    sharedWithFamilyMemberIds?: string[];
    allFamily?: boolean;
    participants?: string[];
  };
  const familyIds = eventRecord.sharedWithFamilyMemberIds ?? [];
  const allFamilyFlag = eventRecord.allFamily ?? false;

  // Build lookup maps from the current user's family member list.
  const familyMemberById = new Map<string, FamilyMemberChip>(
    familyMembers.map((fm) => [fm._id, fm])
  );
  // Cross-reference by display name to identify family member names stored in the
  // legacy participants array (where names were saved alongside family member IDs).
  const familyMemberByName = new Map<string, FamilyMemberChip>(
    familyMembers
      .filter((fm) => Boolean(fm.displayName))
      .map((fm) => [fm.displayName as string, fm])
  );
  const familyIdsSet = new Set(familyIds);

  // External participants: names from the DB participants array that do NOT
  // correspond to any family member in sharedWithFamilyMemberIds.
  // This correctly handles old events where family member names were saved
  // in the participants array alongside their IDs in sharedWithFamilyMemberIds.
  const externalParticipants: Participant[] = (eventRecord.participants ?? [])
    .filter((name) => {
      const fm = familyMemberByName.get(name);
      return !fm || !familyIdsSet.has(fm._id);
    })
    .map((name) => ({ id: name, name, color: '#36a9e2' }));

  // Family participants: reconstructed from sharedWithFamilyMemberIds with the
  // correct entity row IDs so onFamilyChange filtering works during editing.
  const familyParticipants: Participant[] = familyIds
    .map((id) => familyMemberById.get(id))
    .filter((fm): fm is FamilyMemberChip => fm != null)
    .map((fm) => ({
      id: fm._id,
      name: fm.displayName ?? '',
      color: fm.color ?? '#36a9e2',
    }));

  const participants: Participant[] = [
    ...externalParticipants,
    ...familyParticipants,
  ];

  const eventTasks: EventTask[] = tasks.map((t) => ({
    id: t._id,
    title: t.title,
    completed: t.completed ?? false,
    assigneeId: t.assignedToUserId ?? undefined,
    assignedParticipantIds: t.assignedToManual?.trim()
      ? [t.assignedToManual.trim()]
      : t.assignedToUserId
        ? [t.assignedToUserId]
        : undefined,
  }));

  const attachments: EventAttachmentDraft[] = (event.attachments ?? []).map(
    (a) => ({
      storageId: a.storageId,
      originalName: a.originalName,
      displayName: a.displayName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })
  );

  return {
    title: event.title,
    date: dateMidnight,
    startTime: startTimeStr,
    endDate: endDateMidnight,
    endTime: endTimeStr,
    isAllDay: event.allDay ?? false,
    recurrence:
      event.isRecurring && isRecurrenceType(event.recurringPattern)
        ? event.recurringPattern
        : 'none',
    location: isLink ? undefined : (event.location ?? undefined),
    onlineUrl: isLink ? (event.onlineUrl ?? undefined) : undefined,
    locationUrl: isLink ? undefined : (event.locationUrl ?? undefined),
    notes: event.description ?? undefined,
    remindersEnabled,
    reminders,
    participants,
    sharedWithFamilyMemberIds: familyIds.length > 0 ? familyIds : undefined,
    allFamily: allFamilyFlag || undefined,
    tasks: eventTasks,
    tasksVisibleToParticipants: event.tasksVisibleToParticipants ?? false,
    showAllTasksToAll: false,
    createdAt: event._creationTime ?? Date.now(),
    attachments,
    importantItems: event.importantItems ?? [],
  };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditEventScreen(): React.JSX.Element {
  const { id, returnCommunityId } = useLocalSearchParams<{
    id: string;
    returnCommunityId?: string;
  }>();
  const router = useRouter();
  const eventId = id as Id<'events'>;

  const event = useQuery(api.events.getById, { eventId });
  const eventTasks = useQuery(api.eventTasks.listByEvent, { eventId });
  const currentUserId = useQuery(api.users.getMyId);
  const serverFamilyContacts = useQuery(api.members.listMyFamilyContacts);
  const familyMembers: FamilyMemberChip[] = useMemo(
    () =>
      (serverFamilyContacts?.members ?? [])
        .filter((m) => m._id !== serverFamilyContacts?.selfEntityId)
        .map((m) => ({
          _id: m._id,
          displayName: m.displayName,
          color: m.color,
        })),
    [serverFamilyContacts]
  );
  const communityMembersPack = useQuery(
    api.communities.getCommunityMembers,
    event?.communityId ? { communityId: event.communityId } : 'skip'
  );
  const communityTaskParticipants = useMemo(
    () =>
      (communityMembersPack?.members ?? []).map((member) => ({
        id: member.userId,
        name: member.fullName,
        email: member.email,
        color: '#36a9e2',
      })),
    [communityMembersPack]
  );

  const updateEventMutation = useMutation(api.events.update);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);
  const createEventTasks = useMutation(api.eventTasks.createBatch);
  const updateEventTask = useMutation(api.eventTasks.update);
  const removeEventTask = useMutation(api.eventTasks.remove);
  const setTaskAssignee = useMutation(api.eventTasks.setAssignee);

  const isCommunityEvent = Boolean(event?.communityId);

  const mayEditCommunityEvent = useMemo(() => {
    if (!event?.communityId || !currentUserId) return true;
    if (communityMembersPack === undefined || communityMembersPack === null) {
      return true;
    }
    const m = communityMembersPack.members?.find(
      (x) => x.userId === currentUserId
    );
    const isCreator = event.createdBy === currentUserId;
    const elevated = m?.role === 'owner' || m?.role === 'admin';
    return isCreator || elevated;
  }, [event, communityMembersPack, currentUserId]);

  useEffect(() => {
    if (event === undefined || event === null) return;
    if (!event.communityId || currentUserId === undefined) return;
    if (communityMembersPack === undefined || communityMembersPack === null) {
      return;
    }
    if (!mayEditCommunityEvent) {
      router.replace({
        pathname: '/(authenticated)/event/[id]',
        params: { id: eventId as string },
      });
    }
  }, [
    event,
    communityMembersPack,
    currentUserId,
    mayEditCommunityEvent,
    router,
    eventId,
  ]);

  const [rsvpRequired, setRsvpRequired] = useState(
    event?.requiresRsvp !== false
  );

  useEffect(() => {
    if (event) {
      setRsvpRequired(event.requiresRsvp !== false);
    }
  }, [event?._id, event?.requiresRsvp]);

  const handleSave = useCallback(
    async (data: EventData): Promise<string> => {
      const buildTs = (dateMs: number, timeStr?: string): number => {
        const [h, m] = (timeStr ?? '00:00').split(':').map(Number);
        const d = new Date(dateMs);
        d.setHours(h ?? 0, m ?? 0, 0, 0);
        return d.getTime();
      };

      const startTs = data.isAllDay
        ? new Date(data.date).setHours(0, 0, 0, 0)
        : buildTs(data.date, data.startTime);
      const endTs = data.isAllDay
        ? new Date(data.date).setHours(23, 59, 59, 999)
        : buildTs(data.endDate ?? data.date, data.endTime);

      const resolvedAttachments = await uploadDraftAttachmentsEdit(
        data.attachments ?? [],
        generateUploadUrl
      );

      // Build the participants list for persistence:
      // - Family members are tracked via sharedWithFamilyMemberIds (by entity row ID).
      // - The participants field stores ALL display names (family + external) so the
      //   profileCirclesExtraCount formula (totalParticipants - familyIds.length) in
      //   index.tsx / calendar.tsx gives the correct external count.
      const participantNames =
        data.participants.length > 0
          ? data.participants
              .map((p) => p.name)
              .filter((n) => n.trim().length > 0)
          : undefined;

      await updateEventMutation({
        id: eventId,
        title: data.title.trim(),
        description: data.notes?.trim() || undefined,
        startTime: startTs,
        endTime: endTs,
        allDay: data.isAllDay,
        ...(!isCommunityEvent
          ? {
              isRecurring: data.recurrence !== 'none',
              recurringPattern:
                data.recurrence !== 'none' ? data.recurrence : undefined,
            }
          : {}),
        location: data.onlineUrl
          ? undefined
          : data.location?.trim() || undefined,
        onlineUrl: data.onlineUrl?.trim() || undefined,
        locationUrl: data.onlineUrl ? undefined : data.locationUrl || undefined,
        tasksVisibleToParticipants: data.tasksVisibleToParticipants,
        requiresRsvp: rsvpRequired,
        participants: participantNames,
        // Preserve family sharing fields — previously these were omitted and
        // therefore silently cleared on every edit, which broke visibility for
        // shared family members.
        allFamily: data.allFamily || undefined,
        sharedWithFamilyMemberIds:
          data.sharedWithFamilyMemberIds &&
          data.sharedWithFamilyMemberIds.length > 0
            ? data.sharedWithFamilyMemberIds
            : undefined,
        attachments: resolvedAttachments,
        reminders: data.remindersEnabled
          ? data.reminders.map((r) => r.offsetMinutes)
          : [],
        importantItems: data.importantItems ?? [],
      });

      const assignmentUpdates: Array<() => Promise<unknown>> = [];

      // ── Task diff ────────────────────────────────────────────────────────────
      const originalIds = new Set(
        (eventTasks ?? []).map((t) => t._id as string)
      );
      const currentTasks = data.tasks;
      const currentExistingIds = new Set(
        currentTasks.filter((t) => originalIds.has(t.id)).map((t) => t.id)
      );

      const newTasks = currentTasks.filter((t) => !originalIds.has(t.id));
      if (newTasks.length > 0) {
        const taskIds = await createEventTasks({
          eventId,
          tasks: newTasks.map((t) => ({ title: t.title.trim() })),
        });
        for (let i = 0; i < newTasks.length; i++) {
          const task = newTasks[i];
          const taskId = taskIds[i];
          if (!taskId) continue;
          const assignedPid =
            task.assignedParticipantIds?.[0] ?? task.assigneeId;
          if (assignedPid && isCommunityEvent) {
            assignmentUpdates.push(() =>
              setTaskAssignee({
                id: taskId as Id<'eventTasks'>,
                assignee: {
                  type: 'user',
                  userId: assignedPid as Id<'users'>,
                },
              })
            );
            continue;
          }
          const assignedName = data.participants
            .find((p) => p.id === assignedPid)
            ?.name?.trim();
          if (assignedName) {
            await setTaskAssignee({
              id: taskId as Id<'eventTasks'>,
              assignee: { type: 'manual', name: assignedName },
            }).catch(() => {});
          }
        }
      }

      for (const task of currentTasks) {
        if (!originalIds.has(task.id)) continue;
        const orig = (eventTasks ?? []).find((t) => t._id === task.id);
        if (!orig) continue;
        if (orig.title !== task.title.trim()) {
          await updateEventTask({
            id: task.id as Id<'eventTasks'>,
            title: task.title.trim(),
          });
        }

        // BUGFIX — see lib/eventTaskAssignmentDiff.ts for the full root
        // cause writeup. In short: the previous inline computation here
        // (`task.assignedParticipantIds?.[0] ?? task.assigneeId`) silently
        // resurrected the stale, form-load-time `assigneeId` whenever the
        // editor cleared an assignment, so `setTaskAssignee` was never
        // called even though the UI showed the task as unassigned. These
        // pure helpers are the actual save-decision logic (not a
        // reimplementation) and are unit-tested directly.
        if (isCommunityEvent) {
          const diff = resolveCommunityTaskAssignmentDiff(task, orig);
          if (diff.changed) {
            assignmentUpdates.push(() =>
              setTaskAssignee({
                id: task.id as Id<'eventTasks'>,
                assignee: diff.assignee as {
                  type: 'user';
                  userId: Id<'users'>;
                } | null,
              })
            );
          }
          continue;
        }

        const diff = resolvePersonalTaskAssignmentDiff(
          task,
          orig,
          data.participants
        );
        if (diff.changed) {
          await setTaskAssignee({
            id: task.id as Id<'eventTasks'>,
            assignee: diff.assignee as { type: 'manual'; name: string } | null,
          }).catch(() => {});
        }
      }

      for (const orig of eventTasks ?? []) {
        if (!currentExistingIds.has(orig._id)) {
          await removeEventTask({ id: orig._id as Id<'eventTasks'> });
        }
      }

      // All non-assignment writes have finished. A failed assignment retries
      // only this tail, never uploads, event updates, task creation or deletion.
      const finishSave = (): string => {
        if (returnCommunityId) {
          router.replace({
            pathname: '/(authenticated)/community/[id]',
            params: { id: returnCommunityId },
          });
        } else if (router.canGoBack()) {
          router.back();
        } else {
          router.replace({
            pathname: '/(authenticated)/event/[id]',
            params: { id: eventId as string },
          });
        }
        return eventId;
      };
      return saveCommunityTaskAssignments(assignmentUpdates, finishSave);
    },
    [
      eventId,
      isCommunityEvent,
      rsvpRequired,
      eventTasks,
      updateEventMutation,
      generateUploadUrl,
      createEventTasks,
      updateEventTask,
      removeEventTask,
      setTaskAssignee,
      router,
      returnCommunityId,
    ]
  );

  const handleDismissEdit = useCallback(() => {
    if (returnCommunityId) {
      router.replace({
        pathname: '/(authenticated)/community/[id]',
        params: { id: returnCommunityId },
      });
    } else {
      router.back();
    }
  }, [router, returnCommunityId]);

  // useMemo ensures initialData is stable and computed as a hook (before any early
  // returns). This prevents the useState lazy initializer in EventScreen from
  // running with undefined initialData during Expo Router's animation/pre-render.
  // Gate on serverFamilyContacts so family member IDs are available when the form
  // loads — this allows convexEventToEventData to reconstruct participants with the
  // correct entity row IDs instead of raw names.
  const initialData = useMemo<EventData | null>(
    () => {
      if (
        event === undefined ||
        event === null ||
        eventTasks === undefined ||
        serverFamilyContacts === undefined
      ) {
        return null;
      }
      return convexEventToEventData(event, eventTasks, familyMembers);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event, eventTasks, serverFamilyContacts]
  );

  const headerTitle = isCommunityEvent ? 'עריכת אירוע קהילתי' : 'עריכת אירוע';

  if (!initialData) {
    return (
      <View style={s.loader}>
        <ActivityIndicator size="large" color="#36a9e2" />
      </View>
    );
  }

  return (
    <EventScreen
      key={eventId}
      mode="create"
      initialData={initialData}
      customHeaderTitle={headerTitle}
      context={isCommunityEvent ? 'community' : 'personal'}
      showParticipants={!isCommunityEvent}
      taskParticipants={
        isCommunityEvent ? communityTaskParticipants : undefined
      }
      showRsvpSection={isCommunityEvent}
      rsvpRequired={rsvpRequired}
      onRsvpRequiredChange={setRsvpRequired}
      showSuccessSheet={false}
      onSave={handleSave}
      onDismiss={handleDismissEdit}
    />
  );
}

const s = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
