// ============================================================================
// accountDeletionUi.ts — pure client-side orchestration helpers for the
// Profile → "מחיקת חשבון" (Delete Account) UI flow.
// ============================================================================
//
// This module owns ONLY client-side orchestration around the existing
// production backend mutation (`api.users.deleteMyAccount`, see
// convex/accountDeletion.ts / convex/users.ts). It never re-implements or
// changes backend deletion semantics — it only:
//
//   - guards against a second concurrent deletion request (single-flight),
//   - decides what error text to show when the backend mutation rejects,
//   - runs the existing local cleanup utilities (clearOnboardingDraft,
//     resetData, signOut) in the canonical order, and ONLY when explicitly
//     invoked by the caller after a confirmed backend success.
//
// Kept as plain, dependency-injected functions (no ctx/db/RN imports) so
// the success/failure/duplicate-submission orchestration can be unit
// tested with `bun test` without mounting any React Native component —
// mirrors the existing precedent in lib/services/__tests__/importFlowStages.test.ts.
// ============================================================================

/**
 * Calm, non-technical fallback shown when the backend mutation throws an
 * error whose message is missing/empty, unrecognized, or not known to be
 * free of internal detail — never exposes internal ids or stack traces.
 */
export const GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE =
  'לא ניתן לאשר שמחיקת החשבון הושלמה. אפשר לנסות שוב או לפנות לתמיכה דרך מידע ובקשת מחיקת חשבון.';

/**
 * Shown for a recognized "legacy/unsafe data" backend blocker — these
 * source messages (see below) are known to sometimes embed a raw Convex
 * document id or internal field/table name, so they are NEVER shown
 * verbatim. This replacement message is id-free and support-actionable.
 */
export const LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE =
  'לא ניתן להשלים כרגע את מחיקת החשבון באופן בטוח. יש לפנות לתמיכה כדי להשלים את המחיקה.';

export const SHARED_OWNERSHIP_ACCOUNT_DELETION_ERROR_MESSAGE =
  'החשבון הוא בעלים של מרחב משותף. כדי להגן על המידע של שאר החברים, נדרש טיפול בתמיכה לפני המחיקה. אפשר לפתוח מידע ובקשת מחיקה.';

// ── Known-safe backend blocker patterns ─────────────────────────────────────
//
// These mirror the EXACT (non-technical) Hebrew blocker strings the
// production account-deletion engine throws (see
// lib/accountDeletion.ts#planOwnedSpaceDeletion /
// #planOwnedCommunityDeletion and
// evaluateAccountDeletionTransactionSize). Each one only ever
// interpolates a user-owned entity NAME or a plain record COUNT — never a
// Convex id, stack trace, or internal field/table name — so they are safe
// to show verbatim. Do NOT add a pattern here without confirming (by
// reading the actual throw site) that it can never embed an id.
const FAMILY_OWNERSHIP_BLOCKER_PATTERN =
  /^לא ניתן למחוק את החשבון: מרחב המשפחה ".*" בבעלותך משותף עם \d+ משתמש\/ים נוספים\. יש להעביר בעלות או להסיר אותם מהמרחב לפני מחיקת החשבון\.$/;

const COMMUNITY_OWNERSHIP_BLOCKER_PATTERN =
  /^לא ניתן למחוק את החשבון: הקהילה ".*" בבעלותך כוללת \d+ חבר\/ים פעילים נוספים\. יש להעביר בעלות או להסיר אותם מהקהילה לפני מחיקת החשבון\.$/;

const TRANSACTION_SIZE_BLOCKER_PATTERN =
  /^לא ניתן למחוק את החשבון באופן מיידי: היקף המחיקה המתוכנן \(\d+ רשומות\) חורג מהסף הבטוח \(\d+\)\. נא לפנות לתמיכה\.$/;

/**
 * Substrings that identify a "legacy/unsafe data" backend failure — an
 * ambiguous legacy-record classification blocker (embeds `event._id` /
 * `task._id`, see lib/accountDeletion.ts#planOwnedContentDisposition call
 * sites in convex/accountDeletion.ts) or a post-write verification
 * failure (names internal fields/tables like `assignedToUserIds` /
 * `eventTasks` / `members`). Matched anywhere in the message so a
 * multi-line `blockers.join('\n')` message containing even one of these
 * is treated as unsafe as a whole.
 */
const LEGACY_UNSAFE_DATA_BLOCKER_MARKERS = [
  'לא ניתן להשלים סגירת מרחב בבטחה',
  'לא ניתן לסווג באופן חד-משמעי',
  'אימות מחיקת החשבון נכשל',
  // Community ownership transfer could not be determined safely (see
  // lib/accountDeletion.ts `planCommunityOwnershipTransfer` — inconsistent
  // membership data, e.g. a broken active-member/user link or more than
  // one active 'owner' row). This blocker only ever embeds the
  // community's NAME, but is still routed through the generic support
  // message for consistency with the other "backend data problem, not a
  // normal actionable blocker" cases above — normal automatic community
  // transfer never produces a user-facing blocker at all.
  'לא ניתן להעביר באופן בטוח את הבעלות על הקהילה',
];

