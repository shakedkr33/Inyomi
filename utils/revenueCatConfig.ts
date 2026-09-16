// ============================================================================
// קונפיגורציית REVENUECAT - InYomi
// ============================================================================
// ניהול מפתחות RevenueCat API לפי פלטפורמה וסביבה
//
// API Key Prefixes (per RevenueCat docs):
// - Test Store: test_... (development __DEV__ builds only)
// - iOS Production: appl_... (TestFlight + App Store)
// - Android Production: goog_... (internal testing + Play Store)
//
// CRITICAL: Test Store key must ONLY be used in __DEV__ builds.
// Using a test_ key in a release/TestFlight build causes a
// RevenueCat APIKeyValidationResult crash on launch.

import { Platform } from 'react-native';

type RevenueCatPlatform = 'ios' | 'android';

// ============================================================================
// Subscription Tier Type
// ============================================================================

export type SubscriptionTier = 'personal' | 'family' | null;

// ============================================================================
// Entitlement IDs
// ============================================================================

export const PERSONAL_ENTITLEMENT_ID = 'personal';
export const FAMILY_ENTITLEMENT_ID = 'family';

/** @deprecated Legacy entitlement — kept for backward compatibility only.
 *  Do NOT use for tier mapping. Use PERSONAL/FAMILY entitlements instead. */
export const ENTITLEMENT_ID = 'InYomi Pro';

// ============================================================================
// Package Identifiers (RevenueCat Offering packages)
// ============================================================================

export const PACKAGE_IDS = {
  personalMonthly: 'personal_monthly',
  personalAnnual: 'personal_annual',
  familyMonthly: 'family_monthly',
  familyAnnual: 'family_annual',
} as const;

// ============================================================================
// InYomi Together — Named Offering + Package Mapping
// ============================================================================
// The custom "InYomi Together" paywall (app/(authenticated)/subscription.tsx)
// resolves packages EXCLUSIVELY from this named RevenueCat Offering — never
// from `offerings.current`. This is intentional: changing the dashboard's
// Current Offering must never silently change this paywall's products or
// prices. See contexts/RevenueCatContext.tsx for the strict resolution
// (no fallback to offerings.current if this Offering is missing).
//
// "InYomi Together" is the marketing/display name only. Internally, it
// continues to use the existing Family monthly/annual store products —
// Product IDs and Package IDs are NOT renamed.
export const TOGETHER_OFFERING_ID = 'launch30_2026';

export const TOGETHER_PACKAGES = {
  annual: PACKAGE_IDS.familyAnnual, // 'family_annual'
  monthly: PACKAGE_IDS.familyMonthly, // 'family_monthly'
} as const;

// Google Play offer tag for the public annual launch discount. Any offer
// tagged this way is treated as the public launch offer. Never select an
// offer tagged with `rc-ignore-offer` (e.g. `partner50`) as the public
// offer. Re-exported from the pure resolution module (single source of
// truth) — see lib/revenuecat/androidOfferResolution.ts.
export { ANDROID_LAUNCH_OFFER_TAG } from '@/lib/revenuecat/androidOfferResolution';

// ============================================================================
// Product Identifiers (App Store / Google Play)
// ============================================================================

export const PRODUCT_IDS = {
  personalMonthly: 'inyomi_personal_monthly',
  personalAnnual: 'inyomi_personal_annual',
  familyMonthly: 'inyomi_family_monthly',
  familyAnnual: 'inyomi_family_annual',
  /** @deprecated Legacy — kept for old paywall backward compatibility */
  monthly: 'monthly',
  /** @deprecated Legacy — kept for old paywall backward compatibility */
  yearly: 'yearly',
  /** @deprecated Legacy — kept for old paywall backward compatibility */
  lifetime: 'lifetime',
} as const;

// ============================================================================
// API Key Management
// ============================================================================

/**
 * Returns the appropriate RevenueCat API key for the given platform and build type.
 *
 * Priority order:
 *   1. __DEV__ only — Test Store key (test_...) when EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY
 *      is set. Never used in release/TestFlight/Play Store builds (__DEV__ is false there).
 *   2. iOS release/TestFlight — EXPO_PUBLIC_REVENUECAT_IOS_API_KEY (appl_...)
 *   3. Android release/internal testing — EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY (goog_...)
 *   4. Returns null if no key is configured (allows builds without payment keys).
 */

// Declare the React Native global so TypeScript resolves it without importing RN here.
declare const __DEV__: boolean;

export function getRevenueCatApiKey(
  platform: RevenueCatPlatform
): string | null {
  // 1. Test Store key — __DEV__ builds only (Expo Go, local dev, development EAS builds).
  //    NEVER used in TestFlight or production — would crash with APIKeyValidationResult.
  if (__DEV__) {
    const testStoreKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY;
    if (testStoreKey) {
      return testStoreKey;
    }
  }

  // 2. Platform-specific production/release key.
  if (platform === 'ios') {
    return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || null;
  }

  if (platform === 'android') {
    return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || null;
  }

  return null;
}

/**
 * קבלת מפתח RevenueCat API עבור הפלטפורמה הנוכחית
 */
export function getCurrentPlatformRevenueCatApiKey(): string | null {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  return getRevenueCatApiKey(platform);
}

/**
 * בדיקה האם RevenueCat מוגדר כראוי עבור הפלטפורמה הנוכחית
 */
export function isRevenueCatConfigured(): boolean {
  return getCurrentPlatformRevenueCatApiKey() !== null;
}
