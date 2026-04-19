// FIXED: added EventAttachmentsSection between LocationCard and RecurrenceRow
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// Alert is still used for save errors
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DateTimeCard,
  applyDuration,
  fmt2,
  roundToNextHour,
} from '@/lib/components/event/DateTimeCard';
// applyDuration is used in makeEmptyEvent to set a sensible default end time
import {
  LocationCard,
  type LocationUpdate,
} from '@/lib/components/event/LocationCard';
import { NotesCard } from '@/lib/components/event/NotesCard';
import { ParticipantsCard, type FamilyMemberChip } from '@/lib/components/event/ParticipantsCard';
import { EventAttachmentsSection } from '@/lib/components/event/EventAttachmentsSection';
import { RelatedTasksSection } from '@/lib/components/event/RelatedTasksSection';
import { RemindersCard } from '@/lib/components/event/RemindersCard';
import type { EventAttachmentDraft, EventData, RecurrenceType } from '@/lib/types/event';
import { makeReminder } from '@/lib/types/event';

const PRIMARY = '#36a9e2';

/**
 * Build smart default start/end for a new event.
 * @param selectedDateMs  optional pre-selected calendar date (midnight Unix ms)
 */
function makeEmptyEvent(selectedDateMs?: number): EventData {
  const now = new Date();
  const startD = roundToNextHour(now); // e.g. 22:08 → 23:00

  // Base date: use selectedDate if provided, otherwise today midnight
  const baseMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startDate = selectedDateMs ?? baseMidnight;

  const startTime = `${fmt2(startD.getHours())}:00`;

  // Default duration: 1 hour. applyDuration handles cross-midnight automatically.
  const { endDate, endTime } = applyDuration(startDate, startTime, 60);

  return {
    title: '',
    date: startDate,
    startTime,
    endDate,
    endTime,
    isAllDay: false,
    recurrence: 'none',
    location: undefined,
    onlineUrl: undefined,
    notes: undefined,
    remindersEnabled: true,
    reminders: [makeReminder('hour_before')],
    participants: [],
    tasks: [],
    showAllTasksToAll: false,
    createdAt: Date.now(),
  };
}

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
  reminders: [makeReminder('at_event'), makeReminder('hour_before')],
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

/** Returns true when start < end (valid range), or when validation can be skipped. */
function isValidDateRange(event: EventData): boolean {
  if (event.isAllDay || !event.startTime || !event.endTime) return true;
  const [sh, sm] = event.startTime.split(':').map(Number);
  const [eh, em] = event.endTime.split(':').map(Number);
  const startMs = new Date(event.date).setHours(sh ?? 0, sm ?? 0, 0, 0);
  const endMs = new Date(event.endDate ?? event.date).setHours(eh ?? 0, em ?? 0, 0, 0);
  return startMs < endMs;
}

interface EventScreenProps {
  mode: 'create' | 'details';
  eventId?: string;
  /** Pre-selected date (midnight Unix ms) when opened from a calendar day tap. */
  selectedDate?: number;
  /** Called when the user confirms save. Should call the Convex mutation. */
  onSave?: (data: EventData) => Promise<void>;
}

