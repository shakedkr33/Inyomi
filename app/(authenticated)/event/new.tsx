import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import EventScreen from '@/lib/components/event/EventScreen';
import { buildDuplicateEventTemplate } from '@/lib/eventDuplication';
import {
  participantDetails,
  personalTaskEdits,
} from '@/lib/personalEventEditing';
import type { EventAttachmentDraft, EventData } from '@/lib/types/event';

const PRIMARY = '#36a9e2';

type DuplicateSourceEvent = NonNullable<
  ReturnType<typeof useQuery<typeof api.events.getById>>
>;
type DuplicateSourceTask = NonNullable<
  ReturnType<typeof useQuery<typeof api.eventTasks.listByEvent>>
>[number];

/**
 * Part D3–D9 — thin adapter from the Convex query payloads to the pure
 * `buildDuplicateEventTemplate` (lib/eventDuplication.ts), then to
 * EventScreen's `Partial<EventData>` shape. See that module's doc comment
 * for the exact copy/drop rules (tests live in
 * tests/convex/eventDuplication.test.ts).
 */
function buildDuplicateInitialData(
  source: DuplicateSourceEvent,
  tasks: DuplicateSourceTask[],
  todayMidnight: number
): Partial<EventData> {
  const template = buildDuplicateEventTemplate(source, tasks, todayMidnight);
  return {
    title: template.title,
    date: template.date,
    startTime: template.startTime,
    endDate: template.endDate,
    endTime: template.endTime,
    isAllDay: template.isAllDay,
    location: template.location,
    onlineUrl: template.onlineUrl,
    locationUrl: template.locationUrl,
    notes: template.notes,
    remindersEnabled: template.remindersEnabled,
    reminders: template.reminders,
    tasks: template.tasks,
    importantItems: template.importantItems,
    tasksVisibleToParticipants: template.tasksVisibleToParticipants,
    participants: [],
    attachments: [],
  };
}

// ─── Community Event Form ─────────────────────────────────────────────────────

