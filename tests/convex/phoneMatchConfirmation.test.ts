/**
 * Stage 2B+3 — acceptPendingPhoneMatch / declinePhoneMatches (convex/members.ts)
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/eventTaskRsvpDecoupling.test.ts's documented precedent).
 * Given that constraint, these invariants are verified via source
 * inspection of the REAL convex/members.ts file — the same pattern used
 * throughout tests/convex/getPendingPhoneMatches.test.ts and
 * tests/convex/persistOnboardingAnswers.test.ts.
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

const acceptSrc = extractExportBlock(MEMBERS_SOURCE, 'acceptPendingPhoneMatch');
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

describe('acceptPendingPhoneMatch — full verification chain [1-10]', () => {
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
});

describe('acceptPendingPhoneMatch — grant + idempotency', () => {
  it('checks for an existing valid access row before granting', () => {
    expect(acceptSrc).toContain("q.eq(q.field('kind'), 'access')");
    expect(acceptSrc).toContain('if (!existingAccessRow) {');
  });

  it('when no access exists: patches the entity (userId + joined) and creates exactly one access row', () => {
    const grantBlock = acceptSrc.slice(
      acceptSrc.indexOf('if (!existingAccessRow) {')
    );
    expect(grantBlock).toContain('await ctx.db.patch(memberId, {');
    expect(grantBlock).toContain('userId,');
    expect(grantBlock).toContain("inviteStatus: 'joined',");
    expect(grantBlock).toContain("await ctx.db.insert('members', {");
    expect(grantBlock).toContain("kind: 'access',");
  });

  it('idempotent: always (re-)ensures phoneMatchResolvedAt, onboardingCompleted, defaultSpaceId regardless of branch', () => {
    const tail = acceptSrc.slice(
      acceptSrc.lastIndexOf('await ctx.db.patch(userId, {')
    );
    expect(tail).toContain('phoneMatchResolvedAt: Date.now()');
    expect(tail).toContain('onboardingCompleted: true');
    expect(tail).toContain('defaultSpaceId: spaceId');
  });

  it('security: never trusts a client-supplied spaceId — derives it only from the verified entity row', () => {
    expect(acceptSrc).toContain('const spaceId = entity.spaceId;');
  });
});

describe('declinePhoneMatches — behavior', () => {
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

describe('getCurrentUserStatus — Stage 2B+3 extension', () => {
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
