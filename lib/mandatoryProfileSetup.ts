// ============================================================================
// mandatoryProfileSetup.ts — Stage 2B+3 pure helper
// ============================================================================
//
// Small extracted decision helper for the mandatory Profile Setup screen
// (app/(authenticated)/family-profile.tsx, reached when
// onboardingCompleted === false). Kept separate from the screen so the
// "first name required" rule is unit-testable without rendering React
// Native components.
// ============================================================================

/**
 * Mandatory mode: first name is required — the save button must stay
 * disabled until a non-whitespace first name is entered, and while a save
 * is already in flight (prevents duplicate submissions).
 */
export function isMandatorySetupSaveDisabled(
  firstName: string,
  isSaving: boolean
): boolean {
  return isSaving || firstName.trim().length === 0;
}

/**
 * QA fix: whether the current user may add/edit/remove human family
 * members and pets on the family-profile screen.
 *
 * During mandatory Profile Setup no space exists yet (finishOnboarding
 * creates it), so the real per-space admin/member role query
 * (mySpaceRole?.role === 'admin') is always null/false there — which
 * previously hid every "add" action during mandatory onboarding. There is
 * no real admin/member distinction to enforce before a space exists: the
 * user is only editing their own in-progress, not-yet-persisted family/pet
 * list (local editor state), and nothing is written to the members table
 * until saveAll()/finishOnboarding runs. So mandatory setup always allows
 * management, regardless of the (always-false) real admin role.
 *
 * Outside mandatory setup (optional post-auth setup, or the normal
 * settings profile-edit screen for a completed user), this defers entirely
 * to the real per-space admin role — unchanged existing behavior.
 */
export function canManageFamilyProfile(
  isMandatorySetup: boolean,
  isRealSpaceAdmin: boolean
): boolean {
  return isMandatorySetup || isRealSpaceAdmin;
}
