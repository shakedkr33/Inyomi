import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery } from 'convex/react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import { uploadAttachmentDraftsForConvex } from '@/lib/attachmentUpload';
import { EventAttachmentsSection } from '@/lib/components/event/EventAttachmentsSection';
import { TimeWheelPicker } from '@/lib/components/time/TimeWheelPicker';
import { APP_IS_RTL, rtl } from '@/lib/rtl';
import type { EventAttachmentDraft } from '@/lib/types/event';
import type {
  PersistedTaskReminderType,
  TaskReminder,
  TaskReminderUnit,
} from '@/lib/types/task';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#00668E';

type DateOption = 'today' | 'tomorrow' | 'other' | 'none';

/** Reminder options shown when the task has a date but no specific time. */
const DATE_REMINDERS: {
  key: 'none' | PersistedTaskReminderType;
  label: string;
}[] = [
  { key: 'none', label: 'ללא' },
  { key: 'morning', label: 'בבוקר' },
  { key: 'evening', label: 'בערב' },
  { key: 'custom', label: 'מותאם אישית' },
];

/** Reminder options shown when the task has a specific due time. */
const TIME_REMINDERS: {
  key: 'none' | PersistedTaskReminderType;
  label: string;
}[] = [
  { key: 'none', label: 'ללא' },
  { key: 'at_time', label: 'בזמן' },
  { key: 'hour_before', label: 'שעה לפני' },
  { key: 'custom', label: 'מותאם אישית' },
];

const UNIT_LABELS: Record<TaskReminderUnit, string> = {
  minutes: 'דקות',
  hours: 'שעות',
  days: 'ימים',
};

