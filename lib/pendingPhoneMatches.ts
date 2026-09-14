// ============================================================================
// pendingPhoneMatches.ts — Stage 2A pure helper for getPendingPhoneMatches
// ============================================================================
//
// Pure filtering logic for the getPendingPhoneMatches query
// (convex/members.ts). All DB reads (candidate members rows via the
// by_phone index, the caller's own access-row spaceIds, and space
// existence checks) are performed by the Convex query itself; this module
// only decides, from already-fetched data, which candidate rows are safe
// to surface to the caller as a pending phone match. The query handler maps
// the filtered rows into the minimal-safe response shape (kept out of this
// module so Convex Id<> typing is preserved end-to-end without casts).
//
// Stage 2A scope: this is DISCOVERY-ONLY — it never grants access, never
// auto-selects a single match (returns the full safe array), and never
// exposes phone numbers, other users' ids, or space content beyond a name.
// matchOnPhone itself is intentionally NOT modified in Stage 2A (its
// current auto-join behavior is unchanged) — see the Stage 2B+3 plan for
// the hardening pass that will replace it atomically with a confirmation
// flow built on top of this query.
// ============================================================================

export interface PendingMatchCandidateRow {
  _id: string;
  spaceId: string;
  kind?: 'access' | 'entity';
  userId?: string;
  matchedUserId?: string;
  selectedPhoneNumber?: string;
  displayName?: string;
}

export interface FilterPendingPhoneMatchCandidatesInput<
  TRow extends PendingMatchCandidateRow,
> {
  currentUserId: string;
  /** Already normalized (E.164) phone of the authenticated caller. */
  normalizedUserPhone: string;
  /**
   * Candidate member rows. Callers typically pre-scope this via the
   * members `by_phone` index (same index matchOnPhone uses), but this
   * function re-verifies the phone match itself as defense-in-depth and
   * does not trust the caller's pre-filtering alone.
   */
  candidateRows: TRow[];
  /** spaceIds where the caller already has a kind:'access' row. */
  accessSpaceIds: ReadonlySet<string>;
  /** spaceIds that still exist (not deleted/missing). */
  existingSpaceIds: ReadonlySet<string>;
  resolveKind: (row: {
    kind?: 'access' | 'entity';
    displayName?: string;
    userId?: string;
  }) => 'access' | 'entity';
  normalizeToE164: (phone: string) => string | null;
}

/**
 * Returns only the candidate rows that are safe to surface as a pending
 * phone match for the caller: entity rows (never access rows) that were
 * discovery-matched to the caller (matchedUserId === currentUserId) via a
 * phone number the caller still holds, excluding spaces the caller already
 * has access to and any space that no longer exists.
 *
 * Generic over TRow so real Convex `Doc<'members'>` rows (with branded
 * `Id<...>` fields) can be passed in and returned unchanged — the caller
 * maps the returned rows into the public response shape.
 *
 * Never auto-selects a single match — returns the full safe subset so a
 * confirmation UI can present all candidates (Stage 2B+3).
 */
export function filterPendingPhoneMatchCandidates<
  TRow extends PendingMatchCandidateRow,
>(input: FilterPendingPhoneMatchCandidatesInput<TRow>): TRow[] {
  return input.candidateRows.filter((row) => {
    // Must be a visible family entity row, never an access row.
    if (input.resolveKind(row) !== 'entity') return false;

    // Must actually be matched to the calling user (not merely same phone —
    // e.g. a row matched to a different user who shares the same phone
    // string due to a data anomaly must never be returned).
    if (row.matchedUserId !== input.currentUserId) return false;

    // Defense-in-depth: re-verify the phone match independently of how the
    // candidate list was fetched.
    if (!row.selectedPhoneNumber) return false;
    const normalizedRowPhone = input.normalizeToE164(row.selectedPhoneNumber);
    if (
      !normalizedRowPhone ||
      normalizedRowPhone !== input.normalizedUserPhone
    ) {
      return false;
    }

    // Already has access to this space — nothing pending to confirm.
    if (input.accessSpaceIds.has(row.spaceId)) return false;

    // Space no longer exists — nothing safe to offer.
    if (!input.existingSpaceIds.has(row.spaceId)) return false;

    return true;
  });
}
