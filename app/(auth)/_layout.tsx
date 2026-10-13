import { useConvexAuth } from 'convex/react';
import { Redirect, Slot, useLocalSearchParams, useSegments } from 'expo-router';
import { View } from 'react-native';

import { InYomiSplashScreen } from '@/components/InYomiSplashScreen';
import { IS_DEV_MODE } from '@/config/appConfig';
import { useStartupDestinationReady } from '@/lib/hooks/useStartupDestinationReady';

export default function AuthRoutesLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const segments = useSegments();
  const { preview } = useLocalSearchParams<{ preview?: string }>();

  // Whatever screen the Slot below ends up rendering (Welcome, sign-in,
  // verify, paywall) is a genuine finite startup destination for
  // unauthenticated cold starts — see lib/hooks/useStartupDestinationReady.ts
  // and the approved splash-startup-fix plan's destination table
  // (destination = 'auth'). This wrapper's own onLayout fires as soon as
  // the Slot's child has actually laid out; it does NOT change any
  // routing/business behavior.
  const { onLayout: handleAuthDestinationLayout } =
    useStartupDestinationReady('auth');

  // Wait for auth state to hydrate from SecureStore before making routing decisions
  if (isLoading) {
    // This is an intermediate routing/loading surface, NOT the final
    // destination — it must NOT report readiness (see AGENTS.md /
    // splash-startup-fix plan: only the actual focused destination screen
    // removes the root bridge).
    return <InYomiSplashScreen source="auth" />;
  }

  // Preview mode lets authenticated developers access auth screens for debugging
  const isPreviewMode = IS_DEV_MODE && preview === 'true';
  const segmentStrings = segments as string[];
  const isPaywallRoute = segmentStrings.includes('paywall');
  const isAllowedForAuthenticated = isPaywallRoute || isPreviewMode;

  // Authenticated users have no business on auth screens — redirect them home
  if (isAuthenticated && !isAllowedForAuthenticated) {
    return <Redirect href="/(authenticated)" />;
  }

  return (
    <View style={{ flex: 1 }} onLayout={handleAuthDestinationLayout}>
      <Slot />
    </View>
  );
}
