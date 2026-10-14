/**
 * postDeleteAccountOnboardingRace.test.ts
 *
 * Regression tests for a confirmed real-device bug reproduced during
 * Delete Account QA:
 *
 *   1. deleteMyAccount succeeds — the `users` row is deleted.
 *   2. The auth token/session still exists briefly (signOut() has not yet
 *      resolved — see lib/accountDeletionUi.ts `runAccountDeletionCleanup`,
 *      called from app/(authenticated)/profile.tsx `runDeleteAccountFlow`).
 *   3. Convex reactivity re-runs `getCurrentUserStatus` for the
 *      still-authenticated client.
 *   4. OLD BUGGY BEHAVIOR: the query returned
 *      `{ hasProfile: false, onboardingComplete: false,
 *      phoneMatchResolvedAt: null }` — a shape indistinguishable from a
 *      genuine "existing user who hasn't finished onboarding yet".
 *   5. app/(authenticated)/_layout.tsx interpreted this as "needs
 *      onboarding" and called `persistOnboardingAnswers`, which the
 *      backend rejected with "משתמש לא נמצא" — and the layout's own
 *      retry/backoff loop could repeat this every ~3s until the screen
 *      unmounted.
 *
 * THE FIX: `getCurrentUserStatus` (convex/users.ts) now returns the SAME
 * `null` sentinel for "authenticated identity, no backing users row" as
 * it already returns for "no authenticated identity at all" — every
 * existing consumer (app/(authenticated)/_layout.tsx,
 * app/(authenticated)/family-bootstrap.tsx) already treats `null` as "not
 * a real app user — fall back to sign-in/neutral routing", so reusing
 * this exact sentinel requires no new state and cannot regress any
 * legitimate flow.
 *
 * This repo has no Convex mutation/React Native rendering test harness
 * (see tests/convex/qaResetUser.test.ts's and
 * tests/convex/mandatorySetupExitRedirect.test.ts's documented
 * precedent). These invariants are verified via source inspection of the
 * real files, plus direct unit tests of the pure routing decision
 * function (lib/onboardingRouting.ts), the same pattern used throughout
 * this test suite.
 *
 * Run with: bun test tests/convex/postDeleteAccountOnboardingRace.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runAccountDeletionCleanup } from '../../lib/accountDeletionUi';
import { resolvePostAuthOnboardingRoute } from '../../lib/onboardingRouting';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const USERS_SOURCE = readSource('../../convex/users.ts');
const AUTH_SOURCE = readSource('../../convex/auth.ts');
const APPLE_REVIEW_AUTH_SOURCE = readSource('../../convex/appleReviewAuth.ts');
const LAYOUT_SOURCE = readSource('../../app/(authenticated)/_layout.tsx');

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

const statusSrc = extractExportBlock(USERS_SOURCE, 'getCurrentUserStatus');

// ─── B. Legitimate no-user-row semantics (proving section 2 of the task) ───

describe('new-user bootstrap: the users row always exists before the client observes isAuthenticated === true', () => {
  it('Convex Auth createOrUpdateUser (convex/auth.ts) inserts the users row synchronously, in the SAME callback that resolves the session userId', () => {
    const callbackMatch = AUTH_SOURCE.match(
      /async createOrUpdateUser\(ctx, args\) \{[\s\S]*?\n {2}\},/
    );
    expect(callbackMatch).not.toBeNull();
    const body = callbackMatch?.[0] ?? '';
    // The insert happens, then its result is returned as the userId — no
    // intermediate step hands a session/token back to the client before
    // this resolves.
    expect(body).toContain("const userId = await ctx.db.insert('users', {");
    expect(body).toContain('return userId;');
  });

  it('the Apple Review sign-in path (convex/appleReviewAuth.ts) follows the identical insert-before-return pattern', () => {
    expect(APPLE_REVIEW_AUTH_SOURCE).toContain(
      "const userId = await ctx.db.insert('users', {"
    );
  });
});

// ─── A/C/F. getCurrentUserStatus — root cause + exact fix ──────────────────

describe('getCurrentUserStatus — deleted-account transient state returns null, not a fake onboarding-incomplete object', () => {
  it('returns null when getAuthUserId resolves but the users row is missing (the exact deleted-account race)', () => {
    expect(statusSrc).toMatch(
      /const user = await ctx\.db\.get\(userId\);\s*\n\s*if \(!user\) \{\s*\n(?:[^\n]*\n)*?\s*return null;/
    );
  });

  it('never returns hasProfile:false / onboardingComplete:false for a missing user row (the confirmed bug shape)', () => {
    expect(statusSrc).not.toContain('hasProfile: false');
  });

  it('returns the SAME null sentinel used for "not authenticated" — no new/bespoke state introduced', () => {
    const noIdentityReturn = statusSrc.match(/if \(!userId\) return null;/);
    const noUserReturn = statusSrc.match(
      /if \(!user\) \{\s*\n[\s\S]*?return null;/
    );
    expect(noIdentityReturn).not.toBeNull();
    expect(noUserReturn).not.toBeNull();
  });

  it('declares an explicit returns validator that allows null alongside the real-user shape', () => {
    expect(statusSrc).toContain('returns: v.union(');
    expect(statusSrc).toContain('v.null(),');
  });

  it('still returns the real hasProfile:true/onboardingComplete shape for an existing user row (unchanged)', () => {
    expect(statusSrc).toContain('hasProfile: true,');
    expect(statusSrc).toContain(
      'onboardingComplete: user.onboardingCompleted === true,'
    );
    expect(statusSrc).toContain(
      'phoneMatchResolvedAt: user.phoneMatchResolvedAt ?? null,'
    );
  });
});

// ─── D/E/G. _layout.tsx — client guard against the deleted-account state ──

describe('_layout.tsx — explicit isDeletedAccountState guard', () => {
  it('derives isDeletedAccountState from isAuthenticated && userStatus === null', () => {
    expect(LAYOUT_SOURCE).toContain(
      'const isDeletedAccountState = isAuthenticated && userStatus === null;'
    );
  });

  it('the persist-onboarding-answers effect bails out via isDeletedAccountState (and the underlying userStatus === null check) BEFORE ever calling persistOnboardingAnswersMutation', () => {
    const effectMatch = LAYOUT_SOURCE.match(
      /useEffect\(\(\) => \{\s*\/\/ isDeletedAccountState:[\s\S]*?persistInFlightRef\.current = true;/
    );
    expect(effectMatch).not.toBeNull();
    const body = effectMatch?.[0] ?? '';
    expect(body).toContain('isDeletedAccountState');
    expect(body).toContain('userStatus === null');
    // The early-return guard clause must appear BEFORE the line that
    // flips persistInFlightRef (which immediately precedes the actual
    // mutation call) — proving the guard runs first.
    const guardIndex = body.indexOf('if (');
    const inFlightIndex = body.indexOf('persistInFlightRef.current = true;');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(inFlightIndex).toBeGreaterThan(guardIndex);
  });

  it('includes isDeletedAccountState in the persist effect dependency array (reactivity correctness)', () => {
    expect(LAYOUT_SOURCE).toMatch(
      /\}, \[\s*isAuthenticated,\s*userStatus,\s*isDeletedAccountState,/
    );
  });

  it('never schedules a retry (setPersistRetryTick) when the deleted-account guard short-circuits the effect — the retry/backoff code only lives inside .catch() AFTER the mutation call, which is unreachable when the guard returns early', () => {
    const effectMatch = LAYOUT_SOURCE.match(
      /useEffect\(\(\) => \{\s*\/\/ isDeletedAccountState:[\s\S]*?\n {2}\}, \[/
    );
    expect(effectMatch).not.toBeNull();
    const body = effectMatch?.[0] ?? '';
    const guardReturnIndex = body.indexOf('return;');
    const mutationCallIndex = body.indexOf(
      'persistOnboardingAnswersMutation({'
    );
    const retryScheduleIndex = body.indexOf('setPersistRetryTick');
    expect(guardReturnIndex).toBeGreaterThan(-1);
    expect(mutationCallIndex).toBeGreaterThan(guardReturnIndex);
    expect(retryScheduleIndex).toBeGreaterThan(mutationCallIndex);
  });
});

// ─── Pure routing decision — deleted-account state resolves exactly like
//     "still loading": never onboarding-questions, never persist, never a
//     redirect. (lib/onboardingRouting.ts is already exhaustively tested
//     in tests/convex/onboardingRouting.test.ts; this test only proves the
//     EXACT input shape produced by a deleted-account userStatus === null
//     resolves safely, tying the two files together.) ────────────────────

describe('resolvePostAuthOnboardingRoute — fed the exact deleted-account input shape (userStatus null → onboardingComplete undefined)', () => {
  it('resolves to "wait" (never onboarding-questions, never mandatory-profile-setup) — matches the splash-stays-up requirement', () => {
    const decision = resolvePostAuthOnboardingRoute({
      onboardingComplete: undefined, // userStatus?.onboardingComplete when userStatus === null
      hasLocalOnboardingAnswers: true, // the user may have local Q1/Q2 answers from BEFORE deletion
      answersPersisted: false,
      phoneMatchResolvedAt: null, // userStatus?.phoneMatchResolvedAt ?? null when userStatus === null
      pendingMatches: undefined,
    });
    expect(decision).toBe('wait');
  });
});

// ─── Existing (unaffected) real-user scenarios — proving no regression ───

describe('existing normal (fully onboarded) user — unaffected by this fix', () => {
  it('a real user row with onboardingCompleted === true still routes normally', () => {
    const decision = resolvePostAuthOnboardingRoute({
      onboardingComplete: true,
      hasLocalOnboardingAnswers: false,
      answersPersisted: false,
      phoneMatchResolvedAt: null,
      pendingMatches: undefined,
    });
    expect(decision).toBe('normal');
  });
});

describe('existing incomplete-onboarding (real) user — unaffected by this fix', () => {
  it('a real user row with onboardingCompleted === false and no local answers yet still goes to onboarding-questions', () => {
    const decision = resolvePostAuthOnboardingRoute({
      onboardingComplete: false,
      hasLocalOnboardingAnswers: false,
      answersPersisted: false,
      phoneMatchResolvedAt: null,
      pendingMatches: undefined,
    });
    expect(decision).toBe('onboarding-questions');
  });

  it('a real user row with local Q1/Q2 answers not yet persisted still waits for persistOnboardingAnswers (unchanged persistence behavior)', () => {
    const decision = resolvePostAuthOnboardingRoute({
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: false,
      phoneMatchResolvedAt: null,
      pendingMatches: undefined,
    });
    expect(decision).toBe('wait');
  });
});

// ─── Delete Account sequence — cleanup order unaffected, no write window ──

describe('Delete Account cleanup sequence — backend success still proceeds through cleanup/signOut deterministically', () => {
  const ACCOUNT_DELETION_UI_SOURCE = readSource(
    '../../lib/accountDeletionUi.ts'
  );

  it('runs draft cleanup, memory reset and sign-out in order after account cache cleanup', async () => {
    const calls: string[] = [];
    await runAccountDeletionCleanup({
      clearAccountCache: async () => {
        calls.push('cache');
      },
      clearOnboardingDraft: async () => {
        calls.push('draft');
      },
      resetData: () => {
        calls.push('reset');
      },
      signOut: async () => {
        calls.push('signOut');
      },
    });
    expect(calls).toEqual(['cache', 'draft', 'reset', 'signOut']);
  });

  it('executeAccountDeletion never runs local cleanup itself — cleanup is only reachable from the caller after an explicit {ok:true} result (no implicit onboarding write window)', () => {
    const fnMatch = ACCOUNT_DELETION_UI_SOURCE.match(
      /export async function executeAccountDeletion\([\s\S]*?\n\}/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? '';
    expect(body).not.toContain('persistOnboardingAnswers');
    expect(body).not.toContain('signOut');
  });
});
