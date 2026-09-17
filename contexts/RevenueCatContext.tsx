// ============================================================================
// קונטקסט RevenueCat - InYomi
// ============================================================================
// ספק RevenueCat מלא עם תמיכה ב:
// - Expo Go (תצוגה מקדימה ללא רכישות מקוריות)
// - Development builds עם Test Store key
// - Production builds עם מפתחות iOS/Android
// - RevenueCat Paywall (native UI)
// - Customer Center (ניהול מנויים)
// - Two-tier entitlement model: "personal" and "family"
//
// PHASE 1 — REVENUECAT IDENTITY + LOGOUT SAFETY
// ----------------------------------------------------------------------------
// The RevenueCat App User ID is bound to the authenticated Convex Id<"users">
// via Purchases.logIn(convexUserId) instead of running fully anonymous. This
// prevents one InYomi account's entitlement from leaking into another
// account on the same device. See lib/revenuecat/identityReady.ts for the
// pure identity/generation guard logic shared between the render path, the
// async logIn path, and the CustomerInfo listener path.
//
// Purchases.logOut() is intentionally NOT used (see section "IDENTITY
// TRANSITION" below) — signing out clears local context state and blocks all
// customer-specific actions immediately; the next signed-in user calls
// Purchases.logIn() directly, which switches SDK identity on its own.

import Constants from 'expo-constants';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  Platform,
} from 'react-native';
// Type-only import — safe in Expo Go: erased at compile time, never triggers
// the native module import that crashes without a development build. All
// runtime access to the SDK stays behind the existing `await import('react-native-purchases')`
// pattern used throughout this file.
import type {
  PurchasesPackage,
  PurchasesStoreProduct,
} from 'react-native-purchases';
import { MOCK_PAYMENTS, PAYMENT_SYSTEM_ENABLED } from '@/config/appConfig';
import { resolveAndroidAnnualOffer } from '@/lib/revenuecat/androidOfferResolution';
import {
  computeRevenueCatIsLoading,
  isIdentityGenerationCurrent,
  isRevenueCatIdentityReady,
  shouldApplyCustomerInfo,
} from '@/lib/revenuecat/identityReady';
import { decideTogetherOfferingLoadAction } from '@/lib/revenuecat/togetherOfferingReadiness';
import {
  ENTITLEMENT_ID,
  FAMILY_ENTITLEMENT_ID,
  getCurrentPlatformRevenueCatApiKey,
  isRevenueCatConfigured,
  PERSONAL_ENTITLEMENT_ID,
  type SubscriptionTier,
  TOGETHER_OFFERING_ID,
  TOGETHER_PACKAGES,
} from '@/utils/revenueCatConfig';

// ============================================================================
// טיפוסים
// ============================================================================

// מבנה מידע על חבילת מנוי
export type PackageInfo = {
  identifier: string;
  priceString: string;
  price: number;
  currencyCode: string;
  title: string;
  description: string;
  packageType: 'monthly' | 'annual' | 'lifetime' | 'unknown';
  // Full RC data for packages loaded from a real Offering — needed by the
  // InYomi Together paywall to inspect Android subscriptionOptions/pricing
  // phases and to purchase via purchasePackage/purchaseSubscriptionOption
  // with correct offering attribution. Undefined only for PREVIEW_PACKAGES
  // (MOCK_PAYMENTS / Expo Go / unconfigured dev fallback — no real SDK data
  // exists in those modes).
  product?: PurchasesStoreProduct;
  rcPackage?: PurchasesPackage;
};

// ============================================================================
// InYomi Together — named-Offering package state (see utils/revenueCatConfig.ts
// TOGETHER_OFFERING_ID). Resolved strictly from offerings.all[TOGETHER_OFFERING_ID]
// — never falls back to offerings.current. See loadTogetherOffering below.
// ============================================================================
export type TogetherOfferingState =
  | { status: 'loading'; annual: null; monthly: null }
  | { status: 'unavailable'; annual: null; monthly: null }
  | { status: 'ready'; annual: PackageInfo; monthly: PackageInfo };

export type IntroEligibilityResult =
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'UNKNOWN'
  | 'NO_INTRO_OFFER_EXISTS';

// מידע מלא על הלקוח
export type CustomerData = {
  appUserID: string;
  activeEntitlements: string[];
  allPurchasedProductIdentifiers: string[];
  latestExpirationDate: string | null;
  firstSeen: string | null;
  managementURL: string | null;
  // Product identifier (App Store / Google Play SKU) that unlocked the
  // currently-active paid entitlement (family entitlement takes priority
  // over personal — mirrors getSubscriptionTierFromCustomerInfo's
  // priority). Used by Settings to derive the billing period ('annual' /
  // 'monthly') via getBillingPeriodFromProductIdentifier — never guessed
  // from entitlement names. Null when there is no active paid entitlement.
  activeProductIdentifier: string | null;
};

// SDK configuration lifecycle for the real (non-mock) RevenueCat SDK path.
// MOCK_PAYMENTS is intentionally outside this — it keeps its current
// behavior entirely, independent of sdkMode.
type RevenueCatSdkMode = 'configuring' | 'configured' | 'unavailable';

// ============================================================================
// DEBUG ONLY — remove after TestFlight investigation
// ============================================================================
export type RevenueCatDebugInfo = {
  initError: string | null;
  offeringsCurrentId: string | null;
  offeringsPackagesCount: number | null;
  usingPreviewPackages: boolean;
  apiKeyPrefix: string | null; // first 12 chars + *** mask
};

// מבנה הקונטקסט
type RevenueCatContextType = {
  // מצב
  isLoading: boolean;
  isPremium: boolean;
  isConfigured: boolean;
  isExpoGo: boolean;

  // Two-tier subscription state
  subscriptionTier: SubscriptionTier;
  isPersonal: boolean;
  isFamily: boolean;

  // חבילות זמינות
  packages: PackageInfo[];

  // InYomi Together — named-Offering package state + actions (see
  // TogetherOfferingState above). Strictly from offerings.all[TOGETHER_OFFERING_ID].
  togetherOffering: TogetherOfferingState;
  refreshTogetherOffering: () => Promise<void>;
  purchaseTogetherAnnual: () => Promise<boolean>;
  purchaseTogetherMonthly: () => Promise<boolean>;
  checkTogetherAnnualIntroEligibility: () => Promise<IntroEligibilityResult>;

  // מידע על הלקוח
  customerData: CustomerData | null;

  // פעולות רכישה
  purchasePackage: (packageId: string) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  refreshPurchaserInfo: () => Promise<void>;

  // RevenueCat UI - Paywall
  presentPaywall: () => Promise<boolean>;
  presentPaywallIfNeeded: () => Promise<boolean>;

  // RevenueCat UI - Customer Center
  presentCustomerCenter: () => Promise<void>;

  // DEBUG ONLY — remove after TestFlight investigation
  _debug: RevenueCatDebugInfo;
};

// ============================================================================
// חבילות ברירת מחדל לתצוגה מקדימה
// ============================================================================

const PREVIEW_PACKAGES: PackageInfo[] = [
  {
    identifier: '$rc_monthly',
    priceString: '₪9.99/חודש',
    price: 9.99,
    currencyCode: 'ILS',
    title: 'מנוי חודשי',
    description: 'גישה מלאה לכל התכונות',
    packageType: 'monthly',
  },
  {
    identifier: '$rc_annual',
    priceString: '₪69.99/שנה',
    price: 69.99,
    currencyCode: 'ILS',
    title: 'מנוי שנתי',
    description: 'חסכון של 40% לעומת מנוי חודשי',
    packageType: 'annual',
  },
  {
    identifier: '$rc_lifetime',
    priceString: '₪199.99',
    price: 199.99,
    currencyCode: 'ILS',
    title: 'רכישה לצמיתות',
    description: 'גישה מלאה לכל החיים - תשלום חד-פעמי',
    packageType: 'lifetime',
  },
];

// ============================================================================
// פונקציות עזר
// ============================================================================

