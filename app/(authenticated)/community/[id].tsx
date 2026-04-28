import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EventDetailsBottomSheet } from '@/components/EventDetailsBottomSheet';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';
const NOW_PLUS_60_DAYS = () => Date.now() + 60 * 24 * 60 * 60 * 1000;

const TABS = ['הכל', 'אירועים', 'תזכורות', 'פעילות'] as const;
type Tab = (typeof TABS)[number];

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
type TaskSummary = { total: number; assigned: number };

interface EventDoc {
  _id: Id<'events'>;
  title: string;
  startTime: number;
  endTime: number;
  allDay?: boolean;
  location?: string;
  description?: string;
  communityId?: Id<'communities'>;
  requiresRsvp?: boolean;
  createdBy?: Id<'users'>;
  status?: 'active' | 'cancelled';
  cancelledAt?: number;
  cancelReason?: string;
}

interface TaskDoc {
  _id: Id<'tasks'>;
  title: string;
  dueDate?: number;
  completed: boolean;
  completedAt?: number;
}

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

function formatEventDateTime(ts: number, allDay?: boolean): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
  if (allDay) return day;
  const time = d.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} • ${time}`;
}

function formatDueDate(ts: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'היום';
  if (diff === 1) return 'מחר';
  if (diff === -1) return 'אתמול';
  return new Date(ts).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
  });
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

// ─── Add Popover Menu ─────────────────────────────────────────────────────────

interface AddPopoverMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  communityId: string;
  onClose: () => void;
}

function AddPopoverMenu({
  visible,
  position,
  communityId,
  onClose,
}: AddPopoverMenuProps) {
  const router = useRouter();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.popoverBackdrop} onPress={onClose} />
      <View style={[styles.popover, { top: position.y, left: position.x }]}>
        <Pressable
          style={[styles.popoverItem, styles.popoverBorder]}
          onPress={() => {
            onClose();
            router.push(
              `/(authenticated)/event/new?communityId=${communityId}` as Parameters<
                typeof router.push
              >[0]
            );
          }}
          accessible
          accessibilityRole="button"
          accessibilityLabel="אירוע חדש"
        >
          <Text style={styles.popoverLabel}>אירוע חדש</Text>
          <Ionicons name="calendar-outline" size={18} color="#374151" />
        </Pressable>
        <Pressable
          style={styles.popoverItem}
          onPress={() => {
            onClose();
            router.push(
              `/(authenticated)/community-reminder/new?communityId=${communityId}` as Parameters<
                typeof router.push
              >[0]
            );
          }}
          accessible
          accessibilityRole="button"
          accessibilityLabel="תזכורת חדשה"
        >
          <Text style={styles.popoverLabel}>תזכורת חדשה</Text>
          <Ionicons name="checkmark-circle-outline" size={18} color="#374151" />
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── EventCard ────────────────────────────────────────────────────────────────

interface EventCardProps {
  event: EventDoc;
  rsvpStatus: RsvpStatus;
  currentUserId?: Id<'users'>;
  isCancelled?: boolean;
  taskSummary?: TaskSummary;
  onOpenDetails: (eventId: Id<'events'>) => void;
}

function EventCard({
  event,
  rsvpStatus,
  currentUserId,
  isCancelled,
  taskSummary,
  onOpenDetails,
}: EventCardProps) {
  const color = getEventColor(event._id);
  const isCreator =
    currentUserId !== undefined && event.createdBy === currentUserId;

  // Badge — when isCancelled: always "בוטל"; else when requiresRsvp and not creator: RSVP badge
  let badgeLabel = '';
  let badgeColor = '';
  if (isCancelled) {
    badgeLabel = 'בוטל';
    badgeColor = '#fee2e2';
  } else if (event.requiresRsvp && !isCreator) {
    if (rsvpStatus === 'yes') {
      badgeLabel = 'נוסף ליומן ✓';
      badgeColor = '#22c55e';
    } else if (rsvpStatus === 'maybe') {
      badgeLabel = 'אולי';
      badgeColor = '#eab308';
    } else {
      badgeLabel = 'ממתין לאישור';
      badgeColor = '#eab308';
    }
  }

  const dateStr = formatEventDateTime(event.startTime, event.allDay);

  return (
    <Pressable
      style={[styles.eventCard, isCancelled && { opacity: 0.6 }]}
      onPress={() => onOpenDetails(event._id)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={event.title}
    >
      {/* Solid color base */}
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: color }]}
      />

      {/* Gradient overlay — transparent top to dark bottom */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.82)']}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Badge — absolute top-right */}
      {badgeLabel !== '' && (
        <View
          style={[
            styles.eventCardBadge,
            { backgroundColor: badgeColor },
            isCancelled && styles.eventCardBadgeCancelled,
          ]}
        >
          <Text
            style={[
              styles.eventCardBadgeText,
              isCancelled && styles.eventCardBadgeTextCancelled,
            ]}
          >
            {badgeLabel}
          </Text>
        </View>
      )}

      {/* Bottom content */}
      <View style={styles.eventCardBottom}>
        <Text style={styles.eventCardTitle} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={styles.eventCardMeta}>{dateStr}</Text>
        {event.location ? (
          <Text style={styles.eventCardMeta} numberOfLines={1}>
            {event.location}
          </Text>
        ) : null}
        {rsvpStatus === 'yes' ? (
          <Text style={styles.eventCardConfirmed}>אישרת הגעה ✓</Text>
        ) : null}
        {taskSummary && taskSummary.total > 0 ? (
          <Text
            style={[
              styles.eventCardTaskSummary,
              taskSummary.assigned === taskSummary.total
                ? styles.eventCardTaskSummaryDone
                : null,
            ]}
          >
            {`${taskSummary.assigned}/${taskSummary.total} הוקצו`}
          </Text>
        ) : null}
      </View>
    </Pressable>
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

  const showRsvpBadge =
    !isCancelled && !past && (event.requiresRsvp || rsvpStatus !== 'none');
  const showCancelledBadge = isCancelled;

  return (
    <Pressable
      style={[
        styles.eventRow,
        past && { opacity: 0.45 },
        isCancelled && { opacity: 0.5 },
      ]}
      onPress={() => onOpenDetails(event._id)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={event.title}
    >
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
      <View style={styles.eventRowContent}>
        <View style={styles.eventRowTop}>
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
          <Text
            style={[
              styles.eventRowTitle,
              past && !isCancelled && { color: '#9ca3af' },
            ]}
            numberOfLines={2}
          >
            {event.title}
          </Text>
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
        {taskSummary && taskSummary.total > 0 ? (
          <Text
            style={[
              styles.eventRowTaskSummary,
              taskSummary.assigned === taskSummary.total
                ? styles.eventRowTaskSummaryDone
                : null,
            ]}
          >
            {`${taskSummary.assigned}/${taskSummary.total} הוקצו`}
          </Text>
        ) : null}
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
      <View style={styles.sectionRight}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Overflow Menu ────────────────────────────────────────────────────────────

interface OverflowItem {
  label: string;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  danger?: boolean;
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
              onClose();
              m.onPress();
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={m.label}
          >
            <Text
              style={[styles.popoverLabel, m.danger && styles.popoverDanger]}
            >
              {m.label}
            </Text>
            <Ionicons
              name={m.iconName}
              size={18}
              color={m.danger ? '#ef4444' : '#374151'}
            />
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

// ─── ReminderRowAll (כדאי לזכור section in הכל tab) ──────────────────────────

interface ReminderRowAllProps {
  task: TaskDoc;
  onToggle: (id: Id<'tasks'>) => void;
  onHide?: (id: string) => void;
}

function ReminderRowAll({ task, onToggle, onHide }: ReminderRowAllProps) {
  return (
    <Pressable
      style={styles.reminderRow}
      onPress={() => onToggle(task._id)}
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={task.title}
      accessibilityState={{ checked: task.completed }}
    >
      {/* Checkbox — square, right side (first element in RTL row) */}
      <View
        style={[
          styles.reminderCheckbox,
          task.completed && styles.reminderCheckboxDone,
        ]}
      >
        {task.completed && <Ionicons name="checkmark" size={13} color="#fff" />}
      </View>

      {/* Title */}
      <Text
        style={[
          styles.reminderTitle,
          task.completed && styles.reminderTitleDone,
        ]}
        numberOfLines={2}
      >
        {task.title}
      </Text>

      {/* Left side: X button (when completed + onHide provided), completedAt date, or dueDate */}
      {task.completed && onHide ? (
        <TouchableOpacity
          onPress={() => onHide(task._id)}
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
        <Text style={styles.reminderDue}>{formatDueDate(task.dueDate)}</Text>
      ) : null}
    </Pressable>
  );
}

// ─── Tab: הכל ────────────────────────────────────────────────────────────────

interface TabAllProps {
  communityId: Id<'communities'>;
  rsvpMap: Record<string, RsvpStatus>;
  onToggleTask: (id: Id<'tasks'>) => void;
  onSeeMoreEvents: () => void;
  onSeeMoreReminders: () => void;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
  // Persisted state lifted to parent so it survives tab switches
  hiddenReminderIds: Set<string>;
  setHiddenReminderIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  localCompletedIds: Set<string>;
  setLocalCompletedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  localTaskCache: Map<string, TaskDoc>;
  setLocalTaskCache: React.Dispatch<React.SetStateAction<Map<string, TaskDoc>>>;
  isRemindersOpen: boolean;
  setIsRemindersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentUserId?: Id<'users'>;
  taskCountsMap: Record<string, TaskSummary>;
}

function TabAll({
  communityId,
  rsvpMap,
  onToggleTask,
  onOpenEventDetails,
  hiddenReminderIds,
  setHiddenReminderIds,
  localCompletedIds,
  setLocalCompletedIds,
  localTaskCache,
  setLocalTaskCache,
  isRemindersOpen,
  setIsRemindersOpen,
  currentUserId,
  taskCountsMap,
}: TabAllProps) {
  // Stable timestamps — computed once on mount, never change
  const windowStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const windowEnd = useMemo(() => NOW_PLUS_60_DAYS(), []);

  // Memoized query args — prevents Convex from seeing new object references each render
  const eventsArgs = useMemo(
    () => ({
      communityId,
      cursor: null as null,
      numItems: 8,
      fromTime: windowStart,
      toTime: windowEnd,
    }),
    [communityId, windowStart, windowEnd]
  );
  const remindersArgs = useMemo(
    () => ({ communityId, cursor: null as null, numItems: 8 }),
    [communityId]
  );

  const eventsPage = useQuery(api.events.listByCommunityPaged, eventsArgs);
  const remindersPage = useQuery(
    api.tasks.listCommunityRemindersPaged,
    remindersArgs
  );

  const events = (eventsPage?.page ?? []) as EventDoc[];
  const reminders = (remindersPage?.page ?? []) as TaskDoc[];

  const isLoadingEvents = eventsPage === undefined;
  const isLoadingReminders = remindersPage === undefined;

  // hiddenReminderIds, localCompletedIds, localTaskCache come from parent props
  // so they survive tab switches

  // Pending move state: items in the 600ms visual transition (open → completed)
  const [pendingMoveIds, setPendingMoveIds] = useState<Set<string>>(new Set());
  const [pendingSnapshots, setPendingSnapshots] = useState<
    Map<string, TaskDoc>
  >(new Map());

  const activeEvents = events.filter((ev) => ev.status !== 'cancelled');

  const recentlyCancelledEvents = events.filter(
    (ev) =>
      ev.status === 'cancelled' &&
      ev.cancelledAt !== undefined &&
      Date.now() - ev.cancelledAt < 24 * 60 * 60 * 1000
  );

  // Section 1: events the user already RSVPed to OR created by current user
  const myEvents = activeEvents.filter(
    (ev) =>
      (rsvpMap[ev._id] ?? 'none') !== 'none' || ev.createdBy === currentUserId
  );

  // Section 3: events the user hasn't responded to AND not created by current user
  const pendingEvents = activeEvents.filter(
    (ev) =>
      (rsvpMap[ev._id] ?? 'none') === 'none' && ev.createdBy !== currentUserId
  );

  // Section 2: merge query results with locally-completed tasks + pending-transition tasks
  const allRemindersForSection = useMemo(() => {
    const queryIds = new Set(reminders.map((t) => t._id as string));
    // Mark locally-completed items still in the query
    const fromQuery = reminders.map((t) =>
      localCompletedIds.has(t._id as string) ? { ...t, completed: true } : t
    );
    // Items that disappeared from the query (backend updated) but are cached locally
    const fromLocalCache = [...localCompletedIds]
      .filter((id) => !queryIds.has(id))
      .flatMap((id) => {
        const cached = localTaskCache.get(id);
        return cached ? [{ ...cached, completed: true }] : [];
      });
    // Items in pending transition that disappeared from query before 600ms elapsed
    const fromPendingCache = [...pendingMoveIds]
      .filter((id) => !queryIds.has(id) && !localCompletedIds.has(id))
      .flatMap((id) => {
        const snap = pendingSnapshots.get(id);
        return snap ? [{ ...snap, completed: false }] : [];
      });
    return [...fromQuery, ...fromLocalCache, ...fromPendingCache];
  }, [
    reminders,
    localCompletedIds,
    localTaskCache,
    pendingMoveIds,
    pendingSnapshots,
  ]);

  const visibleForSection = allRemindersForSection.filter(
    (t) => !hiddenReminderIds.has(t._id as string)
  );
  const openReminderItems = visibleForSection.filter(
    (t) => !t.completed && !pendingMoveIds.has(t._id as string)
  );
  const pendingMoveItems = visibleForSection.filter((t) =>
    pendingMoveIds.has(t._id as string)
  );
  const completedReminderItems = visibleForSection.filter(
    (t) => t.completed && !pendingMoveIds.has(t._id as string)
  );
  const openCount = openReminderItems.length + pendingMoveItems.length;
  const completedCount = completedReminderItems.length;
  const remindersSummaryText =
    completedCount > 0
      ? `${openCount} פתוחות · ${completedCount} הושלמו`
      : `${openCount} פתוחות`;

  const handleToggleInSection = useCallback(
    (id: Id<'tasks'>) => {
      const task = allRemindersForSection.find((t) => t._id === id);
      const isEffectivelyCompleted = task?.completed ?? false;
      const isPending = pendingMoveIds.has(id as string);

      if (!isEffectivelyCompleted && !isPending) {
        // Open → completing: 600ms visual delay before moving to completed group
        const taskSnapshot = task;
        if (taskSnapshot) {
          setPendingSnapshots((prev) =>
            new Map(prev).set(id as string, taskSnapshot)
          );
        }
        setPendingMoveIds((prev) => new Set([...prev, id as string]));
        setTimeout(() => {
          setPendingMoveIds((prev) => {
            const s = new Set(prev);
            s.delete(id as string);
            return s;
          });
          setPendingSnapshots((prev) => {
            const m = new Map(prev);
            m.delete(id as string);
            return m;
          });
          if (taskSnapshot) {
            setLocalCompletedIds((prev) => new Set([...prev, id as string]));
            setLocalTaskCache((prev) =>
              new Map(prev).set(id as string, taskSnapshot)
            );
          }
        }, 600);
      } else if (isEffectivelyCompleted || isPending) {
        // Completed/pending → open
        if (isPending) {
          setPendingMoveIds((prev) => {
            const s = new Set(prev);
            s.delete(id as string);
            return s;
          });
          setPendingSnapshots((prev) => {
            const m = new Map(prev);
            m.delete(id as string);
            return m;
          });
        }
        setLocalCompletedIds((prev) => {
          const s = new Set(prev);
          s.delete(id as string);
          return s;
        });
      }
      onToggleTask(id);
    },
    [
      allRemindersForSection,
      pendingMoveIds,
      onToggleTask,
      setLocalCompletedIds,
      setLocalTaskCache,
    ]
  );

  const handleHideReminder = useCallback(
    (id: string) => {
      setHiddenReminderIds((prev) => new Set([...prev, id]));
      setLocalCompletedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [setHiddenReminderIds, setLocalCompletedIds]
  );

  return (
    <ScrollView
      style={styles.tabScroll}
      contentContainerStyle={styles.tabContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Section 1: האירועים שלי */}
      <View>
        <SectionHeader
          title="האירועים שלי"
          subtitle="אירועים שכבר הצטרפת אליהם או יצרת"
        />
        {isLoadingEvents ? (
          <ActivityIndicator color={PRIMARY} style={{ marginVertical: 16 }} />
        ) : myEvents.length === 0 ? (
          <View style={styles.emptySmall}>
            <Text style={styles.emptySmallText}>
              עדיין לא הצטרפת לאירועים בקהילה זו
            </Text>
          </View>
        ) : (
          <View style={styles.eventsGrid}>
            {myEvents.map((ev) => (
              <EventCard
                key={ev._id}
                event={ev}
                rsvpStatus={rsvpMap[ev._id] ?? 'none'}
                currentUserId={currentUserId}
                taskSummary={taskCountsMap[ev._id]}
                onOpenDetails={onOpenEventDetails}
              />
            ))}
          </View>
        )}
      </View>

      {/* ── Section 2: כדאי לזכור (accordion) */}
      <View>
        {/* Header — always visible */}
        <Pressable
          onPress={() => setIsRemindersOpen((v) => !v)}
          style={styles.accordionHeader}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`כדאי לזכור, ${remindersSummaryText}`}
          accessibilityState={{ expanded: isRemindersOpen }}
        >
          {/* Left: chevron + summary badge */}
          <View style={styles.accordionLeft}>
            <Ionicons
              name={isRemindersOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="#6b7280"
            />
            {!isLoadingReminders && (
              <View style={styles.reminderSummaryBadge}>
                <Text style={styles.reminderSummaryText}>
                  {remindersSummaryText}
                </Text>
              </View>
            )}
          </View>
          {/* Right: title */}
          <Text style={styles.accordionTitle}>כדאי לזכור</Text>
        </Pressable>

        {/* Body — visible only when open */}
        {isRemindersOpen &&
          (isLoadingReminders ? (
            <ActivityIndicator color={PRIMARY} style={{ marginVertical: 16 }} />
          ) : (
            <View style={{ gap: 8, marginTop: 4 }}>
              {/* Group 1: open (not completed) */}
              {openReminderItems.map((t) => (
                <ReminderRowAll
                  key={t._id}
                  task={t}
                  onToggle={handleToggleInSection}
                />
              ))}
              {/* Group 1: pending items (transitioning to completed — visually shown as completed) */}
              {pendingMoveItems.map((t) => (
                <ReminderRowAll
                  key={t._id}
                  task={{ ...t, completed: true }}
                  onToggle={handleToggleInSection}
                />
              ))}
              {/* Group 2: completed */}
              {completedReminderItems.length > 0 && (
                <>
                  <Text style={styles.completedGroupTitle}>הושלמו</Text>
                  {completedReminderItems.map((t) => (
                    <ReminderRowAll
                      key={t._id}
                      task={t}
                      onToggle={handleToggleInSection}
                      onHide={handleHideReminder}
                    />
                  ))}
                </>
              )}
              {/* Empty state */}
              {openReminderItems.length === 0 &&
                pendingMoveItems.length === 0 &&
                completedReminderItems.length === 0 && (
                  <View style={styles.emptySmall}>
                    <Text style={styles.emptySmallText}>
                      אין תזכורות לקהילה זו
                    </Text>
                  </View>
                )}
            </View>
          ))}
      </View>

      {/* ── Section 3: אירועים נוספים */}
      <View>
        <SectionHeader
          title="אירועים נוספים"
          subtitle="אירועים בקהילה שעדיין לא הגבת אליהם"
        />
        {isLoadingEvents ? (
          <ActivityIndicator color={PRIMARY} style={{ marginVertical: 16 }} />
        ) : pendingEvents.length === 0 ? (
          <View style={[styles.emptySmall, { alignItems: 'center', gap: 8 }]}>
            <Ionicons name="calendar-outline" size={36} color="#d1d5db" />
            <Text style={[styles.emptySmallText, { textAlign: 'center' }]}>
              אין אירועים נוספים להצגה
            </Text>
          </View>
        ) : (
          <View style={styles.eventsGrid}>
            {pendingEvents.map((ev) => (
              <EventCard
                key={ev._id}
                event={ev}
                rsvpStatus={rsvpMap[ev._id] ?? 'none'}
                currentUserId={currentUserId}
                taskSummary={taskCountsMap[ev._id]}
                onOpenDetails={onOpenEventDetails}
              />
            ))}
          </View>
        )}
      </View>

      {/* ── Section 4: פעילות בקהילה */}
      <View>
        <SectionHeader title="פעילות בקהילה" />
        <View style={styles.activityPlaceholder}>
          <Ionicons name="pulse-outline" size={36} color="#d1d5db" />
          <Text style={[styles.emptySmallText, { textAlign: 'center' }]}>
            פעילות אחרונה תופיע כאן בקרוב
          </Text>
          {/* TODO: create activityFeed query in convex/communities.ts */}
        </View>
      </View>

      {/* ── Section 5: אירועים שבוטלו (24h window) */}
      {recentlyCancelledEvents.length > 0 ? (
        <View style={styles.cancelledEventsSection}>
          <Text style={styles.cancelledEventsTitle}>אירועים שבוטלו</Text>
          <View style={styles.eventsGrid}>
            {recentlyCancelledEvents.map((ev) => (
              <EventCard
                key={ev._id}
                event={ev}
                rsvpStatus="none"
                currentUserId={currentUserId}
                isCancelled
                onOpenDetails={onOpenEventDetails}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

// ─── Tab: אירועים ─────────────────────────────────────────────────────────────

interface TabEventsProps {
  communityId: Id<'communities'>;
  rsvpMap: Record<string, RsvpStatus>;
  onRsvpPress: (eventId: Id<'events'>) => void;
  onOpenEventDetails: (eventId: Id<'events'>) => void;
  selectedMonth: Date;
  onMonthChange: (d: Date) => void;
  searchQuery: string;
  currentUserId?: Id<'users'>;
  taskCountsMap: Record<string, TaskSummary>;
}

function TabEvents({
  communityId,
  rsvpMap,
  onRsvpPress,
  onOpenEventDetails,
  selectedMonth,
  onMonthChange,
  searchQuery,
  currentUserId,
  taskCountsMap,
}: TabEventsProps) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<EventDoc[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const monthStart = useMemo(
    () =>
      new Date(
        selectedMonth.getFullYear(),
        selectedMonth.getMonth(),
        1
      ).getTime(),
    [selectedMonth]
  );
  const monthEnd = useMemo(
    () =>
      new Date(
        selectedMonth.getFullYear(),
        selectedMonth.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      ).getTime(),
    [selectedMonth]
  );

  const page = useQuery(api.events.listByCommunityPaged, {
    communityId,
    cursor,
    numItems: 20,
    fromTime: monthStart,
    toTime: monthEnd,
  });

  useEffect(() => {
    if (page?.page) {
      setAccumulated((prev) => {
        const ids = new Set(prev.map((e) => e._id));
        const newItems = (page.page as EventDoc[]).filter(
          (e) => !ids.has(e._id)
        );
        return cursor === null
          ? (page.page as EventDoc[])
          : [...prev, ...newItems];
      });
      setLoadingMore(false);
    }
  }, [page, cursor]);

  // Reset when month changes
  useEffect(() => {
    setCursor(null);
    setAccumulated([]);
  }, [monthStart]);

  const gracePeriod = 24 * 60 * 60 * 1000;
  const activeEvents = accumulated.filter((ev) => ev.status !== 'cancelled');
  const cancelledEvents = accumulated.filter(
    (ev) =>
      ev.status === 'cancelled' &&
      ev.cancelledAt !== undefined &&
      Date.now() - ev.cancelledAt < gracePeriod
  );

  const filtered = useMemo(() => {
    let result = activeEvents;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.location ?? '').toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q)
      );
    }
    const now = Date.now();
    return result.sort((a, b) => {
      const aPast = isEventPast(a);
      const bPast = isEventPast(b);
      if (aPast !== bPast) return aPast ? 1 : -1;
      return a.startTime - b.startTime;
    });
  }, [activeEvents, searchQuery]);

  const monthLabel = selectedMonth.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  });

  const renderItem = useCallback(
    ({ item }: { item: EventDoc }) => (
      <EventRow
        event={item}
        rsvpStatus={rsvpMap[item._id] ?? 'none'}
        onRsvpPress={onRsvpPress}
        onOpenDetails={onOpenEventDetails}
        taskSummary={taskCountsMap[item._id]}
      />
    ),
    [rsvpMap, onRsvpPress, onOpenEventDetails, taskCountsMap]
  );

  const keyExtractor = useCallback((item: EventDoc) => item._id, []);

  const handleLoadMore = useCallback(() => {
    if (page?.isDone === false && page.continueCursor && !loadingMore) {
      setLoadingMore(true);
      setCursor(page.continueCursor);
    }
  }, [page, loadingMore]);

  return (
    <View style={styles.tabFlex}>
      {/* Month selector */}
      <View style={styles.monthSelector}>
        <TouchableOpacity
          onPress={() => {
            const d = new Date(selectedMonth);
            d.setMonth(d.getMonth() + 1);
            onMonthChange(d);
          }}
          style={styles.monthArrow}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חודש הבא"
        >
          <Ionicons name="chevron-back" size={20} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity
          onPress={() => {
            const d = new Date(selectedMonth);
            d.setMonth(d.getMonth() - 1);
            onMonthChange(d);
          }}
          style={styles.monthArrow}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חודש קודם"
        >
          <Ionicons name="chevron-forward" size={20} color="#374151" />
        </TouchableOpacity>
      </View>

      {page === undefined ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyFull}>
          <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>אין אירועים בחודש זה</Text>
        </View>
      ) : (
        <FlatList<EventDoc>
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            <View>
              {loadingMore ? (
                <ActivityIndicator
                  color={PRIMARY}
                  style={{ marginVertical: 16 }}
                />
              ) : null}
              {cancelledEvents.length > 0 ? (
                <View style={styles.cancelledEventsSection}>
                  <Text style={styles.cancelledEventsTitle}>
                    אירועים שבוטלו
                  </Text>
                  <Text style={styles.cancelledEventsSubtitle}>
                    אירועים שבוטלו יוסרו מהתצוגה לאחר 24 שעות מרגע ביטולם
                  </Text>
                  {cancelledEvents.map((ev) => (
                    <EventRow
                      key={ev._id}
                      event={ev}
                      rsvpStatus="none"
                      onRsvpPress={() => {}}
                      onOpenDetails={onOpenEventDetails}
                      isCancelled
                      cancelReason={ev.cancelReason}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Tab: תזכורות ─────────────────────────────────────────────────────────────

interface TabRemindersProps {
  communityId: Id<'communities'>;
  onToggle: (id: Id<'tasks'>) => void;
}

function TabReminders({ communityId, onToggle }: TabRemindersProps) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<TaskDoc[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const since30Days = useMemo(() => Date.now() - 30 * 24 * 60 * 60 * 1000, []);

  const page = useQuery(api.tasks.listCommunityRemindersPaged, {
    communityId,
    cursor,
    numItems: 20,
  });

  const completedPage = useQuery(api.tasks.listCompletedCommunityReminders, {
    communityId,
    since: since30Days,
  });

  useEffect(() => {
    if (page?.page) {
      setAccumulated((prev) => {
        const ids = new Set(prev.map((t) => t._id));
        const newItems = (page.page as TaskDoc[]).filter(
          (t) => !ids.has(t._id)
        );
        return cursor === null
          ? (page.page as TaskDoc[])
          : [...prev, ...newItems];
      });
      setLoadingMore(false);
    }
  }, [page, cursor]);

  const handleLoadMore = useCallback(() => {
    if (page?.isDone === false && page.continueCursor && !loadingMore) {
      setLoadingMore(true);
      setCursor(page.continueCursor);
    }
  }, [page, loadingMore]);

  const completedTasks = (completedPage ?? []) as TaskDoc[];
  const historyCount = completedTasks.length;

  if (page === undefined) {
    return (
      <View style={styles.loadingCenter}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.tabScroll}
      contentContainerStyle={{ paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Section 1: תזכורות פתוחות */}
      <View style={{ marginHorizontal: 16, marginTop: 16 }}>
        <SectionHeader title="תזכורות פתוחות" />
        {accumulated.length === 0 ? (
          <View style={[styles.emptySmall, { alignItems: 'center', gap: 8 }]}>
            <Ionicons
              name="checkmark-circle-outline"
              size={36}
              color="#d1d5db"
            />
            <Text style={[styles.emptySmallText, { textAlign: 'center' }]}>
              כל התזכורות טופלו 🎉
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {accumulated.map((t) => (
              <ReminderRowAll key={t._id} task={t} onToggle={onToggle} />
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

      {/* ── Section 2: תזכורות אחרונות (30 days history) */}
      {historyCount > 0 ? (
        <View style={{ marginHorizontal: 16, marginTop: 24 }}>
          <View style={styles.sectionHeader}>
            <TouchableOpacity
              onPress={() => setShowHistory((v) => !v)}
              accessible
              accessibilityRole="button"
              accessibilityLabel={
                showHistory ? 'הסתר היסטוריה' : `הצג היסטוריה ${historyCount}`
              }
            >
              <Text style={styles.sectionAction}>
                {showHistory ? 'הסתר' : `הצג היסטוריה (${historyCount})`}
              </Text>
            </TouchableOpacity>
            <View style={styles.sectionRight}>
              <Text style={styles.sectionTitle}>תזכורות אחרונות</Text>
              <Text style={styles.sectionSubtitle}>
                תזכורות שטופלו נשמרות כאן עד 30 יום
              </Text>
            </View>
          </View>
          {showHistory ? (
            <View style={{ gap: 8 }}>
              {completedTasks.map((t) => (
                <ReminderRowAll key={t._id} task={t} onToggle={onToggle} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

// ─── Tab: פעילות ─────────────────────────────────────────────────────────────

function TabActivity() {
  return (
    <View style={styles.emptyFull}>
      <Ionicons name="pulse-outline" size={48} color="#d1d5db" />
      <Text style={styles.emptyText}>פעילות הקהילה תופיע כאן בקרוב</Text>
      {/* TODO: create activityFeed query in convex/communities.ts */}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommunityDetailScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const communityId = id as Id<'communities'>;

  // ── Queries
  const community = useQuery(api.communities.getCommunity, { communityId });
  const myRsvps = useQuery(api.eventRsvps.listByUser);
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;
  const taskCountsMap =
    useQuery(api.eventTasks.getTaskCountsByCommunity, { communityId }) ?? {};

  // ── Mutations
  const upsertRsvp = useMutation(api.eventRsvps.upsertRsvp);
  const toggleCompleted = useMutation(api.tasks.toggleCompleted);
  const deleteCommunity = useMutation(api.communities.deleteCommunity);
  const toggleNotifications = useMutation(api.communities.toggleNotifications);

  // ── Local state
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (tab && (TABS as readonly string[]).includes(tab)) return tab as Tab;
    return 'הכל';
  });
  const [isRemindersOpen, setIsRemindersOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 8, y: 80 });
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState({ x: 8, y: 80 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [rsvpSheet, setRsvpSheet] = useState<Id<'events'> | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<Id<'events'> | null>(
    null
  );
  const lastDragCloseTime = useRef<number>(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionCanExpand, setDescriptionCanExpand] = useState(false);
  const menuBtnRef = useRef<View>(null);

  // Reset description state when community changes
  useEffect(() => {
    setDescriptionExpanded(false);
    setDescriptionCanExpand(false);
  }, [communityId]);
  const addBtnRef = useRef<View>(null);

  // ── Persisted TabAll state — lifted here so it survives tab switches
  const [hiddenReminderIds, setHiddenReminderIds] = useState<Set<string>>(
    new Set()
  );
  const [localCompletedIds, setLocalCompletedIds] = useState<Set<string>>(
    new Set()
  );
  const [localTaskCache, setLocalTaskCache] = useState<Map<string, TaskDoc>>(
    new Map()
  );

  // ── Back navigation — inner tabs go back to הכל, הכל goes to communities list
  const handleBack = useCallback(() => {
    if (activeTab !== 'הכל') {
      setActiveTab('הכל');
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
  const handleRsvpSelect = useCallback(
    (status: RsvpStatus) => {
      if (!rsvpSheet) return;
      upsertRsvp({ eventId: rsvpSheet, status }).catch(() =>
        Alert.alert('שגיאה', 'לא ניתן לשמור תגובה')
      );
    },
    [rsvpSheet, upsertRsvp]
  );

  const handleOpenEventDetails = useCallback((eventId: Id<'events'>) => {
    if (Date.now() - lastDragCloseTime.current < 600) return;

    setSelectedEventId(eventId);
  }, []);

  const handleCloseEventDetails = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  const handleNavigateToLocation = useCallback((location: string) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('שגיאה', 'לא ניתן לפתוח ניווט כרגע')
    );
  }, []);

  const handleToggleTask = useCallback(
    (taskId: Id<'tasks'>) => {
      toggleCompleted({ id: taskId }).catch(() =>
        Alert.alert('שגיאה', 'לא ניתן לעדכן תזכורת')
      );
      // TODO: add optimistic update
    },
    [toggleCompleted]
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

  const handleToggleNotifications = useCallback(async () => {
    try {
      const result = await toggleNotifications({ communityId });
      const msg = result?.notificationsEnabled
        ? 'מעכשיו תקבל/י התראות על אירועים ושינויים בקהילה'
        : 'ההתראות בוטלו לקהילה זו';
      Alert.alert('התראות', msg, [{ text: 'אישור' }]);
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשנות הגדרות התראות');
    }
  }, [toggleNotifications, communityId]);

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

  // Add popover anchored to exact button position using measureInWindow
  const handleAddPress = useCallback(() => {
    if (!addBtnRef.current) {
      setAddMenuPos({ x: 8, y: 80 });
      setAddMenuOpen(true);
      return;
    }
    addBtnRef.current.measureInWindow((x, y, _w, h) => {
      setAddMenuPos({ x, y: y + h + 4 });
      setAddMenuOpen(true);
    });
  }, []);

  const overflowItems = useMemo<OverflowItem[]>(
    () => [
      {
        label: 'חיפוש אירוע',
        iconName: 'search-outline',
        onPress: () => {
          setActiveTab('אירועים');
          setSearchOpen(true);
        },
      },
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
      {
        label:
          community?.myNotificationsEnabled !== false
            ? 'בטל התראות'
            : 'הפעל התראות',
        iconName:
          community?.myNotificationsEnabled !== false
            ? 'notifications-off-outline'
            : 'notifications-outline',
        onPress: handleToggleNotifications,
      },
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
      handleToggleNotifications,
      handleDeleteCommunity,
      handleShare,
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
          <Text style={styles.emptyText}>הקהילה לא נמצאה</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => router.back()}
            accessible
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const memberLabel = `${community.tags?.[0] ? `${community.tags[0]} • ` : ''}${community.memberCount} חברים`;
  const descriptionTrimmed = community.description?.trim();
  const showDescription = !!descriptionTrimmed;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header */}
      <View style={styles.header}>
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

        {/* ימין: › + שם + "+" */}
        <View style={styles.headerRight}>
          <View ref={addBtnRef}>
            <TouchableOpacity
              onPress={handleAddPress}
              style={[styles.headerIconBtn, styles.headerAddBtn]}
              accessible
              accessibilityRole="button"
              accessibilityLabel="הוסף אירוע או תזכורת"
            >
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
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
                    if (n > 2) setDescriptionCanExpand(true);
                  }}
                >
                  {descriptionTrimmed}
                </Text>
                <Text
                  style={styles.headerDescription}
                  numberOfLines={descriptionExpanded ? undefined : 2}
                >
                  {descriptionTrimmed}
                </Text>
                {descriptionCanExpand ? (
                  <TouchableOpacity
                    onPress={() => setDescriptionExpanded((s) => !s)}
                    style={styles.headerDescriptionToggleWrap}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={
                      descriptionExpanded ? 'הצג פחות' : 'הצג עוד'
                    }
                  >
                    <Text style={styles.headerDescriptionToggle}>
                      {descriptionExpanded ? 'הצג פחות' : 'הצג עוד'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.headerIconBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Ionicons name="chevron-forward" size={22} color="#374151" />
          </TouchableOpacity>
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
      {activeTab === 'הכל' && (
        <TabAll
          communityId={communityId}
          rsvpMap={rsvpMap}
          onToggleTask={handleToggleTask}
          onOpenEventDetails={handleOpenEventDetails}
          onSeeMoreEvents={handleSeeMoreEvents}
          onSeeMoreReminders={handleSeeMoreReminders}
          hiddenReminderIds={hiddenReminderIds}
          setHiddenReminderIds={setHiddenReminderIds}
          localCompletedIds={localCompletedIds}
          setLocalCompletedIds={setLocalCompletedIds}
          localTaskCache={localTaskCache}
          setLocalTaskCache={setLocalTaskCache}
          isRemindersOpen={isRemindersOpen}
          setIsRemindersOpen={setIsRemindersOpen}
          currentUserId={currentUserId}
          taskCountsMap={taskCountsMap}
        />
      )}
      {activeTab === 'אירועים' && (
        <TabEvents
          communityId={communityId}
          rsvpMap={rsvpMap}
          onRsvpPress={setRsvpSheet}
          onOpenEventDetails={handleOpenEventDetails}
          selectedMonth={selectedMonth}
          onMonthChange={setSelectedMonth}
          searchQuery={searchQuery}
          currentUserId={currentUserId}
          taskCountsMap={taskCountsMap}
        />
      )}
      {activeTab === 'תזכורות' && (
        <TabReminders communityId={communityId} onToggle={handleToggleTask} />
      )}
      {activeTab === 'פעילות' && <TabActivity />}

      {/* ── Modals */}
      <AddPopoverMenu
        visible={addMenuOpen}
        position={addMenuPos}
        communityId={communityId}
        onClose={() => setAddMenuOpen(false)}
      />

      <RsvpBottomSheet
        eventId={rsvpSheet}
        currentStatus={rsvpSheet ? (rsvpMap[rsvpSheet] ?? 'none') : 'none'}
        onSelect={handleRsvpSelect}
        onClose={() => setRsvpSheet(null)}
      />

      <EventDetailsBottomSheet
        eventId={selectedEventId}
        visible={selectedEventId !== null}
        onDragClose={() => {
          lastDragCloseTime.current = Date.now();
        }}
        onClose={handleCloseEventDetails}
        onNavigate={handleNavigateToLocation}
      />

      <OverflowMenu
        visible={menuOpen}
        position={menuPos}
        items={overflowItems}
        onClose={() => setMenuOpen(false)}
      />

      <SearchModal
        visible={searchOpen}
        value={searchQuery}
        onChange={setSearchQuery}
        onClose={() => setSearchOpen(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  // ── Header
  header: {
    flexDirection: 'row',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  headerTextBlock: { alignItems: 'flex-end', flex: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    textAlign: 'right',
  },
  headerDescriptionWrap: { marginTop: 6, width: '100%' },
  headerDescription: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    lineHeight: 18,
  },
  headerDescriptionMeasurer: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    maxWidth: '100%',
  },
  headerDescriptionToggleWrap: { marginTop: 4, alignSelf: 'flex-end' },
  headerDescriptionToggle: {
    fontSize: 12,
    color: '#36a9e2',
    fontWeight: '600',
    textAlign: 'right',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerAddBtn: {
    backgroundColor: PRIMARY,
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
    flexDirection: 'row-reverse',
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  sectionRight: { flex: 1, alignItems: 'flex-end' },
  sectionLeft: { alignItems: 'flex-start', minWidth: 60 },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 2,
  },
  sectionAction: { fontSize: 13, color: PRIMARY, fontWeight: '600' },

  // ── Events grid
  eventsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

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
    textAlign: 'right',
  },
  eventCardMeta: {
    fontSize: 10,
    color: '#fff',
    opacity: 0.9,
    textAlign: 'right',
  },
  eventCardConfirmed: {
    fontSize: 11,
    fontWeight: '700',
    color: '#86efac',
    textAlign: 'right',
    marginTop: 4,
  },
  eventCardTaskSummary: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'right',
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
    textAlign: 'right',
    color: '#111827',
  },
  cancelledEventsSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
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
    flexDirection: 'row',
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
  eventRowContent: { flex: 1, alignItems: 'flex-end', gap: 4 },
  eventRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-end',
    width: '100%',
  },
  eventRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
    flex: 1,
  },
  eventRowLocation: { fontSize: 12, color: '#9ca3af', textAlign: 'right' },
  eventRowCancelReason: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 2,
  },
  eventRowCancelledBadge: {
    alignSelf: 'flex-end',
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
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rsvpStatusText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  eventRowTaskSummary: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
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
  taskTitle: { flex: 1, fontSize: 14, color: '#111827', textAlign: 'right' },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  taskDue: { fontSize: 11, color: '#9ca3af', minWidth: 36, textAlign: 'left' },

  // ── Month selector
  monthSelector: {
    flexDirection: 'row',
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
  seeMoreBtn: { alignSelf: 'flex-end', marginTop: 8 },
  seeMoreText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },

  // ── Empty states
  emptySmall: { paddingVertical: 16, alignItems: 'flex-end' },
  emptySmallText: { fontSize: 13, color: '#9ca3af', textAlign: 'right' },
  emptyFull: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  emptyText: { fontSize: 16, color: '#6b7280', textAlign: 'center' },

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
    textAlign: 'right',
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
  sheetOptionText: { fontSize: 17, color: '#374151', textAlign: 'right' },

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
    textAlign: 'right',
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
  popoverLabel: { fontSize: 15, color: '#374151', textAlign: 'right', flex: 1 },
  popoverDanger: { color: '#ef4444' },

  // ── Reminder rows (כדאי לזכור section in הכל tab)
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
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
  },
  reminderCheckboxDone: { backgroundColor: PRIMARY },
  reminderTitle: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    textAlign: 'right',
  },
  reminderTitleDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  reminderDue: {
    fontSize: 11,
    color: '#9ca3af',
    minWidth: 36,
    textAlign: 'left',
  },
  reminderHideBtn: { padding: 4, flexShrink: 0 },

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

  // ── Accordion (כדאי לזכור)
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  accordionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
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
    textAlign: 'right',
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
