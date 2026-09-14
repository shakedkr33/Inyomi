// ============================================================================
// onboardingAnswers.ts — Stage 2A pure helper for persistOnboardingAnswers
// ============================================================================
//
// Decides which fields (if any) the persistOnboardingAnswers mutation
// (convex/onboarding.ts) should write to the users record. Each field has
// an INDEPENDENT "only write if the server doesn't already have a value"
// guard — this prevents a stale pre-auth draft from ever overwriting an
// answer the server already has, while still allowing a field the server is
// missing to be filled in even when the other field is already set (e.g.
// only onboardingChallenges is missing while onboardingIntent already
// exists on the server).
//
// This mutation is USERS-ONLY (Stage 2A foundation). It must never be
// extended to write to spaces, members, defaultSpaceId, or
// onboardingCompleted — see convex/onboarding.ts (persistOnboardingAnswers)
// doc comment and the Stage 2A/2B+3 plan.
// ============================================================================

/** Exact Q1 UI values — see app/onboarding-step1.tsx. */
export const ONBOARDING_INTENT_VALUES = [
  'personal',
  'couple',
  'family',
] as const;
export type OnboardingIntent = (typeof ONBOARDING_INTENT_VALUES)[number];

/** Exact Q2 UI values — see app/onboarding-step2.tsx `challenges[].id`. */
export const ONBOARDING_CHALLENGE_VALUES = [
  'incoming_from_everywhere',
  'remember_tasks_and_appointments',
  'shared_schedule_coordination',
  'everything_in_one_place',
] as const;
export type OnboardingChallenge = (typeof ONBOARDING_CHALLENGE_VALUES)[number];

export interface OnboardingAnswersServerState {
  /** undefined = server has no answer yet for this field. */
  onboardingIntent: OnboardingIntent | undefined;
  onboardingChallenges: OnboardingChallenge[] | undefined;
}

export interface OnboardingAnswersRequest {
  onboardingIntent?: OnboardingIntent;
  onboardingChallenges?: OnboardingChallenge[];
}

export interface OnboardingAnswersPatch {
  onboardingIntent?: OnboardingIntent;
  onboardingChallenges?: OnboardingChallenge[];
}

/**
 * Pure decision logic for persistOnboardingAnswers.
 *
 * Each field is written IF AND ONLY IF:
 *   - the server does not already have a value for that field, AND
 *   - a value for that field was included in the request.
 *
 * The two fields are evaluated completely independently — an existing
 * onboardingIntent on the server never blocks a missing onboardingChallenges
 * from being written, and vice versa. This is intentional: a stale draft
 * replay must never overwrite an existing answer, but a genuinely missing
 * field must still be fillable.
 *
 * Returns an empty object (no-op patch) when neither field needs writing.
 */
export function buildOnboardingAnswersPatch(
  server: OnboardingAnswersServerState,
  request: OnboardingAnswersRequest
): OnboardingAnswersPatch {
  const patch: OnboardingAnswersPatch = {};

  if (
    server.onboardingIntent === undefined &&
    request.onboardingIntent !== undefined
  ) {
    patch.onboardingIntent = request.onboardingIntent;
  }

  if (
    server.onboardingChallenges === undefined &&
    request.onboardingChallenges !== undefined
  ) {
    patch.onboardingChallenges = request.onboardingChallenges;
  }

  return patch;
}
