// ============================================================================
// canonicalFamilyMembers.ts — Pure helper for FIX 9 FOLLOW-UP
// ============================================================================
//
// Normalizes the "canonical Self Family Profile" representation so every
// user (space admin OR joined family member) can select their own profile
// exactly once, regardless of how they are represented in storage:
//
//   - Joined family member: has a `kind: 'entity'` members row for
//     themselves (created when an admin adds them as a family contact;
//     phone-matched to their userId via matchOnPhone). That row IS their
//     canonical Self and is already present in the entity list — no
//     synthetic row is needed or injected.
//   - Space admin: has no `entity` row for themselves, only their own
//     `kind: 'access'` row. Their canonical Self must be synthesized from
//     that access row (the same representation shape already used to show
//     the admin to OTHER family members) — but injected exactly once, and
//     ONLY when no real entity row already represents them.
//
// This is intentionally NOT a role-based special case ("if admin then...").
// The rule is: if the viewer has no entity-row Self, synthesize Self from
// their own access row. This works identically whether the viewer happens
// to be an admin or (hypothetically) any other access-kind user without an
// entity row — the admin/member distinction is normalized away.
//
// The synthetic candidate is a read-time display/matching representation
// only. Nothing is persisted — no members row is written by this helper.
//
// ============================================================================

/** Minimal shape every canonical candidate must satisfy. */
export interface CanonicalSelfCandidate {
  _id: string;
}

export interface BuildCanonicalFamilyMembersParams<
  TEntity extends { _id: string },
  TSelf extends CanonicalSelfCandidate,
  TOther extends { _id: string },
> {
  /** Entity rows for the space (already enriched for display). */
  entities: TEntity[];
  /**
   * `_id` of the entity row that represents the viewer, if one already
   * exists (i.e. the viewer is a joined family member with their own
   * `kind: 'entity'` row).
   */
  selfEntityId: string | null;
  /**
   * Synthetic Self candidate built from the viewer's own access row + user
   * record. Only used when `selfEntityId` is null — never injected when a
   * real entity row already represents the viewer, so Self can never
   * appear twice.
   */
  syntheticSelfCandidate: TSelf | null;
  /**
   * Synthetic representation of ANOTHER user (e.g. the space admin, shown
   * to other family members who are not the admin). This is unrelated to
   * the viewer's own Self and is never confused with it — both can be
   * computed independently without interacting.
   */
  otherAccessEntry: TOther | null;
}

export interface CanonicalFamilyMembersResult<
  TEntity extends { _id: string },
  TSelf extends CanonicalSelfCandidate,
  TOther extends { _id: string },
> {
  /**
   * Canonical Self profile id. This is the SAME id used both for display
   * (Community association picker, Calendar carousels/filter) and for
   * default-to-self association matching — there is only one id.
   */
  selfId: string | null;
  /** Final member list with Self appearing exactly once. */
  members: Array<TEntity | TSelf | TOther>;
}

export function buildCanonicalFamilyMembers<
  TEntity extends { _id: string },
  TSelf extends CanonicalSelfCandidate,
  TOther extends { _id: string },
>(
  params: BuildCanonicalFamilyMembersParams<TEntity, TSelf, TOther>
): CanonicalFamilyMembersResult<TEntity, TSelf, TOther> {
  const injectSynthetic =
    params.selfEntityId == null && params.syntheticSelfCandidate != null;

  const members: Array<TEntity | TSelf | TOther> = [
    ...(params.otherAccessEntry ? [params.otherAccessEntry] : []),
    ...(injectSynthetic ? [params.syntheticSelfCandidate as TSelf] : []),
    ...params.entities,
  ];

  const selfId =
    params.selfEntityId ??
    (injectSynthetic ? (params.syntheticSelfCandidate as TSelf)._id : null);

  return { selfId, members };
}