// ─── Pure helpers (mirror TaskEditorScreen helpers exactly) ───────────────────

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function midnightOf(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

function unitToMinutes(amount: number, unit: TaskReminderUnit): number {
  if (unit === 'hours') return amount * 60;
  if (unit === 'days') return amount * 1440;
  return amount;
}

function customReminderTimestamp(
  baseTimestamp: number,
  amount: number,
  unit: TaskReminderUnit
): number {
  return baseTimestamp - unitToMinutes(amount, unit) * 60 * 1000;
}

function resolveReminderTimestamp(
  reminder: TaskReminder,
  schedule: { dueDate?: number; dueAt?: number; hasTime: boolean }
): number | undefined {
  if (reminder.type === 'morning') {
    return schedule.dueDate !== undefined
      ? schedule.dueDate + 9 * 60 * 60 * 1000
      : undefined;
  }
  if (reminder.type === 'evening') {
    return schedule.dueDate !== undefined
      ? schedule.dueDate + 18 * 60 * 60 * 1000
      : undefined;
  }
  if (reminder.type === 'at_time') {
    return schedule.hasTime ? schedule.dueAt : undefined;
  }
  if (reminder.type === 'hour_before') {
    return schedule.hasTime && schedule.dueAt !== undefined
      ? schedule.dueAt - 60 * 60 * 1000
      : undefined;
  }
  // custom — resolve from amount/unit, falling back to stored customReminderAt
  const baseTimestamp =
    schedule.dueAt ??
    (schedule.dueDate !== undefined
      ? schedule.dueDate + 9 * 60 * 60 * 1000
      : undefined);
  if (
    baseTimestamp !== undefined &&
    reminder.customAmount !== undefined &&
    reminder.customUnit !== undefined
  ) {
    return customReminderTimestamp(
      baseTimestamp,
      reminder.customAmount,
      reminder.customUnit
    );
  }
  return reminder.customReminderAt;
}

function normalizeTaskReminders({
  reminders,
  dueDate,
  dueAt,
  hasTime,
  now,
}: {
  reminders: TaskReminder[];
  dueDate?: number;
  dueAt?: number;
  hasTime: boolean;
  now: number;
}): TaskReminder[] {
  if (dueDate === undefined) return [];
  return reminders.flatMap((reminder) => {
    const reminderAt = resolveReminderTimestamp(reminder, {
      dueDate,
      dueAt,
      hasTime,
    });
    if (reminderAt === undefined || reminderAt < now) return [];
    if (reminder.type !== 'custom') return [reminder];
    return [{ ...reminder, customReminderAt: reminderAt }];
  });
}

// ─── UI sub-components ────────────────────────────────────────────────────────

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {text}
      {required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

/** Build a fresh 09:00 Date for the default time picker state. */
function makeDefaultTime(): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

export default function CommunityReminderNewScreen() {
  const router = useRouter();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  // ── Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateOption, setDateOption] = useState<DateOption>('today');
  const [customDate, setCustomDate] = useState<Date>(new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [timeEnabled, setTimeEnabled] = useState(false);
  const [selectedTime, setSelectedTime] = useState<Date>(makeDefaultTime);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // ── Reminder state — same model as TaskEditorScreen (TaskReminder[])
  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [customAmount, setCustomAmount] = useState(30);
  const [customUnit, setCustomUnit] = useState<TaskReminderUnit>('minutes');
  const [showCustomReminderModal, setShowCustomReminderModal] = useState(false);

  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Attachments state
  const [attachments, setAttachments] = useState<EventAttachmentDraft[]>([]);

  // ── Reset-on-focus flag — set after successful save or cancel so the next
  // time the screen gains focus (Expo Router reuses the mounted component)
  // all form state is returned to clean defaults.
  // Not triggered by attachment picker or other temporary focus loss events.
  const shouldResetOnFocus = useRef(false);

  const resetForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setDateOption('today');
    setCustomDate(new Date());
    setDatePickerOpen(false);
    setCalendarPickerOpen(false);
    setTimeEnabled(false);
    setSelectedTime(makeDefaultTime());
    setShowTimePicker(false);
    setReminders([]);
    setCustomAmount(30);
    setCustomUnit('minutes');
    setShowCustomReminderModal(false);
    setAttachments([]);
    setTitleError(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (shouldResetOnFocus.current) {
        shouldResetOnFocus.current = false;
        resetForm();
      }
    }, [resetForm])
  );

  // ── Backend
  const spaceId = useQuery(api.users.getMySpace);
  const createReminder = useMutation(api.tasks.create);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);

  // ── Derived reminder state
  const currentCustomReminder = reminders.find((r) => r.type === 'custom');
  const activeReminderOptions = timeEnabled ? TIME_REMINDERS : DATE_REMINDERS;

  const getReminderChipLabel = (
    key: 'none' | PersistedTaskReminderType
  ): string => {
    if (key === 'custom' && currentCustomReminder) {
      if (currentCustomReminder.label) return currentCustomReminder.label;
      const amt = currentCustomReminder.customAmount ?? customAmount;
      const unit = currentCustomReminder.customUnit ?? customUnit;
      return `${amt} ${UNIT_LABELS[unit]} לפני`;
    }
    return activeReminderOptions.find((opt) => opt.key === key)?.label ?? key;
  };

  const isReminderActive = (
    key: 'none' | PersistedTaskReminderType
  ): boolean => {
    if (key === 'none') return reminders.length === 0;
    return reminders.some((r) => r.type === key);
  };

  // ── Resolve due date as midnight-epoch and dueAt as timestamped epoch
  const resolveDueDate = useCallback((): number | undefined => {
    if (dateOption === 'none') return undefined;
    if (dateOption === 'today') return midnightOf(new Date());
    if (dateOption === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return midnightOf(d);
    }
    if (dateOption === 'other') return midnightOf(customDate);
    return undefined;
  }, [dateOption, customDate]);

  const resolveDueAt = useCallback(
    (dueDateMs: number): number => {
      const d = new Date(dueDateMs);
      d.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
      return d.getTime();
    },
    [selectedTime]
  );

  // ── Toggle a reminder type (mirrors TaskEditorScreen.toggleReminder)
  const toggleReminder = (key: 'none' | PersistedTaskReminderType): void => {
    if (key === 'none') {
      setReminders([]);
      return;
    }
    if (key === 'custom') {
      // Pre-fill modal from existing custom reminder, then open
      setCustomAmount(currentCustomReminder?.customAmount ?? 30);
      setCustomUnit(currentCustomReminder?.customUnit ?? 'minutes');
      setShowCustomReminderModal(true);
      return;
    }
    const alreadyHas = reminders.some((r) => r.type === key);
    const optionLabel =
      activeReminderOptions.find((opt) => opt.key === key)?.label ?? key;
    const nextReminders: TaskReminder[] = alreadyHas
      ? reminders.filter((r) => r.type !== key)
      : [
          ...reminders,
          {
            id: createId('reminder'),
            type: key,
            label: optionLabel,
          },
        ];
    setReminders(nextReminders);
  };

  // ── Confirm custom reminder (mirrors TaskEditorScreen.confirmCustomReminder)
  const confirmCustomReminder = (): void => {
    const dueDateMs = resolveDueDate();
    if (dueDateMs === undefined) {
      setShowCustomReminderModal(false);
      return;
    }
    const hasTime = timeEnabled;
    const dueAtMs = hasTime ? resolveDueAt(dueDateMs) : undefined;
    const baseTimestamp = dueAtMs ?? dueDateMs + 9 * 60 * 60 * 1000;
    const reminderAt = customReminderTimestamp(
      baseTimestamp,
      customAmount,
      customUnit
    );

    if (reminderAt < Date.now()) {
      Alert.alert('שגיאה', 'התזכורת שבחרת כבר עברה');
      return;
    }
    if (reminderAt > baseTimestamp) {
      Alert.alert('שגיאה', 'אי אפשר לבחור תזכורת אחרי מועד המשימה');
      return;
    }

    const nextCustom: TaskReminder = {
      id: currentCustomReminder?.id ?? createId('reminder'),
      type: 'custom',
      customAmount,
      customUnit,
      customReminderAt: reminderAt,
      label: `תזכורת: ${customAmount} ${UNIT_LABELS[customUnit]} לפני`,
    };
    setReminders([...reminders.filter((r) => r.type !== 'custom'), nextCustom]);
    setShowCustomReminderModal(false);
  };

  // ── Save
  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }

    // Only require spaceId when there's no communityId context
    if (!spaceId && !communityId) {
      Alert.alert('שגיאה', 'לא נמצא מרחב פעיל. נסה להתנתק ולהתחבר מחדש.');
      return;
    }

    setSaving(true);
    try {
      const dueDateMs = resolveDueDate();
      const hasTime = dateOption !== 'none' && timeEnabled;
      const dueAtMs =
        hasTime && dueDateMs !== undefined
          ? resolveDueAt(dueDateMs)
          : undefined;

      const now = Date.now();
      const normalizedReminders = normalizeTaskReminders({
        reminders,
        dueDate: dueDateMs,
        dueAt: dueAtMs,
        hasTime,
        now,
      });
      const firstReminder = normalizedReminders[0];

      // Upload any attachment drafts (localUri-based) to Convex Storage
      const uploadedAttachments = await uploadAttachmentDraftsForConvex(
        attachments,
        () => generateUploadUrl()
      );

      // Payload — with reminder configured:
      //   { ..., dueDate, hasTime: true, dueAt, reminderType, customReminderAt?, reminders }
      // Payload — without reminder configured:
      //   { ..., dueDate, reminderType: 'none' }
      await createReminder({
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDateMs,
        ...(hasTime ? { hasTime: true, dueAt: dueAtMs } : {}),
        reminderType: firstReminder?.type ?? 'none',
        ...(firstReminder?.type === 'custom'
          ? { customReminderAt: firstReminder.customReminderAt }
          : {}),
        ...(normalizedReminders.length > 0
          ? { reminders: normalizedReminders }
          : {}),
        ...(uploadedAttachments.length > 0
          ? { attachments: uploadedAttachments }
          : {}),
        spaceId: spaceId ? (spaceId as Id<'spaces'>) : undefined,
        communityId: communityId
          ? (communityId as Id<'communities'>)
          : undefined,
      });
      // Reset state immediately so the next create session starts clean.
      // We reset before navigating so if Expo Router reuses this component
      // instance on the next "Add reminder" tap, no stale data remains.
      resetForm();
      if (communityId) {
        router.replace(
          `/(authenticated)/community/${communityId}` as Parameters<
            typeof router.replace
          >[0]
        );
      } else {
        router.back();
      }
    } catch (e) {
      console.error('createReminder error:', e);
      const message =
        e instanceof Error ? e.message : 'לא ניתן לשמור את התזכורת. נסה שוב.';
      Alert.alert('שגיאה', message);
    } finally {
      setSaving(false);
    }
  }, [
    title,
    description,
    spaceId,
    communityId,
    dateOption,
    timeEnabled,
    reminders,
    attachments,
    createReminder,
    generateUploadUrl,
    resetForm,
    router,
    resolveDueDate,
    resolveDueAt,
  ]);

  // ── Save disabled only while loading (undefined) or title is empty
  const isSaveDisabled = !title.trim() || saving || spaceId === undefined;

  const handleClose = () => {
    // Mark that the form should be reset the next time this screen gains focus.
    // This handles abandoned (cancelled) create flows — if the user presses ×
    // and later opens "Add reminder" again, a fresh form is shown.
    shouldResetOnFocus.current = true;
    if (communityId) {
      router.replace(
        `/(authenticated)/community/${communityId}` as Parameters<
          typeof router.replace
        >[0]
      );
    } else {
      router.back();
    }
  };

  // ── Loading state
  if (spaceId === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>תזכורת חדשה</Text>
          <View style={{ width: 36 }} />
        </View>
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  // ── No space error (only when there's no communityId context either)
  if (!spaceId && !communityId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>תזכורת חדשה</Text>
          <View style={{ width: 36 }} />
        </View>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
          }}
        >
          <Ionicons name="warning-outline" size={48} color="#9ca3af" />
          <Text style={styles.errorStateTitle}>לא נמצא מרחב פעיל</Text>
          <TouchableOpacity
            style={styles.errorStateBtn}
            onPress={handleClose}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.errorStateBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Date chip label for "other"
  const otherChipLabel =
    dateOption === 'other'
      ? customDate.toLocaleDateString('he-IL', {
          day: 'numeric',
          month: 'short',
        })
      : 'אחר';

  return (
    <SafeAreaView
      style={[
        styles.safe,
        ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null,
      ]}
      edges={['top']}
    >
      {/* ── Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.closeBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="סגור"
        >
          <Ionicons name="close" size={22} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>תזכורת חדשה</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── מה להזכיר */}
          <View style={styles.card}>
            <FieldLabel text="מה להזכיר?" required />
            <TextInput
              style={[styles.input, titleError && styles.inputError]}
              value={title}
              onChangeText={(t) => {
                setTitle(t);
                if (t.trim()) setTitleError(false);
              }}
              placeholder="הקלידי את הנושא..."
              placeholderTextColor="#9ca3af"
              textAlign={rtl.inputTextAlign}
              multiline={false}
              maxLength={120}
              returnKeyType="next"
              accessible
              accessibilityLabel="נושא התזכורת"
            />
            {titleError ? (
              <Text style={styles.errorText}>שדה זה נדרש</Text>
            ) : null}
          </View>

          {/* ── תיאור קצר */}
          <View style={styles.card}>
            <FieldLabel text="תיאור קצר" />
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="פרטים נוספים (אופציונלי)..."
              placeholderTextColor="#9ca3af"
              textAlign={rtl.inputTextAlign}
              multiline
              numberOfLines={3}
              maxLength={300}
              accessible
              accessibilityLabel="תיאור"
            />
          </View>

          {/* ── תאריך */}
          <View style={styles.card}>
            <FieldLabel text="תאריך" />
            <View style={styles.chipRow}>
              {(
                [
                  ['today', 'היום'],
                  ['tomorrow', 'מחר'],
                  ['none', 'ללא תאריך'],
                  ['other', otherChipLabel],
                ] as [DateOption, string][]
              ).map(([val, label]) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.chip, dateOption === val && styles.chipActive]}
                  onPress={() => {
                    setDateOption(val);
                    // Clear reminders and time when date is removed
                    if (val === 'none') {
                      setReminders([]);
                      setTimeEnabled(false);
                    }
                    if (val !== 'other') {
                      setDatePickerOpen(false);
                      setCalendarPickerOpen(false);
                    }
                  }}
                  accessible
                  accessibilityRole="button"
                  accessibilityState={{ selected: dateOption === val }}
                  accessibilityLabel={label}
                >
                  <Text
                    style={[
                      styles.chipText,
                      dateOption === val && styles.chipTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Date row + pickers — visible only when "other" is selected */}
            {dateOption === 'other' ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {/* Calendar icon — opens inline monthly grid */}
                  <TouchableOpacity
                    onPress={() => {
                      setCalendarPickerOpen(!calendarPickerOpen);
                      setDatePickerOpen(false);
                    }}
                    style={styles.calendarIconBtn}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="בחר מלוח שנה"
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={20}
                      color={PRIMARY}
                    />
                  </TouchableOpacity>

                  {/* Date value button — opens spinner */}
                  <TouchableOpacity
                    style={[styles.input, styles.dateValueBtn]}
                    onPress={() => {
                      setDatePickerOpen(!datePickerOpen);
                      setCalendarPickerOpen(false);
                    }}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={customDate.toLocaleDateString('he-IL')}
                  >
                    <Text style={{ fontSize: 15, color: '#111827' }}>
                      {customDate.toLocaleDateString('he-IL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Date spinner picker */}
                {datePickerOpen ? (
                  <View style={[styles.pickerWrapper, { width: '100%' }]}>
                    <DateTimePicker
                      value={customDate}
                      mode="date"
                      display="spinner"
                      themeVariant="light"
                      locale="he-IL"
                      textColor="#111827"
                      style={{ width: '100%', height: 180 }}
                      onChange={(_, date) => {
                        if (date) {
                          setCustomDate(date);
                          setDateOption('other');
                        }
                      }}
                    />
                    <TouchableOpacity
                      style={styles.pickerConfirmBtn}
                      onPress={() => setDatePickerOpen(false)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="אישור"
                    >
                      <Text style={styles.pickerConfirmText}>
                        {`אישור — ${customDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Inline monthly calendar picker */}
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
                      value={customDate}
                      mode="date"
                      display="inline"
                      themeVariant="light"
                      locale="he-IL"
                      accentColor={PRIMARY}
                      textColor="#111827"
                      onChange={(_, date) => {
                        if (date) {
                          setCustomDate(date);
                          setDateOption('other');
                          setTimeout(() => setCalendarPickerOpen(false), 150);
                        }
                      }}
                    />
                  </View>
                ) : null}
              </>
            ) : null}
          </View>

          {/* ── שעה (רק אם יש תאריך) */}
          {dateOption !== 'none' ? (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <FieldLabel text="שעה" />
                <Switch
                  value={timeEnabled}
                  onValueChange={(val) => {
                    setTimeEnabled(val);
                    // Clear reminders when toggling time — same as TaskEditorScreen
                    setReminders([]);
                  }}
                  trackColor={{ true: PRIMARY, false: '#d7e3ef' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#d7e3ef"
                  accessible
                  accessibilityLabel="הפעל שעה"
                  accessibilityRole="switch"
                />
              </View>
              {timeEnabled ? (
                <>
                  <TouchableOpacity
                    style={[styles.input, styles.timePickerBtn]}
                    onPress={() => setShowTimePicker(!showTimePicker)}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`שעה: ${selectedTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                  >
                    <Text style={styles.timePickerText}>
                      {selectedTime.toLocaleTimeString('he-IL', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <View style={[styles.pickerWrapper, { width: '100%' }]}>
                      <TimeWheelPicker
                        hour={selectedTime.getHours()}
                        minute={selectedTime.getMinutes()}
                        onHourChange={(h) => {
                          const d = new Date(selectedTime);
                          d.setHours(h);
                          setSelectedTime(d);
                        }}
                        onMinuteChange={(m) => {
                          const d = new Date(selectedTime);
                          d.setMinutes(m);
                          setSelectedTime(d);
                        }}
                        onClose={() => setShowTimePicker(false)}
                      />
                      <TouchableOpacity
                        style={styles.pickerConfirmBtn}
                        onPress={() => setShowTimePicker(false)}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel="בחר שעה"
                      >
                        <Text style={styles.pickerConfirmText}>בחר</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              ) : null}
            </View>
          ) : null}

          {/* ── התראה מוקדמת */}
          {dateOption !== 'none' ? (
            <View style={styles.card}>
              <FieldLabel text="התראה מוקדמת" />
              <View style={styles.chipRow}>
                {activeReminderOptions.map(({ key }) => (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.chip,
                      isReminderActive(key) && styles.chipActive,
                    ]}
                    onPress={() => toggleReminder(key)}
                    accessible
                    accessibilityRole="button"
                    accessibilityState={{ selected: isReminderActive(key) }}
                    accessibilityLabel={getReminderChipLabel(key)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isReminderActive(key) && styles.chipTextActive,
                      ]}
                    >
                      {getReminderChipLabel(key)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── צרף תמונה/קובץ */}
          <View style={styles.card}>
            <FieldLabel text="קבצים מצורפים" />
            <EventAttachmentsSection
              attachments={attachments}
              onChange={setAttachments}
            />
          </View>
        </ScrollView>

        {/* ── Bottom save button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, isSaveDisabled && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaveDisabled}
            accessible
            accessibilityRole="button"
            accessibilityLabel="שמור תזכורת"
          >
            <Text
              style={[
                styles.saveBtnText,
                isSaveDisabled && styles.saveBtnTextDisabled,
              ]}
            >
              {saving ? 'שומר...' : 'שמור תזכורת'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Custom reminder modal */}
      <Modal
        visible={showCustomReminderModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCustomReminderModal(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setShowCustomReminderModal(false)}
        />
        <View style={styles.customReminderSheet}>
          <Text style={styles.customReminderTitle}>התראה מותאמת אישית</Text>
          <View style={styles.customReminderRow}>
            <Text style={styles.customReminderBefore}>לפני</Text>
            <View style={styles.customReminderUnits}>
              {(['minutes', 'hours', 'days'] as TaskReminderUnit[]).map(
                (unit) => (
                  <TouchableOpacity
                    key={unit}
                    style={[
                      styles.chip,
                      customUnit === unit && styles.chipActive,
                    ]}
                    onPress={() => setCustomUnit(unit)}
                    accessible
                    accessibilityRole="button"
                    accessibilityState={{ selected: customUnit === unit }}
                    accessibilityLabel={UNIT_LABELS[unit]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        customUnit === unit && styles.chipTextActive,
                      ]}
                    >
                      {UNIT_LABELS[unit]}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
            <TextInput
              style={[styles.input, styles.customReminderInput]}
              value={String(customAmount)}
              onChangeText={(t) => {
                const n = Number.parseInt(t.replace(/[^0-9]/g, ''), 10);
                if (!Number.isNaN(n) && n > 0) setCustomAmount(n);
                else if (t === '') setCustomAmount(1);
              }}
              keyboardType="number-pad"
              maxLength={3}
              textAlign="center"
              accessible
              accessibilityLabel="כמות"
            />
          </View>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={confirmCustomReminder}
            accessible
            accessibilityRole="button"
            accessibilityLabel="אישור"
          >
            <Text style={styles.saveBtnText}>אישור</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  safeAreaRtl: {
    direction: 'rtl',
  },

  header: {
    flexDirection: rtl.flexDirection,
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

  scroll: { flex: 1 },
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
    textAlign: rtl.textAlign,
    marginBottom: 10,
  },
  required: { color: '#ef4444' },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: rtl.textAlign,
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
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  inputError: { borderColor: '#ef4444' },

  chipRow: {
    flexDirection: rtl.flexDirection,
    flexWrap: 'wrap',
    gap: 8,
  },
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
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  timePickerBtn: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  timePickerText: { fontSize: 15, color: '#111827' },

  pickerWrapper: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
  },
  pickerConfirmBtn: {
    backgroundColor: PRIMARY,
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

  errorStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginTop: 16,
    textAlign: 'center',
  },
  errorStateBtn: {
    marginTop: 16,
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  errorStateBtnText: { color: '#fff', fontWeight: '700' },

  customReminderSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
  },
  customReminderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  customReminderRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
  },
  customReminderBefore: { fontSize: 15, color: '#374151' },
  customReminderUnits: {
    flexDirection: rtl.flexDirection,
    gap: 6,
  },
  customReminderInput: {
    width: 70,
    textAlign: 'center',
  },
});
