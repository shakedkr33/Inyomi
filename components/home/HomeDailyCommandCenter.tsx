import { MaterialIcons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Image,
  type ImageErrorEventData,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CommunityEventNameTag } from '@/components/CommunityEventNameTag';
import {
  type AuthorizedHomeEventTask,
  buildEventTasksSummaryLabel,
  type EventTaskAccordionData,
  EventTasksAccordion,
} from '@/components/home/EventTasksAccordion';
import { HomeImportantItemsPreview } from '@/components/home/HomeImportantItemsPreview';
import type { ImportantItem } from '@/components/InlineImportantItemsSection';
import { TaskCheckbox } from '@/components/TaskCheckbox';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { getAvatarInitials } from '@/lib/avatarInitials';
import { SubtaskImagePreviewModal } from '@/lib/components/task/SubtaskImagePreviewModal';
import { SubtaskAttachmentPreview } from '@/lib/components/task/SubtasksSection';
import {
  hasNavigableEventLocation,
  isHomeCompactNavButtonVisible,
} from '@/lib/homeEventNavigation';
import { getTextAlign, rtl } from '@/lib/rtl';
import {
  COMMUNITY_REMINDER_DISMISS_LABEL,
  isCommunityReminderTypeLabel,
} from '@/lib/taskClassification';
import type { Birthday } from '@/lib/types/birthday';
import type { SubTaskAttachment } from '@/lib/types/task';
import { getCountdownLabel } from '@/lib/utils/birthday';
import { colors as tc } from '@/theme/colors';

export type { AuthorizedHomeEventTask, EventTaskAccordionData };

/** Focused read-only subtask preview item for Home screen display. */
export type HomeSubtaskPreviewItem = {
  id: string;
  title: string;
  completed: boolean;
  attachment?: SubTaskAttachment;
};

export type HomeDailyItem = {
  id: string;
  title: string;
  time: string;
  endTime?: string;
  startAt?: number;
  endAt?: number;
  location: string;
  locationUrl?: string;
  remoteUrl?: string;
  type: 'event' | 'task';
  completed: boolean;
  /** Timestamp (ms) when the task was completed — used for "בוצעו היום" grouping. */
  completedAt?: number;
  /** True for all-day events — suppresses elapsed/countdown contextText and progress bar. */
  allDay?: boolean;
  groupName?: string;
  communityId?: string;
  /**
   * User-facing type label override for task-type items (e.g. 'תזכורת קהילה'
   * for general community reminders). Undefined falls back to the default
   * 'משימה' label used for ordinary personal tasks.
   */
  taskTypeLabel?: string;
  linkedEventId?: string;
  pending?: boolean;
  rsvpStatus?: 'none' | 'yes' | 'no' | 'maybe';
  pendingPersonalInvite?: boolean;
  myPersonalRsvpStatus?: 'yes' | 'maybe' | 'no' | 'none';
  assigneeDisplays?: { initials: string; color: string }[];
  profileCircles?: unknown[];
  myAssignedTasks?: { id: string; title: string; completed: boolean }[];
  /** Read-only subtask preview items — populated only for task-type items. */
  subtasks?: HomeSubtaskPreviewItem[];
  /** "חשוב לזכור" items for community events — drives the per-user accordion. */
  importantItems?: ImportantItem[];
  /** Authorized event tasks for the community-event task accordion. */
  authorizedEventTasks?: EventTaskAccordionData;
};

export type HomeDailyTask = {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: number;
  hasTime?: boolean;
  dueAt?: number;
  /** Timestamp (ms) when the task was completed — used for "בוצעו היום" grouping. */
  completedAt?: number;
  assigneeDisplays?: { initials: string; color: string }[];
  /** Read-only subtask preview items for compact summary display on Home. */
  subtasks?: HomeSubtaskPreviewItem[];
  /**
   * User-facing type label override (e.g. 'תזכורת קהילה' for general
   * community reminders) — same semantics as `HomeDailyItem.taskTypeLabel`.
   * Carried by BOTH timed and date-only/untimed community reminders (see
   * BUG 2 fix): classification is a property of the item, not of whether it
   * has a specific time.
   */
  taskTypeLabel?: string;
  /** Real community name — only set for general community reminders. */
  groupName?: string;
  /** Community id — only set for general community reminders. */
  communityId?: string;
};

// ─── Temporal state ───────────────────────────────────────────────────────────

type TemporalState = 'active' | 'ended' | 'upcoming' | 'overdue' | 'completed';
type DisplayMode = 'featured' | 'compact';

interface UnifiedTimelineCardProps {
  item: HomeDailyItem;
  temporalState: TemporalState;
  displayMode: DisplayMode;
  /** Badge label override for non-today featured items. */
  featuredBadgeLabel?: string;
  nowMs: number;
  onOpen: () => void;
  onNavigate?: () => void;
  onToggleComplete?: () => void;
  onOpenRemoteUrl?: () => void;
  /** Called when the user taps כן/אולי/לא on the card's inline RSVP row. */
  onRsvp?: (item: HomeDailyItem, status: 'yes' | 'maybe' | 'no') => void;
  /** Whether the task items accordion is currently expanded for this card. */
  itemsExpanded?: boolean;
  /** Toggle the task items accordion for this card — must not trigger onOpen. */
  onToggleItems?: () => void;
  /** Called when the user taps an item checkbox — receives the subtask id. */
  onToggleSubtask?: (subtaskId: string) => void;
  /** Called when the user taps an item thumbnail — receives the resolved URI. */
  onImagePress?: (uri: string) => void;
  /** "חשוב לזכור" items for community events. */
  importantItems?: ImportantItem[];
  /**
   * True when the current user already added this event's important items
   * to their personal tasks (from api.tasks.getMyImportantItemsBundleStatus
   * — the same batched source of truth Event Details and the community
   * "תזכורות" tab use).
   */
  importantItemsAlreadyAdded?: boolean;
  /** Authorized event tasks accordion data. */
  eventTasksData?: EventTaskAccordionData;
  /** Whether the event-tasks accordion is currently expanded. */
  eventTasksExpanded?: boolean;
  /** Toggle the event-tasks accordion — must not trigger onOpen. */
  onToggleEventTasks?: () => void;
  /** Toggle completion of an event task by its ID. */
  onToggleEventTaskCompleted?: (taskId: string) => void;
  /** Called when user taps "אני אקח" on an eligible unassigned event task. */
  onClaimEventTask?: (taskId: string) => void;
  /** Called when user taps "ביטול הקצאה" on their own incomplete event task. */
  onUnclaimEventTask?: (taskId: string) => void;
  /**
   * Called when the viewer taps the personal-dismiss "X" on a general
   * community reminder. Absent/no-op for every other item type — see
   * `isCommunityReminderTypeLabel` below for the eligibility check.
   */
  onDismissCommunityReminder?: (taskId: string) => void;
  /** Task ids currently awaiting a pending dismiss mutation response. */
  dismissingReminderIds?: Set<string>;
}

