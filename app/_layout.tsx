import 'react-native-gesture-handler';

import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient, useConvexAuth, useQuery } from 'convex/react';
import { Slot } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../global.css';

import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { RevenueCatProvider } from '@/contexts/RevenueCatContext';
import { api } from '@/convex/_generated/api';
import { BirthdaySheetsProvider } from '@/lib/components/birthday/BirthdaySheetsProvider';
import {
  captureColdStartNotification,
  setupAndroidChannels,
  setupNotificationCategories,
} from '@/lib/pushNotifications';
import { bootstrapRTL } from '@/lib/rtlBootstrap';
import { getConvexUrl } from '@/utils/convexConfig';
import { OnboardingProvider } from '../contexts/OnboardingContext';

const convexUrl = getConvexUrl();
const convex = new ConvexReactClient(convexUrl);

const secureStorage = {
  getItem: async (key: string) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {}
  },
  removeItem: async (key: string) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {}
  },
};

// ============================================================================
// ConvexRevenueCatBridge (Phase 1 — RevenueCat identity + logout safety)
// ============================================================================
// RootLayout creates ConvexAuthProvider, so RootLayout itself cannot call
// hooks that require that context (useConvexAuth / useQuery against
// authenticated queries). This bridge is rendered INSIDE ConvexAuthProvider
// so it can derive the tri-state Convex identity and pass it down to
// RevenueCatProvider, which binds the RevenueCat SDK identity to it.
//
// Tri-state convexUserId, derived in this exact order:
//   1. auth isLoading === true                              -> undefined
//   2. isAuthenticated === false                             -> null
//   3. isAuthenticated === true AND getMyId === undefined    -> undefined
//   4. isAuthenticated === true AND getMyId === null         -> null
//   5. isAuthenticated === true AND getMyId is a string      -> that string
//
// getMyId returning null while authenticated reflects a normal, expected
// state (the auth token/identity itself resolved to null on the server —
// see @convex-dev/auth's getAuthUserId), not a corrupted user record, so it
// is treated the same as "signed out" for RevenueCat identity purposes.
function ConvexRevenueCatBridge({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const myId = useQuery(api.users.getMyId, isAuthenticated ? {} : 'skip');

  let convexUserId: string | null | undefined;
  if (isAuthLoading) {
    convexUserId = undefined;
  } else if (!isAuthenticated) {
    convexUserId = null;
  } else if (myId === undefined) {
    convexUserId = undefined;
  } else if (myId === null) {
    convexUserId = null;
  } else {
    convexUserId = myId;
  }

  return (
    <RevenueCatProvider convexUserId={convexUserId}>
      {children}
    </RevenueCatProvider>
  );
}

export default function RootLayout() {
  useEffect(() => {
    bootstrapRTL().catch(() => {});
    setupAndroidChannels().catch(() => {});
    setupNotificationCategories().catch(() => {});
    // Must run as early as possible: reads the OS-buffered notification response
    // that exists when the app was launched cold by a notification tap.
    captureColdStartNotification().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar
          style="light"
          translucent={false}
          backgroundColor="#0a0a0a"
        />
        <ConvexAuthProvider client={convex} storage={secureStorage}>
          <ConvexRevenueCatBridge>
            <OnboardingProvider>
              <NotificationsProvider>
                <BirthdaySheetsProvider>
                  <Slot />
                </BirthdaySheetsProvider>
              </NotificationsProvider>
            </OnboardingProvider>
          </ConvexRevenueCatBridge>
        </ConvexAuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
