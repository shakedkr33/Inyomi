// ============================================================================
// onboardingRouting.ts — Stage 2B+3 pure helper
// ============================================================================
//
// Pure decision logic for the authenticated layout's post-auth onboarding
// routing (app/(authenticated)/_layout.tsx). Extracted so the routing
// contract is unit-testable without rendering the layout or mocking Convex
// hooks.
//
// LOCKED PRODUCT FLOW (see AGENTS.md / Stage 2B+3 plan):
//   1. onboardingCompleted === true            → 'normal' (existing routing)
//   2. onboarding incomplete + no Q1/Q2 yet     → 'onboarding-questions'
//   3. onboarding incomplete + Q1/Q2 available  → persist answers first,
//      then resolve phone matches
//   4. pending phone match(es), not resolved    → 'phone-match-confirmation'
//   5/6/7. accepted / declined / no match       → 'mandatory-profile-setup'
//
// HOME MUST NEVER BE REACHED WHILE onboardingCompleted === false — this
// function never returns a "go home" decision for the incomplete branch;
// the caller's existing normal routing only runs for 'normal'.
//
// A loading query (undefined) is NEVER interpreted as "no matches" ([]) —
// see the `pendingMatches === undefined` check below, which is completely
// distinct from `pendingMatches.length === 0`.
// ============================================================================

export type PostAuthOnboardingDecision =
  | 'wait'
  | 'normal'
  | 'onboarding-questions'
  | 'phone-match-confirmation'
  | 'mandatory-profile-setup';

export interface ResolvePostAuthOnboardingRouteInput {
  /** undefined = userStatus query still loading. */
  onboardingComplete: boolean | undefined;
  /** True if the user has answered Q1/Q2 locally (in-memory or restored draft). */
  hasLocalOnboardingAnswers: boolean;
  /** True once persistOnboardingAnswers has succeeded for this local answer set. */
  answersPersisted: boolean;
  /** Server userStatus.phoneMatchResolvedAt — number once the user has decided. */
  phoneMatchResolvedAt: number | null | undefined;
  /** getPendingPhoneMatches query result — undefined means still loading. */
  pendingMatches: unknown[] | undefined;
}

export function resolvePostAuthOnboardingRoute(
  input: ResolvePostAuthOnboardingRouteInput
): PostAuthOnboardingDecision {
  // Loading state for the primary status query — never guess.
  if (input.onboardingComplete === undefined) return 'wait';

  // Case 1: already completed — defer entirely to existing normal routing.
  if (input.onboardingComplete === true) return 'normal';

  // From here on: onboardingComplete === false.

  // Case 2: no Q1/Q2 answers yet — continue the existing onboarding flow.
  if (!input.hasLocalOnboardingAnswers) return 'onboarding-questions';

  // Case 3: answers exist but have not been persisted to the server yet —
  // wait for persistOnboardingAnswers to resolve before doing anything else.
  // Do NOT proceed to match/profile routing until persistence succeeds.
  if (!input.answersPersisted) return 'wait';

  // Case 4/6: the user already made their phone-match decision (accepted
  // one match earlier, or explicitly declined) — go straight to mandatory
  // Profile Setup. Never re-prompt for other pending matches.
  if (input.phoneMatchResolvedAt) return 'mandatory-profile-setup';

  // Still resolving whether there are pending matches — a loading query
  // must never be treated as "no matches".
  if (input.pendingMatches === undefined) return 'wait';

  // Case 4: one or more pending, unresolved phone matches exist.
  if (input.pendingMatches.length > 0) return 'phone-match-confirmation';

  // Case 7: no phone matches at all.
  return 'mandatory-profile-setup';
}
