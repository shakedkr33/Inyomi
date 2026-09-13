import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Linking,
  Modal,
  Platform,
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
import { AppConfirmationDialog } from '@/components/AppConfirmationDialog';
import { NavigationPickerModal } from '@/components/NavigationPickerModal';
import { RsvpBlockedByTaskDialog } from '@/components/RsvpBlockedByTaskDialog';
import { UpgradeModal } from '@/components/UpgradeModal';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import type { LocalAssignee } from '@/lib/components/event/TaskAssigneeSheet';
import { TaskAssigneeSheet } from '@/lib/components/event/TaskAssigneeSheet';
import { canManageEventReminderItem } from '@/lib/eventReminderPermissions';
import {
  canViewUnansweredRsvp,
  computeUnansweredCommunityMembers,
  rsvpRowDisplayName,
  unansweredMemberDisplayName,
} from '@/lib/eventRsvpUnanswered';
import { canShowCommunityEventSelfClaimAction } from '@/lib/eventTaskClaimVisibility';
import { isCancelledEventWithinCommunityVisibilityWindow } from '@/lib/eventsTabDateHelpers';
import {
  getOpenCommunityCalendarActionLabel,
  getRsvpCalendarActionLabel,
  isOpenCommunityCalendarActionVisible,
  isRsvpCalendarActionVisible,
} from '@/lib/openCommunityCalendarUi';
import { getConvexErrorCode } from '@/lib/utils/convexError';
import { parseGeoUri } from '@/lib/utils/geoUri';
import { getHebrewDateInfo } from '@/lib/utils/hebrewDate';

const HEB_TEXT_ALIGN = 'left';
const HEB_ROW = 'row';
const HEB_FLEX_END = 'flex-start';
const HEB_WRITING_DIRECTION: undefined = undefined;

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';
const IMPORTANT_ITEMS_SECTION_TITLE = 'חשוב לזכור';
const IMPORTANT_ITEMS_COPY_DEFAULT = 'הוסף למשימות שלי';
const IMPORTANT_ITEMS_COPY_SUCCESS = 'נוסף למשימות שלך ✓';
// FIX A — same copy/error-code semantics as the confirmation flow already
// implemented in components/EventDetailsBottomSheet.tsx (not duplicated
// logic — just the same literal backend error code + dialog copy so the
// two surfaces behave identically for this one action).
const CALENDAR_REMOVE_CONFIRM_TITLE = 'להסיר מהיומן?';
const CALENDAR_REMOVE_CONFIRM_MESSAGE =
  'הוקצו לך משימות באירוע הזה. האירוע יוסר מהיומן שלך, אבל המשימות עדיין יופיעו במסך המשימות.';
const CALENDAR_REMOVE_CONFIRMATION_CODE =
  'CALENDAR_REMOVE_REQUIRES_ACTIVE_TASK_CONFIRMATION';

// ─── Types ────────────────────────────────────────────────────────────────────

type RsvpStatus = 'yes' | 'no' | 'maybe' | 'none';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes <= 0) return '';
  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Full Screen parity with buildCommunityEventShareMessage in
// components/EventDetailsBottomSheet.tsx — same header/footer copy and
// link format, adapted to this screen's event shape (startTime/endTime
// instead of dateTimeParts/timeLabel).
const INYOMI_EVENT_LINK_BASE = 'https://inyomi.app/e';

interface CommunityEventShareMessageInput {
  title: string;
  eventId: string;
  startTime: number;
  endTime?: number;
  allDay?: boolean;
  location?: string;
  importantItems: Array<{ id: string; title: string }>;
  communityName?: string;
}

function buildCommunityEventShareMessage({
  title,
  eventId,
  startTime,
  endTime,
  allDay,
  location,
  importantItems,
  communityName,
}: CommunityEventShareMessageInput): string {
  const trimmedCommunityName = communityName?.trim();
  const trimmedLocation = location?.trim();
  const trimmedImportantItems = importantItems
    .map((item) => item.title.trim())
    .filter((itemTitle) => itemTitle.length > 0);

  const dateLine = formatFullDate(startTime);
  const timeLine = allDay
    ? 'כל היום'
    : endTime
      ? `${formatTime(startTime)}-${formatTime(endTime)}`
      : formatTime(startTime);

  const lines = ['אירוע קהילה ב־InYomi 👥'];
  if (trimmedCommunityName) {
    lines.push(`קהילה: ${trimmedCommunityName}`);
  }
  lines.push('', title.trim());
  lines.push(`מתי: ${dateLine}, ${timeLine}`);

  if (trimmedLocation) {
    lines.push(`איפה: ${trimmedLocation}`);
  }

  if (trimmedImportantItems.length > 0) {
    lines.push('', 'חשוב לזכור:');
    lines.push(...trimmedImportantItems.map((itemTitle) => `• ${itemTitle}`));
  }

  lines.push(
    '',
    'נשלח דרך InYomi - פחות לזכור, יותר להיות.',
    'לפתיחת האירוע / הצטרפות:',
    `${INYOMI_EVENT_LINK_BASE}/${eventId}`
  );

  return lines.join('\n');
}

function formatRecurrenceLabel(pattern: string | undefined): string {
  if (pattern === 'daily') return 'כל יום';
  if (pattern === 'weekly') return 'כל שבוע';
  if (pattern === 'monthly') return 'כל חודש';
  if (pattern === 'yearly') return 'כל שנה';
  if (pattern === 'custom') return 'מותאם אישית';
  return 'ללא';
}

function formatReminderLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'תזכורת: בזמן האירוע';
  if (offsetMinutes === 60) return 'תזכורת: שעה לפני האירוע';
  if (offsetMinutes === 1440) return 'תזכורת: יום לפני האירוע';
  if (offsetMinutes % 1440 === 0) {
    return `תזכורת: ${offsetMinutes / 1440} ימים לפני האירוע`;
  }
  if (offsetMinutes % 60 === 0) {
    return `תזכורת: ${offsetMinutes / 60} שעות לפני האירוע`;
  }
  return `תזכורת: ${offsetMinutes} דקות לפני האירוע`;
}

function getReminderLabels(eventLike: unknown): string[] {
  const reminders = (eventLike as { reminders?: unknown }).reminders;
  if (!Array.isArray(reminders) || reminders.length === 0) return [];
  return reminders
    .filter((r): r is number => typeof r === 'number')
    .map(formatReminderLabel);
}

function uniqueById<T>(items: readonly T[], getId: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique;
}

// ─── RSVP Options (module-level to avoid recreating in render) ────────────────

const RSVP_OPTIONS = [
  {
    status: 'yes' as const,
    label: 'כן',
    selectedBg: '#dcfce7',
    selectedBorder: '#16a34a',
    selectedText: '#14532d',
  },
  {
    status: 'maybe' as const,
    label: 'אולי',
    selectedBg: '#fef3c7',
    selectedBorder: '#d97706',
    selectedText: '#92400e',
  },
  {
    status: 'no' as const,
    label: 'לא',
    selectedBg: '#fee2e2',
    selectedBorder: '#dc2626',
    selectedText: '#991b1b',
  },
];

// ─── Overflow Menu ────────────────────────────────────────────────────────────

