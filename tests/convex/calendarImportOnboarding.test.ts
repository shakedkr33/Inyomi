/**
 * Calendar Import onboarding step (final step before first Home).
 *
 * Final flow: Welcome → onboarding questions → OTP → profile setup / family
 * join → Calendar Import (import OR skip) → Home.
 *
 * `onboardingCompleted` is NOT moved or redefined. The step is tracked by two
 * separate server-side user fields:
 *   - calendarImportPromptRequiredAt  (stamped by finishOnboarding only)
 *   - calendarImportPromptResolvedAt  (import done OR explicit skip)
 *
 * This repo has no Convex mutation / React Navigation harness (see the
 * documented precedent in tests/convex/mandatorySetupExitRedirect.test.ts):
 *   - the pure gate logic (lib/calendarImportOnboarding.ts) is tested
 *     behaviorally, composed with the REAL resolvePostAuthOnboardingRoute;
 *   - invariants that live in the shipped mutations/screens are verified via
 *     source inspection of the real files.
 *
 * Run with: bun test tests/convex/calendarImportOnboarding.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  isCalendarImportPromptPending,
  shouldExitCalendarImportToHome,
  shouldRedirectToCalendarImport,
} from '../../lib/calendarImportOnboarding';
import { resolvePostAuthOnboardingRoute } from '../../lib/onboardingRouting';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const LAYOUT = readSource('../../app/(authenticated)/_layout.tsx');
const IMPORT_SCREEN = readSource(
  '../../app/(authenticated)/import-calendar.tsx'
);
const ONBOARDING_SRC = readSource('../../convex/onboarding.ts');
const USERS_SRC = readSource('../../convex/users.ts');
const SCHEMA_SRC = readSource('../../convex/schema.ts');
const GOOGLE_IMPORT_SRC = readSource('../../convex/googleImport.ts');
const APPLE_SRC = readSource('../../convex/appleReviewAuth.ts');
const PROFILE_SRC = readSource('../../app/(authenticated)/profile.tsx');
const HOME_SRC = readSource('../../app/(authenticated)/index.tsx');

function extractBlock(source: string, exportName: string): string {
  const start = source.indexOf(`export const ${exportName} = `);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf('\nexport const ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

// ── Pure gate: pending state ─────────────────────────────────────────────────

describe('isCalendarImportPromptPending', () => {
  it('[13] legacy / existing user (no required stamp) is NEVER pending', () => {
    expect(isCalendarImportPromptPending({})).toBe(false);
    expect(
      isCalendarImportPromptPending({
        calendarImportPromptRequiredAt: undefined,
        calendarImportPromptResolvedAt: undefined,
      })
    ).toBe(false);
    expect(
      isCalendarImportPromptPending({ calendarImportPromptRequiredAt: null })
    ).toBe(false);
  });

  it('[12] new-flow user, unresolved → pending (survives app kill: server state)', () => {
    expect(
      isCalendarImportPromptPending({ calendarImportPromptRequiredAt: 1000 })
    ).toBe(true);
  });

  it('[5][6] resolved (import OR skip) → not pending', () => {
    expect(
      isCalendarImportPromptPending({
        calendarImportPromptRequiredAt: 1000,
        calendarImportPromptResolvedAt: 2000,
      })
    ).toBe(false);
  });
});

// ── Pure gate composed with the real onboarding decision tree ────────────────

function routeFor(opts: {
  onboardingComplete: boolean | undefined;
  pending: boolean | undefined;
  onImportRoute?: boolean;
  hasAnswers?: boolean;
  answersPersisted?: boolean;
  phoneMatchResolvedAt?: number | null;
  pendingMatches?: unknown[] | undefined;
}): 'import' | 'other' {
  const decision = resolvePostAuthOnboardingRoute({
    onboardingComplete: opts.onboardingComplete,
    hasLocalOnboardingAnswers: opts.hasAnswers ?? true,
    answersPersisted: opts.answersPersisted ?? true,
    phoneMatchResolvedAt: opts.phoneMatchResolvedAt ?? null,
    pendingMatches: opts.pendingMatches ?? [],
  });
  return shouldRedirectToCalendarImport({
    onboardingDecision: decision,
    calendarImportPromptPending: opts.pending,
    isOnImportCalendarRoute: opts.onImportRoute ?? false,
  })
    ? 'import'
    : 'other';
}

describe('shouldRedirectToCalendarImport — routing', () => {
  it('[1][4] new personal user / family user without match: onboarding complete + pending → Calendar step', () => {
    expect(routeFor({ onboardingComplete: true, pending: true })).toBe(
      'import'
    );
  });

  it('[3] family user with phone match, joined: onboarding complete + pending → Calendar step', () => {
    // finishOnboarding's claimed path stamps the required flag too (see source tests below).
    expect(routeFor({ onboardingComplete: true, pending: true })).toBe(
      'import'
    );
  });

  it('[5][6] resolved → no redirect (Home)', () => {
    expect(routeFor({ onboardingComplete: true, pending: false })).toBe(
      'other'
    );
  });

  it('[13] existing fully-onboarded user (flag false) is never forced into the step', () => {
    expect(routeFor({ onboardingComplete: true, pending: false })).toBe(
      'other'
    );
  });

  it('loading userStatus never redirects (no guessing, avoids races)', () => {
    expect(
      routeFor({ onboardingComplete: undefined, pending: undefined })
    ).toBe('other');
    expect(routeFor({ onboardingComplete: true, pending: undefined })).toBe(
      'other'
    );
  });

  it('does not redirect while already on the import screen (no redirect loop)', () => {
    expect(
      routeFor({ onboardingComplete: true, pending: true, onImportRoute: true })
    ).toBe('other');
  });

  it('never interferes with the incomplete-onboarding branches (profile setup / phone match / questions)', () => {
    expect(routeFor({ onboardingComplete: false, pending: true })).toBe(
      'other'
    );
    expect(
      routeFor({
        onboardingComplete: false,
        pending: true,
        pendingMatches: [{}],
      })
    ).toBe('other');
    expect(
      routeFor({ onboardingComplete: false, pending: true, hasAnswers: false })
    ).toBe('other');
  });
});

describe('shouldExitCalendarImportToHome', () => {
  it('[5][6] leaves the import screen once the step resolves, only if it was entered pending', () => {
    expect(
      shouldExitCalendarImportToHome({
        isOnImportCalendarRoute: true,
        calendarImportPromptPending: false,
        wasCalendarOnboardingActive: true,
      })
    ).toBe(true);
  });

  it('[14][15] Settings/Home entry (step never pending) is never force-exited', () => {
    expect(
      shouldExitCalendarImportToHome({
        isOnImportCalendarRoute: true,
        calendarImportPromptPending: false,
        wasCalendarOnboardingActive: false,
      })
    ).toBe(false);
  });

  it('does not exit while still pending or while status is loading', () => {
    for (const pending of [true, undefined]) {
      expect(
        shouldExitCalendarImportToHome({
          isOnImportCalendarRoute: true,
          calendarImportPromptPending: pending,
          wasCalendarOnboardingActive: true,
        })
      ).toBe(false);
    }
  });

  it('does not exit from other routes', () => {
    expect(
      shouldExitCalendarImportToHome({
        isOnImportCalendarRoute: false,
        calendarImportPromptPending: false,
        wasCalendarOnboardingActive: true,
      })
    ).toBe(false);
  });
});

// ── Backend / schema ─────────────────────────────────────────────────────────

describe('schema — separate onboarding gate fields', () => {
  it('adds both optional fields (no migration required for existing users)', () => {
    expect(SCHEMA_SRC).toContain(
      'calendarImportPromptRequiredAt: v.optional(v.number())'
    );
    expect(SCHEMA_SRC).toContain(
      'calendarImportPromptResolvedAt: v.optional(v.number())'
    );
  });
});

describe('finishOnboarding — stamps the required flag, onboardingCompleted untouched', () => {
  const finish = ONBOARDING_SRC.slice(
    ONBOARDING_SRC.indexOf('export const finishOnboarding'),
    ONBOARDING_SRC.indexOf('export const resolveCalendarImportPrompt')
  );

  it('stamps calendarImportPromptRequiredAt in BOTH the claimed (family join) and normal paths', () => {
    const occurrences =
      finish.split('calendarImportPromptRequiredAt:').length - 1;
    expect(occurrences).toBe(2);
  });

  it('never stamps the RESOLVED flag (the step is resolved only by the user)', () => {
    expect(finish).not.toContain('calendarImportPromptResolvedAt');
  });

  it('still sets onboardingCompleted: true in both patches (timing unchanged)', () => {
    expect(finish.split('onboardingCompleted: true').length - 1).toBe(2);
  });
});

describe('resolveCalendarImportPrompt mutation', () => {
  const block = extractBlock(ONBOARDING_SRC, 'resolveCalendarImportPrompt');

  it('requires authentication via getAuthUserId', () => {
    expect(block).toContain('getAuthUserId(ctx)');
    expect(block).toContain('if (!userId)');
  });

  it('only valid once onboardingCompleted — never changes onboardingCompleted', () => {
    expect(block).toContain('user.onboardingCompleted !== true');
    expect(block).not.toMatch(/onboardingCompleted:\s*/);
  });

  it('is idempotent: keeps the original resolved timestamp', () => {
    expect(block).toContain(
      'if (user.calendarImportPromptResolvedAt !== undefined) return null;'
    );
  });

  it('writes ONLY calendarImportPromptResolvedAt', () => {
    expect(block).toContain(
      'ctx.db.patch(userId, { calendarImportPromptResolvedAt: Date.now() })'
    );
  });

  it('[E] Skip never marks Google import completed: no googleImportStatus access', () => {
    expect(block).not.toContain('googleImportStatus');
  });

  it('takes no client-supplied identity (userId comes from auth only)', () => {
    expect(block).toContain('args: {}');
  });
});

