import 'react-native-gesture-handler';

import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient, useConvexAuth, useQuery } from 'convex/react';
import { Slot } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../global.css';

import { InYomiSplashScreen } from '@/components/InYomiSplashScreen';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { RevenueCatProvider } from '@/contexts/RevenueCatContext';
import { api } from '@/convex/_generated/api';
import { subscribeDestinationReady } from '@/lib/bridgeReadiness';
import { markColdStartCaptureComplete } from '@/lib/coldStartCaptureGate';
import { BirthdaySheetsProvider } from '@/lib/components/birthday/BirthdaySheetsProvider';
import {
  captureColdStartNotification,
  setupAndroidChannels,
  setupNotificationCategories,
} from '@/lib/pushNotifications';
import { bootstrapRTL } from '@/lib/rtlBootstrap';
import { startupTrace } from '@/lib/startupTrace';
import { getConvexUrl } from '@/utils/convexConfig';
import { OnboardingProvider } from '../contexts/OnboardingContext';

// Safety net only: development starts this after bridge layout; release
// starts it when RootLayout subscribes to destination readiness on mount.
// Neither environment imposes a minimum splash duration.
const BRIDGE_FAILSAFE_MS = 10_000;

// Hold native splash from module initialization. Release waits for the
// final destination; development hands off to the React bridge once ready.
SplashScreen.preventAutoHideAsync();
// TEMPORARY (Step A baseline instrumentation) — module scope, so this is the
// earliest point measurable from JS. See lib/startupTrace.ts.
startupTrace('T0_ROOT_MODULE');

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

  // TEMPORARY (Step A baseline instrumentation) — trace exactly once, the
  // first time Convex Auth's own isLoading resolves to false. Does not
  // affect convexUserId derivation below.
  const authResolvedTracedRef = useRef(false);
  useEffect(() => {
    if (!isAuthLoading && !authResolvedTracedRef.current) {
      authResolvedTracedRef.current = true;
      startupTrace('T1_AUTH_RESOLVED', { isAuthenticated });
    }
  }, [isAuthLoading, isAuthenticated]);

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
  // TEMPORARY (Step A baseline instrumentation) — fires once, right after
  // this component's first commit.
  useEffect(() => {
    startupTrace('T0_ROOT_MOUNT');
  }, []);

  useEffect(() => {
    bootstrapRTL().catch(() => {});
    setupAndroidChannels().catch(() => {});
    setupNotificationCategories().catch(() => {});
    // Must run as early as possible: reads the OS-buffered notification response
    // that exists when the app was launched cold by a notification tap.
    // markColdStartCaptureComplete() fires exactly once regardless of
    // success/failure, so a non-notification cold start is never blocked —
    // see lib/coldStartCaptureGate.ts and the `shouldBlockForColdStartNav`
    // guard in app/(authenticated)/_layout.tsx that consumes this signal.
    captureColdStartNotification()
      .catch(() => {})
      .finally(() => {
        startupTrace('T_COLD_START_CAPTURE_COMPLETE');
        markColdStartCaptureComplete();
      });
  }, []);

  // Development retains the React bridge for Dev Launcher startup. Release
  // renders no root bridge and holds native splash until destination readiness.
  // Both paths share the hide-once ref, readiness subscription and timer ref.
  const [isBridgeVisible, setIsBridgeVisible] = useState(__DEV__);
  const bridgeReadyTracedRef = useRef(false);
  const hasHiddenNativeSplashRef = useRef(false);
  const bridgeRemovedRef = useRef(false);
  // Development native-splash-hide gating: wait until BOTH
  // the root bridge container has laid out AND the root bridge's logo
  // Image has actually loaded — not container layout alone (see
  // maybeHideNativeSplash below). This is intentionally separate from
  // bridgeReadyTracedRef / T_BRANDED_BRIDGE_READY, which continue to gate
  // bridge REMOVAL (failsafe timer, buffered destination-ready signal) and
  // must not be affected by this change.
  const rootBridgeLayoutReadyRef = useRef(false);
  const rootBridgeLogoLoadedRef = useRef(false);
  const failsafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Race guard: a child/destination can report readiness before this root
  // bridge container has itself laid out (both mount in the same initial
  // render pass — their onLayout order across the native bridge is not
  // guaranteed). If that happens, buffer the signal here instead of
  // removing the bridge immediately — removal must never happen before
  // T_BRANDED_BRIDGE_READY / the hideAsync() request. handleBridgeLayout
  // consumes this buffered signal once the bridge itself becomes ready.
  const destinationReadySignalReceivedRef = useRef<string | null>(null);

  const hideReleaseNativeSplash = useCallback(
    (reason: 'destination' | 'failsafe', destination?: string) => {
      if (__DEV__ || hasHiddenNativeSplashRef.current) return;
      hasHiddenNativeSplashRef.current = true;
      if (failsafeTimerRef.current) {
        clearTimeout(failsafeTimerRef.current);
        failsafeTimerRef.current = null;
      }
      const metadata = { environment: 'release', reason, destination };
      startupTrace('T0_HIDE_NATIVE_SPLASH', metadata);
      SplashScreen.hideAsync()
        .then(() => {
          startupTrace('T0_HIDE_NATIVE_SPLASH_RESOLVED', metadata);
        })
        .catch(() => {
          startupTrace('T0_HIDE_NATIVE_SPLASH_FAILED', metadata);
        });
    },
    []
  );

  const removeBridge = useCallback(
    (via: 'signal' | 'failsafe', destination?: string) => {
      if (bridgeRemovedRef.current) return;
      bridgeRemovedRef.current = true;
      if (failsafeTimerRef.current) {
        clearTimeout(failsafeTimerRef.current);
        failsafeTimerRef.current = null;
      }
      setIsBridgeVisible(false);
      startupTrace('T_BRIDGE_REMOVED', { via, destination });
    },
    []
  );

  // In development, hide native splash once BOTH the root bridge container
  // has laid out AND its logo Image has loaded — container layout alone
  // is not sufficient visual-readiness proof (see task: startup traces
  // showed a beige blank interval when hideAsync fired on layout alone,
  // before the logo had actually rendered). Fires at most once
  // (hasHiddenNativeSplashRef-guarded).
  const maybeHideNativeSplash = () => {
    if (hasHiddenNativeSplashRef.current) return;
    if (!rootBridgeLayoutReadyRef.current || !rootBridgeLogoLoadedRef.current)
      return;
    hasHiddenNativeSplashRef.current = true;
    startupTrace('T_ROOT_BRIDGE_VISUAL_READY');

    // A single requestAnimationFrame here is a scheduling hint only (give
    // React one more frame to flush the already-loaded logo Image before
    // requesting the native splash be hidden) — it is not itself the
    // readiness condition and not proof of physical paint.
    requestAnimationFrame(() => {
      // TEMPORARY (Step A baseline instrumentation, kept as-is):
      // T0_HIDE_NATIVE_SPLASH means "hideAsync requested" — NOT proof the
      // native splash has been physically removed from the display.
      // T0_HIDE_NATIVE_SPLASH_RESOLVED marks when the native API call
      // itself completed.
      startupTrace('T0_HIDE_NATIVE_SPLASH');
      SplashScreen.hideAsync()
        .then(() => {
          startupTrace('T0_HIDE_NATIVE_SPLASH_RESOLVED');
        })
        .catch(() => {});
    });
  };

  // Root bridge container layout readiness — one of the two conditions
  // required before the native splash may be hidden. Also unchanged:
  // continues to gate T_BRANDED_BRIDGE_READY, the buffered
  // destination-ready signal and the bridge-removal failsafe timer below.
  const handleBridgeLayout = () => {
    if (!rootBridgeLayoutReadyRef.current) {
      rootBridgeLayoutReadyRef.current = true;
      startupTrace('T_ROOT_BRIDGE_LAYOUT_READY');
      maybeHideNativeSplash();
    }

    if (bridgeReadyTracedRef.current) return;
    bridgeReadyTracedRef.current = true;
    startupTrace('T_BRANDED_BRIDGE_READY');

    // A final destination may have already reported readiness before this
    // root bridge itself became ready (see destinationReadySignalReceivedRef
    // above). Now that T_BRANDED_BRIDGE_READY has fired, it is safe to
    // honor that buffered signal (bridge removal is independent of the
    // native-splash-hide gating above).
    if (destinationReadySignalReceivedRef.current !== null) {
      removeBridge('signal', destinationReadySignalReceivedRef.current);
      return;
    }

    // Defensive failsafe ONLY — started AFTER T_BRANDED_BRIDGE_READY. If no
    // child/destination reports readiness within BRIDGE_FAILSAFE_MS, remove
    // ONLY the visual bridge. Never redirects, never touches auth/
    // RevenueCat/Convex state. Firing in normal QA is a bug, not a feature.
    failsafeTimerRef.current = setTimeout(() => {
      if (bridgeRemovedRef.current) return;
      startupTrace('BRIDGE_FAILSAFE');
      removeBridge('failsafe');
    }, BRIDGE_FAILSAFE_MS);
  };

  // Root bridge logo-loaded readiness — the second of the two conditions
  // required before the native splash may be hidden. Passed only to the
  // ROOT InYomiSplashScreen instance below; child (auth/authenticated)
  // instances never receive this prop and are unaffected.
  const handleRootBridgeLogoLoad = () => {
    if (rootBridgeLogoLoadedRef.current) return;
    rootBridgeLogoLoadedRef.current = true;
    startupTrace('T_ROOT_BRIDGE_LOGO_LOADED');
    maybeHideNativeSplash();
  };

  // Release hides native splash immediately on the existing final-destination
  // signal. Development retains its bridge-layout buffering and removal flow.
  useEffect(() => {
    const unsubscribe = subscribeDestinationReady((destination) => {
      if (!__DEV__) {
        hideReleaseNativeSplash('destination', destination);
        return;
      }
      if (!bridgeReadyTracedRef.current) {
        destinationReadySignalReceivedRef.current = destination;
        return;
      }
      removeBridge('signal', destination);
    });

    // Subscribe first: a destination reported before this effect is replayed
    // synchronously, so an already-ready destination never waits for a timer.
    if (!__DEV__ && !hasHiddenNativeSplashRef.current) {
      failsafeTimerRef.current = setTimeout(() => {
        if (hasHiddenNativeSplashRef.current) return;
        startupTrace('NATIVE_SPLASH_FAILSAFE', {
          environment: 'release',
          reason: 'failsafe',
        });
        hideReleaseNativeSplash('failsafe');
      }, BRIDGE_FAILSAFE_MS);
    }
    return unsubscribe;
  }, [hideReleaseNativeSplash, removeBridge]);

  // Clear any pending failsafe timer on unmount (RootLayout does not
  // normally unmount, but this keeps the timer from leaking if it ever
  // does, e.g. Fast Refresh during development).
  useEffect(() => {
    return () => {
      if (failsafeTimerRef.current) {
        clearTimeout(failsafeTimerRef.current);
        failsafeTimerRef.current = null;
      }
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#EDE8E2' }}>
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
      {/* Development-only root bridge. Renders above <Slot /> (last
          sibling = top of paint order), present from initial render,
          visually identical to the native splash and to every child
          InYomiSplashScreen. pointerEvents="none" so it never intercepts
          touches (it is only ever shown before any interactive content
          matters). No animation, no fade — removal is immediate. */}
      {__DEV__ && isBridgeVisible ? (
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
          onLayout={handleBridgeLayout}
        >
          <InYomiSplashScreen
            source="root"
            onImageLoad={handleRootBridgeLogoLoad}
          />
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
}
