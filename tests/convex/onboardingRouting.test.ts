/**
 * Stage 2B+3 — resolvePostAuthOnboardingRoute (lib/onboardingRouting.ts)
 *
 * Pure decision-tree tests for the authenticated layout's post-auth
 * onboarding routing. See lib/onboardingRouting.ts's doc comment for the
 * full locked product flow this implements.
 *
 * Run with: bun test tests/convex/onboardingRouting.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { resolvePostAuthOnboardingRoute } from '../../lib/onboardingRouting';

function baseInput() {
  return {
    onboardingComplete: false as boolean | undefined,
    hasLocalOnboardingAnswers: false,
    answersPersisted: false,
    phoneMatchResolvedAt: null as number | null | undefined,
    pendingMatches: undefined as unknown[] | undefined,
  };
}

describe('resolvePostAuthOnboardingRoute — loading + completed', () => {
  it('userStatus still loading (onboardingComplete undefined) → wait', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: undefined,
    });
    expect(result).toBe('wait');
  });

  it('completed user → normal routing (existing behavior, untouched)', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: true,
    });
    expect(result).toBe('normal');
  });
});

describe('resolvePostAuthOnboardingRoute — incomplete, no answers yet', () => {
  it('incomplete + no local Q1/Q2 answers → onboarding-questions', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: false,
      hasLocalOnboardingAnswers: false,
    });
    expect(result).toBe('onboarding-questions');
  });
});

describe('resolvePostAuthOnboardingRoute — incomplete, answers pending persistence', () => {
  it('incomplete + local answers exist but not yet persisted → wait (never mandatory-profile-setup)', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: false,
    });
    expect(result).toBe('wait');
  });
});

describe('resolvePostAuthOnboardingRoute — phoneMatchResolvedAt short-circuit', () => {
  it('phoneMatchResolvedAt already set → mandatory-profile-setup, even if pendingMatches is still loading', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: true,
      phoneMatchResolvedAt: 1_700_000_000_000,
      pendingMatches: undefined,
    });
    expect(result).toBe('mandatory-profile-setup');
  });
});

describe('resolvePostAuthOnboardingRoute — pending phone match query loading vs empty', () => {
  it('answers persisted, no phone-match decision yet, query STILL LOADING (undefined) → wait, NOT profile setup', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: true,
      phoneMatchResolvedAt: null,
      pendingMatches: undefined,
    });
    expect(result).toBe('wait');
  });

  it('query resolved with 1+ matches → phone-match-confirmation', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: true,
      phoneMatchResolvedAt: null,
      pendingMatches: [{ memberId: 'm1' }],
    });
    expect(result).toBe('phone-match-confirmation');
  });

  it('query resolved with 2+ matches → phone-match-confirmation (multiple matches supported)', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: true,
      phoneMatchResolvedAt: null,
      pendingMatches: [{ memberId: 'm1' }, { memberId: 'm2' }],
    });
    expect(result).toBe('phone-match-confirmation');
  });

  it('query resolved with an EMPTY array (not undefined) → mandatory-profile-setup', () => {
    const result = resolvePostAuthOnboardingRoute({
      ...baseInput(),
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: true,
      phoneMatchResolvedAt: null,
      pendingMatches: [],
    });
    expect(result).toBe('mandatory-profile-setup');
  });
});

describe('resolvePostAuthOnboardingRoute — HOME MUST NEVER BE REACHED WHILE onboardingCompleted === false', () => {
  it('no branch of the incomplete-onboarding decision tree ever returns "normal"', () => {
    const incompleteScenarios: Array<
      Parameters<typeof resolvePostAuthOnboardingRoute>[0]
    > = [
      {
        ...baseInput(),
        onboardingComplete: false,
        hasLocalOnboardingAnswers: false,
      },
      {
        ...baseInput(),
        onboardingComplete: false,
        hasLocalOnboardingAnswers: true,
        answersPersisted: false,
      },
      {
        ...baseInput(),
        onboardingComplete: false,
        hasLocalOnboardingAnswers: true,
        answersPersisted: true,
        phoneMatchResolvedAt: null,
        pendingMatches: undefined,
      },
      {
        ...baseInput(),
        onboardingComplete: false,
        hasLocalOnboardingAnswers: true,
        answersPersisted: true,
        phoneMatchResolvedAt: null,
        pendingMatches: [],
      },
      {
        ...baseInput(),
        onboardingComplete: false,
        hasLocalOnboardingAnswers: true,
        answersPersisted: true,
        phoneMatchResolvedAt: null,
        pendingMatches: [{ memberId: 'm1' }],
      },
      {
        ...baseInput(),
        onboardingComplete: false,
        hasLocalOnboardingAnswers: true,
        answersPersisted: true,
        phoneMatchResolvedAt: 123,
      },
    ];

    for (const scenario of incompleteScenarios) {
      expect(resolvePostAuthOnboardingRoute(scenario)).not.toBe('normal');
    }
  });
});

describe('resolvePostAuthOnboardingRoute — stale draft cannot bypass completion', () => {
  it('even with local answers + persisted + no phone match decision + no pending matches, the decision is mandatory-profile-setup, never "normal"', () => {
    // Simulates a stale locally-cached draft from a previous incomplete
    // session — the server's onboardingComplete flag (false here) is always
    // authoritative, never the presence of local answers.
    const result = resolvePostAuthOnboardingRoute({
      onboardingComplete: false,
      hasLocalOnboardingAnswers: true,
      answersPersisted: true,
      phoneMatchResolvedAt: null,
      pendingMatches: [],
    });
    expect(result).toBe('mandatory-profile-setup');
  });
});
