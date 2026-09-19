/**
 * Part 8 — hide the persistent bottom tab bar during mandatory onboarding.
 *
 * QA observed the main bottom tab bar visible while the user was still
 * inside phone-match-confirmation / mandatory family-profile-setup. Both
 * screens are mounted as Tabs.Screen entries inside the authenticated Tabs
 * navigator (see app/(authenticated)/_layout.tsx) — hidden from the tab BAR
 * via href: null, but the navigator's OWN persistent tabBarStyle is still
 * rendered underneath while either screen is focused, unless that specific
 * screen overrides tabBarStyle itself (the same static per-screen pattern
 * already used for the `subscription` screen).
 *
 * This repo has no React Navigation test harness (see
 * tests/convex/mandatoryProfileSetupRoutingFix.test.ts's documented
 * precedent). These invariants are verified via source inspection of the
 * real file, the same pattern used there.
 *
 * Run with: bun test tests/convex/onboardingBottomTabsHidden.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const LAYOUT_SOURCE = readFileSync(
  new URL('../../app/(authenticated)/_layout.tsx', import.meta.url),
  'utf8'
);

function extractTabsScreenBlock(source: string, screenName: string): string {
  const openMarker = `name="${screenName}"`;
  const nameIdx = source.indexOf(openMarker);
  expect(nameIdx).toBeGreaterThan(-1);
  const startIdx = source.lastIndexOf('<Tabs.Screen', nameIdx);
  expect(startIdx).toBeGreaterThan(-1);
  const closeIdx = source.indexOf('/>', nameIdx);
  expect(closeIdx).toBeGreaterThan(nameIdx);
  return source.slice(startIdx, closeIdx + 2);
}

describe('phone-match-confirmation Tabs.Screen — bottom tab bar hidden (mandatory onboarding)', () => {
  it('hides itself from the tab bar (href: null) AND hides the persistent tabBarStyle while focused', () => {
    const block = extractTabsScreenBlock(
      LAYOUT_SOURCE,
      'phone-match-confirmation'
    );
    expect(block).toContain('href: null');
    expect(block).toContain("tabBarStyle: { display: 'none' }");
  });
});

describe('family-profile-setup Tabs.Screen — bottom tab bar hidden (mandatory onboarding)', () => {
  it('hides itself from the tab bar (href: null) AND hides the persistent tabBarStyle while focused', () => {
    const block = extractTabsScreenBlock(LAYOUT_SOURCE, 'family-profile-setup');
    expect(block).toContain('href: null');
    expect(block).toContain("tabBarStyle: { display: 'none' }");
  });
});

describe('family-profile Tabs.Screen (normal Settings entry) — tabs untouched', () => {
  it('hides itself from the tab bar but does NOT override tabBarStyle — normal tab/navigation behavior is preserved when opened from Settings', () => {
    const block = extractTabsScreenBlock(LAYOUT_SOURCE, 'family-profile');
    expect(block).toContain('href: null');
    expect(block).not.toContain('tabBarStyle');
  });
});
