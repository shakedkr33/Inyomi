/**
 * QA fix — post-save routing warning + nickname removal regression checks.
 *
 * Manual QA of the mandatory Profile Setup screen produced:
 *   "The action 'REPLACE' with payload {"name":"index","params":{}} was not
 *    handled by any navigator."
 *
 * Root cause: app/(authenticated)/family-profile.tsx (and the other
 * Stage 2B+3 onboarding-routing screens below) are mounted as Tabs.Screen
 * entries inside the authenticated Tabs navigator (see
 * app/(authenticated)/_layout.tsx). Bottom-tab navigators do not implement
 * the REPLACE navigation action (only stack navigators do), so calling
 * router.replace() to a sibling Tabs.Screen from a screen that is itself a
 * Tabs.Screen is unhandled. router.navigate() performs a normal tab switch
 * instead, which the Tabs navigator does handle.
 *
 * This repo has no React Navigation test harness (see
 * tests/convex/phoneMatchConfirmation.test.ts's documented precedent).
 * These invariants are verified via source inspection of the real files,
 * the same pattern used there.
 *
 * Run with: bun test tests/convex/mandatoryProfileSetupRoutingFix.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const FAMILY_PROFILE_SOURCE = readSource(
  '../../app/(authenticated)/family-profile.tsx'
);
const PHONE_MATCH_SOURCE = readSource(
  '../../app/(authenticated)/phone-match-confirmation.tsx'
);
const FAMILY_BOOTSTRAP_SOURCE = readSource(
  '../../app/(authenticated)/family-bootstrap.tsx'
);

describe('family-profile.tsx — no REPLACE to a sibling Tabs.Screen', () => {
  it('never calls router.replace targeting "/(authenticated)" (the sibling index tab)', () => {
    expect(FAMILY_PROFILE_SOURCE).not.toContain(
      "router.replace('/(authenticated)')"
    );
  });

  it('uses router.navigate for the post-save / skip / back Home transitions instead', () => {
    const navigateCount = (
      FAMILY_PROFILE_SOURCE.match(
        /router\.navigate\('\/\(authenticated\)'\)/g
      ) ?? []
    ).length;
    // handleSkipOptionalSetup (.then + .catch), handleSaveOptionalSetup,
    // handleSaveMandatorySetup, and the optional-mode back button.
    expect(navigateCount).toBeGreaterThanOrEqual(5);
  });
});

describe('phone-match-confirmation.tsx — no REPLACE to a sibling Tabs.Screen', () => {
  it('never calls router.replace targeting "/(authenticated)" or the family-profile-setup sibling tab', () => {
    expect(PHONE_MATCH_SOURCE).not.toContain(
      "router.replace('/(authenticated)')"
    );
    expect(PHONE_MATCH_SOURCE).not.toContain(
      "router.replace('/(authenticated)/family-profile-setup')"
    );
  });

  it('uses router.navigate instead', () => {
    expect(PHONE_MATCH_SOURCE).toContain("router.navigate('/(authenticated)')");
    expect(PHONE_MATCH_SOURCE).toContain(
      "router.navigate('/(authenticated)/family-profile-setup')"
    );
  });
});

describe('family-bootstrap.tsx — no REPLACE to a sibling Tabs.Screen', () => {
  it('never calls router.replace targeting "/(authenticated)" or the family-profile-setup sibling tab', () => {
    expect(FAMILY_BOOTSTRAP_SOURCE).not.toContain(
      "router.replace('/(authenticated)')"
    );
    expect(FAMILY_BOOTSTRAP_SOURCE).not.toContain(
      "router.replace('/(authenticated)/family-profile-setup')"
    );
  });

  it('still uses router.replace for routes OUTSIDE the Tabs navigator (unchanged — different navigator, REPLACE is valid there)', () => {
    expect(FAMILY_BOOTSTRAP_SOURCE).toContain(
      "router.replace('/(auth)/sign-in')"
    );
    expect(FAMILY_BOOTSTRAP_SOURCE).toContain(
      "router.replace('/onboarding-hero')"
    );
  });

  it('uses router.navigate for the two same-navigator transitions', () => {
    expect(FAMILY_BOOTSTRAP_SOURCE).toContain(
      "router.navigate('/(authenticated)')"
    );
    expect(FAMILY_BOOTSTRAP_SOURCE).toContain(
      "router.navigate('/(authenticated)/family-profile-setup')"
    );
  });
});

describe('self-profile UI — nickname field removed (locked product decision)', () => {
  it('family-profile.tsx no longer renders a nickname input ("כינוי")', () => {
    expect(FAMILY_PROFILE_SOURCE).not.toContain('כינוי');
  });

  it('family-profile.tsx no longer destructures nickname/setNickname from the editor hook', () => {
    // The hook itself still exposes nickname for backward compatibility —
    // only the screen must stop consuming/rendering it.
    expect(FAMILY_PROFILE_SOURCE).not.toContain('setNickname');
  });

  it('profile.tsx no longer prefers nickname when computing the self-profile display name', () => {
    const PROFILE_SOURCE = readSource('../../app/(authenticated)/profile.tsx');
    expect(PROFILE_SOURCE).not.toContain('rawNickname');
  });
});

describe('mandatory setup — family/pet management is not gated by the real (pre-space) admin role', () => {
  it('family-profile.tsx computes canManageFamilyProfile from the extracted, unit-tested helper', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain('canManageFamilyProfileHelper(');
  });

  it('the member/pet list rendering source (displayMembers/displayPetMembers) reads local editor state whenever canManageFamilyProfile is true, not only the real isAdmin role', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'const displayMembers: FamilyMember[] = canManageFamilyProfile'
    );
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'const displayPetMembers: FamilyMember[] = canManageFamilyProfile'
    );
  });
});
