import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateTimeCard } from '@/lib/components/event/DateTimeCard';
import { LocationCard } from '@/lib/components/event/LocationCard';
import { NotesCard } from '@/lib/components/event/NotesCard';
import { ParticipantsCard } from '@/lib/components/event/ParticipantsCard';
import { RelatedTasksSection } from '@/lib/components/event/RelatedTasksSection';
import { RemindersCard } from '@/lib/components/event/RemindersCard';
import type {
  EventData,
  RecurrenceType,
  ReminderType,
} from '@/lib/types/event';

const PRIMARY = '#36a9e2';

const EMPTY_EVENT: EventData = {
  title: '',
  date: Date.now(),
  startTime: undefined,
  endTime: undefined,
  isAllDay: false,
  recurrence: 'none',
  location: undefined,
  notes: undefined,
  remindersEnabled: true,
  reminderTypes: ['hour_before'],
  participants: [],
  tasks: [],
  showAllTasksToAll: false,
  createdAt: Date.now(),
};

const MOCK_EVENT: EventData = {
  id: '1',
  title: 'ארוחת ערב משפחתית',
  date: new Date(2023, 9, 12).getTime(),
  startTime: '19:30',
  endTime: '22:00',
  isAllDay: false,
  recurrence: 'none',
  location: 'רחוב הירקון 45',
  locationCoords: { lat: 32.08, lng: 34.78 },
  notes: '',
  remindersEnabled: true,
  reminderTypes: ['morning_same_day', 'hour_before'],
  participants: [
    { id: '1', name: 'שרה', color: '#ff6b6b', avatarUrl: undefined },
    { id: '2', name: 'דן', color: '#4ecdc4', avatarUrl: undefined },
  ],
  tasks: [
    { id: '1', title: 'לקנות יין אדום', completed: true, colorDot: '#ef4444' },
    { id: '2', title: 'להכין קינוח', completed: false, assigneeId: '1' },
  ],
  showAllTasksToAll: true,
  createdAt: Date.now(),
};

interface EventScreenProps {
  mode: 'create' | 'details';
  eventId?: string;
}

