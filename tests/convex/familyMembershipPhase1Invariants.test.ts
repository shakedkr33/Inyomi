/**
 * Family Membership Lifecycle Phase 1 — core invariants (convex/members.ts)
 *
 *   - computeIsSelectableForPicker is a PURE predicate, tested directly.
 *   - computeIsFullyJoined, assertNoActiveFamilyMembership,
 *     executeFamilyJoin, getMyPendingFamilyPreview, and
 *     hasPendingMatchMemberId require ctx.db access and have no Convex
 *     mutation/query test harness in this repo (see
 *     tests/convex/phoneMatchConfirmation.test.ts's documented precedent)
 *     — their invariants are verified via source inspection of the REAL
 *     convex/members.ts file.
 *
 * Run with: bun test tests/convex/familyMembershipPhase1Invariants.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { computeIsSelectableForPicker } from '../../convex/members';

const MEMBERS_SOURCE = readFileSync(
  new URL('../../convex/members.ts', import.meta.url),
  'utf8'
);

function extractExportedFunctionBlock(source: string, fnName: string): string {
  const startMarker = `export async function ${fnName}(`;
  const altStartMarker = `export function ${fnName}(`;
  const startIdx =
    source.indexOf(startMarker) !== -1
      ? source.indexOf(startMarker)
      : source.indexOf(altStartMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find exported function "${fnName}" in source`);
  }
  const markerLen =
    source.indexOf(startMarker) !== -1
      ? startMarker.length
      : altStartMarker.length;
  const nextExportMatch = /\nexport (const|async function|function) \w+/.exec(
    source.slice(startIdx + markerLen)
  );
  const endIdx =
    nextExportMatch === null
      ? source.length
      : startIdx + markerLen + nextExportMatch.index;
  return source.slice(startIdx, endIdx);
}

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

describe('computeIsSelectableForPicker — pure canonical picker-visibility rule', () => {
  it('a local/manual profile with no selectedPhoneNumber is always selectable', () => {
    expect(
      computeIsSelectableForPicker({ selectedPhoneNumber: undefined }, false)
    ).toBe(true);
  });

  it('a phone contact that is NOT fully joined is not selectable', () => {
    expect(
      computeIsSelectableForPicker(
        { selectedPhoneNumber: '+972501234567' },
        false
      )
    ).toBe(false);
  });

  it('a fully joined real user (has selectedPhoneNumber) is selectable', () => {
    expect(
      computeIsSelectableForPicker(
        { selectedPhoneNumber: '+972501234567' },
        true
      )
    ).toBe(true);
  });
});

describe('computeIsFullyJoined — server-derived invariant (source inspection)', () => {
  const src = extractExportedFunctionBlock(
    MEMBERS_SOURCE,
    'computeIsFullyJoined'
  );

  it('requires kind to resolve to entity, never access', () => {
    expect(src).toContain("if (resolveKind(entity) !== 'entity') return false;");
  });

  it('requires userId and matchedUserId to both be set and STRICTLY equal (no mismatch)', () => {
    expect(src).toContain(
      'if (!entity.userId || !entity.matchedUserId) return false;'
    );
    expect(src).toContain(
      'if (entity.userId !== entity.matchedUserId) return false;'
    );
  });

  it("requires inviteStatus === 'joined'", () => {
    expect(src).toContain("if (entity.inviteStatus !== 'joined') return false;");
  });

  it("requires the joined user's onboardingCompleted === true", () => {
    expect(src).toContain('joinedUser.onboardingCompleted !== true');
  });

  it('requires a real kind:access row to exist for that user in the SAME spaceId', () => {
    expect(src).toContain("q.eq(q.field('kind'), 'access')");
    expect(src).toContain("q.eq(q.field('spaceId'), entity.spaceId)");
  });
});

describe('assertNoActiveFamilyMembership — one-active-family guard (source inspection)', () => {
  const src = extractExportedFunctionBlock(
    MEMBERS_SOURCE,
    'assertNoActiveFamilyMembership'
  );

  it('checks ALL of the user\'s access rows, not just role:"member" ones (includes owner/admin)', () => {
    expect(src).toContain("resolveKind(r) === 'access'");
    expect(src).not.toContain("role === 'member'");
  });

  it("blocks whenever any access row's space.type !== 'personal'", () => {
    expect(src).toContain("space.type !== 'personal'");
  });

  it('throws (never silently returns) when blocked', () => {
    expect(src).toContain('throw new Error(ALREADY_IN_ACTIVE_FAMILY);');
  });
});

describe('executeFamilyJoin — atomic guard placement (source inspection)', () => {
  const src = extractExportedFunctionBlock(MEMBERS_SOURCE, 'executeFamilyJoin');

  it('runs assertNoActiveFamilyMembership strictly before the final grant writes', () => {
    const guardIdx = src.indexOf('await assertNoActiveFamilyMembership(');
    const grantIdx = src.indexOf('existingAccessRow');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(grantIdx).toBeGreaterThan(guardIdx);
  });

  it('rejects an entity already claimed (userId set) by a DIFFERENT user', () => {
    expect(src).toContain(
      'if (entity.userId !== undefined && entity.userId !== userId) {'
    );
  });
});

describe('getMyPendingFamilyPreview — minimal-safe, deduplicated preview (source inspection)', () => {
  const src = extractExportBlock(MEMBERS_SOURCE, 'getMyPendingFamilyPreview');

  it('reads only from user.pendingMatchMemberId — never trusts a client-supplied id', () => {
    const argsBlock = src.slice(src.indexOf('args: {'), src.indexOf('returns:'));
    expect(argsBlock.trim()).toBe('args: {},');
    expect(src).toContain('const pendingMemberId = user?.pendingMatchMemberId;');
  });

  it('excludes the pending entity itself from otherFamilyMembers (never shows the joining user their own card)', () => {
    expect(src).toContain('row._id !== pendingMemberId');
  });

  it('exposes displayName/color/memberType plus two safe booleans per member — never the actual phone digits or any user id', () => {
    const returnsBlock = src.slice(src.indexOf('returns:'), src.indexOf('handler:'));
    expect(returnsBlock).toContain('displayName: v.optional(v.string())');
    expect(returnsBlock).toContain('color: v.optional(v.string())');
    expect(returnsBlock).toContain('memberType: v.union');
    // QA fix: hasPhoneNumber/isConnected are plain booleans — they let the
    // client distinguish manual vs. contact-pending vs. connected members
    // (see FamilyMemberCard.tsx) without ever exposing the real phone
    // string or another user's id.
    expect(returnsBlock).toContain('hasPhoneNumber: v.boolean()');
    expect(returnsBlock).toContain('isConnected: v.boolean()');
    expect(returnsBlock).not.toContain('selectedPhoneNumber');
    expect(returnsBlock).not.toContain("v.id('users')");
  });
});
