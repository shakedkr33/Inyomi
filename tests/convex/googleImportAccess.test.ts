/**
 * Google Calendar import — access gating regression guard (convex/googleImport.ts)
 *
 * PRODUCT DECISION: Google Calendar import is a one-time onboarding/migration
 * convenience, not a paid feature. It must be reachable and usable in ALL
 * subscription states (trial, free, paid "InYomi Together"). No RevenueCat
 * entitlement / plan check may block `importGoogleCalendar` or
 * `hasCompletedGoogleImport`.
 *
 * Investigation finding (see PR/report): as of this change, neither Convex
 * function ever referenced a subscription tier, entitlement, or
 * `PAYMENT_SYSTEM_ENABLED` check — the only server-side gates are (1)
 * authentication via `getAuthUserId` and (2) the one-time `googleImportStatus`
 * lock. This test locks in that state as a regression guard: it will fail
 * loudly if a future change introduces a plan/entitlement check here.
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/phoneMatchConfirmation.test.ts's documented precedent).
 * Given that constraint, these invariants are verified via source
 * inspection of the REAL convex/googleImport.ts file.
 *
 * Run with: bun test tests/convex/googleImportAccess.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const GOOGLE_IMPORT_SOURCE = readFileSync(
  new URL('../../convex/googleImport.ts', import.meta.url),
  'utf8'
);

// ── No subscription/entitlement gating anywhere in this file ───────────────

describe('googleImport.ts — no plan/entitlement gating (product decision)', () => {
  const forbiddenTokens = [
    'useEffectiveAccess',
    'effectiveAccess',
    'subscriptionTier',
    'RevenueCat',
    'PAYMENT_SYSTEM_ENABLED',
    "'family'",
    "'personal'",
    'entitlement',
    'isTrialActive',
    'isExpiredFree',
    'trial_active',
    'trial_expired_free',
  ];

  for (const token of forbiddenTokens) {
    it(`does not reference "${token}"`, () => {
      expect(GOOGLE_IMPORT_SOURCE).not.toContain(token);
    });
  }
});

// ── importGoogleCalendar: auth + one-time lock only ─────────────────────────

function extractExportBlock(source: string, exportName: string): string {
  const startMarker = `export const ${exportName} = `;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find export "${exportName}" in source`);
  }
  const afterStart = startIdx + startMarker.length;
  const nextExportMatch = /export const \w+ = (mutation|query|internalMutation)\(\{/.exec(
    source.slice(afterStart)
  );
  const endIdx =
    nextExportMatch === null ? source.length : afterStart + nextExportMatch.index;
  return source.slice(startIdx, endIdx);
}

const importGoogleCalendarSrc = extractExportBlock(
  GOOGLE_IMPORT_SOURCE,
  'importGoogleCalendar'
);
const hasCompletedGoogleImportSrc = extractExportBlock(
  GOOGLE_IMPORT_SOURCE,
  'hasCompletedGoogleImport'
);

describe('importGoogleCalendar — access matrix', () => {
  it('requires authentication (getAuthUserId)', () => {
    expect(importGoogleCalendarSrc).toContain('getAuthUserId(ctx)');
    expect(importGoogleCalendarSrc).toContain("if (!userId) throw new Error");
  });

  it('preserves the one-time import lock (checks existing googleImportStatus record)', () => {
    expect(importGoogleCalendarSrc).toContain("query('googleImportStatus')");
    expect(importGoogleCalendarSrc).toContain('by_user_provider');
    expect(importGoogleCalendarSrc).toContain('alreadyCompleted: true as const');
  });

  it('does not gate on any subscription/space-tier field before the lock check', () => {
    // The only checks before resolving the space should be: auth, then the
    // one-time lock. No plan-based branch may appear between them.
    const beforeLock = importGoogleCalendarSrc.slice(
      0,
      importGoogleCalendarSrc.indexOf('if (existing)')
    );
    expect(beforeLock).not.toMatch(/family|personal|trial|premium/i);
  });
});

describe('hasCompletedGoogleImport — access matrix', () => {
  it('requires authentication (getAuthUserId)', () => {
    expect(hasCompletedGoogleImportSrc).toContain('getAuthUserId(ctx)');
  });

  it('does not reference any plan/entitlement field', () => {
    expect(hasCompletedGoogleImportSrc).not.toMatch(/family|personal|trial|premium/i);
  });
});
