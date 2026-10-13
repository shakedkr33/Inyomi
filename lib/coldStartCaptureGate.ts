// ============================================================================
// coldStartCaptureGate — cold-start notification capture completion signal
// ============================================================================
// Purpose: `captureColdStartNotification()` (lib/pushNotifications.ts) is
// async — it awaits `Notifications.getLastNotificationResponseAsync()`
// before it can know whether this cold start was launched by a notification
// tap. Any code that needs to know "is there (or is there NOT) a pending
// cold-start navigation target" must wait for that async call to resolve —
// reading the pending-target store before then is a race (it may not have
// been set yet even though a target exists).
//
// This module is a plain module-level pub/sub singleton (same pattern as
// lib/bridgeReadiness.ts) that RootLayout latches exactly once, immediately
// after captureColdStartNotification() settles (success or failure —
// `markColdStartCaptureComplete` must fire regardless, so a non-notification
// cold start is never blocked forever).
//
// This module intentionally knows NOTHING about routing, auth, or which
// screen is showing — it only answers "has the one-time cold-start
// notification check finished yet?".
// ============================================================================

type Listener = () => void;

let isComplete = false;
let listeners: Listener[] = [];

/**
 * Called by RootLayout exactly once, after captureColdStartNotification()
 * has settled (either outcome). Idempotent — later calls are no-ops. Never
 * throws.
 */
export function markColdStartCaptureComplete(): void {
  if (isComplete) return;
  isComplete = true;

  const toNotify = listeners;
  listeners = [];

  for (const listener of toNotify) {
    try {
      listener();
    } catch {
      // Instrumentation/gating plumbing must never break startup.
    }
  }
}

/**
 * Synchronous check — true once markColdStartCaptureComplete() has been
 * called for this app session.
 */
export function isColdStartCaptureComplete(): boolean {
  return isComplete;
}

/**
 * Subscribe to the one-shot cold-start-capture-complete signal. If already
 * complete when this is called, the listener fires synchronously. Returns
 * an unsubscribe function.
 */
export function onColdStartCaptureComplete(listener: Listener): () => void {
  if (isComplete) {
    listener();
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
export function __resetColdStartCaptureGateForTests(): void {
  isComplete = false;
  listeners = [];
}
