/**
 * getBillingPeriodFromProductIdentifier (lib/billingPeriod.ts)
 *
 * Settings' paid subscription state ("InYomi Together") must show the
 * correct billing period (annual / monthly) WITHOUT guessing — this pure
 * function derives it strictly from the store product identifier that
 * unlocked the customer's active RevenueCat entitlement.
 *
 * Run with: bun test tests/convex/getBillingPeriodFromProductIdentifier.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { getBillingPeriodFromProductIdentifier } from '../../lib/billingPeriod';

describe('getBillingPeriodFromProductIdentifier', () => {
  it('family annual product → annual', () => {
    expect(getBillingPeriodFromProductIdentifier('inyomi_family_annual')).toBe(
      'annual'
    );
  });

  it('family monthly product → monthly', () => {
    expect(getBillingPeriodFromProductIdentifier('inyomi_family_monthly')).toBe(
      'monthly'
    );
  });

  it('personal annual product → annual', () => {
    expect(
      getBillingPeriodFromProductIdentifier('inyomi_personal_annual')
    ).toBe('annual');
  });

  it('personal monthly product → monthly', () => {
    expect(
      getBillingPeriodFromProductIdentifier('inyomi_personal_monthly')
    ).toBe('monthly');
  });

  it('null → null (never guess)', () => {
    expect(getBillingPeriodFromProductIdentifier(null)).toBeNull();
  });

  it('undefined → null (never guess)', () => {
    expect(getBillingPeriodFromProductIdentifier(undefined)).toBeNull();
  });

  it('unrecognized product identifier → null (never guess)', () => {
    expect(getBillingPeriodFromProductIdentifier('unknown_sku')).toBeNull();
  });
});
