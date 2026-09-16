/**
 * InYomi Together paywall — resolveAndroidAnnualOffer
 * (lib/revenuecat/androidOfferResolution.ts)
 *
 * Verifies the critical Android annual pricing/purchase-parity rule:
 *   - launch30 tag, when present, is always selected explicitly (never via
 *     RC's `defaultOption` "cheapest phase" heuristic).
 *   - partner50 (tagged `rc-ignore-offer`) is NEVER selected as the public
 *     offer, even when present alongside or instead of launch30.
 *   - When launch30 is absent, the explicit base plan is returned (never
 *     null, never defaultOption) so the purchase call always has an exact
 *     SubscriptionOption to buy.
 *   - When no subscriptionOptions exist at all, returns null (unavailable),
 *     never a fabricated/hardcoded price.
 *
 * Run with: bun test tests/convex/androidOfferResolution.test.ts
 */

import { describe, expect, it } from 'bun:test';
import type {
  PricingPhase,
  PurchasesStoreProduct,
  SubscriptionOption,
} from 'react-native-purchases';

import { resolveAndroidAnnualOffer } from '../../lib/revenuecat/androidOfferResolution';

function makePhase(amountMicros: number): PricingPhase {
  return {
    billingPeriod: { unit: 3, value: 1, iso8601: 'P1Y' } as never,
    recurrenceMode: 1,
    billingCycleCount: null,
    price: {
      formatted: `₪${(amountMicros / 1_000_000).toFixed(2)}`,
      amountMicros,
      currencyCode: 'ILS',
    },
    offerPaymentMode: null,
  };
}

function makeOption(
  overrides: Partial<SubscriptionOption> & { id: string }
): SubscriptionOption {
  return {
    id: overrides.id,
    storeProductId: 'inyomi_family_annual',
    productId: 'inyomi_family_annual',
    pricingPhases: overrides.pricingPhases ?? [],
    tags: overrides.tags ?? [],
    isBasePlan: overrides.isBasePlan ?? false,
    billingPeriod: null,
    isPrepaid: false,
    fullPricePhase: overrides.fullPricePhase ?? null,
    freePhase: null,
    introPhase: overrides.introPhase ?? null,
    presentedOfferingIdentifier: null,
    presentedOfferingContext: null,
    installmentsInfo: null,
  };
}

function makeProduct(
  subscriptionOptions: SubscriptionOption[] | null
): Pick<PurchasesStoreProduct, 'subscriptionOptions' | 'identifier'> {
  return {
    identifier: 'inyomi_family_annual',
    subscriptionOptions,
  };
}

describe('resolveAndroidAnnualOffer — launch30 present', () => {
  it('selects the launch30-tagged option explicitly, not defaultOption heuristics', () => {
    const launchOption = makeOption({
      id: 'inyomi_family_annual:launch30',
      tags: ['launch30'],
      introPhase: makePhase(25_900_000),
      fullPricePhase: makePhase(36_990_000),
    });
    const basePlan = makeOption({
      id: 'inyomi_family_annual',
      isBasePlan: true,
      fullPricePhase: makePhase(36_990_000),
    });

    const result = resolveAndroidAnnualOffer(
      makeProduct([basePlan, launchOption])
    );

    expect(result).not.toBeNull();
    expect(result?.hasLaunchOffer).toBe(true);
    expect(result?.option.id).toBe('inyomi_family_annual:launch30');
    expect(result?.introPhase?.price.amountMicros).toBe(25_900_000);
    expect(result?.fullPricePhase?.price.amountMicros).toBe(36_990_000);
  });

  it('never selects partner50 even when it is present alongside launch30', () => {
    const launchOption = makeOption({
      id: 'inyomi_family_annual:launch30',
      tags: ['launch30'],
      introPhase: makePhase(25_900_000),
      fullPricePhase: makePhase(36_990_000),
    });
    const partnerOption = makeOption({
      id: 'inyomi_family_annual:partner50',
      tags: ['partner50', 'rc-ignore-offer'],
      introPhase: makePhase(18_495_000),
      fullPricePhase: makePhase(36_990_000),
    });

    const result = resolveAndroidAnnualOffer(
      makeProduct([partnerOption, launchOption])
    );

    expect(result?.option.id).toBe('inyomi_family_annual:launch30');
    expect(result?.option.tags).not.toContain('partner50');
  });
});

describe('resolveAndroidAnnualOffer — launch30 absent', () => {
  it('falls back to the explicit base plan (never null, never defaultOption)', () => {
    const basePlan = makeOption({
      id: 'inyomi_family_annual',
      isBasePlan: true,
      fullPricePhase: makePhase(36_990_000),
    });

    const result = resolveAndroidAnnualOffer(makeProduct([basePlan]));

    expect(result).not.toBeNull();
    expect(result?.hasLaunchOffer).toBe(false);
    expect(result?.option.isBasePlan).toBe(true);
    expect(result?.introPhase).toBeNull();
    expect(result?.fullPricePhase?.price.amountMicros).toBe(36_990_000);
  });

  it('never selects partner50 as a base-plan substitute when launch30 is absent', () => {
    const basePlan = makeOption({
      id: 'inyomi_family_annual',
      isBasePlan: true,
      fullPricePhase: makePhase(36_990_000),
    });
    const partnerOption = makeOption({
      id: 'inyomi_family_annual:partner50',
      tags: ['partner50', 'rc-ignore-offer'],
      introPhase: makePhase(18_495_000),
      fullPricePhase: makePhase(36_990_000),
    });

    const result = resolveAndroidAnnualOffer(
      makeProduct([partnerOption, basePlan])
    );

    expect(result?.hasLaunchOffer).toBe(false);
    expect(result?.option.isBasePlan).toBe(true);
    expect(result?.option.tags).not.toContain('partner50');
  });
});

describe('resolveAndroidAnnualOffer — no options at all', () => {
  it('returns null (unavailable) when subscriptionOptions is an empty array', () => {
    expect(resolveAndroidAnnualOffer(makeProduct([]))).toBeNull();
  });

  it('returns null (unavailable) when subscriptionOptions is null', () => {
    expect(resolveAndroidAnnualOffer(makeProduct(null))).toBeNull();
  });
});
