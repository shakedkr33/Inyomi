import { useEffect, useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeViewGestureHandler } from 'react-native-gesture-handler';

const ITEM_HEIGHT = 44;
// 5 visible items: center row (index 2) is selected.
// With paddingVertical = 2*ITEM_HEIGHT the scroll math is:
//   item-center-in-content = paddingTop + index*ITEM_HEIGHT + ITEM_HEIGHT/2
//   visible-center          = scrollY + CONTAINER_HEIGHT/2
//   when scrollY = index*ITEM_HEIGHT → both equal paddingTop + ITEM_HEIGHT/2 = CONTAINER_HEIGHT/2 ✓
const VISIBLE_ITEMS = 5;
const CONTAINER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // 220

const MONTHS_HE = [
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

interface BirthdayWheelPickerProps {
  day: number;
  month: number;
  year: number | null;
  onDayChange: (d: number) => void;
  onMonthChange: (m: number) => void;
  onYearChange: (y: number | null) => void;
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTH_ITEMS = MONTHS_HE.map((m, i) => ({ label: m, value: i + 1 }));
const YEAR_ITEMS: { label: string; value: number | null }[] = [
  { label: 'לא ידוע', value: null },
  ...Array.from({ length: 100 }, (_, i) => {
    const y = new Date().getFullYear() - i;
    return { label: y.toString(), value: y };
  }),
];

export function BirthdayWheelPicker({
  day,
  month,
  year,
  onDayChange,
  onMonthChange,
  onYearChange,
}: BirthdayWheelPickerProps): React.JSX.Element {
  const dayScroll = useRef<ScrollView>(null);
  const monthScroll = useRef<ScrollView>(null);
  const yearScroll = useRef<ScrollView>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      dayScroll.current?.scrollTo({
        y: (day - 1) * ITEM_HEIGHT,
        animated: false,
      });
      monthScroll.current?.scrollTo({
        y: (month - 1) * ITEM_HEIGHT,
        animated: false,
      });
      const yearIndex = year
        ? YEAR_ITEMS.findIndex((y) => y.value === year)
        : 0;
      yearScroll.current?.scrollTo({
        y: Math.max(0, yearIndex) * ITEM_HEIGHT,
        animated: false,
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [day, month, year]);

  const handleDayScroll = (
    e: NativeSyntheticEvent<NativeScrollEvent>
  ): void => {
    const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    if (index >= 0 && index < DAYS.length && DAYS[index] !== day) {
      onDayChange(DAYS[index]);
    }
  };

  const handleMonthScroll = (
    e: NativeSyntheticEvent<NativeScrollEvent>
  ): void => {
    const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    if (
      index >= 0 &&
      index < MONTH_ITEMS.length &&
      MONTH_ITEMS[index].value !== month
    ) {
      onMonthChange(MONTH_ITEMS[index].value);
    }
  };

  const handleYearScroll = (
    e: NativeSyntheticEvent<NativeScrollEvent>
  ): void => {
    const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    if (
      index >= 0 &&
      index < YEAR_ITEMS.length &&
      YEAR_ITEMS[index].value !== year
    ) {
      onYearChange(YEAR_ITEMS[index].value);
    }
  };

  return (
    <View style={s.container}>
      <View style={s.indicator} />

      <View style={s.columns}>
        {/* NativeViewGestureHandler tells RNGH not to interrupt the native
            ScrollView gesture — fixes picker being unresponsive on first touch */}
        <NativeViewGestureHandler disallowInterruption={true}>
          <ScrollView
            ref={dayScroll}
            style={s.column}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            onMomentumScrollEnd={handleDayScroll}
            contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
          >
            {DAYS.map((d) => (
              <View key={`day-${d}`} style={s.item}>
                <Text style={[s.itemText, d === day && s.itemTextActive]}>
                  {d}
                </Text>
              </View>
            ))}
          </ScrollView>
        </NativeViewGestureHandler>

        <NativeViewGestureHandler disallowInterruption={true}>
          <ScrollView
            ref={monthScroll}
            style={s.column}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            onMomentumScrollEnd={handleMonthScroll}
            contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
          >
            {MONTH_ITEMS.map((m) => (
              <View key={`month-${m.value}`} style={s.item}>
                <Text
                  style={[s.itemText, m.value === month && s.itemTextActive]}
                >
                  {m.label}
                </Text>
              </View>
            ))}
          </ScrollView>
        </NativeViewGestureHandler>

        <NativeViewGestureHandler disallowInterruption={true}>
          <ScrollView
            ref={yearScroll}
            style={s.column}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            onMomentumScrollEnd={handleYearScroll}
            contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
          >
            {YEAR_ITEMS.map((y) => (
              <View key={`year-${y.value ?? 'null'}`} style={s.item}>
                <Text
                  style={[s.itemText, y.value === year && s.itemTextActive]}
                >
                  {y.label}
                </Text>
              </View>
            ))}
          </ScrollView>
        </NativeViewGestureHandler>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    height: CONTAINER_HEIGHT,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  indicator: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    marginTop: -ITEM_HEIGHT / 2,
    backgroundColor: '#36a9e215',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#36a9e230',
    zIndex: 1,
    pointerEvents: 'none',
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
  },
  column: { flex: 1 },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: { fontSize: 18, color: '#9ca3af' },
  itemTextActive: { color: '#111517', fontWeight: '700' },
});
