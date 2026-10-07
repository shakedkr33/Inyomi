/**
 * QA fix — final "שמירה והמשך" must auto-save unsaved profile details
 * before attempting the final family join.
 *
 * Real-device QA: a user could type a valid first + last name into the
 * self-profile form WITHOUT pressing the mid-form "שמירת פרטים" button,
 * and the final CTA was already enabled (it only checks the live field
 * values — see tests/convex/mandatoryProfileSetup.test.ts). Pressing it
 * must transparently persist those values first (via the SAME canonical
 * save function used by "שמירת פרטים"), and only then attempt the real
 * join — never the reverse, and never joining on a failed/invalid save.
 *
 * This suite exercises the pure orchestrator directly
 * (lib/mandatorySetupFinalSave.ts) with mocked dependencies, so every
 * sequencing/guard branch is verified without a React Native render
 * harness (this repo has none — see
 * tests/convex/selfProfileLastNameRequired.test.ts's documented
 * precedent for source-level checks; this helper is pure enough to test
 * directly instead).
 *
 * Run with: bun test tests/convex/mandatorySetupFinalSave.test.ts
 */

import { describe, expect, it } from 'bun:test';
import {
  executeMandatorySetupFinalSave,
  type MandatorySetupFinalSaveState,
} from '../../lib/mandatorySetupFinalSave';
import { validateProfileName } from '../../lib/profileNameValidation';

function freshState(): MandatorySetupFinalSaveState {
  return { isSaving: false };
}

