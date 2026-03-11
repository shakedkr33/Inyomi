import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery } from 'convex/react';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { MoodValue } from '@/components/mood/MoodIcon';
import { MoodIcon } from '@/components/mood/MoodIcon';
import { TaskCheckbox } from '@/components/TaskCheckbox';
import { useNotifications } from '@/contexts/NotificationsContext';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useBirthdaySheets } from '@/lib/components/birthday/BirthdaySheetsProvider';
import { NotificationsDrawer } from '@/lib/components/notifications/NotificationsDrawer';
import { getCountdownLabel } from '@/lib/utils/birthday';

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

const MOODS: { value: MoodValue; label: string; shortText: string }[] = [
  { value: 4, label: 'מדהים', shortText: 'יום מוצלח ומלא בעשייה! ⭐' },
  { value: 3, label: 'בסדר', shortText: 'יום טוב וסביר 👍' },
  { value: 2, label: 'רגיל', shortText: 'יום שגרתי כרגיל.' },
  { value: 1, label: 'עמוס', shortText: 'יום עמוס – כל הכבוד שעברת אותו.' },
  { value: 0, label: 'מתסכל', shortText: 'יום קשה. מחר יהיה טוב יותר 💙' },
];

const MOOD_ITEM_WIDTH = 80;
const wheelMoods = [...MOODS, ...MOODS, ...MOODS];
const MOOD_INITIAL_X = MOODS.length * MOOD_ITEM_WIDTH;

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
  // TODO: לחבר לנתוני קבוצה אמיתיים מ-Convex כשהסכמה מוכנה
  groupName?: string;
  // TODO: לחבר לשדות אמיתיים ב-Convex
  remoteUrl?: string;
  rsvpStatus?: 'none' | 'yes' | 'no' | 'maybe'; // TODO: לחבר ל-RSVP אמיתי מ-Convex
};

