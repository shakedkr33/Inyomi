// ============================================================================
// InYomi Together — Custom Paywall
// ============================================================================
// Custom React Native paywall for the single "InYomi Together" subscription
// (Annual default / Monthly secondary). RevenueCat remains the backend for
// products, prices, purchases, CustomerInfo, entitlements and restore — this
// screen never talks to the store directly.
//
// Packages are resolved EXCLUSIVELY from the named RevenueCat Offering
// `launch30_2026` (see contexts/RevenueCatContext.tsx `togetherOffering` +
// utils/revenueCatConfig.ts TOGETHER_OFFERING_ID) — never from
// `offerings.current`, and never with a hardcoded price/currency symbol.
//
// "InYomi Together" is the marketing name only; internally this continues to
// purchase the existing family_annual / family_monthly store products.
// ============================================================================

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WebViewModal } from '@/components/WebViewModal';
import { COUPON_FLOW_ENABLED } from '@/config/appConfig';
import { useRevenueCat } from '@/contexts/RevenueCatContext';
import { formatCurrency } from '@/lib/formatCurrency';
import {
  type AndroidAnnualResolution,
  resolveAndroidAnnualOffer,
} from '@/lib/revenuecat/androidOfferResolution';
import { calculateDiscountPercent } from '@/lib/revenuecat/discount';
import { iconTransform, rtl } from '@/lib/rtl';
import { SUBSCRIPTION_STRINGS as STR } from '@/lib/subscriptionStrings';

// ─── Constants ──────────────────────────────────────────────────────────────

const BRAND_COLOR = '#00668E';
const BRAND_COLOR_TINT = '#EAF2F5';
const BG = '#FBFCFD';
const TEXT_DARK = '#171B1E';
const TEXT_MUTED = '#6B7684';
const CHECK_BG = '#E3EEF2';
// Subtle border for the compact billing segmented control only (see
// `segmentedControl` style below) — not used anywhere else on this screen.
const SEGMENT_BORDER = '#E2E6EA';

const heroImage = require('@/assets/images/paywall-hero.jpg');

// Legal links shown in the paywall footer. Scoped to this screen only —
// see config/appConfig.ts TERMS_URL / PRIVACY_URL for the app-wide defaults
// used elsewhere (e.g. app/(auth)/paywall/index.tsx), which are untouched.
const TOGETHER_TERMS_URL = 'https://inyomi.com/terms';
const TOGETHER_PRIVACY_URL = 'https://inyomi.com/privacy';

// benefit3 ("תזכורות לכל הדברים החשובים") is intentionally not rendered —
// removed from the on-screen list per UI-polish request to fit the paywall
// on one viewport. The key stays defined in subscriptionStrings.ts (and its
// approved-copy test) so no i18n/content-module changes are needed here.
const BENEFITS: string[] = [
  STR.benefit1,
  STR.benefit2,
  STR.benefit4,
  STR.benefit5,
];

type BillingCycle = 'annual' | 'monthly';

// iOS-only introductory-eligibility result, plus a local 'loading' state
// while checkTogetherAnnualIntroEligibility() resolves. Android eligibility
// is derived synchronously from the resolved SubscriptionOption instead —
// see androidResolution below.
type IosEligibilityState =
  | 'loading'
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'UNKNOWN'
  | 'NO_INTRO_OFFER_EXISTS';

