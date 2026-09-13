/**
 * COMMUNITY EVENT TASK CLAIM BUTTON — focused fix regression coverage.
 *
 * Root cause: in app/(authenticated)/event/[id].tsx, the "אני אקח"
 * self-claim action for a Community Event Task required
 * `myCommunityMembership` — sourced from a SEPARATE, independently-timed
 * `getCommunityMembers` client query — in addition to
 * `participantsCanSeeTasks`. Since the task itself is already
 * server-authorized (convex/eventTasks.ts's `listByEvent` only ever
 * returns tasks the viewer may see/act on), requiring that second client
 * query to resolve created a contradictory UI state: the task title was
 * visible, but the claim action stayed hidden until the membership query
 * happened to resolve.
 *
 * `canShowCommunityEventSelfClaimAction` (lib/eventTaskClaimVisibility.ts)
 * removes that second dependency. This file verifies:
 *   1. The final claim-visibility rule via the actual composition used in
 *      app/(authenticated)/event/[id].tsx (isCommunityEvent +
 *      participantsCanSeeTasks + !isAssigned + !eventHasStarted), including
 *      that RSVP status never appears anywhere in that composition.
 *   2. A source-level regression guard: `myCommunityMembership` must never
 *      again be referenced inside the `showSelfClaimAction` computation in
 *      event/[id].tsx.
 *
 * Run with: bun test tests/convex
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { canShowCommunityEventSelfClaimAction } from '../../lib/eventTaskClaimVisibility';

/**
 * Mirrors the exact composition used in
 * app/(authenticated)/event/[id].tsx: `isClaimable` is
 * `showSelfClaimAction && !isAssigned && !eventHasStarted`, where
 * `showSelfClaimAction` now comes only from
 * `canShowCommunityEventSelfClaimAction`.
 */
function computeIsClaimable(params: {
  isCommunityEvent: boolean;
  participantsCanSeeTasks: boolean;
  isAssigned: boolean;
  eventHasStarted: boolean;
}): boolean {
  const showSelfClaimAction = canShowCommunityEventSelfClaimAction({
    isCommunityEvent: params.isCommunityEvent,
    participantsCanSeeTasks: params.participantsCanSeeTasks,
  });
  return showSelfClaimAction && !params.isAssigned && !params.eventHasStarted;
}

describe('canShowCommunityEventSelfClaimAction', () => {
  it('[TEST 1] regular member + server-returned unassigned task + tasksVisibleToParticipants=true + future event → claim visible', () => {
    const isClaimable = computeIsClaimable({
      isCommunityEvent: true,
      participantsCanSeeTasks: true,
      isAssigned: false,
      eventHasStarted: false,
    });
    expect(isClaimable).toBe(true);
  });

  it('[TEST 2] same scenario, RSVP unanswered → claim action still visible (RSVP status is not part of the computation at all)', () => {
    // The composition intentionally has no RSVP parameter. This test
    // documents that omission is deliberate: an "unanswered RSVP" scenario
    // is represented simply by NOT passing any RSVP-derived value in —
    // there is no code path by which RSVP status could suppress the
    // result.
    const isClaimable = computeIsClaimable({
      isCommunityEvent: true,
      participantsCanSeeTasks: true,
      isAssigned: false,
      eventHasStarted: false,
    });
    expect(isClaimable).toBe(true);
  });

  it('[TEST 3] task already assigned → claim action hidden', () => {
    const isClaimable = computeIsClaimable({
      isCommunityEvent: true,
      participantsCanSeeTasks: true,
      isAssigned: true,
      eventHasStarted: false,
    });
    expect(isClaimable).toBe(false);
  });

  it('[TEST 4] event already started → claim action hidden', () => {
    const isClaimable = computeIsClaimable({
      isCommunityEvent: true,
      participantsCanSeeTasks: true,
      isAssigned: false,
      eventHasStarted: true,
    });
    expect(isClaimable).toBe(false);
  });

  it('[TEST 5] tasksVisibleToParticipants=false → no claim action for an unassigned task', () => {
    const isClaimable = computeIsClaimable({
      isCommunityEvent: true,
      participantsCanSeeTasks: false,
      isAssigned: false,
      eventHasStarted: false,
    });
    expect(isClaimable).toBe(false);
  });

  it('[TEST 6] Personal Event (non-community) → self-claim action never shown (Personal Events use their own, unchanged claim branch)', () => {
    const result = canShowCommunityEventSelfClaimAction({
      isCommunityEvent: false,
      participantsCanSeeTasks: true,
    });
    expect(result).toBe(false);
  });

  it('returns false when both inputs are false', () => {
    expect(
      canShowCommunityEventSelfClaimAction({
        isCommunityEvent: false,
        participantsCanSeeTasks: false,
      })
    ).toBe(false);
  });
});

