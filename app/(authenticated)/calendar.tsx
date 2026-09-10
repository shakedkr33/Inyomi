import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery } from 'convex/react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Minus, Plus } from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Animated,
  type GestureResponderEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommunityEventNameTag } from '@/components/CommunityEventNameTag';
import type { EventItem } from '@/components/EventDetailsBottomSheet';
import { EventDetailsBottomSheet } from '@/components/EventDetailsBottomSheet';
import type { AssignedEventTask } from '@/components/InlineEventTasksSection';
import { InlineEventTasksSection } from '@/components/InlineEventTasksSection';
import type { ImportantItem } from '@/components/InlineImportantItemsSection';
import { InlineImportantItemsSection } from '@/components/InlineImportantItemsSection';
import { MainScreenHeader } from '@/components/MainScreenHeader';
import { NavigationPickerModal } from '@/components/NavigationPickerModal';
import type { ProfileCircle } from '@/components/ProfileCircles';
import { ProfileCircles } from '@/components/ProfileCircles';
import { TaskDetailsBottomSheet } from '@/components/tasks/TaskDetailsBottomSheet';
import { UpgradeModal } from '@/components/UpgradeModal';
import { colors } from '@/constants/theme';
import { useNotifications } from '@/contexts/NotificationsContext';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import { getAvatarInitials } from '@/lib/avatarInitials';
import { useBirthdaySheets } from '@/lib/components/birthday/BirthdaySheetsProvider';
import { NotificationsDrawer } from '@/lib/components/notifications/NotificationsDrawer';
import { useHolidayOverlay } from '@/lib/hooks/useHolidayOverlay';
import { APP_IS_RTL, getTextAlign, needsExplicitRTL, position, rtl, spacing } from '@/lib/rtl';
import {
  type CalendarLayerFilters,
  DEFAULT_CALENDAR_LAYER_FILTERS,
  loadCalendarLayerFilters,
  saveCalendarLayerFilters,
} from '@/lib/storage/calendarLayerFilterPreferences';
import {
  type HolidayOverlayPreferences,
  loadHolidayOverlayPreferences,
} from '@/lib/storage/holidayOverlayPreferences';
import {
  COMMUNITY_REMINDER_DISMISS_LABEL,
  COMMUNITY_REMINDER_TYPE_LABEL,
  isCommunityReminderTypeLabel,
  PERSONAL_TASK_TYPE_LABEL,
} from '@/lib/taskClassification';
import { isTaskPastDue } from '@/lib/taskDueStatus';
import type { HolidayOverlayItem } from '@/lib/types/holidayOverlay';
import { parseGeoUri } from '@/lib/utils/geoUri';
import {
  getHebrewDateInfo,
  getHebrewMonthRangeForGregorianMonth,
} from '@/lib/utils/hebrewDate';

/**
 * Android: root View uses `direction: 'rtl'` (`app/_layout.tsx`). Yoga lays out `flexDirection: 'row'`
 * with inline-start on the physical RIGHT — so JSX order must be reversed vs iOS for the same visuals.
 * (`direction: 'ltr'` on nested Views is unreliable on Android.)
 */
const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

// ===== Module-level date-format caches =====
// toLocaleDateString('he-IL', …) is synchronous and slow on Hermes (~5-50 ms
// per call). A module-level Map ensures each unique calendar day is formatted
// at most once for the lifetime of the app session.
const _dayLabelCache = new Map<string, string>();
function getCachedDayLabel(date: Date): string {
  const key = date.toDateString(); // e.g. "Mon Jul 21 2026" — locale-free, unique per day
  const cached = _dayLabelCache.get(key);
  if (cached !== undefined) return cached;
  const label = date.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  _dayLabelCache.set(key, label);
  return label;
}

const _hebrewDateInfoCache = new Map<string, ReturnType<typeof getHebrewDateInfo>>();
function getCachedHebrewDateInfo(dateStr: string): ReturnType<typeof getHebrewDateInfo> {
  const cached = _hebrewDateInfoCache.get(dateStr);
  if (cached !== undefined) return cached;
  const info = getHebrewDateInfo(dateStr);
  _hebrewDateInfoCache.set(dateStr, info);
  return info;
}

// ===== Constants =====
const PRIMARY_BLUE = colors.primaryDark;
const BG_COLOR = '#f6f7f8';
const COMPACT_CELL_HEIGHT = 54;

/** Horizontal month swipe — distance (px) or velocity to commit */
const MONTH_SWIPE_DISTANCE = 56;
const MONTH_SWIPE_VELOCITY = 420;

/** Calendar panel snap thresholds */
const OPEN_DRAG_DISTANCE = 28;
const CLOSE_DRAG_DISTANCE = 28;
const SNAP_VELOCITY = 260;

// Dynamic panel height building blocks
const PANEL_FIXED_HEIGHT = 56; // compact grid chrome (day-name header row + padding)
const CALENDAR_HANDLE_HEIGHT = 44; // tap-to-toggle arrow handle
const COMPACT_ROW_HEIGHT = COMPACT_CELL_HEIGHT + 4; // cell + weekRow marginBottom
const EXPANDED_DAY_HEADER_HEIGHT = 24;
const EXPANDED_ROW_ITEM_HEIGHT = 20;
const EXPANDED_ROW_ITEM_HEIGHT_SINGLE = 42;
const EXPANDED_GRID_BOTTOM_PADDING = 124;
const EDIT_POPOVER_WIDTH = 112;
const EDIT_POPOVER_HEIGHT = 52;
/** Height when month grid collapses to a single week row (day selected, week-only mode) */
const WEEK_ONLY_PANEL_HEIGHT =
  PANEL_FIXED_HEIGHT + COMPACT_ROW_HEIGHT + CALENDAR_HANDLE_HEIGHT; // 56 + 58 + 44 = 158

type SnapState = 'compact' | 'expanded';

const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

const HEBREW_DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

const HEBREW_WEEKDAYS_FULL = [
  'יום ראשון',
  'יום שני',
  'יום שלישי',
  'יום רביעי',
  'יום חמישי',
  'יום שישי',
  'שבת',
];

// ===== Types =====
interface CalendarEvent {
  id: string;
  title: string;
  name?: string;
  subject?: string;
  summary?: string;
  time: string;
  category: string;
  categoryColor: string;
  communityId?: string;
  location?: string;
  /** geo:lat,lng URI — present when the event was saved with autocomplete coordinates */
  locationUrl?: string;
  icon?: string;
  cancelled?: boolean;
  assigneeColors?: string[];
  sourceType?: 'event' | 'linked';
  /** Disambiguates list keys when same id appears from multiple sources */
  listKey?: string;
  /** Community events shown outside community screen — real name from Convex */
  communityName?: string;
  /** For stable ordering inside a day cell */
  sortTimeMs?: number;
  /** Expanded month chip styling */
  eventVisualKind?: 'community' | 'shared' | 'personal';
  /** True when the current viewer created this event; false for Type B (shared-with-viewer) events */
  isViewerCreator?: boolean;
  /** True when this is a personal invite the current user has not yet answered */
  pendingPersonalInvite?: boolean;
  /** RSVP status of the current user for this personal invited event (undefined = not an invite) */
  myPersonalRsvpStatus?: 'yes' | 'maybe' | 'no' | 'none';
  /** Resolved family-member profiles for compact card circles (personal events only) */
  profileCircles?: ProfileCircle[];
  profileCirclesExtraCount?: number;
  profileCirclesContext?: 'sharedWith' | 'alsoAddedToCalendar';
  /** "חשוב לזכור" items — only populated for community events */
  importantItems?: ImportantItem[];
  /**
   * FIX — Community Event tasks assigned to the current viewer — only
   * populated for community events. Mirrors Timeline's `myAssignedTasks`
   * (see `TimelineEventRow`) so Monthly (day sheet / selected-day panel)
   * can reach parity: only MY assigned tasks, never unassigned or other
   * members' tasks (server query already scopes to the viewer).
   */
  myAssignedTasks?: AssignedEventTask[];
}

interface BirthdayInfo {
  name: string;
  age?: number;
}

interface CalendarDay {
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
  birthday?: BirthdayInfo;
}

// ===== Mock Data =====
const MOCK_TIMELINE_DATA = [
  {
    dayLabel: 'היום, יום חמישי',
    dayNumber: '24',
    isToday: true,
    events: [
      {
        id: '1',
        category: 'משפחה',
        categoryColor: '#ff922b',
        title: 'ארוחת צהריים משפחתית',
        time: '13:00',
        location: 'בבית',
        icon: 'home',
        cancelled: false,
      },
      {
        id: '2',
        category: 'בריאות',
        categoryColor: PRIMARY_BLUE,
        title: 'תור לרופא שיניים',
        time: '10:00',
        location: 'מרפאת כללית, תל אביב',
        icon: 'location-on',
        cancelled: false,
      },
      {
        id: '3',
        category: 'אישי',
        categoryColor: '#9ca3af',
        title: 'קפה עם אמא',
        time: '08:30',
        location: 'קפה לנדוור',
        icon: 'local-cafe',
        cancelled: true,
      },
    ],
  },
  {
    dayLabel: 'אתמול, יום רביעי',
    dayNumber: '23',
    isToday: false,
    events: [
      {
        id: '4',
        category: 'כושר',
        categoryColor: '#7950f2',
        title: 'אימון בחדר כושר',
        time: '18:00',
        location: 'הולמס פלייס',
        icon: 'fitness-center',
        cancelled: false,
      },
      {
        id: '5',
        category: 'קניות',
        categoryColor: '#51cf66',
        title: 'קניות לשבת',
        time: '16:30',
        location: 'שופרסל דיל',
        icon: 'shopping-cart',
        cancelled: false,
      },
    ],
  },
  {
    dayLabel: 'יום שלישי',
    dayNumber: '22',
    isToday: false,
    events: [
      {
        id: '6',
        category: 'עבודה',
        categoryColor: '#6b7280',
        title: 'פגישת צוות שבועית',
        time: '09:00',
        location: '',
        icon: '',
        cancelled: false,
      },
    ],
  },
];

type MockTimelineEvent = (typeof MOCK_TIMELINE_DATA)[number]['events'][number];
type TimelineEventRow = MockTimelineEvent & {
  sourceType?: 'event' | 'linked';
  /** Stable source identifier — set for community events and community tasks. */
  communityId?: string;
  communityName?: string;
  endTime?: string;
  locationUrl?: string;
  myAssignedTasks?: AssignedEventTask[];
  importantItems?: ImportantItem[];
  /** True for rows synthesised from the personal tasks table */
  isPersonalTask?: boolean;
  /** True when the task dueDate is in the past and not yet completed */
  isOverdue?: boolean;
  /** User-facing type chip text — `תזכורת קהילה` for general community reminders, `משימה` otherwise. */
  typeLabel?: string;
  /** Subtask checklist items — only for personal task rows */
  subtasks?: { id: string; title: string; completed: boolean }[];
  /** Initials of the non-self assignee — only for personal task rows */
  assigneeInitials?: string;
  /** Background colour for the assignee avatar — only for personal task rows */
  assigneeColor?: string;
  /** All non-self assignees for multi-circle display on compact task rows. */
  assigneeDisplays?: { initials: string; color: string }[];
  /** Resolved family-member profiles to display as overlapping circles on the card */
  profileCircles?: ProfileCircle[];
  /** Count of external (non-family) participants, shown as "+N" after the circles */
  profileCirclesExtraCount?: number;
  /** Semantic context: 'sharedWith' for personal items, 'alsoAddedToCalendar' for community events */
  profileCirclesContext?: 'sharedWith' | 'alsoAddedToCalendar';
  /** True when this is a personal invite the current user has not yet answered */
  pendingPersonalInvite?: boolean;
  /** RSVP status of the current user for this personal invited event (undefined = not an invite) */
  myPersonalRsvpStatus?: 'yes' | 'maybe' | 'no' | 'none';
};

/** Lightweight task item for monthly selected-day panels (DayEventsList / CalendarDayEventsSheet) */
type CalendarDayTask = {
  id: string;
  title: string;
  time: string;
  isOverdue: boolean;
  assigneeInitials?: string;
  assigneeColor?: string;
  /** All non-self assignees for multi-circle display on compact task cards. */
  assigneeDisplays?: { initials: string; color: string }[];
  subtasks?: { id: string; title: string; completed: boolean }[];
  /** User-facing type chip text — `תזכורת קהילה` for general community reminders, `משימה` otherwise. */
  typeLabel?: string;
  /** Real community name — only set for general community reminders. */
  communityName?: string;
};

interface TimelineDayGroup {
  dayLabel: string;
  dayNumber: string;
  isToday: boolean;
  events: TimelineEventRow[];
  sortKey: number;
}

// ===== Flat list types for FlashList virtualization =====
type MissingDay = { dateStr: string; dayLabel: string; dayNumber: string };

type FlatTimelineRow =
  | { type: 'dayGroup'; key: string; dayGroup: TimelineDayGroup; dateStr: string }
  | { type: 'gapToggle'; key: string; dateStr: string; missingDays: MissingDay[]; isOpen: boolean }
  | { type: 'missingDay'; key: string; day: MissingDay }
  | { type: 'endIndicator'; key: string };

// ===== Task filter (mirrors Home screen rule) =====
function isEventDerivedImportantItemTask(task: {
  sourceType?: string;
}): boolean {
  return (
    task.sourceType === 'community_event_important_item' ||
    task.sourceType === 'community_event_important_items_bundle'
  );
}

/**
 * Type-chip text for a calendar task row. Uses the SAME canonical
 * `taskType` classification returned by `tasks.listMyTasks` (see
 * convex/taskUtils.ts `getTaskClassification`) — never a second,
 * independently-maintained check — so Calendar and Home can never disagree
 * about whether an item is a general community reminder.
 */
function getCalendarTaskTypeLabel(task: { taskType?: string }): string {
  return task.taskType === 'community_reminder'
    ? COMMUNITY_REMINDER_TYPE_LABEL
    : PERSONAL_TASK_TYPE_LABEL;
}

/**
 * Resolves the first non-self assignee on a task for avatar display.
 * Mirrors the same function in the Home screen.
 */
/**
 * Like resolveNonSelfAssigneeCalendar but returns ALL non-self assignees for
 * multi-circle display (e.g. ינ + של) on compact calendar task cards.
 */
function resolveAllNonSelfAssigneesCalendar(
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

/**
 * Correct overdue check.
 * - Timed tasks: overdue only after the specific dueAt moment.
 * - Date-only tasks: overdue only when the due calendar day is strictly before today.
 */
function calcTaskOverdue(
  dueDate: number,
  dueAt: number | null | undefined,
  hasTime: boolean | null | undefined,
  nowMs: number
): boolean {
  if (hasTime && dueAt) return dueAt < nowMs;
  const dueDay = new Date(dueDate);
  dueDay.setHours(0, 0, 0, 0);
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  return dueDay.getTime() < todayStart.getTime();
}

// ===== Event Helpers =====
function calculateDuration(event: CalendarEvent): number {
  const durations: Record<string, number> = {
    משפחה: 60,
    בריאות: 60,
    אישי: 45,
    כושר: 60,
    קניות: 30,
    עבודה: 120,
    חוגים: 45,
  };
  return durations[event.category] ?? 60;
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    משפחה: 'people',
    בריאות: 'local-hospital',
    אישי: 'person',
    כושר: 'fitness-center',
    קניות: 'shopping-cart',
    עבודה: 'work',
    חוגים: 'palette',
  };
  return icons[category] ?? 'event';
}

function openEventEditFromCalendar(
  router: ReturnType<typeof useRouter>,
  event: CalendarEvent
): void {
  if (event.sourceType === 'linked') return;

  router.push({
    pathname: '/(authenticated)/event-edit/[id]',
    params: {
      id: event.id,
      ...(event.communityId ? { returnCommunityId: event.communityId } : {}),
    },
  });
}

function getHebrewCalendarDayLabel(
  year: number,
  month: number,
  day: number
): string {
  const date = new Date(year, month, day);
  const weekday = HEBREW_WEEKDAYS_FULL[date.getDay()];
  const monthName = HEBREW_MONTHS[month];
  return `${weekday}, ${day} ב${monthName}`;
}

function getCalendarEventTitle(event: CalendarEvent): string {
  return (
    event.title ||
    event.name ||
    event.subject ||
    event.summary ||
    'אירוע ללא כותרת'
  );
}

type PersonalRsvpVisualState =
  | { kind: 'cancelled'; label: 'בוטל' }
  | { kind: 'no'; label: 'לא מגיע/ה' }
  | { kind: 'maybe'; label: 'אולי' }
  | { kind: 'pending'; label: 'ממתין לאישור' }
  | { kind: 'normal'; label: null };

function getPersonalRsvpVisualState(input: {
  cancelled?: boolean;
  pendingPersonalInvite?: boolean;
  myPersonalRsvpStatus?: 'yes' | 'maybe' | 'no' | 'none';
}): PersonalRsvpVisualState {
  // RSVP yes always wins — even if pendingPersonalInvite is still true
  // during the reactive update window between eventRsvps and myRsvps queries.
  if (input.myPersonalRsvpStatus === 'yes') {
    return { kind: 'normal', label: null };
  }
  if (!input.pendingPersonalInvite) {
    return { kind: 'normal', label: null };
  }
  if (input.cancelled) {
    return { kind: 'cancelled', label: 'בוטל' };
  }
  if (input.myPersonalRsvpStatus === 'no') {
    return { kind: 'no', label: 'לא מגיע/ה' };
  }
  if (input.myPersonalRsvpStatus === 'maybe') {
    return { kind: 'maybe', label: 'אולי' };
  }
  return { kind: 'pending', label: 'ממתין לאישור' };
}

function getPersonalRsvpBadgeColors(kind: PersonalRsvpVisualState['kind']): {
  backgroundColor: string;
  textColor: string;
} {
  if (kind === 'maybe') {
    return { backgroundColor: '#fef9c3', textColor: '#854d0e' };
  }
  if (kind === 'cancelled' || kind === 'no') {
    return { backgroundColor: '#f3f4f6', textColor: '#6b7280' };
  }
  return { backgroundColor: '#f1f5f9', textColor: '#64748b' };
}

interface PersonalRsvpBadgeProps {
  visual: PersonalRsvpVisualState;
  badgeStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}

function PersonalRsvpBadge({
  visual,
  badgeStyle,
  textStyle,
}: PersonalRsvpBadgeProps): React.JSX.Element | null {
  if (visual.label == null) {
    return null;
  }
  const colors = getPersonalRsvpBadgeColors(visual.kind);
  return (
    <View style={[badgeStyle, { backgroundColor: colors.backgroundColor }]}>
      <Text style={[textStyle, { color: colors.textColor }]}>
        {visual.label}
      </Text>
    </View>
  );
}

function estimateSingleEventHeight(title: string): number {
  const CHARS_PER_LINE = 5;
  const LINE_HEIGHT = 14;
  const TIME_LINE_HEIGHT = 11;
  const PADDING_VERTICAL = 4;
  const lineCount = Math.max(1, Math.ceil(title.length / CHARS_PER_LINE));
  return PADDING_VERTICAL + lineCount * LINE_HEIGHT + TIME_LINE_HEIGHT + 6;
}

function getExpandedWeekHeight(
  week: CalendarDay[],
  baseWeekHeight = 0
): number {
  const maxVisibleItems = Math.max(
    1,
    ...week.map((day) => {
      if (!day.isCurrentMonth) return 0;
      return day.events.length + (day.birthday != null ? 1 : 0);
    })
  );
  const maxEventsHeight = Math.max(
    0,
    ...week.map((day) => {
      if (!day.isCurrentMonth) return 0;
      const birthdayHeight =
        day.birthday != null ? EXPANDED_ROW_ITEM_HEIGHT + 4 : 0;
      const eventHeight =
        day.events.length === 1
          ? Math.max(
              EXPANDED_ROW_ITEM_HEIGHT_SINGLE,
              estimateSingleEventHeight(
                day.events[0].title ??
                  day.events[0].name ??
                  day.events[0].subject ??
                  day.events[0].summary ??
                  ''
              )
            )
          : day.events.length * EXPANDED_ROW_ITEM_HEIGHT;
      return birthdayHeight + eventHeight;
    })
  );
  const gapHeight = maxVisibleItems * 3;

  const contentRequiredHeight =
    EXPANDED_DAY_HEADER_HEIGHT + maxEventsHeight + gapHeight + 10;

  return Math.max(baseWeekHeight, contentRequiredHeight);
}

