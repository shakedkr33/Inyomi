import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import DraggableFlatList, {
  OpacityDecorator,
} from 'react-native-draggable-flatlist';
import { rtl } from '@/lib/rtl';
import type { EventTask, Participant } from '@/lib/types/event';

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';

interface RelatedTasksSectionProps {
  tasks: EventTask[];
  participants: Participant[];
  completedCount: number;
  tasksVisibleToParticipants: boolean;
  showToggle: boolean;
  onChange: (tasks: EventTask[]) => void;
  onToggleVisibility: (val: boolean) => void;
  visibilityOffHelperText: string;
  /** Called when user taps "הוסף" in the no-participants state of the assign sheet */
  onAddParticipants?: () => void;
  assignmentTitle?: string;
  assignmentEmptyText?: string;
  assignmentSectionLabel?: string;
  showAddParticipantsEmptyAction?: boolean;
}

export function RelatedTasksSection({
  tasks,
  participants,
  completedCount,
  tasksVisibleToParticipants,
  showToggle,
  onChange,
  onToggleVisibility,
  visibilityOffHelperText,
  onAddParticipants,
  assignmentTitle = 'הקצאת משימה',
  assignmentEmptyText = 'לא צורפו משתתפים לצורך הקצאת המשימה',
  assignmentSectionLabel = 'משתתפים',
  showAddParticipantsEmptyAction = true,
}: RelatedTasksSectionProps): React.JSX.Element {
  // ── Add-task modal state (cross-platform replacement for Alert.prompt) ────
  const [addTaskModalVisible, setAddTaskModalVisible] = useState(false);
  const [addTaskDraft, setAddTaskDraft] = useState('');

  // ── Assign sheet state ────────────────────────────────────────────────────
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [draftSelected, setDraftSelected] = useState<string[]>([]);

  const openAssignSheet = (task: EventTask): void => {
    setDraftSelected((task.assignedParticipantIds ?? []).slice(0, 1));
    setAssigningTaskId(task.id);
  };

  const closeAssignSheet = (): void => setAssigningTaskId(null);

  const toggleParticipantDraft = (pid: string): void => {
    setDraftSelected((prev) => (prev.includes(pid) ? [] : [pid]));
  };

  const saveAssignment = (): void => {
    const updated = tasks.map((t) =>
      t.id === assigningTaskId
        ? { ...t, assignedParticipantIds: draftSelected.slice(0, 1) }
        : t
    );
    onChange(updated);
    closeAssignSheet();
  };

  // ── Task actions ──────────────────────────────────────────────────────────
  const toggleTask = (taskId: string): void => {
    onChange(
      tasks.map((t) =>
        t.id === taskId ? { ...t, completed: !t.completed } : t
      )
    );
  };

  const deleteTask = (taskId: string): void => {
    onChange(tasks.filter((t) => t.id !== taskId));
  };

  const addTask = (): void => {
    setAddTaskDraft('');
    setAddTaskModalVisible(true);
  };

  const confirmAddTask = (): void => {
    const title = addTaskDraft.trim();
    if (!title) {
      setAddTaskModalVisible(false);
      return;
    }
    const newTask: EventTask = {
      id: Date.now().toString(),
      title,
      completed: false,
    };
    onChange([...tasks, newTask]);
    setAddTaskModalVisible(false);
    setAddTaskDraft('');
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Returns resolved Participant objects for a task's assignedParticipantIds */
  const resolveAssignees = (task: EventTask): Participant[] => {
    if (!task.assignedParticipantIds?.length) return [];
    return task.assignedParticipantIds
      .map((id) => participants.find((p) => p.id === id))
      .filter((p): p is Participant => p != null);
  };

  // ── Drag & drop reorder ──────────────────────────────────────────────────
  // Reordering only updates local form state via `onChange` — exactly like
  // add/delete/toggle/assign above — and is persisted together with the
  // rest of the form on Save (Event Edit's existing save pipeline), not
  // immediately. There is no separate "save order" action.
  const handleDragEnd = ({ data }: { data: EventTask[] }): void => {
    onChange(data);
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderAssigneeAvatars = (task: EventTask): React.ReactNode => {
    const assignees = resolveAssignees(task);
    if (assignees.length === 0) return null;
    const visible = assignees.slice(0, 3);
    return (
      <View style={s.avatarsRow}>
        {visible.map((p) => (
          <View key={p.id} style={s.miniAvatar}>
            <Text style={s.miniAvatarText}>
              {(p.name.trim() || '?')[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
        ))}
        {assignees.length > 3 && (
          <Text style={s.avatarCount}>+{assignees.length - 3}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={s.section}>
      {/* ── Header ── */}
      <View style={s.headerRow}>
        <View style={s.headerContent}>
          <Text style={s.label}>משימות קשורות</Text>
          <Text style={s.progressText}>
            {completedCount} מתוך {tasks.length} הושלמו
          </Text>
        </View>
        <View style={[s.iconCircle, { backgroundColor: TINT }]}>
          <MaterialIcons name="checklist" size={20} color={PRIMARY} />
        </View>
      </View>

      {/* ── Progress Bar ── */}
      {tasks.length > 0 && (
        <View style={s.progressBar}>
          <View
            style={[
              s.progressFill,
              {
                width: `${tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0}%`,
              },
            ]}
          />
        </View>
      )}

      {/* ── Task List ──
          DraggableFlatList with scrollEnabled=false so the parent
          ScrollView (EventScreen) handles scrolling; drag still works
          fine — same pattern as InlineSubtasksEditor's subtask list. */}
      <DraggableFlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        renderItem={({
          item: task,
          drag,
          isActive,
        }: RenderItemParams<EventTask>) => (
          <OpacityDecorator activeOpacity={0.75}>
            <View style={[s.taskRow, isActive && s.taskRowActive]}>
              {/* Drag handle — same icon/interaction as InlineSubtasksEditor */}
              <TouchableOpacity
                onPressIn={drag}
                style={s.dragHandle}
                accessible={true}
                accessibilityLabel="גרור לסידור מחדש"
                hitSlop={6}
              >
                <MaterialIcons name="drag-handle" size={20} color="#b0bec5" />
              </TouchableOpacity>

              {/* Checkbox + title */}
              <Pressable
                onPress={() => toggleTask(task.id)}
                style={s.taskCheckArea}
                accessible={true}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: task.completed }}
                accessibilityLabel={task.title}
              >
                <View style={[s.checkbox, task.completed && s.checkboxDone]}>
                  {task.completed && (
                    <MaterialIcons name="check" size={14} color="#fff" />
                  )}
                </View>
                <Text
                  style={[s.taskTitle, task.completed && s.taskTitleDone]}
                  numberOfLines={1}
                >
                  {task.title}
                </Text>
                {task.colorDot != null && (
                  <View
                    style={[s.colorDot, { backgroundColor: task.colorDot }]}
                  />
                )}
                {/* Compact assignee avatars */}
                {renderAssigneeAvatars(task)}
              </Pressable>

              {/* "הקצה" button */}
              <Pressable
                onPress={() => openAssignSheet(task)}
                style={s.assignBtn}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`הקצה משימה: ${task.title}`}
                hitSlop={6}
              >
                <Text style={s.assignBtnText}>הקצה</Text>
              </Pressable>

              {/* Delete */}
              <Pressable
                onPress={() => deleteTask(task.id)}
                style={s.deleteBtn}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`מחק משימה: ${task.title}`}
                hitSlop={8}
              >
                <MaterialIcons name="close" size={16} color="#94a3b8" />
              </Pressable>
            </View>
          </OpacityDecorator>
        )}
        onDragEnd={handleDragEnd}
        scrollEnabled={false}
        activationDistance={8}
        disableScrollViewPanResponder={true}
        containerStyle={{ overflow: 'visible' }}
      />

      {/* ── Add Task ── */}
      <Pressable
        style={({ pressed }) => [s.addTaskRow, pressed && s.addTaskRowPressed]}
        onPress={addTask}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="הוסף משימה חדשה"
        hitSlop={4}
      >
        <Text style={s.addTaskText}>הוסף משימה חדשה</Text>
        <View style={s.addTaskBtn}>
          <Ionicons name="add" size={18} color={PRIMARY} />
        </View>
      </Pressable>

      {/* ── Visibility Toggle ── */}
      {showToggle && (
        <View style={s.visibilityRow}>
          <View style={s.visibilityTextWrap}>
            <Text style={s.visibilityTitle}>משימות גלויות למשתתפים</Text>
            <Text style={s.visibilityText}>
              {tasksVisibleToParticipants
                ? 'כל חברי הקהילה יראו את המשימות וההקצאות ויוכלו להשתבץ'
                : visibilityOffHelperText}
            </Text>
          </View>
          <Switch
            value={tasksVisibleToParticipants}
            onValueChange={onToggleVisibility}
            trackColor={{ true: PRIMARY, false: '#e2e8f0' }}
            thumbColor="#fff"
            accessible={true}
            accessibilityLabel="משימות גלויות למשתתפים"
          />
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Add Task Modal (cross-platform — replaces Alert.prompt which is iOS-only)
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={addTaskModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddTaskModalVisible(false)}
      >
        <Pressable
          style={s.addModalOverlay}
          onPress={() => setAddTaskModalVisible(false)}
          accessible={false}
        >
          <Pressable style={s.addModalBox} onPress={() => undefined}>
            <Text style={s.addModalTitle}>משימה חדשה</Text>
            <TextInput
              style={s.addModalInput}
              value={addTaskDraft}
              onChangeText={setAddTaskDraft}
              placeholder="שם המשימה"
              placeholderTextColor="#94a3b8"
              textAlign="right"
              autoFocus={true}
              returnKeyType="done"
              onSubmitEditing={confirmAddTask}
              accessible={true}
              accessibilityLabel="שם המשימה"
            />
            <View style={s.addModalBtns}>
              <Pressable
                style={s.addModalCancelBtn}
                onPress={() => setAddTaskModalVisible(false)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="ביטול"
              >
                <Text style={s.addModalCancelText}>ביטול</Text>
              </Pressable>
              <Pressable
                style={[
                  s.addModalConfirmBtn,
                  !addTaskDraft.trim() && s.addModalConfirmBtnDisabled,
                ]}
                onPress={confirmAddTask}
                disabled={!addTaskDraft.trim()}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="הוסף"
              >
                <Text
                  style={[
                    s.addModalConfirmText,
                    !addTaskDraft.trim() && s.addModalConfirmTextDisabled,
                  ]}
                >
                  הוסף
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          Task Assignment Bottom Sheet
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={assigningTaskId != null}
        transparent
        animationType="slide"
        onRequestClose={closeAssignSheet}
      >
        <Pressable
          style={s.sheetOverlay}
          onPress={closeAssignSheet}
          accessible={false}
        >
          <Pressable style={s.sheet} onPress={() => undefined}>
            {/* Handle */}
            <View style={s.sheetHandle} />

            {/* Title */}
            <Text style={s.sheetTitle}>{assignmentTitle}</Text>

            {participants.length === 0 ? (
              /* ── No-participants state ── */
              <View style={s.noParticipantsBox}>
                <MaterialIcons name="group-off" size={32} color="#cbd5e1" />
                <Text style={s.noParticipantsText}>{assignmentEmptyText}</Text>
                {showAddParticipantsEmptyAction ? (
                  <Pressable
                    style={s.addParticipantsBtn}
                    onPress={() => {
                      closeAssignSheet();
                      onAddParticipants?.();
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוסף משתתפים"
                  >
                    <Text style={s.addParticipantsBtnText}>הוסף משתתפים</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              /* ── Participant list ── */
              <>
                <Text style={s.sheetSectionLabel}>
                  {assignmentSectionLabel}
                </Text>
                <ScrollView
                  style={s.participantList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {participants.map((p) => {
                    const selected = draftSelected.includes(p.id);
                    return (
                      <Pressable
                        key={p.id}
                        style={[
                          s.participantRow,
                          selected && s.participantRowSelected,
                        ]}
                        onPress={() => toggleParticipantDraft(p.id)}
                        accessible={true}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={p.name}
                      >
                        {/* Selection indicator */}
                        <View
                          style={[
                            s.participantCheck,
                            selected && s.participantCheckSelected,
                          ]}
                        >
                          {selected && (
                            <MaterialIcons
                              name="check"
                              size={14}
                              color="#fff"
                            />
                          )}
                        </View>

                        {/* Name + secondary */}
                        <View style={s.participantInfo}>
                          <Text style={s.participantName}>{p.name}</Text>
                          {(p.phone ?? p.email) != null && (
                            <Text
                              style={s.participantSecondary}
                              numberOfLines={1}
                            >
                              {p.phone ?? p.email}
                            </Text>
                          )}
                        </View>

                        {/* Avatar */}
                        <View
                          style={[
                            s.participantAvatar,
                            { backgroundColor: p.color },
                          ]}
                        >
                          <Text style={s.participantAvatarText}>
                            {(p.name.trim() || '?')[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {/* Save */}
                <Pressable
                  style={s.saveBtn}
                  onPress={saveAssignment}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="שמור הקצאה"
                >
                  <Text style={s.saveBtnText}>שמור</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: { flex: 1 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: rtl.textAlign,
    marginBottom: 2,
  },
  progressText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: rtl.textAlign,
  },

  // ── Progress bar ──────────────────────────────────────────────────────────
  progressBar: {
    height: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 2,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },

  // ── Task row ──────────────────────────────────────────────────────────────
  taskRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
    gap: 6,
    borderRadius: 8,
  },
  taskRowActive: {
    backgroundColor: '#f0f9ff',
  },
  dragHandle: {
    width: 28,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCheckArea: {
    flex: 1,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
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
  checkboxDone: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  taskTitle: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    textAlign: rtl.textAlign,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: '#94a3b8',
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ── Compact assignee avatars inside task row ───────────────────────────────
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  miniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: TINT,
    borderWidth: 1,
    borderColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: {
    fontSize: 9,
    fontWeight: '700',
    color: PRIMARY,
  },
  avatarCount: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: '600',
  },

  // ── "הקצה" button ─────────────────────────────────────────────────────────
  assignBtn: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: TINT,
  },
  assignBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: PRIMARY,
  },

  deleteBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },

  // ── Add task row ───────────────────────────────────────────────────────────
  addTaskRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    marginTop: 8,
  },
  addTaskBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTaskRowPressed: {
    opacity: 0.7,
  },
  addTaskText: {
    flex: 1,
    fontSize: 14,
    color: PRIMARY,
    fontWeight: '600',
    textAlign: rtl.textAlign,
  },

  // ── Add task modal ──────────────────────────────────────────────────────────
  addModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  addModalBox: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    gap: 16,
  },
  addModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  addModalInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
    textAlign: 'right',
  },
  addModalBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  addModalCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  addModalConfirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addModalConfirmBtnDisabled: {
    backgroundColor: '#e2e8f0',
  },
  addModalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  addModalConfirmTextDisabled: {
    color: '#94a3b8',
  },

  // ── Visibility toggle ─────────────────────────────────────────────────────
  visibilityRow: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  visibilityTextWrap: {
    flex: 1,
    alignItems: rtl.alignStart,
    marginLeft: 8,
  },
  visibilityTitle: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '700',
    textAlign: rtl.textAlign,
    marginBottom: 2,
  },
  visibilityText: {
    fontSize: 12,
    color: '#64748b',
    textAlign: rtl.textAlign,
  },

  // ── Assign bottom sheet ───────────────────────────────────────────────────
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    maxHeight: '70%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 16,
  },
  sheetSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textAlign: 'right',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  // ── Participant list in sheet ──────────────────────────────────────────────
  participantList: {
    maxHeight: 280,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
    gap: 12,
  },
  participantRowSelected: {
    backgroundColor: TINT,
  },
  participantCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantCheckSelected: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  participantInfo: {
    flex: 1,
    alignItems: rtl.alignStart,
  },
  participantName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  participantSecondary: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 1,
  },
  participantAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantAvatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },

  // ── No-participants state ─────────────────────────────────────────────────
  noParticipantsBox: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  noParticipantsText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 240,
  },
  addParticipantsBtn: {
    backgroundColor: TINT,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  addParticipantsBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: PRIMARY,
  },

  // ── Save button ───────────────────────────────────────────────────────────
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
