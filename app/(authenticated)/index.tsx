import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotifications } from '@/contexts/NotificationsContext';
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

const MOODS = [
  { emoji: '😍', label: 'מדהים',   value: 4, phrase: 'יום מוצלח ומלא בעשייה! 🌟' },
  { emoji: '😊', label: 'בסדר',    value: 3, phrase: 'יום טוב, כל הכבוד! 👍' },
  { emoji: '😐', label: 'רגיל',    value: 2, phrase: 'יום רגיל – ולפעמים זה בדיוק מה שצריך.' },
  { emoji: '😓', label: 'עמוס',    value: 1, phrase: 'יום עמוס! תנוחי טוב הלילה.' },
  { emoji: '😤', label: 'מתסכל',   value: 0, phrase: 'יום מאתגר. מחר יהיה טוב יותר 💙' },
];

const MOOD_ITEM_WIDTH = 80;
const wheelMoods = [...MOODS, ...MOODS, ...MOODS];
const MOOD_INITIAL_X = MOODS.length * MOOD_ITEM_WIDTH;

// ─── Types ────────────────────────────────────────────────────────────────────

type Item = {
  id: string;
  time: string;
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
  const [showToast, setShowToast] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [calendarMode, setCalendarMode] = useState<'carousel' | 'month'>('carousel');

  // ── Mood popup state ───────────────────────────────────────────────────────
  const [hasSeenMoodPopupToday, setHasSeenMoodPopupToday] = useState(false);
  const [lastMoodDate, setLastMoodDate] = useState<string | null>(null);
  const [isMoodModalVisible, setIsMoodModalVisible] = useState(false);
  // Tracks the in-modal selection before the user confirms
  const [tempMoodSelection, setTempMoodSelection] = useState<number | null>(null);

  // ── Insight card ───────────────────────────────────────────────────────────
  const [dismissedInsightDate, setDismissedInsightDate] = useState<string | null>(null);

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
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(new Date(year, month, d));
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
    },
  ]);

  // ── All-day events (mock) ──────────────────────────────────────────────────
  const allDayEvents = [
    { id: 'ad1', title: 'חג ראש חודש', iconColor: '#36a9e2' },
  ];

  // ── Undated tasks ──────────────────────────────────────────────────────────
  const [undatedTasks, setUndatedTasks] = useState<UndatedTask[]>([
    { id: 'u1', title: 'לקרוא ספר', completed: false },
    { id: 'u2', title: 'לצלם תמונות', completed: false },
    { id: 'u3', title: 'לסדר ארון הבגדים', completed: false },
  ]);

  const toggleUndatedTask = (id: string) => {
    setUndatedTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  // ── Empty states ───────────────────────────────────────────────────────────
  const hasAnyData = items.length > 0 || undatedTasks.length > 0;
  const hasDayData = items.filter((i) => !i.allDay).length > 0;

  // ── Insight card ───────────────────────────────────────────────────────────
  const showInsightCard = hasAnyData && dismissedInsightDate !== todayISO;
  // TODO: להחליף ללוגיקת AI בעתיד
  const insightText =
    items.length > 3
      ? 'יש לך יום עמוס היום, שווה לשקול להזיז משימה אחת למחר.'
      : 'היום שלך נראה רגוע, אולי זה זמן טוב להשלים משהו קטן מהמשימות הפתוחות.';

  const dismissInsight = () => setDismissedInsightDate(todayISO);

  // ── Task handlers ──────────────────────────────────────────────────────────
  const toggleTask = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
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
      router.push({
        pathname: '/(authenticated)/event/[id]',
        params: { id: item.id },
      });
    }
  };

  // ── Mood helpers ───────────────────────────────────────────────────────────
  // TODO: להחליף ללוגיקת AI בעתיד (לחבר רגש + תובנה)
  const shouldShowMoodPrompt = useCallback((): boolean => {
    const lastHour = items.reduce((max, item) => {
      const h = parseInt(item.time.split(':')[0], 10);
      return h > max ? h : max;
    }, 0);
    const moodStartHour = Math.max(19, lastHour);
    return new Date().getHours() >= moodStartHour;
  }, [items]);

  // Reset mood state when a new day begins
  useEffect(() => {
    if (lastMoodDate !== null && lastMoodDate !== todayISO) {
      setHasSeenMoodPopupToday(false);
      setSelectedMood(null);
    }
  }, []); // runs once on mount

  // Check every minute whether to show the mood popup
  useEffect(() => {
    const check = () => {
      if (shouldShowMoodPrompt() && selectedMood === null && !hasSeenMoodPopupToday) {
        setTempMoodSelection(null);
        setIsMoodModalVisible(true);
      }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [shouldShowMoodPrompt, selectedMood, hasSeenMoodPopupToday]);

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
    const offset = Math.max(0, todayIndex * PILL_WIDTH - (screenWidth - 32 - 38) / 2 + 21);
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
  const handlePopupScrollEnd = (e: { nativeEvent: { contentOffset: { x: number } } }) => {
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
  const handleBottomScrollEnd = (e: { nativeEvent: { contentOffset: { x: number } } }) => {
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

  const AVATAR_COLORS = ['#FFD1DC', '#E0F2F1', '#FFF9C4', '#E8EAF6', '#FCE4EC'];

  const moodWheelPad = (screenWidth - 48 - MOOD_ITEM_WIDTH) / 2;
  const moodPopupHPad = Math.max(0, (screenWidth * 0.88 - 56 - MOOD_ITEM_WIDTH) / 2);

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
      decelerationRate={0.9}
      contentContainerStyle={{ paddingHorizontal: pad }}
      onMomentumScrollEnd={onScrollEnd}
    >
      {wheelMoods.map((mood, i) => {
        const isActive = activeMoodValue === mood.value;
        return (
          <Pressable
            key={i}
            onPress={() => (onItemTap ?? handleMoodSelect)(mood.value)}
            style={styles.moodItem}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={mood.label}
          >
            <View style={[styles.moodEmojiWrap, isActive && styles.moodEmojiWrapActive]}>
              <Text style={{ fontSize: isActive ? 36 : 26, opacity: isActive ? 1 : 0.45 }}>
                {mood.emoji}
              </Text>
            </View>
            <Text style={[styles.moodLabel, isActive && styles.moodLabelActive]}>
              {mood.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  // ── Month calendar grid ─────────────────────────────────────────────────────
  const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const monthName = today.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const calGridDays: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calGridDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calGridDays.push(new Date(year, month, d));
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
  const nextEvent = items.find((i) => !i.allDay && !i.completed);
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
    const offset = Math.max(0, todayIndex * PILL_WIDTH - (screenWidth - 32 - 38) / 2 + 21);
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
          accessibilityLabel={unseenCount > 0 ? `התראות, ${unseenCount} חדשות` : 'התראות'}
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
              name={calendarMode === 'carousel' ? 'calendar-month' : 'view-week'}
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
                const shortName = day.toLocaleDateString('he-IL', { weekday: 'short' });
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
                      style={[styles.dayPillWeekday, isSelected && styles.dayPillTextSelected]}
                    >
                      {shortName}
                    </Text>
                    <Text
                      style={[styles.dayPillNumber, isSelected && styles.dayPillTextSelected]}
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

        {hasAnyData && (
          <Text style={styles.subtitleCount}>
            יש לך {items.filter((i) => !i.allDay).length + 1} פעילויות היום
          </Text>
        )}

        {/* ── Empty state — new user (no data at all) ──────────────────────── */}
        {!hasAnyData && (
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
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="הוספת אירוע ראשון"
            >
              <Text style={styles.emptyStateSecondaryBtnText}>הוספת אירוע ראשון</Text>
            </Pressable>
            <Text style={styles.emptyStateHint}>
              אפשר גם ללחוץ על הפלוס במרכז המסך כדי ליצור אירוע, משימה, יום הולדת או
              קבוצה.
            </Text>
          </View>
        )}

        {/* ── Upcoming event card (only if next event exists) ───────────────── */}
        {hasAnyData && nextEvent && (
          <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <View style={[styles.cardShadow, styles.eventCard]}>
              <View style={styles.eventAccentBar} />
              <View style={{ padding: 24, paddingRight: 32 }}>
                <View style={styles.eventTopRow}>
                  <View style={styles.eventNextPill}>
                    <Text style={styles.eventNextPillText}>האירוע הבא</Text>
                  </View>
                  <Text style={styles.eventTime}>{nextEvent.time}</Text>
                </View>
                <Text style={styles.eventTitle}>{nextEvent.title}</Text>
                <View style={styles.eventAddressRow}>
                  <View style={styles.eventAddressGroup}>
                    <MaterialIcons name="location-on" size={16} color="#94a3b8" />
                    <Text style={styles.eventAddress} numberOfLines={1}>
                      {nextEvent.location}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.navBtn}
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
          </View>
        )}

        {/* ── Empty day state (data exists but not today) ──────────────────── */}
        {hasAnyData && !hasDayData && (
          <View style={styles.emptyDayContainer}>
            <MaterialIcons name="calendar-today" size={28} color="#d1d5db" />
            <Text style={styles.emptyDayTitle}>היום פנוי 🎉</Text>
            <Text style={styles.emptyDaySubtitle}>
              אין לך אירועים או משימות בתאריך הזה.
            </Text>
            <Pressable accessible={true} accessibilityRole="button" accessibilityLabel="הוספת אירוע">
              <Text style={styles.emptyDayLink}>+ הוספת אירוע</Text>
            </Pressable>
          </View>
        )}

        {/* ── Birthdays ──────────────────────────────────────────────────────── */}
        <View style={{ marginBottom: 32 }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🎂 ימי הולדת קרובים</Text>
            <Pressable onPress={() => router.push('/birthdays')}>
              <Text style={styles.seeAll}>ראה הכל</Text>
            </Pressable>
          </View>
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
                      { backgroundColor: AVATAR_COLORS[idx % AVATAR_COLORS.length] },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.birthdayCountdown}>{getCountdownLabel(b)}:</Text>
                    <Text style={styles.birthdayName}>{b.name}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
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
                  <View key={ev.id} style={styles.allDayCard}>
                    <View style={[styles.allDayAccent, { backgroundColor: ev.iconColor }]} />
                    <Text style={styles.allDayTitle}>{ev.title}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Hourly timeline */}
            <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
              {items
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
                        <MaterialIcons name="delete-outline" size={26} color="white" />
                      </Pressable>
                    )}
                  >
                    <View style={{ flexDirection: 'row-reverse', gap: 16, marginBottom: 4 }}>
                      {/* Time column */}
                      <View style={styles.timeColumn}>
                        <Text style={styles.timeText}>{item.time}</Text>
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
                                <Pressable
                                  onPress={(e) => {
                                    e.stopPropagation?.();
                                    toggleTask(item.id);
                                  }}
                                  style={[
                                    styles.taskCheckbox,
                                    item.completed
                                      ? styles.taskCheckboxDone
                                      : styles.taskCheckboxEmpty,
                                  ]}
                                >
                                  {item.completed && (
                                    <MaterialIcons name="check" size={14} color="white" />
                                  )}
                                </Pressable>
                              )}
                              <View style={{ flex: 1 }}>
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
                                    <View style={styles.pendingBadge}>
                                      <Text style={styles.pendingBadgeText}>
                                        ממתין לאישור
                                      </Text>
                                    </View>
                                  )}
                                  <View
                                    style={[
                                      styles.assigneeCircle,
                                      { backgroundColor: item.assigneeColor },
                                    ]}
                                  />
                                </View>
                                <Text style={styles.itemLocation}>{item.location}</Text>
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
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 24, paddingLeft: 8 }}
            >
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                {undatedTasks.map((task) => (
                  <Pressable
                    key={task.id}
                    style={styles.undatedCard}
                    onPress={() => console.log('TODO: navigate to task edit', task.id)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={task.title}
                  >
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        toggleUndatedTask(task.id);
                      }}
                      style={[
                        styles.undatedCheckbox,
                        task.completed && styles.undatedCheckboxDone,
                      ]}
                      accessible={true}
                      accessibilityRole="checkbox"
                      accessibilityLabel="סמן כהושלמה"
                    >
                      {task.completed && (
                        <MaterialIcons name="check" size={12} color="white" />
                      )}
                    </Pressable>
                    <Text
                      style={[styles.undatedTitle, task.completed && styles.completedText]}
                      numberOfLines={2}
                    >
                      {task.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* ── Mood section ───────────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 24, marginTop: 8, marginBottom: 32 }}>
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
              <Text style={styles.moodCompactEmoji}>{selectedMoodData.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.moodCompactLabel}>{selectedMoodData.label}</Text>
                <Text style={styles.moodCompactPhrase}>{selectedMoodData.phrase}</Text>
              </View>
              {lastMoodDate === todayISO && (
                <MaterialIcons name="edit" size={16} color="#94a3b8" />
              )}
            </Pressable>
          ) : (
            renderMoodWheel(moodScrollRef, moodWheelPad, handleBottomScrollEnd)
          )}
        </View>
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
  dayPillNumber: { fontSize: 15, fontWeight: '700', color: '#111517', marginTop: 2 },
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
  taskCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCheckboxDone: { backgroundColor: '#36a9e2', borderColor: '#36a9e2' },
  taskCheckboxEmpty: { borderColor: '#d1d5db' },
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
  itemLocation: { color: '#94a3b8', fontSize: 13, textAlign: 'right', marginTop: 2 },

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
  undatedCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    width: 120,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
  },
  undatedCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  undatedCheckboxDone: {
    backgroundColor: '#36a9e2',
    borderColor: '#36a9e2',
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
  moodItem: { width: MOOD_ITEM_WIDTH, alignItems: 'center', paddingVertical: 8 },
  moodEmojiWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  moodEmojiWrapActive: { borderWidth: 2, borderColor: '#36a9e2' },
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
  moodCompactEmoji: { fontSize: 32 },
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
  toastText: { color: '#374151', fontSize: 14, lineHeight: 20, textAlign: 'right' },

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
