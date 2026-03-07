import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

type DateOption = 'today' | 'tomorrow' | 'other' | 'none';
type NotifyOption = 'none' | 'day_before' | 'two_hours_before' | 'custom';
type ReminderUnit = 'minutes' | 'hours' | 'days';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {text}
      {required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CommunityReminderNewScreen() {
  const router = useRouter();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  // ── Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateOption, setDateOption] = useState<DateOption>('today');
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [timeEnabled, setTimeEnabled] = useState(false);
  const [selectedTime, setSelectedTime] = useState<Date>(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [notifyOption, setNotifyOption] = useState<NotifyOption>('none');
  const [customReminderAmount, setCustomReminderAmount] = useState('30');
  const [customReminderUnit, setCustomReminderUnit] = useState<ReminderUnit>('minutes');
  const [showCustomReminderModal, setShowCustomReminderModal] = useState(false);
  const [customReminderConfirmed, setCustomReminderConfirmed] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Backend
  const spaceId = useQuery(api.users.getMySpace);
  const createReminder = useMutation(api.tasks.create);

  // ── Dynamic notify label
  const getNotifyLabel = (opt: NotifyOption): string => {
    if (opt === 'custom' && customReminderConfirmed) {
      const unitLabel =
        customReminderUnit === 'minutes' ? 'דקות' :
        customReminderUnit === 'hours' ? 'שעות' : 'ימים';
      return `${customReminderAmount} ${unitLabel} לפני`;
    }
    const labels: Record<NotifyOption, string> = {
      none: 'ללא התראה',
      day_before: 'יום לפני',
      two_hours_before: 'שעתיים לפני',
      custom: 'מותאם אישית',
    };
    return labels[opt];
  };

  // ── Resolve due date
  const resolveDueDate = (): number | undefined => {
    if (dateOption === 'none') return undefined;
    let base: Date;
    if (dateOption === 'today') {
      base = new Date();
    } else if (dateOption === 'tomorrow') {
      base = new Date();
      base.setDate(base.getDate() + 1);
    } else if (dateOption === 'other' && customDate) {
      base = new Date(customDate);
    } else {
      return undefined;
    }

    if (timeEnabled) {
      base.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
    } else {
      base.setHours(9, 0, 0, 0);
    }
    return base.getTime();
  };

  // ── Save
  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }

    // Only require spaceId when there's no communityId context
    if (!spaceId && !communityId) {
      Alert.alert('שגיאה', 'לא נמצא מרחב פעיל. נסה להתנתק ולהתחבר מחדש.');
      return;
    }

    setSaving(true);
    try {
      await createReminder({
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: resolveDueDate(),
        spaceId: spaceId ?? undefined,
        communityId: communityId ? communityId as Id<'communities'> : undefined,
      });
      router.back();
    } catch (e) {
      console.error('createReminder error:', e);
      Alert.alert('שגיאה', 'לא ניתן לשמור את התזכורת. נסה שוב.');
    } finally {
      setSaving(false);
    }
  }, [title, description, spaceId, communityId, dateOption, customDate, timeEnabled, selectedTime, createReminder, router]);

  // ── Section X: save disabled only while loading (undefined) or title is empty
  const isSaveDisabled = !title.trim() || saving || spaceId === undefined;

  // ── Loading state
  if (spaceId === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>תזכורת חדשה</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  // ── No space error (only when there's no communityId context either)
  if (!spaceId && !communityId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>תזכורת חדשה</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="warning-outline" size={48} color="#9ca3af" />
          <Text style={styles.errorStateTitle}>לא נמצא מרחב פעיל</Text>
          <TouchableOpacity
            style={styles.errorStateBtn}
            onPress={() => router.back()}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.errorStateBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Date chip label for "other"
  const otherChipLabel =
    dateOption === 'other' && customDate
      ? customDate.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
      : 'אחר';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="סגור"
        >
          <Ionicons name="close" size={22} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>תזכורת חדשה</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── מה להזכיר */}
          <View style={styles.card}>
            <FieldLabel text="מה להזכיר?" required />
            <TextInput
              style={[styles.input, titleError && styles.inputError]}
              value={title}
              onChangeText={(t) => { setTitle(t); if (t.trim()) setTitleError(false); }}
              placeholder="הקלידי את הנושא..."
              placeholderTextColor="#9ca3af"
              textAlign="right"
              multiline={false}
              maxLength={120}
              returnKeyType="next"
              accessible
              accessibilityLabel="נושא התזכורת"
            />
            {titleError ? (
              <Text style={styles.errorText}>שדה זה נדרש</Text>
            ) : null}
          </View>

          {/* ── תיאור קצר */}
          <View style={styles.card}>
            <FieldLabel text="תיאור קצר" />
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="פרטים נוספים (אופציונלי)..."
              placeholderTextColor="#9ca3af"
              textAlign="right"
              multiline
              numberOfLines={3}
              maxLength={300}
              accessible
              accessibilityLabel="תיאור"
            />
          </View>

          {/* ── תאריך */}
          <View style={styles.card}>
            <FieldLabel text="תאריך" />
            <View style={styles.chipRow}>
              {([
                ['today', 'היום'],
                ['tomorrow', 'מחר'],
                ['none', 'ללא תאריך'],
                ['other', otherChipLabel],
              ] as [DateOption, string][]).map(([val, label]) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.chip, dateOption === val && styles.chipActive]}
                  onPress={() => {
                    setDateOption(val);
                    if (val !== 'other') {
                      setDatePickerOpen(false);
                      setCalendarPickerOpen(false);
                    }
                  }}
                  accessible
                  accessibilityRole="button"
                  accessibilityState={{ selected: dateOption === val }}
                  accessibilityLabel={label}
                >
                  <Text style={[styles.chipText, dateOption === val && styles.chipTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Date row + pickers — visible only when "other" is selected */}
            {dateOption === 'other' ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  {/* Calendar icon — opens monthly picker */}
                  <TouchableOpacity
                    onPress={() => {
                      setCalendarPickerOpen(!calendarPickerOpen);
                      setDatePickerOpen(false);
                    }}
                    style={styles.calendarIconBtn}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="בחר מלוח שנה"
                  >
                    <Ionicons name="calendar-outline" size={20} color="#36a9e2" />
                  </TouchableOpacity>

                  {/* Date value button — opens spinner */}
                  <TouchableOpacity
                    style={[styles.input, styles.dateValueBtn]}
                    onPress={() => {
                      setDatePickerOpen(!datePickerOpen);
                      setCalendarPickerOpen(false);
                    }}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={customDate ? customDate.toLocaleDateString('he-IL') : 'בחרי תאריך'}
                  >
                    <Text style={{ fontSize: 15, color: customDate ? '#111827' : '#9ca3af' }}>
                      {customDate
                        ? customDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : 'בחרי תאריך'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Spinner picker */}
                {datePickerOpen ? (
                  <View style={styles.pickerWrapper}>
                    <DateTimePicker
                      value={customDate ?? new Date()}
                      mode="date"
                      display="spinner"
                      locale="he"
                      textColor="#111827"
                      onChange={(_, date) => {
                        if (date) { setCustomDate(date); setDateOption('other'); }
                      }}
                    />
                    <TouchableOpacity
                      style={styles.pickerConfirmBtn}
                      onPress={() => setDatePickerOpen(false)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="אישור"
                    >
                      <Text style={styles.pickerConfirmText}>
                        {customDate
                          ? `אישור — ${customDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                          : 'אישור'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Calendar picker */}
                {calendarPickerOpen ? (
                  <View style={styles.pickerWrapper}>
                    <DateTimePicker
                      value={customDate ?? new Date()}
                      mode="date"
                      display="calendar"
                      locale="he"
                      textColor="#111827"
                      onChange={(_, date) => {
                        if (date) { setCustomDate(date); setDateOption('other'); setCalendarPickerOpen(false); }
                      }}
                    />
                    <TouchableOpacity
                      style={styles.pickerConfirmBtn}
                      onPress={() => setCalendarPickerOpen(false)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="אישור"
                    >
                      <Text style={styles.pickerConfirmText}>אישור</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>

          {/* ── שעה (רק אם יש תאריך) */}
          {dateOption !== 'none' ? (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Switch
                  value={timeEnabled}
                  onValueChange={setTimeEnabled}
                  trackColor={{ true: PRIMARY, false: '#e5e7eb' }}
                  thumbColor="#fff"
                  accessible
                  accessibilityLabel="הפעל שעה"
                />
                <FieldLabel text="שעה" />
              </View>
              {timeEnabled ? (
                <>
                  <TouchableOpacity
                    style={[styles.input, styles.timePickerBtn]}
                    onPress={() => setShowTimePicker(!showTimePicker)}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`שעה: ${selectedTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                  >
                    <Text style={styles.timePickerText}>
                      {selectedTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <View style={[styles.pickerWrapper, { width: '100%', minHeight: 200 }]}>
                      <DateTimePicker
                        value={selectedTime}
                        mode="time"
                        display="spinner"
                        is24Hour
                        textColor="#111827"
                        style={{ width: '100%', height: 180 }}
                        onChange={(_, time) => {
                          if (time) setSelectedTime(time);
                        }}
                      />
                      <TouchableOpacity
                        style={styles.pickerConfirmBtn}
                        onPress={() => setShowTimePicker(false)}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel="אישור שעה"
                      >
                        <Text style={styles.pickerConfirmText}>
                          {`אישור — ${selectedTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              ) : null}
            </View>
          ) : null}

          {/* ── התראה מוקדמת */}
          {dateOption !== 'none' ? (
            <View style={styles.card}>
              <FieldLabel text="התראה מוקדמת" />
              <View style={styles.chipRow}>
                {(['none', 'day_before', 'two_hours_before', 'custom'] as NotifyOption[]).map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[styles.chip, notifyOption === val && styles.chipActive]}
                    onPress={() => {
                      setNotifyOption(val);
                      if (val === 'custom') setShowCustomReminderModal(true);
                    }}
                    accessible
                    accessibilityRole="button"
                    accessibilityState={{ selected: notifyOption === val }}
                    accessibilityLabel={getNotifyLabel(val)}
                  >
                    <Text style={[styles.chipText, notifyOption === val && styles.chipTextActive]}>
                      {getNotifyLabel(val)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── צרף תמונה/קובץ (UI only) */}
          <View style={styles.card}>
            <FieldLabel text="צרף תמונה/קובץ" />
            <Pressable
              style={styles.attachBtn}
              onPress={() => Alert.alert('בקרוב', 'צירוף קבצים יהיה זמין בגרסה הבאה.')}
              accessible
              accessibilityRole="button"
              accessibilityLabel="בחר תמונה או קובץ"
            >
              <Ionicons name="attach-outline" size={20} color="#6b7280" />
              <Text style={styles.attachText}>בחרי תמונה או קובץ</Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* ── Bottom save button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, isSaveDisabled && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaveDisabled}
            accessible
            accessibilityRole="button"
            accessibilityLabel="שמור תזכורת"
          >
            <Text style={[styles.saveBtnText, isSaveDisabled && styles.saveBtnTextDisabled]}>
              {saving ? 'שומר...' : 'שמור תזכורת'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Custom reminder modal */}
      <Modal
        visible={showCustomReminderModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCustomReminderModal(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setShowCustomReminderModal(false)}
        />
        <View style={styles.customReminderSheet}>
          <Text style={styles.customReminderTitle}>התראה מותאמת אישית</Text>
          <View style={styles.customReminderRow}>
            <Text style={styles.customReminderBefore}>לפני</Text>
            <View style={styles.customReminderUnits}>
              {(['minutes', 'hours', 'days'] as ReminderUnit[]).map((unit) => {
                const label = unit === 'minutes' ? 'דקות' : unit === 'hours' ? 'שעות' : 'ימים';
                return (
                  <TouchableOpacity
                    key={unit}
                    style={[styles.chip, customReminderUnit === unit && styles.chipActive]}
                    onPress={() => setCustomReminderUnit(unit)}
                    accessible
                    accessibilityRole="button"
                    accessibilityState={{ selected: customReminderUnit === unit }}
                    accessibilityLabel={label}
                  >
                    <Text style={[styles.chipText, customReminderUnit === unit && styles.chipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={[styles.input, styles.customReminderInput]}
              value={customReminderAmount}
              onChangeText={(t) => setCustomReminderAmount(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={3}
              textAlign="center"
              accessible
              accessibilityLabel="כמות"
            />
          </View>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => {
              setCustomReminderConfirmed(true);
              setShowCustomReminderModal(false);
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel="אישור"
          >
            <Text style={styles.saveBtnText}>אישור</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 24 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
    marginBottom: 10,
  },
  required: { color: '#ef4444' },
  errorText: { fontSize: 12, color: '#ef4444', textAlign: 'right', marginTop: 4 },

  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fafafa',
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  inputError: { borderColor: '#ef4444' },

  chipRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },

  timePickerBtn: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  timePickerText: { fontSize: 15, color: '#111827' },

  pickerWrapper: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
  },
  pickerConfirmBtn: {
    backgroundColor: '#36a9e2',
    margin: 12,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pickerConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  calendarIconBtn: {
    width: 36,
    height: 36,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateValueBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingVertical: 10,
  },

  attachBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderStyle: 'dashed',
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  attachText: { fontSize: 14, color: '#6b7280' },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f1f5f9',
  },
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#e5e7eb' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  saveBtnTextDisabled: { color: '#9ca3af' },

  errorStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginTop: 16,
    textAlign: 'center',
  },
  errorStateBtn: {
    marginTop: 16,
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  errorStateBtnText: { color: '#fff', fontWeight: '700' },

  customReminderSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
  },
  customReminderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  customReminderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  customReminderBefore: { fontSize: 15, color: '#374151' },
  customReminderUnits: {
    flexDirection: 'row-reverse',
    gap: 6,
  },
  customReminderInput: {
    width: 70,
    textAlign: 'center',
  },
});