describe('getCurrentUserStatus exposes calendarImportPromptPending', () => {
  const block = extractBlock(USERS_SRC, 'getCurrentUserStatus');
  it('declares and returns the computed flag via the shared helper', () => {
    expect(block).toContain('calendarImportPromptPending: v.boolean()');
    expect(block).toContain(
      'calendarImportPromptPending: isCalendarImportPromptPending(user)'
    );
  });
  it('keeps the existing fields (additive change)', () => {
    expect(block).toContain(
      'onboardingComplete: user.onboardingCompleted === true'
    );
    expect(block).toContain(
      'phoneMatchResolvedAt: user.phoneMatchResolvedAt ?? null'
    );
  });
});

describe('existing users are protected from re-onboarding [13]', () => {
  it('the required flag is written only by finishOnboarding (never by a user-facing backfill, Apple Review auth, or users.ts)', () => {
    expect(APPLE_SRC).not.toContain('calendarImportPromptRequiredAt');
    expect(USERS_SRC).not.toContain('calendarImportPromptRequiredAt');
    expect(GOOGLE_IMPORT_SRC).not.toContain('calendarImportPromptRequiredAt');
  });
});

describe('Google import backend is untouched by this feature', () => {
  it('importGoogleCalendar keeps its one-time lock and does not reference the onboarding gate', () => {
    expect(GOOGLE_IMPORT_SRC).not.toContain('calendarImportPrompt');
    expect(GOOGLE_IMPORT_SRC).toContain("provider: 'google'");
    expect(GOOGLE_IMPORT_SRC).toContain('alreadyCompleted: true as const');
  });
});

