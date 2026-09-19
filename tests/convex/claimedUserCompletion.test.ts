/**
 * Family Membership Lifecycle Phase 1 — finishOnboarding claimed-user
 * completion (convex/onboarding.ts)
 *
 * SUPERSEDES the old detectValidClaim-based invariant: the claimed path
 * now reads `user.pendingMatchMemberId` (set by acceptPendingPhoneMatch as
 * a SELECTION ONLY — never previously-granted access) and delegates the
 * actual join to the shared executeFamilyJoin transaction (convex/members.ts)
 * — the same transaction completeExistingUserFamilyJoin uses for
 * already-onboarded users.
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/phoneMatchConfirmation.test.ts's documented precedent).
 * Given that constraint, these invariants are verified via source
 * inspection of the REAL convex/onboarding.ts file.
 *
 * Run with: bun test tests/convex/claimedUserCompletion.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ONBOARDING_SOURCE = readFileSync(
  new URL('../../convex/onboarding.ts', import.meta.url),
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

const finishOnboardingSrc = extractExportBlock(
  ONBOARDING_SOURCE,
  'finishOnboarding'
);

const claimedBranch = finishOnboardingSrc.slice(
  finishOnboardingSrc.indexOf('if (pendingMemberId && hasValidPendingMatch) {'),
  finishOnboardingSrc.indexOf('// ── Normal new-user path')
);

const normalBranch = finishOnboardingSrc.slice(
  finishOnboardingSrc.indexOf('// ── Normal new-user path')
);

describe('finishOnboarding — args shape (unchanged)', () => {
  it('takes firstName and lastName instead of fullName', () => {
    const argsBlock = finishOnboardingSrc.slice(
      finishOnboardingSrc.indexOf('args: {'),
      finishOnboardingSrc.indexOf('handler:')
    );
    expect(argsBlock).toContain('firstName: v.string()');
    expect(argsBlock).toContain('lastName: v.string()');
    expect(argsBlock).not.toContain('fullName: v.string()');
  });
});

describe('finishOnboarding — mandatory name validation [TESTS A1-A5 backend mirror]', () => {
  it('trims both names and rejects a blank first name', () => {
    expect(finishOnboardingSrc).toContain(
      'const firstName = args.firstName.trim();'
    );
    expect(finishOnboardingSrc).toContain(
      "if (!firstName) throw new Error('שם פרטי הוא שדה חובה');"
    );
  });

  it('trims and rejects a blank last name', () => {
    expect(finishOnboardingSrc).toContain(
      'const lastName = args.lastName.trim();'
    );
    expect(finishOnboardingSrc).toContain(
      "if (!lastName) throw new Error('שם משפחה הוא שדה חובה');"
    );
  });

  it('derives canonical fullName from the trimmed parts', () => {
    expect(finishOnboardingSrc).toMatch(
      /const fullName = `\$\{firstName\} \$\{lastName\}`;/
    );
  });

  it('validation happens before the claimed-path detection (never trusts an unvalidated name into either path)', () => {
    const validationIdx = finishOnboardingSrc.indexOf('if (!lastName)');
    const claimIdx = finishOnboardingSrc.indexOf('pendingMemberId');
    expect(validationIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(-1);
    expect(validationIdx).toBeLessThan(claimIdx);
  });
});

describe('finishOnboarding — claimed-path detection (Phase 1)', () => {
  it('reads user.pendingMatchMemberId — never the old detectValidClaim invariant', () => {
    expect(finishOnboardingSrc).toContain(
      'const pendingMemberId = user.pendingMatchMemberId;'
    );
    expect(finishOnboardingSrc).not.toContain('detectValidClaim');
  });

  it('re-verifies kind, matchedUserId, and that userId is unset or already this user (defense in depth)', () => {
    expect(finishOnboardingSrc).toContain(
      "resolveKind(pendingEntity) === 'entity'"
    );
    expect(finishOnboardingSrc).toContain(
      'pendingEntity.matchedUserId === userId'
    );
    expect(finishOnboardingSrc).toContain(
      '(pendingEntity.userId === undefined || pendingEntity.userId === userId)'
    );
  });

  it('delegates the actual join to executeFamilyJoin — no duplicated join logic in onboarding.ts', () => {
    expect(finishOnboardingSrc).toContain(
      'await executeFamilyJoin(ctx, userId, pendingMemberId);'
    );
  });
});

describe('finishOnboarding — claimed path creates NO duplicates (executeFamilyJoin owns idempotency)', () => {
  it('the claimed branch itself never inserts a new space', () => {
    expect(claimedBranch).not.toContain("ctx.db.insert('spaces'");
  });

  it('the claimed branch itself never inserts rows directly (delegated to executeFamilyJoin)', () => {
    expect(claimedBranch).not.toContain('ctx.db.insert');
  });
});

describe('finishOnboarding — claimed path reuses the existing space and entity', () => {
  it('patches pendingMemberId (the existing claimed entity) displayName, never a new one', () => {
    expect(claimedBranch).toContain(
      'await ctx.db.patch(pendingMemberId, { displayName: fullName });'
    );
  });

  it('returns the spaceId resolved by executeFamilyJoin, never a newly created one', () => {
    expect(claimedBranch).toContain('return { spaceId };');
  });
});

describe('finishOnboarding — claimed path writes canonical identity', () => {
  it('claimed branch writes firstName, lastName, and fullName to the user record', () => {
    const userPatchBlock = claimedBranch.slice(
      claimedBranch.lastIndexOf('await ctx.db.patch(userId,')
    );
    expect(userPatchBlock).toContain('firstName,');
    expect(userPatchBlock).toContain('lastName,');
    expect(userPatchBlock).toContain('fullName,');
    expect(userPatchBlock).toContain('onboardingCompleted: true,');
  });

  it('identity write happens AFTER executeFamilyJoin, never before access is granted', () => {
    const joinIdx = claimedBranch.indexOf('await executeFamilyJoin(');
    const identityIdx = claimedBranch.lastIndexOf(
      'await ctx.db.patch(userId,'
    );
    expect(joinIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeGreaterThan(joinIdx);
  });
});

describe('finishOnboarding — normal path writes canonical identity (unchanged)', () => {
  it('normal branch writes firstName, lastName, and fullName to the user record', () => {
    const patchBlock = normalBranch.slice(
      normalBranch.indexOf('await ctx.db.patch(userId, {'),
      normalBranch.indexOf('// 4.')
    );
    expect(patchBlock).toContain('firstName,');
    expect(patchBlock).toContain('lastName,');
    expect(patchBlock).toContain('fullName,');
  });

  it('normal path still creates a space, an admin access row, and entity rows exactly as before', () => {
    expect(normalBranch).toContain("ctx.db.insert('spaces', {");
    expect(normalBranch).toContain("kind: 'access',");
    expect(normalBranch).toContain("kind: 'entity',");
  });

  it('normal path still stamps onboardingCompleted, defaultSpaceId, and profileSetupCompletedAt at the end', () => {
    const tail = normalBranch.slice(
      normalBranch.lastIndexOf('await ctx.db.patch(userId, {')
    );
    expect(tail).toContain('onboardingCompleted: true');
    expect(tail).toContain('defaultSpaceId: spaceId');
    expect(tail).toContain(
      'profileSetupCompletedAt: user.profileSetupCompletedAt ?? Date.now()'
    );
  });
});

describe('finishOnboarding — legacy-user / stale-pending-match compatibility', () => {
  it('an invalid/stale pendingMatchMemberId (hasValidPendingMatch false) falls through to the normal new-user path instead of throwing', () => {
    const conditionIdx = finishOnboardingSrc.indexOf(
      'if (pendingMemberId && hasValidPendingMatch) {'
    );
    const normalPathIdx = finishOnboardingSrc.indexOf(
      '// ── Normal new-user path'
    );
    expect(conditionIdx).toBeGreaterThan(-1);
    expect(normalPathIdx).toBeGreaterThan(conditionIdx);
  });

  it('claim detection never references user.firstName/lastName (legacy users missing those fields are unaffected)', () => {
    const claimCallSite = finishOnboardingSrc.slice(
      finishOnboardingSrc.indexOf('const pendingMemberId ='),
      finishOnboardingSrc.indexOf('if (pendingMemberId && hasValidPendingMatch)')
    );
    expect(claimCallSite).not.toContain('user.firstName');
    expect(claimCallSite).not.toContain('user.lastName');
  });
});
