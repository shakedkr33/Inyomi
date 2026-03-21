import { MaterialIcons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { EventTask, Participant } from '@/lib/types/event';

const PRIMARY = '#36a9e2';

interface RelatedTasksSectionProps {
  tasks: EventTask[];
  participants: Participant[];
  completedCount: number;
  showAllTasksToAll: boolean;
  showToggle: boolean;
  onChange: (tasks: EventTask[]) => void;
  onToggleVisibility: (val: boolean) => void;
}

export function RelatedTasksSection({
  tasks,
  participants,
  completedCount,
  showAllTasksToAll,
  showToggle,
  onChange,
  onToggleVisibility,
}: RelatedTasksSectionProps): React.JSX.Element {
  const toggleTask = (taskId: string): void => {
    const updated = tasks.map((t) =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    onChange(updated);
  };

  const addTask = (): void => {
    Alert.prompt(
      'משימה חדשה',
      'הכנס שם המשימה',
      (text) => {
        if (text == null || text.trim() === '') return;
        const newTask: EventTask = {
          id: Date.now().toString(),
          title: text.trim(),
          completed: false,
        };
        onChange([...tasks, newTask]);
      },
      'plain-text',
      '',
      'default'
    );
  };

  const getAssignee = (assigneeId?: string): Participant | undefined => {
    if (assigneeId == null) return undefined;
    return participants.find((p) => p.id === assigneeId);
  };

  return (
    <View style={s.section}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={[s.iconCircle, { backgroundColor: '#fef3c7' }]}>
          <MaterialIcons name="checklist" size={24} color="#d97706" />
        </View>
        <View style={s.headerContent}>
          <Text style={[s.label, { color: '#d97706' }]}>משימות קשורות</Text>
          <Text style={s.progressText}>
            {completedCount} מתוך {tasks.length} הושלמו
          </Text>
        </View>
      </View>

      {/* Progress Bar */}
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

      {/* Task List */}
      {tasks.map((task) => {
        const assignee = getAssignee(task.assigneeId);
        return (
          <Pressable
            key={task.id}
            style={s.taskRow}
            onPress={() => toggleTask(task.id)}
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
              <View style={[s.colorDot, { backgroundColor: task.colorDot }]} />
            )}
            {assignee != null && (
              <View
                style={[s.assigneeAvatar, { backgroundColor: assignee.color }]}
              >
                <Text style={s.assigneeInitial}>{assignee.name.charAt(0)}</Text>
              </View>
            )}
          </Pressable>
        );
      })}

      {/* Add Task */}
      <Pressable
        style={s.addTaskRow}
        onPress={addTask}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="הוסף משימה חדשה"
      >
        <MaterialIcons name="add" size={18} color="#94a3b8" />
        <Text style={s.addTaskText}>הוסף משימה חדשה</Text>
      </Pressable>

      {/* Visibility Toggle */}
      {showToggle && (
        <View style={s.visibilityRow}>
          <Text style={s.visibilityText}>הצג את כל המשימות לכל המשתתפים</Text>
          <Switch
            value={showAllTasksToAll}
            onValueChange={onToggleVisibility}
            trackColor={{ true: PRIMARY, false: '#e2e8f0' }}
            thumbColor="#fff"
            accessible={true}
            accessibilityLabel="הצג משימות לכולם"
          />
        </View>
      )}
    </View>
  );
}

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
  headerRow: {
    flexDirection: 'row',
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
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  progressText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'right',
  },
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
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
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
    textAlign: 'right',
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
  assigneeAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assigneeInitial: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  addTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 8,
  },
  addTaskText: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '500',
  },
  visibilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  visibilityText: {
    fontSize: 13,
    color: '#64748b',
    flex: 1,
    textAlign: 'right',
    marginRight: 8,
  },
});