function CommunityEventForm({
  communityId,
  duplicateFromEventId,
}: {
  communityId: string;
  duplicateFromEventId?: string;
}) {
  const router = useRouter();
  const [rsvpRequired, setRsvpRequired] = useState(false);

  const createEvent = useMutation(api.events.create);
  const createEventTasks = useMutation(api.eventTasks.createBatch);
  const setTaskAssignee = useMutation(api.eventTasks.setAssignee);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);
  const spaceId = useQuery(api.users.getMySpace);
  const communityMembersData = useQuery(api.communities.getCommunityMembers, {
    communityId: communityId as Id<'communities'>,
  });
  const communityMembers = communityMembersData?.members ?? [];

  // Part D3–D4 — the source event is fetched through the existing data layer
  // (api.events.getById / api.eventTasks.listByEvent), never serialized into
  // route params. `duplicateFromEventId` is the only extra piece of state
  // this route needs.
  const duplicateSourceEvent = useQuery(
    api.events.getById,
    duplicateFromEventId
      ? { eventId: duplicateFromEventId as Id<'events'> }
      : 'skip'
  );
  const duplicateSourceTasks = useQuery(
    api.eventTasks.listByEvent,
    duplicateFromEventId
      ? { eventId: duplicateFromEventId as Id<'events'> }
      : 'skip'
  );
  // Stage 3 correction — Part 3: server-side defense-in-depth. Re-derives
  // BOTH the community-match check AND the owner/admin permission check
  // from scratch (see convex/events.ts) — never trust `communityId` +
  // `duplicateFromEventId` route params independently, even though the
  // duplicate action is already hidden from unauthorized users in the UI.
  const duplicationVerdict = useQuery(
    api.events.verifyDuplicationSource,
    duplicateFromEventId
      ? {
          eventId: duplicateFromEventId as Id<'events'>,
          communityId: communityId as Id<'communities'>,
        }
      : 'skip'
  );
  const isDuplicateMode = Boolean(duplicateFromEventId);
  const isDuplicateSourceLoading =
    isDuplicateMode &&
    (duplicateSourceEvent === undefined ||
      duplicateSourceTasks === undefined ||
      duplicationVerdict === undefined);
  // Belt-and-suspenders client-side check on top of the server verdict —
  // the duplication template must never be built from an event belonging
  // to a different community than the one being duplicated into.
  const isDuplicateSourceValid =
    duplicationVerdict === 'ok' &&
    duplicateSourceEvent != null &&
    duplicateSourceEvent.communityId === communityId;
  const duplicateSourceRejected =
    isDuplicateMode && !isDuplicateSourceLoading && !isDuplicateSourceValid;

  // Fail safely: never silently prefill from a mismatched/forbidden source.
  // Bounce back to the community screen with an explanatory alert, the same
  // Alert + navigate-away pattern already used elsewhere in this form (see
  // handleUnifiedCommunitySave below).
  useEffect(() => {
    if (!duplicateSourceRejected) return;
    Alert.alert('שגיאה', 'לא ניתן לשכפל אירוע זה.', [
      {
        text: 'אישור',
        onPress: () =>
          router.replace(
            `/(authenticated)/community/${communityId}` as Parameters<
              typeof router.replace
            >[0]
          ),
      },
    ]);
  }, [duplicateSourceRejected, communityId, router]);

  const duplicateInitialData = useMemo(() => {
    if (
      !isDuplicateMode ||
      !isDuplicateSourceValid ||
      !duplicateSourceEvent ||
      !duplicateSourceTasks
    ) {
      return undefined;
    }
    const todayMidnight = new Date().setHours(0, 0, 0, 0);
    return buildDuplicateInitialData(
      duplicateSourceEvent,
      duplicateSourceTasks,
      todayMidnight
    );
  }, [
    isDuplicateMode,
    isDuplicateSourceValid,
    duplicateSourceEvent,
    duplicateSourceTasks,
  ]);

  // Part D4 — requiresRsvp is community-event-creation-form state
  // (rsvpRequired), not part of EventData — sync it once the source loads.
  const [rsvpSyncedForDuplicate, setRsvpSyncedForDuplicate] = useState(false);
  useEffect(() => {
    if (
      isDuplicateMode &&
      isDuplicateSourceValid &&
      !rsvpSyncedForDuplicate &&
      duplicateSourceEvent !== undefined &&
      duplicateSourceEvent !== null
    ) {
      setRsvpSyncedForDuplicate(true);
      setRsvpRequired(duplicateSourceEvent.requiresRsvp === true);
    }
  }, [
    isDuplicateMode,
    isDuplicateSourceValid,
    rsvpSyncedForDuplicate,
    duplicateSourceEvent,
  ]);

  const communityTaskParticipants = useMemo(
    () =>
      communityMembers.map((member) => ({
        id: member.userId,
        name: member.fullName,
        email: member.email,
        color: '#36a9e2',
      })),
    [communityMembers]
  );

  const handleUnifiedCommunitySave = useCallback(
    async (data: EventData): Promise<string> => {
      if (!spaceId && !communityId) {
        Alert.alert('שגיאה', 'לא נמצא מרחב פעיל. נסה להתנתק ולהתחבר מחדש.');
        throw new Error('לא נמצא מרחב פעיל');
      }

      const baseDate = new Date(data.date);
      const startTs =
        data.isAllDay || !data.startTime
          ? new Date(data.date).setHours(0, 0, 0, 0)
          : (() => {
              const [hStr, mStr] = data.startTime.split(':');
              const d = new Date(baseDate);
              d.setHours(Number(hStr ?? '9'), Number(mStr ?? '0'), 0, 0);
              return d.getTime();
            })();
      const endTs =
        data.isAllDay || !data.endTime
          ? new Date(data.date).setHours(23, 59, 59, 999)
          : (() => {
              const [hStr, mStr] = data.endTime.split(':');
              const endBase =
                data.endDate != null ? new Date(data.endDate) : baseDate;
              const d = new Date(
                endBase.getFullYear(),
                endBase.getMonth(),
                endBase.getDate()
              );
              d.setHours(Number(hStr ?? '10'), Number(mStr ?? '0'), 0, 0);
              return d.getTime();
            })();
      const resolvedAttachments = await uploadDraftAttachments(
        data.attachments ?? [],
        generateUploadUrl
      );

      const eventId = await createEvent({
        // FIXED: community creation now uses the shared base EventScreen form
        title: data.title.trim(),
        description: data.notes?.trim() || undefined,
        startTime: startTs,
        endTime: endTs,
        allDay: data.isAllDay || undefined,
        location: data.location?.trim() || undefined,
        onlineUrl: data.onlineUrl?.trim() || undefined,
        locationUrl: data.locationUrl || undefined,
        spaceId: (spaceId as Id<'spaces'> | null) ?? undefined,
        communityId: communityId as Id<'communities'>,
        tasksVisibleToParticipants: data.tasksVisibleToParticipants,
        requiresRsvp: rsvpRequired,
        attachments:
          resolvedAttachments.length > 0 ? resolvedAttachments : undefined,
        reminders: data.remindersEnabled
          ? data.reminders.map((r) => r.offsetMinutes)
          : [],
        importantItems:
          data.importantItems && data.importantItems.length > 0
            ? data.importantItems
            : undefined,
      });

      const tasksToCreate = data.tasks.filter(
        (task) => task.title.trim().length > 0
      );
      if (tasksToCreate.length > 0) {
        const taskIds = await createEventTasks({
          eventId,
          tasks: tasksToCreate.map((task) => ({ title: task.title.trim() })),
        });

        for (let i = 0; i < tasksToCreate.length; i++) {
          const task = tasksToCreate[i];
          const taskId = taskIds[i];
          const assigneeUserId =
            task.assignedParticipantIds?.[0] ?? task.assigneeId;
          if (taskId && assigneeUserId) {
            await setTaskAssignee({
              id: taskId as Id<'eventTasks'>,
              assignee: {
                type: 'user',
                userId: assigneeUserId as Id<'users'>,
              },
            }).catch(() => {});
          }
        }
      }

      router.replace(
        `/(authenticated)/community/${communityId}` as Parameters<
          typeof router.replace
        >[0]
      );
      return eventId;
    },
    [
      communityId,
      createEvent,
      createEventTasks,
      generateUploadUrl,
      router,
      rsvpRequired,
      setTaskAssignee,
      spaceId,
    ]
  );

  // Part D3 — `initialData` is applied once via EventScreen's useState
  // initializer, so it must not mount the form until the duplication
  // template is ready; otherwise it would mount empty and never pick up the
  // source data on the next render.
  //
  // Part 3 (Stage 3 correction) — a rejected/mismatched duplication source
  // must never render EventScreen with duplicate content, even briefly.
  // Keep showing the loading indicator until the alert-driven
  // router.replace() above actually navigates away.
  if (isDuplicateSourceLoading || duplicateSourceRejected) {
    return (
      <View style={styles.duplicateLoadingContainer}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    );
  }

  return (
    <EventScreen
      // initialData is only applied via useState's initializer — remount if
      // duplication finishes loading after an initial empty-state render.
      key={isDuplicateMode ? 'duplicate' : 'new'}
      mode="create"
      context="community"
      onSave={handleUnifiedCommunitySave}
      showParticipants={false}
      taskParticipants={communityTaskParticipants}
      showRsvpSection={true}
      rsvpRequired={rsvpRequired}
      onRsvpRequiredChange={setRsvpRequired}
      showSuccessSheet={false}
      initialData={duplicateInitialData}
      customHeaderTitle={
        isDuplicateMode ? 'שכפול אירוע — בחר תאריך חדש' : undefined
      }
      requireDateConfirmation={isDuplicateMode}
    />
  );
}

