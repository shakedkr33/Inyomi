// ============================================================================
// InYomi Together — offering-load readiness decision (pure logic)
// ============================================================================
//
// Fixes the "There is no singleton instance. Make sure you configure
// Purchases before trying to get the default instance." crash: that error
// means `Purchases.getOfferings()` was called before `Purchases.configure()`
// (called once, in RevenueCatContext.tsx's `initialize()` effect) actually
// resolved.
//
// `isConfigured` (see utils/revenueCatConfig.ts `isRevenueCatConfigured`) is
// a SYNCHRONOUS API-key-presence check only — it says nothing about whether
// `Purchases.configure()` has completed. `sdkMode` is the correct readiness
// flag for that: it starts as 'configuring' and only becomes 'configured'
// (or 'unavailable' on a real configure failure) once the async configure()
// call in `initialize()` actually settles. This module makes that guard a
// pure, unit-testable decision so `loadTogetherOffering` never needs to call
// the SDK while `sdkMode === 'configuring'`.
//
// Kept dependency-free (no React / RN / RevenueCat SDK imports) so it can be
// unit tested directly with bun test, mirroring lib/revenuecat/identityReady.ts.

export type RevenueCatSdkMode = 'configuring' | 'configured' | 'unavailable';

export type TogetherOfferingLoadAction =
  // Transient — Purchases.configure() has not resolved yet. Do NOT call
  // Purchases.getOfferings(). Leave the existing 'loading' state as-is; the
  // caller re-invokes this decision automatically once sdkMode changes
  // (sdkMode is a dependency of the callback that calls this function).
  | 'skip'
  // Not the real-SDK path (payment system disabled, Expo Go, no API key) OR
  // configure() itself genuinely failed (sdkMode === 'unavailable'). Show the
  // honest unavailable/retry state — never a hardcoded price.
  | 'setUnavailable'
  // Safe to call Purchases.getOfferings() now.
  | 'load';

/**
 * Decides what `loadTogetherOffering` should do, WITHOUT ever calling the
 * RevenueCat SDK before it is actually configured.
 *
 * Evaluated in order:
 *   1. Not the real-SDK path at all (payment system disabled / Expo Go / no
 *      API key configured) -> 'setUnavailable', regardless of sdkMode.
 *   2. sdkMode === 'configuring' -> 'skip' (the race-condition guard).
 *   3. sdkMode === 'unavailable' -> 'setUnavailable' (real configure failure).
 *   4. sdkMode === 'configured' -> 'load'.
 */
export function decideTogetherOfferingLoadAction(input: {
  paymentSystemEnabled: boolean;
  isExpoGo: boolean;
  isConfigured: boolean;
  sdkMode: RevenueCatSdkMode;
}): TogetherOfferingLoadAction {
  const { paymentSystemEnabled, isExpoGo, isConfigured, sdkMode } = input;

  if (!paymentSystemEnabled || isExpoGo || !isConfigured) {
    return 'setUnavailable';
  }
  if (sdkMode === 'configuring') {
    return 'skip';
  }
  if (sdkMode === 'unavailable') {
    return 'setUnavailable';
  }
  return 'load';
}
