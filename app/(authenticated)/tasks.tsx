import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const PRIMARY_BLUE = '#36a9e2';

type Task = {
  id: string;
  title: string;
  category: string;
  isUrgent?: boolean;
  isOverdue?: boolean;
  completed?: boolean;
  subtasks?: {
    id: string;
    title: string;
    completed: boolean;
  }[];
};

/* MOCK_TASKS – הוסר, נתונים מגיעים מ-Convex:
const MOCK_TASKS: Task[] = [
  { id: '1', title: 'לקבוע תור לרופא ילדים', category: 'אישי', isUrgent: true, isOverdue: true, completed: false },
  { id: '2', title: 'קניית מצרכים לשבת', category: 'אישי', completed: false, subtasks: [...] },
  { id: '3', title: 'סידור הבית לאורחים', category: 'אישי', completed: true },
  { id: '4', title: 'שליחת דוח חודשי', category: 'עבודה', completed: true },
];
*/

export default function TasksScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('הכל');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // ── Convex: spaceId ──────────────────────────────────────────────────────
  // TODO: כאשר defaultSpaceId ייאכלס ב-onboarding, לעבור לשליפה ישירה מ-user.defaultSpaceId
  // getMySpace מחזיר את ה-spaceId ישירות (Id<'spaces'> | null)
  const spaceId = useQuery(api.users.getMySpace);

  // ── Convex: tasks queries ────────────────────────────────────────────────
  const convexTasks = useQuery(
    api.tasks.listBySpace,
    spaceId ? { spaceId } : 'skip'
  );
  const convexUndated = useQuery(
    api.tasks.listUndated,
    spaceId ? { spaceId } : 'skip'
  );

  // ממיר נתוני Convex לפורמט Task המקומי
  const allConvexTasks: Task[] = useMemo(() => {
    const dated = (convexTasks ?? []).map((t) => ({
      id: t._id,
      title: t.title,
      category: t.category ?? 'אישי', // TODO: להוסיף category לסכמה
      completed: t.completed,
    }));
    const undated = (convexUndated ?? []).map((t) => ({
      id: t._id,
      title: t.title,
      category: t.category ?? 'אישי',
      completed: t.completed,
    }));
    return [...dated, ...undated];
  }, [convexTasks, convexUndated]);

  // ── Convex: mutations ────────────────────────────────────────────────────
  const toggleCompletedMutation = useMutation(api.tasks.toggleCompleted);
  const removeTaskMutation = useMutation(api.tasks.remove);

  const filters = ['הכל', 'אישי', 'אירועים'];

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  // subtasks הם local-only עד שנוסיף subtasks לסכמת Convex
  // TODO: לחבר subtask toggle ל-Convex כשנוסיף שדה subtasks לטבלת tasks
  const toggleSubtask = (_taskId: string, _subtaskId: string) => {
    // TODO: לממש עם mutation כשיהיו subtasks ב-Convex
    console.log('toggleSubtask: not yet connected to Convex');
  };

  const toggleTaskCompletion = async (taskId: string) => {
    try {
      await toggleCompletedMutation({ id: taskId as Id<'tasks'> });
    } catch (e) {
      console.error('toggleTaskCompletion error:', e);
      // TODO: להוסיף optimistic UI בעתיד
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await removeTaskMutation({ id: taskId as Id<'tasks'> });
    } catch (e) {
      console.error('handleDeleteTask error:', e);
    }
  };

  // ===== לוגיקת סינון משולבת (פילטר + חיפוש) =====
  const filteredTasks = allConvexTasks.filter((task) => {
    // TODO: לסנן גם לפי category אמיתי מ-Convex
    const matchesFilter =
      activeFilter === 'הכל' || task.category === activeFilter;
    const matchesSearch = task.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // עכשיו מחלקים ל"לביצוע" ו"בוצעו" מתוך הרשימה שכבר סוננה
  const pendingTasks = filteredTasks.filter((task) => !task.completed);
  const completedTasks = filteredTasks.filter((task) => task.completed);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>המשימות שלי</Text>
          <Pressable
            style={styles.addButton}
            onPress={() => router.push('/(authenticated)/task/new' as never)}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="הוסף משימה חדשה"
          >
            <MaterialIcons name="add" size={24} color="#ffffff" />
          </Pressable>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <MaterialIcons
              name="search"
              size={20}
              color="#637588"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="חיפוש משימה..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>

        {/* Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersContainer}
          contentContainerStyle={styles.filtersContent}
        >
          {filters.map((filter) => (
            <Pressable
              key={filter}
              style={[
                styles.filterChip,
                activeFilter === filter && styles.filterChipActive,
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  activeFilter === filter && styles.filterChipTextActive,
                ]}
              >
                {filter}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Tasks List */}
        <ScrollView
          style={styles.tasksScrollView}
          showsVerticalScrollIndicator={false}
        >
          {/* Pending Tasks Section */}
          {pendingTasks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>לביצוע</Text>
              {pendingTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isExpanded={expandedTasks.has(task.id)}
                  onToggleExpansion={() => toggleTaskExpansion(task.id)}
                  onToggleSubtask={(subtaskId) =>
                    toggleSubtask(task.id, subtaskId)
                  }
                  onToggleCompletion={() => toggleTaskCompletion(task.id)}
                  onPress={() =>
                    router.push(`/(authenticated)/task/${task.id}` as never)
                  }
                />
              ))}
            </View>
          )}

          {/* Completed Tasks Section */}
          {completedTasks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>בוצעו</Text>
              {completedTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isExpanded={false}
                  onToggleExpansion={() => {}}
                  onToggleSubtask={() => {}}
                  onToggleCompletion={() => toggleTaskCompletion(task.id)}
                  onPress={() =>
                    router.push(`/(authenticated)/task/${task.id}` as never)
                  }
                />
              ))}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ===== Task Card Component =====