// ── Authenticated layout wiring ──────────────────────────────────────────────

describe('authenticated layout — Calendar gate', () => {
  it('evaluates the gate from server userStatus (cold-start safe), not AsyncStorage', () => {
    expect(LAYOUT).toContain('userStatus?.calendarImportPromptPending');
    expect(LAYOUT).toContain('shouldRedirectToCalendarImport(');
  });

  it('redirects with router.replace to the import screen, before the family-bootstrap nudge', () => {
    const calendarIdx = LAYOUT.indexOf('if (needsCalendarImportRedirect) {');
    const bootstrapIdx = LAYOUT.indexOf('if (needsFamilyBootstrapRedirect) {');
    expect(calendarIdx).toBeGreaterThan(-1);
    expect(bootstrapIdx).toBeGreaterThan(calendarIdx);
    const body = LAYOUT.slice(calendarIdx, bootstrapIdx);
    expect(body).toContain(
      "router.replace('/(authenticated)/import-calendar')"
    );
  });

  it('the calendar redirect runs BEFORE the mandatory-setup exit (so a finishing user lands on the Calendar step, not Home)', () => {
    const calendarIdx = LAYOUT.indexOf('if (needsCalendarImportRedirect) {');
    const exitIdx = LAYOUT.indexOf('if (needsMandatorySetupExitRedirect) {');
    expect(exitIdx).toBeGreaterThan(calendarIdx);
  });

  it('keeps the splash up (Home never renders) while the redirect is pending', () => {
    const splash = LAYOUT.match(
      /if \(\s*\n\s*!isReadyToRoute \|\|\s*\n\s*!isAuthenticated \|\|[\s\S]*?return <InYomiSplashScreen[\s\S]*?\/>;\s*\}/
    );
    expect(splash?.[0] ?? '').toContain('needsCalendarImportRedirect');
    // The exit redirect must NOT use the splash (Tabs must stay mounted for navigate).
    expect(splash?.[0] ?? '').not.toContain('needsCalendarImportExitRedirect');
  });

  it('leaves the import screen via router.navigate to Home — never router.back()', () => {
    const idx = LAYOUT.indexOf('if (needsCalendarImportExitRedirect) {');
    expect(idx).toBeGreaterThan(-1);
    const body = LAYOUT.slice(idx, idx + 220);
    expect(body).toContain("router.navigate('/(authenticated)')");
    expect(body).not.toContain('router.back');
    expect(body).toContain('wasCalendarOnboardingRef.current = false;');
  });

  it('both redirect flags are in the routing effect dependency array', () => {
    expect(LAYOUT).toMatch(
      /needsCalendarImportRedirect,\s*needsCalendarImportExitRedirect,\s*needsMandatorySetupExitRedirect,\s*router,\s*\]\);/
    );
  });

  it('does not move or redefine onboardingCompleted routing (decision tree untouched)', () => {
    expect(LAYOUT).toContain('resolvePostAuthOnboardingRoute({');
    expect(LAYOUT).not.toContain('calendarImportPromptPending: onboarding');
  });

  it('suppresses the optional family-bootstrap nudge while the step is pending (no bounce)', () => {
    expect(LAYOUT).toContain('calendarImportPromptPending !== true &&');
  });

  it('hides the tab bar for import-calendar only while pending; the route stays a plain hidden tab (no plan gating)', () => {
    expect(LAYOUT).toContain('name="import-calendar"');
    expect(LAYOUT).toContain('importCalendarOnboardingTabBarOptions');
    expect(LAYOUT).toMatch(
      /calendarImportPromptPending === true\s*\? \{ tabBarStyle: \{ display: 'none' as const \} \}\s*: \{\}/
    );
  });
});