type UndatedTask = {
  id: string;
  title: string;
  completed: boolean;
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { openBirthdayCard, birthdays: contextBirthdays } = useBirthdaySheets();

  // ── Convex: spaceId ────────────────────────────────────────────────────────
  // TODO: כאשר defaultSpaceId ייאכלס ב-onboarding, לעבור לשליפה ישירה מ-user.defaultSpaceId
  // getMySpace מחזיר את ה-spaceId ישירות (Id<'spaces'> | null)
  const spaceId = useQuery(api.users.getMySpace);

  // ── Convex: tasks mutations ────────────────────────────────────────────────
  const toggleCompletedMutation = useMutation(api.tasks.toggleCompleted);
  const [showToast, setShowToast] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [calendarMode, setCalendarMode] = useState<'carousel' | 'month'>(
    'carousel'
  );
  const [devClearBirthdays, setDevClearBirthdays] = useState(false);

  // ── Mood popup state ───────────────────────────────────────────────────────
  const [hasSeenMoodPopupToday, setHasSeenMoodPopupToday] = useState(false);
  const [lastMoodDate, setLastMoodDate] = useState<string | null>(null);
  const [isMoodModalVisible, setIsMoodModalVisible] = useState(false);
  // Tracks the in-modal selection before the user confirms
  const [tempMoodSelection, setTempMoodSelection] = useState<number | null>(
    null
  );

  // ── Insight card ───────────────────────────────────────────────────────────
  const [dismissedInsightDate, setDismissedInsightDate] = useState<
    string | null
  >(null);

  // ── Event detail sheet ─────────────────────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [isEventSheetVisible, setIsEventSheetVisible] = useState(false);

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

  // ── Mood wheel live index ──────────────────────────────────────────────────
  const [currentMoodIndex, setCurrentMoodIndex] = useState<number>(
    MOODS.length
  ); // default: middle of wheelMoods

  const openEventSheet = (item: Item) => {
    setSelectedEvent(item as EventItem);
    setIsEventSheetVisible(true);
  };
  const closeEventSheet = () => {
    setIsEventSheetVisible(false);
    setSelectedEvent(null);
  };

  const dateScrollRef = useRef<ScrollView>(null);
  const moodScrollRef = useRef<ScrollView>(null);
  const moodPopupRef = useRef<ScrollView>(null);
  const moodWheelInitialized = useRef(false);
  const moodPopupInitialized = useRef(false);

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

  // ── Items ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<Item[]>([
    {
      id: '1',
      time: '13:30',
      title: 'איסוף מהגן',
      location: 'גן שושנים',
      type: 'event',
      icon: 'child-care',
      iconBg: '#FFF4E6',
      iconColor: '#FF922B',
      assigneeColor: '#36a9e2',
      completed: false,
      groupName: 'ילדים',
    },
    {
      id: '2',
      time: '16:00',
      title: 'לקנות חלב ולחם',
      location: 'סופר שכונתי',
      type: 'task',
      completed: false,
      icon: 'shopping-cart',
      iconBg: '#E7F5FF',
      iconColor: '#228BE6',
      assigneeColor: '#FFD1DC',
    },
    {
      id: '3',
      time: '17:30',
      title: 'חוג כדורגל (בן 6)',
      location: 'מגרש ספורט קהילתי',
      type: 'event',
      icon: 'fitness-center',
      iconBg: '#F3F0FF',
      iconColor: '#7950F2',
      assigneeColor: '#FFD1DC',
      completed: false,
      pending: true,
      rsvpStatus: 'none',
      groupName: 'ספורט',
    },
  ]);

  // ── All-day events (mock) ──────────────────────────────────────────────────
  // TODO: לחבר לנתוני קבוצה אמיתיים מ-Convex כשהסכמה מוכנה
  const allDayEvents: Array<{
    id: string;
    title: string;
    iconColor: string;
    groupName?: string;
  }> = [
    {
      id: 'ad1',
      title: 'חג ראש חודש',
      iconColor: '#36a9e2',
      groupName: 'משפחה',
    },
  ];

  // ── Convex: dated tasks ────────────────────────────────────────────────────
  // TODO: לאחד עם events מ-Convex כשיחובר (api.events.listByDateRange)
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

  // allItems = Convex tasks (today) + mock event items
  // TODO: להחליף את items לחלוטין ב-events מ-Convex כשיחובר
  const allItems = useMemo(
    () => [...todayTasks, ...items],
    [todayTasks, items]
  );

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
  const showInsightCard = hasEventsOrTasks && dismissedInsightDate !== todayISO;
  // TODO: להחליף ללוגיקת AI בעתיד
  const insightText =
    allItems.length > 3
      ? 'יש לך יום עמוס היום, שווה לשקול להזיז משימה אחת למחר.'
      : 'היום שלך נראה רגוע, אולי זה זמן טוב להשלים משהו קטן מהמשימות הפתוחות.';

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
    } else {
      // Events → open detail sheet
      openEventSheet(item);
    }
  };

  // ── Mood helpers ───────────────────────────────────────────────────────────
  // TODO: להחליף ללוגיקת AI בעתיד (לחבר רגש + תובנה)
  const shouldShowMoodPrompt = useCallback((): boolean => {
    const lastHour = allItems.reduce((max, item) => {
      const h = parseInt(item.time.split(':')[0], 10);
      return Number.isNaN(h) ? max : h > max ? h : max;
    }, 0);
    const moodStartHour = Math.max(19, lastHour);
    return new Date().getHours() >= moodStartHour;
  }, [allItems]);

  // Load last-used navigation app from storage
  useEffect(() => {
    AsyncStorage.getItem('lastNavApp').then((val) => {
      if (val) setLastNavApp(val as 'waze' | 'google' | 'apple');
    });
  }, []);

  // Reset mood state when a new day begins
  useEffect(() => {
    if (lastMoodDate !== null && lastMoodDate !== todayISO) {
      setHasSeenMoodPopupToday(false);
      setSelectedMood(null);
    }
  }, []); // runs once on mount

  // Check every minute whether to show the mood popup
  useEffect(() => {
    if (!canShowMoodFeatures) return; // לא להציג למשתמש ללא אירועים
    const check = () => {
      if (
        shouldShowMoodPrompt() &&
        selectedMood === null &&
        !hasSeenMoodPopupToday
      ) {
        setTempMoodSelection(null);
        setIsMoodModalVisible(true);
      }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [
    canShowMoodFeatures,
    shouldShowMoodPrompt,
    selectedMood,
    hasSeenMoodPopupToday,
  ]);

  // Scroll main mood wheel to initial position after mount
  useEffect(() => {
    moodWheelInitialized.current = false;
    setTimeout(() => {
      moodScrollRef.current?.scrollTo({ x: MOOD_INITIAL_X, animated: false });
    }, 150);
  }, []);

  // Scroll popup mood wheel when modal opens; reset guard so first event is skipped
  useEffect(() => {
    if (isMoodModalVisible) {
      moodPopupInitialized.current = false;
      setTempMoodSelection(selectedMood);
      setTimeout(() => {
        moodPopupRef.current?.scrollTo({ x: MOOD_INITIAL_X, animated: false });
      }, 150);
    }
  }, [isMoodModalVisible]);

  // Scroll date carousel to today on mount
  useEffect(() => {
    const todayIndex = today.getDate() - 1;
    const PILL_WIDTH = 50;
    const offset = Math.max(
      0,
      todayIndex * PILL_WIDTH - (screenWidth - 32 - 38) / 2 + 21
    );
    setTimeout(() => {
      dateScrollRef.current?.scrollTo({ x: offset, animated: false });
    }, 80);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowToast(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  const playMoodSound = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Confirm selection from modal — requires explicit tap on "אישור"
  const confirmMoodSelection = () => {
    if (tempMoodSelection === null) return;
    if (tempMoodSelection !== selectedMood) playMoodSound();
    setSelectedMood(tempMoodSelection);
    setHasSeenMoodPopupToday(true);
    setLastMoodDate(todayISO);
    setIsMoodModalVisible(false);
    // Sync bottom wheel to the confirmed mood
    const idx = MOODS.findIndex((m) => m.value === tempMoodSelection);
    const targetX = (MOODS.length + idx) * MOOD_ITEM_WIDTH;
    setTimeout(() => {
      moodWheelInitialized.current = false;
      moodScrollRef.current?.scrollTo({ x: targetX, animated: false });
    }, 50);
  };

  // Direct selection from bottom wheel (tap or scroll)
  const handleMoodSelect = (value: number) => {
    if (value !== selectedMood) playMoodSound();
    setSelectedMood(value);
    setHasSeenMoodPopupToday(true);
    setLastMoodDate(todayISO);
    setIsMoodModalVisible(false);
    const idx = MOODS.findIndex((m) => m.value === value);
    const targetX = (MOODS.length + idx) * MOOD_ITEM_WIDTH;
    setTimeout(() => {
      moodWheelInitialized.current = false;
      moodScrollRef.current?.scrollTo({ x: targetX, animated: false });
    }, 50);
  };

  // Popup scroll-end: loop-snap + update tempMoodSelection (NO confirm yet)
  const handlePopupScrollEnd = (e: {
    nativeEvent: { contentOffset: { x: number } };
  }) => {
    if (!moodPopupInitialized.current) {
      moodPopupInitialized.current = true;
      return;
    }
    const offsetX = e.nativeEvent.contentOffset.x;
    const rawIndex = Math.round(offsetX / MOOD_ITEM_WIDTH);
    const normalizedIndex = rawIndex % MOODS.length;
    setTempMoodSelection(MOODS[normalizedIndex].value);
    if (rawIndex < MOODS.length) {
      moodPopupRef.current?.scrollTo({
        x: (rawIndex + MOODS.length) * MOOD_ITEM_WIDTH,
        animated: false,
      });
    } else if (rawIndex >= MOODS.length * 2) {
      moodPopupRef.current?.scrollTo({
        x: (rawIndex - MOODS.length) * MOOD_ITEM_WIDTH,
        animated: false,
      });
    }
  };

  // Bottom wheel scroll-end: immediate selection + loop-snap
  const handleBottomScrollEnd = (e: {
    nativeEvent: { contentOffset: { x: number } };
  }) => {
    if (!moodWheelInitialized.current) {
      moodWheelInitialized.current = true;
      return;
    }
    const offsetX = e.nativeEvent.contentOffset.x;
    const rawIndex = Math.round(offsetX / MOOD_ITEM_WIDTH);
    const normalizedIndex = rawIndex % MOODS.length;
    handleMoodSelect(MOODS[normalizedIndex].value);
    setTimeout(() => {
      if (rawIndex < MOODS.length) {
        moodScrollRef.current?.scrollTo({
          x: (rawIndex + MOODS.length) * MOOD_ITEM_WIDTH,
          animated: false,
        });
      } else if (rawIndex >= MOODS.length * 2) {
        moodScrollRef.current?.scrollTo({
          x: (rawIndex - MOODS.length) * MOOD_ITEM_WIDTH,
          animated: false,
        });
      }
    }, 0);
  };

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

  const moodWheelPad = (screenWidth - 48 - MOOD_ITEM_WIDTH) / 2;
  const moodPopupHPad = Math.max(
    0,
    (screenWidth * 0.88 - 56 - MOOD_ITEM_WIDTH) / 2
  );

  // ── Mood wheel (reused in bottom section and popup) ────────────────────────
  const renderMoodWheel = (
    ref: React.RefObject<ScrollView | null>,
    pad: number,
    onScrollEnd: (e: { nativeEvent: { contentOffset: { x: number } } }) => void,
    activeMoodValue: number | null = selectedMood,
    onItemTap?: (value: number) => void
  ) => (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={MOOD_ITEM_WIDTH}
      decelerationRate="fast"
      scrollEventThrottle={16}
      contentContainerStyle={{ paddingHorizontal: pad }}
      onScroll={(e) => {
        const offsetX = e.nativeEvent.contentOffset.x;
        const rawIndex = Math.round(offsetX / MOOD_ITEM_WIDTH);
        const normalized = rawIndex % MOODS.length;
        setCurrentMoodIndex(rawIndex);
        // Live update: modal temp selection or bottom wheel selection
        if (onItemTap) {
          setTempMoodSelection(MOODS[normalized].value);
        } else {
          setSelectedMood(MOODS[normalized].value);
        }
      }}
      onMomentumScrollEnd={onScrollEnd}
    >
      {wheelMoods.map((mood, i) => {
        const distance = Math.abs(i - currentMoodIndex);
        const isCenter = distance === 0;
        const iconSize = isCenter ? 56 : distance === 1 ? 42 : 32;
        const iconOpacity = isCenter ? 1 : distance === 1 ? 0.55 : 0.35;
        return (
          <Pressable
            key={i}
            onPress={() => (onItemTap ?? handleMoodSelect)(mood.value)}
            style={styles.moodItem}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={mood.label}
          >
            <View style={{ opacity: iconOpacity }}>
              <MoodIcon value={mood.value} size={iconSize} active={isCenter} />
            </View>
            <Text
              style={[styles.moodLabel, isCenter && styles.moodLabelActive]}
            >
              {isCenter ? mood.label : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

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

  // ── Derived ────────────────────────────────────────────────────────────────
  const nextEvent = allItems.find((i) => !i.allDay && !i.completed);
  const selectedMoodData = MOODS.find((m) => m.value === selectedMood);

  const handleMoodCardPress = () => {
    // If same day — reopen modal to change mood
    if (lastMoodDate === todayISO) {
      setTempMoodSelection(selectedMood);
      setIsMoodModalVisible(true);
    }
    // Past day — silently ignore
  };

  // ── Helpers to scroll date carousel back to today ──────────────────────────
  const scrollToToday = () => {
    const todayIndex = today.getDate() - 1;
    const PILL_WIDTH = 50;
    const offset = Math.max(
      0,
      todayIndex * PILL_WIDTH - (screenWidth - 32 - 38) / 2 + 21
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
            <Text style={styles.headerGreeting}>{greeting}, שקד</Text>
          </View>
          <Pressable
            onPress={() => router.push('/(authenticated)/profile')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="פתח פרופיל"
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>ש</Text>
            </View>
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {/* ── Daily Insight card ─────────────────────────────────────────────── */}
        {showInsightCard && (
          <View style={styles.insightCard}>
            <View style={styles.insightHeader}>
              <Text style={styles.insightLabel}>תובנה יומית</Text>
              <Pressable
                onPress={dismissInsight}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="סגור תובנה"
              >
                <MaterialIcons name="close" size={18} color="#94a3b8" />
              </Pressable>
            </View>
            {/* TODO: להחליף ללוגיקת AI בעתיד */}
            <Text style={styles.insightText}>{insightText}</Text>
          </View>
        )}

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
              contentContainerStyle={{ paddingVertical: 4 }}
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
            יש לך {allItems.filter((i) => !i.allDay).length + 1} פעילויות היום
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

        {/* ── Upcoming event card (only if next event exists) ───────────────── */}
        {hasEventsOrTasks && nextEvent && (
          <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            {/* Tapping anywhere on the card opens the detail sheet */}
            <Pressable
              onPress={() => openEventSheet(nextEvent)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`פרטי אירוע: ${nextEvent.title}`}
            >
              <View style={[styles.cardShadow, styles.eventCard]}>
                <View style={styles.eventAccentBar} />
                <View style={{ padding: 24, paddingRight: 32 }}>
                  <View style={styles.eventTopRow}>
                    <View style={styles.eventNextPill}>
                      <Text style={styles.eventNextPillText}>האירוע הבא</Text>
                    </View>
                    <Text style={styles.eventTime}>{nextEvent.time}</Text>
                  </View>
                  {nextEvent.endTime && (
                    <Text
                      style={{
                        color: '#94a3b8',
                        fontSize: 13,
                        textAlign: 'left',
                        marginTop: -4,
                        marginBottom: 6,
                      }}
                    >
                      עד {nextEvent.endTime}
                    </Text>
                  )}
                  <Text style={styles.eventTitle}>{nextEvent.title}</Text>

                  {/* Address row: icon+address group on right, nav button on left */}
                  <View style={styles.eventAddressRow}>
                    <View style={styles.eventAddressGroup}>
                      <MaterialIcons
                        name="location-on"
                        size={16}
                        color="#94a3b8"
                      />
                      <Text style={styles.eventAddress} numberOfLines={1}>
                        {nextEvent.location}
                      </Text>
                    </View>
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
                      <MaterialIcons name="near-me" size={16} color="#8d6e63" />
                      <Text style={styles.navBtnText}>נווט</Text>
                    </Pressable>
                  </View>

                  <View style={styles.trafficAlert}>
                    <MaterialIcons name="traffic" size={20} color="#ff6b6b" />
                    <Text style={styles.trafficText}>
                      עומס כבד באיילון: מומלץ לצאת ב-08:15
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
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

        {/* ── Birthdays ──────────────────────────────────────────────────────── */}
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
                  style={{ color: '#36a9e2', fontSize: 14, fontWeight: '700' }}
                >
                  + הוספת יום הולדת ראשון
                </Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 24, paddingLeft: 8 }}
            >
              <View style={{ flexDirection: 'row-reverse', gap: 12 }}>
                {contextBirthdays.map((b, idx) => (
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
              </View>
            </ScrollView>
          )}
        </View>

        {/* ── Timeline ───────────────────────────────────────────────────────── */}
        {hasDayData && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.timelineTitle}>המשך היום</Text>
            </View>

            {/* All-day events */}
            {allDayEvents.length > 0 && (
              <View style={{ paddingHorizontal: 24, marginBottom: 8 }}>
                <Text style={styles.allDayLabel}>אירועים לכל היום</Text>
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

            {/* Hourly timeline */}
            <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
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
                                {/* Title row + RSVP badge */}
                                <View
                                  style={{
                                    flexDirection: 'row-reverse',
                                    alignItems: 'center',
                                    gap: 6,
                                    flexWrap: 'wrap',
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
                                    >
                                      {(!item.rsvpStatus ||
                                        item.rsvpStatus === 'none') && (
                                        <View style={styles.pendingBadge}>
                                          <Text style={styles.pendingBadgeText}>
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
                                  <View
                                    style={[
                                      styles.assigneeCircle,
                                      { backgroundColor: item.assigneeColor },
                                    ]}
                                  />
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

                                <Text style={styles.itemLocation}>
                                  {item.location}
                                </Text>
                                {/* TODO: לחבר לנתוני קבוצה אמיתיים מ-Convex כשהסכמה מוכנה */}
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
                                        item.remoteUrl ? 'videocam' : 'near-me'
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
            style={{ paddingHorizontal: 24, marginTop: 8, marginBottom: 32 }}
          >
            <Text style={styles.moodTitle}>איך הרגיש היום שלך?</Text>

            {selectedMood !== null && selectedMoodData ? (
              // Compact card after mood is selected
              // TODO: להחליף ללוגיקת AI בעתיד (לחבר רגש + תובנה יומית)
              <Pressable
                onPress={handleMoodCardPress}
                style={styles.moodCompactCard}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`הרגש שנבחר: ${selectedMoodData.label}`}
              >
                <MoodIcon
                  value={selectedMoodData.value}
                  size={40}
                  active={true}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.moodCompactLabel}>
                    {selectedMoodData.label}
                  </Text>
                  <Text style={styles.moodCompactPhrase}>
                    {selectedMoodData.shortText}
                  </Text>
                </View>
                {lastMoodDate === todayISO && (
                  <MaterialIcons name="edit" size={16} color="#94a3b8" />
                )}
              </Pressable>
            ) : (
              renderMoodWheel(
                moodScrollRef,
                moodWheelPad,
                handleBottomScrollEnd
              )
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
                ברוכים הבאים הביתה, שקד! הכל מוכן. ה-AI של InYomi כבר התחילה
                לעבוד לסנכרן לך את היום.
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

      {/* ── Mood Modal ─────────────────────────────────────────────────────── */}
      <Modal
        animationType="fade"
        transparent
        visible={isMoodModalVisible}
        onRequestClose={() => setIsMoodModalVisible(false)}
      >
        <View style={styles.moodModalOverlay}>
          <View style={styles.moodModalCard}>
            <Text style={styles.moodModalTitle}>איך הרגיש היום שלך?</Text>
            {renderMoodWheel(
              moodPopupRef,
              moodPopupHPad,
              handlePopupScrollEnd,
              tempMoodSelection,
              (v) => setTempMoodSelection(v)
            )}
            {/* Confirm button — only active after scrolling to a mood */}
            <Pressable
              style={[
                styles.moodConfirmBtn,
                tempMoodSelection === null && styles.moodConfirmBtnDisabled,
              ]}
              onPress={confirmMoodSelection}
              disabled={tempMoodSelection === null}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="אישור בחירת רגש"
            >
              <Text style={styles.moodConfirmBtnText}>אישור</Text>
            </Pressable>
            <Pressable
              style={styles.moodModalClose}
              onPress={() => setIsMoodModalVisible(false)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="סגור"
            >
              <Text style={styles.moodModalCloseText}>סגור</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Event Detail Sheet ──────────────────────────────────────────────── */}
      <EventDetailsBottomSheet
        event={selectedEvent}
        visible={isEventSheetVisible}
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
    width: 42,
    height: 58,
    borderRadius: 21,
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
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthDayCellSelected: {
    backgroundColor: '#36a9e2',
    borderRadius: 999,
  },
  monthDayCellToday: {
    borderWidth: 2,
    borderColor: '#36a9e2',
    borderRadius: 999,
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
  eventAddress: { color: '#94a3b8', fontSize: 13, flex: 1 },
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
  trafficAlert: {
    backgroundColor: '#fff5f5',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    gap: 8,
  },
  trafficText: {
    color: '#ff6b6b',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },

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
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    width: 144,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  birthdayAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
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

  // ── Mood carousel ───────────────────────────────────────────────────────────
  moodTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
    marginBottom: 16,
  },
  moodItem: {
    width: MOOD_ITEM_WIDTH,
    alignItems: 'center',
    paddingVertical: 8,
    // Reserve height for largest size (56) so non-active items don't jump layout
    minHeight: 80,
    justifyContent: 'flex-end',
    gap: 4,
  },
  moodLabel: { fontSize: 12, color: '#94a3b8', textAlign: 'center' },
  moodLabelActive: { fontSize: 14, color: '#111517', fontWeight: '700' },

  // ── Compact mood card (after selection) ─────────────────────────────────────
  moodCompactCard: {
    backgroundColor: '#f0f7ff',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  moodCompactLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
  },
  moodCompactPhrase: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 2,
  },

  // ── Mood popup modal ────────────────────────────────────────────────────────
  moodModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moodModalCard: {
    backgroundColor: '#fff',
    borderRadius: 28,
    padding: 28,
    width: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  moodModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
    marginBottom: 20,
  },
  moodConfirmBtn: {
    marginTop: 20,
    backgroundColor: '#36a9e2',
    borderRadius: 50,
    paddingVertical: 13,
    alignItems: 'center',
  },
  moodConfirmBtnDisabled: {
    backgroundColor: '#e5e7eb',
  },
  moodConfirmBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  moodModalClose: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  moodModalCloseText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '600',
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
