import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import EventScreen from '@/lib/components/event/EventScreen';
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
  tasks: ConvexTask[]
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

  const participants: Participant[] = (event.participants ?? []).map(
    (name) => ({
      id: name,
      name,
      color: '#36a9e2',
    })
  );

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
    notes: event.description ?? undefined,
    remindersEnabled,
    reminders,
    participants,
    tasks: eventTasks,
    showAllTasksToAll: false,
    createdAt: event._creationTime ?? Date.now(),
    attachments,
  };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditEventScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const eventId = id as Id<'events'>;

  const event = useQuery(api.events.getById, { eventId });
  const eventTasks = useQuery(api.eventTasks.listByEvent, { eventId });

  const updateEventMutation = useMutation(api.events.update);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);
  const createEventTasks = useMutation(api.eventTasks.createBatch);
  const updateEventTask = useMutation(api.eventTasks.update);
  const removeEventTask = useMutation(api.eventTasks.remove);
  const setTaskAssignee = useMutation(api.eventTasks.setAssignee);

  const isCommunityEvent = Boolean(event?.communityId);

  const [rsvpRequired, setRsvpRequired] = useState(
    event?.requiresRsvp ?? false
  );

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

      await updateEventMutation({
        id: eventId,
        title: data.title.trim(),
        description: data.notes?.trim() || undefined,
        startTime: startTs,
        endTime: endTs,
        allDay: data.isAllDay || undefined,
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
        requiresRsvp: rsvpRequired,
        participants:
          data.participants.length > 0
            ? data.participants.map((p) => p.name)
            : undefined,
        attachments: resolvedAttachments,
        reminders: data.remindersEnabled
          ? data.reminders.map((r) => r.offsetMinutes)
          : [],
      });

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
        if (!orig || orig.title === task.title.trim()) continue;
        await updateEventTask({
          id: task.id as Id<'eventTasks'>,
          title: task.title.trim(),
        });
      }

      for (const orig of eventTasks ?? []) {
        if (!currentExistingIds.has(orig._id)) {
          await removeEventTask({ id: orig._id as Id<'eventTasks'> });
        }
      }

      router.back();
      return eventId;
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
    ]
  );

  // useMemo ensures initialData is stable and computed as a hook (before any early
  // returns). This prevents the useState lazy initializer in EventScreen from
  // running with undefined initialData during Expo Router's animation/pre-render.
  const initialData = useMemo<EventData | null>(
    () => {
      if (event === undefined || event === null || eventTasks === undefined) {
        return null;
      }
      return convexEventToEventData(event, eventTasks);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event, eventTasks]
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
      showRsvpSection={isCommunityEvent}
      rsvpRequired={rsvpRequired}
      onRsvpRequiredChange={setRsvpRequired}
      showSuccessSheet={false}
      onSave={handleSave}
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
