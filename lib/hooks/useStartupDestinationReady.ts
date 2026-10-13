// ============================================================================
// useStartupDestinationReady — finite startup destination readiness helper
// ============================================================================
// Purpose: wrap the ROOT view of a finite startup destination screen with
// this hook's returned `onLayout` instead of calling reportDestinationReady
// directly. Visual readiness requires BOTH:
//
//   1. the destination's own root view has laid out (onLayout)
//   2. the screen is actually FOCUSED (useIsFocused, from the project's
//      existing @react-navigation/native dependency — already used
//      elsewhere, e.g. app/(authenticated)/calendar.tsx)
//
// Requiring focus protects against lazy/preloaded/inactive navigator
// screens (e.g. a Tabs.Screen that mounts off-screen) firing onLayout while
// it is NOT the screen the user is actually looking at — which would
// otherwise remove the root bridge under the wrong destination. For a
// single-mounted top-level route with no competing sibling destination,
// useIsFocused simply resolves to true as soon as it mounts, so the same
// hook is safe to use everywhere (no special-casing needed).
//
// A third condition — the cold-start notification capture attempt having
// resolved (lib/coldStartCaptureGate.ts) — is also required before
// signaling. This does NOT change routing or redirect decisions; it only
// prevents a default screen (e.g. Home) from reporting ready a frame before
// a notification-driven redirect fires. See app/(authenticated)/_layout.tsx
// for the (separate) `shouldBlockForColdStartNav` routing guard this
// complements.
//
// Behavior:
//   - if the screen lays out while NOT focused: layout is remembered, but
//     readiness is NOT reported yet.
//   - when the screen later becomes focused (layout already occurred):
//     readiness is reported at that point.
//   - if the screen is already focused when onLayout fires: readiness is
//     reported immediately.
//   - reports at most once per hook instance (per mounted screen).
//   - reportDestinationReady() itself remains a global one-shot latch —
//     only the FIRST finite destination to satisfy all conditions actually
//     removes the bridge; every other instance's call is a silent no-op.
// ============================================================================

import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportDestinationReady } from '@/lib/bridgeReadiness';
import {
  isColdStartCaptureComplete,
  onColdStartCaptureComplete,
} from '@/lib/coldStartCaptureGate';
import { startupTrace } from '@/lib/startupTrace';

type UseStartupDestinationReadyOptions = {
  // When false, this instance never reports readiness (its onLayout is
  // still safe to attach — it simply never triggers the effect below).
  // Used for screens shared between a finite startup destination and an
  // unrelated non-startup route (e.g. family-profile.tsx, which is both
  // the mandatory/optional post-auth "profile-setup" destination AND the
  // regular Settings → family-profile screen).
  enabled?: boolean;
};

export function useStartupDestinationReady(
  destination: string,
  options?: UseStartupDestinationReadyOptions
): { onLayout: () => void } {
  const enabled = options?.enabled ?? true;

  // Requires an ambient React Navigation context — guaranteed for every
  // expo-router screen (expo-router is built on React Navigation), so this
  // is safe to call unconditionally from any app/** route or layout.
  const isFocused = useIsFocused();

  const [hasLaidOut, setHasLaidOut] = useState(false);
  const [isColdStartCaptureDone, setIsColdStartCaptureDone] = useState(
    isColdStartCaptureComplete
  );
  const hasReportedRef = useRef(false);

  useEffect(() => {
    if (isColdStartCaptureDone) return;
    return onColdStartCaptureComplete(() => setIsColdStartCaptureDone(true));
  }, [isColdStartCaptureDone]);

  useEffect(() => {
    if (!enabled) return;
    if (hasReportedRef.current) return;
    if (!hasLaidOut || !isFocused || !isColdStartCaptureDone) return;

    hasReportedRef.current = true;
    startupTrace('T_FINAL_DESTINATION_READY', { destination });
    reportDestinationReady(destination);
  }, [enabled, hasLaidOut, isFocused, isColdStartCaptureDone, destination]);

  const onLayout = useCallback(() => {
    setHasLaidOut(true);
  }, []);

  return { onLayout };
}
