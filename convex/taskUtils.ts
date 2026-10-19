import type { TaskClassification } from '../lib/taskClassification';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { isActiveCommunityMember } from './communityMemberUtils';

// ─── Shared storage-deletion helper ──────────────────────────────────────────
//
// Scans EVERY task (except excludingTaskId) and EVERY event (except
// excludingEventId) for any reference to the given storageId before
// physically deleting the storage object.  The scan covers:
//
//   tasks.attachments[].storageId
//   tasks.subtasks[].image.storageId
//   tasks.subtasks[].attachment.storageId
//   events.attachments[].storageId
//
// If ANY remaining document references the ID the function returns without
// deleting — an orphaned storage object is always safer than destroying
// another document's file.
//
// Scaling note: this is O(T × subtasks_per_task + E × attachments_per_event)
// per physical deletion.  Deletion is a rare, user-initiated operation and
// community volumes at MVP are expected to remain well below thousands of
// documents, so the full scan is acceptable.  A storageId index on tasks
// would reduce this to O(1) lookups; that optimisation can be added later.
//
export async function safeDeleteStorageIfUnreferenced(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  exclude?: {
    taskId?: Id<'tasks'>;
    eventId?: Id<'events'>;
  }
): Promise<void> {
  const sid = storageId as string;

  // ── Events scan ────────────────────────────────────────────────────────────
  const allEvents = await ctx.db.query('events').collect();
  for (const event of allEvents) {
    if (
      exclude?.eventId &&
      (event._id as string) === (exclude.eventId as string)
    )
      continue;
    for (const att of event.attachments ?? []) {
      if ((att.storageId as string) === sid) return;
    }
  }

  // ── Tasks scan (attachments + subtask images/attachments) ──────────────────
  const allTasks = await ctx.db.query('tasks').collect();
  for (const task of allTasks) {
    if (exclude?.taskId && (task._id as string) === (exclude.taskId as string))
      continue;
    for (const att of task.attachments ?? []) {
      if ((att.storageId as string) === sid) return;
    }
    for (const st of task.subtasks ?? []) {
      if (st.image?.storageId && (st.image.storageId as string) === sid) return;
      if (
        st.attachment?.storageId &&
        (st.attachment.storageId as string) === sid
      )
        return;
    }
  }

  // Missing objects are an idempotent no-op. All other failures must abort
  // the mutation so removing the reference cannot falsely report cleanup.
  if (!(await ctx.db.system.get(storageId))) return;
  await ctx.storage.delete(storageId);
}

/**
 * Returns true if any explicit assignee was provided for a community task.
 *
 * A community task with no explicit assignee is treated as a "general community
 * reminder" — visible to all members and eligible for shared due-reminder
 * scheduling. One with any explicit assignee is treated as assigned to specific
 * people and is excluded from shared scheduling.
 *
 * Extracted from tasks.ts so that reminderScheduler.ts can share the predicate
 * without duplicating it.
 */
export function hasExplicitAssigneeForCommunityActivity(args: {
  assignedTo?: Id<'users'>;
  assignedToMemberId?: Id<'members'>;
  assignedToUserIds?: Id<'users'>[];
  assignedToMemberIds?: Id<'members'>[];
}): boolean {
  return (
    (args.assignedToUserIds ?? []).length > 0 ||
    (args.assignedToMemberIds ?? []).length > 0 ||
    args.assignedTo !== undefined ||
    args.assignedToMemberId !== undefined
  );
}

