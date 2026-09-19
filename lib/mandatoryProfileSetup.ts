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
 * Mandatory mode (Phase 1): BOTH first name and last name are required —
 * the save button must stay disabled until neither is blank/whitespace-
 * only, and while a save is already in flight (prevents duplicate
 * submissions). This mirrors the server-side validation in
 * convex/onboarding.ts finishOnboarding.
 */
export function isMandatorySetupSaveDisabled(
  firstName: string,
  lastName: string,
  isSaving: boolean
): boolean {
  return (
    isSaving || firstName.trim().length === 0 || lastName.trim().length === 0
  );
}

/**
 * Family Membership Lifecycle Phase 1 correction: whether the current
 * authenticated (pre-onboarding-complete) mandatory-setup session is a
 * CLAIMED family match — the user SELECTED an existing family's phone
 * match via acceptPendingPhoneMatch — rather than a brand-new user with no
 * pending match at all.
 *
 * IMPORTANT: acceptPendingPhoneMatch no longer grants real access
 * immediately (see convex/members.ts's doc comment on
 * acceptPendingPhoneMatch / executeFamilyJoin) — it only records
 * `user.pendingMatchMemberId`. Real access is granted later, inside THIS
 * SAME mandatory-setup flow, once finishOnboarding's claimed path runs
 * executeFamilyJoin. So `hasPendingMatchMemberId` must be computed from
 * `user.pendingMatchMemberId !== undefined` (see convex/members.ts
 * hasPendingMatchMemberId query) — NEVER from a real per-space access row
 * (mySpaceRole), which is always null/undefined during mandatory setup
 * both for brand-new users AND for a claimed-but-not-yet-joined user.
 */
export function isClaimedMandatorySetup(
  isMandatorySetup: boolean,
  hasPendingMatchMemberId: boolean
): boolean {
  return isMandatorySetup && hasPendingMatchMemberId;
}

/**
 * QA fix: whether the current user may add/edit/remove human family
 * members and pets on the family-profile screen.
 *
 * During mandatory Profile Setup for a BRAND-NEW user, no space exists yet
 * (finishOnboarding creates it), so the real per-space admin/member role
 * query (mySpaceRole?.role === 'admin') is always null/false there — which
 * previously hid every "add" action during mandatory onboarding. There is
 * no real admin/member distinction to enforce before a space exists: the
 * user is only editing their own in-progress, not-yet-persisted family/pet
 * list (local editor state), and nothing is written to the members table
 * until saveAll()/finishOnboarding runs. So brand-new mandatory setup
 * always allows management, regardless of the (always-false) real admin
 * role.
 *
 * Phase 1 UX correction: a CLAIMED mandatory setup (isClaimedSetup) is
 * different — a real family with real members already exists, and the
 * authenticated user joined it as a 'member' (never an 'admin') access
 * row. They must never get add/edit/remove controls over that existing
 * family's members — only a real space admin may manage them, exactly
 * like the normal (non-mandatory) member-viewing case.
 *
 * Outside mandatory setup (optional post-auth setup, or the normal
 * settings profile-edit screen for a completed user), this defers entirely
 * to the real per-space admin role — unchanged existing behavior.
 */
export function canManageFamilyProfile(
  isMandatorySetup: boolean,
  isRealSpaceAdmin: boolean,
  isClaimedSetup = false
): boolean {
  return (isMandatorySetup && !isClaimedSetup) || isRealSpaceAdmin;
}
