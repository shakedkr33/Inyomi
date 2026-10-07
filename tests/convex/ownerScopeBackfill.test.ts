/**
 * Family Membership Lifecycle — Phase 0
 *
 * Pure unit tests for convex/ownerScope.ts's deterministic backfill
 * classification (classify*ForBackfill). These must NEVER return a
 * definite scope for a record whose ownership cannot be established from
 * reliable signals alone — see convex/backfills.ts, which trusts these
 * functions to decide what is safe to auto-stamp vs. what must be
 * reported for manual review.
 *
 * Run with: bun test tests/convex/ownerScopeBackfill.test.ts
 */

import { describe, expect, it } from 'bun:test';
import {
  classifyCaptureForBackfill,
  classifyEventForBackfill,
  classifyTaskForBackfill,
} from '../../convex/ownerScope';

const USER = 'user_1';
const OTHER_USER = 'user_2';

describe('classifyEventForBackfill', () => {
  it('deterministically classifies a community event as community', () => {
    expect(
      classifyEventForBackfill({ communityId: 'community_1', createdBy: USER })
    ).toBe('community');
  });

  it('deterministically classifies an imported google_copy event as personal', () => {
    expect(
      classifyEventForBackfill({ source: 'google_copy', createdBy: USER })
    ).toBe('personal');
  });

  it('deterministically classifies an imported device_copy event as personal', () => {
    expect(
      classifyEventForBackfill({ source: 'device_copy', createdBy: USER })
    ).toBe('personal');
  });

  it('deterministically classifies allFamily:true as family', () => {
    expect(
      classifyEventForBackfill({ allFamily: true, createdBy: USER })
    ).toBe('family');
  });

  it('deterministically classifies sharedWithFamilyMemberIds as family', () => {
    expect(
      classifyEventForBackfill({
        sharedWithFamilyMemberIds: ['member_1'],
        createdBy: USER,
      })
    ).toBe('family');
  });

  it('deterministically classifies sharedWithUserIds with another user as family', () => {
    expect(
      classifyEventForBackfill({
        sharedWithUserIds: [OTHER_USER],
        createdBy: USER,
      })
    ).toBe('family');
  });

  it('reports a legacy event with no community/import/sharing signal as ambiguous — never guesses personal', () => {
    expect(classifyEventForBackfill({ createdBy: USER })).toBe('ambiguous');
  });

  it('reports a legacy event shared only with the creator (no-op self-share) as ambiguous', () => {
    expect(
      classifyEventForBackfill({ sharedWithUserIds: [USER], createdBy: USER })
    ).toBe('ambiguous');
  });
});

describe('classifyTaskForBackfill', () => {
  it('deterministically classifies a community task as community', () => {
    expect(
      classifyTaskForBackfill({ communityId: 'community_1', createdBy: USER })
    ).toBe('community');
  });

  it('deterministically classifies a community-sourced reminder as community via sourceType', () => {
    expect(
      classifyTaskForBackfill({
        sourceType: 'community_event_important_item',
        createdBy: USER,
      })
    ).toBe('community');
  });

  it('deterministically classifies assignedTo another user as family', () => {
    expect(
      classifyTaskForBackfill({ createdBy: USER, assignedTo: OTHER_USER })
    ).toBe('family');
  });

  it('deterministically classifies non-empty assignedToMemberIds as family', () => {
    expect(
      classifyTaskForBackfill({
        createdBy: USER,
        assignedToMemberIds: ['member_1'],
      })
    ).toBe('family');
  });

  it('reports a legacy task with no community/assignment signal as ambiguous — never guesses personal', () => {
    expect(classifyTaskForBackfill({ createdBy: USER })).toBe('ambiguous');
  });

  it('deterministically classifies a legacy task explicitly assigned only to its own creator as personal', () => {
    expect(
      classifyTaskForBackfill({ createdBy: USER, assignedTo: USER })
    ).toBe('personal');
  });

  it('deterministically classifies assignedToUserIds containing only the creator as personal', () => {
    expect(
      classifyTaskForBackfill({
        createdBy: USER,
        assignedTo: USER,
        assignedToUserIds: [USER],
      })
    ).toBe('personal');
  });

  it('does not force personal when another user appears in assignedToUserIds', () => {
    expect(
      classifyTaskForBackfill({
        createdBy: USER,
        assignedTo: USER,
        assignedToUserIds: [USER, OTHER_USER],
      })
    ).toBe('family');
  });

  it('does not force personal when a member assignment exists', () => {
    expect(
      classifyTaskForBackfill({
        createdBy: USER,
        assignedTo: USER,
        assignedToUserIds: [USER],
        assignedToMemberIds: ['member_1'],
      })
    ).toBe('family');
  });

  it('leaves an unassigned legacy task (assignedTo undefined, no assignees) ambiguous', () => {
    expect(
      classifyTaskForBackfill({ createdBy: USER, assignedToUserIds: [] })
    ).toBe('ambiguous');
  });

  it('still classifies a community task as community even when creator-only assignment shape also matches', () => {
    expect(
      classifyTaskForBackfill({
        communityId: 'community_1',
        createdBy: USER,
        assignedTo: USER,
        assignedToUserIds: [USER],
      })
    ).toBe('community');
  });

  it('leaves a currently-valid family classification (other assignee) unchanged', () => {
    expect(
      classifyTaskForBackfill({ createdBy: USER, assignedTo: OTHER_USER })
    ).toBe('family');
  });
});

describe('classifyCaptureForBackfill', () => {
  it('always deterministically classifies captures as personal', () => {
    expect(classifyCaptureForBackfill()).toBe('personal');
  });
});
