import type { SubTask, SubTaskAttachment } from '@/lib/types/task';

export function displayedSubtaskAttachment(
  subtask: Pick<SubTask, 'id' | 'image'> & {
    attachment?: Omit<SubTaskAttachment, 'originalName' | 'displayName'> & {
      originalName?: string;
      displayName?: string;
    };
  }
): SubTaskAttachment | undefined {
  if (subtask.attachment)
    return {
      ...subtask.attachment,
      originalName: subtask.attachment.originalName ?? 'file',
      displayName:
        subtask.attachment.displayName ??
        subtask.attachment.originalName ??
        'קובץ',
    };
  return subtask.image
    ? {
        ...subtask.image,
        id: `legacy-${subtask.id}`,
        type: 'image',
        originalName: 'image',
        displayName: 'תמונה',
      }
    : undefined;
}

/** Match tasks.setSubtaskAttachment: change only the displayed slot. */
export function replaceSubtaskAttachment(
  subtask: SubTask,
  attachment: SubTaskAttachment | undefined
): SubTask {
  return subtask.attachment !== undefined
    ? { ...subtask, attachment }
    : { ...subtask, image: undefined, attachment };
}
