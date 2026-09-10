// ============================================================================
// calendarProfileFilter.ts — Pure helpers for Calendar profile filtering
// ============================================================================
//
// FIX 9: All profile-matching logic lives here as pure, testable functions.
// Used by both Timeline and Month calendar modes.
//
// Profile matching uses dual-ID resolution:
//   1. Entity _id → matches sharedWithFamilyMemberIds / assignedToMemberIds
//   2. matchedUserId → matches sharedWithUserIds / assignedToUserIds
//
// ============================================================================

/**
 * Minimal profile shape needed for matching.
 * Sourced from listMyFamilyContacts.members.
 */
export interface FilterProfile {
  _id: string;
  matchedUserId?: string;
}

/**
 * A personal event is relevant to profile X if ANY of:
 *   1. event.allFamily === true
 *   2. profile._id is in event.sharedWithFamilyMemberIds
 *   3. profile.matchedUserId is defined AND in event.sharedWithUserIds
 */
export function isPersonalEventRelevantToProfile(
  event: {
    allFamily?: boolean;
    sharedWithFamilyMemberIds?: string[];
    sharedWithUserIds?: string[];
  },
  profile: FilterProfile
): boolean {
  if (event.allFamily) return true;

  if (event.sharedWithFamilyMemberIds?.includes(profile._id)) return true;

  if (
    profile.matchedUserId &&
    event.sharedWithUserIds?.includes(profile.matchedUserId)
  ) {
    return true;
  }

  return false;
}

/**
 * Map of communityId → profileId[] built from getMyProfileAssociations.
 */
export type AssociationMap = Map<string, string[]>;

/**
 * A community event is relevant to profile X according to the following
 * FIX 9 FOLLOW-UP default-association semantics (per user, per community):
 *
 *   - Explicit associations exist (associatedProfileIds.length > 0):
 *     → relevant ONLY to the explicitly-associated profiles. Self is NOT
 *       implicitly included, even if it was previously the default.
 *   - No explicit associations (undefined or []):
 *     → relevant to the CURRENT USER'S OWN canonical Self profile by
 *       default. Any other (non-Self) selected profile does NOT match.
 *
 * This is a semantic fallback evaluated at read time — it never causes the
 * user's profile id to be written into `associatedProfileIds`.
 *
 * `selfProfileId` must be the same canonical Self profile id shown in the
 * Community association picker and Calendar carousels (see
 * `lib/canonicalFamilyMembers.ts`). Passing it as `undefined`/`null`
 * disables the default-to-self fallback (e.g. when the caller has no
 * resolved Self profile yet) — the community then simply has no match for
 * an empty association, matching pre-FIX-9-FOLLOW-UP behavior.
 */
export function isCommunityEventRelevantToProfile(
  event: { communityId?: string },
  profileId: string,
  associationMap: AssociationMap,
  selfProfileId?: string | null
): boolean {
  if (!event.communityId) return false;
  const profiles = associationMap.get(event.communityId);

  if (!profiles || profiles.length === 0) {
    // No explicit association → defaults to Self only.
    return selfProfileId != null && profileId === selfProfileId;
  }

  return profiles.includes(profileId);
}

/**
 * A personal task is relevant to profile X if:
 *   1. profile._id is in task.assignedToMemberIds
 *   2. profile.matchedUserId is defined AND in task.assignedToUserIds
 */
export function isPersonalTaskRelevantToProfile(
  task: {
    assignedToMemberIds?: string[];
    assignedToUserIds?: string[];
  },
  profile: FilterProfile
): boolean {
  if (task.assignedToMemberIds?.includes(profile._id)) return true;

  if (
    profile.matchedUserId &&
    task.assignedToUserIds?.includes(profile.matchedUserId)
  ) {
    return true;
  }

  return false;
}

/**
 * Build an AssociationMap from the getMyProfileAssociations query result.
 */
export function buildAssociationMap(
  associations: Array<{ communityId: string; profileIds: string[] }>
): AssociationMap {
  const map = new Map<string, string[]>();
  for (const a of associations) {
    map.set(a.communityId, a.profileIds);
  }
  return map;
}

// ============================================================================
// ProfileAssociationSheet visual/toggle helpers — FIX 9 FINAL UX FOLLOW-UP
// ============================================================================
//
// The sheet's PERSISTED state (`explicitProfileIds`, i.e. `optimisticIds` in
// the component) never contains Self merely because it is the implicit
// default (see `isCommunityEventRelevantToProfile` above — the same
// undefined/[] → Self fallback rule). These two pure helpers translate that
// same rule into VISUAL selection state and toggle behavior, so the sheet
// can show Self as selected without ever writing it to storage.
// ============================================================================