function isKnownSafeBlockerLine(line: string): boolean {
  return (
    FAMILY_OWNERSHIP_BLOCKER_PATTERN.test(line) ||
    COMMUNITY_OWNERSHIP_BLOCKER_PATTERN.test(line) ||
    TRANSACTION_SIZE_BLOCKER_PATTERN.test(line)
  );
}

function isLegacyUnsafeDataBlockerLine(line: string): boolean {
  return LEGACY_UNSAFE_DATA_BLOCKER_MARKERS.some((marker) =>
    line.includes(marker)
  );
}

/**
 * Extracts a user-readable, sanitized Hebrew error message from a failed
 * `deleteMyAccount` call. Never displays a raw Convex id, stack trace, or
 * other internal/technical detail.
 *
 * A rejected deletion can report MULTIPLE blockers joined by `\n` (see
 * `plan.blockers.join('\n')` in convex/accountDeletion.ts), so this
 * inspects every joined line individually:
 *
 *   - If ANY line is a known "legacy/unsafe data" blocker (may embed an
 *     id or internal field/table name), the WHOLE message is replaced
 *     with the calm, id-free support message — never partially shown.
 *   - Else, if EVERY line matches a known-safe blocker pattern (family
 *     ownership, community ownership, or the transaction-size/support
 *     limit — none of which can embed an id), the original message is
 *     preserved, except the family blocker is directed to support because
 *     self-service ownership transfer/member removal is unavailable.
 *   - Any other/unrecognized error shape (including non-`Error` throws,
 *     empty messages, or unrecognized text) falls back to the generic
 *     calm Hebrew message rather than risking a technical leak.
 */
export function resolveAccountDeletionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE;
  }

  const message = error.message.trim();
  if (message.length === 0) {
    return GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE;
  }

  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE;
  }

  if (lines.some(isLegacyUnsafeDataBlockerLine)) {
    return LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE;
  }

  if (lines.every(isKnownSafeBlockerLine)) {
    // The legacy backend text suggests transfer/removal, but safe family
    // transfer is not implemented and authenticated-member removal is blocked.
    if (lines.some((line) => FAMILY_OWNERSHIP_BLOCKER_PATTERN.test(line))) {
      return SHARED_OWNERSHIP_ACCOUNT_DELETION_ERROR_MESSAGE;
    }
    return lines.join('\n');
  }

  return GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE;
}

export type AccountDeletionExecutionResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Calls the real backend deletion mutation exactly once and reports
 * success/failure. NEVER performs any local cleanup, sign-out, or
 * re-invocation — callers must only run local cleanup after this returns
 * `{ ok: true }`.
 */
export async function executeAccountDeletion(
  deleteMyAccount: () => Promise<unknown>
): Promise<AccountDeletionExecutionResult> {
  try {
    const result = await deleteMyAccount();
    if (
      typeof result !== 'object' ||
      result === null ||
      !('success' in result) ||
      result.success !== true
    ) {
      return { ok: false, message: GENERIC_ACCOUNT_DELETION_ERROR_MESSAGE };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: resolveAccountDeletionErrorMessage(error) };
  }
}

export interface AccountDeletionCleanupDeps {
  clearAccountCache?: () => Promise<void>;
  clearOnboardingDraft: () => Promise<void>;
  resetData: () => void;
  signOut: () => Promise<void>;
}

/**
 * Runs the existing local cleanup utilities in the canonical order. Must
 * ONLY be called after `executeAccountDeletion` has already resolved with
 * `{ ok: true }` — this function never calls the backend mutation itself
 * and never guards against being called before a confirmed success; that
 * invariant is the caller's responsibility (see profile.tsx).
 */
export async function runAccountDeletionCleanup(
  deps: AccountDeletionCleanupDeps
): Promise<{ cleanupSucceeded: boolean }> {
  let cleanupSucceeded = true;
  // A storage failure must not strand a deleted account signed in. Attempt
  // every cleanup step and let the UI report incomplete local cleanup.
  for (const cleanup of [
    deps.clearAccountCache,
    deps.clearOnboardingDraft,
    deps.resetData,
    deps.signOut,
  ]) {
    try {
      await cleanup?.();
    } catch {
      cleanupSucceeded = false;
    }
  }
  return { cleanupSucceeded };
}

export interface AccountDeletionGuard {
  /** True while a guarded call is currently in flight. */
  isRunning: () => boolean;
  /**
   * Runs `fn` unless a previous call is still in flight, in which case it
   * returns `null` immediately WITHOUT invoking `fn` again — this is the
   * single-flight guard against duplicate submissions (e.g. a double tap
   * on the final destructive confirmation button).
   */
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
}

/** Creates a fresh single-flight guard. One guard instance per screen/flow. */
export function createAccountDeletionGuard(): AccountDeletionGuard {
  let running = false;
  return {
    isRunning: () => running,
    run: async <T>(fn: () => Promise<T>): Promise<T | null> => {
      if (running) {
        return null;
      }
      running = true;
      try {
        return await fn();
      } finally {
        running = false;
      }
    },
  };
}
