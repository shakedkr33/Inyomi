// ============================================================================
// identityEditGuard.ts — Phase 1 final correction: legacy silent-migration guard
// ============================================================================
//
// Distinguishes a HYDRATED FALLBACK name (derived by splitting fullName —
// see lib/legacyNameHydration.ts — purely for display/edit convenience)
// from an EXPLICIT USER IDENTITY EDIT (the user actually typed into the
// first/last name fields on the optional/returning-user profile screen).
//
// See hooks/useFamilyProfileEditor.ts for the stateful wiring:
//   - hydration (OnboardingContext's hydrateFromServer) never marks
//     identity as edited — there is no code path connecting it to this
//     module at all.
//   - only the wrapped setFirstName/setLastName exposed by
//     useFamilyProfileEditor mark identity as edited, and ONLY in
//     response to an actual call from the screen's text-input onChange
//     handlers.
//
// buildProfileNameSavePatch is the single source of truth for what the
// optional/returning-user save (hooks/useFamilyProfileEditor.ts
// saveProfile()) is allowed to send for firstName/lastName/fullName. When
// identityEdited is false, it returns an EMPTY object — no keys at all —
// which is indistinguishable, from convex/users.ts updateMyProfile's
// perspective, from "the caller never mentioned these args" (its
// migration gate is literally
// `args.firstName !== undefined || args.lastName !== undefined`). This is
// what guarantees an unrelated save (family member, avatar color, etc.)
// can never silently populate firstName/lastName or regenerate fullName
// for a legacy user who never touched their own name.
//
// Mandatory onboarding (finishOnboarding via useFamilyProfileEditor's
// saveAll()) is NOT gated by this helper — both names are required and
// always sent there, unconditionally, exactly as before this correction.
// ============================================================================

export interface ProfileNameSaveInput {
  /** True only if the user explicitly typed into firstName/lastName during this session. */
  identityEdited: boolean;
  firstName: string;
  lastName: string;
}

export interface ProfileNameSavePatch {
  fullName?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Builds the firstName/lastName/fullName portion of the updateMyProfile
 * payload for the optional/returning-user profile-edit path.
 *
 * - identityEdited === false → returns {} (no keys at all). Callers must
 *   spread this directly into the mutation args object rather than always
 *   including the keys with `undefined` values, since Convex validators
 *   distinguish an omitted key from an explicit `undefined` value only at
 *   the JS-object level — omitting the key entirely is what keeps
 *   updateMyProfile's `!== undefined` migration gate false.
 * - identityEdited === true → returns the trimmed firstName/lastName and
 *   the regenerated fullName (or a fully empty object's worth of
 *   `undefined` values for any name that trims to blank — mirrors the
 *   existing convex/users.ts updateMyProfile self-edit derivation).
 */
export function buildProfileNameSavePatch(
  input: ProfileNameSaveInput
): ProfileNameSavePatch {
  if (!input.identityEdited) return {};

  const trimmedFirstName = input.firstName.trim();
  const trimmedLastName = input.lastName.trim();
  const fullName = [trimmedFirstName, trimmedLastName]
    .filter(Boolean)
    .join(' ');

  return {
    fullName: fullName || undefined,
    firstName: trimmedFirstName || undefined,
    lastName: trimmedLastName || undefined,
  };
}
