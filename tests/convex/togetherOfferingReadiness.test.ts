// ============================================================================
// togetherOfferingReadiness.test.ts — pure-logic tests for the InYomi
// Together offering-load race-condition guard
// (lib/revenuecat/togetherOfferingReadiness.ts)
// ============================================================================
// Imports ONLY the pure decision function. No React, React Native,
// RevenueCat SDK, or context imports, and no mocking framework — mirrors
// tests/convex/rcIdentityReadyGuard.test.ts's style exactly.
//
// These tests pin the fix for:
//   "There is no singleton instance. Make sure you configure Purchases
//    before trying to get the default instance."
// which was caused by loadTogetherOffering calling Purchases.getOfferings()
// before Purchases.configure() (async, in RevenueCatContext's initialize())
// had resolved. `sdkMode` is the correct readiness flag; `isConfigured` only
// means an API key is present, not that configure() has completed.
//
// Run with: bun test tests/convex/togetherOfferingReadiness.test.ts

import { describe, expect, it } from 'bun:test';

import { decideTogetherOfferingLoadAction } from '../../lib/revenuecat/togetherOfferingReadiness';

describe('decideTogetherOfferingLoadAction', () => {
  it('1. SDK not ready (sdkMode "configuring") -> "skip" — Purchases.getOfferings() must NOT be called', () => {
    expect(
      decideTogetherOfferingLoadAction({
        paymentSystemEnabled: true,
        isExpoGo: false,
        isConfigured: true,
        sdkMode: 'configuring',
      })
    ).toBe('skip');
  });

  it('2. SDK ready but the real-SDK path is not active (payment system disabled) -> "setUnavailable" regardless of sdkMode', () => {
    expect(
      decideTogetherOfferingLoadAction({
        paymentSystemEnabled: false,
        isExpoGo: false,
        isConfigured: true,
        sdkMode: 'configured',
      })
    ).toBe('setUnavailable');
  });

  it('2b. Expo Go -> "setUnavailable" even when sdkMode is "configured"', () => {
    expect(
      decideTogetherOfferingLoadAction({
        paymentSystemEnabled: true,
        isExpoGo: true,
        isConfigured: true,
        sdkMode: 'configured',
      })
    ).toBe('setUnavailable');
  });

  it('2c. No API key configured -> "setUnavailable" even when sdkMode is "configured"', () => {
    expect(
      decideTogetherOfferingLoadAction({
        paymentSystemEnabled: true,
        isExpoGo: false,
        isConfigured: false,
        sdkMode: 'configured',
      })
    ).toBe('setUnavailable');
  });

  it('3. SDK + real-SDK path ready (sdkMode "configured") -> "load" — the Together offering loads', () => {
    expect(
      decideTogetherOfferingLoadAction({
        paymentSystemEnabled: true,
        isExpoGo: false,
        isConfigured: true,
        sdkMode: 'configured',
      })
    ).toBe('load');
  });

  it('4. RevenueCat initialization genuinely failed (sdkMode "unavailable") -> "setUnavailable", not a retry-forever "skip"', () => {
    expect(
      decideTogetherOfferingLoadAction({
        paymentSystemEnabled: true,
        isExpoGo: false,
        isConfigured: true,
        sdkMode: 'unavailable',
      })
    ).toBe('setUnavailable');
  });

  it('5. Transition "configuring" -> "configured" flips the decision from "skip" to "load" for the same otherwise-unchanged inputs', () => {
    const base = {
      paymentSystemEnabled: true,
      isExpoGo: false,
      isConfigured: true,
    } as const;

    expect(
      decideTogetherOfferingLoadAction({ ...base, sdkMode: 'configuring' })
    ).toBe('skip');
    expect(
      decideTogetherOfferingLoadAction({ ...base, sdkMode: 'configured' })
    ).toBe('load');
  });

  it('6. Retry after readiness ("configured") always resolves to "load" — never re-triggers the "configuring" skip once ready', () => {
    const readyInput = {
      paymentSystemEnabled: true,
      isExpoGo: false,
      isConfigured: true,
      sdkMode: 'configured' as const,
    };
    // Simulate calling the decision function twice (initial load + retry).
    expect(decideTogetherOfferingLoadAction(readyInput)).toBe('load');
    expect(decideTogetherOfferingLoadAction(readyInput)).toBe('load');
  });
});
