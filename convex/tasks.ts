import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { insertCommunityActivity } from './communityActivities';
import { isActiveCommunityMember } from './communityMemberUtils';
import {
  cancelPendingJobsForTaskAndUserHelper,
  cancelPendingJobsForTaskHelper,
} from './reminderScheduler';
import {
  buildImportantItemsBundleSubtasks,
  buildImportantItemsBundleTaskTitle,
  clearPersonalCompleted,
  getPersonalCompletion,
  getTaskClassification,
  hasExplicitAssigneeForCommunityActivity,
  isDeletedOrArchivedGeneralCommunityReminder,
  isEligibleForCompletedCommunityReminderBucket,
  isGeneralCommunityReminder,
  isGeneralCommunityReminderWithinRange,
  isStorageReferencedByOtherDocument,
  safeDeleteStorageIfUnreferenced,
  setPersonalCompleted,
  setPersonalDismissed,
} from './taskUtils';
import { createUserNotifications } from './userNotifications';

const taskReminderTypeValidator = v.union(
  v.literal('none'),
  v.literal('morning'),
  v.literal('evening'),
  v.literal('at_time'),
  v.literal('hour_before'),
  v.literal('custom')
);

const taskPersistedReminderTypeValidator = v.union(
  v.literal('morning'),
  v.literal('evening'),
  v.literal('at_time'),
  v.literal('hour_before'),
  v.literal('custom')
);

const taskReminderUnitValidator = v.union(
  v.literal('minutes'),
  v.literal('hours'),
  v.literal('days')
);

const taskReminderValidator = v.object({
  id: v.string(),
  type: taskPersistedReminderTypeValidator,
  customAmount: v.optional(v.number()),
  customUnit: v.optional(taskReminderUnitValidator),
  customReminderAt: v.optional(v.number()),
  label: v.optional(v.string()),
});

const taskRecurrenceTypeValidator = v.union(
  v.literal('none'),
  v.literal('daily'),
  v.literal('weekly'),
  v.literal('specific_days')
);

const MAX_TASK_ATTACHMENTS = 4;

/** Client sends same shape as events.create attachments (no uploadedBy/uploadedAt). */
const taskAttachmentArgValidator = v.object({
  storageId: v.id('_storage'),
  originalName: v.string(),
  displayName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
});

const taskSubtaskImageValidator = v.object({
  storageId: v.id('_storage'),
  mimeType: v.string(),
  sizeBytes: v.number(),
  createdAt: v.number(),
});

const taskSubtaskAttachmentValidator = v.object({
  id: v.string(),
  type: v.union(v.literal('image'), v.literal('file')),
  storageId: v.id('_storage'),
  mimeType: v.string(),
  sizeBytes: v.number(),
  createdAt: v.number(),
  originalName: v.optional(v.string()),
  displayName: v.optional(v.string()),
});

const taskSubtaskValidator = v.object({
  id: v.string(),
  title: v.string(),
  completed: v.boolean(),
  /** @deprecated prefer attachment */
  image: v.optional(taskSubtaskImageValidator),
  attachment: v.optional(taskSubtaskAttachmentValidator),
});

const clearableTaskFieldValidator = v.union(
  v.literal('description'),
  v.literal('dueDate'),
  v.literal('hasTime'),
  v.literal('dueAt'),
  v.literal('reminderType'),
  v.literal('customReminderAt'),
  v.literal('recurrenceType'),
  v.literal('selectedWeekdays'),
  v.literal('subtasks'),
  v.literal('allowParticipantEditing'),
  v.literal('assignedTo'),
  v.literal('assignedToMemberId'),
  v.literal('assignedToUserIds'),
  v.literal('assignedToMemberIds'),
  v.literal('reminders'),
  v.literal('attachments')
);

const editableTaskCategories = new Set([
  'personal',
  'shopping',
  'family',
  'work',
]);

function validateTaskCategory(category: string | undefined): void {
  if (category !== undefined && !editableTaskCategories.has(category)) {
    throw new Error('קטגוריית משימה לא תקינה');
  }
}

function validateTaskSchedule(args: {
  dueDate?: number;
  hasTime?: boolean;
  dueAt?: number;
  recurrenceType?: 'none' | 'daily' | 'weekly' | 'specific_days';
  customReminderAt?: number;
  reminders?: {
    customReminderAt?: number;
  }[];
}): void {
  if (args.recurrenceType && args.recurrenceType !== 'none' && !args.dueDate) {
    throw new Error('אי אפשר להגדיר חזרה ללא תאריך');
  }
  if (args.dueAt !== undefined && args.hasTime !== true) {
    throw new Error('שעה למשימה דורשת סימון שעה');
  }
  const reminderBaseTimestamp =
    args.dueAt ??
    (args.dueDate !== undefined
      ? args.dueDate + 9 * 60 * 60 * 1000
      : undefined);
  if (args.customReminderAt !== undefined) {
    const now = Date.now();
    if (args.customReminderAt < now) {
      throw new Error('התזכורת לא יכולה להיות בעבר');
    }
    if (
      reminderBaseTimestamp !== undefined &&
      args.customReminderAt > reminderBaseTimestamp
    ) {
      throw new Error('התזכורת חייבת להיות לפני מועד המשימה');
    }
  }
  for (const reminder of args.reminders ?? []) {
    if (reminder.customReminderAt === undefined) continue;
    const now = Date.now();
    if (reminder.customReminderAt < now) {
      throw new Error('התזכורת לא יכולה להיות בעבר');
    }
    if (
      reminderBaseTimestamp !== undefined &&
      reminder.customReminderAt > reminderBaseTimestamp
    ) {
      throw new Error('התזכורת חייבת להיות לפני מועד המשימה');
    }
  }
}

type TaskReminderInput = {
  id: string;
  type: 'morning' | 'evening' | 'at_time' | 'hour_before' | 'custom';
  customAmount?: number;
  customUnit?: 'minutes' | 'hours' | 'days';
  customReminderAt?: number;
  label?: string;
};

type TaskScheduleInput = {
  dueDate?: number;
  hasTime?: boolean;
  dueAt?: number;
};

function reminderBaseTimestamp(
  schedule: TaskScheduleInput
): number | undefined {
  if (schedule.dueAt !== undefined) return schedule.dueAt;
  if (schedule.dueDate !== undefined) {
    return schedule.dueDate + 9 * 60 * 60 * 1000;
  }
  return undefined;
}

function reminderOffsetMinutes(
  reminder: TaskReminderInput
): number | undefined {
  if (
    reminder.customAmount === undefined ||
    reminder.customUnit === undefined
  ) {
    return undefined;
  }
  if (reminder.customUnit === 'hours') return reminder.customAmount * 60;
  if (reminder.customUnit === 'days') return reminder.customAmount * 1440;
  return reminder.customAmount;
}

function resolveReminderTimestamp(
  reminder: TaskReminderInput,
  schedule: TaskScheduleInput
): number | undefined {
  if (reminder.type === 'morning') {
    return schedule.dueDate !== undefined
      ? schedule.dueDate + 9 * 60 * 60 * 1000
      : undefined;
  }
  if (reminder.type === 'evening') {
    return schedule.dueDate !== undefined
      ? schedule.dueDate + 18 * 60 * 60 * 1000
      : undefined;
  }
  if (reminder.type === 'at_time') {
    return schedule.hasTime === true ? schedule.dueAt : undefined;
  }
  if (reminder.type === 'hour_before') {
    return schedule.hasTime === true && schedule.dueAt !== undefined
      ? schedule.dueAt - 60 * 60 * 1000
      : undefined;
  }

  const offsetMinutes = reminderOffsetMinutes(reminder);
  const baseTimestamp = reminderBaseTimestamp(schedule);
  if (offsetMinutes !== undefined && baseTimestamp !== undefined) {
    return baseTimestamp - offsetMinutes * 60 * 1000;
  }
  return reminder.customReminderAt;
}

