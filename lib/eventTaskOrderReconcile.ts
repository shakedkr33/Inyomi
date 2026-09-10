/**
 * FIX 8C — Community Event task reordering, aligned with Personal Event
 * Edit UX.
 *
 * Plain TypeScript, no React Native imports, so it can be unit-tested
 * directly (see tests/convex/eventTaskOrderReconcile.test.ts) — same
 * pattern as lib/eventTaskAssignmentDiff.ts and lib/eventTasksSummary.ts.
 *
 * This module resolves the ONE tricky part of persisting drag-reorder
 * together with create/delete/edit in a single Save: the Event Edit form
 * (app/(authenticated)/event-edit/[id].tsx) keeps a single local
 * `EventData.tasks` array that already reflects every add/delete/reorder
 * the user made in this session — but newly-added tasks only get a real
 * Convex `eventTasks` id AFTER `eventTasks.createBatch` runs during Save.
 * Deleted tasks are already absent from the array (RelatedTasksSection
 * removes them from local state immediately on delete), so no separate
 * "deleted" handling is needed here — they simply never appear.
 *
 * `reconcileEventTaskOrder` takes the final local task order and a
 * resolver mapping each task's *local* id (real id for existing tasks,
 * temporary client-generated id for new tasks) to its *persisted* backend
 * id, and produces the exact `orderedIds` payload for
 * `eventTasks.reorder`. It is not a parallel reimplementation of the save
 * logic — the real save handler calls this directly.
 */

export type OrderReconcileTask = { id: string };

/**
 * @param currentTasks The current local tasks array, in the exact order the
 *   form wants persisted (array position === desired order). Deleted tasks
 *   must already be absent — this function does not filter deletions.
 * @param resolveId Maps a task's local id to its persisted backend id.
 *   Called once per task; for existing tasks this should just return the
 *   same id back, for newly-created tasks it should return the real id
 *   assigned by `eventTasks.createBatch` during this same save. Returning
 *   `undefined` drops the task from the result (defensive — should not
 *   happen in practice, since every task in `currentTasks` either already
 *   existed or was just created before this is called).
 * @returns The final ordered list of backend ids to pass to
 *   `eventTasks.reorder`, deduplicated and with no dropped/undefined ids.
 */
export function reconcileEventTaskOrder<TId extends string>(
  currentTasks: ReadonlyArray<OrderReconcileTask>,
  resolveId: (localId: string) => TId | undefined
): TId[] {
  const seen = new Set<TId>();
  const ordered: TId[] = [];
  for (const task of currentTasks) {
    const realId = resolveId(task.id);
    if (realId === undefined || seen.has(realId)) continue;
    seen.add(realId);
    ordered.push(realId);
  }
  return ordered;
}
