// ============================================================================
// qaReset.ts — pure planning/safety helpers for convex/devTools.ts resetQaUser
// ============================================================================
//
// DEV/QA TOOL ONLY. These are pure, side-effect-free functions extracted so
// the safety-critical decision logic behind the resetQaUser internalMutation
// can be unit-tested without a live Convex backend — this repo has no Convex
// mutation test harness (see tests/convex/getPendingPhoneMatches.test.ts's
// documented precedent, which this file follows).
//
// Every function here is a pure decision/transform: no ctx.db access, no
// network calls, no randomness, no wall-clock reads. All actual database
// reads/writes happen in convex/devTools.ts, which calls into these helpers
// with already-fetched data and applies the resulting plan.
//
// Fail-closed philosophy: these helpers never attempt to guess a "best
// effort" cleanup for an ambiguous or unexpected state. If a caller's input
// represents something outside the known-safe scenarios, the corresponding
// function produces a blocker string rather than a destructive decision.
// ============================================================================

/** Mirrors lib/phoneUtils.ts normalizeIsraeliPhone / the duplicated
 * normalizeToE164 in convex/onboarding.ts, convex/members.ts, convex/users.ts.
 * Kept as its own copy (matching the existing repo convention of duplicating
 * this exact function per-file) so this module has zero dependencies beyond
 * itself and is trivially testable in isolation. */
export function normalizeQaPhone(raw: string): string | null {
  const stripped = raw.replace(/[\s\-()]/g, '');
  if (stripped.startsWith('+972')) return stripped;
  if (stripped.startsWith('972')) return `+${stripped}`;
  if (stripped.startsWith('0')) return `+972${stripped.slice(1)}`;
  if (stripped.startsWith('5')) return `+972${stripped}`;
  return null;
}

/**
 * Parses the QA_RESET_ALLOWED_PHONES env var (comma-separated phone numbers,
 * any of the formats normalizeQaPhone accepts) into a normalized E.164
 * allowlist. Invalid/empty entries are silently dropped — an unparseable
 * allowlist entry can never accidentally match a real phone.
 */
export function parseQaResetAllowlist(
  envValue: string | undefined | null
): string[] {
  if (!envValue) return [];
  const normalized: string[] = [];
  for (const raw of envValue.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const phone = normalizeQaPhone(trimmed);
    if (phone) normalized.push(phone);
  }
  return normalized;
}

/** Exact-match allowlist check against an already-normalized phone. */
export function isPhoneAllowlisted(
  normalizedPhone: string,
  allowlist: readonly string[]
): boolean {
  return allowlist.includes(normalizedPhone);
}

export interface ExecutionModeInput {
  dryRun?: boolean;
  execute?: boolean;
}

export interface ExecutionModeResult {
  /** Defaults to true — dryRun must be explicitly set to false to leave dry-run mode. */
  isDryRun: boolean;
  /** True only when dryRun === false AND execute === true. */
  canExecuteLive: boolean;
}

/**
 * dryRun defaults to true. Live execution requires BOTH an explicit
 * dryRun: false AND an explicit execute: true — a caller that only flips one
 * of the two flags never mutates anything.
 */
export function resolveExecutionMode(
  input: ExecutionModeInput
): ExecutionModeResult {
  const isDryRun = input.dryRun !== false;
  const canExecuteLive = !isDryRun && input.execute === true;
  return { isDryRun, canExecuteLive };
}

/**
 * Resolves the exact QA user for a phone from a set of `users` rows matched
 * by the phone index. Fails closed on any ambiguity — zero or multiple
 * matches are never guessed at.
 */
export function checkUsersLookup(matchingUserIds: readonly string[]): {
  qaUserId: string | null;
  blocker: string | null;
} {
  if (matchingUserIds.length === 0) {
    return {
      qaUserId: null,
      blocker: 'No user record found for this phone number.',
    };
  }
  if (matchingUserIds.length > 1) {
    return {
      qaUserId: null,
      blocker: `Multiple (${matchingUserIds.length}) conflicting user records found for this phone number — refusing to guess which one is the QA user.`,
    };
  }
  return { qaUserId: matchingUserIds[0], blocker: null };
}

/**
 * Cross-checks the authAccounts row for this exact phone (provider:'phone')
 * against the users-table match. If the auth account points to a different
 * user than the one resolved via the users table, ownership cannot be
 * resolved safely.
 */
export function checkAuthAccountOwnership(
  phoneAccountUserId: string | null,
  qaUserId: string
): string | null {
  if (phoneAccountUserId !== null && phoneAccountUserId !== qaUserId) {
    return `The authAccounts row for this phone points to user ${phoneAccountUserId}, which does not match the resolved users-table record ${qaUserId} — refusing.`;
  }
  return null;
}

export interface OwnedSpaceAccessInfo {
  spaceId: string;
  spaceName: string;
  /** userIds of every OTHER user (not the QA user) with a kind:'access' row in this space. */
  otherAccessUserIds: string[];
}

export interface OwnedSpaceSafetyResult {
  /** spaceIds that are safe to fully delete (sole QA ownership, no other access rows). */
  deletableSpaceIds: string[];
  /** One entry per owned space that has other users with access — blocks the ENTIRE reset. */
  blockers: string[];
}

/**
 * A QA-owned space is only eligible for deletion when the QA user is the
 * sole access-row holder. If ANY other user has access to ANY QA-owned
 * space, the entire reset is refused — this tool is for isolated onboarding
 * QA accounts only, never for real shared family spaces.
 */
