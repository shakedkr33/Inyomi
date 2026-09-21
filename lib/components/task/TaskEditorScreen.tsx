import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery } from 'convex/react';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { uploadAttachmentDraftsForConvex } from '@/lib/attachmentUpload';
import { EventAttachmentsSection } from '@/lib/components/event/EventAttachmentsSection';
import { TimeWheelPicker } from '@/lib/components/time/TimeWheelPicker';
import { APP_IS_RTL, rtl } from '@/lib/rtl';
import type { EventAttachmentDraft } from '@/lib/types/event';
import type {
  PersistedTaskReminderType,
  SubTask,
  TaskCategory,
  TaskDateOption,
  TaskDraft,
  TaskRecurrenceType,
  TaskReminder,
  TaskReminderType,
  TaskReminderUnit,
} from '@/lib/types/task';
import { TASK_CATEGORIES } from '@/lib/types/task';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

import { getHebrewDateInfo } from '@/lib/utils/hebrewDate';
import { SubtasksSection } from './SubtasksSection';

const PRIMARY = colors.primaryDark;
const TINT = '#e8f5fd';
const DEFAULT_TASKS_ROUTE = '/(authenticated)/tasks';
const NUMBERS = Array.from({ length: 100 }, (_, index) => index + 1);
const NUM_ITEM_H = 48;

const WEEKDAYS = [
  { label: 'א', value: 0 },
  { label: 'ב', value: 1 },
  { label: 'ג', value: 2 },
  { label: 'ד', value: 3 },
  { label: 'ה', value: 4 },
  { label: 'ו', value: 5 },
  { label: 'ש', value: 6 },
] as const;

const DATE_OPTIONS: { key: TaskDateOption; label: string }[] = [
  { key: 'none', label: 'ללא תאריך' },
  { key: 'today', label: 'היום' },
  { key: 'tomorrow', label: 'מחר' },
  { key: 'other', label: 'יום אחר' },
  { key: 'in_one_hour', label: 'בעוד שעה' },
  { key: 'in_two_hours', label: 'בעוד שעתיים' },
];

const RECURRENCE_OPTIONS: {
  key: Exclude<TaskRecurrenceType, 'none'>;
  label: string;
}[] = [
  { key: 'daily', label: 'כל יום' },
  { key: 'weekly', label: 'כל שבוע' },
  { key: 'specific_days', label: 'ימים מסוימים' },
];

const DATE_REMINDERS: { key: TaskReminderType; label: string }[] = [
  { key: 'morning', label: 'בבוקר' },
  { key: 'evening', label: 'בערב' },
  { key: 'none', label: 'ללא' },
  { key: 'custom', label: 'מותאם אישית' },
];

const TIME_REMINDERS: { key: TaskReminderType; label: string }[] = [
  { key: 'at_time', label: 'בזמן' },
  { key: 'hour_before', label: 'שעה לפני' },
  { key: 'none', label: 'ללא' },
  { key: 'custom', label: 'מותאם אישית' },
];

const UNIT_LABELS: Record<TaskReminderUnit, string> = {
  minutes: 'דקות',
  hours: 'שעות',
  days: 'ימים',
};

const REMINDER_LABELS: Record<PersistedTaskReminderType, string> = {
  morning: 'בבוקר',
  evening: 'בערב',
  at_time: 'בזמן',
  hour_before: 'שעה לפני',
  custom: 'מותאם אישית',
};

const EMPTY_DRAFT: TaskDraft = {
  title: '',
  dateOption: 'none',
  selectedDate: undefined,
  selectedTime: '09:00',
  hasTime: false,
  reminders: [],
  recurrenceType: 'none',
  selectedWeekdays: [],
  category: 'personal',
  assignedTo: undefined,
  assignedToMemberId: undefined,
  assignedToUserIds: [],
  assignedToMemberIds: [],
  subtasks: [],
  allowParticipantEditing: false,
  notes: '',
  attachments: [],
};

interface TaskEditorProps {
  mode: 'create' | 'edit';
  taskId?: string;
  returnTo?: string;
  prefillTitle?: string;
  relatedBirthdayId?: string;
  relatedBirthdayName?: string;
}

type EditableSubtaskRow = {
  id: string;
  title: string;
  completed: boolean;
  image?: {
    storageId: Id<'_storage'>;
    mimeType: string;
    sizeBytes: number;
    createdAt: number;
  };
  attachment?: {
    id: string;
    type: 'image' | 'file';
    storageId: Id<'_storage'>;
    mimeType: string;
    sizeBytes: number;
    createdAt: number;
    originalName?: string;
    displayName?: string;
  };
};

type EditableTask = {
  title: string;
  description?: string;
  dueDate?: number;
  hasTime?: boolean;
  dueAt?: number;
  reminderType?: TaskReminderType;
  customReminderAt?: number;
  reminders?: TaskReminder[];
  recurrenceType?: TaskRecurrenceType;
  selectedWeekdays?: number[];
  category?: string;
  assignedTo?: Id<'users'>;
  assignedToMemberId?: Id<'members'>;
  assignedToUserIds?: Id<'users'>[];
  assignedToMemberIds?: Id<'members'>[];
  subtasks?: EditableSubtaskRow[];
  allowParticipantEditing?: boolean;
  attachments?: EventAttachmentFromDoc[];
};

/** Persisted task attachment (Convex document shape). */
type EventAttachmentFromDoc = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  uploadedBy: Id<'users'>;
};

type ClearableTaskField =
  | 'description'
  | 'dueDate'
  | 'assignedTo'
  | 'assignedToMemberId'
  | 'assignedToUserIds'
  | 'assignedToMemberIds'
  | 'hasTime'
  | 'dueAt'
  | 'reminderType'
  | 'customReminderAt'
  | 'reminders'
  | 'recurrenceType'
  | 'selectedWeekdays'
  | 'subtasks'
  | 'allowParticipantEditing'
  | 'attachments';

type AssigneeOption = {
  id: string;
  label: string;
  initials: string;
  color: string;
  userId?: Id<'users'>;
  memberId?: Id<'members'>;
};

function fmt2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Parse a "HH:MM" string safely.
 * Returns { hour, minute } integers or the fallback { hour: 9, minute: 0 }
 * when the string is absent, malformed, or out of range.
 * No NaN can escape this function.
 */
function parseTimeString(time: string | undefined): {
  hour: number;
  minute: number;
} {
  const FALLBACK = { hour: 9, minute: 0 };
  if (!time) return FALLBACK;
  const parts = time.split(':');
  if (parts.length !== 2) return FALLBACK;
  const h = Number.parseInt(parts[0] ?? '', 10);
  const m = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return FALLBACK;
  if (h < 0 || h > 23 || m < 0 || m > 59) return FALLBACK;
  return { hour: h, minute: m };
}

