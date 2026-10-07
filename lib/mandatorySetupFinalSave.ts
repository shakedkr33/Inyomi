// ============================================================================
// mandatorySetupFinalSave.ts — pure orchestration for the mandatory Profile
// Setup final "שמירה והמשך" CTA (app/(authenticated)/family-profile.tsx).
// ============================================================================
//
// QA fix: a user could type a valid first + last name into the self-profile
// form WITHOUT ever pressing the mid-form "שמירת פרטים" button, and the
// final "שמירה והמשך" button would already be enabled (it only checks the
// live firstName/lastName field values — see
// lib/mandatoryProfileSetup.ts's isMandatorySetupSaveDisabled). The user
// must never be required to understand that an intermediate save step
// exists: pressing the final CTA must transparently persist whatever is
// currently visible in the form (via the SAME canonical save function used
// by "שמירת פרטים") before attempting the real family join.
//
// This module is a tiny, UI-free state machine so that sequencing —
// validate → (maybe) save profile → join → handle every failure/guard
// branch — is unit-testable without rendering the screen. The caller
// (family-profile.tsx) only wires real dependencies (validate/isDirty/
// saveProfileName/joinFamily) and maps the returned status to the existing
// on-screen error/loading state.
// ============================================================================

import type { ProfileNameValidationResult } from './profileNameValidation';

/** Mutable re-entrancy guard, held across awaits (e.g. in a React ref). */
export interface MandatorySetupFinalSaveState {
  isSaving: boolean;
}

export interface MandatorySetupFinalSaveDeps {
  /** Pure validation of the currently-visible first/last name values. */
  validate: () => ProfileNameValidationResult;
  /**
   * Whether the currently-visible values differ from what was last
   * successfully persisted (via either "שמירת פרטים" or a prior run of
   * this same final-save flow). When false, the redundant save is
   * skipped and the flow proceeds straight to `joinFamily`.
   */
  isDirty: () => boolean;
  /**
   * The SAME canonical save function used by "שמירת פרטים"
   * (useFamilyProfileEditor's handleSavePersonalName). Synchronous: returns
   * whether the save actually happened. Must only be called after
   * `validate()` has already reported no errors.
   */
  saveProfileName: () => boolean;
  /** The existing final join path (saveAll → finishOnboarding/executeFamilyJoin). */
  joinFamily: () => Promise<void>;
  /**
   * Optional hook invoked synchronously, exactly once, right after the
   * re-entrancy guard is claimed and validation has passed — lets the
   * caller flip its own "saving" UI state in the same tick a duplicate tap
   * would otherwise race against.
   */
  onStart?: () => void;
}

export type MandatorySetupFinalSaveResult =
  /** A save/join sequence was already in flight — this call was ignored. */
  | { status: 'skipped' }
  /** First/last name validation failed — nothing was saved or joined. */
  | { status: 'invalid'; validation: ProfileNameValidationResult }
  /** The canonical profile-name save returned false — join was never attempted. */
  | { status: 'profileSaveFailed' }
  /** Profile name was (already, or just now) persisted, but the join itself failed. */
  | { status: 'joinFailed' }
  /** Profile name persisted (if needed) and the join completed successfully. */
  | { status: 'joined' };

/**
 * Runs the final "שמירה והמשך" sequence exactly once per call, guarding
 * against overlapping/duplicate invocations via `state.isSaving`.
 *
 * Sequence:
 *  1. If already saving → 'skipped' (double-tap protection).
 *  2. Validate first/last name → 'invalid' (with field errors) if either
 *     is missing. Nothing is saved or joined.
 *  3. Claim the guard, call `onStart`.
 *  4. If the visible values are dirty (unsaved/changed), persist them via
 *     the canonical `saveProfileName`. If that returns false → release the
 *     guard, return 'profileSaveFailed'. The join is NEVER attempted in
 *     this branch.
 *  5. Only after a successful (or unnecessary) save, call `joinFamily`.
 *     On rejection → release the guard, return 'joinFailed'. On success →
 *     'joined' (the guard is intentionally left claimed — the caller is
 *     expected to navigate away via its own reactive redirect, exactly
 *     like the pre-existing saveAll()/finishOnboarding flow).
 */
export async function executeMandatorySetupFinalSave(
  state: MandatorySetupFinalSaveState,
  deps: MandatorySetupFinalSaveDeps
): Promise<MandatorySetupFinalSaveResult> {
  if (state.isSaving) {
    return { status: 'skipped' };
  }

  const validation = deps.validate();
  if (validation.firstNameError || validation.lastNameError) {
    return { status: 'invalid', validation };
  }

  state.isSaving = true;
  deps.onStart?.();

  if (deps.isDirty()) {
    const saved = deps.saveProfileName();
    if (!saved) {
      state.isSaving = false;
      return { status: 'profileSaveFailed' };
    }
  }

  try {
    await deps.joinFamily();
    return { status: 'joined' };
  } catch {
    state.isSaving = false;
    return { status: 'joinFailed' };
  }
}