export default function EventScreen({
  mode,
  eventId: _eventId,
  selectedDate,
  onSave,
}: EventScreenProps): React.JSX.Element {
  const isCreate = mode === 'create';
  // TODO: replace MOCK_EVENT with Convex query using _eventId
  const [event, setEvent] = useState<EventData>(() =>
    isCreate ? makeEmptyEvent(selectedDate) : MOCK_EVENT
  );

  // FIXED: load family members for the family sharing section in ParticipantsCard.
  // selfEntityId is the signed-in user's own entity row — excluded from the chips
  // so the creator is never shown (they are always implicitly included).
  const serverFamilyContacts = useQuery(api.members.listMyFamilyContacts);
  useEffect(() => {
    console.log('[DEBUG chips] serverFamilyContacts:', JSON.stringify(serverFamilyContacts));
  }, [serverFamilyContacts]);
  const familyMembers: FamilyMemberChip[] = (serverFamilyContacts?.members ?? [])
    .filter((m) => m._id !== serverFamilyContacts?.selfEntityId)
    .map((m) => ({ _id: m._id, displayName: m.displayName, color: m.color }));
  const [titleError, setTitleError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const autosave = useCallback(
    (_data: EventData) => {
      if (isCreate) return;
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        // TODO: call Convex update mutation with _data
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

  const handleSave = async (): Promise<void> => {
    if (!event.title.trim()) {
      setTitleError(true);
      return;
    }
    if (!isValidDateRange(event)) {
      Alert.alert(
        'שגיאה בתאריכים',
        'לא ניתן לשמור את האירוע. על תאריך ושעת ההתחלה לחול לפני תאריך ושעת הסיום.',
        [{ text: 'אישור', style: 'default' }]
      );
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    try {
      if (onSave) {
        await onSave(event);
      }
      // Reset form so reopening shows a clean slate
      setEvent(makeEmptyEvent(selectedDate));
      // Return to wherever the user came from (calendar, home, etc.)
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(authenticated)');
      }
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשמור. נסה שוב.');
    } finally {
      // Always unblock the save button — whether nav succeeded, failed, or threw
      setIsSaving(false);
    }
  };

  /** true if the user touched any meaningful field */
  // FIXED: attachments now counted as a dirty-state change (triggers back confirmation)
  const isFormDirty = (): boolean =>
    event.title.trim().length > 0 ||
    event.participants.length > 0 ||
    event.tasks.length > 0 ||
    !!event.location ||
    !!event.onlineUrl ||
    !!event.notes ||
    (event.attachments?.length ?? 0) > 0;

  const goBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(authenticated)');
    }
  };

  const handleBack = (): void => {
    if (isCreate && isFormDirty()) {
      setDiscardOpen(true);
    } else {
      goBack();
    }
  };

  const confirmDiscard = (): void => {
    setDiscardOpen(false);
    setEvent(makeEmptyEvent(selectedDate));
    setTitleError(false);
    goBack();
  };

  const completedTasks = event.tasks.filter((t) => t.completed).length;
  const hasMultipleAssignees =
    new Set(event.tasks.map((t) => t.assigneeId).filter(Boolean)).size > 1;

  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      {/* Header — title centered, back arrow on RIGHT, no save action here */}
      <View style={s.header}>
        {/* Left spacer matches back button width for visual centering */}
        <View style={{ width: 40 }} />
        <Text style={s.headerTitle}>
          {isCreate ? 'יצירת אירוע' : 'פרטי אירוע'}
        </Text>
        <Pressable
          style={s.backButton}
          onPress={handleBack}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
        >
          <MaterialIcons name="arrow-forward" size={22} color="#111517" />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <FlatList
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled={true}
          data={[null]}
          keyExtractor={() => 'form'}
          renderItem={() => (
            <>
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
                startDate={event.date}
                startTime={event.startTime}
                endDate={event.endDate ?? event.date}
                endTime={event.endTime}
                isAllDay={event.isAllDay}
                onChange={(updates) => {
                  const patch: Partial<EventData> = {};
                  if (updates.startDate !== undefined) patch.date = updates.startDate;
                  if (updates.startTime !== undefined) patch.startTime = updates.startTime;
                  if (updates.endDate !== undefined) patch.endDate = updates.endDate;
                  if (updates.endTime !== undefined) patch.endTime = updates.endTime;
                  if (updates.isAllDay !== undefined) {
                    patch.isAllDay = updates.isAllDay;
                    if (updates.isAllDay) {
                      patch.remindersEnabled = false;
                      patch.reminders = [];
                    } else {
                      patch.remindersEnabled = true;
                      patch.reminders = [makeReminder('hour_before')];
                    }
                  }
                  updateEvent(patch);
                }}
              />

              {/* Participants */}
              <ParticipantsCard
                participants={event.participants}
                onChange={(p) => {
                  const removedIds = new Set(
                    event.participants
                      .filter((prev) => !p.some((next) => next.id === prev.id))
                      .map((prev) => prev.id)
                  );
                  const tasks =
                    removedIds.size > 0
                      ? event.tasks.map((t) => ({
                          ...t,
                          assignedParticipantIds: (
                            t.assignedParticipantIds ?? []
                          ).filter((id) => !removedIds.has(id)),
                        }))
                      : event.tasks;

                  // FIXED: removing a family member from participants also deselects them in family section
                  const removedFamilyIds = [...removedIds].filter(
                    (id) => familyMembers.some((fm) => fm._id === id)
                  );

                  if (removedFamilyIds.length > 0) {
                    const newFamilyIds = (event.sharedWithFamilyMemberIds ?? []).filter(
                      (id) => !removedFamilyIds.includes(id)
                    );
                    updateEvent({
                      participants: p,
                      tasks,
                      // If "כולם" was on and a member is removed, turn it off
                      allFamily: event.allFamily ? undefined : event.allFamily,
                      sharedWithFamilyMemberIds: newFamilyIds.length > 0 ? newFamilyIds : undefined,
                    });
                  } else {
                    updateEvent({ participants: p, tasks });
                  }
                }}
                familyMembers={familyMembers}
                allFamily={event.allFamily}
                sharedWithFamilyMemberIds={event.sharedWithFamilyMemberIds}
                onFamilyChange={(af, ids) => {
                  // FIXED: family member selection now syncs to event.participants for display
                  const patch: Partial<EventData> = {
                    allFamily: af || undefined,
                    sharedWithFamilyMemberIds: ids.length > 0 ? ids : undefined,
                  };

                  // Keep participants that are NOT family members (external contacts/email)
                  const existingNonFamily = event.participants.filter(
                    (p) => !familyMembers.some((fm) => fm._id === p.id)
                  );

                  if (af) {
                    // "כולם" — add every family member as a participant
                    patch.participants = [
                      ...existingNonFamily,
                      ...familyMembers.map((fm) => ({
                        id: fm._id,
                        name: fm.displayName ?? '',
                        color: fm.color ?? '#36a9e2',
                        avatarUrl: undefined,
                      })),
                    ];
                  } else if (ids.length > 0) {
                    // Individual selection — only the selected family members
                    patch.participants = [
                      ...existingNonFamily,
                      ...familyMembers
                        .filter((fm) => ids.includes(fm._id))
                        .map((fm) => ({
                          id: fm._id,
                          name: fm.displayName ?? '',
                          color: fm.color ?? '#36a9e2',
                          avatarUrl: undefined,
                        })),
                    ];
                  } else {
                    // Nothing selected — strip all family members from participants
                    patch.participants = existingNonFamily;
                  }

                  updateEvent(patch);
                }}
              />

              {/* Location */}
              <LocationCard
                location={event.location}
                onlineUrl={event.onlineUrl}
                onChange={(update: LocationUpdate) =>
                  updateEvent({
                    location: update.location || undefined,
                    onlineUrl: update.onlineUrl || undefined,
                  })
                }
              />

              {/* Attachments */}
              <EventAttachmentsSection
                attachments={event.attachments ?? []}
                onChange={(attachments: EventAttachmentDraft[]) =>
                  updateEvent({ attachments })
                }
              />

              {/* Recurrence */}
              <RecurrenceRow
                value={event.recurrence}
                onChange={(val) => updateEvent({ recurrence: val })}
              />

              {/* Reminders */}
              <RemindersCard
                enabled={event.remindersEnabled}
                reminders={event.reminders}
                isAllDay={event.isAllDay}
                onChange={(enabled, reminders) =>
                  updateEvent({ remindersEnabled: enabled, reminders })
                }
              />

              {/* Notes */}
              <NotesCard
                notes={event.notes}
                onChange={(notes) => updateEvent({ notes })}
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
                onAddParticipants={() => {}}
              />

              <View style={{ height: 20 }} />
            </>
          )}
        />

        {/* ── Sticky footer — inside KAV so it rides above the keyboard ── */}
        {isCreate && (
          <View style={s.footer}>
            <Pressable
              style={[s.footerSaveBtn, (!event.title.trim() || isSaving) && s.footerSaveBtnDisabled]}
              onPress={handleSave}
              disabled={!event.title.trim() || isSaving}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={isSaving ? 'שומר...' : 'שמור אירוע'}
            >
              <Text style={[s.footerSaveBtnText, (!event.title.trim() || isSaving) && s.footerSaveBtnTextDisabled]}>
                {isSaving ? 'שומר...' : 'שמור אירוע'}
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

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

      {/* ── Custom discard confirmation modal (RTL-safe, replaces Alert) ── */}
      <Modal
        visible={discardOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDiscardOpen(false)}
      >
        <Pressable
          style={s.discardOverlay}
          onPress={() => setDiscardOpen(false)}
          accessible={false}
        >
          <Pressable style={s.discardBox} onPress={() => undefined}>
            <Text style={s.discardTitle}>יציאה ללא שמירה</Text>
            <Text style={s.discardMessage}>
              האם ברצונך למחוק את הנתונים שהכנסת?
            </Text>
            <View style={s.discardDivider} />
            <View style={s.discardBtns}>
              <Pressable
                style={s.discardBtnDestructive}
                onPress={confirmDiscard}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="מחק וצא"
              >
                <Text style={s.discardBtnDestructiveText}>מחק וצא</Text>
              </Pressable>
              <View style={s.discardBtnDivider} />
              <Pressable
                style={s.discardBtnCancel}
                onPress={() => setDiscardOpen(false)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="המשך עריכה"
              >
                <Text style={s.discardBtnCancelText}>המשך עריכה</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  flex: { flex: 1 },
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
  // ── Sticky bottom save CTA ────────────────────────────────────────────────
  footer: {
    backgroundColor: '#f6f8f8',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  footerSaveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  footerSaveBtnDisabled: {
    backgroundColor: '#e5e7eb',
  },
  footerSaveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  footerSaveBtnTextDisabled: {
    color: '#9ca3af',
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
    fontWeight: '600',
    color: '#111827',
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
  // ── Discard modal ─────────────────────────────────────────────────────────
  discardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  discardBox: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  discardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  discardMessage: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
    paddingHorizontal: 20,
    paddingBottom: 20,
    lineHeight: 20,
  },
  discardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e8f0',
  },
  discardBtns: {
    flexDirection: 'row',
  },
  discardBtnDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e8f0',
  },
  discardBtnDestructive: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  discardBtnDestructiveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ef4444',
    textAlign: 'center',
  },
  discardBtnCancel: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  discardBtnCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: PRIMARY,
    textAlign: 'center',
  },
});
