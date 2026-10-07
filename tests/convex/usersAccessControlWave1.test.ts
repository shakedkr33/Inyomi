/**
 * Security Wave 1 — convex/users.ts: removal of unauthenticated/unauthorized
 * cross-user public endpoints.
 *
 *   C-01  users.listActive     — unauthenticated global user enumeration
 *   C-02  users.remove         — authenticated-but-unauthorized arbitrary
 *                                 cross-user deletion (client-supplied userId)
 *   H-01  users.getById        — unauthenticated raw cross-user document read
 *   H-02  users.updateProfile  — authenticated-but-unauthorized arbitrary
 *                                 cross-user profile update (client-supplied
 *                                 userId, never compared to the caller)
 *
 * This repo has no Convex mutation/query test harness (see
 * tests/convex/phoneMatchConfirmation.test.ts's documented precedent).
 * These regression guards verify via source inspection of the REAL
 * convex/users.ts file that all four endpoints are gone, that no
 * replacement export reintroduces a client-supplied `userId` parameter, and
 * that the legitimate self-service replacements (getCurrentUser, getMyId,
 * getMyProfile, updateMyProfile, deleteMyAccount) still resolve their target
 * user ONLY from the caller's own authenticated identity — never from a
 * client-supplied id — and that updateMyProfile's claimed-name protection
 * is untouched.
 *
 * Run with: bun test tests/convex/usersAccessControlWave1.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const USERS_SOURCE = readFileSync(
  new URL('../../convex/users.ts', import.meta.url),
  'utf8'
);

function hasExport(source: string, exportName: string): boolean {
  return new RegExp(`export const ${exportName}\\b\\s*=`).test(source);
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

describe('Wave 1 — removed public endpoints', () => {
  it('C-01: users.listActive no longer exists (global user enumeration closed)', () => {
    expect(hasExport(USERS_SOURCE, 'listActive')).toBe(false);
  });

  it('C-02: users.remove no longer exists (arbitrary cross-user deletion closed)', () => {
    expect(hasExport(USERS_SOURCE, 'remove')).toBe(false);
  });

  it('H-01: users.getById no longer exists (raw cross-user document retrieval closed)', () => {
    expect(hasExport(USERS_SOURCE, 'getById')).toBe(false);
  });

  it('H-02: users.updateProfile (legacy, client-supplied userId) no longer exists', () => {
    expect(hasExport(USERS_SOURCE, 'updateProfile')).toBe(false);
  });

  it('deleteMyAccount was NOT touched/wired into this remediation (out of Wave 1 scope)', () => {
    // deleteMyAccount must still exist, unmodified in scope — this guards
    // against C-02's fix accidentally being implemented by rerouting into
    // account deletion, which the task explicitly forbids.
    expect(hasExport(USERS_SOURCE, 'deleteMyAccount')).toBe(true);
  });

  it("no remaining export in users.ts declares a client-supplied `userId: v.id('users')` argument", () => {
    // Guards against silently reintroducing an arbitrary-cross-user
    // mutation/query elsewhere in this file.
    expect(USERS_SOURCE).not.toMatch(/userId:\s*v\.id\(\s*'users'\s*\)/);
  });
});

describe('Wave 1 — legitimate self-service replacements remain intact', () => {
  it('getCurrentUser still resolves the viewer only from getAuthUserId(ctx)', () => {
    const block = extractExportBlock(USERS_SOURCE, 'getCurrentUser');
    expect(block).toContain('getAuthUserId(ctx)');
  });

  it('getMyId still resolves the viewer only from getAuthUserId(ctx)', () => {
    const block = extractExportBlock(USERS_SOURCE, 'getMyId');
    expect(block).toContain('getAuthUserId(ctx)');
  });

  it('getMyProfile still resolves the viewer only from getAuthUserId(ctx) and takes no id argument', () => {
    const block = extractExportBlock(USERS_SOURCE, 'getMyProfile');
    expect(block).toContain('getAuthUserId(ctx)');
    const argsBlock = block.slice(0, block.indexOf('handler:'));
    expect(argsBlock).toMatch(/args:\s*\{\s*\}/);
  });

  it('updateMyProfile resolves its target user ONLY from getAuthUserId(ctx) — args declare no userId', () => {
    const block = extractExportBlock(USERS_SOURCE, 'updateMyProfile');
    expect(block).toContain('getAuthUserId(ctx)');
    const argsBlock = block.slice(
      block.indexOf('args:'),
      block.indexOf('handler:')
    );
    expect(argsBlock).not.toMatch(/userId/);
  });

  it('updateMyProfile still preserves claimed-name protection (isEntityClaimedByOtherUser) for self-edits', () => {
    const block = extractExportBlock(USERS_SOURCE, 'updateMyProfile');
    expect(block).toContain('isEntityClaimedByOtherUser');
  });

  it('deleteMyAccount resolves its target only from getAuthUserId(ctx) (self only) — fixed by the account-deletion engine task; see tests/convex/accountDeletion.test.ts for full coverage of that fix', () => {
    // UPDATED: deleteMyAccount previously used the raw, composite Convex
    // Auth Phone OTP `identity.subject` (via `ctx.auth.getUserIdentity()`)
    // as if it were a `users` table Id directly — a confirmed root bug
    // (could silently fail to find the real user and report a false
    // success). A later, explicitly-scoped task fixed this using the
    // canonical `getAuthUserId(ctx)` resolver and delegated the rest of
    // the deletion to convex/accountDeletion.ts. This guard now protects
    // the FIXED behavior instead of the bug.
    const block = extractExportBlock(USERS_SOURCE, 'deleteMyAccount');
    expect(block).toContain('getAuthUserId(ctx)');
    expect(block).not.toContain('identity.subject');
    const argsBlock = block.slice(0, block.indexOf('handler:'));
    expect(argsBlock).toMatch(/args:\s*\{\s*\}/);
  });
});
