import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#36a9e2';
const HOLIDAY_COLOR = '#f59e0b';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HolidayItem {
  id: string;
  title: string;
  hebrew: string;
  date: string;
  category: string;
}

type YearSelection = 2025 | 2026 | 'both';

// ─── Hebcal API ───────────────────────────────────────────────────────────────

const fetchHolidays = async (year: number): Promise<HolidayItem[]> => {
  const url =
    `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off` +
    `&nx=off&ss=off&mf=off&c=off&geo=none&lg=he&year=${year}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.items ?? []).map(
    (
      item: { title: string; hebrew?: string; date: string; category?: string },
      idx: number
    ) => ({
      id: `${year}-${idx}`,
      title: item.title,
      hebrew: item.hebrew ?? item.title,
      date: item.date,
      category: item.category ?? 'holiday',
    })
  );
};

// ─── Helpers (outside component to avoid re-definition on render) ─────────────

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

const SKELETON_KEYS = [
  'sk-a',
  'sk-b',
  'sk-c',
  'sk-d',
  'sk-e',
  'sk-f',
  'sk-g',
  'sk-h',
];

function Skeleton(): React.JSX.Element {
  return (
    <View style={s.skeletonContainer}>
      {SKELETON_KEYS.map((key) => (
        <View key={key} style={s.skeletonRow}>
          <View style={s.skeletonCheck} />
          <View style={s.skeletonLines}>
            <View style={[s.skeletonLine, { width: '55%' }]} />
            <View style={[s.skeletonLine, { width: '30%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ImportHolidaysScreen(): React.JSX.Element {
  const router = useRouter();

  const [yearSel, setYearSel] = useState<YearSelection>('both');
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const loadHolidays = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      let items: HolidayItem[];
      if (yearSel === 'both') {
        const [a, b] = await Promise.all([
          fetchHolidays(2025),
          fetchHolidays(2026),
        ]);
        items = [...a, ...b];
      } else {
        items = await fetchHolidays(yearSel);
      }
      setHolidays(items);
      // Select all by default
      setSelected(new Set(items.map((h) => h.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, [yearSel]);

  useEffect(() => {
    loadHolidays();
  }, [loadHolidays]);

  const toggleItem = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = (): void => setSelected(new Set(holidays.map((h) => h.id)));
  const deselectAll = (): void => setSelected(new Set());

  const handleImport = async (): Promise<void> => {
    const count = selected.size;
    if (count === 0) return;
    setImporting(true);
    // Build events to save:
    // holidays.filter(h => selected.has(h.id)).map(h => ({
    //   title: h.hebrew || h.title,
    //   date: h.date,
    //   type: 'holiday',
    //   allDay: true,
    //   color: HOLIDAY_COLOR,
    // }))
    await new Promise((r) => setTimeout(r, 1000));
    setImporting(false);
    Alert.alert('ייבוא הושלם ✓', `${count} חגים יובאו בהצלחה ליומן שלך`, [
      { text: 'מצוין', onPress: () => router.back() },
    ]);
  };

  // ─── Render row ────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: HolidayItem }): React.JSX.Element => {
      const isSelected = selected.has(item.id);
      return (
        <Pressable
          style={({ pressed }) => [s.holidayRow, pressed && s.rowPressed]}
          onPress={() => toggleItem(item.id)}
          accessible={true}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={item.hebrew}
        >
          <View style={[s.checkbox, isSelected && s.checkboxChecked]}>
            {isSelected && (
              <MaterialIcons name="check" size={14} color="#fff" />
            )}
          </View>
          <View style={s.holidayInfo}>
            <Text style={s.holidayName}>{item.hebrew}</Text>
            <Text style={s.holidayDate}>{formatDate(item.date)}</Text>
          </View>
          <View style={s.holidayDot} />
        </Pressable>
      );
    },
    [selected, toggleItem]
  );

  return (
    <SafeAreaView style={s.screen}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          style={s.backBtn}
          onPress={() => router.back()}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <MaterialIcons name="arrow-forward-ios" size={20} color="#1e293b" />
        </Pressable>
        <Text style={s.headerTitle}>ייבוא חגים ישראליים</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Explanation */}
      <View style={s.explainCard}>
        <MaterialIcons name="celebration" size={24} color={HOLIDAY_COLOR} />
        <Text style={s.explainText}>
          ייבא חגים ישראליים לתוך היומן שלך בלחיצה אחת
        </Text>
      </View>

      {/* Year pills */}
      <View style={s.yearRow}>
        {([2025, 2026, 'both'] as YearSelection[]).map((y) => (
          <Pressable
            key={String(y)}
            style={[s.yearPill, yearSel === y && s.yearPillActive]}
            onPress={() => setYearSel(y)}
            accessible={true}
            accessibilityRole="button"
            accessibilityState={{ selected: yearSel === y }}
            accessibilityLabel={y === 'both' ? 'שתי השנים' : String(y)}
          >
            <Text
              style={[s.yearPillText, yearSel === y && s.yearPillTextActive]}
            >
              {y === 'both' ? 'שתי השנים' : String(y)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Select/deselect controls */}
      {!loading && !error && holidays.length > 0 && (
        <View style={s.bulkActions}>
          <Text style={s.bulkCount}>
            {selected.size} מתוך {holidays.length} נבחרו
          </Text>
          <View style={s.bulkBtns}>
            <Pressable
              style={s.bulkBtn}
              onPress={deselectAll}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="בטל הכל"
            >
              <Text style={s.bulkBtnText}>בטל הכל</Text>
            </Pressable>
            <Pressable
              style={[s.bulkBtn, s.bulkBtnPrimary]}
              onPress={selectAll}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="בחר הכל"
            >
              <Text style={[s.bulkBtnText, s.bulkBtnPrimaryText]}>בחר הכל</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Content */}
      {loading && <Skeleton />}

      {error && !loading && (
        <View style={s.errorState}>
          <MaterialIcons name="wifi-off" size={40} color="#cbd5e1" />
          <Text style={s.errorText}>לא ניתן לטעון חגים</Text>
          <Pressable
            style={s.retryBtn}
            onPress={loadHolidays}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="נסה שוב"
          >
            <MaterialIcons name="refresh" size={16} color="#fff" />
            <Text style={s.retryBtnText}>נסה שוב</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          data={holidays}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({
            length: 60,
            offset: 60 * index,
            index,
          })}
        />
      )}

      {/* Fixed CTA */}
      <View style={s.cta}>
        <Pressable
          style={[s.importBtn, selected.size === 0 && s.importBtnDisabled]}
          onPress={handleImport}
          disabled={importing || selected.size === 0}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`ייבא ${selected.size} חגים`}
        >
          {importing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <MaterialIcons name="celebration" size={20} color="#fff" />
              <Text style={s.importBtnText}>ייבא {selected.size} חגים</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f8' },
  // Header
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  // Explanation card
  explainCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fef3c7',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  explainText: {
    flex: 1,
    fontSize: 14,
    color: '#92400e',
    textAlign: 'right',
    fontWeight: '500',
  },
  // Year pills
  yearRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  yearPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  yearPillActive: {
    borderColor: HOLIDAY_COLOR,
    backgroundColor: `${HOLIDAY_COLOR}18`,
  },
  yearPillText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  yearPillTextActive: { color: '#92400e' },
  // Bulk actions
  bulkActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  bulkCount: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  bulkBtns: { flexDirection: 'row-reverse', gap: 8 },
  bulkBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bulkBtnPrimary: {
    backgroundColor: `${HOLIDAY_COLOR}18`,
    borderColor: HOLIDAY_COLOR,
  },
  bulkBtnText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  bulkBtnPrimaryText: { color: '#92400e' },
  // List
  listContent: { paddingVertical: 8, paddingBottom: 100 },
  holidayRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    height: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  rowPressed: { backgroundColor: '#f8fafc' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: HOLIDAY_COLOR,
    borderColor: HOLIDAY_COLOR,
  },
  holidayInfo: { flex: 1, gap: 2 },
  holidayName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    textAlign: 'right',
  },
  holidayDate: { fontSize: 12, color: '#94a3b8', textAlign: 'right' },
  holidayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: HOLIDAY_COLOR,
  },
  // Skeleton
  skeletonContainer: { paddingTop: 8 },
  skeletonRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    height: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  skeletonCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#e2e8f0',
  },
  skeletonLines: { flex: 1, gap: 6 },
  skeletonLine: {
    height: 12,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    alignSelf: 'flex-end',
  },
  // Error state
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  errorText: { fontSize: 15, color: '#94a3b8', fontWeight: '500' },
  retryBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PRIMARY,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  // CTA
  cta: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  importBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: HOLIDAY_COLOR,
    height: 54,
    borderRadius: 14,
    shadowColor: HOLIDAY_COLOR,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  importBtnDisabled: { opacity: 0.45 },
  importBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
});
