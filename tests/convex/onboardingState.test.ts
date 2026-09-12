/**
 * Stage 1 — pre-auth onboarding draft persistence + authenticated Step 2
 * continuation decision.
 *
 * Run with: bun test
 *
 * Covers:
 *  A. save -> load round trip
 *  B. clear draft
 *  C. malformed / corrupt draft fails safely (returns null, never throws)
 *  F. authenticated vs unauthenticated Step 2 continuation decision
 *     (getPostStep2Destination)
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ── In-memory fake for @react-native-async-storage/async-storage ─────────────
// mock.module must run before the module under test is imported (it patches
// the module registry), so this file uses a dynamic `await import` below
// instead of a static `import` for lib/onboardingState.
const store = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

const {
  saveOnboardingDraft,
  getOnboardingDraft,
  clearOnboardingDraft,
  getPostStep2Destination,
} = await import('../../lib/onboardingState');

const ONBOARDING_DRAFT_KEY = 'onboarding_draft';

beforeEach(() => {
  store.clear();
});

// ── A: save -> load round trip ────────────────────────────────────────────────

describe('saveOnboardingDraft / getOnboardingDraft — round trip', () => {
  it('returns null when no draft has been saved', async () => {
    expect(await getOnboardingDraft()).toBeNull();
  });

  it('persists and reloads the exact spaceType + challenges', async () => {
    await saveOnboardingDraft({
      spaceType: 'family',
      challenges: [
        'remember_tasks_and_appointments',
        'shared_schedule_coordination',
      ],
    });

    const draft = await getOnboardingDraft();
    expect(draft).not.toBeNull();
    expect(draft?.spaceType).toBe('family');
    expect(draft?.challenges).toEqual([
      'remember_tasks_and_appointments',
      'shared_schedule_coordination',
    ]);
    expect(typeof draft?.createdAt).toBe('number');
  });

  it('overwrites a previous draft with the latest save', async () => {
    await saveOnboardingDraft({ spaceType: 'personal', challenges: [] });
    await saveOnboardingDraft({
      spaceType: 'couple',
      challenges: ['everything_in_one_place'],
    });

    const draft = await getOnboardingDraft();
    expect(draft?.spaceType).toBe('couple');
    expect(draft?.challenges).toEqual(['everything_in_one_place']);
  });
});

// ── B: clear draft ─────────────────────────────────────────────────────────────

describe('clearOnboardingDraft', () => {
  it('removes a previously saved draft', async () => {
    await saveOnboardingDraft({ spaceType: 'family', challenges: [] });
    expect(await getOnboardingDraft()).not.toBeNull();

    await clearOnboardingDraft();
    expect(await getOnboardingDraft()).toBeNull();
  });

  it('is a no-op (does not throw) when no draft exists', async () => {
    await expect(clearOnboardingDraft()).resolves.toBeUndefined();
    expect(await getOnboardingDraft()).toBeNull();
  });
});

// ── C: malformed / corrupt draft fails safely ─────────────────────────────────

describe('getOnboardingDraft — malformed storage value', () => {
  it('returns null (not a throw) for invalid JSON', async () => {
    store.set(ONBOARDING_DRAFT_KEY, 'not-json{{{');
    await expect(getOnboardingDraft()).resolves.toBeNull();
  });

  it('returns null for valid JSON with the wrong shape', async () => {
    store.set(ONBOARDING_DRAFT_KEY, JSON.stringify({ foo: 'bar' }));
    expect(await getOnboardingDraft()).toBeNull();
  });

  it('returns null when challenges is not an array of strings', async () => {
    store.set(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({
        spaceType: 'family',
        challenges: [1, 2],
        createdAt: Date.now(),
      })
    );
    expect(await getOnboardingDraft()).toBeNull();
  });

  it('returns null when createdAt is missing', async () => {
    store.set(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({ spaceType: 'family', challenges: [] })
    );
    expect(await getOnboardingDraft()).toBeNull();
  });
});

// ── F: authenticated vs unauthenticated Step 2 continuation decision ─────────

describe('getPostStep2Destination', () => {
  it('routes an unauthenticated user to Sign In', () => {
    expect(getPostStep2Destination(false)).toBe('/(auth)/sign-in');
  });

  it('routes an already-authenticated user into the authenticated flow, NOT Sign In again', () => {
    // Prevents the onboarding -> Sign In -> authenticated redirect loop when
    // a genuinely new user mistakenly taps the Welcome screen's returning-
    // user link, authenticates, and is routed into onboarding by the
    // authenticated layout because the server has no completed onboarding.
    expect(getPostStep2Destination(true)).toBe(
      '/(authenticated)/family-bootstrap'
    );
  });
});
