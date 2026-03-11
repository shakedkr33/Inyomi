import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#36a9e2';

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthStep = 'connect' | 'connecting' | 'settings';
type TimeRange = 'future' | 'all' | 'custom';
type DuplicateStrategy = 'skip' | 'import-all';

interface MockEvent {
  id: string;
  title: string;
  date: string;
  time?: string;
}

// ─── Mock events returned after "OAuth" ───────────────────────────────────────
const MOCK_EVENTS: MockEvent[] = [
  { id: '1', title: 'ישיבת צוות שבועית', date: '2025-03-03', time: '10:00' },
  { id: '2', title: 'יום הולדת אמא', date: '2025-03-10' },
  { id: '3', title: 'תור שיניים', date: '2025-03-12', time: '14:30' },
  { id: '4', title: 'ועידת הורים', date: '2025-03-18', time: '18:00' },
  { id: '5', title: 'ערב חג פסח', date: '2025-04-12' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ImportCalendarScreen(): React.JSX.Element {
  const router = useRouter();

  const [step, setStep] = useState<AuthStep>('connect');
  const [connectedEmail, setConnectedEmail] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('future');
  const [includeWithTime, setIncludeWithTime] = useState(true);
  const [includeAllDay, setIncludeAllDay] = useState(true);
  const [duplicates, setDuplicates] = useState<DuplicateStrategy>('skip');
  const [importing, setImporting] = useState(false);

  // Filter events based on settings
  const filteredEvents = MOCK_EVENTS.filter((e) => {
    const hasTime = Boolean(e.time);
    if (!includeWithTime && hasTime) return false;
    if (!includeAllDay && !hasTime) return false;
    return true;
  });

  // ─── Mock Google OAuth ────────────────────────────────────────────────────
  // To enable real OAuth, replace this with expo-auth-session + Google Sign-In:
  // import * as Google from 'expo-auth-session/providers/google';
  // const [request, response, promptAsync] = Google.useAuthRequest({ ... });
  const handleConnectGoogle = (): void => {
    setStep('connecting');
    // Simulate OAuth round-trip
    setTimeout(() => {
      setConnectedEmail('user@gmail.com');
      setStep('settings');
    }, 1800);
  };

  const handleImport = async (): Promise<void> => {
    if (!includeWithTime && !includeAllDay) {
      Alert.alert('שגיאה', 'יש לבחור לפחות סוג אירוע אחד לייבוא');
      return;
    }
    setImporting(true);
    // Simulate import
    await new Promise((r) => setTimeout(r, 1200));
    setImporting(false);
    Alert.alert(
      'ייבוא הושלם ✓',
      `${filteredEvents.length} אירועים יובאו בהצלחה ליומן שלך`,
      [{ text: 'מצוין', onPress: () => router.back() }]
    );
  };

  return (
    <SafeAreaView style={s.screen}>
      {/* Custom header */}
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
        <Text style={s.headerTitle}>ייבוא יומן חיצוני</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ─── Step 1: Connect ─────────────────────────────────────────────── */}
      {step !== 'settings' && (
        <View style={s.connectStep}>
          <View style={s.googleIconWrap}>
            {step === 'connecting' ? (
              <ActivityIndicator size="large" color={PRIMARY} />
            ) : (
              <View style={s.googleCircle}>
                <Text style={s.googleLetter}>G</Text>
              </View>
            )}
          </View>

          <Text style={s.connectTitle}>
            {step === 'connecting'
              ? 'מתחבר לחשבון Google...'
              : 'חבר את יומן Google שלך'}
          </Text>
          <Text style={s.connectSubtitle}>
            ייבוא חד-פעמי של אירועים קיימים{'\n'}לתוך האפליקציה
          </Text>

          {step === 'connect' && (
            <Pressable
              style={s.googleBtn}
              onPress={handleConnectGoogle}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="התחבר עם Google"
            >
              <View style={s.googleBtnIcon}>
                <Text style={s.googleLetter}>G</Text>
              </View>
              <Text style={s.googleBtnText}>התחבר עם Google</Text>
            </Pressable>
          )}

          <View style={s.scopeNote}>
            <MaterialIcons name="lock" size={14} color="#94a3b8" />
            <Text style={s.scopeNoteText}>
              הגישה לקריאה בלבד · לא נשמר סיסמה
            </Text>
          </View>
        </View>
      )}

      {/* ─── Step 2: Settings ────────────────────────────────────────────── */}
      {step === 'settings' && (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Connected account badge */}
            <View style={s.connectedBadge}>
              <View style={s.connectedDot} />
              <Text style={s.connectedText}>{connectedEmail}</Text>
              <MaterialIcons name="check-circle" size={16} color="#22c55e" />
            </View>

            {/* ── Time range ── */}
            <SectionCard title="טווח זמן">
              <View style={s.pills}>
                <Pill
                  label="אירועים עתידיים בלבד"
                  active={timeRange === 'future'}
                  onPress={() => setTimeRange('future')}
                />
                <Pill
                  label="כל האירועים"
                  active={timeRange === 'all'}
                  onPress={() => setTimeRange('all')}
                />
                <Pill
                  label="בחירה ידנית"
                  active={timeRange === 'custom'}
                  onPress={() => setTimeRange('custom')}
                />
              </View>
              {timeRange === 'custom' && (
                <View style={s.customDateRow}>
                  <DateField label="עד" />
                  <Text style={s.dateSep}>—</Text>
                  <DateField label="מ-" />
                </View>
              )}
            </SectionCard>

            {/* ── What to import ── */}
            <SectionCard title="מה לייבא">
              <CheckRow
                label="אירועים עם שעה"
                checked={includeWithTime}
                onToggle={() => setIncludeWithTime((p) => !p)}
              />
              <CheckRow
                label="אירועים ללא שעה (כל היום)"
                checked={includeAllDay}
                onToggle={() => setIncludeAllDay((p) => !p)}
              />
            </SectionCard>

            {/* ── Duplicates ── */}
            <SectionCard title="כפילויות">
              <RadioRow
                label="לדלג על אירועים זהים"
                selected={duplicates === 'skip'}
                onSelect={() => setDuplicates('skip')}
              />
              <RadioRow
                label="לייבא הכל"
                selected={duplicates === 'import-all'}
                onSelect={() => setDuplicates('import-all')}
              />
            </SectionCard>

            {/* ── Preview ── */}
            <SectionCard title="תצוגה מקדימה">
              <View style={s.previewHeader}>
                <MaterialIcons
                  name="event-available"
                  size={16}
                  color={PRIMARY}
                />
                <Text style={s.previewCount}>
                  נמצאו {filteredEvents.length} אירועים
                </Text>
              </View>
              {filteredEvents.slice(0, 3).map((ev) => (
                <View key={ev.id} style={s.previewRow}>
                  <Text style={s.previewDate}>
                    {ev.date.split('-').reverse().join('.')}
                  </Text>
                  <View style={s.previewDot} />
                  <Text style={s.previewTitle} numberOfLines={1}>
                    {ev.title}
                  </Text>
                  {ev.time && <Text style={s.previewTime}>{ev.time}</Text>}
                </View>
              ))}
              {filteredEvents.length > 3 && (
                <Text style={s.previewMore}>
                  ועוד {filteredEvents.length - 3} אירועים...
                </Text>
              )}
            </SectionCard>

            <View style={{ height: 100 }} />
          </ScrollView>

          {/* Fixed CTA */}
          <View style={s.cta}>
            <Pressable
              style={[
                s.importBtn,
                filteredEvents.length === 0 && s.importBtnDisabled,
              ]}
              onPress={handleImport}
              disabled={importing || filteredEvents.length === 0}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`ייבוא ${filteredEvents.length} אירועים`}
            >
              {importing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="cloud-download" size={20} color="#fff" />
                  <Text style={s.importBtnText}>
                    ייבוא {filteredEvents.length} אירועים
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={[s.pill, active && s.pillActive]}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={s.checkRow}
      onPress={onToggle}
      accessible={true}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View style={[s.checkbox, checked && s.checkboxChecked]}>
        {checked && <MaterialIcons name="check" size={14} color="#fff" />}
      </View>
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  );
}

function RadioRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={s.checkRow}
      onPress={onSelect}
      accessible={true}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={[s.radio, selected && s.radioSelected]}>
        {selected && <View style={s.radioDot} />}
      </View>
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  );
}

