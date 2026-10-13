/** Personal tasks already obey server permissions. Community Home keeps its
 * established mine/unassigned subset, including for community managers. */
export function filterHomeVisibleEventTasks<
  T extends {
    isAssignedToCurrentUser: boolean;
    assignedToUserId?: string;
    assignedToManual?: string;
  },
>(tasks: T[], isPersonalEvent = false): T[] {
  if (isPersonalEvent) return tasks;
  return tasks.filter(
    (task) =>
      task.isAssignedToCurrentUser ||
      (!task.assignedToUserId && !task.assignedToManual?.trim())
  );
}
