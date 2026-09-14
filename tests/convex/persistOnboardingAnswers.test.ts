/**
 * Stage 2A — persistOnboardingAnswers (convex/onboarding.ts)
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/eventTaskRsvpDecoupling.test.ts's documented precedent).
 * Given that constraint:
 *
 *   - The independent-field-guard decision logic
 *     (buildOnboardingAnswersPatch, lib/onboardingAnswers.ts) is pure and
 *     fully covered here via direct behavioral tests (items 1-8).
 *   - Invariants that require inspecting the actual shipped mutation body
 *     (no writes to spaces/members/onboardingCompleted/defaultSpaceId, no
 *     calls to finishOnboarding/matchOnPhone, unauthenticated rejection,
 *     controlled-literal validators) are verified via source inspection of
 *     the REAL convex/onboarding.ts file (items 9-15) — the same pattern
 *     used in tests/convex/eventTaskRsvpDecoupling.test.ts.
 *
 * Run with: bun test tests/convex/persistOnboardingAnswers.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildOnboardingAnswersPatch,
  type OnboardingAnswersServerState,
} from '../../lib/onboardingAnswers';

const NO_SERVER_STATE: OnboardingAnswersServerState = {
  onboardingIntent: undefined,
  onboardingChallenges: undefined,
};

describe('buildOnboardingAnswersPatch — field persistence [TEST 1-5]', () => {
  it('[1] persists a valid onboardingIntent when server has none', () => {
    const patch = buildOnboardingAnswersPatch(NO_SERVER_STATE, {
      onboardingIntent: 'family',
    });
    expect(patch).toEqual({ onboardingIntent: 'family' });
  });

  it('[2] persists valid onboardingChallenges when server has none', () => {
    const patch = buildOnboardingAnswersPatch(NO_SERVER_STATE, {
      onboardingChallenges: ['everything_in_one_place'],
    });
    expect(patch).toEqual({
      onboardingChallenges: ['everything_in_one_place'],
    });
  });

  it('[3] persists both fields together when server has neither', () => {
    const patch = buildOnboardingAnswersPatch(NO_SERVER_STATE, {
      onboardingIntent: 'couple',
      onboardingChallenges: ['shared_schedule_coordination'],
    });
    expect(patch).toEqual({
      onboardingIntent: 'couple',
      onboardingChallenges: ['shared_schedule_coordination'],
    });
  });

  it('[4] partial: intent only in request → only intent in patch', () => {
    const patch = buildOnboardingAnswersPatch(NO_SERVER_STATE, {
      onboardingIntent: 'personal',
    });
    expect(patch).toEqual({ onboardingIntent: 'personal' });
    expect(patch.onboardingChallenges).toBeUndefined();
  });

  it('[5] partial: challenges only in request → only challenges in patch', () => {
    const patch = buildOnboardingAnswersPatch(NO_SERVER_STATE, {
      onboardingChallenges: ['remember_tasks_and_appointments'],
    });
    expect(patch).toEqual({
      onboardingChallenges: ['remember_tasks_and_appointments'],
    });
    expect(patch.onboardingIntent).toBeUndefined();
  });
});

describe('buildOnboardingAnswersPatch — independent field guards [TEST 6-8]', () => {
  it('[6] server intent exists, challenges undefined, request has both → intent preserved (not patched), challenges written', () => {
    const patch = buildOnboardingAnswersPatch(
      {
        onboardingIntent: 'family',
        onboardingChallenges: undefined,
      },
      {
        onboardingIntent: 'personal', // stale/different draft value — must be ignored
        onboardingChallenges: ['incoming_from_everywhere'],
      }
    );
    expect(patch.onboardingIntent).toBeUndefined();
    expect(patch.onboardingChallenges).toEqual(['incoming_from_everywhere']);
  });

  it('[7] reverse: server challenges exist, intent undefined, request has both → challenges preserved (not patched), intent written', () => {
    const patch = buildOnboardingAnswersPatch(
      {
        onboardingIntent: undefined,
        onboardingChallenges: ['everything_in_one_place'],
      },
      {
        onboardingIntent: 'couple',
        onboardingChallenges: ['shared_schedule_coordination'], // stale — must be ignored
      }
    );
    expect(patch.onboardingChallenges).toBeUndefined();
    expect(patch.onboardingIntent).toBe('couple');
  });

  it('[8] repeated call with both fields already on server → no-op patch (never overwrites existing values)', () => {
    const patch = buildOnboardingAnswersPatch(
      {
        onboardingIntent: 'family',
        onboardingChallenges: ['everything_in_one_place'],
      },
      {
        onboardingIntent: 'personal',
        onboardingChallenges: ['incoming_from_everywhere'],
      }
    );
    expect(patch).toEqual({});
  });

  it('neither field provided in request → no-op patch regardless of server state', () => {
    const patch = buildOnboardingAnswersPatch(NO_SERVER_STATE, {});
    expect(patch).toEqual({});
  });
});

// ── Source-inspection coverage for invariants that require the real handler ──
const ONBOARDING_SOURCE = readFileSync(
  new URL('../../convex/onboarding.ts', import.meta.url),
  'utf8'
);

function extractExportBlock(source: string, exportName: string): string {
  const startMarker = `export const ${exportName} = `;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find export "${exportName}" in source`);
  }
  const afterStart = startIdx + startMarker.length;
  const nextExportMatch = /export const \w+ = (mutation|query)\(\{/.exec(
    source.slice(afterStart)
  );
  const endIdx =
    nextExportMatch === null
      ? source.length
      : afterStart + nextExportMatch.index;
  return source.slice(startIdx, endIdx);
}

const persistOnboardingAnswersSrc = extractExportBlock(
  ONBOARDING_SOURCE,
  'persistOnboardingAnswers'
);
const finishOnboardingSrc = extractExportBlock(
  ONBOARDING_SOURCE,
  'finishOnboarding'
);

describe('persistOnboardingAnswers — scope invariants (source inspection) [TEST 9-14]', () => {
  it('[9,10] args use controlled literal unions (exact Q1/Q2 values), not free-form strings', () => {
    expect(persistOnboardingAnswersSrc).toContain("v.literal('personal')");
    expect(persistOnboardingAnswersSrc).toContain("v.literal('couple')");
    expect(persistOnboardingAnswersSrc).toContain("v.literal('family')");
    expect(persistOnboardingAnswersSrc).toContain(
      "v.literal('incoming_from_everywhere')"
    );
    expect(persistOnboardingAnswersSrc).toContain(
      "v.literal('remember_tasks_and_appointments')"
    );
    expect(persistOnboardingAnswersSrc).toContain(
      "v.literal('shared_schedule_coordination')"
    );
    expect(persistOnboardingAnswersSrc).toContain(
      "v.literal('everything_in_one_place')"
    );
    // Must NOT accept the legacy/placeholder 'business' literal for intent.
    expect(persistOnboardingAnswersSrc).not.toContain("v.literal('business')");
  });

  it('[11] never writes to the spaces table', () => {
    expect(persistOnboardingAnswersSrc).not.toContain("ctx.db.insert('spaces'");
    expect(persistOnboardingAnswersSrc).not.toContain("ctx.db.patch('spaces'");
    expect(persistOnboardingAnswersSrc).not.toContain(
      'onboardingChallenges: args.challenges'
    );
  });

  it('[12] never sets onboardingCompleted', () => {
    expect(persistOnboardingAnswersSrc).not.toContain('onboardingCompleted');
  });

  it('[13] never sets defaultSpaceId', () => {
    expect(persistOnboardingAnswersSrc).not.toContain('defaultSpaceId');
  });

  it('[14] never inserts into the members table (no access/entity rows)', () => {
    expect(persistOnboardingAnswersSrc).not.toContain(
      "ctx.db.insert('members'"
    );
  });

  it('never calls finishOnboarding or matchOnPhone (no dual-write, no side effects)', () => {
    expect(persistOnboardingAnswersSrc).not.toContain('finishOnboarding');
    expect(persistOnboardingAnswersSrc).not.toContain('matchOnPhone');
  });

  it('is USERS-ONLY: only patches the users table via ctx.db.patch(userId, patch)', () => {
    expect(persistOnboardingAnswersSrc).toContain(
      'ctx.db.patch(userId, patch)'
    );
  });
});

describe('persistOnboardingAnswers — unauthenticated caller [TEST 15]', () => {
  it('throws (matches the existing finishOnboarding mutation convention) when unauthenticated', () => {
    expect(persistOnboardingAnswersSrc).toContain(
      'const userId = await getAuthUserId(ctx);'
    );
    expect(persistOnboardingAnswersSrc).toContain('if (!userId) {');
    expect(persistOnboardingAnswersSrc).toContain('throw new Error(');
  });
});

// finishOnboarding's extracted block (per extractExportBlock's documented
// slicing rule) runs up to the next `export const ... = (mutation|query)({`
// declaration, which includes persistOnboardingAnswers' own leading doc
// comment (which legitimately mentions "onboardingIntent" in prose). Strip
// that trailing doc comment so the assertions below only inspect
// finishOnboarding's own args/handler body.
const finishOnboardingOwnBody = finishOnboardingSrc.slice(
  0,
  finishOnboardingSrc.indexOf('// ── persistOnboardingAnswers')
);

describe('finishOnboarding — untouched by Stage 2A (regression guard)', () => {
  it('does not write onboardingIntent/onboardingChallenges fields or call buildOnboardingAnswersPatch', () => {
    expect(finishOnboardingOwnBody).not.toContain('onboardingIntent');
    expect(finishOnboardingOwnBody).not.toContain(
      'buildOnboardingAnswersPatch'
    );
    // finishOnboarding legitimately still writes the legacy
    // spaces.onboardingChallenges field from args.challenges — only assert
    // no NEW users.onboardingChallenges write was introduced there.
    expect(finishOnboardingOwnBody).not.toContain(
      'onboardingChallenges: args.onboardingChallenges'
    );
  });

  it('still creates a space, admin access row, and sets onboardingCompleted/defaultSpaceId exactly as before', () => {
    expect(finishOnboardingOwnBody).toContain("ctx.db.insert('spaces'");
    expect(finishOnboardingOwnBody).toContain("kind: 'access'");
    expect(finishOnboardingOwnBody).toContain('onboardingCompleted: true');
    expect(finishOnboardingOwnBody).toContain('defaultSpaceId: spaceId');
  });
});