interface OverflowItem {
  label: string;
  iconName: ComponentProps<typeof Ionicons>['name'];
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

// FIXED: guard against non-Convex route params (e.g. mock item ids like "1", "2")
// Convex IDs are base62-encoded strings; a length < 8 is never a valid Id<'events'>.
function isValidConvexId(value: string | undefined): boolean {
  return typeof value === 'string' && value.length >= 8;
}

// ─── returnTo origin contract ───────────────────────────────────────────────
// Normal in-app navigation to canonical Event Details explicitly declares
// where it came from via `returnTo`, so header Back / Android hardware Back
// can restore the originating tab instead of relying on Tabs-navigator
// history (which does not reliably preserve tab-of-origin — see PR
// description). Only these exact values are ever accepted; arbitrary
// strings are NEVER used as route paths.
const RETURN_TO_ORIGINS = ['home', 'calendar', 'tasks', 'community'] as const;
type ReturnToOrigin = (typeof RETURN_TO_ORIGINS)[number];

function isReturnToOrigin(value: string | undefined): value is ReturnToOrigin {
  return (
    typeof value === 'string' &&
    (RETURN_TO_ORIGINS as readonly string[]).includes(value)
  );
}

export default function EventDetailScreen() {
  const { id, returnTo: returnToParam } = useLocalSearchParams<{
    id: string;
    returnTo?: string;
  }>();
  const router = useRouter();
  // Guard: only cast to Id<'events'> when the param looks like a real Convex ID.
  // If the guard fails we skip all queries (pass 'skip') and show the not-found state.
  const eventId = isValidConvexId(id) ? (id as Id<'events'>) : null;
  const returnTo = isReturnToOrigin(returnToParam) ? returnToParam : null;

  const event = useQuery(api.events.getById, eventId ? { eventId } : 'skip');
  const rsvps = useQuery(
    api.eventRsvps.listByEvent,
    eventId ? { eventId } : 'skip'
  );
  const myAssignedEventTasksState = useQuery(
    api.eventRsvps.hasMyAssignedEventTasksForEvent,
    eventId ? { eventId } : 'skip'
  );
  const eventTasks = useQuery(
    api.eventTasks.listByEvent,
    eventId ? { eventId } : 'skip'
  );
  const eventImportantItems = useQuery(
    api.tasks.listEventImportantItems,
    eventId ? { eventId } : 'skip'
  );
  const importantItemsCopyState = useQuery(
    api.tasks.hasUserCopiedAllImportantItemsFromEvent,
    eventId ? { eventId } : 'skip'
  );
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;

  const upsertRsvp = useMutation(api.eventRsvps.upsertRsvp);
  const setRsvpNoAndUnclaimMyEventTasks = useMutation(
    api.eventRsvps.setRsvpNoAndUnclaimMyEventTasks
  );
  const addCommunityEventToMyCalendar = useMutation(
    api.communityEventCalendar.addCommunityEventToMyCalendar
  );
  const removeCommunityEventFromMyCalendar = useMutation(
    api.communityEventCalendar.removeCommunityEventFromMyCalendar
  );
  const cancelEventMutation = useMutation(api.events.cancelEvent);
  // FIX C — Bottom Sheet parity: early Community-display removal of a
  // cancelled Community Event, within the 24h visibility window. Never a
  // hard delete (see convex/events.ts's removeCancelledCommunityEvent doc
  // comment) and never applied to Personal Events.
  const removeCancelledCommunityEventMutation = useMutation(
    api.events.removeCancelledCommunityEvent
  );
  const removeEventTask = useMutation(api.eventTasks.remove);
  const setTaskAssignee = useMutation(api.eventTasks.setAssignee);
  const updateEventTaskVisibility = useMutation(
    api.eventTasks.updateEventTaskVisibility
  );
  const claimEventTask = useMutation(api.eventTasks.claimEventTask);
  const unclaimEventTask = useMutation(api.eventTasks.unclaimEventTask);
  // FIX B — task completion, reused verbatim from
  // components/EventDetailsBottomSheet.tsx's toggleEventTaskCompleted usage.
  const toggleEventTaskCompleted = useMutation(api.eventTasks.toggleCompleted);
  const addEventImportantItemsToMyTasks = useMutation(
    api.tasks.addEventImportantItemsToMyTasks
  );
  const updateEventMutation = useMutation(api.events.update);
  // FIXED: link-based sharing for personal events (no communityId)
  const createShareLinkMutation = useMutation(api.shareLinks.createShareLink);

  const showRsvpNoBlockedDialog = useCallback(
    (count: number): void => {
      if (!eventId) return;
      setBlockedRsvpTaskCount(count);
    },
    [eventId]
  );

  const communityMembersData = useQuery(
    api.communities.getCommunityMembers,
    event?.communityId ? { communityId: event.communityId } : 'skip'
  );
  /**
   * Part D1 — computed here (rather than in the derived-state block below)
   * so `overflowItems` (a hook, evaluated before the `event === null` early
   * return) can safely reference it — reused below as the single source for
   * both `canManageCommunityEvent` and "שכפל אירוע"'s gating.
   */
  const isCommunityOwnerOrAdminEarly =
    communityMembersData?.members?.find((m) => m.userId === currentUserId)
      ?.role === 'owner' ||
    communityMembersData?.members?.find((m) => m.userId === currentUserId)
      ?.role === 'admin';
  /**
   * FIX C — Bottom Sheet parity, computed "early" for the same reason as
   * `isCommunityOwnerOrAdminEarly` above (`overflowItems` is a hook
   * evaluated before the `event === null` early return, so it cannot
   * depend on the later derived-state block). This is the ONLY place this
   * gate is computed — the overflow menu item and the confirmation dialog
   * below both read this same value.
   */
  const isCreatorEarly =
    currentUserId !== undefined && event?.createdBy === currentUserId;
  const canRemoveFromCommunityEarly = Boolean(
    event?.communityId &&
      event.status === 'cancelled' &&
      event.cancelledAt !== undefined &&
      isCancelledEventWithinCommunityVisibilityWindow(
        event.cancelledAt,
        Date.now()
      ) &&
      (isCreatorEarly || isCommunityOwnerOrAdminEarly) &&
      event.removedFromCommunityAt === undefined
  );

  const communityRecord = useQuery(
    api.communities.getById,
    event?.communityId ? { communityId: event.communityId } : 'skip'
  );

  const [assigneeSheetTaskId, setAssigneeSheetTaskId] = useState<string | null>(
    null
  );
  const [manualAssigneeName, setManualAssigneeName] = useState('');

  const [navPickerLocation, setNavPickerLocation] = useState<string | null>(
    null
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 8, y: 80 });
  const menuBtnRef = useRef<View>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  // FIX C — Bottom Sheet parity: confirmation state for the early
  // Community-display removal action.
  const [showRemoveFromCommunityDialog, setShowRemoveFromCommunityDialog] =
    useState(false);
  const [isRemovingFromCommunity, setIsRemovingFromCommunity] = useState(false);
  const [isCopyingImportantItems, setIsCopyingImportantItems] = useState(false);
  const [blockedRsvpTaskCount, setBlockedRsvpTaskCount] = useState<
    number | null
  >(null);
  // FIX D — Full Screen parity: opens the RSVP response detail modal
  // (mirrors EventDetailsBottomSheet.tsx's participantRsvpDetailsOpen).
  const [participantRsvpDetailsOpen, setParticipantRsvpDetailsOpen] =
    useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  // FIX A — mirrors calendarRemoveConfirmationEventId in
  // EventDetailsBottomSheet.tsx; holds the eventId pending the
  // active-assigned-task removal confirmation dialog.
  const [calendarRemoveConfirmEventId, setCalendarRemoveConfirmEventId] =
    useState<Id<'events'> | null>(null);
  const [importantItemsCopyError, setImportantItemsCopyError] = useState<
    string | null
  >(null);
  const { isExpiredFree } = useEffectiveAccess();
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);

  const handleMenuPress = useCallback(() => {
    if (!menuBtnRef.current) {
      setMenuPos({ x: 8, y: 80 });
      setMenuOpen(true);
      return;
    }
    menuBtnRef.current.measureInWindow((x, y, _w, h) => {
      // Popover anchored to left; ensure it doesn't overflow left edge (x >= 0)
      const popoverX = Math.max(0, x);
      setMenuPos({ x: popoverX, y: y + h + 4 });
      setMenuOpen(true);
    });
  }, []);

  const handleRsvp = useCallback(
    (status: RsvpStatus) => {
      if (!eventId) return;
      const localAssignedCount = (eventTasks ?? []).filter(
        (task) => task.assignedToUserId === currentUserId
      ).length;
      const assignedCount =
        myAssignedEventTasksState?.count ?? localAssignedCount;
      if (status === 'no' && assignedCount > 0) {
        showRsvpNoBlockedDialog(assignedCount);
        return;
      }
      upsertRsvp({ eventId, status }).catch((error) => {
        if (
          status === 'no' &&
          getConvexErrorCode(error) === 'RSVP_NO_BLOCKED_BY_ACTIVE_TASK'
        ) {
          showRsvpNoBlockedDialog(assignedCount > 0 ? assignedCount : 1);
          return;
        }
        Alert.alert('שגיאה', 'לא ניתן לשמור תגובה');
      });
    },
    [
      currentUserId,
      eventId,
      eventTasks,
      myAssignedEventTasksState,
      showRsvpNoBlockedDialog,
      upsertRsvp,
    ]
  );

  /**
   * FIX A — toggle add/remove for personal-calendar inclusion, ported from
   * EventDetailsBottomSheet.tsx's handleOpenCalendarToggle. RSVP state is
   * never read or written here — the source of truth for saved/not-saved
   * is always event.isSavedToMyCalendar (from api.events.getById), no
   * local boolean is kept.
   */
  const handleCalendarToggle = useCallback(() => {
    if (!eventId || !event) return;
    const isSaved = event.isSavedToMyCalendar === true;
    if (isSaved && myAssignedEventTasksState?.hasAssignedTasks === true) {
      setCalendarRemoveConfirmEventId(eventId);
      return;
    }
    const run = isSaved
      ? removeCommunityEventFromMyCalendar
      : addCommunityEventToMyCalendar;
    run({ eventId }).catch((error) => {
      const errorCode = getConvexErrorCode(error);
      if (
        isSaved &&
        (errorCode === CALENDAR_REMOVE_CONFIRMATION_CODE ||
          errorCode === 'CALENDAR_REMOVE_BLOCKED_BY_ACTIVE_TASK')
      ) {
        setCalendarRemoveConfirmEventId(eventId);
        return;
      }
      Alert.alert(
        'שגיאה',
        isSaved
          ? 'לא ניתן להסיר את האירוע מהיומן'
          : 'לא הצלחנו להוסיף ליומן. נסי שוב בעוד רגע.'
      );
    });
  }, [
    event,
    eventId,
    myAssignedEventTasksState,
    addCommunityEventToMyCalendar,
    removeCommunityEventFromMyCalendar,
  ]);

  const handleConfirmCalendarRemoval = useCallback((): void => {
    if (!calendarRemoveConfirmEventId) return;
    const idToRemove = calendarRemoveConfirmEventId;
    setCalendarRemoveConfirmEventId(null);
    removeCommunityEventFromMyCalendar({
      eventId: idToRemove,
      confirmRemoveWithActiveTask: true,
    }).catch(() => Alert.alert('שגיאה', 'לא ניתן לעדכן את היומן'));
  }, [calendarRemoveConfirmEventId, removeCommunityEventFromMyCalendar]);

  const handleCancelCalendarRemoval = useCallback((): void => {
    setCalendarRemoveConfirmEventId(null);
  }, []);

  const handleCopyImportantItems = useCallback(async () => {
    if (!eventId || isCopyingImportantItems) return;
    setIsCopyingImportantItems(true);
    setImportantItemsCopyError(null);
    try {
      await addEventImportantItemsToMyTasks({ eventId });
    } catch {
      setImportantItemsCopyError('לא ניתן להוסיף למשימות כרגע');
    } finally {
      setIsCopyingImportantItems(false);
    }
  }, [eventId, isCopyingImportantItems, addEventImportantItemsToMyTasks]);

  /**
   * PART B/J — Event Details is the canonical management surface for event
   * important-items: an authorized manager (creator OR active community
   * owner/admin) may remove one item at a time, for BOTH future and PAST
   * events. This DELETEs shared event content — never to be confused with
   * completing the user's own personal task copy.
   */
  const handleDeleteImportantItem = useCallback(
    async (itemId: string) => {
      if (!eventId) return;
      const currentItems = eventImportantItems ?? event?.importantItems ?? [];
      const nextItems = currentItems.filter((item) => item.id !== itemId);
      try {
        await updateEventMutation({
          id: eventId,
          importantItems: nextItems,
        });
      } catch {
        Alert.alert('שגיאה', 'לא ניתן למחוק את הפריט כרגע');
      }
    },
    [eventId, eventImportantItems, event?.importantItems, updateEventMutation]
  );

  const handleCancelEvent = useCallback(async () => {
    if (!event || !eventId) return;
    setShowCancelDialog(false);
    try {
      await cancelEventMutation({
        eventId,
        cancelReason: cancelReason.trim() || undefined,
      });
      setCancelReason('');
      if (event.communityId) {
        router.replace({
          pathname: '/(authenticated)/community/[id]',
          params: { id: event.communityId },
        });
      } else {
        router.replace(
          '/(authenticated)/communities' as Parameters<typeof router.replace>[0]
        );
      }
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לבטל את האירוע');
    }
  }, [event, eventId, cancelEventMutation, cancelReason, router]);

  /**
   * FIX C — Bottom Sheet parity: soft Community-display removal of a
   * cancelled Community Event (never a hard delete). After a successful
   * removal, navigate back to the Community screen rather than leaving the
   * viewer on an event that just disappeared from Community display.
   */
  const handleRemoveFromCommunity = useCallback(async () => {
    if (!event || !eventId || isRemovingFromCommunity) return;
    setShowRemoveFromCommunityDialog(false);
    setIsRemovingFromCommunity(true);
    try {
      await removeCancelledCommunityEventMutation({ eventId });
      const communityId = event.communityId;
      if (communityId) {
        router.replace({
          pathname: '/(authenticated)/community/[id]',
          params: { id: communityId },
        });
      } else {
        router.back();
      }
    } catch {
      Alert.alert('שגיאה', 'לא ניתן להסיר את האירוע מהקהילה');
    } finally {
      setIsRemovingFromCommunity(false);
    }
  }, [
    event,
    eventId,
    isRemovingFromCommunity,
    removeCancelledCommunityEventMutation,
    router,
  ]);

  // ─── returnTo-aware Back navigation ─────────────────────────────────────
  // Full Screen Event Details is a hidden Tabs.Screen sibling of the visible
  // tabs (see app/(authenticated)/_layout.tsx) — it is NOT a Stack screen
  // pushed above the Tabs navigator. router.canGoBack() therefore does not
  // reliably restore the tab the user came from (Tabs history is switch-
  // based, not a linear back-stack). Explicit `returnTo` takes priority;
  // router.replace is used (not push) to switch back to the already-
  // mounted tab without creating a duplicate route — same mechanism already
  // verified to preserve the selected Community tab in QA.
  const handleBackNavigation = useCallback(() => {
    if (returnTo === 'home') {
      router.replace(
        '/(authenticated)' as Parameters<typeof router.replace>[0]
      );
      return;
    }
    if (returnTo === 'calendar') {
      router.replace(
        '/(authenticated)/calendar' as Parameters<typeof router.replace>[0]
      );
      return;
    }
    if (returnTo === 'tasks') {
      router.replace(
        '/(authenticated)/tasks' as Parameters<typeof router.replace>[0]
      );
      return;
    }
    if (returnTo === 'community') {
      if (event?.communityId) {
        router.replace({
          pathname: '/(authenticated)/community/[id]',
          params: { id: event.communityId },
        });
        return;
      }
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace(
        '/(authenticated)/communities' as Parameters<typeof router.replace>[0]
      );
      return;
    }

    // No recognized `returnTo` (cold start / deep link / legacy entry point
    // not yet migrated) — preserve prior behavior.
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (event?.communityId) {
      router.replace({
        pathname: '/(authenticated)/community/[id]',
        params: { id: event.communityId },
      });
      return;
    }
    router.replace('/(authenticated)' as Parameters<typeof router.replace>[0]);
  }, [returnTo, event?.communityId, router]);

  // Ref keeps the Android hardware-back listener (registered once per focus
  // below) always calling the latest handleBackNavigation closure.
  const handleBackNavigationRef = useRef(handleBackNavigation);
  handleBackNavigationRef.current = handleBackNavigation;

  // Android hardware/gesture Back while this screen is focused must follow
  // the same returnTo semantics as the header Back button above — otherwise
  // the Tabs-navigator default Back behavior would restore the wrong tab
  // (the same root cause as the header Back bug). Scoped with
  // useFocusEffect (not a plain mount-effect) because event/[id] is a
  // hidden Tabs.Screen that can remain mounted in the background when
  // another tab is focused; without this the listener would keep
  // intercepting Back on unrelated screens. Any Modal/dialog rendered by
  // this screen (cancel dialog, RSVP details, image preview, etc.) is a
  // native RN Modal, which already intercepts Android Back via its own
  // onRequestClose before this listener ever runs — so open modals are
  // unaffected. This does not touch any other screen's Back handling.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBackNavigationRef.current();
        return true;
      });
      return () => sub.remove();
    }, [])
  );

  // FIXED: always embed URL inside message — never use the separate `url` field.
  // Passing `url` as a second Share.share argument causes iOS UIActivityViewController
  // to treat it as an attachment object; WhatsApp then shows only the URL card and
  // silently drops the message text. Embedding the https:// link directly inside
  // `message` is reliable on both iOS and Android: messaging apps auto-linkify it.
  const handleShare = useCallback(() => {
    if (!event) return;
    const isPersonalEvent = !event.communityId;

    const doShare = async () => {
      // Build the human-readable text block (title + date + location)
      const lines: string[] = [event.title];
      let dateLine = formatFullDate(event.startTime);
      if (!event.allDay) dateLine += ` · ${formatTime(event.startTime)}`;
      lines.push(dateLine);
      if (event.location) lines.push(`📍 ${event.location}`);
      const shareText = lines.join('\n');

      if (isPersonalEvent && eventId) {
        try {
          const { token } = await createShareLinkMutation({ eventId });

          // FIXED: clickable HTTPS share link
          const shareUrl = `https://inyomi.com/shared/${token}`;
          const finalMessage = `${shareText}\n\n${shareUrl}`;
          await Share.share({ message: finalMessage });
          return;
        } catch {
          // Fall back to text-only share if link generation fails
        }
      }

      // Community event: parity with EventDetailsBottomSheet's
      // buildCommunityEventShareMessage — embeds the /e/{eventId} link
      // directly inside the message (never as a separate `url` field; see
      // the FIXED comment above handleShare for why).
      if (event.communityId && eventId) {
        try {
          const message = buildCommunityEventShareMessage({
            title: event.title,
            eventId,
            startTime: event.startTime,
            endTime: event.endTime,
            allDay: event.allDay,
            location: event.location,
            importantItems: eventImportantItems ?? event.importantItems ?? [],
            communityName: communityRecord?.name,
          });
          await Share.share({ message });
        } catch (e) {
          console.error('Share failed:', e);
          Alert.alert(
            'שיתוף לא זמין',
            'לא ניתן לשתף את האירוע כרגע. נסו שוב עוד רגע.'
          );
        }
        return;
      }

      // Fallback: text-only share
      try {
        await Share.share({ message: shareText });
      } catch (e) {
        console.error('Share failed:', e);
      }
    };

    // Delay so ⋯ menu modal has fully dismissed before system Share sheet opens
    setTimeout(() => {
      doShare();
    }, 300);
  }, [
    event,
    eventId,
    createShareLinkMutation,
    eventImportantItems,
    communityRecord,
  ]);

  const handleOpenNavigationChooser = useCallback(() => {
    const location = event?.location?.trim();
    const locationUrl = (event as { locationUrl?: string } | null | undefined)
      ?.locationUrl;
    if (!location || !parseGeoUri(locationUrl)) return;
    setNavPickerLocation(location);
  }, [event]);

  const navPickerLocationUrl =
    (event as { locationUrl?: string } | null | undefined)?.locationUrl ?? null;
  const hasNavigableLocation = parseGeoUri(navPickerLocationUrl) !== null;

  const handleGatedAction = useCallback(
    (action: () => void): void => {
      if (isExpiredFree && !event?.communityId) {
        setUpgradeModalVisible(true);
        return;
      }
      action();
    },
    [isExpiredFree, event?.communityId]
  );

  // FIX C.1 — extracted so the header's ⋯ overflow menu (Personal Events)
  // and the inline Community action row below can both trigger the exact
  // same "עריכה" navigation without duplicating the logic.
  const handleEditPress = useCallback(() => {
    handleGatedAction(() => {
      router.push({
        pathname: '/(authenticated)/event-edit/[id]',
        params: {
          id: eventId as string,
          ...(event?.communityId
            ? { returnCommunityId: event.communityId as string }
            : {}),
        },
      });
    });
  }, [handleGatedAction, router, eventId, event?.communityId]);

  // FIX C.1 — extracted so the header's ⋯ overflow menu (Personal Events)
  // and the inline Community action row below can both trigger the exact
  // same "שכפל" navigation without duplicating the logic. Gating
  // (isCommunityOwnerOrAdminEarly) is left to each call site — same as
  // before this extraction.
  const handleDuplicatePress = useCallback(() => {
    if (!event?.communityId) return;
    handleGatedAction(() => {
      router.push({
        pathname: '/(authenticated)/event/new',
        params: {
          communityId: event.communityId as string,
          duplicateFromEventId: eventId as string,
        },
      });
    });
  }, [handleGatedAction, router, eventId, event?.communityId]);

  const overflowItems = useMemo<OverflowItem[]>(() => {
    const items: OverflowItem[] = [
      {
        label: 'עריכת אירוע',
        iconName: 'create-outline',
        onPress: handleEditPress,
      },
      {
        label: 'שיתוף אירוע',
        iconName: 'share-outline',
        onPress: handleShare,
      },
    ];
    // Part D1/D2B — owner/admin only, same permission source as
    // canCreateCommunityContent (resolveActiveCommunityContext.ts).
    if (event?.communityId && isCommunityOwnerOrAdminEarly) {
      items.push({
        label: 'שכפל אירוע',
        iconName: 'copy-outline',
        onPress: handleDuplicatePress,
      });
    }
    if (event?.status !== 'cancelled') {
      items.push({
        label: 'בטל אירוע',
        iconName: 'close-circle-outline',
        danger: true,
        onPress: () => setShowCancelDialog(true),
      });
    }
    // FIX C — Bottom Sheet parity: "הסר מהקהילה" for a cancelled Community
    // Event still inside the 24h visibility window, managed by the viewer,
    // and not already removed. Never a hard delete — see
    // handleRemoveFromCommunity / convex/events.ts.
    if (canRemoveFromCommunityEarly) {
      items.push({
        label: 'הסר מהקהילה',
        iconName: 'trash-outline',
        danger: true,
        onPress: () => setShowRemoveFromCommunityDialog(true),
      });
    }
    return items;
  }, [
    handleEditPress,
    handleDuplicatePress,
    handleShare,
    event?.communityId,
    event?.status,
    isCommunityOwnerOrAdminEarly,
    canRemoveFromCommunityEarly,
  ]);

  // ── Invalid route param (e.g. mock item ids like "1", "2")
  if (!eventId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
          <Text style={styles.notFoundText}>אירוע לא נמצא</Text>
          <TouchableOpacity
            style={styles.errorBackBtn}
            onPress={() =>
              router.replace(
                '/(authenticated)' as Parameters<typeof router.replace>[0]
              )
            }
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.errorBackBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading
  if (event === undefined) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Not found
  if (event === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
          <Text style={styles.notFoundText}>אירוע לא נמצא</Text>
          <TouchableOpacity
            style={styles.errorBackBtn}
            onPress={() =>
              router.replace(
                '/(authenticated)/communities' as Parameters<
                  typeof router.replace
                >[0]
              )
            }
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.errorBackBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Derived state (event is non-null from here)
  const isCreator =
    currentUserId !== undefined && event.createdBy === currentUserId;
  const myRsvp = rsvps?.find((r) => r.userId === currentUserId);
  const currentStatus: RsvpStatus = (myRsvp?.status as RsvpStatus) ?? 'none';
  const members = communityMembersData?.members ?? [];
  const myCommunityMembership = members.find((m) => m.userId === currentUserId);
  const isCommunityOwnerOrAdmin = isCommunityOwnerOrAdminEarly;
  const canManageCommunityEvent =
    Boolean(event.communityId) && (isCreator || isCommunityOwnerOrAdmin);
  /**
   * FIX C — corrected cancellation copy: the previous text referenced a
   * 14-day retention window, which is NOT the product behavior (a cancelled
   * Community Event is visible in "אירועים שבוטלו" for up to 24 hours — see
   * CANCELLED_COMMUNITY_EVENT_VISIBILITY_WINDOW_MS). Also removes the
   * gendered "האם אתה בטוח" phrasing. Community vs. Personal copy differs
   * because the 24h/"אירועים שבוטלו" behavior only applies to Community
   * Events — a Personal Event has no such Community display at all.
   */
  const cancelDialogBody = event.communityId
    ? 'האירוע יסומן כמבוטל ויוצג בקהילה עד 24 שעות, כדי שחברי הקהילה יוכלו לראות את העדכון. ניתן להסיר אותו מהקהילה גם לפני כן.'
    : 'האירוע יבוטל.';
  // PART B/J — same authorization rule enforced server-side in
  // events.update; works identically for future AND past events (no
  // time-based gate). Reused from the community "תזכורות" tab's per-item
  // delete authorization so there is a single source of truth.
  const canManageImportantItems = canManageEventReminderItem({
    currentUserId,
    eventCreatedBy: event.createdBy ?? '',
    myRole: myCommunityMembership?.role,
  });
  /**
   * QA FIX (Issue 3) — CANONICAL CREATOR RSVP RULE: only the event's actual
   * creator is exempt from RSVP. A non-creator owner/admin must still go
   * through the normal RSVP flow — see EventDetailsBottomSheet.tsx and
   * convex/communityCalendarState.ts's computeRsvpAttentionState for the
   * matching fix.
   */
  const skipCommunityRsvpPrompt = isCreator;
  const canOpenEventOverflowMenu = event.communityId
    ? canManageCommunityEvent
    : isCreator;
  // FIX C.1 — Community Events with management access now surface their
  // actions inline (see communityActionRowItems below) instead of behind
  // the header ⋯ overflow menu, which was hard to use on-device and could
  // render partially off-screen. Personal Events are untouched: their ⋯
  // menu keeps working exactly as before.
  const showHeaderOverflowButton = event.communityId
    ? false
    : canOpenEventOverflowMenu;
  const canManageTasks = isCreator || isCommunityOwnerOrAdmin;
  const participantsCanSeeTasks = event.tasksVisibleToParticipants === true;
  const canRegularMemberSeeTasks = Boolean(
    event.communityId && myCommunityMembership && participantsCanSeeTasks
  );
  // The server already filters tasks per the visibility contract.
  // Show the section to managers always, and to members when they have visible tasks.
  const canSeeTasksSection = event.communityId
    ? canManageTasks ||
      canRegularMemberSeeTasks ||
      (eventTasks !== undefined && eventTasks.length > 0)
    : isCreator;
  const eventTasksForDisplay = uniqueById(
    eventTasks ?? [],
    (task) => task._id as string
  );

  const assignedCount = eventTasksForDisplay.filter(
    (t) => !!t.assignedToUserId || !!t.assignedToManual?.trim()
  ).length;

  const yesCount = rsvps?.filter((r) => r.status === 'yes').length ?? 0;
  const maybeCount = rsvps?.filter((r) => r.status === 'maybe').length ?? 0;
  const noCount = rsvps?.filter((r) => r.status === 'no').length ?? 0;
  const participantNames = (event.participants ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const hasParticipants = participantNames.length > 0;
  const fullHebrewDate = getHebrewDateInfo(event.startTime).fullHebrewDate;
  const recurrenceLabel =
    event.isRecurring === true
      ? formatRecurrenceLabel(event.recurringPattern)
      : 'ללא';
  const reminderLabels = getReminderLabels(event);
  const importantItems = eventImportantItems ?? event.importantItems ?? [];
  const hasImportantItems = importantItems.length > 0;
  const importantItemsCopyLoading = importantItemsCopyState === undefined;
  const allImportantItemsCopied =
    importantItemsCopyState?.allCopied === true && hasImportantItems;
  const importantItemsButtonDisabled =
    importantItemsCopyLoading ||
    isCopyingImportantItems ||
    allImportantItemsCopied;
  const importantItemsButtonLabel = allImportantItemsCopied
    ? IMPORTANT_ITEMS_COPY_SUCCESS
    : IMPORTANT_ITEMS_COPY_DEFAULT;
  const eventRequiresRsvp = event.requiresRsvp === true;
  const rsvpRows = rsvps ?? [];
  const hasCommunityRsvpResponses =
    Boolean(event.communityId) && eventRequiresRsvp;
  /**
   * FIX D — "טרם ענו" (unanswered) is manager-only coordination
   * information: the event creator, or an active community owner/admin
   * (regardless of who created the event) — never a regular member, even
   * though regular members DO see yes/maybe/no. Gated on
   * `communityMembersData !== undefined` so we never render a misleading
   * "טרם ענו 0" while active-member data is still loading; while loading,
   * the manager-only section simply doesn't render (yes/maybe/no are
   * unaffected). See lib/eventRsvpUnanswered.ts for the shared calculation
   * (also used by components/EventDetailsBottomSheet.tsx).
   */
  const communityMemberDataReady = communityMembersData !== undefined;
  const viewerCanViewUnansweredRsvp = canViewUnansweredRsvp({
    isEventCreator: isCreator,
    isActiveCommunityOwnerOrAdmin: isCommunityOwnerOrAdmin,
  });
  const showUnansweredRsvpSection = Boolean(
    hasCommunityRsvpResponses &&
      viewerCanViewUnansweredRsvp &&
      communityMemberDataReady
  );
  const unansweredCommunityMembers = showUnansweredRsvpSection
    ? computeUnansweredCommunityMembers({
        activeMembers: members,
        rsvpRows,
        eventCreatedBy: event.createdBy,
      })
    : [];
  const unansweredRsvpCount = unansweredCommunityMembers.length;

  const openCommunityCalendarInfoReady =
    !event.communityId ||
    (communityRecord !== undefined && communityMembersData !== undefined);

  const viewerIsActiveCommunityMemberForCalendar =
    communityMembersData !== undefined && communityMembersData !== null;

  const showOpenCommunityCalendarAction =
    openCommunityCalendarInfoReady &&
    isOpenCommunityCalendarActionVisible({
      event: {
        communityId: event.communityId ?? null,
        requiresRsvp: event.requiresRsvp,
        status: event.status,
      },
      hasValidConvexEventId: true,
      communityArchived: communityRecord?.archived === true,
      viewerIsActiveMember: viewerIsActiveCommunityMemberForCalendar,
    });

  /**
   * FIX A — Stage 2B parity: RSVP and personal-calendar inclusion are
   * independent axes, so RSVP-required community events must ALSO expose an
   * independent add/remove calendar action — same visibility rules as
   * showOpenCommunityCalendarAction, just for requiresRsvp === true. Never
   * disables/hides the RSVP yes/maybe/no buttons above it, and never reads
   * or writes RSVP status.
   */
  const showRsvpCalendarAction =
    openCommunityCalendarInfoReady &&
    isRsvpCalendarActionVisible({
      event: {
        communityId: event.communityId ?? null,
        requiresRsvp: event.requiresRsvp,
        status: event.status,
      },
      hasValidConvexEventId: true,
      communityArchived: communityRecord?.archived === true,
      viewerIsActiveMember: viewerIsActiveCommunityMemberForCalendar,
    });

  // Local variable to satisfy TypeScript in closures (event.onlineUrl may be undefined)
  const onlineUrl = event.onlineUrl;

  // ── Assignee sheet: derive current assignee from the task being managed
  const _assigneeSheetTask = assigneeSheetTaskId
    ? (eventTasksForDisplay.find((t) => t._id === assigneeSheetTaskId) ?? null)
    : null;
  const currentAssigneeForSheet: LocalAssignee | null =
    _assigneeSheetTask?.assignedToUserId
      ? {
          type: 'user',
          userId: _assigneeSheetTask.assignedToUserId,
          display:
            (_assigneeSheetTask as { assigneeDisplay?: string })
              .assigneeDisplay ?? '',
        }
      : _assigneeSheetTask?.assignedToManual?.trim()
        ? { type: 'manual', name: _assigneeSheetTask.assignedToManual.trim() }
        : null;

  /**
   * FIX C.1 — inline Community-management action row, shown near the top
   * of the screen instead of behind the header ⋯ overflow menu (which was
   * hard to use on-device and could render partially off-screen). Built
   * from the exact same permission sources and handlers already used by
   * `overflowItems` above — no new permission logic, no new mutations.
   * Personal Events never render this row; they keep the ⋯ menu as-is.
   */
  const communityActionRowItems: Array<{
    label: string;
    iconName: ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
    danger?: boolean;
  }> = [];
  if (event.communityId && canManageCommunityEvent) {
    communityActionRowItems.push({
      label: 'עריכה',
      iconName: 'create-outline',
      onPress: handleEditPress,
    });
    communityActionRowItems.push({
      label: 'שיתוף',
      iconName: 'share-outline',
      onPress: handleShare,
    });
    // Same owner/admin-only gating as the "שכפל אירוע" overflow item above.
    if (isCommunityOwnerOrAdminEarly) {
      communityActionRowItems.push({
        label: 'שכפול',
        iconName: 'copy-outline',
        onPress: handleDuplicatePress,
      });
    }
    if (event.status !== 'cancelled') {
      communityActionRowItems.push({
        label: 'ביטול',
        iconName: 'close-circle-outline',
        danger: true,
        onPress: () => setShowCancelDialog(true),
      });
    }
    // FIX C parity: identical gate to the "הסר מהקהילה" overflow item —
    // opens the same confirmation dialog and the same
    // removeCancelledCommunityEventMutation, never a new deletion path.
    if (canRemoveFromCommunityEarly) {
      communityActionRowItems.push({
        label: 'הסר מהקהילה',
        iconName: 'trash-outline',
        danger: true,
        onPress: () => setShowRemoveFromCommunityDialog(true),
      });
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header (RTL): right=back, center=title, left=⋯ */}
      <View style={[styles.header, styles.headerRtl]}>
        {/* First child → right in RTL: back button */}
        <TouchableOpacity
          onPress={handleBackNavigation}
          style={styles.headerIconBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <Ionicons name="chevron-forward" size={22} color="#374151" />
        </TouchableOpacity>

        {/* Center: title */}
        <Text style={styles.headerTitle} numberOfLines={2}>
          {event.title}
        </Text>

        {/* Last child → left in RTL: ⋯ for creator */}
        <View ref={menuBtnRef} style={styles.headerIconBtn}>
          {showHeaderOverflowButton && (
            <TouchableOpacity
              onPress={handleMenuPress}
              style={styles.headerIconBtn}
              accessible
              accessibilityRole="button"
              accessibilityLabel="אפשרויות"
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#374151" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Cancelled banner */}
        {event.status === 'cancelled' ? (
          <View style={styles.cancelledBanner}>
            <View style={styles.cancelledBannerRow}>
              <Ionicons name="close-circle" size={18} color="#dc2626" />
              <Text style={styles.cancelledBannerTitle}>אירוע זה בוטל</Text>
            </View>
            {event.cancelReason ? (
              <Text style={styles.cancelledBannerReason}>
                {`סיבת הביטול: ${event.cancelReason}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* ── FIX C.1: inline Community management action row — visible
            in-page instead of hidden behind the ⋯ overflow menu. Only
            rendered for Community Events the viewer can manage; Personal
            Events and regular members never see this row. */}
        {communityActionRowItems.length > 0 ? (
          <View style={styles.communityActionRow}>
            {communityActionRowItems.map((item) => (
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={item.label}
                key={item.label}
                onPress={item.onPress}
                style={[
                  styles.communityActionBtn,
                  item.danger && styles.communityActionBtnDanger,
                ]}
              >
                <Ionicons
                  name={item.iconName}
                  size={18}
                  color={item.danger ? '#dc2626' : PRIMARY}
                />
                <Text
                  style={[
                    styles.communityActionBtnText,
                    item.danger && styles.communityActionBtnTextDanger,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ── Section 1: פרטי האירוע */}
        <View style={styles.card}>
          {/* Date */}
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={18} color={PRIMARY} />
            <View style={styles.dateTextBlock}>
              <Text style={styles.detailText}>
                {formatFullDate(event.startTime)}
              </Text>
              {fullHebrewDate ? (
                <Text style={styles.hebrewDateLine}>{fullHebrewDate}</Text>
              ) : null}
            </View>
          </View>

          {/* Time */}
          {event.allDay ? (
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={18} color={PRIMARY} />
              <Text style={styles.detailText}>כל היום</Text>
            </View>
          ) : (
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={18} color={PRIMARY} />
              <Text style={styles.detailText}>
                {`${formatTime(event.startTime)} — ${formatTime(event.endTime)}`}
              </Text>
            </View>
          )}

          {/* Location — address text */}
          {event.location ? (
            <View style={styles.locationDetailRow}>
              <View style={styles.locationTextPressable}>
                <Ionicons name="location-outline" size={18} color={PRIMARY} />
                <Text style={styles.linkText}>{event.location}</Text>
              </View>
              {hasNavigableLocation ? (
                <TouchableOpacity
                  style={styles.navigateInlineBtn}
                  onPress={handleOpenNavigationChooser}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="נווט למיקום האירוע"
                >
                  <Ionicons name="navigate-outline" size={14} color="#8d6e63" />
                  <Text style={styles.navigateInlineBtnText}>נווט</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {/* Online URL — meeting/video link */}
          {onlineUrl ? (
            <View style={styles.detailRow}>
              <Ionicons name="videocam-outline" size={18} color={PRIMARY} />
              <TouchableOpacity
                onPress={() => {
                  Linking.openURL(onlineUrl).catch(() => {});
                }}
                accessible
                accessibilityRole="link"
                accessibilityLabel="הצטרפות לפגישה"
              >
                <Text style={styles.linkText}>הצטרפות לפגישה</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Description as notes/details */}
          {event.description ? (
            <>
              <View style={styles.separator} />
              <Text style={styles.descriptionLabel}>הערות</Text>
              <Text style={styles.descriptionText}>{event.description}</Text>
            </>
          ) : null}
        </View>

        {/* ── Scheduling */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>תזמון</Text>
          <View style={styles.scheduleRow}>
            <Ionicons name="repeat-outline" size={18} color={PRIMARY} />
            <Text style={styles.scheduleText}>
              {`אירוע חוזר: ${recurrenceLabel}`}
            </Text>
          </View>
          {reminderLabels.length > 0 ? (
            <View style={styles.reminderRows}>
              {reminderLabels.map((label) => (
                <View key={label} style={styles.reminderDisplayRow}>
                  <Ionicons
                    name="notifications-outline"
                    size={16}
                    color={PRIMARY}
                  />
                  <Text style={styles.reminderDisplayText}>{label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Attachments */}
        {event.attachments && event.attachments.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>קבצים מצורפים</Text>
            <View style={styles.attachmentsList}>
              {event.attachments.map((attachment) => (
                <FullScreenAttachmentRow
                  attachment={attachment}
                  eventId={eventId}
                  key={String(attachment.storageId)}
                  onPreviewImage={setPreviewImageUrl}
                />
              ))}
            </View>
          </View>
        ) : null}

        {hasImportantItems ? (
          <View style={styles.card}>
            <View style={styles.importantItemsHeaderChip}>
              <Text style={styles.importantItemsHeaderChipText}>
                {`📌 ${IMPORTANT_ITEMS_SECTION_TITLE} · ${importantItems.length}`}
              </Text>
            </View>
            <View style={styles.importantItemsList}>
              {importantItems.map((item) => (
                <View key={item.id} style={styles.importantItemRow}>
                  <Text style={styles.importantItemBullet}>•</Text>
                  <Text style={styles.importantItemText}>{item.title}</Text>
                  {canManageImportantItems ? (
                    <Pressable
                      accessibilityLabel={`מחק פריט: ${item.title}`}
                      accessibilityRole="button"
                      accessible={true}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => handleDeleteImportantItem(item.id)}
                      style={styles.importantItemDeleteBtn}
                    >
                      <Ionicons color="#94a3b8" name="close" size={16} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
            <Pressable
              accessibilityLabel={importantItemsButtonLabel}
              accessibilityRole="button"
              accessibilityState={{ disabled: importantItemsButtonDisabled }}
              accessible={true}
              disabled={importantItemsButtonDisabled}
              onPress={handleCopyImportantItems}
              style={({ pressed }) => [
                allImportantItemsCopied
                  ? styles.importantItemsCopiedBtn
                  : styles.importantItemsCopyBtn,
                pressed && !importantItemsButtonDisabled
                  ? styles.importantItemsCopyBtnPressed
                  : null,
                importantItemsButtonDisabled && !allImportantItemsCopied
                  ? styles.importantItemsCopyBtnDisabled
                  : null,
              ]}
            >
              <Text
                style={
                  allImportantItemsCopied
                    ? styles.importantItemsCopiedBtnText
                    : styles.importantItemsCopyBtnText
                }
              >
                {importantItemsButtonLabel}
              </Text>
            </Pressable>
            {importantItemsCopyError ? (
              <Text style={styles.importantItemsCopyError}>
                {importantItemsCopyError}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* ── Section 2: RSVP / passive state */}
        {!skipCommunityRsvpPrompt && eventRequiresRsvp ? (
          <View
            style={[
              styles.card,
              styles.rsvpCardElevated,
              event.status === 'cancelled' && styles.rsvpDisabled,
            ]}
          >
            <Text style={styles.rsvpTitle}>האם תשתתף?</Text>
            <View style={styles.rsvpRow}>
              {RSVP_OPTIONS.map((opt) => {
                const isActive = currentStatus === opt.status;
                const rsvpDisabled = event.status === 'cancelled';
                return (
                  <TouchableOpacity
                    key={opt.status}
                    activeOpacity={0.82}
                    disabled={rsvpDisabled}
                    hitSlop={{
                      top: 8,
                      bottom: 8,
                      left: 6,
                      right: 6,
                    }}
                    style={[
                      styles.rsvpBtn,
                      {
                        backgroundColor: isActive ? opt.selectedBg : '#f8fafc',
                        borderColor: isActive ? opt.selectedBorder : '#64748b',
                        opacity: rsvpDisabled ? 0.45 : 1,
                      },
                      isActive && styles.rsvpBtnSelected,
                    ]}
                    onPress={() => handleRsvp(opt.status)}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                    accessibilityState={{
                      selected: isActive,
                      disabled: rsvpDisabled,
                    }}
                  >
                    <Text
                      style={[
                        styles.rsvpBtnText,
                        isActive && {
                          color: opt.selectedText,
                          fontWeight: '800',
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/*
          FIX A — personal-calendar add/remove toggle for open (no-RSVP)
          community events. Source of truth is always
          event.isSavedToMyCalendar (api.events.getById); no local saved
          boolean is kept. Uses the same isOpenCommunityCalendarActionVisible
          visibility rule as before — only the action itself now toggles
          instead of being add-only.
        */}
        {showOpenCommunityCalendarAction ? (
          <View style={styles.card}>
            <View style={styles.passiveRow}>
              <Ionicons name="people-outline" size={18} color="#94a3b8" />
              <Text style={styles.passiveText}>פתוח לחברי הקהילה</Text>
            </View>
            <Pressable
              accessibilityHint="מוסיף או מסיר את האירוע מהיומן האישי שלך"
              accessibilityLabel={getOpenCommunityCalendarActionLabel(
                event.isSavedToMyCalendar === true
              )}
              accessibilityRole="button"
              accessible={true}
              onPress={handleCalendarToggle}
              style={({ pressed }) => [
                styles.openCalendarBtn,
                pressed && styles.openCalendarBtnPressed,
              ]}
            >
              <Text style={styles.openCalendarBtnText}>
                {getOpenCommunityCalendarActionLabel(
                  event.isSavedToMyCalendar === true
                )}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/*
          FIX A — independent personal-calendar action for RSVP-required
          community events (Stage 2B parity with EventDetailsBottomSheet).
          Rendered as its own card, separate from the RSVP yes/maybe/no card
          above — it never disables/hides those buttons and never touches
          RSVP status; it only reflects and toggles
          event.isSavedToMyCalendar.
        */}
        {showRsvpCalendarAction ? (
          <View style={styles.card}>
            <Pressable
              accessibilityHint="מוסיף או מסיר את האירוע מהיומן האישי שלך, בלי לשנות את תגובת ההגעה"
              accessibilityLabel={getRsvpCalendarActionLabel(
                event.isSavedToMyCalendar === true
              )}
              accessibilityRole="button"
              accessible={true}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={handleCalendarToggle}
              style={({ pressed }) => [
                styles.rsvpCalendarActionBtn,
                pressed && styles.rsvpCalendarActionBtnPressed,
              ]}
            >
              <Text style={styles.rsvpCalendarActionText}>
                {getRsvpCalendarActionLabel(event.isSavedToMyCalendar === true)}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Section 3: משימות לאירוע */}
        {eventTasks !== undefined && canSeeTasksSection && (
          <View style={styles.card}>
            {/* Header: title + assignment summary */}
            <View style={styles.taskSectionHeader}>
              <Text style={styles.taskSectionTitle}>משימות לאירוע</Text>
              {eventTasksForDisplay.length > 0 ? (
                <Text
                  style={[
                    styles.taskSummary,
                    assignedCount === eventTasksForDisplay.length
                      ? styles.taskSummaryAllDone
                      : null,
                  ]}
                >
                  {`${assignedCount}/${eventTasksForDisplay.length} הוקצו`}
                </Text>
              ) : null}
            </View>

            {canManageTasks ? (
              <View style={styles.taskVisibilitySection}>
                <View style={styles.taskVisibilityTextBlock}>
                  <Text style={styles.taskVisibilityTitle}>
                    משימות גלויות למשתתפים
                  </Text>
                  <Text style={styles.taskVisibilityHelper}>
                    {participantsCanSeeTasks
                      ? 'כל חברי הקהילה יראו את המשימות וההקצאות ויוכלו להשתבץ'
                      : 'כל משתתף יראה רק משימות שהוקצו אליו. מנהלי האירוע ימשיכו לראות את כולן'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.taskVisibilityToggleTouch}
                  onPress={() =>
                    handleGatedAction(() => {
                      updateEventTaskVisibility({
                        eventId,
                        tasksVisibleToParticipants: !participantsCanSeeTasks,
                      }).catch(() =>
                        Alert.alert('שגיאה', 'לא ניתן לעדכן נראות משימות')
                      );
                    })
                  }
                  accessible
                  accessibilityRole="switch"
                  accessibilityState={{ checked: participantsCanSeeTasks }}
                  accessibilityLabel="משימות גלויות למשתתפים"
                >
                  <View
                    style={[
                      styles.taskVisibilityToggleTrack,
                      participantsCanSeeTasks &&
                        styles.taskVisibilityToggleTrackOn,
                    ]}
                  >
                    <View
                      style={[
                        styles.taskVisibilityToggleThumb,
                        participantsCanSeeTasks &&
                          styles.taskVisibilityToggleThumbOn,
                      ]}
                    />
                  </View>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Manager-only visibility status explanation */}
            {canManageTasks ? (
              <View style={styles.managerVisibilityRow}>
                <Ionicons
                  name={
                    participantsCanSeeTasks
                      ? 'eye-outline'
                      : 'lock-closed-outline'
                  }
                  size={15}
                  color="#6B7280"
                />
                <View style={styles.managerVisibilityTextBlock}>
                  <Text style={styles.managerVisibilityTitle}>
                    {participantsCanSeeTasks
                      ? 'גלוי למשתתפים'
                      : 'גלוי לפי הקצאה'}
                  </Text>
                  <Text style={styles.managerVisibilityDesc}>
                    {participantsCanSeeTasks
                      ? 'כל חברי הקהילה יכולים לראות את המשימות וההקצאות.'
                      : 'כל משתתף רואה רק משימות שהוקצו אליו.'}
                  </Text>
                </View>
              </View>
            ) : null}

            {eventTasksForDisplay.length === 0 ? (
              <View style={styles.emptyParticipants}>
                <Ionicons name="list-outline" size={32} color="#d1d5db" />
                <Text style={styles.emptyParticipantsText}>
                  לא נוספו משימות לאירוע הזה
                </Text>
              </View>
            ) : (
              <View style={styles.tasksList}>
                {eventTasksForDisplay.map((task) => {
                  const assigneeDisplay = (
                    task as { assigneeDisplay?: string }
                  ).assigneeDisplay?.trim();
                  const isAssigned = Boolean(
                    assigneeDisplay ||
                      task.assignedToUserId ||
                      task.assignedToManual?.trim()
                  );
                  const isAssignedToCurrentUser =
                    task.assignedToUserId === currentUserId;
                  const assignmentLabel = isAssignedToCurrentUser
                    ? 'הוקצה אליי'
                    : assigneeDisplay
                      ? `הוקצה ל־${assigneeDisplay}`
                      : 'הוקצה';
                  // FIX B — Community-Event-only task completion +
                  // self-claim/unclaim eligibility, ported to match
                  // components/EventDetailsBottomSheet.tsx exactly.
                  // Visibility alone never grants completion permission;
                  // backend authorization is unchanged. Personal Events
                  // (isCommunityEvent === false) keep the exact
                  // pre-FIX-B rendering further below — this block only
                  // computes values consumed by the Community Event branch.
                  const isCommunityEvent = Boolean(event.communityId);
                  const isCompleted = task.completed === true;
                  const canCompleteTask =
                    canManageTasks ||
                    (task.assignedToUserId !== undefined &&
                      task.assignedToUserId === currentUserId);
                  const eventHasStarted =
                    typeof event.startTime === 'number' &&
                    event.startTime <= Date.now();
                  // COMMUNITY EVENT TASK CLAIM BUTTON FIX — the task itself
                  // is already server-authorized (listByEvent only returns
                  // tasks this viewer may see/act on; see
                  // lib/eventTaskClaimVisibility.ts for the full root-cause
                  // note). Claim-button visibility must not depend on the
                  // separately-timed `myCommunityMembership` client query,
                  // or the action can stay hidden after the task title is
                  // already visible. Independent of RSVP status.
                  const showSelfClaimAction = canShowCommunityEventSelfClaimAction({
                    isCommunityEvent,
                    participantsCanSeeTasks,
                  });
                  const isClaimable =
                    showSelfClaimAction && !isAssigned && !eventHasStarted;
                  const canUnclaimHere =
                    showSelfClaimAction &&
                    isAssignedToCurrentUser &&
                    !eventHasStarted &&
                    !isCompleted;
                  return (
                    <View key={task._id} style={styles.taskRow}>
                      {/* FIX B — completion checkbox, Community Events only.
                          Personal Events never render this checkbox. */}
                      {isCommunityEvent &&
                        (canCompleteTask ? (
                          <Pressable
                            accessible
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: isCompleted }}
                            accessibilityLabel={`${isCompleted ? 'בטל סימון' : 'סמן כבוצע'}: ${task.title}`}
                            hitSlop={8}
                            onPress={() =>
                              toggleEventTaskCompleted({ id: task._id }).catch(
                                () =>
                                  Alert.alert(
                                    'שגיאה',
                                    'לא ניתן לעדכן מצב המשימה'
                                  )
                              )
                            }
                            style={styles.eventTaskCheckboxTouch}
                          >
                            <View
                              style={[
                                styles.eventTaskCheckbox,
                                isCompleted && styles.eventTaskCheckboxDone,
                              ]}
                            >
                              {isCompleted ? (
                                <Ionicons
                                  name="checkmark"
                                  size={16}
                                  color="#FFFFFF"
                                />
                              ) : null}
                            </View>
                          </Pressable>
                        ) : (
                          <View
                            accessible
                            accessibilityRole="checkbox"
                            accessibilityState={{
                              checked: isCompleted,
                              disabled: true,
                            }}
                            accessibilityLabel={task.title}
                            style={styles.eventTaskCheckboxTouch}
                          >
                            <View
                              style={[
                                styles.eventTaskCheckbox,
                                styles.eventTaskCheckboxDisabled,
                                isCompleted &&
                                  styles.eventTaskCheckboxDoneDisabled,
                              ]}
                            >
                              {isCompleted ? (
                                <Ionicons
                                  name="checkmark"
                                  size={16}
                                  color="#FFFFFF"
                                />
                              ) : null}
                            </View>
                          </View>
                        ))}
                      {/* Actions — left side in RTL (manager only) */}
                      {canManageTasks && (
                        <View style={styles.taskActions}>
                          {isCommunityEvent ? (
                            // FIX B follow-up — Community Events only: the
                            // manager assignment action must be a clearly
                            // labeled tappable control (not icon-only), since
                            // Community task assignment is now account-backed
                            // (see TaskAssigneeSheet allowManualAssignee).
                            <Pressable
                              onPress={() =>
                                handleGatedAction(() => {
                                  setAssigneeSheetTaskId(task._id);
                                  setManualAssigneeName('');
                                })
                              }
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel={
                                isAssigned ? 'שנה הקצאה' : 'הקצה משימה'
                              }
                              style={({ pressed }) => [
                                styles.taskManagerAssignPill,
                                pressed && styles.taskManagerAssignPillPressed,
                              ]}
                            >
                              <Ionicons
                                name={
                                  isAssigned ? 'person' : 'person-add-outline'
                                }
                                size={14}
                                color={PRIMARY}
                              />
                              <Text style={styles.taskManagerAssignPillText}>
                                {isAssigned ? 'שנה הקצאה' : 'הקצה'}
                              </Text>
                            </Pressable>
                          ) : (
                            // Personal Events — preserved exactly: icon-only
                            // assignment control.
                            <TouchableOpacity
                              onPress={() =>
                                handleGatedAction(() => {
                                  setAssigneeSheetTaskId(task._id);
                                  setManualAssigneeName('');
                                })
                              }
                              style={styles.taskActionBtn}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel={
                                isAssigned ? 'שנה הקצאה' : 'הקצה משימה'
                              }
                            >
                              <Ionicons
                                name={
                                  isAssigned ? 'person' : 'person-add-outline'
                                }
                                size={18}
                                color={isAssigned ? PRIMARY : '#9ca3af'}
                              />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            onPress={() =>
                              handleGatedAction(() => {
                                Alert.alert(
                                  'מחק משימה',
                                  'האם למחוק את המשימה?',
                                  [
                                    { text: 'ביטול', style: 'cancel' },
                                    {
                                      text: 'מחק',
                                      style: 'destructive',
                                      onPress: () =>
                                        removeEventTask({
                                          id: task._id,
                                        }).catch(() =>
                                          Alert.alert(
                                            'שגיאה',
                                            'לא ניתן למחוק משימה'
                                          )
                                        ),
                                    },
                                  ]
                                );
                              })
                            }
                            style={styles.taskActionBtn}
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel="מחק משימה"
                          >
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color="#d1d5db"
                            />
                          </TouchableOpacity>
                        </View>
                      )}
                      <View style={styles.taskContent}>
                        <Text
                          style={[
                            styles.taskTitle,
                            // FIX B — completed-title styling applies to
                            // Community Events only; Personal Events keep
                            // the exact pre-FIX-B plain title.
                            isCommunityEvent &&
                              isCompleted &&
                              styles.taskTitleCompleted,
                          ]}
                          numberOfLines={2}
                        >
                          {task.title}
                        </Text>
                        {isCommunityEvent ? (
                          // FIX B — Community Event claim/unclaim UI,
                          // unchanged from the original FIX B implementation.
                          isClaimable ? (
                            <Pressable
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel="אני אקח"
                              hitSlop={{
                                top: 8,
                                bottom: 8,
                                left: 8,
                                right: 8,
                              }}
                              onPress={() =>
                                claimEventTask({ id: task._id }).catch(() =>
                                  Alert.alert(
                                    'שגיאה',
                                    'לא ניתן להשתבץ למשימה כרגע'
                                  )
                                )
                              }
                              style={({ pressed }) => [
                                styles.taskSelfClaimBtnPressable,
                                pressed && styles.taskSelfClaimBtnPressed,
                              ]}
                            >
                              <View style={styles.taskSelfClaimBtnFill}>
                                <Text style={styles.taskSelfClaimBtnText}>
                                  אני אקח
                                </Text>
                              </View>
                            </Pressable>
                          ) : canUnclaimHere ? (
                            <View style={styles.taskAssignmentStatusRow}>
                              <Text
                                style={styles.taskAssignedLabel}
                                numberOfLines={1}
                              >
                                {assignmentLabel}
                              </Text>
                              <Pressable
                                accessible
                                accessibilityRole="button"
                                accessibilityLabel="בטל הקצאה"
                                hitSlop={{
                                  top: 6,
                                  bottom: 6,
                                  left: 8,
                                  right: 8,
                                }}
                                onPress={() =>
                                  unclaimEventTask({ id: task._id }).catch(() =>
                                    Alert.alert(
                                      'שגיאה',
                                      'לא ניתן להסיר הקצאה כרגע'
                                    )
                                  )
                                }
                                style={({ pressed }) => [
                                  styles.taskSelfUnclaimBtn,
                                  pressed && styles.taskSelfUnclaimBtnPressed,
                                ]}
                              >
                                <Text style={styles.taskSelfUnclaimBtnText}>
                                  בטל הקצאה
                                </Text>
                              </Pressable>
                            </View>
                          ) : isAssigned ? (
                            <Text
                              style={
                                isAssignedToCurrentUser
                                  ? styles.taskAssignedLabel
                                  : styles.taskAssignedOtherLabel
                              }
                              numberOfLines={1}
                            >
                              {assignmentLabel}
                            </Text>
                          ) : null
                        ) : /* Personal Event — exact pre-FIX-B claim/unclaim
                               behavior, including handleGatedAction gating
                               for subscription/paywall purposes. */
                        canManageTasks ? (
                          isAssigned ? (
                            <View style={styles.taskAssignmentStatusRow}>
                              <Text
                                style={
                                  isAssignedToCurrentUser
                                    ? styles.taskAssignedLabel
                                    : styles.taskAssignedOtherLabel
                                }
                                numberOfLines={1}
                              >
                                {assignmentLabel}
                              </Text>
                              {isAssignedToCurrentUser ? (
                                <TouchableOpacity
                                  hitSlop={{
                                    top: 8,
                                    bottom: 8,
                                    left: 8,
                                    right: 8,
                                  }}
                                  onPress={() =>
                                    handleGatedAction(() => {
                                      unclaimEventTask({ id: task._id }).catch(
                                        () =>
                                          Alert.alert(
                                            'שגיאה',
                                            'לא ניתן להסיר הקצאה כרגע'
                                          )
                                      );
                                    })
                                  }
                                  style={styles.taskUnassignBtn}
                                  accessible
                                  accessibilityRole="button"
                                  accessibilityLabel="בטל הקצאה"
                                >
                                  <Text style={styles.taskUnassignBtnText}>
                                    בטל הקצאה
                                  </Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          ) : (
                            <TouchableOpacity
                              hitSlop={{
                                top: 8,
                                bottom: 8,
                                left: 8,
                                right: 8,
                              }}
                              style={styles.taskClaimBtn}
                              onPress={() =>
                                handleGatedAction(() => {
                                  claimEventTask({ id: task._id }).catch(() =>
                                    Alert.alert(
                                      'שגיאה',
                                      'לא ניתן להשתבץ למשימה כרגע'
                                    )
                                  );
                                })
                              }
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel="אני אקח"
                            >
                              <Text style={styles.taskClaimBtnText}>
                                אני אקח
                              </Text>
                            </TouchableOpacity>
                          )
                        ) : isAssigned ? (
                          <View style={styles.taskAssignmentStatusRow}>
                            <Text
                              style={
                                isAssignedToCurrentUser
                                  ? styles.taskAssignedLabel
                                  : styles.taskAssignedOtherLabel
                              }
                              numberOfLines={1}
                            >
                              {assignmentLabel}
                            </Text>
                            {isAssignedToCurrentUser ? (
                              <TouchableOpacity
                                hitSlop={{
                                  top: 8,
                                  bottom: 8,
                                  left: 8,
                                  right: 8,
                                }}
                                onPress={() =>
                                  unclaimEventTask({ id: task._id }).catch(() =>
                                    Alert.alert(
                                      'שגיאה',
                                      'לא ניתן להסיר הקצאה כרגע'
                                    )
                                  )
                                }
                                style={styles.taskUnassignBtn}
                                accessible
                                accessibilityRole="button"
                                accessibilityLabel="בטל הקצאה"
                              >
                                <Text style={styles.taskUnassignBtnText}>
                                  בטל הקצאה
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        ) : (
                          <TouchableOpacity
                            hitSlop={{
                              top: 8,
                              bottom: 8,
                              left: 8,
                              right: 8,
                            }}
                            style={styles.taskClaimBtn}
                            onPress={() =>
                              claimEventTask({ id: task._id }).catch(() =>
                                Alert.alert(
                                  'שגיאה',
                                  'לא ניתן להשתבץ למשימה כרגע'
                                )
                              )
                            }
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel="אני אקח"
                          >
                            <Text style={styles.taskClaimBtnText}>אני אקח</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/*
          ── Section 4: משתתפים / RSVP response summary.
          FIX D follow-up — single canonical participant/RSVP section.
          Community RSVP Events render the tappable "תגובות משתתפים"
          summary (opens the FIX D detail modal); manual
          event.participants names, if any, are a separate concept and
          render below the summary, visually separated, under their own
          "מוזמנים (מהאירוע)" label — never merged into the
          yes/maybe/no/unanswered groups. Non-RSVP / Personal Events keep
          the original pills + chips layout unchanged.
        */}
        <View style={styles.card}>
          {hasCommunityRsvpResponses ? (
            <>
              <Pressable
                accessibilityHint="פותח רשימת משתתפים לפי סוג תגובה"
                accessibilityLabel={
                  showUnansweredRsvpSection
                    ? `תגובות משתתפים, כן ${yesCount}, אולי ${maybeCount}, לא ${noCount}, טרם ענו ${unansweredRsvpCount}. צפייה`
                    : `תגובות משתתפים, כן ${yesCount}, אולי ${maybeCount}, לא ${noCount}. צפייה`
                }
                accessibilityRole="button"
                accessible={true}
                onPress={() => setParticipantRsvpDetailsOpen(true)}
                style={({ pressed }) => [
                  styles.rsvpCommunitySummaryBtn,
                  pressed && styles.rsvpCommunitySummaryBtnPressed,
                ]}
              >
                <Text style={styles.rsvpCommunitySummarySectionTitle}>
                  תגובות משתתפים
                </Text>
                <View style={styles.rsvpCommunitySummaryRow}>
                  <Text style={styles.rsvpCommunitySummaryCounts}>
                    {showUnansweredRsvpSection
                      ? `כן ${yesCount} · אולי ${maybeCount} · לא ${noCount} · טרם ענו ${unansweredRsvpCount}`
                      : `כן ${yesCount} · אולי ${maybeCount} · לא ${noCount}`}
                  </Text>
                  <Ionicons color="#94a3b8" name="chevron-back" size={20} />
                </View>
                <Text style={styles.rsvpCommunitySummaryViewHint}>צפייה</Text>
              </Pressable>

              {hasParticipants ? (
                <View style={styles.manualParticipantsSection}>
                  <Text style={styles.manualParticipantsLabel}>
                    מוזמנים (מהאירוע)
                  </Text>
                  <View style={styles.participantChips}>
                    {participantNames.map((name) => (
                      <View key={name} style={styles.participantChip}>
                        <Text style={styles.participantChipText}>{name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>משתתפים</Text>
              <View style={styles.pillsRow}>
                <View style={[styles.pill, styles.pillYes]}>
                  <Text
                    style={[styles.pillText, styles.pillYesText]}
                  >{`מגיעים (${yesCount})`}</Text>
                </View>
                <View style={[styles.pill, styles.pillMaybe]}>
                  <Text
                    style={[styles.pillText, styles.pillMaybeText]}
                  >{`אולי (${maybeCount})`}</Text>
                </View>
                <View style={[styles.pill, styles.pillNo]}>
                  <Text
                    style={[styles.pillText, styles.pillNoText]}
                  >{`לא (${noCount})`}</Text>
                </View>
              </View>

              {hasParticipants ? (
                <View style={styles.participantChips}>
                  {participantNames.map((name) => (
                    <View key={name} style={styles.participantChip}>
                      <Text style={styles.participantChipText}>{name}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      {/* ── Creator overflow menu */}
      <OverflowMenu
        visible={menuOpen}
        position={menuPos}
        items={overflowItems}
        onClose={() => setMenuOpen(false)}
      />

      {/* ── Assignee sheet */}
      <TaskAssigneeSheet
        visible={!!assigneeSheetTaskId}
        currentAssignee={currentAssigneeForSheet}
        members={members}
        currentUserId={currentUserId}
        isCreator={canManageTasks}
        // FIX B follow-up — Community Event tasks must be account-backed:
        // only active community members may be assigned, never a manual
        // free-text name. Personal Events keep manual assignment exactly
        // as before. Existing legacy Community manual assignments are
        // untouched by this — they still display and remain unassignable
        // via onUnassign below, they just can't be newly *created* here.
        allowManualAssignee={!event.communityId}
        // FIX B final context polish — show which task is being managed,
        // Community Events only. Reuses the existing assignee-sheet task
        // lookup (_assigneeSheetTask) rather than adding a new query.
        // Personal Events omit this prop, preserving their sheet exactly.
        taskTitle={event.communityId ? _assigneeSheetTask?.title : undefined}
        manualName={manualAssigneeName}
        onManualNameChange={setManualAssigneeName}
        onSelectUser={(userId: Id<'users'>) => {
          if (!assigneeSheetTaskId) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: { type: 'user', userId },
          }).catch(() => Alert.alert('שגיאה', 'לא ניתן להקצות משימה'));
          setAssigneeSheetTaskId(null);
        }}
        onSelectManual={() => {
          if (!assigneeSheetTaskId || !manualAssigneeName.trim()) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: { type: 'manual', name: manualAssigneeName.trim() },
          }).catch(() => Alert.alert('שגיאה', 'לא ניתן להקצות משימה'));
          setAssigneeSheetTaskId(null);
          setManualAssigneeName('');
        }}
        onUnassign={() => {
          if (!assigneeSheetTaskId) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: null,
          }).catch(() => Alert.alert('שגיאה', 'לא ניתן לבטל הקצאה'));
          setAssigneeSheetTaskId(null);
        }}
        onClose={() => {
          setAssigneeSheetTaskId(null);
          setManualAssigneeName('');
        }}
      />

      {/* ── Cancel dialog */}
      <Modal visible={showCancelDialog} transparent animationType="fade">
        <View style={styles.cancelDialogCenter}>
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.4)' },
            ]}
            onPress={() => {
              setShowCancelDialog(false);
              setCancelReason('');
            }}
          />
          <View style={styles.cancelDialogCard}>
            <Text style={styles.cancelDialogTitle}>בטל אירוע</Text>
            <Text style={styles.cancelDialogBody}>{cancelDialogBody}</Text>
            <TextInput
              style={styles.cancelDialogInput}
              placeholder="סיבת ביטול (אופציונלי)"
              placeholderTextColor="#9ca3af"
              value={cancelReason}
              onChangeText={setCancelReason}
              textAlign="right"
              multiline
              numberOfLines={2}
            />
            <View style={styles.cancelDialogButtons}>
              <TouchableOpacity
                style={styles.cancelDialogBtnBack}
                onPress={() => {
                  setShowCancelDialog(false);
                  setCancelReason('');
                }}
                accessible
                accessibilityRole="button"
                accessibilityLabel="חזור"
              >
                <Text style={styles.cancelDialogBtnBackText}>חזור</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelDialogBtnConfirm}
                onPress={handleCancelEvent}
                accessible
                accessibilityRole="button"
                accessibilityLabel="בטל אירוע"
              >
                <Text style={styles.cancelDialogBtnConfirmText}>בטל אירוע</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/*
        FIX D — Community RSVP response detail modal (Full Screen parity
        with EventDetailsBottomSheet.tsx's participantRsvpDetailsOpen).
        Regular members see כן/אולי/לא only; managers (creator or active
        owner/admin) additionally see "טרם ענו" with unanswered active
        members' names. Must remain viewable for a cancelled Community
        Event. Closes via backdrop tap, the visible "סגירה" button, or
        Android back (onRequestClose) — all three call the same handler.
      */}
      <Modal
        animationType="slide"
        onRequestClose={() => setParticipantRsvpDetailsOpen(false)}
        transparent
        visible={participantRsvpDetailsOpen}
      >
        <Pressable
          accessibilityLabel="סגור"
          accessibilityRole="button"
          accessible={true}
          onPress={() => setParticipantRsvpDetailsOpen(false)}
          style={styles.rsvpDetailModalBackdrop}
        />
        <View style={styles.rsvpDetailModalSheet}>
          <Text style={styles.rsvpDetailModalTitle}>תגובות משתתפים</Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.rsvpDetailScroll}
            contentContainerStyle={styles.rsvpDetailScrollContent}
          >
            <View style={styles.rsvpDetailGroup}>
              <Text
                style={styles.rsvpDetailGroupTitle}
              >{`כן (${yesCount})`}</Text>
              {rsvpRows.filter((r) => r.status === 'yes').length === 0 ? (
                <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
              ) : (
                rsvpRows
                  .filter((r) => r.status === 'yes')
                  .map((r) => (
                    <Text key={r._id} style={styles.rsvpDetailName}>
                      {rsvpRowDisplayName(r)}
                    </Text>
                  ))
              )}
            </View>
            <View style={styles.rsvpDetailGroup}>
              <Text
                style={styles.rsvpDetailGroupTitle}
              >{`אולי (${maybeCount})`}</Text>
              {rsvpRows.filter((r) => r.status === 'maybe').length === 0 ? (
                <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
              ) : (
                rsvpRows
                  .filter((r) => r.status === 'maybe')
                  .map((r) => (
                    <Text key={r._id} style={styles.rsvpDetailName}>
                      {rsvpRowDisplayName(r)}
                    </Text>
                  ))
              )}
            </View>
            <View style={styles.rsvpDetailGroup}>
              <Text
                style={styles.rsvpDetailGroupTitle}
              >{`לא (${noCount})`}</Text>
              {rsvpRows.filter((r) => r.status === 'no').length === 0 ? (
                <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
              ) : (
                rsvpRows
                  .filter((r) => r.status === 'no')
                  .map((r) => (
                    <Text key={r._id} style={styles.rsvpDetailName}>
                      {rsvpRowDisplayName(r)}
                    </Text>
                  ))
              )}
            </View>
            {showUnansweredRsvpSection ? (
              <View style={styles.rsvpDetailGroup}>
                <Text
                  style={styles.rsvpDetailGroupTitle}
                >{`טרם ענו (${unansweredRsvpCount})`}</Text>
                {unansweredCommunityMembers.length === 0 ? (
                  <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
                ) : (
                  unansweredCommunityMembers.map((m) => (
                    <Text key={m.userId} style={styles.rsvpDetailName}>
                      {unansweredMemberDisplayName(m)}
                    </Text>
                  ))
                )}
              </View>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityLabel="סגירת רשימת משתתפים"
            accessibilityRole="button"
            accessible={true}
            onPress={() => setParticipantRsvpDetailsOpen(false)}
            style={styles.rsvpDetailCloseBtn}
          >
            <Text style={styles.rsvpDetailCloseBtnText}>סגירה</Text>
          </Pressable>
        </View>
      </Modal>
      <RsvpBlockedByTaskDialog
        assignedTaskCount={blockedRsvpTaskCount ?? 1}
        onClose={() => setBlockedRsvpTaskCount(null)}
        onConfirm={() => {
          if (!eventId) return;
          setBlockedRsvpTaskCount(null);
          setRsvpNoAndUnclaimMyEventTasks({ eventId }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן לעדכן אישור הגעה')
          );
        }}
        visible={blockedRsvpTaskCount !== null}
      />
      {/*
        FIX A — same confirmation semantics as
        EventDetailsBottomSheet.tsx's calendarRemoveConfirmationEventId flow:
        shown when removal is blocked by active assigned event tasks (either
        pre-checked client-side or via the CALENDAR_REMOVE_CONFIRMATION_CODE
        server error), and confirms by re-calling
        removeCommunityEventFromMyCalendar with confirmRemoveWithActiveTask.
      */}
      <AppConfirmationDialog
        cancelLabel="ביטול"
        confirmDestructive
        confirmLabel="להסיר בכל זאת"
        message={CALENDAR_REMOVE_CONFIRM_MESSAGE}
        onCancel={handleCancelCalendarRemoval}
        onConfirm={handleConfirmCalendarRemoval}
        title={CALENDAR_REMOVE_CONFIRM_TITLE}
        visible={calendarRemoveConfirmEventId !== null}
      />
      {/*
        FIX C — Bottom Sheet parity: soft Community-display removal of a
        cancelled Community Event, never a hard delete. Same copy as
        EventDetailsBottomSheet.tsx's equivalent confirmation.
      */}
      <AppConfirmationDialog
        cancelLabel="ביטול"
        confirmDestructive
        confirmLabel="הסר מהקהילה"
        message="האירוע ייעלם מיד מהתצוגה לחברי הקהילה ולא יוצג יותר כאירוע שבוטל."
        onCancel={() => setShowRemoveFromCommunityDialog(false)}
        onConfirm={handleRemoveFromCommunity}
        title="להסיר את האירוע מהקהילה?"
        visible={showRemoveFromCommunityDialog}
      />
      <NavigationPickerModal
        location={navPickerLocation}
        latitude={parseGeoUri(navPickerLocationUrl)?.lat}
        longitude={parseGeoUri(navPickerLocationUrl)?.lng}
        onClose={() => setNavPickerLocation(null)}
        visible={navPickerLocation !== null}
      />
      <UpgradeModal
        visible={upgradeModalVisible}
        reason="general"
        onClose={() => setUpgradeModalVisible(false)}
      />
      {/*
        Full Screen parity with EventDetailsBottomSheet.tsx's in-app image
        preview modal: closable via close icon, close button, or the
        Android hardware back button (onRequestClose).
      */}
      <Modal
        animationType="fade"
        onRequestClose={() => setPreviewImageUrl(null)}
        transparent
        visible={previewImageUrl !== null}
      >
        <View style={styles.previewBackdrop}>
          <Pressable
            accessibilityLabel="סגור תצוגת תמונה"
            accessibilityRole="button"
            accessible={true}
            onPress={() => setPreviewImageUrl(null)}
            style={styles.previewCloseIcon}
          >
            <Ionicons color="#fff" name="close" size={24} />
          </Pressable>
          {previewImageUrl ? (
            <Image
              resizeMode="contain"
              source={{ uri: previewImageUrl }}
              style={styles.previewImage}
            />
          ) : null}
          <Pressable
            accessibilityLabel="סגירת תצוגה מקדימה"
            accessibilityRole="button"
            accessible={true}
            onPress={() => setPreviewImageUrl(null)}
            style={styles.previewCloseBtn}
          >
            <Text style={styles.previewCloseText}>סגירה</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type FullScreenAttachment = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

// Mirrors EventDetailsBottomSheet.tsx's AttachmentRow: image attachments get
// an in-app preview (via onPreviewImage), non-image attachments open
// externally with Linking.openURL. Kept as its own component (rather than
// inline in .map()) so useQuery is not called inside a loop.
function FullScreenAttachmentRow({
  attachment,
  eventId,
  onPreviewImage,
}: {
  attachment: FullScreenAttachment;
  eventId: Id<'events'> | null;
  onPreviewImage: (url: string) => void;
}): React.JSX.Element {
  const fileUrl = useQuery(
    api.events.getEventAttachmentUrl,
    eventId ? { eventId, storageId: attachment.storageId } : 'skip'
  );
  const isImage = attachment.mimeType.startsWith('image/');

  const previewFile = (): void => {
    if (!fileUrl) {
      Alert.alert('קובץ מצורף', 'הקובץ עדיין לא זמין לפתיחה');
      return;
    }

    if (isImage) {
      onPreviewImage(fileUrl);
      return;
    }

    Alert.alert('קובץ מצורף', 'לא ניתן להציג את הקובץ באפליקציה');
  };

  const openFile = (): void => {
    if (!fileUrl) {
      Alert.alert('קובץ מצורף', 'הקובץ עדיין לא זמין לפתיחה');
      return;
    }

    Linking.openURL(fileUrl).catch(() =>
      Alert.alert('שגיאה', 'לא ניתן לפתוח את הקובץ')
    );
  };

  return (
    <View style={styles.attachmentCard}>
      {isImage && fileUrl ? (
        <Image
          accessibilityLabel={attachment.displayName || attachment.originalName}
          resizeMode="cover"
          source={{ uri: fileUrl }}
          style={styles.attachmentThumb}
        />
      ) : (
        <View style={styles.attachmentIconBox}>
          <Ionicons
            color={PRIMARY}
            name={isImage ? 'image-outline' : 'document-outline'}
            size={20}
          />
        </View>
      )}

      <View style={styles.attachmentContent}>
        <Text style={styles.attachmentName} numberOfLines={1}>
          {attachment.displayName || attachment.originalName}
        </Text>

        <Text style={styles.attachmentMeta} numberOfLines={1}>
          {[attachment.mimeType, formatFileSize(attachment.sizeBytes)]
            .filter(Boolean)
            .join(' · ')}
        </Text>

        <View style={styles.attachmentActions}>
          <Pressable
            accessibilityLabel="צפייה בקובץ"
            accessibilityRole="button"
            accessible={true}
            onPress={previewFile}
            style={styles.smallActionBtn}
          >
            <Text style={styles.smallActionText}>צפייה</Text>
          </Pressable>

          {fileUrl ? (
            <Pressable
              accessibilityLabel="הורדת קובץ"
              accessibilityRole="button"
              accessible={true}
              onPress={openFile}
              style={styles.smallActionBtn}
            >
              <Text style={styles.smallActionText}>הורדה</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f7f8',
    ...Platform.select({
      android: { direction: 'rtl' as const },
      default: {},
    }),
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  // ── Header (RTL: first=right, last=left)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 8,
  },
  headerRtl: {
    flexDirection: 'row-reverse',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },

  // ── Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    alignItems: 'stretch',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  // ── Detail rows (אייקון בימין, טקסט מיושר ימינה — row-reverse עקבי באנדרואיד / iOS)
  detailRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  locationDetailRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  locationTextPressable: {
    flex: 1,
    minHeight: 44,
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 10,
  },
  navigateInlineBtn: {
    minHeight: 34,
    minWidth: 60,
    flexDirection: HEB_ROW,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(141,110,99,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  navigateInlineBtnText: {
    color: '#8d6e63',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  dateTextBlock: {
    flex: 1,
    alignItems: 'stretch',
  },
  detailText: {
    fontSize: 14,
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    flex: 1,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  hebrewDateLine: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '400',
    writingDirection: HEB_WRITING_DIRECTION,
    alignSelf: 'stretch',
    marginTop: 2,
  },
  linkText: {
    fontSize: 14,
    color: PRIMARY,
    textAlign: HEB_TEXT_ALIGN,
    flex: 1,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  separator: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  descriptionText: {
    fontSize: 14,
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    lineHeight: 22,
  },
  descriptionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
  },
  scheduleRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  scheduleText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '600',
  },
  reminderRows: {
    gap: 8,
  },
  reminderDisplayRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e8f5fd',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reminderDisplayText: {
    flex: 1,
    fontSize: 14,
    color: PRIMARY,
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '600',
  },

  // ── Attachments
  attachmentsList: {
    gap: 8,
  },
  attachmentRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    padding: 12,
  },
  attachmentContent: {
    flex: 1,
    alignItems: HEB_FLEX_END,
    gap: 2,
  },
  attachmentName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
  },
  attachmentMeta: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: HEB_TEXT_ALIGN,
  },
  attachmentCard: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 8,
  },
  attachmentThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  attachmentIconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentActions: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  smallActionBtn: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  previewImage: {
    width: '100%',
    height: '72%',
  },
  previewCloseIcon: {
    position: 'absolute',
    top: 56,
    left: 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCloseBtn: {
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  previewCloseText: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '800',
  },

  // ── RSVP
  rsvpCardElevated: {
    zIndex: 2,
    elevation: 4,
    gap: 10,
  },
  rsvpTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    alignSelf: 'stretch',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpRow: {
    flexDirection: HEB_ROW,
    gap: 6,
    alignItems: 'stretch',
    alignSelf: 'stretch',
    width: '100%',
  },
  rsvpBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  rsvpBtnSelected: {
    elevation: 3,
    shadowOpacity: 0.12,
  },
  rsvpBtnText: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
    includeFontPadding: false,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDisabled: { opacity: 0.4 },

  // ── FIX D — RSVP response summary + detail modal (parity with
  // components/EventDetailsBottomSheet.tsx's equivalent styles)
  rsvpCommunitySummaryBtn: {
    alignSelf: 'stretch',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    width: '100%',
  },
  rsvpCommunitySummaryBtnPressed: {
    backgroundColor: '#e8f0f6',
  },
  rsvpCommunitySummarySectionTitle: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    marginBottom: 4,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpCommunitySummaryRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  rsvpCommunitySummaryCounts: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpCommunitySummaryViewHint: {
    alignSelf: 'stretch',
    fontSize: 12,
    fontWeight: '600',
    color: PRIMARY,
    textAlign: HEB_TEXT_ALIGN,
    marginTop: 6,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  // FIX D follow-up — manual event.participants names shown below the
  // RSVP response summary in the merged "משתתפים" card; visually
  // separated from the yes/maybe/no/unanswered groups above.
  manualParticipantsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  manualParticipantsLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    marginBottom: 8,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.32)',
  },
  rsvpDetailModalSheet: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 26,
    maxHeight: '72%',
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  rsvpDetailModalTitle: {
    alignSelf: 'stretch',
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailScroll: {
    flexGrow: 0,
  },
  rsvpDetailScrollContent: {
    gap: 18,
    paddingBottom: 8,
    width: '100%',
  },
  rsvpDetailGroup: {
    gap: 6,
    width: '100%',
  },
  rsvpDetailGroupTitle: {
    alignSelf: 'stretch',
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailName: {
    alignSelf: 'stretch',
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    textAlign: HEB_TEXT_ALIGN,
    paddingVertical: 2,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailEmpty: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailCloseBtn: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpDetailCloseBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#475569',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },

  // ── Cancelled banner
  cancelledBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
    gap: 6,
  },
  cancelledBannerRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  cancelledBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#dc2626',
    textAlign: HEB_TEXT_ALIGN,
  },
  cancelledBannerReason: {
    fontSize: 13,
    color: '#dc2626',
    textAlign: HEB_TEXT_ALIGN,
  },

  // ── FIX C.1: inline Community management action row. Wraps to a second
  // line (rather than clipping or horizontal scroll) when 4+ actions don't
  // fit on narrow devices — see communityActionBtn's flexible sizing.
  communityActionRow: {
    flexDirection: HEB_ROW,
    gap: 6,
    marginBottom: 4,
    width: '100%',
  },
  communityActionBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  communityActionBtnDanger: {
    borderColor: '#fca5a5',
    backgroundColor: '#fff5f5',
  },
  communityActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    textAlign: HEB_TEXT_ALIGN,
  },
  communityActionBtnTextDanger: {
    color: '#dc2626',
  },

  // ── Cancel dialog
  cancelDialogCenter: {
    flex: 1,
    justifyContent: 'center',
  },
  cancelDialogCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 24,
  },
  cancelDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: HEB_TEXT_ALIGN,
    color: '#111827',
  },
  cancelDialogBody: {
    marginTop: 8,
    fontSize: 14,
    color: '#6b7280',
    textAlign: HEB_TEXT_ALIGN,
  },
  cancelDialogInput: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
  },
  cancelDialogButtons: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 8,
  },
  cancelDialogBtnBack: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDialogBtnBackText: {
    color: '#374151',
  },
  cancelDialogBtnConfirm: {
    flex: 1,
    backgroundColor: '#ef4444',
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDialogBtnConfirmText: {
    color: '#fff',
    fontWeight: '700',
  },

  // ── Passive state
  passiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'flex-end',
  },
  passiveText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: HEB_TEXT_ALIGN,
    flex: 1,
  },
  openCalendarBtn: {
    width: '100%',
    minHeight: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#7dd3fc',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 14,
  },
  openCalendarBtnPressed: {
    opacity: 0.9,
  },
  openCalendarBtnText: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  rsvpCalendarActionBtn: {
    width: '100%',
    minHeight: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#7dd3fc',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rsvpCalendarActionBtnPressed: {
    opacity: 0.9,
  },
  rsvpCalendarActionText: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },

  // ── Important items
  importantItemsList: {
    gap: 8,
    width: '100%',
  },
  importantItemsHeaderChip: {
    alignSelf: HEB_FLEX_END,
    backgroundColor: '#E6F4FB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BAE6FD',
  },
  importantItemsHeaderChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0369a1',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  importantItemRow: {
    flexDirection: HEB_ROW,
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
  },
  importantItemBullet: {
    fontSize: 16,
    color: PRIMARY,
    lineHeight: 22,
  },
  importantItemText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    lineHeight: 22,
    fontWeight: '500',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  importantItemDeleteBtn: {
    padding: 4,
  },
  importantItemsCopyBtn: {
    marginTop: 4,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderWidth: 2,
    borderColor: PRIMARY,
  },
  importantItemsCopiedBtn: {
    marginTop: 4,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderWidth: 2,
    borderColor: '#7dd3fc',
  },
  importantItemsCopyBtnPressed: {
    opacity: 0.9,
  },
  importantItemsCopyBtnDisabled: {
    opacity: 0.55,
  },
  importantItemsCopyBtnText: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  importantItemsCopiedBtnText: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  importantItemsCopyError: {
    fontSize: 13,
    color: '#ef4444',
    textAlign: HEB_TEXT_ALIGN,
  },

  // ── Participants
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillYes: { backgroundColor: '#dcfce7' },
  pillYesText: { color: '#16a34a' },
  pillMaybe: { backgroundColor: '#fef9c3' },
  pillMaybeText: { color: '#ca8a04' },
  pillNo: { backgroundColor: '#fee2e2' },
  pillNoText: { color: '#dc2626' },
  participantChips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantChip: {
    borderRadius: 999,
    backgroundColor: '#e8f5fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  participantChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
  },
  emptyParticipants: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  emptyParticipantsText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },

  // ── Tasks
  taskSectionHeader: {
    flexDirection: HEB_ROW,
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  taskSectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
  },
  taskVisibilitySection: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
    marginBottom: 4,
  },
  taskVisibilityTextBlock: {
    flex: 1,
    alignItems: HEB_FLEX_END,
    gap: 2,
  },
  taskVisibilityTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
  },
  taskVisibilityHelper: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: HEB_TEXT_ALIGN,
  },
  managerVisibilityRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F8FAFB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E9EB',
  },
  managerVisibilityTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  managerVisibilityTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    textAlign: HEB_TEXT_ALIGN,
  },
  managerVisibilityDesc: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 1,
    textAlign: HEB_TEXT_ALIGN,
  },
  taskVisibilityToggleTouch: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskVisibilityToggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#d1d5db',
    padding: 3,
    justifyContent: 'center',
  },
  taskVisibilityToggleTrackOn: {
    backgroundColor: PRIMARY,
  },
  taskVisibilityToggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  taskVisibilityToggleThumbOn: {
    alignSelf: 'flex-end',
  },
  taskSummary: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '600',
    textAlign: 'left',
  },
  taskSummaryAllDone: {
    color: '#16a34a',
  },
  tasksList: { gap: 0 },
  taskRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
    width: '100%',
  },
  taskContent: {
    flex: 1,
    alignItems: 'stretch',
    gap: 6,
    minWidth: 0,
  },
  taskTitle: {
    alignSelf: 'stretch',
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  // FIX B — completed task title styling, matching
  // EventDetailsBottomSheet.tsx's detailListTitleCompleted exactly.
  taskTitleCompleted: {
    color: '#92999C',
    textDecorationLine: 'line-through',
  },
  // FIX B — completion checkbox, matching
  // EventDetailsBottomSheet.tsx's eventTaskCheckbox* styles exactly.
  eventTaskCheckboxTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
  },
  eventTaskCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(0,102,142,0.45)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eventTaskCheckboxDone: {
    backgroundColor: '#00668E',
    borderColor: '#00668E',
  },
  eventTaskCheckboxDisabled: {
    borderColor: '#D4D8DA',
    backgroundColor: 'transparent',
  },
  eventTaskCheckboxDoneDisabled: {
    backgroundColor: '#C4C9CB',
    borderColor: '#C4C9CB',
  },
  // FIX B — self-claim / self-unclaim buttons, matching
  // EventDetailsBottomSheet.tsx's taskAssignmentAction /
  // taskUnassignAction styles exactly.
  // VISUAL ALIGNMENT — matches components/EventDetailsBottomSheet.tsx's
  // taskAssignmentAction/taskAssignmentActionText (filled #00668E pill,
  // white text) so the canonical full-screen claim CTA reads with the
  // same primary, filled-button visual language as the Bottom Sheet,
  // kept compact for the task row (content-sized, not full-card width).
  //
  // STRUCTURAL FIX — split into a layout-only Pressable
  // (taskSelfClaimBtnPressable) and a plain inner View that carries all
  // paint (taskSelfClaimBtnFill), mirroring
  // EventDetailsBottomSheet.tsx's taskAssignmentActionPressable /
  // taskAssignmentAction split exactly. Root cause: this screen's
  // ancestor `styles.card` sets Android `elevation` + `borderRadius`,
  // which is a known trigger for Android failing to paint a
  // Pressable's *own* rounded backgroundColor while leaving it fully
  // interactive — moving the fill to a non-Pressable child View avoids
  // that rendering path. Values are unchanged from the prior
  // `taskSelfClaimBtn` definition, only which element they're attached
  // to has changed.
  taskSelfClaimBtnPressable: {
    alignSelf: HEB_FLEX_END,
  },
  taskSelfClaimBtnFill: {
    minHeight: 36,
    minWidth: 80,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#00668E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskSelfClaimBtnPressed: {
    opacity: 0.84,
  },
  taskSelfClaimBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  taskSelfUnclaimBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskSelfUnclaimBtnPressed: {
    opacity: 0.84,
  },
  taskSelfUnclaimBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  taskAssignedLabel: {
    alignSelf: 'stretch',
    fontSize: 12,
    color: PRIMARY,
    fontWeight: '600',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskAssignedOtherLabel: {
    alignSelf: 'stretch',
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskUnassignedLabel: {
    alignSelf: 'stretch',
    fontSize: 12,
    color: '#9ca3af',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskAssignmentAction: {
    minHeight: 32,
    justifyContent: 'center',
    alignSelf: HEB_FLEX_END,
    alignItems: HEB_FLEX_END,
  },
  taskAssignmentStatusRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    gap: 10,
  },
  // Personal Event claim/unclaim — restored pre-FIX-B styles (Community
  // Events use the new taskSelfClaimBtn/taskSelfUnclaimBtn styles above).
  taskClaimBtn: {
    minHeight: 32,
    alignSelf: HEB_FLEX_END,
    alignItems: HEB_FLEX_END,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  taskClaimBtnText: {
    color: PRIMARY,
    fontSize: 13,
    fontWeight: '800',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskUnassignBtn: {
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  taskUnassignBtnText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskActions: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
  },
  taskActionBtn: { padding: 4 },
  // FIX B follow-up — clear, tappable manager assignment pill used in
  // Community Event task rows only (replaces the icon-only control).
  taskManagerAssignPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(54,169,226,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(54,169,226,0.35)',
  },
  taskManagerAssignPillPressed: {
    opacity: 0.75,
  },
  taskManagerAssignPillText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PRIMARY,
  },

  // ── Error states
  notFoundText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  errorBackBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 8,
  },
  errorBackBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
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
  popoverLabel: {
    fontSize: 15,
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    flex: 1,
  },
  popoverDanger: { color: '#ef4444' },
});
