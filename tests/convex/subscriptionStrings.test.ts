/**
 * InYomi Together paywall — SUBSCRIPTION_STRINGS completeness
 * (lib/subscriptionStrings.ts)
 *
 * Guards against a future edit accidentally removing a key the paywall
 * screen depends on, and pins the exact approved copy for the title, CTA,
 * benefits and secondary actions so a future translation swap cannot
 * silently drift from what was approved.
 *
 * Run with: bun test tests/convex/subscriptionStrings.test.ts
 */

import { describe, expect, it } from 'bun:test';

import { SUBSCRIPTION_STRINGS } from '../../lib/subscriptionStrings';

const REQUIRED_KEYS = [
  'backButtonLabel',
  'title',
  'benefit1',
  'benefit2',
  'benefit3',
  'benefit4',
  'benefit5',
  'monthlyPillLabel',
  'annualPillLabel',
  'launchPricePrefix',
  'discountSuffix',
  'firstYear',
  'approxPrefix',
  'perMonthFamilyAnnual',
  'perYear',
  'renewalDisclosure',
  'flexibleMonthly',
  'cta',
  'couponQuestion',
  'continueFree',
  'restore',
  'terms',
  'privacy',
  'loading',
  'unavailableTitle',
  'unavailableRetry',
] as const;

describe('SUBSCRIPTION_STRINGS — completeness', () => {
  it('contains every key the paywall screen depends on', () => {
    for (const key of REQUIRED_KEYS) {
      expect(SUBSCRIPTION_STRINGS).toHaveProperty(key);
      expect(typeof SUBSCRIPTION_STRINGS[key]).toBe('string');
      expect(SUBSCRIPTION_STRINGS[key].length).toBeGreaterThan(0);
    }
  });
});

describe('SUBSCRIPTION_STRINGS — exact approved copy', () => {
  it('title is exactly "InYomi Together" (brand name, never translated)', () => {
    expect(SUBSCRIPTION_STRINGS.title).toBe('InYomi Together');
  });

  it('cta is exactly "המשך עם InYomi Together"', () => {
    expect(SUBSCRIPTION_STRINGS.cta).toBe('המשך עם InYomi Together');
  });

  it('the 5 benefit lines match the approved copy exactly', () => {
    expect(SUBSCRIPTION_STRINGS.benefit1).toBe('עד 6 בני משפחה במנוי אחד');
    expect(SUBSCRIPTION_STRINGS.benefit2).toBe(
      'יומן אישי ומשפחתי, קהילות ומשימות במקום אחד'
    );
    expect(SUBSCRIPTION_STRINGS.benefit3).toBe('תזכורות לכל הדברים החשובים');
    expect(SUBSCRIPTION_STRINGS.benefit4).toBe(
      'זימון משתתפים לאירוע ללא צורך בכתובות אימייל'
    );
    expect(SUBSCRIPTION_STRINGS.benefit5).toBe('יצירת קהילות ללא הגבלה');
  });

  it('coupon question is exactly "יש קוד קופון?" (not "יש לי קוד קופון")', () => {
    expect(SUBSCRIPTION_STRINGS.couponQuestion).toBe('יש קוד קופון?');
  });

  it('continueFree is exactly "להמשיך בחינם – קהילות בלבד"', () => {
    expect(SUBSCRIPTION_STRINGS.continueFree).toBe(
      'להמשיך בחינם – קהילות בלבד'
    );
  });

  it('renewalDisclosure matches the approved copy exactly', () => {
    expect(SUBSCRIPTION_STRINGS.renewalDisclosure).toBe(
      'המנוי מתחדש אוטומטית לאחר שנה במחיר הרגיל'
    );
  });
});