// ===== Calendar Grid Helpers =====
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function generateCalendarGrid(
  year: number,
  month: number,
  monthlyEventsOverride?: Record<number, CalendarEvent[]>
): CalendarDay[][] {
  const now = new Date();
  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOffset = getFirstDayOfMonth(year, month);
  const daysInPrevMonth = getDaysInMonth(year, month - 1);
  const eventsSource = monthlyEventsOverride ?? {};

  const allDays: CalendarDay[] = [];

  for (let i = firstDayOffset - 1; i >= 0; i--) {
    allDays.push({
      day: daysInPrevMonth - i,
      isCurrentMonth: false,
      isToday: false,
      events: [],
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    allDays.push({
      day: d,
      isCurrentMonth: true,
      isToday: d === todayDay && month === todayMonth && year === todayYear,
      events: eventsSource[d] ?? [],
    });
  }

  const minCells = 35;
  const targetCells = allDays.length <= minCells ? minCells : 42;
  const remaining = targetCells - allDays.length;
  for (let i = 1; i <= remaining; i++) {
    allDays.push({
      day: i,
      isCurrentMonth: false,
      isToday: false,
      events: [],
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7));
  }

  if (weeks.length === 6 && weeks[5].every((d) => !d.isCurrentMonth)) {
    weeks.pop();
  }

  return weeks;
}

interface CalendarMonthNavBarProps {
  headerMonthLabel: string;
  hebrewMonthRange: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onTitlePress: () => void;
  showFilterIcon: boolean;
  onFilterPress: () => void;
}

function CalendarMonthNavBar({
  headerMonthLabel,
  hebrewMonthRange,
  onPrevMonth,
  onNextMonth,
  onTitlePress,
  showFilterIcon,
  onFilterPress,
}: CalendarMonthNavBarProps): React.JSX.Element {
  return (
    <View style={styles.monthNavRow}>
      {/* Navigation cluster — arrows visually close to the month title */}
      <View style={styles.monthNavCluster}>
        {/* Physical RIGHT button (first child in rtl layout) → previous month */}
        <Pressable
          onPress={onPrevMonth}
          hitSlop={10}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חודש קודם"
          style={styles.monthChevronButton}
        >
          <MaterialIcons name="chevron-right" size={22} color="#647b87" />
        </Pressable>
        <Pressable
          onPress={onTitlePress}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`בחר חודש ושנה, ${headerMonthLabel}`}
          style={styles.monthTitleButton}
        >
          <Text style={styles.monthYear}>{headerMonthLabel}</Text>
          {hebrewMonthRange ? (
            <Text style={styles.monthYearHebrew}>{hebrewMonthRange}</Text>
          ) : null}
        </Pressable>
        {/* Physical LEFT button (last child in rtl layout) → next month */}
        <Pressable
          onPress={onNextMonth}
          hitSlop={10}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חודש הבא"
          style={styles.monthChevronButton}
        >
          <MaterialIcons name="chevron-left" size={22} color="#647b87" />
        </Pressable>
      </View>

      {/* Filter icon — always on physical right (position: absolute, right) */}
      {showFilterIcon ? (
        <Pressable
          onPress={onFilterPress}
          hitSlop={8}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="סינון היומן"
          style={styles.monthNavFilterBtn}
        >
          <MaterialIcons name="tune" size={22} color="#647b87" />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CalendarFilterPanel — compact bottom-sheet filter panel
// ─────────────────────────────────────────────────────────────────────────────

interface FilterRowDef {
  key: keyof CalendarLayerFilters;
  label: string;
}

interface CalendarFilterPanelProps {
  visible: boolean;
  onClose: () => void;
  filters: CalendarLayerFilters;
  onToggle: (key: keyof CalendarLayerFilters) => void;
  rows: FilterRowDef[];
}

function CalendarFilterPanel({
  visible,
  onClose,
  filters,
  onToggle,
  rows,
}: CalendarFilterPanelProps): React.JSX.Element | null {
  const translateY = useRef(new Animated.Value(400)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 26,
        stiffness: 130,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: 400,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={filterPanelStyles.overlay}>
        {/* Backdrop */}
        <Pressable style={filterPanelStyles.backdrop} onPress={onClose} />

        {/* Sheet */}
        <Animated.View
          style={[filterPanelStyles.sheet, { transform: [{ translateY }] }]}
          accessibilityViewIsModal
        >
          {/* Handle */}
          <View style={filterPanelStyles.handleRow}>
            <View style={filterPanelStyles.handle} />
          </View>

          {/* Title + close */}
          <View style={filterPanelStyles.titleRow}>
            <Text style={filterPanelStyles.title}>הצגה ביומן</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="סגור"
              style={filterPanelStyles.closeBtn}
            >
              <MaterialIcons name="close" size={20} color="#647b87" />
            </Pressable>
          </View>

          {/* Filter rows */}
          {rows.map(({ key, label }) => {
            const isOn = filters[key];
            return (
              <Pressable
                key={key}
                onPress={() => onToggle(key)}
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel={label}
                accessibilityState={{ checked: isOn }}
                style={filterPanelStyles.filterRow}
              >
                {/* Label on right (RTL start) */}
                <Text style={filterPanelStyles.filterLabel}>{label}</Text>
                {/* Toggle indicator on left */}
                <View
                  style={[
                    filterPanelStyles.toggle,
                    isOn
                      ? filterPanelStyles.toggleOn
                      : filterPanelStyles.toggleOff,
                  ]}
                >
                  <View
                    style={[
                      filterPanelStyles.toggleThumb,
                      isOn
                        ? filterPanelStyles.toggleThumbOn
                        : filterPanelStyles.toggleThumbOff,
                    ]}
                  />
                </View>
              </Pressable>
            );
          })}

          <View style={{ height: Math.max(24, insets.bottom) }} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const filterPanelStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
    direction: 'rtl',
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d1d5db',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    minHeight: 52,
  },
  filterLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1a2b38',
    flex: 1,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleOn: {
    backgroundColor: '#36a9e2',
  },
  toggleOff: {
    backgroundColor: '#d1d5db',
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  toggleThumbOff: {
    alignSelf: 'flex-start',
  },
  bottomPad: {
    height: 24,
  },
});

const sheetStyles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    // Modal creates a new Yoga root — explicit direction ensures RTL layout
    // in both Expo Go and native RTL builds (ANDROID_MATCH_IOS_LAYOUT pattern).
    direction: 'rtl',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheetCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '72%',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    direction: 'rtl',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  closeButtonGhost: {
    width: 32,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'center',
  },
  sheetBirthday: {
    fontSize: 13,
    color: '#be185d',
    fontWeight: '600',
    textAlign: getTextAlign() ?? 'right',
    marginBottom: 10,
  },
  sheetScroll: {
    flexGrow: 0,
    maxHeight: 360,
  },
  sheetScrollContent: {
    paddingBottom: 4,
  },
  sheetEmpty: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: getTextAlign() ?? 'right',
    paddingVertical: 20,
    paddingHorizontal: 4,
  },
  /* Holiday row in the expanded-day sheet — read-only, warm amber */
  sheetHolidayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fde68a',
  },
  sheetHolidayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
    flexShrink: 0,
  },
  sheetHolidayTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#92400e',
    textAlign: getTextAlign() ?? 'right',
    writingDirection: 'rtl',
  },
  sheetRow: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  sheetRowCommunity: {
    backgroundColor: '#eff6ff',
    borderColor: '#dbeafe',
  },
  sheetRowShared: {
    backgroundColor: '#f8fafc',
    borderColor: '#e5e7eb',
  },
  sheetEventLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  sheetEventTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111517',
    textAlign: getTextAlign() ?? 'right',
  },
  sheetEventTitleCancelled: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  sheetEventTime: {
    fontSize: 12,
    fontWeight: '700',
    color: '#647b87',
    minWidth: 44,
    textAlign: getTextAlign() ?? 'right',
  },
  sheetTaskRow: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  sheetTaskTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111517',
    textAlign: getTextAlign() ?? 'right',
  },
  sheetOverdueBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#fee2e2',
  },
  sheetOverdueBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  sheetTaskTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  sheetTaskAssigneeAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTaskAssigneeInitials: {
    fontSize: 8,
    fontWeight: '700',
    color: '#ffffff',
  },
  sheetTaskSubtasksRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  sheetTaskSubtasksText: {
    fontSize: 11,
    color: '#64748b',
  },
});

const editPopoverStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    position: 'absolute',
    width: EDIT_POPOVER_WIDTH,
    height: EDIT_POPOVER_HEIGHT,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    overflow: 'hidden',
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: PRIMARY_BLUE,
    textAlign: 'center',
  },
});

interface EventEditMenuState {
  event: CalendarEvent;
  x: number;
  y: number;
}

interface MonthYearPickerModalProps {
  visible: boolean;
  selectedMonth: number;
  selectedYear: number;
  onClose: () => void;
  onConfirm: (month: number, year: number) => void;
}

interface CalendarEventEditPopoverProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: () => void;
}