function TaskCard({
  task,
  isExpanded,
  onToggleExpansion,
  onToggleSubtask,
  onToggleCompletion,
  onPress,
}: {
  task: Task;
  isExpanded: boolean;
  onToggleExpansion: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onToggleCompletion: () => void;
  onPress: () => void;
}) {
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const completedSubtasks =
    task.subtasks?.filter((st) => st.completed).length || 0;
  const totalSubtasks = task.subtasks?.length || 0;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.taskCard,
        task.isUrgent && styles.taskCardUrgent,
        task.completed && styles.taskCardCompleted,
      ]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`משימה: ${task.title}`}
    >
      <View style={styles.taskCardHeader}>
        {/* Checkbox */}
        <Pressable
          style={styles.checkbox}
          onPress={onToggleCompletion}
          accessible={true}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.completed }}
        >
          {task.completed ? (
            <MaterialIcons name="check-circle" size={24} color={PRIMARY_BLUE} />
          ) : (
            <View
              style={[
                styles.checkboxEmpty,
                task.isUrgent && styles.checkboxUrgent,
              ]}
            />
          )}
        </Pressable>

        {/* Task Content */}
        <View style={styles.taskContent}>
          <Text
            style={[
              styles.taskTitle,
              task.isUrgent && styles.taskTitleUrgent,
              task.completed && styles.taskTitleCompleted,
            ]}
          >
            {task.title}
          </Text>

          {/* Tags */}
          <View style={styles.tagsRow}>
            {task.isOverdue && (
              <View style={[styles.tag, styles.tagOverdue]}>
                <Text style={styles.tagTextOverdue}>איחור</Text>
              </View>
            )}
            <View style={styles.tag}>
              <Text style={styles.tagText}>{task.category}</Text>
            </View>
          </View>

          {/* Subtasks Progress */}
          {hasSubtasks && !task.completed && (
            <View style={styles.subtasksProgress}>
              <Text style={styles.subtasksProgressText}>
                {completedSubtasks} מתוך {totalSubtasks} הושלמו
              </Text>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${(completedSubtasks / totalSubtasks) * 100}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}
        </View>

        {/* Expand Button */}
        {hasSubtasks && !task.completed && (
          <Pressable
            style={styles.expandButton}
            onPress={onToggleExpansion}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isExpanded ? 'כווץ' : 'הרחב'}
          >
            <MaterialIcons
              name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
              size={24}
              color="#637588"
            />
          </Pressable>
        )}
      </View>

      {/* Subtasks List (Expanded) */}
      {isExpanded && hasSubtasks && task.subtasks && (
        <View style={styles.subtasksList}>
          {task.subtasks.map((subtask) => (
            <Pressable
              key={subtask.id}
              style={styles.subtaskItem}
              onPress={() => onToggleSubtask(subtask.id)}
              accessible={true}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: subtask.completed }}
            >
              <View
                style={[
                  styles.subtaskCheckbox,
                  subtask.completed && styles.subtaskCheckboxChecked,
                ]}
              >
                {subtask.completed && (
                  <MaterialIcons name="check" size={14} color="#ffffff" />
                )}
              </View>
              <Text
                style={[
                  styles.subtaskText,
                  subtask.completed && styles.subtaskTextCompleted,
                ]}
              >
                {subtask.title}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#f6f7f8',
    direction: 'rtl',
  },

  /* Header */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111418',
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PRIMARY_BLUE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: PRIMARY_BLUE,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },

  /* Search */
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  searchBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#f6f7f8',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginLeft: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111418',
    textAlign: 'right',
  },

  /* Filters */
  filtersContainer: {
    backgroundColor: '#ffffff',
    height: 55, // 👈 זה ימנע מהם להימתח על חצי מסך!
    flexGrow: 0, // 👈 זה מבטיח שהקונטיינר לא יגדל מעבר ל-55 פיקסלים
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  filtersContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
    flexDirection: 'row-reverse', // RTL
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  filterChipActive: {
    backgroundColor: PRIMARY_BLUE,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#637588',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },

  /* Tasks */
  tasksScrollView: {
    flex: 1,
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111418',
    marginBottom: 12,
    textAlign: 'right',
  },

  /* Task Card */
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  taskCardUrgent: {
    borderColor: '#ef4444',
    borderWidth: 2,
  },
  taskCardCompleted: {
    opacity: 0.6,
    backgroundColor: '#f9fafb',
  },
  taskCardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
  },

  /* Checkbox */
  checkbox: {
    marginLeft: 12,
  },
  checkboxEmpty: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#d1d5db',
  },
  checkboxUrgent: {
    borderColor: '#ef4444',
  },

  /* Task Content */
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111418',
    marginBottom: 8,
    textAlign: 'right',
  },
  taskTitleUrgent: {
    color: '#ef4444',
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#9ca3af',
  },

  /* Tags */
  tagsRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginBottom: 8,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  tagOverdue: {
    backgroundColor: '#fee2e2',
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#637588',
  },
  tagTextOverdue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },

  /* Subtasks Progress */
  subtasksProgress: {
    marginTop: 4,
  },
  subtasksProgressText: {
    fontSize: 13,
    color: '#637588',
    marginBottom: 6,
    textAlign: 'right',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: PRIMARY_BLUE,
    borderRadius: 3,
  },

  /* Expand Button */
  expandButton: {
    marginLeft: 8,
  },

  /* Subtasks List */
  subtasksList: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 10,
  },
  subtaskItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 4,
  },
  subtaskCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  subtaskCheckboxChecked: {
    backgroundColor: PRIMARY_BLUE,
    borderColor: PRIMARY_BLUE,
  },
  subtaskText: {
    fontSize: 14,
    color: '#111418',
    textAlign: 'right',
  },
  subtaskTextCompleted: {
    textDecorationLine: 'line-through',
    color: '#9ca3af',
  },
});