describe('[TEST 7] manager behavior is unaffected by this fix', () => {
  it('manager task actions (assign/delete/visibility-toggle) do not read canShowCommunityEventSelfClaimAction at all', () => {
    // Managers render an entirely separate branch in event/[id].tsx gated
    // on `canManageTasks` (isCreator || isCommunityOwnerOrAdmin), which
    // this fix does not touch. This is a source-level guard that the
    // manager assignment/delete/visibility-toggle block still reads
    // `canManageTasks`, independent of the claim-visibility change.
    const EVENT_DETAILS_SOURCE = readFileSync(
      new URL('../../app/(authenticated)/event/[id].tsx', import.meta.url),
      'utf8'
    );
    expect(EVENT_DETAILS_SOURCE).toContain('{canManageTasks && (');
    expect(EVENT_DETAILS_SOURCE).toContain(
      'const canManageTasks = isCreator || isCommunityOwnerOrAdmin;'
    );
  });
});

describe('source-level regression guard — app/(authenticated)/event/[id].tsx', () => {
  const EVENT_DETAILS_SOURCE = readFileSync(
    new URL('../../app/(authenticated)/event/[id].tsx', import.meta.url),
    'utf8'
  );

  it('showSelfClaimAction is computed via canShowCommunityEventSelfClaimAction, not an inline Boolean(...) expression', () => {
    expect(EVENT_DETAILS_SOURCE).toContain(
      'const showSelfClaimAction = canShowCommunityEventSelfClaimAction({'
    );
  });

  it('[regression guard] myCommunityMembership is never referenced inside the showSelfClaimAction assignment', () => {
    const marker = 'const showSelfClaimAction = canShowCommunityEventSelfClaimAction({';
    const startIdx = EVENT_DETAILS_SOURCE.indexOf(marker);
    expect(startIdx).toBeGreaterThan(-1);
    // The assignment is a short, statically-known call — slice a
    // generous window and confirm myCommunityMembership does not appear
    // inside it (it may still legitimately appear elsewhere in the file,
    // e.g. for canRegularMemberSeeTasks / canManageEventReminderItem).
    const assignmentWindow = EVENT_DETAILS_SOURCE.slice(
      startIdx,
      startIdx + marker.length + 120
    );
    expect(assignmentWindow).not.toContain('myCommunityMembership');
  });

  it('imports canShowCommunityEventSelfClaimAction from lib/eventTaskClaimVisibility', () => {
    expect(EVENT_DETAILS_SOURCE).toContain(
      "import { canShowCommunityEventSelfClaimAction } from '@/lib/eventTaskClaimVisibility';"
    );
  });
});

describe('[TEST 7 cont.] existing server-side claim permission is unchanged', () => {
  it('convex/eventTasks.ts claimEventTask still enforces tasksVisibleToParticipants server-side (unrelated to this client fix)', () => {
    const EVENT_TASKS_SOURCE = readFileSync(
      new URL('../../convex/eventTasks.ts', import.meta.url),
      'utf8'
    );
    expect(EVENT_TASKS_SOURCE).toContain(
      "if (!canManage && event.tasksVisibleToParticipants !== true) {"
    );
    expect(EVENT_TASKS_SOURCE).toContain('המשימות אינן גלויות למשתתפים');
  });

  it('convex/eventTasks.ts listByEvent still filters unauthorized tasks server-side (unrelated to this client fix)', () => {
    const EVENT_TASKS_SOURCE = readFileSync(
      new URL('../../convex/eventTasks.ts', import.meta.url),
      'utf8'
    );
    expect(EVENT_TASKS_SOURCE).toContain(
      '!canManageTasks && event.tasksVisibleToParticipants !== true'
    );
  });

  it('this fix does not add any eventRsvps reference to eventTaskClaimVisibility.ts (RSVP remains independent)', () => {
    const HELPER_SOURCE = readFileSync(
      new URL('../../lib/eventTaskClaimVisibility.ts', import.meta.url),
      'utf8'
    );
    expect(HELPER_SOURCE).not.toContain('eventRsvps');
    expect(HELPER_SOURCE).not.toContain('rsvp');
  });
});
