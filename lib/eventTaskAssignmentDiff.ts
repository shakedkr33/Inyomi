/**
 * FIX — Community Event task unassignment silently dropped on Save.
 *
 * Plain TypeScript, no React Native imports, so it can be unit-tested
 * directly (see tests/convex/eventTaskAssignmentDiff.test.ts) without a
 * React Native test harness — same pattern as lib/eventTasksSummary.ts.
 *
 * This module is the SINGLE authoritative place that decides, for an
 * EXISTING event task being edited in the "עריכת אירוע" form
 * (app/(authenticated)/event-edit/[id].tsx), whether the task's assignee
 * actually changed and what `eventTasks.setAssignee` should be called
 * with. The edit screen calls these functions directly — this is not a
 * parallel reimplementation of the save logic, it IS the save logic.
 *
 * ROOT CAUSE (bug being fixed here):
 * `convexEventToEventData` initializes every existing task's
 * `assignedParticipantIds` to an array (possibly empty, never
 * `undefined`) from the live server assignment, and the assign sheet
 * (`RelatedTasksSection.saveAssignment`) is the only thing that mutates it
 * afterwards. The deprecated `assigneeId` field is captured once at
 * form-load time and is NEVER updated by the form again.
 *
 * The previous computation —
 *   `task.assignedParticipantIds?.[0] ?? task.assigneeId`
 * — silently resurrected the stale, original `assigneeId` whenever the
 * editor cleared an assignment (making `assignedParticipantIds` an empty
 * array): `[][0]` is `undefined`, and `undefined ?? task.assigneeId`
 * evaluates back to the ORIGINAL assignee. The resolved pid then still
 * equaled the form-load `assigneeId`, "nothing changed" was concluded,
 * and `setTaskAssignee` was never called — even though the UI showed the
 * task as unassigned. Only fall back to `assigneeId` when
 * `assignedParticipantIds` was never set at all (not expected for
 * existing tasks, kept only as a defensive guard).
 */

/** Minimal shape of a form-side task needed to resolve its assignee. */
export type EditableAssignmentTask = {
  /** @deprecated form-load snapshot only — never mutated afterwards. */
  assigneeId?: string;
  /** Authoritative — kept in sync by the assign sheet. */
  assignedParticipantIds?: string[];
};

/** Minimal shape of the corresponding persisted server task. */
export type PersistedAssignmentTask = {
  assignedToUserId?: string;
  assignedToManual?: string;
};

export type ResolvedAssigneePayload =
  | { type: 'user'; userId: string }
  | { type: 'manual'; name: string }
  | null;

export type AssignmentDiffResult = {
  changed: boolean;
  assignee: ResolvedAssigneePayload;
};

/**
 * Resolves the participant id the form currently represents for a task,
 * correctly distinguishing "explicitly cleared" (empty array → no pid)
 * from "never touched by the assign sheet at all" (array genuinely
 * `undefined` → fall back to the form-load snapshot). This is the exact
 * fix for the bug described above.
 */
export function resolveFormAssignedParticipantId(
  task: EditableAssignmentTask
): string | undefined {
  return task.assignedParticipantIds !== undefined
    ? task.assignedParticipantIds[0]
    : task.assigneeId;
}

/**
 * Community Event branch — assignee is always account-backed (`type:
 * 'user'`) or cleared (`null`); manual names are not supported for
 * Community Events (enforced separately server-side by
 * `assertCommunityTaskAssigneeAllowed`).
 */
export function resolveCommunityTaskAssignmentDiff(
  task: EditableAssignmentTask,
  orig: PersistedAssignmentTask
): AssignmentDiffResult {
  const assignedPid = resolveFormAssignedParticipantId(task);
  const initialAssigneeId = task.assigneeId;
  const originalManualName = orig.assignedToManual?.trim();
  const changed =
    assignedPid !== initialAssigneeId || Boolean(originalManualName);
  if (!changed) return { changed: false, assignee: null };
  return {
    changed: true,
    assignee: assignedPid ? { type: 'user', userId: assignedPid } : null,
  };
}

/**
 * Personal Event branch — assignee resolves to a manual display name
 * from `participants` (family members / free-text participants).
 */
export function resolvePersonalTaskAssignmentDiff(
  task: EditableAssignmentTask,
  orig: PersistedAssignmentTask,
  participants: { id: string; name: string }[]
): AssignmentDiffResult {
  const assignedPid = resolveFormAssignedParticipantId(task);
  const originalManualName = orig.assignedToManual?.trim();
  const assignedName = participants
    .find((p) => p.id === assignedPid)
    ?.name?.trim();
  const changed =
    assignedName !== originalManualName || Boolean(orig.assignedToUserId);
  if (!changed) return { changed: false, assignee: null };
  return {
    changed: true,
    assignee: assignedName ? { type: 'manual', name: assignedName } : null,
  };
}
