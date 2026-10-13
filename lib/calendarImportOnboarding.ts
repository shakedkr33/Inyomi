// ============================================================================
// calendarImportOnboarding.ts — pure helpers for the Calendar Import
// onboarding step (the LAST onboarding step before Home).
// ============================================================================
//
// Final onboarding flow:
//   Welcome → onboarding questions → OTP → profile setup / family join
//   → Calendar Import (import OR skip) → Home
//
// `onboardingCompleted` is NOT moved or redefined by this step. The step is
// tracked by two separate server-side user fields:
//
//   calendarImportPromptRequiredAt  — stamped by finishOnboarding for users
//     going through the new flow. Absent for every pre-existing user, which
//     is how existing users are protected from being re-onboarded.
//   calendarImportPromptResolvedAt  — set once the user imported OR skipped.
//     It does NOT mean "Google import completed".
//
// The pending state is: required AND NOT resolved.
// ============================================================================

import type { PostAuthOnboardingDecision } from './onboardingRouting';

export interface CalendarImportPromptFields {
  calendarImportPromptRequiredAt?: number | null;
  calendarImportPromptResolvedAt?: number | null;
}

/**
 * True only for a user who went through the new onboarding flow
 * (required stamp present) and has not yet imported or skipped.
 * A missing required stamp (legacy / pre-existing user) is never pending.
 */
export function isCalendarImportPromptPending(
  fields: CalendarImportPromptFields
): boolean {
  const required =
    fields.calendarImportPromptRequiredAt !== undefined &&
    fields.calendarImportPromptRequiredAt !== null;
  const resolved =
    fields.calendarImportPromptResolvedAt !== undefined &&
    fields.calendarImportPromptResolvedAt !== null;
  return required && !resolved;
}

export interface CalendarImportGateInput {
  /** Result of resolvePostAuthOnboardingRoute. */
  onboardingDecision: PostAuthOnboardingDecision;
  /** userStatus.calendarImportPromptPending (undefined while loading). */
  calendarImportPromptPending: boolean | undefined;
  /** True when the focused route is the import-calendar screen. */
  isOnImportCalendarRoute: boolean;
}

/**
 * The Calendar gate only ever applies once the existing onboarding decision
 * tree has settled on 'normal' (onboardingCompleted === true). It never
 * interferes with the incomplete-onboarding branches.
 */
export function shouldRedirectToCalendarImport(
  input: CalendarImportGateInput
): boolean {
  return (
    input.onboardingDecision === 'normal' &&
    input.calendarImportPromptPending === true &&
    !input.isOnImportCalendarRoute
  );
}

export interface CalendarImportExitInput {
  isOnImportCalendarRoute: boolean;
  /** userStatus.calendarImportPromptPending (undefined while loading). */
  calendarImportPromptPending: boolean | undefined;
  /**
   * True once this mounted layout session observed the import screen while the
   * step was still pending (so Settings/Home entries — where the step is
   * never pending — are never force-exited).
   */
  wasCalendarOnboardingActive: boolean;
}

/** Leave the import screen for Home once the step flips to resolved. */
export function shouldExitCalendarImportToHome(
  input: CalendarImportExitInput
): boolean {
  return (
    input.isOnImportCalendarRoute &&
    input.wasCalendarOnboardingActive &&
    input.calendarImportPromptPending === false
  );
}
