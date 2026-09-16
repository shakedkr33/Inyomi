// ============================================================================
// Android annual SubscriptionOption resolution — pure logic
// ============================================================================
//
// Google Play subscription offers are NOT represented by `introPrice`
// (that field is iOS-only / defaults to null on Android in this SDK's
// product data). Instead, a Google Play StoreProduct exposes:
//   - product.subscriptionOptions: SubscriptionOption[] | null
//   - product.defaultOption: SubscriptionOption | null
//
// RevenueCat's SDK-side `defaultOption` selection logic (confirmed against
// the installed react-native-purchases 9.7.6 + official RevenueCat docs):
//   1. Filters out any offer tagged "rc-ignore-offer" or "rc-customer-center"
//   2. From what remains, picks the option with the longest free trial or
//      the cheapest first phase
//   3. Falls back to the base plan if no eligible offer remains
//
// For InYomi's Google Play configuration:
//   - The public annual launch discount is tagged "launch30"
//   - `partner50` is tagged "rc-ignore-offer" and is therefore ALWAYS
//     excluded from `defaultOption` by the SDK itself
//
// This module does NOT rely on `defaultOption`'s "cheapest phase" heuristic
// to decide what counts as "the public offer" — a future, cheaper offer
// could otherwise silently become the displayed default. Instead it:
//   1. Explicitly searches `subscriptionOptions` for the `launch30` tag
//   2. Falls back to an EXPLICIT base-plan SubscriptionOption (never to
//      `defaultOption` and never to `purchasePackage`), so the displayed
//      price always matches the exact SubscriptionOption that will be
//      purchased via `Purchases.purchaseSubscriptionOption(...)`.
//
// Kept framework/SDK-import-free (only uses the SDK's exported TYPES) so it
// can be unit tested directly with bun test using plain mock objects shaped
// like the real SubscriptionOption/PricingPhase interfaces.

import type {
  PricingPhase,
  PurchasesStoreProduct,
  SubscriptionOption,
} from 'react-native-purchases';

// Defined here (not in utils/revenueCatConfig.ts, which imports `Platform`
// from 'react-native') so this module stays fully framework-free and
// unit-testable with plain `bun test`, with no react-native module
// resolution involved at all. utils/revenueCatConfig.ts re-exports this
// same constant for the rest of the app to reference — single source of
// truth, no duplication.
export const ANDROID_LAUNCH_OFFER_TAG = 'launch30';

export type AndroidAnnualResolution = {
  /** The exact SubscriptionOption to purchase via purchaseSubscriptionOption. */
  option: SubscriptionOption;
  /** Non-null only when `option` is the launch30 offer. */
  introPhase: PricingPhase | null;
  /** The recurring (post-intro, or base-plan-only) pricing phase. */
  fullPricePhase: PricingPhase | null;
  /** True when `option` is the launch30 public offer. */
  hasLaunchOffer: boolean;
};

/**
 * Resolves the exact Android annual SubscriptionOption to display and
 * purchase for the InYomi Together paywall.
 *
 * Returns `null` only when the product has no subscriptionOptions at all
 * (should not happen for a correctly configured subscription product) —
 * callers must treat `null` as "unavailable", never fall back to a
 * hardcoded price or to `purchasePackage`.
 */
export function resolveAndroidAnnualOffer(
  product: Pick<PurchasesStoreProduct, 'subscriptionOptions' | 'identifier'>
): AndroidAnnualResolution | null {
  const options = product.subscriptionOptions ?? [];

  // 1. Explicit launch30 tag search — never trust "cheapest phase" heuristics.
  const launchOption = options.find(
    (option) =>
      !option.isBasePlan && option.tags.includes(ANDROID_LAUNCH_OFFER_TAG)
  );

  if (launchOption) {
    return {
      option: launchOption,
      introPhase: launchOption.introPhase,
      fullPricePhase: launchOption.fullPricePhase,
      hasLaunchOffer: true,
    };
  }

  // 2. Explicit base plan — never purchasePackage/defaultOption for this case.
  const basePlan = options.find((option) => option.isBasePlan);

  if (basePlan) {
    return {
      option: basePlan,
      introPhase: null,
      fullPricePhase: basePlan.fullPricePhase,
      hasLaunchOffer: false,
    };
  }

  // 3. No subscriptionOptions at all — unavailable, not a silent fallback.
  console.error(
    '[Paywall] No subscriptionOptions found for annual product:',
    product.identifier
  );
  return null;
}
