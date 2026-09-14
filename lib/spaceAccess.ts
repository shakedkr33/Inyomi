// ============================================================================
// spaceAccess.ts — pure space-access predicate for Convex authorization
// ============================================================================
//
// Extracted so requireSpaceAccess (convex/birthdays.ts) can be
// unit-tested without a live Convex query harness (this repo has none —
// see tests/convex/getPendingPhoneMatches.test.ts's documented precedent).
// All DB reads (the caller's own `members` rows via the `by_user` index)
// are performed by the Convex query/mutation itself; this module only
// decides, from already-fetched rows, whether the caller has real access
// to a given space.
//
// Mirrors convex/members.ts resolveKind()'s backward-compat inference so
// pre-`kind`-field rows are still classified correctly. Duplicated rather
// than imported (Convex → lib is the established direction elsewhere in
// this repo — e.g. phone normalization is duplicated in convex/*.ts files
// rather than imported from lib/phoneUtils.ts) to avoid a lib → convex
// import in the other direction.
// ============================================================================

export interface SpaceAccessRow {
  spaceId: string;
  kind?: 'access' | 'entity';
  displayName?: string;
  userId?: string;
}

function resolveRowKind(row: SpaceAccessRow): 'access' | 'entity' {
  if (row.kind) return row.kind;
  // Pre-kind rows: access rows have userId + no displayName; everything else is entity.
  if (!row.displayName && row.userId) return 'access';
  return 'entity';
}

/**
 * True when at least one row in `rows` is an access-kind row (admin OR
 * member) for `spaceId` — i.e. the caller has been granted real access to
 * that space via the `members` table, not merely a client-supplied spaceId
 * string with no server-side verification.
 */
export function hasAccessRowForSpace(
  rows: readonly SpaceAccessRow[],
  spaceId: string
): boolean {
  return rows.some(
    (row) => row.spaceId === spaceId && resolveRowKind(row) === 'access'
  );
}
