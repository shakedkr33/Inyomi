/**
 * Security Wave 2A — P2-L10 (coupled to P2-H01): removal of the public
 * `users.updateUserType` mutation.
 *
 * AUDIT FINDING: `updateUserType` was a public mutation that accepted a
 * client-supplied `userType: 'free' | 'paid'` value and wrote it directly
 * onto the authenticated caller's own user row. It was already effectively
 * non-functional (identity lookup was email-based in a phone-auth system),
 * but a public mutation letting a user set their own paid/free status is
 * dangerous by construction — if any future server logic started trusting
 * `userType` for entitlement decisions (P2-H01), this endpoint would let
 * any authenticated user grant themselves paid access with zero
 * server-side verification. Verified zero callers across app/, convex/,
 * tests/ and scripts before removal — see convex/users.ts for the full
 * root-cause comment.
 *
 * This repo has no Convex mutation/query test harness (see
 * tests/convex/usersAccessControlWave1.test.ts's documented precedent).
 * These regression guards verify via source inspection of the REAL
 * convex/*.ts files that the mutation is gone and that no equivalent
 * client-facing mutation exists anywhere in convex/.
 *
 * Run with: bun test tests/convex/updateUserTypeRemoval.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

const CONVEX_DIR = new URL('../../convex/', import.meta.url);

function listConvexSourceFiles(): string[] {
  return readdirSync(CONVEX_DIR)
    .filter((name) => name.endsWith('.ts') && !name.startsWith('_'))
    .map((name) => name);
}

function readConvexFile(name: string): string {
  return readFileSync(new URL(name, CONVEX_DIR), 'utf8');
}

const USERS_SOURCE = readConvexFile('users.ts');
const ALL_CONVEX_FILES = listConvexSourceFiles();
const ALL_CONVEX_SOURCE = ALL_CONVEX_FILES.map((name) => ({
  name,
  source: readConvexFile(name),
}));

describe('P2-L10 — users.updateUserType no longer exists', () => {
  it('the export is completely removed from convex/users.ts', () => {
    expect(USERS_SOURCE).not.toMatch(/export const updateUserType\b/);
  });

  it('no other convex file re-exports or re-implements updateUserType', () => {
    for (const { name, source } of ALL_CONVEX_SOURCE) {
      expect(
        /export const updateUserType\b/.test(source),
        `updateUserType should not be exported from convex/${name}`
      ).toBe(false);
    }
  });

  it('there is no remaining caller of api.users.updateUserType anywhere in convex/', () => {
    // Matches an actual invocation (e.g. `api.users.updateUserType`,
    // `internal.users.updateUserType`, or a direct call `.updateUserType(`)
    // — NOT the removal doc-comment in convex/users.ts, which intentionally
    // names the removed mutation for audit traceability (see the "SECURITY
    // (Pass 2 / P2-L10..." comment directly above where the export used to
    // be).
    const callerPattern = /\.updateUserType\s*[(,]/;
    for (const { name, source } of ALL_CONVEX_SOURCE) {
      expect(
        callerPattern.test(source),
        `convex/${name} should not call updateUserType`
      ).toBe(false);
    }
  });
});

describe('P2-L10 — no public client mutation can set paid/free status directly', () => {
  it('no public (non-internal) mutation across convex/ declares a client-supplied userType argument', () => {
    // Matches `userType: v.union(...)` or `userType: v.optional(...)` etc.
    // appearing inside a mutation's `args` block. createOrUpdateUser's
    // internal server-assigned default (`userType: 'free' as const`) is a
    // hardcoded literal written unconditionally by the server, not a
    // client-supplied argument, so it does not match this pattern.
    // schema.ts is excluded: `userType: v.optional(v.string())` there is
    // the TABLE COLUMN definition (what shape may be stored), not a
    // mutation argument a client can set arbitrarily — those are two
    // different concerns; storing the field is fine as long as no public
    // mutation writes it from a client-supplied value.
    const clientArgPattern = /userType:\s*v\.(union|optional|literal)\(/;
    for (const { name, source } of ALL_CONVEX_SOURCE) {
      if (name === 'schema.ts') continue;
      expect(
        clientArgPattern.test(source),
        `convex/${name} should not declare a client-facing userType argument`
      ).toBe(false);
    }
  });

  it('no public mutation across convex/ declares a client-supplied "paid" literal argument', () => {
    const paidLiteralArgPattern = /:\s*v\.union\([^)]*v\.literal\(['"]paid['"]\)/;
    for (const { name, source } of ALL_CONVEX_SOURCE) {
      expect(
        paidLiteralArgPattern.test(source),
        `convex/${name} should not declare a client-facing 'paid' literal argument`
      ).toBe(false);
    }
  });

  it('no public mutation across convex/ declares a client-supplied subscriptionTier/entitlement argument', () => {
    const entitlementArgPattern =
      /(subscriptionTier|isPremium|entitlement)\s*:\s*v\./i;
    for (const { name, source } of ALL_CONVEX_SOURCE) {
      expect(
        entitlementArgPattern.test(source),
        `convex/${name} should not declare a client-facing subscription/entitlement argument`
      ).toBe(false);
    }
  });
});

describe('P2-L10 — legitimate subscription-adjacent state handling remains intact', () => {
  it('createOrUpdateUser still exists and still assigns a server-controlled default userType (not client-supplied)', () => {
    expect(USERS_SOURCE).toMatch(/export const createOrUpdateUser\b/);
    expect(USERS_SOURCE).toMatch(/userType:\s*'free' as const/);
  });

  it("getIsQaUser (server-verified QA override) still exists and remains a read-only query, not a mutation", () => {
    expect(USERS_SOURCE).toMatch(/export const getIsQaUser = query\(/);
  });
});
