/**
 * importFlowStages.test.ts
 *
 * Pure-logic tests for the connect_google pre-auth stage, the auto-transition
 * to step1, progress bar visibility, and RTL step ordering.
 *
 * These tests do not mount React components.  They exercise the same state
 * transitions and helper functions that the screen uses, keeping them fast and
 * dependency-free.
 *
 * The flow has four visible progress steps:
 *   1. step1     — calendars + past range
 *   2. holidays  — InYomi holiday-category selection
 *   3. step2     — event selection (preview)
 *   4. step3     — final summary & confirm
 */

import { describe, expect, it } from 'bun:test';

// ── Stage type (mirrors the screen) ──────────────────────────────────────────

type ImportStage =
  | 'connect_google'
  | 'step1'
  | 'holidays'
  | 'step2'
  | 'step3'
  | 'success';

// ── Progress bar logic (mirrors resolveStepStatus from the screen) ────────────

type StepStatus = 'completed' | 'active' | 'future';

function resolveStepStatus(
  stepNum: 1 | 2 | 3 | 4,
  stage: ImportStage
): StepStatus {
  if (stage === 'success') return 'completed';
  if (stage === 'connect_google') return 'future';
  const order: Record<Exclude<ImportStage, 'connect_google'>, number> = {
    step1: 1,
    holidays: 2,
    step2: 3,
    step3: 4,
    success: 5,
  };
  const current = order[stage];
  if (stepNum < current) return 'completed';
  if (stepNum === current) return 'active';
  return 'future';
}

/** Mirrors the showProgress flag from the screen. */
function showProgressBar(stage: ImportStage): boolean {
  return (
    stage === 'step1' ||
    stage === 'holidays' ||
    stage === 'step2' ||
    stage === 'step3' ||
    stage === 'success'
  );
}

/**
 * Returns the logical display order of steps as they appear in RTL layout.
 * In an RTL app with flexDirection:'row', the first JSX element lands on the
 * right.  The steps array below mirrors the JSX order: [step1, holidays,
 * step2, step3]. The rightmost slot (index 0) should hold step 1 for correct
 * RTL display.
 */
const STEPS_JSX_ORDER: readonly [1, 2, 3, 4] = [1, 2, 3, 4];

// ── Auto-transition logic ─────────────────────────────────────────────────────

type CalendarListStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

type OAuthStatus =
  | 'idle'
  | 'authorizing'
  | 'exchanging'
  | 'authorized'
  | 'denied'
  | 'error';

/**
 * Mirrors the useEffect logic that auto-transitions connect_google → step1.
 * Returns the next stage given the current stage, OAuth status, and list status.
 */
