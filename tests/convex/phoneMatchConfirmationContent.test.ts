/**
 * Part 3/5 — match-screen content and terminology correction.
 *
 * QA found the match screen showed only the space name (e.g. "הבית שלנו")
 * and a single matched entity, instead of clearly presenting the existing
 * family profile and ALL of its members. Product also requires
 * "הפרופיל המשפחתי" as the primary concept — never "InYomi Together" (the
 * paid subscription plan name).
 *
 * This repo has no React Navigation / RN render test harness (see
 * tests/convex/mandatoryProfileSetupRoutingFix.test.ts's documented
 * precedent). These invariants are verified via source inspection of the
 * real file, the same pattern used there.
 *
 * Run with: bun test tests/convex/phoneMatchConfirmationContent.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(
  new URL(
    '../../app/(authenticated)/phone-match-confirmation.tsx',
    import.meta.url
  ),
  'utf8'
);

describe('phone-match-confirmation.tsx — product terminology', () => {
  it('never labels the family profile as "InYomi Together" (the paid subscription plan) in any rendered <Text> copy', () => {
    // Source-code comments are allowed to reference the paid plan name for
    // documentation purposes (see the "Part 3" comment above the title) —
    // only actual <Text>...</Text> copy must never use it.
    const textContents = [
      ...SOURCE.matchAll(/<Text[^>]*>\s*([^<]*?)\s*<\/Text>/g),
    ].map((m) => m[1]);
    for (const text of textContents) {
      expect(text).not.toContain('InYomi Together');
    }
  });

  it('uses "הפרופיל המשפחתי" as the primary family-profile concept', () => {
    expect(SOURCE).toContain('הפרופיל המשפחתי');
  });

  it('uses the exact required title copy', () => {
    expect(SOURCE).toContain('מצאנו שכבר יש לך פרופיל משותף ב-InYomi');
  });

  it('uses the exact required CTA copy', () => {
    expect(SOURCE).toContain('המשך לפרופיל המשפחתי');
  });

  it('keeps the exact required secondary-action copy', () => {
    expect(SOURCE).toContain('להגדיר פרופיל נפרד');
  });
});

describe('phone-match-confirmation.tsx — shows all existing family members, never phone numbers', () => {
  it('renders match.memberNames (every existing member display name), not just a single displayName', () => {
    expect(SOURCE).toContain('match.memberNames');
  });

  it('never reads/renders a phone-shaped field on the match object', () => {
    expect(SOURCE).not.toMatch(/match\.(phone|selectedPhoneNumber)/);
  });

  it('renders the matched space name only as secondary metadata below the family-profile label', () => {
    expect(SOURCE).toContain('matchSpaceNameSecondary');
    expect(SOURCE).toContain('match.spaceName');
  });
});