function normalizeRemindersForSchedule(
  reminders: TaskReminderInput[] | undefined,
  schedule: TaskScheduleInput,
  now: number
): TaskReminderInput[] | undefined {
  if (schedule.dueDate === undefined) return undefined;
  const cleaned = (reminders ?? []).flatMap((reminder) => {
    const reminderAt = resolveReminderTimestamp(reminder, schedule);
    if (reminderAt === undefined || reminderAt < now) return [];
    if (reminder.type !== 'custom') return [reminder];
    return [{ ...reminder, customReminderAt: reminderAt }];
  });
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeCustomReminderAtForSchedule(
  customReminderAt: number | undefined,
  schedule: TaskScheduleInput,
  now: number
): number | undefined {
  if (customReminderAt === undefined || customReminderAt < now) {
    return undefined;
  }
  const baseTimestamp = reminderBaseTimestamp(schedule);
  if (baseTimestamp !== undefined && customReminderAt > baseTimestamp) {
    return undefined;
  }
  return customReminderAt;
}

function storageIdsFromTaskAttachments(
  attachments: { storageId: Id<'_storage'> }[] | null | undefined
): Set<string> {
  const s = new Set<string>();
  for (const a of attachments ?? []) {
    s.add(a.storageId as string);
  }
  return s;
}

function storageIdsFromSubtaskImages(
  subtasks:
    | {
        image?: { storageId: Id<'_storage'> } | undefined;
        attachment?: { storageId: Id<'_storage'> } | undefined;
      }[]
    | null
    | undefined
): Set<string> {
  const s = new Set<string>();
  for (const st of subtasks ?? []) {
    if (st.image?.storageId) {
      s.add(st.image.storageId as string);
    }
    if (st.attachment?.storageId) {
      s.add(st.attachment.storageId as string);
    }
  }
  return s;
}

function sanitizeSubtasks(
  subtasks:
    | {
        id: string;
        title: string;
        completed: boolean;
        image?: {
          storageId: Id<'_storage'>;
          mimeType: string;
          sizeBytes: number;
          createdAt: number;
        };
        attachment?: {
          id: string;
          type: 'image' | 'file';
          storageId: Id<'_storage'>;
          mimeType: string;
          sizeBytes: number;
          createdAt: number;
          originalName?: string;
          displayName?: string;
        };
      }[]
    | undefined
):
  | {
      id: string;
      title: string;
      completed: boolean;
      image?: {
        storageId: Id<'_storage'>;
        mimeType: string;
        sizeBytes: number;
        createdAt: number;
      };
      attachment?: {
        id: string;
        type: 'image' | 'file';
        storageId: Id<'_storage'>;
        mimeType: string;
        sizeBytes: number;
        createdAt: number;
        originalName?: string;
        displayName?: string;
      };
    }[]
  | undefined {
  if (!subtasks) return undefined;
  const cleaned = subtasks
    .map((subtask) => {
      const row: {
        id: string;
        title: string;
        completed: boolean;
        image?: {
          storageId: Id<'_storage'>;
          mimeType: string;
          sizeBytes: number;
          createdAt: number;
        };
        attachment?: {
          id: string;
          type: 'image' | 'file';
          storageId: Id<'_storage'>;
          mimeType: string;
          sizeBytes: number;
          createdAt: number;
          originalName?: string;
          displayName?: string;
        };
      } = {
        id: subtask.id,
        title: subtask.title.trim(),
        completed: subtask.completed,
      };
      if (subtask.attachment) {
        row.attachment = subtask.attachment;
      } else if (subtask.image) {
        row.image = subtask.image;
      }
      return row;
    })
    .filter((subtask) => subtask.title.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function stampTaskAttachments(
  attachments: {
    storageId: Id<'_storage'>;
    originalName: string;
    displayName: string;
    mimeType: string;
    sizeBytes: number;
  }[],
  userId: Id<'users'>,
  existing: Doc<'tasks'> | null,
  now: number
): {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  uploadedBy: Id<'users'>;
}[] {
  const existingByStorageId = new Map(
    (existing?.attachments ?? []).map((a) => [a.storageId as string, a])
  );
  return attachments.map((a) => {
    const prev = existingByStorageId.get(a.storageId as string);
    return {
      ...a,
      uploadedBy: prev?.uploadedBy ?? userId,
      uploadedAt: prev?.uploadedAt ?? now,
    };
  });
}

async function getCommunityMembership(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<'communities'>,
  userId: Id<'users'>
) {
  return await ctx.db
    .query('communityMembers')
    .withIndex('by_community_user', (q) =>
      q.eq('communityId', communityId).eq('userId', userId)
    )
    .unique();
}

async function resolveCurrentEventImportantItemTask(
  ctx: QueryCtx,
  task: Doc<'tasks'>
): Promise<Doc<'tasks'> | null> {
  if (task.sourceType !== 'community_event_important_item') {
    return task;
  }

  if (!task.sourceEventId) {
    return null;
  }

  const event = await ctx.db.get(task.sourceEventId);
  if (!event) {
    return null;
  }

  const currentImportantItemIds = new Set(
    (event.importantItems ?? []).map((item) => item.id)
  );

  const isCurrentItem = [task.sourceImportantItemId, task._id as string].some(
    (id) => id !== undefined && currentImportantItemIds.has(id)
  );

  if (!isCurrentItem) {
    return null;
  }

  return {
    ...task,
    dueDate: event.startTime,
  };
}

function getImportantItemDueDate(eventStart: number): number | undefined {
  if (eventStart < Date.now()) {
    return undefined;
  }
  return eventStart;
}

function isPersonalTaskForUser(
  task: Doc<'tasks'>,
  userId: Doc<'users'>['_id']
): boolean {
  if (task.createdBy === userId) {
    return true;
  }

  if (task.assignedTo === userId) {
    return true;
  }

  if ((task.assignedToUserIds ?? []).some((id) => id === userId)) {
    return true;
  }

  return (
    task.assignedTo === undefined &&
    task.communityId === undefined &&
    task.sourceType === undefined
  );
}

/**
 * A task is "personally deletable" (soft-delete allowed) only if:
 * - The current user created it (createdBy === userId), AND
 * - It is NOT a community reminder (communityId set without sourceType).
 *
 * Important items copied from an event (sourceType === 'community_event_important_item')
 * ARE deletable even when communityId is set — they are personal copies owned by the user.
 *
 * Community/event-assigned tasks from the eventTasks table are handled separately
 * and are not represented by this function.
 */
function isPersonallyDeletableTask(
  task: Doc<'tasks'>,
  userId: Id<'users'>
): boolean {
  if (task.createdBy !== userId) return false;
  // Community reminders (communityId set, no sourceType) are community-shared, not personal
  if (task.communityId !== undefined && task.sourceType === undefined)
    return false;
  return true;
}

/**
 * Returns true if userId is the creator or an active assignee of the task.
 * Used to gate participant-level read/write access.
 */
function isUserParticipantInTask(
  task: Doc<'tasks'>,
  userId: Id<'users'>
): boolean {
  if (task.createdBy === userId) return true;
  if (task.assignedTo === userId) return true;
  return (task.assignedToUserIds ?? []).some((id) => id === userId);
}

/** When no assignee was chosen in the UI, persist creator as assignee (no orphan tasks). */
function normalizeAssigneesForWrite(
  fallbackUserId: Id<'users'>,
  input: {
    assignedTo?: Id<'users'>;
    assignedToMemberId?: Id<'members'>;
    assignedToUserIds?: Id<'users'>[];
    assignedToMemberIds?: Id<'members'>[];
  }
): {
  assignedTo: Id<'users'> | undefined;
  assignedToMemberId: Id<'members'> | undefined;
  assignedToUserIds: Id<'users'>[];
  assignedToMemberIds: Id<'members'>[];
} {
  const userIds = Array.from(new Set(input.assignedToUserIds ?? []));
  const memberIds = Array.from(new Set(input.assignedToMemberIds ?? []));
  let assignedTo = input.assignedTo;
  let assignedToMemberId = input.assignedToMemberId;

  const empty =
    userIds.length === 0 &&
    memberIds.length === 0 &&
    assignedTo === undefined &&
    assignedToMemberId === undefined;

  if (empty) {
    return {
      assignedTo: fallbackUserId,
      assignedToMemberId: undefined,
      assignedToUserIds: [fallbackUserId],
      assignedToMemberIds: [],
    };
  }

  if (userIds.length > 0 && assignedTo === undefined) {
    assignedTo = userIds[0];
  }
  if (memberIds.length > 0 && assignedToMemberId === undefined) {
    assignedToMemberId = memberIds[0];
  }

  return {
    assignedTo,
    assignedToMemberId,
    assignedToUserIds: userIds,
    assignedToMemberIds: memberIds,
  };
}

// hadExplicitAssigneeForCommunityActivity was extracted to taskUtils.ts as
// hasExplicitAssigneeForCommunityActivity so reminderScheduler.ts can share it.

// ─────────────────────────────────────────────────────────────────────────────
// scheduleGeneralReminderJobsForRecipients
//
// Low-level scheduling helper — enqueues one scheduleUserReminder call per
// (recipientUserId × future reminder). Past times are silently skipped.
// The caller is responsible for providing the already-filtered recipient list.
// ─────────────────────────────────────────────────────────────────────────────

async function scheduleGeneralReminderJobsForRecipients(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
  _communityId: Id<'communities'>,
  reminders: TaskReminderInput[] | undefined,
  schedule: TaskScheduleInput,
  recipientUserIds: Id<'users'>[]
): Promise<void> {
  if (!reminders || reminders.length === 0) return;
  if (recipientUserIds.length === 0) return;

  const now = Date.now();
  for (const reminder of reminders) {
    const scheduledFor = resolveReminderTimestamp(reminder, schedule);
    if (scheduledFor === undefined || scheduledFor <= now) continue;

    for (const userId of recipientUserIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.reminderScheduler.scheduleUserReminder,
        {
          taskId,
          userId,
          reminderKey: reminder.id,
          scheduledFor,
        }
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduleGeneralReminderJobsForTask
//
// High-level scheduling helper — queries current active community members
// (regardless of mute state — mute is checked only at fire time) and delegates
// to scheduleGeneralReminderJobsForRecipients.
//
// When options.excludePersonallyCompleted is true (used on shared reschedule),
// members who have already personally completed the reminder are excluded so
// they do not receive new scheduled rows after a manager changes the due date.
// Uses a single by_task bulk read to build the completed-user set instead of
// one by_task_user lookup per active member.
//
// MVP limitation: members who join after the reminder is created receive no
// scheduling row for existing reminders. Backfill on join is not in scope.
// ─────────────────────────────────────────────────────────────────────────────

async function scheduleGeneralReminderJobsForTask(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
  communityId: Id<'communities'>,
  reminders: TaskReminderInput[] | undefined,
  schedule: TaskScheduleInput,
  options?: { excludePersonallyCompleted?: boolean }
): Promise<void> {
  if (!reminders || reminders.length === 0) return;

  const allMembers = await ctx.db
    .query('communityMembers')
    .withIndex('by_community', (q) => q.eq('communityId', communityId))
    .collect();

  let recipientUserIds = allMembers
    .filter((m) => isActiveCommunityMember(m))
    .map((m) => m.userId);

  if (recipientUserIds.length === 0) return;

  if (options?.excludePersonallyCompleted) {
    // Build the completed-user set with a single by_task query rather than
    // one by_task_user lookup per active member. Former/removed members with
    // a completedAt row are included in this set, ensuring we never
    // re-schedule a user who completed before leaving the community.
    const allSettings = await ctx.db
      .query('taskParticipantSettings')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .collect();
    const completedUserIds = new Set(
      allSettings
        .filter((s) => s.completedAt !== undefined)
        .map((s) => s.userId as string)
    );
    recipientUserIds = recipientUserIds.filter(
      (uid) => !completedUserIds.has(uid as string)
    );
  }

  await scheduleGeneralReminderJobsForRecipients(
    ctx,
    taskId,
    communityId,
    reminders,
    schedule,
    recipientUserIds
  );
}

// ─────────────────────────────────────────────────────────────
// שליפת תזכורות שהושלמו לאחרונה לקהילה (עד 30 יום)
//
// LEGACY COMPLETION: COMMUNITY VISIBILITY CORRECTION — a general
// community reminder is SHARED community content, never a completable
// task. Legacy taskParticipantSettings.completedAt (written before
// per-user dismissal existed) means ONLY "personally hidden from my own
// Home/Calendar" (see isCommunityReminderPersonallyHidden in
// taskUtils.ts) — it must NEVER be surfaced as "this shared reminder was
// completed inside the community". General community reminders are
// therefore explicitly EXCLUDED from this "completed" bucket, regardless
// of viewer completedAt.
//
// This query is currently unused by any production UI caller — kept (not
// deleted, per the correction's scope) in case a genuinely completable,
// non-general community task type ever needs a "recently completed"
// bucket via taskParticipantSettings.completedAt again. Today that never
// happens in practice: by convention (see schema.ts), only general
// community reminders ever populate taskParticipantSettings.completedAt,
// so this query now always returns [].
// ─────────────────────────────────────────────────────────────
export const listCompletedCommunityReminders = query({
  args: {
    communityId: v.id('communities'),
    since: v.number(),
  },
  handler: async (ctx, { communityId, since }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Load all personal settings for this user (by_user index).
    const allSettings = await ctx.db
      .query('taskParticipantSettings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    // Keep only rows with a completedAt >= since.
    type SettingWithCompletion = (typeof allSettings)[number] & {
      completedAt: number;
    };
    const recentlyCompleted = allSettings.filter(
      (s): s is SettingWithCompletion =>
        s.completedAt !== undefined && s.completedAt >= since
    );

    if (recentlyCompleted.length === 0) return [];

    // Load the tasks, validate community membership and general-reminder category.
    const results = await Promise.all(
      recentlyCompleted.map(async (s) => {
        const task = await ctx.db.get(s.taskId);
        if (!task) return null;
        if (task.communityId !== communityId) return null;
        // General community reminders are never classified as "completed
        // community reminders" — see the correction note above.
        if (!isEligibleForCompletedCommunityReminderBucket(task)) return null;
        // Overlay personal completion timestamps.
        return {
          ...task,
          completed: true as const,
          completedAt: s.completedAt,
        };
      })
    );

    return results
      .filter(<T>(t: T | null): t is T => t !== null)
      .sort((a, b) => b.completedAt - a.completedAt);
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת תזכורות קהילה עם cursor pagination (לביצועים)
//
// LEGACY COMPLETION: COMMUNITY VISIBILITY CORRECTION — this is the
// Community Reminders TAB source query. A general community reminder is
// SHARED community content, never a per-viewer completable task: the
// community remains the source of truth for what was published, so this
// query returns EVERY (non-deleted/archived, unassigned) general
// community reminder in the community, regardless of the viewer's own
// `taskParticipantSettings` row. Neither the new `dismissedAt` field NOR
// legacy `completedAt` may exclude, move, or otherwise partition a general
// reminder here — those fields affect ONLY the viewer's PERSONAL surfaces
// (Home/Calendar — see listVisibleCommunityRemindersForRange /
// isCommunityReminderPersonallyHidden in taskUtils.ts), never the shared
// Community Reminders source.
// ─────────────────────────────────────────────────────────────
export const listCommunityRemindersPaged = query({
  args: {
    communityId: v.id('communities'),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, cursor, numItems }) => {
    const result = await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .filter((q) => q.eq(q.field('assignedTo'), undefined))
      .paginate({ cursor, numItems: numItems ?? 20 });

    const resolvedPage = await Promise.all(
      result.page.map(async (task) => {
        const resolved = await resolveCurrentEventImportantItemTask(ctx, task);
        if (!resolved) return null;

        // "מהקהילה" must contain ONLY true standalone general community
        // reminders. Event-derived task rows (the legacy per-item sync rows
        // created by syncCommunityEventImportantItemTasks with
        // sourceType === 'community_event_important_item', or any task
        // carrying an explicit participant assignment) already surface
        // as their own grouped card under "מאירועים"
        // (listCommunityEventReminderGroupsPaged) and must never be
        // duplicated here.
        //
        // NOTE: re-bound through an explicitly-typed `Doc<'tasks'>` local
        // (rather than returning `resolved` directly) so TypeScript does
        // not carry the `isGeneralCommunityReminder` type-guard's narrowed
        // `communityId` type into the filter predicate below.
        if (!isGeneralCommunityReminder(resolved)) return null;
        const general: Doc<'tasks'> = resolved;

        // Shared community content — never filtered by the viewer's own
        // dismissedAt/completedAt (see correction note above).
        return general;
      })
    );

    return {
      ...result,
      page: resolvedPage.filter((task): task is Doc<'tasks'> => task !== null),
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימות פתוחות לפי קהילה
//
// LEGACY COMPLETION: COMMUNITY VISIBILITY CORRECTION — same rule as
// listCommunityRemindersPaged above: a general community reminder is
// shared community content and is never filtered by the viewer's own
// dismissedAt/completedAt here. Other (non-general) community task types
// keep their existing shared tasks.completed filtering, unchanged.
// ─────────────────────────────────────────────────────────────
export const listByCommunity = query({
  args: { communityId: v.id('communities') },
  handler: async (ctx, { communityId }) => {
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', communityId))
      .filter((q) => q.eq(q.field('assignedTo'), undefined))
      .order('asc')
      .collect();

    const resolvedRows = await Promise.all(
      rows.map(async (task) => {
        const resolved = await resolveCurrentEventImportantItemTask(ctx, task);
        if (!resolved) return null;

        // Re-bound through an explicitly-typed `Doc<'tasks'>` local (same
        // reasoning as listCommunityRemindersPaged above) so the
        // type-guard's narrowed `communityId` type does not leak into the
        // filter predicate below.
        if (isGeneralCommunityReminder(resolved)) {
          const general: Doc<'tasks'> = resolved;
          return general;
        }

        if (resolved.completed) return null;
        return resolved;
      })
    );

    return resolvedRows.filter((task): task is Doc<'tasks'> => task !== null);
  },
});

export const listEventImportantItems = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const event = await ctx.db.get(eventId);
    if (!event) return [];
    if (!event.communityId) {
      return (event.importantItems ?? []).map((item) => ({
        id: item.id,
        title: item.title,
      }));
    }

    const communityId = event.communityId;
    const membership = await ctx.db
      .query('communityMembers')
      .withIndex('by_community_user', (q) =>
        q.eq('communityId', communityId).eq('userId', userId)
      )
      .unique();
    if (!isActiveCommunityMember(membership)) return [];

    const rows = (
      await ctx.db
        .query('tasks')
        .withIndex('by_community', (q) => q.eq('communityId', communityId))
        .collect()
    )
      .filter(
        (task) =>
          task.sourceType === 'community_event_important_item' &&
          task.sourceEventId === eventId &&
          task.assignedTo === undefined
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    if (rows.length === 0) {
      return (event.importantItems ?? []).map((item) => ({
        id: item.id,
        title: item.title,
      }));
    }

    return rows.map((task) => ({
      id: task._id as string,
      title: task.title,
    }));
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת כל המשימות שהמשתמש מעורב בהן (ללא סינון לפי space)
// מחזיר:
//   1. משימות שנוצרו על ידי המשתמש (by_creator)
//   2. משימות שהוקצו לו כ-assignedTo הראשי (by_assigned)
//   3. משימות שנוצרו על ידי חברי ה-space שלו שבהן הוא
//      מופיע ב-assignedToUserIds (assignee משני)
//
// PERSONAL/ASSIGNED TASKS ONLY — a general community reminder (communityId
// set, no assignee) is shared community content, never private task data.
// Its viewer-facing distribution is the dedicated, date-bounded
// `listVisibleCommunityRemindersForRange` query below, never this one. This
// query previously (uncommitted) grew a 4th step here that resolved the
// viewer's active community memberships and scanned every general reminder
// in each of those communities regardless of date — bounded by
// "reminder shape" via `by_community_assigned`, but NOT by date, so DB
// reads still grew with total historical community-reminder volume on every
// long-lived Home/Calendar subscription. That step (and the
// `by_community_assigned` index it used) has been removed — see
// `listVisibleCommunityRemindersForRange`'s own doc comment for the
// replacement architecture.
//
// CREATOR-OVERLAP CORRECTION: a general community reminder used to be able
// to slip back into this query's result when the viewer happened to be its
// `createdBy` (step 2 above), bypassing `dismissCommunityReminderForMe`'s
// personal-dismissal state entirely (this query never reads
// `taskParticipantSettings.dismissedAt`). The final `.filter` below removes
// every general community reminder from this query's output unconditionally
// — regardless of which step matched it — so the reminder's creator gets
// IDENTICAL personal-dismissal behavior to any other member. Every
// Home/Calendar caller still merges this query's result with
// `listVisibleCommunityRemindersForRange` (the sole, dismissal-aware source
// of general community reminders on personal surfaces), so this exclusion
// never removes a reminder from the product surface — only the unfiltered
// duplicate that could bypass dismissal.
// ─────────────────────────────────────────────────────────────
export const listMyTasks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const taskMap = new Map<string, Doc<'tasks'>>();

    const addTask = (task: Doc<'tasks'>): void => {
      const key = task._id as string;
      if (!taskMap.has(key)) taskMap.set(key, task);
    };

    // ── 1. Tasks where current user is primary assignee ────────────────────
    const assignedTasks = await ctx.db
      .query('tasks')
      .withIndex('by_assigned', (q) => q.eq('assignedTo', userId))
      .filter((q) => q.eq(q.field('deletedAt'), undefined))
      .collect();
    for (const task of assignedTasks) addTask(task);

    // ── 2. Tasks created by current user ───────────────────────────────────
    const createdTasks = await ctx.db
      .query('tasks')
      .withIndex('by_creator', (q) => q.eq('createdBy', userId))
      .filter((q) => q.eq(q.field('deletedAt'), undefined))
      .collect();
    for (const task of createdTasks) addTask(task);

    // ── 3. Tasks created by space co-members where user is secondary assignee
    // (handles the case where assignedToUserIds includes userId but
    //  assignedTo points to a different primary assignee)
    const memberRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const spaceIds = [...new Set(memberRows.map((m) => m.spaceId))];

    for (const spaceId of spaceIds) {
      const spaceMemberRows = await ctx.db
        .query('members')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect();

      const coMemberUserIds = spaceMemberRows
        .filter((m) => m.userId !== undefined && m.userId !== userId)
        .map((m) => m.userId as Id<'users'>);

      for (const coUserId of coMemberUserIds) {
        const coTasks = await ctx.db
          .query('tasks')
          .withIndex('by_creator', (q) => q.eq('createdBy', coUserId))
          .filter((q) => q.eq(q.field('deletedAt'), undefined))
          .collect();

        for (const task of coTasks) {
          if (taskMap.has(task._id as string)) continue;
          const userIds = (task.assignedToUserIds ?? []) as Id<'users'>[];
          if (userIds.includes(userId)) {
            addTask(task);
          }
        }
      }
    }

    // Exclude general community reminders regardless of which step above
    // matched them (in practice only step 2 / by_creator ever can — a
    // general reminder has no assignee, so it can never match step 1's
    // by_assigned scan or step 3's assignedToUserIds check). They are
    // SHARED community content with their own dedicated, personal-dismissal
    // -aware retrieval path (listVisibleCommunityRemindersForRange), which
    // this query has no way to consult without adding a per-row settings
    // lookup. Without this exclusion, a reminder's CREATOR would keep
    // seeing it here even after personally dismissing it via
    // dismissCommunityReminderForMe, because this query never reads
    // taskParticipantSettings.dismissedAt — see the personal-dismiss
    // creator-overlap audit fix. Every Home/Calendar caller already merges
    // this query's result with listVisibleCommunityRemindersForRange, so
    // removing general reminders here does not remove them from the
    // product surface — it only removes the un-filtered duplicate.
    const tasks = [...taskMap.values()].filter(
      (t) => !isGeneralCommunityReminder(t)
    );

    // Batch-fetch community names for tasks that have communityId, so the
    // Tasks screen can render the community chip without a separate query.
    const uniqueCommunityIds = [
      ...new Set(
        tasks
          .map((t) => t.communityId)
          .filter((id): id is NonNullable<typeof id> => id != null)
      ),
    ];
    const communityNameMap = new Map<string, string>();
    await Promise.all(
      uniqueCommunityIds.map(async (communityId) => {
        const community = await ctx.db.get(communityId);
        if (community?.name) {
          communityNameMap.set(String(communityId), community.name);
        }
      })
    );

    // Batch-resolve member assignee display names directly from the DB.
    // This mirrors the resolution used in getTaskDetails so task cards and the
    // detail sheet always show the same name for the same assignee.
    const allMemberIds = new Set<string>();
    for (const task of tasks) {
      for (const mid of task.assignedToMemberIds ?? [])
        allMemberIds.add(String(mid));
      if (task.assignedToMemberId)
        allMemberIds.add(String(task.assignedToMemberId));
    }

    const memberProfileMap = new Map<
      string,
      { name: string; color: string | null }
    >();
    await Promise.all(
      [...allMemberIds].map(async (mid) => {
        const member = await ctx.db.get(mid as Id<'members'>);
        if (!member) return;
        let name =
          (member as { displayName?: string }).displayName?.trim() ?? '';
        if (!name) {
          const matchedId = (member as { matchedUserId?: string })
            .matchedUserId;
          if (matchedId) {
            const user = await ctx.db.get(matchedId as Id<'users'>);
            name =
              (user as { fullName?: string } | null)?.fullName?.trim() ?? '';
          }
        }
        memberProfileMap.set(mid, {
          name,
          color: (member as { color?: string }).color ?? null,
        });
      })
    );

    return tasks.map((task) => {
      const seenMids = new Set<string>();
      const assigneeMemberProfiles: {
        id: string;
        name: string;
        color: string | null;
      }[] = [];
      for (const rawMid of [
        ...(task.assignedToMemberIds?.map(String) ?? []),
        ...(task.assignedToMemberId ? [String(task.assignedToMemberId)] : []),
      ]) {
        if (seenMids.has(rawMid)) continue;
        seenMids.add(rawMid);
        const profile = memberProfileMap.get(rawMid);
        if (profile) assigneeMemberProfiles.push({ id: rawMid, ...profile });
      }

      return {
        ...task,
        communityName: task.communityId
          ? communityNameMap.get(String(task.communityId))
          : undefined,
        // Canonical classification (PART E) — Home and Calendar both read
        // this SAME field so they can never disagree about whether an item
        // is a general community reminder or a normal personal task.
        taskType: getTaskClassification(task),
        assigneeMemberProfiles,
      };
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// DEDICATED, VIEWER-SCOPED, DATE-BOUNDED Community Reminder retrieval — the
// final architecture replacing the removed unbounded `listMyTasks` Step 4
// scan (see that query's own doc comment).
//
// Loads general community reminders for ONE community, bounded by the
// caller's requested [from, to] range via TWO index-bounded range scans —
// never a `by_community` collect(). `dueAt` (exact timed reminders) and
// `dueDate` (date-only reminders) are queried separately because a general
// reminder may have EITHER set alone or BOTH set together (the product UI —
// app/(authenticated)/community-reminder/new.tsx / edit/[id].tsx — always
// stamps `dueDate` to the same local day whenever `dueAt` is set, but the
// generic `tasks.update` mutation does not itself enforce that pairing at
// the data-model level, so both index paths are queried defensively rather
// than assumed collapsible into one). Duplicates (a reminder whose `dueAt`
// AND `dueDate` both fall in range) are merged by task `_id` before
// returning — see MERGE/DEDUP in the fix spec.
// ─────────────────────────────────────────────────────────────────────────────
async function loadGeneralCommunityRemindersInRange(
  ctx: QueryCtx,
  communityId: Id<'communities'>,
  from: number,
  to: number
): Promise<Doc<'tasks'>[]> {
  const [byDueAt, byDueDate] = await Promise.all([
    ctx.db
      .query('tasks')
      .withIndex('by_community_assigned_dueAt', (q) =>
        q
          .eq('communityId', communityId)
          .eq('assignedTo', undefined)
          .gte('dueAt', from)
          .lte('dueAt', to)
      )
      .collect(),
    ctx.db
      .query('tasks')
      .withIndex('by_community_assigned_dueDate', (q) =>
        q
          .eq('communityId', communityId)
          .eq('assignedTo', undefined)
          .gte('dueDate', from)
          .lte('dueDate', to)
      )
      .collect(),
  ]);

  const merged = new Map<string, Doc<'tasks'>>();
  for (const task of [...byDueAt, ...byDueDate]) {
    if (!isGeneralCommunityReminder(task)) continue;
    // Belt-and-braces range re-check (see isGeneralCommunityReminderWithinRange's
    // doc comment) — the index scans above already bound the read, this
    // just guards the exact inclusive-range contract on the tiny result set.
    if (!isGeneralCommunityReminderWithinRange(task, from, to)) continue;
    merged.set(task._id as string, task);
  }
  return [...merged.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Community Main "מה חשוב עכשיו" and Home/Calendar all need the SAME thing —
// an active, date-bounded, viewer-visible general community reminder set —
// so this single query serves all three call sites (never separate
// duplicated query logic per screen):
//
//   - Home/Calendar: call WITHOUT `communityId` — every ACTIVE community the
//     viewer belongs to, bounded to that screen's own requested [from, to].
//   - Community Main: call WITH `communityId` — scoped to just that one
//     community (also re-verifies the viewer is an ACTIVE member of exactly
//     that community; returns [] otherwise), bounded to Main's small
//     forward window.
//
// Bounded: one `by_user` scan of the viewer's OWN community memberships,
// one `by_user` scan of the viewer's OWN completion rows (never one
// `by_task_user` lookup per candidate reminder), then the two index-bounded
// range scans above per matching active membership.
// ─────────────────────────────────────────────────────────────────────────────
export const listVisibleCommunityRemindersForRange = query({
  args: {
    from: v.number(),
    to: v.number(),
    communityId: v.optional(v.id('communities')),
    // Personal-dismissal foundation — when explicitly `false`, the
    // viewer's OWN personal hidden state (dismissedAt / legacy
    // completedAt) is ignored, so a general community reminder the viewer
    // has personally hidden from Home/Calendar still comes back for
    // authorized COMMUNITY-context retrieval (Community Main). Omitted or
    // `true` (default) preserves the existing PERSONAL-surface behavior
    // exactly. Ignoring personal hidden state is only ever allowed for a
    // SINGLE, membership-verified community (communityId REQUIRED when
    // this is `false`) — never for the broad multi-community Home/Calendar
    // mode, so this can never become a generic bypass for arbitrary
    // callers.
    respectPersonalHiddenState: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { from, to, communityId, respectPersonalHiddenState }
  ) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const ignorePersonalHiddenState = respectPersonalHiddenState === false;
    if (ignorePersonalHiddenState && communityId === undefined) {
      throw new Error(
        'respectPersonalHiddenState=false requires a single communityId'
      );
    }

    const myMemberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const scopedActiveMemberships = myMemberships.filter(
      (m) =>
        isActiveCommunityMember(m) &&
        (communityId === undefined || m.communityId === communityId)
    );
    if (scopedActiveMemberships.length === 0) return [];

    // Bounded: one `by_user` scan of the viewer's OWN completion/dismissal
    // rows — skipped entirely in community-context retrieval mode, where
    // personal hidden state is irrelevant by design (never a per-reminder
    // settings lookup either way).
    let myHiddenTaskIds = new Set<string>();
    if (!ignorePersonalHiddenState) {
      const myCompletionRows = await ctx.db
        .query('taskParticipantSettings')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect();
      // A general community reminder is personally hidden from PERSONAL
      // surfaces when EITHER the new `dismissedAt` OR the legacy
      // `completedAt` is set — see isCommunityReminderPersonallyHidden's
      // doc comment in taskUtils.ts. Built once from the bulk scan above,
      // never a per-task lookup.
      myHiddenTaskIds = new Set(
        myCompletionRows
          .filter(
            (row) =>
              row.completedAt !== undefined || row.dismissedAt !== undefined
          )
          .map((row) => row.taskId as string)
      );
    }

    const taskMap = new Map<string, Doc<'tasks'>>();
    for (const membership of scopedActiveMemberships) {
      const candidates = await loadGeneralCommunityRemindersInRange(
        ctx,
        membership.communityId,
        from,
        to
      );
      for (const task of candidates) {
        const key = task._id as string;
        if (taskMap.has(key)) continue;
        if (myHiddenTaskIds.has(key)) continue;
        taskMap.set(key, task);
      }
    }

    const tasks = [...taskMap.values()];
    if (tasks.length === 0) return [];

    // Enrich community name once per UNIQUE community id — never a
    // client-side N+1 subscription per reminder.
    const uniqueCommunityIds = [
      ...new Set(tasks.map((t) => t.communityId as Id<'communities'>)),
    ];
    const communityNameMap = new Map<string, string>();
    await Promise.all(
      uniqueCommunityIds.map(async (cid) => {
        const community = await ctx.db.get(cid);
        if (community?.name) {
          communityNameMap.set(String(cid), community.name);
        }
      })
    );

    return tasks.map((task) => ({
      ...task,
      communityName: communityNameMap.get(String(task.communityId)),
      // Always 'community_reminder' here — this query only ever returns
      // general community reminders (see isGeneralCommunityReminder above).
      taskType: getTaskClassification(task),
      // A general community reminder never has an explicit assignee (see
      // isGeneralCommunityReminder) — always empty, kept only so this row
      // shape matches listMyTasks's `assigneeMemberProfiles` field for
      // callers that merge both result sets (Home/Calendar).
      assigneeMemberProfiles: [] as {
        id: string;
        name: string;
        color: string | null;
      }[],
    }));
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת כל המשימות של space (עם תאריך)
// ─────────────────────────────────────────────────────────────
export const listBySpace = query({
  args: { spaceId: v.id('spaces') },
  handler: async (ctx, { spaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .filter((q) =>
        q.and(
          q.neq(q.field('dueDate'), undefined),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .order('asc')
      .collect();
    const resolvedRows = await Promise.all(
      rows
        .filter((task) => isPersonalTaskForUser(task, userId))
        .map((task) => resolveCurrentEventImportantItemTask(ctx, task))
    );

    return resolvedRows.filter(
      (task): task is Doc<'tasks'> =>
        task !== null && task.dueDate !== undefined
    );
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימות ללא תאריך (undated tasks)
// ─────────────────────────────────────────────────────────────
export const listUndated = query({
  args: { spaceId: v.id('spaces') },
  handler: async (ctx, { spaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .filter((q) =>
        q.and(
          q.eq(q.field('dueDate'), undefined),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .collect();
    const resolvedRows = await Promise.all(
      rows
        .filter((task) => isPersonalTaskForUser(task, userId))
        .map((task) => resolveCurrentEventImportantItemTask(ctx, task))
    );

    return resolvedRows.filter(
      (task): task is Doc<'tasks'> =>
        task !== null && task.dueDate === undefined
    );
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימות קשורות ליום הולדת לפי birthdayId
//
// SECURITY: birthdayId is a client-generated local string (Date.now()
// from the on-device birthday list — see lib/birthdayStorage.ts) and is
// NEVER an authorization boundary by itself. Previously this query
// returned every task matching that string across ALL users/spaces.
// Results are now scoped with the same isPersonalTaskForUser rule used by
// every other personal-task query in this file (creator or assignee), so
// a birthdayId collision (or a birthdayId guessed/replayed by another
// caller) can never expose another user's tasks.
// ─────────────────────────────────────────────────────────────
export const listByRelatedBirthday = query({
  args: { birthdayId: v.string() },
  handler: async (ctx, { birthdayId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_related_birthday', (q) =>
        q.eq('relatedBirthdayId', birthdayId)
      )
      .filter((q) => q.eq(q.field('deletedAt'), undefined))
      .order('desc')
      .collect();
    return rows.filter((task) => isPersonalTaskForUser(task, userId));
  },
});

// ─────────────────────────────────────────────────────────────
// יצירת משימה חדשה
// ─────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.optional(v.number()), // undefined = ללא תאריך
    spaceId: v.optional(v.id('spaces')),
    assignedTo: v.optional(v.id('users')),
    assignedToMemberId: v.optional(v.id('members')),
    assignedToUserIds: v.optional(v.array(v.id('users'))),
    assignedToMemberIds: v.optional(v.array(v.id('members'))),
    category: v.optional(v.string()),
    hasTime: v.optional(v.boolean()),
    dueAt: v.optional(v.number()),
    reminderType: v.optional(taskReminderTypeValidator),
    customReminderAt: v.optional(v.number()),
    reminders: v.optional(v.array(taskReminderValidator)),
    recurrenceType: v.optional(taskRecurrenceTypeValidator),
    selectedWeekdays: v.optional(v.array(v.number())),
    subtasks: v.optional(v.array(taskSubtaskValidator)),
    allowParticipantEditing: v.optional(v.boolean()),
    attachments: v.optional(v.array(taskAttachmentArgValidator)),
    communityId: v.optional(v.id('communities')),
    relatedType: v.optional(v.literal('birthday')),
    relatedBirthdayId: v.optional(v.string()),
    relatedBirthdayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    if (args.attachments && args.attachments.length > MAX_TASK_ATTACHMENTS) {
      throw new Error(
        `לא ניתן לצרף יותר מ-${MAX_TASK_ATTACHMENTS} קבצים למשימה`
      );
    }

    // Reject any submitted storageId that is already referenced by another
    // task or event document — prevents cross-document attachment hijack.
    const newStorageIds = new Set<string>([
      ...(args.attachments ?? []).map((a) => a.storageId as string),
      ...(args.subtasks ?? []).flatMap((st) => {
        const ids: string[] = [];
        if (st.image?.storageId) ids.push(st.image.storageId as string);
        if (st.attachment?.storageId)
          ids.push(st.attachment.storageId as string);
        return ids;
      }),
    ]);
    for (const sid of newStorageIds) {
      if (
        await isStorageReferencedByOtherDocument(ctx, sid as Id<'_storage'>)
      ) {
        throw new Error('לא ניתן לצרף קובץ זה');
      }
    }

    const now = Date.now();
    const stampedAttachments =
      args.attachments && args.attachments.length > 0
        ? args.attachments.map((a) => ({
            ...a,
            uploadedBy: userId,
            uploadedAt: now,
          }))
        : undefined;

    const normalizedScheduleArgs = {
      ...args,
      dueAt: args.hasTime === true ? args.dueAt : undefined,
    };
    const normalizedReminders = normalizeRemindersForSchedule(
      args.reminders,
      normalizedScheduleArgs,
      now
    );
    const normalizedCustomReminderAt =
      normalizedReminders?.find((reminder) => reminder.type === 'custom')
        ?.customReminderAt ??
      (args.reminderType === 'custom'
        ? normalizeCustomReminderAtForSchedule(
            args.customReminderAt,
            normalizedScheduleArgs,
            now
          )
        : undefined);

    if (args.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        args.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('רק חברי קהילה פעילים יכולים ליצור תזכורת');
      }
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        throw new Error('רק בעלים או מנהלי קהילה יכולים ליצור תזכורת קהילתית');
      }
    }
    validateTaskCategory(args.category);
    validateTaskSchedule({
      ...normalizedScheduleArgs,
      customReminderAt: normalizedCustomReminderAt,
      reminders: normalizedReminders,
    });

    const {
      assignedTo: argAssignedTo,
      assignedToMemberId: argAssignedToMemberId,
      assignedToUserIds: argAssignedToUserIds,
      assignedToMemberIds: argAssignedToMemberIds,
      ...restInsertArgs
    } = args;

    const explicitAssigneeArgs = {
      assignedTo: argAssignedTo,
      assignedToMemberId: argAssignedToMemberId,
      assignedToUserIds: argAssignedToUserIds,
      assignedToMemberIds: argAssignedToMemberIds,
    };

    // Community reminders with no explicit assignee must be stored with
    // assignedTo === undefined so they match the filter in
    // listCommunityRemindersPaged / listCompletedCommunityReminders / listByCommunity.
    // Personal tasks (no communityId) keep the creator-fallback assignment.
    const normalizedAssignees =
      args.communityId !== undefined &&
      !hasExplicitAssigneeForCommunityActivity(explicitAssigneeArgs)
        ? {
            assignedTo: undefined as Id<'users'> | undefined,
            assignedToMemberId: undefined as Id<'members'> | undefined,
            assignedToUserIds: [] as Id<'users'>[],
            assignedToMemberIds: [] as Id<'members'>[],
          }
        : normalizeAssigneesForWrite(userId, explicitAssigneeArgs);

    const taskId = await ctx.db.insert('tasks', {
      ...restInsertArgs,
      dueAt: normalizedScheduleArgs.dueAt,
      spaceId: args.spaceId ?? undefined,
      assignedTo: normalizedAssignees.assignedTo,
      assignedToMemberId: normalizedAssignees.assignedToMemberId,
      assignedToUserIds:
        normalizedAssignees.assignedToUserIds.length > 0
          ? normalizedAssignees.assignedToUserIds
          : undefined,
      assignedToMemberIds:
        normalizedAssignees.assignedToMemberIds.length > 0
          ? normalizedAssignees.assignedToMemberIds
          : undefined,
      attachments: stampedAttachments,
      reminderType: normalizedReminders?.[0]?.type ?? 'none',
      customReminderAt: normalizedCustomReminderAt,
      reminders: normalizedReminders,
      subtasks: sanitizeSubtasks(args.subtasks),
      completed: false,
      isAiGenerated: false,
      createdBy: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    if (args.communityId && !hasExplicitAssigneeForCommunityActivity(args)) {
      const communityId = args.communityId;
      await insertCommunityActivity(ctx, {
        communityId,
        actorUserId: userId,
        type: 'reminder_created',
        entityType: 'reminder',
        entityId: taskId,
        title: `נוספה תזכורת: ${args.title.trim()}`,
      });

      const community = await ctx.db.get(communityId);
      if (community) {
        const allMembers = await ctx.db
          .query('communityMembers')
          .withIndex('by_community', (q) => q.eq('communityId', communityId))
          .collect();

        const recipientUserIds = allMembers
          .filter(
            (m) =>
              isActiveCommunityMember(m) &&
              m.userId !== userId &&
              m.notificationsEnabled !== false
          )
          .map((m) => m.userId);

        if (recipientUserIds.length > 0) {
          const reminderCreatedTitle = `תזכורת חדשה ב${community.name}`;
          const reminderCreatedBody = args.title.trim();
          const reminderCreatedScreen = `/(authenticated)/community/${communityId}?tab=תזכורות`;

          await createUserNotifications(ctx, {
            recipientUserIds,
            pushType: 'community_general_reminder_created',
            title: reminderCreatedTitle,
            body: reminderCreatedBody,
            screen: reminderCreatedScreen,
          });

          await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
            recipientUserIds,
            pushType: 'community_general_reminder_created',
            title: reminderCreatedTitle,
            body: reminderCreatedBody,
            data: { screen: reminderCreatedScreen },
            channelId: 'communities',
          });
        }

        // ── Schedule due reminders for all active community members.
        //
        // Separate recipient list from community_general_reminder_created:
        // that list excludes the actor so the creator doesn't get a
        // "someone created this" bell. The due-reminder list must include
        // the creator — they want to be reminded too.
        //
        // notificationsEnabled is NOT filtered here; mute state is checked
        // only when the reminder fires (fireReminder.D).
        const allMembersForDue = await ctx.db
          .query('communityMembers')
          .withIndex('by_community', (q) => q.eq('communityId', communityId))
          .collect();

        const dueRecipientUserIds = allMembersForDue
          .filter((m) => isActiveCommunityMember(m))
          .map((m) => m.userId);

        if (normalizedReminders && dueRecipientUserIds.length > 0) {
          const scheduleNow = Date.now();
          for (const reminder of normalizedReminders) {
            const scheduledFor = resolveReminderTimestamp(
              reminder,
              normalizedScheduleArgs
            );
            if (scheduledFor === undefined || scheduledFor <= scheduleNow) {
              continue;
            }
            for (const recipientUserId of dueRecipientUserIds) {
              await ctx.scheduler.runAfter(
                0,
                internal.reminderScheduler.scheduleUserReminder,
                {
                  taskId,
                  userId: recipientUserId,
                  reminderKey: reminder.id,
                  scheduledFor,
                }
              );
            }
          }
        }
      }
    }

    return taskId;
  },
});

// ─────────────────────────────────────────────────────────────
// החלפת מצב השלמה (toggle)
//
// PATH A — General community reminder:
//   Authorization: any active community member (not just creator/assignee).
//   Completion is personal per-user via taskParticipantSettings.completedAt.
//   tasks.completed and tasks.completedAt are NEVER patched for this path.
//   Scheduler: only this user's pending rows are canceled / rescheduled.
//
// PATH B — All other task types (personal, assigned, event-linked):
//   Authorization: isUserParticipantInTask (unchanged).
//   Completion is shared via tasks.completed / tasks.completedAt.
//   Scheduler: existing whole-task behavior unchanged.
// ─────────────────────────────────────────────────────────────
export const toggleCompleted = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');

    // ── PATH A: General community reminder → per-user personal completion ──
    if (isGeneralCommunityReminder(task)) {
      const membership = await getCommunityMembership(
        ctx,
        task.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('אין הרשאה לעדכן משימה זו');
      }

      const personal = await getPersonalCompletion(ctx, id, userId);

      if (!personal.completed) {
        // Completing: record personal completedAt, cancel only this user's pending jobs.
        await setPersonalCompleted(ctx, id, userId);
        await cancelPendingJobsForTaskAndUserHelper(ctx, id, userId);
      } else {
        // Reopening: clear personal completedAt, reschedule only for this user.
        await clearPersonalCompleted(ctx, id, userId);
        await scheduleGeneralReminderJobsForRecipients(
          ctx,
          id,
          task.communityId,
          task.reminders,
          {
            dueDate: task.dueDate,
            hasTime: task.hasTime,
            dueAt: task.dueAt,
          },
          [userId]
        );
      }
      return;
    }

    // ── PATH B: All other task types → existing shared completion ───────────
    if (!isUserParticipantInTask(task, userId)) {
      throw new Error('אין הרשאה לעדכן משימה זו');
    }

    const nowCompleted = !task.completed;
    await ctx.db.patch(id, {
      completed: nowCompleted,
      completedAt: nowCompleted ? Date.now() : undefined,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// הסתרת תזכורת קהילה כללית מהמרחב האישי ("הסתר מהמרחב האישי שלי").
//
// Personal-dismissal foundation — BACKEND ONLY. Writes ONLY
// taskParticipantSettings.dismissedAt for the caller's own row. Never
// affects tasks.completed/tasks.completedAt, never affects any other
// member's view, and never removes the reminder from Community Main or the
// Community Reminders tab (those read via shouldShowCommunityReminderInCommunity
// / respectPersonalHiddenState=false, which never consult dismissedAt).
//
// SECURITY — the viewer is taken ONLY from getAuthUserId(ctx); no userId/
// viewerId is ever accepted as an argument. Before writing, this validates
// SERVER-SIDE that:
//   1. the caller is authenticated,
//   2. the task exists,
//   3. the task is a GENERAL COMMUNITY REMINDER (isGeneralCommunityReminder
//      also excludes soft-deleted/archived tasks and event-derived/assigned
//      community tasks — see that predicate's own doc comment),
//   4. the task has a valid communityId (narrowed by #3),
//   5. the viewer is an ACTIVE member (owner/admin/member; pending/left/
//      non-member rejected) of THAT EXACT community, via the same indexed
//      by_community_user membership lookup toggleCompleted already uses —
//      never a scan of all community members, never authorized off the
//      task creator/assignee alone.
// ─────────────────────────────────────────────────────────────
export const dismissCommunityReminderForMe = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(taskId);
    if (!task) throw new Error('משימה לא נמצאה');

    if (!isGeneralCommunityReminder(task)) {
      throw new Error('ניתן להסתיר רק תזכורות קהילה כלליות');
    }

    const membership = await getCommunityMembership(
      ctx,
      task.communityId,
      userId
    );
    if (!isActiveCommunityMember(membership)) {
      throw new Error('אין הרשאה להסתיר תזכורת זו');
    }

    await setPersonalDismissed(ctx, taskId, userId);
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת משימה בודדת לפי ID (לדף עריכה)
// ─────────────────────────────────────────────────────────────
export const getById = query({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    // TODO: לאמת שהמשתמש הנוכחי שייך ל-space של המשימה
    return await ctx.db.get(id);
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת פרטי משימה מועשרת להצגה במסך Task Details
// ─────────────────────────────────────────────────────────────
export const getTaskDetails = query({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) return null;

    const task = await ctx.db.get(id);
    if (!task) return null;

    // ── Authorization ────────────────────────────────────────────────────────
    //
    // A. General community reminder (communityId set, no sourceType, no assignee):
    //    visible only to active members; former/removed/never-joined → null.
    //
    // B. All other task types (personal, assigned, community-assigned,
    //    event-linked copies, soft-deleted personal tasks):
    //    visible only to the creator or an explicit assignee
    //    (isUserParticipantInTask). An unrelated authenticated user receives
    //    null so the existence of the task is not revealed.
    //
    // Viewing permission does NOT grant edit/delete permission; those gates
    // remain in tasks.update / tasks.remove / tasks.toggleCompleted.

    // Explicit guard: a deleted or archived general community reminder must
    // return null for EVERYONE — including the original creator. Without this
    // guard, isGeneralCommunityReminder returns false (it excludes
    // deleted/archived), causing the logic to fall through to
    // isUserParticipantInTask whose creator check would grant access.
    if (isDeletedOrArchivedGeneralCommunityReminder(task)) return null;

    let canEdit = false;
    if (isGeneralCommunityReminder(task)) {
      const membership = await getCommunityMembership(
        ctx,
        task.communityId,
        currentUserId
      );
      if (!isActiveCommunityMember(membership)) return null;
      canEdit =
        task.createdBy === currentUserId ||
        membership.role === 'owner' ||
        membership.role === 'admin';
    } else if (!isUserParticipantInTask(task, currentUserId)) {
      return null;
    } else {
      canEdit = true;
    }

    // ── Creator profile ──────────────────────────────────────────────────────
    const creator = task.createdBy ? await ctx.db.get(task.createdBy) : null;
    const creatorProfile = creator
      ? {
          id: task.createdBy as string,
          name: (creator as { fullName?: string }).fullName ?? 'משתמש',
          color: (creator as { profileColor?: string }).profileColor ?? null,
        }
      : null;

    // ── User assignees ────────────────────────────────────────────────────────
    // assignedToUserIds is the authoritative multi-assignee list.
    // Fall back to the legacy single assignedTo field only when the array is absent/empty.
    const rawUserIds: string[] =
      task.assignedToUserIds && task.assignedToUserIds.length > 0
        ? [...task.assignedToUserIds]
        : task.assignedTo
          ? [task.assignedTo]
          : [];

    const seenUsers = new Set<string>();
    const userAssigneeIds = rawUserIds.filter((uid) => {
      if (seenUsers.has(uid)) return false;
      seenUsers.add(uid);
      return true;
    });

    // ── Member assignees (family entities without an app account) ─────────────
    // assignedToMemberIds holds people who were added via family contacts but
    // have no matched userId — e.g. a manually-added member like Shalev.
    const rawMemberIds: string[] =
      task.assignedToMemberIds && task.assignedToMemberIds.length > 0
        ? [...task.assignedToMemberIds]
        : task.assignedToMemberId
          ? [task.assignedToMemberId]
          : [];

    const seenMembers = new Set<string>();
    const memberAssigneeIds = rawMemberIds.filter((mid) => {
      if (seenMembers.has(mid)) return false;
      seenMembers.add(mid);
      return true;
    });

    // ── Resolve assignee profiles ─────────────────────────────────────────────
    const assignees: {
      id: string;
      name: string;
      color: string | null;
      kind: 'user' | 'member';
    }[] = [];

    for (const uid of userAssigneeIds) {
      const user = await ctx.db.get(uid as Id<'users'>);
      if (user) {
        assignees.push({
          id: uid,
          name: (user as { fullName?: string }).fullName ?? 'משתמש',
          color: (user as { profileColor?: string }).profileColor ?? null,
          kind: 'user',
        });
      }
    }

    for (const mid of memberAssigneeIds) {
      const member = await ctx.db.get(mid as Id<'members'>);
      if (member) {
        let memberName =
          (member as { displayName?: string }).displayName?.trim() ?? '';
        if (!memberName) {
          const matchedId = (member as { matchedUserId?: string })
            .matchedUserId;
          if (matchedId) {
            const linkedUser = await ctx.db.get(matchedId as Id<'users'>);
            memberName =
              (linkedUser as { fullName?: string } | null)?.fullName?.trim() ??
              '';
          }
        }
        assignees.push({
          id: mid,
          name: memberName,
          color: (member as { color?: string }).color ?? null,
          kind: 'member',
        });
      }
    }

    const currentUserIsCreator = task.createdBy === currentUserId;

    // For general community reminders, overlay the authenticated user's personal
    // completion state. The shared tasks.completed / tasks.completedAt fields
    // are legacy-only for this task type.
    let effectiveCompleted = task.completed;
    let effectiveCompletedAt = task.completedAt;

    if (isGeneralCommunityReminder(task)) {
      const personal = await getPersonalCompletion(ctx, id, currentUserId);
      effectiveCompleted = personal.completed;
      effectiveCompletedAt = personal.completedAt;
    }

    return {
      ...task,
      completed: effectiveCompleted,
      completedAt: effectiveCompletedAt,
      creatorProfile,
      assignees,
      currentUserId,
      currentUserIsCreator,
      canEdit,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת URL לצפייה בקובץ מצורף למשימה — ממוקד ומאובטח
//
// The caller must supply both the taskId and the storageId. The handler:
//   1. Authenticates the user.
//   2. Loads the task.
//   3. Applies the same authoritative read-access rules as getTaskDetails.
//   4. Verifies the storageId is actually referenced by that exact task
//      (task.attachments or subtask image/attachment fields).
//   5. Returns null when the task is missing, the user lacks access, the
//      storageId is not referenced by this task, or the storage object is gone.
//   6. Only then calls ctx.storage.getUrl.
//
// This prevents a caller from obtaining a signed URL for a foreign storageId
// by simply knowing the task ID and guessing an unrelated storage object ID.
// ─────────────────────────────────────────────────────────────
export const getTaskAttachmentUrl = query({
  args: {
    taskId: v.id('tasks'),
    storageId: v.id('_storage'),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { taskId, storageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const task = await ctx.db.get(taskId);
    if (!task) return null;

    // Same deleted/archived guard as getTaskDetails — see comment there.
    if (isDeletedOrArchivedGeneralCommunityReminder(task)) return null;

    if (isGeneralCommunityReminder(task)) {
      const membership = await getCommunityMembership(
        ctx,
        task.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) return null;
    } else if (!isUserParticipantInTask(task, userId)) {
      return null;
    }

    // Verify the requested storageId is actually referenced by this task.
    const taskStorageIds = new Set<string>([
      ...storageIdsFromTaskAttachments(task.attachments),
      ...storageIdsFromSubtaskImages(task.subtasks),
    ]);
    if (!taskStorageIds.has(storageId as string)) {
      return null;
    }

    // ctx.storage.getUrl returns null if the object no longer exists.
    return await ctx.storage.getUrl(storageId);
  },
});

// getTaskDetailsByRouteId was removed — the community-reminder/[id] full-screen
// details route no longer exists. Reminder details are now shown inline in the
// expandable CommunityReminderRow in community/[id].tsx.

// ─────────────────────────────────────────────────────────────
// עדכון שדות משימה קיימת
// ─────────────────────────────────────────────────────────────
export const update = mutation({
  args: {
    id: v.id('tasks'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    assignedTo: v.optional(v.id('users')),
    assignedToMemberId: v.optional(v.id('members')),
    assignedToUserIds: v.optional(v.array(v.id('users'))),
    assignedToMemberIds: v.optional(v.array(v.id('members'))),
    category: v.optional(v.string()),
    hasTime: v.optional(v.boolean()),
    dueAt: v.optional(v.number()),
    reminderType: v.optional(taskReminderTypeValidator),
    customReminderAt: v.optional(v.number()),
    reminders: v.optional(v.array(taskReminderValidator)),
    recurrenceType: v.optional(taskRecurrenceTypeValidator),
    selectedWeekdays: v.optional(v.array(v.number())),
    subtasks: v.optional(v.array(taskSubtaskValidator)),
    allowParticipantEditing: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    attachments: v.optional(v.array(taskAttachmentArgValidator)),
    clearFields: v.optional(v.array(clearableTaskFieldValidator)),
  },
  handler: async (
    ctx,
    { id, clearFields, attachments, subtasks, ...fields }
  ) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    const isCreator = existing.createdBy === userId;
    const isParticipant = isUserParticipantInTask(existing, userId);

    // Community owner/admin may edit any general community reminder,
    // even if they are not the creator or an explicit participant.
    let isCommunityManager = false;
    if (
      !isParticipant &&
      existing.communityId !== undefined &&
      existing.sourceType === undefined
    ) {
      const mgmtMembership = await getCommunityMembership(
        ctx,
        existing.communityId,
        userId
      );
      if (
        isActiveCommunityMember(mgmtMembership) &&
        (mgmtMembership.role === 'owner' || mgmtMembership.role === 'admin')
      ) {
        isCommunityManager = true;
      }
    }

    if (!isParticipant && !isCommunityManager) {
      throw new Error('אין הרשאה לעדכן משימה זו');
    }

    // Community managers get full edit rights (same as creator).
    const hasFullEditRight = isCreator || isCommunityManager;

    if (!hasFullEditRight) {
      if (
        fields.title !== undefined &&
        fields.title.trim() !== existing.title
      ) {
        throw new Error('רק יוצר/ת המשימה יכול/ה לשנות את שם המשימה');
      }
      if (
        fields.category !== undefined &&
        fields.category !== existing.category
      ) {
        throw new Error('רק יוצר/ת המשימה יכול/ה לשנות את קטגוריית המשימה');
      }
      if (
        fields.recurrenceType !== undefined &&
        fields.recurrenceType !== (existing.recurrenceType ?? 'none')
      ) {
        throw new Error('רק יוצר/ת המשימה יכול/ה לשנות את הגדרת החזרה');
      }
      if (
        fields.allowParticipantEditing !== undefined &&
        fields.allowParticipantEditing !==
          (existing.allowParticipantEditing ?? false)
      ) {
        throw new Error('רק יוצר/ת המשימה יכול/ה לשנות הגדרה זו');
      }
      if (
        subtasks !== undefined &&
        !(existing.allowParticipantEditing ?? false)
      ) {
        const existingSnap = JSON.stringify(
          (existing.subtasks ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
          }))
        );
        const newSnap = JSON.stringify(
          (sanitizeSubtasks(subtasks) ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: s.completed,
          }))
        );
        if (existingSnap !== newSnap) {
          throw new Error('יוצר/ת המשימה לא אפשר/ה עריכת תתי־משימות');
        }
      }
    }

    validateTaskCategory(fields.category);
    const now = Date.now();
    const cleared = new Set(clearFields ?? []);
    const nextHasTime = cleared.has('hasTime')
      ? fields.hasTime
      : (fields.hasTime ?? existing.hasTime);
    const nextDueAt =
      nextHasTime === true && !cleared.has('dueAt')
        ? (fields.dueAt ?? existing.dueAt)
        : undefined;
    const nextDueDate = cleared.has('dueDate')
      ? undefined
      : (fields.dueDate ?? existing.dueDate);
    const nextReminders = cleared.has('reminders')
      ? undefined
      : normalizeRemindersForSchedule(
          fields.reminders ?? existing.reminders,
          {
            dueDate: nextDueDate,
            hasTime: nextHasTime,
            dueAt: nextDueAt,
          },
          now
        );
    const nextReminderType = cleared.has('reminderType')
      ? undefined
      : (fields.reminderType ?? existing.reminderType);
    const customReminderFromList = nextReminders?.find(
      (reminder) => reminder.type === 'custom'
    )?.customReminderAt;
    const nextCustomReminderAt =
      customReminderFromList ??
      (cleared.has('customReminderAt') || nextReminders !== undefined
        ? undefined
        : nextReminderType === 'custom'
          ? normalizeCustomReminderAtForSchedule(
              fields.customReminderAt ?? existing.customReminderAt,
              {
                dueDate: nextDueDate,
                hasTime: nextHasTime,
                dueAt: nextDueAt,
              },
              now
            )
          : undefined);
    validateTaskSchedule({
      dueDate: nextDueDate,
      hasTime: nextHasTime,
      dueAt: nextDueAt,
      recurrenceType: fields.recurrenceType ?? existing.recurrenceType,
      customReminderAt: nextCustomReminderAt,
      reminders: nextReminders,
    });

    if (
      attachments !== undefined &&
      attachments.length > MAX_TASK_ATTACHMENTS
    ) {
      throw new Error(
        `לא ניתן לצרף יותר מ-${MAX_TASK_ATTACHMENTS} קבצים למשימה`
      );
    }

    const clearingAttachments = clearFields?.includes('attachments') ?? false;
    const clearingSubtasks = clearFields?.includes('subtasks') ?? false;

    const nextAttachments = (() => {
      if (clearingAttachments) return undefined;
      if (attachments !== undefined) {
        if (attachments.length === 0) return undefined;
        return stampTaskAttachments(attachments, userId, existing, now);
      }
      return existing.attachments;
    })();

    const nextSubtasks = (() => {
      if (clearingSubtasks) return undefined;
      if (subtasks !== undefined) {
        return sanitizeSubtasks(subtasks);
      }
      return existing.subtasks;
    })();

    const storageBefore = new Set([
      ...storageIdsFromTaskAttachments(existing.attachments),
      ...storageIdsFromSubtaskImages(existing.subtasks),
    ]);
    const storageAfter = new Set([
      ...storageIdsFromTaskAttachments(nextAttachments),
      ...storageIdsFromSubtaskImages(nextSubtasks),
    ]);

    // Reject any *newly introduced* storageId that is already referenced by
    // another document — preserves retained references from the same task.
    for (const sid of storageAfter) {
      if (!storageBefore.has(sid)) {
        if (
          await isStorageReferencedByOtherDocument(ctx, sid as Id<'_storage'>, {
            taskId: id,
          })
        ) {
          throw new Error('לא ניתן לצרף קובץ זה');
        }
      }
    }

    for (const sid of storageBefore) {
      if (!storageAfter.has(sid)) {
        await safeDeleteStorageIfUnreferenced(ctx, sid as Id<'_storage'>, {
          taskId: id,
        });
      }
    }

    const patch: Partial<Doc<'tasks'>> = Object.fromEntries(
      Object.entries({
        ...fields,
        updatedAt: now,
      }).filter(([, value]) => value !== undefined)
    ) as Partial<Doc<'tasks'>>;

    patch.reminderType = nextReminders?.[0]?.type ?? 'none';
    patch.customReminderAt = nextCustomReminderAt;
    patch.reminders = nextReminders;

    if (attachments !== undefined || clearingAttachments) {
      patch.attachments = nextAttachments;
    }
    if (subtasks !== undefined || clearingSubtasks) {
      patch.subtasks = nextSubtasks;
    }

    for (const field of clearFields ?? []) {
      (patch as Record<string, undefined>)[field] = undefined;
    }

    const nextUserIds = cleared.has('assignedToUserIds')
      ? []
      : 'assignedToUserIds' in fields
        ? (fields.assignedToUserIds ?? [])
        : (existing.assignedToUserIds ?? []);
    const nextMemberIds = cleared.has('assignedToMemberIds')
      ? []
      : 'assignedToMemberIds' in fields
        ? (fields.assignedToMemberIds ?? [])
        : (existing.assignedToMemberIds ?? []);
    const nextAssignedTo = cleared.has('assignedTo')
      ? undefined
      : 'assignedTo' in fields
        ? fields.assignedTo
        : existing.assignedTo;
    const nextAssignedToMemberId = cleared.has('assignedToMemberId')
      ? undefined
      : 'assignedToMemberId' in fields
        ? fields.assignedToMemberId
        : existing.assignedToMemberId;

    const noExplicitAssigneeIntended =
      nextUserIds.length === 0 &&
      nextMemberIds.length === 0 &&
      nextAssignedTo === undefined &&
      nextAssignedToMemberId === undefined;

    if (existing.communityId !== undefined && noExplicitAssigneeIntended) {
      // Community task with no explicit assignee stays unassigned,
      // mirroring the create mutation so query filters keep working.
      patch.assignedTo = undefined;
      patch.assignedToMemberId = undefined;
      patch.assignedToUserIds = undefined;
      patch.assignedToMemberIds = undefined;
    } else if (noExplicitAssigneeIntended) {
      const fb = existing.createdBy;
      patch.assignedTo = fb;
      patch.assignedToMemberId = undefined;
      patch.assignedToUserIds = [fb];
      patch.assignedToMemberIds = undefined;
    } else {
      patch.assignedTo = nextAssignedTo;
      patch.assignedToMemberId = nextAssignedToMemberId;
      patch.assignedToUserIds =
        nextUserIds.length > 0 ? nextUserIds : undefined;
      patch.assignedToMemberIds =
        nextMemberIds.length > 0 ? nextMemberIds : undefined;
    }

    if (!hasFullEditRight) {
      // Participants cannot modify task-level reminders — they manage their own
      // via the separate updateMyTaskReminder mutation.
      patch.reminderType = existing.reminderType ?? 'none';
      patch.customReminderAt = existing.customReminderAt;
      patch.reminders = existing.reminders;
      // Participants cannot modify assignees
      patch.assignedTo = existing.assignedTo;
      patch.assignedToMemberId = existing.assignedToMemberId;
      patch.assignedToUserIds = existing.assignedToUserIds;
      patch.assignedToMemberIds = existing.assignedToMemberIds;
    }

    await ctx.db.patch(id, patch);

    // ── General community reminder scheduling lifecycle ──
    const communityId = existing.communityId;
    if (communityId !== undefined) {
      // Pre-update eligibility: was this a general community reminder?
      const wasGeneralReminder =
        existing.sourceType === undefined &&
        !existing.completed &&
        existing.deletedAt === undefined &&
        existing.archivedAt === undefined &&
        !hasExplicitAssigneeForCommunityActivity(existing);

      // effectiveArchivedAt: archivedAt can only be SET via update args
      // (it's not in clearableTaskFieldValidator), so the effective value is
      // the new arg if supplied, otherwise the persisted value.
      const effectiveArchivedAt = fields.archivedAt ?? existing.archivedAt;

      // Post-update eligibility: use pre-fallback assignment vars so the intent
      // from args/existing (not the community-unassigned normalisation) is clear.
      const isGeneralReminder =
        existing.sourceType === undefined &&
        !existing.completed &&
        existing.deletedAt === undefined &&
        effectiveArchivedAt === undefined &&
        noExplicitAssigneeIntended;

      if (wasGeneralReminder && !isGeneralReminder) {
        // Case A: became ineligible (assignee added, completed, archived…).
        await cancelPendingJobsForTaskHelper(ctx, id);
      } else if (!wasGeneralReminder && isGeneralReminder) {
        // Case B: became eligible (assignment removed, reopened…) — schedule
        // only for active members who have NOT personally completed.
        await scheduleGeneralReminderJobsForTask(
          ctx,
          id,
          communityId,
          patch.reminders,
          { dueDate: nextDueDate, hasTime: nextHasTime, dueAt: nextDueAt },
          { excludePersonallyCompleted: true }
        );
      } else if (wasGeneralReminder && isGeneralReminder) {
        // Case C / D: remains eligible — reschedule only when schedule changed.
        //
        // reminders: guard on `fields.reminders` (user's explicit input), NOT
        // on `patch.reminders` (which is the output of normalizeRemindersForSchedule).
        // normalizeRemindersForSchedule filters out reminders whose resolved time
        // is < now, so a title-only edit made after a reminder's due time has
        // passed would make patch.reminders differ from existing.reminders even
        // though the user changed nothing — a false positive.
        // cleared.has('reminders') catches the explicit-clear path.
        //
        // dueDate/hasTime/dueAt: nextDueDate/nextHasTime/nextDueAt already fall
        // back to existing.* for omitted fields, so those comparisons are
        // already correct as-is (using patch.dueDate would regress clearFields).
        const remindersChanged = cleared.has('reminders')
          ? (existing.reminders?.length ?? 0) > 0
          : fields.reminders !== undefined &&
            JSON.stringify(existing.reminders ?? []) !==
              JSON.stringify(fields.reminders ?? []);
        const scheduleChanged =
          remindersChanged ||
          existing.dueDate !== nextDueDate ||
          existing.hasTime !== nextHasTime ||
          existing.dueAt !== nextDueAt;

        if (scheduleChanged) {
          // Cancel all old pending jobs (whole-task), then reschedule only
          // for personally-incomplete active members (spec §8.2).
          await cancelPendingJobsForTaskHelper(ctx, id);
          await scheduleGeneralReminderJobsForTask(
            ctx,
            id,
            communityId,
            patch.reminders,
            { dueDate: nextDueDate, hasTime: nextHasTime, dueAt: nextDueAt },
            { excludePersonallyCompleted: true }
          );
        }
        // Case D (no schedule change, e.g. title-only edit) → no-op.
      }
    }
  },
});

export const toggleSubtaskCompleted = mutation({
  args: { id: v.id('tasks'), subtaskId: v.string() },
  handler: async (ctx, { id, subtaskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    if (!isUserParticipantInTask(existing, userId)) {
      throw new Error('אין הרשאה לעדכן משימה זו');
    }
    if (
      existing.createdBy !== userId &&
      !(existing.allowParticipantEditing ?? false)
    ) {
      throw new Error('יוצר/ת המשימה לא אפשר/ה עריכת תתי־משימות');
    }

    const subtasks = existing.subtasks ?? [];
    const nextSubtasks = subtasks.map((subtask) =>
      subtask.id === subtaskId
        ? { ...subtask, completed: !subtask.completed }
        : subtask
    );

    await ctx.db.patch(id, {
      subtasks: nextSubtasks,
      updatedAt: Date.now(),
    });
  },
});

export const setSubtaskAttachment = mutation({
  args: {
    id: v.id('tasks'),
    subtaskId: v.string(),
    attachment: v.optional(
      v.object({
        id: v.string(),
        type: v.union(v.literal('image'), v.literal('file')),
        storageId: v.id('_storage'),
        mimeType: v.string(),
        sizeBytes: v.number(),
        createdAt: v.number(),
        originalName: v.optional(v.string()),
        displayName: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { id, subtaskId, attachment }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    if (!isUserParticipantInTask(existing, userId)) {
      throw new Error('אין הרשאה לעדכן משימה זו');
    }
    if (
      existing.createdBy !== userId &&
      !(existing.allowParticipantEditing ?? false)
    ) {
      throw new Error('יוצר/ת המשימה לא אפשר/ה עריכת תתי־משימות');
    }

    const subtasks = (existing.subtasks ?? []).map((st) =>
      st.id === subtaskId ? { ...st, attachment: attachment ?? undefined } : st
    );

    await ctx.db.patch(id, { subtasks, updatedAt: Date.now() });
  },
});

export const addSubtask = mutation({
  args: { id: v.id('tasks'), title: v.string() },
  handler: async (ctx, { id, title }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const trimmed = title.trim();
    if (!trimmed) return;

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    if (!isUserParticipantInTask(existing, userId)) {
      throw new Error('אין הרשאה לעדכן משימה זו');
    }
    if (
      existing.createdBy !== userId &&
      !(existing.allowParticipantEditing ?? false)
    ) {
      throw new Error('יוצר/ת המשימה לא אפשר/ה עריכת תתי־משימות');
    }

    const newSubtask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: trimmed,
      completed: false,
    };

    await ctx.db.patch(id, {
      subtasks: [...(existing.subtasks ?? []), newSubtask],
      updatedAt: Date.now(),
    });
  },
});

export const removeSubtask = mutation({
  args: { id: v.id('tasks'), subtaskId: v.string() },
  handler: async (ctx, { id, subtaskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    if (!isUserParticipantInTask(existing, userId)) {
      throw new Error('אין הרשאה לעדכן משימה זו');
    }
    if (
      existing.createdBy !== userId &&
      !(existing.allowParticipantEditing ?? false)
    ) {
      throw new Error('יוצר/ת המשימה לא אפשר/ה עריכת תתי־משימות');
    }

    await ctx.db.patch(id, {
      subtasks: (existing.subtasks ?? []).filter((st) => st.id !== subtaskId),
      updatedAt: Date.now(),
    });
  },
});

export const reorderSubtasks = mutation({
  args: { id: v.id('tasks'), orderedIds: v.array(v.string()) },
  handler: async (ctx, { id, orderedIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    if (!isUserParticipantInTask(existing, userId)) {
      throw new Error('אין הרשאה לעדכן משימה זו');
    }
    if (
      existing.createdBy !== userId &&
      !(existing.allowParticipantEditing ?? false)
    ) {
      throw new Error('יוצר/ת המשימה לא אפשר/ה עריכת תתי־משימות');
    }

    const subtaskMap = new Map(
      (existing.subtasks ?? []).map((st) => [st.id, st])
    );
    const reordered = orderedIds
      .map((sid) => subtaskMap.get(sid))
      .filter((st): st is NonNullable<typeof st> => st !== undefined);

    // append any subtasks not in the provided order list (safety)
    for (const st of existing.subtasks ?? []) {
      if (!orderedIds.includes(st.id)) reordered.push(st);
    }

    await ctx.db.patch(id, {
      subtasks: reordered,
      updatedAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת משימה
// ─────────────────────────────────────────────────────────────
export const remove = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('משימה לא נמצאה');

    // Community reminder (communityId set, no sourceType) — creator, owner,
    // or admin may delete.  A regular active member may not delete another
    // person's reminder.
    if (
      existing.communityId !== undefined &&
      existing.sourceType === undefined
    ) {
      const isCreator = existing.createdBy === userId;
      const membership = await getCommunityMembership(
        ctx,
        existing.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('אין לך הרשאה למחוק משימה זו');
      }
      const isManagerRole =
        membership.role === 'owner' || membership.role === 'admin';
      if (!isCreator && !isManagerRole) {
        throw new Error('אין לך הרשאה למחוק משימה זו');
      }
    } else {
      // Personal task or event-linked task — participant check, consistent
      // with the same gate used by update() and toggleCompleted().
      if (!isUserParticipantInTask(existing, userId)) {
        throw new Error('אין לך הרשאה למחוק משימה זו');
      }
    }

    // Cancel any pending scheduled reminders before the row is deleted so no
    // orphaned scheduled functions fire after the task is gone.
    await cancelPendingJobsForTaskHelper(ctx, id);

    // Clean up all taskParticipantSettings rows for this task.
    // Uses the by_task index so cleanup is exhaustive — it covers every row
    // ever written for this task, including rows for users who left or were
    // removed from the community after their completion was recorded.
    // Iterating current communityMembers would miss those former members.
    const allParticipantSettings = await ctx.db
      .query('taskParticipantSettings')
      .withIndex('by_task', (q) => q.eq('taskId', id))
      .collect();

    for (const row of allParticipantSettings) {
      await ctx.db.delete(row._id);
    }

    // Delete storage objects referenced only by this task.
    // Before physically deleting, deleteStorageIfUnreferenced checks that the
    // storageId is not still referenced by any event attachment. This prevents
    // a foreign storageId (introduced via create/update) from destroying an
    // event's file when the task is deleted.
    // Cross-task reference checking is omitted (no storageId index); see the
    // deleteStorageIfUnreferenced JSDoc for the known MVP limitation.
    const ownedStorageIds = new Set([
      ...storageIdsFromTaskAttachments(existing.attachments),
      ...storageIdsFromSubtaskImages(existing.subtasks),
    ]);
    for (const sid of ownedStorageIds) {
      await safeDeleteStorageIfUnreferenced(ctx, sid as Id<'_storage'>, {
        taskId: id,
      });
    }

    await ctx.db.delete(id);
  },
});

export const addEventImportantItemsToMyTasks = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('האירוע לא נמצא');

    if (event.communityId) {
      const communityId = event.communityId;
      const membership = await ctx.db
        .query('communityMembers')
        .withIndex('by_community_user', (q) =>
          q.eq('communityId', communityId).eq('userId', userId)
        )
        .unique();
      if (!isActiveCommunityMember(membership)) {
        throw new Error('אין הרשאה לצפות באירוע');
      }
    } else if (event.createdBy !== userId) {
      throw new Error('אין הרשאה לצפות באירוע');
    }

    const importantItems = event.importantItems ?? [];
    if (importantItems.length === 0) {
      return { created: 0, alreadyExisted: 0 };
    }

    // Check if an active bundle task already exists for this user + event.
    const existingBundle = await ctx.db
      .query('tasks')
      .withIndex('by_assigned_source_event', (q) =>
        q.eq('assignedTo', userId).eq('sourceEventId', eventId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('sourceType'), 'community_event_important_items_bundle'),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .first();

    if (existingBundle) {
      return { created: 0, alreadyExisted: 1 };
    }

    const membership = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();
    const user = membership?.spaceId ? null : await ctx.db.get(userId);
    const spaceId = membership?.spaceId ?? user?.defaultSpaceId;

    const dueDate = getImportantItemDueDate(event.startTime);

    const subtasks = buildImportantItemsBundleSubtasks(importantItems);

    await ctx.db.insert('tasks', {
      title: buildImportantItemsBundleTaskTitle(event.title),
      completed: false,
      subtasks,
      spaceId,
      assignedTo: userId,
      communityId: event.communityId,
      dueDate,
      ...(dueDate !== undefined && { hasTime: true }),
      isAiGenerated: false,
      createdBy: userId,
      createdAt: Date.now(),
      sourceType: 'community_event_important_items_bundle',
      sourceEventId: eventId,
    });

    return { created: 1, alreadyExisted: 0 };
  },
});

export const hasUserCopiedAllImportantItemsFromEvent = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { totalItems: 0, copiedItems: 0, allCopied: false };
    }

    const event = await ctx.db.get(eventId);
    if (!event) {
      return { totalItems: 0, copiedItems: 0, allCopied: false };
    }

    if (event.communityId) {
      const communityId = event.communityId;
      const membership = await ctx.db
        .query('communityMembers')
        .withIndex('by_community_user', (q) =>
          q.eq('communityId', communityId).eq('userId', userId)
        )
        .unique();
      if (!isActiveCommunityMember(membership)) {
        return { totalItems: 0, copiedItems: 0, allCopied: false };
      }
    } else if (event.createdBy !== userId) {
      return { totalItems: 0, copiedItems: 0, allCopied: false };
    }

    const totalItems = event.importantItems?.length ?? 0;
    if (totalItems === 0) {
      return { totalItems: 0, copiedItems: 0, allCopied: false };
    }

    // Source of truth: an active bundle task exists for this user + event.
    const bundleTask = await ctx.db
      .query('tasks')
      .withIndex('by_assigned_source_event', (q) =>
        q.eq('assignedTo', userId).eq('sourceEventId', eventId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('sourceType'), 'community_event_important_items_bundle'),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .first();

    if (bundleTask) {
      return { totalItems, copiedItems: totalItems, allCopied: true };
    }
    return { totalItems, copiedItems: 0, allCopied: false };
  },
});

// ─────────────────────────────────────────────────────────────
// Toggles a personal "חשוב לזכור" task linked to a community
// event important item. If the task doesn't exist yet, it is
// created in a completed state (first tap = done).
// Subsequent calls toggle the task's completed state.
// This enables two-way sync: the same task record drives both
// the event-detail checkbox and the "המשימות שלי" list.
// ─────────────────────────────────────────────────────────────
export const toggleImportantItemCheck = mutation({
  args: {
    eventId: v.id('events'),
    itemId: v.string(),
    itemTitle: v.string(),
  },
  handler: async (ctx, { eventId, itemId, itemTitle }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existingTask = await ctx.db
      .query('tasks')
      .withIndex('by_assigned_source_event', (q) =>
        q.eq('assignedTo', userId).eq('sourceEventId', eventId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('sourceImportantItemId'), itemId),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .first();

    if (existingTask) {
      const nowCompleted = !existingTask.completed;
      await ctx.db.patch(existingTask._id, {
        completed: nowCompleted,
        completedAt: nowCompleted ? Date.now() : undefined,
      });
    } else {
      const event = await ctx.db.get(eventId);
      if (!event) throw new Error('האירוע לא נמצא');

      const membershipRow = await ctx.db
        .query('members')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .first();
      const user = membershipRow?.spaceId ? null : await ctx.db.get(userId);
      const spaceId = membershipRow?.spaceId ?? user?.defaultSpaceId;

      let communityName: string | undefined;
      if (event.communityId) {
        const community = await ctx.db.get(event.communityId);
        communityName = community?.name;
      }
      const descriptionParts: string[] = [];
      if (communityName) descriptionParts.push(`קהילה: ${communityName}`);
      descriptionParts.push(`אירוע: ${event.title}`);
      const description =
        descriptionParts.length > 0 ? descriptionParts.join(' · ') : undefined;

      await ctx.db.insert('tasks', {
        title: itemTitle,
        description,
        completed: true,
        completedAt: Date.now(),
        spaceId,
        assignedTo: userId,
        communityId: event.communityId,
        category: 'אירועים',
        dueDate: getImportantItemDueDate(event.startTime),
        isAiGenerated: false,
        createdBy: userId,
        createdAt: Date.now(),
        sourceType: 'community_event_important_item',
        sourceEventId: eventId,
        sourceImportantItemId: itemId,
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────
// Returns a nested map: eventId → { itemId: completed }
// for all "חשוב לזכור" personal tasks the current user has.
// Used to drive personal checkboxes in event detail, home, and
// timeline — a single reactive query shared across all screens.
// ─────────────────────────────────────────────────────────────
export const getMyImportantItemChecks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return {} as Record<string, Record<string, boolean>>;

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_assigned', (q) => q.eq('assignedTo', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('sourceType'), 'community_event_important_item'),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .collect();

    const result: Record<string, Record<string, boolean>> = {};
    for (const task of tasks) {
      if (!task.sourceEventId || !task.sourceImportantItemId) continue;
      const eventKey = String(task.sourceEventId);
      if (!result[eventKey]) result[eventKey] = {};
      result[eventKey][task.sourceImportantItemId] = task.completed;
    }
    return result;
  },
});

// ─────────────────────────────────────────────────────────────
// Returns a map: eventId (string) → true when the current user already has
// an active "חשוב לזכור" bundle task (sourceType ===
// 'community_event_important_items_bundle') for that event — i.e. the
// canonical "already added to my tasks" state.
//
// One bounded, indexed scan for the authenticated user — reused as the
// SINGLE source of "already added" truth across Home, the community
// "תזכורות" tab, and Event Details, so all three surfaces agree without
// each needing its own per-event query (see the Home N+1 safety note on
// the Home screen's call site).
// ─────────────────────────────────────────────────────────────
export const getMyImportantItemsBundleStatus = query({
  args: {},
  returns: v.record(v.string(), v.boolean()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return {};

    const bundleTasks = await ctx.db
      .query('tasks')
      .withIndex('by_assigned', (q) => q.eq('assignedTo', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('sourceType'), 'community_event_important_items_bundle'),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .collect();

    const result: Record<string, boolean> = {};
    for (const task of bundleTasks) {
      if (!task.sourceEventId) continue;
      result[String(task.sourceEventId)] = true;
    }
    return result;
  },
});

// ─────────────────────────────────────────────────────────────
// Returns all personal "חשוב לזכור" tasks for the current user,
// enriched with event title / date and community name, so the
// Tasks screen can render them under "משימות מאירועים".
// ─────────────────────────────────────────────────────────────
export const listMyImportantItemTasks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_assigned', (q) => q.eq('assignedTo', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('sourceType'), 'community_event_important_item'),
          q.eq(q.field('deletedAt'), undefined)
        )
      )
      .collect();

    const results = await Promise.all(
      tasks.map(async (task) => {
        if (!task.sourceEventId) return null;

        const event = await ctx.db.get(task.sourceEventId);
        if (!event) return null;

        // Only surface items that still exist in the event
        const currentItemIds = new Set(
          (event.importantItems ?? []).map((i) => i.id)
        );
        const stillValid =
          task.sourceImportantItemId !== undefined &&
          currentItemIds.has(task.sourceImportantItemId);
        if (!stillValid) return null;

        let communityName = '';
        if (event.communityId) {
          const community = await ctx.db.get(event.communityId);
          communityName = community?.name ?? '';
        }

        return {
          _id: task._id,
          title: task.title,
          completed: task.completed,
          eventTitle: event.title,
          eventStartTime: event.startTime,
          eventAllDay: event.allDay ?? false,
          communityName,
        };
      })
    );

    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקה רכה (soft delete) של משימה אישית
// ─────────────────────────────────────────────────────────────
export const softDeleteTask = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');

    if (!isPersonallyDeletableTask(task, userId)) {
      throw new Error('לא ניתן למחוק משימה זו');
    }

    // Idempotent — already soft-deleted
    if (task.deletedAt !== undefined) return;

    const now = Date.now();
    await ctx.db.patch(id, {
      deletedAt: now,
      // TODO: Future cleanup cron should hard-delete expired soft-deleted tasks after deleteExpiresAt and safely clean related subtasks, shopping data, attachments, previews, and Convex Storage files.
      deleteExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
      deletedBy: userId,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// שחזור משימה שנמחקה רכה
// ─────────────────────────────────────────────────────────────
export const restoreTask = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(id);
    if (!task) throw new Error('משימה לא נמצאה');

    if (task.deletedBy !== userId) {
      throw new Error('אין הרשאה לשחזר משימה זו');
    }

    await ctx.db.patch(id, {
      deletedAt: undefined,
      deleteExpiresAt: undefined,
      deletedBy: undefined,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// רשימת פריטים שנמחקו לאחרונה (עבור מסך "נמחקו לאחרונה")
// מחזיר רק משימות; ניתן להרחיב בעתיד לסוגי פריטים נוספים.
// ─────────────────────────────────────────────────────────────
export const listRecentlyDeleted = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_deleted_by', (q) => q.eq('deletedBy', userId))
      .filter((q) => q.neq(q.field('deletedAt'), undefined))
      .order('desc')
      .collect();

    return tasks.map((task) => ({
      id: task._id,
      type: 'task' as const,
      title: task.title,
      deletedAt: task.deletedAt,
      deleteExpiresAt: task.deleteExpiresAt,
    }));
  },
});

// ─────────────────────────────────────────────────────────────
// תזכורת אישית של המשתתף — קריאה
// ─────────────────────────────────────────────────────────────
export const getMyTaskReminder = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query('taskParticipantSettings')
      .withIndex('by_task_user', (q) =>
        q.eq('taskId', taskId).eq('userId', userId)
      )
      .unique();
  },
});

// ─────────────────────────────────────────────────────────────
// עדכון תזכורת אישית של המשתתף בלבד
// לא משפיע על תזכורות שאר המשתתפים / היוצר
// ─────────────────────────────────────────────────────────────
export const updateMyTaskReminder = mutation({
  args: {
    taskId: v.id('tasks'),
    reminders: v.optional(v.array(taskReminderValidator)),
    reminderType: v.optional(taskReminderTypeValidator),
    customReminderAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { taskId, reminders, reminderType, customReminderAt }
  ) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(taskId);
    if (!task) throw new Error('משימה לא נמצאה');

    if (!isUserParticipantInTask(task, userId)) {
      throw new Error('אין הרשאה לעדכן תזכורת למשימה זו');
    }

    const existing = await ctx.db
      .query('taskParticipantSettings')
      .withIndex('by_task_user', (q) =>
        q.eq('taskId', taskId).eq('userId', userId)
      )
      .unique();

    const settingsData = { reminders, reminderType, customReminderAt };

    if (existing) {
      if (existing.leftAt !== undefined) {
        throw new Error('עזבת את המשימה הזו');
      }
      await ctx.db.patch(existing._id, settingsData);
    } else {
      await ctx.db.insert('taskParticipantSettings', {
        taskId,
        userId,
        ...settingsData,
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────
// עזיבת משימה משותפת (משתתף שאינו יוצר)
// המשימה נשארת אצל שאר המשתתפים והיוצר
// ─────────────────────────────────────────────────────────────
export const leaveTask = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const task = await ctx.db.get(taskId);
    if (!task) throw new Error('משימה לא נמצאה');

    if (task.createdBy === userId) {
      throw new Error('יוצר/ת המשימה לא יכול/ה לעזוב. מחק/י את המשימה במקום.');
    }

    if (!isUserParticipantInTask(task, userId)) {
      throw new Error('אינך משתתף/ת במשימה זו');
    }

    // Remove user from assignees
    const newUserIds = (task.assignedToUserIds ?? []).filter(
      (id) => String(id) !== String(userId)
    );
    const newAssignedTo =
      task.assignedTo === userId
        ? (newUserIds[0] ?? task.createdBy)
        : task.assignedTo;

    await ctx.db.patch(taskId, {
      assignedToUserIds: newUserIds.length > 0 ? newUserIds : undefined,
      assignedTo: newAssignedTo,
      updatedAt: Date.now(),
    });

    // Record the leave in taskParticipantSettings
    const existing = await ctx.db
      .query('taskParticipantSettings')
      .withIndex('by_task_user', (q) =>
        q.eq('taskId', taskId).eq('userId', userId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { leftAt: Date.now() });
    } else {
      await ctx.db.insert('taskParticipantSettings', {
        taskId,
        userId,
        leftAt: Date.now(),
      });
    }
  },
});
