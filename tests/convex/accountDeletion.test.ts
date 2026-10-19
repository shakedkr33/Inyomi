/**
 * Tests for lib/accountDeletion.ts + source-regression checks on the real
 * production account-deletion engine (convex/accountDeletion.ts) and its
 * only public entry point (convex/users.ts `deleteMyAccount`).
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/qaResetUser.test.ts's documented precedent). Given that
 * constraint:
 *
 *   - Every safety-critical planning/decision function
 *     (lib/accountDeletion.ts) is pure and fully covered here via direct
 *     behavioral tests.
 *   - Invariants that require inspecting the actual shipped mutation body
 *     (guard ordering, deletion order, "users row deleted last", "no
 *     destructive writes before all blockers pass", auth cleanup
 *     dependency order, etc.) are verified via source inspection of the
 *     real convex/accountDeletion.ts / convex/users.ts files — the same
 *     pattern already used by tests/convex/qaResetUser.test.ts and
 *     tests/convex/usersAccessControlWave1.test.ts.
 *
 * Run with: bun test tests/convex/accountDeletion.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  classifyEventForBackfill,
  classifyTaskForBackfill,
} from '../../convex/ownerScope';
import {
  ACCOUNT_DELETION_MAX_PLANNED_WRITES,
  type AccountDeletionPreviewInput,
  type CommunitySuccessorCandidate,
  estimateAccountDeletionWriteCount,
  evaluateAccountDeletionTransactionSize,
  type FamilySuccessorCandidate,
  isAccountDeletionSafeToExecute,
  isTaskStrandedInDeletingUsersTrash,
  type MemberRemapRow,
  type OwnedCommunitySuccessorMembershipInput,
  planCommunityMemberProfileRemap,
  planCommunityOwnershipTransfer,
  planEventResidualReferenceCleanup,
  planEventSharedUserIdsCleanup,
  planFamilyMemberIdRemap,
  planOwnedContentDisposition,
  planOwnedSpaceDeletion,
  planTaskAssignmentCleanup,
  planTaskMemberIdRemap,
  selectCommunitySuccessor,
  selectFamilySuccessor,
  summarizeAccountDeletionPreview,
  verifyNoResidualCommunityMemberProfileReferences,
  verifyNoResidualDeletedByReference,
  verifyNoResidualEventReferences,
  verifyNoResidualEventTaskAssignment,
  verifyNoResidualTaskAssignment,
  verifyNoResidualTaskMemberReferences,
} from '../../lib/accountDeletion';

const USER_ID = 'user_deleting';
const OTHER_USER_ID = 'user_other';
const THIRD_USER_ID = 'user_third';

// ── Transaction-size preflight ──────────────────────────────────────────────
describe('estimateAccountDeletionWriteCount', () => {
  it('sums all planned-counts values', () => {
    expect(estimateAccountDeletionWriteCount({ a: 3, b: 5, c: 0 })).toBe(8);
  });
  it('empty plan → 0', () => {
    expect(estimateAccountDeletionWriteCount({})).toBe(0);
  });
});

describe('evaluateAccountDeletionTransactionSize', () => {
  it('at or under the ceiling → safe, no blocker', () => {
    expect(
      evaluateAccountDeletionTransactionSize(
        ACCOUNT_DELETION_MAX_PLANNED_WRITES
      )
    ).toEqual({ safe: true, blocker: null });
  });
  it('one over the ceiling → blocked, with a clear error', () => {
    const result = evaluateAccountDeletionTransactionSize(
      ACCOUNT_DELETION_MAX_PLANNED_WRITES + 1
    );
    expect(result.safe).toBe(false);
    expect(result.blocker).toContain('לא ניתן למחוק את החשבון');
  });
  it('well under the ceiling → safe', () => {
    expect(evaluateAccountDeletionTransactionSize(10)).toEqual({
      safe: true,
      blocker: null,
    });
  });
});

describe('isAccountDeletionSafeToExecute', () => {
  it('true for zero blockers', () => {
    expect(isAccountDeletionSafeToExecute([])).toBe(true);
  });
  it('false for any blocker — a blocker means no destructive plan execution', () => {
    expect(isAccountDeletionSafeToExecute(['some blocker'])).toBe(false);
  });
});

// ── Family/personal space ownership blocker (§1) ────────────────────────────
describe('planOwnedSpaceDeletion', () => {
  const successor: FamilySuccessorCandidate = {
    accessMembershipId: 'access-other',
    linkedProfileId: 'profile-other',
    userId: OTHER_USER_ID,
    joinedAt: 100,
    creationTime: 50,
  };

  it('eligible linked account transfers ownership', () => {
    const result = planOwnedSpaceDeletion([
      {
        spaceId: 'space1',
        spaceName: 'משפחת כהן',
        otherAccessUserIds: [OTHER_USER_ID],
        eligibleSuccessors: [successor],
        hasAmbiguousActiveMembership: false,
      },
    ]);
    expect(result.deletableSpaceIds).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.transfers).toEqual([{ spaceId: 'space1', successor }]);
  });

  it('sole-user owned space (no other real joined user) → deletable, no blocker', () => {
    const result = planOwnedSpaceDeletion([
      {
        spaceId: 'space1',
        spaceName: 'המרחב שלי',
        otherAccessUserIds: [],
        eligibleSuccessors: [],
        hasAmbiguousActiveMembership: false,
      },
    ]);
    expect(result.deletableSpaceIds).toEqual(['space1']);
    expect(result.blockers).toEqual([]);
  });

  it('ambiguous active linkage blocks instead of closing the space', () => {
    const result = planOwnedSpaceDeletion([
      {
        spaceId: 'shared',
        spaceName: 'Shared',
        otherAccessUserIds: [OTHER_USER_ID],
        eligibleSuccessors: [],
        hasAmbiguousActiveMembership: true,
      },
    ]);
    expect(result.deletableSpaceIds).toEqual([]);
    expect(result.blockers).toHaveLength(1);
    expect(result.decisions[0].action).toBe('blocked');
  });

  it('no owned spaces at all → deletable [], no blockers', () => {
    const result = planOwnedSpaceDeletion([]);
    expect(result.deletableSpaceIds).toEqual([]);
    expect(result.transfers).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.blockers).toEqual([]);
  });
});

describe('selectFamilySuccessor', () => {
  const candidate = (
    id: string,
    joinedAt: number | undefined,
    creationTime: number
  ): FamilySuccessorCandidate => ({
    accessMembershipId: id,
    linkedProfileId: `profile-${id}`,
    userId: `user-${id}`,
    joinedAt,
    creationTime,
  });

  it('uses earliest valid joinedAt regardless of input order', () => {
    const early = candidate('early', 100, 900);
    const late = candidate('late', 200, 10);
    expect(selectFamilySuccessor([late, early])).toEqual(early);
    expect(selectFamilySuccessor([early, late])).toEqual(early);
  });

  it('sorts missing joinedAt after valid values, then creation time and id', () => {
    const valid = candidate('valid', 500, 999);
    expect(
      selectFamilySuccessor([candidate('missing', undefined, 1), valid])
    ).toEqual(valid);
    expect(
      selectFamilySuccessor([
        candidate('b', undefined, 10),
        candidate('a', undefined, 10),
      ])?.accessMembershipId
    ).toBe('a');
  });
});

// ── Community ownership — automatic successor transfer (§2, updated) ───────
//
// Helper to build a minimal eligible/active OTHER membership row with
// terse field names, mirroring OwnedCommunitySuccessorMembershipInput.
function membershipRow(
  overrides: Partial<OwnedCommunitySuccessorMembershipInput> & {
    membershipId: string;
    userId: string;
  }
): OwnedCommunitySuccessorMembershipInput {
  return {
    role: 'member',
    active: true,
    userExists: true,
    joinedAt: 1000,
    creationTime: 1000,
    ...overrides,
  };
}

describe('selectCommunitySuccessor', () => {
  it('1. one admin + members → admin selected', () => {
    const admin: CommunitySuccessorCandidate = {
      membershipId: 'm-admin',
      userId: 'u-admin',
      role: 'admin',
      joinedAt: 500,
      creationTime: 500,
    };
    const member: CommunitySuccessorCandidate = {
      membershipId: 'm-member',
      userId: 'u-member',
      role: 'member',
      joinedAt: 100, // earlier than the admin, but admin still wins (priority 1)
      creationTime: 100,
    };
    expect(selectCommunitySuccessor([admin, member])).toEqual(admin);
  });

  it('2. multiple admins → earliest joined admin selected', () => {
    const laterAdmin: CommunitySuccessorCandidate = {
      membershipId: 'm-later',
      userId: 'u-later',
      role: 'admin',
      joinedAt: 2000,
      creationTime: 2000,
    };
    const earlierAdmin: CommunitySuccessorCandidate = {
      membershipId: 'm-earlier',
      userId: 'u-earlier',
      role: 'admin',
      joinedAt: 1000,
      creationTime: 1000,
    };
    expect(selectCommunitySuccessor([laterAdmin, earlierAdmin])).toEqual(
      earlierAdmin
    );
  });

  it('3. no admin, multiple members → earliest joined member selected', () => {
    const laterMember: CommunitySuccessorCandidate = {
      membershipId: 'm-later',
      userId: 'u-later',
      role: 'member',
      joinedAt: 2000,
      creationTime: 2000,
    };
    const earlierMember: CommunitySuccessorCandidate = {
      membershipId: 'm-earlier',
      userId: 'u-earlier',
      role: 'member',
      joinedAt: 1000,
      creationTime: 1000,
    };
    expect(selectCommunitySuccessor([laterMember, earlierMember])).toEqual(
      earlierMember
    );
  });

  it('7. missing joinedAt → deterministic legacy fallback via _creationTime', () => {
    const a: CommunitySuccessorCandidate = {
      membershipId: 'm-a',
      userId: 'u-a',
      role: 'member',
      joinedAt: undefined,
      creationTime: 200,
    };
    const b: CommunitySuccessorCandidate = {
      membershipId: 'm-b',
      userId: 'u-b',
      role: 'member',
      joinedAt: undefined,
      creationTime: 100,
    };
    expect(selectCommunitySuccessor([a, b])).toEqual(b);
  });

  it('8. equal joinedAt → deterministic tie-break via _creationTime, then membershipId', () => {
    const a: CommunitySuccessorCandidate = {
      membershipId: 'm-a',
      userId: 'u-a',
      role: 'member',
      joinedAt: 1000,
      creationTime: 500,
    };
    const b: CommunitySuccessorCandidate = {
      membershipId: 'm-b',
      userId: 'u-b',
      role: 'member',
      joinedAt: 1000,
      creationTime: 500,
    };
    // Same joinedAt AND same creationTime — final tie-break is the
    // lexicographically smallest membershipId ('m-a' < 'm-b'), never
    // array/query return order.
    expect(selectCommunitySuccessor([b, a])).toEqual(a);
  });

  it('empty candidate pool → null', () => {
    expect(selectCommunitySuccessor([])).toBeNull();
  });
});

describe('planCommunityOwnershipTransfer', () => {
  it('1. one admin + members → admin selected, action = transfer', () => {
    const result = planCommunityOwnershipTransfer('גן השכונה', USER_ID, [
      membershipRow({
        membershipId: 'm-owner',
        userId: USER_ID,
        role: 'owner',
      }),
      membershipRow({
        membershipId: 'm-admin',
        userId: OTHER_USER_ID,
        role: 'admin',
        joinedAt: 500,
      }),
      membershipRow({
        membershipId: 'm-member',
        userId: THIRD_USER_ID,
        role: 'member',
        joinedAt: 100,
      }),
    ]);
    expect(result.action).toBe('transfer');
    expect(result.successor?.userId).toBe(OTHER_USER_ID);
    expect(result.successor?.role).toBe('admin');
    expect(result.eligibleSuccessorCount).toBe(2);
    expect(result.blockerReason).toBeNull();
  });

  it('3. no admin, multiple members → earliest joined member selected', () => {
    const result = planCommunityOwnershipTransfer('קהילה', USER_ID, [
      membershipRow({
        membershipId: 'm-later',
        userId: OTHER_USER_ID,
        role: 'member',
        joinedAt: 2000,
      }),
      membershipRow({
        membershipId: 'm-earlier',
        userId: THIRD_USER_ID,
        role: 'member',
        joinedAt: 1000,
      }),
    ]);
    expect(result.action).toBe('transfer');
    expect(result.successor?.userId).toBe(THIRD_USER_ID);
  });

  it('4. pending user has earlier timestamp → ignored (not active)', () => {
    const result = planCommunityOwnershipTransfer('קהילה', USER_ID, [
      membershipRow({
        membershipId: 'm-pending',
        userId: OTHER_USER_ID,
        role: 'admin',
        active: false, // pending
        joinedAt: 1,
      }),
      membershipRow({
        membershipId: 'm-active',
        userId: THIRD_USER_ID,
        role: 'member',
        active: true,
        joinedAt: 5000,
      }),
    ]);
    expect(result.action).toBe('transfer');
    expect(result.successor?.userId).toBe(THIRD_USER_ID);
  });

  it('5. rejected/left/inactive user → ignored', () => {
    const result = planCommunityOwnershipTransfer('קהילה', USER_ID, [
      membershipRow({
        membershipId: 'm-left',
        userId: OTHER_USER_ID,
        role: 'admin',
        active: false,
        joinedAt: 1,
      }),
    ]);
    // Only the deleted user's own row would remain, but every OTHER row
    // is inactive → zero eligible successors → sole-owner hard-delete.
    expect(result.action).toBe('hardDelete');
    expect(result.successor).toBeNull();
  });

  it('6. deleting owner → never selected, even with the earliest timestamp and admin role', () => {
    const result = planCommunityOwnershipTransfer('קהילה', USER_ID, [
      membershipRow({
        membershipId: 'm-owner',
        userId: USER_ID,
        role: 'owner',
        joinedAt: 1, // earliest of all rows
      }),
      membershipRow({
        membershipId: 'm-member',
        userId: OTHER_USER_ID,
        role: 'member',
        joinedAt: 9999,
      }),
    ]);
    expect(result.action).toBe('transfer');
    expect(result.successor?.userId).toBe(OTHER_USER_ID);
    expect(result.successor?.userId).not.toBe(USER_ID);
  });

  it('9. active/joined row with broken real-user linkage → fails closed (blocked)', () => {
    const result = planCommunityOwnershipTransfer('קהילה', USER_ID, [
      membershipRow({
        membershipId: 'm-broken',
        userId: OTHER_USER_ID,
        role: 'member',
        active: true,
        userExists: false,
      }),
    ]);
    expect(result.action).toBe('blocked');
    expect(result.successor).toBeNull();
    expect(result.blockerReason).toContain('קהילה');
    // Never embeds an id or internal field/table name.
    expect(result.blockerReason).not.toContain(OTHER_USER_ID);
  });

  it('more than one active "owner" row is an invariant violation → fails closed (blocked)', () => {
    const result = planCommunityOwnershipTransfer('קהילה', USER_ID, [
      membershipRow({
        membershipId: 'm-owner2',
        userId: OTHER_USER_ID,
        role: 'owner',
        active: true,
      }),
    ]);
    expect(result.action).toBe('blocked');
  });

  it('10. no eligible other real users → hard-delete plan (sole owner, unchanged behavior)', () => {
    const result = planCommunityOwnershipTransfer('קהילה פעילה', USER_ID, [
      membershipRow({
        membershipId: 'm-owner',
        userId: USER_ID,
        role: 'owner',
      }),
    ]);
    expect(result.action).toBe('hardDelete');
    expect(result.successor).toBeNull();
    expect(result.blockerReason).toBeNull();
  });

  it('archived does not change the algorithm outcome — same eligible-member logic applies', () => {
    const result = planCommunityOwnershipTransfer('קהילה מאורכבת', USER_ID, [
      membershipRow({
        membershipId: 'm-member',
        userId: OTHER_USER_ID,
        role: 'member',
        joinedAt: 10,
      }),
    ]);
    expect(result.action).toBe('transfer');
    expect(result.successor?.userId).toBe(OTHER_USER_ID);
  });

  it('no owned-community members at all → hard-delete plan', () => {
    const result = planCommunityOwnershipTransfer('קהילה ריקה', USER_ID, []);
    expect(result.action).toBe('hardDelete');
  });
});

// ── Atomicity: one unsafe owned community blocks the ENTIRE deletion even
//    when other owned communities are transferable/deletable (§15). ───────
describe('community ownership transfer — atomicity across multiple owned communities', () => {
  it('one blocked community + one transferable + one hard-deletable → blockers is non-empty → NOT safe to execute', () => {
    const transferablePlan = planCommunityOwnershipTransfer(
      'קהילה א',
      USER_ID,
      [
        membershipRow({
          membershipId: 'm1',
          userId: OTHER_USER_ID,
          role: 'admin',
        }),
      ]
    );
    const hardDeletablePlan = planCommunityOwnershipTransfer(
      'קהילה ב',
      USER_ID,
      [membershipRow({ membershipId: 'm2', userId: USER_ID, role: 'owner' })]
    );
    const blockedPlan = planCommunityOwnershipTransfer('קהילה ג', USER_ID, [
      membershipRow({
        membershipId: 'm3',
        userId: THIRD_USER_ID,
        role: 'member',
        userExists: false,
      }),
    ]);

    expect(transferablePlan.action).toBe('transfer');
    expect(hardDeletablePlan.action).toBe('hardDelete');
    expect(blockedPlan.action).toBe('blocked');

    const blockers = [
      transferablePlan.blockerReason,
      hardDeletablePlan.blockerReason,
      blockedPlan.blockerReason,
    ].filter((b): b is string => b !== null);

    expect(blockers).toHaveLength(1);
    expect(isAccountDeletionSafeToExecute(blockers)).toBe(false);
  });
});

// ── Legacy ownerScope disposition (§3/§4) ───────────────────────────────────
describe('planOwnedContentDisposition', () => {
  it('populated "personal" scope → delete', () => {
    expect(planOwnedContentDisposition('personal')).toEqual({
      disposition: 'delete',
      blocked: false,
    });
  });
  it('populated "family" scope → preserve, not blocked', () => {
    expect(planOwnedContentDisposition('family')).toEqual({
      disposition: 'preserve',
      blocked: false,
    });
  });
  it('populated "community" scope → preserve, not blocked', () => {
    expect(planOwnedContentDisposition('community')).toEqual({
      disposition: 'preserve',
      blocked: false,
    });
  });
  it('"ambiguous" legacy record → preserve AND blocked (never guesses)', () => {
    expect(planOwnedContentDisposition('ambiguous')).toEqual({
      disposition: 'preserve',
      blocked: true,
    });
  });
});

describe('legacy (ownerScope undefined) records classified via the existing backfill classifiers', () => {
  it('a legacy event with family sharing signals classifies as family → preserved (never deleted)', () => {
    const scope = classifyEventForBackfill({
      allFamily: true,
      createdBy: USER_ID,
    });
    expect(scope).toBe('family');
    expect(planOwnedContentDisposition(scope)).toEqual({
      disposition: 'preserve',
      blocked: false,
    });
  });

  it('a legacy event with a communityId classifies as community → preserved', () => {
    const scope = classifyEventForBackfill({
      communityId: 'community1',
      createdBy: USER_ID,
    });
    expect(scope).toBe('community');
    expect(planOwnedContentDisposition(scope)).toEqual({
      disposition: 'preserve',
      blocked: false,
    });
  });

  it('a legacy event with zero sharing signal is genuinely ambiguous → blocks account deletion rather than guessing', () => {
    const scope = classifyEventForBackfill({ createdBy: USER_ID });
    expect(scope).toBe('ambiguous');
    expect(planOwnedContentDisposition(scope)).toEqual({
      disposition: 'preserve',
      blocked: true,
    });
  });

  it('a legacy task assigned to another user classifies as family → preserved', () => {
    const scope = classifyTaskForBackfill({
      createdBy: USER_ID,
      assignedTo: OTHER_USER_ID,
    });
    expect(scope).toBe('family');
    expect(planOwnedContentDisposition(scope)).toEqual({
      disposition: 'preserve',
      blocked: false,
    });
  });

  it('a legacy task with a community sourceType classifies as community → preserved', () => {
    const scope = classifyTaskForBackfill({
      createdBy: USER_ID,
      sourceType: 'community_event_important_item',
    });
    expect(scope).toBe('community');
    expect(planOwnedContentDisposition(scope)).toEqual({
      disposition: 'preserve',
      blocked: false,
    });
  });

  it('a legacy task with no assignment signal is ambiguous → blocks', () => {
    const scope = classifyTaskForBackfill({ createdBy: USER_ID });
    expect(scope).toBe('ambiguous');
    expect(planOwnedContentDisposition(scope)).toEqual({
      disposition: 'preserve',
      blocked: true,
    });
  });

  it('an imported (google_copy) legacy event is deterministically personal → deleted', () => {
    const scope = classifyEventForBackfill({
      source: 'google_copy',
      createdBy: USER_ID,
    });
    expect(scope).toBe('personal');
    expect(planOwnedContentDisposition(scope)).toEqual({
      disposition: 'delete',
      blocked: false,
    });
  });
});

// ── Task assignment cleanup (§9/§11) ────────────────────────────────────────
describe('planTaskAssignmentCleanup', () => {
  it('clears tasks.assignedTo (promoting the surviving creator) when the deleted user was the sole assignee with no assignedToUserIds field at all', () => {
    const result = planTaskAssignmentCleanup(
      { createdBy: OTHER_USER_ID, assignedTo: USER_ID },
      USER_ID
    );
    expect(result.assignedTo).toBe(OTHER_USER_ID);
    expect(result.changed).toBe(true);
  });

  it('filters the deleted user out of assignedToUserIds, preserving the rest', () => {
    const result = planTaskAssignmentCleanup(
      {
        createdBy: OTHER_USER_ID,
        assignedToUserIds: [USER_ID, OTHER_USER_ID, THIRD_USER_ID],
      },
      USER_ID
    );
    expect(result.assignedToUserIds).toEqual([OTHER_USER_ID, THIRD_USER_ID]);
    expect(result.changed).toBe(true);
  });

  it('promotes the next remaining assignee when assignedTo === deletedUserId and others remain in assignedToUserIds', () => {
    const result = planTaskAssignmentCleanup(
      {
        createdBy: OTHER_USER_ID,
        assignedTo: USER_ID,
        assignedToUserIds: [USER_ID, OTHER_USER_ID],
      },
      USER_ID
    );
    expect(result.assignedTo).toBe(OTHER_USER_ID);
    expect(result.assignedToUserIds).toEqual([OTHER_USER_ID]);
  });

  it('falls back to a DIFFERENT surviving creator when no other assignee remains', () => {
    const result = planTaskAssignmentCleanup(
      { createdBy: OTHER_USER_ID, assignedTo: USER_ID },
      USER_ID
    );
    expect(result.assignedTo).toBe(OTHER_USER_ID);
  });

  it('never resurrects the deleted user via the creator fallback when the creator IS the deleted user', () => {
    const result = planTaskAssignmentCleanup(
      { createdBy: USER_ID, assignedTo: USER_ID },
      USER_ID
    );
    expect(result.assignedTo).toBeUndefined();
  });

  it('leaves an unrelated task (deleted user not referenced at all) unchanged', () => {
    const result = planTaskAssignmentCleanup(
      {
        createdBy: OTHER_USER_ID,
        assignedTo: OTHER_USER_ID,
        assignedToUserIds: [OTHER_USER_ID],
      },
      USER_ID
    );
    expect(result.changed).toBe(false);
    expect(result.assignedTo).toBe(OTHER_USER_ID);
    expect(result.assignedToUserIds).toEqual([OTHER_USER_ID]);
  });

  it('assignedToUserIds becomes undefined (not []) when it would end up empty', () => {
    const result = planTaskAssignmentCleanup(
      { createdBy: OTHER_USER_ID, assignedToUserIds: [USER_ID] },
      USER_ID
    );
    expect(result.assignedToUserIds).toBeUndefined();
  });
});

describe('verifyNoResidualTaskAssignment', () => {
  it('true when no task references the deleted user in either field', () => {
    expect(
      verifyNoResidualTaskAssignment(
        [
          { createdBy: OTHER_USER_ID, assignedTo: OTHER_USER_ID },
          { createdBy: OTHER_USER_ID, assignedToUserIds: [THIRD_USER_ID] },
        ],
        USER_ID
      )
    ).toBe(true);
  });

  it('false (verification fails) if any task still has assignedTo === deletedUserId', () => {
    expect(
      verifyNoResidualTaskAssignment(
        [{ createdBy: OTHER_USER_ID, assignedTo: USER_ID }],
        USER_ID
      )
    ).toBe(false);
  });

  it('false (verification fails) if any task still has the deleted user inside assignedToUserIds', () => {
    expect(
      verifyNoResidualTaskAssignment(
        [{ createdBy: OTHER_USER_ID, assignedToUserIds: [USER_ID] }],
        USER_ID
      )
    ).toBe(false);
  });
});

describe('verifyNoResidualEventTaskAssignment', () => {
  it('true when no eventTasks row references the deleted user', () => {
    expect(
      verifyNoResidualEventTaskAssignment(
        [{ assignedToUserId: OTHER_USER_ID, assignedByUserId: OTHER_USER_ID }],
        USER_ID
      )
    ).toBe(true);
  });
  it('false if assignedToUserId still equals the deleted user', () => {
    expect(
      verifyNoResidualEventTaskAssignment(
        [{ assignedToUserId: USER_ID }],
        USER_ID
      )
    ).toBe(false);
  });
  it('false if assignedByUserId still equals the deleted user', () => {
    expect(
      verifyNoResidualEventTaskAssignment(
        [{ assignedByUserId: USER_ID }],
        USER_ID
      )
    ).toBe(false);
  });
});

// ── Source-inspection coverage for invariants that require the real files ──
const ACCOUNT_DELETION_SOURCE = readFileSync(
  new URL('../../convex/accountDeletion.ts', import.meta.url),
  'utf8'
);
const USERS_SOURCE = readFileSync(
  new URL('../../convex/users.ts', import.meta.url),
  'utf8'
);

describe('convex/users.ts — deleteMyAccount (source inspection)', () => {
  it('resolves the caller via getAuthUserId, never the raw identity.subject', () => {
    const section = USERS_SOURCE.slice(
      USERS_SOURCE.indexOf('export const deleteMyAccount = mutation({'),
      USERS_SOURCE.indexOf('export const deleteMyAccount = mutation({') + 1200
    );
    expect(section).toContain('const userId = await getAuthUserId(ctx);');
    expect(section).not.toContain('identity.subject');
  });

  it('throws when the authenticated user cannot be resolved — never returns a soft success', () => {
    const section = USERS_SOURCE.slice(
      USERS_SOURCE.indexOf('export const deleteMyAccount = mutation({'),
      USERS_SOURCE.indexOf('export const deleteMyAccount = mutation({') + 1200
    );
    expect(section).toMatch(/if \(!userId\) \{\s*throw new Error/);
  });

  it('never returns the old false-success shape ({ success: true, deletedCount: 0 })', () => {
    const handlerSection = USERS_SOURCE.slice(
      USERS_SOURCE.indexOf('export const deleteMyAccount = mutation({'),
      USERS_SOURCE.indexOf('export const deleteMyAccount = mutation({') + 1200
    );
    expect(handlerSection).not.toContain('deletedCount: deletedCount');
    expect(handlerSection).not.toMatch(/deletedCount,\s*\n\s*\};/);
    expect(handlerSection).not.toContain('let deletedCount = 0;');
  });

  it('delegates all deletion logic to runAccountDeletion from convex/accountDeletion.ts', () => {
    expect(USERS_SOURCE).toContain(
      "import { runAccountDeletion } from './accountDeletion';"
    );
    expect(USERS_SOURCE).toContain('await runAccountDeletion(ctx, userId);');
  });
});

describe('convex/accountDeletion.ts — runAccountDeletion shape invariants (source inspection)', () => {
  it('buildAccountDeletionPlan throws if the resolved userId does not correspond to a real users row — shared by preview and execution', () => {
    const idx = ACCOUNT_DELETION_SOURCE.indexOf(
      'export async function buildAccountDeletionPlan'
    );
    const section = ACCOUNT_DELETION_SOURCE.slice(idx, idx + 600);
    expect(section).toContain('if (!user) {');
    expect(section).toContain('throw new Error(');
  });

  it('runAccountDeletion builds its plan via buildAccountDeletionPlan — the exact same function the preview uses', () => {
    const idx = ACCOUNT_DELETION_SOURCE.indexOf(
      'export async function runAccountDeletion'
    );
    const section = ACCOUNT_DELETION_SOURCE.slice(idx, idx + 400);
    expect(section).toContain(
      'const plan = await buildAccountDeletionPlan(ctx, userId);'
    );
  });

  it('checks blockers (isAccountDeletionSafeToExecute) on the plan before any ctx.db.patch/delete/insert call', () => {
    const blockerCheckIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'if (!isAccountDeletionSafeToExecute(plan.blockers)) {'
    );
    expect(blockerCheckIdx).toBeGreaterThan(-1);
    const beforeBlockerCheck = ACCOUNT_DELETION_SOURCE.slice(
      0,
      blockerCheckIdx
    );
    expect(beforeBlockerCheck).not.toContain('ctx.db.patch(');
    expect(beforeBlockerCheck).not.toContain('ctx.db.delete(');
    expect(beforeBlockerCheck).not.toContain('ctx.db.insert(');
  });

  it('checks the transaction-size preflight (plan.sizeCheck) before any ctx.db.patch/delete/insert call', () => {
    const sizeCheckIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'if (!plan.sizeCheck.safe) {'
    );
    expect(sizeCheckIdx).toBeGreaterThan(-1);
    const beforeSizeCheck = ACCOUNT_DELETION_SOURCE.slice(0, sizeCheckIdx);
    expect(beforeSizeCheck).not.toContain('ctx.db.patch(');
    expect(beforeSizeCheck).not.toContain('ctx.db.delete(');
    expect(beforeSizeCheck).not.toContain('ctx.db.insert(');
  });

  it('the blocker check happens strictly before the transaction-size check', () => {
    const blockerIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'if (!isAccountDeletionSafeToExecute(plan.blockers)) {'
    );
    const sizeIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'if (!plan.sizeCheck.safe) {'
    );
    expect(blockerIdx).toBeGreaterThan(-1);
    expect(sizeIdx).toBeGreaterThan(blockerIdx);
  });

  it('buildAccountDeletionPreview is pure over the plan — takes no ctx, so it cannot write even by mistake', () => {
    const idx = ACCOUNT_DELETION_SOURCE.indexOf(
      'export function buildAccountDeletionPreview('
    );
    const endIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'export async function runAccountDeletion'
    );
    expect(idx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(idx);
    const section = ACCOUNT_DELETION_SOURCE.slice(idx, endIdx);
    expect(section).not.toContain('ctx.');
    expect(section).not.toContain('ctx:');
    expect(section).not.toContain('ctx,');
  });

  it('deletes the users row via a single ctx.db.delete(userId) call, strictly after every other write', () => {
    const lastSectionIdx = ACCOUNT_DELETION_SOURCE.lastIndexOf(
      'Delete the users row LAST'
    );
    const userDeleteIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'await ctx.db.delete(userId);'
    );
    expect(lastSectionIdx).toBeGreaterThan(-1);
    expect(userDeleteIdx).toBeGreaterThan(lastSectionIdx);
    const afterUserDelete = ACCOUNT_DELETION_SOURCE.slice(
      userDeleteIdx + 'await ctx.db.delete(userId);'.length
    );
    expect(afterUserDelete).not.toContain('ctx.db.delete(');
    expect(afterUserDelete).not.toContain('ctx.db.patch(');
  });

  it('verification pass (residual reference checks) runs strictly before Auth cleanup and the final users-row delete', () => {
    const verifyIdx = ACCOUNT_DELETION_SOURCE.indexOf('VERIFY CLEANUP');
    const authCleanupIdx =
      ACCOUNT_DELETION_SOURCE.indexOf('Auth cleanup (§16)');
    const userDeleteIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'await ctx.db.delete(userId);'
    );
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(authCleanupIdx).toBeGreaterThan(verifyIdx);
    expect(userDeleteIdx).toBeGreaterThan(authCleanupIdx);
  });

  it('auth cleanup follows the exact dependency order: refresh tokens → verification codes → verifiers → sessions → accounts → rate limit', () => {
    const authSection = ACCOUNT_DELETION_SOURCE.slice(
      ACCOUNT_DELETION_SOURCE.indexOf('Auth cleanup (§16)'),
      ACCOUNT_DELETION_SOURCE.indexOf('await ctx.db.delete(userId);')
    );
    const order = [
      'for (const token of authRefreshTokens)',
      'for (const code of authVerificationCodes)',
      'for (const verifier of authVerifiers)',
      'for (const session of authSessions)',
      'for (const account of authAccounts)',
      'if (authRateLimitRow)',
    ];
    let lastIdx = -1;
    for (const marker of order) {
      const idx = authSection.indexOf(marker);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('external family entity rows are only ever patched, never deleted', () => {
    const section = ACCOUNT_DELETION_SOURCE.slice(
      ACCOUNT_DELETION_SOURCE.indexOf(
        'External family entity rows — patched, NEVER deleted'
      ),
      ACCOUNT_DELETION_SOURCE.indexOf('familyContacts mirrors on external')
    );
    expect(section).toContain('ctx.db.patch(row._id, patch)');
    expect(section).not.toContain('ctx.db.delete');
  });

  it('reuses planExternalEntityReset / planFamilyContactsReset from lib/qaReset.ts rather than reimplementing them', () => {
    expect(ACCOUNT_DELETION_SOURCE).toContain('  planExternalEntityReset,');
    expect(ACCOUNT_DELETION_SOURCE).toContain('planFamilyContactsReset,');
    expect(ACCOUNT_DELETION_SOURCE).toContain("from '../lib/qaReset';");
  });

  it('never reassigns createdBy anywhere in the file', () => {
    expect(ACCOUNT_DELETION_SOURCE).not.toMatch(/createdBy:\s*userId/);
    expect(ACCOUNT_DELETION_SOURCE).not.toContain('createdBy: cleanup');
  });

  it('scheduled reminders are cancelled via ctx.scheduler.cancel only when pending, before being deleted', () => {
    const section = ACCOUNT_DELETION_SOURCE.slice(
      ACCOUNT_DELETION_SOURCE.indexOf('Cancel + delete scheduled reminders'),
      ACCOUNT_DELETION_SOURCE.indexOf('Delete personal-scope events/tasks')
    );
    expect(section).toContain("reminder.status === 'pending'");
    expect(section).toContain(
      'ctx.scheduler.cancel(reminder.scheduledFunctionId)'
    );
  });

  it('non-owned community memberships are only ever removed via ctx.db.delete on the membership row — the community itself is never deleted', () => {
    const section = ACCOUNT_DELETION_SOURCE.slice(
      ACCOUNT_DELETION_SOURCE.indexOf('Non-owned community memberships (§12)'),
      ACCOUNT_DELETION_SOURCE.indexOf('Cancel + delete scheduled reminders')
    );
    expect(section).toContain('await ctx.db.delete(membership._id);');
    expect(section).not.toContain('ctx.db.delete(communityId');
  });

  it('hard-deletes owned communities via ctx.db.delete(communityId), leaving no dangling ownerId', () => {
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'await ctx.db.delete(communityId);'
    );
  });

  it('hard-deleted community cascade deletes leaf rows (events, eventTasks, saved/rsvp/optOut, tasks, members, activities) before the community row itself', () => {
    const idx = ACCOUNT_DELETION_SOURCE.indexOf(
      'Hard-delete sole-owned communities'
    );
    const communityDeleteIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'await ctx.db.delete(communityId);'
    );
    expect(idx).toBeGreaterThan(-1);
    expect(communityDeleteIdx).toBeGreaterThan(idx);
    const section = ACCOUNT_DELETION_SOURCE.slice(idx, communityDeleteIdx);
    // eventTasks/savedCommunityEvents/userCalendarEntries/eventRsvps/
    // personalEventCalendarOptOuts are re-queried fresh per event here;
    // communityActivities/tasks/members were already read during planning
    // and are deleted from the precomputed map — both are leaf-before-root.
    expect(section).toContain("query('eventTasks')");
    expect(section).toContain("query('savedCommunityEvents')");
    expect(section).toContain("query('eventRsvps')");
    expect(section).toContain('communityActivitiesById.get(communityId)');
    expect(section).toContain(
      'for (const a of activities) await ctx.db.delete(a._id);'
    );
  });

  it('sole-owned space cascade deletes leaf rows (events, eventTasks, tasks, birthdays, members) before the space row itself', () => {
    const idx = ACCOUNT_DELETION_SOURCE.indexOf(
      'Delete sole-owned family/personal spaces'
    );
    const spaceDeleteIdx = ACCOUNT_DELETION_SOURCE.lastIndexOf(
      'await ctx.db.delete(spaceId);'
    );
    expect(idx).toBeGreaterThan(-1);
    expect(spaceDeleteIdx).toBeGreaterThan(idx);
    const section = ACCOUNT_DELETION_SOURCE.slice(idx, spaceDeleteIdx);
    // birthdays/members were already read during planning (precomputed
    // maps, same rationale as communityActivities above).
    expect(section).toContain('ownedSpaceBirthdaysBySpace.get(spaceId)');
    expect(section).toContain(
      'for (const b of birthdays) await ctx.db.delete(b._id);'
    );
  });

  it('uses the dedicated eventTasks indexes (by_assigned_user / by_assigned_by) for deterministic, non-bounded assignment discovery', () => {
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      "withIndex('by_assigned_user', (q) => q.eq('assignedToUserId', userId))"
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      "withIndex('by_assigned_by', (q) => q.eq('assignedByUserId', userId))"
    );
  });

  it('never performs a full table scan (.collect() with no .withIndex) on the tasks table for assignedToUserIds discovery', () => {
    const taskQueries =
      ACCOUNT_DELETION_SOURCE.match(
        /await ctx\.db\s*\n?\s*\.query\('tasks'\)[\s\S]{0,80}/g
      ) ?? [];
    expect(taskQueries.length).toBeGreaterThan(0);
    for (const query of taskQueries) {
      expect(query).toContain('.withIndex(');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// COMMUNITY OWNERSHIP AUTOMATIC TRANSFER — write-phase invariants (§15)
// ════════════════════════════════════════════════════════════════════════
describe('convex/accountDeletion.ts — community ownership transfer write phase (source inspection)', () => {
  const transferSectionIdx = ACCOUNT_DELETION_SOURCE.indexOf(
    'F2. Automatic community ownership transfer'
  );
  const transferSectionEnd = ACCOUNT_DELETION_SOURCE.indexOf(
    'Cancel + delete scheduled reminders',
    transferSectionIdx
  );
  const transferSection = ACCOUNT_DELETION_SOURCE.slice(
    transferSectionIdx,
    transferSectionEnd
  );

  it('the transfer write section exists, strictly after blocker/size gates and before the hard-delete cascade', () => {
    expect(transferSectionIdx).toBeGreaterThan(-1);
    const blockerCheckIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'if (!isAccountDeletionSafeToExecute(plan.blockers)) {'
    );
    const hardDeleteCascadeIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'Hard-delete sole-owned communities'
    );
    expect(transferSectionIdx).toBeGreaterThan(blockerCheckIdx);
    expect(hardDeleteCascadeIdx).toBeGreaterThan(transferSectionEnd);
  });

  it('patches community.ownerId and the successor membership role to owner', () => {
    expect(transferSection).toContain(
      'await ctx.db.patch(entry.communityId, { ownerId: entry.successor.userId });'
    );
    expect(transferSection).toContain(
      "await ctx.db.patch(entry.successor.membershipId, { role: 'owner' });"
    );
  });

  it("deletes the deleting owner's own membership row for each transferred community", () => {
    expect(transferSection).toContain('if (entry.ownerMembershipId) {');
    expect(transferSection).toContain(
      'await ctx.db.delete(entry.ownerMembershipId);'
    );
  });

  it('never deletes the community row itself in the transfer section (only hard-deleted communities are ever removed)', () => {
    expect(transferSection).not.toContain(
      'await ctx.db.delete(entry.communityId'
    );
  });

  it('never touches events/tasks in the transfer section — preserved community content is left completely alone', () => {
    expect(transferSection).not.toContain('personalEventsToDelete');
    expect(transferSection).not.toContain('personalTasksToDelete');
    expect(transferSection).not.toContain('ctx.db.delete(event');
    expect(transferSection).not.toContain('createdBy:');
  });

  it('creates exactly one durable in-app notification per transferred community, addressed only to the successor (never the deleting user)', () => {
    expect(transferSection).toContain('await createUserNotifications(ctx, {');
    expect(transferSection).toContain(
      'recipientUserIds: [entry.successor.userId],'
    );
    // Only ONE createUserNotifications call site exists in the transfer
    // loop — one call per loop iteration means exactly one notification
    // per transferred community, never a duplicate.
    const matches =
      transferSection.match(/createUserNotifications\(ctx, \{/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('uses the exact approved Hebrew notification copy', () => {
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      "const COMMUNITY_OWNERSHIP_TRANSFER_NOTIFICATION_TITLE =\n  'הבעלות על הקהילה הועברה אליך';"
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'כעת יש לך הרשאת בעלות וניהול מלאה בקהילה'
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'העברת הבעלות בוצעה אוטומטית בעקבות מחיקת חשבון'
    );
  });

  it('schedules push delivery via ctx.scheduler.runAfter to the existing internal.pushNotifications.sendPush action — never calls an external push API directly inside this mutation', () => {
    expect(transferSection).toContain(
      'await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {'
    );
    expect(transferSection).not.toContain('exp.host');
    expect(transferSection).not.toContain('fetch(');
  });

  it('the push scheduling call happens after the durable in-app notification insert (in-app is the source of truth)', () => {
    const notifyIdx = transferSection.indexOf(
      'await createUserNotifications(ctx, {'
    );
    const pushIdx = transferSection.indexOf(
      'await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {'
    );
    expect(notifyIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(notifyIdx);
  });

  it('hard-delete cascade section never calls createUserNotifications or schedules a push — no notification for a hard-deleted sole-owned community', () => {
    const hardDeleteCascadeIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'Hard-delete sole-owned communities'
    );
    const hardDeleteCascadeEndIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'Delete sole-owned family/personal spaces'
    );
    const hardDeleteSection = ACCOUNT_DELETION_SOURCE.slice(
      hardDeleteCascadeIdx,
      hardDeleteCascadeEndIdx
    );
    expect(hardDeleteSection).not.toContain('createUserNotifications');
    expect(hardDeleteSection).not.toContain('sendPush');
  });

  it('the new residual communityMembers verification check exists and runs before Auth cleanup', () => {
    const verifyIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'נותרו רשומות חברות בקהילה (communityMembers) עבור המשתמש שנמחק'
    );
    const authCleanupIdx =
      ACCOUNT_DELETION_SOURCE.indexOf('Auth cleanup (§16)');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(authCleanupIdx).toBeGreaterThan(verifyIdx);
    const verifyCleanupIdx = ACCOUNT_DELETION_SOURCE.indexOf('VERIFY CLEANUP');
    expect(verifyIdx).toBeGreaterThan(verifyCleanupIdx);
  });

  it('imports planCommunityOwnershipTransfer from lib/accountDeletion.ts — no second implementation of the successor rule', () => {
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'planCommunityOwnershipTransfer,'
    );
    expect(ACCOUNT_DELETION_SOURCE).not.toContain('planOwnedCommunityDeletion');
  });
});

describe('convex/schema.ts — eventTasks account-deletion indexes (source inspection)', () => {
  const SCHEMA_SOURCE = readFileSync(
    new URL('../../convex/schema.ts', import.meta.url),
    'utf8'
  );
  it('has by_assigned_user on assignedToUserId', () => {
    expect(SCHEMA_SOURCE).toContain(
      ".index('by_assigned_user', ['assignedToUserId'])"
    );
  });
  it('has by_assigned_by on assignedByUserId', () => {
    expect(SCHEMA_SOURCE).toContain(
      ".index('by_assigned_by', ['assignedByUserId'])"
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// READ-ONLY ACCOUNT DELETION PREVIEW
// ════════════════════════════════════════════════════════════════════════

// ── summarizeAccountDeletionPreview (pure) ──────────────────────────────────
// A fully-zeroed base input — every test below overrides only the fields
// it cares about, so each test's intent stays obvious.
const BASE_PREVIEW_INPUT: AccountDeletionPreviewInput = {
  blockers: [],
  plannedWriteCount: 0,
  writeSafetyLimit: ACCOUNT_DELETION_MAX_PLANNED_WRITES,
  sizeSafe: true,
  spaces: [],
  communities: [],
  nonOwnedCommunityMembershipCount: 0,
  personalEventDeleteCount: 0,
  personalTaskDeleteCount: 0,
  familyEventPreserveCount: 0,
  familyTaskPreserveCount: 0,
  communityEventPreserveCount: 0,
  communityTaskPreserveCount: 0,
  legacyOwnerScopeEventCount: 0,
  legacyOwnerScopeTaskCount: 0,
  ambiguousRecordCount: 0,
  tasksAssignedToClearCount: 0,
  tasksAssignedToUserIdsClearCount: 0,
  eventTasksAssignedToUserIdClearCount: 0,
  eventTasksAssignedByUserIdClearCount: 0,
  survivingMemberAssignmentCount: 0,
  externalEntityDetachCount: 0,
  externalAccessRowRemovalCount: 0,
  externalEntityAffectedSpaceCount: 0,
  userScopedCounts: {},
  authRefreshTokenCount: 0,
  authSessionCount: 0,
  authAccountCount: 0,
  authVerificationCodeCount: 0,
  authVerifierCount: 0,
  authRateLimitRowCount: 0,
  eventSharedUserRefsRemoved: 0,
  eventSharedFamilyMemberRefsRemapped: 0,
  taskMemberRefsRemapped: 0,
  communityMemberProfileRefsRemapped: 0,
  softDeletedTasksResolved: 0,
  unsafeMemberReferenceRemapCount: 0,
};

describe('summarizeAccountDeletionPreview', () => {
  it('safeToExecute is true only when there are zero blockers AND the size check passed', () => {
    expect(
      summarizeAccountDeletionPreview({
        ...BASE_PREVIEW_INPUT,
        blockers: [],
        sizeSafe: true,
      }).safeToExecute
    ).toBe(true);
    expect(
      summarizeAccountDeletionPreview({
        ...BASE_PREVIEW_INPUT,
        blockers: ['a blocker'],
        sizeSafe: true,
      }).safeToExecute
    ).toBe(false);
    expect(
      summarizeAccountDeletionPreview({
        ...BASE_PREVIEW_INPUT,
        blockers: [],
        sizeSafe: false,
      }).safeToExecute
    ).toBe(false);
  });

  it('passes blockers/plannedWriteCount/writeSafetyLimit straight through — never recomputes them', () => {
    const result = summarizeAccountDeletionPreview({
      ...BASE_PREVIEW_INPUT,
      blockers: ['blocker A', 'blocker B'],
      plannedWriteCount: 42,
      writeSafetyLimit: 4000,
    });
    expect(result.blockers).toEqual(['blocker A', 'blocker B']);
    expect(result.plannedWriteCount).toBe(42);
    expect(result.writeSafetyLimit).toBe(4000);
  });

  it('distinguishes owned communities that would transfer/hard-delete/block, and reports non-owned membership removals separately', () => {
    const result = summarizeAccountDeletionPreview({
      ...BASE_PREVIEW_INPUT,
      communities: [
        {
          communityId: 'c1',
          communityName: 'קהילה בבעלותי (סולו)',
          archived: false,
          action: 'hardDelete',
          eligibleSuccessorCount: 0,
          selectedSuccessorRole: null,
          selectedSuccessorJoinedAt: null,
          selectedSuccessorName: null,
          reason: null,
        },
        {
          communityId: 'c2',
          communityName: 'קהילה בבעלותי (משותפת, יש אדמין)',
          archived: false,
          action: 'transfer',
          eligibleSuccessorCount: 3,
          selectedSuccessorRole: 'admin',
          selectedSuccessorJoinedAt: 12_345,
          selectedSuccessorName: 'דנה כהן',
          reason: null,
        },
        {
          communityId: 'c3',
          communityName: 'קהילה עם נתונים לא עקביים',
          archived: false,
          action: 'blocked',
          eligibleSuccessorCount: 0,
          selectedSuccessorRole: null,
          selectedSuccessorJoinedAt: null,
          selectedSuccessorName: null,
          reason:
            'לא ניתן להעביר באופן בטוח את הבעלות על הקהילה "קהילה עם נתונים לא עקביים": נתוני החברות בקהילה אינם עקביים. יש לפנות לתמיכה.',
        },
      ],
      nonOwnedCommunityMembershipCount: 5,
    });
    expect(result.communities.ownedCount).toBe(3);
    expect(result.communities.transferCount).toBe(1);
    expect(result.communities.hardDeletableCount).toBe(1);
    expect(result.communities.blockedCount).toBe(1);
    // Non-owned memberships (just removed, community itself untouched) are
    // reported as a completely distinct count from owned-community counts.
    expect(result.communities.nonOwnedMembershipRemovalCount).toBe(5);
    expect(result.communities.details).toHaveLength(3);
  });

  it('distinguishes deletable vs blocked owned spaces', () => {
    const result = summarizeAccountDeletionPreview({
      ...BASE_PREVIEW_INPUT,
      spaces: [
        {
          spaceId: 's1',
          spaceName: 'Solo',
          action: 'hardDelete',
          deletable: true,
          otherJoinedUserCount: 0,
        },
        {
          spaceId: 's2',
          spaceName: 'Shared',
          action: 'blocked',
          deletable: false,
          otherJoinedUserCount: 2,
        },
      ],
    });
    expect(result.spaces.ownedCount).toBe(2);
    expect(result.spaces.transferCount).toBe(0);
    expect(result.spaces.deletableCount).toBe(1);
    expect(result.spaces.blockedCount).toBe(1);
  });

  it('maps content/assignment/family/auth counts through to their named fields without altering them', () => {
    const result = summarizeAccountDeletionPreview({
      ...BASE_PREVIEW_INPUT,
      personalEventDeleteCount: 1,
      personalTaskDeleteCount: 2,
      familyEventPreserveCount: 3,
      familyTaskPreserveCount: 4,
      communityEventPreserveCount: 5,
      communityTaskPreserveCount: 6,
      legacyOwnerScopeEventCount: 7,
      legacyOwnerScopeTaskCount: 8,
      ambiguousRecordCount: 9,
      tasksAssignedToClearCount: 10,
      tasksAssignedToUserIdsClearCount: 11,
      eventTasksAssignedToUserIdClearCount: 12,
      eventTasksAssignedByUserIdClearCount: 13,
      survivingMemberAssignmentCount: 14,
      externalEntityDetachCount: 15,
      externalAccessRowRemovalCount: 16,
      externalEntityAffectedSpaceCount: 17,
      authRefreshTokenCount: 18,
      authSessionCount: 19,
      authAccountCount: 20,
      authVerificationCodeCount: 21,
      authVerifierCount: 22,
      authRateLimitRowCount: 1,
    });
    expect(result.content).toEqual({
      personalEventsToDelete: 1,
      personalTasksToDelete: 2,
      familyEventsPreserved: 3,
      familyTasksPreserved: 4,
      communityEventsPreserved: 5,
      communityTasksPreserved: 6,
      legacyOwnerScopeEvents: 7,
      legacyOwnerScopeTasks: 8,
      ambiguousRecords: 9,
    });
    expect(result.assignments).toEqual({
      tasksAssignedToCleared: 10,
      tasksAssignedToUserIdsCleared: 11,
      eventTasksAssignedToUserIdCleared: 12,
      eventTasksAssignedByUserIdCleared: 13,
      survivingMemberAssignmentsPreserved: 14,
    });
    expect(result.family).toEqual({
      externalEntitiesToDetach: 15,
      externalAccessRowsToRemove: 16,
      affectedSpaceCount: 17,
      samePhoneReMatchEligibleAfterDeletion: true,
    });
    expect(result.auth).toEqual({
      refreshTokens: 18,
      sessions: 19,
      accounts: 20,
      verificationCodes: 21,
      verifiers: 22,
      rateLimitRows: 1,
    });
  });

  it('samePhoneReMatchEligibleAfterDeletion is false when there is nothing to detach', () => {
    expect(
      summarizeAccountDeletionPreview({
        ...BASE_PREVIEW_INPUT,
        externalEntityDetachCount: 0,
      }).family.samePhoneReMatchEligibleAfterDeletion
    ).toBe(false);
  });

  it('passes userScopedCounts through verbatim as userScopedCleanup', () => {
    const result = summarizeAccountDeletionPreview({
      ...BASE_PREVIEW_INPUT,
      userScopedCounts: { pushTokens: 3, dailyMoods: 1, scheduledReminders: 2 },
    });
    expect(result.userScopedCleanup).toEqual({
      pushTokens: 3,
      dailyMoods: 1,
      scheduledReminders: 2,
    });
  });

  it('never returns a raw phone number anywhere in the shape (QA safety)', () => {
    const result = summarizeAccountDeletionPreview(BASE_PREVIEW_INPUT);
    const serialized = JSON.stringify(result);
    // No field in the documented shape carries a phone value at all — this
    // is a structural guard against accidentally adding one later.
    expect(serialized).not.toMatch(/\+972/);
  });
});

// ── convex/accountDeletion.ts + convex/accountDeletionPreview.ts (source
//    inspection) — planner reuse, zero-writes guarantee ────────────────────
const ACCOUNT_DELETION_PREVIEW_SOURCE = readFileSync(
  new URL('../../convex/accountDeletionPreview.ts', import.meta.url),
  'utf8'
);

describe('convex/accountDeletionPreview.ts — previewAccountDeletion (source inspection)', () => {
  it('is declared as an internalQuery — never a public query/mutation, and never internalMutation', () => {
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'export const previewAccountDeletion = internalQuery({'
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toMatch(/=\s*query\(\{/);
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toMatch(/=\s*mutation\(\{/);
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toContain('internalMutation');
  });

  it('performs ZERO writes anywhere in the file: no patch/insert/delete/scheduler/auth-mutation calls', () => {
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toContain('ctx.db.patch(');
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toContain('ctx.db.insert(');
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toContain('ctx.db.delete(');
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toContain(
      'ctx.scheduler.cancel('
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).not.toContain('ctx.auth.');
  });

  it('calls buildAccountDeletionPlan — the exact same planner runAccountDeletion executes against (no second implementation)', () => {
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'buildAccountDeletionPlan,'
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'buildAccountDeletionPreview,'
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      "} from './accountDeletion';"
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'await buildAccountDeletionPlan(ctx, userId)'
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'buildAccountDeletionPreview(plan)'
    );
  });

  it('is gated by the same fail-closed QA_RESET_ENABLED + QA_RESET_ALLOWED_PHONES guards as devTools.ts resetQaUser — throws, never a soft blocker', () => {
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      "process.env.QA_RESET_ENABLED === 'true'"
    );
    const envGuardIdx = ACCOUNT_DELETION_PREVIEW_SOURCE.indexOf(
      "process.env.QA_RESET_ENABLED === 'true'"
    );
    const envGuardSection = ACCOUNT_DELETION_PREVIEW_SOURCE.slice(
      envGuardIdx,
      envGuardIdx + 200
    );
    expect(envGuardSection).toContain('throw new Error(');
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain('parseQaResetAllowlist(');
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain('isPhoneAllowlisted(');
  });

  it('resolves the target user via checkUsersLookup by phone (never a client-supplied Convex Id) — fails closed on 0 or >1 matches', () => {
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain('checkUsersLookup(');
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      "withIndex('by_phone', (q) => q.eq('phone', normalizedPhone))"
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'args: {\n    phone: v.string(),\n  },'
    );
  });

  it('returns safeToExecute/blockers/plannedWriteCount/writeSafetyLimit as part of its declared return validator', () => {
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'safeToExecute: v.boolean(),'
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'blockers: v.array(v.string()),'
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'plannedWriteCount: v.number(),'
    );
    expect(ACCOUNT_DELETION_PREVIEW_SOURCE).toContain(
      'writeSafetyLimit: v.number(),'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// RESIDUAL REFERENCE INTEGRITY — DATA INTEGRITY WAVE
//
// Covers: events.sharedWithUserIds cleanup, member-id remap (fail-closed
// zero/multiple-candidate blocking, cross-space isolation), tasks.deletedBy
// stranded-in-own-trash hard-delete resolution.
// ════════════════════════════════════════════════════════════════════════

// ── §12: events.sharedWithUserIds / deleted-userId reference tests (5) ─────
describe('planEventResidualReferenceCleanup — user-id reference cleanup', () => {
  it('1. removes the deleted userId from sharedWithUserIds, preserving every other invitee', () => {
    const result = planEventResidualReferenceCleanup(
      { sharedWithUserIds: [USER_ID, OTHER_USER_ID, THIRD_USER_ID] },
      USER_ID,
      new Map()
    );
    expect(result.sharedWithUserIds).toEqual([OTHER_USER_ID, THIRD_USER_ID]);
    expect(result.changed).toBe(true);
  });

  it('2. sharedWithUserIds becomes undefined (not []) when the deleted user was the only entry', () => {
    const result = planEventResidualReferenceCleanup(
      { sharedWithUserIds: [USER_ID] },
      USER_ID,
      new Map()
    );
    expect(result.sharedWithUserIds).toBeUndefined();
    expect(result.changed).toBe(true);
  });

  it('3. an event that never referenced the deleted user is left completely unchanged', () => {
    const result = planEventResidualReferenceCleanup(
      { sharedWithUserIds: [OTHER_USER_ID, THIRD_USER_ID] },
      USER_ID,
      new Map()
    );
    expect(result.sharedWithUserIds).toEqual([OTHER_USER_ID, THIRD_USER_ID]);
    expect(result.changed).toBe(false);
  });

  it('4. an event with no sharedWithUserIds field at all is left unchanged (no crash on undefined)', () => {
    const result = planEventResidualReferenceCleanup({}, USER_ID, new Map());
    expect(result.sharedWithUserIds).toBeUndefined();
    expect(result.changed).toBe(false);
  });

  it('5. verifyNoResidualEventReferences fails verification if any patched event still carries the deleted userId', () => {
    expect(
      verifyNoResidualEventReferences(
        [{ sharedWithUserIds: [OTHER_USER_ID] }],
        USER_ID,
        new Set()
      )
    ).toBe(true);
    expect(
      verifyNoResidualEventReferences(
        [{ sharedWithUserIds: [USER_ID] }],
        USER_ID,
        new Set()
      )
    ).toBe(false);
  });
});

// ── planEventSharedUserIdsCleanup — narrow sibling used ONLY by the
// post-deletion repair tool (convex/devTools.ts
// repairAccountDeletionResidualReferences). Unlike
// planEventResidualReferenceCleanup above, this helper never reads or
// returns sharedWithFamilyMemberIds at all — proving by construction that
// the repair tool's sharedWithUserIds repair cannot ever touch member-id
// fields.
describe('planEventSharedUserIdsCleanup — repair-tool-only, never touches sharedWithFamilyMemberIds', () => {
  it('removes the deleted userId from sharedWithUserIds, preserving every other invitee', () => {
    const result = planEventSharedUserIdsCleanup(
      { sharedWithUserIds: [USER_ID, OTHER_USER_ID, THIRD_USER_ID] },
      USER_ID
    );
    expect(result.sharedWithUserIds).toEqual([OTHER_USER_ID, THIRD_USER_ID]);
    expect(result.changed).toBe(true);
  });

  it('sharedWithUserIds becomes undefined (not []) when the deleted user was the only entry', () => {
    const result = planEventSharedUserIdsCleanup(
      { sharedWithUserIds: [USER_ID] },
      USER_ID
    );
    expect(result.sharedWithUserIds).toBeUndefined();
    expect(result.changed).toBe(true);
  });

  it('an event that never referenced the deleted user is left completely unchanged', () => {
    const result = planEventSharedUserIdsCleanup(
      { sharedWithUserIds: [OTHER_USER_ID, THIRD_USER_ID] },
      USER_ID
    );
    expect(result.sharedWithUserIds).toEqual([OTHER_USER_ID, THIRD_USER_ID]);
    expect(result.changed).toBe(false);
  });

  it('an event with no sharedWithUserIds field at all is left unchanged (no crash on undefined)', () => {
    const result = planEventSharedUserIdsCleanup({}, USER_ID);
    expect(result.sharedWithUserIds).toBeUndefined();
    expect(result.changed).toBe(false);
  });

  it('the returned object has no sharedWithFamilyMemberIds key at all — it is structurally impossible for this helper to touch that field', () => {
    const result = planEventSharedUserIdsCleanup(
      { sharedWithUserIds: [USER_ID] },
      USER_ID
    );
    expect(Object.keys(result).sort()).toEqual([
      'changed',
      'sharedWithUserIds',
    ]);
  });
});

// ── §13: member-id remap tests (10) ─────────────────────────────────────────
describe('planFamilyMemberIdRemap — fail-closed access→entity remap', () => {
  it('1. exactly one candidate target in the same space → safe remap', () => {
    const result = planFamilyMemberIdRemap(
      [{ memberId: 'access1', spaceId: 'space1' }],
      [{ memberId: 'entity1', spaceId: 'space1' }]
    );
    expect(result.remap.get('access1')).toBe('entity1');
    expect(result.blockers).toEqual([]);
  });

  it('2. zero candidate targets in that space → fails closed with a blocker, no remap entry', () => {
    const result = planFamilyMemberIdRemap(
      [{ memberId: 'access1', spaceId: 'space1' }],
      []
    );
    expect(result.remap.has('access1')).toBe(false);
    expect(result.blockers).toHaveLength(1);
  });

  it('3. multiple candidate targets in the same space → fails closed with a blocker, never guesses by order', () => {
    const result = planFamilyMemberIdRemap(
      [{ memberId: 'access1', spaceId: 'space1' }],
      [
        { memberId: 'entity1', spaceId: 'space1' },
        { memberId: 'entity2', spaceId: 'space1' },
      ]
    );
    expect(result.remap.has('access1')).toBe(false);
    expect(result.blockers).toHaveLength(1);
  });

  it('4. cross-space isolation: a candidate target in a DIFFERENT space is never used as a remap target', () => {
    const result = planFamilyMemberIdRemap(
      [{ memberId: 'access1', spaceId: 'space1' }],
      [{ memberId: 'entity1', spaceId: 'space2' }]
    );
    expect(result.remap.has('access1')).toBe(false);
    // Treated exactly like the zero-candidate case for space1.
    expect(result.blockers).toHaveLength(1);
  });

  it('5. multiple independent sources across different spaces each resolve to their own space-scoped target', () => {
    const sources: MemberRemapRow[] = [
      { memberId: 'access1', spaceId: 'space1' },
      { memberId: 'access2', spaceId: 'space2' },
    ];
    const targets: MemberRemapRow[] = [
      { memberId: 'entity1', spaceId: 'space1' },
      { memberId: 'entity2', spaceId: 'space2' },
    ];
    const result = planFamilyMemberIdRemap(sources, targets);
    expect(result.remap.get('access1')).toBe('entity1');
    expect(result.remap.get('access2')).toBe('entity2');
    expect(result.blockers).toEqual([]);
  });

  it('6. one ambiguous source among several safe ones blocks the deletion overall while still resolving the safe ones', () => {
    const sources: MemberRemapRow[] = [
      { memberId: 'access1', spaceId: 'space1' },
      { memberId: 'access2', spaceId: 'space2' },
    ];
    const targets: MemberRemapRow[] = [
      { memberId: 'entity1', spaceId: 'space1' },
      { memberId: 'entityA', spaceId: 'space2' },
      { memberId: 'entityB', spaceId: 'space2' },
    ];
    const result = planFamilyMemberIdRemap(sources, targets);
    expect(result.remap.get('access1')).toBe('entity1');
    expect(result.remap.has('access2')).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(isAccountDeletionSafeToExecute(result.blockers)).toBe(false);
  });

  it('7. blocker text never embeds a raw member/space id (sanitized for the UI)', () => {
    const result = planFamilyMemberIdRemap(
      [{ memberId: 'access1', spaceId: 'space1' }],
      []
    );
    expect(result.blockers[0]).not.toContain('access1');
    expect(result.blockers[0]).not.toContain('space1');
  });

  it('8. no sources at all → empty remap, no blockers', () => {
    const result = planFamilyMemberIdRemap(
      [],
      [{ memberId: 'entity1', spaceId: 'space1' }]
    );
    expect(result.remap.size).toBe(0);
    expect(result.blockers).toEqual([]);
  });

  it('9. applying a resolved remap to an event array replaces the source id, dedupes, and preserves unrelated ids in stable order', () => {
    const remapResult = planFamilyMemberIdRemap(
      [{ memberId: 'access1', spaceId: 'space1' }],
      [{ memberId: 'entity1', spaceId: 'space1' }]
    );
    const cleanup = planEventResidualReferenceCleanup(
      { sharedWithFamilyMemberIds: ['access1', 'entity1', 'unrelated1'] },
      OTHER_USER_ID,
      remapResult.remap
    );
    // 'access1' remaps to 'entity1', which is already present — dedup
    // collapses them, and the unrelated id survives untouched.
    expect(cleanup.sharedWithFamilyMemberIds).toEqual([
      'entity1',
      'unrelated1',
    ]);
    expect(cleanup.changed).toBe(true);
  });

  it('10. applying a resolved remap to a task singular field replaces source→target and leaves unrelated tasks alone', () => {
    const remapResult = planFamilyMemberIdRemap(
      [{ memberId: 'access1', spaceId: 'space1' }],
      [{ memberId: 'entity1', spaceId: 'space1' }]
    );
    const remapped = planTaskMemberIdRemap(
      { assignedToMemberId: 'access1' },
      remapResult.remap
    );
    expect(remapped.assignedToMemberId).toBe('entity1');
    expect(remapped.changed).toBe(true);

    const unrelated = planTaskMemberIdRemap(
      { assignedToMemberId: 'someone-else' },
      remapResult.remap
    );
    expect(unrelated.assignedToMemberId).toBe('someone-else');
    expect(unrelated.changed).toBe(false);
  });
});

// ── Regression: unrelated pre-existing dangling member ids in the SAME
// space as the user actually being deleted must never block deletion and
// must never be remapped. `planFamilyMemberIdRemap`'s `sources` are always
// the deleting user's OWN `kind:'access'` rows actually being removed this
// transaction (built from `myMemberRows` in convex/accountDeletion.ts) and
// `targets` are entities matched to that SAME user via `matchedUserId` —
// never an open-ended scan of "any member id in the space that fails to
// resolve". This is what makes the production engine approach "A" (remap
// ONLY the exact access-row(s) known to be deleted) rather than approach
// "B" (scan the space for any dangling id and try to infer one) — see
// convex/devTools.ts's `repairAccountDeletionResidualReferences` doc
// comment for why approach "B" was proven unsafe for that separate tool.
describe('production deletion remap scope — unrelated dangling member ids are never sources or targets', () => {
  it('a space containing unrelated dangling member ids (never passed as sources/targets) produces no blocker and no remap entry for them, while the actual deleting user access row remaps safely', () => {
    // Space has TWO pre-existing dangling ids ("legacyDangling1"/"2") that
    // belong to neither `sources` nor `targets` — e.g. leftover references
    // from a completely different, earlier deletion/removal. They are
    // never supplied to planFamilyMemberIdRemap at all, exactly as the
    // real caller (convex/accountDeletion.ts) only ever builds
    // sources/targets from the CURRENT deleting user's own rows.
    const sources: MemberRemapRow[] = [
      { memberId: 'realAccessRowBeingDeleted', spaceId: 'space1' },
    ];
    const targets: MemberRemapRow[] = [
      { memberId: 'realSurvivingEntity', spaceId: 'space1' },
    ];
    const result = planFamilyMemberIdRemap(sources, targets);

    expect(result.remap.get('realAccessRowBeingDeleted')).toBe(
      'realSurvivingEntity'
    );
    expect(result.remap.has('legacyDangling1')).toBe(false);
    expect(result.remap.has('legacyDangling2')).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(isAccountDeletionSafeToExecute(result.blockers)).toBe(true);
  });

  it('an event/task/community row referencing unrelated dangling ids alongside the real access row only has the real access row remapped — dangling ids pass through completely untouched', () => {
    const remapResult = planFamilyMemberIdRemap(
      [{ memberId: 'realAccessRowBeingDeleted', spaceId: 'space1' }],
      [{ memberId: 'realSurvivingEntity', spaceId: 'space1' }]
    );

    const eventCleanup = planEventResidualReferenceCleanup(
      {
        sharedWithFamilyMemberIds: [
          'legacyDangling1',
          'realAccessRowBeingDeleted',
          'legacyDangling2',
        ],
      },
      OTHER_USER_ID,
      remapResult.remap
    );
    expect(eventCleanup.sharedWithFamilyMemberIds).toEqual([
      'legacyDangling1',
      'realSurvivingEntity',
      'legacyDangling2',
    ]);

    const taskRemap = planTaskMemberIdRemap(
      {
        assignedToMemberId: 'legacyDangling1',
        assignedToMemberIds: ['legacyDangling1', 'realAccessRowBeingDeleted'],
      },
      remapResult.remap
    );
    expect(taskRemap.assignedToMemberId).toBe('legacyDangling1');
    expect(taskRemap.assignedToMemberIds).toEqual([
      'legacyDangling1',
      'realSurvivingEntity',
    ]);

    const communityRemap = planCommunityMemberProfileRemap(
      {
        associatedProfileIds: ['legacyDangling2', 'realAccessRowBeingDeleted'],
      },
      remapResult.remap
    );
    expect(communityRemap.associatedProfileIds).toEqual([
      'legacyDangling2',
      'realSurvivingEntity',
    ]);
  });

  it('a space with unrelated dangling ids but ZERO sources for this deletion (deleting user has no access row needing remap in that space) produces no blockers at all', () => {
    // This models exactly Yaniv's scenario: a space has pre-existing
    // dangling ids A/B for unrelated reasons, but THIS deletion's
    // `externalAccessRows` computation never includes them as sources
    // because they were never the deleting user's own access row id.
    const result = planFamilyMemberIdRemap(
      [],
      [{ memberId: 'realSurvivingEntity', spaceId: 'space1' }]
    );
    expect(result.remap.size).toBe(0);
    expect(result.blockers).toEqual([]);
  });
});

describe('planTaskMemberIdRemap / verifyNoResidualTaskMemberReferences', () => {
  it('remaps both assignedToMemberId and assignedToMemberIds in a single pass', () => {
    const remap = new Map([['access1', 'entity1']]);
    const result = planTaskMemberIdRemap(
      {
        assignedToMemberId: 'access1',
        assignedToMemberIds: ['access1', 'other1'],
      },
      remap
    );
    expect(result.assignedToMemberId).toBe('entity1');
    expect(result.assignedToMemberIds).toEqual(['entity1', 'other1']);
    expect(result.changed).toBe(true);
  });

  it('verification fails if any task still carries a deleted member id in either field', () => {
    const deletedIds = new Set(['access1']);
    expect(
      verifyNoResidualTaskMemberReferences(
        [{ assignedToMemberId: 'entity1', assignedToMemberIds: ['other1'] }],
        deletedIds
      )
    ).toBe(true);
    expect(
      verifyNoResidualTaskMemberReferences(
        [{ assignedToMemberId: 'access1' }],
        deletedIds
      )
    ).toBe(false);
    expect(
      verifyNoResidualTaskMemberReferences(
        [{ assignedToMemberIds: ['access1'] }],
        deletedIds
      )
    ).toBe(false);
  });
});

describe('planCommunityMemberProfileRemap / verifyNoResidualCommunityMemberProfileReferences', () => {
  it('remaps associatedProfileIds, deduping and preserving unrelated ids', () => {
    const remap = new Map([['access1', 'entity1']]);
    const result = planCommunityMemberProfileRemap(
      { associatedProfileIds: ['access1', 'other1'] },
      remap
    );
    expect(result.associatedProfileIds).toEqual(['entity1', 'other1']);
    expect(result.changed).toBe(true);
  });

  it('leaves a membership with no matching id completely unchanged', () => {
    const remap = new Map([['access1', 'entity1']]);
    const result = planCommunityMemberProfileRemap(
      { associatedProfileIds: ['other1'] },
      remap
    );
    expect(result.associatedProfileIds).toEqual(['other1']);
    expect(result.changed).toBe(false);
  });

  it('verification fails if any membership still carries a deleted member id', () => {
    const deletedIds = new Set(['access1']);
    expect(
      verifyNoResidualCommunityMemberProfileReferences(
        [{ associatedProfileIds: ['entity1'] }],
        deletedIds
      )
    ).toBe(true);
    expect(
      verifyNoResidualCommunityMemberProfileReferences(
        [{ associatedProfileIds: ['access1'] }],
        deletedIds
      )
    ).toBe(false);
  });
});

// ── §14: tasks.deletedBy tests (4) ───────────────────────────────────────────
describe('isTaskStrandedInDeletingUsersTrash / verifyNoResidualDeletedByReference', () => {
  it("1. a task soft-deleted into the DELETING user's own trash is stranded → safe to hard-delete", () => {
    expect(
      isTaskStrandedInDeletingUsersTrash(
        { deletedAt: 1000, deletedBy: USER_ID },
        USER_ID
      )
    ).toBe(true);
  });

  it("2. a task soft-deleted into a DIFFERENT user's trash is never touched, even during that other user's account deletion check", () => {
    expect(
      isTaskStrandedInDeletingUsersTrash(
        { deletedAt: 1000, deletedBy: OTHER_USER_ID },
        USER_ID
      )
    ).toBe(false);
  });

  it('3. an active (never soft-deleted) task is never mistaken for stranded trash', () => {
    expect(
      isTaskStrandedInDeletingUsersTrash(
        { deletedBy: USER_ID, deletedAt: undefined },
        USER_ID
      )
    ).toBe(false);
  });

  it('4. verifyNoResidualDeletedByReference fails if any surviving task still has deletedBy === the deleted user', () => {
    expect(
      verifyNoResidualDeletedByReference(
        [{ deletedBy: OTHER_USER_ID }],
        USER_ID
      )
    ).toBe(true);
    expect(
      verifyNoResidualDeletedByReference([{ deletedBy: USER_ID }], USER_ID)
    ).toBe(false);
    // Hard-deleting the stranded row (never surfacing it here at all) also
    // satisfies verification — an empty surviving-tasks list is vacuously true.
    expect(verifyNoResidualDeletedByReference([], USER_ID)).toBe(true);
  });
});

// ── §15: preview shaping for the new residual-reference counts ─────────────
describe('summarizeAccountDeletionPreview — residualReferenceCleanup shaping', () => {
  it('maps every new count through to residualReferenceCleanup without altering them, and unsafeMemberReferenceRemapCount feeds the "unsafeMemberReferenceRemaps" field name', () => {
    const result = summarizeAccountDeletionPreview({
      ...BASE_PREVIEW_INPUT,
      eventSharedUserRefsRemoved: 1,
      eventSharedFamilyMemberRefsRemapped: 12,
      taskMemberRefsRemapped: 4,
      communityMemberProfileRefsRemapped: 2,
      softDeletedTasksResolved: 1,
      unsafeMemberReferenceRemapCount: 0,
    });
    expect(result.residualReferenceCleanup).toEqual({
      eventSharedUserRefsRemoved: 1,
      eventSharedFamilyMemberRefsRemapped: 12,
      taskMemberRefsRemapped: 4,
      communityMemberProfileRefsRemapped: 2,
      softDeletedTasksResolved: 1,
      unsafeMemberReferenceRemaps: 0,
    });
  });

  it('when an unsafe remap exists (blockers non-empty), safeToExecute is false and the preview reports it via unsafeMemberReferenceRemaps', () => {
    const result = summarizeAccountDeletionPreview({
      ...BASE_PREVIEW_INPUT,
      blockers: [
        'נמצאו מספר פרופילי משפחה אפשריים עבור חבר משפחה שהחשבון שלו נמחק — לא ניתן להמשיך במחיקת החשבון מבלי לנחש איזה מהם נכון. יש לפנות לתמיכה.',
      ],
      unsafeMemberReferenceRemapCount: 1,
    });
    expect(result.safeToExecute).toBe(false);
    expect(result.residualReferenceCleanup.unsafeMemberReferenceRemaps).toBe(1);
  });
});

// ── §11 regression: source-inspection checks that the new residual cleanup
//    writes/verifications actually exist in convex/accountDeletion.ts, run
//    AFTER blocker/size gates and BEFORE Auth cleanup — same invariants as
//    every other write phase in this file, extended (not duplicated). ─────
describe('convex/accountDeletion.ts — residual reference cleanup write phase (source inspection)', () => {
  it('imports every new pure helper from lib/accountDeletion.ts rather than reimplementing them', () => {
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'isTaskStrandedInDeletingUsersTrash,'
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'planCommunityMemberProfileRemap,'
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'planEventResidualReferenceCleanup,'
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain('planFamilyMemberIdRemap,');
    expect(ACCOUNT_DELETION_SOURCE).toContain('planTaskMemberIdRemap,');
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'verifyNoResidualCommunityMemberProfileReferences,'
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'verifyNoResidualDeletedByReference,'
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'verifyNoResidualEventReferences,'
    );
    expect(ACCOUNT_DELETION_SOURCE).toContain(
      'verifyNoResidualTaskMemberReferences,'
    );
  });

  it('the member-id remap plan (planFamilyMemberIdRemap) is built during planning and its blockers are pushed into plan.blockers BEFORE the blocker gate in runAccountDeletion', () => {
    const remapPlanIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'planFamilyMemberIdRemap('
    );
    const blockerGateIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'if (!isAccountDeletionSafeToExecute(plan.blockers)) {'
    );
    expect(remapPlanIdx).toBeGreaterThan(-1);
    // buildAccountDeletionPlan runs entirely before runAccountDeletion's
    // gate check (they are two separate functions; the plan call always
    // precedes the gate in source order too).
    expect(blockerGateIdx).toBeGreaterThan(remapPlanIdx);
    expect(
      ACCOUNT_DELETION_SOURCE.slice(remapPlanIdx, blockerGateIdx)
    ).toContain('blockers.push(...memberIdRemapPlan.blockers);');
  });

  it('every new residual-cleanup write happens after the blocker/size gates and before Auth cleanup', () => {
    const blockerGateIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'if (!isAccountDeletionSafeToExecute(plan.blockers)) {'
    );
    const authCleanupIdx =
      ACCOUNT_DELETION_SOURCE.indexOf('Auth cleanup (§16)');
    const writeMarkers = [
      'const cleanup = planEventResidualReferenceCleanup(',
      'const remap = planTaskMemberIdRemap(task, memberIdRemapPlan.remap);',
      'const remap = planCommunityMemberProfileRemap(',
    ];
    for (const marker of writeMarkers) {
      const idx = ACCOUNT_DELETION_SOURCE.indexOf(marker);
      expect(idx).toBeGreaterThan(blockerGateIdx);
      expect(idx).toBeLessThan(authCleanupIdx);
    }
  });

  it('hard-deletes myTrashedTasks (stranded soft-deleted tasks) rather than clearing deletedBy — never resurrects them as active content', () => {
    const section = ACCOUNT_DELETION_SOURCE.slice(
      ACCOUNT_DELETION_SOURCE.indexOf('for (const task of myTrashedTasks) {'),
      ACCOUNT_DELETION_SOURCE.indexOf('for (const task of myTrashedTasks) {') +
        200
    );
    expect(section).toContain('await ctx.db.delete(task._id);');
    expect(section).not.toContain('deletedBy: undefined');
  });

  it('verification for all four new categories runs strictly before Auth cleanup and the final users-row delete', () => {
    const verifyMarkers = [
      '!verifyNoResidualEventReferences(',
      '!verifyNoResidualTaskMemberReferences(',
      '!verifyNoResidualCommunityMemberProfileReferences(',
    ];
    const authCleanupIdx =
      ACCOUNT_DELETION_SOURCE.indexOf('Auth cleanup (§16)');
    const userDeleteIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'await ctx.db.delete(userId);'
    );
    for (const marker of verifyMarkers) {
      const idx = ACCOUNT_DELETION_SOURCE.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(authCleanupIdx);
      expect(idx).toBeLessThan(userDeleteIdx);
    }
  });

  it('the new plannedCounts entries feed plannedWriteCount so the write-limit blocker cannot be bypassed by the new writes', () => {
    const plannedCountsIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'const plannedCounts: Record<string, number> = {'
    );
    const estimateIdx = ACCOUNT_DELETION_SOURCE.indexOf(
      'const plannedWriteCount = estimateAccountDeletionWriteCount(plannedCounts);'
    );
    expect(plannedCountsIdx).toBeGreaterThan(-1);
    expect(estimateIdx).toBeGreaterThan(plannedCountsIdx);
    // These fields are set inside the same plannedCounts object literal
    // that feeds estimateAccountDeletionWriteCount(plannedCounts), so their
    // occurrences here must fall strictly between the two markers above.
    const section = ACCOUNT_DELETION_SOURCE.slice(
      plannedCountsIdx,
      estimateIdx
    );
    expect(section).toContain('eventResidualReferenceCleanups:');
    expect(section).toContain('eventsNeedingResidualReferenceCleanup.length');
    expect(section).toContain('taskMemberIdRemaps:');
    expect(section).toContain('tasksNeedingMemberIdRemap.length');
    expect(section).toContain('communityMemberProfileRemaps:');
    expect(section).toContain('communityMembershipsNeedingProfileRemap.length');
    expect(section).toContain('softDeletedTaskHardDeletes:');
    expect(section).toContain('myTrashedTasks.length');
  });
});

// ════════════════════════════════════════════════════════════════════════
// convex/devTools.ts — one-time guarded repair tool (source inspection
// only — this tool is NEVER invoked as part of this task or its tests)
// ════════════════════════════════════════════════════════════════════════
describe('convex/devTools.ts — repairAccountDeletionResidualReferences (source inspection, never executed)', () => {
  const DEV_TOOLS_SOURCE = readFileSync(
    new URL('../../convex/devTools.ts', import.meta.url),
    'utf8'
  );
  const repairIdx = DEV_TOOLS_SOURCE.indexOf(
    'export const repairAccountDeletionResidualReferences = internalMutation({'
  );

  it('exists as an internalMutation, guarded by the SAME QA_RESET_ENABLED + QA_RESET_ALLOWED_PHONES mechanism as resetQaUser', () => {
    expect(repairIdx).toBeGreaterThan(-1);
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 1500);
    expect(section).toContain("process.env.QA_RESET_ENABLED === 'true'");
    expect(section).toContain('parseQaResetAllowlist(');
    expect(section).toContain('isPhoneAllowlisted(');
    expect(section).toContain('throw new Error(');
  });

  it('dry-run defaults true; live execution requires BOTH dryRun:false AND execute:true via the shared resolveExecutionMode helper', () => {
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 6000);
    expect(section).toContain('resolveExecutionMode(args)');
    expect(section).not.toContain('dryRun ?? false');
  });

  it('refuses to run if a live users row exists for the phone, or if deletedUserId still has a live users row', () => {
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 6000);
    expect(section).toContain('activeUserForPhone');
    expect(section).toContain('deletedUserRowStillExists');
  });

  it('reuses isTaskStrandedInDeletingUsersTrash and the NARROW planEventSharedUserIdsCleanup — never the full member-id remap helpers', () => {
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 20_000);
    expect(section).toContain('isTaskStrandedInDeletingUsersTrash(');
    expect(section).toContain('planEventSharedUserIdsCleanup(');
  });

  it('NEVER imports or calls the full member-id remap helpers — it must not be able to infer/remap a source member id from arbitrary dangling refs', () => {
    // Checked as call-sites (trailing "(") rather than bare substrings,
    // because this function's own doc comment mentions
    // `planEventResidualReferenceCleanup` BY NAME (prose, not a call) when
    // explaining why this tool intentionally does NOT reuse it.
    expect(DEV_TOOLS_SOURCE).not.toContain('planTaskMemberIdRemap(');
    expect(DEV_TOOLS_SOURCE).not.toContain('planCommunityMemberProfileRemap(');
    expect(DEV_TOOLS_SOURCE).not.toContain(
      'planEventResidualReferenceCleanup('
    );
    expect(DEV_TOOLS_SOURCE).not.toContain('planFamilyMemberIdRemap(');
  });

  it('every write (ctx.db.patch/delete) in this mutation is unreachable unless canExecuteLive AND safeToExecute — both gated by an early return', () => {
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 20_000);
    const exitIdx = section.indexOf('if (!canExecuteLive || !safeToExecute) {');
    expect(exitIdx).toBeGreaterThan(-1);
    const beforeExit = section.slice(0, exitIdx);
    expect(beforeExit).not.toContain('ctx.db.patch(');
    expect(beforeExit).not.toContain('ctx.db.delete(');
  });

  it('every write in the live-execution branch only patches sharedWithUserIds or deletes a stranded task — never sharedWithFamilyMemberIds / assignedToMemberId(s) / associatedProfileIds', () => {
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 20_000);
    const exitIdx = section.indexOf('if (!canExecuteLive || !safeToExecute) {');
    const liveSection = section.slice(exitIdx);
    expect(liveSection).toContain(
      'sharedWithUserIds: cleanup.sharedWithUserIds'
    );
    expect(liveSection).not.toContain('sharedWithFamilyMemberIds:');
    expect(liveSection).not.toContain('assignedToMemberId:');
    expect(liveSection).not.toContain('assignedToMemberIds:');
    expect(liveSection).not.toContain('associatedProfileIds:');
  });

  it('blockers can only ever come from the two contradictory live-state guards — never from dangling member-id discovery (that is informational-only and appended to `warnings`, not `blockers`)', () => {
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 20_000);
    const blockerPushes = section.match(/blockers\.push\(/g) ?? [];
    // Exactly two blockers.push call sites: activeUserForPhone and
    // deletedUserRowStillExists. If a third ever appears (e.g. a
    // reintroduced dangling-id ambiguity blocker), this test fails.
    expect(blockerPushes.length).toBe(2);
    expect(section).not.toContain(
      'dangling member-id references — refusing to guess'
    );
  });

  it('dangling member-id diagnostics are reported ONLY under `informationalOnly` in the return shape, never under `plannedRepair`', () => {
    // The returns validator (`repairAccountDeletionResidualReferencesReturns`)
    // is declared BEFORE `export const repairAccountDeletionResidualReferences
    // = internalMutation({`, so it is outside the `repairIdx`-anchored slice
    // used by the other tests in this block — search the whole file for it.
    expect(DEV_TOOLS_SOURCE).toContain('informationalOnly');
    expect(DEV_TOOLS_SOURCE).toContain('unrelatedDanglingMemberIdsFound');
    expect(DEV_TOOLS_SOURCE).toContain('unrelatedMemberReferenceCounts');
    expect(DEV_TOOLS_SOURCE).toContain('plannedRepair');
    // plannedRepair's own field list must not include any member-id field.
    const plannedRepairObjIdx = DEV_TOOLS_SOURCE.indexOf(
      'plannedRepair: v.object({'
    );
    const informationalObjIdx = DEV_TOOLS_SOURCE.indexOf(
      'informationalOnly: v.object({'
    );
    expect(plannedRepairObjIdx).toBeGreaterThan(-1);
    expect(informationalObjIdx).toBeGreaterThan(plannedRepairObjIdx);
    const plannedRepairValidatorSection = DEV_TOOLS_SOURCE.slice(
      plannedRepairObjIdx,
      informationalObjIdx
    );
    expect(plannedRepairValidatorSection).not.toContain('MemberRefs');
  });

  it('scope is limited to events.sharedWithUserIds / tasks.deletedBy — never createdBy or communityActivities.actorUserId', () => {
    const section = DEV_TOOLS_SOURCE.slice(repairIdx, repairIdx + 20_000);
    expect(section).not.toContain('createdBy:');
    expect(section).not.toContain('actorUserId');
  });

  it('this repair tool is never invoked anywhere in the codebase — no ctx.runMutation call site references it', () => {
    // Structural guard against accidental execution: the mutation is
    // exported (so devTools.ts/schema can reference its shape), but no
    // call site anywhere schedules or runs it directly.
    expect(DEV_TOOLS_SOURCE).not.toContain(
      'runMutation(internal.devTools.repairAccountDeletionResidualReferences'
    );
    expect(DEV_TOOLS_SOURCE).not.toContain(
      'runAfter(0, internal.devTools.repairAccountDeletionResidualReferences'
    );
  });
});
