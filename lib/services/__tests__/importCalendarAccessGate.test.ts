/**
 * importCalendarAccessGate.test.ts
 *
 * PRODUCT DECISION: Google Calendar import must be reachable and usable for
 * ALL subscription states (trial, free, paid "InYomi Together"). It is a
 * one-time onboarding/migration convenience, not a paid feature, so no
 * `useEffectiveAccess` permission flag (canCreatePersonalContent,
 * isExpiredFree, isTrialActive, etc.) may gate:
 *   - the Settings entry point (app/(authenticated)/profile.tsx)
 *   - the Home empty-state entry point (app/(authenticated)/index.tsx)
 *   - the route guard in app/(authenticated)/_layout.tsx
 *   - the import screen itself (app/(authenticated)/import-calendar.tsx)
 *
 * Investigation finding: none of these files currently reference
 * `useEffectiveAccess` in connection with the import flow. This test locks
 * that in as a regression guard via source inspection — the same pattern
 * used throughout tests/convex/*.test.ts for files with no test harness.
 *
 * Run with: bun test lib/services/__tests__/importCalendarAccessGate.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const IMPORT_SCREEN_SOURCE = readFileSync(
  new URL('../../../app/(authenticated)/import-calendar.tsx', import.meta.url),
  'utf8'
);
const PROFILE_SOURCE = readFileSync(
  new URL('../../../app/(authenticated)/profile.tsx', import.meta.url),
  'utf8'
);
const HOME_SOURCE = readFileSync(
  new URL('../../../app/(authenticated)/index.tsx', import.meta.url),
  'utf8'
);
const LAYOUT_SOURCE = readFileSync(
  new URL('../../../app/(authenticated)/_layout.tsx', import.meta.url),
  'utf8'
);

describe('import-calendar screen — no plan gating', () => {
  it('does not import or call useEffectiveAccess', () => {
    expect(IMPORT_SCREEN_SOURCE).not.toContain('useEffectiveAccess');
  });

  it('does not reference RevenueCat / subscription tier state', () => {
    expect(IMPORT_SCREEN_SOURCE).not.toContain('useRevenueCat');
    expect(IMPORT_SCREEN_SOURCE).not.toContain('subscriptionTier');
  });

  it('the only "already done" early-return check is the one-time import lock', () => {
    expect(IMPORT_SCREEN_SOURCE).toContain('hasCompletedGoogleImport');
    expect(IMPORT_SCREEN_SOURCE).toContain('alreadyImported?.completed === true');
  });
});

describe('Settings entry point (profile.tsx) — import row is not plan-gated', () => {
  it('the import-calendar SettingsRow has no conditional wrapper based on access', () => {
    const rowMatch = /<SettingsRow\s+label="העתקת אירועים מיומן חיצוני"[\s\S]*?\/>/.exec(
      PROFILE_SOURCE
    );
    expect(rowMatch).not.toBeNull();
    const rowSrc = rowMatch?.[0] ?? '';
    expect(rowSrc).not.toMatch(/isExpiredFree|isPersonal|isFamily|isTrialActive/);
  });
});

describe('Home empty-state entry point (index.tsx) — import CTA is not plan-gated', () => {
  it('the import-calendar CTA press handler has no access-flag guard', () => {
    const idx = HOME_SOURCE.indexOf("router.push('/(authenticated)/import-calendar')");
    expect(idx).toBeGreaterThan(-1);
    const surrounding = HOME_SOURCE.slice(Math.max(0, idx - 400), idx);
    expect(surrounding).not.toMatch(/isExpiredFree|isPersonal|isFamily|isTrialActive/);
  });
});

describe('Route guard (_layout.tsx) — import-calendar is not a gated route', () => {
  it('registers import-calendar as a plain hidden tab screen (href: null only)', () => {
    const idx = LAYOUT_SOURCE.indexOf('name="import-calendar"');
    expect(idx).toBeGreaterThan(-1);
    const line = LAYOUT_SOURCE.slice(idx, idx + 60);
    expect(line).toContain('href: null');
  });

  it('the ActionSheet personal-content gate (isExpiredFree) never targets import-calendar', () => {
    // The only route gated by isExpiredFree in the "+" action sheet is
    // event/new and task/new (personal content creation) — import-calendar
    // must never be routed through handleGatedCreateAction.
    const gatedBlock = LAYOUT_SOURCE.slice(
      LAYOUT_SOURCE.indexOf('function handleGatedCreateAction'),
      LAYOUT_SOURCE.indexOf('const showCommunityActions')
    );
    expect(gatedBlock).not.toContain('import-calendar');
  });
});
