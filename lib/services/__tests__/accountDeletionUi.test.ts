/**
 * accountDeletionUi.test.ts
 *
 * Pure-logic tests for the Profile → Delete Account client orchestration
 * helpers in lib/accountDeletionUi.ts. These tests do not mount any React
 * Native component — they exercise the exact success / failure /
 * duplicate-submission / error-sanitization orchestration the profile.tsx
 * screen relies on, mirroring the existing precedent in
 * lib/services/__tests__/importFlowStages.test.ts.
 *
 * Backend deletion semantics (convex/accountDeletion.ts) are NOT exercised
 * here — `deleteMyAccount` is always a mocked function. The EXACT known
 * blocker strings used as fixtures below are copied verbatim from
 * lib/accountDeletion.ts (read, not modified) purely to prove the client
 * sanitizer recognizes them correctly.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createAccountDeletionGuard,
  executeAccountDeletion,
  GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE,
  LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE,
  resolveAccountDeletionErrorMessage,
  runAccountDeletionCleanup,
} from '@/lib/accountDeletionUi';

// Exact known-safe backend blocker strings (see
// lib/accountDeletion.ts#planOwnedSpaceDeletion /
// #planOwnedCommunityDeletion / evaluateAccountDeletionTransactionSize).
const FAMILY_OWNERSHIP_BLOCKER =
  'לא ניתן למחוק את החשבון: מרחב המשפחה "משפחת כהן" בבעלותך משותף עם 2 משתמש/ים נוספים. יש להעביר בעלות או להסיר אותם מהמרחב לפני מחיקת החשבון.';
const COMMUNITY_OWNERSHIP_BLOCKER =
  'לא ניתן למחוק את החשבון: הקהילה "שכונה טובה" בבעלותך כוללת 3 חבר/ים פעילים נוספים. יש להעביר בעלות או להסיר אותם מהקהילה לפני מחיקת החשבון.';
const TRANSACTION_SIZE_BLOCKER =
  'לא ניתן למחוק את החשבון באופן מיידי: היקף המחיקה המתוכנן (5001 רשומות) חורג מהסף הבטוח (4000). נא לפנות לתמיכה.';
// A realistic Convex-style document id (base32-ish, ~25+ chars) — mirrors
// what `event._id` / `task._id` interpolate into the ambiguous-legacy-record
// blocker message thrown by convex/accountDeletion.ts.
const FAKE_CONVEX_ID = 'jd75k3p1kqz3f8bfeeb4b6h8x0000001';
const AMBIGUOUS_LEGACY_RECORD_BLOCKER = `לא ניתן לסווג באופן חד-משמעי אירוע ישן (${FAKE_CONVEX_ID}) שנוצר על ידך — לא ניתן להמשיך במחיקת החשבון מבלי לנחש. יש לפנות לתמיכה.`;
const VERIFICATION_FAILURE_BLOCKER =
  'אימות מחיקת החשבון נכשל: נותרו הפניות assignedToUserIds למשתמש שנמחק.';
// The community ownership transfer engine's fail-closed "inconsistent
// membership data" blocker (see
// lib/accountDeletion.ts#planCommunityOwnershipTransfer). Only ever
// embeds the community NAME — never a Convex id — but is still routed
// through the generic support message, since normal automatic transfer
// never produces a user-facing blocker at all.
const UNSAFE_COMMUNITY_TRANSFER_BLOCKER =
  'לא ניתן להעביר באופן בטוח את הבעלות על הקהילה "שכונה טובה": נתוני החברות בקהילה אינם עקביים. יש לפנות לתמיכה.';

// ── resolveAccountDeletionErrorMessage ──────────────────────────────────────

describe('resolveAccountDeletionErrorMessage — known-safe blockers stay actionable', () => {
  it('preserves the family-ownership blocker verbatim (name only, no id)', () => {
    expect(
      resolveAccountDeletionErrorMessage(new Error(FAMILY_OWNERSHIP_BLOCKER))
    ).toBe(FAMILY_OWNERSHIP_BLOCKER);
  });

  it('preserves the community-ownership blocker verbatim (name only, no id)', () => {
    expect(
      resolveAccountDeletionErrorMessage(new Error(COMMUNITY_OWNERSHIP_BLOCKER))
    ).toBe(COMMUNITY_OWNERSHIP_BLOCKER);
  });

  it('preserves the transaction-size/support blocker verbatim (counts only, no id)', () => {
    expect(
      resolveAccountDeletionErrorMessage(new Error(TRANSACTION_SIZE_BLOCKER))
    ).toBe(TRANSACTION_SIZE_BLOCKER);
  });

  it('preserves multiple joined known-safe blockers (family + community)', () => {
    const joined = [FAMILY_OWNERSHIP_BLOCKER, COMMUNITY_OWNERSHIP_BLOCKER].join(
      '\n'
    );
    expect(resolveAccountDeletionErrorMessage(new Error(joined))).toBe(joined);
  });
});

describe('resolveAccountDeletionErrorMessage — never exposes raw ids/internal detail', () => {
  it('replaces an ambiguous legacy-record blocker (which embeds a Convex id) with the id-free support message', () => {
    const resolved = resolveAccountDeletionErrorMessage(
      new Error(AMBIGUOUS_LEGACY_RECORD_BLOCKER)
    );
    expect(resolved).toBe(LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE);
    expect(resolved).not.toContain(FAKE_CONVEX_ID);
  });

  it('replaces a post-write verification-failure blocker (internal field/table names) with the support message', () => {
    expect(
      resolveAccountDeletionErrorMessage(
        new Error(VERIFICATION_FAILURE_BLOCKER)
      )
    ).toBe(LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE);
  });

  it('replaces the unsafe-community-transfer blocker with the support message — normal automatic transfer never surfaces this', () => {
    const resolved = resolveAccountDeletionErrorMessage(
      new Error(UNSAFE_COMMUNITY_TRANSFER_BLOCKER)
    );
    expect(resolved).toBe(LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE);
  });

  it('treats a mixed message as unsafe as a whole when ANY joined line is unsafe', () => {
    const joined = [
      FAMILY_OWNERSHIP_BLOCKER,
      AMBIGUOUS_LEGACY_RECORD_BLOCKER,
    ].join('\n');
    const resolved = resolveAccountDeletionErrorMessage(new Error(joined));
    expect(resolved).toBe(LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE);
    expect(resolved).not.toContain(FAKE_CONVEX_ID);
  });

  it('falls back to the generic message for unknown/unrecognized error text', () => {
    expect(
      resolveAccountDeletionErrorMessage(
        new Error('Internal server exception at accountDeletion.ts:412')
      )
    ).toBe(GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE);
  });

  it('falls back to the generic calm message for an empty Error message', () => {
    expect(resolveAccountDeletionErrorMessage(new Error(''))).toBe(
      GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE
    );
  });

  it('falls back to the generic calm message for a non-Error throw', () => {
    expect(resolveAccountDeletionErrorMessage('some string')).toBe(
      GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE
    );
    expect(resolveAccountDeletionErrorMessage(undefined)).toBe(
      GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE
    );
    expect(resolveAccountDeletionErrorMessage({ code: 500 })).toBe(
      GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE
    );
  });

  it('never leaks internal stack traces or ids in either fallback message', () => {
    for (const msg of [
      GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE,
      LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE,
    ]) {
      expect(msg).not.toMatch(/at .*:\d+/);
      expect(msg).not.toContain('Id<');
      expect(msg).not.toContain(FAKE_CONVEX_ID);
    }
  });
});

// ── executeAccountDeletion ──────────────────────────────────────────────────

describe('executeAccountDeletion', () => {
  it('calls the backend mutation exactly once and reports success', async () => {
    let callCount = 0;
    const deleteMyAccount = async () => {
      callCount += 1;
      return { success: true as const };
    };

    const result = await executeAccountDeletion(deleteMyAccount);

    expect(callCount).toBe(1);
    expect(result).toEqual({ ok: true });
  });

  it('reports a known-safe backend blocker verbatim on failure', async () => {
    const deleteMyAccount = async () => {
      throw new Error(COMMUNITY_OWNERSHIP_BLOCKER);
    };

    const result = await executeAccountDeletion(deleteMyAccount);

    expect(result).toEqual({ ok: false, message: COMMUNITY_OWNERSHIP_BLOCKER });
  });

  it('sanitizes a backend error that embeds a raw Convex-style id', async () => {
    const deleteMyAccount = async () => {
      throw new Error(AMBIGUOUS_LEGACY_RECORD_BLOCKER);
    };

    const result = await executeAccountDeletion(deleteMyAccount);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE
      );
      expect(result.message).not.toContain(FAKE_CONVEX_ID);
    }
  });

  it('falls back to the generic message when the backend throws a non-Error', async () => {
    const deleteMyAccount = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'network blip';
    };

    const result = await executeAccountDeletion(deleteMyAccount);

    expect(result).toEqual({
      ok: false,
      message: GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE,
    });
  });
});

// ── runAccountDeletionCleanup ────────────────────────────────────────────────

describe('runAccountDeletionCleanup', () => {
  it('reports cache failure but still clears in-memory state and signs out', async () => {
    const calls: string[] = [];
    const result = await runAccountDeletionCleanup({
      clearAccountCache: async () => {
        calls.push('cache');
        throw new Error('storage');
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
    expect(result.cleanupSucceeded).toBe(false);
    expect(calls).toEqual(['cache', 'draft', 'reset', 'signOut']);
  });
  it('runs clearOnboardingDraft, resetData, signOut in that exact order', async () => {
    const calls: string[] = [];
    await runAccountDeletionCleanup({
      clearOnboardingDraft: async () => {
        calls.push('clearOnboardingDraft');
      },
      resetData: () => {
        calls.push('resetData');
      },
      signOut: async () => {
        calls.push('signOut');
      },
    });

    expect(calls).toEqual(['clearOnboardingDraft', 'resetData', 'signOut']);
  });

  it('awaits clearOnboardingDraft before calling resetData/signOut', async () => {
    const calls: string[] = [];
    await runAccountDeletionCleanup({
      clearOnboardingDraft: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push('clearOnboardingDraft');
      },
      resetData: () => {
        calls.push('resetData');
      },
      signOut: async () => {
        calls.push('signOut');
      },
    });

    expect(calls).toEqual(['clearOnboardingDraft', 'resetData', 'signOut']);
  });
});

// ── End-to-end orchestration (mirrors profile.tsx's runDeleteAccountFlow) ──
//
// profile.tsx calls `executeAccountDeletion` then, ONLY in the `ok: true`
// branch, immediately `await`s `runAccountDeletionCleanup` — no Alert /
// user-interaction gate in between. These tests exercise that exact
// composition using the real exported helpers (no reimplementation).

describe('delete-account flow orchestration — success runs cleanup immediately', () => {
  it('runs deleteMyAccount, then clearOnboardingDraft, resetData, signOut — with no extra interaction', async () => {
    const calls: string[] = [];
    const deleteMyAccount = async () => {
      calls.push('deleteMyAccount');
    };
    const cleanupDeps = {
      clearOnboardingDraft: async () => {
        calls.push('clearOnboardingDraft');
      },
      resetData: () => {
        calls.push('resetData');
      },
      signOut: async () => {
        calls.push('signOut');
      },
    };

    const result = await executeAccountDeletion(deleteMyAccount);
    expect(result.ok).toBe(true);
    if (result.ok) {
      await runAccountDeletionCleanup(cleanupDeps);
    }

    expect(calls).toEqual([
      'deleteMyAccount',
      'clearOnboardingDraft',
      'resetData',
      'signOut',
    ]);
  });
});

describe('delete-account flow orchestration — failure runs zero local cleanup', () => {
  it('never calls clearOnboardingDraft, resetData, or signOut when the backend throws', async () => {
    const cleanupCalls: string[] = [];
    const deleteMyAccount = async () => {
      throw new Error(COMMUNITY_OWNERSHIP_BLOCKER);
    };
    const cleanupDeps = {
      clearOnboardingDraft: async () => {
        cleanupCalls.push('clearOnboardingDraft');
      },
      resetData: () => {
        cleanupCalls.push('resetData');
      },
      signOut: async () => {
        cleanupCalls.push('signOut');
      },
    };

    const result = await executeAccountDeletion(deleteMyAccount);
    expect(result.ok).toBe(false);
    // Mirrors profile.tsx: `runAccountDeletionCleanup` is only ever
    // reachable inside the `result.ok` branch, which is unreachable here.
    if (result.ok) {
      await runAccountDeletionCleanup(cleanupDeps);
    }

    expect(cleanupCalls).toEqual([]);
  });
});

// ── createAccountDeletionGuard — duplicate-submission protection ───────────

describe('createAccountDeletionGuard', () => {
  it('runs a single call normally and resets isRunning afterward', async () => {
    const guard = createAccountDeletionGuard();
    expect(guard.isRunning()).toBe(false);

    const result = await guard.run(async () => 'done');

    expect(result).toBe('done');
    expect(guard.isRunning()).toBe(false);
  });

  it('blocks a second concurrent call while the first is still pending', async () => {
    const guard = createAccountDeletionGuard();
    let callCount = 0;
    let resolveFirst: (() => void) | undefined;

    const slowDelete = () =>
      new Promise<{ ok: true }>((resolve) => {
        callCount += 1;
        resolveFirst = () => resolve({ ok: true });
      });

    const firstCallPromise = guard.run(slowDelete);
    expect(guard.isRunning()).toBe(true);

    // Second "tap" while the first deletion request is still in flight —
    // must NOT invoke the backend mutation again.
    const secondCallPromise = guard.run(slowDelete);

    resolveFirst?.();
    const [firstResult, secondResult] = await Promise.all([
      firstCallPromise,
      secondCallPromise,
    ]);

    expect(callCount).toBe(1);
    expect(firstResult).toEqual({ ok: true });
    expect(secondResult).toBeNull();
    expect(guard.isRunning()).toBe(false);
  });

  it('allows a new call after a previous failed call has finished', async () => {
    const guard = createAccountDeletionGuard();

    // guard.run does not swallow errors — verify isRunning still resets
    // (via the `finally`) even when the guarded function throws.
    await expect(
      guard.run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(guard.isRunning()).toBe(false);

    const secondResult = await guard.run(async () => 'second-ok');
    expect(secondResult).toBe('second-ok');
  });
});

// ── profile.tsx wiring — source-inspection invariants ───────────────────────

const PROFILE_SOURCE = readFileSync(
  new URL('../../../app/(authenticated)/profile.tsx', import.meta.url),
  'utf8'
);

describe('profile.tsx — delete account UI wiring (source inspection)', () => {
  it('wires the delete-account flow to the real api.users.deleteMyAccount mutation', () => {
    expect(PROFILE_SOURCE).toContain('useMutation(api.users.deleteMyAccount)');
  });

  it('calls executeAccountDeletion (backend) before any cleanup helper runs', () => {
    const deleteFlowStart = PROFILE_SOURCE.indexOf('runDeleteAccountFlow');
    const executeCallIndex = PROFILE_SOURCE.indexOf(
      'executeAccountDeletion(deleteMyAccount)'
    );
    const cleanupCallIndex = PROFILE_SOURCE.indexOf(
      'runAccountDeletionCleanup(',
      deleteFlowStart
    );

    expect(executeCallIndex).toBeGreaterThan(-1);
    expect(cleanupCallIndex).toBeGreaterThan(executeCallIndex);
  });

  it('runs local cleanup immediately after backend success with no gating success Alert in between', () => {
    const flowStart = PROFILE_SOURCE.indexOf('const runDeleteAccountFlow');
    const flowEnd = PROFILE_SOURCE.indexOf('\n  };', flowStart);
    expect(flowStart).toBeGreaterThan(-1);
    expect(flowEnd).toBeGreaterThan(flowStart);
    const flowBody = PROFILE_SOURCE.slice(flowStart, flowEnd);

    const notOkIndex = flowBody.indexOf('if (!result.ok)');
    const failureReturnIndex = flowBody.indexOf('return;', notOkIndex);
    const cleanupIndex = flowBody.indexOf('runAccountDeletionCleanup(');
    expect(notOkIndex).toBeGreaterThan(-1);
    expect(failureReturnIndex).toBeGreaterThan(notOkIndex);
    expect(cleanupIndex).toBeGreaterThan(failureReturnIndex);

    // Everything between the failure early-return and the cleanup call is
    // the success path — it must contain no Alert (no gating "OK" tap).
    const successPathBody = flowBody.slice(
      failureReturnIndex + 'return;'.length,
      cleanupIndex
    );
    expect(successPathBody).not.toContain('Alert.alert');
    // The cleanup call itself must be awaited directly, not deferred into
    // an Alert button's onPress callback.
    expect(flowBody).not.toContain('void runAccountDeletionCleanup(');
    expect(flowBody).toContain('await runAccountDeletionCleanup(');
  });

  it('shows the truthful post-deletion success message only after cleanup/sign-out have run', () => {
    const flowStart = PROFILE_SOURCE.indexOf('const runDeleteAccountFlow');
    const flowEnd = PROFILE_SOURCE.indexOf('\n  };', flowStart);
    const flowBody = PROFILE_SOURCE.slice(flowStart, flowEnd);

    const cleanupIndex = flowBody.indexOf('await runAccountDeletionCleanup(');
    const successIndex = flowBody.indexOf("'החשבון נמחק'");
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(successIndex).toBeGreaterThan(-1);
    // The success message must be shown AFTER the cleanup/sign-out call —
    // never before, and never on the failure path (which returns earlier).
    expect(successIndex).toBeGreaterThan(cleanupIndex);
    expect(flowBody).toContain('cleanup.cleanupSucceeded');
    expect(flowBody).not.toContain('החשבון ומידע האישי נמחקו לצמיתות');
  });

  it('never shows the delete-account subscription warning with a Manage Subscription CTA', () => {
    const warningStart = PROFILE_SOURCE.indexOf('לפני שממשיכים');
    const warningEnd = PROFILE_SOURCE.indexOf(
      'מחיקת החשבון לצמיתות?',
      warningStart
    );
    expect(warningStart).toBeGreaterThan(-1);
    expect(warningEnd).toBeGreaterThan(warningStart);

    const subscriptionWarningBlock = PROFILE_SOURCE.slice(
      warningStart,
      warningEnd
    );
    expect(subscriptionWarningBlock).not.toContain('handleManageSubscription');
    expect(subscriptionWarningBlock).not.toContain('presentCustomerCenter');
    expect(subscriptionWarningBlock).not.toContain('ניהול המנוי');
  });

  it('shows the exact required Hebrew copy for all three confirmation steps', () => {
    expect(PROFILE_SOURCE).toContain('מחיקת החשבון תמחק לצמיתות');
    expect(PROFILE_SOURCE).toContain(
      'מחיקת חשבון InYomi אינה מבטלת בהכרח מנוי דרך App Store או Google Play'
    );
    expect(PROFILE_SOURCE).toContain('מחיקת החשבון לצמיתות?');
    expect(PROFILE_SOURCE).toContain('מחקו את החשבון');
  });

  // ── Automatic community ownership transfer (§11/§16) ──────────────────────
  it('includes the exact automatic-community-transfer explanatory sentence in the destructive warning step', () => {
    expect(PROFILE_SOURCE).toContain(
      'אם קיימות קהילות בבעלות החשבון ובהן חברים נוספים, הבעלות תועבר אוטומטית לאחד מחברי הקהילה בהתאם להרשאות ולוותק.'
    );
  });

  it('never adds a "מעבר לקהילות" (navigate to communities) CTA to the delete-account flow', () => {
    expect(PROFILE_SOURCE).not.toContain('מעבר לקהילות');
  });

  it('never adds manual successor-selection UI (no picker/selection screen wired into the delete-account flow)', () => {
    const deleteFlowStart = PROFILE_SOURCE.indexOf('handleDeleteAccount');
    expect(deleteFlowStart).toBeGreaterThan(-1);
    const deleteFlowSection = PROFILE_SOURCE.slice(
      deleteFlowStart,
      PROFILE_SOURCE.indexOf('const handleClose')
    );
    expect(deleteFlowSection).not.toContain('successor');
    expect(deleteFlowSection).not.toContain('transferOwnership');
    expect(deleteFlowSection).not.toContain('selectNewOwner');
  });

  it('the subscription warning step remains unchanged', () => {
    expect(PROFILE_SOURCE).toContain('לפני שממשיכים');
    expect(PROFILE_SOURCE).toContain(
      'מחיקת חשבון InYomi אינה מבטלת בהכרח מנוי דרך App Store או Google Play. אם קיים מנוי בתשלום, יש לנהל או לבטל אותו בנפרד דרך החנות.'
    );
  });
});
