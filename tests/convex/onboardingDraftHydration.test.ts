/**
 * Stage 1 — draft hydration merge rule for OnboardingContext.
 *
 * Run with: bun test
 *
 * Covers:
 *  D. Context can hydrate Step 1 / Step 2 answers from a persisted draft
 *  E. Existing (newer) in-memory answers are never overwritten by a stale
 *     persisted draft
 */

import { describe, expect, it } from 'bun:test';
import type { OnboardingDraft } from '../../lib/onboardingState';
import { mergeDraftIntoOnboardingData } from '../../contexts/OnboardingContext';

const draft: OnboardingDraft = {
  spaceType: 'family',
  challenges: ['remember_tasks_and_appointments'],
  createdAt: Date.now(),
};

describe('mergeDraftIntoOnboardingData', () => {
  it('returns the current data unchanged when there is no draft', () => {
    const current = { firstName: 'דנה' };
    expect(mergeDraftIntoOnboardingData(current, null)).toBe(current);
  });

  it('D: hydrates spaceType + challenges from the draft into empty in-memory data', () => {
    const result = mergeDraftIntoOnboardingData({}, draft);
    expect(result.spaceType).toBe('family');
    expect(result.challenges).toEqual(['remember_tasks_and_appointments']);
  });

  it('D: preserves unrelated fields already present in-memory while hydrating', () => {
    const current = { firstName: 'דנה', personalColor: '#36a9e2' };
    const result = mergeDraftIntoOnboardingData(current, draft);
    expect(result.firstName).toBe('דנה');
    expect(result.personalColor).toBe('#36a9e2');
    expect(result.spaceType).toBe('family');
  });

  it('E: does NOT overwrite an in-memory spaceType with a stale draft', () => {
    const current = { spaceType: 'couple' as const, challenges: [] };
    const result = mergeDraftIntoOnboardingData(current, draft);
    expect(result).toBe(current);
    expect(result.spaceType).toBe('couple');
  });

  it('E: does NOT overwrite in-memory answers when challenges already has entries', () => {
    const current = {
      challenges: ['everything_in_one_place'],
    };
    const result = mergeDraftIntoOnboardingData(current, draft);
    expect(result).toBe(current);
    expect(result.challenges).toEqual(['everything_in_one_place']);
  });

  it('applies the draft when challenges is an empty array in-memory (not yet answered)', () => {
    const current = { challenges: [] as string[] };
    const result = mergeDraftIntoOnboardingData(current, draft);
    expect(result.spaceType).toBe('family');
    expect(result.challenges).toEqual(['remember_tasks_and_appointments']);
  });
});
