/**
 * Stage 2A — getPendingPhoneMatches (convex/members.ts)
 *
 * This repo has no Convex query test harness (see
 * tests/convex/eventTaskRsvpDecoupling.test.ts's documented precedent).
 * Given that constraint:
 *
 *   - The safety-critical filtering logic (filterPendingPhoneMatchCandidates,
 *     lib/pendingPhoneMatches.ts) is pure and fully covered here via direct
 *     behavioral tests (items 2-10).
 *   - Invariants that require inspecting the actual shipped query body
 *     (unauthenticated behavior, response shape / no private fields
 *     exposed) are verified via source inspection of the REAL
 *     convex/members.ts file (items 1, 11-13) — the same pattern used in
 *     tests/convex/eventTaskRsvpDecoupling.test.ts.
 *
 * Run with: bun test tests/convex/getPendingPhoneMatches.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  filterPendingPhoneMatchCandidates,
  type PendingMatchCandidateRow,
} from '../../lib/pendingPhoneMatches';

const CURRENT_USER = 'user_me';
const NORMALIZED_PHONE = '+972501234567';

function normalizeToE164(phone: string): string | null {
  const stripped = phone.replace(/[\s\-()]/g, '');
  if (stripped.startsWith('+972')) return stripped;
  if (stripped.startsWith('972')) return `+${stripped}`;
  if (stripped.startsWith('0')) return `+972${stripped.slice(1)}`;
  if (stripped.startsWith('5')) return `+972${stripped}`;
  return null;
}

function resolveKind(member: {
  kind?: 'access' | 'entity';
  displayName?: string;
  userId?: string;
}): 'access' | 'entity' {
  if (member.kind) return member.kind;
  if (!member.displayName && member.userId) return 'access';
  return 'entity';
}

function baseInput(candidateRows: PendingMatchCandidateRow[]) {
  return {
    currentUserId: CURRENT_USER,
    normalizedUserPhone: NORMALIZED_PHONE,
    candidateRows,
    accessSpaceIds: new Set<string>(),
    existingSpaceIds: new Set<string>(candidateRows.map((r) => r.spaceId)),
    resolveKind,
    normalizeToE164,
  };
}

describe('filterPendingPhoneMatchCandidates — own matched entity rows [TEST 4, 5]', () => {
  it('[4] own matched entity row → returned', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
      displayName: 'Me',
    };
    const result = filterPendingPhoneMatchCandidates(baseInput([row]));
    expect(result).toEqual([row]);
  });

  it('[5] multiple own matches across different spaces → all returned', () => {
    const row1: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const row2: PendingMatchCandidateRow = {
      _id: 'm2',
      spaceId: 'space2',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const result = filterPendingPhoneMatchCandidates(baseInput([row1, row2]));
    expect(result).toHaveLength(2);
    expect(result).toEqual([row1, row2]);
  });

  it('no matches at all → empty array [TEST 3 analog]', () => {
    const result = filterPendingPhoneMatchCandidates(baseInput([]));
    expect(result).toEqual([]);
  });
});

describe('filterPendingPhoneMatchCandidates — exclusion rules [TEST 6-10]', () => {
  it('[6] entity with another matchedUserId → excluded', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'entity',
      matchedUserId: 'someone_else',
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const result = filterPendingPhoneMatchCandidates(baseInput([row]));
    expect(result).toEqual([]);
  });

  it('[7] access-row kind is never returned as a match', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'access',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
      userId: CURRENT_USER,
    };
    const result = filterPendingPhoneMatchCandidates(baseInput([row]));
    expect(result).toEqual([]);
  });

  it('[7b] pre-kind row that infers to access (userId set, no displayName) → excluded', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
      userId: CURRENT_USER,
      // no displayName, no kind → resolveKind() infers 'access'
    };
    const result = filterPendingPhoneMatchCandidates(baseInput([row]));
    expect(result).toEqual([]);
  });

  it('[8] entity phone mismatch (different/stale normalized phone) → excluded', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: '+972529999999',
    };
    const result = filterPendingPhoneMatchCandidates(baseInput([row]));
    expect(result).toEqual([]);
  });

  it('entity with no selectedPhoneNumber at all → excluded', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
    };
    const result = filterPendingPhoneMatchCandidates(baseInput([row]));
    expect(result).toEqual([]);
  });

  it('[9] existing access row in same space → excluded even though the entity row matches', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const input = baseInput([row]);
    const result = filterPendingPhoneMatchCandidates({
      ...input,
      accessSpaceIds: new Set(['space1']),
    });
    expect(result).toEqual([]);
  });

  it('[10] missing/deleted space → excluded', () => {
    const row: PendingMatchCandidateRow = {
      _id: 'm1',
      spaceId: 'space1',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const result = filterPendingPhoneMatchCandidates({
      ...baseInput([row]),
      existingSpaceIds: new Set(), // space1 not present → deleted/missing
    });
    expect(result).toEqual([]);
  });

  it('mixed batch: only the fully-safe candidate survives', () => {
    const safe: PendingMatchCandidateRow = {
      _id: 'safe',
      spaceId: 'space_safe',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const otherUser: PendingMatchCandidateRow = {
      _id: 'other',
      spaceId: 'space_other',
      kind: 'entity',
      matchedUserId: 'someone_else',
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const accessKind: PendingMatchCandidateRow = {
      _id: 'access',
      spaceId: 'space_access',
      kind: 'access',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const phoneMismatch: PendingMatchCandidateRow = {
      _id: 'mismatch',
      spaceId: 'space_mismatch',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: '+972521111111',
    };
    const alreadyAccessed: PendingMatchCandidateRow = {
      _id: 'already',
      spaceId: 'space_already',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };
    const deletedSpace: PendingMatchCandidateRow = {
      _id: 'deleted',
      spaceId: 'space_deleted',
      kind: 'entity',
      matchedUserId: CURRENT_USER,
      selectedPhoneNumber: NORMALIZED_PHONE,
    };

    const allRows = [
      safe,
      otherUser,
      accessKind,
      phoneMismatch,
      alreadyAccessed,
      deletedSpace,
    ];

    const result = filterPendingPhoneMatchCandidates({
      currentUserId: CURRENT_USER,
      normalizedUserPhone: NORMALIZED_PHONE,
      candidateRows: allRows,
      accessSpaceIds: new Set(['space_already']),
      existingSpaceIds: new Set([
        'space_safe',
        'space_other',
        'space_access',
        'space_mismatch',
        'space_already',
        // space_deleted intentionally absent
      ]),
      resolveKind,
      normalizeToE164,
    });

    expect(result).toEqual([safe]);
  });
});

// ── Source-inspection coverage for invariants that require the real handler ──
const MEMBERS_SOURCE = readFileSync(
  new URL('../../convex/members.ts', import.meta.url),
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

const getPendingPhoneMatchesSrc = extractExportBlock(
  MEMBERS_SOURCE,
  'getPendingPhoneMatches'
);
const matchOnPhoneSrc = extractExportBlock(MEMBERS_SOURCE, 'matchOnPhone');

describe('getPendingPhoneMatches — unauthenticated behavior [TEST 1]', () => {
  it('returns [] for an unauthenticated caller (does not throw) — matches listMyFamilyContacts/getMySpaceRole convention in this file', () => {
    expect(getPendingPhoneMatchesSrc).toContain(
      'const userId = await getAuthUserId(ctx);'
    );
    expect(getPendingPhoneMatchesSrc).toContain('if (!userId) return [];');
  });

  it('[2] no phone on user record → returns [] before any matching attempted', () => {
    expect(getPendingPhoneMatchesSrc).toContain('if (!userPhone) return [];');
  });
});

describe('getPendingPhoneMatches — response shape [TEST 11-13]', () => {
  it('[11] returns validator only exposes memberId, spaceName, displayName (spaceId deliberately excluded)', () => {
    expect(getPendingPhoneMatchesSrc).toContain("memberId: v.id('members')");
    expect(getPendingPhoneMatchesSrc).toContain('spaceName: v.string()');
    expect(getPendingPhoneMatchesSrc).toContain(
      'displayName: v.optional(v.string())'
    );
  });

  it('minimal-safe cleanup: spaceId is not part of the returns validator', () => {
    expect(getPendingPhoneMatchesSrc).not.toContain("spaceId: v.id('spaces')");
  });

  it('minimal-safe cleanup: the mapped response object does not include spaceId', () => {
    expect(getPendingPhoneMatchesSrc).toContain(
      "return safeCandidates.map((row) => ({\n      memberId: row._id,\n      spaceName: spaceNameById.get(row.spaceId) ?? '',\n      displayName: row.displayName,\n    }));"
    );
  });

  it('[12] never returns a raw phone number field', () => {
    expect(getPendingPhoneMatchesSrc).not.toContain('selectedPhoneNumber:');
    expect(getPendingPhoneMatchesSrc).not.toContain('phone:');
  });

  it('[13] never returns member lists or other users\u2019 ids', () => {
    expect(getPendingPhoneMatchesSrc).not.toContain('members:');
    expect(getPendingPhoneMatchesSrc).not.toContain('matchedUserId:');
    expect(getPendingPhoneMatchesSrc).not.toContain('userId:');
  });

  it('does not grant access, create rows, or mutate any data (read-only query)', () => {
    expect(getPendingPhoneMatchesSrc).not.toContain('ctx.db.insert');
    expect(getPendingPhoneMatchesSrc).not.toContain('ctx.db.patch');
    expect(getPendingPhoneMatchesSrc).not.toContain('ctx.db.delete');
  });

  it('does not auto-select a single match — maps and returns the full filtered array', () => {
    expect(getPendingPhoneMatchesSrc).toContain('safeCandidates.map(');
    expect(getPendingPhoneMatchesSrc).not.toContain('.find(');
  });
});

describe('matchOnPhone — untouched by Stage 2A (regression guard)', () => {
  it('still auto-assigns userId/matchedUserId/inviteStatus and creates the access row exactly as before', () => {
    expect(matchOnPhoneSrc).toContain('matchedUserId: userId');
    expect(matchOnPhoneSrc).toContain('userId: userId');
    expect(matchOnPhoneSrc).toContain("inviteStatus: 'joined'");
    expect(matchOnPhoneSrc).toContain("kind: 'access'");
  });

  it('does not reference the new Stage 2A helper (getPendingPhoneMatches logic stays fully separate)', () => {
    expect(matchOnPhoneSrc).not.toContain('filterPendingPhoneMatchCandidates');
  });
});