// ── Import screen ────────────────────────────────────────────────────────────

describe('import-calendar screen — onboarding mode', () => {
  it('derives onboarding mode from the server flag (not a spoofable route param)', () => {
    expect(IMPORT_SCREEN).toContain(
      'userStatus?.calendarImportPromptPending === true'
    );
    expect(IMPORT_SCREEN).not.toContain('useLocalSearchParams');
  });

  it('resolves the step through the dedicated mutation', () => {
    expect(IMPORT_SCREEN).toContain(
      'api.onboarding.resolveCalendarImportPrompt'
    );
  });

  it('[F][E] Skip (header + intro) resolves the step and never calls the import mutation', () => {
    const idx = IMPORT_SCREEN.indexOf('const handleResolveCalendarStep');
    const end = IMPORT_SCREEN.indexOf('// Recovery:', idx);
    const handler = IMPORT_SCREEN.slice(idx, end);
    expect(handler).toContain('resolveCalendarPrompt({})');
    expect(handler).not.toContain('importMutation');
    expect(IMPORT_SCREEN).toContain('דלג');
  });

  it('shows the approved Hebrew intro copy', () => {
    expect(IMPORT_SCREEN).toContain('רוצים להתחיל עם היומן שכבר יש לכם?');
    expect(IMPORT_SCREEN).toContain(
      'אפשר להעתיק את האירועים מ־Google Calendar ולהתחיל כשכל מה שכבר תכננתם נמצא גם ב־InYomi. ההעתקה היא חד־פעמית, ואפשר לעשות אותה גם אחר כך דרך ההגדרות.'
    );
    expect(IMPORT_SCREEN).toContain('העתקת אירועים מ־Google');
  });

  it('never shows technical wording to the user', () => {
    const copyLines = IMPORT_SCREEN.split('\n')
      .filter((l) => /['"`>].*[א-ת]/.test(l))
      .join('\n');
    expect(copyLines).not.toMatch(/OAuth|gate|resolved|onboarding state/);
  });

  it('[10][11] already-imported in onboarding never asks to import again: auto-resolves on recovery', () => {
    expect(IMPORT_SCREEN).toContain(
      'if (!isStepPending || !importAlreadyCompleted) return;'
    );
    expect(IMPORT_SCREEN).toContain('if (importAttemptedRef.current) return;');
    expect(IMPORT_SCREEN).toContain(
      'alreadyImported?.completed === true && isOnboardingMode'
    );
  });

  it('[7][8][9] failure / denied / empty states always offer a way to continue without import', () => {
    // Denied/error view, calendar list empty/error, no events, import error.
    expect(
      IMPORT_SCREEN.split('<OnboardingContinueLink').length - 1
    ).toBeGreaterThanOrEqual(4);
    expect(IMPORT_SCREEN).toContain(
      "listStatus === 'empty' || listStatus === 'error'"
    );
  });

  it('a failed resolve is surfaced (never a false success) and is retryable', () => {
    expect(IMPORT_SCREEN).toContain('setResolveError(');
    expect(IMPORT_SCREEN).toContain('לא הצלחנו להמשיך כרגע. אפשר לנסות שוב.');
  });

  it('onboarding completion never uses router.back(); only the non-onboarding paths do', () => {
    const idx = IMPORT_SCREEN.indexOf('const handleResolveCalendarStep');
    const end = IMPORT_SCREEN.indexOf('// Recovery:', idx);
    expect(IMPORT_SCREEN.slice(idx, end)).not.toContain('router.');
    // Header back is replaced by a spacer in onboarding mode.
    expect(IMPORT_SCREEN).toContain(
      '{isOnboardingMode ? (\n          <View style={s.headerSide} />'
    );
  });

  it('the Settings/Home flow keeps its existing completed-state early return, back button and success CTA', () => {
    expect(IMPORT_SCREEN).toContain('alreadyImported?.completed === true');
    expect(IMPORT_SCREEN).toContain(
      "accessibilityLabel={isOnboardingMode ? 'המשך אל InYomi' : 'סיום'}"
    );
    expect(IMPORT_SCREEN).toContain(': () => router.back()');
  });

  it('import pipeline is unchanged: same mutation, same holiday persistence', () => {
    expect(IMPORT_SCREEN).toContain(
      'await importMutation({ events: eventsToImport });'
    );
    expect(IMPORT_SCREEN).toContain('persistHolidaySelection()');
  });
});

describe('[19] cold start — startup destination readiness', () => {
  it('the import screen reports startup readiness only in onboarding mode (so a pending cold start never waits for the emergency splash timer)', () => {
    expect(IMPORT_SCREEN).toContain("'calendar-import-onboarding'");
    expect(IMPORT_SCREEN).toContain('enabled: isOnboardingMode');
    expect(IMPORT_SCREEN).toContain('onLayout={onDestinationLayout}');
  });
});

describe('[14][15] existing entry points unchanged', () => {
  it('Settings row and Home empty-state CTA still push the same import route', () => {
    expect(PROFILE_SRC).toContain(
      "router.push('/(authenticated)/import-calendar')"
    );
    expect(HOME_SRC).toContain(
      "router.push('/(authenticated)/import-calendar')"
    );
  });

  it('does not add the deferred Home "copy events" CTA or welcome-notice changes', () => {
    expect(HOME_SRC).not.toContain('calendarImportPrompt');
  });
});
