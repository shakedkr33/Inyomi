import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { startupTrace } from '@/lib/startupTrace';

// inyomi-native-splash-logo.png: 893 × 689, transparent background — the
// same logo composition used in the native Android/iOS splash screens
// (iY icon + "InYomi" wordmark + Hebrew tagline).
const LOGO_ASPECT_RATIO = 893 / 689;

// Fixed logo width (dp), calibrated to match the apparent size of the logo
// within the native splash screens, rather than scaling with screen width.
// The native splash renders the logo inside a fixed 288dp square icon
// (Android adaptive-icon foreground), so its apparent size does not scale
// with device width either — a percentage-of-screen-width formula here
// caused a visible size jump between native and React splash on wide
// screens. Clamped defensively for extreme screen sizes only.
// NOTE: calibrated against the Android native splash. If on-device
// verification shows the iOS Storyboard splash logo rendering larger than
// this value, this can become `Platform.OS === 'ios' ? 210 : 190` — a
// calibration-only change, not an architectural one.
const NATIVE_LOGO_APPARENT_WIDTH = 190;
const LOGO_WIDTH_MIN = 160;
const LOGO_WIDTH_MAX = 240;

// TEMPORARY (Step A/B instrumentation) — fixed, safe metadata identifying
// WHICH mount produced a T0_CHILD_SPLASH_READY / T0_CHILD_SPLASH_UNMOUNTED
// trace line. 'root' is the root-level branded bridge (app/_layout.tsx);
// 'auth' / 'authenticated' are the child layouts; 'welcome' is the artwork
// overlay on the first-launch screen. Never route params or
// any other identifier is logged here.
type InYomiSplashScreenSource = 'root' | 'auth' | 'welcome' | 'authenticated';

type InYomiSplashScreenProps = {
  source?: InYomiSplashScreenSource;
  // Step B: fired once this instance's own root View has actually been
  // laid out — i.e. there is now a real, visually-identical InYomi surface
  // painted. Purely a readiness signal; never changes routing or app state.
  onReady?: () => void;
  // Root-bridge-only visual-readiness signal: fired once this instance's
  // own logo Image has finished loading (RN Image `onLoad`). Optional and
  // additive — child (auth/authenticated) instances never pass this, so
  // their behavior is unaffected. Used by the ROOT instance in
  // app/_layout.tsx to gate SplashScreen.hideAsync() on the logo asset
  // actually being ready, not just the container having laid out.
  onImageLoad?: () => void;
};

// This component is the React Native continuation of the native splash
// screen. It must stay visually static and identical in background/logo to
// the native splash (#EDE8E2 + centered logo) so the native → React
// transition and any auth ↔ authenticated remount are imperceptible. No
// animations, timers, or decorative elements are used here intentionally —
// see the splash startup fix plan for rationale.
export function InYomiSplashScreen({
  source,
  onReady,
  onImageLoad,
}: InYomiSplashScreenProps = {}) {
  // TEMPORARY (Step A baseline instrumentation) — measures when this
  // component's own layout has actually been computed/painted, i.e. the
  // React "child splash" is visually ready. This callback ONLY emits a
  // timing trace and (Step B) notifies the caller-supplied onReady: it
  // does not change routing, does not hide/show anything on its own, and
  // does not read or write any app state. Guarded with a ref so it fires
  // once per mount even though onLayout can fire more than once.
  const hasTracedLayoutRef = useRef(false);
  const handleLayout = () => {
    if (hasTracedLayoutRef.current) return;
    hasTracedLayoutRef.current = true;
    startupTrace('T0_CHILD_SPLASH_READY', source ? { source } : undefined);
    onReady?.();
  };

  // Development-only layer diagnostics. Welcome's own artwork-loading overlay
  // is distinct from the auth layout's loading splash. A mount/unmount trace
  // identifies a React layer, never proves native visibility or physical paint.
  useEffect(() => {
    if (source) startupTrace('T0_CHILD_SPLASH_MOUNTED', { source });
    return () => {
      if (source) {
        startupTrace('T0_CHILD_SPLASH_UNMOUNTED', {
          source,
          hadLayout: hasTracedLayoutRef.current,
        });
      }
    };
  }, [source]);

  // Fixed-dp logo sizing (see NATIVE_LOGO_APPARENT_WIDTH above) — does not
  // depend on screen width, matching how the native splash logo behaves.
  const logoWidth = useMemo(
    () =>
      Math.min(
        Math.max(NATIVE_LOGO_APPARENT_WIDTH, LOGO_WIDTH_MIN),
        LOGO_WIDTH_MAX
      ),
    []
  );
  const logoHeight = useMemo(() => logoWidth / LOGO_ASPECT_RATIO, [logoWidth]);

  // Fires once, when the logo Image itself has finished loading. Guarded
  // so it emits only once per mount even if `onLoad` were somehow called
  // more than once. No-op unless `onImageLoad` was supplied (root only).
  const hasFiredImageLoadRef = useRef(false);
  const handleImageLoad = () => {
    if (hasFiredImageLoadRef.current) return;
    hasFiredImageLoadRef.current = true;
    onImageLoad?.();
  };

  return (
    <View style={styles.safe} onLayout={handleLayout}>
      <StatusBar style="dark" backgroundColor="#EDE8E2" />

      <View style={styles.content}>
        <Image
          accessibilityLabel="InYomi"
          accessible
          resizeMode="contain"
          onLoad={handleImageLoad}
          source={require('../assets/images/inyomi-native-splash-logo.png')}
          style={{ width: logoWidth, height: logoHeight }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#EDE8E2',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
