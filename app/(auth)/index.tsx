import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InYomiSplashScreen } from '@/components/InYomiSplashScreen';
import { colors } from '@/constants/theme';
import { getOnboardingDraft } from '@/lib/onboardingState';
import { APP_IS_RTL } from '@/lib/rtl';

// ─── Welcome screen — the ONLY Welcome / opening screen in the app ─────────
//
// Reached only by unauthenticated users (the (auth) layout redirects
// authenticated users away). Its two exits:
//   • "בואו נתחיל"  → onboarding questions (/onboarding-step1)
//   • "התחברות"     → existing sign-in flow (/(auth)/sign-in)
//
// A user who signs in and still needs onboarding is routed straight to
// /onboarding-step1 by the authenticated layout — they never see a second
// Welcome (the former post-auth /onboarding-hero screen no longer exists).
//
// Startup: this screen sits inside the (auth) layout, which already reports
// the finite 'auth' startup destination (useStartupDestinationReady). While
// the local draft check and the two artwork images are settling we keep the
// visually identical InYomiSplashScreen on top, so the splash → Welcome
// hand-off never shows a blank frame or images popping in.

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

const SCREEN_BACKGROUND = '#FEFEFD';
const SUBTITLE_COLOR = '#4B5563';
const SECONDARY_TEXT_COLOR = '#374151';

// Source asset dimensions — used only to preserve aspect ratio.
const LOGO_ASPECT_RATIO = 707 / 210;
const HERO_ASPECT_RATIO = 768 / 1024;

const LOGO_MAX_WIDTH = 320;
const LOGO_WIDTH_FRACTION = 0.72;
const HERO_MIN_HEIGHT = 260;
// The hero artwork is near-white at its top/bottom edges but carries a soft
// colored shape at its left/right edges. When the artwork is narrower than
// the screen those edges are faded into the background.
const HERO_EDGE_FADE_FRACTION = 0.08;
const BACKGROUND_TRANSPARENT = 'rgba(254, 254, 253, 0)';

// Safety net: never keep the splash overlay up if an image event is lost.
const ASSET_READY_FAILSAFE_MS = 1500;

const WELCOME_SUBTITLE =
  'אפליקציה לניהול החיים — כל האירועים, המשימות והקהילות במקום אחד';

type HeroSize = { width: number; height: number };