function midnightOf(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

function addDays(days: number): number {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return midnightOf(date);
}

function dateToTimeString(date: Date): string {
  return `${fmt2(date.getHours())}:${fmt2(date.getMinutes())}`;
}

function timestampFromDateAndTime(dateMs: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date(dateMs);
  date.setHours(hours ?? 9, minutes ?? 0, 0, 0);
  return date.getTime();
}

function roundUpToNextQuarterHour(now = new Date()): string {
  const rounded = new Date(now);
  const minutes = rounded.getMinutes();
  const nextMinutes = Math.ceil(minutes / 15) * 15;
  rounded.setMinutes(nextMinutes, 0, 0);
  if (nextMinutes >= 60) {
    rounded.setHours(rounded.getHours() + 1, 0, 0, 0);
  }
  return dateToTimeString(rounded);
}

function formatDate(dateMs: number | undefined): string {
  if (!dateMs) return 'בחרי תאריך';
  return new Date(dateMs).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isToday(dateMs: number | undefined): boolean {
  if (!dateMs) return false;
  return midnightOf(new Date(dateMs)) === midnightOf(new Date());
}

function isTaskRecurrenceType(value: unknown): value is TaskRecurrenceType {
  return (
    value === 'none' ||
    value === 'daily' ||
    value === 'weekly' ||
    value === 'specific_days'
  );
}

function isTaskCategory(value: unknown): value is TaskCategory {
  return (
    value === 'personal' ||
    value === 'shopping' ||
    value === 'family' ||
    value === 'work'
  );
}

function normalizeSubtasks(subtasks: SubTask[]): SubTask[] {
  return subtasks
    .map((subtask) => ({
      id: subtask.id || createId('subtask'),
      title: subtask.title.trim(),
      completed: subtask.completed,
      ...(subtask.attachment ? { attachment: { ...subtask.attachment } } : {}),
    }))
    .filter((subtask) => subtask.title.length > 0);
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` || '??';
  }
  const compact = name.trim().replace(/\s/g, '');
  return compact.slice(0, 2) || '??';
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

function defaultReminderBaseTimestamp(schedule: {
  dueDate?: number;
  dueAt?: number;
}): number | undefined {
  if (schedule.dueAt !== undefined) return schedule.dueAt;
  if (schedule.dueDate !== undefined) {
    return schedule.dueDate + 9 * 60 * 60 * 1000;
  }
  return undefined;
}

function resolveReminderTimestamp(
  reminder: TaskReminder,
  schedule: {
    dueDate?: number;
    dueAt?: number;
    hasTime: boolean;
  }
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

  const baseTimestamp = defaultReminderBaseTimestamp(schedule);
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
    return [
      {
        ...reminder,
        customReminderAt: reminderAt,
      },
    ];
  });
}

function reminderFromOldFields(task: EditableTask): TaskReminder[] {
  if (!task.reminderType || task.reminderType === 'none') return [];
  if (task.reminderType === 'custom') {
    return [
      {
        id: createId('reminder'),
        type: 'custom',
        customAmount: 30,
        customUnit: 'minutes',
        customReminderAt: task.customReminderAt,
        label: 'תזכורת: 30 דקות לפני המשימה',
      },
    ];
  }
  return [
    {
      id: createId('reminder'),
      type: task.reminderType,
      label: REMINDER_LABELS[task.reminderType],
    },
  ];
}

function createEmptyDraft(currentUserId: Id<'users'> | undefined): TaskDraft {
  return {
    ...EMPTY_DRAFT,
    assignedTo: currentUserId,
    assignedToUserIds: currentUserId ? [currentUserId] : [],
    attachments: [],
  };
}

function stableSerializeTaskDraft(d: TaskDraft): string {
  const snapshot = {
    title: d.title,
    dateOption: d.dateOption,
    selectedDate: d.selectedDate,
    selectedTime: d.selectedTime ?? '09:00',
    hasTime: d.hasTime,
    reminders: d.reminders,
    recurrenceType: d.recurrenceType,
    selectedWeekdays: [...d.selectedWeekdays].sort((a, b) => a - b),
    category: d.category,
    assignedTo: d.assignedTo,
    assignedToMemberId: d.assignedToMemberId,
    assignedToUserIds: [...d.assignedToUserIds].sort(),
    assignedToMemberIds: [...d.assignedToMemberIds].sort(),
    subtasks: d.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      completed: s.completed,
      attachment: s.attachment
        ? {
            id: s.attachment.id,
            type: s.attachment.type,
            storageId: s.attachment.storageId,
            localUri: s.attachment.localUri,
            mimeType: s.attachment.mimeType,
            sizeBytes: s.attachment.sizeBytes,
            createdAt: s.attachment.createdAt,
            originalName: s.attachment.originalName,
            displayName: s.attachment.displayName,
          }
        : undefined,
    })),
    allowParticipantEditing: d.allowParticipantEditing,
    notes: d.notes,
    attachments: (d.attachments ?? []).map((a) => ({
      storageId: a.storageId,
      originalName: a.originalName,
      displayName: a.displayName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      localUri: a.localUri,
    })),
  };
  return JSON.stringify(snapshot);
}

function resolveDateOption(task: EditableTask): TaskDateOption {
  if (!task.dueDate) return 'none';
  return 'other';
}

function draftFromTask(task: EditableTask): TaskDraft {
  const hasTime = task.hasTime === true || task.dueAt !== undefined;
  const sourceTimestamp = task.dueAt ?? task.dueDate;
  return {
    title: task.title,
    dateOption: resolveDateOption(task),
    selectedDate: task.dueDate,
    selectedTime: sourceTimestamp
      ? dateToTimeString(new Date(sourceTimestamp))
      : '09:00',
    hasTime,
    reminders: task.reminders ?? reminderFromOldFields(task),
    recurrenceType: isTaskRecurrenceType(task.recurrenceType)
      ? task.recurrenceType
      : 'none',
    selectedWeekdays: task.selectedWeekdays ?? [],
    category: isTaskCategory(task.category) ? task.category : 'personal',
    assignedTo: task.assignedTo,
    assignedToMemberId: task.assignedToMemberId,
    assignedToUserIds:
      task.assignedToUserIds ?? (task.assignedTo ? [task.assignedTo] : []),
    assignedToMemberIds:
      task.assignedToMemberIds ??
      (task.assignedToMemberId ? [task.assignedToMemberId] : []),
    subtasks: (task.subtasks ?? []).map((st) => {
      const base: SubTask = {
        id: st.id,
        title: st.title,
        completed: st.completed,
      };
      if (st.attachment?.storageId) {
        return {
          ...base,
          attachment: {
            id: st.attachment.id,
            type: st.attachment.type,
            storageId: st.attachment.storageId as string,
            mimeType: st.attachment.mimeType,
            sizeBytes: st.attachment.sizeBytes,
            createdAt: st.attachment.createdAt,
            originalName: st.attachment.originalName ?? 'file',
            displayName:
              st.attachment.displayName ?? st.attachment.originalName ?? 'קובץ',
          },
        };
      }
      if (st.image) {
        return {
          ...base,
          attachment: {
            id: `legacy-${st.id}`,
            type: 'image' as const,
            storageId: st.image.storageId as unknown as string,
            mimeType: st.image.mimeType,
            sizeBytes: st.image.sizeBytes,
            createdAt: st.image.createdAt,
            originalName: 'image',
            displayName: 'תמונה',
          },
        };
      }
      return base;
    }),
    allowParticipantEditing: task.allowParticipantEditing ?? false,
    notes: task.description ?? '',
    attachments: (task.attachments ?? []).map((a) => ({
      storageId: a.storageId,
      originalName: a.originalName,
      displayName: a.displayName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })),
  };
}

function isTimedShortcut(option: TaskDateOption): boolean {
  return option === 'in_one_hour' || option === 'in_two_hours';
}

function normalizeReturnRoute(returnTo: string | undefined): string {
  if (returnTo?.startsWith('/(authenticated)/')) return returnTo;
  return DEFAULT_TASKS_ROUTE;
}

export default function TaskEditorScreen({
  mode,
  taskId,
  returnTo,
  prefillTitle,
  relatedBirthdayId,
  relatedBirthdayName,
}: TaskEditorProps): React.JSX.Element {
  const isCreate = mode === 'create';
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [titleError, setTitleError] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  // Local picker draft — isolated from draft.selectedTime while the modal is open.
  // Only applied to the form when the user presses "בחר" and validation passes.
  const [pickerHour, setPickerHour] = useState(9);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [customReminderOpen, setCustomReminderOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState(30);
  const [customUnit, setCustomUnit] = useState<TaskReminderUnit>('minutes');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const numListRef = useRef<FlatList<number>>(null);
  const editSnapshotRef = useRef<string | null>(null);
  // Tracks the SubtasksSection draft input title so it can be flushed on save
  const pendingSubtaskTitleRef = useRef('');

  const destination = normalizeReturnRoute(returnTo);
  const mySpace = useQuery(api.users.getMySpace);
  const currentUser = useQuery(api.users.getCurrentUser);
  const familyContacts = useQuery(api.members.listMyFamilyContacts);
  // SECURITY (Wave 1 / H-03): previously used api.tasks.getById, an
  // unauthenticated/unauthorized raw-document query. Migrated to the
  // canonical authorized query — same object shape (getTaskDetails spreads
  // the raw task document plus adds derived fields TaskEditorScreen already
  // ignores below), but now returns null for any non-participant instead of
  // exposing task content to an unauthorized caller.
  const existingTask = useQuery(
    api.tasks.getTaskDetails,
    !isCreate && taskId ? { id: taskId as Id<'tasks'> } : 'skip'
  );
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const softDeleteTask = useMutation(api.tasks.softDeleteTask);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);
  const updateMyTaskReminder = useMutation(api.tasks.updateMyTaskReminder);
  const leaveTaskMutation = useMutation(api.tasks.leaveTask);

  const currentUserId = currentUser?._id as Id<'users'> | undefined;

  // ── Permission flags ──────────────────────────────────────────────────────
  const isCreator =
    !isCreate &&
    !!currentUserId &&
    !!existingTask &&
    String((existingTask as { createdBy?: unknown }).createdBy) ===
      String(currentUserId);

  const isParticipantNotCreator =
    !isCreate &&
    !isCreator &&
    !!currentUserId &&
    !!existingTask &&
    ((
      (existingTask as { assignedToUserIds?: string[] }).assignedToUserIds ?? []
    ).some((id) => String(id) === String(currentUserId)) ||
      String((existingTask as { assignedTo?: unknown }).assignedTo) ===
        String(currentUserId));

  /** Creator (or new task) gets full editing. Participants have limited access. */
  const canFullyEdit = isCreate || isCreator;

  /** Whether the current participant can edit subtasks (creator always can). */
  const canEditSubtasks =
    canFullyEdit ||
    (isParticipantNotCreator &&
      (existingTask as { allowParticipantEditing?: boolean } | null | undefined)
        ?.allowParticipantEditing === true);

  // Personal reminder for participant — loaded from taskParticipantSettings
  const myTaskReminder = useQuery(
    api.tasks.getMyTaskReminder,
    !isCreate && taskId && isParticipantNotCreator
      ? { taskId: taskId as Id<'tasks'> }
      : 'skip'
  );

  // Track whether we have initialized the participant's personal reminder into draft
  const participantReminderInitializedRef = useRef(false);
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const selfEntity = familyContacts?.selfEntity as
    | { displayName?: string; color?: string }
    | null
    | undefined;
  const currentUserName =
    selfEntity?.displayName?.trim() ||
    (currentUser as { fullName?: string } | null)?.fullName?.trim() ||
    'אני';
  const currentUserColor =
    selfEntity?.color ??
    (currentUser as { profileColor?: string } | null)?.profileColor ??
    PRIMARY;

  useFocusEffect(
    useCallback(() => {
      if (!isCreate) return;
      editSnapshotRef.current = null;
      setTitleError(false);
      setTimeError(null);
      setDiscardOpen(false);
      const emptyDraft = createEmptyDraft(currentUserIdRef.current);
      setDraft(
        prefillTitle ? { ...emptyDraft, title: prefillTitle } : emptyDraft
      );
    }, [isCreate, prefillTitle])
  );

  useEffect(() => {
    if (existingTask) {
      const nextDraft = draftFromTask(existingTask as EditableTask);
      setDraft(nextDraft);
      editSnapshotRef.current = stableSerializeTaskDraft(nextDraft);
      // Reset personal reminder init flag when task changes
      participantReminderInitializedRef.current = false;
    }
  }, [existingTask]);

  useEffect(() => {
    if (customReminderOpen) {
      const index = Math.max(0, customAmount - 1);
      setTimeout(() => {
        numListRef.current?.scrollToIndex({ index, animated: false });
      }, 80);
    }
  }, [customReminderOpen, customAmount]);

  const assignees: AssigneeOption[] = useMemo(() => {
    const options: AssigneeOption[] = currentUserId
      ? [
          {
            id: `user:${currentUserId}`,
            label: 'אני',
            initials: initialsFromName(currentUserName),
            color: currentUserColor,
            userId: currentUserId,
          },
        ]
      : [];

    const selfEntityId = familyContacts?.selfEntityId;
    const familyOptions = (familyContacts?.members ?? [])
      .filter((member) => member._id !== selfEntityId)
      .map((member) => {
        const label = member.displayName?.trim() || 'בן משפחה';
        const userId = member.matchedUserId as Id<'users'> | undefined;
        return {
          id: userId ? `user:${userId}` : `member:${member._id}`,
          label,
          initials: initialsFromName(label),
          color: member.color ?? PRIMARY,
          userId,
          memberId: member._id as Id<'members'>,
        };
      });

    const seen = new Set(options.map((option) => option.id));
    for (const option of familyOptions) {
      if (!seen.has(option.id)) {
        options.push(option);
        seen.add(option.id);
      }
    }
    return options;
  }, [
    currentUserColor,
    currentUserId,
    currentUserName,
    familyContacts?.members,
    familyContacts?.selfEntityId,
  ]);

  const hasDueDate = draft.dateOption !== 'none';
  const showTimeToggle = ['today', 'tomorrow', 'other'].includes(
    draft.dateOption
  );
  const shouldShowTimePicker = showTimeToggle && draft.hasTime;
  const selectedDate = draft.selectedDate ?? addDays(0);
  const previewDueAt = useMemo(() => {
    if (draft.dateOption === 'in_one_hour') return Date.now() + 60 * 60 * 1000;
    if (draft.dateOption === 'in_two_hours')
      return Date.now() + 2 * 60 * 60 * 1000;
    if (draft.hasTime && draft.selectedDate) {
      return timestampFromDateAndTime(
        draft.selectedDate,
        draft.selectedTime ?? '09:00'
      );
    }
    return undefined;
  }, [draft.dateOption, draft.hasTime, draft.selectedDate, draft.selectedTime]);
  const reminderBaseTimestamp =
    previewDueAt ?? timestampFromDateAndTime(selectedDate, '09:00');
  const customReminderAt = customReminderTimestamp(
    reminderBaseTimestamp,
    customAmount,
    customUnit
  );
  const customReminderError = useMemo(() => {
    if (!hasDueDate) {
      return 'בחרי מועד למשימה לפני תזכורת מותאמת אישית';
    }
    if (customReminderAt < Date.now()) {
      return 'התזכורת שבחרת כבר עברה';
    }
    if (customReminderAt > reminderBaseTimestamp) {
      return 'אי אפשר לבחור תזכורת אחרי מועד המשימה';
    }
    return null;
  }, [customReminderAt, hasDueDate, reminderBaseTimestamp]);
  const visibleAssigneeIds = useMemo(
    () => assignees.map((assignee) => assignee.id),
    [assignees]
  );
  const selectedAssigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const userId of draft.assignedToUserIds) {
      ids.add(`user:${userId}`);
    }
    for (const memberId of draft.assignedToMemberIds) {
      ids.add(`member:${memberId}`);
    }
    if (draft.assignedTo) ids.add(`user:${draft.assignedTo}`);
    if (draft.assignedToMemberId) ids.add(`member:${draft.assignedToMemberId}`);
    return ids;
  }, [
    draft.assignedTo,
    draft.assignedToMemberId,
    draft.assignedToMemberIds,
    draft.assignedToUserIds,
  ]);
  const allAssigneesSelected =
    visibleAssigneeIds.length > 0 &&
    visibleAssigneeIds.every((id) => selectedAssigneeIds.has(id));
  const isDirty = useMemo(() => {
    if (isSaving) return false;
    if (isCreate) {
      const baseline = stableSerializeTaskDraft(
        createEmptyDraft(currentUserId)
      );
      return stableSerializeTaskDraft(draft) !== baseline;
    }
    return (
      editSnapshotRef.current !== null &&
      stableSerializeTaskDraft(draft) !== editSnapshotRef.current
    );
  }, [currentUserId, draft, isCreate, isSaving]);

  const updateDraft = useCallback((updates: Partial<TaskDraft>): void => {
    setDraft((prev) => ({ ...prev, ...updates, reminderError: undefined }));
  }, []);

  // Override draft reminders with the participant's personal reminder once loaded.
  // Must appear after updateDraft to satisfy TypeScript block-scope rules.
  useEffect(() => {
    if (
      isParticipantNotCreator &&
      myTaskReminder !== undefined &&
      !participantReminderInitializedRef.current
    ) {
      participantReminderInitializedRef.current = true;
      updateDraft({ reminders: myTaskReminder?.reminders ?? [] });
    }
  }, [isParticipantNotCreator, myTaskReminder, updateDraft]);

  const navigateToDestination = useCallback((): void => {
    router.replace(destination as never);
  }, [destination]);

  const handleBack = (): void => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    navigateToDestination();
  };

  /**
   * Soft-delete the task. Ownership is enforced on the backend as well.
   * A shared task (multiple assignees) gets a stronger warning alert.
   */
  const handleDelete = (): void => {
    if (!taskId || !existingTask) return;
    const otherUserIds = (
      (existingTask.assignedToUserIds as string[] | undefined) ?? []
    ).filter((id) => id !== String(currentUserId));
    const hasMemberAssignees =
      ((existingTask.assignedToMemberIds as string[] | undefined) ?? [])
        .length > 0;
    const isShared = otherUserIds.length > 0 || hasMemberAssignees;
    const alertTitle = isShared
      ? 'למחוק את המשימה המשותפת?'
      : 'למחוק את המשימה?';
    const alertMessage = isShared
      ? 'המשימה תוסר לכל המשתתפים. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.'
      : 'המשימה תוסר. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.';

    Alert.alert(alertTitle, alertMessage, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          setIsDeleting(true);
          try {
            await softDeleteTask({ id: taskId as Id<'tasks'> });
            navigateToDestination();
          } catch (error) {
            console.error('softDeleteTask error:', error);
            Alert.alert('שגיאה', 'לא הצלחנו למחוק את המשימה. נסה שוב.');
          } finally {
            setIsDeleting(false);
          }
        },
      },
    ]);
  };

  const handleLeave = (): void => {
    if (!taskId) return;
    Alert.alert(
      'לעזוב את המשימה?',
      'המשימה תוסר מהרשימה שלך, אבל תישאר אצל שאר המשתתפים.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'עזוב משימה',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await leaveTaskMutation({ taskId: taskId as Id<'tasks'> });
              navigateToDestination();
            } catch (error) {
              Alert.alert('שגיאה', 'לא הצלחנו לעזוב את המשימה. נסה שוב.');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const selectDateOption = (option: TaskDateOption): void => {
    setTimeError(null);
    if (option === 'none') {
      updateDraft({
        dateOption: option,
        selectedDate: undefined,
        hasTime: false,
        reminders: [],
        recurrenceType: 'none',
        selectedWeekdays: [],
      });
      return;
    }
    if (option === 'today') {
      updateDraft({
        dateOption: option,
        selectedDate: addDays(0),
        hasTime: false,
        selectedTime: roundUpToNextQuarterHour(),
      });
      return;
    }
    if (option === 'tomorrow') {
      updateDraft({
        dateOption: option,
        selectedDate: addDays(1),
        hasTime: false,
        selectedTime: '09:00',
      });
      return;
    }
    if (option === 'other') {
      updateDraft({
        dateOption: option,
        selectedDate: draft.selectedDate ?? addDays(0),
        hasTime: false,
        selectedTime: '09:00',
      });
      setDatePickerOpen(true);
      return;
    }
    updateDraft({
      dateOption: option,
      selectedDate: undefined,
      hasTime: true,
      reminders: [],
      recurrenceType: 'none',
      selectedWeekdays: [],
    });
  };

  const setHasTime = (hasTime: boolean): void => {
    setTimeError(null);
    const selectedTime =
      hasTime && draft.dateOption === 'today'
        ? roundUpToNextQuarterHour()
        : '09:00';
    updateDraft({
      hasTime,
      selectedTime: hasTime ? selectedTime : undefined,
      reminders: [],
    });
  };

  // ── Time picker local draft handlers ──────────────────────────────────────
  // Opening initializes local hour/minute from the saved draft value.
  const handleOpenTimePicker = (): void => {
    const parsed = parseTimeString(draft.selectedTime);
    setPickerHour(parsed.hour);
    setPickerMinute(parsed.minute);
    setTimeError(null);
    setTimePickerOpen(true);
  };

  // "בחר" validates and commits the local draft to the form — once.
  const handleApplyTime = (): void => {
    const newTime = `${fmt2(pickerHour)}:${fmt2(pickerMinute)}`;
    const newTimestamp = timestampFromDateAndTime(selectedDate, newTime);
    if (isToday(selectedDate) && newTimestamp < Date.now()) {
      setTimeError('אי אפשר לבחור שעה שכבר עברה');
      return;
    }
    setTimeError(null);
    updateDraft({ selectedTime: newTime });
    setTimePickerOpen(false);
  };

  // Backdrop tap or Android Back — discards local picker state silently.
  const handleCloseTimePicker = (): void => {
    setTimePickerOpen(false);
  };

  const hasReminder = (type: PersistedTaskReminderType): boolean =>
    draft.reminders.some((reminder) => reminder.type === type);

  const toggleReminder = (type: TaskReminderType): void => {
    if (type === 'none') {
      updateDraft({ reminders: [] });
      return;
    }
    if (type === 'custom') {
      openCustomReminder();
      return;
    }
    const nextReminders = hasReminder(type)
      ? draft.reminders.filter((reminder) => reminder.type !== type)
      : [
          ...draft.reminders,
          {
            id: createId('reminder'),
            type,
            label: REMINDER_LABELS[type],
          },
        ];
    updateDraft({ reminders: nextReminders });
  };

  const validateCustomReminder = (reminders: TaskReminder[]): string | null => {
    for (const reminder of reminders) {
      if (reminder.type !== 'custom') continue;
      if (!hasDueDate) {
        return 'בחרי מועד למשימה לפני תזכורת מותאמת אישית';
      }
      if (!reminder.customReminderAt) return 'בחרי זמן לתזכורת מותאמת';
      if (reminder.customReminderAt < Date.now()) {
        return 'התזכורת שבחרת כבר עברה';
      }
      if (reminder.customReminderAt > reminderBaseTimestamp) {
        return 'אי אפשר לבחור תזכורת אחרי מועד המשימה';
      }
    }
    return null;
  };

  const buildSavePayload = (): {
    dueDate?: number;
    dueAt?: number;
    hasTime: boolean;
    clearFields: ClearableTaskField[];
  } => {
    const clearFields: ClearableTaskField[] = [];
    if (draft.dateOption === 'none') {
      clearFields.push('dueDate', 'dueAt', 'selectedWeekdays');
      return { hasTime: false, clearFields };
    }
    if (
      draft.dateOption === 'in_one_hour' ||
      draft.dateOption === 'in_two_hours'
    ) {
      const offset = draft.dateOption === 'in_one_hour' ? 1 : 2;
      const dueAt = Date.now() + offset * 60 * 60 * 1000;
      return {
        dueDate: midnightOf(new Date(dueAt)),
        dueAt,
        hasTime: true,
        clearFields,
      };
    }
    const dueDate = selectedDate;
    if (!draft.hasTime) {
      clearFields.push('dueAt');
      return { dueDate, hasTime: false, clearFields };
    }
    const dueAt = timestampFromDateAndTime(
      dueDate,
      draft.selectedTime ?? '09:00'
    );
    return { dueDate, dueAt, hasTime: true, clearFields };
  };

  const handleSave = async (): Promise<void> => {
    if (canFullyEdit && !draft.title.trim()) {
      setTitleError(true);
      return;
    }
    if (!isCreate && !taskId) return;
    if (isCreate && !mySpace) {
      Alert.alert('שגיאה', 'לא נמצא מרחב פעיל. נסי שוב.');
      return;
    }

    const schedule = buildSavePayload();
    if (
      schedule.dueAt !== undefined &&
      isToday(schedule.dueDate) &&
      schedule.dueAt < Date.now()
    ) {
      setTimeError('אי אפשר לבחור שעה שכבר עברה');
      return;
    }
    const normalizedReminders = normalizeTaskReminders({
      reminders: draft.reminders,
      dueDate: schedule.dueDate,
      dueAt: schedule.dueAt,
      hasTime: schedule.hasTime,
      now: Date.now(),
    });

    const recurrenceType = hasDueDate ? draft.recurrenceType : 'none';
    // Flush any pending subtask title typed but not yet committed via the + button
    const pendingTitle = pendingSubtaskTitleRef.current.trim();
    const subtasksWithPending =
      pendingTitle.length > 0
        ? [
            ...draft.subtasks,
            {
              id: `${Date.now()}-flush`,
              title: pendingTitle,
              completed: false,
            },
          ]
        : draft.subtasks;
    const normalizedSubtasks = normalizeSubtasks(subtasksWithPending);

    setIsSaving(true);
    try {
      const resolvedAttachments = await uploadAttachmentDraftsForConvex(
        draft.attachments ?? [],
        generateUploadUrl
      );

      type SubtaskConvexRow = {
        id: string;
        title: string;
        completed: boolean;
        attachment?: {
          id: string;
          type: 'image' | 'file';
          storageId: Id<'_storage'>;
          mimeType: string;
          sizeBytes: number;
          createdAt: number;
          originalName?: string;
          displayName?: string;
        };
      };

      const subtasksForConvex: SubtaskConvexRow[] = [];
      for (const st of normalizedSubtasks) {
        const att = st.attachment;
        let attachmentRow: SubtaskConvexRow['attachment'];
        if (att?.localUri && !att.storageId) {
          const [uploaded] = await uploadAttachmentDraftsForConvex(
            [
              {
                originalName: att.originalName,
                displayName: att.displayName,
                mimeType: att.mimeType,
                sizeBytes: att.sizeBytes,
                localUri: att.localUri,
              },
            ],
            generateUploadUrl
          );
          attachmentRow = {
            id: att.id,
            type: att.type,
            storageId: uploaded.storageId,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
            createdAt: Date.now(),
            originalName: att.originalName,
            displayName: att.displayName,
          };
        } else if (att?.storageId) {
          attachmentRow = {
            id: att.id,
            type: att.type,
            storageId: att.storageId as Id<'_storage'>,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            createdAt: att.createdAt ?? Date.now(),
            originalName: att.originalName,
            displayName: att.displayName,
          };
        }
        subtasksForConvex.push({
          id: st.id,
          title: st.title,
          completed: st.completed,
          ...(attachmentRow ? { attachment: attachmentRow } : {}),
        });
      }

      const firstReminder = normalizedReminders[0];
      const clearFields: ClearableTaskField[] = [
        ...schedule.clearFields,
        ...(subtasksForConvex.length === 0
          ? (['subtasks'] satisfies ClearableTaskField[])
          : []),
        ...(normalizedReminders.length === 0
          ? ([
              'reminders',
              'reminderType',
              'customReminderAt',
            ] satisfies ClearableTaskField[])
          : []),
        ...(firstReminder && firstReminder.type !== 'custom'
          ? (['customReminderAt'] satisfies ClearableTaskField[])
          : []),
        ...(recurrenceType !== 'specific_days'
          ? (['selectedWeekdays'] satisfies ClearableTaskField[])
          : []),
        ...(draft.assignedTo === undefined
          ? (['assignedTo'] satisfies ClearableTaskField[])
          : []),
        ...(draft.assignedToMemberId === undefined
          ? (['assignedToMemberId'] satisfies ClearableTaskField[])
          : []),
        ...(draft.assignedToUserIds.length === 0
          ? (['assignedToUserIds'] satisfies ClearableTaskField[])
          : []),
        ...(draft.assignedToMemberIds.length === 0
          ? (['assignedToMemberIds'] satisfies ClearableTaskField[])
          : []),
      ];

      const payload = {
        title: draft.title.trim(),
        description: draft.notes.trim() || undefined,
        dueDate: schedule.dueDate,
        hasTime: schedule.hasTime,
        dueAt: schedule.dueAt,
        reminderType: firstReminder?.type ?? 'none',
        customReminderAt:
          firstReminder?.type === 'custom'
            ? firstReminder.customReminderAt
            : undefined,
        reminders:
          normalizedReminders.length > 0 ? normalizedReminders : undefined,
        recurrenceType,
        selectedWeekdays:
          recurrenceType === 'specific_days'
            ? draft.selectedWeekdays
            : undefined,
        category: draft.category,
        assignedTo: draft.assignedTo as Id<'users'> | undefined,
        assignedToMemberId: draft.assignedToMemberId as
          | Id<'members'>
          | undefined,
        assignedToUserIds:
          draft.assignedToUserIds.length > 0
            ? (draft.assignedToUserIds as Id<'users'>[])
            : undefined,
        assignedToMemberIds:
          draft.assignedToMemberIds.length > 0
            ? (draft.assignedToMemberIds as Id<'members'>[])
            : undefined,
        subtasks: subtasksForConvex.length > 0 ? subtasksForConvex : undefined,
        allowParticipantEditing: draft.allowParticipantEditing,
      };

      if (isCreate) {
        await createTask({
          ...payload,
          spaceId: mySpace as Id<'spaces'>,
          attachments:
            resolvedAttachments.length > 0 ? resolvedAttachments : undefined,
          relatedType: relatedBirthdayId ? 'birthday' : undefined,
          relatedBirthdayId: relatedBirthdayId ?? undefined,
          relatedBirthdayName: relatedBirthdayName ?? undefined,
        });
        setDraft(createEmptyDraft(currentUserId));
      } else if (isParticipantNotCreator) {
        // Participant: save personal reminder separately, then update allowed fields only
        await updateMyTaskReminder({
          taskId: taskId as Id<'tasks'>,
          reminders:
            normalizedReminders.length > 0 ? normalizedReminders : undefined,
          reminderType: firstReminder?.type ?? 'none',
          customReminderAt:
            firstReminder?.type === 'custom'
              ? firstReminder.customReminderAt
              : undefined,
        });

        // Only pass fields that participants are allowed to change.
        // Omit title, category, recurrence, assignees — backend keeps existing.
        const restrictedClearFieldKeys: string[] = [
          'reminderType',
          'customReminderAt',
          'reminders',
          'assignedTo',
          'assignedToMemberId',
          'assignedToUserIds',
          'assignedToMemberIds',
          'allowParticipantEditing',
        ];
        const participantClearFields = (clearFields as string[]).filter(
          (f) => !restrictedClearFieldKeys.includes(f)
        ) as ClearableTaskField[];

        await updateTask({
          id: taskId as Id<'tasks'>,
          dueDate: payload.dueDate,
          hasTime: payload.hasTime,
          dueAt: payload.dueAt,
          description: payload.description,
          attachments: resolvedAttachments,
          subtasks: canEditSubtasks ? payload.subtasks : undefined,
          clearFields: participantClearFields,
        });
      } else {
        await updateTask({
          id: taskId as Id<'tasks'>,
          ...payload,
          attachments: resolvedAttachments,
          clearFields,
        });
      }
      navigateToDestination();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'לא ניתן לשמור כרגע';
      Alert.alert('שגיאה', message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleWeekday = (weekday: number): void => {
    updateDraft({
      selectedWeekdays: draft.selectedWeekdays.includes(weekday)
        ? draft.selectedWeekdays.filter((day) => day !== weekday)
        : [...draft.selectedWeekdays, weekday],
    });
  };

  const openCustomReminder = (): void => {
    const currentCustom = draft.reminders.find(
      (reminder) => reminder.type === 'custom'
    );
    setCustomAmount(currentCustom?.customAmount ?? 30);
    setCustomUnit(currentCustom?.customUnit ?? 'minutes');
    setCustomReminderOpen(true);
  };

  const confirmCustomReminder = (): void => {
    if (customReminderError) {
      updateDraft({ reminderError: customReminderError });
      return;
    }
    const nextCustom: TaskReminder = {
      id:
        draft.reminders.find((reminder) => reminder.type === 'custom')?.id ??
        createId('reminder'),
      type: 'custom',
      customAmount,
      customUnit,
      customReminderAt,
      label: `תזכורת: ${customAmount} ${UNIT_LABELS[customUnit]} לפני המשימה`,
    };
    const nextReminders = [
      ...draft.reminders.filter((reminder) => reminder.type !== 'custom'),
      nextCustom,
    ];
    const reminderError = validateCustomReminder(nextReminders);
    if (reminderError) {
      updateDraft({ reminderError });
      return;
    }
    updateDraft({ reminders: nextReminders });
    setCustomReminderOpen(false);
  };

  const applyAssigneeSelection = (ids: Set<string>): void => {
    const userIds: Id<'users'>[] = [];
    const memberIds: Id<'members'>[] = [];
    for (const option of assignees) {
      if (!ids.has(option.id)) continue;
      if (option.userId) {
        userIds.push(option.userId);
      } else if (option.memberId) {
        memberIds.push(option.memberId);
      }
    }
    const firstUserId = userIds[0];
    const firstMemberId = firstUserId ? undefined : memberIds[0];
    updateDraft({
      assignedTo: firstUserId,
      assignedToMemberId: firstMemberId,
      assignedToUserIds: userIds,
      assignedToMemberIds: memberIds,
    });
  };

  const toggleAssignee = (assignee: AssigneeOption): void => {
    const nextIds = new Set(selectedAssigneeIds);
    if (nextIds.has(assignee.id)) {
      nextIds.delete(assignee.id);
    } else {
      nextIds.add(assignee.id);
    }
    applyAssigneeSelection(nextIds);
  };

  const selectEveryone = (): void => {
    if (allAssigneesSelected) {
      applyAssigneeSelection(new Set());
      return;
    }
    applyAssigneeSelection(new Set(visibleAssigneeIds));
  };

  // Participants don't need to fill the title (it's read-only for them)
  const isCtaDisabled =
    (canFullyEdit && !draft.title.trim()) || isSaving || isDeleting;

  /**
   * Whether the current user can soft-delete this task from the editor.
   * Community reminders (communityId set, no sourceType) are not personally deletable.
   * Only the creator (createdBy === currentUserId) can delete.
   */
  const canDeleteFromEditor =
    !isCreate &&
    !!existingTask &&
    !!currentUserId &&
    String((existingTask as { createdBy?: unknown }).createdBy) ===
      String(currentUserId) &&
    // Community reminders are community-owned, not personally deletable
    !(
      (existingTask as { communityId?: unknown }).communityId !== undefined &&
      (existingTask as { sourceType?: unknown }).sourceType === undefined
    );

  if (isCreate && (mySpace === undefined || currentUserId === undefined)) {
    return (
      <SafeAreaView style={[styles.safeArea, ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={PRIMARY} size="large" />
          <Text style={styles.centerText}>טוען נתונים...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          style={styles.backButton}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
        >
          <MaterialIcons name="arrow-forward" size={22} color="#111517" />
        </Pressable>
        <Text style={styles.headerTitle}>
          {isCreate
            ? 'יצירת משימה'
            : isParticipantNotCreator
              ? 'צפייה במשימה'
              : 'עריכת משימה'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>שם המשימה</Text>
            <TextInput
              value={draft.title}
              onChangeText={
                canFullyEdit
                  ? (title) => {
                      setTitleError(false);
                      updateDraft({ title });
                    }
                  : undefined
              }
              editable={canFullyEdit}
              placeholder="מה צריך לעשות?"
              placeholderTextColor="#94a3b8"
              style={[
                styles.titleInput,
                titleError && styles.inputError,
                !canFullyEdit && styles.fieldReadOnly,
              ]}
              textAlign={rtl.inputTextAlign}
              accessible={true}
              accessibilityLabel="שם המשימה"
            />
            {!canFullyEdit ? (
              <Text style={styles.fieldLockedHint}>
                רק יוצר/ת המשימה יכול/ה לשנות את הפרטים האלה
              </Text>
            ) : null}
            {titleError ? (
              <Text style={styles.errorText}>נא להזין שם משימה</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>מתי לבצע?</Text>
            <View style={styles.chipsWrap}>
              {DATE_OPTIONS.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  active={draft.dateOption === option.key}
                  onPress={() => selectDateOption(option.key)}
                />
              ))}
            </View>
            {draft.dateOption === 'other' ? (
              <>
                <Pressable
                  style={styles.selectionRow}
                  onPress={() => setDatePickerOpen(true)}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="בחירת תאריך"
                >
                  <MaterialIcons
                    name="calendar-today"
                    size={18}
                    color={PRIMARY}
                  />
                  <Text style={styles.selectionText}>
                    {formatDate(selectedDate)}
                  </Text>
                </Pressable>
                {draft.selectedDate &&
                getHebrewDateInfo(draft.selectedDate).fullHebrewDate ? (
                  <Text style={styles.hebrewDateHint}>
                    {getHebrewDateInfo(draft.selectedDate).fullHebrewDate}
                  </Text>
                ) : null}
              </>
            ) : null}
            {showTimeToggle ? (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>הוסף שעה</Text>
                <Switch
                  value={draft.hasTime}
                  onValueChange={setHasTime}
                  trackColor={{ true: PRIMARY, false: '#d7e3ef' }}
                  thumbColor="#fff"
                  accessible={true}
                  accessibilityLabel="הוסף שעה"
                />
              </View>
            ) : null}
            {shouldShowTimePicker ? (
              <Pressable
                style={styles.selectionRow}
                onPress={handleOpenTimePicker}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="בחירת שעה"
              >
                <MaterialIcons name="schedule" size={18} color={PRIMARY} />
                <Text style={styles.selectionText}>{draft.selectedTime}</Text>
              </Pressable>
            ) : null}
            {timeError ? (
              <Text style={styles.errorText}>{timeError}</Text>
            ) : null}
            {isTimedShortcut(draft.dateOption) && previewDueAt ? (
              <Text style={styles.helperText}>
                {`המשימה תופיע היום ב־${formatTime(previewDueAt)}`}
              </Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>שיוך</Text>
            <View
              style={[styles.chipsWrap, !canFullyEdit && styles.chipsReadOnly]}
            >
              {TASK_CATEGORIES.map((category) => (
                <Chip
                  key={category.key}
                  label={category.label}
                  active={draft.category === category.key}
                  onPress={
                    canFullyEdit
                      ? () => updateDraft({ category: category.key })
                      : () => undefined
                  }
                />
              ))}
            </View>
          </View>

          {hasDueDate && canFullyEdit ? (
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <Text style={styles.sectionTitleNoMargin}>משימה חוזרת</Text>
                <Switch
                  value={draft.recurrenceType !== 'none'}
                  onValueChange={(active) =>
                    updateDraft({
                      recurrenceType: active ? 'daily' : 'none',
                      selectedWeekdays: active ? draft.selectedWeekdays : [],
                    })
                  }
                  trackColor={{ true: PRIMARY, false: '#d7e3ef' }}
                  thumbColor="#fff"
                  accessible={true}
                  accessibilityLabel="משימה חוזרת"
                />
              </View>
              {draft.recurrenceType !== 'none' ? (
                <>
                  <View style={styles.chipsWrap}>
                    {RECURRENCE_OPTIONS.map((option) => (
                      <Chip
                        key={option.key}
                        label={option.label}
                        active={draft.recurrenceType === option.key}
                        onPress={() =>
                          updateDraft({
                            recurrenceType: option.key,
                            selectedWeekdays:
                              option.key === 'specific_days'
                                ? draft.selectedWeekdays
                                : [],
                          })
                        }
                      />
                    ))}
                  </View>
                  {draft.recurrenceType === 'specific_days' ? (
                    <View style={styles.weekdaysRow}>
                      {WEEKDAYS.map((weekday) => (
                        <Pressable
                          key={weekday.value}
                          style={[
                            styles.weekdayChip,
                            draft.selectedWeekdays.includes(weekday.value) &&
                              styles.weekdayChipActive,
                          ]}
                          onPress={() => toggleWeekday(weekday.value)}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: draft.selectedWeekdays.includes(
                              weekday.value
                            ),
                          }}
                          accessibilityLabel={weekday.label}
                        >
                          <Text
                            style={[
                              styles.weekdayText,
                              draft.selectedWeekdays.includes(weekday.value) &&
                                styles.weekdayTextActive,
                            ]}
                          >
                            {weekday.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {isParticipantNotCreator ? 'התזכורת שלך' : 'תזכורת'}
            </Text>
            {!hasDueDate ? (
              <Text style={styles.helperText}>בחרי מועד כדי להפעיל תזכורת</Text>
            ) : (
              <>
                <View style={styles.chipsWrap}>
                  {(draft.hasTime ? TIME_REMINDERS : DATE_REMINDERS).map(
                    (option) => (
                      <Chip
                        key={option.key}
                        label={option.label}
                        active={
                          option.key === 'none'
                            ? draft.reminders.length === 0
                            : hasReminder(option.key)
                        }
                        onPress={() => toggleReminder(option.key)}
                      />
                    )
                  )}
                </View>
                {draft.reminders
                  .filter((reminder) => reminder.type === 'custom')
                  .map((reminder) => (
                    <Pressable
                      key={reminder.id}
                      style={styles.selectionRow}
                      onPress={openCustomReminder}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="תזכורת מותאמת אישית"
                    >
                      <MaterialIcons
                        name="more-time"
                        size={18}
                        color={PRIMARY}
                      />
                      <Text style={styles.selectionText}>
                        {reminder.label ?? 'תזכורת מותאמת אישית'}
                      </Text>
                    </Pressable>
                  ))}
                {draft.reminderError ? (
                  <Text style={styles.errorText}>{draft.reminderError}</Text>
                ) : null}
              </>
            )}
          </View>

          {canFullyEdit ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>משויך ל...</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.assigneesRow}
              >
                <Pressable
                  style={[
                    styles.assigneeChip,
                    styles.everyoneChip,
                    allAssigneesSelected && styles.assigneeChipActive,
                  ]}
                  onPress={selectEveryone}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityState={{ selected: allAssigneesSelected }}
                  accessibilityLabel="כולם"
                >
                  <MaterialIcons
                    name="groups"
                    size={20}
                    color={allAssigneesSelected ? PRIMARY : '#64748b'}
                  />
                  <Text
                    style={[
                      styles.assigneeText,
                      allAssigneesSelected && styles.assigneeTextActive,
                    ]}
                  >
                    כולם
                  </Text>
                </Pressable>
                {assignees.map((assignee) => {
                  const active = selectedAssigneeIds.has(assignee.id);
                  return (
                    <Pressable
                      key={assignee.id}
                      style={[
                        styles.assigneeChip,
                        active && styles.assigneeChipActive,
                      ]}
                      onPress={() => toggleAssignee(assignee)}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={assignee.label}
                    >
                      <View
                        style={[
                          styles.avatarCircle,
                          { backgroundColor: assignee.color },
                        ]}
                      >
                        <Text style={styles.avatarText}>
                          {assignee.initials}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.assigneeText,
                          active && styles.assigneeTextActive,
                        ]}
                      >
                        {assignee.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.card}>
            <SubtasksSection
              subtasks={draft.subtasks}
              allowEditing={draft.allowParticipantEditing}
              onSubtasksChange={(subtasks) => updateDraft({ subtasks })}
              onAllowEditingChange={(allowParticipantEditing) =>
                updateDraft({ allowParticipantEditing })
              }
              onPendingDraftChange={(title) => {
                pendingSubtaskTitleRef.current = title;
              }}
              canEditSubtasks={canEditSubtasks}
              showToggle={canFullyEdit}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>קבצים ותמונות</Text>
            <EventAttachmentsSection
              attachments={draft.attachments}
              onChange={(attachments: EventAttachmentDraft[]) =>
                updateDraft({ attachments })
              }
              taskId={taskId ? (taskId as Id<'tasks'>) : undefined}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>הערות</Text>
            <TextInput
              value={draft.notes}
              onChangeText={(notes) => updateDraft({ notes })}
              placeholder="הוסיפי הערה אם צריך"
              placeholderTextColor="#94a3b8"
              style={styles.notesInput}
              multiline
              textAlign={rtl.inputTextAlign}
              textAlignVertical="top"
              accessible={true}
              accessibilityLabel="הערות"
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[
              styles.ctaButton,
              isCtaDisabled && styles.ctaButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={isCtaDisabled}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isCreate ? 'צור משימה' : 'שמור שינויים'}
          >
            <Text
              style={[styles.ctaText, isCtaDisabled && styles.ctaTextDisabled]}
            >
              {isSaving ? 'שומרת...' : isCreate ? 'צור משימה' : 'שמור שינויים'}
            </Text>
          </Pressable>

          {canDeleteFromEditor ? (
            <Pressable
              style={[
                styles.deleteButton,
                isDeleting && styles.deleteButtonDisabled,
              ]}
              onPress={handleDelete}
              disabled={isDeleting || isSaving}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="מחיקת משימה"
            >
              <MaterialIcons
                name="delete-outline"
                size={18}
                color={isDeleting ? '#9ca3af' : '#ef4444'}
              />
              <Text
                style={[
                  styles.deleteButtonText,
                  isDeleting && styles.deleteButtonTextDisabled,
                ]}
              >
                {isDeleting ? 'מוחק...' : 'מחק משימה'}
              </Text>
            </Pressable>
          ) : null}

          {isParticipantNotCreator ? (
            <Pressable
              style={[
                styles.leaveButton,
                isDeleting && styles.deleteButtonDisabled,
              ]}
              onPress={handleLeave}
              disabled={isDeleting || isSaving}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="עזיבת משימה"
            >
              <MaterialIcons
                name="exit-to-app"
                size={18}
                color={isDeleting ? '#9ca3af' : '#f97316'}
              />
              <Text
                style={[
                  styles.leaveButtonText,
                  isDeleting && styles.deleteButtonTextDisabled,
                ]}
              >
                {isDeleting ? 'עוזב...' : 'עזוב משימה'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={datePickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDatePickerOpen(false)}
      >
        <PickerSheet onClose={() => setDatePickerOpen(false)}>
          <Text style={styles.sheetTitle}>בחירת תאריך</Text>
          <DateTimePicker
            value={new Date(selectedDate)}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            locale="he"
            themeVariant="light"
            textColor="#111827"
            onChange={(_, selected) => {
              if (Platform.OS === 'android') setDatePickerOpen(false);
              if (selected) updateDraft({ selectedDate: midnightOf(selected) });
            }}
          />
        </PickerSheet>
      </Modal>

      <Modal
        visible={timePickerOpen}
        transparent
        animationType="slide"
        onRequestClose={handleCloseTimePicker}
      >
        <PickerSheet
          onClose={handleCloseTimePicker}
          onConfirm={handleApplyTime}
        >
          <Text style={styles.sheetTitle}>בחירת שעה</Text>
          <TimeWheelPicker
            hour={pickerHour}
            minute={pickerMinute}
            onHourChange={setPickerHour}
            onMinuteChange={setPickerMinute}
          />
          {timeError ? (
            <Text
              style={[styles.errorText, { textAlign: 'center', marginTop: 8 }]}
            >
              {timeError}
            </Text>
          ) : null}
        </PickerSheet>
      </Modal>

      <Modal
        visible={customReminderOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCustomReminderOpen(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setCustomReminderOpen(false)}
        >
          <Pressable style={styles.customSheet} onPress={() => undefined}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>תזכורת מותאמת אישית</Text>
            <View style={styles.customPickerRow}>
              <View style={styles.numberList}>
                <FlatList
                  ref={numListRef}
                  data={NUMBERS}
                  keyExtractor={(item) => String(item)}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={NUM_ITEM_H}
                  decelerationRate="fast"
                  getItemLayout={(_, index) => ({
                    length: NUM_ITEM_H,
                    offset: NUM_ITEM_H * index,
                    index,
                  })}
                  contentContainerStyle={{
                    paddingTop: NUM_ITEM_H,
                    paddingBottom: NUM_ITEM_H,
                  }}
                  onMomentumScrollEnd={(event) => {
                    const index = Math.round(
                      event.nativeEvent.contentOffset.y / NUM_ITEM_H
                    );
                    setCustomAmount(Math.max(1, Math.min(100, index + 1)));
                  }}
                  renderItem={({ item }) => {
                    const selected = customAmount === item;
                    return (
                      <Pressable
                        style={[
                          styles.numberItem,
                          selected && styles.numberItemSelected,
                        ]}
                        onPress={() => {
                          setCustomAmount(item);
                          numListRef.current?.scrollToIndex({
                            index: item - 1,
                            animated: true,
                          });
                        }}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={String(item)}
                      >
                        <Text
                          style={[
                            styles.numberText,
                            selected && styles.numberTextSelected,
                          ]}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    );
                  }}
                />
              </View>
              <View style={styles.unitColumn}>
                {(['minutes', 'hours', 'days'] as TaskReminderUnit[]).map(
                  (unit) => (
                    <Pressable
                      key={unit}
                      style={[
                        styles.unitChip,
                        customUnit === unit && styles.unitChipActive,
                      ]}
                      onPress={() => setCustomUnit(unit)}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityState={{ selected: customUnit === unit }}
                      accessibilityLabel={UNIT_LABELS[unit]}
                    >
                      <Text
                        style={[
                          styles.unitText,
                          customUnit === unit && styles.unitTextActive,
                        ]}
                      >
                        {UNIT_LABELS[unit]}
                      </Text>
                    </Pressable>
                  )
                )}
              </View>
              <Text style={styles.beforeLabel}>לפני</Text>
            </View>
            <Text style={styles.customPreview}>
              {`תזכורת: ${customAmount} ${UNIT_LABELS[customUnit]} לפני המשימה`}
            </Text>
            {customReminderError ? (
              <Text style={styles.errorText}>{customReminderError}</Text>
            ) : null}
            <Pressable
              style={[
                styles.sheetSaveButton,
                customReminderError && styles.sheetSaveButtonDisabled,
              ]}
              onPress={confirmCustomReminder}
              disabled={customReminderError !== null}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="שמור תזכורת"
            >
              <Text
                style={[
                  styles.sheetSaveText,
                  customReminderError && styles.sheetSaveTextDisabled,
                ]}
              >
                שמור
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={discardOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDiscardOpen(false)}
      >
        <View style={styles.discardOverlay}>
          <View style={styles.discardModal}>
            <Text style={styles.discardTitle}>
              {isCreate ? 'יציאה ללא שמירה' : 'יש שינויים שלא נשמרו'}
            </Text>
            <Text style={styles.discardMessage}>
              {isCreate
                ? 'האם ברצונך למחוק את הנתונים שהכנסת?'
                : 'השינויים שביצעת לא יישמרו אם תצאי עכשיו.'}
            </Text>
            <View style={styles.discardActions}>
              <Pressable
                style={styles.discardKeepButton}
                onPress={() => setDiscardOpen(false)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="המשך עריכה"
              >
                <Text style={styles.discardKeepText}>המשך עריכה</Text>
              </Pressable>
              <Pressable
                style={
                  isCreate
                    ? styles.discardDeleteButton
                    : styles.discardCancelChangesButton
                }
                onPress={() => {
                  setDiscardOpen(false);
                  navigateToDestination();
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={isCreate ? 'מחק וצא' : 'בטל שינויים'}
              >
                <Text
                  style={
                    isCreate
                      ? styles.discardDeleteText
                      : styles.discardCancelChangesText
                  }
                >
                  {isCreate ? 'מחק וצא' : 'בטל שינויים'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PickerSheet({
  children,
  onClose,
  onConfirm,
}: {
  children: React.ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
}): React.JSX.Element {
  return (
    <Pressable style={styles.modalOverlay} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => undefined}>
        <View style={styles.sheetHandle} />
        {children}
        <Pressable
          style={styles.sheetDoneButton}
          onPress={onConfirm ?? onClose}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="בחר"
        >
          <Text style={styles.sheetDoneText}>בחר</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f8f8' },
  safeAreaRtl: {
    direction: 'rtl',
  },
  flex: { flex: 1 },
  header: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f6f8f8',
  },
  headerSpacer: { width: 40 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111517',
    textAlign: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 120 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: rtl.textAlign,
    marginBottom: 10,
  },
  sectionTitleNoMargin: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  titleInput: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#0f172a',
    textAlign: rtl.inputTextAlign,
  },
  inputError: { borderWidth: 1.5, borderColor: '#ef4444' },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: rtl.textAlign,
    marginTop: 8,
  },
  chipsWrap: {
    flexDirection: rtl.flexDirection,
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: TINT,
    borderColor: PRIMARY,
  },
  chipText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: PRIMARY },
  selectionRow: {
    marginTop: 12,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
  },
  selectionText: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
    textAlign: rtl.textAlign,
  },
  hebrewDateHint: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: rtl.textAlign,
    marginTop: 3,
    paddingHorizontal: 4,
  },
  toggleRow: {
    marginTop: 12,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    textAlign: rtl.textAlign,
  },
  helperText: {
    marginTop: 12,
    color: '#64748b',
    fontSize: 13,
    textAlign: rtl.textAlign,
    lineHeight: 20,
  },
  weekdaysRow: {
    marginTop: 12,
    flexDirection: rtl.flexDirection,
    gap: 8,
  },
  weekdayChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  weekdayChipActive: { backgroundColor: PRIMARY },
  weekdayText: { color: '#64748b', fontWeight: '800' },
  weekdayTextActive: { color: '#fff' },
  assigneesRow: {
    flexDirection: rtl.flexDirection,
    gap: 10,
    paddingLeft: 4,
  },
  everyoneChip: {
    justifyContent: 'center',
  },
  assigneeChip: {
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 74,
  },
  assigneeChipActive: {
    borderColor: PRIMARY,
    backgroundColor: TINT,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  assigneeText: {
    color: '#64748b',
    fontWeight: '700',
    fontSize: 12,
    maxWidth: 90,
    textAlign: 'center',
  },
  assigneeTextActive: { color: PRIMARY },
  notesInput: {
    minHeight: 92,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    padding: 14,
    fontSize: 15,
    color: '#0f172a',
    textAlign: rtl.inputTextAlign,
  },
  footer: {
    padding: 16,
    backgroundColor: 'rgba(246,248,248,0.96)',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  ctaButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonDisabled: { backgroundColor: '#e2e8f0' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ctaTextDisabled: { color: '#94a3b8' },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
  },
  deleteButtonDisabled: { opacity: 0.4 },
  deleteButtonText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
  deleteButtonTextDisabled: { color: '#9ca3af' },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
  },
  leaveButtonText: { color: '#f97316', fontSize: 14, fontWeight: '600' },
  fieldReadOnly: {
    backgroundColor: '#f1f5f9',
    color: '#64748b',
  },
  fieldLockedHint: {
    marginTop: 6,
    fontSize: 11,
    color: '#94a3b8',
    textAlign: rtl.textAlign,
  },
  chipsReadOnly: { opacity: 0.7 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.32)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  customSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 28,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
    marginBottom: 16,
  },
  sheetTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  sheetDoneButton: {
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: TINT,
    marginTop: 8,
  },
  sheetDoneText: { color: PRIMARY, fontWeight: '800' },
  sheetSaveButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  sheetSaveButtonDisabled: { backgroundColor: '#e2e8f0' },
  sheetSaveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sheetSaveTextDisabled: { color: '#94a3b8' },
  customPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: 6,
  },
  beforeLabel: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '900',
  },
  unitColumn: { gap: 8 },
  unitChip: {
    minWidth: 70,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  unitChipActive: { backgroundColor: TINT },
  unitText: { color: '#64748b', fontWeight: '700' },
  unitTextActive: { color: PRIMARY },
  numberList: {
    width: 86,
    height: NUM_ITEM_H * 3,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  numberItem: {
    height: NUM_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberItemSelected: { backgroundColor: TINT },
  numberText: { color: '#94a3b8', fontSize: 18, fontWeight: '700' },
  numberTextSelected: { color: PRIMARY, fontSize: 22, fontWeight: '900' },
  customPreview: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 4,
  },
  discardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.36)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  discardModal: {
    width: '100%',
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 22,
  },
  discardTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
    textAlign: rtl.textAlign,
    marginBottom: 8,
  },
  discardMessage: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 22,
    textAlign: rtl.textAlign,
  },
  discardActions: {
    flexDirection: rtl.flexDirection,
    gap: 10,
    marginTop: 20,
  },
  discardKeepButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardKeepText: {
    color: PRIMARY,
    fontWeight: '800',
  },
  discardDeleteButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardCancelChangesButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardDeleteText: {
    color: '#dc2626',
    fontWeight: '800',
  },
  discardCancelChangesText: {
    color: '#475569',
    fontWeight: '800',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  centerText: { color: '#64748b', fontSize: 15 },
});
