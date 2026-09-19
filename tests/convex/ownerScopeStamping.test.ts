/**
 * Family Membership Lifecycle — Phase 0
 *
 * Pure unit tests for convex/ownerScope.ts creation-time stamping.
 * ownerScope is stamped ONCE at creation and must never be recomputed by
 * later edits — these tests only cover the stamping functions themselves;
 * immutability-on-edit is asserted structurally by the fact that no
 * update mutation in convex/events.ts / convex/tasks.ts calls these
 * functions (see the Phase 0 report).
 *
 * Run with: bun test tests/convex/ownerScopeStamping.test.ts
 */

import { describe, expect, it } from 'bun:test';
import {
  stampCaptureOwnerScope,
  stampEventOwnerScope,
  stampTaskOwnerScope,
} from '../../convex/ownerScope';

const USER = 'user_1';
const OTHER_USER = 'user_2';

describe('stampEventOwnerScope', () => {
  it('classifies a community event as community', () => {
    expect(
      stampEventOwnerScope({ communityId: 'community_1', createdBy: USER })
    ).toBe('community');
  });

  it('classifies a google_copy import as personal regardless of other fields', () => {
    expect(
      stampEventOwnerScope({
        source: 'google_copy',
        allFamily: true,
        createdBy: USER,
      })
    ).toBe('personal');
  });

  it('classifies a device_copy import as personal', () => {
    expect(
      stampEventOwnerScope({ source: 'device_copy', createdBy: USER })
    ).toBe('personal');
  });

  it('classifies allFamily:true as family', () => {
    expect(
      stampEventOwnerScope({ allFamily: true, createdBy: USER })
    ).toBe('family');
  });

  it('classifies non-empty sharedWithFamilyMemberIds as family', () => {
    expect(
      stampEventOwnerScope({
        sharedWithFamilyMemberIds: ['member_1'],
        createdBy: USER,
      })
    ).toBe('family');
  });

  it('classifies sharedWithUserIds containing another user as family', () => {
    expect(
      stampEventOwnerScope({
        sharedWithUserIds: [OTHER_USER],
        createdBy: USER,
      })
    ).toBe('family');
  });

  it('does NOT classify as family when sharedWithUserIds only contains the creator', () => {
    expect(
      stampEventOwnerScope({ sharedWithUserIds: [USER], createdBy: USER })
    ).toBe('personal');
  });

  it('classifies a plain personal event with no sharing as personal', () => {
    expect(stampEventOwnerScope({ createdBy: USER })).toBe('personal');
  });

  it('community takes precedence over family sharing signals', () => {
    expect(
      stampEventOwnerScope({
        communityId: 'community_1',
        allFamily: true,
        createdBy: USER,
      })
    ).toBe('community');
  });
});

describe('stampTaskOwnerScope', () => {
  it('classifies a community task as community', () => {
    expect(
      stampTaskOwnerScope({ communityId: 'community_1', createdBy: USER })
    ).toBe('community');
  });

  it('classifies assignedTo another user as family', () => {
    expect(
      stampTaskOwnerScope({ createdBy: USER, assignedTo: OTHER_USER })
    ).toBe('family');
  });

  it('does NOT classify assignedTo the creator as family', () => {
    expect(stampTaskOwnerScope({ createdBy: USER, assignedTo: USER })).toBe(
      'personal'
    );
  });

  it('classifies assignedToUserIds containing another user as family', () => {
    expect(
      stampTaskOwnerScope({
        createdBy: USER,
        assignedToUserIds: [USER, OTHER_USER],
      })
    ).toBe('family');
  });

  it('classifies non-empty assignedToMemberIds as family', () => {
    expect(
      stampTaskOwnerScope({
        createdBy: USER,
        assignedToMemberIds: ['member_1'],
      })
    ).toBe('family');
  });

  it('classifies a plain personal task with no assignment signal as personal', () => {
    expect(stampTaskOwnerScope({ createdBy: USER })).toBe('personal');
  });
});

describe('stampCaptureOwnerScope', () => {
  it('always classifies captures as personal', () => {
    expect(stampCaptureOwnerScope()).toBe('personal');
  });
});
