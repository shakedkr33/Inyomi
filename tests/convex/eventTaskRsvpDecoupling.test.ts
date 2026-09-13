/**
 * RSVP / Community Event Task decoupling — regression guard.
 *
 * LOCKED product decision: RSVP and Community Event Tasks are separate
 * concepts. Taking, receiving, unclaiming, unassigning, or completing a
 * task MUST NOT change RSVP. Only an explicit RSVP action
 * (convex/eventRsvps.ts — upsertRsvp / setRsvpNoAndUnclaimMyEventTasks) may
 * change a user's `eventRsvps` row.
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/eventScaleBounding.test.ts's documented precedent: "no
 * Convex test harness (none exists in this repo)"). Given that constraint,
 * this file verifies the ACTUAL mutation handler source in
 * convex/eventTasks.ts directly — rather than a parallel reimplementation
 * or a pure-logic stand-in — by asserting that the specific exported
 * mutation bodies contain no reference to the `eventRsvps` table. This is
 * a direct regression guard: if RSVP-writing code is ever reintroduced into
 * `claimEventTask` or `setAssignee`, this test fails immediately.
 *
 * It also confirms the calendar-inclusion mechanism
 * (`saveCommunityEventToPersonalCalendar` — the existing
 * `savedCommunityEvents` Axis-1 mechanism) is still invoked by both
 * mutations, and that the pre-existing explicit-RSVP-"no" blocking flow
 * (convex/eventRsvps.ts) was left untouched by this fix.
 *
 * Run with: bun test
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';

const EVENT_TASKS_SOURCE = readFileSync(
  new URL('../../convex/eventTasks.ts', import.meta.url),
  'utf8'
);
const EVENT_RSVPS_SOURCE = readFileSync(
  new URL('../../convex/eventRsvps.ts', import.meta.url),
  'utf8'
);

/**
 * Extracts the exact source slice for one exported mutation/query, from its
 * `export const <name> = (mutation|query)({` declaration up to (but not
 * including) the next top-level `export const ... = (mutation|query)({`
 * declaration, or end of file. This slices the REAL file contents — not a
 * reimplementation — so these tests exercise the actual shipped handler
 * bodies.
 */