/**
 * Whether `profileId` should appear visually selected in the association
 * sheet, given the current PERSISTED explicit selection.
 *
 *   - No explicit selection (`explicitProfileIds.length === 0`): only the
 *     canonical Self profile appears selected (the implicit default).
 *   - Explicit selection exists: only explicitly-selected profiles appear
 *     selected — Self is not implicitly added.
 */
export function isProfileVisuallySelectedInAssociationSheet(
  explicitProfileIds: string[],
  selfProfileId: string | null | undefined,
  profileId: string
): boolean {
  if (explicitProfileIds.length === 0) {
    return selfProfileId != null && profileId === selfProfileId;
  }
  return explicitProfileIds.includes(profileId);
}

/**
 * Computes the next PERSISTED explicit selection after the user taps
 * `tappedProfileId`, given the current PERSISTED explicit selection.
 *
 * Returns `null` when the tap must NOT cause any persistence (no-op):
 * tapping the implicitly-selected Self profile while there is no explicit
 * association yet is already visually selected and semantically
 * unchanged, so no mutation should be written (avoids churn / a
 * needless explicit-[Self] write).
 *
 * Otherwise returns the new explicit id array to persist:
 *   - Implicit state (`explicitProfileIds.length === 0`) + tap non-Self
 *     profile A → `[A]` (the user's first explicit choice REPLACES the
 *     implicit default; Self is not carried over into `[Self, A]`).
 *   - Explicit state + tap any profile → standard toggle (add if absent,
 *     remove if present), which may return `[]` when the last explicit
 *     profile is removed — restoring the implicit-Self default on the
 *     next read.
 */
export function computeAssociationToggleResult(
  explicitProfileIds: string[],
  selfProfileId: string | null | undefined,
  tappedProfileId: string
): string[] | null {
  const isImplicitSelfState = explicitProfileIds.length === 0;

  if (
    isImplicitSelfState &&
    selfProfileId != null &&
    tappedProfileId === selfProfileId
  ) {
    return null;
  }

  if (explicitProfileIds.includes(tappedProfileId)) {
    return explicitProfileIds.filter((id) => id !== tappedProfileId);
  }
  return [...explicitProfileIds, tappedProfileId];
}

/**
 * Canonical profile category, used only to order the selectable profile
 * list — never to change matching/filtering semantics.
 *
 * Classification rule (from the current Family Profile model returned by
 * `listMyFamilyContacts.members`):
 *   - 'contact': `matchedUserId` is set → linked to a real app user/contact.
 *   - 'manual':  memberType is 'person' (or unset, defaulting to 'person')
 *                and `matchedUserId` is NOT set → manually-created profile.
 *   - 'pet':     memberType === 'pet'.
 */
type ProfileOrderCategory = 'contact' | 'manual' | 'pet';

const PROFILE_CATEGORY_RANK: Record<ProfileOrderCategory, number> = {
  contact: 0,
  manual: 1,
  pet: 2,
};

function classifyProfileOrderCategory(profile: {
  matchedUserId?: string;
  memberType?: 'person' | 'pet';
}): ProfileOrderCategory {
  const memberType = profile.memberType ?? 'person';
  if (memberType === 'pet') return 'pet';
  return profile.matchedUserId ? 'contact' : 'manual';
}

/**
 * Returns the canonical selectable profile list from listMyFamilyContacts.members.
 *
 * Deduplicates by matchedUserId to avoid showing the same person twice
 * (can happen when a synthetic admin entry and an entity row both exist
 * for the same matchedUserId).
 *
 * Applies the canonical FIX 9 category ordering — contact/linked profiles,
 * then manual person profiles, then pets — via a stable sort, so profiles
 * keep their existing relative order (as returned by the query) within each
 * category. No secondary alphabetical (or other) sort is introduced.
 *
 * This is the single ordering source for every FIX 9 selectable-profile
 * surface (Community ProfileAssociationSheet, Calendar Timeline carousel,
 * Calendar Filter Bottom Sheet) — callers must not re-sort/re-reverse the
 * result.
 *
 * Does NOT automatically exclude self — the caller's screen decides based
 * on the UX context.
 */
export function getSelectableProfiles<
  T extends {
    _id: string;
    matchedUserId?: string;
    memberType?: 'person' | 'pet';
  },
>(members: T[]): T[] {
  const seenMatchedUserIds = new Set<string>();
  const deduped: T[] = [];
  for (const m of members) {
    if (m.matchedUserId) {
      if (seenMatchedUserIds.has(m.matchedUserId)) continue;
      seenMatchedUserIds.add(m.matchedUserId);
    }
    deduped.push(m);
  }
  // Array.prototype.sort is spec-guaranteed stable (ES2019+), so items with
  // equal category rank retain their original relative order.
  return deduped
    .slice()
    .sort(
      (a, b) =>
        PROFILE_CATEGORY_RANK[classifyProfileOrderCategory(a)] -
        PROFILE_CATEGORY_RANK[classifyProfileOrderCategory(b)]
    );
}
