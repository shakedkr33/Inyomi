import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MainScreenHeader } from '@/components/MainScreenHeader';
import { TaskDetailsBottomSheet } from '@/components/tasks/TaskDetailsBottomSheet';
import { UpgradeModal } from '@/components/UpgradeModal';
import { colors } from '@/constants/theme';
import { useNotifications } from '@/contexts/NotificationsContext';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import { getAvatarInitials } from '@/lib/avatarInitials';
import { NotificationsDrawer } from '@/lib/components/notifications/NotificationsDrawer';
import { InlineSubtasksEditor } from '@/lib/components/task/InlineSubtasksEditor';
import { APP_IS_RTL, needsExplicitRTL, rtl } from '@/lib/rtl';
import { getEffectiveTaskDueTimestamp } from '@/lib/taskDueStatus';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;
import { getTaskCategoryLabel } from '@/lib/types/task';

const PRIMARY_BLUE = colors.primaryDark;
const PRIMARY_BLUE_TINT = '#E8F5FD';
const TEXT_DARK = '#111418';
const TEXT_MUTED = '#637588';
const CARD_BORDER = '#eef2f7';
const COMPLETED_WINDOW_48_HOURS = 48 * 60 * 60 * 1000;
const COMPLETED_WINDOW_7_DAYS = 7 * 24 * 60 * 60 * 1000;

const TASK_TABS = [
  'הכל',
  'אישי',
  'קניות',
  'משפחה',
  'עבודה',
  'קהילות',
  'אירועי יומן',
] as const;

type TaskTab = (typeof TASK_TABS)[number];
type TaskKind = 'task' | 'eventTask';
type Placement = 'mine' | 'tracking' | 'completed' | 'hidden';
type MineGroupKey = 'overdue' | 'today' | 'upcoming' | 'undated';

type SubtaskRow = {
  id: string;
  title: string;
  completed: boolean;
  attachment?: SubtaskAttachmentPreviewData;
  image?: SubtaskAttachmentPreviewData;
};

type SubtaskAttachmentPreviewData = {
  storageId?: Id<'_storage'> | string;
  localUri?: string;
  mimeType?: string;
  displayName?: string;
  originalName?: string;
};

type AssigneeDisplay = {
  key: string;
  name: string;
  initials: string;
  color: string;
};

type DisplayTask = {
  uid: string;
  id: string;
  kind: TaskKind;
  title: string;
  completed: boolean;
  category: TaskTab;
  dueDate?: number;
  dueAt?: number;
  hasTime?: boolean;
  completedAt?: number;
  updatedAt?: number;
  createdAt?: number;
  createdBy?: string;
  assignedTo?: string;
  assignedToMemberId?: string;
  assignedToUserIds: string[];
  assignedToMemberIds: string[];
  communityId?: string;
  sourceType?: string;
  sourceEventId?: string;
  eventTitle?: string;
  eventId?: string;
  eventStartTime?: number;
  eventAllDay?: boolean;
  communityName?: string;
  assigneeMemberProfiles?: { id: string; name: string; color: string | null }[];
  subtasks: SubtaskRow[];
  hasAttachments: boolean;
  hasReminders: boolean;
  isEventTask: boolean;
  placement: Placement;
  mineGroup?: MineGroupKey;
  responsibilityLabel?: 'הוקצה אליי' | 'כולם';
  assigneeNames: string[];
  assigneeDisplays: AssigneeDisplay[];
  secondaryText: string;
  searchText: string;
  sortTimestamp: number;
};

type MemberOption = {
  _id: string;
  displayName?: string;
  matchedUserId?: string;
  color?: string;
};

type MemberMaps = {
  selfEntityId?: string;
  userNames: Map<string, string>;
  memberNames: Map<string, string>;
  userColors: Map<string, string>;
  memberColors: Map<string, string>;
  visibleAssigneeCount: number;
};

const EMPTY_STATES: Record<TaskTab, { title: string; helper?: string }> = {
  הכל: { title: 'אין עדיין משימות פתוחות.' },
  אישי: { title: 'אין עדיין משימות אישיות.' },
  קניות: {
    title: 'אין עדיין רשימות קניות.',
    helper: 'אפשר ליצור רשימת קניות עם פריטים, תמונות ותזכורות.',
  },
  משפחה: {
    title: 'אין עדיין משימות משפחתיות.',
    helper: 'כאן יופיעו משימות שישויכו למשפחה.',
  },
  עבודה: { title: 'אין עדיין משימות עבודה.' },
  קהילות: {
    title: 'אין עדיין משימות מקהילות.',
    helper: 'משימות מאירועי קהילה או מקבוצות יופיעו כאן.',
  },
  'אירועי יומן': {
    title: 'אין עדיין משימות מאירועי יומן.',
    helper: 'כשתיווצר משימה שמחוברת לאירוע, היא תופיע כאן.',
  },
};

const MINE_GROUPS: {
  key: MineGroupKey;
  title: string;
}[] = [
  { key: 'overdue', title: 'עבר המועד' },
  { key: 'today', title: 'היום' },
  { key: 'upcoming', title: 'בהמשך' },
  { key: 'undated', title: 'ללא תאריך' },
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function dayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDaysFromToday(days: number): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
  });
}

function formatDueText(task: {
  dueDate?: number;
  dueAt?: number;
  hasTime?: boolean;
  eventStartTime?: number;
  eventAllDay?: boolean;
}): string {
  const timestamp = task.dueAt ?? task.dueDate ?? task.eventStartTime;
  if (!timestamp) return 'ללא תאריך';

  const today = addDaysFromToday(0);
  const tomorrow = addDaysFromToday(1);
  const taskDay = dayStart(timestamp);
  const dayLabel =
    taskDay === today
      ? 'היום'
      : taskDay === tomorrow
        ? 'מחר'
        : formatDate(timestamp);
  const hasTime = task.dueAt !== undefined || task.eventAllDay === false;

  if (!hasTime || task.eventAllDay) return dayLabel;
  return `${dayLabel} ${formatTime(timestamp)}`;
}

function getDueSortTimestamp(task: {
  dueDate?: number;
  dueAt?: number;
  eventStartTime?: number;
  createdAt?: number;
}): number {
  return (
    task.dueAt ?? task.dueDate ?? task.eventStartTime ?? task.createdAt ?? 0
  );
}

function getMineGroup(task: DisplayTask, now: number): MineGroupKey {
  const effectiveDue = getEffectiveTaskDueTimestamp(task);
  if (!effectiveDue) return 'undated';
  if (effectiveDue < now) return 'overdue';

  const today = addDaysFromToday(0);
  const tomorrow = addDaysFromToday(1);
  const taskDay = dayStart(effectiveDue);
  if (taskDay === today) return 'today';
  if (taskDay >= tomorrow) return 'upcoming';
  return 'undated';
}

function getTaskTabFromCategory(category?: string): TaskTab {
  if (category === 'shopping') return 'קניות';
  if (category === 'family') return 'משפחה';
  if (category === 'work') return 'עבודה';
  if (category === 'community') return 'קהילות';
  if (category === 'calendar_event') return 'אירועי יומן';
  return getTaskCategoryLabel(category) as TaskTab;
}

function resolveTaskCategory(task: {
  category?: string;
  communityId?: unknown;
  sourceType?: string;
}): TaskTab {
  if (
    task.communityId ||
    task.sourceType === 'community_event_important_item'
  ) {
    return 'קהילות';
  }
  return getTaskTabFromCategory(task.category);
}

