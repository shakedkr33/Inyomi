import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { TaskDraft } from '@/lib/types/task';
import { AssigneesChips } from './AssigneesChips';
import { ReminderChips } from './ReminderChips';
import { RepeatSection } from './RepeatSection';
import { SubtasksSection } from './SubtasksSection';

const PRIMARY = '#308ce8';

const MOCK_ASSIGNEES = [
  { id: 'me', name: 'אני', initial: 'א', color: PRIMARY },
  { id: '1', name: 'יוסי', initial: 'י', color: '#3b82f6' },
  { id: '2', name: 'מיכל', initial: 'מ', color: '#ec4899' },
];

const MOCK_EVENTS = [
  { id: 'none', label: 'ללא אירוע' },
  { id: '1', label: 'ארוחת ערב משפחתית' },
  { id: '2', label: 'טיול יום הולדת' },
];

const EMPTY_DRAFT: TaskDraft = {
  title: '',
  dateOption: 'today',
  selectedTime: '09:00',
  reminder: 'none',
  assignees: ['me'],
  subtasks: [],
  allowSubtaskEditing: true,
  notes: '',
  isRoutine: false,
};

interface TaskEditorProps {
  mode: 'create' | 'edit';
  taskId?: string;
}

export default function TaskEditorScreen({
  mode,
  taskId: _taskId,
}: TaskEditorProps): React.JSX.Element {
  const isCreate = mode === 'create';

  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [titleError, setTitleError] = useState(false);
  const [linkedEvent, setLinkedEvent] = useState('none');
  const [eventPickerOpen, setEventPickerOpen] = useState(false);

  // ── Convex: spaceId ─────────────────────────────────────────────────────
  // getMySpace מחזיר את ה-spaceId ישירות (Id<'spaces'> | null | undefined)
  // undefined = עדיין טוען | null = אין מרחב פעיל | string = ה-ID
  const mySpace = useQuery(api.users.getMySpace);
  const spaceId = mySpace ?? undefined; // ממיר null ל-undefined עבור mutatio

  // ── Convex: edit mode – load existing task ───────────────────────────────
  const existingTask = useQuery(
    api.tasks.getById,
    !isCreate && _taskId ? { id: _taskId as Id<'tasks'> } : 'skip'
  );

  useEffect(() => {
    if (existingTask) {
      // ממלא את הטופס בנתוני המשימה הקיימת
      const hasDueDate = existingTask.dueDate != null;
      const dueDate = existingTask.dueDate
        ? new Date(existingTask.dueDate)
        : null;
      setDraft((prev) => ({
        ...prev,
        title: existingTask.title,
        notes: existingTask.description ?? '',
        dateOption: hasDueDate ? 'today' : 'none', // TODO: להבחין בין היום לתאריך אחר
        selectedTime: dueDate
          ? dueDate.toLocaleTimeString('he-IL', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '09:00',
      }));
    }
  }, [existingTask]);

  // ── Convex: mutations ────────────────────────────────────────────────────
  const createTaskMutation = useMutation(api.tasks.create);
  const updateTaskMutation = useMutation(api.tasks.update);

  const update = (updates: Partial<TaskDraft>): void => {
    setDraft((prev) => {
      const next = { ...prev, ...updates };
      next.isRoutine = next.repeat != null || next.subtasks.length > 0;
      return next;
    });
  };

  // ממיר dateOption + selectedTime ל-Unix timestamp (ms)
  const resolveDueDate = (): number | undefined => {
    if (draft.dateOption === 'none') return undefined;
    const base = new Date(); // TODO: לתמוך ב-dateOption === 'other' עם date picker
    const timeParts = (draft.selectedTime ?? '09:00').split(':');
    const hours = Number(timeParts[0] ?? '9');
    const minutes = Number(timeParts[1] ?? '0');
    base.setHours(hours, minutes, 0, 0);
    return base.getTime();
  };

  const handleSave = async (): Promise<void> => {
    if (!draft.title.trim()) {
      setTitleError(true);
      return;
    }

    if (isCreate) {
      if (!spaceId) {
        Alert.alert('שגיאה', 'לא ניתן לאתר את המרחב שלך. נסה שוב מאוחר יותר.');
        return;
      }
      try {
        await createTaskMutation({
          title: draft.title.trim(),
          description: draft.notes || undefined,
          dueDate: resolveDueDate(),
          spaceId,
          // TODO: להוסיף assignedTo מ-AssigneesChips כשיחובר ל-Convex
        });
        router.back();
      } catch (e) {
        console.error('createTask error:', e);
        Alert.alert('שגיאה', 'לא ניתן היה לשמור את המשימה.');
      }
    } else {
      if (!_taskId) return;
      try {
        await updateTaskMutation({
          id: _taskId as Id<'tasks'>,
          title: draft.title.trim(),
          description: draft.notes || undefined,
          dueDate: resolveDueDate(),
        });
        router.back();
      } catch (e) {
        console.error('updateTask error:', e);
        Alert.alert('שגיאה', 'לא ניתן היה לעדכן את המשימה.');
      }
    }
  };

  const handleBack = (): void => {
    if (isCreate && draft.title.trim()) {
      Alert.alert('לצאת בלי לשמור?', 'השינויים לא יישמרו', [
        { text: 'ביטול', style: 'cancel' },
        { text: 'צא', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  };

  const showDateFields = draft.dateOption !== 'none';

  // ── spaceId loading / error states ────────────────────────────────────────
  // mySpace === undefined  → still loading
  // mySpace === null       → loaded but no space found
  if (isCreate && mySpace === undefined) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Pressable
            onPress={handleBack}
            style={s.closeBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="סגור"
          >
            <MaterialIcons name="close" size={22} color="#9ca3af" />
          </Pressable>
          <Text style={s.headerTitle}>יצירת משימה חדשה</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.spaceLoadingContainer}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={s.spaceLoadingText}>טוען פרטי מרחב...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isCreate && mySpace === null) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Pressable
            onPress={handleBack}
            style={s.closeBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="סגור"
          >
            <MaterialIcons name="close" size={22} color="#9ca3af" />
          </Pressable>
          <Text style={s.headerTitle}>יצירת משימה חדשה</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.spaceLoadingContainer}>
          <MaterialIcons name="error-outline" size={48} color="#d1d5db" />
          <Text style={s.spaceErrorText}>לא נמצא מרחב פעיל</Text>
          <Text style={s.spaceErrorSubtext}>
            נדרש מרחב (space) כדי ליצור משימות. אנא השלם את תהליך ה-Onboarding.
          </Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => router.back()}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={s.retryBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={handleBack}
          style={s.closeBtn}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="סגור"
        >
          <MaterialIcons name="close" size={22} color="#9ca3af" />
        </Pressable>
        <Text style={s.headerTitle}>
          {isCreate ? 'יצירת משימה חדשה' : 'עריכת משימה'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Task Title */}
        <View style={s.section}>
          <Text style={s.label}>שם המשימה (חובה)</Text>
          <TextInput
            style={[s.titleInput, titleError && s.inputError]}
            value={draft.title}
            onChangeText={(t) => {
              setTitleError(false);
              update({ title: t });
            }}
            placeholder="מה צריך לעשות?"
            placeholderTextColor="#9ca3af"
            textAlign="right"
            autoFocus={isCreate}
            accessible={true}
            accessibilityLabel="שם המשימה"
          />
          {titleError && <Text style={s.errorText}>נא להזין שם משימה</Text>}
        </View>

        {/* 2. When */}
        <View style={s.section}>
          <Text style={s.label}>מתי לבצע?</Text>
          <View style={s.dateRow}>
            {(
              [
                { key: 'today', label: 'היום', icon: 'today' },
                { key: 'other', label: 'יום אחר', icon: 'calendar-month' },
                { key: 'none', label: 'ללא תאריך', icon: 'event-busy' },
              ] as const
            ).map((opt) => (
              <Pressable
                key={opt.key}
                style={[
                  s.dateBtn,
                  draft.dateOption === opt.key && s.dateBtnActive,
                ]}
                onPress={() => update({ dateOption: opt.key })}
                accessible={true}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.dateOption === opt.key }}
                accessibilityLabel={opt.label}
              >
                <MaterialIcons
                  name={opt.icon}
                  size={22}
                  color={draft.dateOption === opt.key ? PRIMARY : '#6b7280'}
                />
                <Text
                  style={[
                    s.dateBtnText,
                    draft.dateOption === opt.key && s.dateBtnTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {showDateFields && (
            <View style={s.timeRow}>
              <Text style={s.timeLabel}>שעה:</Text>
              <TextInput
                style={s.timeInput}
                value={draft.selectedTime}
                onChangeText={(t) => update({ selectedTime: t })}
                placeholder="09:00"
                placeholderTextColor="#9ca3af"
                keyboardType="numbers-and-punctuation"
                accessible={true}
                accessibilityLabel="שעת ביצוע"
              />
            </View>
          )}
        </View>

        {/* 3. Reminders */}
        {showDateFields && (
          <View style={s.section}>
            <Text style={s.label}>תזכורת</Text>
            <ReminderChips
              value={draft.reminder}
              onChange={(r) => update({ reminder: r })}
            />
          </View>
        )}

        {/* 4. Repeat */}
        {showDateFields && (
          <View style={s.section}>
            <RepeatSection
              value={draft.repeat}
              onChange={(r) => update({ repeat: r })}
            />
          </View>
        )}

        {/* 5. Linked Event */}
        <View style={s.section}>
          <Text style={s.label}>שיוך לאירוע</Text>
          <Pressable
            style={s.selectContainer}
            onPress={() => setEventPickerOpen(!eventPickerOpen)}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`שיוך לאירוע: ${MOCK_EVENTS.find((e) => e.id === linkedEvent)?.label ?? 'ללא אירוע'}`}
          >
            <MaterialIcons name="expand-more" size={22} color="#9ca3af" />
            <Text style={s.selectText}>
              {MOCK_EVENTS.find((e) => e.id === linkedEvent)?.label ??
                'ללא אירוע'}
            </Text>
          </Pressable>
          {eventPickerOpen && (
            <View style={s.pickerDropdown}>
              {MOCK_EVENTS.map((ev) => (
                <Pressable
                  key={ev.id}
                  style={[
                    s.pickerOption,
                    linkedEvent === ev.id && s.pickerOptionActive,
                  ]}
                  onPress={() => {
                    setLinkedEvent(ev.id);
                    setEventPickerOpen(false);
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={ev.label}
                >
                  <Text
                    style={[
                      s.pickerOptionText,
                      linkedEvent === ev.id && s.pickerOptionTextActive,
                    ]}
                  >
                    {ev.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* 6. Assignees */}
        <View style={s.section}>
          <Text style={s.label}>אחראי</Text>
          <AssigneesChips
            assignees={MOCK_ASSIGNEES}
            selected={draft.assignees}
            onChange={(ids) => update({ assignees: ids })}
          />
        </View>

        {/* 7. Subtasks */}
        <View style={s.section}>
          <SubtasksSection
            subtasks={draft.subtasks}
            allowEditing={draft.allowSubtaskEditing}
            onSubtasksChange={(st) => update({ subtasks: st })}
            onAllowEditingChange={(v) => update({ allowSubtaskEditing: v })}
          />
        </View>

        {/* 8. Notes */}
        <View style={s.section}>
          <Text style={s.label}>הערות</Text>
          <TextInput
            style={s.notesInput}
            value={draft.notes}
            onChangeText={(t) => update({ notes: t })}
            placeholder="הוספת פרטים נוספים או הערות..."
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={4}
            textAlign="right"
            maxLength={300}
            accessible={true}
            accessibilityLabel="הערות"
          />
        </View>

        {/* 9. AI Tags Banner */}
        <View style={s.aiBanner}>
          <View style={s.aiIconBox}>
            <MaterialIcons name="auto-awesome" size={22} color={PRIMARY} />
          </View>
          <View style={s.aiContent}>
            <View style={s.aiTags}>
              {draft.title.length > 0 && (
                <>
                  <View style={[s.aiTag, { backgroundColor: '#fee2e2' }]}>
                    <Text style={[s.aiTagText, { color: '#dc2626' }]}>
                      דחוף
                    </Text>
                  </View>
                  <View style={[s.aiTag, { backgroundColor: '#dbeafe' }]}>
                    <Text style={[s.aiTagText, { color: '#2563eb' }]}>
                      היום
                    </Text>
                  </View>
                  <View style={[s.aiTag, { backgroundColor: '#ede9fe' }]}>
                    <Text style={[s.aiTagText, { color: '#7c3aed' }]}>
                      אישי
                    </Text>
                  </View>
                </>
              )}
            </View>
            <Text style={s.aiText}>
              המערכת מייצרת תיוגים חכמים באופן אוטומטי לזיהוי מהיר.
            </Text>
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky Footer */}
      <View style={s.footer}>
        <Pressable
          style={[s.saveBtn, isCreate && !spaceId && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={isCreate && !spaceId}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={isCreate ? 'צור משימה' : 'שמור משימה'}
        >
          <Text style={s.saveBtnText}>
            {isCreate ? 'צור משימה' : 'שמור משימה'}
          </Text>
          <MaterialIcons name="check-circle" size={22} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111418',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  section: { marginBottom: 28 },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111418',
    textAlign: 'right',
    marginBottom: 10,
  },
  titleInput: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    height: 54,
    paddingHorizontal: 20,
    fontSize: 15,
    color: '#111418',
  },
  inputError: { borderWidth: 2, borderColor: '#ef4444' },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'right',
    marginTop: 4,
  },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateBtn: {
    flex: 1,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#fff',
  },
  dateBtnActive: {
    borderWidth: 2,
    borderColor: PRIMARY,
    backgroundColor: `${PRIMARY}0d`,
  },
  dateBtnText: { fontSize: 11, fontWeight: '500', color: '#6b7280' },
  dateBtnTextActive: { color: PRIMARY, fontWeight: '700' },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  timeLabel: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  timeInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
  },
  selectContainer: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    height: 54,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: { fontSize: 15, color: '#374151' },
  pickerDropdown: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginTop: 8,
    overflow: 'hidden',
  },
  pickerOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pickerOptionActive: {
    backgroundColor: `${PRIMARY}0d`,
  },
  pickerOptionText: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
  },
  pickerOptionTextActive: {
    color: PRIMARY,
    fontWeight: '700',
  },
  notesInput: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    minHeight: 110,
    padding: 16,
    fontSize: 14,
    color: '#111418',
    textAlignVertical: 'top',
  },
  aiBanner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
    alignItems: 'center',
  },
  aiIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${PRIMARY}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiContent: { flex: 1 },
  aiTags: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  aiTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  aiTagText: { fontSize: 10, fontWeight: '900' },
  aiText: { fontSize: 11, color: '#64748b', lineHeight: 16 },
  footer: {
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: PRIMARY,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  saveBtnDisabled: { opacity: 0.45 },
  spaceLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  spaceLoadingText: { fontSize: 15, color: '#6b7280', textAlign: 'center' },
  spaceErrorText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center',
  },
  spaceErrorSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: PRIMARY,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