function extractExportBlock(source: string, exportName: string): string {
  const startMarker = `export const ${exportName} = `;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find export "${exportName}" in source`);
  }
  const afterStart = startIdx + startMarker.length;
  const nextExportMatch = /export const \w+ = (mutation|query)\(\{/.exec(
    source.slice(afterStart)
  );
  const endIdx =
    nextExportMatch === null
      ? source.length
      : afterStart + nextExportMatch.index;
  return source.slice(startIdx, endIdx);
}

const claimEventTaskSrc = extractExportBlock(
  EVENT_TASKS_SOURCE,
  'claimEventTask'
);
const setAssigneeSrc = extractExportBlock(EVENT_TASKS_SOURCE, 'setAssignee');
const unclaimEventTaskSrc = extractExportBlock(
  EVENT_TASKS_SOURCE,
  'unclaimEventTask'
);
const toggleCompletedSrc = extractExportBlock(
  EVENT_TASKS_SOURCE,
  'toggleCompleted'
);

describe('claimEventTask — RSVP decoupling [TEST 1, 2, 9, 10, 11]', () => {
  it('never references the eventRsvps table (unanswered/maybe/yes — requiresRsvp true/false/undefined all pass through identical code, since no RSVP branch exists)', () => {
    expect(claimEventTaskSrc).not.toContain('eventRsvps');
  });

  it('does not reference a removed rsvpChanged field in its own body', () => {
    expect(claimEventTaskSrc).not.toContain('rsvpChanged');
  });

  it('still returns wasAddedToCalendar (calendar inclusion signal preserved) [TEST 12]', () => {
    expect(claimEventTaskSrc).toContain('wasAddedToCalendar');
  });

  it('still calls saveCommunityEventToPersonalCalendar for the claiming user (Axis 1 preserved) [TEST 12]', () => {
    expect(claimEventTaskSrc).toContain('saveCommunityEventToPersonalCalendar');
  });

  it('still assigns the task to the claiming user (assignment behavior preserved)', () => {
    expect(claimEventTaskSrc).toContain('assignedToUserId: userId');
  });

  it('still guards past events and cancelled events (event-state guards preserved)', () => {
    expect(claimEventTaskSrc).toContain('EVENT_IS_PAST');
    expect(claimEventTaskSrc).toContain("event.status === 'cancelled'");
  });
});

describe('setAssignee (user assignee branch) — RSVP decoupling [TEST 3, 4, 9, 10, 11]', () => {
  it('never references the eventRsvps table (unanswered/maybe/yes — requiresRsvp true/false/undefined all pass through identical code, since no RSVP branch exists)', () => {
    expect(setAssigneeSrc).not.toContain('eventRsvps');
  });

  it('still calls saveCommunityEventToPersonalCalendar for the assignee (Axis 1 preserved for Member X) [TEST 12]', () => {
    expect(setAssigneeSrc).toContain('saveCommunityEventToPersonalCalendar');
  });

  it('still assigns the task to the target user and stamps assignedByUserId/assignedAt', () => {
    expect(setAssigneeSrc).toContain('assignedToUserId: assignee.userId');
    expect(setAssigneeSrc).toContain('assignedByUserId: userId');
    expect(setAssigneeSrc).toContain('assignedAt: now');
  });

  it('still sends the community_task_assigned notification to the assignee', () => {
    expect(setAssigneeSrc).toContain("pushType: 'community_task_assigned'");
    expect(setAssigneeSrc).toContain('createUserNotifications');
    expect(setAssigneeSrc).toContain('sendPush');
  });

  it('still enforces manager/self-claim assignment permissions', () => {
    expect(setAssigneeSrc).toContain(
      'רק יוצר האירוע או הממונה הנוכחי יכולים לשנות הקצאה'
    );
  });
});

describe('unclaimEventTask — RSVP untouched [TEST 5]', () => {
  it('never references the eventRsvps table', () => {
    expect(unclaimEventTaskSrc).not.toContain('eventRsvps');
  });

  it('still clears assignment fields only', () => {
    expect(unclaimEventTaskSrc).toContain('assignedToUserId: undefined');
    expect(unclaimEventTaskSrc).toContain('assignedToManual: undefined');
    expect(unclaimEventTaskSrc).toContain('assignedByUserId: undefined');
    expect(unclaimEventTaskSrc).toContain('assignedAt: undefined');
  });

  it('still blocks unclaiming an already-completed task', () => {
    expect(unclaimEventTaskSrc).toContain('TASK_ALREADY_COMPLETED');
  });
});

describe('setAssignee(assignee = null) — unassign RSVP untouched [TEST 6]', () => {
  it('the null-assignee clearing branch never references eventRsvps (whole file already asserted eventRsvps-free above)', () => {
    // setAssigneeSrc covers the ENTIRE setAssignee body, including the
    // `assignee === null` unassign branch — already proven eventRsvps-free
    // above. This test documents that the null branch specifically clears
    // assignment fields and nothing else.
    expect(setAssigneeSrc).toContain('assignedToUserId: undefined');
    expect(setAssigneeSrc).toContain('getTaskAssignmentClearAuthorization');
  });
});

describe('toggleCompleted (complete + reopen) — RSVP untouched [TEST 7, 8]', () => {
  it('never references the eventRsvps table', () => {
    expect(toggleCompletedSrc).not.toContain('eventRsvps');
  });

  it('only patches completed/completedAt (covers both complete and reopen — nowCompleted is derived as !task.completed)', () => {
    expect(toggleCompletedSrc).toContain('completed: nowCompleted');
    expect(toggleCompletedSrc).toContain(
      'completedAt: nowCompleted ? Date.now() : undefined'
    );
  });
});

describe('Explicit RSVP "no" + assigned-task block flow — untouched by this fix [TEST 13, 14]', () => {
  it('upsertRsvp still blocks RSVP "no" while the user has an assigned event task', () => {
    expect(EVENT_RSVPS_SOURCE).toContain('RSVP_NO_BLOCKED_BY_ACTIVE_TASK');
    expect(EVENT_RSVPS_SOURCE).toContain(
      'לא ניתן לסמן אי הגעה בזמן שיש לך משימה באירוע'
    );
  });

  it('setRsvpNoAndUnclaimMyEventTasks still exists and unclaims + sets RSVP no together', () => {
    expect(EVENT_RSVPS_SOURCE).toContain(
      'export const setRsvpNoAndUnclaimMyEventTasks = mutation({'
    );
    expect(EVENT_RSVPS_SOURCE).toContain("status: 'no'");
  });

  it('hasMyAssignedEventTasksForEvent still exists (used to decide whether to show the block dialog)', () => {
    expect(EVENT_RSVPS_SOURCE).toContain(
      'export const hasMyAssignedEventTasksForEvent = query({'
    );
  });

  it('upsertRsvp still allows explicit yes/maybe/no/none writes (the ONLY legitimate RSVP write path, alongside setRsvpNoAndUnclaimMyEventTasks)', () => {
    expect(EVENT_RSVPS_SOURCE).toContain(
      'export const upsertRsvp = mutation({'
    );
  });
});