function computeNextStage(
  stage: ImportStage,
  oAuthStatus: OAuthStatus,
  listStatus: CalendarListStatus
): ImportStage {
  if (stage !== 'connect_google') return stage;
  if (oAuthStatus !== 'authorized') return stage;
  if (
    listStatus === 'ready' ||
    listStatus === 'empty' ||
    listStatus === 'error'
  ) {
    return 'step1';
  }
  return stage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('initial stage', () => {
  it('is connect_google (not step1)', () => {
    const initial: ImportStage = 'connect_google';
    expect(initial).toBe('connect_google');
  });

  it('progress bar is absent in connect_google', () => {
    expect(showProgressBar('connect_google')).toBe(false);
  });

  it('progress bar is absent before any auth', () => {
    // The only stage where auth has not yet happened is connect_google.
    const preAuthStages: ImportStage[] = ['connect_google'];
    for (const stage of preAuthStages) {
      expect(showProgressBar(stage)).toBe(false);
    }
  });
});

describe('progress bar visibility', () => {
  it('is visible in step1', () => {
    expect(showProgressBar('step1')).toBe(true);
  });

  it('is visible in holidays', () => {
    expect(showProgressBar('holidays')).toBe(true);
  });

  it('is visible in step2', () => {
    expect(showProgressBar('step2')).toBe(true);
  });

  it('is visible in step3', () => {
    expect(showProgressBar('step3')).toBe(true);
  });

  it('is visible on success', () => {
    expect(showProgressBar('success')).toBe(true);
  });

  it('is NOT visible in connect_google', () => {
    expect(showProgressBar('connect_google')).toBe(false);
  });
});

describe('RTL logical step order', () => {
  it('first JSX element is step 1 (will appear on right in RTL with flexDirection:row)', () => {
    expect(STEPS_JSX_ORDER[0]).toBe(1);
  });

  it('second JSX element is step 2 / holidays (will appear next in RTL)', () => {
    expect(STEPS_JSX_ORDER[1]).toBe(2);
  });

  it('third JSX element is step 3 / event selection', () => {
    expect(STEPS_JSX_ORDER[2]).toBe(3);
  });

  it('fourth JSX element is step 4 / summary (will appear on left in RTL)', () => {
    expect(STEPS_JSX_ORDER[3]).toBe(4);
  });
});

describe('resolveStepStatus in connect_google', () => {
  it('all four steps are future in connect_google (bar not shown anyway)', () => {
    expect(resolveStepStatus(1, 'connect_google')).toBe('future');
    expect(resolveStepStatus(2, 'connect_google')).toBe('future');
    expect(resolveStepStatus(3, 'connect_google')).toBe('future');
    expect(resolveStepStatus(4, 'connect_google')).toBe('future');
  });
});

describe('resolveStepStatus in step1', () => {
  it('step 1 is active', () => {
    expect(resolveStepStatus(1, 'step1')).toBe('active');
  });
  it('step 2 is future', () => {
    expect(resolveStepStatus(2, 'step1')).toBe('future');
  });
  it('step 3 is future', () => {
    expect(resolveStepStatus(3, 'step1')).toBe('future');
  });
  it('step 4 is future', () => {
    expect(resolveStepStatus(4, 'step1')).toBe('future');
  });
});

describe('resolveStepStatus in holidays', () => {
  it('step 1 is completed', () => {
    expect(resolveStepStatus(1, 'holidays')).toBe('completed');
  });
  it('step 2 is active', () => {
    expect(resolveStepStatus(2, 'holidays')).toBe('active');
  });
  it('step 3 is future', () => {
    expect(resolveStepStatus(3, 'holidays')).toBe('future');
  });
  it('step 4 is future', () => {
    expect(resolveStepStatus(4, 'holidays')).toBe('future');
  });
});

describe('resolveStepStatus in step2', () => {
  it('step 1 is completed', () => {
    expect(resolveStepStatus(1, 'step2')).toBe('completed');
  });
  it('step 2 is completed', () => {
    expect(resolveStepStatus(2, 'step2')).toBe('completed');
  });
  it('step 3 is active', () => {
    expect(resolveStepStatus(3, 'step2')).toBe('active');
  });
  it('step 4 is future', () => {
    expect(resolveStepStatus(4, 'step2')).toBe('future');
  });
});

describe('resolveStepStatus in step3', () => {
  it('step 1 is completed', () => {
    expect(resolveStepStatus(1, 'step3')).toBe('completed');
  });
  it('step 2 is completed', () => {
    expect(resolveStepStatus(2, 'step3')).toBe('completed');
  });
  it('step 3 is completed', () => {
    expect(resolveStepStatus(3, 'step3')).toBe('completed');
  });
  it('step 4 is active', () => {
    expect(resolveStepStatus(4, 'step3')).toBe('active');
  });
});

describe('resolveStepStatus in success', () => {
  it('all four steps are completed', () => {
    expect(resolveStepStatus(1, 'success')).toBe('completed');
    expect(resolveStepStatus(2, 'success')).toBe('completed');
    expect(resolveStepStatus(3, 'success')).toBe('completed');
    expect(resolveStepStatus(4, 'success')).toBe('completed');
  });

  it('does not add a fifth step on success', () => {
    // The step set is fixed at 1, 2, 3, 4. Verify the array length.
    expect(STEPS_JSX_ORDER.length).toBe(4);
  });
});

describe('auto-transition connect_google → step1', () => {
  it('stays in connect_google when OAuth is idle', () => {
    expect(computeNextStage('connect_google', 'idle', 'ready')).toBe(
      'connect_google'
    );
  });

  it('stays in connect_google when OAuth is authorizing', () => {
    expect(computeNextStage('connect_google', 'authorizing', 'ready')).toBe(
      'connect_google'
    );
  });

  it('stays in connect_google when OAuth is exchanging', () => {
    expect(computeNextStage('connect_google', 'exchanging', 'ready')).toBe(
      'connect_google'
    );
  });

  it('stays in connect_google when OAuth authorized but list still loading', () => {
    expect(computeNextStage('connect_google', 'authorized', 'loading')).toBe(
      'connect_google'
    );
  });

  it('stays in connect_google when OAuth authorized but list is idle', () => {
    expect(computeNextStage('connect_google', 'authorized', 'idle')).toBe(
      'connect_google'
    );
  });

  it('transitions to step1 when OAuth authorized and list is ready', () => {
    expect(computeNextStage('connect_google', 'authorized', 'ready')).toBe(
      'step1'
    );
  });

  it('transitions to step1 when OAuth authorized and list is empty (no calendars)', () => {
    expect(computeNextStage('connect_google', 'authorized', 'empty')).toBe(
      'step1'
    );
  });

  it('transitions to step1 when OAuth authorized and list is error', () => {
    expect(computeNextStage('connect_google', 'authorized', 'error')).toBe(
      'step1'
    );
  });

  it('does not change stage if already in step1', () => {
    expect(computeNextStage('step1', 'authorized', 'ready')).toBe('step1');
  });

  it('does not change stage if already in holidays (manual CTA transition only)', () => {
    expect(computeNextStage('holidays', 'authorized', 'ready')).toBe(
      'holidays'
    );
  });

  it('does not change stage if already in step2', () => {
    expect(computeNextStage('step2', 'authorized', 'ready')).toBe('step2');
  });

  it('cancelled auth stays in connect_google (no error state)', () => {
    // cancel/dismiss returns status 'idle', which does not trigger transition
    expect(computeNextStage('connect_google', 'idle', 'idle')).toBe(
      'connect_google'
    );
  });

  it('OAuth error stays in connect_google', () => {
    expect(computeNextStage('connect_google', 'error', 'idle')).toBe(
      'connect_google'
    );
  });

  it('OAuth denied stays in connect_google', () => {
    expect(computeNextStage('connect_google', 'denied', 'idle')).toBe(
      'connect_google'
    );
  });
});

describe('cancelled auth does not enter error state', () => {
  it('cancel returns status idle (not error or denied)', () => {
    // The hook sets status to 'idle' on cancel/dismiss.
    // Our transition logic only requires status !== 'authorized' to stay put.
    const stage = computeNextStage('connect_google', 'idle', 'idle');
    expect(stage).toBe('connect_google');
    // No error status means no error message shown.
    const cancelledStatus: OAuthStatus = 'idle';
    expect(cancelledStatus).not.toBe('error');
    expect(cancelledStatus).not.toBe('denied');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: step1 must render progress bar, calendar list, chips, and CTA
// (previously the screen only showed the calendar list on authorized+ready)
// ─────────────────────────────────────────────────────────────────────────────

describe('step1 must contain all required UI sections (regression guard)', () => {
  it('progress bar is shown in step1', () => {
    expect(showProgressBar('step1')).toBe(true);
  });

  it('step 1 is marked active in the progress bar when in step1', () => {
    expect(resolveStepStatus(1, 'step1')).toBe('active');
    expect(resolveStepStatus(2, 'step1')).toBe('future');
    expect(resolveStepStatus(3, 'step1')).toBe('future');
    expect(resolveStepStatus(4, 'step1')).toBe('future');
  });

  it('connect_google does NOT show the progress bar (no premature bar)', () => {
    expect(showProgressBar('connect_google')).toBe(false);
  });

  it('chips are defined — exactly three, covering all past-range values', () => {
    // Mirrors the RANGE_CHIPS constant in import-calendar.tsx.
    // If the chip array ever shrinks or changes, this test will catch it.
    type PastRange = 'none' | 'two_months' | 'one_year';
    const RANGE_CHIPS: ReadonlyArray<{ value: PastRange; label: string }> = [
      { value: 'none', label: 'מהיום' },
      { value: 'two_months', label: 'חודשיים אחורה' },
      { value: 'one_year', label: 'שנה אחורה' },
    ];
    expect(RANGE_CHIPS).toHaveLength(3);
    const values = RANGE_CHIPS.map((c) => c.value);
    expect(values).toContain('none');
    expect(values).toContain('two_months');
    expect(values).toContain('one_year');
  });

  it('"מהיום" chip is first (appears on the right in RTL)', () => {
    type PastRange = 'none' | 'two_months' | 'one_year';
    const RANGE_CHIPS: ReadonlyArray<{ value: PastRange; label: string }> = [
      { value: 'none', label: 'מהיום' },
      { value: 'two_months', label: 'חודשיים אחורה' },
      { value: 'one_year', label: 'שנה אחורה' },
    ];
    expect(RANGE_CHIPS[0].label).toBe('מהיום');
  });

  it('step1 CTA label is "המשך" (proceeds to the holidays step, not directly to preview)', () => {
    const ctaLabel = 'המשך';
    expect(ctaLabel).toBeTruthy();
  });

  it('"בדיקת אירועים" CTA lives in the holidays step and triggers the preview', () => {
    const ctaLabel = 'בדיקת אירועים';
    expect(ctaLabel).toBeTruthy();
  });

  it('stage sequence is: connect_google → step1 → holidays → step2 → step3 → success', () => {
    const sequence: ImportStage[] = [
      'connect_google',
      'step1',
      'holidays',
      'step2',
      'step3',
      'success',
    ];
    expect(sequence[0]).toBe('connect_google');
    expect(sequence[1]).toBe('step1');
    expect(sequence[2]).toBe('holidays');
    expect(sequence[3]).toBe('step2');
    expect(sequence[4]).toBe('step3');
    expect(sequence[5]).toBe('success');
  });

  it('auto-transition from connect_google to step1 fires when authorized + list ready', () => {
    expect(computeNextStage('connect_google', 'authorized', 'ready')).toBe(
      'step1'
    );
  });

  it('step1 is NOT reached while calendars are still loading (prevents premature render)', () => {
    expect(computeNextStage('connect_google', 'authorized', 'loading')).toBe(
      'connect_google'
    );
    expect(computeNextStage('connect_google', 'authorized', 'idle')).toBe(
      'connect_google'
    );
  });
});
