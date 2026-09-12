import { useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useOnboarding } from '@/contexts/OnboardingContext';
import { api } from '@/convex/_generated/api';
import { APP_IS_RTL } from '@/lib/rtl';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

/**
 * Post-OTP routing: Home if family exists / invite join / skipped setup;
 * otherwise optional family-profile-setup.
 */
export default function FamilyBootstrapScreen(): React.JSX.Element {
  const router = useRouter();
  const { data: onboardingData, isDraftHydrated } = useOnboarding();
  // FIXED: Stage 1 — the local pre-auth draft (if any) is hydrated into
  // OnboardingContext once at app start (see OnboardingContext.tsx), so
  // checking onboardingData.spaceType here already reflects both a
  // same-session answer and a restored draft. isDraftHydrated gates the
  // routing decision below until that one-time async check has settled.
  const hasCompletedOnboardingLocally = Boolean(onboardingData.spaceType);

  const userStatus = useQuery(api.users.getCurrentUserStatus, {});
  const bootstrap = useQuery(api.users.getFamilyBootstrapStatus, {});

  const redirectedRef = useRef(false);

  useEffect(() => {
    if (redirectedRef.current) return;
    if (!isDraftHydrated || userStatus === undefined || bootstrap === undefined)
      return;

    if (userStatus === null || bootstrap === null) {
      redirectedRef.current = true;
      router.replace('/(auth)/sign-in');
      return;
    }

    const syncingOnboarding =
      hasCompletedOnboardingLocally && !userStatus.onboardingComplete;

    if (syncingOnboarding) return;

    if (!hasCompletedOnboardingLocally && !userStatus.onboardingComplete) {
      redirectedRef.current = true;
      router.replace('/onboarding-hero');
      return;
    }

    redirectedRef.current = true;

    const { hasConfiguredFamily, joinedExistingSpace, familySetupSkippedAt } =
      bootstrap;

    if (
      hasConfiguredFamily ||
      joinedExistingSpace ||
      familySetupSkippedAt !== null
    ) {
      router.replace('/(authenticated)');
      return;
    }

    router.replace('/(authenticated)/family-profile-setup');
  }, [
    bootstrap,
    userStatus,
    hasCompletedOnboardingLocally,
    isDraftHydrated,
    router,
  ]);

  return (
    <View
      className="flex-1 items-center justify-center bg-white px-8"
      style={ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : undefined}
    >
      <ActivityIndicator color="#4A9FE2" size="large" />
      <Text className="mt-6 text-center text-base text-gray-600">
        מכינים את החשבון…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeAreaRtl: {
    direction: 'rtl',
  },
});