type AnnualPricingViewModel = {
  isEligible: boolean;
  regularPriceString: string;
  introPriceString: string | null;
  monthlyEquivalentString: string | null;
  discountPercent: number | null;
};

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const router = useRouter();
  const {
    togetherOffering,
    refreshTogetherOffering,
    purchaseTogetherAnnual,
    purchaseTogetherMonthly,
    checkTogetherAnnualIntroEligibility,
    restorePurchases,
  } = useRevenueCat();

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual');
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [iosEligibility, setIosEligibility] =
    useState<IosEligibilityState>('loading');

  // Segmented billing-cycle control — a single Animated.Value drives a
  // crossfade of the brand-color fill between the two segments (opacity
  // only, so it's safe with useNativeDriver). 1 = annual segment filled,
  // 0 = monthly segment filled. This is purely visual; it does not affect
  // billingCycle (the state that actually drives which price block/
  // purchase path is used below — untouched).
  const segmentFillAnim = useRef(
    new Animated.Value(billingCycle === 'annual' ? 1 : 0)
  ).current;

  useEffect(() => {
    Animated.timing(segmentFillAnim, {
      toValue: billingCycle === 'annual' ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [billingCycle, segmentFillAnim]);

  const monthlyFillAnim = segmentFillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  // Re-check iOS intro eligibility whenever the Together offering becomes
  // ready (including after a retry). Android never uses this API — the SDK
  // always returns UNKNOWN for Android per the installed 9.7.6 typings.
  useEffect(() => {
    let isMounted = true;
    if (Platform.OS === 'ios' && togetherOffering.status === 'ready') {
      setIosEligibility('loading');
      checkTogetherAnnualIntroEligibility().then((result) => {
        if (isMounted) {
          setIosEligibility(result);
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [togetherOffering.status, checkTogetherAnnualIntroEligibility]);

  // Android annual SubscriptionOption resolution — the SAME pure function
  // used by RevenueCatContext.purchaseTogetherAnnual on the SAME `product`
  // object, guaranteeing displayed price == purchased option.
  const androidResolution = useMemo<AndroidAnnualResolution | null>(() => {
    if (Platform.OS !== 'android') {
      return null;
    }
    if (togetherOffering.status !== 'ready') {
      return null;
    }
    if (!togetherOffering.annual.product) {
      return null;
    }
    return resolveAndroidAnnualOffer(togetherOffering.annual.product);
  }, [togetherOffering]);

  const annualPricing = useMemo<AnnualPricingViewModel | null>(() => {
    if (togetherOffering.status !== 'ready') {
      return null;
    }
    const { product } = togetherOffering.annual;
    if (!product) {
      return null;
    }

    if (Platform.OS === 'android') {
      if (!androidResolution?.fullPricePhase) {
        return null;
      }
      const regularPhase = androidResolution.fullPricePhase;
      if (androidResolution.hasLaunchOffer && androidResolution.introPhase) {
        const introPhase = androidResolution.introPhase;
        const introAmount = introPhase.price.amountMicros / 1_000_000;
        const regularAmount = regularPhase.price.amountMicros / 1_000_000;
        return {
          isEligible: true,
          regularPriceString: regularPhase.price.formatted,
          introPriceString: introPhase.price.formatted,
          monthlyEquivalentString: formatCurrency(
            introAmount / 12,
            introPhase.price.currencyCode
          ),
          discountPercent: calculateDiscountPercent(introAmount, regularAmount),
        };
      }
      return {
        isEligible: false,
        regularPriceString: regularPhase.price.formatted,
        introPriceString: null,
        monthlyEquivalentString: null,
        discountPercent: null,
      };
    }

    // iOS
    if (iosEligibility === 'loading') {
      return null;
    }
    if (iosEligibility === 'ELIGIBLE' && product.introPrice) {
      const { introPrice } = product;
      return {
        isEligible: true,
        regularPriceString: product.priceString,
        introPriceString: introPrice.priceString,
        monthlyEquivalentString: formatCurrency(
          introPrice.price / 12,
          product.currencyCode
        ),
        discountPercent: calculateDiscountPercent(
          introPrice.price,
          product.price
        ),
      };
    }
    return {
      isEligible: false,
      regularPriceString: product.priceString,
      introPriceString: null,
      monthlyEquivalentString: null,
      discountPercent: null,
    };
  }, [togetherOffering, androidResolution, iosEligibility]);

  const monthlyPriceString =
    togetherOffering.status === 'ready'
      ? togetherOffering.monthly.priceString
      : null;

  const isPricingReady =
    togetherOffering.status === 'ready' &&
    (billingCycle === 'monthly'
      ? monthlyPriceString !== null
      : annualPricing !== null);

  const handlePurchase = async (): Promise<void> => {
    if (!isPricingReady || isPurchasing) {
      return;
    }
    setIsPurchasing(true);
    try {
      const success =
        billingCycle === 'annual'
          ? await purchaseTogetherAnnual()
          : await purchaseTogetherMonthly();
      if (success) {
        Alert.alert(STR.purchaseSuccessTitle, STR.purchaseSuccessBody, [
          { text: STR.confirmLabel, onPress: () => router.back() },
        ]);
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async (): Promise<void> => {
    setIsRestoring(true);
    try {
      const success = await restorePurchases();
      if (success) {
        router.back();
      }
    } finally {
      setIsRestoring(false);
    }
  };

  const handleContinueFree = (): void => {
    router.back();
  };

  const handleRetryOffering = (): void => {
    refreshTogetherOffering();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <WebViewModal
        onClose={() => setTermsVisible(false)}
        title={STR.terms}
        url={TOGETHER_TERMS_URL}
        visible={termsVisible}
      />
      <WebViewModal
        onClose={() => setPrivacyVisible(false)}
        title={STR.privacy}
        url={TOGETHER_PRIVACY_URL}
        visible={privacyVisible}
      />

      {/* Header */}
      <View style={s.header}>
        <Pressable
          accessibilityLabel={STR.backButtonLabel}
          accessibilityRole="button"
          accessible={true}
          hitSlop={12}
          onPress={() => router.back()}
          style={s.backButton}
        >
          <MaterialIcons
            color={TEXT_DARK}
            name="arrow-back-ios"
            size={20}
            style={{ transform: iconTransform.flipHorizontal }}
          />
        </Pressable>
      </View>

      {/* TOP CONTENT: Hero, title, benefits — unchanged sizing/spacing.
          Lives in its own ScrollView (flex:1) so it scrolls independently
          on small screens / large font scaling, WITHOUT stretching or
          repositioning the bottom purchase area below (that used to happen
          via the old flexGrow:1 + justifyContent:'space-between'
          contentContainer, which spread the two blocks apart by an amount
          that varied with content/viewport height). */}
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        style={s.scroll}
      >
        <View style={s.topContent}>
          <View style={s.heroWrap}>
            <Image
              resizeMode="contain"
              source={heroImage}
              style={s.heroImage}
            />
          </View>

          <Text style={s.title}>{STR.title}</Text>

          <View style={s.benefitsList}>
            {BENEFITS.map((benefit) => (
              <View key={benefit} style={s.benefitRow}>
                <View style={s.checkBadge}>
                  <MaterialIcons color={BRAND_COLOR} name="check" size={14} />
                </View>
                <Text style={s.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* BOTTOM PURCHASE AREA: a plain (non-scrolling) sibling of the
          ScrollView above, not a child of it. Because the ScrollView has
          flex:1 and this View doesn't, this block always takes its
          natural height and sits flush at the bottom of the screen —
          pushed down against the safe-area edge with only the small,
          fixed paddingBottom below (the outer SafeAreaView now handles
          edges={['top', 'bottom']} itself, so no manual insets.bottom
          calculation is needed here — this is just breathing room above
          that safe-area inset), never centered or spread apart by a flex
          container. */}
      <View style={s.bottomPurchaseArea}>
        {/* Billing segmented control — annual (right, per RTL) / monthly
            (left). JSX order is [annual, monthly]; combined with
            rtl.flexDirection this renders annual on the physical right,
            matching the rest of this screen's RTL row conventions (e.g.
            benefitRow above). Selection directly sets billingCycle — the
            SAME state variable that already drives which price block and
            purchase path (annual vs monthly) render below; that logic is
            unchanged. */}
        <View style={s.pillRow}>
          <View style={s.segmentedControl}>
            <Pressable
              accessibilityLabel={STR.annualPillLabel}
              accessibilityRole="button"
              accessibilityState={{ selected: billingCycle === 'annual' }}
              accessible={true}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              onPress={() => setBillingCycle('annual')}
              style={s.segment}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  s.segmentFill,
                  { opacity: segmentFillAnim },
                ]}
              />
              <Text
                style={[
                  s.segmentText,
                  billingCycle === 'annual' && s.segmentTextSelected,
                ]}
              >
                {STR.annualPillLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={STR.monthlyPillLabel}
              accessibilityRole="button"
              accessibilityState={{ selected: billingCycle === 'monthly' }}
              accessible={true}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              onPress={() => setBillingCycle('monthly')}
              style={s.segment}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  s.segmentFill,
                  { opacity: monthlyFillAnim },
                ]}
              />
              <Text
                style={[
                  s.segmentText,
                  billingCycle === 'monthly' && s.segmentTextSelected,
                ]}
              >
                {STR.monthlyPillLabel}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Pricing area */}
        <View style={s.pricingArea}>
          {togetherOffering.status === 'loading' && (
            <View style={s.pricingLoading}>
              <ActivityIndicator color={BRAND_COLOR} />
              <Text style={s.loadingText}>{STR.loading}</Text>
            </View>
          )}

          {togetherOffering.status === 'unavailable' && (
            <View style={s.pricingUnavailable}>
              <Text style={s.unavailableTitle}>{STR.unavailableTitle}</Text>
              <Pressable
                accessibilityLabel={STR.unavailableRetry}
                accessibilityRole="button"
                accessible={true}
                onPress={handleRetryOffering}
                style={s.retryButton}
              >
                <Text style={s.retryButtonText}>{STR.unavailableRetry}</Text>
              </Pressable>
            </View>
          )}

          {togetherOffering.status === 'ready' &&
            billingCycle === 'monthly' &&
            monthlyPriceString !== null && (
              <View>
                <Text style={s.flexibleMonthlyText}>{STR.flexibleMonthly}</Text>
                <Text style={s.monthlyPrice}>{monthlyPriceString}</Text>
              </View>
            )}

          {togetherOffering.status === 'ready' &&
            billingCycle === 'annual' &&
            annualPricing === null && (
              <View style={s.pricingLoading}>
                <ActivityIndicator color={BRAND_COLOR} />
              </View>
            )}

          {togetherOffering.status === 'ready' &&
            billingCycle === 'annual' &&
            annualPricing !== null &&
            (annualPricing.isEligible ? (
              <View>
                <Text style={s.launchPriceLine}>
                  {STR.launchPricePrefix}
                  {annualPricing.discountPercent !== null
                    ? ` — ${annualPricing.discountPercent}% ${STR.discountSuffix}`
                    : ''}
                  <Text style={s.firstYearText}> {STR.firstYear} </Text>
                  <Text style={s.strikethroughRegular}>
                    {annualPricing.regularPriceString}
                  </Text>
                </Text>
                <Text style={s.priceLineText}>
                  {STR.approxPrefix}
                  {annualPricing.monthlyEquivalentString ?? ''}{' '}
                  {STR.perMonthFamilyAnnual}
                  {' · ('}
                  {annualPricing.introPriceString ?? ''} {STR.perYear}
                  {')'}
                </Text>
                <Text style={s.renewalText}>{STR.renewalDisclosure}</Text>
              </View>
            ) : (
              <View>
                <Text style={s.regularOnlyPrice}>
                  {annualPricing.regularPriceString}
                </Text>
                <Text style={s.regularOnlyPeriod}>{STR.perYear}</Text>
              </View>
            ))}
        </View>

        {/* CTA */}
        <Pressable
          accessibilityLabel={STR.cta}
          accessibilityRole="button"
          accessible={true}
          disabled={!isPricingReady || isPurchasing}
          onPress={handlePurchase}
          style={[
            s.primaryCta,
            (!isPricingReady || isPurchasing) && s.primaryCtaDisabled,
          ]}
        >
          {isPurchasing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={s.primaryCtaText}>{STR.cta}</Text>
          )}
        </Pressable>

        {/* Secondary actions — coupon link stays hidden while
              COUPON_FLOW_ENABLED is false (unchanged feature-flag
              infrastructure); "להמשיך בחינם" is the sole secondary action. */}
        <View style={s.secondaryRow}>
          {COUPON_FLOW_ENABLED && (
            <>
              <Pressable
                accessibilityLabel={STR.couponQuestion}
                accessibilityRole="button"
                accessible={true}
                style={s.secondaryLink}
              >
                <Text style={s.secondaryLinkText}>{STR.couponQuestion}</Text>
              </Pressable>
              <Text style={s.footerSeparator}>·</Text>
            </>
          )}
          <Pressable
            accessibilityLabel={STR.continueFree}
            accessibilityRole="button"
            accessible={true}
            disabled={isPurchasing}
            onPress={handleContinueFree}
            style={s.secondaryLink}
          >
            <Text style={s.secondaryLinkText}>{STR.continueFree}</Text>
          </Pressable>
        </View>

        {/* Footer — last element in the bottom purchase area, sits just
              above the safe area via this View's own paddingBottom. */}
        <View style={s.footer}>
          <Pressable
            accessibilityLabel={STR.restore}
            accessibilityRole="button"
            accessible={true}
            disabled={isRestoring || isPurchasing}
            onPress={handleRestore}
            style={s.footerLink}
          >
            {isRestoring ? (
              <ActivityIndicator color={TEXT_MUTED} size="small" />
            ) : (
              <Text style={s.footerLinkText}>{STR.restore}</Text>
            )}
          </Pressable>
          <Text style={s.footerSeparator}>·</Text>
          <Pressable
            accessibilityLabel={STR.terms}
            accessibilityRole="button"
            accessible={true}
            onPress={() => setTermsVisible(true)}
            style={s.footerLink}
          >
            <Text style={s.footerLinkText}>{STR.terms}</Text>
          </Pressable>
          <Text style={s.footerSeparator}>·</Text>
          <Pressable
            accessibilityLabel={STR.privacy}
            accessibilityRole="button"
            accessible={true}
            onPress={() => setPrivacyVisible(true)}
            style={s.footerLink}
          >
            <Text style={s.footerLinkText}>{STR.privacy}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  scroll: {
    flex: 1,
  },
  // ScrollView content — only the top (hero/title/benefits) area lives
  // inside this ScrollView now. No flexGrow/space-between here: on short
  // content this simply stacks from the top (leaving blank space below it,
  // inside the ScrollView, above the fixed bottomPurchaseArea below); on
  // tall content it scrolls normally. It no longer has any influence on
  // where the bottom purchase area sits.
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 2,
    paddingBottom: 8,
  },
  topContent: {
    // No flex/height rules — this block keeps its natural (unchanged) size.
  },
  // Fixed (non-scrolling) sibling of the ScrollView above. Because it has
  // no flex and the ScrollView has flex:1, this block always renders at
  // its natural height flush against the bottom of the screen — the outer
  // SafeAreaView (edges={['top', 'bottom']}) handles the real bottom safe
  // area inset now that the tab bar no longer renders beneath this screen,
  // so this block only needs a small fixed paddingBottom for breathing room.
  bottomPurchaseArea: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 14,
  },

  // Hero — sized down (priority 1) so the whole paywall fits one viewport
  // on regular-size phones without scrolling.
  heroWrap: {
    alignItems: 'center',
    marginBottom: 10,
  },
  heroImage: {
    width: '52%',
    maxWidth: 190,
    height: undefined,
    aspectRatio: 1,
    borderRadius: 28,
  },

  // Title — reduced spacing to title (priority 2)
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: BRAND_COLOR,
    textAlign: 'center',
    marginBottom: 14,
  },

  // Benefits — tighter row spacing (priority 3), extra breathing room
  // below before the billing toggle pill.
  benefitsList: {
    gap: 9,
    marginBottom: 32,
  },
  benefitRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 10,
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: CHECK_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: {
    flex: 1,
    fontSize: 14.5,
    color: TEXT_DARK,
    textAlign: rtl.textAlign,
    lineHeight: 20,
  },

  // Billing segmented control — a compact SECONDARY toggle (not a CTA).
  // Sized ~160x38 (well under the primaryCta's visual weight below) with a
  // little extra margin so the eye moves: toggle → pricing → CTA. Touch
  // target is kept comfortable via hitSlop on each Pressable (see JSX)
  // rather than by inflating the visible control.
  pillRow: {
    alignItems: 'center',
    marginBottom: 10,
  },
  // Outer pill: subtle border + light neutral fill, no shadow — reads as a
  // small toggle, not a button. `padding` + `gap` inset the two segments
  // slightly from the outer edge so the selected segment's own rounded
  // corners read as "floating" inside the pill, while both segments still
  // clearly belong to one continuous control.
  segmentedControl: {
    flexDirection: rtl.flexDirection,
    width: 160,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F4F5',
    borderWidth: 1,
    borderColor: SEGMENT_BORDER,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Animated opacity-only fill (simple crossfade between segments) — this
  // is intentionally the only animation on the control per the "keep it
  // simple" polish request. Rounded to match `segment` so the selected
  // side reads as its own rounded pill.
  segmentFill: {
    backgroundColor: BRAND_COLOR,
    borderRadius: 16,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: TEXT_MUTED,
  },
  segmentTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },

  // Pricing area — compressed margin to CTA below
  pricingArea: {
    minHeight: 72,
    justifyContent: 'center',
    marginBottom: 6,
  },
  pricingLoading: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  pricingUnavailable: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  unavailableTitle: {
    fontSize: 14,
    color: TEXT_MUTED,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: BRAND_COLOR_TINT,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: BRAND_COLOR,
  },

  // Monthly pricing
  flexibleMonthlyText: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginBottom: 4,
  },
  monthlyPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: TEXT_DARK,
    textAlign: 'center',
  },

  // Annual eligible pricing — 3-line consolidated block:
  // (1) launchPriceLine — bold/emphasized headline, with two nested
  //     de-emphasized segments: firstYearText (small, light gray) and
  //     strikethroughRegular (the old full price, struck through)
  // (2) priceLineText — single price line
  // (3) renewalText — small disclosure
  launchPriceLine: {
    fontSize: 15,
    fontWeight: '800',
    color: BRAND_COLOR,
    textAlign: 'center',
    marginBottom: 4,
  },
  firstYearText: {
    fontSize: 12,
    fontWeight: '400',
    color: TEXT_MUTED,
  },
  priceLineText: {
    fontSize: 14,
    color: TEXT_DARK,
    textAlign: 'center',
    marginBottom: 4,
  },
  strikethroughRegular: {
    textDecorationLine: 'line-through',
  },
  renewalText: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginTop: 2,
  },

  // Annual not-eligible pricing
  regularOnlyPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: TEXT_DARK,
    textAlign: 'center',
  },
  regularOnlyPeriod: {
    fontSize: 14,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginTop: 2,
  },

  // CTA — compressed bottom-area spacing
  primaryCta: {
    backgroundColor: BRAND_COLOR,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 6,
    shadowColor: BRAND_COLOR,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryCtaDisabled: {
    opacity: 0.5,
  },
  primaryCtaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },

  // Secondary actions
  secondaryRow: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  secondaryLink: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  secondaryLinkText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: TEXT_MUTED,
  },

  // Footer
  footer: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  footerLink: {
    paddingVertical: 4,
    minWidth: 20,
    alignItems: 'center',
  },
  footerLinkText: {
    fontSize: 12.5,
    color: TEXT_MUTED,
  },
  footerSeparator: {
    fontSize: 12.5,
    color: TEXT_MUTED,
  },
});