describe('executeMandatorySetupFinalSave', () => {
  it('[TEST 7 / invalid] invalid last name → field error, zero save, zero join', async () => {
    const state = freshState();
    let saveCalls = 0;
    let joinCalls = 0;

    const result = await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('דנה', '', true),
      isDirty: () => true,
      saveProfileName: () => {
        saveCalls += 1;
        return true;
      },
      joinFamily: () => {
        joinCalls += 1;
        return Promise.resolve();
      },
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.validation.lastNameError).toBe('יש להזין שם משפחה');
    }
    expect(saveCalls).toBe(0);
    expect(joinCalls).toBe(0);
    // Invalid submissions must not claim the re-entrancy guard either —
    // the user must be able to retry immediately after fixing the field.
    expect(state.isSaving).toBe(false);
  });

  it('missing first name AND last name → invalid with both errors, zero save, zero join', async () => {
    const state = freshState();
    let joinCalls = 0;
    const result = await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('', '', true),
      isDirty: () => true,
      saveProfileName: () => true,
      joinFamily: () => {
        joinCalls += 1;
        return Promise.resolve();
      },
    });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.validation.firstNameError).toBe('יש להזין שם פרטי');
      expect(result.validation.lastNameError).toBe('יש להזין שם משפחה');
    }
    expect(joinCalls).toBe(0);
  });

  it('[Scenario A–E] valid + dirty (unsaved) → saves profile first, then joins exactly once', async () => {
    const state = freshState();
    const calls: string[] = [];

    const result = await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('דנה', 'כהן', true),
      isDirty: () => true,
      saveProfileName: () => {
        calls.push('save');
        return true;
      },
      joinFamily: () => {
        calls.push('join');
        return Promise.resolve();
      },
    });

    expect(result.status).toBe('joined');
    expect(calls).toEqual(['save', 'join']);
  });

  it('[TEST: already-saved unchanged] not dirty → skips the duplicate save, still joins', async () => {
    const state = freshState();
    let saveCalls = 0;
    let joinCalls = 0;

    const result = await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('דנה', 'כהן', true),
      isDirty: () => false,
      saveProfileName: () => {
        saveCalls += 1;
        return true;
      },
      joinFamily: () => {
        joinCalls += 1;
        return Promise.resolve();
      },
    });

    expect(result.status).toBe('joined');
    expect(saveCalls).toBe(0);
    expect(joinCalls).toBe(1);
  });

  it('[TEST: edit after previous save] dirty again after a prior save → persists the NEW values before joining', async () => {
    const state = freshState();
    const persistedValues: Array<{ firstName: string; lastName: string }> = [];
    const currentFirstName = 'דנה';
    let currentLastName = 'כהן';
    let lastSaved = { firstName: 'דנה', lastName: 'כהן' };

    // Simulate the user editing the last name again after an earlier save.
    currentLastName = 'לוי';

    const result = await executeMandatorySetupFinalSave(state, {
      validate: () =>
        validateProfileName(currentFirstName, currentLastName, true),
      isDirty: () =>
        lastSaved.firstName !== currentFirstName ||
        lastSaved.lastName !== currentLastName,
      saveProfileName: () => {
        persistedValues.push({
          firstName: currentFirstName,
          lastName: currentLastName,
        });
        lastSaved = { firstName: currentFirstName, lastName: currentLastName };
        return true;
      },
      joinFamily: () => Promise.resolve(),
    });

    expect(result.status).toBe('joined');
    expect(persistedValues).toEqual([{ firstName: 'דנה', lastName: 'לוי' }]);
  });

  it('[save failure → zero join writes] saveProfileName returns false → profileSaveFailed, join never attempted', async () => {
    const state = freshState();
    let joinCalls = 0;

    const result = await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('דנה', 'כהן', true),
      isDirty: () => true,
      saveProfileName: () => false,
      joinFamily: () => {
        joinCalls += 1;
        return Promise.resolve();
      },
    });

    expect(result.status).toBe('profileSaveFailed');
    expect(joinCalls).toBe(0);
    // The guard must be released so the user can retry.
    expect(state.isSaving).toBe(false);
  });

  it('join itself fails (e.g. network error) → joinFailed, guard released for retry', async () => {
    const state = freshState();
    const result = await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('דנה', 'כהן', true),
      isDirty: () => false,
      saveProfileName: () => true,
      joinFamily: () => Promise.reject(new Error('network error')),
    });

    expect(result.status).toBe('joinFailed');
    expect(state.isSaving).toBe(false);
  });

  it('[rapid double tap] a second call while the first is still in flight is skipped — exactly one save/join sequence', async () => {
    const state = freshState();
    let saveCalls = 0;
    let joinCalls = 0;
    let resolveJoin: (() => void) | undefined;

    const deps = {
      validate: () => validateProfileName('דנה', 'כהן', true),
      isDirty: () => true,
      saveProfileName: () => {
        saveCalls += 1;
        return true;
      },
      joinFamily: () =>
        new Promise<void>((resolve) => {
          joinCalls += 1;
          resolveJoin = resolve;
        }),
    };

    const firstCall = executeMandatorySetupFinalSave(state, deps);
    // Fired synchronously, in the same tick, before the first call's
    // joinFamily promise has resolved — simulates a rapid double tap.
    const secondCall = executeMandatorySetupFinalSave(state, deps);

    const secondResult = await secondCall;
    expect(secondResult.status).toBe('skipped');
    expect(saveCalls).toBe(1);
    expect(joinCalls).toBe(1);

    resolveJoin?.();
    const firstResult = await firstCall;
    expect(firstResult.status).toBe('joined');
  });

  it('onStart is invoked exactly once, synchronously, after validation passes and before saving', async () => {
    const state = freshState();
    const events: string[] = [];

    await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('דנה', 'כהן', true),
      isDirty: () => true,
      saveProfileName: () => {
        events.push('save');
        return true;
      },
      joinFamily: () => {
        events.push('join');
        return Promise.resolve();
      },
      onStart: () => events.push('start'),
    });

    expect(events).toEqual(['start', 'save', 'join']);
  });

  it('onStart is never invoked when validation fails', async () => {
    const state = freshState();
    let onStartCalls = 0;

    await executeMandatorySetupFinalSave(state, {
      validate: () => validateProfileName('', 'כהן', true),
      isDirty: () => true,
      saveProfileName: () => true,
      joinFamily: () => Promise.resolve(),
      onStart: () => {
        onStartCalls += 1;
      },
    });

    expect(onStartCalls).toBe(0);
  });
});