// ─── Write-time cross-document storage reference check ───────────────────────
//
// Returns true if the given storageId is currently referenced by ANY task or
// event document OTHER than the document identified by `exclude`.
//
// Call this at mutation write-time for every *newly introduced* storageId
// (i.e. a storageId the client submits that was not already on this exact
// document) to prevent a client from hijacking a file that belongs to another
// document.
//
// Same scan coverage as safeDeleteStorageIfUnreferenced — the two helpers share
// the authoritative list of storage-reference locations so they cannot drift:
//
//   tasks.attachments[].storageId
//   tasks.subtasks[].image.storageId
//   tasks.subtasks[].attachment.storageId
//   events.attachments[].storageId
//
export async function isStorageReferencedByOtherDocument(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  exclude?: {
    taskId?: Id<'tasks'>;
    eventId?: Id<'events'>;
  }
): Promise<boolean> {
  const sid = storageId as string;

  const allEvents = await ctx.db.query('events').collect();
  for (const event of allEvents) {
    if (
      exclude?.eventId &&
      (event._id as string) === (exclude.eventId as string)
    )
      continue;
    for (const att of event.attachments ?? []) {
      if ((att.storageId as string) === sid) return true;
    }
  }

  const allTasks = await ctx.db.query('tasks').collect();
  for (const task of allTasks) {
    if (exclude?.taskId && (task._id as string) === (exclude.taskId as string))
      continue;
    for (const att of task.attachments ?? []) {
      if ((att.storageId as string) === sid) return true;
    }
    for (const st of task.subtasks ?? []) {
      if (st.image?.storageId && (st.image.storageId as string) === sid)
        return true;
      if (
        st.attachment?.storageId &&
        (st.attachment.storageId as string) === sid
      )
        return true;
    }
  }

  return false;
}

// ─── Deleted/archived general-community-reminder guard ───────────────────────
//
// isGeneralCommunityReminder excludes tasks where deletedAt or archivedAt is
// set (by design — scheduling must not treat them as active). This means a
// deleted/archived general community reminder evaluates to false there and
// falls through to isUserParticipantInTask, whose creator check (line 539 of
// tasks.ts: `if (task.createdBy === userId) return true`) would grant the
// original creator access.
//
// This predicate catches that case: it matches tasks that WERE general
// community reminders but have been deleted or archived. Any read-access guard
// must check this BEFORE calling isGeneralCommunityReminder and return null
// immediately when true — for EVERYONE, including the original creator.
//
export function isDeletedOrArchivedGeneralCommunityReminder(task: {
  communityId?: Id<'communities'>;
  sourceType?: string;
  deletedAt?: number;
  archivedAt?: number;
  assignedTo?: Id<'users'>;
  assignedToMemberId?: Id<'members'>;
  assignedToUserIds?: Id<'users'>[];
  assignedToMemberIds?: Id<'members'>[];
}): boolean {
  return (
    task.communityId !== undefined &&
    task.sourceType === undefined &&
    !hasExplicitAssigneeForCommunityActivity(task) &&
    (task.deletedAt !== undefined || task.archivedAt !== undefined)
  );
}

/**
 * Returns true if a task document represents a general community reminder —
 * i.e. a community-wide task that is not assigned to any specific user and has
 * no event-source link.
 *
 * This is the single authoritative predicate used across tasks.ts,
 * reminderScheduler.ts, and query logic so that all paths agree on what
 * constitutes a general community reminder.
 */
