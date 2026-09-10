/**
 * Regression tests for the Community Event task unassignment bug.
 *
 * BUG: editing an existing Community Event, removing an assignee (e.g.
 * "יניב" on "להביא נעלי קטרגל") in the "עריכת אירוע קהילתי" editor, and
 * pressing "שמור אירוע" did NOT actually clear the persisted assignment.
 * The community task Bottom Sheet still showed the removed assignee, and
 * that member still saw the task as assigned to them on Home/Calendar.
 *
 * ROOT CAUSE: app/(authenticated)/event-edit/[id].tsx computed the
 * form's "current assignee" as
 *   `task.assignedParticipantIds?.[0] ?? task.assigneeId`
 * — but `assigneeId` is a deprecated field captured once at form-load
 * time and NEVER updated afterwards, while `assignedParticipantIds` is
 * the authoritative, live field the assign sheet actually mutates
 * (including clearing it to `[]`). Once cleared, `[][0]` is `undefined`,
 * and `undefined ?? task.assigneeId` silently fell back to the ORIGINAL,
 * stale assignee — making the save handler conclude "nothing changed"
 * and skip the `eventTasks.setAssignee` mutation entirely, even though
 * the editor's UI showed the task as unassigned.
 *
 * These tests exercise `lib/eventTaskAssignmentDiff.ts` directly — the
 * exact pure functions the real save handler in
 * app/(authenticated)/event-edit/[id].tsx calls to decide whether/how to
 * call `eventTasks.setAssignee`. This is the actual affected
 * mutation-decision path, not a parallel reimplementation of it.
 *
 * `getTaskAssignmentClearAuthorization` (convex/eventTasks.ts) is the
 * exact server-side authorization `setAssignee` calls when clearing an
 * assignment — covering "unauthorized users cannot alter assignments"
 * for the unassign path specifically exercised by this bug report.
 *
 * Run with: bun test
 */

import { describe, expect, it } from 'bun:test';
import { getTaskAssignmentClearAuthorization } from '../../convex/eventTasks';
import {
  resolveCommunityTaskAssignmentDiff,
  resolveFormAssignedParticipantId,
  resolvePersonalTaskAssignmentDiff,
} from '../../lib/eventTaskAssignmentDiff';

const YANIV = 'user_yaniv';
const CURRENT_USER = 'user_me';
const DANA = 'user_dana';

describe('resolveFormAssignedParticipantId — the actual bug', () => {
  it('[TEST 1] returns undefined when assignedParticipantIds was explicitly cleared (not the stale assigneeId)', () => {
    // Editor removed Yaniv via the assign sheet: assignedParticipantIds
    // becomes [], but the deprecated assigneeId snapshot is untouched.
    const pid = resolveFormAssignedParticipantId({
      assigneeId: YANIV,
      assignedParticipantIds: [],
    });
    expect(pid).toBeUndefined();
  });

  it('falls back to assigneeId only when assignedParticipantIds was never set at all', () => {
    const pid = resolveFormAssignedParticipantId({
      assigneeId: YANIV,
      assignedParticipantIds: undefined,
    });
    expect(pid).toBe(YANIV);
  });

  it('returns the live selected participant id when present', () => {
    const pid = resolveFormAssignedParticipantId({
      assigneeId: YANIV,
      assignedParticipantIds: [DANA],
    });
    expect(pid).toBe(DANA);
  });
});