function DateField({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={s.dateField}>
      <Text style={s.dateFieldLabel}>{label}</Text>
      <Pressable style={s.dateFieldBtn}>
        <MaterialIcons name="calendar-today" size={14} color={PRIMARY} />
        <Text style={s.dateFieldText}>בחר תאריך</Text>
      </Pressable>
    </View>
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
    textAlign: 'center',
  },
  // ─── Connect step ────────────────────────────────
  connectStep: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  googleIconWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  googleCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  googleLetter: {
    fontSize: 36,
    fontWeight: '700',
    color: '#4285F4',
  },
  connectTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  connectSubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
  },
  googleBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  googleBtnIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  googleBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  scopeNote: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  scopeNoteText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  // ─── Settings step ───────────────────────────────
  scrollContent: { padding: 20, gap: 16 },
  connectedBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  connectedText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#166534',
    textAlign: 'right',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'right',
    marginBottom: 4,
  },
  pills: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  pillActive: { borderColor: PRIMARY, backgroundColor: `${PRIMARY}15` },
  pillText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  pillTextActive: { color: PRIMARY },
  customDateRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  dateSep: { color: '#94a3b8', fontSize: 14 },
  dateField: { flex: 1, gap: 4 },
  dateFieldLabel: { fontSize: 11, color: '#94a3b8', textAlign: 'right' },
  dateFieldBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dateFieldText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  checkRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: PRIMARY },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY,
  },
  checkLabel: { fontSize: 14, color: '#1e293b', fontWeight: '500' },
  previewHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  previewCount: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
  },
  previewRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  previewDate: {
    fontSize: 12,
    color: '#94a3b8',
    width: 70,
    textAlign: 'right',
  },
  previewDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: PRIMARY,
  },
  previewTitle: { flex: 1, fontSize: 13, color: '#1e293b', textAlign: 'right' },
  previewTime: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  previewMore: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    paddingTop: 8,
  },
  // ─── CTA ────────────────────────────────────────
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
    backgroundColor: PRIMARY,
    height: 54,
    borderRadius: 14,
    shadowColor: PRIMARY,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
});