export function isGeneralCommunityReminder(task: {
  communityId?: Id<'communities'>;
  sourceType?: string;
  deletedAt?: number;
  archivedAt?: number;
  assignedTo?: Id<'users'>;
  assignedToMemberId?: Id<'members'>;
  assignedToUserIds?: Id<'users'>[];
  assignedToMemberIds?: Id<'members'>[];
}): task is typeof task & { communityId: Id<'communities'> } {
  return (
    task.communityId !== undefined &&
    task.sourceType === undefined &&
    !hasExplicitAssigneeForCommunityActivity(task) &&
    task.deletedAt === undefined &&
    task.archivedAt === undefined
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical task/reminder classification — single source of truth used by
// every screen that renders a task/reminder type label (Home, Calendar,
// Community Main) so the classification can never drift between screens
// (see PART E of the community-reminder distribution fix).
// ─────────────────────────────────────────────────────────────────────────────

export function getTaskClassification(task: {
  communityId?: Id<'communities'>;
  sourceType?: string;
  deletedAt?: number;
  archivedAt?: number;
  assignedTo?: Id<'users'>;
  assignedToMemberId?: Id<'members'>;
  assignedToUserIds?: Id<'users'>[];
  assignedToMemberIds?: Id<'members'>[];
}): TaskClassification {
  return isGeneralCommunityReminder(task)
    ? 'community_reminder'
    : 'personal_task';
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer-eligibility predicate for general community reminders — PART F.
//
// A general community reminder is shared community content: visibility is
// derived from the VIEWER's current active membership in the reminder's
// community, never from who created it. This is the pure predicate the
// actual indexed ctx.db scan in tasks.listMyTasks delegates to, so the
// eligibility rule itself can be unit-tested without a live Convex test
// harness (none exists in this repo — see the extraction precedent in
// convex/events.ts `shouldIncludeCategory2Event` /
// tests/convex/eventsListByDateRangeCategory2.test.ts).
//
// Deliberately does NOT check past-due here — past-due filtering uses the
// SAME lib/taskDueStatus.ts helpers already used by the Community Reminders
// tab, applied client-side (never Date.now() inside a Convex query).
// ─────────────────────────────────────────────────────────────────────────────
export function shouldIncludeCommunityReminderForViewer(args: {
  task: {
    communityId?: Id<'communities'>;
    sourceType?: string;
    deletedAt?: number;
    archivedAt?: number;
    assignedTo?: Id<'users'>;
    assignedToMemberId?: Id<'members'>;
    assignedToUserIds?: Id<'users'>[];
    assignedToMemberIds?: Id<'members'>[];
  };
  /**
   * The viewer's own membership row in task.communityId, or null when they
   * never joined / it wasn't found. Only `status` is read (via
   * isActiveCommunityMember) — a minimal shape keeps this predicate
   * callable from pure unit tests without constructing a full Convex
   * document.
   */
  viewerMembership: Pick<Doc<'communityMembers'>, 'status'> | null;
  /** Whether the VIEWER (not the creator) has personally completed this reminder. */
  personallyCompletedByViewer: boolean;
}): boolean {
  if (!isGeneralCommunityReminder(args.task)) return false;
  if (args.personallyCompletedByViewer) return false;
  return isActiveCommunityMember(
    args.viewerMembership as Doc<'communityMembers'> | null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal-dismissal foundation — Community Reminder personal-dismissal
// backend cluster.
//
// A general Community Reminder is SHARED COMMUNITY CONTENT. Personal
// dismissal (`taskParticipantSettings.dismissedAt`) only ever hides it from
// the VIEWER's own personal surfaces (Home/Calendar) — it NEVER hides the
// reminder from Community Main or the Community Reminders tab, and it never
// affects any other member.
//
// Legacy compatibility: earlier Community Reminder work temporarily treated
// reminders as completable, so some users already have
// `taskParticipantSettings.completedAt` set for a general community
// reminder. That data is never migrated or deleted — on PERSONAL surfaces a
// legacy `completedAt` continues to behave exactly like a `dismissedAt`
// (prevents previously-completed reminders from reappearing), while the new
// dismissal mutation only ever writes `dismissedAt` going forward.
//
// isCommunityReminderPersonallyHidden is the single low-level predicate that
// captures this OR-rule. It deliberately returns false for any task that is
// not a general community reminder (ordinary personal/assigned/event task
// completion is a completely separate concept — see
// setPersonalCompleted/clearPersonalCompleted below, which this predicate
// never touches).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape read by isCommunityReminderPersonallyHidden — deliberately
 * narrower than the full taskParticipantSettings document so this predicate
 * stays callable from pure unit tests without constructing a full Convex row.
 */
export interface PersonalReminderHiddenState {
  dismissedAt?: number;
  completedAt?: number;
}

/**
 * True when the VIEWER has personally hidden this general community
 * reminder from their own personal surfaces (Home/Calendar) — via the new
 * `dismissedAt` field OR the legacy `completedAt` field.
 *
 * Always false for a task that is not a general community reminder — this
 * predicate must never be mistaken for, or substitute, ordinary
 * personal/assigned/event-task completion semantics.
 */
export function isCommunityReminderPersonallyHidden(
  task: {
    communityId?: Id<'communities'>;
    sourceType?: string;
    deletedAt?: number;
    archivedAt?: number;
    assignedTo?: Id<'users'>;
    assignedToMemberId?: Id<'members'>;
    assignedToUserIds?: Id<'users'>[];
    assignedToMemberIds?: Id<'members'>[];
  },
  settings: PersonalReminderHiddenState | null | undefined
): boolean {
  if (!isGeneralCommunityReminder(task)) return false;
  if (!settings) return false;
  return (
    settings.dismissedAt !== undefined || settings.completedAt !== undefined
  );
}

/**
 * Canonical eligibility predicate for PERSONAL surfaces (Home/Calendar):
 * visible only when the task is a general community reminder, the viewer is
 * an ACTIVE member of its community, AND the viewer has not personally
 * hidden it (dismissedAt OR legacy completedAt — see
 * isCommunityReminderPersonallyHidden).
 *
 * Named to express the PRODUCT surface concept (personal surface), not a
 * specific screen — Home and Calendar both delegate to this same predicate.
 */
export function shouldShowCommunityReminderOnPersonalSurface(args: {
  task: {
    communityId?: Id<'communities'>;
    sourceType?: string;
    deletedAt?: number;
    archivedAt?: number;
    assignedTo?: Id<'users'>;
    assignedToMemberId?: Id<'members'>;
    assignedToUserIds?: Id<'users'>[];
    assignedToMemberIds?: Id<'members'>[];
  };
  viewerMembership: Pick<Doc<'communityMembers'>, 'status'> | null;
  settings: PersonalReminderHiddenState | null | undefined;
}): boolean {
  if (!isGeneralCommunityReminder(args.task)) return false;
  if (isCommunityReminderPersonallyHidden(args.task, args.settings)) {
    return false;
  }
  return isActiveCommunityMember(
    args.viewerMembership as Doc<'communityMembers'> | null
  );
}

/**
 * True when a task MAY be classified into a "recently completed" community
 * bucket (e.g. listCompletedCommunityReminders) based on a viewer's
 * `taskParticipantSettings.completedAt`.
 *
 * A general community reminder is SHARED community content, never a
 * per-viewer completable task going forward — legacy `completedAt` on such
 * a task means only "personally hidden from my own Home/Calendar" (see
 * isCommunityReminderPersonallyHidden) and must NEVER be surfaced as "this
 * shared reminder was completed inside the community". This predicate is
 * therefore false for every general community reminder, regardless of
 * completedAt — see the "Legacy Completion: Community Visibility
 * Correction" fix.
 */
export function isEligibleForCompletedCommunityReminderBucket(task: {
  communityId?: Id<'communities'>;
  sourceType?: string;
  deletedAt?: number;
  archivedAt?: number;
  assignedTo?: Id<'users'>;
  assignedToMemberId?: Id<'members'>;
  assignedToUserIds?: Id<'users'>[];
  assignedToMemberIds?: Id<'members'>[];
}): boolean {
  return !isGeneralCommunityReminder(task);
}

/**
 * Canonical eligibility predicate for COMMUNITY surfaces (Community Main,
 * Community Reminders tab): visible whenever the task is a general
 * community reminder and the viewer is an ACTIVE member of its community —
 * deliberately does NOT accept any personal dismissal/completion state at
 * all, so it can never be called in a way that accidentally lets personal
 * state suppress shared content. The community remains the source of truth;
 * personal dismissal is per-user only and never affects other members.
 */
export function shouldShowCommunityReminderInCommunity(args: {
  task: {
    communityId?: Id<'communities'>;
    sourceType?: string;
    deletedAt?: number;
    archivedAt?: number;
    assignedTo?: Id<'users'>;
    assignedToMemberId?: Id<'members'>;
    assignedToUserIds?: Id<'users'>[];
    assignedToMemberIds?: Id<'members'>[];
  };
  viewerMembership: Pick<Doc<'communityMembers'>, 'status'> | null;
}): boolean {
  if (!isGeneralCommunityReminder(args.task)) return false;
  return isActiveCommunityMember(
    args.viewerMembership as Doc<'communityMembers'> | null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure range-inclusion rule for the date-bounded viewer-range Community
// Reminder query (convex/tasks.ts `listVisibleCommunityRemindersForRange` /
// `loadGeneralCommunityRemindersInRange`) — final architecture replacing the
// unbounded `listMyTasks` Step 4 scan.
//
// The ACTUAL row-reduction happens at the DB layer via two indexed range
// scans (`by_community_assigned_dueAt` / `by_community_assigned_dueDate`),
// which cannot be unit-tested without a live Convex harness (none exists in
// this repo — see the identical precedent noted at the top of
// tests/convex/communityReminderDistribution.test.ts). This predicate
// captures the exact inclusion RULE those two index scans jointly implement,
// so it is unit-testable, and is also applied as a cheap in-memory
// belt-and-braces filter on the (already tiny, already index-bounded)
// candidate set returned by the two scans — never a substitute for the
// index bounding itself.
//
// A reminder is "within range" when EITHER its exact `dueAt` timestamp OR
// its date-only `dueDate` timestamp falls within [from, to] (inclusive) —
// matching the exact same inclusive `.gte()/.lte()` semantics as the index
// range queries, so this helper can never silently disagree with them. A
// reminder with NEITHER field set (a real, currently-reachable "ללא תאריך"
// product state — see lib/taskDueStatus.ts's doc comment) is never "within
// range": there is no temporal anchor to place it on a date-driven surface.
// ─────────────────────────────────────────────────────────────────────────────
export function isGeneralCommunityReminderWithinRange(
  task: { dueAt?: number; dueDate?: number },
  from: number,
  to: number
): boolean {
  const dueAtInRange =
    task.dueAt !== undefined && task.dueAt >= from && task.dueAt <= to;
  const dueDateInRange =
    task.dueDate !== undefined && task.dueDate >= from && task.dueDate <= to;
  return dueAtInRange || dueDateInRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical "הוסף למשימות שלי" bundle shape helpers — pure, so the exact
// title format and subtask mapping used by
// tasks.addEventImportantItemsToMyTasks can be unit-tested without a
// Convex test harness. This is the ONLY conversion mechanism: ONE parent
// task per event, with each important item as a subtask — never one task
// per item.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical bundle task title — matches the EXACT existing format
 * tasks.addEventImportantItemsToMyTasks already produces today
 * ("חשוב לזכור - {event title}"). Deliberately preserved as-is: PART C of
 * the manual-QA follow-up requires reusing this exact mechanism, not
 * introducing a new title format.
 */
export function buildImportantItemsBundleTaskTitle(eventTitle: string): string {
  return `חשוב לזכור - ${eventTitle}`;
}

export interface ImportantItemInput {
  id: string;
  title: string;
}

export interface ImportantItemBundleSubtask {
  id: string;
  title: string;
  completed: boolean;
}

/** Maps an event's important items to the bundle task's subtasks — always uncompleted at creation. */
export function buildImportantItemsBundleSubtasks(
  importantItems: ImportantItemInput[]
): ImportantItemBundleSubtask[] {
  return importantItems.map((item) => ({
    id: item.id,
    title: item.title,
    completed: false,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal completion helpers for general community reminders.
//
// These helpers read/write the completedAt field on taskParticipantSettings
// rows identified by the by_task_user index. They NEVER touch tasks.completed
// or tasks.completedAt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the authenticated user's personal completion state for a task.
 * Missing settings row or absent completedAt → { completed: false }.
 * Does NOT fall back to tasks.completed for general community reminders.
 */
export async function getPersonalCompletion(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<'tasks'>,
  userId: Id<'users'>
): Promise<{ completed: boolean; completedAt?: number }> {
  const row = await ctx.db
    .query('taskParticipantSettings')
    .withIndex('by_task_user', (q) =>
      q.eq('taskId', taskId).eq('userId', userId)
    )
    .unique();

  if (!row || row.completedAt === undefined) {
    return { completed: false };
  }
  return { completed: true, completedAt: row.completedAt };
}

/**
 * Marks a user's personal completion on a task.
 * Upserts the settings row — patches existing or inserts minimal new row.
 * Preserves all unrelated fields (reminders, reminderType, leftAt, etc.).
 * Returns the timestamp written.
 */
export async function setPersonalCompleted(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
  userId: Id<'users'>
): Promise<number> {
  const now = Date.now();
  const row = await ctx.db
    .query('taskParticipantSettings')
    .withIndex('by_task_user', (q) =>
      q.eq('taskId', taskId).eq('userId', userId)
    )
    .unique();

  if (row) {
    await ctx.db.patch(row._id, { completedAt: now });
  } else {
    await ctx.db.insert('taskParticipantSettings', {
      taskId,
      userId,
      completedAt: now,
    });
  }
  return now;
}

/**
 * Clears a user's personal completion on a task.
 * Only patches completedAt to undefined — never deletes the row
 * (it may contain personal reminder settings or leftAt).
 */
export async function clearPersonalCompleted(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
  userId: Id<'users'>
): Promise<void> {
  const row = await ctx.db
    .query('taskParticipantSettings')
    .withIndex('by_task_user', (q) =>
      q.eq('taskId', taskId).eq('userId', userId)
    )
    .unique();

  if (row && row.completedAt !== undefined) {
    await ctx.db.patch(row._id, { completedAt: undefined });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal-dismissal read/write helpers for general community reminders.
//
// Mirror the getPersonalCompletion / setPersonalCompleted shape above, but
// operate exclusively on the NEW `dismissedAt` field. These NEVER read or
// write `completedAt` — legacy completedAt compatibility is handled purely
// by isCommunityReminderPersonallyHidden at read time, never by writing it
// here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the authenticated user's personal hidden-state row for a task
 * (both `dismissedAt` and legacy `completedAt`, for callers that need to
 * evaluate isCommunityReminderPersonallyHidden). Missing row → {}.
 */
export async function getPersonalReminderHiddenState(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<'tasks'>,
  userId: Id<'users'>
): Promise<PersonalReminderHiddenState> {
  const row = await ctx.db
    .query('taskParticipantSettings')
    .withIndex('by_task_user', (q) =>
      q.eq('taskId', taskId).eq('userId', userId)
    )
    .unique();

  if (!row) return {};
  return { dismissedAt: row.dismissedAt, completedAt: row.completedAt };
}

/**
 * Marks a user's personal dismissal (hide-from-my-personal-space) on a
 * task. Upserts the settings row — patches existing or inserts minimal new
 * row — using the same by_task_user identity as setPersonalCompleted, so a
 * viewer/task pair can never end up with two settings rows.
 *
 * Idempotency: if the row already has `dismissedAt` set, the ORIGINAL
 * timestamp is preserved and no write is performed — the smallest possible
 * idempotent guard, consistent with the fact that dismissal is a one-way
 * personal action (there is no "un-dismiss" mutation in this backend-only
 * task) with no product need to track the *latest* dismissal time.
 *
 * Never writes `completedAt` — dismissal and legacy completion are
 * independent fields; only isCommunityReminderPersonallyHidden combines them
 * for read-time visibility.
 */
export async function setPersonalDismissed(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
  userId: Id<'users'>
): Promise<number> {
  const row = await ctx.db
    .query('taskParticipantSettings')
    .withIndex('by_task_user', (q) =>
      q.eq('taskId', taskId).eq('userId', userId)
    )
    .unique();

  if (row) {
    if (row.dismissedAt !== undefined) {
      // Already dismissed — idempotent no-op, preserve the original timestamp.
      return row.dismissedAt;
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { dismissedAt: now });
    return now;
  }

  const now = Date.now();
  await ctx.db.insert('taskParticipantSettings', {
    taskId,
    userId,
    dismissedAt: now,
  });
  return now;
}