export default function WelcomeScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const isNavigating = useRef(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [isLogoReady, setIsLogoReady] = useState(false);
  const [isHeroReady, setIsHeroReady] = useState(false);
  const [isFailsafeElapsed, setIsFailsafeElapsed] = useState(false);
  const [heroSlot, setHeroSlot] = useState<HeroSize | null>(null);

  // An existing pre-auth onboarding draft means this device already got past
  // Welcome — skip straight to sign-in (unchanged behavior).
  useEffect(() => {
    getOnboardingDraft()
      .then((draft) => {
        if (draft) {
          router.replace('/(auth)/sign-in');
          return;
        }
        setIsCheckingOnboarding(false);
      })
      .catch(() => setIsCheckingOnboarding(false));
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(
      () => setIsFailsafeElapsed(true),
      ASSET_READY_FAILSAFE_MS
    );
    return () => clearTimeout(timer);
  }, []);

  // Onboarding precedes authentication for users who have not seen it yet.
  const goToOnboarding = () => {
    if (isNavigating.current) return;
    isNavigating.current = true;
    router.replace('/onboarding-step1');
  };

  // Returning-user path: skip onboarding entirely and go straight to Sign In.
  const goToSignIn = () => {
    if (isNavigating.current) return;
    isNavigating.current = true;
    router.replace('/(auth)/sign-in');
  };

  const handleHeroSlotLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setHeroSlot((previous) =>
      previous && previous.width === width && previous.height === height
        ? previous
        : { width, height }
    );
  };

  const logoWidth = Math.min(windowWidth * LOGO_WIDTH_FRACTION, LOGO_MAX_WIDTH);
  const logoHeight = logoWidth / LOGO_ASPECT_RATIO;

  // Fit the hero inside its flexible slot without ever distorting it.
  let heroWidth = 0;
  let heroHeight = 0;
  if (heroSlot) {
    heroHeight = Math.min(heroSlot.height, heroSlot.width / HERO_ASPECT_RATIO);
    heroWidth = heroHeight * HERO_ASPECT_RATIO;
  }

  const isSplashOverlayVisible =
    isCheckingOnboarding ||
    (!(isLogoReady && isHeroReady) && !isFailsafeElapsed);

  return (
    <SafeAreaView
      style={[styles.safe, ANDROID_MATCH_IOS_LAYOUT && styles.safeAreaRtl]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.header}>
          {/* The English slogan is part of this logo asset — it is
              intentionally not rendered as separate text. */}
          <Image
            source={require('@/assets/branding/inyomi-logo-horizontal.png')}
            style={{ width: logoWidth, height: logoHeight }}
            resizeMode="contain"
            accessible={true}
            accessibilityRole="image"
            accessibilityLabel="InYomi. Less to remember. More to be."
            onLoad={() => setIsLogoReady(true)}
            onError={() => setIsLogoReady(true)}
          />
          <Text style={styles.subtitle}>{WELCOME_SUBTITLE}</Text>
        </View>

        <View style={styles.heroSlot} onLayout={handleHeroSlotLayout}>
          {heroSlot ? (
            <View style={{ width: heroWidth, height: heroHeight }}>
              <Image
                source={require('@/assets/images/onboarding/welcome-hero.jpg')}
                style={styles.heroImage}
                resizeMode="contain"
                accessible={true}
                accessibilityRole="image"
                accessibilityLabel="הדגמה של מסך הבית ב-InYomi"
                onLoad={() => setIsHeroReady(true)}
                onError={() => setIsHeroReady(true)}
              />
              {/* One symmetric overlay (bg → clear → clear → bg) so it never
                  depends on left/right swapping in native RTL. */}
              <LinearGradient
                pointerEvents="none"
                colors={[
                  SCREEN_BACKGROUND,
                  BACKGROUND_TRANSPARENT,
                  BACKGROUND_TRANSPARENT,
                  SCREEN_BACKGROUND,
                ]}
                locations={[
                  0,
                  HERO_EDGE_FADE_FRACTION,
                  1 - HERO_EDGE_FADE_FRACTION,
                  1,
                ]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Pinned outside the ScrollView (after it in paint order) so the
          primary actions are always on screen and can never be pushed below
          the fold or painted over by the hero/gradient layers. */}
      <View style={styles.footer}>
        <Pressable
          onPress={goToOnboarding}
          style={styles.cta}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="בואו נתחיל"
          accessibilityHint="מעבר להיכרות קצרה עם InYomi"
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>
            בואו נתחיל
          </Text>
        </Pressable>

        <Pressable
          onPress={goToSignIn}
          style={styles.secondaryAction}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="כבר יש לך חשבון? התחברות"
          accessibilityHint="דילוג על ההיכרות ומעבר למסך התחברות"
          hitSlop={8}
        >
          <Text style={styles.secondaryText} maxFontSizeMultiplier={1.3}>
            {'כבר יש לך חשבון? '}
            <Text style={styles.secondaryActionText}>התחברות</Text>
          </Text>
        </Pressable>
      </View>

      {isSplashOverlayVisible ? (
        <View style={StyleSheet.absoluteFill}>
          <InYomiSplashScreen source="welcome" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: SCREEN_BACKGROUND,
  },
  safeAreaRtl: {
    direction: 'rtl',
  },

  scroll: {
    flex: 1,
  },
  // flexGrow (not flex) so the content can exceed the viewport and scroll on
  // short screens / large font scales instead of clipping.
  scrollContent: {
    flexGrow: 1,
  },

  header: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 12,
  },
  subtitle: {
    marginTop: 12,
    maxWidth: 360,
    color: SUBTITLE_COLOR,
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Absorbs all remaining vertical space; the hero is fitted inside it.
  heroSlot: {
    flex: 1,
    minHeight: HERO_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },

  footer: {
    alignItems: 'center',
    backgroundColor: SCREEN_BACKGROUND,
    paddingHorizontal: 32,
    paddingTop: 8,
    paddingBottom: 12,
  },
  cta: {
    width: '100%',
    maxWidth: 360,
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: '#00668E',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 1,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },

  secondaryAction: {
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: SECONDARY_TEXT_COLOR,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  secondaryActionText: {
    color: colors.primaryDark,
    fontWeight: '800',
  },
});