/**
 * Returns true when a RevenueCat log message describes a purchase cancellation.
 *
 * RevenueCat's native SDK emits cancellation notices at LOG_LEVEL.ERROR, which
 * the SDK's default log handler routes to console.error, triggering the React
 * Native red LogBox.  Cancellation is a normal user action — not an app error —
 * so we intercept these messages in a custom setLogHandler and demote them.
 *
 * Only the (logLevel, message) pair is available inside LogHandler, so this
 * helper uses the narrowest reliable pattern set for the cancellation messages
 * emitted by RevenueCat 9.x on iOS and Android.
 */
function isPurchaseCancellationMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('purchase was cancelled') ||
    lower.includes('purchase was canceled') ||
    lower.includes('user cancelled') ||
    lower.includes('user canceled') ||
    lower.includes('purchase_cancelled')
  );
}

/**
 * Shared purchase-cancellation detection for purchasePackage,
 * purchaseTogetherAnnual and purchaseTogetherMonthly — identical logic
 * previously duplicated only in purchasePackage.
 * PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR === "1". userCancelled is
 * deprecated in SDK 9.x but still reliable as a fallback signal.
 */
function isCancelledPurchaseError(error: unknown): boolean {
  const purchasesError = error as {
    code?: string;
    userCancelled?: boolean;
    message?: string;
  };
  if (purchasesError.code === '1' || purchasesError.userCancelled === true) {
    return true;
  }
  const errorMessage = purchasesError.message ?? '';
  return (
    errorMessage.toLowerCase().includes('cancelled') ||
    errorMessage.toLowerCase().includes('canceled')
  );
}

/**
 * בדיקה האם רצים ב-Expo Go
 */
