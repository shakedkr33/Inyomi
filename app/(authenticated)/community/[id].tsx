import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  type GestureResponderEvent,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  type StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextStyle,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AppConfirmationDialog } from '@/components/AppConfirmationDialog';
import {
  type AuthorizedHomeEventTask,
  type EventTaskAccordionData,
  EventTasksAccordion,
} from '@/components/home/EventTasksAccordion';
import { ImportantItemsAddToTasksButton } from '@/components/ImportantItemsAddToTasksButton';
import {
  type JoinApprovalMode,
  JoinApprovalSettingsModal,
} from '@/components/JoinApprovalSettingsModal';
import { ProfileAssociationSheet } from '@/components/ProfileAssociationSheet';
import { RsvpBlockedByTaskDialog } from '@/components/RsvpBlockedByTaskDialog';
import { useActionSheet } from '@/contexts/ActionSheetContext';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { selectMainReminderCandidates } from '@/lib/communityMainReminderCandidate';
import { canManageEventReminderItem } from '@/lib/eventReminderPermissions';
import { formatCommunityMainTaskCtaText } from '@/lib/eventTasksSummary';
import {
  formatEventsTabMonthYearLabel,
  getCurrentEventsTabMonth,
  getEventsTabMonthRange,
  getEventsTabMonthTemporalKind,
  getLocalDayStart,
  getNextEventsTabMonth,
  getPreviousEventsTabMonth,
  hasEventEndedByNow,
  isCancelledEventWithinCommunityVisibilityWindow,
  isCurrentEventsTabMonth,
} from '@/lib/eventsTabDateHelpers';
import {
  getOpenCommunityCalendarActionLabel,
  isOpenCommunityCalendarActionVisible,
} from '@/lib/openCommunityCalendarUi';
import { resolveActiveCommunityContext } from '@/lib/resolveActiveCommunityContext';
import { APP_IS_RTL, needsExplicitRTL, position, rtl } from '@/lib/rtl';
import {
  formatDueDate,
  formatDueTime,
  formatReminderScheduleLabel,
  isTaskPastDue,
} from '@/lib/taskDueStatus';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

import { getConvexErrorCode } from '@/lib/utils/convexError';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

// Stage 2A: "הכל" was renamed to "ראשי" (the Main overview tab). Old
// deep-links / persisted params using "הכל" are still accepted — see the
// activeTab initializer below — so existing links never break.
const TABS = ['ראשי', 'אירועים', 'תזכורות', 'פעילות'] as const;
type Tab = (typeof TABS)[number];
/** Stage 2A backward-compat: pre-rename tab param value. */
const LEGACY_MAIN_TAB_PARAM = 'הכל';

const EVENT_COLORS = [
  '#36a9e2',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#f43f5e',
  '#6366f1',
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type RsvpStatus = 'yes' | 'no' | 'maybe' | 'none';
/**
 * STAGE 3 CORRECTION (Part A) — "אירועים" tab date scope is now always an
 * exact calendar month, navigated one month at a time via prev/next arrows
 * (see MonthYearNavigator). The former "קרובים" default + forward-only
 * 12-month tab strip has been removed — there is no product-imposed past
 * or future navigation limit any more (see lib/eventsTabDateHelpers.ts).
 */
type EventsTabFilter = { year: number; monthIndex0: number };
type TaskSummary = {
  total: number;
  assigned: number;
  totalTasksCount: number;
  assignedTasksCount: number;
  myAssignedTasks: Array<{ id: Id<'eventTasks'>; title: string }>;
  hasMyAssignedTasks: boolean;
};

interface EventDoc {
  _id: Id<'events'>;
  title: string;
  category?: string;
  startTime: number;
  endTime: number;
  allDay?: boolean;
  location?: string;
  description?: string;
  communityId?: Id<'communities'>;
  requiresRsvp?: boolean;
  tasksVisibleToParticipants?: boolean;
  createdBy?: Id<'users'>;
  /** Stage 2A: used for the "ראשי" tab's "חדש" chip (createdAt > previous visit). */
  createdAt?: number;
  status?: 'active' | 'cancelled';
  cancelledAt?: number;
  /** FIX C — set once a manager early-removes a cancelled event from Community display. */
  removedFromCommunityAt?: number;
  cancelReason?: string;
  /** Open community events: personal calendar / "הסר מהיומן" (from Convex) */
  isSavedToMyCalendar?: boolean;
  /** Stage 3 — "אירועים" tab bucket flags (from listCommunityEventsTabPaged only). */
  isPendingRsvp?: boolean;
  isAdditionalEligible?: boolean;
  importantItems?: Array<{ id: string; title: string }>;
}

interface TaskDoc {
  _id: Id<'tasks'>;
  title: string;
  description?: string;
  dueDate?: number;
  dueAt?: number;
  hasTime?: boolean;
  completed: boolean;
  completedAt?: number;
  createdBy?: Id<'users'>;
  communityId?: Id<'communities'>;
  sourceType?: string;
  reminderType?: string;
  customReminderAt?: number;
  reminders?: Array<{
    id: string;
    type: string;
    customAmount?: number;
    customUnit?: string;
    customReminderAt?: number;
    label?: string;
  }>;
  attachments?: Array<{
    storageId: Id<'_storage'>;
    originalName: string;
    displayName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: number;
    uploadedBy: Id<'users'>;
  }>;
}

/**
 * Stage 4 — Community "תזכורות" tab: one entry per personally-relevant,
 * active community event that has "חשוב לזכור" items — from
 * api.events.listCommunityEventReminderGroupsPaged. Deliberately NOT the
 * shared `EventDoc` shape: this is a narrow, server-shaped reminder-group
 * projection, not a general-purpose event record.
 */
interface EventReminderGroupDoc {
  _id: Id<'events'>;
  title: string;
  startTime: number;
  endTime: number;
  allDay?: boolean;
  location?: string;
  status?: 'active' | 'cancelled';
  importantItems: Array<{ id: string; title: string }>;
  createdBy: Id<'users'>;
}

type CommunityActivityType =
  | 'event_created'
  | 'event_updated'
  | 'event_cancelled'
  | 'reminder_created'
  | 'task_assigned'
  | 'task_completed'
  | 'member_joined'
  | 'community_updated';

type CommunityActivityEntityType =
  | 'event'
  | 'reminder'
  | 'task'
  | 'community'
  | 'member';

interface CommunityActivityItem {
  id: Id<'communityActivities'>;
  type: CommunityActivityType;
  title: string;
  description?: string;
  actorDisplayName?: string;
  createdAt: number;
  entityType?: CommunityActivityEntityType;
  entityId?: string;
}

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type ActivityDateGroup = 'היום' | 'אתמול' | 'השבוע' | 'מוקדם יותר';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEventColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}

function isEventPast(event: EventDoc): boolean {
  const now = Date.now();
  if (event.allDay) {
    const d = new Date(event.startTime);
    d.setHours(23, 59, 59, 999);
    return d.getTime() < now;
  }
  return event.endTime < now;
}

function formatEventDate(ts: number, allDay?: boolean): string {
  const d = new Date(ts);
  if (allDay) {
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFlyerDate(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatFlyerTime(event: EventDoc): string {
  if (event.allDay) return 'כל היום';
  return `${new Date(event.startTime).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  })} — ${new Date(event.endTime).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

// ─── Stage 2A "ראשי" tab helpers ────────────────────────────────────────────

/**
 * Local (device-timezone) day-boundary key, mirroring the existing
 * calendar.tsx Y/M/D comparison approach. No new timezone semantics are
 * introduced here — this only reuses `Date`'s local getters.
 */
function getLocalDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isEventOnLocalDay(event: EventDoc, dayKey: string): boolean {
  return getLocalDayKey(event.startTime) === dayKey;
}

/**
 * Stage 2A "חדש" chip: an event is "new" only once we know the viewer's
 * PREVIOUS visit timestamp (captured before `markCommunityViewed` runs —
 * see `previousVisitAtRef` in the screen component) and this event was
 * created after that visit. `undefined` previousVisitAt (e.g. first-ever
 * visit) never renders "חדש" — matches the existing
 * `computeHasNewEventsSinceVisit` convention of treating "unknown" as "not
 * new" rather than "everything is new".
 */
function isEventNewSincePreviousVisit(
  event: EventDoc,
  previousVisitAt: number | undefined
): boolean {
  if (previousVisitAt === undefined || event.createdAt === undefined) {
    return false;
  }
  return event.createdAt > previousVisitAt;
}

function formatMainCardDateTime(event: EventDoc): string {
  const dateLabel = new Date(event.startTime).toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  if (event.allDay) return `${dateLabel} · כל היום`;
  const timeLabel = new Date(event.startTime).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateLabel} · ${timeLabel}`;
}

/** Compact RSVP/status line for Stage 2A Main cards — reuses existing
 * status vocabulary (no new RSVP semantics).
 *
 * QA FIX (Issue 3): the creator of an RSVP-required event never needs to
 * RSVP to their own event (see computeRsvpAttentionState's canonical
 * creator exemption in convex/communityCalendarState.ts) — so the creator
 * must never see "נדרש אישור הגעה" on their own card, even though their
 * own rsvpStatus is naturally 'none'/unanswered.
 */
function getMainCardStatusLabel(
  event: EventDoc,
  rsvpStatus: RsvpStatus,
  isCreator: boolean
): string {
  if (event.requiresRsvp === false) return 'פתוח לחברי הקהילה';
  if (isCreator) return 'אירוע שלך';
  if (rsvpStatus === 'yes') return 'אישרת הגעה';
  if (rsvpStatus === 'no') return 'סימנת שלא מגיע/ה';
  if (rsvpStatus === 'maybe') return 'סימנת אולי מגיע/ה';
  return 'נדרש אישור הגעה';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatReminderShortLabel(
  reminderType: string | undefined,
  customReminderAt: number | undefined
): string | null {
  if (!reminderType || reminderType === 'none') return null;
  if (reminderType === 'morning') return 'בבוקר';
  if (reminderType === 'evening') return 'בערב';
  if (reminderType === 'at_time') return 'בזמן';
  if (reminderType === 'hour_before') return 'שעה לפני';
  if (reminderType === 'custom' && customReminderAt) {
    const d = new Date(customReminderAt);
    return `${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ${d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`;
  }
  return null;
}

function formatReminderFullLabel(
  reminderType: string | undefined,
  customReminderAt: number | undefined
): string | null {
  if (!reminderType || reminderType === 'none') return null;
  if (reminderType === 'morning') return 'התראה בבוקר';
  if (reminderType === 'evening') return 'התראה בערב';
  if (reminderType === 'at_time') return 'התראה בזמן';
  if (reminderType === 'hour_before') return 'התראה שעה לפני';
  if (reminderType === 'custom' && customReminderAt) {
    const d = new Date(customReminderAt);
    return `התראה ב-${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ${d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`;
  }
  return null;
}

function getActivityIcon(type: CommunityActivityType): IoniconName {
  const icons: Record<CommunityActivityType, IoniconName> = {
    event_created: 'calendar-outline',
    event_updated: 'create-outline',
    event_cancelled: 'close-circle-outline',
    reminder_created: 'notifications-outline',
    task_assigned: 'person-add-outline',
    task_completed: 'checkmark-circle-outline',
    member_joined: 'people-outline',
    community_updated: 'information-circle-outline',
  };
  return icons[type];
}

function formatRelativeActivityTime(createdAt: number): string {
  const diffMs = Date.now() - createdAt;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) return 'עכשיו';
  if (diffMinutes < 60) return `לפני ${diffMinutes} דק׳`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return 'לפני שעה';
  if (diffHours < 24) return `לפני ${diffHours} שעות`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activityDate = new Date(createdAt);
  activityDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (today.getTime() - activityDate.getTime()) / 86_400_000
  );
  if (diffDays === 1) return 'אתמול';

  return new Date(createdAt).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
  });
}

function getActivityDateGroup(createdAt: number): ActivityDateGroup {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activityDate = new Date(createdAt);
  activityDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (today.getTime() - activityDate.getTime()) / 86_400_000
  );
  if (diffDays === 0) return 'היום';
  if (diffDays === 1) return 'אתמול';
  if (diffDays < 7) return 'השבוע';
  return 'מוקדם יותר';
}

