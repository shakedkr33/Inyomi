/**
 * Phase 1 — claimed-name protection
 *
 *   - isEntityClaimedByOtherUser (convex/members.ts) is a pure predicate,
 *     tested directly.
 *   - Its usage inside updateMyProfile (convex/users.ts) is verified via
 *     source inspection, following the same pattern as
 *     tests/convex/phoneMatchConfirmation.test.ts.
 *
 * Run with: bun test tests/convex/claimedMemberProtection.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isEntityClaimedByOtherUser } from '../../convex/members';

const ME = 'user_me' as any;
const OTHER = 'user_other' as any;

describe('isEntityClaimedByOtherUser', () => {
  it('[TEST 24 support] joined entity claimed by a different real user → true (protected)', () => {
    expect(
      isEntityClaimedByOtherUser({ inviteStatus: 'joined', userId: OTHER }, ME)
    ).toBe(true);
  });

  it('[TEST 25 support] entity claimed by the caller themself → false (self-edit allowed)', () => {
    expect(
      isEntityClaimedByOtherUser({ inviteStatus: 'joined', userId: ME }, ME)
    ).toBe(false);
  });

  it('[TEST 27 support] unclaimed entity (no userId) → false (manager-editable)', () => {
    expect(
      isEntityClaimedByOtherUser(
        { inviteStatus: 'none', userId: undefined },
        ME
      )
    ).toBe(false);
  });

  it('entity has a userId but inviteStatus is not joined (e.g. stale/partial state) → false', () => {
    expect(
      isEntityClaimedByOtherUser({ inviteStatus: 'invited', userId: OTHER }, ME)
    ).toBe(false);
  });

  it('entity has no inviteStatus at all → false', () => {
    expect(isEntityClaimedByOtherUser({ userId: OTHER }, ME)).toBe(false);
  });
});

const USERS_SOURCE = readFileSync(
  new URL('../../convex/users.ts', import.meta.url),
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

const updateMyProfileSrc = extractExportBlock(USERS_SOURCE, 'updateMyProfile');

describe('updateMyProfile — args shape (Phase 1)', () => {
  it('accepts optional firstName and lastName', () => {
    const argsBlock = updateMyProfileSrc.slice(
      updateMyProfileSrc.indexOf('args: {'),
      updateMyProfileSrc.indexOf('handler:')
    );
    expect(argsBlock).toContain('firstName: v.optional(v.string())');
    expect(argsBlock).toContain('lastName: v.optional(v.string())');
  });
});

// The current owner-management decision supersedes the old claimed-label
// restriction. Real handler coverage lives in privacyAuthorization.test.ts:
// owners can edit family labels, while personal account identity is unchanged.

describe("updateMyProfile — [TEST 26] self name edit syncs the caller's own claimed entity displayName", () => {
  it("after patching the user, re-queries the caller's own member rows and patches joined entities to the new canonical name", () => {
    expect(updateMyProfileSrc).toContain('canonicalFullNameForSync');
    expect(updateMyProfileSrc).toContain(
      "resolveKind(r) === 'entity' && r.inviteStatus === 'joined'"
    );
    expect(updateMyProfileSrc).toContain(
      'displayName: canonicalFullNameForSync,'
    );
  });

  it('only triggers when firstName or lastName was explicitly provided — never a forced migration for unrelated saves', () => {
    expect(updateMyProfileSrc).toContain(
      'if (args.firstName !== undefined || args.lastName !== undefined) {'
    );
  });

  it('regenerates fullName from the merged first/last name, falling back to existing stored values for the untouched field', () => {
    // Matched with whitespace-insensitive regexes so Biome/Ultracite
    // reformatting (e.g. wrapping the fallback in parens) doesn't break
    // this source-inspection assertion.
    expect(updateMyProfileSrc).toMatch(
      /args\.firstName !== undefined\s*\?\s*args\.firstName\.trim\(\)\s*:\s*\(?user\.firstName\s*\?\?\s*''\)?;/
    );
    expect(updateMyProfileSrc).toMatch(
      /args\.lastName !== undefined\s*\?\s*args\.lastName\.trim\(\)\s*:\s*\(?user\.lastName\s*\?\?\s*''\)?;/
    );
  });
});