describe('resolveCommunityTaskAssignmentDiff — Community Event save path', () => {
  it('[TEST 1] removing an existing assignee produces changed=true with assignee=null (the bug)', () => {
    const task = { assigneeId: YANIV, assignedParticipantIds: [] };
    const orig = { assignedToUserId: YANIV };
    const diff = resolveCommunityTaskAssignmentDiff(task, orig);
    expect(diff.changed).toBe(true);
    expect(diff.assignee).toBeNull();
  });

  it('[TEST 2] unrelated edits with the assignment untouched produce changed=false', () => {
    // Task never opened in the assign sheet — assignedParticipantIds
    // still mirrors the form-load snapshot exactly.
    const task = { assigneeId: YANIV, assignedParticipantIds: [YANIV] };
    const orig = { assignedToUserId: YANIV };
    const diff = resolveCommunityTaskAssignmentDiff(task, orig);
    expect(diff.changed).toBe(false);
  });

  it('an untouched, never-assigned task produces changed=false', () => {
    const task = { assigneeId: undefined, assignedParticipantIds: [] };
    const orig = {};
    const diff = resolveCommunityTaskAssignmentDiff(task, orig);
    expect(diff.changed).toBe(false);
  });

  it('[TEST 3] changing the assignee from one user to another produces changed=true with the NEW userId', () => {
    const task = { assigneeId: YANIV, assignedParticipantIds: [DANA] };
    const orig = { assignedToUserId: YANIV };
    const diff = resolveCommunityTaskAssignmentDiff(task, orig);
    expect(diff.changed).toBe(true);
    expect(diff.assignee).toEqual({ type: 'user', userId: DANA });
  });

  it('assigning a previously-unassigned task produces changed=true with the new userId', () => {
    const task = { assigneeId: undefined, assignedParticipantIds: [DANA] };
    const orig = {};
    const diff = resolveCommunityTaskAssignmentDiff(task, orig);
    expect(diff.changed).toBe(true);
    expect(diff.assignee).toEqual({ type: 'user', userId: DANA });
  });

  it('a legacy manual assignment is always reported changed, even if the pid looks unchanged', () => {
    // Legacy Community task with a manual (non-account) assignee — must
    // always be resolved through setAssignee (per assertCommunityTaskAssigneeAllowed's
    // "clearing a legacy manual assignment is always allowed" contract).
    const task = { assigneeId: undefined, assignedParticipantIds: [] };
    const orig = { assignedToManual: 'שם ידני' };
    const diff = resolveCommunityTaskAssignmentDiff(task, orig);
    expect(diff.changed).toBe(true);
    expect(diff.assignee).toBeNull();
  });
});

describe('resolvePersonalTaskAssignmentDiff — Personal Event save path', () => {
  const participants = [
    { id: CURRENT_USER, name: 'אני' },
    { id: DANA, name: 'דנה' },
  ];

  it('removing an existing manual assignee produces changed=true with assignee=null', () => {
    const task = { assigneeId: DANA, assignedParticipantIds: [] };
    const orig = { assignedToManual: 'דנה' };
    const diff = resolvePersonalTaskAssignmentDiff(task, orig, participants);
    expect(diff.changed).toBe(true);
    expect(diff.assignee).toBeNull();
  });

  it('unrelated edits with the assignment untouched produce changed=false', () => {
    const task = { assigneeId: DANA, assignedParticipantIds: [DANA] };
    const orig = { assignedToManual: 'דנה' };
    const diff = resolvePersonalTaskAssignmentDiff(task, orig, participants);
    expect(diff.changed).toBe(false);
  });

  it('changing the assignee to a different participant produces changed=true with the new name', () => {
    const task = { assigneeId: DANA, assignedParticipantIds: [CURRENT_USER] };
    const orig = { assignedToManual: 'דנה' };
    const diff = resolvePersonalTaskAssignmentDiff(task, orig, participants);
    expect(diff.changed).toBe(true);
    expect(diff.assignee).toEqual({ type: 'manual', name: 'אני' });
  });
});

describe('getTaskAssignmentClearAuthorization — unassign permission (setAssignee)', () => {
  it('[TEST 5] a plain member who is not the assignee cannot clear another member’s assignment', () => {
    const authz = getTaskAssignmentClearAuthorization({
      canManageAssignments: false,
      isAssignedUser: false,
      hasManual: false,
    });
    expect(authz.allowed).toBe(false);
    if (!authz.allowed) {
      expect(authz.reason).toBe('רק הממונה או יוצר האירוע יכולים לבטל הקצאה');
    }
  });

  it('[TEST 5] the assigned member CAN unclaim their own task (existing claim/unclaim semantics)', () => {
    const authz = getTaskAssignmentClearAuthorization({
      canManageAssignments: false,
      isAssignedUser: true,
      hasManual: false,
    });
    expect(authz.allowed).toBe(true);
  });

  it('[TEST 5] the event creator/admin CAN clear another member’s assignment (the editor scenario)', () => {
    const authz = getTaskAssignmentClearAuthorization({
      canManageAssignments: true,
      isAssignedUser: false,
      hasManual: false,
    });
    expect(authz.allowed).toBe(true);
  });

  it('[TEST 5] a non-manager cannot clear a legacy manual assignment, even if somehow "assigned"', () => {
    const authz = getTaskAssignmentClearAuthorization({
      canManageAssignments: false,
      isAssignedUser: true,
      hasManual: true,
    });
    expect(authz.allowed).toBe(false);
    if (!authz.allowed) {
      expect(authz.reason).toBe('רק יוצר האירוע יכול לשנות הקצאה ידנית');
    }
  });

  it('[TEST 5] a manager CAN clear a legacy manual assignment', () => {
    const authz = getTaskAssignmentClearAuthorization({
      canManageAssignments: true,
      isAssignedUser: false,
      hasManual: true,
    });
    expect(authz.allowed).toBe(true);
  });
});