function groupActivitiesByDate(
  activities: CommunityActivityItem[]
): Array<{ title: ActivityDateGroup; items: CommunityActivityItem[] }> {
  const groups: ActivityDateGroup[] = ['היום', 'אתמול', 'השבוע', 'מוקדם יותר'];
  return groups
    .map((title) => ({
      title,
      items: activities.filter(
        (activity) => getActivityDateGroup(activity.createdAt) === title
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * FIX 8B — member-facing, action-oriented task-status copy shared by the
 * Community Main carousel cards (MainEventCard/AdditionalEventCard) and the
 * Community "אירועים" tab card (EventsTabCard). Replaces the previous
 * technical "X/Y הוקצו" counter with plain-language Hebrew copy describing
 * (a) how many tasks are still unassigned and (b) how many are assigned to
 * the viewer themself — combined into one concise line when both are true.
 * Returns null when there is nothing meaningful to show (no active tasks).
 */
function formatCommunityTaskStatusLine(
  taskSummary: TaskSummary
): string | null {
  const assignedTasksCount =
    taskSummary.assignedTasksCount ?? taskSummary.assigned;
  const totalTasksCount = taskSummary.totalTasksCount ?? taskSummary.total;
  if (totalTasksCount <= 0) return null;

  const unassignedCount = Math.max(totalTasksCount - assignedTasksCount, 0);
  const myCount = taskSummary.myAssignedTasks.length;

  if (unassignedCount <= 0 && myCount <= 0) {
    return 'כל המשימות שובצו';
  }

  const myPartCompact =
    myCount === 1 ? 'משימה אחת' : myCount > 1 ? `${myCount} משימות` : null;
  const unassignedPartCompact =
    unassignedCount === 1
      ? 'אחת ממתינה לשיבוץ'
      : unassignedCount > 1
        ? `${unassignedCount} ממתינות לשיבוץ`
        : null;

  if (myPartCompact && unassignedPartCompact) {
    return `יש לך ${myPartCompact} · ${unassignedPartCompact}`;
  }
  if (myPartCompact) {
    return `יש לך ${myPartCompact} באירוע`;
  }
  if (unassignedCount === 1) {
    return 'משימה אחת ממתינה לשיבוץ';
  }
  return `${unassignedCount} משימות ממתינות לשיבוץ`;
}

/**
 * FIX 8B FOLLOW-UP §1 — own-assignment-only variant of
 * formatCommunityTaskStatusLine, used when the viewer does NOT have full
 * task visibility (not a manager and `tasksVisibleToParticipants !== true`).
 * Deliberately never mentions unassigned/total counts — those belong
 * exclusively to the full-visibility branch below.
 *
 * FIX 8B FINAL CTA COPY — used ONLY by `getCommunityMainTaskStatusLine`
 * (Community Main's CTA copy) when there are no unassigned tasks left but
 * the viewer has assigned tasks of their own (e.g. "יש לך משימה אחת
 * באירוע") — distinct from the plain status copy the Events tab still uses
 * via `formatCommunityTaskStatusLine`, which is intentionally untouched.
 */
function formatOwnAssignedOnlyTaskStatusLine(myCount: number): string | null {
  if (myCount <= 0) return null;
  return myCount === 1
    ? 'יש לך משימה אחת באירוע'
    : `יש לך ${myCount} משימות באירוע`;
}

// `formatCommunityMainTaskCtaText` (Community Main-only task CTA copy) now
// lives in `lib/eventTasksSummary.ts` — see its doc comment there — so the
// mine/available combined-copy rule is unit-testable without a React
// Native harness and cannot drift from what this screen renders. Imported
// above via the `@/lib/eventTasksSummary` import group. Deliberately
// separate from `formatCommunityTaskStatusLine` below, which the Events
// tab still uses verbatim per the FIX 8B UX CORRECTION spec (§5) —
// changing the CTA copy must never affect Events tab copy.

/**
 * FIX 8B UX CORRECTION — `isActionable: false` means the line must render
 * as static/passive text (e.g. "✓ כל המשימות שובצו" when everything is
 * assigned and the viewer has nothing of their own) — never as the CTA
 * pill button, since there is nothing useful to open. `isDone` is kept
 * separately for `TaskSummaryLine`'s existing `doneStyle` contract.
 */
type CommunityMainTaskLine = {
  text: string;
  isDone: boolean;
  isActionable: boolean;
};

/**
 * FIX 8B FOLLOW-UP §1 — the ONLY function Community Main's carousel cards
 * (MainEventCard/AdditionalEventCard) are allowed to derive their visible
 * task-status copy from. `getTaskCountsForEvents` (→ `taskSummary`) is NOT
 * visibility-aware on its own — it always returns the event's real total
 * and unassigned counts. This combines it with `homeTaskEntry`, sourced
 * from the SAME authorized query (`listEventTasksForHome`) that gates the
 * task sheet's actual task list, to decide what is safe to reveal:
 *
 *   - No `homeTaskEntry` at all → nothing is authorized for this viewer on
 *     this event → render nothing (never fall back to raw counts).
 *   - `canManageTasks || tasksVisibleToParticipants` → full CTA copy
 *     (unassigned + own-assigned counts).
 *   - Otherwise → own-assignment-only line, built ONLY from
 *     `taskSummary.myAssignedTasks` — a per-viewer count that is always
 *     safe to reveal because it never describes other members' tasks or
 *     the event-wide total/unassigned counts.
 */
function getCommunityMainTaskStatusLine(
  taskSummary: TaskSummary | undefined,
  homeTaskEntry: EventTaskAccordionData | undefined
): CommunityMainTaskLine | null {
  if (!homeTaskEntry) return null;

  const hasFullVisibility =
    homeTaskEntry.canManageTasks || homeTaskEntry.tasksVisibleToParticipants;

  if (hasFullVisibility) {
    if (!taskSummary) return null;
    const assignedTasksCount =
      taskSummary.assignedTasksCount ?? taskSummary.assigned;
    const totalTasksCount = taskSummary.totalTasksCount ?? taskSummary.total;
    if (totalTasksCount <= 0) return null;
    const unassignedCount = Math.max(totalTasksCount - assignedTasksCount, 0);
    const myCount = taskSummary.myAssignedTasks.length;
    const text = formatCommunityMainTaskCtaText(myCount, unassignedCount);
    const isDone = unassignedCount <= 0;
    // Nothing actionable ONLY when everything is assigned AND the viewer
    // has nothing of their own to unclaim — every other combination still
    // opens a useful task sheet (claim, or view/unclaim own task).
    const isActionable = !(isDone && myCount <= 0);
    return { text, isDone, isActionable };
  }

  const myCount = taskSummary?.myAssignedTasks.length ?? 0;
  const text = formatOwnAssignedOnlyTaskStatusLine(myCount);
  if (!text) return null;
  return { text, isDone: false, isActionable: true };
}

interface TaskSummaryLineProps {
  /**
   * Raw counts-based summary — used as-is by EventRow, CommunityEventFlyerCard
   * and EventsTabCard (unchanged FIX 8B behavior). Community Main's carousel
   * cards no longer use this component at all — see `CommunityMainTaskCta`,
   * which renders their visibility-safe CTA copy directly.
   */
  taskSummary?: TaskSummary;
  copy: 'full' | 'compact';
  style: StyleProp<TextStyle>;
  doneStyle?: StyleProp<TextStyle>;
}

function TaskSummaryLine({
  taskSummary,
  style,
  doneStyle,
}: TaskSummaryLineProps) {
  const lineText = taskSummary
    ? formatCommunityTaskStatusLine(taskSummary)
    : null;
  if (!lineText) return null;

  let isAllAssigned = false;
  if (taskSummary) {
    const assignedTasksCount =
      taskSummary.assignedTasksCount ?? taskSummary.assigned;
    const totalTasksCount = taskSummary.totalTasksCount ?? taskSummary.total;
    isAllAssigned =
      totalTasksCount > 0 && assignedTasksCount >= totalTasksCount;
  }

  return (
    <Text numberOfLines={1} style={[style, isAllAssigned ? doneStyle : null]}>
      {lineText}
    </Text>
  );
}

// ─── RSVP Bottom Sheet ────────────────────────────────────────────────────────

interface RsvpSheetProps {
  eventId: Id<'events'> | null;
  currentStatus: RsvpStatus;
  onSelect: (status: RsvpStatus) => void;
  onClose: () => void;
}

const RSVP_OPTIONS: {
  status: RsvpStatus;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}[] = [
  { status: 'yes', label: 'כן', icon: 'checkmark-circle', color: '#22c55e' },
  { status: 'maybe', label: 'אולי', icon: 'help-circle', color: '#eab308' },
  { status: 'no', label: 'לא', icon: 'close-circle', color: '#ef4444' },
];

function RsvpBottomSheet({
  eventId,
  currentStatus,
  onSelect,
  onClose,
}: RsvpSheetProps) {
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    if (eventId) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else {
      slideAnim.setValue(300);
    }
  }, [eventId, slideAnim]);

  if (!eventId) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>האם תשתתף?</Text>
        {RSVP_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.status}
            style={[
              styles.sheetOption,
              currentStatus === opt.status && styles.sheetOptionActive,
            ]}
            onPress={() => {
              onSelect(opt.status);
              onClose();
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={opt.label}
          >
            <Ionicons
              name={opt.icon}
              size={22}
              color={currentStatus === opt.status ? opt.color : '#9ca3af'}
            />
            <Text
              style={[
                styles.sheetOptionText,
                currentStatus === opt.status && {
                  color: opt.color,
                  fontWeight: '700',
                },
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </Animated.View>
    </Modal>
  );
}

// ─── Action Sheet (+ button) ──────────────────────────────────────────────────
// Stage 2B: the top community "+" (and its AddPopoverMenu) was removed after
// the GLOBAL bottom-center "+" became context-aware — see _layout.tsx's
// ActionSheetModal and this screen's setActiveCommunityContext effect above.
// Community event/reminder creation is now reached exclusively through the
// global "+", using the exact same routes ("/event/new?communityId=" and
// "/community-reminder/new?communityId=") this popover used to push to.

type FlyerVariant = {
  bg: string;
  border: string;
  pillBg: string;
  pillText: string;
  divider: string;
  meta: string;
  buttonBg: string;
  buttonText: string;
};

const FLYER_VARIANTS: FlyerVariant[] = [
  {
    bg: '#f8f2ec',
    border: '#eadfce',
    pillBg: '#efe3d5',
    pillText: '#7a5c3f',
    divider: '#9a8268',
    meta: '#7c6b5a',
    buttonBg: '#e9ddd0',
    buttonText: '#5f4a35',
  },
  {
    bg: '#f6eef2',
    border: '#ead7e1',
    pillBg: '#eedde7',
    pillText: '#7a4b63',
    divider: '#9a6f84',
    meta: '#7a5d6d',
    buttonBg: '#eadbe4',
    buttonText: '#5f3f52',
  },
  {
    bg: '#eff4f6',
    border: '#dbe6eb',
    pillBg: '#dde9ee',
    pillText: '#4a6878',
    divider: '#6a8593',
    meta: '#5e7480',
    buttonBg: '#dce8ee',
    buttonText: '#32505d',
  },
  {
    bg: '#f5f3ef',
    border: '#e8e3db',
    pillBg: '#ebe6dd',
    pillText: '#6d6558',
    divider: '#8a8276',
    meta: '#6f695f',
    buttonBg: '#e8e3db',
    buttonText: '#554f45',
  },
];

interface CommunityEventFlyerCardProps {
  event: EventDoc;
  rsvpStatus: RsvpStatus;
  taskSummary?: TaskSummary;
  cardWidth: number;
  onOpenDetails: (eventId: Id<'events'>) => void;
  onRsvpSelect: (eventId: Id<'events'>, status: RsvpStatus) => Promise<void>;
  /** Owner/admin/creator: always "לפרטים", no inline RSVP */
  flyerDetailsOnly?: boolean;
  /** When false for participants, hide X/Y task counts (tasks not visible to them). */
  showTaskMetrics?: boolean;
  isSavedToMyCalendar?: boolean;
  onCalendarToggle?: (eventId: Id<'events'>) => void | Promise<void>;
  /** false for pending / non-active members (no personal calendar for community events) */
  viewerIsActiveCommunityMember?: boolean;
  communityArchived?: boolean;
}

// No longer rendered by the replaced "הכל"/TabAll tab (Stage 2A).
// Intentionally kept — the flyer/invitation visual direction it implements
// is explicitly reserved (per the Stage 2A prompt) for Event Details and the
// future "אירועים" tab redesign (Stage 2B/3), which is out of scope here.
// Deleting a working, reusable component to satisfy this stage's lint pass
// would risk losing it for that upcoming work; removal is deferred to
// whichever stage actually retires it.
// biome-ignore lint/correctness/noUnusedVariables: see comment above.
function CommunityEventFlyerCard({
  event,
  rsvpStatus,
  taskSummary,
  cardWidth,
  onOpenDetails,
  onRsvpSelect,
  flyerDetailsOnly = false,
  isSavedToMyCalendar = false,
  onCalendarToggle,
  viewerIsActiveCommunityMember = true,
  communityArchived = false,
}: CommunityEventFlyerCardProps) {
  const [showInlineChoices, setShowInlineChoices] = useState(false);
  const variant =
    FLYER_VARIANTS[Math.abs(event._id.length) % FLYER_VARIANTS.length];
  const isOpenCommunityEvent = event.requiresRsvp === false;
  /** Invitee has not chosen yet — CTA ממתין לאישור opens inline choices */
  const showInviteePendingCta =
    !flyerDetailsOnly && !isOpenCommunityEvent && rsvpStatus === 'none';
  /** Invitee chose yes/maybe/no — can change inline without locking after yes */
  const showMemberChangeRsvpCta =
    !flyerDetailsOnly && !isOpenCommunityEvent && rsvpStatus !== 'none';
  const showInlineRsvpRow =
    showInlineChoices && (showInviteePendingCta || showMemberChangeRsvpCta);
  const rawCategory = event.category?.trim();
  const showCategoryPill = Boolean(rawCategory && rawCategory.length > 0);
  const dateLabel = formatFlyerDate(event.startTime);
  const timeLabel = formatFlyerTime(event);
  const locationLabel = event.location?.trim() || 'מיקום יתעדכן בהמשך';
  const importantItemsCount = event.importantItems?.length ?? 0;
  const showImportantItemsChip = importantItemsCount > 0;
  const rsvpMeta = isOpenCommunityEvent
    ? 'פתוח לחברי הקהילה'
    : rsvpStatus === 'yes'
      ? 'אישרת הגעה'
      : rsvpStatus === 'no'
        ? 'סימנת לא'
        : rsvpStatus === 'maybe'
          ? 'סימנת אולי'
          : 'נדרש אישור הגעה';
  const taskTotal = taskSummary?.totalTasksCount ?? taskSummary?.total ?? 0;
  const taskCopy = cardWidth < 176 ? 'compact' : 'full';
  useEffect(() => {
    if (rsvpStatus !== 'none') setShowInlineChoices(false);
  }, [rsvpStatus]);

  const isCancelledEvent = event.status === 'cancelled';
  const openCalendarActionLabel =
    getOpenCommunityCalendarActionLabel(isSavedToMyCalendar);
  const showOpenCalendarCta =
    onCalendarToggle !== undefined &&
    isOpenCommunityCalendarActionVisible({
      event: {
        communityId: event.communityId ?? null,
        requiresRsvp: event.requiresRsvp,
        status: event.status,
      },
      hasValidConvexEventId: true,
      communityArchived,
      viewerIsActiveMember: viewerIsActiveCommunityMember,
    });

  return (
    <View
      style={[
        styles.flyerCard,
        {
          width: cardWidth,
          backgroundColor: variant.bg,
          borderColor: variant.border,
        },
        isCancelledEvent ? { opacity: 0.68 } : null,
      ]}
    >
      <Pressable
        style={styles.flyerCardBody}
        onPress={() => onOpenDetails(event._id)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`פרטי אירוע ${event.title}`}
      >
        {showCategoryPill ? (
          <View style={[styles.flyerPill, { backgroundColor: variant.pillBg }]}>
            <Text
              style={[styles.flyerPillText, { color: variant.pillText }]}
              numberOfLines={1}
            >
              {rawCategory}
            </Text>
          </View>
        ) : null}
        <Text style={styles.flyerTitle} numberOfLines={2}>
          {event.title}
        </Text>
        <View style={styles.flyerImportantItemsSlot}>
          {showImportantItemsChip ? (
            <View style={styles.flyerImportantItemsChip}>
              <Text style={styles.flyerImportantItemsChipText}>
                {`📌 חשוב לזכור · ${importantItemsCount}`}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.flyerDividerRow}>
          <View
            style={[
              styles.flyerDividerLine,
              { backgroundColor: variant.divider },
            ]}
          />
          <Text
            style={[styles.flyerDividerDiamond, { color: variant.divider }]}
          >
            ✦
          </Text>
          <View
            style={[
              styles.flyerDividerLine,
              { backgroundColor: variant.divider },
            ]}
          />
        </View>
        <Text style={styles.flyerDate}>{dateLabel}</Text>
        <Text style={styles.flyerTime}>{timeLabel}</Text>
        <Text style={styles.flyerLocation} numberOfLines={1}>
          {locationLabel}
        </Text>
        <Text
          style={[
            styles.flyerMeta,
            !isOpenCommunityEvent &&
              rsvpStatus === 'maybe' &&
              styles.flyerMetaEmphasis,
            { color: variant.meta },
          ]}
          numberOfLines={1}
        >
          {rsvpMeta}
        </Text>
        {taskSummary && taskTotal > 0 ? (
          <TaskSummaryLine
            copy={taskCopy}
            doneStyle={styles.flyerMetaDone}
            style={[
              styles.flyerMeta,
              styles.flyerMetaLast,
              { color: variant.meta },
            ]}
            taskSummary={taskSummary}
          />
        ) : (
          <Text
            numberOfLines={1}
            style={[
              styles.flyerMeta,
              styles.flyerMetaLast,
              { color: variant.meta },
            ]}
          >
            ללא משימות פעילות
          </Text>
        )}
      </Pressable>

      <View style={styles.flyerCtaWrap}>
        {showInlineRsvpRow ? (
          <View style={styles.flyerInlineRsvpRow}>
            {(
              [
                { status: 'yes', label: 'כן' },
                { status: 'maybe', label: 'אולי' },
                { status: 'no', label: 'לא' },
              ] as { status: RsvpStatus; label: string }[]
            ).map((opt) => (
              <TouchableOpacity
                key={`${event._id}-${opt.status}`}
                style={styles.flyerInlineRsvpBtn}
                onPress={() => {
                  onRsvpSelect(event._id, opt.status).finally(() => {
                    setShowInlineChoices(false);
                  });
                }}
                accessible
                accessibilityRole="button"
                accessibilityLabel={opt.label}
              >
                <Text style={styles.flyerInlineRsvpText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : showOpenCalendarCta ? (
          <TouchableOpacity
            style={[styles.flyerCtaBtn, { backgroundColor: variant.buttonBg }]}
            onPress={(pressEvent) => {
              pressEvent.stopPropagation();
              onCalendarToggle(event._id);
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={openCalendarActionLabel}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Text style={[styles.flyerCtaText, { color: variant.buttonText }]}>
              {openCalendarActionLabel}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.flyerCtaBtn, { backgroundColor: variant.buttonBg }]}
            onPress={() => {
              if (flyerDetailsOnly) {
                onOpenDetails(event._id);
                return;
              }
              if (showInviteePendingCta || showMemberChangeRsvpCta) {
                setShowInlineChoices(true);
                return;
              }
              onOpenDetails(event._id);
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              flyerDetailsOnly
                ? 'לפרטים'
                : showInviteePendingCta
                  ? 'ממתין לאישור'
                  : showMemberChangeRsvpCta
                    ? rsvpStatus === 'yes'
                      ? 'שינוי אישור'
                      : 'שינוי תגובה'
                    : 'לפרטים'
            }
          >
            <Text style={[styles.flyerCtaText, { color: variant.buttonText }]}>
              {flyerDetailsOnly
                ? 'לפרטים'
                : showInviteePendingCta
                  ? 'ממתין לאישור'
                  : showMemberChangeRsvpCta
                    ? rsvpStatus === 'yes'
                      ? 'שינוי אישור'
                      : 'שינוי תגובה'
                    : 'לפרטים'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── EventRow (events tab list view) ─────────────────────────────────────────

interface EventRowProps {
  event: EventDoc;
  rsvpStatus: RsvpStatus;
  onRsvpPress: (eventId: Id<'events'>) => void;
  onOpenDetails: (eventId: Id<'events'>) => void;
  isCancelled?: boolean;
  cancelReason?: string;
  taskSummary?: TaskSummary;
}

function EventRow({
  event,
  rsvpStatus,
  onRsvpPress,
  onOpenDetails,
  isCancelled,
  cancelReason,
  taskSummary,
}: EventRowProps) {
  const past = isEventPast(event);

  let badgeLabel = '';
  let badgeColor = '#eab308';
  if (isCancelled) {
    badgeLabel = 'בוטל';
    badgeColor = '#fee2e2';
  } else if (rsvpStatus === 'yes') {
    badgeLabel = 'כן';
    badgeColor = '#22c55e';
  } else if (rsvpStatus === 'maybe') {
    badgeLabel = 'אולי';
    badgeColor = '#eab308';
  } else if (rsvpStatus === 'no') {
    badgeLabel = 'לא';
    badgeColor = '#ef4444';
  }

  const isOpenCommunityEvent = event.requiresRsvp === false;
  const showRsvpBadge =
    !isOpenCommunityEvent &&
    !isCancelled &&
    !past &&
    (event.requiresRsvp !== false || rsvpStatus !== 'none');
  const showCancelledBadge = isCancelled;

  return (
    <Pressable
      style={[
        styles.eventRow,
        // FIX C.2 — a cancelled event must remain fully readable; its
        // cancellation state is communicated by the "בוטל" badge + reason,
        // never by fading the whole row. `!isCancelled` guards the
        // past-event fade too, so a cancelled event whose date is already
        // in the past does not inherit past-event opacity merely because
        // `past === true`.
        past && !isCancelled && { opacity: 0.45 },
      ]}
      onPress={() => onOpenDetails(event._id)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={event.title}
    >
      {/* First child = physical RIGHT in effective row-reverse */}
      <View style={styles.eventRowContent}>
        <View style={styles.eventRowTop}>
          {/* Title first = physical RIGHT in effective row-reverse */}
          <Text
            style={[
              styles.eventRowTitle,
              past && !isCancelled && { color: '#9ca3af' },
            ]}
            numberOfLines={2}
          >
            {event.title}
          </Text>
          {past && !isCancelled && (
            <View
              style={[
                styles.eventBadge,
                { backgroundColor: '#94a3b8', marginLeft: 0, marginRight: 6 },
              ]}
            >
              <Text style={styles.eventBadgeText}>עבר</Text>
            </View>
          )}
        </View>
        {cancelReason ? (
          <Text style={styles.eventRowCancelReason} numberOfLines={1}>
            {cancelReason}
          </Text>
        ) : null}
        {event.location ? (
          <Text
            style={[
              styles.eventRowLocation,
              past && !isCancelled && { color: '#c4c9d4' },
            ]}
            numberOfLines={1}
          >
            📍 {event.location}
          </Text>
        ) : null}
        {showCancelledBadge ? (
          <View style={styles.eventRowCancelledBadge}>
            <Text style={styles.eventRowCancelledBadgeText}>{badgeLabel}</Text>
          </View>
        ) : showRsvpBadge ? (
          <TouchableOpacity
            style={[styles.rsvpStatusBadge, { backgroundColor: badgeColor }]}
            onPress={() => onRsvpPress(event._id)}
          >
            <Text style={styles.rsvpStatusText}>
              {badgeLabel !== '' ? `${badgeLabel} ▾` : 'ממתין לאישור ▾'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {taskSummary &&
        (taskSummary.totalTasksCount ?? taskSummary.total) > 0 ? (
          <TaskSummaryLine
            copy="compact"
            doneStyle={styles.eventRowTaskSummaryDone}
            style={styles.eventRowTaskSummary}
            taskSummary={taskSummary}
          />
        ) : null}
      </View>
      {/* Second child = physical LEFT in effective row-reverse: date column */}
      <View style={styles.eventRowLeft}>
        <Text style={styles.eventRowDate}>
          {new Date(event.startTime).toLocaleDateString('he-IL', {
            day: 'numeric',
            month: 'short',
          })}
        </Text>
        <View
          style={[
            styles.eventDot,
            { backgroundColor: getEventColor(event._id) },
          ]}
        />
      </View>
    </Pressable>
  );
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: TaskDoc;
  onToggle: (id: Id<'tasks'>) => void;
}

function TaskRow({ task, onToggle }: TaskRowProps) {
  return (
    <Pressable
      style={styles.taskRow}
      onPress={() => onToggle(task._id)}
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={task.title}
      accessibilityState={{ checked: task.completed }}
    >
      <View style={[styles.checkbox, task.completed && styles.checkboxChecked]}>
        {task.completed && <Ionicons name="checkmark" size={13} color="#fff" />}
      </View>
      <Text
        style={[styles.taskTitle, task.completed && styles.taskTitleDone]}
        numberOfLines={2}
      >
        {task.title}
      </Text>
      {task.dueDate !== undefined ? (
        <Text style={styles.taskDue}>{formatDueDate(task.dueDate)}</Text>
      ) : null}
    </Pressable>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionRight}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.sectionLeft}>
        {actionLabel && onAction && (
          <TouchableOpacity
            onPress={onAction}
            accessible
            accessibilityRole="button"
          >
            <Text style={styles.sectionAction}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Overflow Menu ────────────────────────────────────────────────────────────

interface OverflowItem {
  label: string;
  /** Secondary explanatory copy shown under the label (e.g. auto-add setting). */
  subtitle?: string;
  iconName?: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  danger?: boolean;
  /**
   * Stage 2B: renders a native Switch instead of the trailing icon, for
   * PERSONAL preference rows (e.g. auto-add to calendar) that every active
   * member can control — not an owner/admin-only action, so it does not
   * close the popover on tap (the row's `onPress` still fires the mutation;
   * the popover stays open so the user can see the switch flip).
   */
  toggle?: { value: boolean };
}

interface OverflowMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  items: OverflowItem[];
  onClose: () => void;
}

function OverflowMenu({
  visible,
  position,
  items,
  onClose,
}: OverflowMenuProps) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.popoverBackdrop} onPress={onClose} />
      <View style={[styles.popover, { top: position.y, left: position.x }]}>
        {items.map((m, idx) => (
          <Pressable
            key={m.label}
            style={[
              styles.popoverItem,
              idx < items.length - 1 && styles.popoverBorder,
            ]}
            onPress={() => {
              // Toggle rows are driven ONLY by the Switch's onValueChange
              // below (tapping the row itself is a no-op) so the mutation —
              // which flips the current value — never fires twice from one
              // tap. Every other row closes the popover and fires its action.
              if (m.toggle) return;
              onClose();
              m.onPress();
            }}
            accessible
            accessibilityRole={m.toggle ? 'switch' : 'button'}
            accessibilityLabel={m.label}
            accessibilityState={
              m.toggle ? { checked: m.toggle.value } : undefined
            }
          >
            <View style={styles.popoverLabelBlock}>
              <Text
                style={[styles.popoverLabel, m.danger && styles.popoverDanger]}
              >
                {m.label}
              </Text>
              {m.subtitle ? (
                <Text style={styles.popoverSubtitle}>{m.subtitle}</Text>
              ) : null}
            </View>
            {m.toggle ? (
              <Switch
                ios_backgroundColor="#b0bec5"
                onValueChange={m.onPress}
                thumbColor="#ffffff"
                trackColor={{ false: '#b0bec5', true: PRIMARY }}
                value={m.toggle.value}
              />
            ) : (
              m.iconName && (
                <Ionicons
                  name={m.iconName}
                  size={18}
                  color={m.danger ? '#ef4444' : '#374151'}
                />
              )
            )}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

// ─── Search Modal ─────────────────────────────────────────────────────────────

interface SearchModalProps {
  visible: boolean;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}

function SearchModal({ visible, value, onChange, onClose }: SearchModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.searchBackdrop} onPress={onClose} />
      <View style={styles.searchBox}>
        <TextInput
          style={styles.searchInput}
          value={value}
          onChangeText={onChange}
          placeholder="חיפוש אירוע..."
          placeholderTextColor="#9ca3af"
          textAlign="right"
          autoFocus
          returnKeyType="search"
          onSubmitEditing={onClose}
          accessibilityLabel="חיפוש אירוע"
        />
        <Ionicons name="search" size={20} color="#9ca3af" />
      </View>
    </Modal>
  );
}

// ─── ReminderAttachmentRow — isolates useQuery hook per attachment ─────────────

interface ReminderAttachmentRowProps {
  taskId: Id<'tasks'>;
  storageId: Id<'_storage'>;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
}

function ReminderAttachmentRow({
  taskId,
  storageId,
  displayName,
  mimeType,
  sizeBytes,
}: ReminderAttachmentRowProps): React.JSX.Element {
  const url = useQuery(api.tasks.getTaskAttachmentUrl, { taskId, storageId });
  const [imageError, setImageError] = useState(false);
  const isImage = mimeType.startsWith('image/');

  const handleTap = useCallback((): void => {
    if (!url) return;
    Linking.openURL(url).catch(() => {
      Alert.alert('שגיאה', 'לא ניתן לפתוח את הקובץ');
    });
  }, [url]);

  return (
    <Pressable
      style={styles.reminderAttachRow}
      onPress={handleTap}
      disabled={!url}
      accessible
      accessibilityRole={isImage ? 'imagebutton' : 'link'}
      accessibilityLabel={`פתח ${isImage ? 'תמונה' : 'קובץ'}: ${displayName}`}
    >
      {isImage && url && !imageError ? (
        <Image
          source={{ uri: url }}
          style={styles.reminderAttachThumb}
          resizeMode="cover"
          onError={() => setImageError(true)}
          accessible={false}
        />
      ) : (
        <View style={styles.reminderAttachIconBox}>
          <Ionicons
            name={isImage ? 'image-outline' : 'document-outline'}
            size={20}
            color="#6b7280"
          />
        </View>
      )}
      <View style={styles.reminderAttachMeta}>
        <Text style={styles.reminderAttachName} numberOfLines={2}>
          {displayName}
        </Text>
        {sizeBytes > 0 ? (
          <Text style={styles.reminderAttachSize}>
            {formatBytes(sizeBytes)}
          </Text>
        ) : null}
      </View>
      {url ? (
        <Ionicons name="chevron-back" size={14} color="#9ca3af" />
      ) : (
        <ActivityIndicator size="small" color={PRIMARY} />
      )}
    </Pressable>
  );
}

// ─── CommunityReminderRow — expandable reminder card ──────────────────────────

interface CommunityReminderRowProps {
  task: TaskDoc;
  onToggle: (id: Id<'tasks'>) => void;
  onHide?: (id: string) => void;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  currentUserId?: Id<'users'>;
  myRole?: 'owner' | 'admin' | 'member';
}

function CommunityReminderRow({
  task,
  onToggle,
  onHide,
  isExpanded,
  onToggleExpand,
  currentUserId,
  myRole,
}: CommunityReminderRowProps): React.JSX.Element {
  const rowRouter = useRouter();
  const removeTask = useMutation(api.tasks.remove);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hasDescription = !!task.description;
  const hasAttachments = (task.attachments?.length ?? 0) > 0;
  const hasReminderDetails =
    (!!task.reminderType && task.reminderType !== 'none') ||
    (task.reminders?.length ?? 0) > 0;

  const canManage =
    currentUserId !== undefined &&
    (task.createdBy === currentUserId ||
      myRole === 'owner' ||
      myRole === 'admin');

  const hasExpandableContent =
    hasDescription || hasAttachments || hasReminderDetails || canManage;

  const shortLabel = formatReminderShortLabel(
    task.reminderType,
    task.customReminderAt
  );

  const handleDeleteConfirm = useCallback(async () => {
    setDeleteDialogVisible(false);
    setDeleting(true);
    try {
      await removeTask({ id: task._id });
    } catch (e) {
      setDeleting(false);
      const msg = e instanceof Error ? e.message : 'לא ניתן למחוק את התזכורת';
      Alert.alert('שגיאה', msg);
    }
  }, [task._id, removeTask]);

  return (
    <>
      <View
        style={[
          styles.reminderRow,
          isExpanded && styles.reminderRowExpanded,
          deleting && { opacity: 0.5 },
        ]}
      >
        {/* ── Main summary row (always visible) */}
        <View style={styles.reminderMainRow}>
          {/* Checkbox — own TouchableOpacity so it doesn't bubble to expand area */}
          <TouchableOpacity
            onPress={() => onToggle(task._id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessible
            accessibilityRole="checkbox"
            accessibilityLabel={task.completed ? 'סמן כלא טופל' : 'סמן כטופל'}
            accessibilityState={{ checked: task.completed }}
          >
            <View
              style={[
                styles.reminderCheckbox,
                task.completed && styles.reminderCheckboxDone,
              ]}
            >
              {task.completed && (
                <Ionicons name="checkmark" size={13} color="#fff" />
              )}
            </View>
          </TouchableOpacity>

          {/* Title + Description — tap expands/collapses */}
          <Pressable
            style={styles.reminderTextBlock}
            onPress={() =>
              hasExpandableContent && onToggleExpand(task._id as string)
            }
            accessible={hasExpandableContent}
            accessibilityRole={hasExpandableContent ? 'button' : 'text'}
            accessibilityLabel={
              isExpanded ? 'הסתרת פרטי התזכורת' : 'הצגת פרטי התזכורת'
            }
          >
            <Text
              style={[
                styles.reminderTitle,
                task.completed && styles.reminderTitleDone,
              ]}
              numberOfLines={isExpanded ? undefined : 2}
            >
              {task.title}
            </Text>
            {hasDescription && (
              <Text
                style={[
                  styles.reminderDescriptionText,
                  task.completed && styles.reminderTitleDone,
                ]}
                numberOfLines={isExpanded ? undefined : 2}
              >
                {task.description}
              </Text>
            )}
            {/* Compact reminder label — collapsed only */}
            {!isExpanded && shortLabel ? (
              <Text style={styles.reminderShortLabel}>🔔 {shortLabel}</Text>
            ) : null}
          </Pressable>

          {/* End column: date/completedAt/hide + chevron */}
          <View style={styles.reminderEndCol}>
            {task.completed && onHide ? (
              <TouchableOpacity
                onPress={() => onHide(task._id as string)}
                style={styles.reminderHideBtn}
                accessible
                accessibilityRole="button"
                accessibilityLabel="הסתר"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={16} color="#9ca3af" />
              </TouchableOpacity>
            ) : task.completed && task.completedAt !== undefined ? (
              <Text style={styles.reminderDue}>
                {`טופל ב-${new Date(task.completedAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`}
              </Text>
            ) : task.dueDate !== undefined ? (
              <Text style={styles.reminderDue}>
                {formatDueDate(task.dueDate)}
                {task.hasTime && task.dueAt !== undefined
                  ? ` · ${formatDueTime(task.dueAt)}`
                  : ''}
              </Text>
            ) : null}

            {hasExpandableContent ? (
              <TouchableOpacity
                onPress={() => onToggleExpand(task._id as string)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessible
                accessibilityRole="button"
                accessibilityLabel={
                  isExpanded ? 'הסתרת פרטי התזכורת' : 'הצגת פרטי התזכורת'
                }
              >
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#9ca3af"
                />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* ── Expanded content (conditionally mounted — attachment queries live here) */}
        {isExpanded ? (
          <View style={styles.reminderExpandedSection}>
            <View style={styles.reminderExpandedDivider} />

            {/* Due date + time row (expanded only) */}
            {task.dueDate !== undefined ? (
              <View style={styles.reminderExpandedMeta}>
                <View style={styles.reminderExpandedMetaRow}>
                  <Ionicons name="calendar-outline" size={14} color="#6b7280" />
                  <Text style={styles.reminderExpandedMetaText}>
                    {formatDueDate(task.dueDate)}
                    {task.hasTime && task.dueAt !== undefined
                      ? ` · ${formatDueTime(task.dueAt)}`
                      : ''}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Detailed reminder schedule */}
            {hasReminderDetails ? (
              <View style={styles.reminderExpandedMeta}>
                {task.reminderType && task.reminderType !== 'none' ? (
                  <View style={styles.reminderExpandedMetaRow}>
                    <Ionicons
                      name="notifications-outline"
                      size={14}
                      color="#6b7280"
                    />
                    <Text style={styles.reminderExpandedMetaText}>
                      {formatReminderFullLabel(
                        task.reminderType,
                        task.customReminderAt
                      )}
                    </Text>
                  </View>
                ) : null}
                {task.reminders && task.reminders.length > 0
                  ? task.reminders.map((r) => {
                      const label =
                        r.label ??
                        formatReminderFullLabel(r.type, r.customReminderAt) ??
                        r.type;
                      return (
                        <View key={r.id} style={styles.reminderExpandedMetaRow}>
                          <Ionicons
                            name="alarm-outline"
                            size={14}
                            color="#6b7280"
                          />
                          <Text style={styles.reminderExpandedMetaText}>
                            {label}
                          </Text>
                        </View>
                      );
                    })
                  : null}
              </View>
            ) : null}

            {/* Attachments */}
            {hasAttachments
              ? (task.attachments ?? []).map((a) => (
                  <ReminderAttachmentRow
                    key={a.storageId as string}
                    taskId={task._id}
                    storageId={a.storageId}
                    displayName={a.displayName}
                    mimeType={a.mimeType}
                    sizeBytes={a.sizeBytes}
                  />
                ))
              : null}

            {/* Management actions */}
            {canManage ? (
              <View style={styles.reminderExpandedActions}>
                <TouchableOpacity
                  onPress={() =>
                    rowRouter.push({
                      pathname: '/(authenticated)/community-reminder/edit/[id]',
                      params: {
                        id: task._id as string,
                        returnCommunityId: task.communityId as string,
                      },
                    } as Parameters<typeof rowRouter.push>[0])
                  }
                  style={styles.reminderActionBtn}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="עריכת תזכורת"
                >
                  <Ionicons name="create-outline" size={16} color={PRIMARY} />
                  <Text style={styles.reminderActionText}>עריכה</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDeleteDialogVisible(true)}
                  style={styles.reminderActionBtn}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="מחיקת תזכורת"
                >
                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  <Text
                    style={[styles.reminderActionText, { color: '#ef4444' }]}
                  >
                    מחיקה
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <AppConfirmationDialog
        visible={deleteDialogVisible}
        title="מחיקת תזכורת"
        message="האם את בטוחה שתרצי למחוק את התזכורת? פעולה זו אינה ניתנת לביטול."
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteDialogVisible(false)}
        confirmDestructive
      />
    </>
  );
}

interface ActivityRowProps {
  activity: CommunityActivityItem;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
}

function ActivityRow({ activity, onOpenEventDetails }: ActivityRowProps) {
  const canOpenEvent =
    activity.entityType === 'event' && activity.entityId !== undefined;

  const handlePress = useCallback((): void => {
    if (!canOpenEvent || !activity.entityId) return;
    onOpenEventDetails(activity.entityId as Id<'events'>);
  }, [activity.entityId, canOpenEvent, onOpenEventDetails]);

  return (
    <Pressable
      onPress={canOpenEvent ? handlePress : undefined}
      style={({ pressed }) => [
        styles.activityRow,
        canOpenEvent && pressed ? styles.activityRowPressed : null,
      ]}
      accessible
      accessibilityRole={canOpenEvent ? 'button' : 'text'}
      accessibilityLabel={activity.title}
      accessibilityHint={canOpenEvent ? 'פותח את פרטי האירוע' : undefined}
    >
      <View style={styles.activityIconWrap}>
        <Ionicons
          name={getActivityIcon(activity.type)}
          size={18}
          color={PRIMARY}
        />
      </View>
      <View style={styles.activityTextBlock}>
        <Text style={styles.activityTitle} numberOfLines={2}>
          {activity.title}
        </Text>
        {activity.description ? (
          <Text style={styles.activityDescription} numberOfLines={2}>
            {activity.description}
          </Text>
        ) : null}
      </View>
      <Text style={styles.activityTime}>
        {formatRelativeActivityTime(activity.createdAt)}
      </Text>
    </Pressable>
  );
}

interface ActivityListProps {
  activities: CommunityActivityItem[];
  grouped?: boolean;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
}

function ActivityList({
  activities,
  grouped = false,
  onOpenEventDetails,
}: ActivityListProps) {
  if (!grouped) {
    return (
      <View style={styles.activityCard}>
        {activities.map((activity, index) => (
          <View key={activity.id}>
            <ActivityRow
              activity={activity}
              onOpenEventDetails={onOpenEventDetails}
            />
            {index < activities.length - 1 ? (
              <View style={styles.activityDivider} />
            ) : null}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.activityTimeline}>
      {groupActivitiesByDate(activities).map((group) => (
        <View key={group.title} style={styles.activityGroup}>
          <Text style={styles.activityGroupTitle}>{group.title}</Text>
          <View style={styles.activityCard}>
            {group.items.map((activity, index) => (
              <View key={activity.id}>
                <ActivityRow
                  activity={activity}
                  onOpenEventDetails={onOpenEventDetails}
                />
                {index < group.items.length - 1 ? (
                  <View style={styles.activityDivider} />
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Tab: ראשי (Stage 2A Main overview) ─────────────────────────────────────

type ImportantNowItem = {
  key: string;
  label: string;
  iconName: IoniconName;
  emphasis?: boolean;
  onPress?: () => void;
};

interface ImportantNowRowProps {
  item: ImportantNowItem;
}

function ImportantNowRow({ item }: ImportantNowRowProps) {
  const row = (
    <View
      style={[
        styles.importantNowRow,
        item.emphasis && styles.importantNowRowEmphasis,
      ]}
    >
      <View
        style={[
          styles.importantNowIconWrap,
          item.emphasis && styles.importantNowIconWrapEmphasis,
        ]}
      >
        <Ionicons
          color={item.emphasis ? '#fff' : PRIMARY}
          name={item.iconName}
          size={18}
        />
      </View>
      <Text numberOfLines={1} style={styles.importantNowLabel}>
        {item.label}
      </Text>
      {item.onPress ? (
        <Ionicons color="#9ca3af" name="chevron-back" size={16} />
      ) : null}
    </View>
  );

  if (!item.onPress) return row;

  return (
    <Pressable
      accessible
      accessibilityLabel={item.label}
      accessibilityRole="button"
      onPress={item.onPress}
    >
      {row}
    </Pressable>
  );
}

interface MainEventChipsProps {
  isToday: boolean;
  isTomorrow: boolean;
  isNew: boolean;
}

function MainEventChips({ isToday, isTomorrow, isNew }: MainEventChipsProps) {
  if (!isToday && !isTomorrow && !isNew) return null;
  return (
    <View style={styles.mainChipsRow}>
      {isNew ? (
        <View style={[styles.mainChip, styles.mainChipNew]}>
          <Text style={styles.mainChipTextNew}>חדש</Text>
        </View>
      ) : null}
      {isToday ? (
        <View style={[styles.mainChip, styles.mainChipToday]}>
          <Text style={styles.mainChipTextToday}>היום</Text>
        </View>
      ) : isTomorrow ? (
        <View style={[styles.mainChip, styles.mainChipTomorrow]}>
          <Text style={styles.mainChipTextTomorrow}>מחר</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * FIX 8B FINAL CTA COPY + VISUAL TREATMENT — dedicated, unmistakably-a-
 * button task CTA rendered near the bottom of MainEventCard/
 * AdditionalEventCard. A solid brand-blue button (not an outline/pill/
 * text-row): solid `PRIMARY` background, bold white text, near-full width,
 * minimum 44px touch height, centered content — reads as one solid action
 * control rather than a status row. Opens the Community Task Bottom Sheet.
 *
 * When `line.isActionable` is `false` (nothing useful to do — e.g.
 * "✓ כל המשימות שובצו" with no task of the viewer's own) it renders as
 * plain, non-pressable passive text so it never implies tappability where
 * there is no action.
 */
function CommunityMainTaskCta({
  line,
  onPress,
}: {
  line: CommunityMainTaskLine;
  onPress: (event: GestureResponderEvent) => void;
}) {
  // Root-cause investigation note: this Pressable previously used the
  // `style={({ pressed }) => [...]}` callback form. Converted to a static
  // style array driven by local `pressed` state (onPressIn/onPressOut) as
  // the priority-hypothesis fix for the reported "hit target works, blue
  // background/text never paints" symptom. See the task's final report for
  // what static investigation could and could not confirm.
  const [pressed, setPressed] = useState(false);

  if (!line.isActionable) {
    return (
      <Text numberOfLines={1} style={styles.mainEventTaskPassive}>
        {line.text}
      </Text>
    );
  }

  return (
    <Pressable
      accessibilityHint="פותח את רשימת המשימות של האירוע"
      accessibilityLabel={line.text}
      accessibilityRole="button"
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.mainEventTaskCta,
        pressed && styles.mainEventTaskCtaPressed,
      ]}
    >
      <MaterialIcons color="#fff" name="assignment-turned-in" size={16} />
      <Text numberOfLines={1} style={styles.mainEventTaskCtaText}>
        {line.text}
      </Text>
    </Pressable>
  );
}

interface MainEventCardProps {
  event: EventDoc;
  rsvpStatus: RsvpStatus;
  isCreator: boolean;
  /**
   * FIX 8B FOLLOW-UP §1 — precomputed, visibility-safe line (or `null` when
   * nothing may be shown to this viewer). See `getCommunityMainTaskStatusLine`.
   */
  taskStatusLine: CommunityMainTaskLine | null;
  cardWidth: number;
  isNew: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  onOpenDetails: (eventId: Id<'events'>) => void;
  /**
   * FIX 8B UX CORRECTION: tapping the task CTA calls this with the event id
   * to open the dedicated Community Task Bottom Sheet — never expands or
   * navigates the card itself. Optional so callers that don't support the
   * sheet (none currently) keep the CTA hidden.
   */
  onOpenTaskSheet?: (eventId: Id<'events'>) => void;
}

/**
 * Stage 2A "ראשי" carousel card — compact by design (per the approved
 * Stitch mockup). This intentionally does NOT reuse CommunityEventFlyerCard:
 * the flyer/invitation visual direction is reserved for Event Details (see
 * prompt's "MY EVENTS — CARD CONTENT"), and Main needs a smaller, denser
 * card for fast horizontal scanning.
 */
function MainEventCard({
  event,
  rsvpStatus,
  isCreator,
  taskStatusLine,
  cardWidth,
  isNew,
  isToday,
  isTomorrow,
  onOpenDetails,
  onOpenTaskSheet,
}: MainEventCardProps) {
  const statusLabel = getMainCardStatusLabel(event, rsvpStatus, isCreator);
  const locationLabel = event.location?.trim();
  const eventId = event._id;
  // Stop propagation so tapping the task CTA never also triggers the
  // card's own onOpenDetails press (they're nested Pressables).
  const handleTaskCtaPress = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation();
      onOpenTaskSheet?.(eventId);
    },
    [onOpenTaskSheet, eventId]
  );

  return (
    <Pressable
      accessible
      accessibilityLabel={`פרטי אירוע ${event.title}`}
      accessibilityRole="button"
      onPress={() => onOpenDetails(event._id)}
      style={[styles.mainEventCard, { width: cardWidth }]}
    >
      <MainEventChips isNew={isNew} isToday={isToday} isTomorrow={isTomorrow} />
      <Text numberOfLines={2} style={styles.mainEventTitle}>
        {event.title}
      </Text>
      <Text numberOfLines={1} style={styles.mainEventDate}>
        {formatMainCardDateTime(event)}
      </Text>
      {locationLabel ? (
        <Text numberOfLines={1} style={styles.mainEventLocation}>
          📍 {locationLabel}
        </Text>
      ) : null}
      <View style={styles.mainEventFooter}>
        <Text numberOfLines={1} style={styles.mainEventStatus}>
          {statusLabel}
        </Text>
        {taskStatusLine ? (
          <CommunityMainTaskCta
            line={taskStatusLine}
            onPress={handleTaskCtaPress}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

interface MainPendingRsvpRowProps {
  event: EventDoc;
  isNew: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  /**
   * QA FIX (Issue 3): true ONLY for the event's actual creator — never for
   * owner/admin merely by role. In practice the creator's own event no
   * longer appears in this list at all (see computeRsvpAttentionState),
   * so this is always false here in normal operation; kept as an explicit
   * defensive guard rather than assumed.
   */
  flyerDetailsOnly: boolean;
  onOpenDetails: (eventId: Id<'events'>) => void;
  onRsvpSelect: (eventId: Id<'events'>, status: RsvpStatus) => Promise<void>;
}

/**
 * Stage 2A "מחכים לתגובה" row. Reuses the exact same inline
 * כן/אולי/לא RSVP interaction and mutation path (`onRsvpSelect` →
 * `handleInlineRsvp` in the parent) as CommunityEventFlyerCard — no new
 * RSVP semantics are introduced here.
 */
function MainPendingRsvpRow({
  event,
  isNew,
  isToday,
  isTomorrow,
  flyerDetailsOnly,
  onOpenDetails,
  onRsvpSelect,
}: MainPendingRsvpRowProps) {
  const [showInlineChoices, setShowInlineChoices] = useState(false);

  return (
    <View style={styles.pendingRow}>
      <Pressable
        accessible
        accessibilityLabel={`פרטי אירוע ${event.title}`}
        accessibilityRole="button"
        onPress={() => onOpenDetails(event._id)}
        style={styles.pendingRowContent}
      >
        <MainEventChips
          isNew={isNew}
          isToday={isToday}
          isTomorrow={isTomorrow}
        />
        <Text numberOfLines={1} style={styles.pendingRowTitle}>
          {event.title}
        </Text>
        <Text numberOfLines={1} style={styles.pendingRowMeta}>
          {formatMainCardDateTime(event)}
        </Text>
      </Pressable>
      <View style={styles.pendingRowCtaWrap}>
        {flyerDetailsOnly ? (
          <TouchableOpacity
            accessible
            accessibilityLabel="לפרטים"
            accessibilityRole="button"
            onPress={() => onOpenDetails(event._id)}
            style={styles.pendingRowCtaBtn}
          >
            <Text style={styles.pendingRowCtaText}>לפרטים</Text>
          </TouchableOpacity>
        ) : showInlineChoices ? (
          <View style={styles.pendingInlineRsvpRow}>
            {(
              [
                { status: 'yes', label: 'כן' },
                { status: 'maybe', label: 'אולי' },
                { status: 'no', label: 'לא' },
              ] as { status: RsvpStatus; label: string }[]
            ).map((opt) => (
              <TouchableOpacity
                accessible
                accessibilityLabel={opt.label}
                accessibilityRole="button"
                key={`${event._id}-${opt.status}`}
                onPress={() => {
                  onRsvpSelect(event._id, opt.status).finally(() => {
                    setShowInlineChoices(false);
                  });
                }}
                style={styles.pendingInlineRsvpBtn}
              >
                <Text style={styles.pendingInlineRsvpText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <TouchableOpacity
            accessible
            accessibilityLabel="אישור הגעה"
            accessibilityRole="button"
            onPress={() => setShowInlineChoices(true)}
            style={styles.pendingRowCtaBtn}
          >
            <Text style={styles.pendingRowCtaText}>אישור הגעה</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

interface AdditionalEventCardProps {
  event: EventDoc;
  cardWidth: number;
  isNew: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  /**
   * FIX 8B FOLLOW-UP §1 — precomputed, visibility-safe line (or `null` when
   * nothing may be shown to this viewer). See `getCommunityMainTaskStatusLine`.
   */
  taskStatusLine: CommunityMainTaskLine | null;
  isAdding: boolean;
  onOpenDetails: (eventId: Id<'events'>) => void;
  onAddToCalendar: (eventId: Id<'events'>) => void;
  /** FIX 8B UX CORRECTION — see MainEventCardProps.onOpenTaskSheet. */
  onOpenTaskSheet?: (eventId: Id<'events'>) => void;
}

/**
 * QA FIX (Issue 2) — "אירועים נוספים" card. Reuses the exact same compact
 * card visual language as MainEventCard (title/date/location/task summary)
 * plus the SAME "הוסף ליומן" label already used by the open-event footer
 * button (getOpenCommunityCalendarActionLabel) — no new copy is introduced.
 * The label is always the "add" variant here by construction: this card is
 * only ever rendered for events listCommunityAdditionalEventsPaged already
 * confirmed are NOT in the viewer's personal calendar.
 */
function AdditionalEventCard({
  event,
  cardWidth,
  isNew,
  isToday,
  isTomorrow,
  taskStatusLine,
  isAdding,
  onOpenDetails,
  onAddToCalendar,
  onOpenTaskSheet,
}: AdditionalEventCardProps) {
  const locationLabel = event.location?.trim();
  const addLabel = getOpenCommunityCalendarActionLabel(false);
  const eventId = event._id;
  // Stop propagation so tapping the task CTA never also triggers this
  // card's own onOpenDetails press (nested Pressables).
  const handleTaskCtaPress = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation();
      onOpenTaskSheet?.(eventId);
    },
    [onOpenTaskSheet, eventId]
  );

  return (
    <View style={[styles.mainEventCard, { width: cardWidth }]}>
      <Pressable
        accessible
        accessibilityLabel={`פרטי אירוע ${event.title}`}
        accessibilityRole="button"
        onPress={() => onOpenDetails(event._id)}
        style={styles.additionalEventPressable}
      >
        <MainEventChips
          isNew={isNew}
          isToday={isToday}
          isTomorrow={isTomorrow}
        />
        <Text numberOfLines={2} style={styles.mainEventTitle}>
          {event.title}
        </Text>
        <Text numberOfLines={1} style={styles.mainEventDate}>
          {formatMainCardDateTime(event)}
        </Text>
        {locationLabel ? (
          <Text numberOfLines={1} style={styles.mainEventLocation}>
            📍 {locationLabel}
          </Text>
        ) : null}
        {taskStatusLine ? (
          <CommunityMainTaskCta
            line={taskStatusLine}
            onPress={handleTaskCtaPress}
          />
        ) : null}
      </Pressable>
      <Pressable
        accessible
        accessibilityHint="מוסיף את האירוע ליומן האישי שלך"
        accessibilityLabel={addLabel}
        accessibilityRole="button"
        disabled={isAdding}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => onAddToCalendar(event._id)}
        style={({ pressed }) => [
          styles.additionalEventAddBtn,
          (pressed || isAdding) && styles.additionalEventAddBtnPressed,
        ]}
      >
        <Text style={styles.additionalEventAddBtnText}>
          {isAdding ? '...' : addLabel}
        </Text>
      </Pressable>
    </View>
  );
}

interface CommunityTaskBottomSheetProps {
  /** `null` (or no data) means the sheet is closed — never rendered. */
  event: EventDoc | null;
  taskData: EventTaskAccordionData | undefined;
  isLoading: boolean;
  onClose: () => void;
  onClaimTask: (taskId: string) => void;
  onUnclaimTask: (taskId: string) => void;
}

/**
 * FIX 8B UX CORRECTION — dedicated Community Main task-participation Bottom
 * Sheet, replacing the previous `CommunityMainTaskPanel` inline-below-
 * carousel rendering. Opens as a Modal (same slide-up pattern as the
 * existing `RsvpBottomSheet` — backdrop press to dismiss, spring-in
 * animation, `onRequestClose` for the Android hardware back button) ONLY
 * when the task CTA on a MainEventCard/AdditionalEventCard is tapped —
 * never on a plain card tap, which must keep opening Event Details.
 *
 * Reuses the SAME `EventTasksAccordion` presentational component and
 * claim/unclaim mutations as the panel it replaces — no forked
 * task-authorization logic, no new sync mechanism. `canManageTasks` is
 * intentionally always passed as `false`: this surface is member
 * participation only (claim/unclaim), never task management or completion
 * — see `allowCompletion={false}` below (FIX 8B FOLLOW-UP §3). Managers
 * keep using Event Details / Event Edit for actual task management.
 */
function CommunityTaskBottomSheet({
  event,
  taskData,
  isLoading,
  onClose,
  onClaimTask,
  onUnclaimTask,
}: CommunityTaskBottomSheetProps) {
  const slideAnim = useRef(new Animated.Value(400)).current;
  const isOpen = event !== null;
  // FIX 8B FOLLOW-UP §2 — Android system-navigation overlap fix: the
  // Modal draws behind Android's system nav bar/gesture area, so the
  // sheet's own bottom padding must account for `insets.bottom` (already
  // the app's established pattern — see TaskDetailsBottomSheet). `Math.max`
  // keeps the existing 24pt look on devices with a small/no inset (e.g.
  // gesture nav) while growing enough to fully clear 3-button nav bars.
  const insets = useSafeAreaInsets();
  const taskSheetBottomPadding = Math.max(24, insets.bottom + 12);

  useEffect(() => {
    if (isOpen) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else {
      slideAnim.setValue(400);
    }
  }, [isOpen, slideAnim]);

  if (!event) return null;

  const tasks = taskData?.tasks ?? [];

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible>
      <Pressable
        accessibilityLabel="סגירת רשימת המשימות"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.sheetBackdrop}
      />
      <Animated.View
        style={[
          styles.taskSheet,
          {
            paddingBottom: taskSheetBottomPadding,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={styles.sheetHandle} />
        <View style={styles.taskSheetHeader}>
          <View style={styles.taskSheetHeaderTextBlock}>
            <Text numberOfLines={1} style={styles.taskSheetEventTitle}>
              {event.title}
            </Text>
            <Text style={styles.taskSheetSectionTitle}>משימות לאירוע</Text>
          </View>
          <Pressable
            accessible
            accessibilityLabel="סגירה"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onClose}
            style={styles.taskSheetCloseBtn}
          >
            <MaterialIcons color="#647b87" name="close" size={20} />
          </Pressable>
        </View>
        {isLoading ? (
          <ActivityIndicator color={PRIMARY} style={{ marginVertical: 24 }} />
        ) : tasks.length > 0 ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.taskSheetScroll}
          >
            <EventTasksAccordion
              allowCompletion={false}
              canManageTasks={false}
              eventEndTime={event.endTime}
              expanded
              onClaimTask={onClaimTask}
              onToggle={() => {
                // No-op: this surface always renders expanded — the
                // accordion's own collapse/expand affordance is unused
                // here, and must never close the whole sheet (a past
                // regression in the panel this replaces).
              }}
              onUnclaimTask={onUnclaimTask}
              tasks={tasks}
              tasksVisibleToParticipants={
                taskData?.tasksVisibleToParticipants ?? false
              }
            />
          </ScrollView>
        ) : (
          <Text style={styles.taskSheetEmptyText}>
            אין משימות גלויות עבורך באירוע זה כרגע
          </Text>
        )}
      </Animated.View>
    </Modal>
  );
}

interface TabMainProps {
  communityId: Id<'communities'>;
  rsvpMap: Record<string, RsvpStatus>;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
  onSeeMoreEvents: () => void;
  onSeeMoreReminders: () => void;
  currentUserId?: Id<'users'>;
  onInlineRsvp: (eventId: Id<'events'>, status: RsvpStatus) => Promise<void>;
  /** Captured BEFORE markCommunityViewed runs — see previousVisitAtRef above. */
  previousVisitAt: number | undefined;
  /**
   * MICRO-FIX (stale-across-focus) — device-local midnight, refreshed by
   * the PARENT screen on every genuine focus/visit (see its
   * `focusedLocalDayStart` state, set alongside `isScreenFocused` in the
   * same `useFocusEffect`), never recomputed from this component's own
   * per-mount `now`. This screen is a hidden `Tabs.Screen` that can stay
   * mounted across a tab switch away and back — including overnight — so
   * a per-mount `localDayStart` here would silently keep scanning from
   * YESTERDAY's midnight after an overnight revisit to the same mounted
   * screen. See lib/eventsTabDateHelpers.ts's getLocalDayStart.
   */
  focusedLocalDayStart: number;
}

function TabMain({
  communityId,
  rsvpMap,
  onOpenEventDetails,
  onSeeMoreEvents,
  onSeeMoreReminders,
  currentUserId,
  onInlineRsvp,
  previousVisitAt,
  focusedLocalDayStart,
}: TabMainProps) {
  const { width: screenWidth } = useWindowDimensions();
  const carouselCardWidth = Math.min(240, screenWidth * 0.68);

  // Stable "now" — computed once per mount, never Date.now() inside a Convex
  // query (see the no-date-now-in-queries rule). Also keeps the overview
  // query's args referentially stable across re-renders. Intentionally left
  // UNCHANGED by the stale-across-focus micro-fix above — other logic in
  // this component (todayKey/tomorrowKey) still legitimately wants a stable
  // per-mount instant, not a per-focus one.
  const now = useMemo(() => Date.now(), []);
  const todayKey = useMemo(() => getLocalDayKey(now), [now]);
  const tomorrowKey = useMemo(
    () => getLocalDayKey(now + 24 * 60 * 60 * 1000),
    [now]
  );

  // Stage 2A: single bounded query resolves BOTH "האירועים שלי" and
  // "מחכים לתגובה" independently — see listCommunityMainOverview in
  // convex/events.ts for the bounding strategy (never a full-community
  // collect(), see Stage 1C).
  const overviewArgs = useMemo(
    () => ({
      communityId,
      now,
      localDayStart: focusedLocalDayStart,
      myEventsLimit: 6,
      pendingRsvpLimit: 3,
    }),
    [communityId, now, focusedLocalDayStart]
  );
  const overview = useQuery(api.events.listCommunityMainOverview, overviewArgs);
  const isLoadingOverview = overview === undefined;

  // FIX C.2 — recent Community Event cancellations (up to 24h old, via the
  // SAME shared isCancelledEventWithinCommunityVisibilityWindow boundary
  // FIX C already introduced for "אירועים שבוטלו"). Deliberately a
  // separate, dedicated, small query — never mixed into `overview`'s
  // myEvents/pendingRsvpEvents, which are upcoming-event categories with
  // active-event semantics that must stay unchanged. See
  // events.listRecentCancelledCommunityEvents.
  const recentCancelledArgs = useMemo(
    () => ({ communityId, now }),
    [communityId, now]
  );
  const recentCancelledEvents =
    useQuery(
      api.events.listRecentCancelledCommunityEvents,
      recentCancelledArgs
    ) ?? [];
  // BUG FIX (manual QA, follow-up) — Community Main must keep TODAY's
  // events visible for the viewer's entire local day, even once their
  // start/end time has passed (unlike the "אירועים" tab, which correctly
  // moves an ended event into "אירועים שהתקיימו" via hasEventEndedByNow).
  // The server (`listCommunityMainOverview`) already scopes its scan to
  // `startTime >= localDayStart` — the viewer's device-local midnight —
  // which is now the ONLY eligibility boundary for these lists, so no
  // client-side `hasEventEndedByNow` filtering is applied here any more.
  // See the doc comment above isMainOverviewAccumulatorSatisfied in
  // convex/communityCalendarState.ts for the full rationale.
  const myEvents = (overview?.myEvents ?? []) as EventDoc[];
  const myEventsHasMore = overview?.myEventsHasMore ?? false;
  const pendingRsvpEvents = (overview?.pendingRsvpEvents ?? []) as EventDoc[];
  const pendingRsvpHasMore = overview?.pendingRsvpHasMore ?? false;

  // Dedicated, date-bounded Community Reminder retrieval for "מה חשוב עכשיו"
  // — final architecture replacing the previous bounded-but-unsorted
  // `by_community` pagination scan (listCommunityRemindersPaged) that used
  // to sit here. Main only needs a SMALL relevant forward window, never a
  // history scan or a raw-row-count-based safety cap: this query is bounded
  // by the requested date range itself via the same indexed
  // dueAt/dueDate retrieval primitives the Home/Calendar viewer-range query
  // uses (see convex/tasks.ts `listVisibleCommunityRemindersForRange` /
  // `loadGeneralCommunityRemindersInRange`), scoped to just THIS community
  // via the `communityId` arg (also re-verifies active membership
  // server-side). `isDone`/raw-row-count no longer exist in this model at
  // all, so the previous ">8 raw rows suppresses the reminder" bug
  // (gating on a stale `isDone`) is now structurally impossible — old,
  // unrelated community tasks are never read in the first place, since the
  // index bounds by date, not by creation order.
  //
  // Window: today (viewer's local day start, already computed above as
  // `focusedLocalDayStart`) through +30 days — a small, bounded, near-term
  // forward window matching "מה חשוב עכשיו"'s existing "imminent" framing
  // (see MAIN RANGE in the fix spec) — never a 12-month/all-history range.
  const mainReminderWindow = useMemo(
    () => ({
      from: focusedLocalDayStart,
      to: focusedLocalDayStart + 30 * 24 * 60 * 60 * 1000,
    }),
    [focusedLocalDayStart]
  );
  const mainReminderCandidates =
    useQuery(api.tasks.listVisibleCommunityRemindersForRange, {
      communityId,
      from: mainReminderWindow.from,
      to: mainReminderWindow.to,
      // COMMUNITY-CONTEXT semantics (QA fix, BUG 2): Main is community
      // shared content, never a personal surface — a viewer's own
      // dismissedAt/legacy completedAt must NEVER hide a reminder from the
      // community itself (only from that viewer's own Home/Calendar). Omit
      // this and the query defaults to PERSONAL-surface semantics, which
      // is exactly the previous bug: a viewer who dismissed a reminder from
      // Home would also stop seeing it here. Membership authorization is
      // unaffected either way — `scopedActiveMemberships` above is always
      // enforced regardless of this flag.
      respectPersonalHiddenState: false,
    }) ?? [];

  // PART B — surface an ACTIVE general community reminder in "מה חשוב עכשיו"
  // from the bounded window above (never an unbounded/extra query). Active
  // lifecycle (past-due excluded, nearest-due-within-window first) is the
  // SAME isTaskPastDue/dueAt/dueDate definition the Reminders tab already
  // uses — see lib/communityMainReminderCandidate.ts.
  const mainReminderSelection = useMemo(
    () => selectMainReminderCandidates(mainReminderCandidates, now),
    [mainReminderCandidates, now]
  );
  const nearestActiveReminder = mainReminderSelection.nearest;

  // ── QA FIX (Issue 2) — "אירועים נוספים": genuinely paginated, NOT capped
  // to 2-3 events. A separate query (listCommunityAdditionalEventsPaged)
  // from the bounded "האירועים שלי"/"מחכים לתגובה" overview above, so this
  // list can keep growing (5/10/30+ events) via `onEndReached` without ever
  // widening — or duplicating the logic of — the Stage 2A bounded scan.
  // Reset whenever the community changes, since this screen instance can
  // stay mounted across communities (see Issue 1 / useFocusEffect above).
  const [additionalCursor, setAdditionalCursor] = useState<string | null>(null);
  const [additionalEvents, setAdditionalEvents] = useState<EventDoc[]>([]);
  const [additionalLoadingMore, setAdditionalLoadingMore] = useState(false);
  const seenAdditionalCursors = useRef<Set<string | null>>(new Set([null]));

  useEffect(() => {
    seenAdditionalCursors.current = new Set([null]);
    setAdditionalCursor(null);
    setAdditionalEvents([]);
    setAdditionalLoadingMore(false);
  }, [communityId]);

  const additionalArgs = useMemo(
    () => ({
      communityId,
      cursor: additionalCursor,
      numItems: 12,
      now,
      localDayStart: focusedLocalDayStart,
    }),
    [communityId, additionalCursor, now, focusedLocalDayStart]
  );
  const additionalPage = useQuery(
    api.events.listCommunityAdditionalEventsPaged,
    additionalArgs
  );
  const isLoadingAdditional = additionalPage === undefined;

  useEffect(() => {
    if (!additionalPage) return;

    setAdditionalEvents((prev) => {
      const ids = new Set(prev.map((e) => e._id as string));
      // BUG FIX (manual QA, follow-up) — no client-side hasEventEndedByNow
      // filtering here either; see myEvents/pendingRsvpEvents's comment
      // above for the full explanation.
      const freshPage = additionalPage.page as EventDoc[];
      const newItems = freshPage.filter((e) => !ids.has(e._id as string));
      return additionalCursor === null ? freshPage : [...prev, ...newItems];
    });

    // Sparse-page auto-advance: eligibility filtering happens server-side
    // AFTER pagination, so a page can come back empty while more events
    // remain further out (isDone === false). Advance automatically so the
    // carousel doesn't look prematurely finished — mirrors TabReminders'
    // identical sparse-page handling below.
    if (
      additionalPage.page.length === 0 &&
      additionalPage.isDone === false &&
      additionalPage.continueCursor
    ) {
      const next = additionalPage.continueCursor;
      if (!seenAdditionalCursors.current.has(next)) {
        seenAdditionalCursors.current.add(next);
        setAdditionalLoadingMore(true);
        setAdditionalCursor(next);
        return;
      }
    }
    setAdditionalLoadingMore(false);
  }, [additionalPage, additionalCursor]);

  const handleLoadMoreAdditional = useCallback(() => {
    if (
      additionalPage?.isDone === false &&
      additionalPage.continueCursor &&
      !additionalLoadingMore
    ) {
      setAdditionalLoadingMore(true);
      setAdditionalCursor(additionalPage.continueCursor);
    }
  }, [additionalPage, additionalLoadingMore]);

  const addCommunityEventToMyCalendar = useMutation(
    api.communityEventCalendar.addCommunityEventToMyCalendar
  );
  const [addingEventId, setAddingEventId] = useState<string | null>(null);
  const handleAddToCalendar = useCallback(
    (eventId: Id<'events'>) => {
      setAddingEventId(eventId as string);
      addCommunityEventToMyCalendar({ eventId })
        .then(() => {
          // Optimistically drop it from the local "אירועים נוספים" cache —
          // it now belongs in "האירועים שלי" (the reactive overview query
          // above picks it up on its own). Never manually add it there;
          // that stays exclusively backend-driven per the Issue 2 spec.
          setAdditionalEvents((prev) =>
            prev.filter((e) => (e._id as string) !== (eventId as string))
          );
        })
        .catch(() => {
          Alert.alert('שגיאה', 'לא ניתן להוסיף את האירוע ליומן');
        })
        .finally(() => {
          setAddingEventId((prev) =>
            prev === (eventId as string) ? null : prev
          );
        });
    },
    [addCommunityEventToMyCalendar]
  );

  // Task counts are requested ONLY for the events actually rendered on this
  // screen (≤6 my-events + ≤3 pending + loaded "אירועים נוספים" pages,
  // deduped) — never a community-wide scan.
  const taskCountEventIds = useMemo(() => {
    const ids = new Set<Id<'events'>>();
    for (const ev of myEvents) ids.add(ev._id);
    for (const ev of pendingRsvpEvents) ids.add(ev._id);
    for (const ev of additionalEvents) ids.add(ev._id);
    return [...ids];
  }, [myEvents, pendingRsvpEvents, additionalEvents]);
  const taskCountsMap =
    useQuery(
      api.eventTasks.getTaskCountsForEvents,
      taskCountEventIds.length > 0 ? { eventIds: taskCountEventIds } : 'skip'
    ) ?? {};

  // ── FIX 8B — Community Main inline task panel ──────────────────────────
  // Reuses the SAME authorized query Home already uses
  // (listEventTasksForHome) rather than inventing a second task-visibility
  // pipeline. Scoped to exactly the events already rendered on this screen
  // (same id set as taskCountsMap above) — never a community-wide scan.
  const homeTaskResults = useQuery(
    api.eventTasks.listEventTasksForHome,
    taskCountEventIds.length > 0 ? { eventIds: taskCountEventIds } : 'skip'
  );
  const isHomeTaskDataLoading =
    homeTaskResults === undefined && taskCountEventIds.length > 0;
  const homeTasksByEventId = useMemo(() => {
    const map: Record<string, EventTaskAccordionData> = {};
    for (const r of homeTaskResults ?? []) {
      const tasks: AuthorizedHomeEventTask[] = r.tasks.map((t) => ({
        id: String(t._id),
        title: t.title,
        completed: t.completed,
        completedAt: t.completedAt,
        assignedToUserId: t.assignedToUserId
          ? String(t.assignedToUserId)
          : undefined,
        assignedToManual: t.assignedToManual,
        assigneeDisplay: t.assigneeDisplay,
        isAssignedToCurrentUser: t.isAssignedToCurrentUser,
      }));
      map[String(r.eventId)] = {
        tasks,
        canManageTasks: r.canManageTasks,
        tasksVisibleToParticipants: r.tasksVisibleToParticipants,
      };
    }
    return map;
  }, [homeTaskResults]);

  // FIX 8B FOLLOW-UP §1 — visibility-safe task-status line per event,
  // computed ONCE here from the SAME two authorized data sources (never
  // from raw `taskCountsMap` counts alone). See `getCommunityMainTaskStatusLine`.
  const communityMainTaskLineByEventId = useMemo(() => {
    const map: Record<string, CommunityMainTaskLine | null> = {};
    for (const eventId of taskCountEventIds) {
      map[eventId as string] = getCommunityMainTaskStatusLine(
        taskCountsMap[eventId],
        homeTasksByEventId[eventId as string]
      );
    }
    return map;
  }, [taskCountEventIds, taskCountsMap, homeTasksByEventId]);

  // FIX 8B UX CORRECTION — a single selected event id is sufficient to open
  // one Community Task Bottom Sheet at a time (replaces the previous
  // section-aware `openTaskPanelSelection` inline-panel state — the sheet
  // is a full-screen Modal overlay, so it no longer needs to know which
  // carousel section it was opened from).
  const [selectedTaskEventId, setSelectedTaskEventId] =
    useState<Id<'events'> | null>(null);

  const eventsById = useMemo(() => {
    const map = new Map<string, EventDoc>();
    for (const ev of myEvents) map.set(ev._id as string, ev);
    for (const ev of pendingRsvpEvents) map.set(ev._id as string, ev);
    for (const ev of additionalEvents) map.set(ev._id as string, ev);
    return map;
  }, [myEvents, pendingRsvpEvents, additionalEvents]);

  // Defensive auto-close: if the open event scrolls out of every loaded
  // list (e.g. pagination replaced it, or it left the viewer's calendar),
  // never leave a stale/orphaned sheet open.
  useEffect(() => {
    if (selectedTaskEventId && !eventsById.has(selectedTaskEventId)) {
      setSelectedTaskEventId(null);
    }
  }, [selectedTaskEventId, eventsById]);

  const handleOpenTaskSheet = useCallback((eventId: Id<'events'>) => {
    setSelectedTaskEventId(eventId);
  }, []);
  const handleCloseTaskSheet = useCallback(() => {
    setSelectedTaskEventId(null);
  }, []);

  // Same mutations + in-flight guarding pattern as
  // HomeDailyCommandCenter's handleClaimEventTask/handleUnclaimEventTask —
  // intentionally not a second implementation of the underlying semantics,
  // just a second UI entry point to the same Convex mutations. FIX 8B
  // FOLLOW-UP §3 — Community Main is claim/unclaim-only, so no
  // `toggleCompleted` mutation/handler is wired here any more.
  const claimEventTaskMutation = useMutation(api.eventTasks.claimEventTask);
  const unclaimEventTaskMutation = useMutation(api.eventTasks.unclaimEventTask);
  const pendingTaskActionIds = useRef(new Set<string>());

  const handleClaimEventTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (pendingTaskActionIds.current.has(taskId)) return;
      pendingTaskActionIds.current.add(taskId);
      try {
        await claimEventTaskMutation({ id: taskId as Id<'eventTasks'> });
      } catch (_error) {
        Alert.alert('שגיאה', 'לא ניתן להשתבץ למשימה כרגע');
      } finally {
        pendingTaskActionIds.current.delete(taskId);
      }
    },
    [claimEventTaskMutation]
  );

  const handleUnclaimEventTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (pendingTaskActionIds.current.has(taskId)) return;
      pendingTaskActionIds.current.add(taskId);
      try {
        await unclaimEventTaskMutation({ id: taskId as Id<'eventTasks'> });
      } catch (_error) {
        Alert.alert('שגיאה', 'לא ניתן להסיר הקצאה כרגע');
      } finally {
        pendingTaskActionIds.current.delete(taskId);
      }
    },
    [unclaimEventTaskMutation]
  );

  const selectedTaskEvent = selectedTaskEventId
    ? (eventsById.get(selectedTaskEventId as string) ?? null)
    : null;

  const isEventNew = useCallback(
    (ev: EventDoc) => isEventNewSincePreviousVisit(ev, previousVisitAt),
    [previousVisitAt]
  );

  // "מה חשוב עכשיו" candidates — nearest today/tomorrow event drawn from the
  // union of the two already-bounded lists above (no extra query).
  const relevantEvents = useMemo(() => {
    const byId = new Map<string, EventDoc>();
    for (const ev of myEvents) byId.set(ev._id as string, ev);
    for (const ev of pendingRsvpEvents) byId.set(ev._id as string, ev);
    return [...byId.values()].sort((a, b) => a.startTime - b.startTime);
  }, [myEvents, pendingRsvpEvents]);
  const todayEvent = useMemo(
    () => relevantEvents.find((ev) => isEventOnLocalDay(ev, todayKey)),
    [relevantEvents, todayKey]
  );
  const tomorrowEvent = useMemo(
    () => relevantEvents.find((ev) => isEventOnLocalDay(ev, tomorrowKey)),
    [relevantEvents, tomorrowKey]
  );

  const importantNowItems = useMemo<ImportantNowItem[]>(() => {
    const items: ImportantNowItem[] = [];

    // FIX C.2 — recent cancellations are high-priority Community updates:
    // added FIRST, before today/pending/tomorrow/reminder candidates, so a
    // recent cancellation is never silently displaced by a normal
    // tomorrow event once the final `slice(0, 3)` below runs. Already
    // sorted newest-cancellation-first by the query
    // (selectRecentCancelledCommunityEvents).
    for (const cancelledEvent of recentCancelledEvents) {
      items.push({
        key: `cancelled-${cancelledEvent._id}`,
        label: `בוטל · ${cancelledEvent.title}`,
        iconName: 'close-circle-outline',
        onPress: () => onOpenEventDetails(cancelledEvent._id),
      });
    }

    if (todayEvent) {
      items.push({
        key: 'today',
        label: `אירוע היום · ${todayEvent.title}`,
        iconName: 'star',
        emphasis: true,
        onPress: () => onOpenEventDetails(todayEvent._id),
      });
    }

    if (pendingRsvpEvents.length > 0) {
      const label = pendingRsvpHasMore
        ? 'אירועים מחכים לתגובה'
        : pendingRsvpEvents.length === 1
          ? 'אירוע אחד מחכה לתגובה'
          : `${pendingRsvpEvents.length} אירועים מחכים לתגובה`;
      items.push({
        key: 'pending',
        label,
        iconName: 'help-circle-outline',
        onPress: onSeeMoreEvents,
      });
    }

    if (tomorrowEvent) {
      items.push({
        key: 'tomorrow',
        label: `אירוע מחר · ${tomorrowEvent.title}`,
        iconName: 'calendar-outline',
        onPress: () => onOpenEventDetails(tomorrowEvent._id),
      });
    }

    if (nearestActiveReminder) {
      const extraActiveCount =
        (mainReminderSelection?.activeReminders.length ?? 1) - 1;
      // BUG 3 fix (QA): preserve the reminder's configured schedule in the
      // Main presentation — reuses the SAME formatReminderScheduleLabel
      // helper the Reminders tab's date/time text is built from (see
      // lib/taskDueStatus.ts), never a second date-formatting system.
      // `dueAt` (the exact timed timestamp) is the source of truth for the
      // time whenever `hasTime` is set — never derived from `dueDate`'s
      // local-day midnight — so a date-only reminder never shows a fake
      // `00:00`.
      const scheduleLabel = formatReminderScheduleLabel(nearestActiveReminder);
      const schedulePrefix = scheduleLabel
        ? `תזכורת ${scheduleLabel}`
        : 'תזכורת';
      const label =
        extraActiveCount > 0
          ? `${schedulePrefix} · ${nearestActiveReminder.title} (+${extraActiveCount})`
          : `${schedulePrefix} · ${nearestActiveReminder.title}`;
      items.push({
        key: 'reminders',
        label,
        iconName: 'notifications-outline',
        onPress: onSeeMoreReminders,
      });
    }

    return items.slice(0, 3);
  }, [
    recentCancelledEvents,
    todayEvent,
    tomorrowEvent,
    pendingRsvpEvents.length,
    pendingRsvpHasMore,
    nearestActiveReminder,
    mainReminderSelection,
    onOpenEventDetails,
    onSeeMoreEvents,
    onSeeMoreReminders,
  ]);

  // QA FIX (Issue 3): ONLY the event's actual creator is exempt from RSVP —
  // management role (owner/admin) alone must never bypass RSVP for an event
  // someone else created. In practice `pendingRsvpEvents` never contains the
  // viewer's own created events any more (see computeRsvpAttentionState's
  // creator exemption), so this always resolves to false there; kept
  // explicit/defensive so this list is provably safe against ever
  // regressing to a role-based bypass.
  const isEventCreator = useCallback(
    (ev: EventDoc) => ev.createdBy === currentUserId,
    [currentUserId]
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.tabContent}
        showsVerticalScrollIndicator={false}
        style={styles.tabScroll}
      >
        {/* ── מה חשוב עכשיו — hidden entirely when there is nothing to show */}
        {importantNowItems.length > 0 ? (
          <View>
            <SectionHeader title="מה חשוב עכשיו" />
            <View style={styles.importantNowList}>
              {importantNowItems.map((item) => (
                <ImportantNowRow item={item} key={item.key} />
              ))}
            </View>
          </View>
        ) : null}

        {/* ── האירועים שלי — horizontal carousel, always shown (core section) */}
        <View>
          <SectionHeader
            actionLabel="הצג הכל"
            onAction={onSeeMoreEvents}
            title="האירועים שלי"
          />
          {isLoadingOverview ? (
            <ActivityIndicator color={PRIMARY} style={{ marginVertical: 16 }} />
          ) : myEvents.length === 0 ? (
            <View style={styles.emptySmall}>
              <Text style={styles.emptySmallText}>
                {myEventsHasMore
                  ? // The scan hit its safety cap without proof there are no
                    // matching events further out — showing the flat "no
                    // events" claim here would be a false negative (see the
                    // Stage 2A scale-edge-case investigation). Point at the
                    // existing "הצג הכל" action above instead of asserting
                    // emptiness we can't actually confirm.
                    'יש אירועים נוספים לצפייה'
                  : 'עדיין אין אירועים ביומן שלך בקהילה זו'}
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.mainCarouselContent}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {myEvents.map((ev) => (
                <MainEventCard
                  cardWidth={carouselCardWidth}
                  event={ev}
                  isCreator={isEventCreator(ev)}
                  isNew={isEventNew(ev)}
                  isToday={isEventOnLocalDay(ev, todayKey)}
                  isTomorrow={isEventOnLocalDay(ev, tomorrowKey)}
                  key={ev._id}
                  onOpenDetails={onOpenEventDetails}
                  onOpenTaskSheet={handleOpenTaskSheet}
                  rsvpStatus={rsvpMap[ev._id] ?? 'none'}
                  taskStatusLine={
                    communityMainTaskLineByEventId[ev._id as string] ?? null
                  }
                />
              ))}
              {myEventsHasMore ? (
                <Pressable
                  accessible
                  accessibilityLabel="הצג את כל האירועים שלי"
                  accessibilityRole="button"
                  onPress={onSeeMoreEvents}
                  style={[styles.mainSeeMoreCard, { width: carouselCardWidth }]}
                >
                  <Ionicons color={PRIMARY} name="chevron-back" size={20} />
                  <Text style={styles.mainSeeMoreText}>הצג הכל</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          )}
        </View>

        {/* ── מחכים לתגובה — short vertical list, hidden entirely when empty */}
        {pendingRsvpEvents.length > 0 ? (
          <View>
            <SectionHeader
              actionLabel={pendingRsvpHasMore ? 'הצג הכל' : undefined}
              onAction={pendingRsvpHasMore ? onSeeMoreEvents : undefined}
              subtitle="אירועים שדורשים אישור הגעה ממך"
              title="מחכים לתגובה"
            />
            {isLoadingOverview ? (
              <ActivityIndicator
                color={PRIMARY}
                style={{ marginVertical: 16 }}
              />
            ) : (
              <View style={{ gap: 8 }}>
                {pendingRsvpEvents.map((ev) => (
                  <MainPendingRsvpRow
                    event={ev}
                    flyerDetailsOnly={isEventCreator(ev)}
                    isNew={isEventNew(ev)}
                    isToday={isEventOnLocalDay(ev, todayKey)}
                    isTomorrow={isEventOnLocalDay(ev, tomorrowKey)}
                    key={ev._id}
                    onOpenDetails={onOpenEventDetails}
                    onRsvpSelect={onInlineRsvp}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* ── אירועים נוספים — QA FIX (Issue 2): upcoming community events not
          yet in the viewer's personal calendar. Horizontal, genuinely
          paginated list — NOT capped to 2-3 events (see
          listCommunityAdditionalEventsPaged). Hidden entirely once loading
          settles and there is nothing eligible to discover. */}
        {isLoadingAdditional && additionalEvents.length === 0 ? (
          <View>
            <SectionHeader
              subtitle="אירועי קהילה שעדיין לא הוספת ליומן שלך"
              title="אירועים נוספים"
            />
            <ActivityIndicator color={PRIMARY} style={{ marginVertical: 16 }} />
          </View>
        ) : additionalEvents.length > 0 ? (
          <View>
            <SectionHeader
              subtitle="אירועי קהילה שעדיין לא הוספת ליומן שלך"
              title="אירועים נוספים"
            />
            <FlatList<EventDoc>
              contentContainerStyle={styles.mainCarouselContent}
              data={additionalEvents}
              horizontal
              keyExtractor={(ev) => ev._id}
              ListFooterComponent={
                additionalLoadingMore ? (
                  <ActivityIndicator
                    color={PRIMARY}
                    style={{ marginHorizontal: 16 }}
                  />
                ) : null
              }
              onEndReached={handleLoadMoreAdditional}
              onEndReachedThreshold={0.5}
              renderItem={({ item: ev }) => (
                <AdditionalEventCard
                  cardWidth={carouselCardWidth}
                  event={ev}
                  isAdding={addingEventId === (ev._id as string)}
                  isNew={isEventNew(ev)}
                  isToday={isEventOnLocalDay(ev, todayKey)}
                  isTomorrow={isEventOnLocalDay(ev, tomorrowKey)}
                  onAddToCalendar={handleAddToCalendar}
                  onOpenDetails={onOpenEventDetails}
                  onOpenTaskSheet={handleOpenTaskSheet}
                  taskStatusLine={
                    communityMainTaskLineByEventId[ev._id as string] ?? null
                  }
                />
              )}
              showsHorizontalScrollIndicator={false}
            />
          </View>
        ) : null}
      </ScrollView>
      <CommunityTaskBottomSheet
        event={selectedTaskEvent}
        isLoading={isHomeTaskDataLoading}
        onClaimTask={handleClaimEventTask}
        onClose={handleCloseTaskSheet}
        onUnclaimTask={handleUnclaimEventTask}
        taskData={
          selectedTaskEvent
            ? homeTasksByEventId[selectedTaskEvent._id as string]
            : undefined
        }
      />
    </>
  );
}

// ─── Tab: אירועים ─────────────────────────────────────────────────────────────

const EVENTS_TAB_PAGE_SIZE = 20;

interface MonthYearNavigatorProps {
  filter: EventsTabFilter;
  isCurrentMonth: boolean;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onJumpToCurrentMonth: () => void;
}

/**
 * STAGE 3 CORRECTION (Part A) — replaces the former 12-month horizontal
 * "קרובים" + month-tab strip with simple, unbounded prev/next month/year
 * arrow navigation: "‹  אוגוסט 2026  ›". Reuses the EXACT visual language
 * of calendar.tsx's CalendarMonthNavBar (chevron-right = physical-right =
 * previous, chevron-left = physical-left = next, same #f8fafc circular
 * chevron buttons) so month navigation looks and behaves identically
 * everywhere in the app. There is no product-imposed past or future limit
 * — every press is an O(1) client-state step via
 * getPreviousEventsTabMonth/getNextEventsTabMonth.
 */
function MonthYearNavigator({
  filter,
  isCurrentMonth,
  onPrevMonth,
  onNextMonth,
  onJumpToCurrentMonth,
}: MonthYearNavigatorProps) {
  const label = formatEventsTabMonthYearLabel(filter.year, filter.monthIndex0);
  return (
    <View style={styles.eventsMonthNavRow}>
      <View style={styles.eventsMonthNavCluster}>
        {/* Physical RIGHT button (first child in rtl layout) → previous month */}
        <Pressable
          accessible
          accessibilityLabel="חודש קודם"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onPrevMonth}
          style={styles.eventsMonthChevronBtn}
        >
          <MaterialIcons color="#647b87" name="chevron-right" size={22} />
        </Pressable>
        <View style={styles.eventsMonthTitleBlock}>
          <Text style={styles.eventsMonthYearLabel}>{label}</Text>
        </View>
        {/* Physical LEFT button (last child in rtl layout) → next month */}
        <Pressable
          accessible
          accessibilityLabel="חודש הבא"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onNextMonth}
          style={styles.eventsMonthChevronBtn}
        >
          <MaterialIcons color="#647b87" name="chevron-left" size={22} />
        </Pressable>
      </View>
      {!isCurrentMonth ? (
        <Pressable
          accessible
          accessibilityLabel="חזרה לחודש הנוכחי"
          accessibilityRole="button"
          onPress={onJumpToCurrentMonth}
          style={styles.eventsMonthJumpToCurrentBtn}
        >
          <Text style={styles.eventsMonthJumpToCurrentBtnText}>
            החודש הנוכחי
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Stage 3 compact card RSVP label. Deliberately a SEPARATE, short label set
 * from getMainCardStatusLabel (Main's carousel cards have more room) —
 * same precedent as EventRow's own local badgeLabel — but reuses the exact
 * same underlying rule: the creator is never shown an RSVP badge (QA FIX
 * Issue 3's creator exemption), and only requiresRsvp === true events show
 * one at all. `null` means "no RSVP badge for this card".
 */
function getEventsTabRsvpLabel(
  event: EventDoc,
  rsvpStatus: RsvpStatus,
  isCreator: boolean
): string | null {
  if (event.requiresRsvp !== true) return null;
  if (isCreator) return null;
  if (rsvpStatus === 'yes') return 'כן';
  if (rsvpStatus === 'maybe') return 'אולי';
  if (rsvpStatus === 'no') return 'לא';
  return 'נדרש אישור הגעה';
}

/**
 * STAGE 3 CORRECTION — 'historical' is a NEW bucket (Part B): a past month
 * shows ONLY this bucket, and the current month additionally moves any
 * already-ended event here instead of into my/pending/additional. It is
 * purely informational — no RSVP action, no "הוסף ליומן" — except the
 * manager-only duplicate action, which past events must still expose
 * (Part D10).
 */
type EventsTabBucket = 'my' | 'pending' | 'additional' | 'historical';

interface EventsTabCardProps {
  event: EventDoc;
  bucket: EventsTabBucket;
  rsvpStatus: RsvpStatus;
  isCreator: boolean;
  isNew: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  taskSummary?: TaskSummary;
  isAdding: boolean;
  /** Part D1 — owner/admin only (the exact community-event-creation permission). */
  canDuplicate: boolean;
  onOpenDetails: (eventId: Id<'events'>) => void;
  onRsvpPress: (eventId: Id<'events'>) => void;
  onAddToCalendar: (eventId: Id<'events'>) => void;
  onDuplicate: (eventId: Id<'events'>) => void;
}

/**
 * Stage 3 — the full "אירועים" tab's compact card. QA FIX (manual QA gap):
 * unlike the pre-Stage-3 EventRow, this surfaces location, RSVP state,
 * "חשוב לזכור" count and task-assignment summary together so a member can
 * understand an event without opening it. Deliberately reuses existing
 * pieces (MainEventChips, TaskSummaryLine, formatMainCardDateTime,
 * getOpenCommunityCalendarActionLabel) rather than a flyer-style layout —
 * see the Stage 3 prompt's "avoid flyer-style giant cards" guidance.
 *
 * The RSVP badge is a tappable "אישור הגעה" button for `bucket === 'pending'`
 * (opens the SAME existing RsvpBottomSheet as every other RSVP entry point
 * in this screen — no second RSVP UX).
 *
 * STAGE 3 CORRECTION (Part C1–C3): an RSVP-required event the viewer
 * answered "לא" now lands in `bucket === 'additional'` (see
 * classifyCommunityEventForEventsTab) instead of disappearing. Its card
 * shows the "לא" chip AND a separate "שינוי תשובה" action (same
 * RsvpBottomSheet flow) INSTEAD OF "הוסף ליומן" — adding to the calendar
 * makes no sense while the answer is still "no", and changing the answer
 * to yes/maybe already re-includes the event in "האירועים שלי" on its own
 * (see computeIsSavedToMyCalendar). `bucket === 'historical'` never shows
 * either action — see the type doc above.
 */
function EventsTabCard({
  event,
  bucket,
  rsvpStatus,
  isCreator,
  isNew,
  isToday,
  isTomorrow,
  taskSummary,
  isAdding,
  canDuplicate,
  onOpenDetails,
  onRsvpPress,
  onAddToCalendar,
  onDuplicate,
}: EventsTabCardProps) {
  const locationLabel = event.location?.trim();
  const importantItemsCount = event.importantItems?.length ?? 0;
  const taskTotal = taskSummary?.totalTasksCount ?? taskSummary?.total ?? 0;
  const rsvpLabel = getEventsTabRsvpLabel(event, rsvpStatus, isCreator);
  const isPendingActionable = bucket === 'pending' && rsvpLabel !== null;
  const isRsvpChangeActionable =
    bucket === 'additional' && event.requiresRsvp === true;
  const showAddToCalendar = bucket === 'additional' && !isRsvpChangeActionable;
  const addLabel = getOpenCommunityCalendarActionLabel(false);

  return (
    <View style={styles.eventsTabCard}>
      {canDuplicate ? (
        <Pressable
          accessible
          accessibilityLabel="שכפל אירוע"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onDuplicate(event._id)}
          style={styles.eventsTabDuplicateBtn}
        >
          <MaterialIcons color="#64748b" name="content-copy" size={16} />
        </Pressable>
      ) : null}
      <Pressable
        accessible
        accessibilityLabel={`פרטי אירוע ${event.title}`}
        accessibilityRole="button"
        onPress={() => onOpenDetails(event._id)}
        style={styles.eventsTabCardPressable}
      >
        <MainEventChips
          isNew={isNew}
          isToday={isToday}
          isTomorrow={isTomorrow}
        />
        <Text numberOfLines={2} style={styles.eventsTabCardTitle}>
          {event.title}
        </Text>
        <Text numberOfLines={1} style={styles.eventsTabCardMeta}>
          {formatMainCardDateTime(event)}
        </Text>
        {locationLabel ? (
          <Text numberOfLines={1} style={styles.eventsTabCardMeta}>
            📍 {locationLabel}
          </Text>
        ) : null}
        <View style={styles.eventsTabCardFooter}>
          {rsvpLabel ? (
            isPendingActionable ? (
              <TouchableOpacity
                accessible
                accessibilityLabel="אישור הגעה"
                accessibilityRole="button"
                onPress={() => onRsvpPress(event._id)}
                style={styles.eventsTabRsvpPendingBtn}
              >
                <Text style={styles.eventsTabRsvpPendingBtnText}>
                  {rsvpLabel}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.eventsTabRsvpChip}>
                <Text style={styles.eventsTabRsvpChipText}>{rsvpLabel}</Text>
              </View>
            )
          ) : null}
          {isRsvpChangeActionable ? (
            <TouchableOpacity
              accessible
              accessibilityLabel="שינוי תשובה"
              accessibilityRole="button"
              onPress={() => onRsvpPress(event._id)}
              style={styles.eventsTabRsvpPendingBtn}
            >
              <Text style={styles.eventsTabRsvpPendingBtnText}>
                שינוי תשובה
              </Text>
            </TouchableOpacity>
          ) : null}
          {importantItemsCount > 0 ? (
            <Text numberOfLines={1} style={styles.eventsTabImportantChip}>
              {`📌 חשוב לזכור · ${importantItemsCount}`}
            </Text>
          ) : null}
          {taskSummary && taskTotal > 0 ? (
            <TaskSummaryLine
              copy="compact"
              doneStyle={styles.eventsTabTaskSummaryDone}
              style={styles.eventsTabTaskSummary}
              taskSummary={taskSummary}
            />
          ) : null}
        </View>
      </Pressable>
      {showAddToCalendar ? (
        <Pressable
          accessible
          accessibilityHint="מוסיף את האירוע ליומן האישי שלך"
          accessibilityLabel={addLabel}
          accessibilityRole="button"
          disabled={isAdding}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => onAddToCalendar(event._id)}
          style={({ pressed }) => [
            styles.additionalEventAddBtn,
            (pressed || isAdding) && styles.additionalEventAddBtnPressed,
          ]}
        >
          <Text style={styles.additionalEventAddBtnText}>
            {isAdding ? '...' : addLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type EventsTabRow =
  | { key: string; kind: 'section'; title: string; subtitle?: string }
  | { key: string; kind: 'event'; event: EventDoc; bucket: EventsTabBucket }
  | { key: string; kind: 'empty'; message: string }
  | { key: string; kind: 'cancelled-header' }
  | { key: string; kind: 'cancelled-event'; event: EventDoc };

interface TabEventsProps {
  communityId: Id<'communities'>;
  rsvpMap: Record<string, RsvpStatus>;
  onRsvpPress: (eventId: Id<'events'>) => void;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
  filter: EventsTabFilter;
  onFilterChange: (filter: EventsTabFilter) => void;
  searchQuery: string;
  currentUserId?: Id<'users'>;
  /** Captured BEFORE markCommunityViewed runs — see previousVisitAtRef above. */
  previousVisitAt: number | undefined;
  /** Part D1 — drives `canDuplicate`: identical to canCreateCommunityContent
   * (resolveActiveCommunityContext.ts) — owner/admin only. */
  myRole?: 'owner' | 'admin' | 'member';
  onDuplicateEvent: (eventId: Id<'events'>) => void;
}

/**
 * Stage 3 — full "אירועים" tab: the complete event-management/browsing
 * surface for a community (see the Stage 3 report for the full
 * architecture writeup). ONE paginated, date-scoped query
 * (listCommunityEventsTabPaged) drives everything below — the three
 * sections ("האירועים שלי" / "מחכים לתגובה" / "אירועים נוספים") are a
 * client-side bucketing of the SAME accumulated pages by the
 * server-computed classification flags, never a separate query per
 * section. This intentionally mirrors the "ראשי" tab's mental model, but
 * without ראשי's small per-category caps — every event in the selected
 * date scope is reachable via ordinary pagination.
 */
function TabEvents({
  communityId,
  rsvpMap,
  onRsvpPress,
  onOpenEventDetails,
  filter,
  onFilterChange,
  searchQuery,
  currentUserId,
  previousVisitAt,
  myRole,
  onDuplicateEvent,
}: TabEventsProps) {
  // Stable "now" per mount (this tab only mounts while active — see the
  // conditional render in the parent) — never Date.now() inside a query.
  const now = useMemo(() => Date.now(), []);
  const todayKey = useMemo(() => getLocalDayKey(now), [now]);
  const tomorrowKey = useMemo(
    () => getLocalDayKey(now + 24 * 60 * 60 * 1000),
    [now]
  );

  // Part D1 — identical permission source as the global "+" sheet's
  // canCreateCommunityContent (resolveActiveCommunityContext.ts).
  const canDuplicate = myRole === 'owner' || myRole === 'admin';

  const isCurrentMonth = isCurrentEventsTabMonth(
    now,
    filter.year,
    filter.monthIndex0
  );
  const monthTemporalKind = getEventsTabMonthTemporalKind(
    now,
    filter.year,
    filter.monthIndex0
  );
  const handlePrevMonth = useCallback(() => {
    onFilterChange(getPreviousEventsTabMonth(filter.year, filter.monthIndex0));
  }, [filter, onFilterChange]);
  const handleNextMonth = useCallback(() => {
    onFilterChange(getNextEventsTabMonth(filter.year, filter.monthIndex0));
  }, [filter, onFilterChange]);
  const handleJumpToCurrentMonth = useCallback(() => {
    onFilterChange(getCurrentEventsTabMonth(Date.now()));
  }, [onFilterChange]);

  const { fromTime, toTime } = useMemo(() => {
    // toTime is the EXCLUSIVE start of the next month — the server query
    // uses `.lt('startTime', toTime)`, so an event starting at exactly
    // 00:00:00.000 on the 1st of next month is correctly excluded from
    // this month's page (see listCommunityEventsTabPaged).
    const { monthStart, nextMonthStart } = getEventsTabMonthRange(
      filter.year,
      filter.monthIndex0
    );
    return { fromTime: monthStart, toTime: nextMonthStart };
  }, [filter]);
  const filterKey = `${filter.year}-${filter.monthIndex0}`;

  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<EventDoc[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const seenCursorsRef = useRef<Set<string | null>>(new Set([null]));

  // Reset accumulation whenever the community or the selected date scope
  // changes — this is a fresh scan, not a continuation of the previous one.
  useEffect(() => {
    seenCursorsRef.current = new Set([null]);
    setCursor(null);
    setAccumulated([]);
    setLoadingMore(false);
  }, [communityId, filterKey]);

  const pageArgs = useMemo(
    () => ({
      communityId,
      cursor,
      numItems: EVENTS_TAB_PAGE_SIZE,
      fromTime,
      toTime,
    }),
    [communityId, cursor, fromTime, toTime]
  );
  const page = useQuery(api.events.listCommunityEventsTabPaged, pageArgs);

  useEffect(() => {
    if (!page) return;

    setAccumulated((prev) => {
      const ids = new Set(prev.map((e) => e._id as string));
      const newItems = (page.page as EventDoc[]).filter(
        (e) => !ids.has(e._id as string)
      );
      return cursor === null
        ? (page.page as EventDoc[])
        : [...prev, ...newItems];
    });

    // Every event returned by this query keeps its true bucket flags (no
    // post-fetch elimination like listCommunityAdditionalEventsPaged). A
    // bucketable-empty page can only happen for a FUTURE/CURRENT month when
    // every event on it is a plain RSVP "no" not-personal/pending-excluded
    // one or a long-cancelled one. Auto-advance past it rather than risk a
    // premature "no events" flash while more pages remain — same
    // sparse-page precedent as TabMain's additional-events carousel.
    // STAGE 3 CORRECTION (Part B) — for a PAST month, or for an
    // already-ended event within the CURRENT month, every event is
    // unconditionally bucketable into "אירועים שהתקיימו" regardless of the
    // my/pending/additional flags above.
    const pageHasBucketableEvent = page.page.some((ev) => {
      const e = ev as EventDoc;
      if (e.status === 'cancelled') return true;
      if (monthTemporalKind === 'past') return true;
      if (monthTemporalKind === 'current' && hasEventEndedByNow(e, now)) {
        return true;
      }
      return e.isSavedToMyCalendar || e.isPendingRsvp || e.isAdditionalEligible;
    });
    if (
      !pageHasBucketableEvent &&
      page.isDone === false &&
      page.continueCursor &&
      !seenCursorsRef.current.has(page.continueCursor)
    ) {
      seenCursorsRef.current.add(page.continueCursor);
      setLoadingMore(true);
      setCursor(page.continueCursor);
      return;
    }
    setLoadingMore(false);
  }, [page, cursor, monthTemporalKind, now]);

  const handleLoadMore = useCallback(() => {
    if (
      page?.isDone === false &&
      page.continueCursor &&
      !loadingMore &&
      !seenCursorsRef.current.has(page.continueCursor)
    ) {
      seenCursorsRef.current.add(page.continueCursor);
      setLoadingMore(true);
      setCursor(page.continueCursor);
    }
  }, [page, loadingMore]);

  const activeEvents = useMemo(
    () => accumulated.filter((ev) => ev.status !== 'cancelled'),
    [accumulated]
  );
  // FIX C — uses the SAME shared 24h-window helper the early-removal action
  // (EventDetailsBottomSheet.tsx / event/[id].tsx) and the server
  // (events.removeCancelledCommunityEvent) rely on, so this can never drift
  // out of sync with either. `listCommunityEventsTabPaged` (the data source
  // for `accumulated`) is already the authoritative filter for
  // `removedFromCommunityAt` — the extra client-side check below is
  // defense-in-depth only, so a manually-removed event can never resurface
  // here even if another rendering path fed in a stale cached page.
  const cancelledEvents = useMemo(
    () =>
      accumulated.filter(
        (ev) =>
          ev.status === 'cancelled' &&
          ev.removedFromCommunityAt === undefined &&
          isCancelledEventWithinCommunityVisibilityWindow(
            ev.cancelledAt,
            Date.now()
          )
      ),
    [accumulated]
  );

  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return activeEvents;
    const q = searchQuery.toLowerCase();
    return activeEvents.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.location ?? '').toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q)
    );
  }, [activeEvents, searchQuery]);

  // STAGE 3 CORRECTION (Part B) — a PAST selected month shows ONLY the
  // historical list (B1: "do NOT show meaningless current-action
  // sections"). The CURRENT month keeps normal three-section semantics for
  // events that have not yet ended, and additionally surfaces any
  // already-ended event from earlier in the same month under "אירועים
  // שהתקיימו" (B2) instead of discarding it. A FUTURE month has no
  // historical section at all (B3).
  const actionableEvents = useMemo(() => {
    if (monthTemporalKind === 'past') return [];
    if (monthTemporalKind === 'future') return searchFiltered;
    return searchFiltered.filter((e) => !hasEventEndedByNow(e, now));
  }, [searchFiltered, monthTemporalKind, now]);
  const historicalEvents = useMemo(() => {
    if (monthTemporalKind === 'future') return [];
    const list =
      monthTemporalKind === 'past'
        ? searchFiltered
        : searchFiltered.filter((e) => hasEventEndedByNow(e, now));
    return [...list].sort((a, b) => b.startTime - a.startTime);
  }, [searchFiltered, monthTemporalKind, now]);

  const myEvents = useMemo(
    () =>
      actionableEvents
        .filter((e) => e.isSavedToMyCalendar)
        .sort((a, b) => a.startTime - b.startTime),
    [actionableEvents]
  );
  const pendingEvents = useMemo(
    () =>
      actionableEvents
        .filter((e) => e.isPendingRsvp)
        .sort((a, b) => a.startTime - b.startTime),
    [actionableEvents]
  );
  const additionalEvents = useMemo(
    () =>
      actionableEvents
        .filter((e) => e.isAdditionalEligible)
        .sort((a, b) => a.startTime - b.startTime),
    [actionableEvents]
  );

  // STAGE 1C precedent: task counts are requested only for events
  // accumulated so far (the currently loaded pages), never the whole
  // community. "חשוב לזכור" needs no such query at all — importantItems is
  // already part of every event document returned above.
  const taskCountEventIds = useMemo(
    () => accumulated.map((ev) => ev._id),
    [accumulated]
  );
  const taskCountsMap =
    useQuery(
      api.eventTasks.getTaskCountsForEvents,
      taskCountEventIds.length > 0 ? { eventIds: taskCountEventIds } : 'skip'
    ) ?? {};

  const addCommunityEventToMyCalendar = useMutation(
    api.communityEventCalendar.addCommunityEventToMyCalendar
  );
  const [addingEventId, setAddingEventId] = useState<string | null>(null);
  const handleAddToCalendar = useCallback(
    (eventId: Id<'events'>) => {
      setAddingEventId(eventId as string);
      addCommunityEventToMyCalendar({ eventId })
        .catch(() => {
          Alert.alert('שגיאה', 'לא ניתן להוסיף את האירוע ליומן');
        })
        .finally(() => {
          setAddingEventId((prev) =>
            prev === (eventId as string) ? null : prev
          );
        });
    },
    [addCommunityEventToMyCalendar]
  );

  const isEventNew = useCallback(
    (ev: EventDoc) => isEventNewSincePreviousVisit(ev, previousVisitAt),
    [previousVisitAt]
  );
  const isEventCreator = useCallback(
    (ev: EventDoc) => ev.createdBy === currentUserId,
    [currentUserId]
  );

  const isFirstPageLoading = page === undefined && accumulated.length === 0;

  const rows = useMemo<EventsTabRow[]>(() => {
    if (isFirstPageLoading) return [];

    const list: EventsTabRow[] = [];
    const allBucketsEmpty =
      myEvents.length === 0 &&
      pendingEvents.length === 0 &&
      additionalEvents.length === 0 &&
      historicalEvents.length === 0;
    // Only claim "no events" once the scan of the selected date scope has
    // genuinely finished (page.isDone) — see the sparse-page comment above;
    // hitting a bucketable-empty page mid-scan must never render this.
    if (
      allBucketsEmpty &&
      cancelledEvents.length === 0 &&
      page?.isDone !== false
    ) {
      list.push({
        key: 'empty-all',
        kind: 'empty',
        message: 'אין אירועים בחודש הזה',
      });
      return list;
    }

    if (myEvents.length > 0) {
      list.push({ key: 'section-my', kind: 'section', title: 'האירועים שלי' });
      for (const ev of myEvents) {
        list.push({
          key: `my-${ev._id}`,
          kind: 'event',
          event: ev,
          bucket: 'my',
        });
      }
    }
    if (pendingEvents.length > 0) {
      list.push({
        key: 'section-pending',
        kind: 'section',
        title: 'מחכים לתגובה',
        subtitle: 'אירועים שדורשים אישור הגעה ממך',
      });
      for (const ev of pendingEvents) {
        list.push({
          key: `pending-${ev._id}`,
          kind: 'event',
          event: ev,
          bucket: 'pending',
        });
      }
    }
    if (additionalEvents.length > 0) {
      list.push({
        key: 'section-additional',
        kind: 'section',
        title: 'אירועים נוספים',
        subtitle: 'אירועי קהילה שעדיין לא הוספת ליומן שלך',
      });
      for (const ev of additionalEvents) {
        list.push({
          key: `additional-${ev._id}`,
          kind: 'event',
          event: ev,
          bucket: 'additional',
        });
      }
    }
    if (historicalEvents.length > 0) {
      list.push({
        key: 'section-historical',
        kind: 'section',
        title: 'אירועים שהתקיימו',
      });
      for (const ev of historicalEvents) {
        list.push({
          key: `historical-${ev._id}`,
          kind: 'event',
          event: ev,
          bucket: 'historical',
        });
      }
    }
    if (cancelledEvents.length > 0) {
      list.push({ key: 'cancelled-header', kind: 'cancelled-header' });
      for (const ev of cancelledEvents) {
        list.push({
          key: `cancelled-${ev._id}`,
          kind: 'cancelled-event',
          event: ev,
        });
      }
    }
    return list;
  }, [
    isFirstPageLoading,
    myEvents,
    pendingEvents,
    additionalEvents,
    historicalEvents,
    cancelledEvents,
    page,
  ]);

  const renderItem = useCallback(
    ({ item }: { item: EventsTabRow }) => {
      if (item.kind === 'section') {
        return (
          <View style={styles.eventsTabSectionHeader}>
            <Text style={styles.eventsTabSectionTitle}>{item.title}</Text>
            {item.subtitle ? (
              <Text style={styles.eventsTabSectionSubtitle}>
                {item.subtitle}
              </Text>
            ) : null}
          </View>
        );
      }
      if (item.kind === 'empty') {
        return (
          <View style={styles.emptyFull}>
            <Ionicons color="#d1d5db" name="calendar-outline" size={48} />
            <Text style={styles.emptyText}>{item.message}</Text>
          </View>
        );
      }
      if (item.kind === 'cancelled-header') {
        return (
          <View style={styles.cancelledEventsSection}>
            <Text style={styles.cancelledEventsTitle}>אירועים שבוטלו</Text>
            <Text style={styles.cancelledEventsSubtitle}>
              אירועים שבוטלו יוסרו מהתצוגה לאחר 24 שעות מרגע ביטולם
            </Text>
          </View>
        );
      }
      if (item.kind === 'cancelled-event') {
        return (
          <EventRow
            cancelReason={item.event.cancelReason}
            event={item.event}
            isCancelled
            onOpenDetails={onOpenEventDetails}
            onRsvpPress={() => {}}
            rsvpStatus="none"
          />
        );
      }
      return (
        <EventsTabCard
          bucket={item.bucket}
          canDuplicate={canDuplicate}
          event={item.event}
          isAdding={addingEventId === (item.event._id as string)}
          isCreator={isEventCreator(item.event)}
          isNew={isEventNew(item.event)}
          isToday={isEventOnLocalDay(item.event, todayKey)}
          isTomorrow={isEventOnLocalDay(item.event, tomorrowKey)}
          onAddToCalendar={handleAddToCalendar}
          onDuplicate={onDuplicateEvent}
          onOpenDetails={onOpenEventDetails}
          onRsvpPress={onRsvpPress}
          rsvpStatus={rsvpMap[item.event._id] ?? 'none'}
          taskSummary={taskCountsMap[item.event._id]}
        />
      );
    },
    [
      addingEventId,
      canDuplicate,
      onDuplicateEvent,
      handleAddToCalendar,
      isEventCreator,
      isEventNew,
      onOpenEventDetails,
      onRsvpPress,
      rsvpMap,
      taskCountsMap,
      todayKey,
      tomorrowKey,
    ]
  );

  const keyExtractor = useCallback((item: EventsTabRow) => item.key, []);

  return (
    <View style={styles.tabFlex}>
      <MonthYearNavigator
        filter={filter}
        isCurrentMonth={isCurrentMonth}
        onJumpToCurrentMonth={handleJumpToCurrentMonth}
        onNextMonth={handleNextMonth}
        onPrevMonth={handlePrevMonth}
      />

      {isFirstPageLoading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={PRIMARY} size="large" />
        </View>
      ) : (
        <FlatList<EventsTabRow>
          contentContainerStyle={styles.eventsTabListContent}
          data={rows}
          keyExtractor={keyExtractor}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                color={PRIMARY}
                style={{ marginVertical: 16 }}
              />
            ) : null
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Tab: תזכורות ─────────────────────────────────────────────────────────────

/**
 * Stage 4 — one grouped card per personally-relevant community event that
 * still has active "חשוב לזכור" items. Deliberately NOT a per-item card
 * (see the Stage 4 report) — the whole group opens the EXISTING Event
 * Details flow; there is no separate reminder-detail screen for event
 * important items.
 *
 * Manual QA follow-up: each important item now renders as its own
 * structured row (not one text blob), an authorized manager (event creator
 * OR active community owner/admin — the SAME rule events.update already
 * enforces server-side) gets a per-item delete control, and the card
 * exposes the canonical group-level "הוסף למשימות שלי" action shared with
 * Event Details.
 */
interface EventReminderGroupCardProps {
  group: EventReminderGroupDoc;
  currentUserId?: Id<'users'>;
  myRole?: 'owner' | 'admin' | 'member';
  alreadyAdded: boolean;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
  onDeleteItem: (eventId: Id<'events'>, itemId: string) => void;
}

function EventReminderGroupCard({
  group,
  currentUserId,
  myRole,
  alreadyAdded,
  onOpenEventDetails,
  onDeleteItem,
}: EventReminderGroupCardProps): React.JSX.Element {
  const dateLabel = formatDueDate(group.startTime);
  const timeLabel = group.allDay
    ? 'כל היום'
    : new Date(group.startTime).toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
      });

  // Same authorization rule as events.update: the event creator, or an
  // active community owner/admin — never every owner/admin unconditionally,
  // and never inferred from anything other than this exact rule.
  const canManage = canManageEventReminderItem({
    currentUserId,
    eventCreatedBy: group.createdBy,
    myRole,
  });

  return (
    <View style={styles.eventReminderGroupCard}>
      <Pressable
        onPress={() => onOpenEventDetails(group._id)}
        style={({ pressed }) => [
          styles.eventReminderGroupPressable,
          pressed && { opacity: 0.85 },
        ]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`חשוב לזכור לאירוע ${group.title}, ${dateLabel} ${timeLabel}`}
        accessibilityHint="פותח את פרטי האירוע"
      >
        <View style={styles.eventReminderGroupHeaderRow}>
          <Ionicons name="calendar-outline" size={16} color={PRIMARY} />
          <Text style={styles.eventReminderGroupTitle} numberOfLines={2}>
            {group.title}
          </Text>
        </View>
        <Text style={styles.eventReminderGroupMeta}>
          {`${dateLabel} · ${timeLabel}`}
        </Text>
        <View style={styles.eventReminderGroupDivider} />
        <Text style={styles.eventReminderGroupItemsLabel}>חשוב לזכור</Text>
      </Pressable>

      <View style={styles.eventReminderGroupItemsBlock}>
        {group.importantItems.map((item, index) => (
          <View
            key={item.id}
            style={[
              styles.eventReminderGroupItemRow,
              index > 0 && styles.eventReminderGroupItemRowSeparator,
            ]}
          >
            <Text style={styles.eventReminderGroupItemText} numberOfLines={2}>
              {`• ${item.title}`}
            </Text>
            {canManage ? (
              <Pressable
                onPress={() => onDeleteItem(group._id, item.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`הסר את ${item.title} מחשוב לזכור`}
                accessibilityHint="מוחק את הפריט מהאירוע"
                style={({ pressed }) => [
                  styles.eventReminderGroupItemDeleteBtn,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={19}
                  color="#9ca3af"
                />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.eventReminderGroupFooterRow}>
        <ImportantItemsAddToTasksButton
          eventId={group._id}
          alreadyAdded={alreadyAdded}
          onError={() => Alert.alert('שגיאה', 'לא ניתן להוסיף למשימות כרגע')}
        />
      </View>
    </View>
  );
}

interface TabRemindersProps {
  communityId: Id<'communities'>;
  onToggle: (id: Id<'tasks'>) => void;
  currentUserId?: Id<'users'>;
  myRole?: 'owner' | 'admin' | 'member';
  onOpenEventDetails: (eventId: Id<'events'>) => void;
}

function TabReminders({
  communityId,
  onToggle,
  currentUserId,
  myRole,
  onOpenEventDetails,
}: TabRemindersProps) {
  // Stable "now" per mount — never Date.now() inside a query, and
  // hasEventEndedByNow (device-local wall clock) is applied client-side
  // below, exactly like the "אירועים" tab (see the Stage 4 report).
  const now = useMemo(() => Date.now(), []);

  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<TaskDoc[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedReminderId, setExpandedReminderId] = useState<string | null>(
    null
  );
  // Tracks every cursor we have already sent to useQuery. Prevents an impossible
  // but defensive cursor loop if Convex somehow returns the same continueCursor twice.
  const seenCursors = useRef<Set<string | null>>(new Set([null]));

  // ── Event-based "חשוב לזכור" groups — independent bounded/paginated query
  const [eventGroupsCursor, setEventGroupsCursor] = useState<string | null>(
    null
  );
  const [eventGroupsAccumulated, setEventGroupsAccumulated] = useState<
    EventReminderGroupDoc[]
  >([]);
  const [eventGroupsLoadingMore, setEventGroupsLoadingMore] = useState(false);
  const seenEventGroupsCursors = useRef<Set<string | null>>(new Set([null]));

  const page = useQuery(api.tasks.listCommunityRemindersPaged, {
    communityId,
    cursor,
    numItems: 20,
  });

  const eventGroupsPage = useQuery(
    api.events.listCommunityEventReminderGroupsPaged,
    { communityId, cursor: eventGroupsCursor, numItems: 20, now }
  );

  // Single batched "already added to my tasks" source of truth — shared by
  // Event Details, this tab, and Home. Never one query per event group.
  const bundleStatusByEventId = useQuery(
    api.tasks.getMyImportantItemsBundleStatus,
    {}
  );

  const updateEvent = useMutation(api.events.update);
  const handleDeleteImportantItem = useCallback(
    (eventId: Id<'events'>, itemId: string) => {
      const group = eventGroupsAccumulated.find((g) => g._id === eventId);
      if (!group) return;
      const importantItems = group.importantItems.filter(
        (item) => item.id !== itemId
      );
      updateEvent({ id: eventId, importantItems }).catch(() => {
        Alert.alert('שגיאה', 'לא ניתן למחוק את הפריט כרגע');
      });
    },
    [eventGroupsAccumulated, updateEvent]
  );

  useEffect(() => {
    if (!page?.page) return;

    setAccumulated((prev) => {
      const ids = new Set(prev.map((t) => t._id));
      const newItems = (page.page as TaskDoc[]).filter((t) => !ids.has(t._id));
      return cursor === null
        ? (page.page as TaskDoc[])
        : [...prev, ...newItems];
    });

    // Sparse-page auto-advance: the backend page contained only personally
    // completed reminders so the filtered result is empty, but more pages exist.
    // Advance the cursor automatically so open reminders on later pages surface
    // without requiring a user tap. A spinner replaces the premature empty state.
    if (
      page.page.length === 0 &&
      page.isDone === false &&
      page.continueCursor
    ) {
      const next = page.continueCursor;
      if (!seenCursors.current.has(next)) {
        seenCursors.current.add(next);
        setLoadingMore(true);
        setCursor(next);
        return;
      }
    }
    setLoadingMore(false);
  }, [page, cursor]);

  // Event reminder groups: identical sparse-page auto-advance pattern —
  // eligibility filtering happens server-side AFTER the page is fetched, so
  // an eligible-but-later group must never be missed by a premature "done".
  useEffect(() => {
    if (!eventGroupsPage?.page) return;

    setEventGroupsAccumulated((prev) => {
      if (eventGroupsCursor === null) return eventGroupsPage.page;
      // Beyond the first page: merge in place so a manager's per-item
      // delete (which reactively re-runs this query) refreshes an
      // already-accumulated group's importantItems instead of leaving a
      // stale snapshot from when that page was first fetched.
      const freshById = new Map(eventGroupsPage.page.map((g) => [g._id, g]));
      const merged = prev.map((g) => freshById.get(g._id) ?? g);
      const prevIds = new Set(prev.map((g) => g._id));
      const newItems = eventGroupsPage.page.filter((g) => !prevIds.has(g._id));
      return [...merged, ...newItems];
    });

    if (
      eventGroupsPage.page.length === 0 &&
      eventGroupsPage.isDone === false &&
      eventGroupsPage.continueCursor
    ) {
      const next = eventGroupsPage.continueCursor;
      if (!seenEventGroupsCursors.current.has(next)) {
        seenEventGroupsCursors.current.add(next);
        setEventGroupsLoadingMore(true);
        setEventGroupsCursor(next);
        return;
      }
    }
    setEventGroupsLoadingMore(false);
  }, [eventGroupsPage, eventGroupsCursor]);

  const handleLoadMore = useCallback(() => {
    if (page?.isDone === false && page.continueCursor && !loadingMore) {
      setLoadingMore(true);
      setCursor(page.continueCursor);
    }
  }, [page, loadingMore]);

  const handleLoadMoreEventGroups = useCallback(() => {
    if (
      eventGroupsPage?.isDone === false &&
      eventGroupsPage.continueCursor &&
      !eventGroupsLoadingMore
    ) {
      setEventGroupsLoadingMore(true);
      setEventGroupsCursor(eventGroupsPage.continueCursor);
    }
  }, [eventGroupsPage, eventGroupsLoadingMore]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedReminderId((prev) => (prev === id ? null : id));
  }, []);

  // "Has this event ended" is device-local-time-sensitive — decided here,
  // client-side, exactly like the "אירועים" tab (hasEventEndedByNow), never
  // in the Convex query. Active groups are already in ascending startTime
  // order from the server's indexed scan, so no further client-side sort
  // is needed to satisfy "nearest relevant event first".
  const activeEventGroups = useMemo(
    () =>
      eventGroupsAccumulated.filter((g) => !hasEventEndedByNow(g, Date.now())),
    [eventGroupsAccumulated]
  );

  // STAGE 4 ALIGNMENT PART H2/H3 — "מהקהילה" is an ACTIVE surface: the
  // backend (`listCommunityRemindersPaged`) already excludes reminders the
  // current user personally completed. On top of that, a reminder whose
  // real due/reminder timestamp (dueAt when hasTime, else end-of-day of
  // dueDate) has already passed must also drop out of the active list. A
  // reminder with NO date at all ("ללא תאריך") has no reliable timestamp
  // and is therefore never treated as past-due (see lib/taskDueStatus.ts).
  const activeGeneralReminders = useMemo(
    () => accumulated.filter((t) => !isTaskPastDue(t, Date.now())),
    [accumulated]
  );

  // Clear expandedReminderId when the expanded reminder is no longer in the
  // active list (the 30-day completed-reminder history UI was removed from
  // this active tab — see PART H1).
  const activeGeneralReminderIds = useMemo(
    () => new Set(activeGeneralReminders.map((t) => t._id as string)),
    [activeGeneralReminders]
  );
  useEffect(() => {
    if (
      expandedReminderId &&
      !activeGeneralReminderIds.has(expandedReminderId)
    ) {
      setExpandedReminderId(null);
    }
  }, [expandedReminderId, activeGeneralReminderIds]);

  if (page === undefined || eventGroupsPage === undefined) {
    return (
      <View style={styles.loadingCenter}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  // ── Unified empty state — only when BOTH content types are genuinely
  // exhausted (not merely mid-sparse-page auto-advance) and empty.
  const eventGroupsSettled =
    !eventGroupsLoadingMore && eventGroupsPage.isDone !== false;
  const generalRemindersSettled = !loadingMore && page.isDone !== false;
  const isFullyEmpty =
    eventGroupsSettled &&
    activeEventGroups.length === 0 &&
    generalRemindersSettled &&
    activeGeneralReminders.length === 0;

  if (isFullyEmpty) {
    return (
      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.emptySmall,
            { alignItems: 'center', gap: 8, marginTop: 48 },
          ]}
        >
          <Ionicons name="notifications-outline" size={36} color="#d1d5db" />
          <Text style={[styles.emptySmallText, { textAlign: 'center' }]}>
            אין תזכורות כרגע
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.tabScroll}
      contentContainerStyle={{ paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Section 1: מאירועים — event-based "חשוב לזכור" groups */}
      {activeEventGroups.length > 0 || !eventGroupsSettled ? (
        <View style={{ marginHorizontal: 16, marginTop: 16 }}>
          <SectionHeader title="מאירועים" />
          {activeEventGroups.length === 0 ? (
            <ActivityIndicator color={PRIMARY} style={{ marginVertical: 16 }} />
          ) : (
            <View style={{ gap: 10 }}>
              {activeEventGroups.map((group) => (
                <EventReminderGroupCard
                  key={group._id}
                  group={group}
                  currentUserId={currentUserId}
                  myRole={myRole}
                  alreadyAdded={
                    bundleStatusByEventId?.[String(group._id)] === true
                  }
                  onOpenEventDetails={onOpenEventDetails}
                  onDeleteItem={handleDeleteImportantItem}
                />
              ))}
              {eventGroupsLoadingMore ? (
                <ActivityIndicator
                  color={PRIMARY}
                  style={{ marginVertical: 8 }}
                />
              ) : eventGroupsPage?.isDone === false ? (
                <TouchableOpacity
                  onPress={handleLoadMoreEventGroups}
                  style={{ paddingVertical: 12, alignItems: 'center' }}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="טען עוד"
                >
                  <Text
                    style={{ color: PRIMARY, fontSize: 14, fontWeight: '600' }}
                  >
                    טען עוד
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {/* ── Section 2: מהקהילה — ACTIVE standalone community reminders only.
          Personally-completed reminders are excluded server-side; past-due
          reminders (real dueAt/dueDate has passed) are excluded here. This
          is an active mental-load surface, not a history screen — the
          previous 30-day completed-reminder history UI was removed (PART
          H1); completed/old reminders remain in the database untouched. */}
      {activeGeneralReminders.length > 0 || !generalRemindersSettled ? (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: activeEventGroups.length > 0 ? 24 : 16,
          }}
        >
          <SectionHeader title="מהקהילה" />
          {activeGeneralReminders.length === 0 ? (
            generalRemindersSettled ? null : (
              <ActivityIndicator
                color={PRIMARY}
                style={{ marginVertical: 16 }}
              />
            )
          ) : (
            <View style={{ gap: 8 }}>
              {activeGeneralReminders.map((t) => (
                <CommunityReminderRow
                  key={t._id}
                  task={t}
                  onToggle={onToggle}
                  isExpanded={expandedReminderId === (t._id as string)}
                  onToggleExpand={handleToggleExpand}
                  currentUserId={currentUserId}
                  myRole={myRole}
                />
              ))}
              {loadingMore ? (
                <ActivityIndicator
                  color={PRIMARY}
                  style={{ marginVertical: 8 }}
                />
              ) : page?.isDone === false ? (
                <TouchableOpacity
                  onPress={handleLoadMore}
                  style={{ paddingVertical: 12, alignItems: 'center' }}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="טען עוד"
                >
                  <Text
                    style={{ color: PRIMARY, fontSize: 14, fontWeight: '600' }}
                  >
                    טען עוד
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

// ─── Tab: פעילות ─────────────────────────────────────────────────────────────

interface TabActivityProps {
  communityId: Id<'communities'>;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
}

function TabActivity({ communityId, onOpenEventDetails }: TabActivityProps) {
  const activityArgs = useMemo(
    () => ({ communityId, limit: 50 }),
    [communityId]
  );
  const activities = useQuery(
    api.communityActivities.listCommunityActivities,
    activityArgs
  ) as CommunityActivityItem[] | undefined;

  if (activities === undefined) {
    return (
      <View style={styles.loadingCenter}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (activities.length === 0) {
    return (
      <View style={styles.emptyFull}>
        <Ionicons name="pulse-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyText}>פעילות הקהילה תופיע כאן בקרוב</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.tabScroll}
      contentContainerStyle={styles.tabContent}
      showsVerticalScrollIndicator={false}
    >
      <ActivityList
        activities={activities}
        grouped
        onOpenEventDetails={onOpenEventDetails}
      />
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommunityDetailScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const convex = useConvex();
  const communityId = id as Id<'communities'>;

  // ── Queries
  const community = useQuery(api.communities.getCommunity, { communityId });
  const myRsvps = useQuery(api.eventRsvps.listByUser);
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;
  // STAGE 1C: getTaskCountsByCommunity (unbounded — scans every event and
  // every event's tasks in the community) was removed from this top level.
  // TabMain and TabEvents each fetch their own task counts scoped to only
  // the events they've actually loaded, via getTaskCountsForEvents.

  // ── Mutations
  const upsertRsvp = useMutation(api.eventRsvps.upsertRsvp);
  const setRsvpNoAndUnclaimMyEventTasks = useMutation(
    api.eventRsvps.setRsvpNoAndUnclaimMyEventTasks
  );
  const toggleCompleted = useMutation(api.tasks.toggleCompleted);
  const deleteCommunity = useMutation(api.communities.deleteCommunity);
  const markCommunityViewed = useMutation(api.communities.markCommunityViewed);
  const updateJoinApprovalMode = useMutation(
    api.communities.updateCommunityJoinApprovalMode
  );
  const toggleAutoAddEvents = useMutation(api.communities.toggleAutoAddEvents);

  // ── Local state
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (tab === LEGACY_MAIN_TAB_PARAM) return 'ראשי';
    if (tab && (TABS as readonly string[]).includes(tab)) return tab as Tab;
    return 'ראשי';
  });
  const [eventsFilter, setEventsFilter] = useState<EventsTabFilter>(() =>
    getCurrentEventsTabMonth(Date.now())
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 8, y: 80 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [joinApprovalOpen, setJoinApprovalOpen] = useState(false);
  const [joinApprovalDraft, setJoinApprovalDraft] =
    useState<JoinApprovalMode>('automatic');
  const [joinApprovalSaving, setJoinApprovalSaving] = useState(false);
  const [rsvpSheet, setRsvpSheet] = useState<Id<'events'> | null>(null);
  const [blockedRsvpDialog, setBlockedRsvpDialog] = useState<{
    eventId: Id<'events'>;
    count: number;
  } | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionCanExpand, setDescriptionCanExpand] = useState(false);
  // FIX 9: Profile association sheet
  const [profileAssociationOpen, setProfileAssociationOpen] = useState(false);
  const menuBtnRef = useRef<View>(null);

  // Reset description when switching communities
  useEffect(() => {
    setDescriptionExpanded(false);
    setDescriptionCanExpand(false);
  }, [communityId, community?.description]);

  // ── Optimization Sprint Fix #1 ───────────────────────────────────────────
  // Previously, the markCommunityViewed effect below depended on the whole
  // reactive `community` object, so EVERY reactive update re-ran it:
  //
  //   effect → markCommunityViewed → lastViewedAt patch → getCommunity
  //   invalidation → new `community` reference → effect → ... (unbounded
  //   loop; ~85K/~120K calls in production per the confirmed audit).
  //
  // This screen is a hidden `Tabs.Screen` (see the Stage 2B comment below)
  // that stays MOUNTED after navigating away, so "once per mount" (a ref
  // reset only on `communityId` change) is not a valid fix either — it
  // would silently skip marking a genuine revisit to the SAME community.
  // The correct unit of work is ONE mark per genuine screen FOCUS ("visit"):
  // `useFocusEffect` resets the per-visit guards on every focus and its
  // cleanup fires on blur (React Navigation focus semantics), independent
  // of mount/unmount.
  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const hasCapturedVisitRef = useRef(false);
  const hasMarkedViewedThisVisitRef = useRef(false);
  // MICRO-FIX (stale-across-focus) — the "ראשי" tab's Main-overview/
  // Additional-events server queries need the VIEWER's device-local
  // midnight as their scan lower bound (see getLocalDayStart's doc
  // comment / TabMainProps.focusedLocalDayStart). This screen can stay
  // MOUNTED across a tab switch away and back (same reason
  // markCommunityViewed above moved off "once per mount"), so a
  // per-mount value would silently go stale after an overnight revisit.
  // Refreshed in the SAME useFocusEffect below that resets the other
  // per-visit guards — one fresh capture per genuine focus, never a
  // timer, never recomputed on every render.
  const [focusedLocalDayStart, setFocusedLocalDayStart] = useState(() =>
    getLocalDayStart(Date.now())
  );
  // Stage 2A: snapshot of the viewer's PREVIOUS visit to this community —
  // captured once per VISIT, from the FIRST reactive `community` value this
  // visit ever sees, BEFORE markCommunityViewed (below) has a chance to
  // advance `lastViewedAt` to "now". Used to decide which events are "חדש"
  // (event.createdAt > previousVisitAtRef.current) for the rest of THIS
  // visit even though the live `community.myLastViewedAt` value advances
  // underneath it once markCommunityViewed fires.
  const previousVisitAtRef = useRef<number | undefined>(undefined);

  // Resets the per-visit guards on every genuine focus (a new "visit"), and
  // clears them again on blur so the NEXT focus — whether it's the same
  // community or a different one — is treated as a fresh visit. Mirrors the
  // Stage 2B `useFocusEffect` pattern below (active community context).
  useFocusEffect(
    useCallback(() => {
      hasCapturedVisitRef.current = false;
      hasMarkedViewedThisVisitRef.current = false;
      setIsScreenFocused(true);
      // One fresh capture per genuine focus/visit — see the
      // focusedLocalDayStart declaration above for why this can't be a
      // per-mount value.
      setFocusedLocalDayStart(getLocalDayStart(Date.now()));
      return () => {
        setIsScreenFocused(false);
      };
    }, [])
  );
  // Defensive: also reset when navigating directly between two different
  // community routes (communityId changes) so a stale previous-visit value
  // can never leak from one community into another.
  // biome-ignore lint/correctness/useExhaustiveDependencies: communityId is
  // intentionally the sole re-run trigger — it is not read in the body.
  useEffect(() => {
    hasCapturedVisitRef.current = false;
    hasMarkedViewedThisVisitRef.current = false;
    previousVisitAtRef.current = undefined;
  }, [communityId]);

  useEffect(() => {
    if (!isScreenFocused) return;
    if (community === undefined || community === null) return;
    if (hasCapturedVisitRef.current) return;
    hasCapturedVisitRef.current = true;
    previousVisitAtRef.current = community.myLastViewedAt;
  }, [isScreenFocused, community]);

  // Mark viewed for list "new events" hint — only for fully approved
  // members, and only ONCE per focus/visit (see the Fix #1 comment above).
  // A 30s server-side idempotency guard (convex/communities.ts) backs this
  // up defensively, but is not a substitute for this visit-scoped guard.
  useEffect(() => {
    if (!isScreenFocused) return;
    if (hasMarkedViewedThisVisitRef.current) return;
    if (community === undefined || community === null) return;
    if (community.myMembershipStatus === 'pending') return;
    hasMarkedViewedThisVisitRef.current = true;
    markCommunityViewed({ communityId }).catch(() => {
      // non-blocking
    });
  }, [isScreenFocused, communityId, community, markCommunityViewed]);

  // Stage 2B: tell the GLOBAL "+" sheet which community is active so it can
  // expose "אירוע בקהילה" / "תזכורת בקהילה" for authorized creators. Uses the
  // SAME owner/admin gate already enforced by the server for community
  // event/reminder creation (convex/events.ts, convex/tasks.ts) — this never
  // broadens who can create community content.
  //
  // QA FIX (Issue 1 — stale global "+" context): this screen is registered
  // as a hidden `Tabs.Screen` (see app/(authenticated)/_layout.tsx), so
  // React Navigation's tab navigator keeps it MOUNTED in the background
  // when the user switches to Home/Calendar/Tasks/Communities — it is only
  // ever unmounted when the whole authenticated stack unmounts (e.g. sign
  // out). A plain `useEffect` cleanup therefore never re-runs on a tab
  // switch, so the community context used to stay stuck on the "+" sheet
  // until another community screen happened to mount and overwrite it.
  // `useFocusEffect` (re-exported by expo-router from
  // @react-navigation/native) fires its cleanup on BLUR — i.e. exactly when
  // this screen stops being the focused route, regardless of whether it
  // stays mounted — so the context is cleared the instant the user leaves
  // this specific community screen, even via a tab switch.
  const { setActiveCommunityContext } = useActionSheet();
  useFocusEffect(
    useCallback(() => {
      const nextContext = resolveActiveCommunityContext({
        communityId,
        community,
      });
      if (nextContext === null) return;
      setActiveCommunityContext(nextContext);
      return () => setActiveCommunityContext(null);
    }, [community, communityId, setActiveCommunityContext])
  );

  // ── Back navigation — inner tabs go back to ראשי, ראשי goes to communities list
  const handleBack = useCallback(() => {
    if (activeTab !== 'ראשי') {
      setActiveTab('ראשי');
      return;
    }
    router.replace(
      '/(authenticated)/communities' as Parameters<typeof router.replace>[0]
    );
  }, [router, activeTab]);

  // ── RSVP map
  const rsvpMap = useMemo<Record<string, RsvpStatus>>(() => {
    if (!myRsvps) return {};
    return Object.fromEntries(
      myRsvps.map((r) => [r.eventId, r.status as RsvpStatus])
    );
  }, [myRsvps]);

  // ── Handlers
  const handleBlockedRsvpNo = useCallback(
    (eventId: Id<'events'>, count: number) => {
      setBlockedRsvpDialog({ eventId, count });
    },
    []
  );

  const handleRsvpSelect = useCallback(
    async (status: RsvpStatus) => {
      if (!rsvpSheet) return;
      if (status === 'no') {
        const assignedState = await convex.query(
          api.eventRsvps.hasMyAssignedEventTasksForEvent,
          { eventId: rsvpSheet }
        );
        if (assignedState.hasAssignedTasks) {
          handleBlockedRsvpNo(rsvpSheet, assignedState.count);
          return;
        }
      }
      upsertRsvp({ eventId: rsvpSheet, status }).catch((error) => {
        if (
          status === 'no' &&
          getConvexErrorCode(error) === 'RSVP_NO_BLOCKED_BY_ACTIVE_TASK'
        ) {
          handleBlockedRsvpNo(rsvpSheet, 1);
          return;
        }
        Alert.alert('שגיאה', 'לא ניתן לשמור תגובה');
      });
    },
    [convex, handleBlockedRsvpNo, rsvpSheet, upsertRsvp]
  );

  const handleInlineRsvp = useCallback(
    async (eventId: Id<'events'>, status: RsvpStatus) => {
      if (status === 'no') {
        const assignedState = await convex.query(
          api.eventRsvps.hasMyAssignedEventTasksForEvent,
          { eventId }
        );
        if (assignedState.hasAssignedTasks) {
          handleBlockedRsvpNo(eventId, assignedState.count);
          return;
        }
      }
      await upsertRsvp({ eventId, status }).catch((error) => {
        if (
          status === 'no' &&
          getConvexErrorCode(error) === 'RSVP_NO_BLOCKED_BY_ACTIVE_TASK'
        ) {
          handleBlockedRsvpNo(eventId, 1);
          return;
        }
        Alert.alert('שגיאה', 'לא ניתן לעדכן אישור הגעה');
      });
    },
    [convex, handleBlockedRsvpNo, upsertRsvp]
  );

  const handleOpenEventDetails = useCallback(
    (eventId: Id<'events'>) => {
      // returnTo lets Event Details header/hardware Back restore this same
      // Community (via event.communityId) instead of relying on
      // Tabs-navigator history (see event/[id].tsx).
      router.push({
        pathname: '/(authenticated)/event/[id]',
        params: { id: eventId, returnTo: 'community' },
      } as never);
    },
    [router]
  );

  /**
   * Part D3 — duplication opens the EXISTING community event creation route
   * in a pre-filled duplication mode via `duplicateFromEventId`; it never
   * writes a new event directly, and the entire source event is never
   * serialized into route params — CommunityEventForm (event/new.tsx)
   * fetches it through the existing data layer (api.events.getById /
   * api.eventTasks.listByEvent).
   */
  const handleDuplicateEvent = useCallback(
    (eventId: Id<'events'>) => {
      router.push({
        pathname: '/(authenticated)/event/new',
        params: {
          communityId,
          duplicateFromEventId: eventId as string,
        },
      });
    },
    [communityId, router]
  );

  const handleToggleTask = useCallback(
    (taskId: Id<'tasks'>) => {
      return toggleCompleted({ id: taskId });
    },
    [toggleCompleted]
  );

  // Wrapper used by TabReminders (no optimistic state, just fire-and-alert).
  const handleToggleTaskWithAlert = useCallback(
    (taskId: Id<'tasks'>) => {
      handleToggleTask(taskId).catch(() =>
        Alert.alert('שגיאה', 'לא ניתן לעדכן תזכורת')
      );
    },
    [handleToggleTask]
  );

  const handleDeleteCommunity = useCallback(() => {
    Alert.alert(
      'מחיקת קהילה',
      'מחיקת קהילה תמחק גם את כל האירועים והתזכורות שלה עבור כל החברים. פעולה זו אינה הפיכה.',
      [
        { text: 'בטל', style: 'cancel' },
        {
          text: 'מחק',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCommunity({ communityId });
              router.back();
            } catch {
              Alert.alert('שגיאה', 'לא ניתן למחוק את הקהילה');
            }
          },
        },
      ]
    );
  }, [deleteCommunity, communityId, router]);

  // Stage 2B: personal preference — no bulk save-row creation, no RSVP change.
  // Backend just flips communityMembers.autoAddEventsToCalendar; the reactive
  // `community` query re-renders the Switch with the real persisted value.
  const handleToggleAutoAdd = useCallback(() => {
    toggleAutoAddEvents({ communityId }).catch(() => {
      Alert.alert('שגיאה', 'לא ניתן לעדכן את ההגדרה');
    });
  }, [toggleAutoAddEvents, communityId]);

  const handleOpenJoinApprovalSettings = useCallback(() => {
    setJoinApprovalDraft(community?.joinApprovalMode ?? 'automatic');
    setJoinApprovalOpen(true);
  }, [community?.joinApprovalMode]);

  const handleSaveJoinApproval = useCallback(async () => {
    try {
      setJoinApprovalSaving(true);
      await updateJoinApprovalMode({
        communityId,
        joinApprovalMode: joinApprovalDraft,
      });
      setJoinApprovalOpen(false);
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשמור את ההגדרות');
    } finally {
      setJoinApprovalSaving(false);
    }
  }, [communityId, joinApprovalDraft, updateJoinApprovalMode]);

  const handleSeeMoreEvents = useCallback(() => setActiveTab('אירועים'), []);
  const handleSeeMoreReminders = useCallback(() => setActiveTab('תזכורות'), []);

  const handleShare = useCallback(() => {
    const code = community?.inviteCode;
    const name = community?.name ?? 'קהילה';
    const message = code
      ? `הצטרפו לקהילה "${name}":\ninyomi://community-join/${code}`
      : `הצטרפו לקהילה "${name}" באפליקציית InYomi`;
    // Delay to ensure the ⋯ menu modal has fully dismissed before the system Share sheet opens
    setTimeout(async () => {
      try {
        await Share.share({ message });
      } catch (e) {
        console.error('Share failed:', e);
        Alert.alert('שגיאה', 'לא ניתן לשתף כרגע');
      }
    }, 300);
  }, [community]);

  // Overflow menu opens from the LEFT — position uses left: px
  const handleMenuPress = useCallback(() => {
    if (!menuBtnRef.current) {
      setMenuPos({ x: 8, y: 80 });
      setMenuOpen(true);
      return;
    }
    menuBtnRef.current.measure((_fx, _fy, _w, h, px, py) => {
      setMenuPos({ x: Math.max(0, px), y: py + h + 4 });
      setMenuOpen(true);
    });
  }, []);

  const overflowItems = useMemo<OverflowItem[]>(
    () => [
      {
        label: 'הצג ביומן',
        iconName: 'calendar-outline',
        onPress: () => {
          // TODO: add communityId filter to calendar screen
          router.push(
            `/(authenticated)/calendar?communityId=${communityId}` as Parameters<
              typeof router.push
            >[0]
          );
        },
      },
      ...(community?.myRole === 'owner' || community?.myRole === 'admin'
        ? [
            {
              label: 'ערוך קהילה',
              iconName: 'create-outline' as const,
              onPress: () =>
                router.push({
                  pathname: '/(authenticated)/community-edit/[id]',
                  params: { id: communityId, returnTo: 'detail' },
                }),
            },
          ]
        : []),
      // Stage 2B: PERSONAL preference — visible to every active member, not
      // owner/admin-gated. Value comes straight from the reactive query.
      {
        label: 'הוספה אוטומטית ליומן',
        subtitle: 'כל אירועי הקהילה יופיעו ביומן שלך',
        onPress: handleToggleAutoAdd,
        toggle: { value: community?.myAutoAddEventsToCalendar === true },
      },
      // FIX 9: Profile association — personal setting for every active member
      {
        label: 'שיוך לפרופיל משפחה',
        iconName: 'people-outline',
        onPress: () => {
          setMenuOpen(false);
          setTimeout(() => setProfileAssociationOpen(true), 200);
        },
      },
      {
        label: 'ניהול חברים',
        iconName: 'people-outline',
        onPress: () =>
          router.push(
            `/(authenticated)/community-members/${communityId}?returnTab=${activeTab}` as Parameters<
              typeof router.push
            >[0]
          ),
      },
      ...(community?.myRole === 'owner' || community?.myRole === 'admin'
        ? [
            {
              label: 'הגדרות הצטרפות',
              iconName: 'settings-outline' as const,
              onPress: handleOpenJoinApprovalSettings,
            },
          ]
        : []),
      {
        label: 'שיתוף קישור',
        iconName: 'share-outline',
        onPress: handleShare,
      },
      {
        label: 'מחיקת קהילה',
        iconName: 'trash-outline',
        danger: true,
        onPress: handleDeleteCommunity,
      },
    ],
    [
      community,
      communityId,
      router,
      activeTab,
      handleOpenJoinApprovalSettings,
      handleDeleteCommunity,
      handleShare,
      handleToggleAutoAdd,
    ]
  );

  // ── Loading / not found
  if (community === undefined) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  if (community === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingCenter}>
          <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>אין לך גישה לקהילה הזו</Text>
          <Text style={styles.emptySubText}>
            יכול להיות שהוסרת מהקהילה או שהקישור כבר לא פעיל.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() =>
              router.replace(
                '/(authenticated)/communities' as Parameters<
                  typeof router.replace
                >[0]
              )
            }
            accessible
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>חזרה לקהילות</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (community.myMembershipStatus === 'pending') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.pendingGateHeader}>
          <View style={{ width: 40 }} />
          <Text style={styles.pendingGateTitle} numberOfLines={1}>
            {community.name}
          </Text>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.headerIconBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזרה לרשימת הקהילות"
          >
            <Ionicons name="chevron-forward" size={22} color="#374151" />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingCenter}>
          <Ionicons name="time-outline" size={52} color="#94a3b8" />
          <Text style={[styles.emptyText, styles.pendingGateMessage]}>
            בקשת ההצטרפות נשלחה וממתינה לאישור מנהל הקהילה
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const memberLabel = `${community.tags?.[0] ? `${community.tags[0]} • ` : ''}${community.memberCount} חברים`;
  const descriptionTrimmed = community.description?.trim();
  const showDescription = !!descriptionTrimmed;

  return (
    <SafeAreaView
      style={[
        styles.container,
        ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null,
      ]}
      edges={['top']}
    >
      {/* ── Header */}
      <View style={styles.header}>
        {/* JSX order swapped to match rtl.flexDirection (row-reverse in Expo Go):
            first child renders on the RIGHT, second child on the LEFT.
            headerRight (back + name + add) → physical RIGHT ✓
            headerLeft (⋯ menu)             → physical LEFT  ✓ */}

        {/* ימין: › + שם + "+" */}
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.headerIconBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Ionicons name="chevron-forward" size={22} color="#374151" />
          </TouchableOpacity>
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerTitle} numberOfLines={2}>
              {community.name}
            </Text>
            <Text style={styles.headerSubtitle}>{memberLabel}</Text>
            {showDescription ? (
              <View style={styles.headerDescriptionWrap}>
                <Text
                  style={[
                    styles.headerDescription,
                    styles.headerDescriptionMeasurer,
                  ]}
                  onTextLayout={(e) => {
                    const n = e.nativeEvent.lines.length;
                    setDescriptionCanExpand(n > 1);
                  }}
                >
                  {descriptionTrimmed}
                </Text>
                <View style={styles.headerDescriptionRow}>
                  <Text
                    style={[
                      styles.headerDescription,
                      descriptionCanExpand &&
                        styles.headerDescriptionWithToggle,
                    ]}
                    numberOfLines={descriptionExpanded ? 4 : 1}
                  >
                    {descriptionTrimmed}
                  </Text>
                  {descriptionCanExpand ? (
                    <TouchableOpacity
                      onPress={() => setDescriptionExpanded((s) => !s)}
                      style={styles.headerDescriptionToggleWrap}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={descriptionExpanded ? 'פחות' : 'עוד'}
                    >
                      <Text style={styles.headerDescriptionToggle}>
                        {descriptionExpanded ? 'פחות' : 'עוד'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        </View>

        {/* שמאל: ⋯ בלבד */}
        <View style={styles.headerLeft}>
          <View ref={menuBtnRef}>
            <TouchableOpacity
              onPress={handleMenuPress}
              style={styles.headerIconBtn}
              accessible
              accessibilityRole="button"
              accessibilityLabel="אפשרויות"
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#374151" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsRow}
      >
        {TABS.map((tab) => {
          const active = tab === activeTab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabChip, active && styles.tabChipActive]}
              onPress={() => setActiveTab(tab)}
              accessible
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab}
            >
              <Text
                style={[styles.tabChipText, active && styles.tabChipTextActive]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Tab content */}
      {activeTab === 'ראשי' && (
        <TabMain
          communityId={communityId}
          rsvpMap={rsvpMap}
          onOpenEventDetails={handleOpenEventDetails}
          onSeeMoreEvents={handleSeeMoreEvents}
          onSeeMoreReminders={handleSeeMoreReminders}
          currentUserId={currentUserId}
          onInlineRsvp={handleInlineRsvp}
          previousVisitAt={previousVisitAtRef.current}
          focusedLocalDayStart={focusedLocalDayStart}
        />
      )}
      {activeTab === 'אירועים' && (
        <TabEvents
          communityId={communityId}
          currentUserId={currentUserId}
          filter={eventsFilter}
          myRole={community?.myRole ?? undefined}
          onDuplicateEvent={handleDuplicateEvent}
          onFilterChange={setEventsFilter}
          onOpenEventDetails={handleOpenEventDetails}
          onRsvpPress={setRsvpSheet}
          previousVisitAt={previousVisitAtRef.current}
          rsvpMap={rsvpMap}
          searchQuery={searchQuery}
        />
      )}
      {activeTab === 'תזכורות' && (
        <TabReminders
          communityId={communityId}
          onToggle={handleToggleTaskWithAlert}
          currentUserId={currentUserId}
          myRole={community?.myRole ?? undefined}
          onOpenEventDetails={handleOpenEventDetails}
        />
      )}
      {activeTab === 'פעילות' && (
        <TabActivity
          communityId={communityId}
          onOpenEventDetails={handleOpenEventDetails}
        />
      )}

      {/* ── Modals */}
      <RsvpBottomSheet
        eventId={rsvpSheet}
        currentStatus={rsvpSheet ? (rsvpMap[rsvpSheet] ?? 'none') : 'none'}
        onSelect={handleRsvpSelect}
        onClose={() => setRsvpSheet(null)}
      />

      <OverflowMenu
        visible={menuOpen}
        position={menuPos}
        items={overflowItems}
        onClose={() => setMenuOpen(false)}
      />

      <JoinApprovalSettingsModal
        visible={joinApprovalOpen}
        value={joinApprovalDraft}
        saving={joinApprovalSaving}
        onChange={setJoinApprovalDraft}
        onClose={() => setJoinApprovalOpen(false)}
        onSave={handleSaveJoinApproval}
      />

      {/* FIX 9: Profile association sheet */}
      <ProfileAssociationSheet
        communityId={communityId}
        visible={profileAssociationOpen}
        onClose={() => setProfileAssociationOpen(false)}
      />

      <SearchModal
        visible={searchOpen}
        value={searchQuery}
        onChange={setSearchQuery}
        onClose={() => setSearchOpen(false)}
      />
      <RsvpBlockedByTaskDialog
        assignedTaskCount={blockedRsvpDialog?.count ?? 1}
        onClose={() => setBlockedRsvpDialog(null)}
        onConfirm={() => {
          if (!blockedRsvpDialog) return;
          const eventId = blockedRsvpDialog.eventId;
          setBlockedRsvpDialog(null);
          setRsvpNoAndUnclaimMyEventTasks({ eventId }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן לעדכן אישור הגעה')
          );
        }}
        visible={blockedRsvpDialog !== null}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  safeAreaRtl: {
    direction: 'rtl',
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  // ── Header
  header: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 8,
  },
  headerRight: {
    flex: 1,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  headerTextBlock: { alignItems: rtl.alignStart, flex: 1 },
  headerLeft: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    textAlign: rtl.textAlign,
  },
  headerDescriptionWrap: { marginTop: 6, width: '100%' },
  headerDescriptionRow: {
    alignItems: rtl.alignStart,
  },
  headerDescription: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: rtl.textAlign,
    lineHeight: 18,
    writingDirection: 'rtl',
  },
  headerDescriptionWithToggle: { width: '100%' },
  headerDescriptionMeasurer: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    maxWidth: '100%',
  },
  headerDescriptionToggleWrap: { marginTop: 2, minHeight: 18 },
  headerDescriptionToggle: {
    fontSize: 12,
    color: '#36a9e2',
    fontWeight: '600',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  // ── Tabs strip
  tabsScroll: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    maxHeight: 50,
  },
  tabsRow: {
    flexGrow: 1,
    flexDirection: rtl.flexDirection,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tabChip: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  tabChipText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  tabChipTextActive: { color: '#fff', fontWeight: '600' },

  // ── Scroll / flex
  tabScroll: { flex: 1 },
  tabFlex: { flex: 1 },
  tabContent: { padding: 16, gap: 20, paddingBottom: 100 },

  // ── Section header
  sectionHeader: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  sectionRight: {
    flex: 1,
    alignItems: needsExplicitRTL() ? 'flex-end' : 'flex-start',
  },
  sectionLeft: {
    alignItems: needsExplicitRTL() ? 'flex-start' : 'flex-end',
    minWidth: 60,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  sectionAction: { fontSize: 13, color: PRIMARY, fontWeight: '600' },

  // ── Stage 2A "ראשי" (Main) tab ──────────────────────────────────────────
  importantNowList: { gap: 8 },
  importantNowRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef2f6',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  importantNowRowEmphasis: {
    backgroundColor: '#eaf6fd',
    borderColor: '#bee7f8',
  },
  importantNowIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eaf6fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importantNowIconWrapEmphasis: { backgroundColor: PRIMARY },
  importantNowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    textAlign: rtl.textAlign,
  },
  mainChipsRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  mainChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mainChipNew: { backgroundColor: '#fee2e2' },
  mainChipTextNew: { fontSize: 11, fontWeight: '700', color: '#dc2626' },
  mainChipToday: { backgroundColor: '#dbeafe' },
  mainChipTextToday: { fontSize: 11, fontWeight: '700', color: '#1d4ed8' },
  mainChipTomorrow: { backgroundColor: '#f1f5f9' },
  mainChipTextTomorrow: { fontSize: 11, fontWeight: '700', color: '#475569' },
  mainCarouselContent: {
    flexDirection: 'row-reverse',
    // Without this, the row's default cross-axis `alignItems: 'stretch'`
    // forces every card in the carousel to match the tallest sibling's
    // height, so a single card with an actionable task CTA (naturally
    // taller than a card without one) would inflate every other compact
    // card in the same row too. `flex-start` lets each card keep its own
    // natural/minHeight instead of being stretched by neighbors —
    // required for "cards without a task CTA remain compact".
    alignItems: 'flex-start',
    gap: 12,
    paddingLeft: 16,
  },
  mainEventCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eef2f6',
    backgroundColor: '#fff',
    padding: 14,
    minHeight: 148,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  mainEventTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f2937',
    textAlign: rtl.textAlign,
    marginBottom: 4,
  },
  mainEventDate: {
    fontSize: 12,
    color: '#4b5563',
    textAlign: rtl.textAlign,
    marginBottom: 2,
  },
  mainEventLocation: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: rtl.textAlign,
    marginBottom: 6,
  },
  mainEventFooter: { marginTop: 'auto', gap: 6 },
  mainEventStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: PRIMARY,
    textAlign: rtl.textAlign,
  },
  // ── FIX 8B FINAL CTA COPY + VISUAL TREATMENT — Community Main task CTA
  // (solid brand-blue button, unmistakably a control — not a pill/text
  // row or outline) ────────────────────────────────────────────────────
  mainEventTaskCta: {
    flexDirection: rtl.flexDirection,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: PRIMARY,
  },
  mainEventTaskCtaPressed: { backgroundColor: '#2a8bbd', opacity: 0.92 },
  mainEventTaskCtaText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    textAlign: rtl.textAlign,
  },
  mainEventTaskPassive: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: rtl.textAlign,
  },
  // ── FIX 8B UX CORRECTION — Community Task Bottom Sheet ──────────────────
  taskSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '78%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    // Base value only — overridden at render time with a safe-area-aware
    // value (see `taskSheetBottomPadding` in CommunityTaskBottomSheet) so
    // Android system navigation never covers the last task row/action.
    paddingBottom: 24,
  },
  taskSheetHeader: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  taskSheetHeaderTextBlock: { flex: 1, minWidth: 0, gap: 2 },
  taskSheetEventTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  taskSheetSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  taskSheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  taskSheetScroll: { flexGrow: 0 },
  taskSheetEmptyText: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    fontSize: 13,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  additionalEventPressable: { flex: 1 },
  additionalEventAddBtn: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PRIMARY,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  additionalEventAddBtnPressed: { opacity: 0.6 },
  additionalEventAddBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
  },
  mainSeeMoreCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eef2f6',
    borderStyle: 'dashed',
    backgroundColor: '#fafbfc',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 148,
  },
  mainSeeMoreText: { fontSize: 13, fontWeight: '600', color: PRIMARY },
  pendingRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef2f6',
    padding: 12,
  },
  pendingRowContent: { flex: 1 },
  pendingRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
    textAlign: rtl.textAlign,
  },
  pendingRowMeta: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  pendingRowCtaWrap: { minWidth: 92 },
  pendingRowCtaBtn: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
  },
  pendingRowCtaText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  pendingInlineRsvpRow: {
    flexDirection: 'row-reverse',
    gap: 6,
    minHeight: 40,
  },
  pendingInlineRsvpBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingInlineRsvpText: { fontSize: 12, fontWeight: '700', color: '#374151' },

  // ── STAGE 3 CORRECTION (Part A) — month/year arrow navigator, reusing
  // calendar.tsx's CalendarMonthNavBar visual language (same chevron
  // buttons/colors) instead of the removed 12-month horizontal strip.
  eventsMonthNavRow: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    paddingVertical: 8,
    alignItems: 'center',
    gap: 4,
  },
  eventsMonthNavCluster: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
  },
  eventsMonthChevronBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  eventsMonthTitleBlock: { minWidth: 140, alignItems: 'center' },
  eventsMonthYearLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'center',
  },
  eventsMonthJumpToCurrentBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  eventsMonthJumpToCurrentBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: PRIMARY,
  },

  // ── Stage 3 "אירועים" tab — list content / section headers
  eventsTabListContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,
    gap: 10,
  },
  eventsTabSectionHeader: { paddingTop: 6, paddingBottom: 2 },
  eventsTabSectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  eventsTabSectionSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },

  // ── Stage 3 "אירועים" tab — compact event card
  eventsTabCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eef2f6',
    backgroundColor: '#fff',
    padding: 14,
  },
  // Part D2A — compact manager-only duplicate icon, positioned so it never
  // overlaps the card's main open-details Pressable (separate touch target,
  // absolute-positioned in the card's top corner).
  eventsTabDuplicateBtn: {
    position: 'absolute',
    top: 8,
    ...position.end(8),
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    zIndex: 1,
  },
  eventsTabCardPressable: { gap: 2 },
  eventsTabCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f2937',
    textAlign: rtl.textAlign,
    marginBottom: 2,
  },
  eventsTabCardMeta: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: rtl.textAlign,
  },
  eventsTabCardFooter: {
    flexDirection: rtl.flexDirection,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  eventsTabRsvpChip: {
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eventsTabRsvpChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  eventsTabRsvpPendingBtn: {
    borderRadius: 999,
    backgroundColor: PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventsTabRsvpPendingBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  eventsTabImportantChip: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0369a1',
  },
  eventsTabTaskSummary: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
  },
  eventsTabTaskSummaryDone: { color: '#16a34a' },

  // ── Events grid
  // direction:'ltr' cancels the inherited direction:'rtl' (from ANDROID_MATCH_IOS_LAYOUT root)
  // so cards always flow physical left→right. Text inside cards is textAlign:'center' — unaffected.
  eventsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    direction: 'ltr',
  },

  flyerCard: {
    minHeight: 272,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  flyerCardBody: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 6,
  },
  flyerPill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  flyerPillText: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  flyerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
    minHeight: 48,
  },
  flyerImportantItemsChip: {
    alignSelf: 'center',
    backgroundColor: '#E6F4FB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BAE6FD',
  },
  flyerImportantItemsSlot: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  flyerImportantItemsChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369a1',
    textAlign: 'center',
  },
  flyerDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 9,
    paddingHorizontal: 4,
    gap: 8,
  },
  flyerDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    maxHeight: 1,
    opacity: 0.75,
  },
  flyerDividerDiamond: {
    fontSize: 12,
    textAlign: 'center',
    includeFontPadding: false,
  },
  flyerDate: {
    fontSize: 13,
    color: '#4b5563',
    textAlign: 'center',
    marginBottom: 4,
  },
  flyerTime: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 6,
  },
  flyerLocation: {
    fontSize: 13,
    color: '#4b5563',
    textAlign: 'center',
    marginBottom: 8,
    width: '100%',
  },
  flyerMeta: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 3,
    width: '100%',
  },
  flyerMetaEmphasis: {
    fontWeight: '700',
  },
  flyerMetaDone: {
    color: '#16a34a',
  },
  flyerMetaLast: {
    marginBottom: 0,
  },
  flyerCtaWrap: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 0,
  },
  flyerCtaBtn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  flyerCtaText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  flyerInlineRsvpRow: {
    minHeight: 44,
    flexDirection: 'row-reverse',
    gap: 8,
  },
  flyerInlineRsvpBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  flyerInlineRsvpText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },

  // ── Event Card (הכל tab — full height redesign)
  eventCard: {
    width: '47%',
    height: 220,
    borderRadius: 20,
    overflow: 'hidden',
  },
  eventCardBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  eventCardBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  eventCardBadgeCancelled: { borderRadius: 999 },
  eventCardBadgeTextCancelled: {
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
  eventCardBottom: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    gap: 3,
  },
  eventCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    textAlign: rtl.textAlign,
  },
  eventCardMeta: {
    fontSize: 10,
    color: '#fff',
    opacity: 0.9,
    textAlign: rtl.textAlign,
  },
  eventCardConfirmed: {
    fontSize: 11,
    fontWeight: '700',
    color: '#86efac',
    textAlign: rtl.textAlign,
    marginTop: 4,
  },
  eventCardTaskSummary: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  eventCardTaskSummaryDone: {
    color: '#86efac',
  },
  cancelledEventsSection: {
    paddingTop: 24,
    gap: 12,
  },
  cancelledEventsTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: rtl.textAlign,
    color: '#111827',
  },
  cancelledEventsSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  // Keep eventBadge for EventRow (אירועים tab) — unchanged
  eventBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  eventBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  // ── Event Row (events tab)
  eventRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  eventRowLeft: { alignItems: 'center', gap: 4, minWidth: 44 },
  eventDot: { width: 8, height: 8, borderRadius: 4 },
  eventRowDate: { fontSize: 11, color: '#9ca3af', textAlign: 'center' },
  eventRowContent: {
    flex: 1,
    alignItems: needsExplicitRTL() ? 'flex-end' : 'flex-start',
    gap: 4,
  },
  eventRowTop: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-start',
    width: '100%',
  },
  eventRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    textAlign: rtl.textAlign,
    flex: 1,
  },
  eventRowLocation: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
  },
  eventRowCancelReason: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  eventRowCancelledBadge: {
    alignSelf: needsExplicitRTL() ? 'flex-end' : 'flex-start',
    backgroundColor: '#fee2e2',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  eventRowCancelledBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  rsvpStatusBadge: {
    alignSelf: needsExplicitRTL() ? 'flex-end' : 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rsvpStatusText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  eventRowTaskSummary: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  eventRowTaskSummaryDone: {
    color: '#16a34a',
  },

  // ── Tasks
  taskList: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  taskSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 16,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  taskTitle: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  taskDue: { fontSize: 11, color: '#9ca3af', minWidth: 36, textAlign: 'left' },

  // ── Month selector
  monthSelector: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  monthArrow: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },

  // ── See more
  seeMoreBtn: { alignSelf: rtl.alignStart, marginTop: 8 },
  seeMoreText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },

  // ── Empty states
  emptySmall: { paddingVertical: 16, alignItems: rtl.alignStart },
  emptySmallText: { fontSize: 13, color: '#9ca3af', textAlign: rtl.textAlign },
  emptyFull: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  pendingGateHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  pendingGateTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  pendingGateMessage: {
    marginTop: 18,
    paddingHorizontal: 24,
    lineHeight: 24,
  },
  emptyText: { fontSize: 16, color: '#6b7280', textAlign: 'center' },
  emptySubText: {
    maxWidth: 300,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 22,
    textAlign: 'center',
  },

  // ── Retry
  retryBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 8,
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── RSVP Bottom Sheet
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
    marginBottom: 12,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
    justifyContent: 'flex-end',
  },
  sheetOptionActive: { backgroundColor: '#f8fafc' },
  sheetOptionText: { fontSize: 17, color: '#374151', textAlign: rtl.textAlign },

  // ── Add Action Sheet
  addSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  addSheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
    justifyContent: 'flex-end',
  },
  addSheetIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSheetLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    textAlign: rtl.textAlign,
  },

  // ── Overflow popover
  popoverBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  popover: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderRadius: 12,
    width: 215,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  popoverBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  popoverLabelBlock: {
    flex: 1,
    gap: 2,
  },
  popoverLabel: {
    fontSize: 15,
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  popoverSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
  },
  popoverDanger: { color: '#ef4444' },

  // ── Stage 4 / manual QA follow-up: event-based "חשוב לזכור" reminder
  // group card — a single card per event with structured per-item rows,
  // an optional per-item manager delete control, and a group-level
  // "הוסף למשימות שלי" footer action.
  eventReminderGroupCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eef2f6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    overflow: 'hidden',
  },
  eventReminderGroupPressable: {
    padding: 14,
    paddingBottom: 8,
  },
  eventReminderGroupHeaderRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
  },
  eventReminderGroupTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1f2937',
    textAlign: rtl.textAlign,
  },
  eventReminderGroupMeta: {
    fontSize: 12.5,
    color: '#6b7280',
    marginTop: 4,
    textAlign: rtl.textAlign,
  },
  eventReminderGroupDivider: {
    height: 1,
    backgroundColor: '#f1f3f5',
    marginVertical: 10,
  },
  eventReminderGroupItemsLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  eventReminderGroupItemsBlock: {
    paddingHorizontal: 14,
  },
  eventReminderGroupItemRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 8,
    minHeight: 32,
  },
  eventReminderGroupItemRowSeparator: {
    borderTopWidth: 1,
    borderTopColor: '#f5f6f8',
  },
  eventReminderGroupItemText: {
    flex: 1,
    fontSize: 13.5,
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  eventReminderGroupItemDeleteBtn: {
    padding: 2,
  },
  eventReminderGroupFooterRow: {
    padding: 14,
    paddingTop: 10,
  },

  // ── Reminder rows (expandable cards)
  reminderRow: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  reminderRowExpanded: {
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  reminderMainRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    gap: 10,
  },
  reminderTextBlock: {
    flex: 1,
    gap: 3,
  },
  reminderEndCol: {
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    paddingTop: 2,
  },
  reminderCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  reminderCheckboxDone: { backgroundColor: PRIMARY },
  reminderTitle: {
    fontSize: 15,
    color: '#111827',
    textAlign: rtl.textAlign,
    fontWeight: '500',
  },
  reminderTitleDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  reminderDescriptionText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: rtl.textAlign,
    lineHeight: 18,
  },
  reminderShortLabel: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  reminderDue: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
  },
  reminderHideBtn: { padding: 2, flexShrink: 0 },
  // ── Expanded section
  reminderExpandedSection: {
    marginTop: 10,
    gap: 8,
  },
  reminderExpandedDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f3f4f6',
    marginBottom: 2,
  },
  reminderExpandedMeta: {
    gap: 4,
  },
  reminderExpandedMetaRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
  },
  reminderExpandedMetaText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: rtl.textAlign,
    flex: 1,
  },
  reminderExpandedActions: {
    flexDirection: rtl.flexDirection,
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  reminderActionBtn: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  reminderActionText: {
    fontSize: 13,
    color: PRIMARY,
    fontWeight: '600',
  },
  // ── Attachment rows inside expanded reminder
  reminderAttachRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  reminderAttachThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    flexShrink: 0,
  },
  reminderAttachIconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  reminderAttachMeta: {
    flex: 1,
    gap: 2,
  },
  reminderAttachName: {
    fontSize: 13,
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  reminderAttachSize: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
  },

  // ── Activity placeholder (Section 4 in הכל tab)
  activityPlaceholder: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  activityCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  activityRow: {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
  },
  activityRowPressed: { backgroundColor: '#f8fafc' },
  activityIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#e8f6fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTextBlock: { flex: 1, gap: 2 },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  activityDescription: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: rtl.textAlign,
    writingDirection: 'rtl',
  },
  activityTime: {
    minWidth: 64,
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'left',
  },
  activityDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#eef2f7',
    marginLeft: 14,
    marginRight: 58,
  },
  activityTimeline: { gap: 14 },
  activityGroup: { gap: 8 },
  activityGroupTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textAlign: rtl.textAlign,
    paddingHorizontal: 2,
  },

  // ── Accordion (כדאי לזכור)
  accordionHeader: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  accordionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  accordionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reminderSummaryBadge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  reminderSummaryText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
  },
  completedGroupTitle: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 8,
    fontWeight: '500',
  },

  // ── Search modal
  searchBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  searchBox: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 16, color: '#111827' },
});
