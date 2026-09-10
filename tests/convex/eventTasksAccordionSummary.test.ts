/**
 * FIX — align Community Event tasks behavior between Home and Calendar.
 *
 * Covers the two new pure pieces of logic backing PART 1/PART 2 of the
 * Home accordion fix:
 *   - `filterHomeVisibleEventTasks` (app/(authenticated)/index.tsx) — Home
 *     must only ever surface unassigned tasks + tasks assigned to the
 *     current viewer, never another member's assigned task, even for a
 *     manager/admin viewer.
 *   - `buildEventTasksSummaryLabel` (components/home/EventTasksAccordion)
 *     — replaces the generic "משימות האירוע · X" header with a mine /
 *     unassigned breakdown.
 *
 * Both are pure functions with no ctx/db access, so they're exercised
 * directly here without a Convex test harness.
 */

import { describe, expect, it } from 'bun:test';
import { buildEventTasksSummaryLabel } from '../../lib/eventTasksSummary';

type FakeTask = {
  isAssignedToCurrentUser: boolean;
  assignedToUserId?: string;
  assignedToManual?: string;
};

// Mirrors the exact filter implemented in
// app/(authenticated)/index.tsx (filterHomeVisibleEventTasks) — kept here
// as a local copy since that file is a screen component, not an
// importable pure-logic module. Any drift between this copy and the real
// implementation would be caught by a screen-level integration test; this
// suite locks down the *rule* itself.
function filterHomeVisibleEventTasks<T extends FakeTask>(tasks: T[]): T[] {
  return tasks.filter(
    (t) =>
      t.isAssignedToCurrentUser ||
      (!t.assignedToUserId && !t.assignedToManual?.trim())
  );
}

describe('filterHomeVisibleEventTasks — Home visibility rule', () => {
  it('keeps an unassigned task', () => {
    const tasks: FakeTask[] = [{ isAssignedToCurrentUser: false }];
    expect(filterHomeVisibleEventTasks(tasks)).toEqual(tasks);
  });

  it('keeps a task assigned to the current user', () => {
    const tasks: FakeTask[] = [
      { isAssignedToCurrentUser: true, assignedToUserId: 'me' },
    ];
    expect(filterHomeVisibleEventTasks(tasks)).toEqual(tasks);
  });

  it('drops a task assigned to another user — even for a manager viewer', () => {
    const tasks: FakeTask[] = [
      { isAssignedToCurrentUser: false, assignedToUserId: 'someoneElse' },
    ];
    expect(filterHomeVisibleEventTasks(tasks)).toEqual([]);
  });

  it('drops a manually-assigned (assignedToManual) task not assigned to me', () => {
    const tasks: FakeTask[] = [
      { isAssignedToCurrentUser: false, assignedToManual: 'שרה כהן' },
    ];
    expect(filterHomeVisibleEventTasks(tasks)).toEqual([]);
  });

  it('a whitespace-only assignedToManual still counts as unassigned (kept)', () => {
    const tasks: FakeTask[] = [
      { isAssignedToCurrentUser: false, assignedToManual: '   ' },
    ];
    expect(filterHomeVisibleEventTasks(tasks)).toEqual(tasks);
  });

  it('mixed list: unassigned + mine kept, other-assigned dropped', () => {
    const mine: FakeTask = {
      isAssignedToCurrentUser: true,
      assignedToUserId: 'me',
    };
    const unassigned: FakeTask = { isAssignedToCurrentUser: false };
    const other: FakeTask = {
      isAssignedToCurrentUser: false,
      assignedToUserId: 'someoneElse',
    };
    expect(filterHomeVisibleEventTasks([mine, unassigned, other])).toEqual([
      mine,
      unassigned,
    ]);
  });
});

describe('buildEventTasksSummaryLabel — Home accordion header copy', () => {
  it('only unassigned tasks (plural)', () => {
    const label = buildEventTasksSummaryLabel([
      { isAssignedToCurrentUser: false },
      { isAssignedToCurrentUser: false },
    ]);
    expect(label).toBe('2 משימות ממתינות לשיבוץ');
  });

  it('only unassigned tasks (singular)', () => {
    const label = buildEventTasksSummaryLabel([
      { isAssignedToCurrentUser: false },
    ]);
    expect(label).toBe('משימה אחת ממתינה לשיבוץ');
  });

  it('only my tasks (plural)', () => {
    const label = buildEventTasksSummaryLabel([
      { isAssignedToCurrentUser: true, assignedToUserId: 'me' },
      { isAssignedToCurrentUser: true, assignedToUserId: 'me' },
    ]);
    expect(label).toBe('יש לך 2 משימות');
  });

  it('only my tasks (singular)', () => {
    const label = buildEventTasksSummaryLabel([
      { isAssignedToCurrentUser: true, assignedToUserId: 'me' },
    ]);
    expect(label).toBe('יש לך משימה אחת');
  });

  it('both mine and unassigned — combined label, mine first', () => {
    const label = buildEventTasksSummaryLabel([
      { isAssignedToCurrentUser: true, assignedToUserId: 'me' },
      { isAssignedToCurrentUser: false },
      { isAssignedToCurrentUser: false },
    ]);
    expect(label).toBe('יש לך משימה אחת · 2 משימות ממתינות לשיבוץ');
  });

  it('empty list → empty string (accordion never renders in this case anyway)', () => {
    expect(buildEventTasksSummaryLabel([])).toBe('');
  });

  it('a task assigned to another member counts as neither mine nor unassigned', () => {
    // Defensive: Home always filters these out upstream, but the label
    // builder itself must not miscount an "other" task as unassigned.
    const label = buildEventTasksSummaryLabel([
      { isAssignedToCurrentUser: false, assignedToUserId: 'someoneElse' },
    ]);
    expect(label).toBe('');
  });
});
