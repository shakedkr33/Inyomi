// ============================================================================
// billingPeriod.ts — pure billing-period derivation (Settings paid state)
// ============================================================================
//
// Derives the billing period (annual vs monthly) STRICTLY from the store
// product identifier that unlocked the customer's active RevenueCat
// entitlement (see contexts/RevenueCatContext.tsx
// #getActiveEntitlementProductIdentifier / CustomerData.activeProductIdentifier).
// Never guessed from entitlement name/tier — personal and family
// entitlements each have their own annual/monthly SKUs, all covered below.
// Returns null (never a fabricated guess) when the product identifier is
// missing or unrecognized.
//
// Intentionally kept free of any 'react-native' import (unlike
// utils/revenueCatConfig.ts, which imports Platform at module scope) so it
// can be unit-tested with plain `bun test` — same pattern as
// lib/spaceTypeDerivation.ts and lib/onboardingRouting.ts.
//
// The literals below MUST mirror utils/revenueCatConfig.ts#PRODUCT_IDS
// exactly. Per this app's product/engineering rules, RevenueCat product
// identifiers are never renamed — if that ever changes, update both files
// together.
// ============================================================================

const ANNUAL_PRODUCT_IDS: readonly string[] = [
  'inyomi_personal_annual',
  'inyomi_family_annual',
];

const MONTHLY_PRODUCT_IDS: readonly string[] = [
  'inyomi_personal_monthly',
  'inyomi_family_monthly',
];

export type BillingPeriod = 'annual' | 'monthly';

export function getBillingPeriodFromProductIdentifier(
  productIdentifier: string | null | undefined
): BillingPeriod | null {
  if (!productIdentifier) {
    return null;
  }
  if (ANNUAL_PRODUCT_IDS.includes(productIdentifier)) {
    return 'annual';
  }
  if (MONTHLY_PRODUCT_IDS.includes(productIdentifier)) {
    return 'monthly';
  }
  return null;
}
