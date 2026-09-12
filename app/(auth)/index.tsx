import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { getOnboardingDraft } from '@/lib/onboardingState';
import { APP_IS_RTL } from '@/lib/rtl';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isNavigating = useRef(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);

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

  if (isCheckingOnboarding) {
    return null;
  }

  return (
    <SafeAreaView
      style={[styles.safe, ANDROID_MATCH_IOS_LAYOUT && styles.safeAreaRtl]}
    >
      <View style={styles.content}>
        <View style={styles.phoneSection}>
          <View style={styles.phoneMockup}>
            <View style={styles.phoneScreen}>
              <View style={styles.phoneScreenPlaceholder} />
            </View>
          </View>
        </View>

        <View style={styles.brandSection}>
          <Image
            source={require('@/assets/images/logo-inyomi.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="InYomi Logo"
          />

          <Text style={styles.headline}>
            כל האירועים, המשימות והתיאומים שלך במקום אחד
          </Text>
        </View>
      </View>

      <View style={[styles.bottomArea, { bottom: insets.bottom + 24 }]}>
        <Pressable
          onPress={goToOnboarding}
          style={styles.cta}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="בואו נתחיל"
        >
          <Text style={styles.ctaText}>בואו נתחיל</Text>
        </Pressable>

        <Pressable
          onPress={goToSignIn}
          style={styles.secondaryLink}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="כבר יש לי חשבון? התחברות"
          accessibilityHint="דילוג על ההיכרות והמעבר ישירות למסך התחברות"
          hitSlop={8}
        >
          <Text style={styles.secondaryLinkText}>כבר יש לי חשבון? התחברות</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f6f7f8',
    paddingHorizontal: 24,
    position: 'relative',
  },
  safeAreaRtl: {
    direction: 'rtl',
  },

  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 170,
  },

  phoneSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },

  phoneMockup: {
    width: 270,
    height: 500,
    backgroundColor: '#0d1117',
    borderRadius: 48,
    padding: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 16,
  },

  phoneScreen: {
    flex: 1,
    borderRadius: 36,
    overflow: 'hidden',
    backgroundColor: '#e8edf2',
  },

  phoneScreenPlaceholder: {
    flex: 1,
    backgroundColor: '#dde5ec',
  },

  brandSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },

  logo: {
    width: 150,
    height: 88,
    marginBottom: 4,
  },

  headline: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111418',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
    maxWidth: 320,
  },

  bottomArea: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 50,
  },

  cta: {
    height: 60,
    backgroundColor: '#36A9E2',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2497d3',
  },

  ctaText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },

  // Secondary, lower-emphasis action — must not visually compete with the
  // primary CTA above it.
  secondaryLink: {
    marginTop: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryLinkText: {
    color: '#5b6672',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
