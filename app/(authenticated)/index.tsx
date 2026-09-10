import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommunityEventNameTag } from '@/components/CommunityEventNameTag';
import {
  type EventTaskAccordionData,
  HomeDailyCommandCenter,
  type HomeDailyItem,
  type HomeDailyTask,
} from '@/components/home/HomeDailyCommandCenter';
import type { AssignedEventTask } from '@/components/InlineEventTasksSection';
import { InlineEventTasksSection } from '@/components/InlineEventTasksSection';
import type { ImportantItem } from '@/components/InlineImportantItemsSection';
import { InlineImportantItemsSection } from '@/components/InlineImportantItemsSection';
import { MainScreenHeader } from '@/components/MainScreenHeader';
import { NavigationPickerModal } from '@/components/NavigationPickerModal';
import type { ProfileCircle } from '@/components/ProfileCircles';
import { ProfileCircles } from '@/components/ProfileCircles';
import { TaskCheckbox } from '@/components/TaskCheckbox';
import { TaskDetailsBottomSheet } from '@/components/tasks/TaskDetailsBottomSheet';
import { colors } from '@/constants/theme';
import { useNotifications } from '@/contexts/NotificationsContext';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { getAvatarInitials } from '@/lib/avatarInitials';
import { useBirthdaySheets } from '@/lib/components/birthday/BirthdaySheetsProvider';
import { NotificationsDrawer } from '@/lib/components/notifications/NotificationsDrawer';
import { SubtaskImagePreviewModal } from '@/lib/components/task/SubtaskImagePreviewModal';
import { SubtaskAttachmentPreview } from '@/lib/components/task/SubtasksSection';
import { isEventEligibleForHomeImportantItemsPreview } from '@/lib/homeImportantItemsPreview';
import { APP_IS_RTL, getTextAlign, position, rtl, spacing } from '@/lib/rtl';
import { getHomeReminderMetadata } from '@/lib/taskClassification';
import { isTaskPastDue } from '@/lib/taskDueStatus';
import type { SubTaskAttachment } from '@/lib/types/task';
import { getCountdownLabel, getNextOccurrence } from '@/lib/utils/birthday';
import { parseGeoUri } from '@/lib/utils/geoUri';
import { colors as tc } from '@/theme/colors';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * PRODUCT RULE — Home Community Event accordion visibility.
 *
 * Home is a "what's still available to claim / what's already mine"
 * surface, never a task-management view: only unassigned tasks and tasks
 * already assigned to the current viewer are shown here — even for
 * community managers/admins. Tasks assigned to other members are never
 * shown on Home (they remain visible in full via Community Main / Event
 * Details, which intentionally keep manager/full visibility).
 *
 * Filtered here (upstream of `EventTasksAccordion`) rather than inside
 * that shared component, because the same component also renders the
 * Community Bottom Sheet, whose own (unrelated) visibility rules must
 * stay untouched.
 */
function filterHomeVisibleEventTasks<
  T extends {
    isAssignedToCurrentUser: boolean;
    assignedToUserId?: string;
    assignedToManual?: string;
  },
>(tasks: T[]): T[] {
  return tasks.filter(
    (t) =>
      t.isAssignedToCurrentUser ||
      (!t.assignedToUserId && !t.assignedToManual?.trim())
  );
}

function getGreetingByHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 17) return 'צהריים טובים';
  if (hour >= 17 && hour < 22) return 'ערב טוב';
  return 'לילה טוב';
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getEmptyStateCopy(selectedDate: Date): {
  title: string;
  subtitle: string;
} {
  const sel = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate()
  );
  const now = new Date();
  const tod = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (sel.getTime() === tod.getTime()) {
    return {
      title: 'היום פנוי 🎉',
      subtitle: 'אין לך אירועים או משימות היום.',
    };
  }
  if (sel.getTime() < tod.getTime()) {
    return {
      title: 'לא היו פעילויות ביום הזה',
      subtitle: 'לא היו אירועים או משימות בתאריך הזה.',
    };
  }
  return {
    title: 'אין פעילויות מתוכננות',
    subtitle: 'אין אירועים או משימות בתאריך הזה.',
  };
}