type HomeDailyCommandCenterProps = {
  selectedDate: Date;
  nowMs: number;
  scheduledItems: HomeDailyItem[];
  allDayItems: HomeDailyItem[];
  overdueTasks: HomeDailyTask[];
  /** Untimed tasks for the selected day (complete + incomplete). */
  untimedTasks: HomeDailyTask[];
  undatedTaskCount: number;
  /** All undated tasks — complete and incomplete. Collapsed section filters to incomplete. */
  undatedTasks: HomeDailyTask[];
  /**
   * Single authoritative source for "בוצעו היום": every task the user completed
   * today across all categories (timed, dated-untimed, overdue, undated).
   * Derived in index.tsx from convexTasks + convexUndatedTasks using nowMs
   * boundaries so it reacts to the existing clock rollover.
   */
  completedTodayTasksAllSources: HomeDailyTask[];
  birthdays: Birthday[];
  hasAnyBirthdays: boolean;
  onOpenItem: (item: HomeDailyItem) => void;
  onOpenTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onNavigate: (location: string, locationUrl?: string) => void;
  onOpenRemoteUrl: (url: string) => void;
  onRsvp: (item: HomeDailyItem, status: 'yes' | 'maybe' | 'no') => void;
  onOpenTasks: () => void;
  onOpenBirthday: (birthday: Birthday) => void;
  onOpenBirthdays: () => void;
  onAddBirthday: () => void;
  /**
   * Single batched "already added to my tasks" map: eventId → true —
   * from api.tasks.getMyImportantItemsBundleStatus. Shared source of truth
   * with Event Details and the community "תזכורות" tab.
   */
  myImportantItemsBundleStatus: Record<string, boolean>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isSameCalendarDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const formatTimeRange = (item: HomeDailyItem): string =>
  item.endTime ? `${item.time}–${item.endTime}` : item.time;

const formatElapsed = (startAt: number, nowMs: number): string => {
  const minutes = Math.max(1, Math.floor((nowMs - startAt) / 60_000));
  if (minutes < 60) {
    return minutes === 1 ? 'התחיל לפני דקה' : `התחיל לפני ${minutes} דקות`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'התחיל לפני שעה';
  if (hours === 2) return 'התחיל לפני שעתיים';
  return `התחיל לפני ${hours} שעות`;
};

const formatUntilStart = (startAt: number, nowMs: number): string | null => {
  const minutes = Math.ceil((startAt - nowMs) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) {
    return minutes === 1 ? 'מתחיל בעוד דקה' : `מתחיל בעוד ${minutes} דקות`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    if (hours === 1) return 'מתחיל בעוד שעה';
    if (hours === 2) return 'מתחיל בעוד שעתיים';
    return `מתחיל בעוד ${hours} שעות`;
  }
  return null;
};

const formatEnded = (endAt: number, nowMs: number): string => {
  const minutes = Math.max(1, Math.floor((nowMs - endAt) / 60_000));
  if (minutes < 60) {
    return minutes === 1 ? 'הסתיים לפני דקה' : `הסתיים לפני ${minutes} דקות`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'הסתיים לפני שעה';
  if (hours === 2) return 'הסתיים לפני שעתיים';
  return `הסתיים לפני ${hours} שעות`;
};

const isPendingInvitation = (item: HomeDailyItem): boolean =>
  (item.pendingPersonalInvite === true &&
    (item.myPersonalRsvpStatus ?? 'none') === 'none') ||
  (item.pending === true && (item.rsvpStatus ?? 'none') === 'none');

// Formats the original due date/time of an overdue task for display.
// NOTE: dueDate midnight must not use +86_400_000; calendar operations are used
// instead so DST transitions are handled correctly.
// When hasTime===true but dueAt is undefined, only the date label is returned
// (data inconsistency — dueAt is the authoritative time source).
const formatDueLabel = (
  dueDate: number,
  hasTime: boolean,
  dueAt: number | undefined,
  nowMs: number
): string => {
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayStartMs = yesterdayStart.getTime();

  const dueDateDay = new Date(dueDate);
  dueDateDay.setHours(0, 0, 0, 0);
  const dueDateDayMs = dueDateDay.getTime();

  if (dueDateDayMs === yesterdayStartMs) {
    if (!hasTime) return 'אתמול';
    if (dueAt === undefined) return 'אתמול';
    const timeStr = new Date(dueAt).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `אתמול, ${timeStr}`;
  }

  const datePart = new Date(dueDate).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
  });
  if (!hasTime) return datePart;
  if (dueAt === undefined) return datePart;
  const timeStr = new Date(dueAt).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart}, ${timeStr}`;
};

// ─── Interactive task items accordion ────────────────────────────────────────

/**
 * Expandable interactive items accordion for Home task cards.
 * Collapsed: one summary line + chevron. Expanded: every item in stored order.
 * Item checkboxes call the existing Convex toggleSubtaskCompleted mutation.
 * Image thumbnails open SubtaskImagePreviewModal via onImagePress callback.
 * Attachment queries are skipped while collapsed (no thumbnail rendered).
 */
const HomeTaskItemsAccordion = ({
  taskId,
  subtasks,
  expanded,
  onToggle,
  onToggleSubtask,
  onImagePress,
}: {
  taskId: string;
  subtasks: HomeSubtaskPreviewItem[];
  expanded: boolean;
  onToggle: () => void;
  /** Called with the subtask id when the user taps an item checkbox. */
  onToggleSubtask?: (subtaskId: string) => void;
  /** Called with the resolved image URI when the user taps a thumbnail. */
  onImagePress?: (uri: string) => void;
}): React.JSX.Element | null => {
  if (subtasks.length === 0) return null;
  const totalCount = subtasks.length;
  const completedCount = subtasks.reduce(
    (n, s) => n + (s.completed ? 1 : 0),
    0
  );
  const summaryLabel = `${completedCount} מתוך ${totalCount} פריטים הושלמו`;
  return (
    <>
      {/* Summary row — sits directly below task content without a top divider */}
      <Pressable
        accessible={true}
        accessibilityLabel={`${summaryLabel}, ${expanded ? 'סגירת רשימת הפריטים' : 'פתיחת רשימת הפריטים'}`}
        accessibilityRole="button"
        onPress={onToggle}
        style={styles.itemsSummaryRow}
      >
        <Text style={styles.itemsSummaryText}>{summaryLabel}</Text>
        <MaterialIcons
          color={tc.textSecondary}
          name={expanded ? 'expand-less' : 'expand-more'}
          size={20}
        />
      </Pressable>
      {expanded ? (
        <>
          {/* One divider between summary and first item */}
          <View style={styles.itemsAccordionDivider} />
          {subtasks.map((subtask, index) => (
            <View
              key={subtask.id}
              style={[styles.itemRow, index > 0 && styles.itemRowDivider]}
            >
              {/* Interactive checkbox — ~40pt touch target via hitSlop */}
              <Pressable
                accessible={true}
                accessibilityLabel={subtask.title || 'פריט'}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: subtask.completed }}
                hitSlop={11}
                onPress={() => onToggleSubtask?.(subtask.id)}
                style={styles.itemCheckboxTouch}
              >
                <View
                  style={[
                    styles.itemIndicator,
                    subtask.completed && styles.itemIndicatorDone,
                  ]}
                >
                  {subtask.completed ? (
                    <MaterialIcons color="#FFFFFF" name="check" size={10} />
                  ) : null}
                </View>
              </Pressable>
              <Text
                numberOfLines={1}
                style={[
                  styles.itemTitle,
                  subtask.completed && styles.itemTitleDone,
                ]}
              >
                {subtask.title}
              </Text>
              {subtask.attachment ? (
                <View style={styles.itemThumbWrap}>
                  <SubtaskAttachmentPreview
                    attachment={subtask.attachment}
                    onImageThumbnailPress={onImagePress}
                    taskId={taskId as Id<'tasks'>}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const BirthdayAvatar = ({
  birthday,
}: {
  birthday: Birthday;
}): React.JSX.Element => {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = getAvatarInitials(
    birthday.firstName?.trim() || birthday.name
  );
  const showImage = Boolean(birthday.photoUri) && !imageFailed;

  if (showImage) {
    return (
      <Image
        accessibilityLabel={`תמונה של ${birthday.name}`}
        onError={(_event: { nativeEvent: ImageErrorEventData }) =>
          setImageFailed(true)
        }
        source={{ uri: birthday.photoUri ?? '' }}
        style={styles.birthdayAvatar}
      />
    );
  }

  return (
    <View style={[styles.birthdayAvatar, styles.birthdayAvatarFallback]}>
      <Text style={styles.birthdayInitials}>{initials || '–'}</Text>
    </View>
  );
};

const SourceLabel = ({ item }: { item: HomeDailyItem }): React.JSX.Element => {
  // A task-type item that also carries community metadata is a general
  // community reminder — show both the classification label and the
  // community tag (reuses the exact tag already used for community events).
  if (item.type === 'task' && item.communityId && item.groupName) {
    return (
      <View style={styles.sourceLabelRow}>
        <Text style={styles.sourceLabel}>{item.taskTypeLabel ?? 'משימה'}</Text>
        <CommunityEventNameTag name={item.groupName} />
      </View>
    );
  }
  if (item.communityId && item.groupName) {
    return <CommunityEventNameTag name={item.groupName} />;
  }
  if (item.type === 'task') {
    return (
      <Text style={styles.sourceLabel}>{item.taskTypeLabel ?? 'משימה'}</Text>
    );
  }
  if (item.linkedEventId) {
    return <Text style={styles.sourceLabel}>אירוע משותף</Text>;
  }
  return <Text style={styles.sourceLabel}>אירוע אישי</Text>;
};

/**
 * Light secondary "X" action that lets the viewer hide a general community
 * reminder from their own Home/Calendar (see `dismissCommunityReminderForMe`
 * in convex/tasks.ts). Replaces the checkbox for these items — a community
 * reminder is informational community content, never a private task, so it
 * has no completion state (see PART 17 of the personal-dismiss task).
 */
const DismissReminderButton = ({
  disabled,
  onPress,
}: {
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element => (
  <Pressable
    accessible={true}
    accessibilityLabel={COMMUNITY_REMINDER_DISMISS_LABEL}
    accessibilityRole="button"
    disabled={disabled}
    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    onPress={onPress}
    style={styles.dismissReminderButton}
  >
    <MaterialIcons color="#92999C" name="close" size={16} />
  </Pressable>
);

// ─── UnifiedTimelineCard ─────────────────────────────────────────────────────

const UnifiedTimelineCard = ({
  item,
  temporalState,
  displayMode,
  featuredBadgeLabel,
  nowMs,
  onOpen,
  onNavigate,
  onToggleComplete,
  onOpenRemoteUrl,
  onRsvp,
  itemsExpanded,
  onToggleItems,
  onToggleSubtask,
  onImagePress,
  importantItems = [],
  importantItemsAlreadyAdded = false,
  eventTasksData,
  eventTasksExpanded,
  onToggleEventTasks,
  onToggleEventTaskCompleted,
  onClaimEventTask,
  onUnclaimEventTask,
  onDismissCommunityReminder,
  dismissingReminderIds,
}: UnifiedTimelineCardProps): React.JSX.Element => {
  const hasTaskSubtasks =
    item.type === 'task' && (item.subtasks?.length ?? 0) > 0;
  // General community reminders are informational community content, not a
  // private task — they never get the completion checkbox, only the
  // personal-dismiss "X" (see PART 17 of the personal-dismiss task).
  const isCommunityReminderItem =
    item.type === 'task' && isCommunityReminderTypeLabel(item.taskTypeLabel);
  const isDismissingReminder = dismissingReminderIds?.has(item.id) ?? false;
  const handleDismissReminder = (): void =>
    onDismissCommunityReminder?.(item.id);
  const hasEventImportantItems =
    item.type === 'event' && importantItems.length > 0;
  const hasEventTasks =
    item.type === 'event' && (eventTasksData?.tasks.length ?? 0) > 0;
  // Home-only summary: mine/unassigned breakdown built from the already
  // Home-filtered task list (see filterHomeVisibleEventTasks in
  // app/(authenticated)/index.tsx) — replaces the generic "משימות האירוע · X".
  const eventTasksSummaryLabel = hasEventTasks
    ? buildEventTasksSummaryLabel(eventTasksData?.tasks ?? [])
    : undefined;
  const hasNavigation = hasNavigableEventLocation(
    item.location,
    item.locationUrl
  );
  const hasRemoteAction = Boolean(item.remoteUrl);
  const hasPrimaryAction = hasNavigation || hasRemoteAction;

  // Badge config by temporal state
  const badgeConfig = ((): {
    label: string;
    bg: string;
    color: string;
  } | null => {
    switch (temporalState) {
      case 'active':
        return {
          label: 'מתקיים עכשיו',
          bg: tc.primaryLight,
          color: tc.primary,
        };
      case 'upcoming':
        if (displayMode !== 'featured') return null;
        return {
          label: featuredBadgeLabel ?? 'הבא בתור',
          bg: tc.accentLight,
          color: tc.accent,
        };
      case 'ended':
        return { label: 'הסתיים', bg: '#F1F4F5', color: '#767C7E' };
      case 'overdue':
        return { label: 'באיחור', bg: '#FFF8EC', color: tc.warning };
      case 'completed':
        return { label: 'בוצע', bg: '#F1F4F5', color: '#92999C' };
    }
  })();

  // Context text (live time line) — suppressed for all-day events
  const contextText = ((): string | null => {
    if (item.allDay) return null;
    if (temporalState === 'active' && item.startAt !== undefined) {
      return formatElapsed(item.startAt, nowMs);
    }
    if (temporalState === 'upcoming' && item.startAt !== undefined) {
      return formatUntilStart(item.startAt, nowMs);
    }
    if (temporalState === 'ended' && item.endAt !== undefined) {
      return formatEnded(item.endAt, nowMs);
    }
    return null;
  })();

  const isCompleted = temporalState === 'completed';
  const isEnded = temporalState === 'ended';
  const isOverdue = temporalState === 'overdue';

  const currentRsvpStatus = item.myPersonalRsvpStatus ?? item.rsvpStatus;
  // Show the inline כן/אולי/לא row only for unanswered-but-soft-committed events.
  // 'none': item stays in invitations (existing path, not this row).
  // 'maybe': item is on the timeline but needs a nudge — show the row.
  // 'yes': no row; answer is final. 'no': item excluded from timeline entirely.
  // Ended events don't benefit from re-RSVP nudging.
  const showMaybeRsvpRow =
    item.type === 'event' &&
    currentRsvpStatus === 'maybe' &&
    temporalState !== 'ended' &&
    onRsvp !== undefined;

  // ─── FEATURED card ───────────────────────────────────────────────────────────
  if (displayMode === 'featured') {
    const cardBorderStyle = isOverdue ? styles.overdueCardBorder : undefined;

    // Progress bar element — active events only, derived from nowMs timestamps
    let progressElement: React.JSX.Element | null = null;
    if (
      item.type === 'event' &&
      !item.allDay &&
      temporalState === 'active' &&
      item.startAt !== undefined &&
      item.endAt !== undefined &&
      item.endAt > item.startAt
    ) {
      const durationMs = item.endAt - item.startAt;
      const elapsedMs = Math.min(Math.max(nowMs - item.startAt, 0), durationMs);
      const progress = elapsedMs / durationMs;
      progressElement = (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(progress * 100),
          }}
          style={styles.progressTrack}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%` as `${number}%` },
            ]}
          />
        </View>
      );
    }

    return (
      <View style={[styles.expandedCard, cardBorderStyle]}>
        <Pressable
          accessible={true}
          accessibilityLabel={`פתיחת פרטים: ${item.title}`}
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.expandedContent}
        >
          {/* Personal-dismiss "X" — physical top-left corner of the card, on
              its own line, never inline with the title/type-label/community
              tag/time (see BUG 1 of the Home X position QA fix). */}
          {isCommunityReminderItem ? (
            <View style={styles.dismissCornerRow}>
              <DismissReminderButton
                disabled={isDismissingReminder}
                onPress={handleDismissReminder}
              />
            </View>
          ) : null}
          <View style={styles.cardTopRow}>
            <Text style={styles.timeRange}>{formatTimeRange(item)}</Text>
            {badgeConfig ? (
              <View
                style={[styles.statusPill, { backgroundColor: badgeConfig.bg }]}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: badgeConfig.color },
                  ]}
                />
                <Text style={[styles.statusText, { color: badgeConfig.color }]}>
                  {badgeConfig.label}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.sourceRow}>
            <SourceLabel item={item} />
          </View>

          <View style={styles.titleRow}>
            {item.type === 'task' && !isCommunityReminderItem ? (
              <TaskCheckbox
                checked={item.completed}
                onToggle={onToggleComplete ?? (() => {})}
              />
            ) : null}
            <Text
              numberOfLines={3}
              style={[
                styles.expandedTitle,
                isCompleted && styles.completedText,
              ]}
            >
              {item.title}
            </Text>
          </View>

          {item.location ? (
            <View style={styles.metadataRow}>
              <MaterialIcons name="location-on" size={17} color="#767C7E" />
              <Text numberOfLines={2} style={styles.metadataText}>
                {item.location}
              </Text>
            </View>
          ) : null}

          {contextText ? (
            <Text style={styles.contextText}>{contextText}</Text>
          ) : null}

          {progressElement}

          {/* Static assigned-tasks hint — shown only when no full accordion is available */}
          {(item.myAssignedTasks?.length ?? 0) > 0 && !hasEventTasks ? (
            <Text style={styles.assignedTasksText}>
              {item.myAssignedTasks?.length === 1
                ? 'יש לך משימה אחת באירוע'
                : `יש לך ${item.myAssignedTasks?.length} משימות באירוע`}
            </Text>
          ) : null}
        </Pressable>

        {hasTaskSubtasks ? (
          <HomeTaskItemsAccordion
            expanded={itemsExpanded ?? false}
            onToggle={onToggleItems ?? (() => {})}
            onToggleSubtask={onToggleSubtask}
            onImagePress={onImagePress}
            subtasks={item.subtasks ?? []}
            taskId={item.id}
          />
        ) : null}

        {hasEventImportantItems ? (
          <View style={styles.importantItemsWrapper}>
            <HomeImportantItemsPreview
              alreadyAdded={importantItemsAlreadyAdded}
              eventId={String(item.id)}
              items={importantItems}
            />
          </View>
        ) : null}

        {hasEventTasks && eventTasksData ? (
          <EventTasksAccordion
            tasks={eventTasksData.tasks}
            canManageTasks={eventTasksData.canManageTasks}
            tasksVisibleToParticipants={
              eventTasksData.tasksVisibleToParticipants
            }
            expanded={eventTasksExpanded ?? false}
            onToggle={onToggleEventTasks ?? (() => {})}
            onToggleCompleted={onToggleEventTaskCompleted ?? (() => {})}
            eventEndTime={item.endAt}
            onClaimTask={onClaimEventTask}
            onUnclaimTask={onUnclaimEventTask}
            summaryLabel={eventTasksSummaryLabel}
            emphasized
          />
        ) : null}

        {showMaybeRsvpRow ? (
          <View style={styles.rsvpRowFeatured}>
            {(
              [
                ['yes', 'כן'],
                ['maybe', 'אולי'],
                ['no', 'לא'],
              ] as const
            ).map(([status, label]) => (
              <Pressable
                accessibilityLabel={`${label}, ${item.title}`}
                accessibilityRole="button"
                accessible={true}
                key={status}
                onPress={() => onRsvp?.(item, status)}
                style={[
                  styles.rsvpButton,
                  status === currentRsvpStatus && styles.rsvpButtonPrimary,
                ]}
              >
                <Text
                  style={[
                    styles.rsvpButtonText,
                    status === currentRsvpStatus &&
                      styles.rsvpButtonTextPrimary,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {hasPrimaryAction ? (
          <View style={styles.actionRow}>
            <Pressable
              accessible={true}
              accessibilityLabel={hasRemoteAction ? 'הצטרפות לאירוע' : 'ניווט'}
              accessibilityRole="button"
              onPress={hasRemoteAction ? onOpenRemoteUrl : onNavigate}
              style={styles.primaryAction}
            >
              <MaterialIcons
                color="#FFFFFF"
                name={hasRemoteAction ? 'videocam' : 'near-me'}
                size={18}
              />
              <Text style={styles.primaryActionText}>
                {hasRemoteAction ? 'הצטרפות' : 'ניווט'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  // ─── COMPACT card ────────────────────────────────────────────────────────────
  const showCheckbox =
    item.type === 'task' && !isEnded && !isCommunityReminderItem;

  // ── Compact EVENT card content — vertical hierarchy matching featured ─────────
  const compactEventContent: React.JSX.Element | null =
    item.type === 'event' ? (
      <>
        {/* Top row: time range + temporal badge */}
        <View style={styles.cardTopRow}>
          <Text numberOfLines={1} style={styles.timeRange}>
            {formatTimeRange(item)}
          </Text>
          {badgeConfig ? (
            <View
              style={[
                styles.compactStatusPill,
                { backgroundColor: badgeConfig.bg },
              ]}
            >
              <Text
                style={[styles.compactStatusText, { color: badgeConfig.color }]}
              >
                {badgeConfig.label}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Source label */}
        <View style={styles.compactSourceRow}>
          <SourceLabel item={item} />
        </View>

        {/* Event title */}
        <Text
          numberOfLines={2}
          style={[styles.compactEventTitle, isEnded && styles.endedText]}
        >
          {item.title}
        </Text>

        {/* Location */}
        {item.location ? (
          <View style={styles.compactMetaRow}>
            <MaterialIcons name="location-on" size={14} color="#767C7E" />
            <Text numberOfLines={1} style={styles.compactMetaText}>
              {item.location}
            </Text>
          </View>
        ) : null}

        {/* Relative time context */}
        {contextText ? (
          <Text style={styles.compactContextText}>{contextText}</Text>
        ) : null}
      </>
    ) : null;

  // ── Compact TASK card content — preserves checkbox behavior ──────────────────
  const compactTaskContent: React.JSX.Element | null =
    item.type === 'task' ? (
      <>
        {/* Personal-dismiss "X" — physical top-left corner, on its own line,
            never inline with the title/type-label/community tag/time (see
            BUG 1 of the Home X position QA fix). */}
        {isCommunityReminderItem ? (
          <View style={styles.dismissCornerRow}>
            <DismissReminderButton
              disabled={isDismissingReminder}
              onPress={handleDismissReminder}
            />
          </View>
        ) : null}
        {/* Time + badge top row — only when the task has a time value */}
        {item.time ? (
          <View style={styles.cardTopRow}>
            <Text numberOfLines={1} style={styles.timeRange}>
              {formatTimeRange(item)}
            </Text>
            {badgeConfig ? (
              <View
                style={[
                  styles.compactStatusPill,
                  { backgroundColor: badgeConfig.bg },
                ]}
              >
                <Text
                  style={[
                    styles.compactStatusText,
                    { color: badgeConfig.color },
                  ]}
                >
                  {badgeConfig.label}
                </Text>
              </View>
            ) : null}
          </View>
        ) : badgeConfig ? (
          /* No time but has a badge — show badge aligned to card start */
          <View
            style={[
              styles.compactStatusPill,
              styles.compactBadgeSelfStart,
              { backgroundColor: badgeConfig.bg },
            ]}
          >
            <Text
              style={[styles.compactStatusText, { color: badgeConfig.color }]}
            >
              {badgeConfig.label}
            </Text>
          </View>
        ) : null}

        {/* Source label */}
        <View style={styles.compactSourceRow}>
          <SourceLabel item={item} />
        </View>

        {/* Title row — checkbox for incomplete tasks (community reminders
            never show a checkbox; their dismiss "X" is the corner row above). */}
        <View style={styles.compactTaskTitleRow}>
          {showCheckbox ? (
            <TaskCheckbox
              checked={item.completed}
              onToggle={onToggleComplete ?? (() => {})}
            />
          ) : null}
          <Text
            numberOfLines={2}
            style={[
              styles.compactEventTitle,
              isCompleted && styles.completedText,
            ]}
          >
            {item.title}
          </Text>
        </View>

        {/* Context text */}
        {contextText ? (
          <Text style={styles.compactContextText}>{contextText}</Text>
        ) : null}
      </>
    ) : null;

  const compactContent = compactEventContent ?? compactTaskContent;

  // Show compact "ניווט" pill on upcoming/active events with a valid
  // navigation destination — see isHomeCompactNavButtonVisible's doc
  // comment for why 'active' must be included (all-day events are
  // classified 'active' for their whole calendar day). Only applies to
  // compact display — featured events keep the full-width button.
  const showCompactNavButton = isHomeCompactNavButtonVisible({
    itemType: item.type,
    temporalState,
    location: item.location,
    locationUrl: item.locationUrl,
  });

  if (showMaybeRsvpRow) {
    return (
      <View
        style={[
          styles.compactCardShell,
          isEnded && styles.endedCompactCard,
          isOverdue && styles.overdueCompactCard,
          isCompleted && styles.completedCompactCard,
        ]}
      >
        <Pressable
          accessible={true}
          accessibilityLabel={`פתיחת ${item.title}`}
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.compactCardPadding}
        >
          {compactContent}
        </Pressable>
        {hasTaskSubtasks ? (
          <HomeTaskItemsAccordion
            expanded={itemsExpanded ?? false}
            onToggle={onToggleItems ?? (() => {})}
            onToggleSubtask={onToggleSubtask}
            onImagePress={onImagePress}
            subtasks={item.subtasks ?? []}
            taskId={item.id}
          />
        ) : null}
        {hasEventImportantItems ? (
          <View style={styles.importantItemsWrapper}>
            <HomeImportantItemsPreview
              alreadyAdded={importantItemsAlreadyAdded}
              eventId={String(item.id)}
              items={importantItems}
            />
          </View>
        ) : null}
        {hasEventTasks && eventTasksData ? (
          <EventTasksAccordion
            tasks={eventTasksData.tasks}
            canManageTasks={eventTasksData.canManageTasks}
            tasksVisibleToParticipants={
              eventTasksData.tasksVisibleToParticipants
            }
            expanded={eventTasksExpanded ?? false}
            onToggle={onToggleEventTasks ?? (() => {})}
            onToggleCompleted={onToggleEventTaskCompleted ?? (() => {})}
            eventEndTime={item.endAt}
            onClaimTask={onClaimEventTask}
            onUnclaimTask={onUnclaimEventTask}
            summaryLabel={eventTasksSummaryLabel}
            emphasized
          />
        ) : null}
        <View style={styles.rsvpRowCardSection}>
          {(
            [
              ['yes', 'כן'],
              ['maybe', 'אולי'],
              ['no', 'לא'],
            ] as const
          ).map(([status, label]) => (
            <Pressable
              accessibilityLabel={`${label}, ${item.title}`}
              accessibilityRole="button"
              accessible={true}
              key={status}
              onPress={() => onRsvp?.(item, status)}
              style={[
                styles.rsvpButton,
                status === currentRsvpStatus && styles.rsvpButtonPrimary,
              ]}
            >
              <Text
                style={[
                  styles.rsvpButtonText,
                  status === currentRsvpStatus && styles.rsvpButtonTextPrimary,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  if (showCompactNavButton) {
    return (
      <View
        style={[
          styles.compactCardShell,
          isEnded && styles.endedCompactCard,
          isOverdue && styles.overdueCompactCard,
          isCompleted && styles.completedCompactCard,
        ]}
      >
        <Pressable
          accessible={true}
          accessibilityLabel={`פתיחת ${item.title}`}
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.compactCardPadding}
        >
          {compactContent}
        </Pressable>
        {hasTaskSubtasks ? (
          <HomeTaskItemsAccordion
            expanded={itemsExpanded ?? false}
            onToggle={onToggleItems ?? (() => {})}
            onToggleSubtask={onToggleSubtask}
            onImagePress={onImagePress}
            subtasks={item.subtasks ?? []}
            taskId={item.id}
          />
        ) : null}
        {hasEventImportantItems ? (
          <View style={styles.importantItemsWrapper}>
            <HomeImportantItemsPreview
              alreadyAdded={importantItemsAlreadyAdded}
              eventId={String(item.id)}
              items={importantItems}
            />
          </View>
        ) : null}
        {hasEventTasks && eventTasksData ? (
          <EventTasksAccordion
            tasks={eventTasksData.tasks}
            canManageTasks={eventTasksData.canManageTasks}
            tasksVisibleToParticipants={
              eventTasksData.tasksVisibleToParticipants
            }
            expanded={eventTasksExpanded ?? false}
            onToggle={onToggleEventTasks ?? (() => {})}
            onToggleCompleted={onToggleEventTaskCompleted ?? (() => {})}
            eventEndTime={item.endAt}
            onClaimTask={onClaimEventTask}
            onUnclaimTask={onUnclaimEventTask}
            summaryLabel={eventTasksSummaryLabel}
            emphasized
          />
        ) : null}
        <View style={styles.compactNavActionRow}>
          <Pressable
            accessible={true}
            accessibilityLabel={`ניווט אל ${item.title}`}
            accessibilityRole="button"
            onPress={onNavigate}
            style={styles.compactNavigateButton}
          >
            <MaterialIcons color={tc.primary} name="near-me" size={17} />
            <Text style={styles.compactNavigateButtonText}>ניווט</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // For tasks with subtask items: restructure so the task checkbox is a sibling
  // of the task-open Pressable — prevents nested-Pressable conflicts.
  // The accordion summary Pressable is also a sibling (rendered inside the accordion).
  if (hasTaskSubtasks) {
    return (
      <View
        style={[
          styles.compactCardShell,
          isEnded && styles.endedCompactCard,
          isOverdue && styles.overdueCompactCard,
          isCompleted && styles.completedCompactCard,
        ]}
      >
        {/* Personal-dismiss "X" — physical top-left corner, on its own line,
            never inline with the title/type-label/community tag/time (see
            BUG 1 of the Home X position QA fix). */}
        {isCommunityReminderItem ? (
          <View style={styles.dismissCornerRow}>
            <DismissReminderButton
              disabled={isDismissingReminder}
              onPress={handleDismissReminder}
            />
          </View>
        ) : null}
        {/* Main task row: checkbox (sibling) + content Pressable */}
        <View style={styles.taskMainRowCompact}>
          {showCheckbox ? (
            <TaskCheckbox
              checked={item.completed}
              onToggle={onToggleComplete ?? (() => {})}
            />
          ) : null}
          <Pressable
            accessible={true}
            accessibilityLabel={`פתיחת ${item.title}`}
            accessibilityRole="button"
            onPress={onOpen}
            style={styles.compactCardOpenContent}
          >
            {/* Time + badge */}
            {item.time ? (
              <View style={styles.cardTopRow}>
                <Text numberOfLines={1} style={styles.timeRange}>
                  {formatTimeRange(item)}
                </Text>
                {badgeConfig ? (
                  <View
                    style={[
                      styles.compactStatusPill,
                      { backgroundColor: badgeConfig.bg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.compactStatusText,
                        { color: badgeConfig.color },
                      ]}
                    >
                      {badgeConfig.label}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : badgeConfig ? (
              <View
                style={[
                  styles.compactStatusPill,
                  styles.compactBadgeSelfStart,
                  { backgroundColor: badgeConfig.bg },
                ]}
              >
                <Text
                  style={[
                    styles.compactStatusText,
                    { color: badgeConfig.color },
                  ]}
                >
                  {badgeConfig.label}
                </Text>
              </View>
            ) : null}
            {/* Source label */}
            <View style={styles.compactSourceRow}>
              <SourceLabel item={item} />
            </View>
            {/* Title (checkbox is outside this Pressable) */}
            <Text
              numberOfLines={2}
              style={[
                styles.compactEventTitle,
                isCompleted && styles.completedText,
              ]}
            >
              {item.title}
            </Text>
            {contextText ? (
              <Text style={styles.compactContextText}>{contextText}</Text>
            ) : null}
          </Pressable>
        </View>
        <HomeTaskItemsAccordion
          expanded={itemsExpanded ?? false}
          onToggle={onToggleItems ?? (() => {})}
          onToggleSubtask={onToggleSubtask}
          onImagePress={onImagePress}
          subtasks={item.subtasks ?? []}
          taskId={item.id}
        />
        {hasEventImportantItems ? (
          <View style={styles.importantItemsWrapper}>
            <HomeImportantItemsPreview
              alreadyAdded={importantItemsAlreadyAdded}
              eventId={String(item.id)}
              items={importantItems}
            />
          </View>
        ) : null}
      </View>
    );
  }

  // Default compact card — event-only path needs a View wrapper when there are important items
  // or event tasks so the accordion Pressables are siblings of (not nested inside) the card Pressable.
  if (hasEventImportantItems || hasEventTasks) {
    return (
      <View
        style={[
          styles.compactCardShell,
          isEnded && styles.endedCompactCard,
          isOverdue && styles.overdueCompactCard,
          isCompleted && styles.completedCompactCard,
        ]}
      >
        <Pressable
          accessible={true}
          accessibilityLabel={`פתיחת ${item.title}`}
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.compactCardPadding}
        >
          {compactContent}
        </Pressable>
        {hasEventImportantItems ? (
          <View style={styles.importantItemsWrapper}>
            <HomeImportantItemsPreview
              alreadyAdded={importantItemsAlreadyAdded}
              eventId={String(item.id)}
              items={importantItems}
            />
          </View>
        ) : null}
        {hasEventTasks && eventTasksData ? (
          <EventTasksAccordion
            tasks={eventTasksData.tasks}
            canManageTasks={eventTasksData.canManageTasks}
            tasksVisibleToParticipants={
              eventTasksData.tasksVisibleToParticipants
            }
            expanded={eventTasksExpanded ?? false}
            onToggle={onToggleEventTasks ?? (() => {})}
            onToggleCompleted={onToggleEventTaskCompleted ?? (() => {})}
            eventEndTime={item.endAt}
            onClaimTask={onClaimEventTask}
            onUnclaimTask={onUnclaimEventTask}
            summaryLabel={eventTasksSummaryLabel}
            emphasized
          />
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      accessible={true}
      accessibilityLabel={`פתיחת ${item.title}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={[
        styles.compactCardShell,
        styles.compactCardPadding,
        isEnded && styles.endedCompactCard,
        isOverdue && styles.overdueCompactCard,
        isCompleted && styles.completedCompactCard,
      ]}
    >
      {compactContent}
    </Pressable>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export function HomeDailyCommandCenter({
  selectedDate,
  nowMs,
  scheduledItems,
  allDayItems,
  overdueTasks,
  untimedTasks,
  undatedTaskCount,
  undatedTasks,
  completedTodayTasksAllSources,
  birthdays,
  hasAnyBirthdays,
  onOpenItem,
  onOpenTask,
  onToggleTask,
  onNavigate,
  onOpenRemoteUrl,
  onRsvp,
  onOpenTasks,
  onOpenBirthday,
  onOpenBirthdays,
  onAddBirthday,
  myImportantItemsBundleStatus,
}: HomeDailyCommandCenterProps): React.JSX.Element {
  const [undatedExpanded, setUndatedExpanded] = useState(false);
  const [endedExpanded, setEndedExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(true);
  // Tracks which task-item accordions are open. Multiple can be open at once.
  // Functional updates ensure no stale state across nowMs-driven re-renders.
  const [expandedItemTaskIds, setExpandedItemTaskIds] = useState<Set<string>>(
    new Set()
  );
  // Tracks which event-task accordions are open (one per event card).
  const [expandedEventTaskIds, setExpandedEventTaskIds] = useState<Set<string>>(
    new Set()
  );

  // ─── Image preview state ──────────────────────────────────────────────────
  const [imagePreviewUri, setImagePreviewUri] = useState<string | null>(null);

  // ─── Subtask toggle mutation ──────────────────────────────────────────────
  const toggleSubtaskMutation = useMutation(api.tasks.toggleSubtaskCompleted);
  // Per-(taskId:subtaskId) in-flight guard — prevents duplicate taps while a
  // request is pending. Does NOT block other items.
  const pendingSubtaskToggles = useRef(new Set<string>());

  // ─── Event task toggle mutation ───────────────────────────────────────────
  const toggleEventTaskMutation = useMutation(api.eventTasks.toggleCompleted);
  const pendingEventTaskToggles = useRef(new Set<string>());

  // ─── Event task claim / unclaim mutations ─────────────────────────────────
  const claimEventTaskMutation = useMutation(api.eventTasks.claimEventTask);
  const unclaimEventTaskMutation = useMutation(api.eventTasks.unclaimEventTask);
  const pendingClaimIds = useRef(new Set<string>());
  const pendingUnclaimIds = useRef(new Set<string>());

  const handleToggleEventTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (pendingEventTaskToggles.current.has(taskId)) return;
      pendingEventTaskToggles.current.add(taskId);
      try {
        await toggleEventTaskMutation({ id: taskId as Id<'eventTasks'> });
      } catch (error) {
        console.error('toggleEventTask error:', error);
      } finally {
        pendingEventTaskToggles.current.delete(taskId);
      }
    },
    [toggleEventTaskMutation]
  );

  const handleClaimEventTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (pendingClaimIds.current.has(taskId)) return;
      pendingClaimIds.current.add(taskId);
      try {
        await claimEventTaskMutation({ id: taskId as Id<'eventTasks'> });
      } catch (error) {
        Alert.alert('שגיאה', 'לא ניתן להשתבץ למשימה כרגע');
        console.error('claimEventTask error:', error);
      } finally {
        pendingClaimIds.current.delete(taskId);
      }
    },
    [claimEventTaskMutation]
  );

  const handleUnclaimEventTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (pendingUnclaimIds.current.has(taskId)) return;
      pendingUnclaimIds.current.add(taskId);
      try {
        await unclaimEventTaskMutation({ id: taskId as Id<'eventTasks'> });
      } catch (error) {
        Alert.alert('שגיאה', 'לא ניתן להסיר הקצאה כרגע');
        console.error('unclaimEventTask error:', error);
      } finally {
        pendingUnclaimIds.current.delete(taskId);
      }
    },
    [unclaimEventTaskMutation]
  );

  // ─── Community reminder personal-dismiss mutation ─────────────────────────
  // Hides a general community reminder from THIS viewer's Home/Calendar only
  // (see convex/tasks.ts `dismissCommunityReminderForMe`). Never writes
  // `completedAt` and never affects Community Main / Community "תזכורות" —
  // the Convex reactive query removes the reminder from Home automatically
  // once the mutation succeeds, no local list mutation needed.
  const dismissCommunityReminderMutation = useMutation(
    api.tasks.dismissCommunityReminderForMe
  );
  const pendingDismissReminderIds = useRef(new Set<string>());
  const [dismissingReminderIds, setDismissingReminderIds] = useState<
    Set<string>
  >(new Set());

  const handleDismissCommunityReminder = useCallback(
    (taskId: string): void => {
      if (pendingDismissReminderIds.current.has(taskId)) return;
      pendingDismissReminderIds.current.add(taskId);
      setDismissingReminderIds((prev) => new Set(prev).add(taskId));
      dismissCommunityReminderMutation({ taskId: taskId as Id<'tasks'> })
        .catch((error) => {
          console.error('dismissCommunityReminderForMe error:', error);
          Alert.alert('שגיאה', 'לא הצלחנו להסתיר את התזכורת. נסו שוב.');
        })
        .finally(() => {
          pendingDismissReminderIds.current.delete(taskId);
          setDismissingReminderIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        });
    },
    [dismissCommunityReminderMutation]
  );

  const handleToggleSubtask = useCallback(
    async (taskId: string, subtaskId: string): Promise<void> => {
      const key = `${taskId}:${subtaskId}`;
      if (pendingSubtaskToggles.current.has(key)) return;
      pendingSubtaskToggles.current.add(key);
      try {
        await toggleSubtaskMutation({
          id: taskId as Id<'tasks'>,
          subtaskId,
        });
      } catch (error) {
        console.error('toggleSubtask error:', error);
      } finally {
        pendingSubtaskToggles.current.delete(key);
      }
    },
    [toggleSubtaskMutation]
  );

  const toggleItemsFor = (taskId: string): void => {
    setExpandedItemTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleEventTasksFor = (eventId: string): void => {
    setExpandedEventTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const today = new Date(nowMs);
  const isToday = isSameCalendarDay(selectedDate, today);
  const selectedMidnight = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate()
  ).getTime();
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  const isPast = selectedMidnight < todayMidnight;
  const isFuture = selectedMidnight > todayMidnight;

  // ─── Invitations ─────────────────────────────────────────────────────────
  const invitations = scheduledItems.filter(isPendingInvitation);
  const attentionCount =
    (isToday ? overdueTasks.length : 0) + invitations.length;
  const invitationIds = new Set(invitations.map((item) => item.id));

  // ─── Timeline items (invitations + RSVP 'no' excluded; ended events kept) ─
  const timelineItemsAll = scheduledItems.filter((item) => {
    if (invitationIds.has(item.id)) return false;
    if (item.rsvpStatus === 'no' || item.myPersonalRsvpStatus === 'no')
      return false;
    return true;
  });

  // ─── Today: ended events → "מוקדם יותר" ─────────────────────────────────
  const endedItems: HomeDailyItem[] = isToday
    ? timelineItemsAll.filter(
        (item) =>
          item.type === 'event' &&
          item.endAt !== undefined &&
          item.endAt <= nowMs
      )
    : [];

  // ─── Today: completed tasks → "בוצעו היום" ───────────────────────────────
  // Single source of truth: completedTodayTasksAllSources (from index.tsx) covers
  // timed, dated-untimed, overdue, and undated tasks completed today.
  // Defensive dedup guards against any theoretical duplicates in the source array.
  const taskToItem = (task: HomeDailyTask): HomeDailyItem => ({
    id: task.id,
    title: task.title,
    time: '',
    location: '',
    type: 'task',
    completed: true,
    completedAt: task.completedAt,
    assigneeDisplays: task.assigneeDisplays,
    subtasks: task.subtasks,
  });

  const completedTodayItems: HomeDailyItem[] = (() => {
    if (!isToday) return [];
    const seenIds = new Set<string>();
    return completedTodayTasksAllSources
      .filter((t) => {
        if (seenIds.has(t.id)) return false;
        seenIds.add(t.id);
        return true;
      })
      .map(taskToItem);
  })();

  // ─── Main timeline: active + upcoming + overdue (Today: minus ended + minus completed) ─
  const timelineItems: HomeDailyItem[] = isToday
    ? timelineItemsAll.filter((item) => {
        // exclude ended events
        if (
          item.type === 'event' &&
          item.endAt !== undefined &&
          item.endAt <= nowMs
        )
          return false;
        // exclude completed tasks (they go to "בוצעו היום")
        if (item.type === 'task' && item.completed) return false;
        return true;
      })
    : timelineItemsAll;

  // ─── Active events (Today only) ───────────────────────────────────────────
  const activeItems: HomeDailyItem[] = isToday
    ? timelineItems.filter(
        (item) =>
          item.type === 'event' &&
          item.startAt !== undefined &&
          item.endAt !== undefined &&
          item.startAt <= nowMs &&
          nowMs < item.endAt
      )
    : [];
  const activeIds = new Set(activeItems.map((item) => item.id));

  // ─── Featured item: first upcoming, non-completed, non-overdue ───────────
  const featuredItem =
    isPast || activeItems.length > 0
      ? null
      : (timelineItems.find(
          (item) =>
            !item.completed &&
            (isFuture || item.startAt === undefined || item.startAt > nowMs) &&
            // Defensive: never feature an event whose endAt has already passed.
            // Normally endedItems filtering removes these, but guards against any
            // edge case where endAt is stale or the filter ran with stale nowMs.
            !(
              item.type === 'event' &&
              item.endAt !== undefined &&
              item.endAt <= nowMs
            )
        ) ?? null);
  const featuredItemId = featuredItem?.id;

  // ─── Remaining (non-active, non-featured) items ───────────────────────────
  const remainingItems = timelineItems.filter(
    (item) => item.id !== featuredItemId && !activeIds.has(item.id)
  );

  // ─── Temporal state helper ────────────────────────────────────────────────
  const getTemporalState = (item: HomeDailyItem): TemporalState => {
    if (item.type === 'task') {
      if (item.completed) return 'completed';
      if (item.startAt !== undefined && item.startAt <= nowMs) return 'overdue';
      return 'upcoming';
    }
    if (item.endAt !== undefined && item.endAt <= nowMs) return 'ended';
    if (
      item.startAt !== undefined &&
      item.endAt !== undefined &&
      item.startAt <= nowMs &&
      nowMs < item.endAt
    )
      return 'active';
    return 'upcoming';
  };

  // ─── Misc ─────────────────────────────────────────────────────────────────
  const emptySuffix = isToday ? 'להיום' : isPast ? 'ביום הזה' : 'לתאריך הזה';

  // Untimed tasks for the selected day section (incomplete only on Today)
  const visibleUntimedTasks = isToday
    ? untimedTasks.filter((t) => !t.completed)
    : untimedTasks;

  // Undated tasks — incomplete only (always)
  const visibleUndatedTasks = undatedTasks.filter((t) => !t.completed);

  return (
    <>
      <View style={styles.root}>
        {/* ── Attention section (overdue + invitations) ────────────────────────── */}
        {attentionCount > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              דורש תשומת לב · {attentionCount}
            </Text>
            <View style={styles.attentionCard}>
              {isToday
                ? overdueTasks.map((task, index) => (
                    <View
                      key={task.id}
                      style={
                        index > 0 || invitations.length > 0
                          ? styles.dividedRow
                          : undefined
                      }
                    >
                      <View style={styles.attentionRow}>
                        <TaskCheckbox
                          checked={task.completed}
                          onToggle={() => onToggleTask(task.id)}
                        />
                        <Pressable
                          accessibilityLabel={`פתיחת משימה באיחור: ${task.title}`}
                          accessibilityRole="button"
                          accessible={true}
                          onPress={() => onOpenTask(task.id)}
                          style={styles.attentionBody}
                        >
                          <Text numberOfLines={2} style={styles.attentionTitle}>
                            {task.title}
                          </Text>
                          <Text style={styles.overdueLabel}>ממתינה להשלמה</Text>
                          {task.dueDate !== undefined ? (
                            <Text style={styles.overdueDueLabel}>
                              {formatDueLabel(
                                task.dueDate,
                                task.hasTime ?? false,
                                task.dueAt,
                                nowMs
                              )}
                            </Text>
                          ) : null}
                        </Pressable>
                      </View>
                      {(task.subtasks?.length ?? 0) > 0 ? (
                        <HomeTaskItemsAccordion
                          expanded={expandedItemTaskIds.has(task.id)}
                          onImagePress={setImagePreviewUri}
                          onToggle={() => toggleItemsFor(task.id)}
                          onToggleSubtask={(subtaskId) =>
                            handleToggleSubtask(task.id, subtaskId)
                          }
                          subtasks={task.subtasks ?? []}
                          taskId={task.id}
                        />
                      ) : null}
                    </View>
                  ))
                : null}
              {invitations.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.invitationBlock,
                    (index > 0 || (isToday && overdueTasks.length > 0)) &&
                      styles.dividedRow,
                  ]}
                >
                  <Pressable
                    accessibilityLabel={`פתיחת הזמנה: ${item.title}`}
                    accessibilityRole="button"
                    accessible={true}
                    onPress={() => onOpenItem(item)}
                    style={styles.invitationHeader}
                  >
                    <View style={styles.inviteIcon}>
                      <MaterialIcons
                        color={tc.primary}
                        name="mail-outline"
                        size={20}
                      />
                    </View>
                    <View style={styles.attentionBody}>
                      <Text style={styles.attentionTitle}>
                        הזמנה ממתינה לאישור
                      </Text>
                      <Text numberOfLines={1} style={styles.invitationSubtitle}>
                        {item.title}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.rsvpRow}>
                    {(
                      [
                        ['yes', 'כן'],
                        ['maybe', 'אולי'],
                        ['no', 'לא'],
                      ] as const
                    ).map(([status, label]) => (
                      <Pressable
                        accessibilityLabel={`${label}, ${item.title}`}
                        accessibilityRole="button"
                        accessible={true}
                        key={status}
                        onPress={() => onRsvp(item, status)}
                        style={({ pressed }) => [
                          styles.rsvpButton,
                          status ===
                            (item.myPersonalRsvpStatus ?? item.rsvpStatus) &&
                            styles.rsvpButtonPrimary,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.rsvpButtonText,
                            status ===
                              (item.myPersonalRsvpStatus ?? item.rsvpStatus) &&
                              styles.rsvpButtonTextPrimary,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Schedule section ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {isPast ? 'היום שהיה' : 'הלו״ז שלי'}
          </Text>

          {/* All-day events — rendered as full unified cards */}
          {allDayItems.length > 0 ? (
            <View style={styles.allDayGroup}>
              {allDayItems.map((item) => (
                <UnifiedTimelineCard
                  displayMode="compact"
                  item={item}
                  itemsExpanded={expandedItemTaskIds.has(item.id)}
                  key={item.id}
                  nowMs={nowMs}
                  onImagePress={setImagePreviewUri}
                  onNavigate={() => onNavigate(item.location, item.locationUrl)}
                  onOpen={() => onOpenItem(item)}
                  onOpenRemoteUrl={() => {
                    if (item.remoteUrl) onOpenRemoteUrl(item.remoteUrl);
                  }}
                  onRsvp={onRsvp}
                  onToggleComplete={() => onToggleTask(item.id)}
                  onToggleItems={() => toggleItemsFor(item.id)}
                  onToggleSubtask={(subtaskId) =>
                    handleToggleSubtask(item.id, subtaskId)
                  }
                  temporalState={getTemporalState(item)}
                  importantItems={item.importantItems}
                  importantItemsAlreadyAdded={
                    myImportantItemsBundleStatus[item.id] === true
                  }
                  eventTasksData={item.authorizedEventTasks}
                  eventTasksExpanded={expandedEventTaskIds.has(item.id)}
                  onToggleEventTasks={() => toggleEventTasksFor(item.id)}
                  onToggleEventTaskCompleted={handleToggleEventTask}
                  onClaimEventTask={handleClaimEventTask}
                  onUnclaimEventTask={handleUnclaimEventTask}
                  onDismissCommunityReminder={handleDismissCommunityReminder}
                  dismissingReminderIds={dismissingReminderIds}
                />
              ))}
            </View>
          ) : null}

          {/* ── Today: "מוקדם יותר" (ended events) ─────────────────────────────── */}
          {isToday && endedItems.length > 0 ? (
            <View style={styles.collapsibleSection}>
              <Pressable
                accessible={true}
                accessibilityLabel={`מוקדם יותר, ${endedItems.length} אירועים, ${endedExpanded ? 'לחץ לכיווץ' : 'לחץ להרחבה'}`}
                accessibilityRole="button"
                onPress={() => setEndedExpanded((prev) => !prev)}
                style={styles.collapsibleHeader}
              >
                <Text style={styles.collapsibleHeaderText}>
                  מוקדם יותר · {endedItems.length}
                </Text>
                <MaterialIcons
                  color={tc.textSecondary}
                  name={endedExpanded ? 'expand-less' : 'expand-more'}
                  size={22}
                />
              </Pressable>
              {endedExpanded ? (
                <View style={styles.collapsibleContent}>
                  {endedItems.map((item) => (
                    <UnifiedTimelineCard
                      displayMode="compact"
                      item={item}
                      itemsExpanded={expandedItemTaskIds.has(item.id)}
                      key={item.id}
                      nowMs={nowMs}
                      onImagePress={setImagePreviewUri}
                      onNavigate={() =>
                        onNavigate(item.location, item.locationUrl)
                      }
                      onOpen={() => onOpenItem(item)}
                      onOpenRemoteUrl={() => {
                        if (item.remoteUrl) onOpenRemoteUrl(item.remoteUrl);
                      }}
                      onToggleComplete={() => onToggleTask(item.id)}
                      onToggleItems={() => toggleItemsFor(item.id)}
                      onToggleSubtask={(subtaskId) =>
                        handleToggleSubtask(item.id, subtaskId)
                      }
                      temporalState="ended"
                      importantItems={item.importantItems}
                      importantItemsAlreadyAdded={
                        myImportantItemsBundleStatus[item.id] === true
                      }
                      eventTasksData={item.authorizedEventTasks}
                      eventTasksExpanded={expandedEventTaskIds.has(item.id)}
                      onToggleEventTasks={() => toggleEventTasksFor(item.id)}
                      onToggleEventTaskCompleted={handleToggleEventTask}
                      onClaimEventTask={handleClaimEventTask}
                      onUnclaimEventTask={handleUnclaimEventTask}
                      onDismissCommunityReminder={
                        handleDismissCommunityReminder
                      }
                      dismissingReminderIds={dismissingReminderIds}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ── Active events — all featured ──────────────────────────────────── */}
          {activeItems.map((item) => (
            <UnifiedTimelineCard
              displayMode="featured"
              item={item}
              itemsExpanded={expandedItemTaskIds.has(item.id)}
              key={item.id}
              nowMs={nowMs}
              onImagePress={setImagePreviewUri}
              onNavigate={() => onNavigate(item.location, item.locationUrl)}
              onOpen={() => onOpenItem(item)}
              onOpenRemoteUrl={() => {
                if (item.remoteUrl) onOpenRemoteUrl(item.remoteUrl);
              }}
              onRsvp={onRsvp}
              onToggleComplete={() => onToggleTask(item.id)}
              onToggleItems={() => toggleItemsFor(item.id)}
              onToggleSubtask={(subtaskId) =>
                handleToggleSubtask(item.id, subtaskId)
              }
              temporalState="active"
              importantItems={item.importantItems}
              importantItemsAlreadyAdded={
                myImportantItemsBundleStatus[item.id] === true
              }
              eventTasksData={item.authorizedEventTasks}
              eventTasksExpanded={expandedEventTaskIds.has(item.id)}
              onToggleEventTasks={() => toggleEventTasksFor(item.id)}
              onToggleEventTaskCompleted={handleToggleEventTask}
              onClaimEventTask={handleClaimEventTask}
              onUnclaimEventTask={handleUnclaimEventTask}
              onDismissCommunityReminder={handleDismissCommunityReminder}
              dismissingReminderIds={dismissingReminderIds}
            />
          ))}

          {/* ── Featured (first upcoming) item ───────────────────────────────── */}
          {featuredItem && !isPast ? (
            <UnifiedTimelineCard
              displayMode="featured"
              featuredBadgeLabel={isToday ? 'הבא בתור' : 'הראשון בלו״ז'}
              item={featuredItem}
              itemsExpanded={expandedItemTaskIds.has(featuredItem.id)}
              nowMs={nowMs}
              onImagePress={setImagePreviewUri}
              onNavigate={() =>
                onNavigate(featuredItem.location, featuredItem.locationUrl)
              }
              onOpen={() => onOpenItem(featuredItem)}
              onOpenRemoteUrl={() => {
                if (featuredItem.remoteUrl)
                  onOpenRemoteUrl(featuredItem.remoteUrl);
              }}
              onRsvp={onRsvp}
              onToggleComplete={() => onToggleTask(featuredItem.id)}
              onToggleItems={() => toggleItemsFor(featuredItem.id)}
              onToggleSubtask={(subtaskId) =>
                handleToggleSubtask(featuredItem.id, subtaskId)
              }
              temporalState={getTemporalState(featuredItem)}
              importantItems={featuredItem.importantItems}
              importantItemsAlreadyAdded={
                myImportantItemsBundleStatus[featuredItem.id] === true
              }
              eventTasksData={featuredItem.authorizedEventTasks}
              eventTasksExpanded={expandedEventTaskIds.has(featuredItem.id)}
              onToggleEventTasks={() => toggleEventTasksFor(featuredItem.id)}
              onToggleEventTaskCompleted={handleToggleEventTask}
              onClaimEventTask={handleClaimEventTask}
              onUnclaimEventTask={handleUnclaimEventTask}
              onDismissCommunityReminder={handleDismissCommunityReminder}
              dismissingReminderIds={dismissingReminderIds}
            />
          ) : null}

          {/* ── Remaining items (compact) ─────────────────────────────────────── */}
          {remainingItems.length > 0 ? (
            <View style={styles.compactGroup}>
              {remainingItems.map((item) => {
                const tState = getTemporalState(item);
                return (
                  <UnifiedTimelineCard
                    displayMode="compact"
                    item={item}
                    itemsExpanded={expandedItemTaskIds.has(item.id)}
                    key={item.id}
                    nowMs={nowMs}
                    onImagePress={setImagePreviewUri}
                    onNavigate={() =>
                      onNavigate(item.location, item.locationUrl)
                    }
                    onOpen={() => onOpenItem(item)}
                    onOpenRemoteUrl={() => {
                      if (item.remoteUrl) onOpenRemoteUrl(item.remoteUrl);
                    }}
                    onRsvp={onRsvp}
                    onToggleComplete={() => onToggleTask(item.id)}
                    onToggleItems={() => toggleItemsFor(item.id)}
                    onToggleSubtask={(subtaskId) =>
                      handleToggleSubtask(item.id, subtaskId)
                    }
                    temporalState={tState}
                    importantItems={item.importantItems}
                    importantItemsAlreadyAdded={
                      myImportantItemsBundleStatus[item.id] === true
                    }
                    eventTasksData={item.authorizedEventTasks}
                    eventTasksExpanded={expandedEventTaskIds.has(item.id)}
                    onToggleEventTasks={() => toggleEventTasksFor(item.id)}
                    onToggleEventTaskCompleted={handleToggleEventTask}
                    onClaimEventTask={handleClaimEventTask}
                    onUnclaimEventTask={handleUnclaimEventTask}
                    onDismissCommunityReminder={handleDismissCommunityReminder}
                    dismissingReminderIds={dismissingReminderIds}
                  />
                );
              })}
            </View>
          ) : null}

          {/* Empty state */}
          {allDayItems.length === 0 &&
          activeItems.length === 0 &&
          !featuredItem &&
          remainingItems.length === 0 &&
          endedItems.length === 0 ? (
            <View style={styles.calmEmpty}>
              <MaterialIcons
                color={tc.primary}
                name="event-available"
                size={22}
              />
              <Text style={styles.calmEmptyText}>
                אין עוד דברים מתוזמנים {emptySuffix}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Untimed tasks for selected day ───────────────────────────────────── */}
        {visibleUntimedTasks.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>
                {isToday ? 'משימות להיום' : 'משימות לתאריך הזה'}
              </Text>
              <Pressable
                accessibilityLabel="פתיחת כל המשימות"
                accessibilityRole="button"
                accessible={true}
                onPress={onOpenTasks}
              >
                <Text style={styles.sectionLink}>הכל</Text>
              </Pressable>
            </View>
            <View style={styles.taskList}>
              {visibleUntimedTasks.map((task, index) => {
                const isCommunityReminderTask = isCommunityReminderTypeLabel(
                  task.taskTypeLabel
                );
                return (
                  <View
                    key={task.id}
                    style={index > 0 ? styles.dividedRow : undefined}
                  >
                    <Pressable
                      accessibilityLabel={`פתיחת משימה: ${task.title}`}
                      accessibilityRole="button"
                      accessible={true}
                      onPress={() => onOpenTask(task.id)}
                      style={styles.taskRow}
                    >
                      {!isCommunityReminderTask ? (
                        <TaskCheckbox
                          checked={task.completed}
                          onToggle={() => onToggleTask(task.id)}
                        />
                      ) : null}
                      <View style={styles.taskRowBody}>
                        {/* Personal-dismiss "X" — physical top-left corner of
                            this reminder's own content block, on its own line,
                            never inline with the title/type-label/community
                            tag (see BUG 1 of the Home X position QA fix). */}
                        {isCommunityReminderTask ? (
                          <View style={styles.dismissCornerRow}>
                            <DismissReminderButton
                              disabled={dismissingReminderIds.has(task.id)}
                              onPress={() =>
                                handleDismissCommunityReminder(task.id)
                              }
                            />
                          </View>
                        ) : null}
                        {/* BUG 2 fix: date-only/untimed community reminders must
                            carry the exact same 'תזכורת קהילה' + community-name
                            tags the timed timeline card shows (see SourceLabel
                            above) — classification is a property of the item,
                            never of whether it has a specific time. */}
                        {task.communityId && task.groupName ? (
                          <View
                            style={[styles.sourceLabelRow, { marginBottom: 4 }]}
                          >
                            <Text style={styles.sourceLabel}>
                              {task.taskTypeLabel ?? 'משימה'}
                            </Text>
                            <CommunityEventNameTag name={task.groupName} />
                          </View>
                        ) : null}
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.taskTitle,
                            task.completed && styles.completedText,
                          ]}
                        >
                          {task.title}
                        </Text>
                      </View>
                      <MaterialIcons
                        color="#ADB3B5"
                        name="chevron-left"
                        size={21}
                      />
                    </Pressable>
                    {(task.subtasks?.length ?? 0) > 0 ? (
                      <HomeTaskItemsAccordion
                        expanded={expandedItemTaskIds.has(task.id)}
                        onImagePress={setImagePreviewUri}
                        onToggle={() => toggleItemsFor(task.id)}
                        onToggleSubtask={(subtaskId) =>
                          handleToggleSubtask(task.id, subtaskId)
                        }
                        subtasks={task.subtasks ?? []}
                        taskId={task.id}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ── Today: "בוצעו היום" (completed tasks) ────────────────────────────── */}
        {isToday && completedTodayItems.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.completedAccordion}>
              <Pressable
                accessible={true}
                accessibilityLabel={`בוצעו היום, ${completedTodayItems.length} משימות, ${completedExpanded ? 'לחץ לכיווץ' : 'לחץ להרחבה'}`}
                accessibilityRole="button"
                onPress={() => setCompletedExpanded((prev) => !prev)}
                style={styles.completedAccordionHeader}
              >
                <Text style={styles.collapsibleHeaderText}>
                  בוצעו היום · {completedTodayItems.length}
                </Text>
                <MaterialIcons
                  color={tc.textSecondary}
                  name={completedExpanded ? 'expand-less' : 'expand-more'}
                  size={22}
                />
              </Pressable>
              {completedExpanded ? (
                <View style={styles.completedAccordionContent}>
                  {completedTodayItems.map((item, index) => (
                    <View
                      key={item.id}
                      style={index > 0 ? styles.dividedRow : undefined}
                    >
                      <Pressable
                        accessible={true}
                        accessibilityLabel={`פתיחת משימה: ${item.title}`}
                        accessibilityRole="button"
                        onPress={() => onOpenItem(item)}
                        style={styles.taskRow}
                      >
                        <TaskCheckbox
                          checked={item.completed}
                          onToggle={() => onToggleTask(item.id)}
                        />
                        <View style={styles.taskRowBody}>
                          <Text
                            numberOfLines={2}
                            style={[styles.taskTitle, styles.completedText]}
                          >
                            {item.title}
                          </Text>
                        </View>
                        <MaterialIcons
                          color="#ADB3B5"
                          name="chevron-left"
                          size={21}
                        />
                      </Pressable>
                      {(item.subtasks?.length ?? 0) > 0 ? (
                        <HomeTaskItemsAccordion
                          expanded={expandedItemTaskIds.has(item.id)}
                          onImagePress={setImagePreviewUri}
                          onToggle={() => toggleItemsFor(item.id)}
                          onToggleSubtask={(subtaskId) =>
                            handleToggleSubtask(item.id, subtaskId)
                          }
                          subtasks={item.subtasks ?? []}
                          taskId={item.id}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── Today: undated tasks (incomplete only) ────────────────────────────── */}
        {isToday && undatedTaskCount > 0 ? (
          <View style={styles.section}>
            <View style={styles.undatedAccordion}>
              <Pressable
                accessibilityLabel={`${undatedTaskCount} משימות פתוחות ללא תאריך, ${undatedExpanded ? 'לחץ לכיווץ' : 'לחץ להרחבה'}`}
                accessibilityRole="button"
                accessible={true}
                onPress={() => setUndatedExpanded((prev) => !prev)}
                style={styles.undatedAccordionHeader}
              >
                <Text style={styles.undatedText}>
                  {undatedTaskCount === 1
                    ? 'משימה פתוחה אחת ללא תאריך'
                    : `${undatedTaskCount} משימות פתוחות ללא תאריך`}
                </Text>
                <MaterialIcons
                  color={tc.primary}
                  name={undatedExpanded ? 'expand-less' : 'expand-more'}
                  size={23}
                />
              </Pressable>
              {undatedExpanded ? (
                <View style={styles.undatedAccordionContent}>
                  {visibleUndatedTasks.map((task, index) => (
                    <View
                      key={task.id}
                      style={index > 0 ? styles.dividedRow : undefined}
                    >
                      <Pressable
                        accessibilityLabel={`פתיחת משימה: ${task.title}`}
                        accessibilityRole="button"
                        accessible={true}
                        onPress={() => onOpenTask(task.id)}
                        style={styles.taskRow}
                      >
                        <TaskCheckbox
                          checked={task.completed}
                          onToggle={() => onToggleTask(task.id)}
                        />
                        <View style={styles.taskRowBody}>
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.taskTitle,
                              task.completed && styles.completedText,
                            ]}
                          >
                            {task.title}
                          </Text>
                        </View>
                        <MaterialIcons
                          color="#ADB3B5"
                          name="chevron-left"
                          size={21}
                        />
                      </Pressable>
                      {(task.subtasks?.length ?? 0) > 0 ? (
                        <HomeTaskItemsAccordion
                          expanded={expandedItemTaskIds.has(task.id)}
                          onImagePress={setImagePreviewUri}
                          onToggle={() => toggleItemsFor(task.id)}
                          onToggleSubtask={(subtaskId) =>
                            handleToggleSubtask(task.id, subtaskId)
                          }
                          subtasks={task.subtasks ?? []}
                          taskId={task.id}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── Birthdays ─────────────────────────────────────────────────────────── */}
        {!isPast ? (
          <View style={styles.section}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>ימי הולדת קרובים</Text>
              {hasAnyBirthdays ? (
                <Pressable
                  accessibilityLabel="פתיחת כל ימי ההולדת"
                  accessibilityRole="button"
                  accessible={true}
                  onPress={onOpenBirthdays}
                >
                  <Text style={styles.sectionLink}>הצג הכל</Text>
                </Pressable>
              ) : null}
            </View>
            {birthdays.length > 0 ? (
              <ScrollView
                contentContainerStyle={styles.birthdayRow}
                horizontal={true}
                showsHorizontalScrollIndicator={false}
              >
                {birthdays.map((birthday) => (
                  <Pressable
                    accessibilityLabel={`יום ההולדת של ${birthday.name}`}
                    accessibilityRole="button"
                    accessible={true}
                    key={birthday.id}
                    onPress={() => onOpenBirthday(birthday)}
                    style={styles.birthdayCard}
                  >
                    <BirthdayAvatar
                      birthday={birthday}
                      key={birthday.photoUri ?? 'no-photo'}
                    />
                    <View style={styles.birthdayBody}>
                      <Text numberOfLines={1} style={styles.birthdayName}>
                        {birthday.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.birthdayCountdown}>
                        {getCountdownLabel(birthday)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            ) : hasAnyBirthdays ? (
              <Text style={styles.noBirthdays}>
                אין ימי הולדת ב־30 הימים הקרובים
              </Text>
            ) : (
              <View style={styles.birthdayEmptyState}>
                <Text style={styles.birthdayEmptyText}>
                  עדיין לא הוספת ימי הולדת
                </Text>
                <Pressable
                  accessibilityLabel="הוספת יום הולדת"
                  accessibilityRole="button"
                  accessible={true}
                  onPress={onAddBirthday}
                  style={styles.birthdayAddButton}
                >
                  <Text style={styles.birthdayAddButtonText}>הוספה</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
      </View>

      <SubtaskImagePreviewModal
        uri={imagePreviewUri}
        onClose={() => setImagePreviewUri(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    gap: 22,
  },
  section: {
    gap: 12,
  },
  sectionHeadingRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#2D3335',
    fontSize: 17,
    fontWeight: '700',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  sectionLink: {
    color: tc.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  attentionCard: {
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E9EDEE',
    backgroundColor: '#FFFFFF',
  },
  attentionRow: {
    minHeight: 68,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dividedRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E9EB',
  },
  // ── Task row body — wraps title in list rows ───────────────────────────────
  // justifyContent: 'center' ensures the title text is vertically centred even
  // if the column container grows (e.g. via Yoga cross-axis measurement).
  taskRowBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  // ── HomeTaskItemsAccordion styles ──────────────────────────────────────────
  itemsAccordionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E9EB',
  },
  itemsSummaryRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    minHeight: 44,
  },
  itemsSummaryText: {
    flex: 1,
    fontSize: 13,
    color: '#334E6F',
    fontWeight: '600',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  itemRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    minHeight: 40,
    backgroundColor: 'transparent',
  },
  itemRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E9EB',
  },
  itemCheckboxTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
  },
  itemIndicator: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#ADB3B5',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemIndicatorDone: {
    backgroundColor: '#52B788',
    borderColor: '#52B788',
  },
  itemTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '500',
    color: '#2D3335',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  itemTitleDone: {
    color: '#92999C',
    textDecorationLine: 'line-through',
  },
  itemThumbWrap: {
    flexShrink: 0,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF7FD',
  },
  attentionBody: {
    flex: 1,
    minWidth: 0,
  },
  attentionTitle: {
    color: tc.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  overdueLabel: {
    color: tc.warning,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    textAlign: getTextAlign(),
  },
  overdueDueLabel: {
    color: '#767C7E',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  invitationBlock: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  invitationHeader: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
  },
  invitationSubtitle: {
    color: '#5A6062',
    fontSize: 13,
    marginTop: 2,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  rsvpRow: {
    flexDirection: rtl.flexDirection,
    gap: 8,
  },
  rsvpButton: {
    minHeight: 44,
    flex: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tc.warmGray,
  },
  rsvpButtonPrimary: {
    backgroundColor: tc.primary,
  },
  rsvpButtonText: {
    color: tc.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  rsvpButtonTextPrimary: {
    color: tc.textOnPrimary,
  },
  // ── Inline RSVP row — featured card (between content and actionRow) ─────────
  rsvpRowFeatured: {
    flexDirection: rtl.flexDirection,
    gap: 8,
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  // ── Inline RSVP row — compact card (sits below the pressable content area) ──
  rsvpRowCardSection: {
    flexDirection: rtl.flexDirection,
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  // ── Expanded (featured) card ───────────────────────────────────────────────
  expandedCard: {
    overflow: 'hidden',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#E9EDEE',
    backgroundColor: '#FFFFFF',
    shadowColor: '#22343C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 3,
  },
  overdueCardBorder: {
    borderColor: '#F5DFA0',
  },
  expandedContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  // Shared top row — used by both featured and compact event cards
  cardTopRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusPill: {
    flexShrink: 1,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  timeRange: {
    flexShrink: 0,
    minWidth: 70,
    color: '#334E6F',
    fontSize: 15,
    fontWeight: '700',
    writingDirection: 'ltr',
    textAlign: getTextAlign(),
  },
  sourceRow: {
    alignItems: 'flex-start',
    marginTop: 12,
  },
  sourceLabel: {
    color: tc.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  sourceLabelRow: {
    alignItems: 'center',
    flexDirection: rtl.flexDirection,
    gap: 6,
  },
  titleRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  /**
   * Personal-dismiss "X" corner slot — a dedicated row rendered ABOVE a
   * community reminder's time/type-label/title content (never inline with
   * it), aligned to the PHYSICAL left edge regardless of RTL environment
   * (see BUG 1 of the "Home X position" QA fix). `rtl.alignEnd` is the
   * existing, device-measured helper for exactly this: physical LEFT
   * column cross-axis alignment in both Expo Go and native-RTL builds —
   * never a raw `left`/`right` style, which would only be correct in one
   * of the two environments. Used identically by the featured card, the
   * compact card, and the date-only/untimed list row so there is a single
   * consistent positioning approach, not three separate implementations.
   */
  dismissCornerRow: {
    alignItems: rtl.alignEnd,
    marginBottom: 6,
  },
  /**
   * Personal-dismiss "X" for general community reminders — replaces the
   * checkbox in the exact same slot (see PART 3/6 of the personal-dismiss
   * task). Kept visually light/secondary: small, muted icon, no fill.
   */
  dismissReminderButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedTitle: {
    flex: 1,
    color: '#15191A',
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 28,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  metadataRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 7,
  },
  metadataText: {
    flex: 1,
    color: '#5A6062',
    fontSize: 13,
    lineHeight: 19,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  contextText: {
    color: '#334E6F',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    textAlign: getTextAlign(),
  },
  assignedTasksText: {
    color: tc.primary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 7,
    textAlign: getTextAlign(),
  },
  // ── Active-event progress bar ──────────────────────────────────────────────
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    backgroundColor: tc.primaryLight,
    overflow: 'hidden',
    // RTL: row-reverse so fill starts from the right and progresses left
    flexDirection: rtl.flexDirection,
    marginTop: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: tc.primary,
  },
  actionRow: {
    flexDirection: rtl.flexDirection,
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  primaryAction: {
    minHeight: 48,
    flex: 1,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 24,
    backgroundColor: tc.primary,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  // ── Compact card ───────────────────────────────────────────────────────────
  compactGroup: {
    gap: 8,
  },
  // Card shell — border, background, shadow (no padding so RSVP variant can control it)
  compactCardShell: {
    width: '100%',
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3E8EA',
    overflow: 'hidden',
    shadowColor: '#22343C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  // Row that holds the checkbox sibling + the main-content Pressable
  taskMainRowCompact: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
  },
  // The Pressable that opens the full task — takes remaining width beside checkbox
  compactCardOpenContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  // Inner content padding (applied to Pressable shell or inner Pressable in RSVP variant)
  compactCardPadding: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  endedCompactCard: {
    backgroundColor: '#F8FAFB',
    borderColor: '#E5E7EB',
  },
  overdueCompactCard: {
    backgroundColor: '#FFF8EC',
    borderColor: '#F5DFA0',
  },
  completedCompactCard: {
    backgroundColor: '#F8F9FA',
    borderColor: '#E5E7EB',
  },
  // Status pill for compact cards (no dot, slightly smaller than featured statusPill)
  compactStatusPill: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // Used when a task has no time — aligns badge to the card start (RTL: right)
  compactBadgeSelfStart: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  compactStatusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  // Source label row — shared margin for compact cards
  compactSourceRow: {
    alignItems: 'flex-start',
    marginTop: 8,
  },
  // Event title for compact cards — slightly smaller than featured expandedTitle
  compactEventTitle: {
    color: '#15191A',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
    minWidth: 0,
    flexShrink: 1,
    marginTop: 4,
  },
  // Location row for compact event cards
  compactMetaRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 5,
  },
  compactMetaText: {
    flex: 1,
    color: '#5A6062',
    fontSize: 12,
    lineHeight: 17,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  compactContextText: {
    color: '#767C7E',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    textAlign: getTextAlign(),
  },
  // Title row for compact task cards — reserves space for the checkbox
  compactTaskTitleRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  // ── Compact upcoming-event navigation action ───────────────────────────────
  compactNavActionRow: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  compactNavigateButton: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 13,
    paddingVertical: 7,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: tc.primaryLight,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  compactNavigateButtonText: {
    color: tc.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  // ── Collapsible sections ───────────────────────────────────────────────────
  collapsibleSection: {
    gap: 8,
  },
  collapsibleHeader: {
    minHeight: 48,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  collapsibleHeaderCard: {
    minHeight: 52,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E9EB',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  collapsibleHeaderText: {
    color: '#334E6F',
    fontSize: 14,
    fontWeight: '700',
    textAlign: getTextAlign(),
  },
  collapsibleContent: {
    gap: 8,
  },
  // ── All-day events ─────────────────────────────────────────────────────────
  allDayGroup: {
    gap: 7,
  },
  allDayRow: {
    minHeight: 54,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    borderRadius: 17,
    paddingHorizontal: 14,
    backgroundColor: '#F1F4F5',
  },
  allDayLabel: {
    color: tc.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  allDayTitle: {
    flex: 1,
    color: '#252A2C',
    fontSize: 14,
    fontWeight: '700',
    textAlign: getTextAlign(),
  },
  calmEmpty: {
    minHeight: 62,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 20,
    backgroundColor: '#F1F4F5',
  },
  calmEmptyText: {
    color: '#5A6062',
    fontSize: 13,
    fontWeight: '600',
  },
  // ── Task list ──────────────────────────────────────────────────────────────
  taskList: {
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E9EDEE',
    backgroundColor: '#FFFFFF',
  },
  taskRow: {
    minHeight: 60,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  taskTitle: {
    color: '#252A2C',
    fontSize: 14,
    fontWeight: '600',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  completedText: {
    color: '#92999C',
    textDecorationLine: 'line-through',
  },
  endedText: {
    color: '#92999C',
  },
  // ── Undated tasks row ──────────────────────────────────────────────────────
  undatedRow: {
    minHeight: 58,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E9EB',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  undatedText: {
    color: '#334E6F',
    fontSize: 14,
    fontWeight: '700',
  },
  // ── Undated accordion — unified shell for header + expanded tasks ──────────
  undatedAccordion: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9EDEE',
    borderRadius: 20,
    overflow: 'hidden',
  },
  undatedAccordionHeader: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  undatedAccordionContent: {
    borderTopWidth: 1,
    borderTopColor: '#E5E9EB',
    backgroundColor: '#FFFFFF',
  },
  // ── Completed tasks accordion — unified shell (mirrors undatedAccordion) ───
  completedAccordion: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9EDEE',
    borderRadius: 20,
    overflow: 'hidden',
  },
  completedAccordionHeader: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  completedAccordionContent: {
    borderTopWidth: 1,
    borderTopColor: '#E5E9EB',
    backgroundColor: '#FFFFFF',
  },
  // ── Birthdays ──────────────────────────────────────────────────────────────
  birthdayRow: {
    flexDirection: rtl.flexDirection,
    gap: 10,
    paddingLeft: 4,
  },
  birthdayCard: {
    width: 154,
    minHeight: 66,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E9EDEE',
    padding: 10,
    backgroundColor: '#FFFFFF',
  },
  birthdayAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E5E9EB',
  },
  birthdayAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayInitials: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '800',
  },
  birthdayBody: {
    flex: 1,
    minWidth: 0,
  },
  birthdayName: {
    color: '#252A2C',
    fontSize: 14,
    fontWeight: '800',
    textAlign: getTextAlign(),
  },
  birthdayCountdown: {
    color: tc.primary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
    textAlign: getTextAlign(),
  },
  noBirthdays: {
    color: '#767C7E',
    fontSize: 13,
    textAlign: getTextAlign(),
  },
  birthdayEmptyState: {
    width: '100%',
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 8,
  },
  birthdayEmptyText: {
    color: '#767C7E',
    fontSize: 13,
    textAlign: getTextAlign(),
    flexShrink: 1,
    minWidth: 0,
  },
  birthdayAddButton: {
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: tc.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  birthdayAddButtonText: {
    color: tc.textOnPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
  importantItemsWrapper: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
});