function isRunningInExpoGo(): boolean {
  try {
    return Constants.executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
}

/**
 * Derives the subscription tier from RevenueCat customerInfo entitlements.
 * Priority: family wins if both personal and family are active.
 */
function getSubscriptionTierFromCustomerInfo(customerInfo: {
  entitlements: { active: Record<string, unknown> };
}): SubscriptionTier {
  if (customerInfo.entitlements.active[FAMILY_ENTITLEMENT_ID] !== undefined) {
    return 'family';
  }
  if (customerInfo.entitlements.active[PERSONAL_ENTITLEMENT_ID] !== undefined) {
    return 'personal';
  }
  return null;
}

/**
 * Returns the store product identifier (e.g. "inyomi_family_annual") that
 * unlocked the currently-active paid entitlement, or null when there is no
 * active paid entitlement. Priority mirrors getSubscriptionTierFromCustomerInfo
 * (family wins over personal if somehow both were active).
 *
 * Used exclusively to derive billing period (annual/monthly) for display —
 * see lib/billingPeriod.ts#getBillingPeriodFromProductIdentifier. Never
 * used to change tier/entitlement logic.
 */
function getActiveEntitlementProductIdentifier(customerInfo: {
  entitlements: { active: Record<string, unknown> };
}): string | null {
  const familyEntitlement = customerInfo.entitlements.active[
    FAMILY_ENTITLEMENT_ID
  ] as { productIdentifier?: string } | undefined;
  if (familyEntitlement?.productIdentifier) {
    return familyEntitlement.productIdentifier;
  }
  const personalEntitlement = customerInfo.entitlements.active[
    PERSONAL_ENTITLEMENT_ID
  ] as { productIdentifier?: string } | undefined;
  if (personalEntitlement?.productIdentifier) {
    return personalEntitlement.productIdentifier;
  }
  return null;
}

/**
 * Legacy backward-compatible check. Returns true if ANY paid entitlement
 * is active (personal, family, or legacy "InYomi Pro").
 */
function checkHasPremium(customerInfo: {
  entitlements: { active: Record<string, unknown> };
}): boolean {
  return (
    getSubscriptionTierFromCustomerInfo(customerInfo) !== null ||
    customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined
  );
}

/**
 * מיפוי סוג חבילה מ-RevenueCat ל-PackageType שלנו
 */
function mapPackageType(
  type: string
): 'monthly' | 'annual' | 'lifetime' | 'unknown' {
  switch (type) {
    case 'MONTHLY':
      return 'monthly';
    case 'ANNUAL':
      return 'annual';
    case 'LIFETIME':
      return 'lifetime';
    default:
      return 'unknown';
  }
}

// ============================================================================
// קונטקסט
// ============================================================================

const RevenueCatContext = createContext<RevenueCatContextType | undefined>(
  undefined
);

// ============================================================================
// ספק (Provider)
// ============================================================================

export function RevenueCatProvider({
  children,
  convexUserId,
}: {
  children: React.ReactNode;
  // Tri-state authenticated Convex identity:
  //   undefined = auth/user identity still resolving — no identity work happens
  //   null      = signed out (or authenticated with no user record)
  //   string    = authenticated stable Convex Id<"users">
  // See app/_layout.tsx's ConvexRevenueCatBridge for how this is derived.
  convexUserId: string | null | undefined;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionTier, setSubscriptionTier] =
    useState<SubscriptionTier>(null);
  const [packages, setPackages] = useState<PackageInfo[]>(PREVIEW_PACKAGES);
  const [togetherOffering, setTogetherOffering] =
    useState<TogetherOfferingState>({
      status: 'loading',
      annual: null,
      monthly: null,
    });
  const [isInitialized, setIsInitialized] = useState(false);
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);

  // ── Identity state (Phase 1) ──────────────────────────────────────────
  const [sdkMode, setSdkMode] = useState<RevenueCatSdkMode>('configuring');
  const [activeRevenueCatUserId, setActiveRevenueCatUserId] = useState<
    string | null
  >(null);
  const [identityGeneration, setIdentityGeneration] = useState(0);
  const [activeListenerGeneration, setActiveListenerGeneration] = useState(0);
  const [identitySyncStatus, setIdentitySyncStatus] = useState<
    'idle' | 'syncing' | 'ready' | 'failed'
  >('idle');
  const [failedForUserId, setFailedForUserId] = useState<string | null>(null);

  // DEBUG ONLY — remove after TestFlight investigation
  const [_debugInfo, _setDebugInfo] = useState<RevenueCatDebugInfo>({
    initError: null,
    offeringsCurrentId: null,
    offeringsPackagesCount: null,
    usingPreviewPackages: true,
    apiKeyPrefix: null,
  });

  const isExpoGo = isRunningInExpoGo();
  const isConfigured = isRevenueCatConfigured();

  // Holds a "remove this listener" closure — never the raw listener itself.
  const listenerRemovalRef = useRef<(() => void) | null>(null);

  // ── Identity refs — authoritative checks inside async callbacks/listeners ──
  const activeRevenueCatUserIdRef = useRef<string | null>(null);
  const identityGenerationRef = useRef(0);
  const activeListenerGenerationRef = useRef(0);
  const failedForUserIdRef = useRef<string | null>(null);
  const logInInFlightRef = useRef(false);

  // ============================================================================
  // עדכון נתוני לקוח מ-CustomerInfo
  // ============================================================================

  // PHASE 1 RACE CORRECTION — every caller MUST pass the identity generation
  // that was current when it decided this CustomerInfo update was worth
  // applying (captured via `identityGenerationRef.current` BEFORE this
  // caller's own await chain started). This function then re-validates that
  // generation against `identityGenerationRef.current` both before doing any
  // work AND again after its own internal await (`Purchases.getAppUserID()`).
  // A superseded generation (logout / account switch / unmount in between)
  // makes this call a complete no-op: isPremium, subscriptionTier and
  // customerData are only ever written together, never partially, and only
  // while `expectedGeneration` is still the live generation. See
  // lib/revenuecat/identityReady.ts#isIdentityGenerationCurrent.
  const updateCustomerData = useCallback(
    async (
      customerInfo: {
        entitlements: { active: Record<string, unknown> };
        activeSubscriptions: string[];
        allPurchasedProductIdentifiers: string[];
        latestExpirationDate: string | null;
        firstSeen: string;
        managementURL: string | null;
      },
      expectedGeneration: number
    ) => {
      const stillCurrent = () =>
        isIdentityGenerationCurrent({
          expectedGeneration,
          currentGeneration: identityGenerationRef.current,
        });

      if (!stillCurrent()) {
        // Superseded before any work started — silent no-op.
        return;
      }

      const hasPremium = checkHasPremium(customerInfo);
      const tier = getSubscriptionTierFromCustomerInfo(customerInfo);
      const activeProductIdentifier =
        getActiveEntitlementProductIdentifier(customerInfo);
      let appUserID: string | null = null;

      try {
        const Purchases = (await import('react-native-purchases')).default;
        appUserID = await Purchases.getAppUserID();
      } catch {
        // שגיאה שקטה - appUserID נשאר null; סטטוס פרימיום/tier עדיין
        // מתעדכנים להלן (בכפוף לבדיקת ה-generation), בהתאם להתנהגות הקודמת.
      }

      // Re-check AFTER the await(s) above — a logout / account switch /
      // unmount may have superseded this generation while awaiting the SDK.
      // isPremium / subscriptionTier / customerData are committed together
      // or not at all — a stale generation may never partially mutate state.
      if (!stillCurrent()) {
        return;
      }

      setIsPremium(hasPremium);
      setSubscriptionTier(tier);
      if (appUserID !== null) {
        setCustomerData({
          appUserID,
          activeEntitlements: Object.keys(customerInfo.entitlements.active),
          allPurchasedProductIdentifiers:
            customerInfo.allPurchasedProductIdentifiers,
          latestExpirationDate: customerInfo.latestExpirationDate,
          firstSeen: customerInfo.firstSeen,
          managementURL: customerInfo.managementURL,
          activeProductIdentifier,
        });
      }
    },
    []
  );

  // ============================================================================
  // אתחול — Purchases.configure + offerings בלבד.
  // אין כאן עוד קריאה ל-getCustomerInfo ואין רישום listener קבוע: נתוני
  // הלקוח מגיעים אך ורק מ-logIn מוצלח (ראו runSyncAttempt למטה) ומה-listener
  // המקושר לזהות שנרשם לאחריו.
  // ============================================================================

  useEffect(() => {
    async function initialize() {
      // Legacy dev mode — isPremium is true for all users, but no real
      // subscription tier is set. useEffectiveAccess falls back to
      // DEV_ACCESS_OVERRIDE or trial_active default. Entirely outside
      // sdkMode/identity — kept exactly as before.
      if (!PAYMENT_SYSTEM_ENABLED) {
        setIsPremium(true);
        setSubscriptionTier(null);
        setIsLoading(false);
        setIsInitialized(true);
        setSdkMode('unavailable');
        return;
      }

      // ב-Expo Go אין גישה למודולים מקוריים
      if (isExpoGo) {
        setPackages(PREVIEW_PACKAGES);
        setIsLoading(false);
        setIsInitialized(true);
        setSdkMode('unavailable');
        return;
      }

      // אם אין מפתחות מוגדרים - עובדים במצב תצוגה מקדימה
      if (!isConfigured) {
        if (!__DEV__) {
          console.error(
            '[RevenueCat] CRITICAL: API key missing in non-DEV build. ' +
              'Payments will not work. Check EAS Environment Variables for ' +
              'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY.'
          );
        }
        setPackages(PREVIEW_PACKAGES);
        setIsLoading(false);
        setIsInitialized(true);
        setSdkMode('unavailable');
        return;
      }

      // שלב 1: הגדרת (configure) ה-SDK של RevenueCat.
      // זהו try/catch נפרד ומכוון: כשל כאן משמעו שה-SDK עצמו לא זמין, ולכן
      // sdkMode הופך ל-"unavailable". כשל ב-getOfferings (שלב 2 להלן) הוא
      // תקלת רשת/קטלוג נפרדת ואינו רשאי לגרום ל-sdkMode "unavailable" — ראו
      // PHASE 1 CORRECTION למעלה.
      try {
        const apiKey = getCurrentPlatformRevenueCatApiKey();
        if (!apiKey) {
          throw new Error('אין מפתח API לפלטפורמה הנוכחית');
        }

        // DEBUG ONLY — capture masked API key prefix
        const maskedKey =
          apiKey.length > 12
            ? `${apiKey.substring(0, 12)}***`
            : `${apiKey.substring(0, 4)}***`;
        _setDebugInfo((prev) => ({ ...prev, apiKeyPrefix: maskedKey }));

        // ייבוא דינמי למניעת קריסות ב-Expo Go
        const Purchases = (await import('react-native-purchases')).default;

        // הגדרת רמת לוג - VERBOSE בפיתוח, INFO בייצור
        await Purchases.setLogLevel(
          __DEV__ ? Purchases.LOG_LEVEL.VERBOSE : Purchases.LOG_LEVEL.ERROR
        );

        // קונפיגורציית SDK - Modern API.
        // appUserID is NOT passed here — it starts anonymous and is bound to
        // the authenticated Convex user afterward via Purchases.logIn() in
        // the identity-transition effect below.
        Purchases.configure({
          apiKey,
        });

        // Override the default log handler so that purchase-cancellation
        // messages (which RevenueCat emits at ERROR level) do NOT reach
        // console.error and trigger the React Native red LogBox.
        // Cancellation is a normal user action, not an application failure.
        // All other log levels, and all genuine error messages, are forwarded
        // using the same routing as the SDK default.
        Purchases.setLogHandler((logLevel, message) => {
          if (
            logLevel === Purchases.LOG_LEVEL.ERROR &&
            isPurchaseCancellationMessage(message)
          ) {
            // Expected user action — only surface in dev builds for diagnostics
            if (__DEV__) {
              console.debug(`[RevenueCat] ${message}`);
            }
            return;
          }
          switch (logLevel) {
            case Purchases.LOG_LEVEL.DEBUG:
              console.debug(`[RevenueCat] ${message}`);
              break;
            case Purchases.LOG_LEVEL.INFO:
              console.info(`[RevenueCat] ${message}`);
              break;
            case Purchases.LOG_LEVEL.WARN:
              console.warn(`[RevenueCat] ${message}`);
              break;
            case Purchases.LOG_LEVEL.ERROR:
              console.error(`[RevenueCat] ${message}`);
              break;
            default:
              console.log(`[RevenueCat] ${message}`);
          }
        });

        // ה-SDK עצמו הוגדר בהצלחה. זהות RevenueCat (Purchases.logIn) יכולה
        // להתחיל להסתנכרן עבור המשתמש המחובר — ראו ה-effect של מעבר זהות
        // למטה. הצלחה כאן אינה תלויה בהצלחת getOfferings.
        setIsInitialized(true);
        setSdkMode('configured');
      } catch (error) {
        // RevenueCat SDK עצמו לא זמין (מפתח שגוי / configure נכשל).
        // DEBUG ONLY — log error instead of silently swallowing it
        console.error('[RevenueCat] configure error:', error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        _setDebugInfo((prev) => ({
          ...prev,
          initError: errorMessage,
          usingPreviewPackages: true,
        }));

        // במקרה של שגיאה - עובדים במצב תצוגה מקדימה
        setPackages(PREVIEW_PACKAGES);
        setIsInitialized(true);
        setSdkMode('unavailable');
        setIsLoading(false);
        return;
      }

      // שלב 2: טעינת ההצעות (Offerings) — לא ספציפי למשתמש, זמין ללא זהות.
      // try/catch נפרד ומכוון: כשל כאן (למשל אין רשת) משאיר את
      // ה-fallback/preview הקיים בתוקף, אך אינו הופך את sdkMode ל-
      // "unavailable" ואינו מונע את סנכרון הזהות (Purchases.logIn) שממשיך
      // לרוץ ב-effect הנפרד למטה.
      try {
        // ייבוא דינמי חדש — module caching בלבד, אין קונפיגורציה חדשה.
        const Purchases = (await import('react-native-purchases')).default;
        const offerings = await Purchases.getOfferings();

        // DEBUG ONLY — capture offerings metadata before checking packages
        _setDebugInfo((prev) => ({
          ...prev,
          offeringsCurrentId: offerings.current?.identifier ?? null,
          offeringsPackagesCount:
            offerings.current?.availablePackages?.length ?? 0,
        }));

        if (offerings.current?.availablePackages) {
          const loadedPackages: PackageInfo[] =
            offerings.current.availablePackages.map((pkg) => ({
              identifier: pkg.identifier,
              priceString: pkg.product.priceString,
              price: pkg.product.price,
              currencyCode: pkg.product.currencyCode,
              title: pkg.product.title,
              description: pkg.product.description,
              packageType: mapPackageType(pkg.packageType),
              product: pkg.product,
              rcPackage: pkg,
            }));
          setPackages(loadedPackages);
          // DEBUG ONLY — real packages loaded, not preview
          _setDebugInfo((prev) => ({ ...prev, usingPreviewPackages: false }));
        }
      } catch (error) {
        // תקלת הצעות/קטלוג (למשל אין רשת) — שומרים על ה-fallback הקיים של
        // חבילות תצוגה מקדימה. sdkMode נשאר "configured": ה-SDK עצמו תקין,
        // וסנכרון הזהות (logIn) ימשיך כרגיל.
        // DEBUG ONLY — log error instead of silently swallowing it
        console.error('[RevenueCat] getOfferings error:', error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        _setDebugInfo((prev) => ({
          ...prev,
          initError: errorMessage,
          usingPreviewPackages: true,
        }));
        setPackages(PREVIEW_PACKAGES);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
    // No cleanup needed here — this effect never registers a listener.
    // Listener lifecycle is owned entirely by the identity-transition effect.
  }, [isExpoGo, isConfigured]);

  // ============================================================================
  // InYomi Together — named-Offering loading (strict, no silent fallback)
  // ============================================================================
  // Deliberately independent of the general offerings.current loader above:
  // this is additive and does not touch the pre-existing `packages` state or
  // any of its consumers. Resolves EXCLUSIVELY from
  // offerings.all[TOGETHER_OFFERING_ID] — if that named Offering is missing,
  // or is missing either of its two expected packages, status becomes
  // 'unavailable' with a development diagnostic log. Never falls back to
  // offerings.current and never displays a hardcoded price.
  // ============================================================================

  const loadTogetherOffering = useCallback(async (): Promise<void> => {
    // Race-condition guard (see lib/revenuecat/togetherOfferingReadiness.ts):
    // `isConfigured` only means an API key is PRESENT — it does NOT mean
    // Purchases.configure() (called once, async, in `initialize()` above)
    // has actually resolved yet. Calling Purchases.getOfferings() before
    // that resolves throws "There is no singleton instance...". `sdkMode`
    // is the correct readiness flag for that and is already used for this
    // exact purpose elsewhere in this file (see computeRevenueCatIsLoading).
    const action = decideTogetherOfferingLoadAction({
      paymentSystemEnabled: PAYMENT_SYSTEM_ENABLED,
      isExpoGo,
      isConfigured,
      sdkMode,
    });

    if (action === 'skip') {
      // Transient — Purchases.configure() hasn't resolved yet. Do NOT call
      // the SDK. Leave the calm 'loading' state in place (set by the effect
      // below before this function runs); the effect re-invokes this
      // callback automatically once sdkMode changes, since sdkMode is now
      // one of this callback's dependencies.
      return;
    }

    if (action === 'setUnavailable') {
      // Either not the real-SDK path at all (payment system disabled / Expo
      // Go / no API key — Purchases attempts already show the existing
      // "מצב פיתוח" / "לא מוגדר" alerts via purchaseTogetherAnnual/
      // purchaseTogetherMonthly below), OR Purchases.configure() itself
      // genuinely failed (sdkMode === 'unavailable') — a real failure, not
      // a transient race. Either way: the honest unavailable/retry state,
      // never a hardcoded price.
      setTogetherOffering({
        status: 'unavailable',
        annual: null,
        monthly: null,
      });
      return;
    }

    try {
      const Purchases = (await import('react-native-purchases')).default;
      const offerings = await Purchases.getOfferings();
      const togetherOfferingData = offerings.all[TOGETHER_OFFERING_ID];

      if (!togetherOfferingData) {
        console.error(
          `[Paywall] Offering '${TOGETHER_OFFERING_ID}' not found. ` +
            `Available offerings: ${Object.keys(offerings.all).join(', ') || 'none'}`
        );
        setTogetherOffering({
          status: 'unavailable',
          annual: null,
          monthly: null,
        });
        return;
      }

      const annualPkg = togetherOfferingData.availablePackages.find(
        (pkg) => pkg.identifier === TOGETHER_PACKAGES.annual
      );
      const monthlyPkg = togetherOfferingData.availablePackages.find(
        (pkg) => pkg.identifier === TOGETHER_PACKAGES.monthly
      );

      if (!(annualPkg && monthlyPkg)) {
        console.error(
          `[Paywall] Offering '${TOGETHER_OFFERING_ID}' is missing expected packages. ` +
            `annual (${TOGETHER_PACKAGES.annual}): ${annualPkg ? 'found' : 'MISSING'}, ` +
            `monthly (${TOGETHER_PACKAGES.monthly}): ${monthlyPkg ? 'found' : 'MISSING'}`
        );
        setTogetherOffering({
          status: 'unavailable',
          annual: null,
          monthly: null,
        });
        return;
      }

      const toPackageInfo = (pkg: PurchasesPackage): PackageInfo => ({
        identifier: pkg.identifier,
        priceString: pkg.product.priceString,
        price: pkg.product.price,
        currencyCode: pkg.product.currencyCode,
        title: pkg.product.title,
        description: pkg.product.description,
        packageType: mapPackageType(pkg.packageType),
        product: pkg.product,
        rcPackage: pkg,
      });

      // DEBUG ONLY — dev-build diagnostic to help verify whether Test Store
      // or real App Store/Sandbox product data was loaded for this named
      // Offering. No secrets: only public catalog/pricing fields the SDK
      // already exposes to this app. Never affects pricing logic or UI.
      if (__DEV__) {
        const describePkg = (pkg: PurchasesPackage) => ({
          packageIdentifier: pkg.identifier,
          productIdentifier: pkg.product.identifier,
          priceString: pkg.product.priceString,
          currencyCode: pkg.product.currencyCode,
          introPrice: pkg.product.introPrice
            ? {
                priceString: pkg.product.introPrice.priceString,
                period: pkg.product.introPrice.period,
                cycles: pkg.product.introPrice.cycles,
              }
            : null,
          presentedOfferingIdentifier:
            pkg.product.presentedOfferingContext?.offeringIdentifier ?? null,
        });
        const currentApiKey = getCurrentPlatformRevenueCatApiKey();
        const apiKeyPrefix = currentApiKey
          ? `${currentApiKey.substring(0, 12)}***`
          : null;
        console.log(
          '[Paywall][DEBUG] Together offering loaded:',
          JSON.stringify(
            {
              apiKeyPrefix,
              offeringIdentifier: togetherOfferingData.identifier,
              annual: describePkg(annualPkg),
              monthly: describePkg(monthlyPkg),
            },
            null,
            2
          )
        );
      }

      setTogetherOffering({
        status: 'ready',
        annual: toPackageInfo(annualPkg),
        monthly: toPackageInfo(monthlyPkg),
      });
    } catch (error) {
      console.error('[Paywall] Failed to load Together offering:', error);
      setTogetherOffering({
        status: 'unavailable',
        annual: null,
        monthly: null,
      });
    }
  }, [isExpoGo, isConfigured, sdkMode]);

  useEffect(() => {
    // Runs on mount AND every time loadTogetherOffering's identity changes
    // (i.e. whenever sdkMode transitions — see its dependency array above).
    // Resetting to 'loading' here is harmless while sdkMode is still
    // 'configuring' (loadTogetherOffering will just skip the SDK call and
    // leave this exact state in place) and is what makes the "configuring
    // -> configured -> offering loads automatically" transition work
    // without any polling or setTimeout: sdkMode flipping is itself the
    // trigger, via the normal React effect/dependency mechanism.
    setTogetherOffering({ status: 'loading', annual: null, monthly: null });
    loadTogetherOffering();
  }, [loadTogetherOffering]);

  // ============================================================================
  // מעבר זהות (identity transition) — מופעל כאשר convexUserId או sdkMode
  // משתנים. אחראי על: ניקוי מיידי של state ישן, הסרת listener קודם, ניהול
  // דורות (generations) למניעת race conditions, וקריאה ל-Purchases.logIn()
  // עבור המשתמש המחובר הנוכחי.
  //
  // Purchases.logOut() אינו נקרא כאן בכוונה (ראו הערת "PHASE 1" בראש הקובץ).
  // ============================================================================

  // Applies CustomerInfo from a successful logIn as the current identity's
  // ready state: active user/generation refs + state, customer data,
  // subscriptionTier/isPremium (via updateCustomerData), clearing any prior
  // failed state, and registering the identity-bound CustomerInfo listener.
  // PHASE 1 RACE CORRECTION — this function no longer marks anything as the
  // active/ready identity (activeRevenueCatUserId / activeListenerGeneration
  // / identitySyncStatus 'ready') up front. Every one of those writes is
  // deferred until AFTER updateCustomerData has resolved AND a listener has
  // been successfully registered AND `thisGeneration` has been re-confirmed
  // current at that exact point. This guarantees the ordering contract in
  // section 7 of the Phase 1 correction: whenever isRevenueCatIdentityReady
  // can become true for `thisGeneration`, valid CustomerInfo state and
  // listener ownership for that same generation are already in place —
  // never before. A generation that is superseded at ANY of the checkpoints
  // below becomes a complete no-op: no listener, no ref/state mutation, no
  // "ready" flag, and any listener it already created is torn down
  // immediately rather than left orphaned.
  const applyResolvedIdentity = useCallback(
    async (userId: string, thisGeneration: number, customerInfo: unknown) => {
      const stillCurrent = () =>
        isIdentityGenerationCurrent({
          expectedGeneration: thisGeneration,
          currentGeneration: identityGenerationRef.current,
        });

      if (!stillCurrent()) {
        return;
      }

      await updateCustomerData(customerInfo as never, thisGeneration);

      // Re-check AFTER updateCustomerData's internal awaits — a newer
      // identity transition may have started while it was in flight. If so,
      // this attempt must never register a listener or become "ready".
      if (!stillCurrent()) {
        return;
      }

      // Register a NEW identity-bound listener, closing over the exact
      // user/generation it belongs to. Stale callbacks from a previous
      // identity are discarded via shouldApplyCustomerInfo.
      const Purchases = (await import('react-native-purchases')).default;

      // Re-check AGAIN immediately after the dynamic import's await and
      // BEFORE registering the listener — the import itself is an await
      // boundary a superseding transition could resolve during.
      if (!stillCurrent()) {
        return;
      }

      const closedUserId = userId;
      const closedGeneration = thisGeneration;
      const listener = (info: unknown) => {
        const shouldApply = shouldApplyCustomerInfo({
          closedUserId,
          closedGeneration,
          currentActiveUserId: activeRevenueCatUserIdRef.current,
          currentIdentityGeneration: identityGenerationRef.current,
          currentListenerGeneration: activeListenerGenerationRef.current,
        });
        if (!shouldApply) {
          return;
        }
        updateCustomerData(info as never, closedGeneration);
      };
      Purchases.addCustomerInfoUpdateListener(listener);

      // Nothing above this point awaits again, so this final commit is
      // atomic with the registration: no window remains where a superseding
      // transition could run between "listener registered" and "ownership
      // committed" — a stale attempt can never overwrite a newer
      // generation's ref/state or its listenerRemovalRef.
      activeRevenueCatUserIdRef.current = userId;
      activeListenerGenerationRef.current = thisGeneration;
      listenerRemovalRef.current = () => {
        Purchases.removeCustomerInfoUpdateListener(listener);
      };
      setActiveRevenueCatUserId(userId);
      setActiveListenerGeneration(thisGeneration);
      setIdentitySyncStatus('ready');
      failedForUserIdRef.current = null;
      setFailedForUserId(null);
    },
    [updateCustomerData]
  );

  const runSyncAttempt = useCallback(
    async (userId: string, thisGeneration: number) => {
      logInInFlightRef.current = true;
      setIdentitySyncStatus('syncing');

      try {
        const Purchases = (await import('react-native-purchases')).default;
        const logInResult = await Purchases.logIn(userId);

        if (identityGenerationRef.current !== thisGeneration) {
          // A newer identity transition has already superseded this attempt.
          return;
        }

        await applyResolvedIdentity(
          userId,
          thisGeneration,
          logInResult.customerInfo
        );
      } catch (error) {
        if (identityGenerationRef.current !== thisGeneration) {
          // Stale failure from a superseded attempt — discard.
          return;
        }

        const errorCode = (error as { code?: string } | undefined)?.code;
        console.warn('[RevenueCat] logIn failed', {
          identityGeneration: thisGeneration,
          code: errorCode,
        });

        activeRevenueCatUserIdRef.current = null;
        activeListenerGenerationRef.current = 0;
        setActiveRevenueCatUserId(null);
        setActiveListenerGeneration(0);
        setIdentitySyncStatus('failed');
        failedForUserIdRef.current = userId;
        setFailedForUserId(userId);
      } finally {
        if (identityGenerationRef.current === thisGeneration) {
          logInInFlightRef.current = false;
        }
      }
    },
    [applyResolvedIdentity]
  );

  useEffect(() => {
    // Every run of this effect (convexUserId or sdkMode changed) represents
    // a new identity generation. Invalidate everything first.
    activeRevenueCatUserIdRef.current = null;
    activeListenerGenerationRef.current = 0;
    identityGenerationRef.current += 1;
    const thisGeneration = identityGenerationRef.current;
    logInInFlightRef.current = false;

    setActiveRevenueCatUserId(null);
    setActiveListenerGeneration(0);
    setIdentityGeneration(thisGeneration);
    setIsPremium(false);
    setSubscriptionTier(null);
    setCustomerData(null);
    setIdentitySyncStatus('idle');
    failedForUserIdRef.current = null;
    setFailedForUserId(null);

    if (typeof convexUserId === 'string' && sdkMode === 'configured') {
      // Authenticated + SDK ready — start a sync attempt.
      // (undefined convexUserId => still resolving, WAIT.
      //  null convexUserId => signed out, nothing more to do.
      //  sdkMode === 'configuring' => WAIT; this effect re-runs once sdkMode
      //  flips to 'configured' because sdkMode is a dependency below.
      //  sdkMode === 'unavailable' => no logIn, per section 6 rules.)
      runSyncAttempt(convexUserId, thisGeneration);
    }

    return () => {
      // Runs before the next invocation of this effect AND on unmount.
      // Removing the listener here (rather than at the top of the effect
      // body) means a fresh run always starts with no listener attached.
      if (listenerRemovalRef.current) {
        listenerRemovalRef.current();
        listenerRemovalRef.current = null;
      }
      // Bump the generation again so any logIn promise already in flight
      // (from this run, or from React StrictMode's double-invocation) is
      // discarded by runSyncAttempt's generation check, including on
      // unmount.
      identityGenerationRef.current += 1;
    };
  }, [convexUserId, sdkMode, runSyncAttempt]);

  // ============================================================================
  // Foreground retry — retries a failed logIn for the CURRENT user only,
  // once per transition into "active". Never uses a stale closure: the
  // subscription is torn down and re-registered whenever the values the
  // retry condition depends on change, and previousAppState is (re)seeded
  // from AppState.currentState on every (re)registration so a transition is
  // neither missed nor invented.
  // ============================================================================

  useEffect(() => {
    let previousAppState: AppStateStatus = AppState.currentState;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const cameToForeground =
        /inactive|background/.test(previousAppState) &&
        nextAppState === 'active';
      previousAppState = nextAppState;

      if (!cameToForeground) {
        return;
      }

      if (
        typeof convexUserId === 'string' &&
        sdkMode === 'configured' &&
        identitySyncStatus === 'failed' &&
        failedForUserIdRef.current === convexUserId &&
        !logInInFlightRef.current
      ) {
        identityGenerationRef.current += 1;
        const thisGeneration = identityGenerationRef.current;
        setIdentityGeneration(thisGeneration);
        runSyncAttempt(convexUserId, thisGeneration);
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange
    );

    return () => {
      subscription.remove();
    };
  }, [convexUserId, sdkMode, identitySyncStatus, runSyncAttempt]);

  // ============================================================================
  // Render-time identity readiness + safe exposure gating
  // ============================================================================

  const isIdentityReady =
    sdkMode === 'configured' &&
    isRevenueCatIdentityReady({
      convexUserId,
      activeRevenueCatUserId,
      activeListenerGeneration,
      identityGeneration,
    });

  // The real, identity-aware SDK path. MOCK_PAYMENTS is kept entirely
  // outside this gate — its behavior is unchanged (see section 18 of the
  // Phase 1 spec): while MOCK_PAYMENTS is on, exposed values pass straight
  // through from the underlying state, exactly as before this phase.
  const rcSdkActive =
    !MOCK_PAYMENTS && PAYMENT_SYSTEM_ENABLED && !isExpoGo && isConfigured;

  const exposedIsPremium = rcSdkActive
    ? isIdentityReady && isPremium
    : isPremium;
  const exposedSubscriptionTier = rcSdkActive
    ? isIdentityReady
      ? subscriptionTier
      : null
    : subscriptionTier;
  const exposedCustomerData = rcSdkActive
    ? isIdentityReady
      ? customerData
      : null
    : customerData;
  const exposedIsLoading = rcSdkActive
    ? computeRevenueCatIsLoading({
        sdkMode,
        convexUserId,
        isIdentityReady,
        failedForUserId,
      })
    : isLoading;

  // ============================================================================
  // רכישת חבילה
  // ============================================================================

  const purchasePackage = useCallback(
    async (packageId: string): Promise<boolean> => {
      // מצב רכישות מדומות
      if (MOCK_PAYMENTS) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setIsPremium(true);
        Alert.alert('הצלחה', 'הרכישה הושלמה בהצלחה (מצב בדיקה)');
        return true;
      }

      // Expo Go - לא ניתן לבצע רכישות
      if (isExpoGo) {
        Alert.alert(
          'מצב פיתוח',
          'רכישות לא זמינות ב-Expo Go.\n\nכדי לבדוק רכישות אמיתיות, בנה גרסת פיתוח (development build).'
        );
        return false;
      }

      // אין מפתחות מוגדרים
      if (!isConfigured) {
        Alert.alert(
          'לא מוגדר',
          'מפתחות RevenueCat לא מוגדרים.\n\nהגדר את המפתחות ב-.env כדי לאפשר רכישות.'
        );
        return false;
      }

      // Identity guard (Phase 1) — refuse to purchase against a wrong or
      // unresolved RevenueCat identity. No alert: this is a silent, expected
      // block during a brief identity transition, not a user-facing error.
      if (!isIdentityReady) {
        return false;
      }

      // Captured NOW (before this function's own await chain) — the
      // generation this purchase is authorized under. Passed to
      // updateCustomerData below so a logout/account-switch mid-purchase
      // cannot write this purchase's CustomerInfo into a different identity.
      const expectedGeneration = identityGenerationRef.current;

      try {
        const Purchases = (await import('react-native-purchases')).default;
        const offerings = await Purchases.getOfferings();
        const packageToPurchase = offerings.current?.availablePackages.find(
          (pkg) => pkg.identifier === packageId
        );

        if (!packageToPurchase) {
          throw new Error(`חבילה ${packageId} לא נמצאה`);
        }

        const { customerInfo } =
          await Purchases.purchasePackage(packageToPurchase);
        await updateCustomerData(customerInfo as never, expectedGeneration);
        const hasPremium = checkHasPremium(customerInfo);

        return hasPremium;
      } catch (error: unknown) {
        if (isCancelledPurchaseError(error)) {
          // Cancellation is a normal user action — no alert, no error log.
          return false;
        }

        Alert.alert('שגיאה', 'הרכישה נכשלה. אנא נסה שוב.');
        return false;
      }
    },
    [isExpoGo, isConfigured, isIdentityReady, updateCustomerData]
  );

  // ============================================================================
  // שחזור רכישות
  // ============================================================================

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    // מצב רכישות מדומות
    if (MOCK_PAYMENTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      Alert.alert('שחזור', 'לא נמצאו רכישות קודמות (מצב בדיקה)');
      return false;
    }

    // Expo Go
    if (isExpoGo) {
      Alert.alert('מצב פיתוח', 'שחזור רכישות לא זמין ב-Expo Go.');
      return false;
    }

    // אין מפתחות
    if (!isConfigured) {
      Alert.alert('לא מוגדר', 'מפתחות RevenueCat לא מוגדרים.');
      return false;
    }

    // Identity guard (Phase 1) — see purchasePackage above.
    if (!isIdentityReady) {
      return false;
    }

    // Captured NOW — see purchasePackage above for why.
    const expectedGeneration = identityGenerationRef.current;

    try {
      const Purchases = (await import('react-native-purchases')).default;
      const customerInfo = await Purchases.restorePurchases();
      await updateCustomerData(customerInfo as never, expectedGeneration);
      const hasPremium = checkHasPremium(customerInfo);

      if (hasPremium) {
        Alert.alert('הצלחה', 'הרכישות שוחזרו בהצלחה! 🎉');
      } else {
        Alert.alert('שחזור', 'לא נמצאו רכישות קודמות.');
      }

      return hasPremium;
    } catch (_error) {
      Alert.alert('שגיאה', 'שחזור הרכישות נכשל. אנא נסה שוב.');
      return false;
    }
  }, [isExpoGo, isConfigured, isIdentityReady, updateCustomerData]);

  // ============================================================================
  // InYomi Together — purchase actions
  // ============================================================================
  // Guard ordering (MOCK_PAYMENTS → Expo Go → not configured → identity →
  // offering readiness) mirrors purchasePackage above exactly, for the same
  // reasons documented there.
  //
  // Android annual is CRITICAL: displayed pricing must always match the
  // exact SubscriptionOption purchased. resolveAndroidAnnualOffer (pure,
  // lib/revenuecat/androidOfferResolution.ts) is called here with the SAME
  // `product` object the paywall screen uses to render pricing, guaranteeing
  // display == checkout. purchasePackage() is intentionally NEVER used for
  // Android annual — it would delegate to RC's `defaultOption` heuristic,
  // which could silently select a different eligible offer in the future.
  // ============================================================================

  const purchaseTogetherAnnual = useCallback(async (): Promise<boolean> => {
    if (MOCK_PAYMENTS) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setIsPremium(true);
      Alert.alert('הצלחה', 'הרכישה הושלמה בהצלחה (מצב בדיקה)');
      return true;
    }

    if (isExpoGo) {
      Alert.alert(
        'מצב פיתוח',
        'רכישות לא זמינות ב-Expo Go.\n\nכדי לבדוק רכישות אמיתיות, בנה גרסת פיתוח (development build).'
      );
      return false;
    }

    if (!isConfigured) {
      Alert.alert(
        'לא מוגדר',
        'מפתחות RevenueCat לא מוגדרים.\n\nהגדר את המפתחות ב-.env כדי לאפשר רכישות.'
      );
      return false;
    }

    if (!isIdentityReady) {
      return false;
    }

    if (togetherOffering.status !== 'ready') {
      return false;
    }

    // Captured NOW — see purchasePackage above for why.
    const expectedGeneration = identityGenerationRef.current;

    const { annual } = togetherOffering;

    try {
      const Purchases = (await import('react-native-purchases')).default;

      if (Platform.OS === 'android') {
        if (!annual.product) {
          return false;
        }
        const resolution = resolveAndroidAnnualOffer(annual.product);
        if (!resolution) {
          Alert.alert('שגיאה', 'הרכישה נכשלה. אנא נסה שוב.');
          return false;
        }
        const { customerInfo } = await Purchases.purchaseSubscriptionOption(
          resolution.option
        );
        await updateCustomerData(customerInfo as never, expectedGeneration);
        return checkHasPremium(customerInfo);
      }

      // iOS — the store automatically applies the intro offer for eligible
      // users when purchasing the package; eligibility for DISPLAY is
      // determined separately via checkTogetherAnnualIntroEligibility.
      if (!annual.rcPackage) {
        return false;
      }
      const { customerInfo } = await Purchases.purchasePackage(
        annual.rcPackage
      );
      await updateCustomerData(customerInfo as never, expectedGeneration);
      return checkHasPremium(customerInfo);
    } catch (error: unknown) {
      if (isCancelledPurchaseError(error)) {
        return false;
      }
      Alert.alert('שגיאה', 'הרכישה נכשלה. אנא נסה שוב.');
      return false;
    }
  }, [
    isExpoGo,
    isConfigured,
    isIdentityReady,
    togetherOffering,
    updateCustomerData,
  ]);

  const purchaseTogetherMonthly = useCallback(async (): Promise<boolean> => {
    if (MOCK_PAYMENTS) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setIsPremium(true);
      Alert.alert('הצלחה', 'הרכישה הושלמה בהצלחה (מצב בדיקה)');
      return true;
    }

    if (isExpoGo) {
      Alert.alert(
        'מצב פיתוח',
        'רכישות לא זמינות ב-Expo Go.\n\nכדי לבדוק רכישות אמיתיות, בנה גרסת פיתוח (development build).'
      );
      return false;
    }

    if (!isConfigured) {
      Alert.alert(
        'לא מוגדר',
        'מפתחות RevenueCat לא מוגדרים.\n\nהגדר את המפתחות ב-.env כדי לאפשר רכישות.'
      );
      return false;
    }

    if (!isIdentityReady) {
      return false;
    }

    if (
      togetherOffering.status !== 'ready' ||
      !togetherOffering.monthly.rcPackage
    ) {
      return false;
    }

    // Captured NOW — see purchasePackage above for why.
    const expectedGeneration = identityGenerationRef.current;

    try {
      const Purchases = (await import('react-native-purchases')).default;
      const { customerInfo } = await Purchases.purchasePackage(
        togetherOffering.monthly.rcPackage
      );
      await updateCustomerData(customerInfo as never, expectedGeneration);
      return checkHasPremium(customerInfo);
    } catch (error: unknown) {
      if (isCancelledPurchaseError(error)) {
        return false;
      }
      Alert.alert('שגיאה', 'הרכישה נכשלה. אנא נסה שוב.');
      return false;
    }
  }, [
    isExpoGo,
    isConfigured,
    isIdentityReady,
    togetherOffering,
    updateCustomerData,
  ]);

  // ============================================================================
  // InYomi Together — iOS intro-price eligibility
  // ============================================================================
  // Android always returns INTRO_ELIGIBILITY_STATUS_UNKNOWN from this SDK
  // API (confirmed in the installed react-native-purchases 9.7.6 typings'
  // documentation comment) — Android eligibility for DISPLAY purposes is
  // instead derived by the paywall screen calling resolveAndroidAnnualOffer
  // directly on togetherOffering.annual.product (hasLaunchOffer flag).
  // ============================================================================

  const checkTogetherAnnualIntroEligibility =
    useCallback(async (): Promise<IntroEligibilityResult> => {
      if (MOCK_PAYMENTS || isExpoGo || !isConfigured) {
        return 'UNKNOWN';
      }
      if (Platform.OS !== 'ios') {
        return 'UNKNOWN';
      }
      if (
        togetherOffering.status !== 'ready' ||
        !togetherOffering.annual.product
      ) {
        return 'UNKNOWN';
      }

      const productIdentifier = togetherOffering.annual.product.identifier;

      try {
        const Purchases = (await import('react-native-purchases')).default;
        const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(
          [productIdentifier]
        );
        const status = result[productIdentifier]?.status;

        // DEBUG ONLY — dev-build diagnostic: raw eligibility result plus
        // whether the store actually returned an introPrice for this
        // product. Never used to alter eligibility/UI logic.
        if (__DEV__) {
          console.log(
            '[Paywall][DEBUG] checkTrialOrIntroductoryPriceEligibility:',
            JSON.stringify(
              {
                productIdentifier,
                rawStatus: status,
                rawDescription: result[productIdentifier]?.description ?? null,
                hasIntroPrice: Boolean(
                  togetherOffering.status === 'ready' &&
                    togetherOffering.annual.product?.introPrice
                ),
                introPrice:
                  togetherOffering.status === 'ready'
                    ? togetherOffering.annual.product?.introPrice
                    : null,
                regularPriceString:
                  togetherOffering.status === 'ready'
                    ? togetherOffering.annual.product?.priceString
                    : null,
                currencyCode:
                  togetherOffering.status === 'ready'
                    ? togetherOffering.annual.product?.currencyCode
                    : null,
              },
              null,
              2
            )
          );
        }

        switch (status) {
          case Purchases.INTRO_ELIGIBILITY_STATUS
            .INTRO_ELIGIBILITY_STATUS_ELIGIBLE:
            return 'ELIGIBLE';
          case Purchases.INTRO_ELIGIBILITY_STATUS
            .INTRO_ELIGIBILITY_STATUS_INELIGIBLE:
            return 'INELIGIBLE';
          case Purchases.INTRO_ELIGIBILITY_STATUS
            .INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS:
            return 'NO_INTRO_OFFER_EXISTS';
          default:
            return 'UNKNOWN';
        }
      } catch (error) {
        console.error(
          '[Paywall] checkTrialOrIntroductoryPriceEligibility failed:',
          error
        );
        return 'UNKNOWN';
      }
    }, [isExpoGo, isConfigured, togetherOffering]);

  // ============================================================================
  // רענון מידע רוכש
  // ============================================================================

  const refreshPurchaserInfo = useCallback(async () => {
    if (!isConfigured || isExpoGo || !isInitialized) {
      return;
    }

    // Identity guard (Phase 1) — see purchasePackage above.
    if (!isIdentityReady) {
      return;
    }

    // Captured NOW — see purchasePackage above for why.
    const expectedGeneration = identityGenerationRef.current;

    try {
      const Purchases = (await import('react-native-purchases')).default;
      const customerInfo = await Purchases.getCustomerInfo();
      await updateCustomerData(customerInfo as never, expectedGeneration);
    } catch (_error) {
      // שגיאה בשקט - לא צריך להציג למשתמש
    }
  }, [
    isConfigured,
    isExpoGo,
    isInitialized,
    isIdentityReady,
    updateCustomerData,
  ]);

  // ============================================================================
  // RevenueCat Paywall - הצגת מסך תשלום native
  // ============================================================================

  const presentPaywall = useCallback(async (): Promise<boolean> => {
    // מצב רכישות מדומות
    if (MOCK_PAYMENTS) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setIsPremium(true);
      Alert.alert('הצלחה', 'הרכישה הושלמה בהצלחה (מצב בדיקה)');
      return true;
    }

    // Expo Go - לא ניתן להציג paywall native
    if (isExpoGo) {
      Alert.alert(
        'מצב פיתוח',
        'מסך תשלום מקורי לא זמין ב-Expo Go.\n\nכדי לבדוק, בנה גרסת פיתוח.'
      );
      return false;
    }

    if (!isConfigured) {
      Alert.alert('לא מוגדר', 'מפתחות RevenueCat לא מוגדרים.');
      return false;
    }

    // Identity guard (Phase 1) — see purchasePackage above.
    if (!isIdentityReady) {
      return false;
    }

    try {
      const RevenueCatUI = (await import('react-native-purchases-ui')).default;
      const result = await RevenueCatUI.presentPaywall({
        displayCloseButton: true,
      });

      // בדיקת תוצאה - PURCHASED או RESTORED = הצלחה
      if (
        result === RevenueCatUI.PAYWALL_RESULT.PURCHASED ||
        result === RevenueCatUI.PAYWALL_RESULT.RESTORED
      ) {
        await refreshPurchaserInfo();
        return true;
      }

      return false;
    } catch (_error) {
      Alert.alert('שגיאה', 'אירעה שגיאה בהצגת מסך התשלום.');
      return false;
    }
  }, [isExpoGo, isConfigured, isIdentityReady, refreshPurchaserInfo]);

  // ============================================================================
  // RevenueCat Paywall If Needed - מציג רק אם אין entitlement
  // ============================================================================

  const presentPaywallIfNeeded = useCallback(async (): Promise<boolean> => {
    // מצב רכישות מדומות — נבדק תמיד ראשון, ללא שינוי: אינו נוגע ב-SDK
    // האמיתי או בזהות RevenueCat כלל.
    if (MOCK_PAYMENTS) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setIsPremium(true);
      Alert.alert('הצלחה', 'הרכישה הושלמה בהצלחה (מצב בדיקה)');
      return true;
    }

    // Expo Go — fallback קיים, ללא שינוי, אינו נוגע ב-SDK האמיתי.
    if (isExpoGo) {
      Alert.alert(
        'מצב פיתוח',
        'מסך תשלום מקורי לא זמין ב-Expo Go.\n\nכדי לבדוק, בנה גרסת פיתוח.'
      );
      return false;
    }

    // אין מפתחות מוגדרים — fallback קיים, ללא שינוי.
    if (!isConfigured) {
      Alert.alert('לא מוגדר', 'מפתחות RevenueCat לא מוגדרים.');
      return false;
    }

    // מכאן ואילך אנחנו על מסלול ה-SDK האמיתי (real RevenueCat SDK path).
    // Identity guard (Phase 1 correction) — MUST run BEFORE trusting the raw
    // isPremium shortcut below. If identity is not ready (e.g. mid A -> B
    // sign-out/sign-in transition), refuse silently with ZERO
    // customer-specific RevenueCat calls and no stale-user Premium result.
    // See lib/revenuecat/identityReady.ts for isIdentityReady's derivation.
    if (!isIdentityReady) {
      return false;
    }

    // אם כבר פרימיום - לא צריך להציג (legacy check — semantics unchanged,
    // still reads the raw isPremium state — but now only reachable once the
    // CURRENT RevenueCat identity has been confirmed ready above, so a
    // stale previous user's isPremium can never leak into this shortcut).
    if (isPremium) {
      return true;
    }

    try {
      const RevenueCatUI = (await import('react-native-purchases-ui')).default;
      const result = await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: ENTITLEMENT_ID,
        displayCloseButton: true,
      });

      if (
        result === RevenueCatUI.PAYWALL_RESULT.PURCHASED ||
        result === RevenueCatUI.PAYWALL_RESULT.RESTORED
      ) {
        await refreshPurchaserInfo();
        return true;
      }

      return false;
    } catch (_error) {
      Alert.alert('שגיאה', 'אירעה שגיאה בהצגת מסך התשלום.');
      return false;
    }
  }, [
    isPremium,
    isExpoGo,
    isConfigured,
    isIdentityReady,
    refreshPurchaserInfo,
  ]);

  // ============================================================================
  // Customer Center - ניהול מנויים
  // ============================================================================

  const presentCustomerCenter = useCallback(async () => {
    // Expo Go
    if (isExpoGo) {
      Alert.alert(
        'מצב פיתוח',
        'Customer Center לא זמין ב-Expo Go.\n\nכדי לבדוק, בנה גרסת פיתוח.'
      );
      return;
    }

    if (!isConfigured) {
      Alert.alert('לא מוגדר', 'מפתחות RevenueCat לא מוגדרים.');
      return;
    }

    // Identity guard (Phase 1) — see purchasePackage above.
    if (!isIdentityReady) {
      return;
    }

    // Captured NOW — the native Customer Center UI stays open for as long
    // as the user interacts with it, so this callback may fire long after
    // entry; the captured generation lets updateCustomerData reject it if a
    // logout/account-switch happened while the sheet was open.
    const expectedGeneration = identityGenerationRef.current;

    try {
      const RevenueCatUI = (await import('react-native-purchases-ui')).default;
      await RevenueCatUI.presentCustomerCenter({
        callbacks: {
          onRestoreCompleted: ({ customerInfo }) => {
            updateCustomerData(customerInfo as never, expectedGeneration);
            Alert.alert('הצלחה', 'הרכישות שוחזרו בהצלחה!');
          },
          onRestoreFailed: () => {
            Alert.alert('שגיאה', 'שחזור הרכישות נכשל.');
          },
        },
      });
    } catch (_error) {
      // Fallback chain if the native Customer Center UI itself fails to
      // present (e.g. unsupported RC dashboard config): prefer RevenueCat's
      // own `managementURL` — it already points to the exact correct
      // destination (App Store subscription management for an iOS
      // purchase, Google Play subscription management for an Android
      // purchase) for THIS customer's active subscription, no guessing or
      // hardcoded store URLs. Only when that isn't available do we fall
      // back to the iOS-only native `showManageSubscriptions()` helper, and
      // finally a calm explanatory alert — never the sales paywall.
      try {
        if (customerData?.managementURL) {
          await Linking.openURL(customerData.managementURL);
        } else if (Platform.OS === 'ios') {
          const Purchases = (await import('react-native-purchases')).default;
          await Purchases.showManageSubscriptions();
        } else {
          Alert.alert(
            'ניהול מנוי',
            'כדי לנהל את המנוי שלך, פתח את הגדרות חנות Google Play.'
          );
        }
      } catch {
        Alert.alert('שגיאה', 'אירעה שגיאה בפתיחת ניהול המנויים.');
      }
    }
  }, [
    isExpoGo,
    isConfigured,
    isIdentityReady,
    updateCustomerData,
    customerData,
  ]);

  // ============================================================================
  // רינדור
  // ============================================================================

  const isPersonal =
    exposedSubscriptionTier === 'personal' ||
    exposedSubscriptionTier === 'family';
  const isFamily = exposedSubscriptionTier === 'family';

  return (
    <RevenueCatContext.Provider
      value={{
        isLoading: exposedIsLoading,
        isPremium: exposedIsPremium,
        isConfigured,
        isExpoGo,
        subscriptionTier: exposedSubscriptionTier,
        isPersonal,
        isFamily,
        packages,
        togetherOffering,
        refreshTogetherOffering: loadTogetherOffering,
        purchaseTogetherAnnual,
        purchaseTogetherMonthly,
        checkTogetherAnnualIntroEligibility,
        customerData: exposedCustomerData,
        purchasePackage,
        restorePurchases,
        refreshPurchaserInfo,
        presentPaywall,
        presentPaywallIfNeeded,
        presentCustomerCenter,
        // DEBUG ONLY — remove after TestFlight investigation
        _debug: _debugInfo,
      }}
    >
      {children}
    </RevenueCatContext.Provider>
  );
}

// ============================================================================
// הוק (Hook)
// ============================================================================

export function useRevenueCat() {
  const context = useContext(RevenueCatContext);
  if (context === undefined) {
    throw new Error('useRevenueCat חייב להיות בשימוש בתוך RevenueCatProvider');
  }
  return context;
}
