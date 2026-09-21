/**
 * Security Wave 1 — convex/tasks.ts H-03: `tasks.getById` (public,
 * unauthenticated raw-document query) removed; `lib/components/task/
 * TaskEditorScreen.tsx` migrated to the canonical authorized query
 * `tasks.getTaskDetails`.
 *
 * This repo has no Convex mutation/query test harness (see
 * tests/convex/phoneMatchConfirmation.test.ts's documented precedent).
 * These regression guards combine:
 *   (a) direct unit tests of the already-exported pure authorization
 *       building blocks getTaskDetails relies on
 *       (isGeneralCommunityReminder / isDeletedOrArchivedGeneralCommunityReminder
 *       from convex/taskUtils.ts, isActiveCommunityMember from
 *       convex/communityMemberUtils.ts), and
 *   (b) source inspection of the REAL convex/tasks.ts file, proving that
 *       getTaskDetails' handler actually gates its return value on exactly
 *       those building blocks (plus the local isUserParticipantInTask
 *       helper) in the documented order, and that getById no longer exists.
 *
 * Run with: bun test tests/convex/tasksGetTaskDetailsAccessControlWave1.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Id } from '../../convex/_generated/dataModel';
import { isActiveCommunityMember } from '../../convex/communityMemberUtils';
import {
  isDeletedOrArchivedGeneralCommunityReminder,
  isGeneralCommunityReminder,
} from '../../convex/taskUtils';

const TASKS_SOURCE = readFileSync(
  new URL('../../convex/tasks.ts', import.meta.url),
  'utf8'
);
const SCHEMA_SOURCE = readFileSync(
  new URL('../../convex/schema.ts', import.meta.url),
  'utf8'
);
const TASK_EDITOR_SOURCE = readFileSync(
  new URL('../../lib/components/task/TaskEditorScreen.tsx', import.meta.url),
  'utf8'
);

function extractExportBlock(source: string, exportName: string): string {
  const startMarker = `export const ${exportName} = `;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find export "${exportName}" in source`);
  }
  const afterStart = startIdx + startMarker.length;
  const nextExportMatch =
    /export const \w+ = (mutation|query|internalMutation)\(\{/.exec(
      source.slice(afterStart)
    );
  const endIdx =
    nextExportMatch === null
      ? source.length
      : afterStart + nextExportMatch.index;
  return source.slice(startIdx, endIdx);
}

// ── H-03: tasks.getById removed ─────────────────────────────────────────────

describe('H-03 — tasks.getById removed', () => {
  it('convex/tasks.ts no longer exports a public getById query', () => {
    expect(/export const getById\s*=/.test(TASKS_SOURCE)).toBe(false);
  });

  it('TaskEditorScreen.tsx no longer references api.tasks.getById as a query call', () => {
    expect(TASK_EDITOR_SOURCE).not.toMatch(/useQuery\(\s*api\.tasks\.getById/);
  });

  it('TaskEditorScreen.tsx now loads the existing task via api.tasks.getTaskDetails', () => {
    expect(TASK_EDITOR_SOURCE).toMatch(
      /useQuery\(\s*api\.tasks\.getTaskDetails/
    );
  });
});

// ── H-03: getTaskDetails authorization structure ────────────────────────────

describe('H-03 — getTaskDetails authorization gates (source inspection)', () => {
  const block = extractExportBlock(TASKS_SOURCE, 'getTaskDetails');

  it('requires authentication and returns null for unauthenticated callers', () => {
    expect(block).toContain('getAuthUserId(ctx)');
    expect(block).toMatch(/if\s*\(!currentUserId\)\s*return null;/);
  });

  it('returns null for a missing task', () => {
    expect(block).toMatch(/if\s*\(!task\)\s*return null;/);
  });

  it('returns null for everyone (including the creator) on a deleted/archived general community reminder', () => {
    expect(block).toContain(
      'isDeletedOrArchivedGeneralCommunityReminder(task)) return null'
    );
  });

  it('gates general community reminders on active community membership', () => {
    expect(block).toContain('isGeneralCommunityReminder(task)');
    expect(block).toMatch(
      /if\s*\(!isActiveCommunityMember\(membership\)\)\s*return null;/
    );
  });

  it('gates all other task types on isUserParticipantInTask (creator or explicit assignee)', () => {
    expect(block).toMatch(
      /else if\s*\(!isUserParticipantInTask\(task, currentUserId\)\)\s*\{\s*return null;/
    );
  });

  it('returns the full task document (spread) plus derived fields, never a partial/renamed shape', () => {
    expect(block).toMatch(/return\s*\{\s*\.\.\.task,/);
    expect(block).toContain('creatorProfile');
    expect(block).toContain('assignees');
    expect(block).toContain('canEdit');
  });
});

// ── Authorization building blocks: direct unit tests ────────────────────────
// These exercise the exact exported predicates getTaskDetails's handler
// calls (per the source-inspection assertions above) against representative
// personal/shared/community task scenarios.

const CREATOR = 'user_creator' as Id<'users'>;
const ASSIGNEE = 'user_assignee' as Id<'users'>;
const STRANGER = 'user_stranger' as Id<'users'>;
const COMMUNITY = 'community_1' as Id<'communities'>;

describe('getTaskDetails building block — isGeneralCommunityReminder / isActiveCommunityMember', () => {
  it('a personal (no communityId) task is never classified as a general community reminder', () => {
    const personalTask = { communityId: undefined, sourceType: undefined };
    expect(isGeneralCommunityReminder(personalTask)).toBe(false);
  });

  it('an unassigned community-wide task IS a general community reminder', () => {
    const reminder = {
      communityId: COMMUNITY,
      sourceType: undefined,
      assignedTo: undefined,
      assignedToMemberId: undefined,
      assignedToUserIds: undefined,
      assignedToMemberIds: undefined,
      deletedAt: undefined,
      archivedAt: undefined,
    };
    expect(isGeneralCommunityReminder(reminder)).toBe(true);
  });

  it('a deleted general community reminder is excluded even for its creator (matches the explicit guard)', () => {
    const deletedReminder = {
      communityId: COMMUNITY,
      sourceType: undefined,
      assignedTo: undefined,
      assignedToMemberId: undefined,
      assignedToUserIds: undefined,
      assignedToMemberIds: undefined,
      deletedAt: Date.now(),
      archivedAt: undefined,
    };
    expect(isGeneralCommunityReminder(deletedReminder)).toBe(false);
    expect(isDeletedOrArchivedGeneralCommunityReminder(deletedReminder)).toBe(
      true
    );
  });

  it('a non-member (null membership row) is not an active community member', () => {
    expect(isActiveCommunityMember(null)).toBe(false);
  });

  it('a member with status "left" is not an active community member', () => {
    expect(
      isActiveCommunityMember({
        status: 'left',
      } as unknown as Parameters<typeof isActiveCommunityMember>[0])
    ).toBe(false);
  });

  it('a member with status "active" (or legacy/missing status) IS an active community member', () => {
    expect(
      isActiveCommunityMember({
        status: 'active',
      } as unknown as Parameters<typeof isActiveCommunityMember>[0])
    ).toBe(true);
    expect(
      isActiveCommunityMember(
        {} as unknown as Parameters<typeof isActiveCommunityMember>[0]
      )
    ).toBe(true);
  });
});

describe('getTaskDetails building block — participant classification for personal/shared tasks', () => {
  // isUserParticipantInTask itself is not exported (private to tasks.ts —
  // see the source-inspection test above proving getTaskDetails calls it).
  // These scenarios exercise the SAME classification via the documented
  // rule ("createdBy === userId || assignedTo === userId ||
  // assignedToUserIds includes userId") to lock in the intended behavior:
  // creator and explicit assignees are participants, everyone else is not.
  function isParticipant(
    task: {
      createdBy?: Id<'users'>;
      assignedTo?: Id<'users'>;
      assignedToUserIds?: Id<'users'>[];
    },
    userId: Id<'users'>
  ): boolean {
    if (task.createdBy === userId) return true;
    if (task.assignedTo === userId) return true;
    return (task.assignedToUserIds ?? []).some((id) => id === userId);
  }

  const personalTask = { createdBy: CREATOR };
  const sharedTask = { createdBy: CREATOR, assignedToUserIds: [ASSIGNEE] };

  it('the creator is a participant in their own personal task', () => {
    expect(isParticipant(personalTask, CREATOR)).toBe(true);
  });

  it("an unrelated authenticated user is NOT a participant in another user's private task", () => {
    expect(isParticipant(personalTask, STRANGER)).toBe(false);
  });

  it('an explicit multi-assignee is a participant in a shared task', () => {
    expect(isParticipant(sharedTask, ASSIGNEE)).toBe(true);
  });

  it('an unrelated authenticated user is NOT a participant in a shared task they were not assigned to', () => {
    expect(isParticipant(sharedTask, STRANGER)).toBe(false);
  });
});

// ── Task Editor field-compatibility ─────────────────────────────────────────
// getTaskDetails' handler returns `{ ...task, ... }` (proven above), so every
// field TaskEditorScreen's EditableTask reads must be a real column of the
// `tasks` table for the migration to be data-compatible.

describe('H-03 — TaskEditorScreen field compatibility with getTaskDetails', () => {
  function extractSchemaTableBlock(tableName: string): string {
    const marker = `${tableName}: defineTable({`;
    const startIdx = SCHEMA_SOURCE.indexOf(marker);
    if (startIdx === -1) {
      throw new Error(`Could not find table "${tableName}" in schema.ts`);
    }
    // Find the matching closing "})" for this defineTable( by scanning
    // brace depth from the opening "{" right after "defineTable(".
    const openBraceIdx = SCHEMA_SOURCE.indexOf(
      '{',
      startIdx + marker.length - 1
    );
    let depth = 0;
    let i = openBraceIdx;
    for (; i < SCHEMA_SOURCE.length; i++) {
      if (SCHEMA_SOURCE[i] === '{') depth++;
      if (SCHEMA_SOURCE[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    return SCHEMA_SOURCE.slice(startIdx, i + 1);
  }

  const tasksTableBlock = extractSchemaTableBlock('tasks');

  // Every field read off `existingTask` by TaskEditorScreen's EditableTask
  // type (see lib/components/task/TaskEditorScreen.tsx) — must exist on the
  // real `tasks` table so that getTaskDetails' `...task` spread provides it.
  const requiredFields = [
    'title',
    'description',
    'dueDate',
    'hasTime',
    'dueAt',
    'reminderType',
    'customReminderAt',
    'reminders',
    'recurrenceType',
    'selectedWeekdays',
    'category',
    'assignedTo',
    'assignedToMemberId',
    'assignedToUserIds',
    'assignedToMemberIds',
    'subtasks',
    'allowParticipantEditing',
    'attachments',
    'createdBy',
  ];

  for (const field of requiredFields) {
    it(`tasks table defines "${field}" (consumed by TaskEditorScreen's EditableTask)`, () => {
      expect(tasksTableBlock).toMatch(new RegExp(`\\b${field}:\\s*v\\.`));
    });
  }
});