export default function EventScreen({
  mode,
  eventId: _eventId,
}: EventScreenProps): React.JSX.Element {
  const isCreate = mode === 'create';
  // TODO: replace MOCK_EVENT with Convex query using _eventId
  const [event, setEvent] = useState<EventData>(
    isCreate ? EMPTY_EVENT : MOCK_EVENT
  );
  const [titleError, setTitleError] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();

  const autosave = useCallback(
    (_data: EventData) => {
      if (isCreate) return;
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        // TODO: call Convex mutation with _data
      }, 600);
    },
    [isCreate]
  );

  const updateEvent = useCallback(
    (updates: Partial<EventData>) => {
      setEvent((prev) => {
        const updated = { ...prev, ...updates };
        autosave(updated);
        return updated;
      });
    },
    [autosave]
  );

  const handleSave = (): void => {
    if (!event.title.trim()) {
      setTitleError(true);
      return;
    }
    // TODO: call Convex mutation
    router.back();
  };

  const handleBack = (): void => {
    if (isCreate && event.title.trim()) {
      Alert.alert('לצאת בלי לשמור?', 'השינויים לא יישמרו', [
        { text: 'ביטול', style: 'cancel' },
        { text: 'צא', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  };

  const completedTasks = event.tasks.filter((t) => t.completed).length;
  const hasMultipleAssignees =
    new Set(event.tasks.map((t) => t.assigneeId).filter(Boolean)).size > 1;

  return (
    <SafeAreaView style={s.safeArea}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          style={s.backButton}
          onPress={handleBack}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
        >
          <MaterialIcons name="arrow-forward" size={22} color="#111517" />
        </Pressable>
        <Text style={s.headerTitle}>
          {isCreate ? 'יצירת אירוע' : 'פרטי אירוע'}
        </Text>
        {isCreate ? (
          <Pressable
            style={s.saveButton}
            onPress={handleSave}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="שמור אירוע"
          >
            <Text style={s.saveButtonText}>שמור</Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Event Title — compact field */}
        <View style={s.titleSection}>
          <TextInput
            style={[s.titleInput, titleError && s.titleInputError]}
            value={event.title}
            onChangeText={(text) => {
              setTitleError(false);
              updateEvent({ title: text });
            }}
            placeholder="שם האירוע"
            placeholderTextColor="#94a3b8"
            textAlign="right"
            autoFocus={isCreate}
            accessible={true}
            accessibilityLabel="שם האירוע"
          />
          {titleError && (
            <Text style={s.errorText}>שם האירוע הוא שדה חובה</Text>
          )}
        </View>

        {/* Date & Time */}
        <DateTimeCard
          date={event.date}
          startTime={event.startTime}
          endTime={event.endTime}
          isAllDay={event.isAllDay}
          onChange={(updates) => updateEvent(updates)}
        />

        {/* Recurrence */}
        <RecurrenceRow
          value={event.recurrence}
          onChange={(val) => updateEvent({ recurrence: val })}
        />

        {/* Participants */}
        <ParticipantsCard
          participants={event.participants}
          onChange={(p) => updateEvent({ participants: p })}
        />

        {/* Location */}
        <LocationCard
          location={event.location}
          onChange={(loc) => updateEvent({ location: loc })}
        />

        {/* Reminders */}
        <RemindersCard
          enabled={event.remindersEnabled}
          types={event.reminderTypes}
          onChange={(enabled: boolean, types: ReminderType[]) =>
            updateEvent({ remindersEnabled: enabled, reminderTypes: types })
          }
        />

        {/* Related Tasks */}
        <RelatedTasksSection
          tasks={event.tasks}
          participants={event.participants}
          completedCount={completedTasks}
          showAllTasksToAll={event.showAllTasksToAll}
          showToggle={hasMultipleAssignees}
          onChange={(tasks) => updateEvent({ tasks })}
          onToggleVisibility={(val) => updateEvent({ showAllTasksToAll: val })}
        />

        {/* Notes */}
        <NotesCard
          notes={event.notes}
          onChange={(notes) => updateEvent({ notes })}
        />

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Share FAB */}
      {!isCreate && (
        <Pressable
          style={s.shareFab}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="שתף אירוע"
        >
          <MaterialIcons name="share" size={22} color="#64748b" />
        </Pressable>
      )}
    </SafeAreaView>
  );
}

/* ─── Recurrence Row (inline) ─── */

function RecurrenceRow({
  value,
  onChange,
}: {
  value: RecurrenceType;
  onChange: (v: RecurrenceType) => void;
}): React.JSX.Element {
  const labels: Record<RecurrenceType, string> = {
    none: 'לא',
    daily: 'כל יום',
    weekly: 'כל שבוע',
    monthly: 'כל חודש',
    yearly: 'כל שנה',
  };
  const options: RecurrenceType[] = [
    'none',
    'daily',
    'weekly',
    'monthly',
    'yearly',
  ];

  const [open, setOpen] = useState(false);

  return (
    <View style={s.card}>
      <Pressable
        style={s.recurrenceRow}
        onPress={() => setOpen(!open)}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`אירוע חוזר: ${labels[value]}`}
      >
        <MaterialIcons name="expand-more" size={24} color="#94a3b8" />
        <Text style={s.recurrenceText}>אירוע חוזר: {labels[value]}</Text>
      </Pressable>
      {open && (
        <View style={s.recurrenceOptions}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              style={[
                s.recurrenceOption,
                value === opt && s.recurrenceOptionActive,
              ]}
              onPress={() => {
                onChange(opt);
                setOpen(false);
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={labels[opt]}
            >
              <Text
                style={[
                  s.recurrenceOptionText,
                  value === opt && s.recurrenceOptionTextActive,
                ]}
              >
                {labels[opt]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/* ─── Styles ─── */

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f8f8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f6f8f8',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111517',
  },
  saveButton: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 4 },
  titleSection: { marginBottom: 10 },
  titleInput: {
    fontSize: 17,
    fontWeight: '500',
    color: '#0f172a',
    textAlign: 'right',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  titleInputError: {
    borderWidth: 1.5,
    borderColor: '#ef4444',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'right',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  recurrenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recurrenceText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#334155',
    textAlign: 'right',
  },
  recurrenceOptions: {
    marginTop: 10,
    gap: 2,
  },
  recurrenceOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  recurrenceOptionActive: {
    backgroundColor: '#e8f5fd',
  },
  recurrenceOptionText: {
    fontSize: 15,
    color: '#475569',
    textAlign: 'right',
  },
  recurrenceOptionTextActive: {
    color: PRIMARY,
    fontWeight: '700',
  },
  shareFab: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
});
