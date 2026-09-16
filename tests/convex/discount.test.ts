/**
 * InYomi Together paywall — calculateDiscountPercent (lib/revenuecat/discount.ts)
 *
 * The paywall must never hardcode a discount percentage (e.g. "30%"); it is
 * always computed dynamically from the actual intro vs. regular store
 * prices returned by RevenueCat/the store.
 *
 * Run with: bun test tests/convex/discount.test.ts
 */

import { describe, expect, it } from 'bun:test';

import { calculateDiscountPercent } from '../../lib/revenuecat/discount';

describe('calculateDiscountPercent', () => {
  it('259 vs 369.90 rounds to 30%', () => {
    expect(calculateDiscountPercent(259, 369.9)).toBe(30);
  });

  it('rounds to the nearest whole percent', () => {
    // 1 - 100/149 = 0.32885... -> 33%
    expect(calculateDiscountPercent(100, 149)).toBe(33);
  });

  it('returns null when intro price equals regular price (no real discount)', () => {
    expect(calculateDiscountPercent(100, 100)).toBeNull();
  });

  it('returns null when intro price exceeds regular price (invalid data)', () => {
    expect(calculateDiscountPercent(150, 100)).toBeNull();
  });

  it('returns null when regular price is zero or negative', () => {
    expect(calculateDiscountPercent(50, 0)).toBeNull();
    expect(calculateDiscountPercent(50, -10)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(calculateDiscountPercent(Number.NaN, 100)).toBeNull();
    expect(calculateDiscountPercent(50, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
