import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Pre-auth onboarding draft ─────────────────────────────────────────────
//
// Replaces the legacy device-global `hasSeenOnboarding` boolean with a
// structured draft of the actual questionnaire answers (Step 1 + Step 2).
// This is the ONLY thing persisted pre-auth in Stage 1 — no profile/family
// setup fields are stored here (those are collected post-auth).
//
// Lifecycle:
//   - written atomically at the end of Step 2 (onboarding-step2.tsx)
//   - read on app start to detect "onboarding already answered" and to
//     hydrate OnboardingContext after a process kill (contexts/OnboardingContext.tsx)
//   - cleared after sign-out so a second user on the same device never
//     inherits it (app/(authenticated)/profile.tsx)

const ONBOARDING_DRAFT_KEY = 'onboarding_draft';

/**
 * Step 1 answer. Kept as `string` (not the narrower union used elsewhere)
 * so this storage-layer module has no dependency on OnboardingContext's
 * types and can be tested in isolation.
 */
export interface OnboardingDraft {
  spaceType: string;
  challenges: string[];
  createdAt: number;
}

export type OnboardingDraftInput = Omit<OnboardingDraft, 'createdAt'>;

function isValidOnboardingDraft(value: unknown): value is OnboardingDraft {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.spaceType === 'string' &&
    Array.isArray(candidate.challenges) &&
    candidate.challenges.every((c) => typeof c === 'string') &&
    typeof candidate.createdAt === 'number'
  );
}

/**
 * Persists the completed Step 1 + Step 2 answers. Fails gracefully — a
 * storage write failure must never crash the app; the caller's in-memory
 * OnboardingContext session can continue regardless.
 */
export const saveOnboardingDraft = async (
  draft: OnboardingDraftInput
): Promise<void> => {
  try {
    const payload: OnboardingDraft = { ...draft, createdAt: Date.now() };
    await AsyncStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Swallow — draft persistence is a best-effort convenience, not a
    // requirement for the current in-memory session to keep working.
  }
};

/**
 * Reads the pre-auth draft, if any. Returns null when absent, unreadable,
 * or malformed (defensive against a corrupted/old-shape AsyncStorage value).
 */
export const getOnboardingDraft = async (): Promise<OnboardingDraft | null> => {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidOnboardingDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const clearOnboardingDraft = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    // Best-effort cleanup — nothing meaningful to recover from here.
  }
};

// ─── Authenticated Step 2 continuation ─────────────────────────────────────
//
// A user can reach Step 1 / Step 2 while ALREADY authenticated: e.g. they
// tapped the Welcome screen's "כבר יש לי חשבון? התחברות" link by mistake,
// completed SMS auth, and the authenticated layout then routed them into
// onboarding because the server has no completed onboarding for them yet.
//
// In that case Step 2's "Continue" must NOT send them through Sign In again
// (which would just bounce them straight back into the authenticated area
// and back out here). Extracted as a pure function so the decision is
// covered by a unit test without needing to render the screen.

export type PostOnboardingStep2Destination =
  | '/(auth)/sign-in'
  | '/(authenticated)/family-bootstrap';

export const getPostStep2Destination = (
  isAuthenticated: boolean
): PostOnboardingStep2Destination =>
  isAuthenticated ? '/(authenticated)/family-bootstrap' : '/(auth)/sign-in';
