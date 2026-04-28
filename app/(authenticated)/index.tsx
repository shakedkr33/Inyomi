import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { EventItem } from '@/components/EventDetailsBottomSheet';
import { EventDetailsBottomSheet } from '@/components/EventDetailsBottomSheet';
import { TaskCheckbox } from '@/components/TaskCheckbox';
import { useNotifications } from '@/contexts/NotificationsContext';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useBirthdaySheets } from '@/lib/components/birthday/BirthdaySheetsProvider';
import { NotificationsDrawer } from '@/lib/components/notifications/NotificationsDrawer';
import { getCountdownLabel, getNextOccurrence } from '@/lib/utils/birthday';

const { width: screenWidth } = Dimensions.get('window');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Mood data ────────────────────────────────────────────────────────────────

const MOODS = [
  { value: 2, label: 'טוב', emoji: '😊' },
  { value: 1, label: 'רגיל', emoji: '😐' },
  { value: 0, label: 'עמוס', emoji: '😓' },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Item = {
  id: string;
  time: string;
  endTime?: string;
  title: string;
  location: string;
  type: 'event' | 'task';
  icon: string;
  iconBg: string;
  iconColor: string;
  assigneeColor: string;
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
};

type UndatedTask = {
  id: string;
  title: string;
  completed: boolean;
};

// ─── Inline face mood (cream/boho tone — emoji cannot be recolored) ─────────

function FaceMood({ value }: { value: 0 | 1 | 2 }) {
  return (
    <View
      style={{
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: '#F5E6C8',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Eyes */}
      <View
        style={{
          flexDirection: 'row',
          gap: 7,
          marginTop: -4,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#4a3728',
          }}
        />
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#4a3728',
          }}
        />
      </View>
      {/* Mouth — happy */}
      {value === 2 && (
        <View
          style={{
            width: 18,
            height: 9,
            borderBottomLeftRadius: 9,
            borderBottomRightRadius: 9,
            borderWidth: 2,
            borderColor: '#4a3728',
            borderTopWidth: 0,
            marginTop: 5,
          }}
        />
      )}
      {/* Mouth — neutral */}
      {value === 1 && (
        <View
          style={{
            width: 14,
            height: 2,
            backgroundColor: '#4a3728',
            borderRadius: 1,
            marginTop: 7,
          }}
        />
      )}
      {/* Mouth — stressed: small open oval (anxious, not sad) */}
      {value === 0 && (
        <View
          style={{
            width: 13,
            height: 9,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: '#4a3728',
            marginTop: 6,
          }}
        />
      )}
      {/* Sweat drop for עמוס — teardrop shape */}
      {value === 0 && (
        <View
          style={{
            position: 'absolute',
            top: 5,
            right: 7,
            width: 5,
            height: 9,
            borderTopLeftRadius: 2,
            borderTopRightRadius: 2,
            borderBottomLeftRadius: 5,
            borderBottomRightRadius: 5,
            backgroundColor: 'rgba(100,160,220,0.7)',
          }}
        />
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { openBirthdayCard, birthdays: contextBirthdays } = useBirthdaySheets();

  // ── Convex: spaceId ────────────────────────────────────────────────────────
  // TODO: כאשר defaultSpaceId ייאכלס ב-onboarding, לעבור לשליפה ישירה מ-user.defaultSpaceId
  // getMySpace מחזיר את ה-spaceId ישירות (Id<'spaces'> | null)
  const spaceId = useQuery(api.users.getMySpace);

  // ── Convex: current user (for greeting name + avatar) ─────────────────────
  const currentUser = useQuery(api.users.getCurrentUser);
  const userFirstName = currentUser?.fullName?.split(' ')[0] ?? null;

  // ── Convex: tasks mutations ────────────────────────────────────────────────
  const toggleCompletedMutation = useMutation(api.tasks.toggleCompleted);
  const [showToast, setShowToast] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [moodByDate, setMoodByDate] = useState<Record<string, number>>({});
  const [calendarMode, setCalendarMode] = useState<'carousel' | 'month'>(
    'carousel'
  );
  const [devClearBirthdays, setDevClearBirthdays] = useState(false);

  // ── Insight card ───────────────────────────────────────────────────────────
  const [dismissedInsightDate, setDismissedInsightDate] = useState<
    string | null
  >(null);

  // ── Event detail sheet ─────────────────────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isEventSheetVisible, setIsEventSheetVisible] = useState(false);
  const lastDragCloseTime = useRef<number>(0);

  // ── Navigation app picker ──────────────────────────────────────────────────
  const [navPickerVisible, setNavPickerVisible] = useState(false);
  const [navLocation, setNavLocation] = useState<string | null>(null);
  const [lastNavApp, setLastNavApp] = useState<
    'waze' | 'google' | 'apple' | null
  >(null);

  // ── RSVP (replaces pendingResponses + expandedPendingId) ──────────────────
  const [openRsvpForId, setOpenRsvpForId] = useState<string | null>(null);

  // ── Undated tasks "show all" modal ─────────────────────────────────────────
  const [showAllUndated, setShowAllUndated] = useState(false);

  const openEventSheet = (item: Item) => {
    if (Date.now() - lastDragCloseTime.current < 600) return;

    setSelectedEvent({
      ...(item as EventItem),
      canEdit: item.linkedEventId ? false : undefined,
    });
    setSelectedEventId(item.linkedEventId ? null : item.id);
    setIsEventSheetVisible(true);
  };
  const closeEventSheet = () => {
    setIsEventSheetVisible(false);
    setSelectedEvent(null);
    setSelectedEventId(null);
  };

  const dateScrollRef = useRef<ScrollView>(null);

  const {
    unseenCount,
    markAllSeen,
    isLoading: notifLoading,
  } = useNotifications();

  const handleBellPress = (): void => {
    if (!isNotificationsOpen) setIsNotificationsOpen(true);
    if (!notifLoading) markAllSeen();
  };

  // ── Computed values ────────────────────────────────────────────────────────
  const greeting = getGreetingByHour(new Date().getHours());
  const todayLabel = new Date().toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const todayISO = new Date().toISOString().split('T')[0];

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarDays: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++)
    calendarDays.push(new Date(year, month, d));
  for (let d = 1; d <= 7; d++) calendarDays.push(new Date(year, month + 1, d));

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

  const communityEvents =
    useQuery(api.events.listCommunityEventsForDate, { from, to }) ?? [];

  // ── Personal events for selected date ─────────────────────────────────────
  const personalEventData =
    useQuery(
      api.events.listByDateRange,
      spaceId ? { spaceId: spaceId as Id<'spaces'>, from, to } : 'skip'
    ) ?? [];

  // FIXED: linked (shared) events for selected date — merged into timeline
  const linkedEventData =
    useQuery(
      api.linkedEvents.getLinkedEventsForSpace,
      spaceId ? { spaceId: spaceId as Id<'spaces'>, from, to } : 'skip'
    ) ?? [];

  const assignedEventTasks =
    useQuery(api.eventTasks.listMyAssignedEventTasksForDate, { from, to }) ??
    [];

  // ── Convex: dated tasks ────────────────────────────────────────────────────
  const convexTasks = useQuery(
    api.tasks.listBySpace,
    spaceId ? { spaceId } : 'skip'
  );

  const todayTasks: Item[] = useMemo(
    () =>
      (convexTasks ?? [])
        .filter(
          (t) =>
            t.dueDate != null && isSameDay(new Date(t.dueDate), selectedDate)
        )
        .map((t) => ({
          id: t._id,
          time: t.dueDate
            ? new Date(t.dueDate).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '',
          title: t.title,
          location: '',
          type: 'task' as const,
          icon: 'check-box',
          iconBg: '#E7F5FF',
          iconColor: '#228BE6',
          assigneeColor: '#E7F5FF',
          completed: t.completed,
          // TODO: להוסיף category, assignedTo, notes כשהסכמה תורחב
        })),
    [convexTasks, selectedDate]
  );

  // ── Community event items mapped to Item shape ────────────────────────────
  const communityEventItems: Item[] = useMemo(() => {
    const taskCountByEvent: Record<string, number> = {};
    for (const t of assignedEventTasks) {
      taskCountByEvent[t.eventId] = (taskCountByEvent[t.eventId] ?? 0) + 1;
    }
    return communityEvents.map((ev) => {
      const count = taskCountByEvent[ev._id] ?? 0;
      const personalTaskSummary =
        count === 0
          ? undefined
          : count === 1
            ? 'יש לך משימה אחת באירוע הזה'
            : `יש לך ${count} משימות באירוע הזה`;
      return {
        id: ev._id,
        time: ev.allDay
          ? ''
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
        title: ev.title,
        location: ev.location ?? '',
        type: 'event' as const,
        icon: 'event',
        iconBg: '#E8F5FD',
        iconColor: '#36a9e2',
        assigneeColor: '#36a9e2',
        completed: false,
        allDay: ev.allDay,
        groupName: ev.communityName,
        communityId: ev.communityId,
        personalTaskSummary,
        isRecurring: undefined,
        recurringPattern: undefined,
      };
    });
  }, [communityEvents, assignedEventTasks]);

  // ── Assigned event task items mapped to Item shape ────────────────────────
  const assignedTaskItems: Item[] = useMemo(
    () =>
      assignedEventTasks.map((t) => ({
        id: t._id,
        time: t.eventAllDay
          ? ''
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
        completed: false,
        allDay: t.eventAllDay,
        groupName: t.communityName,
      })),
    [assignedEventTasks]
  );

  // ── Personal events for selected date mapped to Item shape ───────────────
  const personalEventItems: Item[] = useMemo(
    () =>
      personalEventData.map((ev) => ({
        id: ev._id,
        time: ev.allDay
          ? ''
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
        title: ev.title,
        location: ev.location ?? '',
        type: 'event' as const,
        icon: 'event',
        iconBg: '#e8f5fd',
        iconColor: '#36a9e2',
        assigneeColor: '#36a9e2',
        completed: false,
        allDay: ev.allDay,
        isRecurring: ev.isRecurring,
        recurringPattern: ev.recurringPattern,
        reminders: (ev as { reminders?: number[] }).reminders,
      })),
    [personalEventData]
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
            ? ''
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
          title: ev.title,
          location: ev.location ?? '',
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
        isRecurring: undefined,
        recurringPattern: undefined,
        linkedEventId: i.linkedEventId,
      }));
    const personalAllDay = personalEventItems
      .filter((i) => i.allDay)
      .map((i) => ({
        id: i.id,
        title: i.title,
        iconColor: i.iconColor,
        groupName: undefined,
        isRecurring: i.isRecurring,
        recurringPattern: i.recurringPattern,
        reminders: i.reminders,
      }));
    // FIXED: include linked all-day events in all-day strip
    const linkedAllDay = linkedEventItems
      .filter((i) => i.allDay)
      .map((i) => ({
        id: i.id,
        title: i.title,
        iconColor: i.iconColor,
        groupName: i.groupName,
        isRecurring: undefined,
        recurringPattern: undefined,
      }));
    return [...communityAllDay, ...personalAllDay, ...linkedAllDay];
  }, [communityEventItems, personalEventItems, linkedEventItems]);

  // allItems = personal events + tasks (today) + mock items + community events + assigned tasks
  const allItems = useMemo(() => {
    const timedPersonalEvents = personalEventItems.filter((i) => !i.allDay);
    const timedCommunityEvents = communityEventItems.filter((i) => !i.allDay);
    // Assigned event tasks appear as separate actionable items in the timeline.
    // communityEventItems uses event._id; assignedTaskItems uses task._id — no collision.
    // Deduplicate by id as a conservative guard.
    const timedAssignedTasks = assignedTaskItems.filter((i) => !i.allDay);
    // FIXED: linked events merged into timeline (timed only; all-day handled separately)
    const timedLinkedEvents = linkedEventItems.filter((i) => !i.allDay);
    const seen = new Set<string>();
    const deduped: Item[] = [];
    for (const item of [
      ...todayTasks,
      ...items,
      ...timedPersonalEvents,
      ...timedLinkedEvents,
      ...timedCommunityEvents,
      ...timedAssignedTasks,
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
  }, [todayTasks, items, personalEventItems, linkedEventItems, communityEventItems, assignedTaskItems]);

  // ── Convex: undated tasks ──────────────────────────────────────────────────
  const convexUndatedTasks = useQuery(
    api.tasks.listUndated,
    spaceId ? { spaceId } : 'skip'
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
      (convexUndatedTasks ?? []).map((t) => ({
        id: t._id,
        title: t.title,
        completed: t.completed,
      })),
    [convexUndatedTasks]
  );

  const toggleUndatedTask = async (id: string) => {
    try {
      await toggleCompletedMutation({ id: id as Id<'tasks'> });
    } catch (e) {
      console.error('toggleUndatedTask error:', e);
      // TODO: להוסיף optimistic UI בעתיד
    }
  };

  // ── Empty states ───────────────────────────────────────────────────────────
  const hasEventsOrTasks = allItems.length > 0 || undatedTasks.length > 0;
  const hasBirthdays = devClearBirthdays ? false : contextBirthdays.length > 0;
  const hasDayData = allItems.filter((i) => !i.allDay).length > 0;

  const shouldShowEventsEmptyState = !hasEventsOrTasks;
  const shouldShowBirthdaysEmptyState = !hasBirthdays;
  const canShowMoodFeatures = hasEventsOrTasks;
  // TODO: בעתיד לחבר לסטטוס אמיתי של משתמש חדש מ-Convex

  // TODO: להוסיף בעתיד מסך/התראות לאירועים שנדחו כדי לאפשר חרטה
  const visibleItems = allItems.filter((i) => i.rsvpStatus !== 'no');

  // ── Insight card ───────────────────────────────────────────────────────────
  // TODO: re-enable when AI insight is ready
  // const showInsightCard = hasEventsOrTasks && dismissedInsightDate !== todayISO;
  // const insightText = allItems.length > 3
  //   ? 'יש לך יום עמוס היום, שווה לשקול להזיז משימה אחת למחר.'
  //   : 'היום שלך נראה רגוע, אולי זה זמן טוב להשלים משהו קטן מהמשימות הפתוחות.';
  const dismissInsight = () => setDismissedInsightDate(todayISO);

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

  const handleDeleteFromSources = (item: Item) => {
    // TODO: wire to calendar / backend deletion
    console.log('Delete from sources:', item.id);
  };

  const confirmDelete = (item: Item) => {
    Alert.alert('מחיקה', 'האם אתה בטוח שברצונך למחוק?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          handleDeleteFromSources(item);
          setItems((prev) => prev.filter((i) => i.id !== item.id));
        },
      },
    ]);
  };

  const handleCardPress = (item: Item) => {
    if (item.type === 'task') {
      router.push({
        pathname: '/(authenticated)/task/[id]',
        params: { id: item.id },
      });
    } else if (item.communityId) {
      // Community events → open the standard event detail bottom sheet
      openEventSheet(item);
    } else if (item.linkedEventId) {
      // FIXED: linked (shared) events → navigate to read-only linked-event detail
      router.push({
        pathname: '/(authenticated)/linked-event/[id]',
        params: { id: item.linkedEventId },
      });
    } else {
      // Personal events → open generic bottom sheet
      openEventSheet(item);
    }
  };

  // Load last-used navigation app from storage
  useEffect(() => {
    AsyncStorage.getItem('lastNavApp').then((val) => {
      if (val) setLastNavApp(val as 'waze' | 'google' | 'apple');
    });
  }, []);

  // Scroll date carousel to today on mount
  // With row-reverse, day 1 is rightmost. Today's position from the left =
  // (totalDays - 1 - todayIndex) * PILL_WIDTH
  useEffect(() => {
    const PILL_WIDTH = 50;
    const todayIndex = today.getDate() - 1;
    const totalDays = daysInMonth + 7;
    const reversedIndex = totalDays - 1 - todayIndex;
    const offset = Math.max(
      0,
      reversedIndex * PILL_WIDTH - (screenWidth - 32 - 38) / 2 + 21
    );
    setTimeout(() => {
      dateScrollRef.current?.scrollTo({ x: offset, animated: false });
    }, 80);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowToast(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  // ── Navigation picker handlers ─────────────────────────────────────────────

  const handleOpenNavPicker = (location: string) => {
    setNavLocation(location);
    setNavPickerVisible(true);
  };

  const handleNavSelect = async (app: 'waze' | 'google' | 'apple') => {
    if (!navLocation) return;
    const encoded = encodeURIComponent(navLocation);
    const urls = {
      waze: `https://waze.com/ul?q=${encoded}`,
      google: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
      apple: `http://maps.apple.com/?q=${encoded}`,
    };
    const url = urls[app];
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        setLastNavApp(app);
        AsyncStorage.setItem('lastNavApp', app);
      } else {
        Alert.alert('שגיאה', 'לא ניתן לפתוח את אפליקציית הניווט במכשיר זה.');
      }
    } catch {
      Alert.alert('שגיאה', 'אירעה שגיאה בפתיחת הניווט.');
    }
    setNavPickerVisible(false);
    setNavLocation(null);
  };

  const AVATAR_COLORS = ['#FFD1DC', '#E0F2F1', '#FFF9C4', '#E8EAF6', '#FCE4EC'];

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
    <View style={styles.monthCalendar}>
      <Text style={styles.monthName}>{monthName}</Text>
      <View style={styles.monthGrid}>
        {HEB_DAYS.map((d) => (
          <View key={d} style={styles.monthDayHeader}>
            <Text style={styles.monthDayHeaderText}>{d}</Text>
          </View>
        ))}
        {calGridDays.map((day, i) => {
          if (!day) return <View key={`e-${i}`} style={styles.monthDayCell} />;
          const isSel = isSameDay(day, selectedDate);
          const isTod = isSameDay(day, today);
          return (
            <Pressable
              key={i}
              style={[
                styles.monthDayCell,
                isSel && styles.monthDayCellSelected,
                !isSel && isTod && styles.monthDayCellToday,
              ]}
              onPress={() => setSelectedDate(day)}
            >
              <Text
                style={[
                  styles.monthDayText,
                  isSel && styles.monthDayTextSelected,
                  !isSel && isTod && styles.monthDayTextToday,
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
  const isSelectedToday = isSameDay(selectedDate, today);
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
  // End-of-day: today, had timed items, but none are future
  const isEndOfDay =
    isSelectedToday &&
    timedItemsForSelectedDay.length > 0 &&
    !hasFutureTimedItemsToday;
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

  // ── Per-date mood ──────────────────────────────────────────────────────────
  const selectedDateKey = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
  const currentDayMood: number | null = moodByDate[selectedDateKey] ?? null;
  const setCurrentDayMood = (value: number | null) => {
    setMoodByDate((prev) => {
      if (value === null) {
        const next = { ...prev };
        delete next[selectedDateKey];
        return next;
      }
      return { ...prev, [selectedDateKey]: value };
    });
  };

  // ── Birthday strip: filter to next 30 days only (Home Screen only) ─────────
  const thirtyDaysFromNow = new Date(
    today.getTime() + 30 * 24 * 60 * 60 * 1000
  );
  const upcomingBirthdays = contextBirthdays
    .filter((b) => getNextOccurrence(b) <= thirtyDaysFromNow)
    .sort(
      (a, b) => getNextOccurrence(a).getTime() - getNextOccurrence(b).getTime()
    );

  // ── Helpers to scroll date carousel back to today ──────────────────────────
  const scrollToToday = () => {
    const PILL_WIDTH = 50;
    const todayIndex = today.getDate() - 1;
    const totalDays = daysInMonth + 7;
    const reversedIndex = totalDays - 1 - todayIndex;
    const offset = Math.max(
      0,
      reversedIndex * PILL_WIDTH - (screenWidth - 32 - 38) / 2 + 21
    );
    dateScrollRef.current?.scrollTo({ x: offset, animated: true });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f7f8' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        {/* Bell — left */}
        <Pressable
          onPress={handleBellPress}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={
            unseenCount > 0 ? `התראות, ${unseenCount} חדשות` : 'התראות'
          }
          style={{ position: 'relative' }}
        >
          <MaterialIcons
            name={unseenCount > 0 ? 'notifications' : 'notifications-none'}
            size={26}
            color="#111517"
          />
          {unseenCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>
                {unseenCount > 9 ? '9+' : unseenCount}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Text stack + avatar — right */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.headerDate}>{todayLabel}</Text>
            <Text style={styles.headerGreeting}>
              {userFirstName ? `${greeting}, ${userFirstName}` : greeting}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/(authenticated)/profile')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="פתח פרופיל"
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {userFirstName ? userFirstName[0].toUpperCase() : '?'}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {/* ── Date section header (toggle + "היום" chip) ────────────────────── */}
        <View style={styles.dateSectionRow}>
          {!isSameDay(selectedDate, today) && (
            <Pressable
              style={styles.todayChip}
              onPress={() => {
                setSelectedDate(today);
                scrollToToday();
                setCalendarMode('carousel');
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="חזרה להיום"
            >
              <Text style={styles.todayChipText}>היום</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() =>
              setCalendarMode((m) => (m === 'carousel' ? 'month' : 'carousel'))
            }
            style={styles.calendarToggleBtn}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={
              calendarMode === 'carousel' ? 'פתח לוח שנה חודשי' : 'חזרה לקרוסלה'
            }
          >
            <MaterialIcons
              name={
                calendarMode === 'carousel' ? 'calendar-month' : 'view-week'
              }
              size={20}
              color="#36a9e2"
            />
          </Pressable>
        </View>

        {/* ── Carousel OR month calendar ─────────────────────────────────────── */}
        {calendarMode === 'carousel' ? (
          <View style={styles.carouselRow}>
            <ScrollView
              ref={dateScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingVertical: 4,
                flexDirection: 'row-reverse',
              }}
            >
              {calendarDays.map((day, i) => {
                const isSelected = isSameDay(day, selectedDate);
                const isToday = isSameDay(day, today);
                const shortName = day.toLocaleDateString('he-IL', {
                  weekday: 'short',
                });
                return (
                  <Pressable
                    key={i}
                    onPress={() => setSelectedDate(day)}
                    style={[
                      styles.dayPill,
                      isSelected && styles.dayPillSelected,
                      !isSelected && isToday && styles.dayPillToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayPillWeekday,
                        isSelected && styles.dayPillTextSelected,
                      ]}
                    >
                      {shortName}
                    </Text>
                    <Text
                      style={[
                        styles.dayPillNumber,
                        isSelected && styles.dayPillTextSelected,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            {renderMonthCalendar()}
          </View>
        )}

        {hasEventsOrTasks && (
          <Text style={styles.subtitleCount}>
            {isSummaryMode
              ? `${allItems.filter((i) => !i.allDay).length} פעילויות ביום זה`
              : `יש לך ${allItems.filter((i) => !i.allDay).length} פעילויות היום`}
          </Text>
        )}

        {/* ── Empty state — no events or tasks ─────────────────────────────── */}
        {shouldShowEventsEmptyState && (
          <View style={styles.emptyStateContainer}>
            <View style={styles.emptyStateIconWrap}>
              <MaterialIcons name="calendar-today" size={36} color="#36a9e2" />
            </View>
            <Text style={styles.emptyStateTitle}>
              עדיין לא הוספת אירועים או משימות
            </Text>
            <Text style={styles.emptyStateSubtitle}>
              התחילי בהוספת אירוע ראשון או ייבוא יומן קיים.
            </Text>
            <Pressable
              style={styles.emptyStatePrimaryBtn}
              onPress={() => router.push('/(authenticated)/import-calendar')}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="ייבוא מיומן גוגל או אפל"
            >
              <Text style={styles.emptyStatePrimaryBtnText}>
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
              <Text style={styles.emptyStateSecondaryBtnText}>
                הוספת אירוע ראשון
              </Text>
            </Pressable>
            <Text style={styles.emptyStateHint}>
              אפשר גם ללחוץ על הפלוס במרכז המסך כדי ליצור אירוע, משימה, יום
              הולדת או קבוצה.
            </Text>
          </View>
        )}

        {/* ── Summary mode: calm section label for past days ───────────────── */}
        {isSummaryMode && hasDayData && (
          <View
            style={{ paddingHorizontal: 24, marginBottom: 8, marginTop: 4 }}
          >
            <Text style={styles.summaryTitle}>סיכום יום</Text>
          </View>
        )}

        {/* ── Next event area — state-aware ─────────────────────────────────── */}

        {/* Normal next-event card: today or future day with a valid next item */}
        {!isSummaryMode && hasEventsOrTasks && nextEvent && (
          <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <Pressable
              onPress={() => handleCardPress(nextEvent)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`פרטי אירוע: ${nextEvent.title}`}
            >
              <View style={[styles.cardShadow, styles.eventCard]}>
                <View style={styles.eventAccentBar} />
                <View style={{ padding: 24, paddingRight: 32 }}>
                  {/* Top row: "האירוע הבא" pill (right) + relative start time (left) */}
                  <View style={styles.eventTopRow}>
                    <View style={styles.eventNextPill}>
                      <Text style={styles.eventNextPillText}>האירוע הבא</Text>
                    </View>
                    {/* Relative time — only within 2 hours */}
                    {(() => {
                      if (!nextEvent.time) return null;
                      const [h, m] = nextEvent.time.split(':').map(Number);
                      if (Number.isNaN(h) || Number.isNaN(m)) return null;
                      const eventDate = new Date();
                      eventDate.setHours(h, m, 0, 0);
                      const diffMins = Math.round(
                        (eventDate.getTime() - Date.now()) / 60000
                      );
                      if (diffMins <= 0 || diffMins > 120) return null;
                      return (
                        <Text
                          style={{
                            color: '#94a3b8',
                            fontSize: 12,
                            fontWeight: '600',
                          }}
                        >
                          {`מתחיל בעוד ${diffMins} דק׳`}
                        </Text>
                      );
                    })()}
                  </View>

                  {/* Title */}
                  <Text style={styles.eventTitle}>{nextEvent.title}</Text>

                  {/* Time range */}
                  <Text
                    style={{
                      color: '#36a9e2',
                      fontSize: 22,
                      fontWeight: '700',
                      textAlign: 'right',
                      marginBottom: 8,
                    }}
                  >
                    {nextEvent.endTime
                      ? `${nextEvent.time} – ${nextEvent.endTime}`
                      : nextEvent.time}
                  </Text>

                  {/* Address row: location text right, "נווט" button left */}
                  <View style={styles.eventAddressRow}>
                    <View style={styles.eventAddressGroup}>
                      {/* Text first in row-reverse = rightmost; icon on its left */}
                      <Text style={styles.eventAddress} numberOfLines={1}>
                        {nextEvent.location}
                      </Text>
                      <MaterialIcons
                        name="location-on"
                        size={16}
                        color="#94a3b8"
                      />
                    </View>
                    {nextEvent.location ? (
                      <Pressable
                        style={styles.navBtn}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          handleOpenNavPicker(nextEvent.location);
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
                        <Text style={styles.navBtnText}>נווט</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {/* TODO: wire real traffic data here */}
                </View>
              </View>
            </Pressable>
          </View>
        )}

        {/* End-of-day fallback: today, had timed items, none are future */}
        {isEndOfDay && !nextEvent && (
          <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <View style={[styles.cardShadow, styles.endOfDayCard]}>
              <Text style={styles.endOfDayTitle}>
                אין לך עוד משימות ואירועים להיום
              </Text>
              <Text style={styles.endOfDaySubtitle}>
                אפשר לסגור את היום בנחת או לעבור למה שמחכה מחר
              </Text>
              <Pressable
                onPress={() => {
                  const tomorrow = new Date(today);
                  tomorrow.setDate(today.getDate() + 1);
                  setSelectedDate(tomorrow);
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="מה יש מחר"
              >
                <Text style={styles.endOfDayCta}>מה יש מחר ←</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Empty day state (data exists but not today) ──────────────────── */}
        {hasEventsOrTasks && !hasDayData && (
          <View style={styles.emptyDayContainer}>
            <MaterialIcons name="calendar-today" size={28} color="#d1d5db" />
            <Text style={styles.emptyDayTitle}>היום פנוי 🎉</Text>
            <Text style={styles.emptyDaySubtitle}>
              אין לך אירועים או משימות בתאריך הזה.
            </Text>
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="הוספת אירוע"
            >
              <Text style={styles.emptyDayLink}>+ הוספת אירוע</Text>
            </Pressable>
          </View>
        )}

        {/* ── Birthdays — hidden in summary/past-day mode ───────────────────── */}
        {!isSummaryMode && (
          <View style={{ marginBottom: 32 }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>🎂 ימי הולדת קרובים</Text>
              {!shouldShowBirthdaysEmptyState && (
                <Pressable onPress={() => router.push('/birthdays')}>
                  <Text style={styles.seeAll}>ראה הכל</Text>
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
                  onPress={() => {
                    /* TODO: פתח flow הוספת יום הולדת */
                  }}
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
                  alignItems: 'flex-end',
                }}
              >
                <Text
                  style={{ fontSize: 13, color: '#94a3b8', textAlign: 'right' }}
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
                    style={styles.birthdayCard}
                  >
                    <View
                      style={[
                        styles.birthdayAvatar,
                        {
                          backgroundColor:
                            AVATAR_COLORS[idx % AVATAR_COLORS.length],
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.birthdayCountdown}>
                        {getCountdownLabel(b)}:
                      </Text>
                      <Text style={styles.birthdayName}>{b.name}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* ── Timeline ───────────────────────────────────────────────────────── */}
        {hasDayData && (
          <>
            {!isSummaryMode && !isEndOfDay && (
              <View style={styles.sectionHeader}>
                <Text style={styles.timelineTitle}>המשך היום</Text>
              </View>
            )}

            {/* All-day events */}
            {allDayEvents.length > 0 && (
              <View style={{ paddingHorizontal: 24, marginBottom: 8 }}>
                <Text style={styles.allDayLabel}>
                  אירועים/משימות של כל היום
                </Text>
                {allDayEvents.map((ev) => (
                  <Pressable
                    key={ev.id}
                    style={styles.allDayCard}
                    onPress={() =>
                      openEventSheet({
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
                        styles.allDayAccent,
                        { backgroundColor: ev.iconColor },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.allDayTitle}>{ev.title}</Text>
                      {/* TODO: לחבר לנתוני קבוצה אמיתיים מ-Convex כשהסכמה מוכנה */}
                      {ev.groupName ? (
                        <View style={styles.groupRow}>
                          <MaterialIcons
                            name="group"
                            size={12}
                            color="#64748b"
                          />
                          <Text style={styles.groupText}>{ev.groupName}</Text>
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
                      renderRightActions={() => (
                        <Pressable
                          style={styles.deleteAction}
                          onPress={() => confirmDelete(item)}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel="מחק פריט"
                        >
                          <MaterialIcons
                            name="delete-outline"
                            size={26}
                            color="white"
                          />
                        </Pressable>
                      )}
                    >
                      <Pressable
                        onPress={() => handleCardPress(item)}
                        style={[
                          styles.summaryCard,
                          item.completed && styles.summaryCardMuted,
                        ]}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel={item.title}
                      >
                        <View
                          style={[
                            styles.timelineAccent,
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
                              <Text style={styles.summaryCardTime}>
                                {item.time}
                                {item.endTime ? ` – ${item.endTime}` : ''}
                              </Text>
                            ) : null}
                            {/* Title + assignee circle */}
                            <View
                              style={{
                                flexDirection: 'row-reverse',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <Text
                                style={[
                                  styles.taskTitle,
                                  item.completed && styles.completedText,
                                ]}
                              >
                                {item.title}
                              </Text>
                              <View
                                style={[
                                  styles.assigneeCircle,
                                  { backgroundColor: item.assigneeColor },
                                ]}
                              />
                            </View>
                            {item.location ? (
                              <Text style={styles.itemLocation}>
                                {item.location}
                              </Text>
                            ) : null}
                            {item.groupName ? (
                              <View style={styles.groupRow}>
                                <MaterialIcons
                                  name="group"
                                  size={12}
                                  color="#64748b"
                                />
                                <Text style={styles.groupText}>
                                  {item.groupName}
                                </Text>
                              </View>
                            ) : null}
                            {/* Nav button — warm brown, same as active-day */}
                            {item.location ? (
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  handleOpenNavPicker(item.location);
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
                    </Swipeable>
                  ))}
              </View>
            ) : !isEndOfDay ? (
              /* ── Active-day timeline with time column + swipe ── */
              <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
                {visibleItems
                  .filter((i) => !i.allDay && i.id !== nextEvent?.id)
                  .map((item) => (
                    <Swipeable
                      key={item.id}
                      renderRightActions={() => (
                        <Pressable
                          style={styles.deleteAction}
                          onPress={() => confirmDelete(item)}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel="מחק פריט"
                        >
                          <MaterialIcons
                            name="delete-outline"
                            size={26}
                            color="white"
                          />
                        </Pressable>
                      )}
                    >
                      <View
                        style={{
                          flexDirection: 'row-reverse',
                          gap: 16,
                          marginBottom: 4,
                        }}
                      >
                        {/* Time column */}
                        <View style={styles.timeColumn}>
                          <Text style={styles.timeText}>{item.time}</Text>
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
                            <View style={styles.timelineCard}>
                              <View
                                style={[
                                  styles.timelineAccent,
                                  { backgroundColor: item.iconColor },
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
                                  {/* Title row: title + assignee circles only */}
                                  <View
                                    style={{
                                      flexDirection: 'row-reverse',
                                      alignItems: 'center',
                                      gap: 6,
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.taskTitle,
                                        item.completed && styles.completedText,
                                      ]}
                                    >
                                      {item.title}
                                    </Text>
                                    {/* Assignee circles row — expandable for multiple */}
                                    <View
                                      style={{
                                        flexDirection: 'row-reverse',
                                        gap: 4,
                                      }}
                                    >
                                      <View
                                        style={[
                                          styles.assigneeCircle,
                                          {
                                            backgroundColor: item.assigneeColor,
                                          },
                                        ]}
                                      />
                                    </View>
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
                                    item.groupName ||
                                    item.personalTaskSummary ||
                                    item.pending) && (
                                    <View
                                      style={{
                                        flexDirection: 'row-reverse',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start',
                                        marginTop: 4,
                                      }}
                                    >
                                      {/* Right: location, group, task summary */}
                                      <View style={{ flex: 1 }}>
                                        {item.location ? (
                                          <Text style={styles.itemLocation}>
                                            {item.location}
                                          </Text>
                                        ) : null}
                                        {/* TODO: לחבר לנתוני קבוצה אמיתיים מ-Convex */}
                                        {item.groupName ? (
                                          <View style={styles.groupRow}>
                                            <MaterialIcons
                                              name="group"
                                              size={12}
                                              color="#64748b"
                                            />
                                            <Text style={styles.groupText}>
                                              {item.groupName}
                                            </Text>
                                          </View>
                                        ) : null}
                                        {item.personalTaskSummary ? (
                                          <Text
                                            style={styles.personalTaskSummary}
                                          >
                                            {item.personalTaskSummary}
                                          </Text>
                                        ) : null}
                                      </View>

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
                                            <View style={styles.pendingBadge}>
                                              <Text
                                                style={styles.pendingBadgeText}
                                              >
                                                ממתין לאישור
                                              </Text>
                                            </View>
                                          )}
                                          {item.rsvpStatus === 'yes' && (
                                            <View
                                              style={[
                                                styles.pendingBadge,
                                                { backgroundColor: '#dcfce7' },
                                              ]}
                                            >
                                              <Text
                                                style={[
                                                  styles.pendingBadgeText,
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
                                                styles.pendingBadge,
                                                { backgroundColor: '#fef9c3' },
                                              ]}
                                            >
                                              <Text
                                                style={[
                                                  styles.pendingBadgeText,
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
                                  {item.location || item.remoteUrl ? (
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
                                          handleOpenNavPicker(item.location);
                                        }
                                      }}
                                      style={{
                                        alignSelf: 'flex-start',
                                        marginTop: 6,
                                        backgroundColor: 'rgba(54,169,226,0.1)',
                                        borderRadius: 12,
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
                                          item.remoteUrl
                                            ? 'videocam'
                                            : 'near-me'
                                        }
                                        size={13}
                                        color="#36a9e2"
                                      />
                                      <Text
                                        style={{
                                          color: '#36a9e2',
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
                        </View>
                      </View>
                    </Swipeable>
                  ))}
              </View>
            ) : null}
          </>
        )}

        {/* ── Undated tasks ──────────────────────────────────────────────────── */}
        {undatedTasks.length > 0 && (
          <View style={{ marginBottom: 32 }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>משימות ללא תאריך</Text>
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
                <Pressable
                  key={task.id}
                  style={styles.undatedRow}
                  onPress={() =>
                    console.log('TODO: navigate to task edit', task.id)
                  }
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
                      styles.undatedTitle,
                      task.completed && styles.completedText,
                    ]}
                    numberOfLines={1}
                  >
                    {task.title}
                  </Text>
                </Pressable>
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
                    textAlign: 'right',
                    marginBottom: 16,
                  }}
                >
                  משימות ללא תאריך
                </Text>
                {/* TODO: לשפר סינון/קיבוץ בעתיד */}
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={{ gap: 8 }}>
                    {undatedTasks.map((task) => (
                      <Pressable
                        key={task.id}
                        style={styles.undatedRow}
                        onPress={() => {
                          setShowAllUndated(false);
                          console.log('TODO: navigate to task edit', task.id);
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
                            styles.undatedTitle,
                            task.completed && styles.completedText,
                          ]}
                          numberOfLines={2}
                        >
                          {task.title}
                        </Text>
                      </Pressable>
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

        {/* ── Mood section — shown only when user has events/tasks ──────────── */}
        {canShowMoodFeatures && (
          <View
            style={{ paddingHorizontal: 24, marginTop: 8, marginBottom: 40 }}
          >
            <Text style={styles.moodTitle}>איך הרגיש היום שלך?</Text>
            {currentDayMood === null ? (
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                {MOODS.map((mood) => (
                  <Pressable
                    key={mood.value}
                    onPress={() => setCurrentDayMood(mood.value)}
                    style={{
                      flex: 1,
                      backgroundColor: '#fff',
                      borderRadius: 16,
                      paddingVertical: 14,
                      alignItems: 'center',
                      gap: 4,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.05,
                      shadowRadius: 4,
                      elevation: 1,
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={mood.label}
                  >
                    <FaceMood value={mood.value} />
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '600',
                        color: '#374151',
                      }}
                    >
                      {mood.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Pressable
                onPress={() => setCurrentDayMood(null)}
                style={{
                  backgroundColor: '#f0f7ff',
                  borderRadius: 16,
                  padding: 14,
                  flexDirection: 'row-reverse',
                  alignItems: 'center',
                  gap: 10,
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="שנה את הרגש שנבחר"
              >
                {currentDayMood !== null && (
                  <FaceMood value={currentDayMood as 0 | 1 | 2} />
                )}
                <Text
                  style={{ fontSize: 14, fontWeight: '700', color: '#111517' }}
                >
                  {MOODS.find((m) => m.value === currentDayMood)?.label}
                </Text>
                <MaterialIcons
                  name="edit"
                  size={14}
                  color="#94a3b8"
                  style={{ marginRight: 'auto' }}
                />
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Welcome toast ──────────────────────────────────────────────────── */}
      {showToast && (
        <View style={styles.toastWrapper}>
          <View style={[styles.toastShadow, styles.toastCard]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toastText}>
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

      {/* ── Event Detail Sheet ──────────────────────────────────────────────── */}
      <EventDetailsBottomSheet
        event={selectedEvent}
        eventId={selectedEventId}
        visible={isEventSheetVisible}
        onDragClose={() => {
          lastDragCloseTime.current = Date.now();
        }}
        onClose={closeEventSheet}
        onNavigate={handleOpenNavPicker}
      />

      {/* ── Navigation App Picker Modal ──────────────────────────────────────── */}
      <Modal
        visible={navPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNavPickerVisible(false)}
      >
        {/* Backdrop — tap to dismiss */}
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={() => setNavPickerVisible(false)}
        />

        <View
          style={{
            backgroundColor: '#fff',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 36,
          }}
        >
          {/* Handle */}
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: '#e5e7eb',
              alignSelf: 'center',
              marginBottom: 20,
            }}
          />

          <Text
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: '#111517',
              textAlign: 'right',
              marginBottom: 16,
            }}
          >
            פתח עם...
          </Text>

          {/* Last-used app — shown first with a label */}
          {lastNavApp
            ? (() => {
                const labels: Record<'waze' | 'google' | 'apple', string> = {
                  waze: 'Waze',
                  google: 'Google Maps',
                  apple: 'Apple Maps',
                };
                return (
                  <View style={{ marginBottom: 8 }}>
                    <Text
                      style={{
                        fontSize: 11,
                        color: '#94a3b8',
                        textAlign: 'right',
                        marginBottom: 6,
                      }}
                    >
                      השתמשת לאחרונה
                    </Text>
                    <Pressable
                      onPress={() => handleNavSelect(lastNavApp)}
                      style={{
                        flexDirection: 'row-reverse',
                        alignItems: 'center',
                        gap: 12,
                        backgroundColor: 'rgba(54,169,226,0.08)',
                        borderRadius: 16,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        borderWidth: 1,
                        borderColor: 'rgba(54,169,226,0.2)',
                        marginBottom: 12,
                      }}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`פתח עם ${labels[lastNavApp]}`}
                    >
                      <Text
                        style={{
                          fontSize: 17,
                          fontWeight: '700',
                          color: '#36a9e2',
                          flex: 1,
                          textAlign: 'right',
                        }}
                      >
                        {labels[lastNavApp]}
                      </Text>
                      <MaterialIcons name="near-me" size={22} color="#36a9e2" />
                    </Pressable>
                    <View
                      style={{
                        height: 1,
                        backgroundColor: '#f1f5f9',
                        marginBottom: 12,
                      }}
                    />
                  </View>
                );
              })()
            : null}

          {/* All options */}
          {(
            [
              { key: 'waze', label: 'Waze', icon: 'near-me', show: true },
              { key: 'google', label: 'Google Maps', icon: 'map', show: true },
              {
                key: 'apple',
                label: 'Apple Maps',
                icon: 'location-on',
                show: Platform.OS === 'ios',
              },
            ] as const
          )
            .filter((o) => o.show)
            .map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => handleNavSelect(opt.key)}
                style={{
                  flexDirection: 'row-reverse',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderRadius: 16,
                  marginBottom: 8,
                  backgroundColor: '#f8fafc',
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`פתח עם ${opt.label}`}
              >
                <MaterialIcons name={opt.icon} size={22} color="#64748b" />
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '600',
                    color: '#111517',
                    flex: 1,
                    textAlign: 'right',
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}

          {/* Cancel */}
          <Pressable
            onPress={() => setNavPickerVisible(false)}
            style={{
              alignSelf: 'center',
              marginTop: 8,
              paddingVertical: 8,
              paddingHorizontal: 24,
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="ביטול"
          >
            <Text style={{ color: '#94a3b8', fontSize: 15, fontWeight: '600' }}>
              ביטול
            </Text>
          </Pressable>
        </View>
      </Modal>
      {__DEV__ && (
        <Pressable
          onPress={() => {
            if (devClearBirthdays) {
              // TODO: כשאירועים יחוברו ל-Convex – לשחזר נתוני mock כאן
              setItems([
                /* הנתונים המקוריים שלך */
              ]);
              setDevClearBirthdays(false);
            } else {
              // undatedTasks מגיע מ-Convex – לא ניתן לנקות locally
              // TODO: להוסיף dev toggle לנקות נתוני Convex
              setItems([]);
              setDevClearBirthdays(true);
            }
          }}
          style={{
            position: 'absolute',
            top: 60,
            left: 10,
            backgroundColor: '#ff000033',
            padding: 6,
            borderRadius: 8,
          }}
        >
          <Text style={{ fontSize: 10 }}>
            {devClearBirthdays ? '↩️ שחזר' : '🧪 ריק'}
          </Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Header ─────────────────────────────────────────────────────────────────
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
  dateSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
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
  calendarToggleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(54,169,226,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Date carousel ───────────────────────────────────────────────────────────
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
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'right',
    paddingHorizontal: 24,
    marginBottom: 16,
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
  eventAccentBar: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 6,
    backgroundColor: '#36a9e2',
  },
  eventTopRow: {
    flexDirection: 'row-reverse',
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
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  eventAddressGroup: {
    flexDirection: 'row-reverse',
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
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 12,
    alignItems: 'center',
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
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
  timelineTitle: { fontSize: 18, fontWeight: '700', color: '#111517' },
  timeColumn: { width: 48, alignItems: 'center', paddingTop: 14 },
  timeText: { fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  timelineCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    minHeight: 72,
    flexDirection: 'row-reverse',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    overflow: 'hidden',
  },
  timelineAccent: {
    position: 'absolute',
    right: 0,
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

  // ── Mood section ────────────────────────────────────────────────────────────
  moodTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
    marginBottom: 16,
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
