import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EventScreen from '@/lib/components/event/EventScreen';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

type LocationType = 'address' | 'link';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTimestamp(date: Date, timeDate: Date): number {
  const result = new Date(date);
  result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
  return result.getTime();
}

// ─── Community Event Form ─────────────────────────────────────────────────────

function CommunityEventForm({ communityId }: { communityId: string }) {
  const router = useRouter();

  // ── Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('address');
  const [location, setLocation] = useState('');
  const [rsvpRequired, setRsvpRequired] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Date/time pickers
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [startTimeDate, setStartTimeDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [endTimeDate, setEndTimeDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    return d;
  });
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const createEvent = useMutation(api.events.create);
  const spaceId = useQuery(api.users.getMySpace);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    // Only block if there's no communityId context either
    if (!spaceId && !communityId) {
      Alert.alert('שגיאה', 'לא נמצא מרחב פעיל. נסה להתנתק ולהתחבר מחדש.');
      return;
    }

    setSaving(true);
    try {
      const startTs = allDay
        ? new Date(selectedDate).setHours(0, 0, 0, 0)
        : buildTimestamp(selectedDate, startTimeDate);
      const endTs = allDay
        ? new Date(selectedDate).setHours(23, 59, 59, 999)
        : buildTimestamp(selectedDate, endTimeDate);

      const eventArgs = {
        title: title.trim(),
        description: description.trim() || undefined,
        startTime: startTs,
        endTime: endTs,
        allDay,
        location: locationType === 'address' ? location.trim() || undefined : undefined,
        onlineUrl: locationType === 'link' ? location.trim() || undefined : undefined,
        spaceId: spaceId ?? undefined,
        communityId: communityId as Id<'communities'>,
        requiresRsvp: rsvpRequired,
      };
      console.log('Creating event with args:', eventArgs);
      await createEvent(eventArgs);
      router.replace(`/(authenticated)/community/${communityId}` as Parameters<typeof router.replace>[0]);
    } catch (e) {
      console.error('createCommunityEvent error:', e);
      Alert.alert('שגיאה', 'לא ניתן לשמור את האירוע. נסה שוב.');
    } finally {
      setSaving(false);
    }
  }, [title, description, selectedDate, startTimeDate, endTimeDate, allDay, location, locationType, rsvpRequired, communityId, spaceId, createEvent, router]);

  // selectedDate is always set (initialized to today), so no null check needed
  const isSaveDisabled = !title.trim() || saving || spaceId === undefined;

  const dateLabel = selectedDate.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.replace(`/(authenticated)/community/${communityId}` as Parameters<typeof router.replace>[0])}
          style={s.closeBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="סגור"
        >
          <Ionicons name="close" size={22} color="#374151" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>אירוע חדש</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* שם האירוע */}
          <View style={s.card}>
            <Text style={s.fieldLabel}>
              שם האירוע <Text style={s.required}>*</Text>
            </Text>
            <TextInput
              style={[s.input, titleError && s.inputError]}
              value={title}
              onChangeText={(t) => { setTitle(t); if (t.trim()) setTitleError(false); }}
              placeholder="הכניסי שם לאירוע..."
              placeholderTextColor="#9ca3af"
              textAlign="right"
              maxLength={120}
              accessible
              accessibilityLabel="שם האירוע"
            />
            {titleError ? <Text style={s.errorText}>שדה זה נדרש</Text> : null}
          </View>

          {/* תאריך ושעה */}
          <View style={s.card}>
            {/* כל היום toggle */}
            <View style={s.rowBetween}>
              <Switch
                value={allDay}
                onValueChange={setAllDay}
                trackColor={{ true: PRIMARY, false: '#e5e7eb' }}
                thumbColor="#fff"
                accessible
                accessibilityLabel="אירוע כל היום"
              />
              <Text style={s.fieldLabel}>כל היום</Text>
            </View>

            {/* תאריך */}
            <Text style={[s.fieldLabel, { marginTop: 12 }]}>תאריך</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              {/* Calendar icon — opens inline monthly grid */}
              <TouchableOpacity
                onPress={() => { setCalendarPickerOpen(!calendarPickerOpen); setDatePickerOpen(false); }}
                style={s.calendarIconBtn}
                accessible
                accessibilityRole="button"
                accessibilityLabel="בחר מלוח שנה"
              >
                <Ionicons name="calendar-outline" size={20} color="#36a9e2" />
              </TouchableOpacity>

              {/* Date value button — opens spinner */}
              <TouchableOpacity
                style={[s.input, s.dateValueBtn]}
                onPress={() => { setDatePickerOpen(!datePickerOpen); setCalendarPickerOpen(false); }}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`תאריך: ${dateLabel}`}
              >
                <Text style={{ fontSize: 15, color: '#111827' }}>
                  {selectedDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Date spinner picker */}
            {datePickerOpen ? (
              <View style={[s.pickerWrapper, { width: '100%' }]}>
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="spinner"
                  themeVariant="light"
                  locale="he-IL"
                  textColor="#111827"
                  style={{ width: '100%', height: 180 }}
                  onChange={(_, date) => {
                    if (date) setSelectedDate(date);
                  }}
                />
                <TouchableOpacity
                  style={s.pickerConfirmBtn}
                  onPress={() => setDatePickerOpen(false)}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="אישור"
                >
                  <Text style={s.pickerConfirmText}>
                    {`אישור — ${selectedDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Inline monthly calendar picker */}
            {calendarPickerOpen ? (
              <View style={{ backgroundColor: '#f3f4f6', borderRadius: 12, marginTop: 8, overflow: 'hidden' }}>
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="inline"
                  themeVariant="light"
                  locale="he-IL"
                  accentColor="#36a9e2"
                  textColor="#111827"
                  onChange={(_, date) => {
                    if (date) {
                      setSelectedDate(date);
                      setTimeout(() => setCalendarPickerOpen(false), 150);
                    }
                  }}
                />
              </View>
            ) : null}

            {/* שעות (רק אם לא כל היום) */}
            {!allDay ? (
              <>
                {/* Time buttons row */}
                <View style={s.timeRow}>
                  {/* סיום */}
                  <View style={{ flex: 1 }}>
                    <Text style={s.timeLabel}>סיום</Text>
                    <TouchableOpacity
                      style={[s.input, s.pickerBtn]}
                      onPress={() => { setShowEndPicker(!showEndPicker); setShowStartPicker(false); }}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`שעת סיום: ${endTimeDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                    >
                      <Text style={{ fontSize: 15, color: '#111827' }}>
                        {endTimeDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {/* התחלה */}
                  <View style={{ flex: 1 }}>
                    <Text style={s.timeLabel}>התחלה</Text>
                    <TouchableOpacity
                      style={[s.input, s.pickerBtn]}
                      onPress={() => { setShowStartPicker(!showStartPicker); setShowEndPicker(false); }}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`שעת התחלה: ${startTimeDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                    >
                      <Text style={{ fontSize: 15, color: '#111827' }}>
                        {startTimeDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Start time picker — full width below the row */}
                {showStartPicker ? (
                  <View style={[s.pickerWrapper, { width: '100%', minHeight: 200 }]}>
                    <DateTimePicker
                      value={startTimeDate}
                      mode="time"
                      display="spinner"
                      is24Hour
                      locale="he-IL"
                      themeVariant="light"
                      textColor="#111827"
                      style={{ width: '100%', height: 180 }}
                      onChange={(_, time) => {
                        if (time) setStartTimeDate(time);
                      }}
                    />
                    <TouchableOpacity
                      style={s.pickerConfirmBtn}
                      onPress={() => setShowStartPicker(false)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="אישור שעת התחלה"
                    >
                      <Text style={s.pickerConfirmText}>
                        {`אישור — ${startTimeDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* End time picker — full width below the row */}
                {showEndPicker ? (
                  <View style={[s.pickerWrapper, { width: '100%', minHeight: 200 }]}>
                    <DateTimePicker
                      value={endTimeDate}
                      mode="time"
                      display="spinner"
                      is24Hour
                      locale="he-IL"
                      themeVariant="light"
                      textColor="#111827"
                      style={{ width: '100%', height: 180 }}
                      onChange={(_, time) => {
                        if (time) setEndTimeDate(time);
                      }}
                    />
                    <TouchableOpacity
                      style={s.pickerConfirmBtn}
                      onPress={() => setShowEndPicker(false)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="אישור שעת סיום"
                    >
                      <Text style={s.pickerConfirmText}>
                        {`אישור — ${endTimeDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>

          {/* מיקום */}
          <View style={s.card}>
            <Text style={s.fieldLabel}>מיקום</Text>
            <View style={s.chipRow}>
              {([['address', 'כתובת'], ['link', 'קישור']] as [LocationType, string][]).map(([val, label]) => (
                <TouchableOpacity
                  key={val}
                  style={[s.chip, locationType === val && s.chipActive]}
                  onPress={() => setLocationType(val)}
                  accessible
                  accessibilityRole="button"
                  accessibilityState={{ selected: locationType === val }}
                  accessibilityLabel={label}
                >
                  <Text style={[s.chipText, locationType === val && s.chipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[s.input, { marginTop: 10 }]}
              value={location}
              onChangeText={setLocation}
              placeholder={locationType === 'address' ? 'רחוב, עיר...' : 'https://...'}
              placeholderTextColor="#9ca3af"
              textAlign="right"
              autoCapitalize="none"
              keyboardType={locationType === 'link' ? 'url' : 'default'}
              accessible
              accessibilityLabel={locationType === 'address' ? 'כתובת' : 'קישור'}
            />
          </View>

          {/* תיאור */}
          <View style={s.card}>
            <Text style={s.fieldLabel}>תיאור</Text>
            <TextInput
              style={[s.input, s.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="פרטים נוספים על האירוע..."
              placeholderTextColor="#9ca3af"
              textAlign="right"
              multiline
              numberOfLines={4}
              maxLength={500}
              accessible
              accessibilityLabel="תיאור"
            />
          </View>

          {/* RSVP */}
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Switch
                value={rsvpRequired}
                onValueChange={setRsvpRequired}
                trackColor={{ true: PRIMARY, false: '#e5e7eb' }}
                thumbColor="#fff"
                accessible
                accessibilityLabel="נדרש אישור הגעה"
              />
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.fieldLabel}>נדרש אישור הגעה</Text>
                <Text style={s.fieldSub}>חברי הקהילה יצטרכו לאשר השתתפות</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Save button */}
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.saveBtn, isSaveDisabled && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaveDisabled}
            accessible
            accessibilityRole="button"
            accessibilityLabel="שמור אירוע"
          >
            <Text style={[s.saveBtnText, isSaveDisabled && s.saveBtnTextDisabled]}>
              {saving ? 'שומר...' : 'שמור אירוע'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Route Entry ──────────────────────────────────────────────────────────────

export default function NewEventScreen(): React.JSX.Element {
  const { communityId } = useLocalSearchParams<{ communityId?: string }>();

  if (communityId) {
    return <CommunityEventForm communityId={communityId} />;
  }

  return <EventScreen mode="create" />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
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
    marginBottom: 8,
  },
  fieldSub: { fontSize: 12, color: '#9ca3af', textAlign: 'right' },
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
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  inputError: { borderColor: '#ef4444' },

  pickerBtn: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },

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

  timeRow: { flexDirection: 'row-reverse', gap: 12, marginTop: 10 },
  timeLabel: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 6,
  },

  chipRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 4 },
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
  },

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
});
