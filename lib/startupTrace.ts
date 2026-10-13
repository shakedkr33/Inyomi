// ============================================================================
// startupTrace — TEMPORARY startup instrumentation (Step A baseline)
// ============================================================================
// Purpose: measure the CURRENT cold-start timeline (module load → root mount
// → native splash hide → auth → RevenueCat → onboarding draft → user status
// → family bootstrap → profile hydration → ready-to-route → Home mount)
// WITHOUT changing any startup behavior.
//
// This module is intentionally minimal:
//   - No timers, no delays, no side effects other than a console.log call.
//   - Never throws — a broken trace call must never break app startup.
//   - Full tracing is development-only. Release allows only the startup
//     destination/native-splash handoff events below, including the failsafe.
//
// PII / privacy constraints (must be preserved by every call site):
//   - Never pass user IDs, phone numbers, auth tokens, CustomerInfo,
//     RevenueCat/customer identifiers, product IDs, or error objects that
//     may contain personal/account data.
//   - RevenueCat attempt payloads may contain ONLY { attempt, success }.
//   - GATES payloads may contain ONLY boolean gate values.
//
// This is temporary instrumentation for a baseline measurement. It is not a
// permanent logging/analytics system and should be removed or reworked once
// the baseline has been captured and the follow-up (bridge) work is decided.
// ============================================================================

type StartupTracePrimitive = string | number | boolean | null | undefined;

// Allowed payload shape: a flat map of primitives only. This intentionally
// disallows nested objects/arrays (e.g. CustomerInfo, error objects) at the
// type level so call sites cannot accidentally leak structured PII.
export type StartupTracePayload = Record<string, StartupTracePrimitive>;

// Boolean-only payload shape, used for GATES snapshots.
export type StartupGatesPayload = Record<string, boolean>;

let sequence = 0;

const RELEASE_SPLASH_EVENTS = new Set([
  'T_FINAL_DESTINATION_READY',
  'T0_HIDE_NATIVE_SPLASH',
  'T0_HIDE_NATIVE_SPLASH_RESOLVED',
  'T0_HIDE_NATIVE_SPLASH_FAILED',
  'NATIVE_SPLASH_FAILSAFE',
]);

function isTracingEnabled(label: string): boolean {
  // Do not enable logging in non-RN environments without an explicit mode.
  return (
    typeof __DEV__ !== 'undefined' &&
    (__DEV__ || RELEASE_SPLASH_EVENTS.has(label))
  );
}

/**
 * Emit a single [STARTUP] trace line.
 *
 * - `performance.now()` gives a monotonic relative-to-JS-runtime-start
 *   timestamp (ms), useful for measuring deltas between startup phases.
 * - `Date.now()` (wall clock) is included for correlating with external
 *   logs (e.g. Metro/adb logcat timestamps), not for measuring deltas.
 *
 * Never throws: a failure here must never affect app startup.
 */
export function startupTrace(
  label: string,
  payload?: StartupTracePayload
): void {
  if (!isTracingEnabled(label)) return;

  try {
    sequence += 1;
    const relMs = Math.round(performance.now());
    const wall = Date.now();
    const parts = [
      `[STARTUP] #${sequence} ${label} rel=${relMs}ms wall=${wall}`,
    ];
    if (payload && Object.keys(payload).length > 0) {
      parts.push(JSON.stringify(payload));
    }
    // eslint-disable-next-line no-console
    console.log(parts.join(' '));
  } catch {
    // Instrumentation must never break startup.
  }
}

/**
 * Emit a GATES snapshot — boolean-only routing-gate state, for correlating
 * gate transitions with the timed milestones above.
 */
export function startupTraceGates(gates: StartupGatesPayload): void {
  startupTrace('GATES', gates);
}