const styles = StyleSheet.create({
  duplicateLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ─── Upload helper ────────────────────────────────────────────────────────────
// FIXED: uploads draft attachments (localUri) to Convex Storage before saving.
// Returns the final list with storageId set and localUri stripped.
// uploadedBy is stamped by the backend mutation; we pass a placeholder here
// and let the mutation fill it using getAuthUserId(ctx).

// Shape accepted by the create/update mutation args (uploadedBy/uploadedAt stamped by backend)
type ConvexAttachment = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

async function uploadDraftAttachments(
  drafts: EventAttachmentDraft[],
  generateUrl: () => Promise<string>
): Promise<ConvexAttachment[]> {
  const results: ConvexAttachment[] = [];

  for (const draft of drafts) {
    if (draft.storageId && !draft.localUri) {
      // Already saved — pass through (storageId already typed as Id<'_storage'>)
      results.push({
        storageId: draft.storageId,
        originalName: draft.originalName,
        displayName: draft.displayName,
        mimeType: draft.mimeType,
        sizeBytes: draft.sizeBytes,
      });
      continue;
    }

    if (!draft.localUri) continue; // skip anything with neither

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

// ─── Route Entry ──────────────────────────────────────────────────────────────

export default function NewEventScreen(): React.JSX.Element {
  const {
    communityId,
    selectedDate: selectedDateParam,
    date: dateParam,
    returnTo,
    sourceView,
    sourceDate,
    sourceMonth,
    sourceCollapsed,
    prefillTitle,
    relatedBirthdayId,
    relatedBirthdayName,
    duplicateFromEventId,
  } = useLocalSearchParams<{
    communityId?: string;
    selectedDate?: string;
    date?: string;
    returnTo?: string;
    sourceView?: string;
    sourceDate?: string;
    sourceMonth?: string;
    sourceCollapsed?: string;
    prefillTitle?: string;
    relatedBirthdayId?: string;
    relatedBirthdayName?: string;
    /** Part D3 — community event duplication (see CommunityEventForm). */
    duplicateFromEventId?: string;
  }>();
  const router = useRouter();
  // FIXED: added generateUploadUrl + upload loop before createEvent for file attachments
  const createEvent = useMutation(api.events.create);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);
  // FIXED: persist personal event checklist tasks created in EventScreen
  // Use resolveMySpaceId-backed query so the event lands in the same space
  // that listByDateRange (calendar/home) reads from.
  // api.users.getMySpace used .first() which returned the wrong row for users
  // with multiple membership rows (e.g. own admin space + family member-access row).
  const spaceId = useQuery(api.members.getMyResolvedSpaceId);

  // Resolve initial date: prefer legacy numeric selectedDate, then YYYY-MM-DD date param.
  // Build local midnight timestamp to avoid UTC-offset day shift.
  const selectedDate = useMemo((): number | undefined => {
    if (selectedDateParam) return Number(selectedDateParam);
    if (dateParam) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
      if (match) {
        const y = Number(match[1]);
        const m = Number(match[2]) - 1;
        const d = Number(match[3]);
        const dt = new Date(y, m, d);
        if (!Number.isNaN(dt.getTime())) return dt.getTime();
      }
    }
    return undefined;
  }, [selectedDateParam, dateParam]);

  // Navigate back to the exact context the user came from.
  // Only used when returnTo is set.
  const navigateToReturnTarget = useCallback((): void => {
    if (returnTo === '/(authenticated)/birthdays') {
      router.replace('/(authenticated)/birthdays' as never);
      return;
    }
    if (returnTo === 'calendar') {
      if (sourceView === 'timeline') {
        router.replace({
          pathname: '/(authenticated)/calendar',
          params: {
            view: 'timeline',
            ...(sourceDate ? { date: sourceDate } : {}),
          },
        } as never);
        return;
      }
      if (sourceView === 'month') {
        router.replace({
          pathname: '/(authenticated)/calendar',
          params: {
            view: 'month',
            ...(sourceDate ? { date: sourceDate } : {}),
            ...(sourceMonth ? { month: sourceMonth } : {}),
            collapsed: sourceCollapsed ?? 'true',
          },
        } as never);
        return;
      }
    }
    // Safe fallback — always return to Calendar, never to Home.
    router.replace('/(authenticated)/calendar' as never);
  }, [returnTo, sourceView, sourceDate, sourceMonth, sourceCollapsed, router]);

  const handlePersonalSave = useCallback(
    async (data: EventData): Promise<string> => {
      // Block save if spaceId hasn't resolved — an event without spaceId
      // is invisible to listByDateRange and will never appear in the calendar.
      if (spaceId === undefined) {
        throw new Error('טוען נתונים, נסה שוב.');
      }
      if (spaceId === null) {
        throw new Error('לא נמצא מרחב אישי. נסה לצאת ולהיכנס מחדש.');
      }
      const resolvedSpaceId = spaceId as Id<'spaces'>;

      const baseDate = new Date(data.date);

      let startMs: number;
      if (data.startTime) {
        const [hStr, mStr] = data.startTime.split(':');
        const d = new Date(baseDate);
        d.setHours(Number(hStr ?? '9'), Number(mStr ?? '0'), 0, 0);
        startMs = d.getTime();
      } else {
        startMs = data.date;
      }

      let endMs: number;
      if (data.endTime) {
        const [hStr, mStr] = data.endTime.split(':');
        // Use endDate if provided (handles cross-midnight correctly),
        // fall back to startDate for events that finish on the same day.
        const endBase =
          data.endDate != null ? new Date(data.endDate) : baseDate;
        const d = new Date(
          endBase.getFullYear(),
          endBase.getMonth(),
          endBase.getDate()
        );
        d.setHours(Number(hStr ?? '10'), Number(mStr ?? '0'), 0, 0);
        endMs = d.getTime();
      } else {
        endMs = startMs + 60 * 60 * 1000; // default +1 hour
      }

      // Upload any new draft attachments (localUri set, storageId not yet set)
      const resolvedAttachments = await uploadDraftAttachments(
        data.attachments ?? [],
        generateUploadUrl
      );

      // FIXED: family sharing saved to event on creation
      // Let any Convex errors propagate — EventScreen.handleSave catches them
      // FIXED: return eventId so EventScreen can show the post-save success/share sheet
      const newEventId = await createEvent({
        participantDetails: participantDetails(data.participants),
        ...personalTaskEdits(data.tasks),
        title: data.title,
        description: data.notes?.trim() || undefined,
        startTime: startMs,
        endTime: endMs,
        allDay: data.isAllDay || undefined,
        isRecurring: data.recurrence !== 'none' || undefined,
        recurringPattern:
          data.recurrence !== 'none' ? data.recurrence : undefined,
        spaceId: resolvedSpaceId,
        location: data.location?.trim() || undefined,
        onlineUrl: data.onlineUrl?.trim() || undefined,
        locationUrl: data.locationUrl || undefined,
        tasksVisibleToParticipants: data.tasksVisibleToParticipants,
        participants:
          data.participants.length > 0
            ? data.participants
                .map((participant) => participant.name.trim())
                .filter((name) => name.length > 0)
            : undefined,
        allFamily: false,
        sharedWithFamilyMemberIds:
          data.sharedWithFamilyMemberIds &&
          data.sharedWithFamilyMemberIds.length > 0
            ? data.sharedWithFamilyMemberIds
            : undefined,
        sharedWithUserIds:
          data.sharedWithUserIds && data.sharedWithUserIds.length > 0
            ? (data.sharedWithUserIds as Id<'users'>[])
            : undefined,
        attachments:
          resolvedAttachments.length > 0 ? resolvedAttachments : undefined,
        reminders: data.remindersEnabled
          ? data.reminders.map((r) => r.offsetMinutes)
          : [],
        relatedType: relatedBirthdayId ? 'birthday' : undefined,
        relatedBirthdayId: relatedBirthdayId || undefined,
        relatedBirthdayName: relatedBirthdayName || undefined,
      });

      return newEventId;
    },
    [
      createEvent,
      generateUploadUrl,
      relatedBirthdayId,
      relatedBirthdayName,
      spaceId,
    ]
  );

  if (communityId) {
    return (
      <CommunityEventForm
        communityId={communityId}
        duplicateFromEventId={duplicateFromEventId}
      />
    );
  }

  return (
    <EventScreen
      key={selectedDate != null ? String(selectedDate) : 'default'}
      mode="create"
      onSave={handlePersonalSave}
      selectedDate={selectedDate}
      prefillTitle={prefillTitle || undefined}
      onDismiss={returnTo ? navigateToReturnTarget : undefined}
    />
  );
}
