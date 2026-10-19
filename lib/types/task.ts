import type { EventAttachmentDraft } from '@/lib/types/event';

export type TaskDateOption =
  | 'none'
  | 'today'
  | 'tomorrow'
  | 'other'
  | 'in_one_hour'
  | 'in_two_hours';

export type TaskReminderType =
  | 'none'
  | 'morning'
  | 'evening'
  | 'at_time'
  | 'hour_before'
  | 'custom';

export type PersistedTaskReminderType = Exclude<TaskReminderType, 'none'>;

export type TaskReminderUnit = 'minutes' | 'hours' | 'days';

export interface TaskReminder {
  id: string;
  type: PersistedTaskReminderType;
  customAmount?: number;
  customUnit?: TaskReminderUnit;
  customReminderAt?: number;
  label?: string;
}

export type TaskRecurrenceType = 'none' | 'daily' | 'weekly' | 'specific_days';

export type ReminderOption = TaskReminderType;
export type RepeatOption = Exclude<TaskRecurrenceType, 'none'>;

export type TaskCategory = 'personal' | 'shopping' | 'family' | 'work';

export const TASK_CATEGORIES: {
  key: TaskCategory;
  label: string;
}[] = [
  { key: 'personal', label: 'אישי' },
  { key: 'shopping', label: 'קניות' },
  { key: 'family', label: 'משפחה' },
  { key: 'work', label: 'עבודה' },
] as const;

export const TASK_FILTERS = [
  'הכל',
  ...TASK_CATEGORIES.map((category) => category.label),
  'אירועים',
] as const;

export type TaskFilter = (typeof TASK_FILTERS)[number];

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  personal: 'אישי',
  shopping: 'קניות',
  family: 'משפחה',
  work: 'עבודה',
};

export function isTaskCategory(value: string): value is TaskCategory {
  return ['personal', 'shopping', 'family', 'work'].includes(value);
}

export function getTaskCategoryLabel(category?: string): string {
  return category && isTaskCategory(category)
    ? TASK_CATEGORY_LABELS[category]
    : TASK_CATEGORY_LABELS.personal;
}

export type SubTaskAttachmentType = 'image' | 'file';

/** Subtask file (same draft/persist pattern as EventAttachmentDraft + id/type). */
export interface SubTaskAttachment {
  id: string;
  type: SubTaskAttachmentType;
  storageId?: string;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: number;
  localUri?: string;
}

export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
  attachment?: SubTaskAttachment;
  /** Retained historical slot; attachment takes precedence. */
  image?: {
    storageId: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: number;
  };
}

export interface TaskAssignee {
  id: string;
  name: string;
  initial: string;
  color: string;
}

export interface TaskDraft {
  title: string;
  dateOption: TaskDateOption;
  selectedDate?: number;
  selectedTime?: string;
  hasTime: boolean;
  reminders: TaskReminder[];
  recurrenceType: TaskRecurrenceType;
  selectedWeekdays: number[];
  category: TaskCategory;
  assignedTo?: string;
  assignedToMemberId?: string;
  assignedToUserIds: string[];
  assignedToMemberIds: string[];
  reminderError?: string;
  linkedEventId?: string;
  subtasks: SubTask[];
  allowParticipantEditing: boolean;
  notes: string;
  attachments: EventAttachmentDraft[];
}