// Tasks that are derived from community event important items (both the legacy
// per-item copies and the Sprint 2 bundle task) are shown nested under the
// event on Home and must not appear as standalone task cards there.
// Mirrored by the identically-named helper in app/(authenticated)/calendar.tsx
// — keep both in sync.
function isEventDerivedImportantItemTask(task: {
  sourceType?: string;
}): boolean {
  return (
    task.sourceType === 'community_event_important_item' ||
    task.sourceType === 'community_event_important_items_bundle'
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Item = {
  id: string;
  time: string;
  endTime?: string;
  /** Exact timestamps support reliable active/up-next state without parsing display text. */
  startAt?: number;
  endAt?: number;
  title: string;
  location: string;
  /** geo:lat,lng URI — present when the event was saved with autocomplete coordinates */
  locationUrl?: string;
  type: 'event' | 'task';
  icon: string;
  iconBg: string;
  iconColor: string;
  assigneeColor: string;
  /** First-letter initials of the primary non-self assignee. Undefined = no real assignee to show. */
  assigneeInitials?: string;
  /** All non-self assignees for multi-circle display on compact task cards. */
  assigneeDisplays?: { initials: string; color: string }[];
  completed: boolean;
  allDay?: boolean;
  pending?: boolean;
  groupName?: string;
  remoteUrl?: string;
  rsvpStatus?: 'none' | 'yes' | 'no' | 'maybe';
  communityId?: string; // set only for community events — used to route to event detail
  personalTaskSummary?: string; // set when current user has assigned tasks in this event
  isRecurring?: boolean;
  recurringPattern?: string;
  reminders?: number[];
  // FIXED: linkedEventId set on linked shared events → routes to linked-event/[id] detail
  linkedEventId?: string;
  /** Mirrors Convex calendar flags for community rows opened from home timeline */
  isSavedToMyCalendar?: boolean;
  /** Subtask/checklist items — only populated for personal task items */
  subtasks?: HomeSubtask[];
  /** Tasks assigned to the current user for this event (eventTasks only) */
  myAssignedTasks?: AssignedEventTask[];
  /** "חשוב לזכור" items for community events */
  importantItems?: ImportantItem[];
  /**
   * Discriminates the source of a task-type item:
   * 'personal_task' = from the tasks table, created by current user → can soft-delete
   * 'event_task'    = from the eventTasks table, assigned by community → open event instead
   * undefined       = event item (not a task)
   */
  taskSource?: 'personal_task' | 'event_task';
  /** eventId for routing event_task items to the correct event detail screen */
  taskEventId?: string;
  /**
   * User-facing type label override for task-type items (e.g. 'תזכורת קהילה'
   * for general community reminders). Undefined falls back to the default
   * 'משימה' label used for ordinary personal tasks.
   */
  taskTypeLabel?: string;
  /** Resolved family-member profiles to display as overlapping circles on the card */
  profileCircles?: ProfileCircle[];
  /** Count of external (non-family) participants, shown as "+N" after the circles */
  profileCirclesExtraCount?: number;
  /** Semantic context: 'sharedWith' for personal items, 'alsoAddedToCalendar' for community events */
  profileCirclesContext?: 'sharedWith' | 'alsoAddedToCalendar';
  /** True for personal invited events (not creator, not community). Drives badge + muted card. */
  pendingPersonalInvite?: boolean;
  /** RSVP status of the current user for personal invited events (undefined = not an invite or creator) */
  myPersonalRsvpStatus?: 'yes' | 'maybe' | 'no' | 'none';
  /** Timestamp (ms) when the task was completed — used for "בוצעו היום" grouping. */
  completedAt?: number;
  /** Authorized event tasks for the community-event task accordion (server-filtered). */
  authorizedEventTasks?: EventTaskAccordionData;
};

type UndatedTask = {
  id: string;
  title: string;
  completed: boolean;
  /** Timestamp (ms) when the task was completed — used for "בוצעו היום" grouping. */
  completedAt?: number;
  /** Resolved initials for the primary assignee (if any and not self). */
  assigneeInitials?: string;
  /** Background color for the assignee circle. */
  assigneeColor?: string;
  /** All non-self assignees for multi-circle display on compact task cards. */
  assigneeDisplays?: { initials: string; color: string }[];
  /** Subtask/checklist items for expand-and-toggle support on Home. */
  subtasks?: HomeSubtask[];
  /**
   * User-facing type label for task-type items (e.g. 'תזכורת קהילה' for
   * general community reminders) — same field name/semantics as `Item`'s
   * `taskTypeLabel` (BUG 2 fix: classification/community metadata is a
   * property of the ITEM, not of whether it has a `dueAt`, so date-only
   * untimed tasks must carry it exactly like timed tasks do).
   */
  taskTypeLabel?: string;
  /** Real community name — only set for general community reminders. */
  groupName?: string;
  /** Community id — only set for general community reminders. */
  communityId?: string;
};

// Overdue tasks extend UndatedTask with raw date fields for the calm due-date display.
type OverdueTask = UndatedTask & {
  /** Raw ms timestamp of the due date (for formatting the calm date label). */
  dueDate?: number;
  /** Whether the task had a specific time set. */
  hasTime?: boolean;
  /** Raw ms timestamp of the actual due time (dueAt takes priority over dueDate for time). */
  dueAt?: number;
};

// ─── Subtask types ────────────────────────────────────────────────────────────

type HomeSubtask = {
  id: string;
  title: string;
  completed: boolean;
  attachment?: SubTaskAttachment;
};

// ─── Home subtask expand/collapse section ─────────────────────────────────────

type HomeSubtaskSectionProps = {
  taskId: string;
  subtasks: HomeSubtask[];
  isExpanded: boolean;
  onToggleExpansion: () => void;
  onToggleSubtask: (subtaskId: string) => void;
};

function HomeSubtaskSection({
  taskId,
  subtasks,
  isExpanded,
  onToggleExpansion,
  onToggleSubtask,
}: HomeSubtaskSectionProps): React.JSX.Element | null {
  const [imagePreviewUri, setImagePreviewUri] = useState<string | null>(null);

  if (subtasks.length === 0) return null;

  const completedCount = subtasks.filter((s) => s.completed).length;
  const progressText = `${completedCount} מתוך ${subtasks.length} פריטים סומנו`;

  return (
    <View style={{ marginTop: 6 }}>
      {/* Progress + expand toggle */}
      <Pressable
        style={{
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 2,
        }}
        onPress={(e) => {
          e.stopPropagation?.();
          onToggleExpansion();
        }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={isExpanded ? 'כווץ רשימה' : 'הרחב רשימה'}
      >
        <MaterialIcons
          name={isExpanded ? 'expand-less' : 'expand-more'}
          size={16}
          color="#94a3b8"
        />
        <Text
          style={{
            fontSize: 12,
            color: '#64748b',
            textAlign: getTextAlign(),
            flex: 1,
          }}
        >
          {progressText}
        </Text>
      </Pressable>

      {/* Subtask rows — only when expanded */}
      {isExpanded ? (
        <View style={{ marginTop: 4, gap: 4 }}>
          {subtasks.map((subtask) => (
            <Pressable
              key={subtask.id}
              style={{
                flexDirection: 'row-reverse',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 2,
              }}
              onPress={(e) => {
                e.stopPropagation?.();
                onToggleSubtask(subtask.id);
              }}
              accessible={true}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: subtask.completed }}
              accessibilityLabel={subtask.title}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  borderWidth: 1.5,
                  borderColor: subtask.completed ? '#36a9e2' : '#cbd5e1',
                  backgroundColor: subtask.completed
                    ? '#36a9e2'
                    : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {subtask.completed ? (
                  <MaterialIcons name="check" size={12} color="#fff" />
                ) : null}
              </View>
              <Text
                style={{
                  fontSize: 13,
                  color: subtask.completed ? '#94a3b8' : '#334155',
                  textDecorationLine: subtask.completed
                    ? 'line-through'
                    : 'none',
                  flex: 1,
                  textAlign: getTextAlign(),
                }}
                numberOfLines={2}
              >
                {subtask.title}
              </Text>
              {subtask.attachment ? (
                <SubtaskAttachmentPreview
                  taskId={taskId as Id<'tasks'>}
                  attachment={subtask.attachment}
                  onImageThumbnailPress={(uri) => setImagePreviewUri(uri)}
                />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <SubtaskImagePreviewModal
        uri={imagePreviewUri}
        onClose={() => setImagePreviewUri(null)}
      />
    </View>
  );
}

// ─── Relative start-time formatting helper ────────────────────────────────────

/**
 * Returns a natural Hebrew relative-time string for the top activity card.
 * Receives the number of minutes until the activity starts (must be > 0).
 */
function formatRelativeStartTime(mins: number): string {
  if (mins < 1) return 'תכף מתחיל';
  if (mins < 60) return `בעוד ${mins} דק׳`;
  if (mins === 60) return 'בעוד שעה';
  if (mins === 120) return 'בעוד שעתיים';
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  const hoursWord = hours === 2 ? 'שעתיים' : `${hours} שעות`;
  if (remainingMins === 0) return `בעוד ${hoursWord}`;
  return `בעוד ${hoursWord} ו־${remainingMins} דק׳`;
}

// ─── Overdue date formatting helper ───────────────────────────────────────────

/**
 * Returns a calm Hebrew date string for an overdue task row.
 * Uses dueAt for the time component (same source as timed task display).
 * Never displays 00:00 for untimed tasks.
 */
function formatOverdueDate(
  task: Pick<OverdueTask, 'dueDate' | 'hasTime' | 'dueAt'>
): string {
  if (!task.dueDate) return '';
  const datePart = new Date(task.dueDate).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
  });
  if (task.hasTime) {
    const timeTs = task.dueAt ?? task.dueDate;
    const timePart = new Date(timeTs).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${datePart}, ${timePart}`;
  }
  return datePart;
}

// ─── Assignee resolution helper ───────────────────────────────────────────────

/**
 * Like resolveNonSelfAssignee but returns ALL non-self assignees so compact
 * task cards can render multiple overlapping circles (e.g. ינ + של).
 * Resolution order mirrors resolveAssigneeDisplays in tasks.tsx:
 *   1. If viewer is an assignee but not creator, show the creator's circle first.
 *   2. User-ID assignees (excluding viewer).
 *   3. Member-entity assignees (excluding viewer's selfEntityId), using
 *      task-embedded assigneeMemberProfiles as primary name source.
 */
function resolveAllNonSelfAssignees(
  task: {
    assignedTo?: unknown;
    assignedToUserIds?: unknown;
    assignedToMemberId?: unknown;
    assignedToMemberIds?: unknown;
    createdBy?: unknown;
    assigneeMemberProfiles?: {
      id: string;
      name: string;
      color: string | null;
    }[];
  },
  currentUserId: string | undefined,
  byUserId: Map<string, { initials: string; color: string }>,
  byMemberId: Map<string, { initials: string; color: string }>,
  selfEntityId: string | undefined
): { initials: string; color: string }[] {
  const displays: { initials: string; color: string }[] = [];
  const seen = new Set<string>();

  const creatorId = task.createdBy as string | undefined;
  const isCreator = !!currentUserId && creatorId === currentUserId;

  const userAssignees: string[] = [
    ...((task.assignedToUserIds as string[] | undefined) ?? []),
    ...(task.assignedTo ? [task.assignedTo as string] : []),
  ];
  const memberAssignees: string[] = [
    ...((task.assignedToMemberIds as string[] | undefined) ?? []),
    ...(task.assignedToMemberId ? [task.assignedToMemberId as string] : []),
  ];

  const viewerIsUserAssignee =
    currentUserId !== undefined && userAssignees.includes(currentUserId);
  const viewerIsMemberAssignee =
    selfEntityId !== undefined && memberAssignees.includes(selfEntityId);
  const viewerIsAssignee = viewerIsUserAssignee || viewerIsMemberAssignee;

  // When the viewer is an assignee (but not the creator), show the creator circle first.
  if (
    !isCreator &&
    viewerIsAssignee &&
    creatorId &&
    creatorId !== currentUserId
  ) {
    const info = byUserId.get(creatorId);
    if (info?.initials && !seen.has(`u:${creatorId}`)) {
      seen.add(`u:${creatorId}`);
      displays.push(info);
    }
  }

  for (const uid of userAssignees) {
    if (!uid || uid === currentUserId) continue;
    if (seen.has(`u:${uid}`)) continue;
    const info = byUserId.get(uid);
    if (info?.initials) {
      seen.add(`u:${uid}`);
      displays.push(info);
    }
  }

  const profiles = task.assigneeMemberProfiles ?? [];
  for (const mid of memberAssignees) {
    if (!mid || mid === selfEntityId) continue;
    if (seen.has(`m:${mid}`)) continue;
    const embedded = profiles.find((p) => p.id === mid);
    if (embedded?.name) {
      const initials = getAvatarInitials(embedded.name);
      if (initials) {
        seen.add(`m:${mid}`);
        displays.push({ initials, color: embedded.color ?? '#36a9e2' });
        continue;
      }
    }
    const info = byMemberId.get(mid);
    if (info?.initials) {
      seen.add(`m:${mid}`);
      displays.push(info);
    }
  }

  return displays;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const {
    openBirthdayCard,
    openBirthdayAddChoice,
    birthdays: contextBirthdays,
  } = useBirthdaySheets();

  // ── Convex: spaceId ────────────────────────────────────────────────────────
  // TODO: כאשר defaultSpaceId ייאכלס ב-onboarding, לעבור לשליפה ישירה מ-user.defaultSpaceId
  // getMySpace מחזיר את ה-spaceId ישירות (Id<'spaces'> | null)
  const spaceId = useQuery(api.users.getMySpace);

  // ── Convex: current user (for greeting name + avatar) ─────────────────────
  const currentUser = useQuery(api.users.getCurrentUser);
  const userFirstName = currentUser?.fullName?.split(' ')[0] ?? null;

  // ── Convex: family contacts (for assignee avatars on task rows) ────────────
  const familyContacts = useQuery(api.members.listMyFamilyContacts);

  // Build two lookup maps for compact assignee indicators:
  //   byUserId   — keyed by matched Convex userId  (for assignedTo / assignedToUserIds)
  //   byMemberId — keyed by member entity _id       (for assignedToMemberId / assignedToMemberIds)
  // This mirrors the resolution order used by the Tasks screen's resolveAssigneeDisplays.
  const memberMaps = useMemo(() => {
    const byUserId = new Map<string, { initials: string; color: string }>();
    const byMemberId = new Map<string, { initials: string; color: string }>();
    const selfEntityId = familyContacts?.selfEntityId as string | undefined;

    for (const member of familyContacts?.members ?? []) {
      const name = (member.displayName ?? '').trim();
      const initials = getAvatarInitials(name);
      const info = {
        initials,
        color: (member.color ?? '#36a9e2') as string,
      };
      if (member.matchedUserId) {
        byUserId.set(member.matchedUserId as string, info);
      }
      byMemberId.set(member._id as string, info);
    }
    return { byUserId, byMemberId, selfEntityId };
  }, [familyContacts?.members, familyContacts?.selfEntityId]);

  // Full-profile lookup maps for ProfileCircles (need name, not just initials).
  // Excludes the current user so they never appear in their own shared-with list.
  const familyProfilesByUserId = useMemo(() => {
    const map = new Map<string, ProfileCircle>();
    const currentUserId = currentUser?._id as string | undefined;
    for (const member of familyContacts?.members ?? []) {
      const uid = (member as { matchedUserId?: string }).matchedUserId;
      if (!uid || uid === currentUserId) continue;
      const name = (member.displayName ?? '').trim();
      if (!name) continue;
      map.set(uid, {
        id: uid,
        name,
        color: (member.color ?? '#36a9e2') as string,
      });
    }
    return map;
  }, [familyContacts?.members, currentUser?._id]);

  const familyProfilesByMemberId = useMemo(() => {
    const map = new Map<string, ProfileCircle>();
    const selfEntityId = familyContacts?.selfEntityId as string | undefined;
    for (const member of familyContacts?.members ?? []) {
      const mid = member._id as string;
      if (mid === selfEntityId) continue;
      const name = (member.displayName ?? '').trim();
      if (!name) continue;
      map.set(mid, {
        id: mid,
        name,
        color: (member.color ?? '#36a9e2') as string,
      });
    }
    return map;
  }, [familyContacts?.members, familyContacts?.selfEntityId]);

  // ── Convex: tasks mutations ────────────────────────────────────────────────
  const toggleCompletedMutation = useMutation(api.tasks.toggleCompleted);
  const softDeleteTaskMutation = useMutation(api.tasks.softDeleteTask);
  const toggleSubtaskMutation = useMutation(api.tasks.toggleSubtaskCompleted);
  const upsertHomeRsvpMutation = useMutation(api.eventRsvps.upsertRsvp);
  const [showToast, setShowToast] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // true while the user has not explicitly navigated away from Today.
  // Set to false whenever the user taps Yesterday / Tomorrow / a calendar cell.
  // Set back to true when the user taps Today.
  const pinnedToToday = useRef(true);
  const [calendarMode, setCalendarMode] = useState<'segmented' | 'month'>(
    'segmented'
  );

  // ── Insight card ───────────────────────────────────────────────────────────
  const [_dismissedInsightDate, setDismissedInsightDate] = useState<
    string | null
  >(null);

  // ── Navigation app picker ──────────────────────────────────────────────────
  const [navPickerLocation, setNavPickerLocation] = useState<string | null>(
    null
  );
  const [navPickerLocationUrl, setNavPickerLocationUrl] = useState<
    string | null
  >(null);

  // ── RSVP (replaces pendingResponses + expandedPendingId) ──────────────────
  const [openRsvpForId, setOpenRsvpForId] = useState<string | null>(null);

  // ── Undated tasks "show all" modal ─────────────────────────────────────────
  const [showAllUndated, setShowAllUndated] = useState(false);

  // ── Task detail sheet ──────────────────────────────────────────────────────
  const [taskSheetTaskId, setTaskSheetTaskId] = useState<string | null>(null);
  const [taskSheetVisible, setTaskSheetVisible] = useState(false);

  const openTaskSheet = (id: string) => {
    setTaskSheetTaskId(id);
    setTaskSheetVisible(true);
  };
  const closeTaskSheet = () => setTaskSheetVisible(false);

  const {
    unseenCount,
    markAllSeen,
    isLoading: notifLoading,
  } = useNotifications();

  const handleBellPress = (): void => {
    if (!isNotificationsOpen) setIsNotificationsOpen(true);
    if (!notifLoading) markAllSeen();
  };

  // Refresh live event labels once per minute and immediately whenever the app
  // returns to the foreground. A single screen-level timer avoids per-card work.
  useEffect(() => {
    const refreshNow = (): void => setNowMs(Date.now());
    const firstDelay = 60_000 - (Date.now() % 60_000);
    let minuteInterval: ReturnType<typeof setInterval> | undefined;
    const minuteTimeout = setTimeout(() => {
      refreshNow();
      minuteInterval = setInterval(refreshNow, 60_000);
    }, firstDelay);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshNow();
    });

    return () => {
      clearTimeout(minuteTimeout);
      if (minuteInterval) clearInterval(minuteInterval);
      subscription.remove();
    };
  }, []);

  // ── Computed values ────────────────────────────────────────────────────────
  const greeting = getGreetingByHour(new Date().getHours());
  const homeGreeting = userFirstName
    ? `${greeting}, ${userFirstName}`
    : greeting;
  const todayISO = new Date().toISOString().split('T')[0];

  // Refreshes with the single minute clock so an app left open across midnight
  // moves live states and date labels forward without adding another timer.
  const today = useMemo(() => new Date(nowMs), [nowMs]);
  const tomorrow = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [today]);
  const yesterday = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [today]);

  // Tracks the calendar-day midnight we last saw so the rollover effect can
  // detect when the real date changes without firing every minute.
  const lastMidnightRef = useRef<number>(
    new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  );

  // Midnight rollover: fires every minute (whenever `today` changes), but only
  // advances selectedDate when the calendar day has actually changed AND the
  // user was pinned to Today. Explicit Yesterday / Tomorrow / calendar-cell
  // selections set pinnedToToday to false and are left untouched.
  useEffect(() => {
    const currentMidnight = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ).getTime();
    if (currentMidnight !== lastMidnightRef.current) {
      lastMidnightRef.current = currentMidnight;
      if (pinnedToToday.current) {
        setSelectedDate(new Date());
      }
    }
  }, [today]);

  // Wrapper that keeps pinnedToToday in sync with every explicit date selection.
  const selectDate = (date: Date): void => {
    pinnedToToday.current = isSameDay(date, today);
    setSelectedDate(date);
  };

  const selectedDateLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString('he-IL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    [selectedDate]
  );

  const isSelectedToday = isSameDay(selectedDate, today);
  const isSelectedTomorrow = isSameDay(selectedDate, tomorrow);
  const isSelectedYesterday = isSameDay(selectedDate, yesterday);
  const isCustomDate =
    !isSelectedToday && !isSelectedYesterday && !isSelectedTomorrow;
  const emptyDayCopy = getEmptyStateCopy(selectedDate);
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // FIXED: removed hardcoded mock items (id:'1','2','3') that caused
  // ArgumentValidationError when users tapped them and pressed "עריכה" —
  // the mock IDs were passed as Id<'events'> to Convex which rejected them.
  // Real data from Convex now fills the timeline; no placeholder needed.
  const [items, setItems] = useState<Item[]>([]);

  // ── Community: date range for selectedDate ────────────────────────────────
  const { from, to } = useMemo(() => {
    const d = new Date(selectedDate);
    d.setHours(0, 0, 0, 0);
    const fromMs = d.getTime();
    const toMs = fromMs + 24 * 60 * 60 * 1000 - 1;
    return { from: fromMs, to: toMs };
  }, [selectedDate]);

  const communityEventsQuery = useQuery(api.events.listCommunityEventsForDate, {
    from,
    to,
  });
  const communityEvents = communityEventsQuery ?? [];

  // Community event IDs for the current date — used to fetch "also added" family data
  const communityEventIds = useMemo(
    () => communityEvents.map((ev) => ev._id as Id<'events'>),
    [communityEvents]
  );

  // Batch query: authorized event tasks per community event (server-filtered per role/visibility).
  // Skipped when there are no community events to avoid unnecessary subscriptions.
  const homeEventTaskResults =
    useQuery(
      api.eventTasks.listEventTasksForHome,
      communityEventIds.length > 0 ? { eventIds: communityEventIds } : 'skip'
    ) ?? [];

  // Build a fast lookup: eventId → authorized task accordion data.
  const eventTaskDataById = useMemo<Record<string, EventTaskAccordionData>>(
    () =>
      homeEventTaskResults.reduce<Record<string, EventTaskAccordionData>>(
        (acc, r) => {
          const mappedTasks = r.tasks.map((t) => ({
            id: String(t._id),
            title: t.title,
            completed: t.completed,
            completedAt: t.completedAt,
            order: t.order,
            assignedToUserId: t.assignedToUserId
              ? String(t.assignedToUserId)
              : undefined,
            assignedToManual: t.assignedToManual,
            assigneeDisplay: t.assigneeDisplay,
            isAssignedToCurrentUser: t.isAssignedToCurrentUser,
          }));
          acc[String(r.eventId)] = {
            // Home-only rule: unassigned + mine, never other members'
            // assigned tasks — see filterHomeVisibleEventTasks doc.
            tasks: filterHomeVisibleEventTasks(mappedTasks),
            canManageTasks: r.canManageTasks,
            tasksVisibleToParticipants: r.tasksVisibleToParticipants,
          };
          return acc;
        },
        {}
      ),
    [homeEventTaskResults]
  );

  // For each community event, which family members (same space) also added it to their calendar
  const familyAlsoAdded =
    useQuery(
      api.profileCircles.getFamilyAlsoAddedCommunityEvents,
      communityEventIds.length > 0 ? { eventIds: communityEventIds } : 'skip'
    ) ?? {};

  // ── Personal events for selected date ─────────────────────────────────────
  const personalEventData =
    useQuery(api.events.listByDateRange, { from, to }) ?? [];

  // ── My RSVPs — one query for all events; used to detect personal invite status ──
  const myRsvpsHome = useQuery(api.eventRsvps.listByUser) ?? [];
  const myRsvpByEventIdHome = useMemo(
    () => new Map(myRsvpsHome.map((r) => [String(r.eventId), r.status])),
    [myRsvpsHome]
  );

  /**
   * Space-scoped `listByDateRange` returns every event in the user's space,
   * including community events that are NOT on the personal/home aggregate
   * (e.g. open community event after "remove from my calendar"). Home must
   * not show those — align with `listCommunityEventsForDate` + server
   * `shouldIncludeInPersonalHomeCalendar`. While the community query is still
   * loading, keep unfiltered personal rows to avoid wiping the list briefly.
   */
  const personalEventsForHome = useMemo(() => {
    if (communityEventsQuery === undefined) {
      return personalEventData;
    }
    const allowedCommunityHomeIds = new Set(
      communityEventsQuery.map((e) => e._id as string)
    );
    return personalEventData.filter((ev) => {
      if (!ev.communityId) {
        return true;
      }
      return allowedCommunityHomeIds.has(ev._id as string);
    });
  }, [personalEventData, communityEventsQuery]);

  // FIXED: linked (shared) events for selected date — merged into timeline
  const linkedEventData =
    useQuery(
      api.linkedEvents.getLinkedEventsForSpace,
      spaceId ? { spaceId: spaceId as Id<'spaces'>, from, to } : 'skip'
    ) ?? [];

  const assignedEventTasks =
    useQuery(api.eventTasks.listMyAssignedEventTasksForDate, { from, to }) ??
    [];

  // Single batched "already added to my tasks" source of truth for every
  // community event's "חשוב לזכור" group — shared with Event Details and
  // the community "תזכורות" tab. One query for the whole Home screen,
  // never one per event/important item (see PART D6).
  const myImportantItemsBundleStatus =
    useQuery(api.tasks.getMyImportantItemsBundleStatus) ?? {};

  // ── Convex: dated tasks ────────────────────────────────────────────────────
  // listMyTasks mirrors Tasks-screen visibility: creator, assignedTo,
  // and co-member secondary assignees — no spaceId restriction. It never
  // returns general community reminders (excluded unconditionally, even for
  // their own creator — see that query's own doc comment in convex/tasks.ts,
  // "CREATOR-OVERLAP CORRECTION"), because it has no way to consult a
  // viewer's personal-dismissal state and would otherwise let a reminder's
  // creator bypass `dismissCommunityReminderForMe`.
  const convexTasks = useQuery(api.tasks.listMyTasks);

  // Dedicated, date-bounded, personal-dismissal-aware Community Reminder
  // retrieval for every ACTIVE community the viewer belongs to — reuses the
  // EXACT same [from, to] Home already computes for the selected day (see
  // the `from`/`to` memo above), never a separate/wider range. This is the
  // ONLY source of shared Community Reminders on Home, for every viewer
  // including the reminder's own creator.
  const homeCommunityReminders =
    useQuery(api.tasks.listVisibleCommunityRemindersForRange, {
      from,
      to,
    }) ?? [];

  // Merge personal tasks (listMyTasks) with the dedicated Community Reminder
  // set, deduped by task id. Since listMyTasks never returns general
  // community reminders (see above), the two sources cannot overlap for a
  // reminder — this dedup only matters for the (unrelated) case of an
  // ordinary personal/assigned task, kept defensively for robustness.
  const mergedConvexTasks = useMemo(() => {
    const map = new Map<string, (typeof homeCommunityReminders)[number]>();
    for (const t of convexTasks ?? []) map.set(String(t._id), t);
    for (const t of homeCommunityReminders) {
      if (!map.has(String(t._id))) map.set(String(t._id), t);
    }
    return [...map.values()];
  }, [convexTasks, homeCommunityReminders]);

  // General community reminders follow the same "active lifecycle" as the
  // Community Reminders tab / Main "מה חשוב עכשיו": once past due they must
  // disappear from every active Home surface (timeline, today, undated).
  // Ordinary personal tasks are unaffected — they keep their existing
  // overdue-bucket behavior below. Uses the same canonical isTaskPastDue
  // helper (device nowMs), never a second expiry definition.
  const visibleConvexTasks = useMemo(
    () =>
      mergedConvexTasks.filter(
        (t) => t.taskType !== 'community_reminder' || !isTaskPastDue(t, nowMs)
      ),
    [mergedConvexTasks, nowMs]
  );

  const todayTasks: Item[] = useMemo(
    () =>
      visibleConvexTasks
        .filter(
          (t) =>
            t.dueDate != null &&
            // Only timed tasks go into the timeline. Untimed today tasks
            // are rendered in the separate "היום" section below the timeline.
            t.hasTime === true &&
            isSameDay(new Date(t.dueDate), selectedDate) &&
            // "חשוב לזכור" personal copies and bundles are shown nested under
            // the event, not as separate standalone task cards on Home.
            !isEventDerivedImportantItemTask(t)
        )
        .map((t) => {
          // dueAt holds the exact time; dueDate is day-at-midnight.
          // Use dueAt first so the displayed time matches what the Tasks screen shows.
          const timeTs = t.dueAt ?? t.dueDate;
          const timeStr = timeTs
            ? new Date(timeTs).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';
          const currentUserId = currentUser?._id as string | undefined;
          const assigneeDisplays = resolveAllNonSelfAssignees(
            t,
            currentUserId,
            memberMaps.byUserId,
            memberMaps.byMemberId,
            memberMaps.selfEntityId
          );
          return {
            id: t._id,
            time: timeStr,
            startAt: timeTs ?? undefined,
            title: t.title,
            location: '',
            type: 'task' as const,
            icon: 'check-box',
            iconBg: '#E7F5FF',
            iconColor: '#228BE6',
            assigneeColor: assigneeDisplays[0]?.color ?? '#E7F5FF',
            assigneeInitials: assigneeDisplays[0]?.initials,
            assigneeDisplays:
              assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
            completed: t.completed,
            completedAt: t.completedAt ?? undefined,
            taskSource: 'personal_task' as const,
            // General community reminders are shared community content, not
            // a private task — surface the same classification label +
            // community tag pattern already used for community events. Uses
            // the SAME shared helper as the date-only mapping below (BUG 2
            // fix) so the two paths can never carry different metadata for
            // the same item shape.
            ...getHomeReminderMetadata(t),
            subtasks: (t.subtasks ?? []).map((s) => ({
              id: s.id,
              title: s.title,
              completed: s.completed,
              attachment: s.attachment
                ? {
                    id: s.attachment.id,
                    type: s.attachment.type,
                    storageId: String(s.attachment.storageId),
                    originalName: s.attachment.originalName ?? '',
                    displayName: s.attachment.displayName ?? '',
                    mimeType: s.attachment.mimeType,
                    sizeBytes: s.attachment.sizeBytes,
                    createdAt: s.attachment.createdAt,
                  }
                : undefined,
            })),
          };
        }),
    [visibleConvexTasks, selectedDate, memberMaps, currentUser?._id]
  );

  // ── Overdue incomplete tasks — due before today, not yet completed ─────────
  const overdueTasks: OverdueTask[] = useMemo(() => {
    const startOfToday = new Date(nowMs);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    return visibleConvexTasks
      .filter(
        (t) =>
          t.dueDate != null &&
          t.dueDate < startOfTodayMs &&
          !t.completed &&
          !isEventDerivedImportantItemTask(t)
      )
      .map((t) => {
        const currentUserId = currentUser?._id as string | undefined;
        const assigneeDisplays = resolveAllNonSelfAssignees(
          t,
          currentUserId,
          memberMaps.byUserId,
          memberMaps.byMemberId,
          memberMaps.selfEntityId
        );
        return {
          id: t._id,
          title: t.title,
          completed: t.completed,
          assigneeInitials: assigneeDisplays[0]?.initials,
          assigneeColor: assigneeDisplays[0]?.color,
          assigneeDisplays:
            assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
          dueDate: t.dueDate ?? undefined,
          hasTime: t.hasTime ?? false,
          dueAt: t.dueAt ?? undefined,
          subtasks: (t.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
            attachment: s.attachment
              ? {
                  id: s.attachment.id,
                  type: s.attachment.type,
                  storageId: String(s.attachment.storageId),
                  originalName: s.attachment.originalName ?? '',
                  displayName: s.attachment.displayName ?? '',
                  mimeType: s.attachment.mimeType,
                  sizeBytes: s.attachment.sizeBytes,
                  createdAt: s.attachment.createdAt,
                }
              : s.image
                ? {
                    id: `${s.id}-img`,
                    type: 'image' as const,
                    storageId: String(s.image.storageId),
                    originalName: '',
                    displayName: '',
                    mimeType: s.image.mimeType,
                    sizeBytes: s.image.sizeBytes,
                    createdAt: s.image.createdAt,
                  }
                : undefined,
          })),
        };
      });
  }, [visibleConvexTasks, nowMs, memberMaps, currentUser?._id]);

  // ── Untimed personal tasks for the selected day ───────────────────────────
  // Tasks with hasTime===true go into the timeline via todayTasks.
  // Tasks without a specific time (hasTime falsy) are rendered in a separate
  // section. Boundaries are based on selectedDate so the section updates when
  // the user picks a different day.
  const selectedDayUntimedTasks: UndatedTask[] = useMemo(() => {
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();
    const currentUserId = currentUser?._id as string | undefined;
    return visibleConvexTasks
      .filter(
        (t) =>
          t.dueDate != null &&
          !t.hasTime &&
          t.dueDate >= dayStartMs &&
          t.dueDate < dayEndMs &&
          !isEventDerivedImportantItemTask(t)
      )
      .map((t) => {
        const assigneeDisplays = resolveAllNonSelfAssignees(
          t,
          currentUserId,
          memberMaps.byUserId,
          memberMaps.byMemberId,
          memberMaps.selfEntityId
        );
        return {
          id: t._id,
          title: t.title,
          completed: t.completed,
          completedAt: t.completedAt ?? undefined,
          assigneeInitials: assigneeDisplays[0]?.initials,
          assigneeColor: assigneeDisplays[0]?.color,
          assigneeDisplays:
            assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
          // BUG 2 fix: classification/community metadata is a property of
          // the ITEM (t.taskType/t.communityName/t.communityId from
          // listMyTasks), never of whether dueAt is set — uses the SAME
          // shared helper as the timed `todayTasks` mapping above so a
          // date-only community reminder can never lose its
          // 'תזכורת קהילה' + community-name metadata on Home.
          ...getHomeReminderMetadata(t),
          subtasks: (t.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
            attachment: s.attachment
              ? {
                  id: s.attachment.id,
                  type: s.attachment.type,
                  storageId: String(s.attachment.storageId),
                  originalName: s.attachment.originalName ?? '',
                  displayName: s.attachment.displayName ?? '',
                  mimeType: s.attachment.mimeType,
                  sizeBytes: s.attachment.sizeBytes,
                  createdAt: s.attachment.createdAt,
                }
              : s.image
                ? {
                    id: `${s.id}-img`,
                    type: 'image' as const,
                    storageId: String(s.image.storageId),
                    originalName: '',
                    displayName: '',
                    mimeType: s.image.mimeType,
                    sizeBytes: s.image.sizeBytes,
                    createdAt: s.image.createdAt,
                  }
                : undefined,
          })),
        };
      });
  }, [visibleConvexTasks, selectedDate, memberMaps, currentUser?._id]);

  // ── Assigned eventTasks grouped by eventId — shared across all event item builders ──
  const tasksByEvent: Record<string, AssignedEventTask[]> = useMemo(() => {
    const map: Record<string, AssignedEventTask[]> = {};
    for (const t of assignedEventTasks) {
      const key = String(t.eventId);
      if (!map[key]) map[key] = [];
      map[key].push({ id: t._id, title: t.title, completed: t.completed });
    }
    return map;
  }, [assignedEventTasks]);

  // ── importantItems indexed by eventId — feeds both communityEventItems and
  //    personalEventItems so the section survives deduplication either way ──
  // STAGE 4 ALIGNMENT PART F/G/I — once the source event has ended, its
  // "חשוב לזכור" preview/action must stop appearing on this ACTIVE Home
  // surface (the event card itself is untouched — governed entirely by
  // Home's own existing personal-calendar date logic).
  const communityImportantItemsById = useMemo(() => {
    const map: Record<string, ImportantItem[]> = {};
    for (const ev of communityEvents) {
      const items = (ev as { importantItems?: ImportantItem[] }).importantItems;
      if (
        items &&
        items.length > 0 &&
        isEventEligibleForHomeImportantItemsPreview(
          {
            startTime: ev.startTime,
            endTime: ev.endTime,
            allDay: ev.allDay,
          },
          nowMs
        )
      ) {
        map[String(ev._id)] = items;
      }
    }
    return map;
  }, [communityEvents, nowMs]);

  // ── Community event items mapped to Item shape ────────────────────────────
  const communityEventItems: Item[] = useMemo(() => {
    return communityEvents.map((ev) => {
      const myTasks = tasksByEvent[String(ev._id)] ?? [];
      const count = myTasks.length;
      const personalTaskSummary =
        count === 0
          ? undefined
          : count === 1
            ? 'יש לך משימה אחת באירוע הזה'
            : `יש לך ${count} משימות באירוע הזה`;
      const rsvpStatus =
        myRsvpByEventIdHome.get(String(ev._id)) ?? ('none' as const);
      const requiresRsvp =
        (ev as { requiresRsvp?: boolean }).requiresRsvp === true;
      return {
        id: ev._id,
        time: ev.allDay
          ? 'כל היום'
          : new Date(ev.startTime).toLocaleTimeString('he-IL', {
              hour: '2-digit',
              minute: '2-digit',
            }),
        endTime: ev.allDay
          ? undefined
          : ev.endTime != null
            ? new Date(ev.endTime).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : undefined,
        startAt: ev.startTime,
        endAt: ev.endTime ?? undefined,
        title: ev.title,
        location: ev.location ?? '',
        locationUrl: (ev as { locationUrl?: string }).locationUrl,
        remoteUrl: (ev as { onlineUrl?: string }).onlineUrl,
        type: 'event' as const,
        icon: 'event',
        iconBg: '#E8F5FD',
        iconColor: '#36a9e2',
        assigneeColor: '#36a9e2',
        completed: false,
        pending: requiresRsvp && rsvpStatus === 'none',
        rsvpStatus,
        allDay: ev.allDay,
        groupName: ev.communityName,
        communityId: ev.communityId as string | undefined,
        personalTaskSummary,
        isRecurring: undefined,
        recurringPattern: undefined,
        isSavedToMyCalendar: ev.isSavedToMyCalendar,
        myAssignedTasks: myTasks.length > 0 ? myTasks : undefined,
        importantItems: communityImportantItemsById[String(ev._id)],
        profileCircles: familyAlsoAdded[String(ev._id)] ?? [],
        profileCirclesExtraCount: 0,
        profileCirclesContext: 'alsoAddedToCalendar' as const,
        authorizedEventTasks: eventTaskDataById[String(ev._id)],
      };
    });
  }, [
    communityEvents,
    tasksByEvent,
    communityImportantItemsById,
    familyAlsoAdded,
    myRsvpByEventIdHome,
    eventTaskDataById,
  ]);

  // ── Assigned event task items mapped to Item shape ────────────────────────
  const assignedTaskItems: Item[] = useMemo(
    () =>
      assignedEventTasks.map((t) => ({
        id: t._id,
        time: t.eventAllDay
          ? '00:00'
          : new Date(t.eventStartTime).toLocaleTimeString('he-IL', {
              hour: '2-digit',
              minute: '2-digit',
            }),
        title: t.title,
        location: t.eventTitle,
        type: 'task' as const,
        icon: 'check-box',
        iconBg: '#F0FDF4',
        iconColor: '#16a34a',
        assigneeColor: '#16a34a',
        completed: t.completed ?? false,
        allDay: false,
        groupName: t.communityName,
        communityId: t.communityId as string,
        // eventTask from eventTasks table — not deletable, opens event instead
        taskSource: 'event_task' as const,
        taskEventId: String(t.eventId),
      })),
    [assignedEventTasks]
  );

  // ── Personal events for selected date mapped to Item shape ───────────────
  const personalEventItems: Item[] = useMemo(
    () =>
      personalEventsForHome.map((ev) => {
        const communityIdStr = ev.communityId
          ? (ev.communityId as string)
          : undefined;
        const communityName =
          communityIdStr !== undefined && 'communityName' in ev
            ? (ev as { communityName?: string }).communityName
            : undefined;
        const isSavedToMyCalendar =
          'isSavedToMyCalendar' in ev
            ? (ev as { isSavedToMyCalendar?: boolean }).isSavedToMyCalendar
            : undefined;
        const myTasks = tasksByEvent[String(ev._id)] ?? [];

        // Profile circles for personal (non-community) events only.
        // Community events that appear in the personal space are handled by
        // communityEventItems (which uses familyAlsoAdded for "גם הוסיפו ליומן").
        let profileCircles: ProfileCircle[] = [];
        let profileCirclesExtraCount = 0;
        let profileCirclesContext: 'sharedWith' | 'alsoAddedToCalendar' =
          'sharedWith';
        // Personal invite RSVP state (non-community, non-creator invitees only)
        let pendingPersonalInviteForItem: boolean | undefined;
        let myPersonalRsvpStatusForItem:
          | 'yes'
          | 'maybe'
          | 'no'
          | 'none'
          | undefined;

        if (!communityIdStr) {
          const evShared = ev as {
            createdBy?: string;
            allFamily?: boolean;
            sharedWithUserIds?: string[];
            sharedWithFamilyMemberIds?: string[];
            participants?: string[];
            sharedMemberProfiles?: Array<{
              id: string;
              displayName: string;
              color: string;
              isViewer: boolean;
            }>;
          };
          const currentUserId = currentUser?._id as string | undefined;
          const isCreator =
            !!currentUserId && evShared.createdBy === currentUserId;

          // Compute personal RSVP status for non-creator explicit invitees.
          // Uses same detection as EventDetailsBottomSheet:
          //   sharedWithUserIds includes currentUserId
          //   OR sharedWithFamilyMemberIds includes viewerSelfEntityId
          if (!isCreator) {
            const homeViewerSelfEntityId = familyContacts?.selfEntityId as
              | string
              | undefined;
            const isExplicitInvitee =
              (currentUserId != null &&
                (evShared.sharedWithUserIds ?? []).includes(currentUserId)) ||
              (homeViewerSelfEntityId != null &&
                (evShared.sharedWithFamilyMemberIds ?? []).includes(
                  homeViewerSelfEntityId
                ));
            if (isExplicitInvitee) {
              const myStatus = myRsvpByEventIdHome.get(String(ev._id)) as
                | 'yes'
                | 'maybe'
                | 'no'
                | 'none'
                | undefined;
              myPersonalRsvpStatusForItem = myStatus ?? 'none';
              if (myPersonalRsvpStatusForItem !== 'yes')
                pendingPersonalInviteForItem = true;
            }
          }

          // Total participant names (family + external) stored at save time.
          const totalParticipants = evShared.participants?.length ?? 0;

          if (isCreator) {
            // Creator's view: show the selected family recipients.
            // Uses server-resolved sharedMemberProfiles so the display is reliable
            // even if the local map has a key mismatch (e.g. admin row vs entity row).
            if (evShared.allFamily) {
              // Use byMemberId so manual family members (entity rows with no
              // matchedUserId) are included alongside app-user family members.
              // selfEntityId is already excluded from familyProfilesByMemberId.
              profileCircles = [...familyProfilesByMemberId.values()];
              profileCirclesExtraCount = Math.max(
                0,
                totalParticipants - profileCircles.length
              );
            } else {
              const resolved = evShared.sharedMemberProfiles ?? [];
              for (const p of resolved) {
                // Safety: never show the current viewer's own circle.
                if (p.isViewer) continue;
                profileCircles.push({
                  id: p.id,
                  name: p.displayName,
                  color: p.color,
                });
              }
              // External count = total participants minus family member IDs.
              const familyCount = (evShared.sharedWithFamilyMemberIds ?? [])
                .length;
              profileCirclesExtraCount = Math.max(
                0,
                totalParticipants - familyCount
              );
            }
          } else {
            // Recipient's view: show the creator's circle + all other recipients.
            // Other-recipient circles come from server-resolved sharedMemberProfiles
            // (cross-space safe — the local map can't resolve creator-space IDs).
            // The isViewer flag from the server skips the current viewer's circle.
            const resolved = evShared.sharedMemberProfiles ?? [];
            const creatorId = evShared.createdBy;
            const circles: ProfileCircle[] = [];
            if (creatorId) {
              const creatorProfile =
                familyProfilesByUserId.get(creatorId) ??
                familyProfilesByMemberId.get(creatorId);
              if (creatorProfile) circles.push(creatorProfile);
            }
            for (const p of resolved) {
              if (p.isViewer) continue;
              circles.push({ id: p.id, name: p.displayName, color: p.color });
            }
            // External participants are never shown as circles; count them in +N.
            // participants stores all display names (family + external) so
            // subtracting the family member ID count gives external count.
            const externalCount = Math.max(
              0,
              totalParticipants -
                (evShared.sharedWithFamilyMemberIds?.length ?? 0)
            );
            // Pass all circles unsliced; ProfileCircles handles maxVisible cap.
            profileCircles = circles;
            profileCirclesExtraCount = externalCount;
          }
          profileCirclesContext = 'sharedWith';
        } else {
          // Community event appearing via personal space — use familyAlsoAdded
          profileCircles = familyAlsoAdded[String(ev._id)] ?? [];
          profileCirclesExtraCount = 0;
          profileCirclesContext = 'alsoAddedToCalendar';
        }

        return {
          id: ev._id,
          time: ev.allDay
            ? 'כל היום'
            : new Date(ev.startTime).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              }),
          endTime:
            !ev.allDay && ev.endTime != null
              ? new Date(ev.endTime).toLocaleTimeString('he-IL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : undefined,
          startAt: ev.startTime,
          endAt: ev.endTime ?? undefined,
          title: ev.title,
          location: ev.location ?? '',
          locationUrl: (ev as { locationUrl?: string }).locationUrl,
          remoteUrl: (ev as { onlineUrl?: string }).onlineUrl,
          type: 'event' as const,
          icon: 'event',
          // Muted visuals for cancelled personal events — mirrors linkedEventItems pattern.
          iconBg:
            (ev as { status?: string }).status === 'cancelled'
              ? '#f3f4f6'
              : '#e8f5fd',
          iconColor:
            (ev as { status?: string }).status === 'cancelled'
              ? '#9ca3af'
              : '#36a9e2',
          assigneeColor: '#36a9e2',
          completed: false,
          allDay: ev.allDay,
          isRecurring: ev.isRecurring,
          recurringPattern: ev.recurringPattern,
          reminders: (ev as { reminders?: number[] }).reminders,
          // Show 'בוטל' badge for cancelled personal events (reuses linkedEvent pattern).
          groupName: communityIdStr
            ? communityName
            : (ev as { status?: string }).status === 'cancelled'
              ? 'בוטל'
              : undefined,
          communityId: communityIdStr,
          isSavedToMyCalendar,
          myAssignedTasks: myTasks.length > 0 ? myTasks : undefined,
          // Carry importantItems from community data so they survive deduplication
          // regardless of which version of the event wins the seen-id check.
          importantItems: communityImportantItemsById[String(ev._id)],
          // Carry authorizedEventTasks from community data so accordion data
          // survives deduplication regardless of which representation wins the
          // seen-id check (mirrors the importantItems propagation pattern).
          authorizedEventTasks: communityIdStr
            ? eventTaskDataById[String(ev._id)]
            : undefined,
          profileCircles,
          profileCirclesExtraCount,
          profileCirclesContext,
          pendingPersonalInvite: pendingPersonalInviteForItem,
          myPersonalRsvpStatus: myPersonalRsvpStatusForItem,
        };
      }),
    [
      personalEventsForHome,
      tasksByEvent,
      communityImportantItemsById,
      familyProfilesByUserId,
      familyProfilesByMemberId,
      familyAlsoAdded,
      currentUser,
      myRsvpByEventIdHome,
      familyContacts?.selfEntityId,
      eventTaskDataById,
    ]
  );

  // FIXED: linked (shared) events mapped to Item shape
  const linkedEventItems: Item[] = useMemo(
    () =>
      linkedEventData.map((ev) => {
        const isCancelled = ev.sourceStatus === 'cancelled';
        const isDeleted = ev.sourceStatus === 'deleted';
        return {
          id: ev._id,
          time: ev.allDay
            ? 'כל היום'
            : new Date(ev.startTime).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              }),
          endTime:
            !ev.allDay && ev.endTime != null
              ? new Date(ev.endTime).toLocaleTimeString('he-IL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : undefined,
          startAt: ev.startTime,
          endAt: ev.endTime ?? undefined,
          title: ev.title,
          location: ev.location ?? '',
          locationUrl: (ev as { locationUrl?: string }).locationUrl,
          type: 'event' as const,
          icon: 'link',
          iconBg: isCancelled || isDeleted ? '#f3f4f6' : '#eff8ff',
          iconColor: isCancelled || isDeleted ? '#9ca3af' : '#0284c7',
          assigneeColor: '#0284c7',
          completed: false,
          allDay: ev.allDay,
          // Small status label in the groupName slot
          groupName: isDeleted ? 'נמחק' : isCancelled ? 'בוטל' : 'משותף',
          linkedEventId: ev._id, // routes to linked-event/[id] on tap
        };
      }),
    [linkedEventData]
  );

  // ── All-day section: community + personal all-day events ──────────────────
  const allDayEvents = useMemo(() => {
    const communityAllDay = communityEventItems
      .filter((i) => i.allDay)
      .map((i) => ({
        id: i.id,
        title: i.title,
        iconColor: i.iconColor,
        groupName: i.groupName,
        communityId: i.communityId,
        isRecurring: undefined,
        recurringPattern: undefined,
        linkedEventId: i.linkedEventId,
        reminders: i.reminders,
      }));
    const personalAllDay = personalEventItems
      .filter((i) => i.allDay)
      .map((i) => ({
        id: i.id,
        title: i.title,
        iconColor: i.iconColor,
        groupName: i.groupName,
        communityId: i.communityId,
        isRecurring: i.isRecurring,
        recurringPattern: i.recurringPattern,
        reminders: i.reminders,
        linkedEventId: i.linkedEventId,
      }));
    // FIXED: include linked all-day events in all-day strip
    const linkedAllDay = linkedEventItems
      .filter((i) => i.allDay)
      .map((i) => ({
        id: i.id,
        title: i.title,
        iconColor: i.iconColor,
        groupName: i.groupName,
        communityId: undefined as string | undefined,
        isRecurring: undefined,
        recurringPattern: undefined,
        reminders: i.reminders,
        linkedEventId: i.linkedEventId,
      }));
    // Same event can appear in more than one source (e.g. community + personal lists); dedupe by id.
    const merged = [...communityAllDay, ...personalAllDay, ...linkedAllDay];
    const seenIds = new Set<string>();
    const deduped: typeof merged = [];
    for (const ev of merged) {
      if (!seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        deduped.push(ev);
      }
    }
    return deduped;
  }, [communityEventItems, personalEventItems, linkedEventItems]);

  // allItems = personal events + tasks (today) + mock items + community events + assigned tasks
  const allItems = useMemo(() => {
    const timedPersonalEvents = personalEventItems.filter((i) => !i.allDay);
    const timedCommunityEvents = communityEventItems.filter((i) => !i.allDay);
    // Assigned event tasks appear as separate actionable items in the timeline.
    // communityEventItems uses event._id; assignedTaskItems uses task._id — no collision.
    // Deduplicate by id as a conservative guard.
    const _timedAssignedTasks = assignedTaskItems.filter((i) => !i.allDay);
    // FIXED: linked events merged into timeline (timed only; all-day handled separately)
    const timedLinkedEvents = linkedEventItems.filter((i) => !i.allDay);
    const seen = new Set<string>();
    const deduped: Item[] = [];
    // timedAssignedTasks intentionally excluded: event tasks are now shown
    // inline inside their parent event card via InlineEventTasksSection.
    for (const item of [
      ...todayTasks,
      ...items,
      ...timedPersonalEvents,
      ...timedLinkedEvents,
      ...timedCommunityEvents,
    ]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        deduped.push(item);
      }
    }
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return Number.isNaN(h) || Number.isNaN(m) ? 0 : h * 60 + m;
    };
    return deduped.sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return toMinutes(a.time) - toMinutes(b.time);
    });
  }, [
    todayTasks,
    items,
    personalEventItems,
    linkedEventItems,
    communityEventItems,
    assignedTaskItems,
  ]);

  const allDayTimelineItems = useMemo(() => {
    const seen = new Set<string>();
    const result: Item[] = [];
    for (const item of [
      ...personalEventItems,
      ...communityEventItems,
      ...linkedEventItems,
    ]) {
      if (!item.allDay || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
    return result;
  }, [personalEventItems, communityEventItems, linkedEventItems]);

  // ── Convex: undated tasks ──────────────────────────────────────────────────
  const convexUndatedTasks = useQuery(
    api.tasks.listUndated,
    spaceId ? { spaceId: spaceId as Id<'spaces'> } : 'skip'
  );
  // mock fallback כל עוד אין נתונים בדאטהבייס
  /* MOCK (הוסר):
  const [undatedTasks, setUndatedTasks] = useState<UndatedTask[]>([
    { id: 'u1', title: 'לקרוא ספר', completed: false },
    { id: 'u2', title: 'לצלם תמונות', completed: false },
    { id: 'u3', title: 'לסדר ארון הבגדים', completed: false },
  ]);
  */
  const undatedTasks: UndatedTask[] = useMemo(
    () =>
      (convexUndatedTasks ?? [])
        .filter((t) => !isEventDerivedImportantItemTask(t))
        .map((t) => {
          const currentUserId = currentUser?._id as string | undefined;
          const assigneeDisplays = resolveAllNonSelfAssignees(
            t,
            currentUserId,
            memberMaps.byUserId,
            memberMaps.byMemberId,
            memberMaps.selfEntityId
          );
          return {
            id: t._id,
            title: t.title,
            completed: t.completed,
            completedAt: t.completedAt ?? undefined,
            assigneeInitials: assigneeDisplays[0]?.initials,
            assigneeColor: assigneeDisplays[0]?.color,
            assigneeDisplays:
              assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
            subtasks: (t.subtasks ?? []).map((s) => ({
              id: s.id,
              title: s.title,
              completed: s.completed,
              attachment: s.attachment
                ? {
                    id: s.attachment.id,
                    type: s.attachment.type,
                    storageId: String(s.attachment.storageId),
                    originalName: s.attachment.originalName ?? '',
                    displayName: s.attachment.displayName ?? '',
                    mimeType: s.attachment.mimeType,
                    sizeBytes: s.attachment.sizeBytes,
                    createdAt: s.attachment.createdAt,
                  }
                : undefined,
            })),
          };
        }),
    [convexUndatedTasks, memberMaps, currentUser?._id]
  );

  // ── All tasks completed today — single authoritative source for "בוצעו היום" ─
  // Covers timed, dated-untimed, overdue, and undated tasks. Day boundaries are
  // derived from nowMs so this memo recomputes on the existing clock rollover,
  // not from an independent new Date() call.
  const completedTodayTasksAllSources: HomeDailyTask[] = useMemo(() => {
    const startOfToday = new Date(nowMs);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    startOfTomorrow.setHours(0, 0, 0, 0);

    const todayStartMs = startOfToday.getTime();
    const todayEndMs = startOfTomorrow.getTime();

    const currentUserId = currentUser?._id as string | undefined;

    const isCompletedToday = (t: { completedAt?: number | null }): boolean =>
      t.completedAt != null &&
      t.completedAt >= todayStartMs &&
      t.completedAt < todayEndMs;

    const fromDated: HomeDailyTask[] = visibleConvexTasks
      .filter((t) => t.completed && isCompletedToday(t))
      .map((t) => {
        const assigneeDisplays = resolveAllNonSelfAssignees(
          t,
          currentUserId,
          memberMaps.byUserId,
          memberMaps.byMemberId,
          memberMaps.selfEntityId
        );
        return {
          id: t._id,
          title: t.title,
          completed: true as const,
          completedAt: t.completedAt ?? undefined,
          dueDate: t.dueDate ?? undefined,
          hasTime: t.hasTime ?? undefined,
          dueAt: t.dueAt ?? undefined,
          assigneeDisplays:
            assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
          subtasks: (t.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
            attachment: s.attachment
              ? {
                  id: s.attachment.id,
                  type: s.attachment.type,
                  storageId: String(s.attachment.storageId),
                  originalName: s.attachment.originalName ?? '',
                  displayName: s.attachment.displayName ?? '',
                  mimeType: s.attachment.mimeType,
                  sizeBytes: s.attachment.sizeBytes,
                  createdAt: s.attachment.createdAt,
                }
              : s.image
                ? {
                    id: `${s.id}-img`,
                    type: 'image' as const,
                    storageId: String(s.image.storageId),
                    originalName: '',
                    displayName: '',
                    mimeType: s.image.mimeType,
                    sizeBytes: s.image.sizeBytes,
                    createdAt: s.image.createdAt,
                  }
                : undefined,
          })),
        };
      });

    const fromUndated: HomeDailyTask[] = (convexUndatedTasks ?? [])
      .filter((t) => t.completed && isCompletedToday(t))
      .map((t) => {
        const assigneeDisplays = resolveAllNonSelfAssignees(
          t,
          currentUserId,
          memberMaps.byUserId,
          memberMaps.byMemberId,
          memberMaps.selfEntityId
        );
        return {
          id: t._id,
          title: t.title,
          completed: true as const,
          completedAt: t.completedAt ?? undefined,
          assigneeDisplays:
            assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
          subtasks: (t.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
            attachment: s.attachment
              ? {
                  id: s.attachment.id,
                  type: s.attachment.type,
                  storageId: String(s.attachment.storageId),
                  originalName: s.attachment.originalName ?? '',
                  displayName: s.attachment.displayName ?? '',
                  mimeType: s.attachment.mimeType,
                  sizeBytes: s.attachment.sizeBytes,
                  createdAt: s.attachment.createdAt,
                }
              : s.image
                ? {
                    id: `${s.id}-img`,
                    type: 'image' as const,
                    storageId: String(s.image.storageId),
                    originalName: '',
                    displayName: '',
                    mimeType: s.image.mimeType,
                    sizeBytes: s.image.sizeBytes,
                    createdAt: s.image.createdAt,
                  }
                : undefined,
          })),
        };
      });

    const seen = new Set<string>();
    return [...fromDated, ...fromUndated].filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [
    visibleConvexTasks,
    convexUndatedTasks,
    nowMs,
    memberMaps,
    currentUser?._id,
  ]);

  const toggleUndatedTask = async (id: string) => {
    try {
      await toggleCompletedMutation({ id: id as Id<'tasks'> });
    } catch (e) {
      console.error('toggleUndatedTask error:', e);
      // TODO: להוסיף optimistic UI בעתיד
    }
  };

  const toggleOverdueTask = async (id: string) => {
    try {
      await toggleCompletedMutation({ id: id as Id<'tasks'> });
    } catch (e) {
      console.error('toggleOverdueTask error:', e);
    }
  };

  const toggleTodayTask = async (id: string) => {
    try {
      await toggleCompletedMutation({ id: id as Id<'tasks'> });
    } catch (e) {
      console.error('toggleTodayTask error:', e);
    }
  };

  // ── Subtask expand/collapse + toggle ──────────────────────────────────────
  const [expandedHomeTaskIds, setExpandedHomeTaskIds] = useState<Set<string>>(
    new Set()
  );

  const toggleHomeTaskExpansion = (taskId: string) => {
    setExpandedHomeTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleHomeSubtask = async (
    taskId: string,
    subtaskId: string
  ): Promise<void> => {
    try {
      await toggleSubtaskMutation({
        id: taskId as Id<'tasks'>,
        subtaskId,
      });
    } catch (e) {
      console.error('toggleHomeSubtask error:', e);
    }
  };

  // Navigate to the task edit/details screen.
  const handleTaskPress = (id: string) => {
    openTaskSheet(id);
  };

  // ── Empty states ───────────────────────────────────────────────────────────
  const hasEventsOrTasks =
    allItems.length > 0 ||
    allDayEvents.length > 0 ||
    undatedTasks.length > 0 ||
    (isSelectedToday && overdueTasks.length > 0) ||
    selectedDayUntimedTasks.length > 0;
  const hasBirthdays = contextBirthdays.length > 0;
  // hasDayData gates the Timeline section (including the all-day strip inside it).
  // Must include all-day events so they render even when no timed events exist.
  const hasDayData = allItems.length > 0 || allDayEvents.length > 0;

  // Derived counts used by the honest empty-state logic below.
  // Include all-day events so the activity count matches what is actually shown.
  const todayCount = allItems.length + allDayEvents.length;
  const overdueCount = overdueTasks.length;
  // hasOverdueTasks is scoped to today — overdue section only renders for today.
  const hasOverdueTasks = isSelectedToday && overdueCount > 0;

  const shouldShowEventsEmptyState = !hasEventsOrTasks;
  const shouldShowBirthdaysEmptyState = !hasBirthdays;
  // TODO: בעתיד לחבר לסטטוס אמיתי של משתמש חדש מ-Convex

  // TODO: להוסיף בעתיד מסך/התראות לאירועים שנדחו כדי לאפשר חרטה
  // Stage 1D: community-event personal inclusion (creator / per-community
  // auto-add / explicit save / RSVP yes-or-maybe) is fully decided server-side
  // (see computeIsSavedToMyCalendar + listCommunityEventsForDate). An item
  // only reaches allItems when the server already decided it belongs on the
  // viewer's personal Home — including auto-add-included events where RSVP
  // happens to be "no" (RSVP and calendar inclusion are independent: "no"
  // means "not attending", not "remove from my calendar"). Filtering by
  // rsvpStatus here again would incorrectly hide those legitimately-included
  // events, so this list is no longer filtered by RSVP status.
  const visibleItems = allItems;

  // ── Insight card ───────────────────────────────────────────────────────────
  // TODO: re-enable when AI insight is ready
  // const showInsightCard = hasEventsOrTasks && dismissedInsightDate !== todayISO;
  // const insightText = allItems.length > 3
  //   ? 'יש לך יום עמוס היום, שווה לשקול להזיז משימה אחת למחר.'
  //   : 'היום שלך נראה רגוע, אולי זה זמן טוב להשלים משהו קטן מהמשימות הפתוחות.';
  const _dismissInsight = () => setDismissedInsightDate(todayISO);

  // ── Task handlers ──────────────────────────────────────────────────────────
  const toggleTask = async (id: string) => {
    const isConvexTask = todayTasks.some((t) => t.id === id);
    if (isConvexTask) {
      try {
        await toggleCompletedMutation({ id: id as Id<'tasks'> });
      } catch (e) {
        console.error('toggleTask error:', e);
        // TODO: להוסיף optimistic UI בעתיד
      }
    } else {
      // mock event – local state בלבד (עד שאירועים יחוברו ל-Convex)
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, completed: !item.completed } : item
        )
      );
    }
  };

  const handleOpenItemEvent = (item: Item) => {
    const eventId = item.taskEventId;
    if (eventId) {
      router.replace({
        pathname: '/(authenticated)/event/[id]',
        params: { id: eventId, returnTo: 'home' },
      } as never);
      return;
    }
    if (item.communityId) {
      router.replace({
        pathname: '/(authenticated)/community/[id]',
        params: { id: item.communityId },
      } as never);
      return;
    }
    Alert.alert('שגיאה', 'לא הצלחנו לפתוח את האירוע כרגע');
  };

  const confirmDelete = (item: Item) => {
    if (item.type !== 'task' || item.taskSource !== 'personal_task') {
      // Community/event-assigned tasks: open the event instead of deleting
      handleOpenItemEvent(item);
      return;
    }
    const isShared = (item.profileCircles?.length ?? 0) > 0;
    Alert.alert(
      isShared ? 'למחוק את המשימה המשותפת?' : 'למחוק את המשימה?',
      isShared
        ? 'המשימה תוסר לכל המשתתפים. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.'
        : 'המשימה תוסר. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'מחק',
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteTaskMutation({ id: item.id as Id<'tasks'> });
            } catch (error) {
              console.error('softDeleteTask error:', error);
              Alert.alert('שגיאה', 'לא הצלחנו למחוק את המשימה. נסה שוב.');
            }
          },
        },
      ]
    );
  };

  const handleCardPress = (item: Item) => {
    if (item.type === 'task') {
      openTaskSheet(item.id);
    } else if (item.linkedEventId) {
      // Linked (shared) events → navigate to read-only linked-event detail
      router.push({
        pathname: '/(authenticated)/linked-event/[id]',
        params: { id: item.linkedEventId },
      });
    } else {
      // Normal Personal + Community events → canonical Full Screen event
      // details. returnTo lets header/hardware Back restore Home
      // specifically (see event/[id].tsx).
      router.push({
        pathname: '/(authenticated)/event/[id]',
        params: { id: item.id, returnTo: 'home' },
      } as never);
    }
  };

  const handleHomeItemPress = (homeItem: HomeDailyItem): void => {
    const item = [...allItems, ...allDayTimelineItems].find(
      (candidate) => candidate.id === homeItem.id
    );
    if (item) handleCardPress(item);
  };

  const handleHomeRsvp = async (
    item: HomeDailyItem,
    status: 'yes' | 'maybe' | 'no'
  ): Promise<void> => {
    try {
      await upsertHomeRsvpMutation({
        eventId: item.id as Id<'events'>,
        status,
      });
    } catch {
      Alert.alert(
        'לא הצלחנו לשמור את התגובה',
        status === 'no'
          ? 'ייתכן שיש לך משימה פעילה באירוע. אפשר לפתוח את פרטי האירוע ולבדוק.'
          : 'אפשר לנסות שוב בעוד רגע.'
      );
    }
  };

  const handleOpenRemoteUrl = (url: string): void => {
    Linking.openURL(url).catch(() =>
      Alert.alert('שגיאה', 'לא ניתן לפתוח את הקישור.')
    );
  };

  useEffect(() => {
    const timer = setTimeout(() => setShowToast(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  const handleOpenNavPicker = (
    location: string,
    locationUrl?: string
  ): void => {
    if (!parseGeoUri(locationUrl)) return;
    setNavPickerLocation(location);
    setNavPickerLocationUrl(locationUrl ?? null);
  };

  const AVATAR_COLORS = ['#FFD1DC', '#E0F2F1', '#FFF9C4', '#E8EAF6', '#FCE4EC'];

  // iOS native RTL flips literal textAlign:'right' to the wrong side — use getTextAlign()
  const stylesRtl = useMemo(() => {
    const ta = getTextAlign();
    return StyleSheet.create(
      Object.fromEntries(
        Object.entries(styles).map(([key, style]) => {
          if (
            style &&
            typeof style === 'object' &&
            'textAlign' in style &&
            (style as TextStyle).textAlign === 'right'
          ) {
            return [key, { ...style, textAlign: ta ?? 'right' }];
          }
          return [key, style];
        })
      ) as typeof styles
    );
  }, []);

  // ── Month calendar grid ─────────────────────────────────────────────────────
  const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const monthName = today.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  });
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const calGridDays: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calGridDays.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    calGridDays.push(new Date(year, month, d));
  while (calGridDays.length % 7 !== 0) calGridDays.push(null);

  const renderMonthCalendar = () => (
    <View style={stylesRtl.monthCalendar}>
      <Text style={stylesRtl.monthName}>{monthName}</Text>
      <View style={stylesRtl.monthGrid}>
        {HEB_DAYS.map((d) => (
          <View key={d} style={stylesRtl.monthDayHeader}>
            <Text style={stylesRtl.monthDayHeaderText}>{d}</Text>
          </View>
        ))}
        {calGridDays.map((day, i) => {
          if (!day) {
            // biome-ignore lint/suspicious/noArrayIndexKey: leading calendar placeholders are static and have no data identity.
            return <View key={`e-${i}`} style={stylesRtl.monthDayCell} />;
          }
          const isSel = isSameDay(day, selectedDate);
          const isTod = isSameDay(day, today);
          return (
            <Pressable
              accessibilityLabel={`בחירת ${day.toLocaleDateString('he-IL', {
                day: 'numeric',
                month: 'long',
              })}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel }}
              accessible={true}
              key={day.toISOString()}
              style={[
                stylesRtl.monthDayCell,
                isSel && stylesRtl.monthDayCellSelected,
                !isSel && isTod && stylesRtl.monthDayCellToday,
              ]}
              onPress={() => selectDate(day)}
            >
              <Text
                style={[
                  stylesRtl.monthDayText,
                  isSel && stylesRtl.monthDayTextSelected,
                  !isSel && isTod && stylesRtl.monthDayTextToday,
                ]}
              >
                {day.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  // ── Day-state flags ────────────────────────────────────────────────────────
  // isSelectedToday is hoisted above so it's available in hasEventsOrTasks.
  // Midnight of today — used to compare dates without time
  const todayMidnight = new Date(year, month, today.getDate()).getTime();
  const isSelectedPastDay =
    !isSelectedToday && selectedDate.getTime() < todayMidnight;

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const timedItemsForSelectedDay = allItems.filter(
    (i) => !i.allDay && !!i.time
  );
  const hasFutureTimedItemsToday =
    isSelectedToday &&
    timedItemsForSelectedDay.some((i) => {
      if (i.completed) return false;
      const [h, m] = i.time.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return false;
      return h * 60 + m > nowMinutes;
    });
  // End-of-day: today, all timed items are in the past AND all are completed.
  // Incomplete timed tasks must remain visible even after their scheduled time.
  const hasIncompleteTodayTimedTasks = timedItemsForSelectedDay.some(
    (i) => !i.completed
  );
  const isEndOfDay =
    isSelectedToday &&
    timedItemsForSelectedDay.length > 0 &&
    !hasFutureTimedItemsToday &&
    !hasIncompleteTodayTimedTasks;
  // Summary mode: viewing a past day
  const isSummaryMode = isSelectedPastDay;

  // ── Derived ────────────────────────────────────────────────────────────────
  // past day → no next-event card
  // today → next future incomplete timed item
  // future day → first incomplete timed item
  const nextEvent: Item | null = (() => {
    if (isSelectedPastDay) return null;
    const timedIncomplete = allItems.filter(
      (i) => !i.allDay && !i.completed && !!i.time
    );
    if (isSelectedToday) {
      return (
        timedIncomplete.find((i) => {
          const [h, m] = i.time.split(':').map(Number);
          if (Number.isNaN(h) || Number.isNaN(m)) return false;
          const t = new Date();
          t.setHours(h, m, 0, 0);
          return t.getTime() > Date.now();
        }) ?? null
      );
    }
    return timedIncomplete[0] ?? null;
  })();

  // ── Birthday strip: filter to next 30 days only (Home Screen only) ─────────
  const thirtyDaysFromNow = new Date(
    today.getTime() + 30 * 24 * 60 * 60 * 1000
  );
  const upcomingBirthdays = contextBirthdays
    .filter((b) => getNextOccurrence(b) <= thirtyDaysFromNow)
    .sort(
      (a, b) => getNextOccurrence(a).getTime() - getNextOccurrence(b).getTime()
    );

  // Rest-of-day items: timed items shown in the "המשך היום" timeline
  const restOfDayItems = visibleItems.filter(
    (i) => !i.allDay && i.id !== nextEvent?.id
  );

  // True when today is selected, there were timed events, and all their
  // end-times have already passed → switch header to "היום שהיה"
  const allTodayEventsEnded =
    isSelectedToday &&
    timedItemsForSelectedDay.length > 0 &&
    timedItemsForSelectedDay.every((i) => {
      if (!i.endTime) return false;
      const [h, m] = i.endTime.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return false;
      return h * 60 + m < nowMinutes;
    });

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const useDailyCommandCenter = true;
  const showLegacyNextArea =
    !useDailyCommandCenter && !isSummaryMode && hasEventsOrTasks;
  const showLegacyEmptyDay =
    !useDailyCommandCenter &&
    hasEventsOrTasks &&
    !hasDayData &&
    selectedDayUntimedTasks.length === 0;
  const showLegacyOverdue =
    !useDailyCommandCenter && isSelectedToday && overdueTasks.length > 0;
  const showLegacyUndated =
    !useDailyCommandCenter && isSelectedToday && undatedTasks.length > 0;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[
        { flex: 1, backgroundColor: '#f6f7f8' },
        ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null,
      ]}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={stylesRtl.headerSurface}>
        <MainScreenHeader
          title={homeGreeting}
          subtitle={selectedDateLabel}
          variant="home"
          onNotificationsPress={handleBellPress}
          notificationsCount={unseenCount}
          returnTo="/(authenticated)"
        />
      </View>

      {/* ── Date navigation bar (sticky — outside ScrollView) ─────────────── */}
      <View style={stylesRtl.dateSectionRow}>
        {/* RTL order (row-reverse): אתמול (right) | היום | מחר | 📅 (left) */}
        <View style={stylesRtl.pillStrip}>
          <Pressable
            accessible={true}
            accessibilityLabel="אתמול"
            accessibilityRole="button"
            accessibilityState={{ selected: isSelectedYesterday }}
            onPress={() => selectDate(yesterday)}
            style={[
              stylesRtl.dayPillTab,
              isSelectedYesterday ? stylesRtl.dayPillTabActive : null,
            ]}
          >
            <Text
              style={[
                stylesRtl.dayPillText,
                isSelectedYesterday && stylesRtl.dayPillTextActive,
              ]}
            >
              אתמול
            </Text>
          </Pressable>
          <Pressable
            accessible={true}
            accessibilityLabel="היום"
            accessibilityRole="button"
            accessibilityState={{ selected: isSelectedToday }}
            onPress={() => selectDate(today)}
            style={[
              stylesRtl.dayPillTab,
              isSelectedToday ? stylesRtl.dayPillTabActive : null,
            ]}
          >
            <Text
              style={[
                stylesRtl.dayPillText,
                isSelectedToday && stylesRtl.dayPillTextActive,
              ]}
            >
              היום
            </Text>
          </Pressable>
          <Pressable
            accessible={true}
            accessibilityLabel="מחר"
            accessibilityRole="button"
            accessibilityState={{ selected: isSelectedTomorrow }}
            onPress={() => selectDate(tomorrow)}
            style={[
              stylesRtl.dayPillTab,
              isSelectedTomorrow ? stylesRtl.dayPillTabActive : null,
            ]}
          >
            <Text
              style={[
                stylesRtl.dayPillText,
                isSelectedTomorrow && stylesRtl.dayPillTextActive,
              ]}
            >
              מחר
            </Text>
          </Pressable>
          <Pressable
            accessible={true}
            accessibilityLabel={
              calendarMode === 'segmented'
                ? 'פתח לוח שנה חודשי'
                : 'חזרה לבחירת יום'
            }
            accessibilityRole="button"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() =>
              setCalendarMode((m) =>
                m === 'segmented' ? 'month' : 'segmented'
              )
            }
            style={[
              stylesRtl.calendarIconBtn,
              isCustomDate ? stylesRtl.calendarIconBtnActive : null,
            ]}
          >
            <MaterialIcons
              color={isCustomDate ? tc.primary : tc.textSecondary}
              name={
                calendarMode === 'segmented' ? 'calendar-month' : 'view-week'
              }
              size={20}
            />
          </Pressable>
        </View>
      </View>

      {calendarMode === 'month' ? (
        <View
          style={{
            paddingHorizontal: 16,
            marginBottom: 8,
            backgroundColor: '#f6f7f8',
          }}
        >
          {renderMonthCalendar()}
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {(todayCount + selectedDayUntimedTasks.length > 0 ||
          hasOverdueTasks) && (
          <Text style={stylesRtl.subtitleCount}>
            {isSummaryMode
              ? `${todayCount} פעילויות ביום זה`
              : hasOverdueTasks && todayCount === 0
                ? overdueCount === 1
                  ? 'יש לך משימה אחת ממתינה'
                  : `יש לך ${overdueCount} משימות ממתינות`
                : `${todayCount + selectedDayUntimedTasks.length} דברים מתוכננים ${
                    isSelectedToday
                      ? 'להיום'
                      : isSelectedPastDay
                        ? 'ביום הזה'
                        : 'לתאריך הזה'
                  }`}
          </Text>
        )}

        {useDailyCommandCenter && (
          <HomeDailyCommandCenter
            allDayItems={allDayTimelineItems}
            birthdays={upcomingBirthdays}
            completedTodayTasksAllSources={completedTodayTasksAllSources}
            hasAnyBirthdays={hasBirthdays}
            myImportantItemsBundleStatus={myImportantItemsBundleStatus ?? {}}
            nowMs={nowMs}
            onAddBirthday={openBirthdayAddChoice}
            onNavigate={handleOpenNavPicker}
            onOpenBirthday={openBirthdayCard}
            onOpenBirthdays={() => router.push('/birthdays')}
            onOpenItem={handleHomeItemPress}
            onOpenRemoteUrl={handleOpenRemoteUrl}
            onOpenTask={handleTaskPress}
            onOpenTasks={() => router.push('/(authenticated)/tasks')}
            onRsvp={handleHomeRsvp}
            onToggleTask={(taskId) => {
              void toggleCompletedMutation({
                id: taskId as Id<'tasks'>,
              }).catch(() =>
                Alert.alert('שגיאה', 'לא הצלחנו לעדכן את המשימה.')
              );
            }}
            overdueTasks={overdueTasks}
            scheduledItems={allItems}
            selectedDate={selectedDate}
            undatedTaskCount={
              undatedTasks.filter((task) => !task.completed).length
            }
            undatedTasks={undatedTasks}
            untimedTasks={selectedDayUntimedTasks}
          />
        )}
        {/* ── Empty state — no events or tasks ─────────────────────────────── */}
        {!useDailyCommandCenter && shouldShowEventsEmptyState && (
          <View style={stylesRtl.emptyStateContainer}>
            <View style={stylesRtl.emptyStateIconWrap}>
              <MaterialIcons name="calendar-today" size={36} color="#36a9e2" />
            </View>
            <Text style={stylesRtl.emptyStateTitle}>
              עדיין לא הוספת אירועים או משימות
            </Text>
            <Text style={stylesRtl.emptyStateSubtitle}>
              התחילי בהוספת אירוע ראשון או ייבוא יומן קיים.
            </Text>
            <Pressable
              style={stylesRtl.emptyStatePrimaryBtn}
              onPress={() => router.push('/(authenticated)/import-calendar')}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="ייבוא מיומן גוגל או אפל"
            >
              <Text style={stylesRtl.emptyStatePrimaryBtnText}>
                ייבוא מיומן גוגל / אפל
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                /* TODO: פתח flow יצירת אירוע */
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="הוספת אירוע ראשון"
            >
              <Text style={stylesRtl.emptyStateSecondaryBtnText}>
                הוספת אירוע ראשון
              </Text>
            </Pressable>
            <Text style={stylesRtl.emptyStateHint}>
              אפשר גם ללחוץ על הפלוס במרכז המסך כדי ליצור אירוע, משימה, יום
              הולדת או קבוצה.
            </Text>
          </View>
        )}

        {/* ── Summary mode: calm section label for past days ───────────────── */}
        {!useDailyCommandCenter && isSummaryMode && hasDayData && (
          <View
            style={{ paddingHorizontal: 24, marginBottom: 8, marginTop: 4 }}
          >
            <Text style={stylesRtl.summaryTitle}>סיכום יום</Text>
          </View>
        )}

        {/* ── Next event area — state-aware ─────────────────────────────────── */}

        {/* Normal next-event card: today or future day with a valid next item */}
        {showLegacyNextArea && nextEvent && (
          <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <Pressable
              onPress={() => handleCardPress(nextEvent)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`פרטי אירוע: ${nextEvent.title}`}
            >
              <View
                style={[
                  stylesRtl.cardShadow,
                  stylesRtl.eventCard,
                  nextEvent.myAssignedTasks &&
                    nextEvent.myAssignedTasks.length > 0 &&
                    stylesRtl.nextEventCardWithTasks,
                ]}
              >
                <View style={stylesRtl.eventAccentBar} />
                <View style={{ padding: 24, ...spacing.paddingStart(32) }}>
                  {/* Top row: "הפעילות הבאה" pill (right) + relative start time (left) */}
                  <View style={stylesRtl.eventTopRow}>
                    <View style={stylesRtl.eventNextPill}>
                      <Text style={stylesRtl.eventNextPillText}>
                        הפעילות הבאה
                      </Text>
                    </View>
                    {/* Relative time — shown whenever start is in the future */}
                    {(() => {
                      if (!nextEvent.time) return null;
                      const [h, m] = nextEvent.time.split(':').map(Number);
                      if (Number.isNaN(h) || Number.isNaN(m)) return null;
                      const eventDate = new Date();
                      eventDate.setHours(h, m, 0, 0);
                      const diffMins = Math.round(
                        (eventDate.getTime() - Date.now()) / 60000
                      );
                      if (diffMins <= 0) return null;
                      return (
                        <Text
                          style={{
                            color: '#94a3b8',
                            fontSize: 12,
                            fontWeight: '600',
                          }}
                        >
                          {formatRelativeStartTime(diffMins)}
                        </Text>
                      );
                    })()}
                  </View>

                  {nextEvent.communityId && nextEvent.groupName ? (
                    <View style={{ marginBottom: 8 }}>
                      <CommunityEventNameTag name={nextEvent.groupName} />
                    </View>
                  ) : null}

                  {/* Title row — includes assignee chip for task items */}
                  <View
                    style={{
                      flexDirection: 'row-reverse',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      style={[
                        stylesRtl.eventTitle,
                        { marginBottom: 0, flex: 1 },
                      ]}
                    >
                      {nextEvent.title}
                    </Text>
                    {nextEvent.type === 'task' &&
                    (nextEvent.assigneeDisplays?.length ?? 0) > 0 ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginLeft: 8,
                        }}
                      >
                        {(nextEvent.assigneeDisplays ?? [])
                          .slice(0, 3)
                          .map((d, i) => (
                            <View
                              key={`${d.initials}:${d.color}`}
                              style={[
                                stylesRtl.assigneeCircle,
                                {
                                  backgroundColor: d.color,
                                  marginLeft: i === 0 ? 0 : -6,
                                  zIndex: 3 - i,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  fontSize: 9,
                                  color: '#fff',
                                  fontWeight: '700',
                                  textAlign: 'center',
                                  includeFontPadding: false,
                                }}
                              >
                                {d.initials}
                              </Text>
                            </View>
                          ))}
                      </View>
                    ) : null}
                  </View>

                  {/* Time range */}
                  <Text
                    style={{
                      color: '#36a9e2',
                      fontSize: 22,
                      fontWeight: '700',
                      textAlign: getTextAlign(),
                      marginBottom: 8,
                    }}
                  >
                    {nextEvent.endTime
                      ? `${nextEvent.time} – ${nextEvent.endTime}`
                      : nextEvent.time}
                  </Text>

                  {/* Address row: only rendered when a location exists */}
                  {nextEvent.location ? (
                    <View style={stylesRtl.eventAddressRow}>
                      <View style={stylesRtl.eventAddressGroup}>
                        {/* Icon first = physical rightmost (rtl.flexDirection = physical row-reverse) */}
                        <MaterialIcons
                          name="location-on"
                          size={16}
                          color="#94a3b8"
                        />
                        <Text style={stylesRtl.eventAddress} numberOfLines={1}>
                          {nextEvent.location}
                        </Text>
                      </View>
                      {parseGeoUri(nextEvent.locationUrl) ? (
                        <Pressable
                          style={stylesRtl.navBtn}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            handleOpenNavPicker(
                              nextEvent.location,
                              nextEvent.locationUrl
                            );
                          }}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel="נווט"
                        >
                          <MaterialIcons
                            name="near-me"
                            size={16}
                            color="#8d6e63"
                          />
                          <Text style={stylesRtl.navBtnText}>נווט</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {/* Profile circles — "משותף עם" for personal, "גם הוסיפו ליומן" for community */}
                  {nextEvent.type === 'event' &&
                  ((nextEvent.profileCircles &&
                    nextEvent.profileCircles.length > 0) ||
                    (nextEvent.profileCirclesExtraCount ?? 0) > 0) ? (
                    <View
                      style={{
                        flexDirection: 'row-reverse',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 8,
                      }}
                    >
                      <ProfileCircles
                        profiles={nextEvent.profileCircles ?? []}
                        extraCount={nextEvent.profileCirclesExtraCount}
                        context={
                          nextEvent.profileCirclesContext ?? 'sharedWith'
                        }
                      />
                    </View>
                  ) : null}
                  {/* TODO: wire real traffic data here */}
                </View>
              </View>
            </Pressable>
            {nextEvent.myAssignedTasks &&
            nextEvent.myAssignedTasks.length > 0 ? (
              <View style={stylesRtl.nextEventTaskExpansionContainer}>
                <InlineEventTasksSection tasks={nextEvent.myAssignedTasks} />
              </View>
            ) : null}
            {nextEvent.importantItems && nextEvent.importantItems.length > 0 ? (
              <View style={stylesRtl.nextEventTaskExpansionContainer}>
                <InlineImportantItemsSection items={nextEvent.importantItems} />
              </View>
            ) : null}
            {nextEvent.type === 'task' &&
            (nextEvent.subtasks?.length ?? 0) > 0 &&
            !nextEvent.completed ? (
              <View style={stylesRtl.nextEventTaskExpansionContainer}>
                <HomeSubtaskSection
                  taskId={nextEvent.id}
                  subtasks={nextEvent.subtasks ?? []}
                  isExpanded={expandedHomeTaskIds.has(nextEvent.id)}
                  onToggleExpansion={() =>
                    toggleHomeTaskExpansion(nextEvent.id)
                  }
                  onToggleSubtask={(subtaskId) =>
                    toggleHomeSubtask(nextEvent.id, subtaskId)
                  }
                />
              </View>
            ) : null}
          </View>
        )}

        {/* End-of-day fallback: today, had timed items, none are future */}
        {!useDailyCommandCenter && isEndOfDay && !nextEvent && (
          <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <View style={[stylesRtl.cardShadow, stylesRtl.endOfDayCard]}>
              <Text style={stylesRtl.endOfDayTitle}>
                אין לך עוד משימות ואירועים להיום
              </Text>
              <Text style={stylesRtl.endOfDaySubtitle}>
                אפשר לסגור את היום בנחת או לעבור למה שמחכה מחר
              </Text>
              <Pressable
                onPress={() => {
                  selectDate(tomorrow);
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="מה יש מחר"
              >
                <Text style={stylesRtl.endOfDayCta}>מה יש מחר ←</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Empty day state (data exists but not for this day) ───────────── */}
        {showLegacyEmptyDay &&
          hasEventsOrTasks &&
          !hasDayData &&
          selectedDayUntimedTasks.length === 0 && (
            <View style={stylesRtl.emptyDayContainer}>
              <MaterialIcons name="calendar-today" size={28} color="#d1d5db" />
              {hasOverdueTasks ? (
                <>
                  <Text style={stylesRtl.emptyDayTitle}>אין אירועים היום</Text>
                  <Text style={stylesRtl.emptyDaySubtitle}>
                    {overdueCount === 1
                      ? 'יש משימה אחת שעדיין מחכה לך'
                      : `יש ${overdueCount} משימות שעדיין מחכות לך`}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={stylesRtl.emptyDayTitle}>
                    {emptyDayCopy.title}
                  </Text>
                  <Text style={stylesRtl.emptyDaySubtitle}>
                    {emptyDayCopy.subtitle}
                  </Text>
                </>
              )}
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/(authenticated)/event/new',
                    params: { selectedDate: String(selectedDate.getTime()) },
                  } as Parameters<typeof router.push>[0])
                }
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="הוספת אירוע"
              >
                <Text style={stylesRtl.emptyDayLink}>+ הוספת אירוע</Text>
              </Pressable>
            </View>
          )}

        {/* ── Birthdays — hidden in summary/past-day mode ───────────────────── */}
        {!useDailyCommandCenter && !isSummaryMode && (
          <View style={{ marginBottom: 32 }}>
            <View style={stylesRtl.sectionHeader}>
              <Text style={stylesRtl.sectionTitle}>🎂 ימי הולדת קרובים</Text>
              {!shouldShowBirthdaysEmptyState && (
                <Pressable onPress={() => router.push('/birthdays')}>
                  <Text style={stylesRtl.seeAll}>ראה הכל</Text>
                </Pressable>
              )}
            </View>

            {shouldShowBirthdaysEmptyState ? (
              <View
                style={{
                  marginHorizontal: 24,
                  backgroundColor: '#fff',
                  borderRadius: 16,
                  padding: 20,
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 4,
                  elevation: 1,
                }}
              >
                <MaterialIcons
                  name="cake"
                  size={28}
                  color="#d1d5db"
                  style={{ marginBottom: 8 }}
                />
                <Text
                  style={{
                    fontSize: 14,
                    color: '#6b7280',
                    textAlign: 'center',
                    marginBottom: 12,
                  }}
                >
                  עוד לא הוספת ימי הולדת.
                </Text>
                <Pressable
                  onPress={openBirthdayAddChoice}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="הוספת יום הולדת ראשון"
                >
                  <Text
                    style={{
                      color: '#36a9e2',
                      fontSize: 14,
                      fontWeight: '700',
                    }}
                  >
                    + הוספת יום הולדת ראשון
                  </Text>
                </Pressable>
              </View>
            ) : upcomingBirthdays.length === 0 ? (
              <View
                style={{
                  marginHorizontal: 24,
                  paddingVertical: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    textAlign: getTextAlign(),
                  }}
                >
                  אין ימי הולדת ב-30 הימים הקרובים
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingRight: 24,
                  paddingLeft: 8,
                  flexDirection: 'row-reverse',
                  gap: 12,
                }}
              >
                {upcomingBirthdays.map((b, idx) => (
                  <Pressable
                    key={b.id}
                    onPress={() => openBirthdayCard(b)}
                    style={stylesRtl.birthdayCard}
                  >
                    <View
                      style={[
                        stylesRtl.birthdayAvatar,
                        {
                          backgroundColor:
                            AVATAR_COLORS[idx % AVATAR_COLORS.length],
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={stylesRtl.birthdayCountdown}>
                        {getCountdownLabel(b)}:
                      </Text>
                      <Text style={stylesRtl.birthdayName}>{b.name}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* ── Timeline ───────────────────────────────────────────────────────── */}
        {!useDailyCommandCenter && hasDayData && (
          <>
            {!isSummaryMode && !isEndOfDay && (
              <View style={stylesRtl.sectionHeader}>
                <Text style={stylesRtl.timelineTitle}>
                  {allTodayEventsEnded ? 'היום שהיה' : 'המשך היום'}
                </Text>
              </View>
            )}

            {/* All-day events */}
            {allDayEvents.length > 0 && (
              <View style={{ paddingHorizontal: 24, marginBottom: 8 }}>
                <Text style={stylesRtl.allDayLabel}>
                  אירועים/משימות של כל היום
                </Text>
                {allDayEvents.map((ev) => (
                  <Pressable
                    key={ev.id}
                    style={stylesRtl.allDayCard}
                    onPress={() =>
                      // Route through the same handler as ordinary event-card
                      // taps so linked (shared) all-day events correctly open
                      // linked-event/[id] instead of the legacy event sheet.
                      handleCardPress({
                        id: ev.id,
                        time: '00:00',
                        title: ev.title,
                        location: '',
                        type: 'event',
                        icon: 'event',
                        iconBg: '#E8F5FD',
                        iconColor: ev.iconColor,
                        assigneeColor: ev.iconColor,
                        completed: false,
                        allDay: true,
                        groupName: ev.groupName,
                        communityId: ev.communityId,
                        isRecurring: ev.isRecurring,
                        recurringPattern: ev.recurringPattern,
                        reminders: ev.reminders,
                        linkedEventId: ev.linkedEventId,
                      })
                    }
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={ev.title}
                  >
                    <View
                      style={[
                        stylesRtl.allDayAccent,
                        { backgroundColor: ev.iconColor },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      {ev.communityId && ev.groupName ? (
                        <View style={{ marginBottom: 6 }}>
                          <CommunityEventNameTag name={ev.groupName} />
                        </View>
                      ) : null}
                      <Text style={stylesRtl.allDayTitle}>{ev.title}</Text>
                      {ev.groupName && !ev.communityId ? (
                        <View style={stylesRtl.groupRow}>
                          <MaterialIcons
                            name="group"
                            size={12}
                            color="#64748b"
                          />
                          <Text style={stylesRtl.groupText}>
                            {ev.groupName}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Timeline — branched: summary-mode compact cards vs active-day timeline */}
            {isSummaryMode ? (
              /* ── Summary-mode: compact recap cards, fully interactive ── */
              <View style={{ paddingHorizontal: 24, paddingBottom: 8, gap: 8 }}>
                {visibleItems
                  .filter((i) => !i.allDay)
                  .map((item) => (
                    <Swipeable
                      key={item.id}
                      renderRightActions={() => {
                        if (item.type !== 'task') return null;
                        if (item.taskSource === 'event_task') {
                          return (
                            <Pressable
                              style={stylesRtl.openEventAction}
                              onPress={() => handleOpenItemEvent(item)}
                              accessible={true}
                              accessibilityRole="button"
                              accessibilityLabel="פתיחה באירוע"
                            >
                              <MaterialIcons
                                name="open-in-new"
                                size={22}
                                color="white"
                              />
                              <Text style={stylesRtl.swipeActionLabel}>
                                פתח אירוע
                              </Text>
                            </Pressable>
                          );
                        }
                        return (
                          <Pressable
                            style={stylesRtl.deleteAction}
                            onPress={() => confirmDelete(item)}
                            accessible={true}
                            accessibilityRole="button"
                            accessibilityLabel="מחיקת משימה"
                          >
                            <MaterialIcons
                              name="delete-outline"
                              size={26}
                              color="white"
                            />
                          </Pressable>
                        );
                      }}
                    >
                      <Pressable
                        onPress={() => handleCardPress(item)}
                        style={[
                          stylesRtl.summaryCard,
                          item.completed && stylesRtl.summaryCardMuted,
                        ]}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel={item.title}
                      >
                        <View
                          style={[
                            stylesRtl.timelineAccent,
                            {
                              backgroundColor: item.completed
                                ? '#d1d5db'
                                : item.iconColor,
                            },
                          ]}
                        />
                        <View
                          style={{
                            flexDirection: 'row-reverse',
                            alignItems: 'flex-start',
                            gap: 10,
                            flex: 1,
                          }}
                        >
                          {item.type === 'task' && (
                            <TaskCheckbox
                              checked={item.completed}
                              onToggle={() => toggleTask(item.id)}
                            />
                          )}
                          <View style={{ flex: 1 }}>
                            {item.time ? (
                              <Text style={stylesRtl.summaryCardTime}>
                                {item.time}
                                {item.endTime ? ` – ${item.endTime}` : ''}
                              </Text>
                            ) : null}
                            {item.communityId && item.groupName ? (
                              <View style={{ marginBottom: 6, marginTop: 2 }}>
                                <CommunityEventNameTag name={item.groupName} />
                              </View>
                            ) : null}
                            {/* Title + assignee circles (tasks) / profile circles (events) */}
                            <View
                              style={{
                                flexDirection: 'row-reverse',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <Text
                                style={[
                                  stylesRtl.taskTitle,
                                  item.completed && stylesRtl.completedText,
                                ]}
                              >
                                {item.title}
                              </Text>
                              {(item.assigneeDisplays?.length ?? 0) > 0 ? (
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                  }}
                                >
                                  {(item.assigneeDisplays ?? [])
                                    .slice(0, 3)
                                    .map((d, i) => (
                                      <View
                                        key={`${d.initials}:${d.color}`}
                                        style={[
                                          stylesRtl.assigneeCircle,
                                          {
                                            backgroundColor: d.color,
                                            marginLeft: i === 0 ? 0 : -6,
                                            zIndex: 3 - i,
                                          },
                                        ]}
                                      >
                                        <Text
                                          style={{
                                            fontSize: 9,
                                            color: '#fff',
                                            fontWeight: '700',
                                          }}
                                        >
                                          {d.initials}
                                        </Text>
                                      </View>
                                    ))}
                                </View>
                              ) : item.type === 'event' &&
                                ((item.profileCircles?.length ?? 0) > 0 ||
                                  (item.profileCirclesExtraCount ?? 0) > 0) ? (
                                <ProfileCircles
                                  profiles={item.profileCircles ?? []}
                                  extraCount={item.profileCirclesExtraCount}
                                  context={
                                    item.profileCirclesContext ?? 'sharedWith'
                                  }
                                  size={22}
                                />
                              ) : null}
                            </View>
                            {/* Personal invite RSVP status badge */}
                            {item.pendingPersonalInvite ? (
                              item.groupName === 'בוטל' ? (
                                <View
                                  style={[
                                    stylesRtl.pendingBadge,
                                    {
                                      backgroundColor: '#f3f4f6',
                                      marginTop: 4,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      stylesRtl.pendingBadgeText,
                                      { color: '#6b7280' },
                                    ]}
                                  >
                                    בוטל
                                  </Text>
                                </View>
                              ) : item.myPersonalRsvpStatus === 'no' ? (
                                <View
                                  style={[
                                    stylesRtl.pendingBadge,
                                    {
                                      backgroundColor: '#f3f4f6',
                                      marginTop: 4,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      stylesRtl.pendingBadgeText,
                                      { color: '#6b7280' },
                                    ]}
                                  >
                                    לא מגיע/ה
                                  </Text>
                                </View>
                              ) : item.myPersonalRsvpStatus === 'maybe' ? (
                                <View
                                  style={[
                                    stylesRtl.pendingBadge,
                                    {
                                      backgroundColor: '#fef9c3',
                                      marginTop: 4,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      stylesRtl.pendingBadgeText,
                                      { color: '#854d0e' },
                                    ]}
                                  >
                                    אולי
                                  </Text>
                                </View>
                              ) : (
                                <View
                                  style={[
                                    stylesRtl.pendingBadge,
                                    { marginTop: 4 },
                                  ]}
                                >
                                  <Text style={stylesRtl.pendingBadgeText}>
                                    ממתין לאישור
                                  </Text>
                                </View>
                              )
                            ) : null}
                            {item.location ? (
                              <Text style={stylesRtl.itemLocation}>
                                {item.location}
                              </Text>
                            ) : null}
                            {item.groupName &&
                            !item.communityId &&
                            !item.pendingPersonalInvite ? (
                              <View style={stylesRtl.groupRow}>
                                <MaterialIcons
                                  name="group"
                                  size={12}
                                  color="#64748b"
                                />
                                <Text style={stylesRtl.groupText}>
                                  {item.groupName}
                                </Text>
                              </View>
                            ) : null}
                            {/* Nav button — warm brown, same as active-day */}
                            {item.location && parseGeoUri(item.locationUrl) ? (
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  handleOpenNavPicker(
                                    item.location,
                                    item.locationUrl
                                  );
                                }}
                                style={{
                                  alignSelf: 'flex-start',
                                  marginTop: 6,
                                  backgroundColor: 'rgba(141,110,99,0.1)',
                                  borderRadius: 12,
                                  paddingHorizontal: 10,
                                  paddingVertical: 4,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                                accessible={true}
                                accessibilityRole="button"
                                accessibilityLabel="נווט"
                              >
                                <MaterialIcons
                                  name="near-me"
                                  size={13}
                                  color="#8d6e63"
                                />
                                <Text
                                  style={{
                                    color: '#8d6e63',
                                    fontSize: 12,
                                    fontWeight: '700',
                                  }}
                                >
                                  נווט
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      </Pressable>
                      {item.myAssignedTasks &&
                      item.myAssignedTasks.length > 0 ? (
                        <View style={stylesRtl.taskExpansionContainer}>
                          <InlineEventTasksSection
                            tasks={item.myAssignedTasks}
                          />
                        </View>
                      ) : null}
                      {item.importantItems && item.importantItems.length > 0 ? (
                        <View style={stylesRtl.taskExpansionContainer}>
                          <InlineImportantItemsSection
                            items={item.importantItems}
                          />
                        </View>
                      ) : null}
                      {item.type === 'task' &&
                      (item.subtasks?.length ?? 0) > 0 &&
                      !item.completed ? (
                        <View style={stylesRtl.taskExpansionContainer}>
                          <HomeSubtaskSection
                            taskId={item.id}
                            subtasks={item.subtasks ?? []}
                            isExpanded={expandedHomeTaskIds.has(item.id)}
                            onToggleExpansion={() =>
                              toggleHomeTaskExpansion(item.id)
                            }
                            onToggleSubtask={(subtaskId) =>
                              toggleHomeSubtask(item.id, subtaskId)
                            }
                          />
                        </View>
                      ) : null}
                    </Swipeable>
                  ))}
              </View>
            ) : !isEndOfDay ? (
              /* ── Active-day timeline with time column + swipe ── */
              <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
                {restOfDayItems.length === 0 && (
                  <View
                    style={{
                      paddingVertical: 16,
                      alignItems: 'flex-end',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        color: '#6b7280',
                        textAlign: getTextAlign(),
                        marginBottom: 12,
                      }}
                    >
                      אין אירועים נוספים בהמשך
                    </Text>
                    <View
                      style={{
                        flexDirection: rtl.flexDirection,
                        gap: 16,
                      }}
                    >
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/(authenticated)/event/new',
                            params: {
                              selectedDate: String(selectedDate.getTime()),
                            },
                          } as Parameters<typeof router.push>[0])
                        }
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="הוספת אירוע"
                      >
                        <Text style={stylesRtl.emptyDayLink}>
                          + הוספת אירוע
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          router.push('/(authenticated)/task/new' as never)
                        }
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="הוספת משימה"
                      >
                        <Text style={stylesRtl.emptyDayLink}>
                          + הוספת משימה
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                {restOfDayItems.map((item) => (
                  <Swipeable
                    key={item.id}
                    renderRightActions={() => {
                      if (item.type !== 'task') return null;
                      if (item.taskSource === 'event_task') {
                        return (
                          <Pressable
                            style={stylesRtl.openEventAction}
                            onPress={() => handleOpenItemEvent(item)}
                            accessible={true}
                            accessibilityRole="button"
                            accessibilityLabel="פתיחה באירוע"
                          >
                            <MaterialIcons
                              name="open-in-new"
                              size={22}
                              color="white"
                            />
                            <Text style={stylesRtl.swipeActionLabel}>
                              פתח אירוע
                            </Text>
                          </Pressable>
                        );
                      }
                      return (
                        <Pressable
                          style={stylesRtl.deleteAction}
                          onPress={() => confirmDelete(item)}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel="מחיקת משימה"
                        >
                          <MaterialIcons
                            name="delete-outline"
                            size={26}
                            color="white"
                          />
                        </Pressable>
                      );
                    }}
                  >
                    <View
                      style={{
                        flexDirection: rtl.flexDirection,
                        gap: 16,
                        marginBottom: 4,
                      }}
                    >
                      {/* Time column */}
                      <View style={stylesRtl.timeColumn}>
                        <Text style={stylesRtl.timeText}>{item.time}</Text>
                        {item.endTime && (
                          <Text
                            style={{
                              fontSize: 10,
                              color: '#cbd5e1',
                              textAlign: 'center',
                              marginTop: 1,
                            }}
                          >
                            {item.endTime}
                          </Text>
                        )}
                      </View>

                      {/* Card */}
                      <View style={{ flex: 1, marginBottom: 12 }}>
                        <Pressable onPress={() => handleCardPress(item)}>
                          <View
                            style={[
                              stylesRtl.timelineCard,
                              item.myAssignedTasks &&
                                item.myAssignedTasks.length > 0 &&
                                stylesRtl.timelineCardWithTasks,
                            ]}
                          >
                            <View
                              style={[
                                stylesRtl.timelineAccent,
                                { backgroundColor: item.iconColor },
                              ]}
                            />
                            <View
                              style={{
                                flexDirection: rtl.flexDirection,
                                alignItems: 'flex-start',
                                gap: 10,
                                flex: 1,
                              }}
                            >
                              {item.type === 'task' && (
                                <TaskCheckbox
                                  checked={item.completed}
                                  onToggle={() => toggleTask(item.id)}
                                />
                              )}
                              <View style={{ flex: 1 }}>
                                {item.communityId && item.groupName ? (
                                  <View style={{ marginBottom: 6 }}>
                                    <CommunityEventNameTag
                                      name={item.groupName}
                                    />
                                  </View>
                                ) : null}
                                {/* Title row: title + assignee circles (tasks) / profile circles (events) */}
                                <View
                                  style={{
                                    flexDirection: rtl.flexDirection,
                                    alignItems: 'center',
                                    gap: 6,
                                  }}
                                >
                                  <Text
                                    style={[
                                      stylesRtl.taskTitle,
                                      item.completed && stylesRtl.completedText,
                                    ]}
                                  >
                                    {item.title}
                                  </Text>
                                  {(item.assigneeDisplays?.length ?? 0) > 0 ? (
                                    <View
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                      }}
                                    >
                                      {(item.assigneeDisplays ?? [])
                                        .slice(0, 3)
                                        .map((d, i) => (
                                          <View
                                            key={`${d.initials}:${d.color}`}
                                            style={[
                                              stylesRtl.assigneeCircle,
                                              {
                                                backgroundColor: d.color,
                                                marginLeft: i === 0 ? 0 : -6,
                                                zIndex: 3 - i,
                                              },
                                            ]}
                                          >
                                            <Text
                                              style={{
                                                fontSize: 9,
                                                color: '#fff',
                                                fontWeight: '700',
                                              }}
                                            >
                                              {d.initials}
                                            </Text>
                                          </View>
                                        ))}
                                    </View>
                                  ) : item.type === 'event' &&
                                    ((item.profileCircles?.length ?? 0) > 0 ||
                                      (item.profileCirclesExtraCount ?? 0) >
                                        0) ? (
                                    <ProfileCircles
                                      profiles={item.profileCircles ?? []}
                                      extraCount={item.profileCirclesExtraCount}
                                      context={
                                        item.profileCirclesContext ??
                                        'sharedWith'
                                      }
                                      size={22}
                                    />
                                  ) : null}
                                </View>

                                {/* RSVP inline chips */}
                                {openRsvpForId === item.id && (
                                  <View
                                    style={{
                                      flexDirection: 'row-reverse',
                                      gap: 8,
                                      marginTop: 10,
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    {(
                                      [
                                        {
                                          key: 'yes',
                                          label: 'כן',
                                          activeBg: '#e0f2fe',
                                          activeColor: '#0369a1',
                                        },
                                        {
                                          key: 'maybe',
                                          label: 'אולי',
                                          activeBg: '#fef9c3',
                                          activeColor: '#854d0e',
                                        },
                                        {
                                          key: 'no',
                                          label: 'לא',
                                          activeBg: '#fee2e2',
                                          activeColor: '#991b1b',
                                        },
                                      ] as const
                                    ).map((opt) => {
                                      const isSelected =
                                        item.rsvpStatus === opt.key;
                                      return (
                                        <Pressable
                                          key={opt.key}
                                          onPress={() => {
                                            // TODO: לסנכרן עם Convex בעתיד
                                            setItems((prev) =>
                                              prev.map((i) =>
                                                i.id === item.id
                                                  ? {
                                                      ...i,
                                                      rsvpStatus: opt.key,
                                                    }
                                                  : i
                                              )
                                            );
                                            setOpenRsvpForId(null);
                                          }}
                                          style={{
                                            backgroundColor: isSelected
                                              ? opt.activeBg
                                              : '#fff',
                                            borderRadius: 20,
                                            paddingHorizontal: 16,
                                            paddingVertical: 6,
                                            borderWidth: 1,
                                            borderColor: isSelected
                                              ? 'transparent'
                                              : '#e5e7eb',
                                          }}
                                          accessible={true}
                                          accessibilityRole="button"
                                          accessibilityLabel={opt.label}
                                        >
                                          <Text
                                            style={{
                                              color: isSelected
                                                ? opt.activeColor
                                                : '#6b7280',
                                              fontWeight: isSelected
                                                ? '700'
                                                : '500',
                                              fontSize: 14,
                                            }}
                                          >
                                            {opt.label}
                                          </Text>
                                        </Pressable>
                                      );
                                    })}
                                  </View>
                                )}

                                {/* Metadata row: location/group on right, badge on left */}
                                {(item.location ||
                                  (item.groupName &&
                                    !item.communityId &&
                                    !item.pendingPersonalInvite) ||
                                  item.personalTaskSummary ||
                                  item.pending ||
                                  item.pendingPersonalInvite) && (
                                  <View
                                    style={{
                                      flexDirection: rtl.flexDirection,
                                      justifyContent: 'space-between',
                                      alignItems: 'flex-start',
                                      marginTop: 4,
                                    }}
                                  >
                                    {/* Right: location, group, task summary */}
                                    <View style={{ flex: 1 }}>
                                      {item.location ? (
                                        <Text style={stylesRtl.itemLocation}>
                                          {item.location}
                                        </Text>
                                      ) : null}
                                      {item.groupName &&
                                      !item.communityId &&
                                      !item.pendingPersonalInvite ? (
                                        <View style={stylesRtl.groupRow}>
                                          <MaterialIcons
                                            name="group"
                                            size={12}
                                            color="#64748b"
                                          />
                                          <Text style={stylesRtl.groupText}>
                                            {item.groupName}
                                          </Text>
                                        </View>
                                      ) : null}
                                      {item.personalTaskSummary ? (
                                        <Text
                                          style={stylesRtl.personalTaskSummary}
                                        >
                                          {item.personalTaskSummary}
                                        </Text>
                                      ) : null}
                                    </View>

                                    {/* Left: personal invite RSVP badge (display-only) */}
                                    {item.pendingPersonalInvite && (
                                      <View
                                        style={{
                                          marginLeft: 8,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {item.groupName === 'בוטל' ? (
                                          <View
                                            style={[
                                              stylesRtl.pendingBadge,
                                              { backgroundColor: '#f3f4f6' },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                stylesRtl.pendingBadgeText,
                                                { color: '#6b7280' },
                                              ]}
                                            >
                                              בוטל
                                            </Text>
                                          </View>
                                        ) : item.myPersonalRsvpStatus ===
                                          'no' ? (
                                          <View
                                            style={[
                                              stylesRtl.pendingBadge,
                                              { backgroundColor: '#f3f4f6' },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                stylesRtl.pendingBadgeText,
                                                { color: '#6b7280' },
                                              ]}
                                            >
                                              לא מגיע/ה
                                            </Text>
                                          </View>
                                        ) : item.myPersonalRsvpStatus ===
                                          'maybe' ? (
                                          <View
                                            style={[
                                              stylesRtl.pendingBadge,
                                              { backgroundColor: '#fef9c3' },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                stylesRtl.pendingBadgeText,
                                                { color: '#854d0e' },
                                              ]}
                                            >
                                              אולי
                                            </Text>
                                          </View>
                                        ) : (
                                          <View style={stylesRtl.pendingBadge}>
                                            <Text
                                              style={stylesRtl.pendingBadgeText}
                                            >
                                              ממתין לאישור
                                            </Text>
                                          </View>
                                        )}
                                      </View>
                                    )}
                                    {/* Left: pending badge — tapping opens RSVP chips */}
                                    {item.pending && (
                                      <Pressable
                                        onPress={(e) => {
                                          e.stopPropagation?.();
                                          setOpenRsvpForId((prev) =>
                                            prev === item.id ? null : item.id
                                          );
                                        }}
                                        hitSlop={{
                                          top: 8,
                                          bottom: 8,
                                          left: 8,
                                          right: 8,
                                        }}
                                        accessible={true}
                                        accessibilityRole="button"
                                        accessibilityLabel="סטטוס אישור"
                                        style={{
                                          marginLeft: 8,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {(!item.rsvpStatus ||
                                          item.rsvpStatus === 'none') && (
                                          <View style={stylesRtl.pendingBadge}>
                                            <Text
                                              style={stylesRtl.pendingBadgeText}
                                            >
                                              ממתין לאישור
                                            </Text>
                                          </View>
                                        )}
                                        {item.rsvpStatus === 'yes' && (
                                          <View
                                            style={[
                                              stylesRtl.pendingBadge,
                                              { backgroundColor: '#dcfce7' },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                stylesRtl.pendingBadgeText,
                                                { color: '#166534' },
                                              ]}
                                            >
                                              ✓ מאושר
                                            </Text>
                                          </View>
                                        )}
                                        {item.rsvpStatus === 'maybe' && (
                                          <View
                                            style={[
                                              stylesRtl.pendingBadge,
                                              { backgroundColor: '#fef9c3' },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                stylesRtl.pendingBadgeText,
                                                { color: '#854d0e' },
                                              ]}
                                            >
                                              אולי
                                            </Text>
                                          </View>
                                        )}
                                      </Pressable>
                                    )}
                                  </View>
                                )}

                                {/* Navigate / Join button */}
                                {item.remoteUrl ||
                                (item.location &&
                                  parseGeoUri(item.locationUrl)) ? (
                                  <Pressable
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      if (item.remoteUrl) {
                                        Linking.openURL(item.remoteUrl).catch(
                                          () =>
                                            Alert.alert(
                                              'שגיאה',
                                              'לא ניתן לפתוח את הקישור.'
                                            )
                                        );
                                      } else {
                                        handleOpenNavPicker(
                                          item.location,
                                          item.locationUrl
                                        );
                                      }
                                    }}
                                    style={{
                                      alignSelf: rtl.alignEnd,
                                      marginTop: 6,
                                      backgroundColor: item.remoteUrl
                                        ? 'rgba(54,169,226,0.1)'
                                        : 'rgba(141,110,99,0.1)',
                                      borderRadius: 10,
                                      paddingHorizontal: 10,
                                      paddingVertical: 4,
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                    accessible={true}
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                      item.remoteUrl ? 'הצטרף לפגישה' : 'נווט'
                                    }
                                  >
                                    <MaterialIcons
                                      name={
                                        item.remoteUrl ? 'videocam' : 'near-me'
                                      }
                                      size={13}
                                      color={
                                        item.remoteUrl ? '#36a9e2' : '#8d6e63'
                                      }
                                    />
                                    <Text
                                      style={{
                                        color: item.remoteUrl
                                          ? '#36a9e2'
                                          : '#8d6e63',
                                        fontSize: 12,
                                        fontWeight: '700',
                                      }}
                                    >
                                      {item.remoteUrl ? 'הצטרף' : 'נווט'}
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        </Pressable>
                        {item.myAssignedTasks &&
                        item.myAssignedTasks.length > 0 ? (
                          <View style={stylesRtl.taskExpansionContainer}>
                            <InlineEventTasksSection
                              tasks={item.myAssignedTasks}
                            />
                          </View>
                        ) : null}
                        {item.importantItems &&
                        item.importantItems.length > 0 ? (
                          <View style={stylesRtl.taskExpansionContainer}>
                            <InlineImportantItemsSection
                              items={item.importantItems}
                            />
                          </View>
                        ) : null}
                        {item.type === 'task' &&
                        (item.subtasks?.length ?? 0) > 0 &&
                        !item.completed ? (
                          <View style={stylesRtl.taskExpansionContainer}>
                            <HomeSubtaskSection
                              taskId={item.id}
                              subtasks={item.subtasks ?? []}
                              isExpanded={expandedHomeTaskIds.has(item.id)}
                              onToggleExpansion={() =>
                                toggleHomeTaskExpansion(item.id)
                              }
                              onToggleSubtask={(subtaskId) =>
                                toggleHomeSubtask(item.id, subtaskId)
                              }
                            />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Swipeable>
                ))}
              </View>
            ) : null}
          </>
        )}

        {/* ── Untimed personal tasks for selected day ──────────────────────── */}
        {!useDailyCommandCenter && selectedDayUntimedTasks.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <View style={stylesRtl.sectionHeader}>
              <Text style={stylesRtl.sectionTitle}>
                {isSelectedToday ? 'היום' : 'משימות ליום הזה'}
              </Text>
            </View>
            <View style={{ paddingHorizontal: 24, gap: 8 }}>
              {selectedDayUntimedTasks.map((task) => (
                <View
                  key={task.id}
                  style={[
                    stylesRtl.undatedRow,
                    { flexDirection: 'column', alignItems: 'stretch' },
                  ]}
                >
                  {/* Main task row — tap to open edit */}
                  <Pressable
                    style={{
                      flexDirection: rtl.flexDirection,
                      alignItems: 'center',
                      gap: 12,
                    }}
                    onPress={() => handleTaskPress(task.id)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={task.title}
                  >
                    <TaskCheckbox
                      checked={task.completed}
                      onToggle={() => toggleTodayTask(task.id)}
                    />
                    <Text
                      style={[
                        stylesRtl.undatedTitle,
                        { flex: 1 },
                        task.completed && stylesRtl.completedText,
                      ]}
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                    {(task.assigneeDisplays?.length ?? 0) > 0 ? (
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center' }}
                      >
                        {(task.assigneeDisplays ?? [])
                          .slice(0, 3)
                          .map((d, i) => (
                            <View
                              key={`${d.initials}:${d.color}`}
                              style={[
                                stylesRtl.assigneeCircle,
                                {
                                  backgroundColor: d.color,
                                  marginLeft: i === 0 ? 0 : -6,
                                  zIndex: 3 - i,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  fontSize: 9,
                                  color: '#fff',
                                  fontWeight: '700',
                                }}
                              >
                                {d.initials}
                              </Text>
                            </View>
                          ))}
                      </View>
                    ) : null}
                  </Pressable>
                  {/* Subtask section */}
                  {(task.subtasks?.length ?? 0) > 0 && !task.completed ? (
                    <HomeSubtaskSection
                      taskId={task.id}
                      subtasks={task.subtasks ?? []}
                      isExpanded={expandedHomeTaskIds.has(task.id)}
                      onToggleExpansion={() => toggleHomeTaskExpansion(task.id)}
                      onToggleSubtask={(subtaskId) =>
                        toggleHomeSubtask(task.id, subtaskId)
                      }
                    />
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Overdue incomplete tasks — only shown on the real current day ── */}
        {showLegacyOverdue && (
          <View style={{ marginBottom: 24 }}>
            <View style={stylesRtl.sectionHeader}>
              <Text style={stylesRtl.sectionTitle}>עדיין מחכה לך</Text>
            </View>
            <View style={{ paddingHorizontal: 24, gap: 8 }}>
              {overdueTasks.map((task) => (
                <View
                  key={task.id}
                  style={[
                    stylesRtl.undatedRow,
                    { flexDirection: 'column', alignItems: 'stretch' },
                  ]}
                >
                  {/* Main task row — tap to open edit */}
                  <Pressable
                    style={{
                      flexDirection: rtl.flexDirection,
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                    onPress={() => handleTaskPress(task.id)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={task.title}
                  >
                    <View
                      style={{
                        flexDirection: rtl.flexDirection,
                        alignItems: 'center',
                        gap: 8,
                        flex: 1,
                      }}
                    >
                      <TaskCheckbox
                        checked={task.completed}
                        onToggle={() => toggleOverdueTask(task.id)}
                      />
                      <Text
                        style={[
                          stylesRtl.undatedTitle,
                          { flex: 1 },
                          task.completed && stylesRtl.completedText,
                        ]}
                        numberOfLines={1}
                      >
                        {task.title}
                      </Text>
                      {(task.assigneeDisplays?.length ?? 0) > 0 ? (
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center' }}
                        >
                          {(task.assigneeDisplays ?? [])
                            .slice(0, 3)
                            .map((d, i) => (
                              <View
                                key={`${d.initials}:${d.color}`}
                                style={[
                                  stylesRtl.assigneeCircle,
                                  {
                                    backgroundColor: d.color,
                                    marginLeft: i === 0 ? 0 : -6,
                                    zIndex: 3 - i,
                                  },
                                ]}
                              >
                                <Text
                                  style={{
                                    fontSize: 9,
                                    color: '#fff',
                                    fontWeight: '700',
                                  }}
                                >
                                  {d.initials}
                                </Text>
                              </View>
                            ))}
                        </View>
                      ) : null}
                    </View>
                    {task.dueDate ? (
                      <Text
                        style={{
                          fontSize: 11,
                          color: '#94a3b8',
                          marginRight: 8,
                          textAlign: getTextAlign(),
                        }}
                      >
                        {formatOverdueDate(task)}
                      </Text>
                    ) : null}
                  </Pressable>
                  {/* Subtask section */}
                  {(task.subtasks?.length ?? 0) > 0 && !task.completed ? (
                    <HomeSubtaskSection
                      taskId={task.id}
                      subtasks={task.subtasks ?? []}
                      isExpanded={expandedHomeTaskIds.has(task.id)}
                      onToggleExpansion={() => toggleHomeTaskExpansion(task.id)}
                      onToggleSubtask={(subtaskId) =>
                        toggleHomeSubtask(task.id, subtaskId)
                      }
                    />
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Undated tasks — only on real current day ─────────────────────── */}
        {showLegacyUndated && (
          <View style={{ marginBottom: 32 }}>
            <View style={stylesRtl.sectionHeader}>
              <Text style={stylesRtl.sectionTitle}>משימות ללא תאריך</Text>
              {undatedTasks.length > 3 && (
                <Pressable
                  onPress={() => setShowAllUndated(true)}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`הצג הכל, ${undatedTasks.length} משימות`}
                >
                  <Text
                    style={{
                      color: '#36a9e2',
                      fontSize: 13,
                      fontWeight: '700',
                    }}
                  >
                    הצג הכל ({undatedTasks.length})
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={{ paddingHorizontal: 24, gap: 8 }}>
              {undatedTasks.slice(0, 3).map((task) => (
                <View
                  key={task.id}
                  style={[
                    stylesRtl.undatedRow,
                    { flexDirection: 'column', alignItems: 'stretch' },
                  ]}
                >
                  <Pressable
                    style={{
                      flexDirection: rtl.flexDirection,
                      alignItems: 'center',
                      gap: 12,
                    }}
                    onPress={() => handleTaskPress(task.id)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={task.title}
                  >
                    <TaskCheckbox
                      checked={task.completed}
                      onToggle={() => toggleUndatedTask(task.id)}
                    />
                    <Text
                      style={[
                        stylesRtl.undatedTitle,
                        { flex: 1 },
                        task.completed && stylesRtl.completedText,
                      ]}
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                    {task.assigneeInitials ? (
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: task.assigneeColor ?? '#36a9e2',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 9,
                            color: '#fff',
                            fontWeight: '700',
                          }}
                        >
                          {task.assigneeInitials}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                  {(task.subtasks?.length ?? 0) > 0 && !task.completed ? (
                    <HomeSubtaskSection
                      taskId={task.id}
                      subtasks={task.subtasks ?? []}
                      isExpanded={expandedHomeTaskIds.has(task.id)}
                      onToggleExpansion={() => toggleHomeTaskExpansion(task.id)}
                      onToggleSubtask={(subtaskId) =>
                        toggleHomeSubtask(task.id, subtaskId)
                      }
                    />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Modal: all undated tasks */}
            <Modal
              visible={showAllUndated}
              animationType="slide"
              transparent
              onRequestClose={() => setShowAllUndated(false)}
            >
              <Pressable
                style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
                onPress={() => setShowAllUndated(false)}
              />
              <View
                style={{
                  backgroundColor: '#fff',
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  padding: 24,
                  maxHeight: '70%',
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: '#e5e7eb',
                    alignSelf: 'center',
                    marginBottom: 16,
                  }}
                />
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: '700',
                    color: '#111517',
                    textAlign: getTextAlign(),
                    marginBottom: 16,
                  }}
                >
                  משימות ללא תאריך
                </Text>
                {/* TODO: לשפר סינון/קיבוץ בעתיד */}
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={{ gap: 8 }}>
                    {undatedTasks.map((task) => (
                      <View
                        key={task.id}
                        style={[
                          stylesRtl.undatedRow,
                          { flexDirection: 'column', alignItems: 'stretch' },
                        ]}
                      >
                        <Pressable
                          style={{
                            flexDirection: rtl.flexDirection,
                            alignItems: 'center',
                            gap: 12,
                          }}
                          onPress={() => {
                            setShowAllUndated(false);
                            handleTaskPress(task.id);
                          }}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel={task.title}
                        >
                          <TaskCheckbox
                            checked={task.completed}
                            onToggle={() => toggleUndatedTask(task.id)}
                          />
                          <Text
                            style={[
                              stylesRtl.undatedTitle,
                              { flex: 1 },
                              task.completed && stylesRtl.completedText,
                            ]}
                            numberOfLines={2}
                          >
                            {task.title}
                          </Text>
                          {task.assigneeInitials ? (
                            <View
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 11,
                                backgroundColor:
                                  task.assigneeColor ?? '#36a9e2',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 9,
                                  color: '#fff',
                                  fontWeight: '700',
                                }}
                              >
                                {task.assigneeInitials}
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                        {(task.subtasks?.length ?? 0) > 0 && !task.completed ? (
                          <HomeSubtaskSection
                            taskId={task.id}
                            subtasks={task.subtasks ?? []}
                            isExpanded={expandedHomeTaskIds.has(task.id)}
                            onToggleExpansion={() =>
                              toggleHomeTaskExpansion(task.id)
                            }
                            onToggleSubtask={(subtaskId) =>
                              toggleHomeSubtask(task.id, subtaskId)
                            }
                          />
                        ) : null}
                      </View>
                    ))}
                  </View>
                </ScrollView>
                <Pressable
                  onPress={() => setShowAllUndated(false)}
                  style={{
                    alignSelf: 'center',
                    marginTop: 16,
                    paddingVertical: 4,
                    paddingHorizontal: 16,
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="סגירה"
                >
                  <Text
                    style={{
                      color: '#94a3b8',
                      fontSize: 15,
                      fontWeight: '600',
                    }}
                  >
                    סגירה
                  </Text>
                </Pressable>
              </View>
            </Modal>
          </View>
        )}
      </ScrollView>

      {/* ── Welcome toast ──────────────────────────────────────────────────── */}
      {showToast && (
        <View style={stylesRtl.toastWrapper}>
          <View style={[stylesRtl.toastShadow, stylesRtl.toastCard]}>
            <View style={{ flex: 1 }}>
              <Text style={stylesRtl.toastText}>
                {userFirstName
                  ? `ברוכים הבאים הביתה, ${userFirstName}! הכל מוכן. ה-AI של InYomi כבר התחילה לעבוד לסנכרן לך את היום.`
                  : 'ברוכים הבאים הביתה! הכל מוכן. ה-AI של InYomi כבר התחילה לעבוד לסנכרן לך את היום.'}
              </Text>
            </View>
            <MaterialIcons name="auto-awesome" size={20} color="#36a9e2" />
          </View>
        </View>
      )}

      {/* ── Notifications Drawer ───────────────────────────────────────────── */}
      <NotificationsDrawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
      />

      {/* ── Task Detail Sheet ───────────────────────────────────────────────── */}
      <TaskDetailsBottomSheet
        taskId={taskSheetTaskId}
        visible={taskSheetVisible}
        onClose={closeTaskSheet}
      />

      <NavigationPickerModal
        location={navPickerLocation}
        latitude={parseGeoUri(navPickerLocationUrl)?.lat}
        longitude={parseGeoUri(navPickerLocationUrl)?.lng}
        onClose={() => {
          setNavPickerLocation(null);
          setNavPickerLocationUrl(null);
        }}
        visible={navPickerLocation !== null}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/** Deeper warm greige for the date-navigation pill track.
 *  Distinct from the screen background (#f6f7f8) and the global warmGray token
 *  which is used on bottom sheets and empty states throughout the app. */
const HOME_DATE_TABS_BG = '#EDE8E2';

const styles = StyleSheet.create({
  safeAreaRtl: {
    direction: 'rtl',
  },
  // ── Header ─────────────────────────────────────────────────────────────────
  headerSurface: {
    backgroundColor: '#f6f7f8',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#f6f7f8',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  headerDate: { fontSize: 12, color: '#94a3b8', textAlign: 'right' },
  headerGreeting: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111517',
    textAlign: 'right',
  },

  // ── Insight card ────────────────────────────────────────────────────────────
  insightCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 4,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  insightHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  insightLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#36a9e2',
    textAlign: 'right',
  },
  insightText: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
    lineHeight: 20,
  },

  // ── Date section header ─────────────────────────────────────────────────────
  dateSelectorShell: {
    minHeight: 68,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    marginHorizontal: 24,
    marginTop: 8,
    marginBottom: 10,
    borderRadius: 34,
    padding: 6,
    backgroundColor: '#EBEEF0',
  },
  dateSegment: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  dateSegmentSelected: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#00668E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 9,
    elevation: 2,
  },
  dateSegmentText: {
    color: '#5A6062',
    fontSize: 14,
    fontWeight: '600',
  },
  dateSegmentTextSelected: {
    color: '#00668E',
    fontWeight: '800',
  },
  dateCalendarButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  dateSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#f6f7f8',
    gap: 8,
    zIndex: 10,
    shadowColor: '#1A1A1A',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  todayChip: {
    backgroundColor: '#36a9e2',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  todayChipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  // ── Segmented day selector ───────────────────────────────────────────────────
  pillStrip: {
    flex: 1,
    flexDirection: rtl.flexDirection,
    alignItems: 'stretch',
    backgroundColor: HOME_DATE_TABS_BG,
    borderRadius: 26,
    padding: 4,
    minHeight: 48,
  },
  dayPillTab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'transparent',
  },
  dayPillTabActive: {
    backgroundColor: tc.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  dayPillText: {
    fontSize: 14,
    fontWeight: '500',
    color: tc.textSecondary,
    textAlign: 'center',
  },
  dayPillTextActive: {
    fontSize: 14,
    fontWeight: '700',
    color: tc.primary,
  },
  calendarIconBtn: {
    width: 40,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarIconBtnActive: {
    backgroundColor: tc.primaryLight,
    borderRadius: 10,
  },

  // ── Date carousel (kept for reference) ──────────────────────────────────────
  carouselRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 4,
  },
  dayPill: {
    width: 44,
    height: 56,
    borderRadius: 10,
    marginHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  dayPillToday: { borderWidth: 2, borderColor: '#36a9e2' },
  dayPillSelected: { backgroundColor: '#36a9e2', borderWidth: 0 },
  dayPillWeekday: { fontSize: 10, color: '#94a3b8' },
  dayPillNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111517',
    marginTop: 2,
  },
  dayPillTextSelected: { color: '#fff', fontWeight: '900' },
  subtitleCount: {
    color: tc.textSecondary,
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'right',
    paddingHorizontal: 24,
    marginBottom: 16,
    marginTop: 8,
  },

  // ── Month calendar ──────────────────────────────────────────────────────────
  monthCalendar: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  monthName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
    marginBottom: 12,
  },
  monthGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
  },
  monthDayHeader: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 4,
  },
  monthDayHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  monthDayCell: {
    width: `${100 / 7}%`,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthDayCellSelected: {
    backgroundColor: '#36a9e2',
    borderRadius: 10,
  },
  monthDayCellToday: {
    borderWidth: 2,
    borderColor: '#36a9e2',
    borderRadius: 10,
  },
  monthDayText: {
    fontSize: 14,
    color: '#111517',
    fontWeight: '500',
  },
  monthDayTextSelected: { color: '#fff', fontWeight: '700' },
  monthDayTextToday: { color: '#36a9e2', fontWeight: '700' },

  // ── Empty state — new user ──────────────────────────────────────────────────
  emptyStateContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  emptyStateIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyStatePrimaryBtn: {
    backgroundColor: '#36a9e2',
    borderRadius: 50,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 12,
  },
  emptyStatePrimaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyStateSecondaryBtnText: {
    color: '#36a9e2',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 20,
  },
  emptyStateHint: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Empty day state ──────────────────────────────────────────────────────────
  emptyDayContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyDayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111517',
    marginTop: 12,
    marginBottom: 6,
  },
  emptyDaySubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 12,
  },
  emptyDayLink: {
    fontSize: 14,
    color: '#36a9e2',
    fontWeight: '600',
  },

  // ── Event card ──────────────────────────────────────────────────────────────
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  eventCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#f8fafc',
  },
  nextEventCardWithTasks: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  nextEventTaskExpansionContainer: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#f8fafc',
    paddingHorizontal: 24,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  eventAccentBar: {
    position: 'absolute',
    ...position.start(0),
    top: 0,
    bottom: 0,
    width: 6,
    backgroundColor: '#36a9e2',
  },
  eventTopRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  eventNextPill: {
    backgroundColor: '#f0f7ff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  eventNextPillText: { color: '#36a9e2', fontSize: 11, fontWeight: '700' },
  eventTime: { color: '#36a9e2', fontSize: 26, fontWeight: '700' },
  eventTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
    marginBottom: 8,
  },
  eventAddressRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  eventAddressGroup: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    flex: 1,
    marginLeft: 8,
  },
  eventAddress: { color: '#94a3b8', fontSize: 13, flex: 1, textAlign: 'right' },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(141,110,99,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  navBtnText: { color: '#8d6e63', fontWeight: '700', fontSize: 13 },

  // ── Birthdays ───────────────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 12,
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textAlign: 'right',
  },
  seeAll: { fontSize: 12, fontWeight: '700', color: '#36a9e2' },
  birthdayCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    width: 116,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  birthdayAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  birthdayCountdown: {
    fontSize: 9,
    fontWeight: '700',
    color: '#36a9e2',
    textAlign: 'right',
  },
  birthdayName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
  },

  // ── All-day events ──────────────────────────────────────────────────────────
  allDayLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 6,
  },
  allDayCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  allDayAccent: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  allDayTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111517',
    textAlign: 'right',
    paddingRight: 8,
  },

  // ── Timeline ────────────────────────────────────────────────────────────────
  timelineTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
  },
  timeColumn: { width: 48, alignItems: 'center', paddingTop: 14 },
  timeText: { fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  timelineCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    minHeight: 72,
    flexDirection: rtl.flexDirection,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    overflow: 'hidden',
  },
  timelineCardWithTasks: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  taskExpansionContainer: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 0,
    paddingBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  timelineAccent: {
    position: 'absolute',
    ...position.start(0),
    top: 0,
    bottom: 0,
    width: 4,
    borderRadius: 2,
  },
  deleteAction: {
    backgroundColor: '#ff4444',
    borderRadius: 16,
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    marginBottom: 12,
  },
  openEventAction: {
    backgroundColor: '#36a9e2',
    borderRadius: 16,
    width: 90,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    marginBottom: 12,
    gap: 4,
  },
  swipeActionLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  // taskCheckbox moved to components/TaskCheckbox.tsx
  taskTitle: {
    textDecorationLine: 'none',
    color: '#111517',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    flex: 1,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#94a3b8',
    opacity: 0.7,
  },
  assigneeCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLocation: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'right',
    marginTop: 2,
  },

  // ── Group name label ─────────────────────────────────────────────────────────
  groupRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  groupText: {
    fontSize: 12,
    color: '#64748b',
  },
  personalTaskSummary: {
    fontSize: 12,
    color: '#36a9e2',
    textAlign: 'right',
    marginTop: 2,
  },

  // ── Pending badge ────────────────────────────────────────────────────────────
  pendingBadge: {
    backgroundColor: '#fff3cd',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#b45309',
  },

  // ── Undated tasks ────────────────────────────────────────────────────────────
  undatedRow: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  undatedTitle: {
    fontSize: 13,
    color: '#111517',
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
  },

  // ── Summary-mode list cards ──────────────────────────────────────────────────
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row-reverse',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  summaryCardMuted: { opacity: 0.5 },
  summaryCardTime: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
    marginBottom: 2,
    fontWeight: '600',
  },

  // ── Summary mode title ──────────────────────────────────────────────────────
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
  },

  // ── End-of-day fallback card ─────────────────────────────────────────────────
  endOfDayCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#f0f7ff',
  },
  endOfDayTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
    marginBottom: 6,
  },
  endOfDaySubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 14,
  },
  endOfDayCta: {
    fontSize: 14,
    fontWeight: '700',
    color: '#36a9e2',
    textAlign: 'right',
  },

  // ── Toast ───────────────────────────────────────────────────────────────────
  toastWrapper: {
    position: 'absolute',
    bottom: 10,
    left: 16,
    right: 16,
    zIndex: 40,
    alignItems: 'center',
  },
  toastShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 10,
  },
  toastCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#36a9e2',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 12,
    width: '100%',
  },
  toastText: {
    color: '#374151',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
  },

  // ── Bell badge ──────────────────────────────────────────────────────────────
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
});
