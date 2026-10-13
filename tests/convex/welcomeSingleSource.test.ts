/**
 * Single Welcome screen — routing contract.
 *
 * Before: two Welcome-like screens existed — the pre-auth app/(auth)/index.tsx
 * and a post-auth app/onboarding-hero.tsx that signed-in users with
 * incomplete onboarding were redirected to (so a user who tapped
 * "התחברות" on the first Welcome saw a second one after OTP).
 *
 * Now app/(auth)/index.tsx is the ONLY Welcome. Signed-in users who still
 * need onboarding are routed straight to Q1 (/onboarding-step1).
 *
 * This repo has no React Navigation test harness (see
 * tests/convex/mandatoryProfileSetupRoutingFix.test.ts for the documented
 * precedent), so these invariants are verified by source inspection.
 *
 * Run with: bun test tests/convex/welcomeSingleSource.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

function resolvePath(relativePath: string): URL {
  return new URL(relativePath, import.meta.url);
}

function readSource(relativePath: string): string {
  return readFileSync(resolvePath(relativePath), 'utf8');
}

const WELCOME_SOURCE = readSource('../../app/(auth)/index.tsx');
const AUTHENTICATED_LAYOUT_SOURCE = readSource(
  '../../app/(authenticated)/_layout.tsx'
);
const FAMILY_BOOTSTRAP_SOURCE = readSource(
  '../../app/(authenticated)/family-bootstrap.tsx'
);
const STEP1_SOURCE = readSource('../../app/onboarding-step1.tsx');

describe('single Welcome screen — no duplicate post-auth Welcome', () => {
  it('the legacy post-auth onboarding-hero route no longer exists', () => {
    expect(existsSync(resolvePath('../../app/onboarding-hero.tsx'))).toBe(
      false
    );
  });

  it('nothing navigates to the removed /onboarding-hero route', () => {
    for (const source of [
      WELCOME_SOURCE,
      AUTHENTICATED_LAYOUT_SOURCE,
      FAMILY_BOOTSTRAP_SOURCE,
      STEP1_SOURCE,
    ]) {
      expect(source).not.toMatch(
        /router\.(replace|push|navigate)\([^)]*onboarding-hero/
      );
    }
  });

  it('the authenticated layout sends users needing onboarding questions straight to step 1', () => {
    expect(AUTHENTICATED_LAYOUT_SOURCE).toMatch(
      /if \(needsOnboardingRedirect\) \{[\s\S]*?router\.replace\('\/onboarding-step1'\);/
    );
  });

  it('family-bootstrap also skips straight to step 1 when onboarding answers are missing', () => {
    expect(FAMILY_BOOTSTRAP_SOURCE).toContain(
      "router.replace('/onboarding-step1')"
    );
  });

  it('onboarding-step1 releases the startup bridge for authenticated cold starts that land on it', () => {
    expect(STEP1_SOURCE).toContain("useStartupDestinationReady('onboarding')");
    expect(STEP1_SOURCE).toContain(
      'onLayout={handleOnboardingDestinationLayout}'
    );
  });
});

describe('Welcome screen (app/(auth)/index.tsx) — behavior contract', () => {
  it('"בואו נתחיל" continues to the existing onboarding questions', () => {
    expect(WELCOME_SOURCE).toContain("router.replace('/onboarding-step1')");
    expect(WELCOME_SOURCE).toContain('בואו נתחיל');
  });

  it('"התחברות" goes to the existing sign-in flow', () => {
    expect(WELCOME_SOURCE).toContain("router.replace('/(auth)/sign-in')");
    expect(WELCOME_SOURCE).toContain('כבר יש לך חשבון? ');
    expect(WELCOME_SOURCE).toContain('התחברות');
  });

  it('preserves the existing onboarding-draft skip to sign-in', () => {
    expect(WELCOME_SOURCE).toContain('getOnboardingDraft');
    expect(WELCOME_SOURCE).toMatch(
      /if \(draft\) \{\s*router\.replace\('\/\(auth\)\/sign-in'\);/
    );
  });

  it('renders the approved Hebrew subtitle and does not duplicate the English slogan as text', () => {
    expect(WELCOME_SOURCE).toContain(
      'אפליקציה לניהול החיים — כל האירועים, המשימות והקהילות במקום אחד'
    );
    expect(WELCOME_SOURCE).not.toMatch(/>\s*Less to remember/);
  });

  it('renders the logo and hero as separate assets that exist on disk', () => {
    expect(WELCOME_SOURCE).toContain(
      '@/assets/branding/inyomi-logo-horizontal.png'
    );
    expect(WELCOME_SOURCE).toContain(
      '@/assets/images/onboarding/welcome-hero.jpg'
    );
    expect(
      existsSync(
        resolvePath('../../assets/branding/inyomi-logo-horizontal.png')
      )
    ).toBe(true);
    expect(
      existsSync(resolvePath('../../assets/images/onboarding/welcome-hero.jpg'))
    ).toBe(true);
  });

  it('is guarded against double navigation', () => {
    expect(WELCOME_SOURCE).toContain('isNavigating');
  });
});