function CalendarEventEditPopover({
  visible,
  x,
  y,
  onClose,
  onEdit,
}: CalendarEventEditPopoverProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityLabel="סגור תפריט עריכה"
        accessibilityRole="button"
        onPress={onClose}
        style={editPopoverStyles.backdrop}
      />
      <View style={[editPopoverStyles.card, { left: x, top: y }]}>
        <Pressable
          accessibilityLabel="עריכה"
          accessibilityRole="button"
          accessible={true}
          onPress={onEdit}
          style={editPopoverStyles.button}
        >
          <Text style={editPopoverStyles.buttonText}>עריכה</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function MonthYearPickerModal({
  visible,
  selectedMonth,
  selectedYear,
  onClose,
  onConfirm,
}: MonthYearPickerModalProps): React.JSX.Element {
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 21 }, (_, index) => currentYear - 10 + index),
    [currentYear]
  );
  const [draftMonth, setDraftMonth] = useState(selectedMonth);
  const [draftYear, setDraftYear] = useState(selectedYear);

  useEffect(() => {
    if (!visible) return;
    setDraftMonth(selectedMonth);
    setDraftYear(selectedYear);
  }, [selectedMonth, selectedYear, visible]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={pickerStyles.modalRoot} pointerEvents="box-none">
        <Pressable
          accessibilityLabel="סגור בוחר חודש ושנה"
          accessibilityRole="button"
          onPress={onClose}
          style={pickerStyles.backdrop}
        />

        <View style={pickerStyles.card}>
          <Text style={pickerStyles.title}>בחירת חודש</Text>

          <View style={pickerStyles.columns}>
            <View style={pickerStyles.column}>
              <Text style={pickerStyles.columnTitle}>חודש</Text>
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={pickerStyles.columnScroll}
              >
                {HEBREW_MONTHS.map((monthName, monthIndex) => {
                  const isActive = draftMonth === monthIndex;
                  return (
                    <Pressable
                      key={monthName}
                      accessibilityLabel={monthName}
                      accessibilityRole="button"
                      accessible={true}
                      onPress={() => setDraftMonth(monthIndex)}
                      style={[
                        pickerStyles.optionButton,
                        isActive && pickerStyles.optionButtonActive,
                      ]}
                    >
                      <Text
                        style={[
                          pickerStyles.optionText,
                          isActive && pickerStyles.optionTextActive,
                        ]}
                      >
                        {monthName}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={pickerStyles.column}>
              <Text style={pickerStyles.columnTitle}>שנה</Text>
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={pickerStyles.columnScroll}
              >
                {years.map((yearValue) => {
                  const isActive = draftYear === yearValue;
                  return (
                    <Pressable
                      key={String(yearValue)}
                      accessibilityLabel={String(yearValue)}
                      accessibilityRole="button"
                      accessible={true}
                      onPress={() => setDraftYear(yearValue)}
                      style={[
                        pickerStyles.optionButton,
                        isActive && pickerStyles.optionButtonActive,
                      ]}
                    >
                      <Text
                        style={[
                          pickerStyles.optionText,
                          isActive && pickerStyles.optionTextActive,
                        ]}
                      >
                        {String(yearValue)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          <View style={pickerStyles.actions}>
            <Pressable
              accessibilityLabel="ביטול בחירת חודש"
              accessibilityRole="button"
              accessible={true}
              onPress={onClose}
              style={pickerStyles.secondaryButton}
            >
              <Text style={pickerStyles.secondaryButtonText}>ביטול</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="הצג חודש נבחר"
              accessibilityRole="button"
              accessible={true}
              onPress={() => onConfirm(draftMonth, draftYear)}
              style={pickerStyles.primaryButton}
            >
              <Text style={pickerStyles.primaryButtonText}>הצג</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface CalendarDayEventsSheetProps {
  visible: boolean;
  onClose: () => void;
  dayLabel: string;
  birthday?: BirthdayInfo;
  events: CalendarEvent[];
  tasks?: CalendarDayTask[];
  holidays?: HolidayOverlayItem[];
  onEventNavigate: (event: CalendarEvent) => void;
  onEventLongPress: (
    event: CalendarEvent,
    pressEvent: GestureResponderEvent
  ) => void;
  onOpenTaskSheet: (id: string) => void;
  myImportantItemChecks?: Record<string, Record<string, boolean>>;
}

function CalendarDayEventsSheet({
  visible,
  onClose,
  dayLabel,
  birthday,
  events,
  tasks = [],
  holidays = [],
  onEventNavigate,
  onEventLongPress,
  onOpenTaskSheet,
  myImportantItemChecks = {},
}: CalendarDayEventsSheetProps): React.JSX.Element {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={sheetStyles.modalRoot} pointerEvents="box-none">
        <Pressable
          style={sheetStyles.backdrop}
          onPress={onClose}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="סגור"
        />
        <View style={sheetStyles.sheetCard} accessibilityViewIsModal>
          <View style={sheetStyles.sheetTopRow}>
            <View style={sheetStyles.closeButtonGhost} />
            <Text style={sheetStyles.sheetTitle}>{dayLabel}</Text>
            <Pressable
              accessibilityLabel="סגור חלון אירועי יום"
              accessibilityRole="button"
              accessible={true}
              onPress={onClose}
              style={sheetStyles.closeButton}
            >
              <MaterialIcons color="#647b87" name="close" size={18} />
            </Pressable>
          </View>

          {birthday != null ? (
            <Text style={sheetStyles.sheetBirthday}>
              🎂 יום הולדת: {birthday.name}
            </Text>
          ) : null}

          <ScrollView
            style={sheetStyles.sheetScroll}
            contentContainerStyle={sheetStyles.sheetScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {events.length === 0 &&
            tasks.length === 0 &&
            holidays.length === 0 ? (
              <Text style={sheetStyles.sheetEmpty}>אין אירועים ביום הזה</Text>
            ) : null}

            {/* Holiday rows — read-only, above events */}
            {holidays.map((holiday) => (
              <View
                key={holiday.id}
                accessible={false}
                importantForAccessibility="no"
                style={sheetStyles.sheetHolidayRow}
              >
                <View style={sheetStyles.sheetHolidayDot} />
                <Text style={sheetStyles.sheetHolidayTitle}>
                  {holiday.title}
                </Text>
              </View>
            ))}

            {events.map((ev) => {
              const kind = ev.eventVisualKind ?? 'personal';
              // FIX — Monthly/Timeline parity: render MY assigned Community
              // Event tasks here too (mirrors Timeline's InlineEventTasksSection).
              const hasSheetAssignedTasks =
                !ev.cancelled && (ev.myAssignedTasks?.length ?? 0) > 0;
              const hasSheetImportantItems =
                !ev.cancelled && (ev.importantItems?.length ?? 0) > 0;
              const hasSheetExpansion =
                hasSheetAssignedTasks || hasSheetImportantItems;
              return (
                <View key={ev.listKey ?? ev.id}>
                  <Pressable
                    accessibilityLabel={`${ev.time !== '' ? `${ev.time} ` : ''}${ev.title}`}
                    accessibilityRole="button"
                    accessible={true}
                    delayLongPress={340}
                    onLongPress={(pressEvent) =>
                      onEventLongPress(ev, pressEvent)
                    }
                    onPress={() => onEventNavigate(ev)}
                    style={[
                      sheetStyles.sheetRow,
                      kind === 'community' && sheetStyles.sheetRowCommunity,
                      kind === 'shared' && sheetStyles.sheetRowShared,
                      hasSheetExpansion && {
                        marginBottom: 0,
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                      },
                    ]}
                  >
                    <View style={sheetStyles.sheetEventLine}>
                      {ev.time !== '' ? (
                        <Text style={sheetStyles.sheetEventTime}>
                          {ev.time}
                        </Text>
                      ) : null}
                      <Text
                        numberOfLines={1}
                        style={[
                          sheetStyles.sheetEventTitle,
                          ev.cancelled && sheetStyles.sheetEventTitleCancelled,
                        ]}
                      >
                        {ev.title}
                      </Text>
                    </View>
                  </Pressable>
                  {hasSheetAssignedTasks ? (
                    <InlineEventTasksSection tasks={ev.myAssignedTasks ?? []} />
                  ) : null}
                  {hasSheetImportantItems ? (
                    <InlineImportantItemsSection
                      items={ev.importantItems ?? []}
                    />
                  ) : null}
                </View>
              );
            })}

            {tasks.map((task) => (
              <View key={task.id} style={{ marginBottom: 8 }}>
                <CalendarTaskCard
                  task={task}
                  onOpenTaskSheet={onOpenTaskSheet}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ===== Main Component =====
export default function CalendarScreen(): React.JSX.Element {
  const router = useRouter();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const {
    communityId: rawCommunityId,
    view: returnView,
    date: returnDate,
    month: returnMonth,
    collapsed: returnCollapsed,
  } = useLocalSearchParams<{
    communityId?: string;
    view?: string;
    date?: string;
    month?: string;
    collapsed?: string;
  }>();
  // Guard against the string "undefined" being passed as a route param
  const communityId =
    rawCommunityId === 'undefined' ? undefined : rawCommunityId;

  // `today`/`timelineRange` are declared here (rather than further below,
  // where the rest of the monthly-view state lives) so the community-
  // filtered query below can reuse the exact same visible-range calculation
  // the unfiltered timeline already uses — see STAGE 1C comment on
  // api.events.listByCommunity for why this range is required.
  const today = useMemo(() => new Date(), []);
  const timelineRange = useMemo(() => {
    const fromDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    fromDate.setMonth(fromDate.getMonth() - 4);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    toDate.setMonth(toDate.getMonth() + 8);
    toDate.setHours(23, 59, 59, 999);

    return { from: fromDate.getTime(), to: toDate.getTime() };
  }, [today]);

  // STAGE 1C: bounded to the same [-4mo, +8mo] window the unfiltered
  // timeline uses (timelineRange) instead of loading every event the
  // community has ever had. See the query's STAGE 1C comment in
  // convex/events.ts. This is the only current caller of
  // api.events.listByCommunity.
  const communityEvents = useQuery(
    api.events.listByCommunity,
    communityId
      ? {
          communityId: communityId as Id<'communities'>,
          from: timelineRange.from,
          to: timelineRange.to,
        }
      : 'skip'
  );

  const communityData = useQuery(
    api.communities.getById,
    communityId ? { communityId: communityId as Id<'communities'> } : 'skip'
  );

  const spaceId = useQuery(api.users.getMySpace);

  const [viewMode, setViewMode] = useState<'timeline' | 'monthly'>('timeline');
  const [slideAnim] = useState(new Animated.Value(1));
  const [segmentContainerWidth, setSegmentContainerWidth] = useState(0);
  const SEGMENT_PAD = 4;
  const pillWidth =
    segmentContainerWidth > 0
      ? (segmentContainerWidth - SEGMENT_PAD * 2) / 2
      : 0;
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  // Linked Calendar events (sourceType === 'linked') still use the legacy
  // bottom sheet — normal Personal/Community events navigate to
  // /(authenticated)/event/[id] instead (see handleOpenEventDetails).
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const lastDragCloseTime = useRef<number>(0);

  const [taskSheetTaskId, setTaskSheetTaskId] = useState<string | null>(null);
  const [taskSheetVisible, setTaskSheetVisible] = useState(false);
  const {
    unseenCount,
    markAllSeen,
    isLoading: notifLoading,
  } = useNotifications();
  const { isExpiredFree } = useEffectiveAccess();
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);

  // ── Layer filter state ──────────────────────────────────────────────────────
  // Persisted to AsyncStorage via calendarLayerFilterPreferences.
  // Defaults match DEFAULT_CALENDAR_LAYER_FILTERS; replaced on hydration.
  const [layerFilters, setLayerFilters] = useState<CalendarLayerFilters>(
    () => ({ ...DEFAULT_CALENDAR_LAYER_FILTERS })
  );
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  /**
   * Guards against the hydration race condition:
   * if the user toggles any filter before loadCalendarLayerFilters() resolves,
   * this ref is set to true and the late-arriving stored value is discarded.
   * The user's choice (already persisted by toggleLayerFilter) always wins.
   */
  const hasUserChangedFiltersRef = useRef(false);

  const toggleLayerFilter = useCallback(
    (key: keyof CalendarLayerFilters): void => {
      hasUserChangedFiltersRef.current = true;
      setLayerFilters((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        // Persist immediately; fire-and-forget
        saveCalendarLayerFilters(next);
        return next;
      });
    },
    []
  );

  // Hydrate persisted filter preferences once on mount.
  // The ref guard ensures that if the user toggles a filter before the async
  // read resolves, the late-arriving stored result does not overwrite their choice.
  useEffect(() => {
    loadCalendarLayerFilters().then((stored) => {
      if (!hasUserChangedFiltersRef.current) {
        setLayerFilters(stored);
      }
    });
  }, []);

  // ── Holiday overlay preferences ────────────────────────────────────────────
  // Loaded from AsyncStorage via loadHolidayOverlayPreferences().
  // Never written from this screen — holiday settings screen owns that.
  const [holidayPreferences, setHolidayPreferences] =
    useState<HolidayOverlayPreferences>({ enabledCategories: [] });

  // Load once on mount.
  useEffect(() => {
    let cancelled = false;
    loadHolidayOverlayPreferences().then((prefs) => {
      if (!cancelled) setHolidayPreferences(prefs);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh when the screen regains focus so changes made in
  // "חגים ומועדים" settings are immediately reflected here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadHolidayOverlayPreferences().then((prefs) => {
        if (!cancelled) setHolidayPreferences(prefs);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // True when the user has at least one holiday category enabled.
  const anyHolidayCategoryEnabled =
    holidayPreferences.enabledCategories.length > 0;

  function handleGatedCreateAction(action: () => void): void {
    if (isExpiredFree) {
      setUpgradeModalVisible(true);
      return;
    }
    action();
  }

  const handleBellPress = (): void => {
    if (!isNotificationsOpen) {
      setIsNotificationsOpen(true);
    }
    if (!notifLoading) {
      markAllSeen();
    }
  };

  const handleOpenEventDetails = useCallback((event: CalendarEvent): void => {
    if (Date.now() - lastDragCloseTime.current < 600) return;
    // Personal task rows are display-only in the calendar — not openable as events
    if (event.id.startsWith('task:')) return;

    if (event.sourceType === 'linked') {
      setSelectedEvent({
        id: event.id,
        time: event.time,
        title: event.title,
        location: event.location,
        type: 'event',
        iconColor: event.categoryColor,
        completed: false,
        canEdit: false,
      });
      return;
    }

    // Normal Personal + Community events (real `events` table id) → canonical
    // Full Screen event details. Linked events are handled above and keep the
    // legacy bottom sheet for now (separate product decision). returnTo lets
    // Event Details header/hardware Back restore Calendar specifically,
    // instead of relying on Tabs-navigator history (see event/[id].tsx).
    router.push({
      pathname: '/(authenticated)/event/[id]',
      params: { id: event.id, returnTo: 'calendar' },
    } as never);
  }, [router]);

  const closeEventSheet = (): void => {
    setSelectedEvent(null);
  };

  const [navPickerLocation, setNavPickerLocation] = useState<string | null>(
    null
  );
  const [navPickerLocationUrl, setNavPickerLocationUrl] = useState<
    string | null
  >(null);

  const handleNavigateToLocation = (
    location: string,
    locationUrl?: string
  ): void => {
    if (!parseGeoUri(locationUrl)) return;
    setNavPickerLocation(location);
    setNavPickerLocationUrl(locationUrl ?? null);
  };

  const [monthlyVisibleDate, setMonthlyVisibleDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const displayYear = monthlyVisibleDate.getFullYear();
  const displayMonth = monthlyVisibleDate.getMonth();
  const [selectedDay, setSelectedDay] = useState<number | null>(
    today.getDate()
  );
  const [daySheetDay, setDaySheetDay] = useState<number | null>(null);
  const [monthlyViewportHeight, setMonthlyViewportHeight] = useState(0);
  const [isMonthPickerVisible, setIsMonthPickerVisible] = useState(false);
  const [eventEditMenu, setEventEditMenu] = useState<EventEditMenuState | null>(
    null
  );
  const longPressGuardRef = useRef<{ key: string; until: number } | null>(null);

  const isFiltered = !!communityId;

  // === Personal events for the displayed month ===
  const monthRange = useMemo(() => {
    const from = new Date(displayYear, displayMonth, 1).setHours(0, 0, 0, 0);
    const to = new Date(displayYear, displayMonth + 1, 0).setHours(
      23,
      59,
      59,
      999
    );
    return { from, to };
  }, [displayYear, displayMonth]);

  const personalEvents =
    useQuery(api.events.listByDateRange, {
      from: monthRange.from,
      to: monthRange.to,
    }) ?? [];

  /** Community events (RSVP yes for members; creators/admins unchanged) — merged into unfiltered month + timeline */
  const aggregateCommunityEvents =
    useQuery(
      api.events.listCommunityEventsForDate,
      !isFiltered ? { from: monthRange.from, to: monthRange.to } : 'skip'
    ) ?? [];

  // FIX — Monthly/Timeline parity: my assigned Community Event tasks for
  // the displayed month, grouped per event. Same query + shape as
  // `timelineAssignedEventTasks` below — Monthly (day sheet + selected-day
  // panel) previously never fetched this at all, which is the exact root
  // cause of Community Event subtasks being entirely missing there.
  const monthAssignedEventTasks =
    useQuery(
      api.eventTasks.listMyAssignedEventTasksForDate,
      !isFiltered ? { from: monthRange.from, to: monthRange.to } : 'skip'
    ) ?? [];

  const monthTasksByEventId = useMemo(() => {
    const map: Record<string, AssignedEventTask[]> = {};
    for (const t of monthAssignedEventTasks) {
      if (!map[t.eventId]) map[t.eventId] = [];
      map[t.eventId].push({
        id: t._id,
        title: t.title,
        completed: t.completed,
      });
    }
    return map;
  }, [monthAssignedEventTasks]);

  const timelinePersonalEvents =
    useQuery(api.events.listByDateRange, {
      from: timelineRange.from,
      to: timelineRange.to,
    }) ?? [];

  const timelineCommunityEvents =
    useQuery(
      api.events.listCommunityEventsForDate,
      !isFiltered ? { from: timelineRange.from, to: timelineRange.to } : 'skip'
    ) ?? [];

  // My assigned event tasks for the timeline date range — grouped per event
  const timelineAssignedEventTasks =
    useQuery(api.eventTasks.listMyAssignedEventTasksForDate, {
      from: timelineRange.from,
      to: timelineRange.to,
    }) ?? [];

  // Lifted out of TimelineView so the subscription stays alive across tab
  // switches — avoids a cold Convex round-trip every time the user returns
  // to the Timeline tab on Android.
  const myImportantItemChecks =
    useQuery(api.tasks.getMyImportantItemChecks) ?? {};

  const timelineTasksByEventId = useMemo(() => {
    const map: Record<string, AssignedEventTask[]> = {};
    for (const t of timelineAssignedEventTasks) {
      if (!map[t.eventId]) map[t.eventId] = [];
      map[t.eventId].push({
        id: t._id,
        title: t.title,
        completed: t.completed,
      });
    }
    return map;
  }, [timelineAssignedEventTasks]);

  // Family contacts + current user — needed for assignee avatars on task cards
  const familyContacts = useQuery(api.members.listMyFamilyContacts);
  const currentUser = useQuery(api.users.getCurrentUser);

  // My RSVPs — one query for all events, used to detect pending personal invites
  const myRsvps = useQuery(api.eventRsvps.listByUser) ?? [];
  const myRsvpByEventId = useMemo(
    () => new Map(myRsvps.map((r) => [String(r.eventId), r.status])),
    [myRsvps]
  );

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
      if (member.matchedUserId)
        byUserId.set(member.matchedUserId as string, info);
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

  // All community events saved by family members — used for profile circles on
  // timeline event cards without querying per-event (O(family_size) DB calls).
  const familyAllSaved =
    useQuery(api.profileCircles.getFamilyAllSavedCommunityEvents) ?? {};

  // Personal tasks for the calendar — fetched once, filtered client-side.
  // Never carries general community reminders: listMyTasks excludes them
  // unconditionally, even for their own creator (see that query's own doc
  // comment in convex/tasks.ts, "CREATOR-OVERLAP CORRECTION") — it has no
  // way to consult a viewer's personal-dismissal state and would otherwise
  // let a reminder's creator bypass `dismissCommunityReminderForMe`.
  const calendarTasksRaw = useQuery(api.tasks.listMyTasks) ?? [];

  // Dedicated, date-bounded, personal-dismissal-aware Community Reminder
  // retrieval — one query per Calendar range the screen already computes
  // (monthRange for the monthly grid/day panels, timelineRange for the
  // Timeline view), mirroring the exact same per-view range split already
  // used for personalEvents/timelinePersonalEvents above. Never a single
  // unbounded/all-history query. This is the ONLY source of general
  // community reminders on Calendar, for every viewer including the
  // reminder's own creator.
  const communityRemindersMonthly =
    useQuery(api.tasks.listVisibleCommunityRemindersForRange, {
      from: monthRange.from,
      to: monthRange.to,
    }) ?? [];
  const communityRemindersTimeline =
    useQuery(api.tasks.listVisibleCommunityRemindersForRange, {
      from: timelineRange.from,
      to: timelineRange.to,
    }) ?? [];

  const calendarPersonalTasks = useMemo(() => {
    const personal = calendarTasksRaw.filter(
      (t) =>
        t.dueDate != null &&
        !t.completed &&
        !isEventDerivedImportantItemTask(t) &&
        // General community reminders are an ACTIVE surface: once past
        // due they must drop out entirely (same lifecycle already applied
        // by the Community Reminders tab) — never shown as "overdue"
        // like a personal task. See lib/taskDueStatus.ts.
        !(t.taskType === 'community_reminder' && isTaskPastDue(t, Date.now()))
    );

    // Merge in the dedicated Community Reminder result sets — deduped by
    // task id, since the SAME reminder can legitimately appear in both the
    // month-bounded and timeline-bounded query (whenever the displayed
    // month falls inside the timeline's -4/+8 month window). `personal`
    // above never contains a general community reminder (see
    // calendarTasksRaw's comment), so this dedup only matters between the
    // two `listVisibleCommunityRemindersForRange` calls, never against
    // `personal`.
    const reminderMap = new Map<string, (typeof communityRemindersMonthly)[number]>();
    for (const r of [...communityRemindersMonthly, ...communityRemindersTimeline]) {
      reminderMap.set(String(r._id), r);
    }
    const reminders = [...reminderMap.values()].filter(
      (t) => !isTaskPastDue(t, Date.now())
    );

    const merged = new Map<string, (typeof personal)[number]>();
    for (const t of personal) merged.set(String(t._id), t);
    for (const t of reminders) {
      if (!merged.has(String(t._id))) merged.set(String(t._id), t);
    }
    return [...merged.values()];
  }, [calendarTasksRaw, communityRemindersMonthly, communityRemindersTimeline]);

  /** Task count per day-of-month for the currently displayed month (monthly indicator) */
  const calendarTasksByDay = useMemo(() => {
    const map: Record<number, number> = {};
    for (const t of calendarPersonalTasks) {
      if (t.dueDate == null) continue;
      const d = new Date(t.dueDate);
      if (d.getFullYear() !== displayYear || d.getMonth() !== displayMonth)
        continue;
      const day = d.getDate();
      map[day] = (map[day] ?? 0) + 1;
    }
    return map;
  }, [calendarPersonalTasks, displayYear, displayMonth]);

  /** Task-dot count per day — respects both משימות and קהילות chips */
  const filteredCalendarTasksByDay = useMemo(() => {
    if (!layerFilters.showTasks) return {};
    // All tasks visible: return pre-computed map
    if (layerFilters.showCommunity) return calendarTasksByDay;
    // Community tasks hidden: recount from source, skipping communityId tasks
    const map: Record<number, number> = {};
    for (const t of calendarPersonalTasks) {
      if (t.dueDate == null || t.communityId) continue;
      const d = new Date(t.dueDate);
      if (d.getFullYear() !== displayYear || d.getMonth() !== displayMonth)
        continue;
      const day = d.getDate();
      map[day] = (map[day] ?? 0) + 1;
    }
    return map;
  }, [
    layerFilters.showTasks,
    layerFilters.showCommunity,
    calendarTasksByDay,
    calendarPersonalTasks,
    displayYear,
    displayMonth,
  ]);

  // ── Chip conditional visibility (Phase 2A) ──────────────────────────────────
  // Derived from already-loaded calendar data — no additional backend queries.

  /** True when community-sourced content exists in the currently loaded ranges. */
  const hasCommunityContent = useMemo(
    () =>
      aggregateCommunityEvents.length > 0 ||
      timelineCommunityEvents.length > 0 ||
      calendarPersonalTasks.some((t) => Boolean(t.communityId)),
    [aggregateCommunityEvents, timelineCommunityEvents, calendarPersonalTasks]
  );

  /** True when there is at least one active task with a due date on the calendar. */
  const hasDateBasedTasks = useMemo(
    () => calendarPersonalTasks.length > 0,
    [calendarPersonalTasks]
  );

  /**
   * Currently available filter rows for the filter panel.
   *
   * חגים ומועדים — shown only when the user has at least one holiday category enabled.
   * זמני שבת וחג  — hidden until Shabbat time + city selection is implemented.
   * The filter state keys for those layers remain intact for future use.
   *
   * If this list is empty the filter icon is hidden entirely.
   */
  const visibleFilterRows = useMemo(
    () =>
      (
        [
          hasCommunityContent
            ? ({ key: 'showCommunity', label: 'קהילות' } as const)
            : null,
          hasDateBasedTasks
            ? ({ key: 'showTasks', label: 'משימות' } as const)
            : null,
          anyHolidayCategoryEnabled
            ? ({ key: 'showHolidays', label: 'חגים ומועדים' } as const)
            : null,
          // { key: 'showShabbatTimes', label: 'זמני שבת וחג' } — future: enable via Shabbat city selection
        ] as ({ key: keyof CalendarLayerFilters; label: string } | null)[]
      ).filter(
        (row): row is { key: keyof CalendarLayerFilters; label: string } =>
          row !== null
      ),
    [hasCommunityContent, hasDateBasedTasks, anyHolidayCategoryEnabled]
  );

  // FIXED: linked (shared) events for the displayed month — shown as dots alongside personal events
  const linkedEvents =
    useQuery(
      api.linkedEvents.getLinkedEventsForSpace,
      spaceId
        ? {
            spaceId: spaceId as Id<'spaces'>,
            from: monthRange.from,
            to: monthRange.to,
          }
        : 'skip'
    ) ?? [];

  // === Calendar grid data ===
  const grid = useMemo(() => {
    if (isFiltered) {
      // Community filter active — suppress personal event dots
      return generateCalendarGrid(displayYear, displayMonth, {});
    }
    if (
      personalEvents.length === 0 &&
      linkedEvents.length === 0 &&
      aggregateCommunityEvents.length === 0
    ) {
      // No personal events (or still loading) — fall back to empty dots
      return generateCalendarGrid(displayYear, displayMonth, {});
    }
    // Build real event markers keyed by day-of-month
    const eventsByDay: Record<number, CalendarEvent[]> = {};
    for (const ev of personalEvents) {
      const d = new Date(ev.startTime);
      if (d.getFullYear() !== displayYear || d.getMonth() !== displayMonth)
        continue;
      const day = d.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      const isSavedCommunityInSpace = Boolean(ev.communityId);
      const evS = ev as {
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
      const calGridUserId = currentUser?._id as string | undefined;
      const isViewerCreator = isSavedCommunityInSpace
        ? undefined
        : !!calGridUserId && evS.createdBy === calGridUserId;

      // Profile circles for compact personal event cards in the day list
      let gridPc: ProfileCircle[] = [];
      let gridPcExtra = 0;
      let gridPcContext: 'sharedWith' | 'alsoAddedToCalendar' = 'sharedWith';
      if (isSavedCommunityInSpace) {
        gridPc = familyAllSaved[ev._id as string] ?? [];
        gridPcContext = 'alsoAddedToCalendar';
      } else {
        const totalParticipants = evS.participants?.length ?? 0;
        if (isViewerCreator) {
          if (evS.allFamily) {
            gridPc = [...familyProfilesByMemberId.values()];
            gridPcExtra = Math.max(0, totalParticipants - gridPc.length);
          } else {
            const resolved = evS.sharedMemberProfiles ?? [];
            for (const p of resolved) {
              if (p.isViewer) continue;
              gridPc.push({ id: p.id, name: p.displayName, color: p.color });
            }
            const familyCount = (evS.sharedWithFamilyMemberIds ?? []).length;
            gridPcExtra = Math.max(0, totalParticipants - familyCount);
          }
        } else {
          const resolved = evS.sharedMemberProfiles ?? [];
          const creatorId = evS.createdBy;
          const circles: ProfileCircle[] = [];
          if (creatorId) {
            const cp =
              familyProfilesByUserId.get(creatorId) ??
              familyProfilesByMemberId.get(creatorId);
            if (cp) circles.push(cp);
          }
          for (const p of resolved) {
            if (p.isViewer) continue;
            circles.push({ id: p.id, name: p.displayName, color: p.color });
          }
          const externalCount = Math.max(
            0,
            totalParticipants - (evS.sharedWithFamilyMemberIds?.length ?? 0)
          );
          gridPc = circles;
          gridPcExtra = externalCount;
        }
      }

      const personalRow = {
        id: ev._id,
        listKey: `${ev._id}-personal`,
        title: ev.title,
        time: ev.allDay
          ? ''
          : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        category: isSavedCommunityInSpace ? 'קהילה' : 'אישי',
        categoryColor: isSavedCommunityInSpace ? '#36a9e2' : PRIMARY_BLUE,
        communityId: ev.communityId,
        assigneeColors: [],
        sourceType: 'event' as const,
        communityName: ev.communityName,
        sortTimeMs: ev.startTime,
        eventVisualKind: isSavedCommunityInSpace
          ? ('community' as const)
          : ('personal' as const),
        isViewerCreator,
        cancelled: (ev as { status?: string }).status === 'cancelled',
        // pendingPersonalInvite = true for explicit personal invitees (not allFamily)
        // who haven't confirmed attendance ('yes') — drives card muting and badge.
        // Uses same invitee detection as EventDetailsBottomSheet:
        //   sharedWithUserIds includes currentUserId
        //   OR sharedWithFamilyMemberIds includes viewerSelfEntityId
        pendingPersonalInvite: (() => {
          if (isSavedCommunityInSpace || isViewerCreator !== false)
            return undefined;
          const gridViewerSelfEntityId = familyContacts?.selfEntityId as
            | string
            | undefined;
          const isExplicitInvitee =
            (calGridUserId != null &&
              (evS.sharedWithUserIds ?? []).includes(calGridUserId)) ||
            (gridViewerSelfEntityId != null &&
              (evS.sharedWithFamilyMemberIds ?? []).includes(
                gridViewerSelfEntityId
              ));
          if (!isExplicitInvitee) return undefined;
          const s = myRsvpByEventId.get(String(ev._id)) as
            | 'yes'
            | 'maybe'
            | 'no'
            | 'none'
            | undefined;
          return s !== 'yes' ? true : undefined;
        })(),
        myPersonalRsvpStatus: (() => {
          if (isSavedCommunityInSpace || isViewerCreator !== false)
            return undefined;
          const gridViewerSelfEntityId = familyContacts?.selfEntityId as
            | string
            | undefined;
          const isExplicitInvitee =
            (calGridUserId != null &&
              (evS.sharedWithUserIds ?? []).includes(calGridUserId)) ||
            (gridViewerSelfEntityId != null &&
              (evS.sharedWithFamilyMemberIds ?? []).includes(
                gridViewerSelfEntityId
              ));
          if (!isExplicitInvitee) return undefined;
          const s = myRsvpByEventId.get(String(ev._id)) as
            | 'yes'
            | 'maybe'
            | 'no'
            | 'none'
            | undefined;
          return s ?? 'none';
        })(),
        profileCircles: gridPc.length > 0 ? gridPc : undefined,
        profileCirclesExtraCount: gridPcExtra > 0 ? gridPcExtra : undefined,
        profileCirclesContext: gridPcContext,
        importantItems: isSavedCommunityInSpace
          ? (() => {
              const rawItems = (ev as { importantItems?: ImportantItem[] })
                .importantItems;
              return rawItems && rawItems.length > 0 ? rawItems : undefined;
            })()
          : undefined,
        // FIX — Monthly/Timeline parity: only ever MY assigned Community
        // Event tasks (server query already scopes to the viewer).
        myAssignedTasks: isSavedCommunityInSpace
          ? monthTasksByEventId[ev._id as string]
          : undefined,
      };
      if (!eventsByDay[day].some((e) => e.id === personalRow.id)) {
        eventsByDay[day].push(personalRow);
      }
    }
    // FIXED: add linked event dots with a distinct teal-blue shade
    for (const ev of linkedEvents) {
      const d = new Date(ev.startTime);
      if (d.getFullYear() !== displayYear || d.getMonth() !== displayMonth)
        continue;
      const day = d.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      const linkedRow = {
        id: ev._id,
        listKey: `${ev._id}-linked`,
        title: ev.title,
        time: ev.allDay
          ? ''
          : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        category: 'משותף',
        categoryColor: '#0284c7',
        assigneeColors: [],
        cancelled: ev.sourceStatus === 'cancelled',
        sourceType: 'linked' as const,
        sortTimeMs: ev.startTime,
        eventVisualKind: 'shared' as const,
      };
      if (!eventsByDay[day].some((e) => e.id === linkedRow.id)) {
        eventsByDay[day].push(linkedRow);
      }
    }
    for (const ev of aggregateCommunityEvents) {
      const d = new Date(ev.startTime);
      if (d.getFullYear() !== displayYear || d.getMonth() !== displayMonth)
        continue;
      const day = d.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      const communityRow = {
        id: ev._id,
        listKey: `${ev._id}-community`,
        title: ev.title,
        time: ev.allDay
          ? ''
          : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        category: 'קהילה',
        categoryColor: '#36a9e2',
        communityId: ev.communityId,
        assigneeColors: [],
        sourceType: 'event' as const,
        communityName: ev.communityName,
        sortTimeMs: ev.startTime,
        eventVisualKind: 'community' as const,
        importantItems:
          ev.importantItems && ev.importantItems.length > 0
            ? ev.importantItems
            : undefined,
        // FIX — Monthly/Timeline parity — see personalRow comment above.
        myAssignedTasks: monthTasksByEventId[ev._id as string],
      };
      if (!eventsByDay[day].some((e) => e.id === communityRow.id)) {
        eventsByDay[day].push(communityRow);
      }
    }
    for (const k of Object.keys(eventsByDay)) {
      const di = Number(k);
      eventsByDay[di].sort((a, b) => (a.sortTimeMs ?? 0) - (b.sortTimeMs ?? 0));
    }
    return generateCalendarGrid(displayYear, displayMonth, eventsByDay);
  }, [
    displayYear,
    displayMonth,
    isFiltered,
    personalEvents,
    linkedEvents,
    aggregateCommunityEvents,
    monthTasksByEventId,
    currentUser?._id,
    familyProfilesByUserId,
    familyProfilesByMemberId,
    familyAllSaved,
    myRsvpByEventId,
    familyContacts?.selfEntityId,
  ]);

  // === Filtered grid (Phase 2A layer chips) ===
  // Structural shape is identical to `grid` — only events within each day are filtered.
  // Community events are identified by `communityId` being set (non-nullish).
  const filteredGrid = useMemo(() => {
    if (layerFilters.showCommunity) return grid;
    return grid.map((week) =>
      week.map((day) => ({
        ...day,
        events: day.events.filter((ev) => !ev.communityId),
      }))
    );
  }, [grid, layerFilters.showCommunity]);

  // === Holiday overlay (Phase 2B Step 4A) ===
  // Compute the inclusive date range that exactly covers the visible monthly grid,
  // including leading days from the previous month and trailing days from the next.
  const holidayGridRange = useMemo(() => {
    const firstDayOffset = getFirstDayOfMonth(displayYear, displayMonth);
    // Grid start = first cell (may be in prev month when firstDayOffset > 0).
    // new Date(year, month, day) is local — no timezone shift.
    const startD = new Date(displayYear, displayMonth, 1 - firstDayOffset);

    // Total visible cells: 5 or 6 rows × 7 days, matching generateCalendarGrid logic.
    const daysInMonth = getDaysInMonth(displayYear, displayMonth);
    const rawCount = firstDayOffset + daysInMonth;
    const totalCells = rawCount <= 35 ? 35 : 42;
    // Trim 6th row if all its days would be from next month (mirrors generateCalendarGrid).
    // We use grid.length if available — it already has this trimming applied.
    const visibleCells = grid.length > 0 ? grid.length * 7 : totalCells;

    const endD = new Date(
      startD.getFullYear(),
      startD.getMonth(),
      startD.getDate() + visibleCells - 1
    );

    const fmt = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    return { startDate: fmt(startD), endDate: fmt(endD) };
  }, [displayYear, displayMonth, grid.length]);

  // Derive YYYY-MM-DD range from timelineRange timestamps (local time, no toISOString()).
  const timelineHolidayRange = useMemo(() => {
    const fromD = new Date(timelineRange.from);
    const toD = new Date(timelineRange.to);
    const fmtLocal = (d2: Date): string =>
      `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}-${String(d2.getDate()).padStart(2, '0')}`;
    return { startDate: fmtLocal(fromD), endDate: fmtLocal(toD) };
  }, [timelineRange]);

  // Single active holiday range: monthly grid in monthly mode, full timeline window
  // in timeline mode. One hook call covers both — no duplicate provider work occurs.
  const activeHolidayRange =
    viewMode === 'monthly' ? holidayGridRange : timelineHolidayRange;

  // Call useHolidayOverlay unconditionally; pass empty categories when holidays
  // are not enabled or are hidden via the master filter, so the hook does no work.
  const { items: holidayItems } = useHolidayOverlay({
    startDate: activeHolidayRange.startDate,
    endDate: activeHolidayRange.endDate,
    enabledCategories:
      anyHolidayCategoryEnabled && layerFilters.showHolidays
        ? holidayPreferences.enabledCategories
        : [],
  });

  // Build a per-date map of HolidayOverlayItem[].
  // Multi-day items appear on every local date from startDate through endDateInclusive.
  // No timezone shifts: dates are parsed as numeric year/month/day → local Date.
  // Duplicates by item.id on the same date are prevented.
  const holidaysByDay = useMemo((): Record<string, HolidayOverlayItem[]> => {
    const result: Record<string, HolidayOverlayItem[]> = {};

    for (const item of holidayItems) {
      const endStr = item.endDateInclusive ?? item.startDate;

      // Parse YYYY-MM-DD as local date — never use new Date("YYYY-MM-DD") or toISOString().
      const [sy, sm, sd] = item.startDate.split('-').map(Number);
      const [ey, em, ed] = endStr.split('-').map(Number);
      const startD = new Date(sy, sm - 1, sd);
      const endD = new Date(ey, em - 1, ed);

      let cur = new Date(startD);
      while (cur <= endD) {
        const curY = cur.getFullYear();
        const curM = String(cur.getMonth() + 1).padStart(2, '0');
        const curDay = String(cur.getDate()).padStart(2, '0');
        const key = `${curY}-${curM}-${curDay}`;

        if (!result[key]) result[key] = [];
        // Prevent duplicates by stable item id.
        if (!result[key].some((h) => h.id === item.id)) {
          result[key].push(item);
        }

        // Advance by one local day without timezone shifts.
        cur = new Date(curY, cur.getMonth(), cur.getDate() + 1);
      }
    }

    return result;
  }, [holidayItems]);

  // === Dynamic panel heights ===
  const compactPanelHeight =
    PANEL_FIXED_HEIGHT +
    grid.length * COMPACT_ROW_HEIGHT +
    CALENDAR_HANDLE_HEIGHT;
  const expandedPanelHeight =
    monthlyViewportHeight > 0
      ? Math.max(compactPanelHeight, monthlyViewportHeight)
      : Math.max(compactPanelHeight, Math.round(screenHeight * 0.58));
  const expandedWeekBaseHeight = useMemo((): number | undefined => {
    if (monthlyViewportHeight <= 0 || grid.length === 0) return undefined;

    const expandedGridChromeHeight = 52;
    const availableGridHeight = Math.max(
      0,
      monthlyViewportHeight - expandedGridChromeHeight
    );

    return Math.max(72, Math.floor(availableGridHeight / grid.length));
  }, [grid.length, monthlyViewportHeight]);

  const calendarHeight = useSharedValue(compactPanelHeight);
  const savedHeight = useSharedValue(compactPanelHeight);
  const compactHeightSV = useSharedValue(compactPanelHeight);
  const expandedHeightSV = useSharedValue(expandedPanelHeight);
  const [snapState, setSnapState] = useState<SnapState>('compact');
  const isExpanded = snapState === 'expanded';

  // Week-only collapse: collapses the month grid to the selected week row.
  const [isWeekCollapsed, setIsWeekCollapsed] = useState(false);
  // Guard ref: prevents firing collapse/expand state changes on every scroll frame.
  const weekCollapseGuard = useRef(false);

  // Which grid row index contains selectedDay (for week-only rendering).
  const selectedWeekIndex = useMemo(() => {
    if (selectedDay == null) return -1;
    return grid.findIndex((week) =>
      week.some((d) => d.day === selectedDay && d.isCurrentMonth)
    );
  }, [grid, selectedDay]);

  // Reset week-collapse and guard when the selected day is cleared.
  useEffect(() => {
    if (selectedDay == null) {
      setIsWeekCollapsed(false);
      weekCollapseGuard.current = false;
    }
  }, [selectedDay]);

  // Sync shared values when month or viewport changes.
  // isWeekCollapsed must be included so that any layout remeasure that triggers
  // this effect (e.g. the content View's onLayout firing on tab-focus return)
  // does not silently reset calendarHeight from WEEK_ONLY_PANEL_HEIGHT back to
  // compactPanelHeight while the grid is still showing only one week row.
  useEffect(() => {
    compactHeightSV.value = compactPanelHeight;
    expandedHeightSV.value = expandedPanelHeight;
    const targetHeight = isWeekCollapsed
      ? WEEK_ONLY_PANEL_HEIGHT
      : snapState === 'expanded'
        ? expandedPanelHeight
        : compactPanelHeight;
    calendarHeight.value = withSpring(targetHeight, {
      damping: 20,
      stiffness: 90,
    });
  }, [
    compactPanelHeight,
    expandedPanelHeight,
    calendarHeight,
    compactHeightSV,
    expandedHeightSV,
    isWeekCollapsed,
    snapState,
  ]);

  // === Day events list animation (lifted from MonthlyGrid) ===
  const isShowingListRef = useRef(selectedDay != null);
  const [visibleDay, setVisibleDay] = useState<number | null>(selectedDay);
  const listAnim = useRef(
    new Animated.Value(selectedDay != null ? 1 : 0)
  ).current;

  useEffect(() => {
    if (selectedDay != null) {
      setVisibleDay(selectedDay);
      if (!isShowingListRef.current) {
        listAnim.setValue(0);
        Animated.timing(listAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
      isShowingListRef.current = true;
    } else {
      Animated.timing(listAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setVisibleDay(null);
      });
      isShowingListRef.current = false;
    }
  }, [selectedDay, listAnim]);

  const visibleDayData = useMemo((): CalendarDay | null => {
    if (visibleDay == null) return null;
    for (const week of filteredGrid) {
      for (const d of week) {
        if (d.day === visibleDay && d.isCurrentMonth) return d;
      }
    }
    return null;
  }, [filteredGrid, visibleDay]);

  const sheetDayData = useMemo((): CalendarDay | null => {
    if (daySheetDay == null) return null;
    for (const week of filteredGrid) {
      for (const d of week) {
        if (d.day === daySheetDay && d.isCurrentMonth) return d;
      }
    }
    return null;
  }, [filteredGrid, daySheetDay]);

  const daySheetLabel = useMemo((): string => {
    if (sheetDayData == null) return '';
    return getHebrewCalendarDayLabel(
      displayYear,
      displayMonth,
      sheetDayData.day
    );
  }, [sheetDayData, displayYear, displayMonth]);

  /** Tasks for the compact below-grid day panel */
  const visibleDayTasks = useMemo((): CalendarDayTask[] => {
    if (visibleDay == null) return [];
    if (!layerFilters.showTasks) return [];
    const nowMs = Date.now();
    const currentUserId = currentUser?._id as string | undefined;
    return calendarPersonalTasks
      .filter((t) => {
        if (t.dueDate == null) return false;
        // Hide community tasks when קהילות chip is OFF (stable: communityId set)
        if (!layerFilters.showCommunity && t.communityId) return false;
        const d = new Date(t.dueDate);
        return (
          d.getFullYear() === displayYear &&
          d.getMonth() === displayMonth &&
          d.getDate() === visibleDay
        );
      })
      .map((t) => {
        const assigneeDisplays = resolveAllNonSelfAssigneesCalendar(
          t,
          currentUserId,
          memberMaps.byUserId,
          memberMaps.byMemberId,
          memberMaps.selfEntityId
        );
        return {
          id: `task:${t._id}`,
          title: t.title,
          time:
            t.hasTime && t.dueAt
              ? `${String(new Date(t.dueAt).getHours()).padStart(2, '0')}:${String(new Date(t.dueAt).getMinutes()).padStart(2, '0')}`
              : '',
          isOverdue: calcTaskOverdue(t.dueDate ?? 0, t.dueAt, t.hasTime, nowMs),
          assigneeInitials: assigneeDisplays[0]?.initials,
          assigneeColor: assigneeDisplays[0]?.color,
          assigneeDisplays:
            assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
          subtasks: (t.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
          })),
          typeLabel: getCalendarTaskTypeLabel(t),
          communityName: t.communityName,
        };
      });
  }, [
    calendarPersonalTasks,
    visibleDay,
    displayYear,
    displayMonth,
    currentUser,
    memberMaps,
    layerFilters.showTasks,
    layerFilters.showCommunity,
  ]);

  /** Tasks for the expanded day-sheet modal */
  const sheetDayTasks = useMemo((): CalendarDayTask[] => {
    if (daySheetDay == null) return [];
    if (!layerFilters.showTasks) return [];
    const nowMs = Date.now();
    const currentUserId = currentUser?._id as string | undefined;
    return calendarPersonalTasks
      .filter((t) => {
        if (t.dueDate == null) return false;
        // Hide community tasks when קהילות chip is OFF (stable: communityId set)
        if (!layerFilters.showCommunity && t.communityId) return false;
        const d = new Date(t.dueDate);
        return (
          d.getFullYear() === displayYear &&
          d.getMonth() === displayMonth &&
          d.getDate() === daySheetDay
        );
      })
      .map((t) => {
        const assigneeDisplays = resolveAllNonSelfAssigneesCalendar(
          t,
          currentUserId,
          memberMaps.byUserId,
          memberMaps.byMemberId,
          memberMaps.selfEntityId
        );
        return {
          id: `task:${t._id}`,
          title: t.title,
          time:
            t.hasTime && t.dueAt
              ? `${String(new Date(t.dueAt).getHours()).padStart(2, '0')}:${String(new Date(t.dueAt).getMinutes()).padStart(2, '0')}`
              : '',
          isOverdue: calcTaskOverdue(t.dueDate ?? 0, t.dueAt, t.hasTime, nowMs),
          assigneeInitials: assigneeDisplays[0]?.initials,
          assigneeColor: assigneeDisplays[0]?.color,
          assigneeDisplays:
            assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
          subtasks: (t.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
          })),
          typeLabel: getCalendarTaskTypeLabel(t),
          communityName: t.communityName,
        };
      });
  }, [
    calendarPersonalTasks,
    daySheetDay,
    displayYear,
    displayMonth,
    currentUser,
    memberMaps,
    layerFilters.showTasks,
    layerFilters.showCommunity,
  ]);

  /**
   * Raw task IDs per day-of-month for the current display month.
   * Used by expanded DayCells to directly open a single task without going
   * through the day-sheet when it is the only visible item on that day.
   * Respects the same filter flags as filteredCalendarTasksByDay.
   */
  const filteredTaskIdsByDay = useMemo((): Record<number, string[]> => {
    if (!layerFilters.showTasks) return {};
    const map: Record<number, string[]> = {};
    for (const t of calendarPersonalTasks) {
      if (t.dueDate == null) continue;
      if (!layerFilters.showCommunity && t.communityId) continue;
      const d = new Date(t.dueDate);
      if (d.getFullYear() !== displayYear || d.getMonth() !== displayMonth)
        continue;
      const day = d.getDate();
      if (!map[day]) map[day] = [];
      map[day].push(`task:${t._id}`);
    }
    return map;
  }, [
    calendarPersonalTasks,
    displayYear,
    displayMonth,
    layerFilters.showTasks,
    layerFilters.showCommunity,
  ]);

  /** Holidays for the expanded day-sheet modal — pre-computed to reuse in visible condition. */
  const sheetDayHolidays = useMemo((): HolidayOverlayItem[] => {
    if (daySheetDay == null) return [];
    const key = `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}-${String(daySheetDay).padStart(2, '0')}`;
    return holidaysByDay[key] ?? [];
  }, [daySheetDay, displayYear, displayMonth, holidaysByDay]);

  // Resets week-collapse state + guard — called from pan gesture and snap toggle.
  const resetWeekCollapse = useCallback((): void => {
    setIsWeekCollapsed(false);
    weekCollapseGuard.current = false;
  }, []);

  // === Tap-to-toggle for the arrow handle ===
  const toggleCalendarSnap = useCallback((): void => {
    // Always clear week-only mode when toggling the main snap
    resetWeekCollapse();

    const nextState: SnapState =
      snapState === 'expanded' ? 'compact' : 'expanded';
    const targetHeight =
      nextState === 'expanded' ? expandedHeightSV.value : compactHeightSV.value;

    calendarHeight.value = withSpring(targetHeight, {
      damping: 22,
      stiffness: 120,
    });

    setSnapState(nextState);
  }, [
    calendarHeight,
    compactHeightSV,
    expandedHeightSV,
    resetWeekCollapse,
    snapState,
  ]);

  // === Scroll-triggered week-collapse for the selected-day panel ===
  // Collapse-only: scrolling down > 20px collapses the month grid to the
  // selected week. Expansion back to full month is handled exclusively by the
  // pan/handle gesture — never by scroll returning to the top.
  const handleDayListScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }): void => {
      const y = event.nativeEvent.contentOffset.y;
      if (y > 20 && selectedDay != null && !weekCollapseGuard.current) {
        weekCollapseGuard.current = true;
        setIsWeekCollapsed(true);
        calendarHeight.value = withSpring(WEEK_ONLY_PANEL_HEIGHT, {
          damping: 22,
          stiffness: 120,
        });
      }
    },
    [selectedDay, calendarHeight]
  );

  // === Pan gesture for the bottom arrow handle only ===
  // drag DOWN (positive translationY) = expand, drag UP = collapse
  const panGesture = Gesture.Pan()
    .activeOffsetY([-4, 4])
    .failOffsetX([-48, 48])
    .onBegin(() => {
      'worklet';
      savedHeight.value = calendarHeight.value;
    })
    .onUpdate((event) => {
      'worklet';
      const newHeight = savedHeight.value + event.translationY;
      // When starting from week-only (below compact), allow smooth dragging
      // upward from that smaller height rather than clamping to compact.
      const minH =
        savedHeight.value < compactHeightSV.value
          ? savedHeight.value
          : compactHeightSV.value;
      calendarHeight.value = Math.max(
        minH,
        Math.min(expandedHeightSV.value, newHeight)
      );
    })
    .onEnd((event) => {
      'worklet';
      const currentHeight = calendarHeight.value;
      const compact = compactHeightSV.value;
      const expanded = expandedHeightSV.value;

      let targetHeight: number;

      // Detect if the drag started from week-only (height well below compact).
      const startedWeekOnly = savedHeight.value < compact - 4;

      if (startedWeekOnly) {
        // Any downward drag from week-only restores the full-month compact view.
        // A big drag / fast flick goes straight to expanded.
        if (
          event.translationY > OPEN_DRAG_DISTANCE ||
          event.velocityY > SNAP_VELOCITY
        ) {
          targetHeight = expanded;
        } else {
          targetHeight = compact;
        }
      } else {
        const midpoint = compact + (expanded - compact) * 0.35;
        const startedCompact = savedHeight.value <= compact + 4;
        const startedExpanded = savedHeight.value >= expanded - 4;

        if (
          startedCompact &&
          (event.translationY > OPEN_DRAG_DISTANCE ||
            event.velocityY > SNAP_VELOCITY)
        ) {
          targetHeight = expanded;
        } else if (
          startedExpanded &&
          (event.translationY < -CLOSE_DRAG_DISTANCE ||
            event.velocityY < -SNAP_VELOCITY)
        ) {
          targetHeight = compact;
        } else {
          targetHeight = currentHeight >= midpoint ? expanded : compact;
        }
      }

      calendarHeight.value = withSpring(targetHeight, {
        damping: 22,
        stiffness: 120,
      });

      const newState: SnapState =
        targetHeight === compact ? 'compact' : 'expanded';
      runOnJS(setSnapState)(newState);
      // Pan always restores full-month view, so clear week-only mode + guard.
      runOnJS(resetWeekCollapse)();
    });

  const animatedCalendarStyle = useAnimatedStyle(() => ({
    height: calendarHeight.value,
  }));

  // === View mode persistence ===
  const loadViewMode = useCallback(async () => {
    try {
      const saved = await AsyncStorage.getItem('@calendar_view_mode');
      if (saved === 'timeline' || saved === 'monthly') {
        setViewMode(saved);
        Animated.timing(slideAnim, {
          toValue: saved === 'timeline' ? 1 : 0,
          duration: 0,
          useNativeDriver: false,
        }).start();
      }
    } catch (_error) {
      // Silently handle storage read failure
    }
  }, [slideAnim]);

  useEffect(() => {
    loadViewMode();
  }, [loadViewMode]);

  // Restore calendar context when returning from Create Event with explicit params.
  // Fires whenever the return params change (i.e., after router.replace back here).
  useEffect(() => {
    if (!returnView) return;

    if (returnView === 'timeline') {
      setViewMode('timeline');
      slideAnim.setValue(1);
    } else if (returnView === 'month') {
      setViewMode('monthly');
      slideAnim.setValue(0);

      const shouldBeCollapsed = returnCollapsed !== 'false';
      setSnapState(shouldBeCollapsed ? 'compact' : 'expanded');

      if (returnMonth) {
        const parts = returnMonth.split('-');
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        if (!Number.isNaN(y) && !Number.isNaN(m) && m >= 1 && m <= 12) {
          setMonthlyVisibleDate(new Date(y, m - 1, 1));
        }
      }

      if (returnDate) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(returnDate);
        if (match) {
          const d = Number(match[3]);
          if (d >= 1 && d <= 31) setSelectedDay(d);
        }
      }
    }
    // slideAnim is a stable Animated.Value instance (from useState) — it never
    // changes, so including it in deps does not add unwanted re-runs.
  }, [returnView, returnDate, returnMonth, returnCollapsed, slideAnim]);

  const saveViewMode = async (mode: 'timeline' | 'monthly'): Promise<void> => {
    try {
      await AsyncStorage.setItem('@calendar_view_mode', mode);
    } catch (_error) {
      // Silently handle storage write failure
    }
  };

  const handleViewModeChange = (mode: 'timeline' | 'monthly'): void => {
    // Prevent switching to monthly view when community filter is active
    if (isFiltered && mode === 'monthly') return;

    // TEMP PERF
    console.log('[PERF] tab-switch to', mode, Date.now());
    setEventEditMenu(null);
    setDaySheetDay(null);
    setIsMonthPickerVisible(false);
    setViewMode(mode);
    saveViewMode(mode);

    Animated.spring(slideAnim, {
      toValue: mode === 'timeline' ? 1 : 0,
      useNativeDriver: false,
      tension: 100,
      friction: 10,
    }).start();
  };

  const headerMonth =
    viewMode === 'monthly'
      ? `${HEBREW_MONTHS[displayMonth]} ${displayYear}`
      : `${HEBREW_MONTHS[today.getMonth()]} ${today.getFullYear()}`;

  const hebrewMonthRange = useMemo(() => {
    const y = viewMode === 'monthly' ? displayYear : today.getFullYear();
    const m = viewMode === 'monthly' ? displayMonth : today.getMonth();
    return getHebrewMonthRangeForGregorianMonth(y, m);
  }, [viewMode, displayYear, displayMonth, today]);

  const goToPrevMonth = useCallback((): void => {
    setDaySheetDay(null);
    setEventEditMenu(null);
    setMonthlyVisibleDate(
      (currentDate) =>
        new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
    );
    setSelectedDay(null);
  }, []);

  const goToNextMonth = useCallback((): void => {
    setDaySheetDay(null);
    setEventEditMenu(null);
    setMonthlyVisibleDate(
      (currentDate) =>
        new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
    );
    setSelectedDay(null);
  }, []);

  const handleMonthPickerConfirm = useCallback(
    (month: number, year: number): void => {
      setIsMonthPickerVisible(false);
      setDaySheetDay(null);
      setEventEditMenu(null);
      setMonthlyVisibleDate(new Date(year, month, 1));
      setSelectedDay(null);
    },
    []
  );

  const applyMonthSwipe = useCallback(
    (translationX: number, velocityX: number) => {
      if (isFiltered || viewMode !== 'monthly') return;
      if (
        translationX <= -MONTH_SWIPE_DISTANCE ||
        velocityX <= -MONTH_SWIPE_VELOCITY
      ) {
        goToNextMonth();
        return;
      }
      if (
        translationX >= MONTH_SWIPE_DISTANCE ||
        velocityX >= MONTH_SWIPE_VELOCITY
      ) {
        goToPrevMonth();
      }
    },
    [goToNextMonth, goToPrevMonth, isFiltered, viewMode]
  );

  const monthSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isFiltered && viewMode === 'monthly')
        .activeOffsetX([-20, 20])
        .failOffsetY([-20, 20])
        .onEnd((e) => {
          runOnJS(applyMonthSwipe)(e.translationX, e.velocityX);
        }),
    [applyMonthSwipe, isFiltered, viewMode]
  );

  const openDayEventsSheet = useCallback((day: number) => {
    setEventEditMenu(null);
    setSelectedDay(day);
    setDaySheetDay(day);
  }, []);

  const closeDayEventsSheet = useCallback(() => {
    setEventEditMenu(null);
    setDaySheetDay(null);
  }, []);

  /**
   * Opens a task's detail sheet directly from an expanded day-cell (single-task day
   * with no other visible items).  The task ID comes prefixed with "task:" — strip it
   * before passing to the sheet state.
   */
  const handleOpenTaskSheetFromCell = useCallback((id: string) => {
    const rawId = id.replace(/^task:/, '');
    setTaskSheetTaskId(rawId);
    setTaskSheetVisible(true);
  }, []);

  const handleExpandedEventNavigate = useCallback(
    (event: CalendarEvent) => {
      const key = event.listKey ?? event.id;
      const guard = longPressGuardRef.current;
      if (guard && guard.key === key && Date.now() < guard.until) {
        longPressGuardRef.current = null;
        return;
      }
      longPressGuardRef.current = null;
      setEventEditMenu(null);
      setDaySheetDay(null);
      handleOpenEventDetails(event);
    },
    [handleOpenEventDetails]
  );

  const handleExpandedEventLongPress = useCallback(
    (event: CalendarEvent, pressEvent: GestureResponderEvent) => {
      const key = event.listKey ?? event.id;
      longPressGuardRef.current = { key, until: Date.now() + 700 };
      if (event.sourceType === 'linked') return;
      // Type B (shared-with-viewer) events: recipient cannot edit or delete
      if (event.isViewerCreator === false) return;

      const x = Math.min(
        Math.max(12, pressEvent.nativeEvent.pageX - EDIT_POPOVER_WIDTH / 2),
        screenWidth - EDIT_POPOVER_WIDTH - 12
      );
      const y = Math.min(
        Math.max(90, pressEvent.nativeEvent.pageY - EDIT_POPOVER_HEIGHT - 10),
        screenHeight - EDIT_POPOVER_HEIGHT - 24
      );

      setEventEditMenu({ event, x, y });
    },
    [screenHeight, screenWidth]
  );

  const handleExpandedEditAction = useCallback(() => {
    if (eventEditMenu == null) return;
    const eventToEdit = eventEditMenu.event;
    setEventEditMenu(null);
    closeDayEventsSheet();
    openEventEditFromCalendar(router, eventToEdit);
  }, [closeDayEventsSheet, eventEditMenu, router]);

  const handleExpandedCreateForDay = useCallback(
    (cellDate: Date) => {
      setEventEditMenu(null);
      if (isExpiredFree) {
        setUpgradeModalVisible(true);
        return;
      }
      const ts = new Date(
        cellDate.getFullYear(),
        cellDate.getMonth(),
        cellDate.getDate(),
        0,
        0,
        0,
        0
      ).getTime();
      const dateStr = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
      const monthStr = `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}`;
      router.push({
        pathname: '/(authenticated)/event/new',
        params: {
          selectedDate: String(ts),
          returnTo: 'calendar',
          sourceView: 'month',
          sourceDate: dateStr,
          sourceMonth: monthStr,
          sourceCollapsed: snapState === 'compact' ? 'true' : 'false',
        },
      } as Parameters<typeof router.push>[0]);
    },
    [router, snapState, displayYear, displayMonth, isExpiredFree]
  );

  // ── Auto-switch to timeline view when community filter is active
  useEffect(() => {
    if (communityId) {
      setViewMode('timeline');
      // Immediately snap — no animation delay since this is initialization
      slideAnim.setValue(1);
    }
  }, [communityId, slideAnim]);

  // ── Build timeline data: use real events when filtering by community
  const timelineData = useMemo(() => {
    // TEMP PERF
    console.log('[PERF] timelineData compute START', Date.now());
    const todayD = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const todayKey = `${todayD.getFullYear()}-${todayD.getMonth()}-${todayD.getDate()}`;
    const todayLabel = getCachedDayLabel(todayD);

    if (!isFiltered) {
      // Personal + community around today for independent timeline browsing
      if (
        timelinePersonalEvents.length === 0 &&
        timelineCommunityEvents.length === 0
      ) {
        return [];
      }

      const grouped: Record<
        string,
        {
          dayLabel: string;
          dayNumber: string;
          isToday: boolean;
          events: TimelineEventRow[];
          sortKey: number;
        }
      > = {};

      for (const event of timelinePersonalEvents) {
        const d = new Date(event.startTime);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const isToday =
          d.getFullYear() === todayD.getFullYear() &&
          d.getMonth() === todayD.getMonth() &&
          d.getDate() === todayD.getDate();

        if (!grouped[key]) {
          grouped[key] = {
            dayLabel: getCachedDayLabel(d),
            dayNumber: String(d.getDate()),
            isToday,
            events: [],
            sortKey: d.getTime(),
          };
        }

        const timeStr = event.allDay
          ? ''
          : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

        // Same event id can appear only once per day (mirrors grid dedupe vs community merge)
        if (grouped[key].events.some((e) => e.id === event._id)) {
          continue;
        }

        const isSavedCommunityInSpace = Boolean(event.communityId);
        const endD1 = event.endTime ? new Date(event.endTime) : null;
        const myTasks1 = timelineTasksByEventId[event._id];
        const rawImportantItems1 = (
          event as { importantItems?: ImportantItem[] }
        ).importantItems;

        // Profile circles for personal events
        let pc1: ProfileCircle[] = [];
        let pc1Extra = 0;
        let pc1Context: 'sharedWith' | 'alsoAddedToCalendar' = 'sharedWith';
        let pendingPersonalInvite1: boolean | undefined;
        let myPersonalRsvpStatus1: 'yes' | 'maybe' | 'no' | 'none' | undefined;
        if (isSavedCommunityInSpace) {
          pc1 = familyAllSaved[event._id as string] ?? [];
          pc1Context = 'alsoAddedToCalendar';
        } else {
          const evS = event as {
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
          const calCurrentUserId = currentUser?._id as string | undefined;
          const isCreator =
            !!calCurrentUserId && evS.createdBy === calCurrentUserId;
          if (!isCreator) {
            // Use same invitee detection as EventDetailsBottomSheet:
            //   sharedWithUserIds includes currentUserId
            //   OR sharedWithFamilyMemberIds includes viewerSelfEntityId
            const tlViewerSelfEntityId = familyContacts?.selfEntityId as
              | string
              | undefined;
            const isExplicitInvitee1 =
              (calCurrentUserId != null &&
                (evS.sharedWithUserIds ?? []).includes(calCurrentUserId)) ||
              (tlViewerSelfEntityId != null &&
                (evS.sharedWithFamilyMemberIds ?? []).includes(
                  tlViewerSelfEntityId
                ));
            if (isExplicitInvitee1) {
              const myStatus = myRsvpByEventId.get(String(event._id)) as
                | 'yes'
                | 'maybe'
                | 'no'
                | 'none'
                | undefined;
              myPersonalRsvpStatus1 = myStatus ?? 'none';
              // pendingPersonalInvite drives card muting + badge for all non-yes statuses
              if (myPersonalRsvpStatus1 !== 'yes')
                pendingPersonalInvite1 = true;
            }
          }
          const totalParticipants = evS.participants?.length ?? 0;

          if (isCreator) {
            // Creator's view: show selected family recipients.
            // Uses server-resolved sharedMemberProfiles so display is reliable
            // even if the local map has a key mismatch.
            if (evS.allFamily) {
              // Use byMemberId so manual family members (entity rows with no
              // matchedUserId) are included alongside app-user family members.
              // selfEntityId is already excluded from familyProfilesByMemberId.
              pc1 = [...familyProfilesByMemberId.values()];
              pc1Extra = Math.max(0, totalParticipants - pc1.length);
            } else {
              const resolved = evS.sharedMemberProfiles ?? [];
              for (const p of resolved) {
                // Safety: never show the current viewer's own circle.
                if (p.isViewer) continue;
                pc1.push({ id: p.id, name: p.displayName, color: p.color });
              }
              const familyCount = (evS.sharedWithFamilyMemberIds ?? []).length;
              pc1Extra = Math.max(0, totalParticipants - familyCount);
            }
          } else {
            // Recipient's view: show the creator's circle + all other recipients.
            // Other-recipient circles come from server-resolved sharedMemberProfiles
            // (cross-space safe). The isViewer flag skips the current viewer's circle.
            const resolved = evS.sharedMemberProfiles ?? [];
            const creatorId = evS.createdBy;
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
              totalParticipants - (evS.sharedWithFamilyMemberIds?.length ?? 0)
            );
            // Pass all circles unsliced; ProfileCircles handles maxVisible cap.
            pc1 = circles;
            pc1Extra = externalCount;
          }
        }

        grouped[key].events.push({
          id: event._id,
          category: isSavedCommunityInSpace ? 'קהילה' : 'אישי',
          categoryColor: isSavedCommunityInSpace ? '#36a9e2' : PRIMARY_BLUE,
          title: event.title,
          time: timeStr,
          endTime: endD1
            ? `${String(endD1.getHours()).padStart(2, '0')}:${String(endD1.getMinutes()).padStart(2, '0')}`
            : undefined,
          location: event.location ?? '',
          locationUrl: (event as { locationUrl?: string }).locationUrl,
          icon: 'event',
          cancelled: event.status === 'cancelled',
          sourceType: 'event',
          communityName: event.communityName,
          myAssignedTasks:
            myTasks1 && myTasks1.length > 0 ? myTasks1 : undefined,
          importantItems: rawImportantItems1?.length
            ? rawImportantItems1
            : undefined,
          profileCircles: pc1.length > 0 ? pc1 : undefined,
          profileCirclesExtraCount: pc1Extra > 0 ? pc1Extra : undefined,
          profileCirclesContext: pc1Context,
          communityId: event.communityId
            ? String(event.communityId)
            : undefined,
          pendingPersonalInvite: pendingPersonalInvite1,
          myPersonalRsvpStatus: myPersonalRsvpStatus1,
        });
      }

      for (const event of timelineCommunityEvents) {
        const d = new Date(event.startTime);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const isToday =
          d.getFullYear() === todayD.getFullYear() &&
          d.getMonth() === todayD.getMonth() &&
          d.getDate() === todayD.getDate();

        if (!grouped[key]) {
          grouped[key] = {
            dayLabel: getCachedDayLabel(d),
            dayNumber: String(d.getDate()),
            isToday,
            events: [],
            sortKey: d.getTime(),
          };
        }

        const timeStr = event.allDay
          ? ''
          : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

        // Skip if already added from personal list or duplicate community row
        if (grouped[key].events.some((e) => e.id === event._id)) {
          continue;
        }

        const myTasks2 = timelineTasksByEventId[event._id];
        const endD2 = event.endTime ? new Date(event.endTime) : null;
        const rawImportantItems2 = (
          event as { importantItems?: ImportantItem[] }
        ).importantItems;
        const pc2 = familyAllSaved[event._id as string] ?? [];
        grouped[key].events.push({
          id: event._id,
          category: 'קהילה',
          categoryColor: '#36a9e2',
          title: event.title,
          time: timeStr,
          endTime: endD2
            ? `${String(endD2.getHours()).padStart(2, '0')}:${String(endD2.getMinutes()).padStart(2, '0')}`
            : undefined,
          location: event.location ?? '',
          locationUrl: (event as { locationUrl?: string }).locationUrl,
          icon: 'event',
          cancelled: false,
          sourceType: 'event',
          communityName: event.communityName,
          myAssignedTasks:
            myTasks2 && myTasks2.length > 0 ? myTasks2 : undefined,
          importantItems: rawImportantItems2?.length
            ? rawImportantItems2
            : undefined,
          communityId: event.communityId
            ? String(event.communityId)
            : undefined,
          profileCircles: pc2.length > 0 ? pc2 : undefined,
          profileCirclesContext: 'alsoAddedToCalendar',
        });
      }

      // Personal tasks — inserted on their original dueDate (date-truth preserved)
      const nowMs = Date.now();
      for (const t of calendarPersonalTasks) {
        if (t.dueDate == null) continue;
        if (t.dueDate < timelineRange.from || t.dueDate > timelineRange.to)
          continue;

        const d = new Date(t.dueDate);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const isToday =
          d.getFullYear() === todayD.getFullYear() &&
          d.getMonth() === todayD.getMonth() &&
          d.getDate() === todayD.getDate();

        if (!grouped[key]) {
          grouped[key] = {
            dayLabel: getCachedDayLabel(d),
            dayNumber: String(d.getDate()),
            isToday,
            events: [],
            sortKey: d.getTime(),
          };
        }

        const taskId = `task:${t._id}`;
        if (grouped[key].events.some((e) => e.id === taskId)) continue;

        const timeStr =
          t.hasTime && t.dueAt
            ? `${String(new Date(t.dueAt).getHours()).padStart(2, '0')}:${String(new Date(t.dueAt).getMinutes()).padStart(2, '0')}`
            : '';

        const currentUserId = currentUser?._id as string | undefined;
        const assigneeDisplays = resolveAllNonSelfAssigneesCalendar(
          t,
          currentUserId,
          memberMaps.byUserId,
          memberMaps.byMemberId,
          memberMaps.selfEntityId
        );

        grouped[key].events.push({
          id: taskId,
          category: getCalendarTaskTypeLabel(t),
          categoryColor: PRIMARY_BLUE,
          title: t.title,
          time: timeStr,
          location: '',
          icon: 'check-box-outline-blank',
          cancelled: false,
          isPersonalTask: true,
          communityId: t.communityId ? String(t.communityId) : undefined,
          communityName: t.communityName,
          isOverdue: calcTaskOverdue(t.dueDate, t.dueAt, t.hasTime, nowMs),
          subtasks: (t.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
          })),
          assigneeInitials: assigneeDisplays[0]?.initials,
          assigneeColor: assigneeDisplays[0]?.color,
          assigneeDisplays:
            assigneeDisplays.length > 0 ? assigneeDisplays : undefined,
          typeLabel: getCalendarTaskTypeLabel(t),
        });
      }

      // Sort each day group: timed items chronologically, untimed at the bottom
      for (const group of Object.values(grouped)) {
        group.events.sort((a, b) => {
          if (!a.time && !b.time) return 0;
          if (!a.time) return 1;
          if (!b.time) return -1;
          const [ah = 0, am = 0] = a.time.split(':').map(Number);
          const [bh = 0, bm = 0] = b.time.split(':').map(Number);
          return ah * 60 + am - (bh * 60 + bm);
        });
      }

      if (!grouped[todayKey]) {
        grouped[todayKey] = {
          dayLabel: todayLabel,
          dayNumber: String(todayD.getDate()),
          isToday: true,
          events: [],
          sortKey: todayD.getTime(),
        };
      }

      // TEMP PERF
      const _tdResult1 = Object.values(grouped).sort((a, b) => a.sortKey - b.sortKey);
      console.log('[PERF] timelineData compute END', _tdResult1.length, 'groups', Date.now());
      return _tdResult1;
    }

    // Community filter active — show community events only
    if (!communityEvents || communityEvents.length === 0) return [];

    const grouped: Record<
      string,
      {
        dayLabel: string;
        dayNumber: string;
        isToday: boolean;
        events: TimelineEventRow[];
        sortKey: number;
      }
    > = {};

    for (const event of communityEvents) {
      const d = new Date(event.startTime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const isToday =
        d.getFullYear() === todayD.getFullYear() &&
        d.getMonth() === todayD.getMonth() &&
        d.getDate() === todayD.getDate();

      if (!grouped[key]) {
        grouped[key] = {
          dayLabel: getCachedDayLabel(d),
          dayNumber: String(d.getDate()),
          isToday,
          events: [],
          sortKey: event.startTime,
        };
      }
      if (grouped[key].events.some((e) => e.id === event._id)) {
        continue;
      }
      const myTasks3 = timelineTasksByEventId[event._id];
      const endD3 = event.endTime ? new Date(event.endTime) : null;
      const rawImportantItems3 = (event as { importantItems?: ImportantItem[] })
        .importantItems;
      const pc3 = familyAllSaved[event._id as string] ?? [];
      grouped[key].events.push({
        id: event._id,
        category: 'קהילה',
        categoryColor: '#36a9e2',
        title: event.title,
        time: new Date(event.startTime).toLocaleTimeString('he-IL', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        endTime: endD3
          ? `${String(endD3.getHours()).padStart(2, '0')}:${String(endD3.getMinutes()).padStart(2, '0')}`
          : undefined,
        location: event.location ?? '',
        icon: 'event',
        cancelled: event.status === 'cancelled',
        sourceType: 'event',
        communityName: communityData?.name,
        myAssignedTasks: myTasks3 && myTasks3.length > 0 ? myTasks3 : undefined,
        importantItems: rawImportantItems3?.length
          ? rawImportantItems3
          : undefined,
        profileCircles: pc3.length > 0 ? pc3 : undefined,
        profileCirclesContext: 'alsoAddedToCalendar',
      });
    }

    if (!grouped[todayKey]) {
      grouped[todayKey] = {
        dayLabel: todayLabel,
        dayNumber: String(todayD.getDate()),
        isToday: true,
        events: [],
        sortKey: todayD.getTime(),
      };
    }

    // Sort ascending so the list can scroll to past and future around today.
    // TEMP PERF
    const _tdResult2 = Object.values(grouped).sort((a, b) => a.sortKey - b.sortKey);
    console.log('[PERF] timelineData compute END', _tdResult2.length, 'groups', Date.now());
    return _tdResult2;
  }, [
    today,
    isFiltered,
    communityEvents,
    timelinePersonalEvents,
    timelineCommunityEvents,
    communityData?.name,
    timelineTasksByEventId,
    calendarPersonalTasks,
    timelineRange,
    memberMaps,
    currentUser,
    familyProfilesByUserId,
    familyProfilesByMemberId,
    familyAllSaved,
    myRsvpByEventId,
    familyContacts?.selfEntityId,
  ]);

  // === Filtered timeline data (Phase 2A layer chips) ===
  // Applied after `timelineData` is built; does not mutate DB data.
  //
  // Identity rules (stable properties only — no display text):
  //   community item  → ev.communityId is truthy
  //   task item       → ev.isPersonalTask === true
  //   community task  → both are true (caught by either chip being OFF)
  const filteredTimelineData = useMemo(() => {
    const { showCommunity, showTasks } = layerFilters;
    if (showCommunity && showTasks) return timelineData;
    return (
      timelineData
        .map((group) => ({
          ...group,
          events: group.events.filter((ev) => {
            // Community source: communityId is set for community events and for
            // personal events saved from a community (isSavedCommunityInSpace).
            if (!showCommunity && Boolean(ev.communityId)) return false;
            // Task items: covers personal tasks and community tasks.
            // Community tasks are also caught by the rule above when both chips are OFF.
            if (!showTasks && ev.isPersonalTask) return false;
            return true;
          }),
        }))
        // Keep empty today group so the auto-scroll anchor is preserved.
        .filter((group) => group.events.length > 0 || group.isToday)
    );
  }, [timelineData, layerFilters]);

  // Extend filteredTimelineData with holiday-only day groups.
  // Days that have holidays but no events/tasks are inserted so they appear in
  // the timeline when showHolidays is on. When showHolidays is off, holidaysByDay
  // is empty (hook receives [] categories), so no extra groups are added.
  const filteredTimelineDataWithHolidays = useMemo((): TimelineDayGroup[] => {
    // TEMP PERF
    console.log('[PERF] filteredTimelineDataWithHolidays START', Date.now());
    if (viewMode !== 'timeline') return filteredTimelineData;
    const holidayKeys = Object.keys(holidaysByDay);
    if (holidayKeys.length === 0) return filteredTimelineData;

    // Collect dateStr values already present in filteredTimelineData.
    const existingDates = new Set<string>();
    for (const group of filteredTimelineData) {
      const sk = new Date(group.sortKey);
      existingDates.add(
        `${sk.getFullYear()}-${String(sk.getMonth() + 1).padStart(2, '0')}-${String(sk.getDate()).padStart(2, '0')}`
      );
    }

    const extra: TimelineDayGroup[] = [];
    for (const dateKey of holidayKeys) {
      if (existingDates.has(dateKey)) continue;
      // Parse YYYY-MM-DD as local date — never use new Date("YYYY-MM-DD").
      const [yy, mm, dd] = dateKey.split('-').map(Number);
      const dateObj = new Date(yy, mm - 1, dd);
      const dateMs = dateObj.getTime();
      // Guard: only include dates within the actual timeline query window.
      if (dateMs < timelineRange.from || dateMs > timelineRange.to) continue;

      const todayLocal = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const isHolidayToday =
        dateObj.getFullYear() === todayLocal.getFullYear() &&
        dateObj.getMonth() === todayLocal.getMonth() &&
        dateObj.getDate() === todayLocal.getDate();

      extra.push({
        dayLabel: getCachedDayLabel(dateObj),
        dayNumber: String(dateObj.getDate()),
        isToday: isHolidayToday,
        events: [],
        sortKey: dateObj.getTime(),
      });
    }

    if (extra.length === 0) {
      // TEMP PERF
      console.log('[PERF] filteredTimelineDataWithHolidays END (no extra)', Date.now());
      return filteredTimelineData;
    }
    // TEMP PERF
    const _ftwh = [...filteredTimelineData, ...extra].sort(
      (a, b) => a.sortKey - b.sortKey
    );
    console.log('[PERF] filteredTimelineDataWithHolidays END', _ftwh.length, 'groups', Date.now());
    return _ftwh;
  }, [filteredTimelineData, holidaysByDay, viewMode, timelineRange, today]);


  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[
        styles.safeArea,
        ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null,
      ]}
    >
      <View style={styles.container}>
        {/* Community filter banner */}
        {communityId ? (
          <View style={styles.communityBanner}>
            <Pressable
              onPress={() => router.setParams({ communityId: undefined })}
              style={styles.communityBannerClose}
              accessible
              accessibilityRole="button"
              accessibilityLabel="בטל סינון קהילה"
            >
              <MaterialIcons name="close" size={16} color="#fff" />
            </Pressable>
            <Text style={styles.communityBannerText}>
              {communityData?.name
                ? `מסונן לפי: ${communityData.name}`
                : 'מסונן לפי קהילה'}
            </Text>
            <MaterialIcons name="filter-list" size={16} color="#fff" />
          </View>
        ) : null}

        {/* Header */}
        <View style={styles.header}>
          <MainScreenHeader
            title="היומן שלי"
            onNotificationsPress={handleBellPress}
            notificationsCount={unseenCount}
            returnTo="/(authenticated)/calendar"
          />

          {/* View Toggle — LTR track on all platforms: pill left= is physical, ציר זמן LEFT, חודשי RIGHT. */}
          <View
            style={[
              styles.segmentedControl,
              styles.segmentedControlAndroidTrack,
            ]}
            onLayout={(e) =>
              setSegmentContainerWidth(e.nativeEvent.layout.width)
            }
          >
            {pillWidth > 0 && (
              <Animated.View
                style={[
                  styles.segmentedSlider,
                  {
                    width: pillWidth,
                    left: slideAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [pillWidth + SEGMENT_PAD, SEGMENT_PAD],
                    }),
                  },
                ]}
              />
            )}
            <Pressable
              style={styles.segmentButton}
              onPress={() => handleViewModeChange('timeline')}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="תצוגת ציר זמן"
            >
              <Text
                style={[
                  styles.segmentText,
                  viewMode === 'timeline' && styles.segmentTextActive,
                ]}
              >
                ציר זמן
              </Text>
            </Pressable>
            <Pressable
              style={styles.segmentButton}
              onPress={() => handleViewModeChange('monthly')}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={
                isFiltered
                  ? 'תצוגה חודשית (לא זמינה בסינון קהילה)'
                  : 'תצוגה חודשית'
              }
              accessibilityState={{ disabled: isFiltered }}
            >
              <Text
                style={[
                  styles.segmentText,
                  viewMode === 'monthly' && styles.segmentTextActive,
                  isFiltered && styles.segmentTextDisabled,
                ]}
              >
                חודשי
              </Text>
            </Pressable>
          </View>

          {viewMode === 'monthly' ? (
            <View style={styles.monthHeaderWrap}>
              <CalendarMonthNavBar
                headerMonthLabel={headerMonth}
                hebrewMonthRange={hebrewMonthRange}
                onNextMonth={goToNextMonth}
                onPrevMonth={goToPrevMonth}
                onTitlePress={() => setIsMonthPickerVisible(true)}
                showFilterIcon={!communityId && visibleFilterRows.length > 0}
                onFilterPress={() => setIsFilterPanelOpen(true)}
              />
            </View>
          ) : null}

          {/* Timeline view: show filter icon in a row below the segmented control */}
          {viewMode === 'timeline' &&
          !communityId &&
          visibleFilterRows.length > 0 ? (
            <View style={styles.timelineFilterRow}>
              <Pressable
                onPress={() => setIsFilterPanelOpen(true)}
                hitSlop={8}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="סינון היומן"
                style={styles.timelineFilterBtn}
              >
                <MaterialIcons name="tune" size={20} color="#647b87" />
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Content */}
        {viewMode === 'timeline' ? (
          <TimelineView
            data={filteredTimelineDataWithHolidays}
            holidaysByDay={holidaysByDay}
            myImportantItemChecks={myImportantItemChecks}
            onEventPress={handleOpenEventDetails}
            onNavigate={handleNavigateToLocation}
            onOpenTaskSheet={(id) => {
              setTaskSheetTaskId(id);
              setTaskSheetVisible(true);
            }}
            onAddPress={(dateStr) => {
                handleGatedCreateAction(() => {
                  router.push({
                    pathname: '/(authenticated)/event/new',
                    params: {
                      date: dateStr,
                      returnTo: 'calendar',
                      sourceView: 'timeline',
                      sourceDate: dateStr,
                    },
                  } as Parameters<typeof router.push>[0]);
                });
              }}
            />
        ) : (
          <View
            style={styles.content}
            onLayout={(event) => {
              setMonthlyViewportHeight(event.nativeEvent.layout.height);
            }}
          >
            <ReAnimated.View
              style={[styles.calendarPanel, animatedCalendarStyle]}
            >
              {isExpanded ? (
                <ScrollView
                  contentContainerStyle={styles.expandedCalendarScrollContent}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={false}
                  style={styles.expandedCalendarScroll}
                >
                  <GestureDetector gesture={monthSwipeGesture}>
                    <View
                      collapsable={false}
                      style={styles.expandedCalendarGridHost}
                    >
                      <MonthlyGrid
                        displayMonth={displayMonth}
                        displayYear={displayYear}
                        expandedWeekBaseHeight={expandedWeekBaseHeight}
                        grid={filteredGrid}
                        selectedDay={selectedDay}
                        isExpanded={isExpanded}
                        tasksByDay={filteredCalendarTasksByDay}
                        taskIdsByDay={filteredTaskIdsByDay}
                        holidaysByDay={holidaysByDay}
                        onCreateEventForDay={handleExpandedCreateForDay}
                        onNavigateToEvent={handleExpandedEventNavigate}
                        onOpenDaySheet={openDayEventsSheet}
                        onOpenTaskSheetFromCell={handleOpenTaskSheetFromCell}
                        onSelectDay={setSelectedDay}
                      />
                    </View>
                  </GestureDetector>
                </ScrollView>
              ) : (
                <GestureDetector gesture={monthSwipeGesture}>
                  <View collapsable={false}>
                    <MonthlyGrid
                      displayMonth={displayMonth}
                      displayYear={displayYear}
                      expandedWeekBaseHeight={undefined}
                      grid={
                        isWeekCollapsed && selectedWeekIndex >= 0
                          ? ([
                              filteredGrid[selectedWeekIndex],
                            ] as typeof filteredGrid)
                          : filteredGrid
                      }
                      selectedDay={selectedDay}
                      isExpanded={isExpanded}
                      tasksByDay={filteredCalendarTasksByDay}
                      taskIdsByDay={filteredTaskIdsByDay}
                      holidaysByDay={holidaysByDay}
                      onCreateEventForDay={handleExpandedCreateForDay}
                      onNavigateToEvent={handleExpandedEventNavigate}
                      onOpenDaySheet={openDayEventsSheet}
                      onOpenTaskSheetFromCell={handleOpenTaskSheetFromCell}
                      onSelectDay={setSelectedDay}
                    />
                  </View>
                </GestureDetector>
              )}

              <GestureDetector gesture={panGesture}>
                <Pressable
                  onPress={toggleCalendarSnap}
                  style={styles.dragHandleContainer}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isExpanded ? 'סגור את היומן' : 'פתח את היומן'
                  }
                >
                  <MaterialIcons
                    name={
                      isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'
                    }
                    size={30}
                    color="#647b87"
                  />
                </Pressable>
              </GestureDetector>
            </ReAnimated.View>

            {!isExpanded ? (
              <ScrollView
                style={styles.dailyEventsScroll}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={handleDayListScroll}
              >
                {visibleDay != null &&
                  (visibleDayData != null || visibleDayTasks.length > 0) && (
                    <DayEventsList
                      dayData={
                        visibleDayData ?? {
                          day: visibleDay,
                          isCurrentMonth: true,
                          isToday:
                            today.getDate() === visibleDay &&
                            today.getMonth() === displayMonth &&
                            today.getFullYear() === displayYear,
                          events: [],
                        }
                      }
                      year={displayYear}
                      month={displayMonth}
                      anim={listAnim}
                      tasks={visibleDayTasks}
                      holidays={(() => {
                        const key = `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}-${String(visibleDay).padStart(2, '0')}`;
                        return holidaysByDay[key] ?? [];
                      })()}
                      myImportantItemChecks={myImportantItemChecks}
                      onEventPress={handleOpenEventDetails}
                      onClose={() => setSelectedDay(null)}
                      onOpenTaskSheet={(id) => {
                        setTaskSheetTaskId(id);
                        setTaskSheetVisible(true);
                      }}
                    />
                  )}
              </ScrollView>
            ) : null}
          </View>
        )}

        {/* Notifications Drawer */}
        <NotificationsDrawer
          isOpen={isNotificationsOpen}
          onClose={() => setIsNotificationsOpen(false)}
        />
        <TaskDetailsBottomSheet
          taskId={taskSheetTaskId}
          visible={taskSheetVisible}
          onClose={() => setTaskSheetVisible(false)}
        />
        <EventDetailsBottomSheet
          event={selectedEvent}
          eventId={null}
          visible={selectedEvent !== null}
          onDragClose={() => {
            lastDragCloseTime.current = Date.now();
          }}
          onClose={closeEventSheet}
          onNavigate={handleNavigateToLocation}
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
        <CalendarDayEventsSheet
          birthday={sheetDayData?.birthday}
          dayLabel={daySheetLabel}
          events={sheetDayData?.events ?? []}
          tasks={sheetDayTasks}
          holidays={sheetDayHolidays}
          myImportantItemChecks={myImportantItemChecks}
          onClose={closeDayEventsSheet}
          onEventLongPress={handleExpandedEventLongPress}
          onEventNavigate={handleExpandedEventNavigate}
          onOpenTaskSheet={(id) => {
            closeDayEventsSheet();
            setTaskSheetTaskId(id);
            setTaskSheetVisible(true);
          }}
          visible={
            daySheetDay !== null &&
            (sheetDayData != null ||
              sheetDayTasks.length > 0 ||
              sheetDayHolidays.length > 0)
          }
        />
        <MonthYearPickerModal
          onClose={() => setIsMonthPickerVisible(false)}
          onConfirm={handleMonthPickerConfirm}
          selectedMonth={displayMonth}
          selectedYear={displayYear}
          visible={isMonthPickerVisible}
        />
        <CalendarEventEditPopover
          onClose={() => setEventEditMenu(null)}
          onEdit={handleExpandedEditAction}
          visible={eventEditMenu != null}
          x={eventEditMenu?.x ?? 0}
          y={eventEditMenu?.y ?? 0}
        />
        <CalendarFilterPanel
          visible={isFilterPanelOpen}
          onClose={() => setIsFilterPanelOpen(false)}
          filters={layerFilters}
          onToggle={toggleLayerFilter}
          rows={visibleFilterRows}
        />
        <UpgradeModal
          visible={upgradeModalVisible}
          reason="general"
          onClose={() => setUpgradeModalVisible(false)}
        />
      </View>
    </SafeAreaView>
  );
}

// ===== Monthly Grid =====
interface MonthlyGridProps {
  grid: CalendarDay[][];
  displayYear: number;
  displayMonth: number;
  expandedWeekBaseHeight?: number;
  selectedDay: number | null;
  isExpanded: boolean;
  /** Count of personal tasks per day-of-month for lightweight indicator */
  tasksByDay: Record<number, number>;
  /**
   * Raw task IDs per day-of-month.  Used in expanded mode to directly open a
   * single task when it is the only visible item on that day.
   */
  taskIdsByDay?: Record<number, string[]>;
  /** Holiday overlay items keyed by YYYY-MM-DD date string */
  holidaysByDay: Record<string, HolidayOverlayItem[]>;
  onSelectDay: (day: number | null) => void;
  onOpenDaySheet: (day: number) => void;
  onNavigateToEvent: (event: CalendarEvent) => void;
  onCreateEventForDay: (cellDate: Date) => void;
  /** Opens a task's detail sheet directly from an expanded single-task day cell. */
  onOpenTaskSheetFromCell?: (id: string) => void;
}

function hebrewPrefix(
  title: string | undefined | null,
  maxPixelWidth: number
): string {
  const t = title ?? 'אירוע ללא כותרת';

  const NARROW = new Set(['י', 'ו', 'ן', 'ל', 'ז', 'ר', 'ת', "'", '׳', '״']);
  const MEDIUM = new Set([
    'ה',
    'ח',
    'ע',
    'ב',
    'ד',
    'כ',
    'נ',
    'פ',
    'ק',
    'ץ',
    'ף',
    'ך',
  ]);

  const widthOf = (ch: string): number => {
    if (ch === ' ') return 2.8;
    if (NARROW.has(ch)) return 3.5;
    if (MEDIUM.has(ch)) return 5.0;
    return 6.0;
  };

  let acc = 0;
  let cutIndex = t.length;
  for (let i = 0; i < t.length; i++) {
    acc += widthOf(t[i]);
    if (acc > maxPixelWidth) {
      cutIndex = i;
      break;
    }
  }

  return t.slice(0, cutIndex);
}

function MonthlyGrid({
  grid,
  displayYear,
  displayMonth,
  expandedWeekBaseHeight,
  selectedDay,
  isExpanded,
  tasksByDay,
  taskIdsByDay,
  holidaysByDay,
  onSelectDay,
  onOpenDaySheet,
  onNavigateToEvent,
  onCreateEventForDay,
  onOpenTaskSheetFromCell,
}: MonthlyGridProps): React.JSX.Element {
  // Grid starts at (1 - firstDayOffset) of the displayed month — used to map
  // each cell's position to its absolute YYYY-MM-DD date for holiday lookup.
  const gridFirstDayOffset = getFirstDayOfMonth(displayYear, displayMonth);

  return (
    <View
      style={[
        mStyles.gridContainer,
        isExpanded && mStyles.gridContainerExpanded,
      ]}
    >
      {/* Day Name Headers */}
      <View
        style={[
          mStyles.weekRow,
          isExpanded && mStyles.weekRowExpanded,
          { flexDirection: rtl.flexDirection },
        ]}
      >
        {HEBREW_DAY_NAMES.map((name, i) => (
          <View key={name} style={mStyles.dayHeaderCell}>
            <Text
              style={[
                mStyles.dayHeaderText,
                i === 6 && mStyles.shabbatHeaderText,
              ]}
            >
              {name}
            </Text>
          </View>
        ))}
      </View>

      {/* Calendar Rows */}
      {grid.map((week, wi) => {
        const weekKey = week
          .map((d) => `${d.isCurrentMonth ? 'c' : 'o'}${d.day}`)
          .join('-');
        const weekHeight = isExpanded
          ? getExpandedWeekHeight(week, expandedWeekBaseHeight)
          : undefined;

        return (
          <View
            key={weekKey}
            style={[
              mStyles.weekRow,
              isExpanded && mStyles.weekRowExpanded,
              { flexDirection: rtl.flexDirection },
            ]}
          >
            {week.map((dayData, di) => {
              // Compute the absolute date of this cell to look up holidays.
              // Offset from grid start (which may be in the previous month).
              const cellIndex = wi * 7 + di;
              const cellD = new Date(
                displayYear,
                displayMonth,
                1 - gridFirstDayOffset + cellIndex
              );
              const cellDateKey = `${cellD.getFullYear()}-${String(cellD.getMonth() + 1).padStart(2, '0')}-${String(cellD.getDate()).padStart(2, '0')}`;
              const dayHolidays = holidaysByDay[cellDateKey] ?? [];

              return (
                <DayCell
                  key={`${dayData.isCurrentMonth ? 'c' : 'o'}-${dayData.day}`}
                  dayData={dayData}
                  displayMonth={displayMonth}
                  displayYear={displayYear}
                  isSelected={
                    selectedDay === dayData.day && dayData.isCurrentMonth
                  }
                  isExpanded={isExpanded}
                  weekHeight={weekHeight}
                  taskCount={
                    dayData.isCurrentMonth ? (tasksByDay[dayData.day] ?? 0) : 0
                  }
                  tasksForDay={
                    dayData.isCurrentMonth
                      ? (taskIdsByDay?.[dayData.day] ?? [])
                      : []
                  }
                  dayHolidays={dayHolidays}
                  onCompactPress={() => {
                    if (!dayData.isCurrentMonth) return;
                    // In compact mode: open day-sheet when 2+ visible items,
                    // otherwise fall back to ordinary day selection.
                    const tCount = tasksByDay[dayData.day] ?? 0;
                    const totalVisible =
                      dayData.events.length + tCount + dayHolidays.length;
                    if (totalVisible > 1) {
                      onOpenDaySheet(dayData.day);
                      return;
                    }
                    onSelectDay(
                      selectedDay === dayData.day ? null : dayData.day
                    );
                  }}
                  onCreateEventForDay={onCreateEventForDay}
                  onNavigateToEvent={onNavigateToEvent}
                  onOpenDaySheet={onOpenDaySheet}
                  onOpenTaskSheetFromCell={onOpenTaskSheetFromCell}
                  onSelectDay={onSelectDay}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ===== Day Cell =====
interface DayCellProps {
  dayData: CalendarDay;
  displayYear: number;
  displayMonth: number;
  isSelected: boolean;
  isExpanded: boolean;
  weekHeight?: number;
  /** Number of personal tasks due on this day (0 if none or out of month) */
  taskCount: number;
  /**
   * Raw task IDs for this day (same filter rules as taskCount).
   * Used in expanded mode to directly navigate to a single task's details
   * when it is the sole visible item on that day.
   */
  tasksForDay?: string[];
  /** Holiday overlay items for this specific day (empty when showHolidays is off) */
  dayHolidays: HolidayOverlayItem[];
  onCompactPress: () => void;
  onSelectDay: (day: number | null) => void;
  onOpenDaySheet: (day: number) => void;
  onNavigateToEvent: (event: CalendarEvent) => void;
  onCreateEventForDay: (cellDate: Date) => void;
  /** Opens a task's detail sheet directly (single-task day, no other content). */
  onOpenTaskSheetFromCell?: (id: string) => void;
}

function DayCell({
  dayData,
  displayYear,
  displayMonth,
  isSelected,
  isExpanded,
  weekHeight,
  taskCount,
  tasksForDay = [],
  dayHolidays,
  onCompactPress,
  onSelectDay,
  onOpenDaySheet,
  onNavigateToEvent,
  onCreateEventForDay,
  onOpenTaskSheetFromCell,
}: DayCellProps): React.JSX.Element {
  const { findBirthdayByName, openBirthdayCard } = useBirthdaySheets();
  const hasEventsForDay = dayData.isCurrentMonth && dayData.events.length > 0;
  const isSingleEventDay = dayData.events.length === 1;

  /**
   * Total number of visible calendar items for this day.
   * Holidays, events, and tasks all count.  Hidden layers already produce empty
   * arrays / zero counts, so no extra filtering is needed here.
   */
  const totalVisibleItems =
    dayData.events.length + taskCount + dayHolidays.length;

  /**
   * True when the day contains a mix of item types (or multiple items of the
   * same type).  Tapping any item or the background while this is true must
   * open the central day-overview sheet so the user sees everything at once.
   */
  const hasMixedContent = totalVisibleItems > 1;

  const cellDate = useMemo(
    () => new Date(displayYear, displayMonth, dayData.day, 0, 0, 0, 0),
    [displayYear, displayMonth, dayData.day]
  );

  const handleBirthdayPress = useCallback((): void => {
    if (dayData.birthday == null) return;
    const found = findBirthdayByName(dayData.birthday.name);
    if (found) openBirthdayCard(found);
  }, [dayData.birthday, findBirthdayByName, openBirthdayCard]);

  const openSheetForThisDay = (): void => {
    if (dayData.isCurrentMonth) onOpenDaySheet(dayData.day);
  };

  const longPressCreate = (): void => {
    if (!dayData.isCurrentMonth) return;
    onCreateEventForDay(cellDate);
  };

  const expandedAccessibilityLabel = (): string =>
    dayData.events.length > 0
      ? `${dayData.events.length} אירועים`
      : 'אין אירועים ביום הזה';

  const selectThisDay = (): void => {
    if (!dayData.isCurrentMonth) return;
    onSelectDay(dayData.day);
  };

  /** Opens the day-sheet when there are 2+ visible items; selects the day otherwise. */
  const handleDayAreaPress = (): void => {
    if (!dayData.isCurrentMonth) return;
    if (hasMixedContent) {
      openSheetForThisDay();
      return;
    }
    selectThisDay();
  };

  // ── Compact (collapsed month) ──
  if (!isExpanded) {
    return (
      <Pressable
        style={[
          mStyles.dayCell,
          !dayData.isCurrentMonth && mStyles.dayCellOtherMonth,
        ]}
        accessibilityHint="לחץ לצפייה באירועי היום, לחיצה ארוכה ליצירת אירוע"
        accessibilityLabel={`יום ${dayData.day}${dayData.birthday ? `, יום הולדת ${dayData.birthday.name}` : ''}${dayData.events.length > 0 ? `, ${dayData.events.length} אירועים` : ''}`}
        accessibilityRole="button"
        accessible={true}
        delayLongPress={480}
        onLongPress={longPressCreate}
        onPress={onCompactPress}
      >
        <View
          style={[
            mStyles.dayNumWrapper,
            dayData.isToday && !isSelected && mStyles.dayNumTodayBg,
            isSelected && mStyles.dayNumSelectedBg,
          ]}
        >
          <Text
            style={[
              mStyles.dayNumText,
              !dayData.isCurrentMonth && mStyles.dayNumOtherMonth,
              dayData.isToday && !isSelected && mStyles.dayNumTodayText,
              isSelected && mStyles.dayNumSelectedText,
            ]}
          >
            {dayData.day}
          </Text>
        </View>

        {dayData.birthday != null && (
          <Pressable
            accessibilityHint="לחץ לצפייה בימי הולדת"
            accessibilityLabel={`יום הולדת ${dayData.birthday.name}`}
            accessibilityRole="button"
            accessible={true}
            delayLongPress={480}
            hitSlop={6}
            onLongPress={longPressCreate}
            onPress={handleBirthdayPress}
          >
            <Text style={mStyles.birthdayEmoji}>🎂</Text>
          </Pressable>
        )}

        {hasEventsForDay && (
          <View
            accessibilityElementsHidden={true}
            importantForAccessibility="no"
            style={mStyles.eventIndicatorBar}
          />
        )}

        {taskCount > 0 && (
          <View
            accessibilityElementsHidden={true}
            importantForAccessibility="no"
            style={mStyles.taskIndicatorDot}
          />
        )}

        {dayHolidays.length > 0 && (
          <View
            accessibilityElementsHidden={true}
            importantForAccessibility="no"
            pointerEvents="none"
            style={mStyles.compactHolidayLabel}
          >
            <Text numberOfLines={1} style={mStyles.compactHolidayText}>
              {hebrewPrefix(dayHolidays[0].title, 28)}
              {dayHolidays.length > 1 ? ` +${dayHolidays.length - 1}` : ''}
            </Text>
          </View>
        )}
      </Pressable>
    );
  }

  // ── Expanded month ──
  return (
    <Pressable
      accessibilityHint="לחיצה ארוכה ליצירת אירוע"
      accessibilityLabel={`יום ${dayData.day}, ${expandedAccessibilityLabel()}`}
      accessibilityRole="button"
      accessible={true}
      delayLongPress={420}
      disabled={!dayData.isCurrentMonth}
      onLongPress={longPressCreate}
      onPress={handleDayAreaPress}
      style={[
        mStyles.dayCell,
        mStyles.dayCellExpanded,
        weekHeight != null ? { height: weekHeight } : null,
        !dayData.isCurrentMonth && mStyles.dayCellOtherMonth,
      ]}
    >
      <Pressable
        accessibilityHint="לחיצה ארוכה ליצירת אירוע"
        accessibilityLabel={`יום ${dayData.day}, ${expandedAccessibilityLabel()}`}
        accessibilityRole="button"
        accessible={true}
        delayLongPress={420}
        disabled={!dayData.isCurrentMonth}
        hitSlop={2}
        onLongPress={longPressCreate}
        onPress={handleDayAreaPress}
        style={mStyles.dayNumRowExpanded}
      >
        <View
          style={[
            mStyles.dayNumWrapperSmall,
            dayData.isToday && !isSelected && mStyles.dayNumTodayBg,
            isSelected && mStyles.dayNumSelectedBg,
          ]}
        >
          <Text
            style={[
              mStyles.dayNumTextSmall,
              !dayData.isCurrentMonth && mStyles.dayNumOtherMonth,
              dayData.isToday && !isSelected && mStyles.dayNumTodayText,
              isSelected && mStyles.dayNumSelectedText,
            ]}
          >
            {dayData.day}
          </Text>
        </View>
      </Pressable>

      {dayData.isCurrentMonth && (
        <View style={mStyles.expandedEvents}>
          {/*
           * Holiday rows — shown before personal events, read-only in the
           * day-sheet.  Tapping them always opens the day-sheet so the full
           * title is visible (even when the holiday is the sole item).
           */}
          {dayHolidays.map((holiday) => (
            <Pressable
              key={holiday.id}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={holiday.title}
              accessibilityHint="פתח תצוגת יום"
              onPress={openSheetForThisDay}
              style={mStyles.expandedHolidayRow}
            >
              <Text numberOfLines={1} style={mStyles.expandedHolidayText}>
                {hebrewPrefix(holiday.title, 36)}
              </Text>
            </Pressable>
          ))}

          {dayData.birthday != null && (
            <Pressable
              accessibilityLabel={`יום הולדת ${dayData.birthday.name}`}
              accessibilityRole="button"
              accessible={true}
              delayLongPress={420}
              onLongPress={longPressCreate}
              onPress={handleBirthdayPress}
              style={mStyles.expandedBirthdayRow}
            >
              <Text style={mStyles.expandedBirthdayText}>
                🎂 {dayData.birthday.name}
              </Text>
            </Pressable>
          )}

          {dayData.events.map((event) => {
            const kind = event.eventVisualKind ?? 'personal';
            const eventTitle = getCalendarEventTitle(event);
            const rowStyle =
              kind === 'community'
                ? mStyles.expandedEventRowCommunity
                : kind === 'shared'
                  ? mStyles.expandedEventRowShared
                  : mStyles.expandedEventRowPersonal;
            const accessLabel =
              event.time !== '' ? `${eventTitle} ${event.time}` : eventTitle;

            return (
              <Pressable
                key={event.listKey ?? event.id}
                accessibilityLabel={accessLabel}
                accessibilityRole="button"
                accessible={true}
                delayLongPress={420}
                onLongPress={longPressCreate}
                onPress={() => {
                  if (hasMixedContent) {
                    openSheetForThisDay();
                    return;
                  }
                  onNavigateToEvent(event);
                }}
                style={[
                  mStyles.expandedEventRow,
                  rowStyle,
                  isSingleEventDay
                    ? mStyles.expandedEventRowSingle
                    : mStyles.expandedEventRowCompact,
                  event.cancelled && mStyles.expandedEventRowCancelled,
                ]}
              >
                {isSingleEventDay ? (
                  <View style={mStyles.expandedEventSingleContainer}>
                    <Text
                      style={[
                        mStyles.expandedEventSingleTitle,
                        event.cancelled && mStyles.expandedEventTitleCancelled,
                      ]}
                    >
                      {eventTitle}
                    </Text>
                    {event.time !== '' && (
                      <Text style={mStyles.expandedEventTimeText}>
                        {event.time}
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text
                    ellipsizeMode="clip"
                    numberOfLines={1}
                    style={[
                      mStyles.expandedEventText,
                      event.cancelled && mStyles.expandedEventTitleCancelled,
                    ]}
                  >
                    {hebrewPrefix(eventTitle, 36)}
                  </Text>
                )}
              </Pressable>
            );
          })}

          {taskCount > 0 && (
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={
                taskCount === 1 ? '✓ משימה' : `✓ ${taskCount} משימות`
              }
              onPress={() => {
                if (hasMixedContent) {
                  openSheetForThisDay();
                  return;
                }
                // Single task, no other visible items — go directly to task details.
                if (tasksForDay.length === 1 && onOpenTaskSheetFromCell) {
                  onOpenTaskSheetFromCell(tasksForDay[0]);
                  return;
                }
                // Fallback: open the day-sheet (shows CalendarTaskCard with tap-through).
                openSheetForThisDay();
              }}
              style={mStyles.expandedTaskRow}
            >
              <Text style={mStyles.expandedTaskText}>
                {taskCount === 1 ? '✓ משימה' : `✓ ${taskCount} משימות`}
              </Text>
            </Pressable>
          )}

          <Pressable
            accessibilityHint="לחיצה ארוכה ליצירת אירוע חדש"
            accessibilityLabel="אזור יום"
            accessibilityRole="button"
            accessible={true}
            delayLongPress={420}
            style={mStyles.expandedDayFiller}
            onLongPress={longPressCreate}
            onPress={handleDayAreaPress}
          />
        </View>
      )}
    </Pressable>
  );
}

// ===== Calendar Task Card =====
// Single component used by both the monthly selected-day panel and the timeline.

interface CalendarTaskCardProps {
  task: CalendarDayTask;
  onOpenTaskSheet: (id: string) => void;
  /** Lifted from TimelineView to survive FlashList recycling. Falls back to internal state when not provided (monthly-view call sites). */
  subtasksExpanded?: boolean;
  onToggleSubtasks?: () => void;
  /**
   * Timeline mode already renders the reminder's time on the timeline axis
   * itself (see `event.time` in TimelineView's `eventTimeColumn`) — showing
   * it a second time inside the card is redundant (BUG 1 of the community
   * reminder QA pass). Monthly/day-list call sites (`CalendarDayEventsSheet`,
   * `DayEventsList`) don't render a separate time axis, so they must keep
   * showing the time inside the card exactly as before. The time value
   * itself, `task.time`, is NEVER altered — only whether this card visually
   * repeats it. Screen readers still hear the time via the unchanged
   * `accessibilityLabel` below.
   */
  hideTimeInCard?: boolean;
}

function CalendarTaskCard({
  task,
  onOpenTaskSheet,
  subtasksExpanded: subtasksExpandedProp,
  onToggleSubtasks,
  hideTimeInCard = false,
}: CalendarTaskCardProps): React.JSX.Element {
  const [subtasksExpandedLocal, setSubtasksExpandedLocal] = useState(false);
  const subtasksExpanded = subtasksExpandedProp ?? subtasksExpandedLocal;
  const toggleSubtasks =
    onToggleSubtasks ?? (() => setSubtasksExpandedLocal((v) => !v));
  const subtasks = task.subtasks ?? [];
  const completedCount = subtasks.filter((s) => s.completed).length;
  // Strip the "task:" prefix that wraps the Convex _id in calendar rows.
  const rawId = task.id.replace(/^task:/, '');

  // ── Personal-dismiss for general community reminders (Home + Calendar
  // only — see convex/tasks.ts `dismissCommunityReminderForMe`). Reuses the
  // SAME canonical `typeLabel` already derived exclusively from
  // `getCalendarTaskTypeLabel`/`getTaskClassification` — never a second,
  // ad-hoc classification check.
  const isCommunityReminder = isCommunityReminderTypeLabel(task.typeLabel);
  const dismissCommunityReminderMutation = useMutation(
    api.tasks.dismissCommunityReminderForMe
  );
  const [isDismissingReminder, setIsDismissingReminder] = useState(false);
  const handleDismissReminder = (): void => {
    if (isDismissingReminder) return;
    setIsDismissingReminder(true);
    dismissCommunityReminderMutation({ taskId: rawId as Id<'tasks'> })
      .catch((error) => {
        console.error('dismissCommunityReminderForMe error:', error);
        Alert.alert('שגיאה', 'לא הצלחנו להסתיר את התזכורת. נסו שוב.');
      })
      .finally(() => setIsDismissingReminder(false));
  };

  return (
    <Pressable
      style={styles.eventCard}
      onPress={() => onOpenTaskSheet(rawId)}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${task.typeLabel ?? PERSONAL_TASK_TYPE_LABEL}: ${task.title}${task.time ? `, ${task.time}` : ''}${task.isOverdue ? ', באיחור' : ''}`}
    >
      {/* Blue accent bar */}
      <View
        style={[styles.eventAccentBar, { backgroundColor: PRIMARY_BLUE }]}
      />

      <View style={styles.eventCardContent}>
        {/* Header: tag + time + overdue + assignee */}
        <View style={styles.eventCardHeader}>
          <View
            style={[
              styles.categoryTag,
              { backgroundColor: `${PRIMARY_BLUE}18` },
            ]}
          >
            <Text style={[styles.categoryTagText, { color: PRIMARY_BLUE }]}>
              {task.typeLabel ?? PERSONAL_TASK_TYPE_LABEL}
            </Text>
          </View>
          {task.communityName ? (
            <CommunityEventNameTag name={task.communityName} />
          ) : null}
          {!hideTimeInCard && task.time !== '' ? (
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748b' }}>
              {task.time}
            </Text>
          ) : null}
          {task.isOverdue ? (
            <View style={styles.overdueBadge}>
              <Text style={styles.overdueBadgeText}>באיחור</Text>
            </View>
          ) : null}
          {(task.assigneeDisplays?.length ?? 0) > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {(task.assigneeDisplays ?? []).slice(0, 3).map((d, i) => (
                <View
                  key={`${d.initials}:${d.color}`}
                  style={[
                    styles.taskAssigneeAvatar,
                    {
                      backgroundColor: d.color,
                      marginLeft: i === 0 ? 0 : -6,
                      zIndex: 3 - i,
                    },
                  ]}
                >
                  <Text style={styles.taskAssigneeInitials}>{d.initials}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {isCommunityReminder ? (
            <Pressable
              accessible={true}
              accessibilityLabel={COMMUNITY_REMINDER_DISMISS_LABEL}
              accessibilityRole="button"
              disabled={isDismissingReminder}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={(e) => {
                e.stopPropagation?.();
                handleDismissReminder();
              }}
              style={styles.dismissReminderButton}
            >
              <MaterialIcons color="#94a3b8" name="close" size={16} />
            </Pressable>
          ) : null}
        </View>

        {/* Title */}
        <Text style={styles.eventTitle}>{task.title}</Text>

        {/* Subtask expand / collapse — same pattern as Home screen */}
        {subtasks.length > 0 ? (
          <View style={{ marginTop: 2 }}>
            <Pressable
              style={{
                flexDirection: rtl.flexDirection,
                alignItems: 'center',
                gap: 4,
                paddingVertical: 2,
              }}
              onPress={(e) => {
                e.stopPropagation?.();
                toggleSubtasks();
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={
                subtasksExpanded ? 'כווץ סעיפים' : 'הרחב סעיפים'
              }
            >
              <MaterialIcons
                name={subtasksExpanded ? 'expand-less' : 'expand-more'}
                size={16}
                color="#94a3b8"
              />
              <Text
                style={{
                  fontSize: 12,
                  color: '#64748b',
                  textAlign: rtl.textAlign,
                  flex: 1,
                }}
              >
                {completedCount} מתוך {subtasks.length} סעיפים
              </Text>
            </Pressable>

            {subtasksExpanded ? (
              <View style={{ marginTop: 4, gap: 4 }}>
                {subtasks.map((sub) => (
                  <View
                    key={sub.id}
                    style={{
                      flexDirection: rtl.flexDirection,
                      alignItems: 'center',
                      gap: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        borderWidth: 1.5,
                        borderColor: sub.completed ? PRIMARY_BLUE : '#cbd5e1',
                        backgroundColor: sub.completed
                          ? PRIMARY_BLUE
                          : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {sub.completed ? (
                        <MaterialIcons name="check" size={12} color="#fff" />
                      ) : null}
                    </View>
                    <Text
                      style={{
                        fontSize: 13,
                        color: sub.completed ? '#94a3b8' : '#334155',
                        textDecorationLine: sub.completed
                          ? 'line-through'
                          : 'none',
                        flex: 1,
                        textAlign: rtl.textAlign,
                      }}
                    >
                      {sub.title}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ===== Day Events List =====
interface DayEventsListProps {
  dayData: CalendarDay;
  year: number;
  month: number;
  anim: Animated.Value;
  tasks?: CalendarDayTask[];
  holidays?: HolidayOverlayItem[];
  onEventPress: (event: CalendarEvent) => void;
  onClose: () => void;
  onOpenTaskSheet: (id: string) => void;
  myImportantItemChecks?: Record<string, Record<string, boolean>>;
}

function DayEventsList({
  dayData,
  year,
  month,
  anim,
  tasks = [],
  holidays = [],
  onEventPress,
  onClose,
  onOpenTaskSheet,
  myImportantItemChecks = {},
}: DayEventsListProps): React.JSX.Element {
  const router = useRouter();
  const { findBirthdayByName, openBirthdayCard } = useBirthdaySheets();
  const { isExpiredFree: listIsExpiredFree } = useEffectiveAccess();
  const [listUpgradeModalVisible, setListUpgradeModalVisible] = useState(false);

  function handleGatedAdd(action: () => void): void {
    if (listIsExpiredFree) {
      setListUpgradeModalVisible(true);
      return;
    }
    action();
  }

  const dayLabel = useMemo((): string => {
    const date = new Date(year, month, dayData.day);
    const weekday = HEBREW_WEEKDAYS_FULL[date.getDay()];
    const monthName = HEBREW_MONTHS[month];
    if (dayData.isToday) {
      return `היום, ${dayData.day} ב${monthName}`;
    }
    return `${weekday}, ${dayData.day} ב${monthName}`;
  }, [dayData.day, dayData.isToday, year, month]);

  const hebrewDayLabel = useMemo(
    () => getHebrewDateInfo(new Date(year, month, dayData.day)).fullHebrewDate,
    [year, month, dayData.day]
  );

  const hasContent =
    dayData.events.length > 0 ||
    dayData.birthday != null ||
    tasks.length > 0 ||
    holidays.length > 0;

  return (
    <Animated.View
      style={[
        dStyles.wrapper,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* Header — Android RTL: first item is physical right; close right / add left matches iOS */}
      <View style={dStyles.header}>
        {ANDROID_MATCH_IOS_LAYOUT ? (
          <>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={dStyles.closeBtn}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="סגור רשימת אירועים"
            >
              <MaterialIcons name="close" size={20} color="#647b87" />
            </Pressable>
            <View style={dStyles.headerTitleBlock}>
              <Text
                style={[
                  dStyles.headerTitle,
                  { textAlign: rtl.textAlign ?? 'right' },
                ]}
              >
                {dayLabel}
              </Text>
              {hebrewDayLabel ? (
                <Text style={dStyles.headerHebrewDate}>{hebrewDayLabel}</Text>
              ) : null}
            </View>
            <Pressable
              style={dStyles.addBtn}
              onPress={() => {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayData.day).padStart(2, '0')}`;
                const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
                handleGatedAdd(() => {
                  router.push({
                    pathname: '/(authenticated)/event/new',
                    params: {
                      date: dateStr,
                      returnTo: 'calendar',
                      sourceView: 'month',
                      sourceDate: dateStr,
                      sourceMonth: monthStr,
                      sourceCollapsed: 'true',
                    },
                  } as Parameters<typeof router.push>[0]);
                });
              }}
              accessible={true}
              accessibilityLabel="הוסף אירוע חדש"
            >
              <Text style={dStyles.addBtnText}>+ הוסף אירוע</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={dStyles.closeBtn}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="סגור רשימת אירועים"
            >
              <MaterialIcons name="close" size={20} color="#647b87" />
            </Pressable>
            <View style={dStyles.headerTitleBlock}>
              <Text
                style={[
                  dStyles.headerTitle,
                  { textAlign: rtl.textAlign ?? 'right' },
                ]}
              >
                {dayLabel}
              </Text>
              {hebrewDayLabel ? (
                <Text style={dStyles.headerHebrewDate}>{hebrewDayLabel}</Text>
              ) : null}
            </View>
            <Pressable
              style={dStyles.addBtn}
              onPress={() => {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayData.day).padStart(2, '0')}`;
                const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
                handleGatedAdd(() => {
                  router.push({
                    pathname: '/(authenticated)/event/new',
                    params: {
                      date: dateStr,
                      returnTo: 'calendar',
                      sourceView: 'month',
                      sourceDate: dateStr,
                      sourceMonth: monthStr,
                      sourceCollapsed: 'true',
                    },
                  } as Parameters<typeof router.push>[0]);
                });
              }}
              accessible={true}
              accessibilityLabel="הוסף אירוע חדש"
            >
              <Text style={dStyles.addBtnText}>+ הוסף אירוע</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Holiday Rows — shown before personal events; read-only, no press action */}
      {holidays.map((holiday) => (
        <View
          key={holiday.id}
          accessible={false}
          importantForAccessibility="no"
          style={dStyles.holidayRow}
        >
          <View style={dStyles.holidayDot} />
          <Text style={dStyles.holidayTitle}>{holiday.title}</Text>
        </View>
      ))}

      {/* Birthday Card */}
      {dayData.birthday != null && (
        <Pressable
          style={dStyles.birthdayCard}
          onPress={() => {
            const found = findBirthdayByName(dayData.birthday?.name ?? '');
            if (found) openBirthdayCard(found);
          }}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`יום הולדת ${dayData.birthday.name}`}
        >
          <Text style={dStyles.birthdayEmoji}>🎂</Text>
          <View style={dStyles.birthdayContent}>
            <Text style={dStyles.birthdayTitle}>
              יום הולדת: {dayData.birthday.name}
            </Text>
            {dayData.birthday.age != null && (
              <Text style={dStyles.birthdayAge}>
                {dayData.birthday.age} שנים
              </Text>
            )}
          </View>
          <MaterialIcons name="chevron-left" size={20} color="#e64980" />
        </Pressable>
      )}

      {/* Event Cards */}
      {dayData.events.map((event) => {
        const duration = calculateDuration(event);
        const iconName = getCategoryIcon(event.category);
        const rsvpVisual = getPersonalRsvpVisualState({
          cancelled: event.cancelled,
          pendingPersonalInvite: event.pendingPersonalInvite,
          myPersonalRsvpStatus: event.myPersonalRsvpStatus,
        });
        const eventTitle = getCalendarEventTitle(event);
        // FIX — Monthly/Timeline parity: my assigned Community Event tasks
        // also need the "flat card" treatment so the section attaches
        // seamlessly below, same as importantItems already does.
        const hasAssignedTasks =
          !event.cancelled && (event.myAssignedTasks?.length ?? 0) > 0;
        const hasImportantItems =
          !event.cancelled && (event.importantItems?.length ?? 0) > 0;
        const hasExpansion = hasAssignedTasks || hasImportantItems;
        return (
          <View
            key={event.listKey ?? event.id}
            style={[
              hasExpansion ? dStyles.unifiedCardOuter : undefined,
              hasExpansion &&
                rsvpVisual.kind !== 'normal' &&
                dStyles.pendingPersonalInviteCard,
            ]}
          >
            <Pressable
              style={[
                hasExpansion ? dStyles.cardFlatPressable : dStyles.card,
                !hasExpansion &&
                  rsvpVisual.kind !== 'normal' &&
                  dStyles.pendingPersonalInviteCard,
              ]}
              onPress={() => onEventPress(event)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`${event.title}, ${event.time}, ${duration} דקות`}
            >
              {ANDROID_MATCH_IOS_LAYOUT ? (
                <>
                  <View style={dStyles.timeCol}>
                    <Text style={dStyles.timeText}>{event.time}</Text>
                    <Text style={dStyles.durationText}>{duration} דק׳</Text>
                  </View>
                  <View
                    style={[
                      dStyles.divider,
                      { backgroundColor: `${event.categoryColor}50` },
                    ]}
                  />
                  <View style={dStyles.content}>
                    {event.communityName ? (
                      <View style={{ marginBottom: 4 }}>
                        <CommunityEventNameTag name={event.communityName} />
                      </View>
                    ) : null}
                    <Text style={dStyles.eventTitle}>{eventTitle}</Text>
                    <PersonalRsvpBadge
                      badgeStyle={dStyles.pendingRsvpBadge}
                      textStyle={dStyles.pendingRsvpBadgeText}
                      visual={rsvpVisual}
                    />
                    {event.location != null && event.location !== '' && (
                      <View style={dStyles.locationRow}>
                        <View style={dStyles.locationDot} />
                        <Text style={dStyles.locationText}>
                          {event.location}
                        </Text>
                      </View>
                    )}
                    {(event.profileCircles?.length ?? 0) > 0 ||
                    (event.profileCirclesExtraCount ?? 0) > 0 ? (
                      <View style={{ marginTop: 4 }}>
                        <ProfileCircles
                          profiles={event.profileCircles ?? []}
                          extraCount={event.profileCirclesExtraCount ?? 0}
                          context={event.profileCirclesContext ?? 'sharedWith'}
                        />
                      </View>
                    ) : (event.assigneeColors?.length ?? 0) > 0 ? (
                      <View style={dStyles.assigneeDots}>
                        {event.assigneeColors?.slice(0, 4).map((color) => (
                          <View
                            key={color}
                            style={[
                              dStyles.assigneeDot,
                              { backgroundColor: color },
                            ]}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <View
                    style={[
                      dStyles.iconBox,
                      { backgroundColor: `${event.categoryColor}20` },
                    ]}
                  >
                    <MaterialIcons
                      name={iconName as 'event'}
                      size={20}
                      color={event.categoryColor}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View style={dStyles.timeCol}>
                    <Text style={dStyles.timeText}>{event.time}</Text>
                    <Text style={dStyles.durationText}>{duration} דק׳</Text>
                  </View>
                  <View
                    style={[
                      dStyles.divider,
                      { backgroundColor: `${event.categoryColor}50` },
                    ]}
                  />
                  <View style={dStyles.content}>
                    {event.communityName ? (
                      <View style={{ marginBottom: 4 }}>
                        <CommunityEventNameTag name={event.communityName} />
                      </View>
                    ) : null}
                    <Text style={dStyles.eventTitle}>{eventTitle}</Text>
                    <PersonalRsvpBadge
                      badgeStyle={dStyles.pendingRsvpBadge}
                      textStyle={dStyles.pendingRsvpBadgeText}
                      visual={rsvpVisual}
                    />
                    {event.location != null && event.location !== '' && (
                      <View style={dStyles.locationRow}>
                        <View style={dStyles.locationDot} />
                        <Text style={dStyles.locationText}>
                          {event.location}
                        </Text>
                      </View>
                    )}
                    {(event.profileCircles?.length ?? 0) > 0 ||
                    (event.profileCirclesExtraCount ?? 0) > 0 ? (
                      <View style={{ marginTop: 4 }}>
                        <ProfileCircles
                          profiles={event.profileCircles ?? []}
                          extraCount={event.profileCirclesExtraCount ?? 0}
                          context={event.profileCirclesContext ?? 'sharedWith'}
                        />
                      </View>
                    ) : (event.assigneeColors?.length ?? 0) > 0 ? (
                      <View style={dStyles.assigneeDots}>
                        {event.assigneeColors?.slice(0, 4).map((color) => (
                          <View
                            key={color}
                            style={[
                              dStyles.assigneeDot,
                              { backgroundColor: color },
                            ]}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <View
                    style={[
                      dStyles.iconBox,
                      { backgroundColor: `${event.categoryColor}20` },
                    ]}
                  >
                    <MaterialIcons
                      name={iconName as 'event'}
                      size={20}
                      color={event.categoryColor}
                    />
                  </View>
                </>
              )}
            </Pressable>
            {hasAssignedTasks ? (
              <View style={dStyles.importantItemsInset}>
                <InlineEventTasksSection tasks={event.myAssignedTasks ?? []} />
              </View>
            ) : null}
            {hasImportantItems ? (
              <View style={dStyles.importantItemsInset}>
                <InlineImportantItemsSection
                  items={event.importantItems ?? []}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      {/* Personal Task Cards — unified CalendarTaskCard */}
      {tasks.map((task) => (
        <View key={task.id} style={{ marginBottom: 8 }}>
          <CalendarTaskCard task={task} onOpenTaskSheet={onOpenTaskSheet} />
        </View>
      ))}

      {/* Empty State */}
      {!hasContent && (
        <View style={dStyles.emptyState}>
          <MaterialIcons name="calendar-today" size={40} color="#d1d5db" />
          <Text style={dStyles.emptyText}>אין אירועים מתוכננים ליום זה</Text>
        </View>
      )}
      <UpgradeModal
        visible={listUpgradeModalVisible}
        reason="general"
        onClose={() => setListUpgradeModalVisible(false)}
      />
    </Animated.View>
  );
}

// ===== Timeline Holiday Row =====
function TimelineHolidayRow({
  holiday,
}: {
  holiday: HolidayOverlayItem;
}): React.JSX.Element {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={holiday.title}
      style={styles.timelineHolidayRow}
    >
      <Text style={styles.timelineHolidayTitle}>{holiday.title}</Text>
    </View>
  );
}

// ===== Timeline Helpers =====

/** Returns all calendar days strictly between two Date values (local time). */
function buildMissingDays(
  fromDate: Date,
  toDate: Date
): Array<{ dateStr: string; dayLabel: string; dayNumber: string }> {
  const result: Array<{
    dateStr: string;
    dayLabel: string;
    dayNumber: string;
  }> = [];
  const cursor = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate() + 1
  );
  const endMs = new Date(
    toDate.getFullYear(),
    toDate.getMonth(),
    toDate.getDate()
  ).getTime();

  while (cursor.getTime() < endMs) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const d = cursor.getDate();
    result.push({
      dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayLabel: getCachedDayLabel(cursor),
      dayNumber: String(d),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

// ===== Timeline View =====
function TimelineView({
  data,
  holidaysByDay,
  myImportantItemChecks,
  onEventPress,
  onNavigate,
  onAddPress,
  onOpenTaskSheet,
}: {
  data: TimelineDayGroup[];
  /** Per-date holiday items. Empty record when showHolidays is off or no categories enabled. */
  holidaysByDay: Record<string, HolidayOverlayItem[]>;
  /** Lifted to parent so the Convex subscription stays alive across tab switches. */
  myImportantItemChecks: Record<string, Record<string, boolean>>;
  onEventPress: (event: CalendarEvent) => void;
  onNavigate: (location: string, locationUrl?: string) => void;
  onAddPress: (dateStr: string) => void;
  onOpenTaskSheet: (id: string) => void;
}): React.JSX.Element {
  const [openGaps, setOpenGaps] = useState<Record<string, boolean>>({});
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  // TEMP PERF
  useEffect(() => {
    console.log('[PERF] myImportantItemChecks resolved', Date.now());
  }, [myImportantItemChecks]);

  // TEMP PERF
  useEffect(() => {
    console.log('[PERF] TimelineView mounted (JS)', Date.now());
    const raf = requestAnimationFrame(() => {
      console.log('[PERF] TimelineView first frame after mount', Date.now());
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Build flat list: one item per day group, plus gap toggles, expanded missing days, and end indicator.
  // Recomputes when data or openGaps changes so gap expand/collapse correctly inserts/removes rows.
  const flattenedTimelineRows = useMemo((): FlatTimelineRow[] => {
    const rows: FlatTimelineRow[] = [];
    for (let idx = 0; idx < data.length; idx++) {
      const dayGroup = data[idx];
      const sk = new Date(dayGroup.sortKey);
      const dateStr = `${sk.getFullYear()}-${String(sk.getMonth() + 1).padStart(2, '0')}-${String(sk.getDate()).padStart(2, '0')}`;
      rows.push({ type: 'dayGroup', key: `group-${dayGroup.sortKey}`, dayGroup, dateStr });
      const nextGroup = data[idx + 1];
      const missingDays =
        nextGroup != null ? buildMissingDays(sk, new Date(nextGroup.sortKey)) : [];
      if (missingDays.length > 0) {
        const isOpen = openGaps[dateStr] ?? false;
        rows.push({ type: 'gapToggle', key: `gap-${dateStr}`, dateStr, missingDays, isOpen });
        if (isOpen) {
          for (const day of missingDays) {
            rows.push({ type: 'missingDay', key: day.dateStr, day });
          }
        }
      }
    }
    rows.push({ type: 'endIndicator', key: 'end-indicator' });
    return rows;
  }, [data, openGaps]);

  // Index of the today dayGroup row — used as FlashList's initialScrollIndex.
  const todayRowIndex = useMemo(
    () => flattenedTimelineRows.findIndex((r) => r.type === 'dayGroup' && r.dayGroup.isToday),
    [flattenedTimelineRows],
  );

  if (data.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 48,
          gap: 16,
          paddingTop: 80,
        }}
      >
        <MaterialIcons name="event-busy" size={48} color="#d1d5db" />
        <Text style={{ fontSize: 16, color: '#9ca3af', textAlign: 'center' }}>
          אין אירועים לקהילה זו
        </Text>
      </View>
    );
  }

  const renderFlatRow = ({ item }: { item: FlatTimelineRow }): React.JSX.Element | null => {
    if (item.type === 'dayGroup') {
      const { dayGroup, dateStr } = item;
      return (
        <View style={styles.dayGroup}>
          {/* Day Header */}
          <View style={[styles.dayHeader, { flexDirection: rtl.flexDirection }]}>
            <View
              style={[
                styles.dayNumberCircle,
                dayGroup.isToday && styles.dayNumberCircleToday,
              ]}
            >
              <Text
                style={[
                  styles.dayNumberText,
                  dayGroup.isToday && styles.dayNumberTextToday,
                ]}
              >
                {dayGroup.dayNumber}
              </Text>
            </View>
            <View style={styles.dayLabelBlock}>
              <Text
                style={[
                  styles.dayLabel,
                  dayGroup.isToday && styles.dayLabelToday,
                ]}
              >
                {dayGroup.dayLabel}
              </Text>
              {getCachedHebrewDateInfo(dateStr).fullHebrewDate ? (
                <Text style={styles.dayHebrewLabel}>
                  {getCachedHebrewDateInfo(dateStr).fullHebrewDate}
                </Text>
              ) : null}
            </View>
            <View style={styles.dayDivider} />
            <Pressable
              onPress={() => onAddPress(dateStr)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`הוסף אירוע בתאריך ${dayGroup.dayLabel}`}
              style={({ pressed }) => [
                styles.addEventPill,
                pressed && styles.addEventPillPressed,
              ]}
            >
              <Text style={styles.addEventPillText}>הוסף</Text>
            </Pressable>
          </View>

          {/* Timeline events */}
          <View style={styles.timelineLineWrapper}>
            {/* Holiday overlays + Events/Tasks */}
            <View style={styles.eventsWrapper}>
              {(holidaysByDay[dateStr] ?? []).map((h) => (
                <TimelineHolidayRow key={`holiday-${h.id}`} holiday={h} />
              ))}
              {dayGroup.events.map((event: TimelineEventRow) => {
                const rsvpVisual = getPersonalRsvpVisualState({
                  cancelled: event.cancelled,
                  pendingPersonalInvite: event.pendingPersonalInvite,
                  myPersonalRsvpStatus: event.myPersonalRsvpStatus,
                });
                const eventTitle = getCalendarEventTitle(event);
                return (
                  <View key={event.id} style={styles.eventRow}>
                    {/* Time column + Rail/Dot + Card (RTL right→left: time | rail | card) */}
                    <View style={styles.eventRowInner}>
                      {/* Time column — far RIGHT (first child in rtl layout) */}
                      <View style={styles.eventTimeColumn}>
                        {event.time ? (
                          <>
                            <Text style={styles.eventTimeText}>
                              {event.endTime ? `${event.time}-` : event.time}
                            </Text>
                            {event.endTime ? (
                              <Text style={styles.eventEndTimeText}>
                                {event.endTime}
                              </Text>
                            ) : null}
                          </>
                        ) : null}
                      </View>

                      {/* Rail + Dot — MIDDLE between time and card */}
                      <View style={styles.eventRailColumn}>
                        <View style={styles.eventRailLine} />
                        <View
                          style={[
                            styles.eventDot,
                            { borderColor: event.categoryColor },
                            event.cancelled && styles.eventDotCancelled,
                          ]}
                        />
                      </View>

                      {/* Event / Task Card — physical LEFT */}
                      <View style={styles.timelineEventCardColumn}>
                        {event.isPersonalTask ? (
                          /* ── Personal task card — unified CalendarTaskCard ── */
                          <CalendarTaskCard
                            task={{
                              id: event.id,
                              title: event.title,
                              time: event.time,
                              isOverdue: event.isOverdue ?? false,
                              assigneeInitials: event.assigneeInitials,
                              assigneeColor: event.assigneeColor,
                              assigneeDisplays: event.assigneeDisplays,
                              subtasks: event.subtasks,
                              typeLabel: event.typeLabel,
                              communityName: event.communityName,
                            }}
                            // BUG 1 fix: the timeline axis (eventTimeColumn
                            // above) already shows this row's time — never
                            // repeat it inside the card in Timeline mode.
                            hideTimeInCard={true}
                            subtasksExpanded={expandedTaskIds.has(event.id)}
                            onToggleSubtasks={() => {
                              setExpandedTaskIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(event.id)) {
                                  next.delete(event.id);
                                } else {
                                  next.add(event.id);
                                }
                                return next;
                              });
                            }}
                            onOpenTaskSheet={onOpenTaskSheet}
                          />
                        ) : (
                          /* ── Regular event card ── */
                          <Pressable
                            key={`${event.id}-${rsvpVisual.kind}`}
                            style={[
                              styles.eventCard,
                              event.cancelled && styles.eventCardCancelled,
                              event.myAssignedTasks &&
                                event.myAssignedTasks.length > 0 &&
                                styles.eventCardWithTasks,
                              !event.cancelled &&
                                rsvpVisual.kind !== 'normal' &&
                                styles.pendingPersonalInviteCard,
                            ]}
                            onPress={() => onEventPress(event)}
                            accessible={true}
                            accessibilityRole="button"
                            accessibilityLabel={`${event.title}${event.time ? `, ${event.time}` : ''}`}
                          >
                            {/* Color accent bar */}
                            <View
                              style={[
                                styles.eventAccentBar,
                                {
                                  backgroundColor: event.cancelled
                                    ? '#9ca3af'
                                    : event.categoryColor,
                                },
                              ]}
                            />

                            {/* Card inner content */}
                            <View style={styles.eventCardContent}>
                              {/* Header: category tag + community name tag + profile circles */}
                              <View style={styles.eventCardHeader}>
                                <View
                                  style={[
                                    styles.categoryTag,
                                    {
                                      backgroundColor: `${event.categoryColor}20`,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.categoryTagText,
                                      {
                                        color: event.cancelled
                                          ? '#9ca3af'
                                          : event.categoryColor,
                                      },
                                    ]}
                                  >
                                    {event.category}
                                  </Text>
                                </View>
                                {event.communityName ? (
                                  <CommunityEventNameTag
                                    name={event.communityName}
                                  />
                                ) : null}
                                {(event.profileCircles?.length ?? 0) > 0 ||
                                (event.profileCirclesExtraCount ?? 0) > 0 ? (
                                  <ProfileCircles
                                    profiles={event.profileCircles ?? []}
                                    extraCount={
                                      event.profileCirclesExtraCount ?? 0
                                    }
                                    context={
                                      event.profileCirclesContext ?? 'sharedWith'
                                    }
                                    size={22}
                                  />
                                ) : null}
                              </View>

                              {/* Event Title */}
                              <Text
                                style={[
                                  styles.eventTitle,
                                  event.cancelled && styles.eventTitleCancelled,
                                ]}
                              >
                                {eventTitle}
                              </Text>
                              <PersonalRsvpBadge
                                badgeStyle={styles.pendingRsvpBadge}
                                textStyle={styles.pendingRsvpBadgeText}
                                visual={rsvpVisual}
                              />

                              {/* Location + nav button */}
                              {event.location ? (
                                <>
                                  <View style={styles.locationRow}>
                                    <MaterialIcons
                                      name="location-on"
                                      size={13}
                                      color="#94a3b8"
                                    />
                                    <Text
                                      style={styles.locationText}
                                      numberOfLines={1}
                                    >
                                      {event.location}
                                    </Text>
                                  </View>
                                  {parseGeoUri(event.locationUrl) ? (
                                    <Pressable
                                      style={styles.eventNavBtn}
                                      onPress={(e) => {
                                        e.stopPropagation?.();
                                        onNavigate(
                                          event.location as string,
                                          event.locationUrl
                                        );
                                      }}
                                      accessible={true}
                                      accessibilityRole="button"
                                      accessibilityLabel="נווט"
                                    >
                                      <Text style={styles.eventNavBtnText}>
                                        נווט
                                      </Text>
                                      <MaterialIcons
                                        name="near-me"
                                        size={13}
                                        color="#8d6e63"
                                      />
                                    </Pressable>
                                  ) : null}
                                </>
                              ) : null}
                            </View>
                          </Pressable>
                        )}
                        {!event.isPersonalTask &&
                        event.myAssignedTasks &&
                        event.myAssignedTasks.length > 0 ? (
                          <View style={styles.calendarTaskExpansionContainer}>
                            <InlineEventTasksSection tasks={event.myAssignedTasks} />
                          </View>
                        ) : null}
                        {!event.isPersonalTask &&
                        event.importantItems &&
                        event.importantItems.length > 0 ? (
                          <View style={styles.calendarTaskExpansionContainer}>
                            <InlineImportantItemsSection
                              items={event.importantItems}
                            />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      );
    }

    if (item.type === 'gapToggle') {
      const { dateStr, missingDays, isOpen } = item;
      return (
        <View style={styles.gapRow}>
          <Pressable
            onPress={() =>
              setOpenGaps((prev) => ({
                ...prev,
                [dateStr]: !(prev[dateStr] ?? false),
              }))
            }
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={
              isOpen
                ? 'הסתר ימים ללא אירועים'
                : `הצג ${missingDays.length === 1 ? 'יום' : 'ימים'} ללא אירועים`
            }
            hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
            style={({ pressed }) => [
              styles.gapToggleButton,
              pressed && styles.gapToggleButtonPressed,
            ]}
          >
            {isOpen ? (
              <Minus size={18} color={PRIMARY_BLUE} strokeWidth={2} />
            ) : (
              <Plus size={18} color={PRIMARY_BLUE} strokeWidth={2} />
            )}
          </Pressable>
        </View>
      );
    }

    if (item.type === 'missingDay') {
      const { day } = item;
      return (
        <View style={styles.dayGroup}>
          <View style={[styles.dayHeader, { flexDirection: rtl.flexDirection }]}>
            <View style={styles.dayNumberCircle}>
              <Text style={styles.dayNumberText}>{day.dayNumber}</Text>
            </View>
            <Text style={styles.dayLabel}>{day.dayLabel}</Text>
            <View style={styles.dayDivider} />
            <Pressable
              onPress={() => onAddPress(day.dateStr)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`הוסף אירוע בתאריך ${day.dayLabel}`}
              style={({ pressed }) => [
                styles.addEventPill,
                pressed && styles.addEventPillPressed,
              ]}
            >
              <Text style={styles.addEventPillText}>הוסף</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    // endIndicator
    return (
      <View style={styles.endIndicator}>
        <MaterialIcons name="history" size={30} color="#d1d5db" />
        <Text style={styles.endText}>סוף ההיסטוריה המוצגת</Text>
      </View>
    );
  };

  return (
    <FlashList
      data={flattenedTimelineRows}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.type}
      renderItem={renderFlatRow}
      initialScrollIndex={todayRowIndex >= 0 ? todayRowIndex : undefined}
      initialScrollIndexParams={{ viewOffset: 12 }}
      style={{ flex: 1, overflow: 'hidden' }}
      contentContainerStyle={{
        paddingTop: 16,
        paddingHorizontal: 16,
        paddingBottom: 120,
      }}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ===== General Styles =====
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  /** Ensures RTL Yoga layout for this screen if a navigator strips root `direction` inheritance (Android). */
  safeAreaRtl: {
    direction: 'rtl',
  },
  container: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },

  /* Community filter banner */
  communityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  communityBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    textAlign: 'right',
  },
  communityBannerClose: {
    padding: 4,
  },

  /* Header */
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  monthHeaderWrap: {
    marginTop: 6,
    marginBottom: 0,
    paddingHorizontal: 2,
  },
  monthTimelineWrap: {
    marginBottom: 12,
    alignItems: 'center',
  },
  monthNavRow: {
    width: '100%',
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  monthNavCluster: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 2,
    // Horizontal padding prevents the cluster from reaching the filter icon area
    paddingHorizontal: 50,
  },
  monthNavFilterBtn: {
    position: 'absolute',
    ...position.start(4),
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  timelineFilterRow: {
    // Column cross-axis: rtl.alignStart = physical RIGHT (measured 2026-07, Section D).
    alignItems: rtl.alignStart,
    paddingHorizontal: 12,
    paddingBottom: 4,
    paddingTop: 2,
  },
  timelineFilterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  monthChevronButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  monthYear: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  monthYearHebrew: {
    fontSize: 11,
    fontWeight: '400',
    color: '#8fa3b0',
    textAlign: 'center',
    marginTop: 1,
  },
  monthTitleButton: {
    flex: 1,
    alignItems: 'center',
  },
  monthNavRowPanel: {
    paddingVertical: 2,
  },
  monthYearPanel: {
    fontSize: 15,
    fontWeight: '700',
  },
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
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

  /* Segmented Control */
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    padding: 4,
    position: 'relative',
    height: 40,
  },
  /** Android: LTR row → ציר זמן left, חודשי right; matches pill anchored `right: 4` + translateX for monthly/timeline. */
  segmentedControlAndroidTrack: {
    direction: 'ltr',
    flexDirection: 'row',
  },
  segmentedSlider: {
    position: 'absolute',
    top: 4,
    height: 32,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#647b87',
  },
  segmentTextActive: {
    color: PRIMARY_BLUE,
    fontWeight: '700',
  },
  segmentTextDisabled: {
    color: '#b0bec5',
    fontWeight: '600',
  },

  /* Content */
  content: {
    flex: 1,
    overflow: 'hidden',
  },

  /* Timeline */
  timelineContainer: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  dayGroup: {
    marginBottom: 32,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  dayNumberCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberCircleToday: {
    backgroundColor: `${PRIMARY_BLUE}20`,
  },
  dayNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#647b87',
  },
  dayNumberTextToday: {
    color: PRIMARY_BLUE,
  },
  dayLabelBlock: {
    flexDirection: 'column',
  },
  dayLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#647b87',
  },
  dayLabelToday: {
    color: '#111517',
  },
  dayHebrewLabel: {
    fontSize: 11,
    fontWeight: '400',
    color: '#a8bbc6',
    marginTop: 1,
    textAlign: getTextAlign() ?? 'right',
  },
  dayDivider: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
    borderRadius: 1,
  },
  addEventPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#e8f5fd',
  },
  addEventPillPressed: {
    opacity: 0.7,
  },
  addEventPillText: {
    fontSize: 13,
    color: PRIMARY_BLUE,
    fontWeight: '600',
  },
  gapRow: {
    // Column cross-axis: rtl.alignStart = physical RIGHT (measured 2026-07, Section D).
    alignItems: rtl.alignStart,
    paddingRight: needsExplicitRTL() ? 6 : 0,
    paddingStart: needsExplicitRTL() ? 0 : 6,
    marginTop: -16,
    marginBottom: 8,
  },
  gapToggleButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  gapToggleButtonPressed: {
    backgroundColor: '#e8f5fd',
  },

  /* Timeline Line */
  timelineLineWrapper: {
    position: 'relative',
  },
  eventsWrapper: {
    gap: 16,
  },
  eventRow: {
    width: '100%',
    alignItems: 'stretch',
  },
  eventRowInner: {
    width: '100%',
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    gap: 10,
  },
  eventRailColumn: {
    width: 20,
    alignItems: 'center',
    alignSelf: 'stretch',
    position: 'relative',
  },
  eventRailLine: {
    position: 'absolute',
    width: 2,
    top: 0,
    bottom: -16,
    backgroundColor: '#e5e7eb',
    borderRadius: 1,
  },
  eventTimeColumn: {
    width: 44,
    alignItems: 'center',
    paddingTop: 14,
    flexShrink: 0,
  },
  eventTimeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  eventEndTimeText: {
    fontSize: 11,
    color: '#cbd5e1',
    textAlign: 'center',
    marginTop: 1,
  },
  eventDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    backgroundColor: '#ffffff',
    zIndex: 1,
    marginTop: 10,
  },
  eventDotCancelled: {
    borderColor: '#9ca3af',
  },

  /* Holiday Row */
  timelineHolidayRow: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    borderRightWidth: 3,
    borderRightColor: '#f59e0b',
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
    minHeight: 44,
  },
  timelineHolidayTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#92400e',
    textAlign: 'right',
    writingDirection: 'rtl',
  },

  /* Event Card */
  timelineEventCardColumn: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
  },
  eventCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  eventCardWithTasks: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  calendarTaskExpansionContainer: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 12,
    paddingBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  eventCardCancelled: {
    opacity: 0.6,
  },

  /* Pending personal RSVP — timeline (no opacity: avoids RN repaint bug on RSVP yes) */
  pendingPersonalInviteCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
  },
  pendingRsvpBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    marginTop: 4,
    alignSelf: rtl.alignStart,
  },
  pendingRsvpBadgeText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: '#64748b',
  },

  eventAccentBar: {
    position: 'absolute',
    ...position.start(0),
    top: 0,
    bottom: 0,
    width: 4,
    borderRadius: 2,
  },
  eventCardContent: {
    padding: 12,
    ...spacing.paddingStart(16),
    minHeight: 72,
  },
  eventCardHeader: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  /**
   * Personal-dismiss "X" for general community reminders — visually light
   * secondary card action (see PART 6/19 of the personal-dismiss task).
   * Never rendered for ordinary tasks, which have no completion UI here
   * either (CalendarTaskCard opens the task detail sheet instead).
   */
  dismissReminderButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  categoryTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  overdueBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#fee2e2',
  },
  overdueBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  taskAssigneeAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskAssigneeInitials: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ffffff',
  },
  taskSubtasksRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  taskSubtasksText: {
    fontSize: 11,
    color: '#b45309',
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111517',
    marginBottom: 4,
    textAlign: rtl.textAlign,
  },
  eventTitleCancelled: {
    textDecorationLine: 'line-through',
    textDecorationColor: '#9ca3af',
    color: '#9ca3af',
  },
  locationRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: rtl.textAlign,
    flex: 1,
  },
  eventNavBtn: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    // Shrink-wrap to content, positioned at physical LEFT (logical end in RTL).
    alignSelf: rtl.alignEnd,
    gap: 4,
    backgroundColor: 'rgba(141,110,99,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 6,
  },
  eventNavBtnText: {
    color: '#8d6e63',
    fontWeight: '700',
    fontSize: 12,
  },
  profileCirclesRow: {
    marginTop: 6,
  },

  /* End Indicator */
  endIndicator: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  endText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },

  /* Calendar Panel (monthly view) */
  calendarPanel: {
    backgroundColor: BG_COLOR,
    overflow: 'hidden',
  },
  expandedCalendarScroll: {
    flex: 1,
  },
  expandedCalendarScrollContent: {
    paddingBottom: EXPANDED_GRID_BOTTOM_PADDING,
  },
  expandedCalendarGridHost: {},
  dragHandleContainer: {
    height: CALENDAR_HANDLE_HEIGHT,
    minHeight: CALENDAR_HANDLE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_COLOR,
    zIndex: 2,
  },
  dailyEventsScroll: {
    flex: 1,
  },

  /* FAB */
});

// ===== Monthly View Styles =====
const mStyles = StyleSheet.create({
  gridContainer: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  gridContainerExpanded: {
    paddingHorizontal: 8,
  },
  weekRow: {
    gap: 4,
    marginBottom: 4,
  },
  weekRowExpanded: {
    gap: 3,
  },

  /* Day Header */
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
  },
  dayHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
  },
  shabbatHeaderText: {
    color: PRIMARY_BLUE,
  },

  /* Day Cell */
  dayCell: {
    flex: 1,
    height: COMPACT_CELL_HEIGHT,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    position: 'relative',
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
    gap: 2,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  dayCellExpanded: {
    // Column cross-axis: rtl.alignStart = physical RIGHT (measured 2026-07, Section D).
    alignItems: rtl.alignStart,
    justifyContent: 'flex-start',
    paddingTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 3,
  },
  dayCellOtherMonth: {
    backgroundColor: '#fafafa',
    shadowOpacity: 0,
    elevation: 0,
  },

  /* Day Number */
  dayNumWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumWrapperSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumTodayBg: {
    backgroundColor: `${PRIMARY_BLUE}15`,
  },
  dayNumSelectedBg: {
    backgroundColor: PRIMARY_BLUE,
  },
  dayNumText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  dayNumTextSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1f2937',
  },
  dayNumOtherMonth: {
    color: '#d1d5db',
  },
  dayNumTodayText: {
    color: PRIMARY_BLUE,
    fontWeight: '700',
  },
  dayNumSelectedText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  dayNumRowExpanded: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: EXPANDED_DAY_HEADER_HEIGHT,
    paddingHorizontal: 2,
    marginBottom: 1,
  },

  /* Birthday */
  birthdayEmoji: {
    fontSize: 10,
    lineHeight: 14,
  },

  eventIndicatorBar: {
    position: 'absolute',
    right: 12,
    bottom: 6,
    left: 12,
    height: 3,
    borderRadius: 999,
    backgroundColor: `${PRIMARY_BLUE}45`,
  },

  /* Expanded Cell Content */
  expandedEvents: {
    width: '100%',
    gap: 3,
    alignSelf: 'stretch',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  expandedBirthdayRow: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: '#fff1f2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ffe4e6',
  },
  expandedBirthdayText: {
    fontSize: 10,
    color: '#be185d',
    fontWeight: '600',
    textAlign: rtl.textAlign,
  },
  expandedEventRow: {
    width: '100%',
    borderRadius: 6,
    paddingHorizontal: 3,
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: rtl.alignStart,
  },
  expandedEventRowCompact: {
    minHeight: EXPANDED_ROW_ITEM_HEIGHT,
    paddingVertical: 1,
  },
  expandedEventRowSingle: {
    minHeight: EXPANDED_ROW_ITEM_HEIGHT_SINGLE,
    paddingVertical: 2,
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
  },
  expandedEventRowCancelled: {
    opacity: 0.72,
  },
  expandedEventRowPersonal: {
    backgroundColor: '#f9fafb',
    borderColor: '#eef0f3',
  },
  expandedEventRowCommunity: {
    backgroundColor: '#eff6ff',
    borderColor: '#dbeafe',
  },
  expandedEventRowShared: {
    backgroundColor: '#f8fafc',
    borderColor: '#e8ecf1',
  },
  expandedEventSingleContainer: {
    width: '100%',
    paddingHorizontal: 1,
    paddingTop: 1,
    paddingBottom: 1,
    flexDirection: 'column',
    alignItems: rtl.alignStart,
  },
  expandedEventSingleTitle: {
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
    width: '100%',
    fontSize: 10,
    fontWeight: '500',
    color: '#111827',
    lineHeight: 13,
    includeFontPadding: false,
  },
  expandedEventText: {
    width: '100%',
    minWidth: 0,
    textAlign: rtl.textAlign,
    flexShrink: 1,
    fontSize: 10,
    color: '#111827',
    includeFontPadding: false,
  },
  expandedEventTimeText: {
    fontSize: 9,
    fontWeight: '500',
    color: '#6b7280',
    textAlign: rtl.textAlign,
    width: '100%',
    marginTop: 1,
    includeFontPadding: false,
  },
  expandedEventTitleCancelled: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  expandedDayFiller: {
    flex: 1,
    minHeight: 8,
  },

  /* Task indicators */
  taskIndicatorDot: {
    position: 'absolute',
    right: 4,
    bottom: 10,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#f59e0b',
  },
  expandedTaskRow: {
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: '#fffbeb',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fde68a',
    alignItems: rtl.alignStart,
  },
  expandedTaskText: {
    fontSize: 9,
    color: '#b45309',
    fontWeight: '600',
    textAlign: rtl.textAlign,
  },

  /* Holiday indicators — warm amber, non-interactive */
  compactHolidayLabel: {
    paddingHorizontal: 2,
    paddingVertical: 1,
    maxWidth: '100%',
  },
  compactHolidayText: {
    fontSize: 8,
    color: '#b45309',
    fontWeight: '500',
    textAlign: 'center',
    includeFontPadding: false,
  },
  expandedHolidayRow: {
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: '#fef3c7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fde68a',
    alignItems: rtl.alignStart,
  },
  expandedHolidayText: {
    fontSize: 9,
    color: '#92400e',
    fontWeight: '600',
    textAlign: rtl.textAlign,
    includeFontPadding: false,
  },
});

const pickerStyles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 14,
    direction: 'rtl',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'center',
    marginBottom: 14,
  },
  columns: {
    flexDirection: 'row-reverse',
    gap: 12,
  },
  column: {
    flex: 1,
  },
  columnTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#647b87',
    textAlign: 'right',
    marginBottom: 8,
  },
  columnScroll: {
    maxHeight: 260,
  },
  optionButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#edf2f7',
  },
  optionButtonActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111517',
    textAlign: 'right',
  },
  optionTextActive: {
    color: PRIMARY_BLUE,
  },
  actions: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 14,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#647b87',
  },
  primaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: PRIMARY_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
});

// ===== Day Events List Styles =====
const dStyles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 88,
  },

  /* Header */
  header: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerTitleBlock: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111517',
  },
  headerHebrewDate: {
    fontSize: 12,
    fontWeight: '400',
    color: '#8fa3b0',
    marginTop: 1,
    textAlign: getTextAlign() ?? 'right',
  },
  addBtn: {
    backgroundColor: `${PRIMARY_BLUE}15`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY_BLUE,
  },
  closeBtn: {
    padding: 4,
  },

  /* Birthday Card */
  birthdayCard: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    backgroundColor: '#fdf2f8',
    borderRadius: 16,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#fce7f3',
    marginBottom: 8,
  },
  birthdayEmoji: {
    fontSize: 28,
  },
  birthdayContent: {
    flex: 1,
  },
  birthdayTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#be185d',
    textAlign: rtl.textAlign,
  },
  birthdayAge: {
    fontSize: 13,
    color: '#9d174d',
    marginTop: 2,
    textAlign: rtl.textAlign,
  },

  /* Event Card - Stitch Design */
  card: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    gap: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  /* Unified outer shell used when an event has important items.
     Owns the white card decoration (bg, radius, border, shadow, spacing)
     so the event Pressable and accordion share one visual container. */
  unifiedCardOuter: {
    marginBottom: 8,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  /* Flat pressable inside unifiedCardOuter — layout only, no decoration */
  cardFlatPressable: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  /* Horizontal inset for the accordion inside unifiedCardOuter */
  importantItemsInset: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  timeCol: {
    alignItems: 'center',
    minWidth: 52,
  },
  timeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
  },
  durationText: {
    fontSize: 11,
    color: '#647b87',
    marginTop: 3,
  },
  divider: {
    width: 4,
    height: 40,
    borderRadius: 2,
  },
  content: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111517',
    textAlign: rtl.textAlign,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-start',
  },
  locationDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#647b87',
  },
  locationText: {
    fontSize: 13,
    color: '#647b87',
  },
  assigneeDots: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    marginTop: 4,
  },
  assigneeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Task Card (day panel) */
  taskCard: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    gap: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  taskIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f7ff',
  },
  taskOverdueBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#fee2e2',
    marginTop: 4,
    alignSelf: rtl.alignStart,
  },
  taskOverdueText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },

  /* Pending personal RSVP — month day panel (no opacity: avoids RN repaint bug on RSVP yes) */
  pendingPersonalInviteCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  pendingRsvpBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    marginTop: 4,
    alignSelf: rtl.alignStart,
  },
  pendingRsvpBadgeText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748b',
  },
  taskTitleRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
  },
  taskAssigneeAvatarSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskAssigneeInitialsSmall: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ffffff',
  },
  taskSubtasksRowDay: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  taskSubtasksTextDay: {
    fontSize: 11,
    color: '#64748b',
  },

  /* Empty State */
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },

  /* Holiday row — read-only, warm amber, above event cards */
  holidayRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fde68a',
    marginBottom: 8,
  },
  holidayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
    flexShrink: 0,
  },
  holidayTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#92400e',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
});
