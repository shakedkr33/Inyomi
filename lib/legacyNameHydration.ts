// ============================================================================
// legacyNameHydration.ts — Pure helper extracted from
// contexts/OnboardingContext.tsx's hydrateFromServer
// ============================================================================
//
// Derives display/edit-convenience firstName/lastName from a server
// profile — preferring the canonical split fields (Phase 1) when present,
// and falling back to splitting `fullName` on whitespace for legacy users
// who only ever saved `fullName` (pre-Phase 1).
//
// This is a UI DISPLAY/EDIT-CONVENIENCE DERIVATION ONLY. The derived
// values must never be treated as an explicit identity edit — see
// lib/identityEditGuard.ts for the separate mechanism (wired in
// hooks/useFamilyProfileEditor.ts) that prevents this fallback from being
// silently persisted back to the server on an unrelated save.
//
// Behavior is unchanged from the original inline logic in
// OnboardingContext.tsx — this is a pure extraction for testability, not a
// behavior change.
// ============================================================================

export interface ServerNameProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
}

export interface DerivedName {
  firstName: string;
  lastName: string;
}

export function deriveNameFromServerProfile(
  profile: ServerNameProfile
): DerivedName {
  const hasServerSplitName = Boolean(
    profile.firstName?.trim() || profile.lastName?.trim()
  );

  if (hasServerSplitName) {
    return {
      firstName: profile.firstName?.trim() ?? '',
      lastName: profile.lastName?.trim() ?? '',
    };
  }

  const parts = (profile.fullName ?? '').trim().split(/\s+/);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}
