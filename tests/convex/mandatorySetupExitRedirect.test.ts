/**
 * Part 7 QA fix — "NAVIGATE {name:'index'}" unhandled after mandatory
 * Profile Setup Save.
 *
 * Root cause: family-profile.tsx's handleSaveMandatorySetup used to call
 * router.navigate('/(authenticated)') itself inside saveAll().then(). The
 * instant finishOnboarding's write flips userStatus.onboardingComplete to
 * true, the authenticated layout's own needsHydration gate can briefly
 * render <InYomiSplashScreen /> INSTEAD OF the <Tabs> navigator this screen
 * lives in (until hydrateFromServer's effect resolves) — if the imperative
 * navigate call landed in that window, its target no longer existed,
 * producing the reported warning.
 *
 * Fix: the authenticated layout (app/(authenticated)/_layout.tsx) is now the
 * ONLY place that performs this specific transition, via
 * needsMandatorySetupExitRedirect — driven by rendered state, never an
 * imperative call from inside the mutation's own .then(). This mirrors the
 * same architecture already used for the phone-match-confirmation race (see
 * tests/convex/mandatoryProfileSetupRoutingFix.test.ts).
 *
 * This repo has no React Navigation test harness (see
 * tests/convex/mandatoryProfileSetupRoutingFix.test.ts's documented
 * precedent). These invariants are verified via source inspection of the
 * real files, the same pattern used there.
 *
 * Run with: bun test tests/convex/mandatorySetupExitRedirect.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const LAYOUT_SOURCE = readSource('../../app/(authenticated)/_layout.tsx');
const FAMILY_PROFILE_SOURCE = readSource(
  '../../app/(authenticated)/family-profile.tsx'
);

describe('app/(authenticated)/_layout.tsx — needsMandatorySetupExitRedirect', () => {
  it('defines the exit-redirect flag, gated on the profile-setup route and a completed onboardingComplete', () => {
    expect(LAYOUT_SOURCE).toContain('needsMandatorySetupExitRedirect');
    expect(LAYOUT_SOURCE).toContain('wasMandatorySetupRef');
  });

  it('tracks wasMandatorySetupRef only while onboarding was still incomplete on this route (never for the optional post-auth nudge)', () => {
    expect(LAYOUT_SOURCE).toContain(
      'if (isProfileSetupRoute && userStatus?.onboardingComplete === false) {'
    );
  });

  it('does NOT include needsMandatorySetupExitRedirect in the splash-screen early return — Tabs must stay mounted for the navigate call to succeed', () => {
    const splashReturnMatch = LAYOUT_SOURCE.match(
      /if \(\s*!isReadyToRoute \|\|[\s\S]*?return <InYomiSplashScreen \/>;\s*\}/
    );
    expect(splashReturnMatch).not.toBeNull();
    expect(splashReturnMatch?.[0] ?? '').not.toContain(
      'needsMandatorySetupExitRedirect'
    );
  });

  it('performs the transition with router.navigate (same-navigator tab switch), not router.replace', () => {
    const redirectEffectMatch = LAYOUT_SOURCE.match(
      /if \(needsMandatorySetupExitRedirect\) \{[\s\S]*?\n {4}\}/
    );
    expect(redirectEffectMatch).not.toBeNull();
    const body = redirectEffectMatch?.[0] ?? '';
    expect(body).toContain("router.navigate('/(authenticated)')");
    expect(body).not.toContain('router.replace');
  });

  it('resets wasMandatorySetupRef after performing the redirect (idempotent — no repeat navigation)', () => {
    const redirectEffectMatch = LAYOUT_SOURCE.match(
      /if \(needsMandatorySetupExitRedirect\) \{[\s\S]*?\n {4}\}/
    );
    expect(redirectEffectMatch?.[0] ?? '').toContain(
      'wasMandatorySetupRef.current = false;'
    );
  });

  it('includes needsMandatorySetupExitRedirect in the routing effect dependency array', () => {
    expect(LAYOUT_SOURCE).toMatch(
      /useEffect\(\(\) => \{\s*if \(!isReadyToRoute\) return;[\s\S]*?needsMandatorySetupExitRedirect,\s*router,\s*\]\);/
    );
  });
});

describe('family-profile.tsx handleSaveMandatorySetup — no imperative navigation of its own', () => {
  it('never calls router.navigate/replace/push inside handleSaveMandatorySetup', () => {
    const match = FAMILY_PROFILE_SOURCE.match(
      /const handleSaveMandatorySetup[\s\S]*?\n {2}\};/
    );
    expect(match).not.toBeNull();
    const body = match?.[0] ?? '';
    expect(body).not.toMatch(/router\.(navigate|replace|push)\(/);
  });

  it('still calls saveAll() and surfaces a retryable error on failure', () => {
    const match = FAMILY_PROFILE_SOURCE.match(
      /const handleSaveMandatorySetup[\s\S]*?\n {2}\};/
    );
    const body = match?.[0] ?? '';
    expect(body).toContain('saveAll()');
    expect(body).toContain('setMandatorySetupError(');
  });
});
