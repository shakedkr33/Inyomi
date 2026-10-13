// ============================================================================
// bridgeReadiness — root branded bridge visual-readiness signal
// ============================================================================
// Purpose: let the actual, focused, final startup destination screen tell
// RootLayout "the real destination surface is now visually present", so
// RootLayout can remove its persistent overlay ("the bridge") with an
// invisible (no fade, no flash) handoff.
//
// IMPORTANT — this is NOT fired by intermediate loading/routing surfaces.
// Auth/onboarding-gate child InYomiSplashScreen instances (rendered by
// app/(auth)/_layout.tsx and app/(authenticated)/_layout.tsx while a
// routing decision is still pending) are visually identical to the bridge
// and to each other, so the bridge simply stays up underneath/behind them
// until a genuine FINAL destination (Home, sign-in, onboarding-step1,
// phone-match-confirmation, profile-setup, a resolved deep-link screen,
// etc. — see lib/hooks/useStartupDestinationReady.ts) reports readiness.
// This is what makes every intermediate routing transition, auth ↔
// authenticated remount, and redirect chain invisible: some one of
// {bridge, child splash, real destination content} is always on screen.
//
// This module intentionally knows NOTHING about:
//   - auth state
//   - subscription/RevenueCat state
//   - routing decisions / onboarding state
//   - focus/layout mechanics (that lives in useStartupDestinationReady,
//     which enforces BOTH layout AND focus before calling reportDestinationReady)
//
// It is a plain module-level pub/sub singleton (not React context) so it
// can be called from any depth of the tree — child auth/authenticated
// layouts, or top-level routes that bypass both — without prop drilling.
//
// Reported readiness is a one-shot, latched signal for the current app
// session: once any consumer calls reportDestinationReady(), the root
// bridge is gone for good (a later remount of a child splash, or a later
// visit to another finite-destination screen, never brings it back).
// ============================================================================

type Listener = (destination: string) => void;

let hasReported = false;
let reportedDestination: string | null = null;
let listeners: Listener[] = [];

/**
 * Report that the real, focused, FINAL destination surface (not an
 * intermediate loading/routing screen) is now laid out. Idempotent — only
 * the first call has any effect; later calls (e.g. from a second finite
 * destination screen mounting) are no-ops. Never throws.
 *
 * `destination` is a short identifier (e.g. 'home', 'auth', 'onboarding',
 * 'phone-match', 'profile-setup') used only for instrumentation — it never
 * affects routing or app state.
 */
export function reportDestinationReady(destination: string): void {
  if (hasReported) return;
  hasReported = true;
  reportedDestination = destination;

  const toNotify = listeners;
  listeners = [];

  for (const listener of toNotify) {
    try {
      listener(destination);
    } catch {
      // Instrumentation/bridge plumbing must never break startup or
      // navigation.
    }
  }
}

/**
 * Subscribe to the one-shot destination-ready signal. If readiness was
 * already reported before this call (should not normally happen given
 * RootLayout subscribes on its first render, before any destination can
 * mount), the listener is invoked immediately with the already-reported
 * destination.
 *
 * Returns an unsubscribe function.
 */
export function subscribeDestinationReady(listener: Listener): () => void {
  if (hasReported) {
    listener(reportedDestination ?? 'unknown');
    return () => {};
  }

  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/**
 * Test-only helper to reset the module's singleton state between test
 * cases. Not used by application code.
 */
export function __resetBridgeReadinessForTests(): void {
  hasReported = false;
  reportedDestination = null;
  listeners = [];
}
