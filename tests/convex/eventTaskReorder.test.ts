/**
 * FIX 8C — Community Event task reordering, aligned with Personal Event
 * Edit UX.
 *
 * These tests exercise the exact pure functions `convex/eventTasks.ts`'s
 * `reorder` mutation and its authorization guard use:
 *
 *   - `computeEventTaskOrderPatches` — the normalization/dedup logic the
 *     mutation handler calls verbatim to decide what `order` value to
 *     patch onto each task.
 *   - `canManageEventTasksPure` — the exact rule `isEventTaskManager`
 *     (used by `create`/`update`/`remove`/`reorder`) delegates to once it
 *     has resolved the caller's community membership.
 *
 * Neither is a parallel reimplementation of the mutation — they ARE its
 * decision logic, extracted so they can be unit-tested without a Convex
 * test harness (no ctx/db access), the same pattern already used for
 * `getTaskAssignmentClearAuthorization` and
 * `assertCommunityTaskAssigneeAllowed` in this same file.
 *
 * Run with: bun test
 */

import { describe, expect, it } from 'bun:test';
import type { Id } from '../../convex/_generated/dataModel';
import {
  canManageEventTasksPure,
  computeEventTaskOrderPatches,
} from '../../convex/eventTasks';

function id<T extends string>(s: string): Id<T> {
  return s as Id<T>;
}

describe('computeEventTaskOrderPatches', () => {
  it('[TEST 1] pure reorder produces sequential order matching the new position: A,B,C → C,A,B', () => {
    const existingIds = new Set([id('A'), id('B'), id('C')]);
    const patches = computeEventTaskOrderPatches(existingIds, [
      id('C'),
      id('A'),
      id('B'),
    ]);
    expect(patches).toEqual([
      { id: id('C'), order: 0 },
      { id: id('A'), order: 1 },
      { id: id('B'), order: 2 },
    ]);
  });

  it('[TEST 4] stable/normalized: legacy/duplicate prior order values are irrelevant — output is always sequential from the given orderedIds', () => {
    // The function never reads a prior `order` field at all — it only
    // knows about `existingIds` (which tasks are real) and `orderedIds`
    // (the desired final sequence). This is exactly why legacy tasks with
    // a missing/duplicate `order` are handled deterministically: the
    // previous value is never consulted.
    const existingIds = new Set([id('legacy-1'), id('legacy-2'), id('new')]);
    const patches = computeEventTaskOrderPatches(existingIds, [
      id('new'),
      id('legacy-1'),
      id('legacy-2'),
    ]);
    expect(patches.map((p) => p.order)).toEqual([0, 1, 2]);
    expect(patches.map((p) => p.id)).toEqual([
      id('new'),
      id('legacy-1'),
      id('legacy-2'),
    ]);
  });

  it('[TEST — no duplicate tasks] skips ids not belonging to this event (defense in depth)', () => {
    const existingIds = new Set([id('A'), id('B')]);
    const patches = computeEventTaskOrderPatches(existingIds, [
      id('A'),
      id('not-in-this-event'),
      id('B'),
    ]);
    expect(patches).toEqual([
      { id: id('A'), order: 0 },
      { id: id('B'), order: 1 },
    ]);
  });

  it('[TEST — no duplicate tasks] de-duplicates a repeated id in orderedIds', () => {
    const existingIds = new Set([id('A'), id('B')]);
    const patches = computeEventTaskOrderPatches(existingIds, [
      id('A'),
      id('A'),
      id('B'),
    ]);
    expect(patches).toEqual([
      { id: id('A'), order: 0 },
      { id: id('B'), order: 1 },
    ]);
  });

  it('returns an empty array when orderedIds is empty', () => {
    expect(computeEventTaskOrderPatches(new Set([id('A')]), [])).toEqual([]);
  });
});

describe('canManageEventTasksPure — reorder authorization', () => {
  const communityId = id<'communities'>('community-1');
  const creatorId = id<'users'>('creator');
  const otherUserId = id<'users'>('other');

  it('allows the event creator regardless of community membership', () => {
    const event = { createdBy: creatorId, communityId };
    expect(
      canManageEventTasksPure(event, creatorId, {
        isActiveMember: false,
      })
    ).toBe(true);
  });

  it('allows an active community owner', () => {
    const event = { createdBy: creatorId, communityId };
    expect(
      canManageEventTasksPure(event, otherUserId, {
        isActiveMember: true,
        role: 'owner',
      })
    ).toBe(true);
  });

  it('allows an active community admin', () => {
    const event = { createdBy: creatorId, communityId };
    expect(
      canManageEventTasksPure(event, otherUserId, {
        isActiveMember: true,
        role: 'admin',
      })
    ).toBe(true);
  });

  it('[TEST — authorization] denies a regular (non-admin/owner) active community member', () => {
    const event = { createdBy: creatorId, communityId };
    expect(
      canManageEventTasksPure(event, otherUserId, {
        isActiveMember: true,
        role: 'member',
      })
    ).toBe(false);
  });

  it('[TEST — authorization] denies an inactive (left) owner/admin', () => {
    const event = { createdBy: creatorId, communityId };
    expect(
      canManageEventTasksPure(event, otherUserId, {
        isActiveMember: false,
        role: 'owner',
      })
    ).toBe(false);
  });

  it('denies a non-creator on a Personal Event (no communityId) regardless of membership', () => {
    const event = { createdBy: creatorId, communityId: undefined };
    expect(
      canManageEventTasksPure(event, otherUserId, {
        isActiveMember: true,
        role: 'owner',
      })
    ).toBe(false);
  });
});
