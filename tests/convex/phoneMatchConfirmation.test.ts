/**
 * Family Membership Lifecycle Phase 1 — acceptPendingPhoneMatch /
 * completeExistingUserFamilyJoin / declinePhoneMatches (convex/members.ts)
 *
 * SUPERSEDES the old Stage 2B+3 immediate-join semantics: accepting a
 * phone match now only SELECTS it (`user.pendingMatchMemberId`) — it no
 * longer creates an access row, patches entity.userId, or sets
 * inviteStatus:'joined'. Real membership is granted only by
 * executeFamilyJoin (invoked by completeExistingUserFamilyJoin here, or by
 * finishOnboarding's claimed path — see claimedUserCompletion.test.ts).
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/eventTaskRsvpDecoupling.test.ts's documented precedent).
 * Given that constraint, these invariants are verified via source
 * inspection of the REAL convex/members.ts file — the same pattern used
 * throughout tests/convex/getPendingPhoneMatches.test.ts.
 *
 * Run with: bun test tests/convex/phoneMatchConfirmation.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

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

/** Extracts an `export async function NAME(` ... block up to the next top-level export. */
function extractExportedFunctionBlock(source: string, fnName: string): string {
  const startMarker = `export async function ${fnName}(`;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find exported function "${fnName}" in source`);
  }
  const nextExportMatch = /\nexport (const|async function) \w+/.exec(
    source.slice(startIdx + startMarker.length)
  );
  const endIdx =
    nextExportMatch === null
      ? source.length
      : startIdx + startMarker.length + nextExportMatch.index;
  return source.slice(startIdx, endIdx);
}

const acceptSrc = extractExportBlock(MEMBERS_SOURCE, 'acceptPendingPhoneMatch');
const completeJoinSrc = extractExportBlock(
  MEMBERS_SOURCE,
  'completeExistingUserFamilyJoin'
);
const executeJoinSrc = extractExportedFunctionBlock(
  MEMBERS_SOURCE,
  'executeFamilyJoin'
);
const declineSrc = extractExportBlock(MEMBERS_SOURCE, 'declinePhoneMatches');

describe('acceptPendingPhoneMatch — args shape', () => {
  it('takes ONLY memberId — the server derives the space itself (args block has no spaceId)', () => {
    const argsBlock = acceptSrc.slice(
      acceptSrc.indexOf('args: {'),
      acceptSrc.indexOf('returns:')
    );
    expect(argsBlock).toContain("memberId: v.id('members')");
    expect(argsBlock).not.toContain("spaceId: v.id('spaces')");
  });

  it('returns { spaceId } only', () => {
    expect(acceptSrc).toContain(
      "returns: v.object({ spaceId: v.id('spaces') })"
    );
  });
});

describe('acceptPendingPhoneMatch — full verification chain [1-11]', () => {
  it('[1] rejects unauthenticated callers', () => {
    expect(acceptSrc).toContain('const userId = await getAuthUserId(ctx);');
    expect(acceptSrc).toContain("if (!userId) throw new Error('לא מחובר');");
  });

  it('[2] requires the authenticated user to have a verified stored phone', () => {
    expect(acceptSrc).toContain('const userPhone = user.phone;');
    expect(acceptSrc).toContain(
      'if (!userPhone) throw new Error(PERMISSION_DENIED);'
    );
  });

  it('[3] rejects a missing/deleted entity row', () => {
    expect(acceptSrc).toContain('const entity = await ctx.db.get(memberId);');
    expect(acceptSrc).toContain(
      "if (!entity) throw new Error('פרופיל לא נמצא');"
    );
  });

  it('[4] rejects an access-row memberId (must be an entity row)', () => {
    expect(acceptSrc).toContain(
      "if (resolveKind(entity) !== 'entity') throw new Error(PERMISSION_DENIED);"
    );
  });

  it('[5] rejects when entity.matchedUserId !== authenticated userId', () => {
    expect(acceptSrc).toContain(
      'if (entity.matchedUserId !== userId) throw new Error(PERMISSION_DENIED);'
    );
  });

  it('[6] rejects when the entity has no selectedPhoneNumber', () => {
    expect(acceptSrc).toContain(
      'if (!entity.selectedPhoneNumber) throw new Error(PERMISSION_DENIED);'
    );
  });

  it('[7-9] normalizes both phones and rejects on mismatch', () => {
    expect(acceptSrc).toContain('normalizeToE164(userPhone)');
    expect(acceptSrc).toContain('normalizeToE164(entity.selectedPhoneNumber)');
    expect(acceptSrc).toContain(
      'if (normalizedEntityPhone !== normalizedUserPhone)'
    );
  });

  it('[10] rejects a missing/deleted space', () => {
    expect(acceptSrc).toContain('const space = await ctx.db.get(spaceId);');
    expect(acceptSrc).toContain(
      "if (!space) throw new Error('המרחב לא נמצא');"
    );
  });

  it('[11] rejects an entity already claimed by a DIFFERENT real user', () => {
    expect(acceptSrc).toContain(
      "if (entity.userId !== undefined && entity.userId !== userId) {"
    );
  });
});

describe('acceptPendingPhoneMatch — SELECTION ONLY, never grants access', () => {
  it('patches ONLY pendingMatchMemberId and phoneMatchResolvedAt on the user', () => {
    const patchBlock = acceptSrc.slice(
      acceptSrc.lastIndexOf('await ctx.db.patch(userId, {')
    );
    expect(patchBlock).toContain('pendingMatchMemberId: memberId,');
    expect(patchBlock).toContain('phoneMatchResolvedAt: Date.now(),');
  });

  it('never creates a members row (no access row is granted by selection alone)', () => {
    expect(acceptSrc).not.toContain("ctx.db.insert('members'");
  });

  it('never patches the entity row itself (userId / inviteStatus stay untouched)', () => {
    expect(acceptSrc).not.toContain('ctx.db.patch(memberId');
  });

  it('never sets onboardingCompleted, defaultSpaceId, or a familyContacts mirror', () => {
    const handlerBody = acceptSrc.slice(
      acceptSrc.indexOf('handler:'),
      acceptSrc.indexOf('\n});') + 4
    );
    expect(handlerBody).not.toContain('onboardingCompleted');
    expect(handlerBody).not.toContain('defaultSpaceId');
    expect(handlerBody).not.toContain('familyContacts');
  });

  it('security: never trusts a client-supplied spaceId — derives it only from the verified entity row', () => {
    expect(acceptSrc).toContain('const spaceId = entity.spaceId;');
  });
});

describe('executeFamilyJoin — the ONLY path that grants real membership', () => {
  it('re-verifies kind, matchedUserId, and rejects an entity claimed by a different user', () => {
    expect(executeJoinSrc).toContain(
      "if (resolveKind(entity) !== 'entity') throw new Error(PERMISSION_DENIED);"
    );
    expect(executeJoinSrc).toContain(
      'if (entity.matchedUserId !== userId) throw new Error(PERMISSION_DENIED);'
    );
  });

  it('runs the active-family guard atomically before any final write', () => {
    const guardIdx = executeJoinSrc.indexOf('assertNoActiveFamilyMembership');
    const writeIdx = executeJoinSrc.indexOf('existingAccessRow');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(writeIdx);
  });

  it('idempotently patches entity (userId + joined) and creates exactly one access row only when none exists', () => {
    expect(executeJoinSrc).toContain('if (!existingAccessRow) {');
    const grantBlock = executeJoinSrc.slice(
      executeJoinSrc.indexOf('if (!existingAccessRow) {')
    );
    expect(grantBlock).toContain('await ctx.db.patch(memberId, {');
    expect(grantBlock).toContain("inviteStatus: 'joined',");
    expect(grantBlock).toContain("await ctx.db.insert('members', {");
    expect(grantBlock).toContain("kind: 'access',");
  });

  it('clears pendingMatchMemberId and sets defaultSpaceId once membership is granted', () => {
    expect(executeJoinSrc).toContain('defaultSpaceId: spaceId,');
    expect(executeJoinSrc).toContain('pendingMatchMemberId: undefined,');
  });
});

describe('completeExistingUserFamilyJoin — already-onboarded user join', () => {
  it('requires onboardingCompleted === true', () => {
    expect(completeJoinSrc).toContain(
      'if (!user.onboardingCompleted) throw new Error(PERMISSION_DENIED);'
    );
  });

  it('requires the supplied memberId to exactly match the server-recorded pendingMatchMemberId', () => {
    expect(completeJoinSrc).toContain(
      'user.pendingMatchMemberId !== memberId'
    );
  });

  it('delegates the actual join to executeFamilyJoin (no duplicated join logic)', () => {
    expect(completeJoinSrc).toContain(
      'await executeFamilyJoin(ctx, userId, memberId);'
    );
  });
});

describe('declinePhoneMatches — behavior (unchanged)', () => {
  it('takes no arguments and returns null', () => {
    expect(declineSrc).toContain('args: {},');
    expect(declineSrc).toContain('returns: v.null(),');
  });

  it('rejects unauthenticated callers', () => {
    expect(declineSrc).toContain('const userId = await getAuthUserId(ctx);');
    expect(declineSrc).toContain("if (!userId) throw new Error('לא מחובר');");
  });

  it('sets phoneMatchResolvedAt only if not already set (idempotent, never overwrites)', () => {
    expect(declineSrc).toContain('if (!user.phoneMatchResolvedAt) {');
    expect(declineSrc).toContain(
      'await ctx.db.patch(userId, { phoneMatchResolvedAt: Date.now() });'
    );
  });

  it('never creates access, never touches entity rows, never marks onboardingCompleted, never creates a space', () => {
    expect(declineSrc).not.toContain('ctx.db.insert');
    expect(declineSrc).not.toContain("kind: 'access'");
    expect(declineSrc).not.toContain("inviteStatus: 'joined'");
    expect(declineSrc).not.toContain('onboardingCompleted');
    expect(declineSrc).not.toContain('defaultSpaceId');
  });
});

describe('getCurrentUserStatus — Stage 2B+3 extension (unchanged)', () => {
  const USERS_SOURCE = readFileSync(
    new URL('../../convex/users.ts', import.meta.url),
    'utf8'
  );
  const statusSrc = extractExportBlock(USERS_SOURCE, 'getCurrentUserStatus');

  it('includes phoneMatchResolvedAt in both the no-user and normal response branches', () => {
    expect(statusSrc).toContain('phoneMatchResolvedAt: null,');
    expect(statusSrc).toContain(
      'phoneMatchResolvedAt: user.phoneMatchResolvedAt ?? null,'
    );
  });

  it('preserves the existing hasProfile/onboardingComplete shape for current callers', () => {
    expect(statusSrc).toContain('hasProfile: false,');
    expect(statusSrc).toContain('hasProfile: true,');
    expect(statusSrc).toContain(
      'onboardingComplete: user.onboardingCompleted === true,'
    );
  });
});
