import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
// FIXED: added file attachment support (prefill, section, upload loop in handleSave)
import type { LocalAssignee } from '@/lib/components/event/TaskAssigneeSheet';
import { TaskAssigneeSheet } from '@/lib/components/event/TaskAssigneeSheet';
import { EventAttachmentsSection } from '@/lib/components/event/EventAttachmentsSection';
import type { EventAttachmentDraft } from '@/lib/types/event';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

// ─── Upload helper (mirrors new.tsx) ─────────────────────────────────────────
// Returns the final attachment list with storageId set and localUri stripped.
// uploadedBy/uploadedAt are stamped by the backend mutation.

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

    const { storageId } = (await uploadResponse.json()) as { storageId: string };

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

type LocationType = 'address' | 'link';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTimestamp(date: Date, timeDate: Date): number {
  const result = new Date(date);
  result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
  return result.getTime();
}

// ─── Edit Event Form ───────────────────────────────────────────────────────────

export default function EditEventScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const eventId = id as Id<'events'>;

  const event = useQuery(api.events.getById, { eventId });
  const eventTasks = useQuery(api.eventTasks.listByEvent, { eventId });
  const updateEvent = useMutation(api.events.update);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);
  const createEventTasks = useMutation(api.eventTasks.createBatch);
  const updateEventTask = useMutation(api.eventTasks.update);
  const removeEventTask = useMutation(api.eventTasks.remove);
  const setTaskAssignee = useMutation(api.eventTasks.setAssignee);
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;
  const communityMembersData = useQuery(
    api.communities.getCommunityMembers,
    event?.communityId ? { communityId: event.communityId } : 'skip'
  );
  const communityMembers = communityMembersData?.members ?? [];

  const [tasks, setTasks] = useState<
    {
      id: string;
      title: string;
      isNew: boolean;
      assignee?: LocalAssignee | null;
    }[]
  >([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [assigneeSheetTaskId, setAssigneeSheetTaskId] = useState<string | null>(
    null
  );
  const [manualAssigneeName, setManualAssigneeName] = useState('');

  // ── Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('address');
  const [location, setLocation] = useState('');
  const [rsvpRequired, setRsvpRequired] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<EventAttachmentDraft[]>([]);

  // ── Date/time pickers
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [startTimeDate, setStartTimeDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [endTimeDate, setEndTimeDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    return d;
  });
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // ── Prefill form when event loads
  useEffect(() => {
    if (!event || event._id !== eventId) return;
    setTitle(event.title ?? '');
    setDescription(event.description ?? '');
    setAllDay(event.allDay ?? false);
    setRsvpRequired(event.requiresRsvp ?? false);

    const start = new Date(event.startTime);
    setSelectedDate(start);
    setStartTimeDate(new Date(start));
    setEndTimeDate(new Date(event.endTime));

    if (event.onlineUrl?.trim()) {
      setLocationType('link');
      setLocation(event.onlineUrl);
    } else {
      setLocationType('address');
      setLocation(event.location ?? '');
    }

    // Prefill attachments from saved event — map to EventAttachmentDraft (no localUri)
    setAttachments(
      (event.attachments ?? []).map((a) => ({
        storageId: a.storageId,
        originalName: a.originalName,
        displayName: a.displayName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      }))
    );
  }, [event, eventId]);

  // ── Reset tasks when event changes; prefill when eventTasks load
  useEffect(() => {
    setTasks([]);
  }, [eventId]);

  useEffect(() => {
    if (eventTasks === undefined) return;
    setTasks(
      (eventTasks ?? []).map((t) => {
        const enriched = t as typeof t & { assigneeDisplay?: string };
        const assignee: LocalAssignee | undefined = t.assignedToUserId
          ? {
              type: 'user',
              userId: t.assignedToUserId,
              display: enriched.assigneeDisplay ?? '',
            }
          : t.assignedToManual?.trim()
            ? { type: 'manual', name: t.assignedToManual.trim() }
            : undefined;
        return { id: t._id, title: t.title, isNew: false, assignee };
      })
    );
  }, [eventTasks]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setSaving(true);
    try {
      const startTs = allDay
        ? new Date(selectedDate).setHours(0, 0, 0, 0)
        : buildTimestamp(selectedDate, startTimeDate);
      const endTs = allDay
        ? new Date(selectedDate).setHours(23, 59, 59, 999)
        : buildTimestamp(selectedDate, endTimeDate);

      // Upload any new draft attachments before saving
      const resolvedAttachments = await uploadDraftAttachmentsEdit(
        attachments,
        generateUploadUrl
      );

      await updateEvent({
        id: eventId,
        title: title.trim(),
        description: description.trim() || undefined,
        startTime: startTs,
        endTime: endTs,
        allDay,
        location:
          locationType === 'address' ? location.trim() || undefined : undefined,
        onlineUrl:
          locationType === 'link' ? location.trim() || undefined : undefined,
        requiresRsvp: rsvpRequired,
        attachments: resolvedAttachments,
      });

      const existingIds = new Set(
        (eventTasks ?? []).map((t) => t._id as string)
      );
      const currentIds = new Set(
        tasks.filter((t) => !t.isNew).map((t) => t.id as string)
      );

      const newTasksList = tasks.filter((t) => t.isNew && t.title.trim());
      if (newTasksList.length > 0) {
        const taskIds = await createEventTasks({
          eventId,
          tasks: newTasksList.map((t) => ({ title: t.title.trim() })),
        });
        for (let i = 0; i < newTasksList.length; i++) {
          const task = newTasksList[i];
          const taskId = taskIds[i];
          if (taskId && task.assignee) {
            await setTaskAssignee({
              id: taskId as Id<'eventTasks'>,
              assignee:
                task.assignee.type === 'user'
                  ? {
                      type: 'user',
                      userId: task.assignee.userId as Id<'users'>,
                    }
                  : { type: 'manual', name: task.assignee.name },
            }).catch(() => {});
          }
        }
      }

      for (const t of tasks) {
        if (!t.isNew && existingIds.has(t.id)) {
          const orig = eventTasks?.find((x) => x._id === t.id);
          if (orig) {
            if (orig.title !== t.title.trim()) {
              await updateEventTask({
                id: t.id as Id<'eventTasks'>,
                title: t.title.trim(),
              });
            }
            // Detect assignee change
            const origAssignee: LocalAssignee | null = orig.assignedToUserId
              ? { type: 'user', userId: orig.assignedToUserId, display: '' }
              : orig.assignedToManual?.trim()
                ? { type: 'manual', name: orig.assignedToManual.trim() }
                : null;
            const localAssignee = t.assignee ?? null;
            const changed =
              JSON.stringify({
                type: origAssignee?.type,
                id:
                  origAssignee?.type === 'user'
                    ? origAssignee.userId
                    : origAssignee?.type === 'manual'
                      ? origAssignee.name
                      : null,
              }) !==
              JSON.stringify({
                type: localAssignee?.type,
                id:
                  localAssignee?.type === 'user'
                    ? localAssignee.userId
                    : localAssignee?.type === 'manual'
                      ? localAssignee.name
                      : null,
              });
            if (changed) {
              await setTaskAssignee({
                id: t.id as Id<'eventTasks'>,
                assignee:
                  localAssignee === null
                    ? null
                    : localAssignee.type === 'user'
                      ? {
                          type: 'user',
                          userId: localAssignee.userId as Id<'users'>,
                        }
                      : { type: 'manual', name: localAssignee.name },
              }).catch(() => {});
            }
          }
        }
      }

      for (const id of existingIds) {
        if (!currentIds.has(id)) {
          await removeEventTask({ id: id as Id<'eventTasks'> });
        }
      }

      router.replace({
        pathname: '/(authenticated)/event/[id]',
        params: { id: eventId },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'לא ניתן לשמור את האירוע';
      Alert.alert('שגיאה', msg);
    } finally {
      setSaving(false);
    }
  }, [
    title,
    description,
    selectedDate,
    startTimeDate,
    endTimeDate,
    allDay,
    location,
    locationType,
    rsvpRequired,
    eventId,
    updateEvent,
    generateUploadUrl,
    createEventTasks,
    updateEventTask,
    removeEventTask,
    setTaskAssignee,
    eventTasks,
    tasks,
    attachments,
    router,
  ]);

  const handleCancel = useCallback(() => {
    router.replace({
      pathname: '/(authenticated)/event/[id]',
      params: { id: eventId },
    });
  }, [router, eventId]);

  const isSaveDisabled = !title.trim() || saving;
  const dateLabel = selectedDate.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // ── Loading
  if (event === undefined) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingCenter}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Not found
  if (event === null) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingCenter}>
          <Text style={s.notFoundText}>אירוע לא נמצא</Text>
          <Pressable
            onPress={handleCancel}
            style={s.backBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={s.backBtnText}>חזור</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Unauthorized (not creator)
  if (currentUserId !== undefined && event.createdBy !== currentUserId) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingCenter}>
          <Text style={s.notFoundText}>אין לך הרשאה לערוך את האירוע</Text>
          <Pressable
            onPress={handleCancel}
            style={s.backBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={s.backBtnText}>חזור</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Cannot edit cancelled event
  if (event.status === 'cancelled') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingCenter}>
          <Text style={s.notFoundText}>לא ניתן לערוך אירוע שבוטל</Text>
          <Pressable
            onPress={handleCancel}
            style={s.backBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={s.backBtnText}>חזור</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={handleCancel}
          style={s.closeBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="סגור"
        >
          <Ionicons name="close" size={22} color="#374151" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>עריכת אירוע</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* שם האירוע */}
          <View style={s.card}>
            <Text style={s.fieldLabel}>
              שם האירוע <Text style={s.required}>*</Text>
            </Text>
            <TextInput
              style={[s.input, titleError && s.inputError]}
              value={title}
              onChangeText={(t) => {
                setTitle(t);
                if (t.trim()) setTitleError(false);
              }}
              placeholder="הכניסי שם לאירוע..."
              placeholderTextColor="#9ca3af"
              textAlign="right"
              maxLength={120}
              accessible
              accessibilityLabel="שם האירוע"
            />
            {titleError ? <Text style={s.errorText}>שדה זה נדרש</Text> : null}
          </View>

          {/* תאריך ושעה */}
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Switch
                value={allDay}
                onValueChange={setAllDay}
                trackColor={{ true: PRIMARY, false: '#e5e7eb' }}
                thumbColor="#fff"
                accessible
                accessibilityLabel="אירוע כל היום"
              />
              <Text style={s.fieldLabel}>כל היום</Text>
            </View>

            <Text style={[s.fieldLabel, { marginTop: 12 }]}>תאריך</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: 4,
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  setCalendarPickerOpen(!calendarPickerOpen);
                  setDatePickerOpen(false);
                }}
                style={s.calendarIconBtn}
                accessible
                accessibilityRole="button"
                accessibilityLabel="בחר מלוח שנה"
              >
                <Ionicons name="calendar-outline" size={20} color="#36a9e2" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.input, s.dateValueBtn]}
                onPress={() => {
                  setDatePickerOpen(!datePickerOpen);
                  setCalendarPickerOpen(false);
                }}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`תאריך: ${dateLabel}`}
              >
                <Text style={{ fontSize: 15, color: '#111827' }}>
                  {selectedDate.toLocaleDateString('he-IL', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </Text>
              </TouchableOpacity>
            </View>

            {datePickerOpen ? (
              <View style={[s.pickerWrapper, { width: '100%' }]}>
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="spinner"
                  themeVariant="light"
                  locale="he-IL"
                  textColor="#111827"
                  style={{ width: '100%', height: 180 }}
                  onChange={(_, date) => {
                    if (date) setSelectedDate(date);
                  }}
                />
                <TouchableOpacity
                  style={s.pickerConfirmBtn}
                  onPress={() => setDatePickerOpen(false)}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="אישור"
                >
                  <Text style={s.pickerConfirmText}>
                    {`אישור — ${selectedDate.toLocaleDateString('he-IL', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}`}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {calendarPickerOpen ? (
              <View
                style={{
                  backgroundColor: '#f3f4f6',
                  borderRadius: 12,
                  marginTop: 8,
                  overflow: 'hidden',
                }}
              >
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="inline"
                  themeVariant="light"
                  locale="he-IL"
                  accentColor="#36a9e2"
                  textColor="#111827"
                  onChange={(_, date) => {
                    if (date) {
                      setSelectedDate(date);
                      setTimeout(() => setCalendarPickerOpen(false), 150);
                    }
                  }}
                />
              </View>
            ) : null}

            {!allDay ? (
              <>
                <View style={s.timeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.timeLabel}>סיום</Text>
                    <TouchableOpacity
                      style={[s.input, s.pickerBtn]}
                      onPress={() => {
                        setShowEndPicker(!showEndPicker);
                        setShowStartPicker(false);
                      }}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`שעת סיום: ${endTimeDate.toLocaleTimeString(
                        'he-IL',
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                        }
                      )}`}
                    >
                      <Text style={{ fontSize: 15, color: '#111827' }}>
                        {endTimeDate.toLocaleTimeString('he-IL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.timeLabel}>התחלה</Text>
                    <TouchableOpacity
                      style={[s.input, s.pickerBtn]}
                      onPress={() => {
                        setShowStartPicker(!showStartPicker);
                        setShowEndPicker(false);
                      }}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`שעת התחלה: ${startTimeDate.toLocaleTimeString(
                        'he-IL',
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                        }
                      )}`}
                    >
                      <Text style={{ fontSize: 15, color: '#111827' }}>
                        {startTimeDate.toLocaleTimeString('he-IL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {showStartPicker ? (
                  <View
                    style={[s.pickerWrapper, { width: '100%', minHeight: 200 }]}
                  >
                    <DateTimePicker
                      value={startTimeDate}
                      mode="time"
                      display="spinner"
                      is24Hour
                      locale="he-IL"
                      themeVariant="light"
                      textColor="#111827"
                      style={{ width: '100%', height: 180 }}
                      onChange={(_, time) => {
                        if (time) setStartTimeDate(time);
                      }}
                    />
                    <TouchableOpacity
                      style={s.pickerConfirmBtn}
                      onPress={() => setShowStartPicker(false)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="אישור שעת התחלה"
                    >
                      <Text style={s.pickerConfirmText}>
                        {`אישור — ${startTimeDate.toLocaleTimeString('he-IL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {showEndPicker ? (
                  <View
                    style={[s.pickerWrapper, { width: '100%', minHeight: 200 }]}
                  >
                    <DateTimePicker
                      value={endTimeDate}
                      mode="time"
                      display="spinner"
                      is24Hour
                      locale="he-IL"
                      themeVariant="light"
                      textColor="#111827"
                      style={{ width: '100%', height: 180 }}
                      onChange={(_, time) => {
                        if (time) setEndTimeDate(time);
                      }}
                    />
                    <TouchableOpacity
                      style={s.pickerConfirmBtn}
                      onPress={() => setShowEndPicker(false)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="אישור שעת סיום"
                    >
                      <Text style={s.pickerConfirmText}>
                        {`אישור — ${endTimeDate.toLocaleTimeString('he-IL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>

          {/* מיקום */}
          <View style={s.card}>
            <Text style={s.fieldLabel}>מיקום</Text>
            <View style={s.chipRow}>
              {(
                [
                  ['address', 'כתובת'],
                  ['link', 'קישור'],
                ] as [LocationType, string][]
              ).map(([val, label]) => (
                <TouchableOpacity
                  key={val}
                  style={[s.chip, locationType === val && s.chipActive]}
                  onPress={() => setLocationType(val)}
                  accessible
                  accessibilityRole="button"
                  accessibilityState={{ selected: locationType === val }}
                  accessibilityLabel={label}
                >
                  <Text
                    style={[
                      s.chipText,
                      locationType === val && s.chipTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[s.input, { marginTop: 10 }]}
              value={location}
              onChangeText={setLocation}
              placeholder={
                locationType === 'address' ? 'רחוב, עיר...' : 'https://...'
              }
              placeholderTextColor="#9ca3af"
              textAlign="right"
              autoCapitalize="none"
              keyboardType={locationType === 'link' ? 'url' : 'default'}
              accessible
              accessibilityLabel={
                locationType === 'address' ? 'כתובת' : 'קישור'
              }
            />
          </View>

          {/* קבצים מצורפים */}
          <EventAttachmentsSection
            attachments={attachments}
            onChange={setAttachments}
          />

          {/* תיאור */}
          <View style={s.card}>
            <Text style={s.fieldLabel}>תיאור</Text>
            <TextInput
              style={[s.input, s.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="פרטים נוספים על האירוע..."
              placeholderTextColor="#9ca3af"
              textAlign="right"
              multiline
              numberOfLines={4}
              maxLength={500}
              accessible
              accessibilityLabel="תיאור"
            />
          </View>

          {/* משימות לאירוע */}
          <View style={s.card}>
            <Text style={s.fieldLabel}>משימות לאירוע</Text>
            {tasks.length > 0 && (
              <View style={s.tasksList}>
                {tasks.map((t) => (
                  <View key={t.id} style={s.taskRow}>
                    <TouchableOpacity
                      onPress={() =>
                        setTasks((prev) => prev.filter((x) => x.id !== t.id))
                      }
                      style={s.taskRemoveBtn}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="הסר משימה"
                    >
                      <Ionicons name="close-circle" size={20} color="#9ca3af" />
                    </TouchableOpacity>
                    <View style={s.taskContent}>
                      <Text style={s.taskTitle} numberOfLines={2}>
                        {t.title}
                      </Text>
                      {t.assignee ? (
                        <TouchableOpacity
                          onPress={() => {
                            setAssigneeSheetTaskId(t.id);
                            setManualAssigneeName('');
                          }}
                          style={s.assigneeChip}
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel={`ממונה: ${t.assignee.type === 'user' ? t.assignee.display : t.assignee.name}`}
                        >
                          <Ionicons name="person" size={12} color="#6b7280" />
                          <Text style={s.assigneeChipText} numberOfLines={1}>
                            {t.assignee.type === 'user'
                              ? t.assignee.display
                              : t.assignee.name}
                          </Text>
                        </TouchableOpacity>
                      ) : communityMembers.length > 0 ? (
                        <TouchableOpacity
                          onPress={() => {
                            setAssigneeSheetTaskId(t.id);
                            setManualAssigneeName('');
                          }}
                          style={s.assignBtn}
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel="הקצה משימה"
                        >
                          <Ionicons
                            name="person-add-outline"
                            size={12}
                            color={PRIMARY}
                          />
                          <Text style={s.assignBtnText}>הקצה</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
            {/* New task input row */}
            <View style={s.newTaskInputRow}>
              <TouchableOpacity
                onPress={() => {
                  if (!newTaskText.trim()) return;
                  setTasks((prev) => [
                    ...prev,
                    {
                      id: `tmp-${Date.now()}`,
                      title: newTaskText.trim(),
                      isNew: true,
                    },
                  ]);
                  setNewTaskText('');
                }}
                style={[
                  s.addTaskBtn,
                  !newTaskText.trim() && s.addTaskBtnDisabled,
                ]}
                disabled={!newTaskText.trim()}
                accessible
                accessibilityRole="button"
                accessibilityLabel="הוסף משימה"
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={newTaskText.trim() ? PRIMARY : '#9ca3af'}
                />
                <Text
                  style={[
                    s.addTaskText,
                    !newTaskText.trim() && s.addTaskTextDisabled,
                  ]}
                >
                  הוסף
                </Text>
              </TouchableOpacity>
              <TextInput
                style={[s.input, s.newTaskInput]}
                value={newTaskText}
                onChangeText={setNewTaskText}
                placeholder="כתוב משימה..."
                placeholderTextColor="#9ca3af"
                textAlign="right"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (!newTaskText.trim()) return;
                  setTasks((prev) => [
                    ...prev,
                    {
                      id: `tmp-${Date.now()}`,
                      title: newTaskText.trim(),
                      isNew: true,
                    },
                  ]);
                  setNewTaskText('');
                }}
                accessible
                accessibilityLabel="משימה חדשה"
              />
            </View>
          </View>

          {/* RSVP */}
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Switch
                value={rsvpRequired}
                onValueChange={setRsvpRequired}
                trackColor={{ true: PRIMARY, false: '#e5e7eb' }}
                thumbColor="#fff"
                accessible
                accessibilityLabel="נדרש אישור הגעה"
              />
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.fieldLabel}>נדרש אישור הגעה</Text>
                <Text style={s.fieldSub}>חברי הקהילה יצטרכו לאשר השתתפות</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Save button */}
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.saveBtn, isSaveDisabled && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaveDisabled}
            accessible
            accessibilityRole="button"
            accessibilityLabel="שמור שינויים"
          >
            <Text
              style={[s.saveBtnText, isSaveDisabled && s.saveBtnTextDisabled]}
            >
              {saving ? 'שומר...' : 'שמור שינויים'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Assignee sheet */}
      <TaskAssigneeSheet
        visible={!!assigneeSheetTaskId}
        currentAssignee={
          tasks.find((t) => t.id === assigneeSheetTaskId)?.assignee ?? null
        }
        members={communityMembers}
        currentUserId={currentUserId}
        isCreator
        manualName={manualAssigneeName}
        onManualNameChange={setManualAssigneeName}
        onSelectUser={(userId, display) => {
          if (!assigneeSheetTaskId) return;
          setTasks((prev) =>
            prev.map((t) =>
              t.id === assigneeSheetTaskId
                ? { ...t, assignee: { type: 'user', userId, display } }
                : t
            )
          );
          setAssigneeSheetTaskId(null);
        }}
        onSelectManual={() => {
          if (!assigneeSheetTaskId || !manualAssigneeName.trim()) return;
          const name = manualAssigneeName.trim();
          setTasks((prev) =>
            prev.map((t) =>
              t.id === assigneeSheetTaskId
                ? { ...t, assignee: { type: 'manual', name } }
                : t
            )
          );
          setAssigneeSheetTaskId(null);
          setManualAssigneeName('');
        }}
        onUnassign={() => {
          if (!assigneeSheetTaskId) return;
          setTasks((prev) =>
            prev.map((t) =>
              t.id === assigneeSheetTaskId ? { ...t, assignee: null } : t
            )
          );
          setAssigneeSheetTaskId(null);
        }}
        onClose={() => {
          setAssigneeSheetTaskId(null);
          setManualAssigneeName('');
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },

  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  notFoundText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  backBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: { padding: 16, gap: 12, paddingBottom: 24 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
    marginBottom: 8,
  },
  fieldSub: { fontSize: 12, color: '#9ca3af', textAlign: 'right' },
  required: { color: '#ef4444' },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'right',
    marginTop: 4,
  },

  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fafafa',
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  inputError: { borderColor: '#ef4444' },

  pickerBtn: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },

  pickerWrapper: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
  },
  pickerConfirmBtn: {
    backgroundColor: '#36a9e2',
    margin: 12,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pickerConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  calendarIconBtn: {
    width: 36,
    height: 36,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateValueBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingVertical: 10,
  },

  timeRow: { flexDirection: 'row-reverse', gap: 12, marginTop: 10 },
  timeLabel: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 6,
  },

  tasksList: { gap: 4, marginBottom: 8 },
  taskRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  taskRemoveBtn: { padding: 4, marginTop: 2 },
  taskContent: { flex: 1, gap: 4 },
  taskTitle: { fontSize: 14, color: '#374151', textAlign: 'right' },
  assigneeChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  assigneeChipText: { fontSize: 12, color: '#6b7280' },
  assignBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
  },
  assignBtnText: { fontSize: 12, color: PRIMARY, fontWeight: '600' },
  newTaskInputRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  newTaskInput: { flex: 1, marginTop: 0 },
  addTaskBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  addTaskBtnDisabled: { opacity: 0.4 },
  addTaskText: { fontSize: 14, color: PRIMARY, fontWeight: '600' },
  addTaskTextDisabled: { color: '#9ca3af' },
  chipRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f1f5f9',
  },
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#e5e7eb' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  saveBtnTextDisabled: { color: '#9ca3af' },
});