function resolveAssigneeNames(
  task: Pick<
    DisplayTask,
    | 'assignedTo'
    | 'assignedToMemberId'
    | 'assignedToUserIds'
    | 'assignedToMemberIds'
    | 'assigneeMemberProfiles'
  >,
  _currentUserId: string | undefined,
  maps: MemberMaps
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (key: string, name: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  const userIds = [...task.assignedToUserIds];
  if (task.assignedTo) userIds.push(task.assignedTo);
  for (const userId of userIds) {
    addName(`user:${userId}`, maps.userNames.get(userId) ?? '');
  }

  const memberIds = [...task.assignedToMemberIds];
  if (task.assignedToMemberId) memberIds.push(task.assignedToMemberId);
  for (const memberId of memberIds) {
    // Primary: task-embedded profile resolved directly from the DB.
    // Fallback: listMyFamilyContacts-based map (for freshly added members).
    const embedded = task.assigneeMemberProfiles?.find(
      (p) => p.id === memberId
    );
    const name = embedded?.name ?? maps.memberNames.get(memberId) ?? '';
    addName(`member:${memberId}`, name);
  }

  return names.filter((n) => n.length > 0);
}

function resolveAssigneeDisplays(
  task: Pick<
    DisplayTask,
    | 'assignedTo'
    | 'assignedToMemberId'
    | 'assignedToUserIds'
    | 'assignedToMemberIds'
    | 'createdBy'
    | 'assigneeMemberProfiles'
  >,
  currentUserId: string | undefined,
  maps: MemberMaps
): AssigneeDisplay[] {
  const displays: AssigneeDisplay[] = [];
  const seen = new Set<string>();
  const addDisplay = (key: string, name: string, color?: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    displays.push({
      key,
      name,
      initials: getAvatarInitials(name),
      color: color ?? PRIMARY_BLUE,
    });
  };

  const currentUserIsCreator = task.createdBy === currentUserId;
  const currentUserIsAssignee =
    currentUserId !== undefined &&
    (task.assignedToUserIds.includes(currentUserId) ||
      task.assignedTo === currentUserId);
  const currentMemberIsAssignee =
    maps.selfEntityId !== undefined &&
    (task.assignedToMemberIds.includes(maps.selfEntityId) ||
      task.assignedToMemberId === maps.selfEntityId);
  const viewerIsAssignee = currentUserIsAssignee || currentMemberIsAssignee;

  // ── For assignee viewers who are NOT the creator ───────────────────────────
  // Show the creator's avatar so the assignee knows who assigned the task.
  if (!currentUserIsCreator && viewerIsAssignee && task.createdBy) {
    const creatorName = maps.userNames.get(task.createdBy);
    if (creatorName && task.createdBy !== currentUserId) {
      addDisplay(
        `user:${task.createdBy}`,
        creatorName,
        maps.userColors.get(task.createdBy)
      );
    }
  }

  // ── User assignees ─────────────────────────────────────────────────────────
  const userIds = [...task.assignedToUserIds];
  if (task.assignedTo) userIds.push(task.assignedTo);
  for (const userId of userIds) {
    if (userId === currentUserId) continue; // viewer never shown in avatars
    const name = maps.userNames.get(userId) ?? '';
    addDisplay(`user:${userId}`, name, maps.userColors.get(userId));
  }

  // ── Member assignees (family entities without an app account) ─────────────
  // Use the task-embedded profile (resolved directly from the DB in listMyTasks)
  // as the primary name source. Fall back to listMyFamilyContacts-based maps for
  // members added after the task was last fetched.
  const memberIds = [...task.assignedToMemberIds];
  if (task.assignedToMemberId) memberIds.push(task.assignedToMemberId);
  for (const memberId of memberIds) {
    if (memberId === maps.selfEntityId) continue; // viewer's own entity never shown
    const embedded = task.assigneeMemberProfiles?.find(
      (p) => p.id === memberId
    );
    const name = embedded?.name ?? maps.memberNames.get(memberId) ?? '';
    const color =
      embedded?.color ?? maps.memberColors.get(memberId) ?? undefined;
    addDisplay(`member:${memberId}`, name, color);
  }

  return displays;
}

function isAssignedToCurrentUser(
  task: Pick<
    DisplayTask,
    | 'assignedTo'
    | 'assignedToMemberId'
    | 'assignedToUserIds'
    | 'assignedToMemberIds'
  >,
  currentUserId: string | undefined,
  selfEntityId: string | undefined
): boolean {
  if (!currentUserId && !selfEntityId) return false;
  return (
    (currentUserId !== undefined &&
      (task.assignedTo === currentUserId ||
        task.assignedToUserIds.includes(currentUserId))) ||
    (selfEntityId !== undefined &&
      (task.assignedToMemberId === selfEntityId ||
        task.assignedToMemberIds.includes(selfEntityId)))
  );
}

function isAssignedToEveryone(task: DisplayTask, maps: MemberMaps): boolean {
  const assignedKeys = new Set<string>();
  for (const userId of task.assignedToUserIds)
    assignedKeys.add(`user:${userId}`);
  if (task.assignedTo) assignedKeys.add(`user:${task.assignedTo}`);
  for (const memberId of task.assignedToMemberIds)
    assignedKeys.add(`member:${memberId}`);
  if (task.assignedToMemberId)
    assignedKeys.add(`member:${task.assignedToMemberId}`);
  return (
    maps.visibleAssigneeCount > 1 &&
    assignedKeys.size >= maps.visibleAssigneeCount
  );
}

function hasAnyAssignee(task: DisplayTask): boolean {
  return (
    task.assignedTo !== undefined ||
    task.assignedToMemberId !== undefined ||
    task.assignedToUserIds.length > 0 ||
    task.assignedToMemberIds.length > 0
  );
}

function isCreatedForSelfOnly(
  task: DisplayTask,
  currentUserId: string | undefined
): boolean {
  if (task.createdBy !== currentUserId) return false;
  if (hasAnyAssignee(task)) return false;
  // Canonical community important-item tasks (no assignedTo) are community-shared
  // rows created on behalf of the community, not personal tasks of the event creator.
  // Personal copies (assignedTo === userId) are captured separately via importantItemTaskRows.
  if (task.communityId && task.sourceType === 'community_event_important_item')
    return false;
  return true;
}

function recentCompletedTimestamp(task: DisplayTask): number | undefined {
  if (!task.completed) return undefined;
  return task.completedAt ?? task.updatedAt ?? task.createdAt;
}

function buildSecondaryText(task: DisplayTask): string {
  const dueText = formatDueText(task);
  if (task.eventTitle) {
    return `${task.eventTitle} · ${dueText}`;
  }
  if (task.communityName) {
    return `${task.communityName} · ${dueText}`;
  }
  return dueText;
}

function sortTasks(a: DisplayTask, b: DisplayTask): number {
  return (
    a.sortTimestamp - b.sortTimestamp || a.title.localeCompare(b.title, 'he')
  );
}

function taskMatchesTab(task: DisplayTask, activeFilter: TaskTab): boolean {
  return activeFilter === 'הכל' || task.category === activeFilter;
}

function taskMatchesSearch(task: DisplayTask, searchQuery: string): boolean {
  const normalizedSearch = normalizeText(searchQuery);
  if (!normalizedSearch) return true;
  return normalizeText(task.searchText).includes(normalizedSearch);
}

function getSubtaskAttachment(
  subtask: SubtaskRow
): SubtaskAttachmentPreviewData | undefined {
  return subtask.attachment ?? subtask.image;
}

/**
 * A DisplayTask is "personally deletable" if:
 * - It is from the tasks table (not an eventTask)
 * - It was created by the current user
 * - It is not a community reminder (communityId set without sourceType)
 *
 * Important items copied from events (sourceType === 'community_event_important_item')
 * are personally deletable even if communityId is set.
 */
function isPersonallyDeletableDisplayTask(
  task: DisplayTask,
  currentUserId: string | undefined
): boolean {
  if (!currentUserId) return false;
  if (task.kind === 'eventTask') return false;
  if (task.createdBy !== currentUserId) return false;
  // Community reminders (communityId set, no sourceType) are community-shared
  if (task.communityId && !task.sourceType) return false;
  return true;
}

/**
 * A task is "shared" if it has other assignees beyond the creator.
 * Owner can still delete, but gets a stronger warning alert.
 */
function isSharedTask(task: DisplayTask, currentUserId: string): boolean {
  const otherUsers = task.assignedToUserIds.filter(
    (id) => id !== currentUserId
  );
  const hasMemberAssignment = task.assignedToMemberIds.length > 0;
  return otherUsers.length > 0 || hasMemberAssignment;
}

export default function TasksScreen() {
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<TaskTab>('הכל');
  const [showMoreCompleted, setShowMoreCompleted] = useState(false);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(
    new Set()
  );
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [previewImageError, setPreviewImageError] = useState(false);
  const [previewImageLoading, setPreviewImageLoading] = useState(false);

  const openImagePreview = useCallback((uri: string) => {
    setPreviewImageError(false);
    setPreviewImageLoading(true);
    setPreviewImageUri(uri);
  }, []);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const { isExpiredFree } = useEffectiveAccess();
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);

  function handleGatedCreateAction(action: () => void): void {
    if (isExpiredFree) {
      setUpgradeModalVisible(true);
      return;
    }
    action();
  }

  const [taskSheetTaskId, setTaskSheetTaskId] = useState<string | null>(null);
  const [taskSheetVisible, setTaskSheetVisible] = useState(false);
  const {
    unseenCount,
    markAllSeen,
    isLoading: notificationsLoading,
  } = useNotifications();

  const handleBellPress = (): void => {
    if (!isNotificationsOpen) {
      setIsNotificationsOpen(true);
    }
    if (!notificationsLoading) {
      markAllSeen();
    }
  };

  const currentUser = useQuery(api.users.getCurrentUser);
  const familyContacts = useQuery(api.members.listMyFamilyContacts);

  // User-centric query — returns all tasks the current user is involved in,
  // regardless of which space they live in (fixes shared task visibility).
  const myTasks = useQuery(api.tasks.listMyTasks, {});
  const eventTaskRange = useMemo(() => {
    const fromDate = new Date();
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + 90);
    toDate.setHours(23, 59, 59, 999);
    return { from: fromDate.getTime(), to: toDate.getTime() };
  }, []);
  const assignedEventTaskRows = useQuery(
    api.eventTasks.listMyAssignedEventTasks,
    eventTaskRange
  );
  const privatePersonalAssignments = useQuery(api.eventTasks.listMyPrivatePersonalAssignments, {});
  const setEventTaskAssignee = useMutation(api.eventTasks.setAssignee);
  // important-to-remember tasks (community event important items)
  const importantItemTaskRows = useQuery(
    api.tasks.listMyImportantItemTasks,
    {}
  );

  const toggleCompletedMutation = useMutation(api.tasks.toggleCompleted);
  const toggleEventTaskCompletedMutation = useMutation(
    api.eventTasks.toggleCompleted
  );
  const toggleSubtaskMutation = useMutation(api.tasks.toggleSubtaskCompleted);
  const softDeleteTaskMutation = useMutation(api.tasks.softDeleteTask);
  const unclaimEventTaskMutation = useMutation(api.eventTasks.unclaimEventTask);

  const currentUserId = currentUser?._id as string | undefined;

  const memberMaps = useMemo<MemberMaps>(() => {
    const members = (familyContacts?.members ?? []) as MemberOption[];
    const selfEntityId = familyContacts?.selfEntityId as string | undefined;
    const userNames = new Map<string, string>();
    const memberNames = new Map<string, string>();
    const userColors = new Map<string, string>();
    const memberColors = new Map<string, string>();

    if (currentUserId) {
      userNames.set(currentUserId, currentUser?.fullName?.trim() || '');
      userColors.set(currentUserId, PRIMARY_BLUE);
    }
    for (const member of members) {
      const name = member.displayName?.trim() || '';
      const color = member.color ?? PRIMARY_BLUE;
      memberNames.set(member._id, name);
      memberColors.set(member._id, color);
      if (member.matchedUserId) {
        userNames.set(member.matchedUserId, name);
        userColors.set(member.matchedUserId, color);
      }
    }

    const visibleAssigneeCount =
      1 + members.filter((member) => member._id !== selfEntityId).length;

    return {
      selfEntityId,
      userNames,
      memberNames,
      userColors,
      memberColors,
      visibleAssigneeCount,
    };
  }, [
    currentUserId,
    currentUser?.fullName,
    familyContacts?.members,
    familyContacts?.selfEntityId,
  ]);

  const allTasks: DisplayTask[] = useMemo(() => {
    const byId = new Map<string, DisplayTask>();
    const now = Date.now();

    // ── Regular personal/family/work/shopping tasks ──────────────────────────
    // listMyTasks now enriches tasks with communityName (via batch community lookup),
    // so bundle tasks automatically receive the community chip data here.
    for (const row of myTasks ?? []) {
      const assignedToUserIds = ((row.assignedToUserIds ?? []) as string[]).map(
        String
      );
      const assignedToMemberIds = (
        (row.assignedToMemberIds ?? []) as string[]
      ).map(String);
      const task: DisplayTask = {
        uid: `task:${row._id}`,
        id: String(row._id),
        kind: 'task',
        title: row.title,
        completed: row.completed,
        category: resolveTaskCategory(row),
        dueDate: row.dueDate,
        dueAt: row.dueAt,
        hasTime: row.hasTime,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
        createdBy: String(row.createdBy),
        assignedTo: row.assignedTo ? String(row.assignedTo) : undefined,
        assignedToMemberId: row.assignedToMemberId
          ? String(row.assignedToMemberId)
          : undefined,
        assignedToUserIds,
        assignedToMemberIds,
        communityId: row.communityId ? String(row.communityId) : undefined,
        communityName: row.communityName ?? undefined,
        assigneeMemberProfiles:
          (row.assigneeMemberProfiles as
            | { id: string; name: string; color: string | null }[]
            | undefined) ?? [],
        sourceType: row.sourceType,
        sourceEventId: row.sourceEventId
          ? String(row.sourceEventId)
          : undefined,
        subtasks: (row.subtasks ?? []) as SubtaskRow[],
        hasAttachments: (row.attachments ?? []).length > 0,
        hasReminders:
          (row.reminders ?? []).length > 0 ||
          (row.reminderType !== undefined && row.reminderType !== 'none'),
        isEventTask: row.sourceType === 'community_event_important_item',
        placement: 'hidden',
        assigneeNames: [],
        assigneeDisplays: [],
        secondaryText: '',
        searchText: '',
        sortTimestamp: getDueSortTimestamp(row),
      };
      byId.set(task.uid, task);
    }

    // ── Community event tasks (eventTasks table) ─────────────────────────────
    for (const eventTask of assignedEventTaskRows ?? []) {
      const task: DisplayTask = {
        uid: `eventTask:${eventTask._id}`,
        id: String(eventTask._id),
        kind: 'eventTask',
        title: eventTask.title,
        completed: eventTask.completed,
        category: eventTask.communityId ? 'קהילות' : 'אישי',
        eventId: String(eventTask.eventId),
        eventTitle: eventTask.eventTitle,
        communityId: eventTask.communityId
          ? String(eventTask.communityId)
          : undefined,
        eventStartTime: eventTask.eventStartTime,
        eventAllDay: eventTask.eventAllDay,
        communityName: eventTask.communityName,
        assignedToUserIds: currentUserId ? [currentUserId] : [],
        assignedToMemberIds: [],
        subtasks: [],
        hasAttachments: false,
        hasReminders: false,
        isEventTask: true,
        placement: eventTask.completed ? 'completed' : 'mine',
        responsibilityLabel: 'הוקצה אליי',
        assigneeNames: ['אני'],
        assigneeDisplays: [],
        secondaryText: '',
        searchText: '',
        sortTimestamp: eventTask.eventStartTime,
      };
      byId.set(task.uid, task);
    }

    for (const row of privatePersonalAssignments ?? []) {
      const task: DisplayTask = {
        uid: `eventTask:${row._id}`, id: row._id, kind: 'eventTask',
        title: row.title, completed: row.completed, category: 'אישי',
        assignedToUserIds: currentUserId ? [currentUserId] : [], assignedToMemberIds: [],
        subtasks: [], hasAttachments: false, hasReminders: false, isEventTask: true,
        placement: row.completed ? 'completed' : 'mine', responsibilityLabel: 'הוקצה אליי',
        assigneeNames: ['אני'], assigneeDisplays: [], secondaryText: '', searchText: '',
        sortTimestamp: Number.MAX_SAFE_INTEGER,
      };
      byId.set(task.uid, task);
    }

    // ── Important-to-remember tasks (חשוב לזכור) ─────────────────────────────
    for (const impTask of importantItemTaskRows ?? []) {
      const uid = `importantTask:${impTask._id}`;
      // Skip if already present from regular queries (avoids duplicate)
      if (byId.has(`task:${impTask._id}`)) continue;
      const task: DisplayTask = {
        uid,
        id: String(impTask._id),
        kind: 'task',
        title: impTask.title,
        completed: impTask.completed,
        category: 'קהילות',
        eventTitle: impTask.eventTitle,
        eventStartTime: impTask.eventStartTime,
        eventAllDay: impTask.eventAllDay,
        communityName: impTask.communityName,
        sourceType: 'community_event_important_item',
        assignedToUserIds: currentUserId ? [currentUserId] : [],
        assignedToMemberIds: [],
        subtasks: [],
        hasAttachments: false,
        hasReminders: false,
        isEventTask: true,
        placement: impTask.completed ? 'completed' : 'mine',
        responsibilityLabel: undefined,
        assigneeNames: ['אני'],
        assigneeDisplays: [],
        secondaryText: '',
        searchText: '',
        sortTimestamp: impTask.eventStartTime,
      };
      byId.set(uid, task);
    }

    return [...byId.values()].map((task) => {
      const assignedToSelf = isAssignedToCurrentUser(
        task,
        currentUserId,
        memberMaps.selfEntityId
      );
      const assignedToEveryone = isAssignedToEveryone(task, memberMaps);
      const createdBySelf = task.createdBy === currentUserId;
      const placement: Placement = task.completed
        ? 'completed'
        : assignedToSelf ||
            assignedToEveryone ||
            isCreatedForSelfOnly(task, currentUserId)
          ? 'mine'
          : createdBySelf && hasAnyAssignee(task)
            ? 'tracking'
            : task.placement === 'mine'
              ? 'mine'
              : 'hidden';
      const responsibilityLabel = assignedToEveryone
        ? 'כולם'
        : assignedToSelf && !createdBySelf
          ? 'הוקצה אליי'
          : undefined;
      const assigneeNames = resolveAssigneeNames(
        task,
        currentUserId,
        memberMaps
      );
      const assigneeDisplays = resolveAssigneeDisplays(
        task,
        currentUserId,
        memberMaps
      );
      const mineGroup =
        placement === 'mine' ? getMineGroup(task, now) : undefined;
      const enrichedTask: DisplayTask = {
        ...task,
        placement,
        responsibilityLabel,
        assigneeNames,
        assigneeDisplays,
        mineGroup,
      };
      const secondaryText = buildSecondaryText(enrichedTask);
      return {
        ...enrichedTask,
        secondaryText,
        searchText: [
          enrichedTask.title,
          secondaryText,
          enrichedTask.category,
          enrichedTask.eventTitle,
          enrichedTask.communityName,
          ...assigneeNames,
        ]
          .filter(Boolean)
          .join(' '),
      };
    });
  }, [
    assignedEventTaskRows,
    privatePersonalAssignments,
    myTasks,
    currentUserId,
    importantItemTaskRows,
    memberMaps,
  ]);

  const visibleTasks = useMemo(
    () =>
      allTasks
        .filter((task) => task.placement !== 'hidden')
        .filter((task) => taskMatchesTab(task, activeFilter))
        .filter((task) => taskMatchesSearch(task, searchQuery)),
    [activeFilter, allTasks, searchQuery]
  );

  const mineGroups = useMemo(() => {
    const groups: Record<MineGroupKey, DisplayTask[]> = {
      overdue: [],
      today: [],
      upcoming: [],
      undated: [],
    };
    for (const task of visibleTasks) {
      if (task.placement !== 'mine' || !task.mineGroup) continue;
      groups[task.mineGroup].push(task);
    }
    for (const key of Object.keys(groups) as MineGroupKey[]) {
      groups[key].sort(sortTasks);
    }
    return groups;
  }, [visibleTasks]);

  const trackingTasks = useMemo(
    () =>
      visibleTasks
        .filter((task) => task.placement === 'tracking')
        .sort(sortTasks),
    [visibleTasks]
  );

  const completedCandidates = useMemo(
    () =>
      visibleTasks
        .filter((task) => task.placement === 'completed')
        .sort((a, b) => {
          const completedA = recentCompletedTimestamp(a) ?? 0;
          const completedB = recentCompletedTimestamp(b) ?? 0;
          return completedB - completedA;
        }),
    [visibleTasks]
  );

  const hasMoreCompletedTasks = useMemo(() => {
    const now = Date.now();
    return completedCandidates.some((task) => {
      const completedAt = recentCompletedTimestamp(task);
      if (completedAt === undefined) return false;
      const age = now - completedAt;
      return age > COMPLETED_WINDOW_48_HOURS && age <= COMPLETED_WINDOW_7_DAYS;
    });
  }, [completedCandidates]);

  const completedTasks = useMemo(() => {
    const now = Date.now();
    const windowMs = showMoreCompleted
      ? COMPLETED_WINDOW_7_DAYS
      : COMPLETED_WINDOW_48_HOURS;
    return completedCandidates.filter((task) => {
      const completedAt = recentCompletedTimestamp(task);
      return completedAt === undefined || now - completedAt <= windowMs;
    });
  }, [completedCandidates, showMoreCompleted]);

  const hasMineTasks = MINE_GROUPS.some(
    (group) => mineGroups[group.key].length > 0
  );
  const hasVisibleContent =
    hasMineTasks || trackingTasks.length > 0 || completedTasks.length > 0;

  type ListSectionItem =
    | { type: 'mine' }
    | { type: 'tracking' }
    | { type: 'completed' }
    | { type: 'empty' }
    | { type: 'spacer' };

  const listSections = useMemo((): ListSectionItem[] => {
    const sections: ListSectionItem[] = [];
    if (hasVisibleContent) {
      if (hasMineTasks) sections.push({ type: 'mine' });
      if (trackingTasks.length > 0) sections.push({ type: 'tracking' });
      if (completedTasks.length > 0) sections.push({ type: 'completed' });
    } else {
      sections.push({ type: 'empty' });
    }
    sections.push({ type: 'spacer' });
    return sections;
  }, [
    hasVisibleContent,
    hasMineTasks,
    trackingTasks.length,
    completedTasks.length,
  ]);

  const toggleTaskCompletion = async (task: DisplayTask): Promise<void> => {
    try {
      if (task.kind === 'eventTask') {
        await toggleEventTaskCompletedMutation({
          id: task.id as Id<'eventTasks'>,
        });
        return;
      }
      await toggleCompletedMutation({ id: task.id as Id<'tasks'> });
    } catch (error) {
      console.error('toggleTaskCompletion error:', error);
    }
  };

  const toggleTaskExpansion = (taskId: string): void => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleSubtask = async (
    task: DisplayTask,
    subtaskId: string
  ): Promise<void> => {
    if (task.kind !== 'task') return;
    try {
      await toggleSubtaskMutation({
        id: task.id as Id<'tasks'>,
        subtaskId,
      });
    } catch (error) {
      console.error('toggleSubtask error:', error);
    }
  };

  const openSourceInfo = (task: DisplayTask): void => {
    const isEventSource =
      task.isEventTask || task.sourceEventId || task.eventId;
    const eventName = task.eventTitle ?? task.title;
    const message = task.kind === 'eventTask' && !task.eventId
      ? 'זו משימה שהוקצתה לך. פרטי האירוע אינם משותפים.'
      : isEventSource
      ? task.category === 'אירועי יומן'
        ? `זוהי משימה מתוך אירוע יומן ${eventName}`
        : `זוהי משימה מתוך האירוע ${eventName}`
      : task.communityName
        ? `זוהי משימה מתוך קהילת ${task.communityName}`
        : 'זוהי משימה מתוך קהילה';

    const actions: {
      text: string;
      style?: 'cancel';
      onPress?: () => void;
    }[] = [{ text: 'חזרה', style: 'cancel' }];

    if (task.communityId) {
      actions.push({
        text: 'פתיחת קהילה',
        onPress: () =>
          router.push({
            pathname: '/(authenticated)/community/[id]',
            params: { id: task.communityId },
          } as never),
      });
    }

    const eventId = task.eventId ?? task.sourceEventId;
    if (eventId) {
      actions.push({
        text: 'פתיחת אירוע',
        onPress: () =>
          router.push({
            pathname: '/(authenticated)/event/[id]',
            params: { id: eventId, returnTo: 'tasks' },
          } as never),
      });
    }

    Alert.alert('פרטי משימה', message, actions);
  };

  const handleSoftDelete = (task: DisplayTask): void => {
    if (!currentUserId) return;
    const shared = isSharedTask(task, currentUserId);
    const title = shared ? 'למחוק את המשימה המשותפת?' : 'למחוק את המשימה?';
    const message = shared
      ? 'המשימה תוסר לכל המשתתפים. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.'
      : 'המשימה תוסר. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.';
    Alert.alert(title, message, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          try {
            await softDeleteTaskMutation({ id: task.id as Id<'tasks'> });
          } catch (error) {
            console.error('softDeleteTask error:', error);
            Alert.alert('שגיאה', 'לא הצלחנו למחוק את המשימה. נסה שוב.');
          }
        },
      },
    ]);
  };

  const handleUnclaimEventTask = async (task: DisplayTask): Promise<void> => {
    try {
      if (task.communityId) await unclaimEventTaskMutation({ id: task.id as Id<'eventTasks'> });
      else await setEventTaskAssignee({ id: task.id as Id<'eventTasks'>, assignee: null });
    } catch (error) {
      Alert.alert(
        'שגיאה',
        error instanceof Error ? error.message : 'לא ניתן לבטל את ההקצאה כרגע'
      );
    }
  };

  const handleOpenTaskEvent = (task: DisplayTask): void => {
    // Event Task "פתח אירוע" → canonical Full Screen event details using the
    // real parent event id; fall back to community route for reminders.
    // returnTo lets header/hardware Back restore Tasks specifically (see
    // event/[id].tsx).
    const eventId = task.eventId ?? task.sourceEventId;
    if (eventId) {
      router.push({
        pathname: '/(authenticated)/event/[id]',
        params: { id: eventId, returnTo: 'tasks' },
      } as never);
      return;
    }
    if (task.communityId) {
      router.replace({
        pathname: '/(authenticated)/community/[id]',
        params: { id: task.communityId },
      } as never);
      return;
    }
    Alert.alert('שגיאה', 'לא הצלחנו לפתוח את האירוע כרגע');
  };

  const handleTaskPress = (task: DisplayTask): void => {
    const isPersonalTask =
      task.kind === 'task' &&
      !task.communityId &&
      !task.sourceEventId &&
      task.sourceType !== 'community_event_important_item' &&
      task.category !== 'קהילות' &&
      task.category !== 'אירועי יומן';

    if (isPersonalTask) {
      setTaskSheetTaskId(task.id);
      setTaskSheetVisible(true);
      return;
    }

    openSourceInfo(task);
  };

  return (
    <SafeAreaView style={[styles.safeArea, ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null]}>
      <View style={styles.container}>
        <View style={styles.headerSurface}>
          <MainScreenHeader
            title="המשימות שלי"
            showAdd={true}
            onAdd={() =>
              handleGatedCreateAction(() =>
                router.push('/(authenticated)/task/new' as never)
              )
            }
            onNotificationsPress={handleBellPress}
            notificationsCount={unseenCount}
            returnTo="/(authenticated)/tasks"
          />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="חיפוש משימה..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor="#9ca3af"
            />
            <MaterialIcons
              name="search"
              size={20}
              color="#637588"
              style={styles.searchIcon}
            />
          </View>
        </View>

        {/* Filter Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersContainer}
          contentContainerStyle={styles.filtersContent}
        >
          {TASK_TABS.map((filter) => (
            <Pressable
              key={filter}
              style={[
                styles.filterChip,
                activeFilter === filter && styles.filterChipActive,
              ]}
              onPress={() => setActiveFilter(filter)}
              accessible={true}
              accessibilityRole="button"
              accessibilityState={{ selected: activeFilter === filter }}
              accessibilityLabel={`סינון ${filter}`}
            >
              <Text
                style={[
                  styles.filterChipText,
                  activeFilter === filter && styles.filterChipTextActive,
                ]}
              >
                {filter}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Tasks List */}
        <FlatList
          data={listSections}
          keyExtractor={(item, index) => item.type + String(index)}
          style={styles.tasksScrollView}
          contentContainerStyle={styles.tasksContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            if (item.type === 'empty') {
              return <EmptyState activeFilter={activeFilter} />;
            }
            if (item.type === 'spacer') {
              return <View style={styles.bottomSpacer} />;
            }
            if (item.type === 'mine') {
              return (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>לביצוע שלי</Text>
                  {MINE_GROUPS.map((group) =>
                    mineGroups[group.key].length > 0 ? (
                      <TaskGroup
                        key={group.key}
                        title={group.title}
                        isOverdue={group.key === 'overdue'}
                        tasks={mineGroups[group.key]}
                        expandedTaskIds={expandedTaskIds}
                        currentUserId={currentUserId}
                        onToggleCompletion={toggleTaskCompletion}
                        onToggleExpansion={toggleTaskExpansion}
                        onToggleSubtask={toggleSubtask}
                        onOpenImagePreview={openImagePreview}
                        onPressTask={handleTaskPress}
                        onSoftDelete={handleSoftDelete}
                        onOpenEvent={handleOpenTaskEvent}
                        onUnclaimEventTask={handleUnclaimEventTask}
                      />
                    ) : null
                  )}
                </View>
              );
            }
            if (item.type === 'tracking') {
              return (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>במעקב</Text>
                  <Text style={styles.sectionHelper}>משימות שהוקצו לאחרים</Text>
                  {trackingTasks.map((task) => {
                    const canDeleteTracking = isPersonallyDeletableDisplayTask(
                      task,
                      currentUserId
                    );
                    const renderTrackingSwipeAction = () =>
                      canDeleteTracking ? (
                        <Pressable
                          style={styles.swipeDeleteAction}
                          onPress={() => handleSoftDelete(task)}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel="מחיקת משימה"
                        >
                          <MaterialIcons
                            name="delete-outline"
                            size={26}
                            color="#ffffff"
                          />
                          <Text style={styles.swipeActionLabel}>מחק</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          style={styles.swipeOpenEventAction}
                          onPress={() => handleOpenTaskEvent(task)}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel="פתיחה באירוע"
                        >
                          <MaterialIcons
                            name="open-in-new"
                            size={22}
                            color="#ffffff"
                          />
                          <Text style={styles.swipeActionLabel}>פתח אירוע</Text>
                        </Pressable>
                      );
                    return (
                      <Swipeable
                        key={task.uid}
                        renderRightActions={renderTrackingSwipeAction}
                      >
                        <TaskCard
                          task={task}
                          isExpanded={expandedTaskIds.has(task.uid)}
                          isOverdue={false}
                          onToggleCompletion={() => toggleTaskCompletion(task)}
                          onToggleExpansion={() =>
                            toggleTaskExpansion(task.uid)
                          }
                          onToggleSubtask={(subtaskId) =>
                            toggleSubtask(task, subtaskId)
                          }
                          onOpenImagePreview={openImagePreview}
                          onPress={() => handleTaskPress(task)}
                        />
                      </Swipeable>
                    );
                  })}
                </View>
              );
            }
            if (item.type === 'completed') {
              return (
                <View style={styles.section}>
                  <View style={styles.sectionHeaderRow}>
                    {hasMoreCompletedTasks ? (
                      <View style={styles.completedActions}>
                        <Pressable
                          onPress={() => setShowMoreCompleted((prev) => !prev)}
                          style={styles.secondaryButton}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel={
                            showMoreCompleted ? 'הצג פחות' : 'הצג עוד'
                          }
                        >
                          <Text style={styles.secondaryButtonText}>
                            {showMoreCompleted ? 'הצג פחות' : 'הצג עוד'}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.completedActionsPlaceholder} />
                    )}
                    <Text style={styles.sectionTitleNoMargin}>בוצעו</Text>
                  </View>
                  {completedTasks.map((task) => (
                    <TaskCard
                      key={task.uid}
                      task={task}
                      isExpanded={expandedTaskIds.has(task.uid)}
                      isOverdue={false}
                      onToggleCompletion={() => toggleTaskCompletion(task)}
                      onToggleExpansion={() => toggleTaskExpansion(task.uid)}
                      onToggleSubtask={(subtaskId) =>
                        toggleSubtask(task, subtaskId)
                      }
                      onOpenImagePreview={openImagePreview}
                      onPress={() => handleTaskPress(task)}
                    />
                  ))}
                </View>
              );
            }
            return null;
          }}
        />
      </View>
      <NotificationsDrawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        direction="rtl"
      />
      <TaskDetailsBottomSheet
        taskId={taskSheetTaskId}
        visible={taskSheetVisible}
        onClose={() => setTaskSheetVisible(false)}
      />
      <UpgradeModal
        visible={upgradeModalVisible}
        reason="general"
        onClose={() => setUpgradeModalVisible(false)}
      />
      <Modal
        visible={previewImageUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPreviewImageUri(null);
          setPreviewImageError(false);
          setPreviewImageLoading(false);
        }}
      >
        <View style={styles.previewOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setPreviewImageUri(null);
              setPreviewImageError(false);
              setPreviewImageLoading(false);
            }}
            accessible={false}
          />
          {previewImageUri ? (
            <View style={styles.previewCard}>
              <Pressable
                style={styles.previewCloseButton}
                onPress={() => {
                  setPreviewImageUri(null);
                  setPreviewImageError(false);
                  setPreviewImageLoading(false);
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="סגירה"
              >
                <MaterialIcons name="close" size={24} color="#ffffff" />
              </Pressable>
              {previewImageError ? (
                <View style={styles.previewErrorContainer}>
                  <MaterialIcons
                    name="broken-image"
                    size={48}
                    color="#94a3b8"
                  />
                  <Text style={styles.previewErrorText}>
                    לא הצלחנו להציג את התמונה
                  </Text>
                  <Pressable
                    style={styles.previewErrorClose}
                    onPress={() => {
                      setPreviewImageUri(null);
                      setPreviewImageError(false);
                      setPreviewImageLoading(false);
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="סגור"
                  >
                    <Text style={styles.previewErrorCloseText}>סגור</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Image
                    source={{ uri: previewImageUri }}
                    style={styles.previewImage}
                    resizeMode="contain"
                    accessible={true}
                    accessibilityLabel="תצוגה מקדימה של תמונה"
                    onLoadStart={() => setPreviewImageLoading(true)}
                    onLoadEnd={() => setPreviewImageLoading(false)}
                    onError={() => {
                      setPreviewImageLoading(false);
                      setPreviewImageError(true);
                    }}
                  />
                  {previewImageLoading ? (
                    <View style={styles.previewLoadingOverlay}>
                      <ActivityIndicator size="large" color="#ffffff" />
                      <Text style={styles.previewLoadingText}>
                        טוענים את התמונה...
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TaskGroup({
  title,
  isOverdue,
  tasks,
  expandedTaskIds,
  currentUserId,
  onToggleCompletion,
  onToggleExpansion,
  onToggleSubtask,
  onOpenImagePreview,
  onPressTask,
  onSoftDelete,
  onOpenEvent,
  onUnclaimEventTask,
}: {
  title: string;
  isOverdue: boolean;
  tasks: DisplayTask[];
  expandedTaskIds: Set<string>;
  currentUserId: string | undefined;
  onToggleCompletion: (task: DisplayTask) => void;
  onToggleExpansion: (taskId: string) => void;
  onToggleSubtask: (task: DisplayTask, subtaskId: string) => void;
  onOpenImagePreview: (uri: string) => void;
  onPressTask: (task: DisplayTask) => void;
  onSoftDelete: (task: DisplayTask) => void;
  onOpenEvent: (task: DisplayTask) => void;
  onUnclaimEventTask: (task: DisplayTask) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, isOverdue && styles.groupTitleOverdue]}>
        {title}
      </Text>
      {tasks.map((task) => {
        const canDelete = isPersonallyDeletableDisplayTask(task, currentUserId);
        const renderSwipeAction = () =>
          canDelete ? (
            <Pressable
              style={styles.swipeDeleteAction}
              onPress={() => onSoftDelete(task)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="מחיקת משימה"
            >
              <MaterialIcons name="delete-outline" size={26} color="#ffffff" />
              <Text style={styles.swipeActionLabel}>מחק</Text>
            </Pressable>
          ) : task.kind === 'eventTask' ? (
            <Pressable
              style={styles.swipeUnclaimAction}
              onPress={() => onUnclaimEventTask(task)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="ביטול הקצאה"
            >
              <MaterialIcons name="person-remove" size={22} color="#ffffff" />
              <Text style={styles.swipeActionLabel}>בטל הקצאה</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.swipeOpenEventAction}
              onPress={() => onOpenEvent(task)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="פתיחה באירוע"
            >
              <MaterialIcons name="open-in-new" size={22} color="#ffffff" />
              <Text style={styles.swipeActionLabel}>פתח אירוע</Text>
            </Pressable>
          );

        return (
          <Swipeable key={task.uid} renderRightActions={renderSwipeAction}>
            <TaskCard
              task={task}
              isExpanded={expandedTaskIds.has(task.uid)}
              isOverdue={isOverdue}
              onToggleCompletion={() => onToggleCompletion(task)}
              onToggleExpansion={() => onToggleExpansion(task.uid)}
              onToggleSubtask={(subtaskId) => onToggleSubtask(task, subtaskId)}
              onOpenImagePreview={onOpenImagePreview}
              onPress={() => onPressTask(task)}
            />
          </Swipeable>
        );
      })}
    </View>
  );
}

function TaskCard({
  task,
  isExpanded,
  isOverdue,
  onToggleCompletion,
  onToggleExpansion,
  onToggleSubtask,
  onOpenImagePreview,
  onPress,
}: {
  task: DisplayTask;
  isExpanded: boolean;
  isOverdue: boolean;
  onToggleCompletion: () => void;
  onToggleExpansion: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onOpenImagePreview: (uri: string) => void;
  onPress: () => void;
}) {
  const hasSubtasks = task.subtasks.length > 0;
  const completedSubtasks = task.subtasks.filter(
    (subtask) => subtask.completed
  ).length;
  const totalSubtasks = task.subtasks.length;
  const tags = buildVisibleTags(task, isOverdue);
  const progressText =
    task.category === 'קניות'
      ? `${completedSubtasks} מתוך ${totalSubtasks} פריטים סומנו`
      : `${completedSubtasks} מתוך ${totalSubtasks} שלבים הושלמו`;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.taskCard, task.completed && styles.taskCardCompleted]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`משימה: ${task.title}`}
    >
      <View style={styles.taskCardRow}>
        <View style={styles.taskContent}>
          <Text
            style={[
              styles.taskTitle,
              task.completed && styles.taskTitleCompleted,
            ]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.metaSide}>
              <TaskIndicators task={task} hasSubtasks={hasSubtasks} />
              <AssigneeAvatars
                assignees={task.assigneeDisplays}
                showEveryone={false}
              />
            </View>
            <Text style={styles.taskMeta} numberOfLines={1}>
              {task.secondaryText}
            </Text>
          </View>

          {tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {tags.map((tag) => (
                <View key={tag.label} style={[styles.tag, tag.style]}>
                  <Text style={[styles.tagText, tag.textStyle]}>
                    {tag.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {hasSubtasks && !task.completed ? (
            <View style={styles.subtasksProgress}>
              <View style={styles.subtasksProgressHeader}>
                <Text style={styles.subtasksProgressText}>{progressText}</Text>
                <Pressable
                  style={styles.expandButton}
                  onPress={(event) => {
                    event.stopPropagation();
                    onToggleExpansion();
                  }}
                  hitSlop={8}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={isExpanded ? 'כווץ פריטים' : 'הצג פריטים'}
                >
                  <MaterialIcons
                    name={
                      isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'
                    }
                    size={22}
                    color={TEXT_MUTED}
                  />
                </Pressable>
              </View>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${(completedSubtasks / totalSubtasks) * 100}%` },
                  ]}
                />
              </View>
              {isExpanded ? (
                <View style={styles.subtasksList}>
                  {task.kind === 'task' ? (
                    <InlineSubtasksEditor
                      taskId={task.id}
                      subtasks={task.subtasks}
                      onOpenImagePreview={onOpenImagePreview}
                    />
                  ) : (
                    task.subtasks.map((subtask) => (
                      <Pressable
                        key={subtask.id}
                        style={styles.subtaskItem}
                        onPress={(event) => {
                          event.stopPropagation();
                          onToggleSubtask(subtask.id);
                        }}
                        accessible={true}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: subtask.completed }}
                        accessibilityLabel={subtask.title}
                      >
                        <View
                          style={[
                            styles.subtaskCheckbox,
                            subtask.completed && styles.subtaskCheckboxChecked,
                          ]}
                        >
                          {subtask.completed ? (
                            <MaterialIcons
                              name="check"
                              size={13}
                              color="#ffffff"
                            />
                          ) : null}
                        </View>
                        <Text
                          style={[
                            styles.subtaskText,
                            subtask.completed && styles.subtaskTextCompleted,
                          ]}
                          numberOfLines={2}
                        >
                          {subtask.title}
                        </Text>
                        {getSubtaskAttachment(subtask) ? (
                          <SubtaskAttachmentButton
                            taskId={
                              task.kind === 'task'
                                ? (task.id as Id<'tasks'>)
                                : undefined
                            }
                            attachment={getSubtaskAttachment(subtask)}
                            onOpenImagePreview={onOpenImagePreview}
                          />
                        ) : null}
                      </Pressable>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <Pressable
          style={styles.checkbox}
          onPress={(event) => {
            event.stopPropagation();
            onToggleCompletion();
          }}
          hitSlop={10}
          accessible={true}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.completed }}
          accessibilityLabel={`סימון השלמה עבור ${task.title}`}
        >
          {task.completed ? (
            <MaterialIcons name="check-circle" size={30} color={PRIMARY_BLUE} />
          ) : (
            <View
              style={[
                styles.checkboxEmpty,
                isOverdue && styles.checkboxOverdue,
              ]}
            />
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

function TaskIndicators({
  task,
  hasSubtasks,
}: {
  task: DisplayTask;
  hasSubtasks: boolean;
}) {
  if (!(task.hasReminders || task.hasAttachments || hasSubtasks)) return null;

  return (
    <View style={styles.indicatorsRow}>
      {task.hasReminders ? (
        <MaterialIcons name="notifications-none" size={15} color="#94a3b8" />
      ) : null}
      {task.hasAttachments ? (
        <MaterialIcons name="attach-file" size={15} color="#94a3b8" />
      ) : null}
      {hasSubtasks ? (
        <MaterialIcons name="checklist-rtl" size={15} color="#94a3b8" />
      ) : null}
    </View>
  );
}

function AssigneeAvatars({
  assignees,
  showEveryone,
}: {
  assignees: AssigneeDisplay[];
  showEveryone: boolean;
}) {
  if (showEveryone) {
    return (
      <View style={styles.everyoneBadge}>
        <Text style={styles.everyoneBadgeText}>כולם</Text>
      </View>
    );
  }
  const resolved = assignees.filter((a) => a.initials.length > 0);
  if (resolved.length === 0) return null;
  const visible = resolved.slice(0, 3);
  const extraCount = resolved.length - visible.length;

  return (
    <View style={styles.assigneeAvatars}>
      {visible.map((assignee, index) => (
        <View
          key={assignee.key}
          style={[
            styles.assigneeAvatar,
            {
              backgroundColor: assignee.color,
              marginRight: index === 0 ? 0 : -6,
              zIndex: visible.length - index,
            },
          ]}
        >
          <Text style={styles.assigneeAvatarText}>{assignee.initials}</Text>
        </View>
      ))}
      {extraCount > 0 ? (
        <View style={[styles.assigneeAvatar, styles.assigneeAvatarExtra]}>
          <Text style={styles.assigneeAvatarExtraText}>+{extraCount}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SubtaskAttachmentButton({
  taskId,
  attachment,
  onOpenImagePreview,
}: {
  taskId?: Id<'tasks'>;
  attachment: SubtaskAttachmentPreviewData | undefined;
  onOpenImagePreview: (uri: string) => void;
}) {
  const storageId = attachment?.storageId as Id<'_storage'> | undefined;
  // Use task-scoped query when taskId is available so the server verifies the
  // storageId reference. Falls back to skip (no URL) when taskId is absent —
  // this path is only reached for eventTask subtasks which don't carry storage.
  const storageUrl = useQuery(
    api.tasks.getTaskAttachmentUrl,
    taskId && storageId ? { taskId, storageId } : 'skip'
  );
  const uri = attachment?.localUri ?? storageUrl ?? undefined;
  const isImage = (attachment?.mimeType ?? '').startsWith('image/');

  const openAttachment = async (): Promise<void> => {
    if (!uri) {
      Alert.alert('קובץ מצורף', 'לא ניתן לפתוח את הקובץ כרגע');
      return;
    }
    if (isImage) {
      onOpenImagePreview(uri);
      return;
    }
    try {
      await Linking.openURL(uri);
    } catch {
      Alert.alert('קובץ מצורף', 'לא ניתן לפתוח את הקובץ כרגע');
    }
  };

  if (isImage && uri) {
    return (
      <Pressable
        style={styles.subtaskThumbnailButton}
        onPress={(event) => {
          event.stopPropagation();
          openAttachment();
        }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="פתיחת תמונה"
      >
        <Image source={{ uri }} style={styles.subtaskThumbnail} />
      </Pressable>
    );
  }

  return (
    <Pressable
      style={styles.subtaskFileButton}
      onPress={(event) => {
        event.stopPropagation();
        openAttachment();
      }}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={
        attachment?.displayName ?? attachment?.originalName ?? 'פתיחת קובץ'
      }
    >
      <MaterialIcons name="attach-file" size={16} color={PRIMARY_BLUE} />
    </Pressable>
  );
}

function EmptyState({ activeFilter }: { activeFilter: TaskTab }) {
  const state = EMPTY_STATES[activeFilter];
  return (
    <View style={styles.emptyState}>
      <MaterialIcons name="task-alt" size={34} color="#cbd5e1" />
      <Text style={styles.emptyTitle}>{state.title}</Text>
      {state.helper ? (
        <Text style={styles.emptyHelper}>{state.helper}</Text>
      ) : null}
    </View>
  );
}

function buildVisibleTags(
  task: DisplayTask,
  _isOverdue: boolean
): {
  label: string;
  style?: object;
  textStyle?: object;
}[] {
  const tags: {
    label: string;
    style?: object;
    textStyle?: object;
  }[] = [];

  // "חשוב לזכור" chip for important-to-remember tasks
  if (task.sourceType === 'community_event_important_item') {
    tags.push({
      label: 'חשוב לזכור',
      style: styles.importantItemTag,
      textStyle: styles.importantItemTagText,
    });
  }

  if (task.communityName && tags.length < 3) {
    tags.push({
      label: task.communityName,
      style: styles.sourceTag,
      textStyle: styles.sourceTagText,
    });
  }

  if (task.eventTitle && tags.length < 3) {
    tags.push({
      label: task.eventTitle,
      style: styles.sourceTag,
      textStyle: styles.sourceTagText,
    });
  }

  if (
    !(
      task.communityName ||
      task.eventTitle ||
      task.sourceType === 'community_event_important_item'
    ) &&
    tags.length < 3
  ) {
    tags.push({
      label: task.category,
      style: styles.categoryTag,
      textStyle: styles.categoryTagText,
    });
  }

  return tags.slice(0, 3);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  safeAreaRtl: {
    direction: 'rtl',
  },
  container: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },

  /* Header */
  headerSurface: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 0,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  /* Search */
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  searchBar: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    backgroundColor: '#f6f7f8',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    ...(needsExplicitRTL() ? { marginRight: 8 } : { marginStart: 8 }),
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: TEXT_DARK,
    textAlign: rtl.inputTextAlign,
    writingDirection: 'rtl',
  },

  /* Filters */
  filtersContainer: {
    backgroundColor: '#ffffff',
    height: 55,
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    direction: 'rtl',
  },
  filtersContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
    direction: 'rtl',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    minWidth: '100%',
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f5f7fa',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterChipActive: {
    backgroundColor: PRIMARY_BLUE,
    borderColor: PRIMARY_BLUE,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MUTED,
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },

  /* Tasks */
  tasksScrollView: {
    flex: 1,
  },
  tasksContent: {
    paddingTop: 8,
    alignItems: 'stretch',
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
    alignItems: 'stretch',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT_DARK,
    marginBottom: 10,
    alignSelf: 'stretch',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  sectionTitleNoMargin: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: TEXT_DARK,
    alignSelf: 'stretch',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  sectionHelper: {
    color: TEXT_MUTED,
    fontSize: 13,
    alignSelf: 'stretch',
    textAlign: rtl.textAlign,
    marginTop: -4,
    marginBottom: 10,
    writingDirection: 'rtl',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  completedActions: {
    flexDirection: 'row',
    gap: 8,
  },
  completedActionsPlaceholder: {
    width: 1,
  },
  secondaryButton: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef6fb',
  },
  secondaryButtonText: {
    color: PRIMARY_BLUE,
    fontSize: 12,
    fontWeight: '800',
  },
  group: {
    marginTop: 4,
  },
  groupTitle: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '800',
    alignSelf: 'stretch',
    textAlign: rtl.textAlign,
    marginBottom: 8,
    writingDirection: 'rtl',
  },
  groupTitleOverdue: {
    color: '#D97706',
  },

  /* Task Card */
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  taskCardCompleted: {
    opacity: 0.68,
    backgroundColor: '#f9fafb',
  },
  taskCardRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
  },

  /* Checkbox */
  checkbox: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
    ...(needsExplicitRTL() ? { marginRight: 10 } : { marginStart: 10 }),
    paddingTop: 1,
  },
  checkboxEmpty: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  checkboxOverdue: {
    borderColor: '#d89b65',
    backgroundColor: '#fff8f1',
  },

  /* Task Content */
  taskContent: {
    flex: 1,
    alignItems: 'stretch',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT_DARK,
    marginBottom: 5,
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
    lineHeight: 22,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#94a3b8',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  metaSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskMeta: {
    flex: 1,
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
    lineHeight: 18,
  },
  indicatorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  assigneeAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 24,
  },
  assigneeAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  assigneeAvatarText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
  },
  assigneeAvatarExtra: {
    backgroundColor: '#e2e8f0',
    marginRight: -6,
  },
  assigneeAvatarExtraText: {
    color: TEXT_MUTED,
    fontSize: 9,
    fontWeight: '900',
  },
  everyoneBadge: {
    minWidth: 34,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY_BLUE_TINT,
  },
  everyoneBadgeText: {
    color: PRIMARY_BLUE,
    fontSize: 10,
    fontWeight: '900',
    writingDirection: 'rtl',
  },

  /* Tags */
  tagsRow: {
    flexDirection: rtl.flexDirection,
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    gap: 6,
    marginTop: 9,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  categoryTag: {
    backgroundColor: PRIMARY_BLUE_TINT,
  },
  tagOverdue: {
    backgroundColor: '#fff2e5',
  },
  sourceTag: {
    backgroundColor: '#eef6fb',
  },
  importantItemTag: {
    backgroundColor: '#FEF3C7',
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED,
    textAlign: rtl.textAlign,
  },
  categoryTagText: {
    color: PRIMARY_BLUE,
  },
  sourceTagText: {
    color: PRIMARY_BLUE,
  },
  importantItemTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
  },
  tagTextOverdue: {
    color: '#b36a2e',
  },

  /* Subtasks Progress */
  subtasksProgress: {
    marginTop: 10,
  },
  subtasksProgressHeader: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  subtasksProgressText: {
    flex: 1,
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  expandButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  progressBar: {
    height: 5,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: PRIMARY_BLUE,
    borderRadius: 3,
    alignSelf: needsExplicitRTL() ? 'flex-end' : 'flex-start',
  },
  subtasksList: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    gap: 8,
  },
  subtaskItem: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  subtaskCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  subtaskCheckboxChecked: {
    backgroundColor: PRIMARY_BLUE,
    borderColor: PRIMARY_BLUE,
  },
  subtaskText: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 13,
    lineHeight: 18,
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  subtaskTextCompleted: {
    color: '#94a3b8',
    textDecorationLine: 'line-through',
  },
  subtaskThumbnailButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  subtaskThumbnail: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e5e7eb',
  },
  subtaskFileButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY_BLUE_TINT,
  },

  /* Empty */
  emptyState: {
    marginHorizontal: 16,
    marginTop: 28,
    borderRadius: 18,
    padding: 20,
    alignItems: rtl.alignStart,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  emptyTitle: {
    marginTop: 10,
    color: TEXT_DARK,
    fontSize: 16,
    fontWeight: '800',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  emptyHelper: {
    marginTop: 6,
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 20,
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  bottomSpacer: {
    height: 40,
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  previewCard: {
    width: '100%',
    height: '78%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCloseButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  previewLoadingText: {
    color: '#ffffff',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 4,
  },
  previewErrorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  previewErrorText: {
    color: '#94a3b8',
    fontSize: 16,
    textAlign: 'center',
  },
  previewErrorClose: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  previewErrorCloseText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },

  /* Swipe actions */
  swipeDeleteAction: {
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 12,
    borderRadius: 14,
    gap: 4,
  },
  swipeOpenEventAction: {
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    marginBottom: 12,
    borderRadius: 14,
    gap: 4,
  },
  swipeUnclaimAction: {
    backgroundColor: '#f59e0b',
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    marginBottom: 12,
    borderRadius: 14,
    gap: 4,
  },
  swipeActionLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
