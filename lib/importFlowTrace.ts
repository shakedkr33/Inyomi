// ============================================================================
// importFlowTrace — TEMPORARY diagnostics for the Calendar Import onboarding
// bug (Google account chooser returns to the intro stage instead of advancing
// to calendar selection). REMOVE once the root cause is confirmed and fixed.
// ============================================================================
// Development builds only (__DEV__). Payloads are flat maps of primitives —
// never pass tokens, authorization codes, PKCE verifiers, client IDs, redirect
// URIs, user IDs, phone numbers or error objects.
// ============================================================================

type ImportTracePrimitive = string | number | boolean | null | undefined;
export type ImportTracePayload = Record<string, ImportTracePrimitive>;

let sequence = 0;
let instanceCounter = 0;

/** Returns a small monotonically increasing id to tell mounts apart. */
export function nextImportTraceInstanceId(): number {
  instanceCounter += 1;
  return instanceCounter;
}

export function importTrace(label: string, payload?: ImportTracePayload): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  try {
    sequence += 1;
    const suffix =
      payload && Object.keys(payload).length > 0
        ? ` ${JSON.stringify(payload)}`
        : '';
    console.log(`[IMPORT_TRACE] #${sequence} ${label}${suffix}`);
  } catch {
    // Diagnostics must never affect app behavior.
  }
}