export function evaluateOwnedSpacesSafety(
  spaces: readonly OwnedSpaceAccessInfo[]
): OwnedSpaceSafetyResult {
  const deletableSpaceIds: string[] = [];
  const blockers: string[] = [];
  for (const space of spaces) {
    if (space.otherAccessUserIds.length > 0) {
      blockers.push(
        `Space "${space.spaceName}" (${space.spaceId}) has ${space.otherAccessUserIds.length} other user(s) with access — refusing the entire reset.`
      );
    } else {
      deletableSpaceIds.push(space.spaceId);
    }
  }
  return { deletableSpaceIds, blockers };
}

export interface SpaceScopedRow {
  id: string;
  spaceId: string | undefined;
}

/**
 * Generic helper for the "content created by QA outside their own owned
 * space" safety check (events/tasks/captures created via by_creator/by_user
 * index). A row with no spaceId at all is treated as ambiguous (outside),
 * never assumed safe.
 */
export function findRowsOutsideOwnedSpaces(
  rows: readonly SpaceScopedRow[],
  ownedSpaceIds: ReadonlySet<string>
): SpaceScopedRow[] {
  return rows.filter(
    (row) => row.spaceId === undefined || !ownedSpaceIds.has(row.spaceId)
  );
}

export interface ExternalEntityRowInput {
  matchedUserId?: string;
  userId?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
}

export interface ExternalEntityResetPlan {
  clearMatchedUserId: boolean;
  clearUserId: boolean;
  resetInviteStatusToNone: boolean;
  removeAccessRow: boolean;
}

/**
 * Computes exactly what must change on a single external entity row
 * (a members row owned by ANOTHER user's space whose selectedPhoneNumber
 * matches the QA phone) to safely unlink the QA user, per the current
 * matchOnPhone / acceptPendingPhoneMatch / declinePhoneMatches lifecycle
 * (convex/members.ts):
 *
 *   - matchedUserId is ALWAYS cleared when it points to the QA user — this
 *     is the discovery link (set by matchOnPhone) and must not survive the
 *     QA user's deletion regardless of accept/decline state.
 *   - userId is cleared ONLY if it currently equals the QA user (set only
 *     by acceptPendingPhoneMatch on acceptance — never touched by
 *     matchOnPhone/declinePhoneMatches).
 *   - inviteStatus is reset to 'none' ONLY when it is exactly 'joined' AND
 *     userId === qaUserId (i.e. it was set by acceptPendingPhoneMatch for
 *     THIS QA user's acceptance). A manually-set 'invited'/'none' value
 *     unrelated to this match is never rewritten — matches the current
 *     lifecycle where 'none' is the only value matchOnPhone/decline ever
 *     leave in place, and 'joined' is the only value acceptPendingPhoneMatch
 *     ever writes.
 *   - removeAccessRow is true only when the row was actually accepted
 *     (userId === qaUserId) AND the QA user does have a kind:'access' row
 *     in that same space (the row acceptPendingPhoneMatch inserted).
 *
 * The row itself, its selectedPhoneNumber, displayName, color, and
 * memberType are NEVER part of this plan — they belong to the other user
 * and must always be preserved untouched.
 */
export function planExternalEntityReset(
  row: ExternalEntityRowInput,
  qaUserId: string,
  hasAccessRowInSameSpace: boolean
): ExternalEntityResetPlan {
  const isQaDiscoveryMatch = row.matchedUserId === qaUserId;
  const isQaAccepted = row.userId === qaUserId;

  return {
    clearMatchedUserId: isQaDiscoveryMatch,
    clearUserId: isQaAccepted,
    resetInviteStatusToNone: isQaAccepted && row.inviteStatus === 'joined',
    removeAccessRow: isQaAccepted && hasAccessRowInSameSpace,
  };
}

/** True if a plan actually changes anything (used to skip no-op patches/reports). */
export function externalEntityResetPlanIsNoop(
  plan: ExternalEntityResetPlan
): boolean {
  return (
    !plan.clearMatchedUserId &&
    !plan.clearUserId &&
    !plan.resetInviteStatusToNone &&
    !plan.removeAccessRow
  );
}

export interface FamilyContactEntryLike {
  selectedPhoneNumber?: string;
  matchedUserId?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
  [key: string]: unknown;
}

/**
 * Resets ONLY the familyContacts blob entries (on an external space owner's
 * users record) that are actually linked to the QA user via matchedUserId
 * AND whose selectedPhoneNumber normalizes to the QA phone — mirroring
 * exactly what matchOnPhone/acceptPendingPhoneMatch write into this blob
 * (convex/members.ts). Every other entry — including entries for different
 * family members, or entries whose phone/match do not point at this QA
 * user — is returned completely unchanged (same object reference), so
 * unrelated familyContacts entries are never rewritten.
 */
export function planFamilyContactsReset<T extends FamilyContactEntryLike>(
  contacts: readonly T[],
  normalizedQaPhone: string,
  qaUserId: string,
  normalizePhone: (phone: string) => string | null
): { updated: T[]; changed: boolean } {
  let changed = false;
  const updated = contacts.map((entry): T => {
    if (!entry.selectedPhoneNumber) return entry;
    if (entry.matchedUserId !== qaUserId) return entry;
    const normalizedEntryPhone = normalizePhone(entry.selectedPhoneNumber);
    if (normalizedEntryPhone !== normalizedQaPhone) return entry;

    changed = true;
    const next: T = { ...entry, matchedUserId: undefined };
    if (entry.inviteStatus === 'joined') {
      next.inviteStatus = 'none';
    }
    return next;
  });
  return { updated, changed };
}

/** Safe to execute live iff there are zero blockers. */
export function computeSafeToExecute(blockers: readonly string[]): boolean {
  return blockers.length === 0;
}
