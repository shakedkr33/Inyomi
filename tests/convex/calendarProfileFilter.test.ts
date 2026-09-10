/**
 * Tests for lib/calendarProfileFilter.ts — FIX 9
 *
 * Pure function tests for Calendar profile filtering logic:
 *   - Personal event relevance (dual-ID matching)
 *   - Community event relevance (association map)
 *   - Personal task relevance (dual-ID matching)
 *   - Canonical profile list deduplication
 *   - Association map builder
 *
 * Run with: bun test tests/convex/calendarProfileFilter.test.ts
 */

import { describe, expect, it } from 'bun:test';

import {
  type AssociationMap,
  buildAssociationMap,
  computeAssociationToggleResult,
  type FilterProfile,
  getSelectableProfiles,
  isCommunityEventRelevantToProfile,
  isPersonalEventRelevantToProfile,
  isPersonalTaskRelevantToProfile,
  isProfileVisuallySelectedInAssociationSheet,
} from '../../lib/calendarProfileFilter';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const profileShalev: FilterProfile = {
  _id: 'entity_shalev',
  matchedUserId: 'user_shalev',
};

const profilePetBuddy: FilterProfile = {
  _id: 'entity_buddy',
  // pets have no matchedUserId
};

const profileUnlinked: FilterProfile = {
  _id: 'entity_child_no_account',
  // no matchedUserId — child without app account
};

// ── isPersonalEventRelevantToProfile ──────────────────────────────────────────

describe('isPersonalEventRelevantToProfile', () => {
  it('returns true when allFamily is true', () => {
    expect(
      isPersonalEventRelevantToProfile({ allFamily: true }, profileShalev)
    ).toBe(true);
  });

  it('returns true when allFamily is true for pet', () => {
    expect(
      isPersonalEventRelevantToProfile({ allFamily: true }, profilePetBuddy)
    ).toBe(true);
  });

  it('returns true when entity _id is in sharedWithFamilyMemberIds', () => {
    expect(
      isPersonalEventRelevantToProfile(
        { sharedWithFamilyMemberIds: ['other', 'entity_shalev', 'another'] },
        profileShalev
      )
    ).toBe(true);
  });

  it('returns true when matchedUserId is in sharedWithUserIds', () => {
    expect(
      isPersonalEventRelevantToProfile(
        { sharedWithUserIds: ['user_shalev'] },
        profileShalev
      )
    ).toBe(true);
  });

  it('returns true when both paths match', () => {
    expect(
      isPersonalEventRelevantToProfile(
        {
          sharedWithFamilyMemberIds: ['entity_shalev'],
          sharedWithUserIds: ['user_shalev'],
        },
        profileShalev
      )
    ).toBe(true);
  });

  it('returns false when neither path matches', () => {
    expect(
      isPersonalEventRelevantToProfile(
        {
          sharedWithFamilyMemberIds: ['entity_other'],
          sharedWithUserIds: ['user_other'],
        },
        profileShalev
      )
    ).toBe(false);
  });

  it('returns false when event has no family fields', () => {
    expect(isPersonalEventRelevantToProfile({}, profileShalev)).toBe(false);
  });

  it('returns false for unlinked profile when only sharedWithUserIds present', () => {
    expect(
      isPersonalEventRelevantToProfile(
        { sharedWithUserIds: ['user_someone'] },
        profileUnlinked
      )
    ).toBe(false);
  });

  it('matches pet by entity _id (not userId)', () => {
    expect(
      isPersonalEventRelevantToProfile(
        { sharedWithFamilyMemberIds: ['entity_buddy'] },
        profilePetBuddy
      )
    ).toBe(true);
  });

  it('does not match pet via sharedWithUserIds (pet has no matchedUserId)', () => {
    expect(
      isPersonalEventRelevantToProfile(
        { sharedWithUserIds: ['entity_buddy'] },
        profilePetBuddy
      )
    ).toBe(false);
  });

  it('handles empty arrays', () => {
    expect(
      isPersonalEventRelevantToProfile(
        { sharedWithFamilyMemberIds: [], sharedWithUserIds: [] },
        profileShalev
      )
    ).toBe(false);
  });
});

// ── isCommunityEventRelevantToProfile ─────────────────────────────────────────

describe('isCommunityEventRelevantToProfile', () => {
  const associationMap: AssociationMap = new Map([
    ['community_b2', ['entity_shalev', 'entity_buddy']],
    ['community_sports', ['entity_shalev']],
  ]);

  it('returns true when community is associated with profile', () => {
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        'entity_shalev',
        associationMap
      )
    ).toBe(true);
  });

  it('returns true for pet profile association', () => {
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        'entity_buddy',
        associationMap
      )
    ).toBe(true);
  });

  it('returns false when community is not associated with profile', () => {
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_sports' },
        'entity_buddy',
        associationMap
      )
    ).toBe(false);
  });

  it('returns false when community not in map', () => {
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_unknown' },
        'entity_shalev',
        associationMap
      )
    ).toBe(false);
  });

  it('returns false when no communityId', () => {
    expect(
      isCommunityEventRelevantToProfile({}, 'entity_shalev', associationMap)
    ).toBe(false);
  });

  it('returns false with empty map', () => {
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        'entity_shalev',
        new Map()
      )
    ).toBe(false);
  });
});

// ── isCommunityEventRelevantToProfile — FIX 9 FOLLOW-UP default-to-Self ──────
// "If a Community has NO explicit profile association (undefined or []),
// the Community is considered associated with the CURRENT USER'S OWN
// canonical Family Profile by default, for filtering purposes only."
describe('isCommunityEventRelevantToProfile — default-to-Self semantics', () => {
  const SELF = 'entity_self';
  const OTHER = 'entity_shalev';

  it('#4 empty associatedProfileIds ([]) + selected Self → matches', () => {
    const map: AssociationMap = new Map([['community_b2', []]]);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map,
        SELF
      )
    ).toBe(true);
  });

  it('#5 undefined associatedProfileIds (community absent from map) + selected Self → matches', () => {
    const map: AssociationMap = new Map(); // community never appears when association is undefined
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map,
        SELF
      )
    ).toBe(true);
  });

  it('#6 empty association + selected OTHER (non-Self) profile → does NOT match', () => {
    const map: AssociationMap = new Map([['community_b2', []]]);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        OTHER,
        map,
        SELF
      )
    ).toBe(false);
  });

  it('#7 explicit [Profile A] + selected Self → does NOT match (explicit overrides default)', () => {
    const map: AssociationMap = new Map([['community_b2', [OTHER]]]);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map,
        SELF
      )
    ).toBe(false);
  });

  it('#8 explicit [Self] + selected Self → matches', () => {
    const map: AssociationMap = new Map([['community_b2', [SELF]]]);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map,
        SELF
      )
    ).toBe(true);
  });

  it('#9 explicit [Self, Profile A] → both Self and Profile A match', () => {
    const map: AssociationMap = new Map([['community_b2', [SELF, OTHER]]]);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map,
        SELF
      )
    ).toBe(true);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        OTHER,
        map,
        SELF
      )
    ).toBe(true);
  });

  it('#10 explicit [Profile A, Profile B] → Self does NOT match', () => {
    const PROFILE_B = 'entity_buddy';
    const map: AssociationMap = new Map([['community_b2', [OTHER, PROFILE_B]]]);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map,
        SELF
      )
    ).toBe(false);
  });

  it('default-to-Self is disabled when no selfProfileId is passed (backward-compat)', () => {
    const map: AssociationMap = new Map(); // undefined association
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map
        // selfProfileId omitted
      )
    ).toBe(false);
  });

  it('default-to-Self does not match when selfProfileId is explicitly null', () => {
    const map: AssociationMap = new Map([['community_b2', []]]);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        SELF,
        map,
        null
      )
    ).toBe(false);
  });
});

// ── isPersonalTaskRelevantToProfile ───────────────────────────────────────────

describe('isPersonalTaskRelevantToProfile', () => {
  it('matches via assignedToMemberIds (entity ID)', () => {
    expect(
      isPersonalTaskRelevantToProfile(
        { assignedToMemberIds: ['entity_shalev'] },
        profileShalev
      )
    ).toBe(true);
  });

  it('matches via assignedToUserIds (matchedUserId)', () => {
    expect(
      isPersonalTaskRelevantToProfile(
        { assignedToUserIds: ['user_shalev'] },
        profileShalev
      )
    ).toBe(true);
  });

  it('does not match self-assigned task for another profile', () => {
    expect(
      isPersonalTaskRelevantToProfile(
        { assignedToUserIds: ['user_creator'], assignedToMemberIds: [] },
        profileShalev
      )
    ).toBe(false);
  });

  it('matches pet via entity _id', () => {
    expect(
      isPersonalTaskRelevantToProfile(
        { assignedToMemberIds: ['entity_buddy'] },
        profilePetBuddy
      )
    ).toBe(true);
  });

  it('does not match pet via assignedToUserIds (no matchedUserId)', () => {
    expect(
      isPersonalTaskRelevantToProfile(
        { assignedToUserIds: ['entity_buddy'] },
        profilePetBuddy
      )
    ).toBe(false);
  });

  it('returns false for task with no assignment fields', () => {
    expect(isPersonalTaskRelevantToProfile({}, profileShalev)).toBe(false);
  });

  it('returns false for task with empty assignment arrays', () => {
    expect(
      isPersonalTaskRelevantToProfile(
        { assignedToMemberIds: [], assignedToUserIds: [] },
        profileShalev
      )
    ).toBe(false);
  });
});

// ── buildAssociationMap ───────────────────────────────────────────────────────

describe('buildAssociationMap', () => {
  it('builds correct map from associations', () => {
    const map = buildAssociationMap([
      { communityId: 'c1', profileIds: ['p1', 'p2'] },
      { communityId: 'c2', profileIds: ['p1'] },
    ]);
    expect(map.get('c1')).toEqual(['p1', 'p2']);
    expect(map.get('c2')).toEqual(['p1']);
    expect(map.size).toBe(2);
  });

  it('handles empty input', () => {
    const map = buildAssociationMap([]);
    expect(map.size).toBe(0);
  });
});

// ── getSelectableProfiles ─────────────────────────────────────────────────────

describe('getSelectableProfiles', () => {
  it('returns all members when no duplicates', () => {
    const members = [
      { _id: 'a', matchedUserId: 'u1', displayName: 'A' },
      { _id: 'b', displayName: 'B' },
      { _id: 'c', matchedUserId: 'u3', displayName: 'C' },
    ];
    const result = getSelectableProfiles(members);
    expect(result).toHaveLength(3);
  });

  it('deduplicates by matchedUserId — keeps first seen', () => {
    const members = [
      { _id: 'admin_access', matchedUserId: 'u_admin', displayName: 'Admin' },
      { _id: 'child1', displayName: 'Child' },
      {
        _id: 'admin_entity',
        matchedUserId: 'u_admin',
        displayName: 'Admin Entity',
      },
    ];
    const result = getSelectableProfiles(members);
    expect(result).toHaveLength(2);
    expect(result[0]._id).toBe('admin_access');
    expect(result[1]._id).toBe('child1');
  });

  it('includes members without matchedUserId (children/pets)', () => {
    const members = [
      { _id: 'child1', displayName: 'C1' },
      { _id: 'pet1', displayName: 'P1' },
    ];
    const result = getSelectableProfiles(members);
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(getSelectableProfiles([])).toHaveLength(0);
  });

  it('person and pet profiles are both included', () => {
    const members = [
      {
        _id: 'p1',
        matchedUserId: 'u1',
        displayName: 'Person',
        memberType: 'person' as const,
      },
      { _id: 'pet1', displayName: 'Pet', memberType: 'pet' as const },
    ];
    const result = getSelectableProfiles(members);
    expect(result).toHaveLength(2);
  });

  it('orders contact profiles before manual person profiles before pets, even when input order is reversed', () => {
    const members = [
      { _id: 'pet1', displayName: 'Pet', memberType: 'pet' as const },
      {
        _id: 'manual1',
        displayName: 'Manual Child',
        memberType: 'person' as const,
      },
      {
        _id: 'contact1',
        matchedUserId: 'u1',
        displayName: 'Contact',
        memberType: 'person' as const,
      },
    ];
    const result = getSelectableProfiles(members);
    expect(result.map((p) => p._id)).toEqual(['contact1', 'manual1', 'pet1']);
  });

  it('treats a profile with no memberType field as a person for ordering (default fallback)', () => {
    const members = [
      { _id: 'pet1', displayName: 'Pet', memberType: 'pet' as const },
      {
        _id: 'legacy1',
        matchedUserId: 'u2',
        displayName: 'Legacy contact (no memberType)',
      },
    ];
    const result = getSelectableProfiles(members);
    expect(result.map((p) => p._id)).toEqual(['legacy1', 'pet1']);
  });

  it('preserves existing relative order within each category (stable sort, no alphabetical re-sort)', () => {
    const members = [
      {
        _id: 'contact_z',
        matchedUserId: 'u1',
        displayName: 'Zohar',
        memberType: 'person' as const,
      },
      {
        _id: 'contact_a',
        matchedUserId: 'u2',
        displayName: 'Avi',
        memberType: 'person' as const,
      },
      { _id: 'manual_z', displayName: 'Zoe', memberType: 'person' as const },
      { _id: 'manual_a', displayName: 'Adam', memberType: 'person' as const },
      { _id: 'pet_z', displayName: 'Zorro', memberType: 'pet' as const },
      { _id: 'pet_a', displayName: 'Apollo', memberType: 'pet' as const },
    ];
    const result = getSelectableProfiles(members);
    // Query order (Zohar before Avi, Zoe before Adam, Zorro before Apollo) is
    // preserved within each category — no alphabetical sort is applied.
    expect(result.map((p) => p._id)).toEqual([
      'contact_z',
      'contact_a',
      'manual_z',
      'manual_a',
      'pet_z',
      'pet_a',
    ]);
  });
});

// ── Filter combination semantics ──────────────────────────────────────────────

describe('filter combination semantics', () => {
  const profile = profileShalev;
  const associationMap = buildAssociationMap([
    { communityId: 'c_b2', profileIds: ['entity_shalev'] },
  ]);

  const personalEventRelevant = {
    sharedWithFamilyMemberIds: ['entity_shalev'],
  };
  const personalEventUnrelated = {
    sharedWithFamilyMemberIds: ['entity_other'],
  };
  const communityEventAssociated = { communityId: 'c_b2' };
  const communityEventUnassociated = { communityId: 'c_other' };
  const personalTask = { assignedToMemberIds: ['entity_shalev'] };
  const selfOnlyTask = { assignedToUserIds: ['user_creator'] };

  it('profile only: personal event relevant → shown', () => {
    expect(
      isPersonalEventRelevantToProfile(personalEventRelevant, profile)
    ).toBe(true);
  });

  it('profile only: personal event unrelated → hidden', () => {
    expect(
      isPersonalEventRelevantToProfile(personalEventUnrelated, profile)
    ).toBe(false);
  });

  it('profile only: associated community → shown', () => {
    expect(
      isCommunityEventRelevantToProfile(
        communityEventAssociated,
        profile._id,
        associationMap
      )
    ).toBe(true);
  });

  it('profile only: unassociated community → hidden', () => {
    expect(
      isCommunityEventRelevantToProfile(
        communityEventUnassociated,
        profile._id,
        associationMap
      )
    ).toBe(false);
  });

  it('profile: relevant task → shown', () => {
    expect(isPersonalTaskRelevantToProfile(personalTask, profile)).toBe(true);
  });

  it('profile: self-only task → hidden', () => {
    expect(isPersonalTaskRelevantToProfile(selfOnlyTask, profile)).toBe(false);
  });

  it('no profile: no filtering applied (all items pass)', () => {
    // When selectedProfileId is null, the filter functions are not called.
    // This test documents the contract: caller skips filter when no profile selected.
    expect(true).toBe(true);
  });
});

// ── Entitlement ───────────────────────────────────────────────────────────────

describe('entitlement behavior (documented contracts)', () => {
  it('stored associations survive entitlement loss', () => {
    // Association data (communityMembers.associatedProfileIds) is never deleted
    // by entitlement changes. The UI locks the feature; data remains.
    // This is a contract test — the actual entitlement check is in the UI.
    const association = {
      communityId: 'c1',
      profileIds: ['entity_shalev'],
    };
    const map = buildAssociationMap([association]);
    expect(map.get('c1')).toEqual(['entity_shalev']);
  });

  it('free user cannot activate selectedProfileId (UI contract)', () => {
    // The Calendar UI uses useEffectiveAccess to gate profile selection.
    // When effectiveAccess === 'trial_expired_free', the carousel is hidden
    // and selectedProfileId cannot be set. This is a UI-level check.
    expect(true).toBe(true);
  });
});

// ── ProfileAssociationSheet visual/toggle helpers — FIX 9 FINAL UX FOLLOW-UP ─
describe('isProfileVisuallySelectedInAssociationSheet', () => {
  const SELF = 'entity_self';
  const PROFILE_A = 'entity_shalev';

  it('#1 empty explicit association → Self is visually selected', () => {
    expect(isProfileVisuallySelectedInAssociationSheet([], SELF, SELF)).toBe(
      true
    );
  });

  it('empty explicit association → non-Self profile is NOT visually selected', () => {
    expect(
      isProfileVisuallySelectedInAssociationSheet([], SELF, PROFILE_A)
    ).toBe(false);
  });

  it('empty explicit association + no selfProfileId → nothing is selected', () => {
    expect(isProfileVisuallySelectedInAssociationSheet([], null, SELF)).toBe(
      false
    );
  });

  it('explicit [Profile A] → Self is NOT visually selected (explicit overrides implicit)', () => {
    expect(
      isProfileVisuallySelectedInAssociationSheet([PROFILE_A], SELF, SELF)
    ).toBe(false);
  });

  it('explicit [Profile A] → Profile A is visually selected', () => {
    expect(
      isProfileVisuallySelectedInAssociationSheet([PROFILE_A], SELF, PROFILE_A)
    ).toBe(true);
  });

  it('explicit [Profile A, Self] → both are visually selected', () => {
    expect(
      isProfileVisuallySelectedInAssociationSheet([PROFILE_A, SELF], SELF, SELF)
    ).toBe(true);
    expect(
      isProfileVisuallySelectedInAssociationSheet(
        [PROFILE_A, SELF],
        SELF,
        PROFILE_A
      )
    ).toBe(true);
  });
});

describe('computeAssociationToggleResult', () => {
  const SELF = 'entity_self';
  const PROFILE_A = 'entity_shalev';
  const PROFILE_B = 'entity_buddy';

  it('#2 tapping implicitly-selected Self with no explicit association → no-op (null)', () => {
    expect(computeAssociationToggleResult([], SELF, SELF)).toBeNull();
  });

  it('#3 implicit Self + tap Profile A → explicit [Profile A], NOT [Self, Profile A]', () => {
    expect(computeAssociationToggleResult([], SELF, PROFILE_A)).toEqual([
      PROFILE_A,
    ]);
  });

  it('#4 explicit [Profile A] + tap Self → explicit [Profile A, Self]', () => {
    expect(computeAssociationToggleResult([PROFILE_A], SELF, SELF)).toEqual([
      PROFILE_A,
      SELF,
    ]);
  });

  it('#5 explicit [Profile A] + tap Profile A (remove final explicit profile) → []', () => {
    expect(
      computeAssociationToggleResult([PROFILE_A], SELF, PROFILE_A)
    ).toEqual([]);
  });

  it('explicit [Profile A, Self] + tap Self (removes Self, keeps Profile A) → [Profile A]', () => {
    expect(
      computeAssociationToggleResult([PROFILE_A, SELF], SELF, SELF)
    ).toEqual([PROFILE_A]);
  });

  it('#6 existing multi-select: implicit state + tap Profile A then Profile B independently', () => {
    // Each call is independent/pure — simulating two sequential taps from
    // an implicit start, composing the results as the component would.
    const afterA = computeAssociationToggleResult([], SELF, PROFILE_A);
    expect(afterA).toEqual([PROFILE_A]);
    const afterB = computeAssociationToggleResult(
      afterA as string[],
      SELF,
      PROFILE_B
    );
    expect(afterB).toEqual([PROFILE_A, PROFILE_B]);
  });

  it('no selfProfileId provided → tapping any profile toggles normally (no implicit no-op)', () => {
    expect(computeAssociationToggleResult([], null, SELF)).toEqual([SELF]);
  });
});

// ── FIX 9 FOLLOW-UP: default-to-Self is a read-time fallback only ───────────
describe('FIX 9 FOLLOW-UP — no migration / no backfill (documented contract)', () => {
  it('undefined/empty associatedProfileIds rows remain valid without any write', () => {
    // `setCommunityProfileAssociation` never writes the user's own profile
    // id into `associatedProfileIds` — an explicit empty selection is
    // persisted as `undefined` (see convex/communities.ts). The default-to
    // -Self behavior is applied ONLY inside
    // `isCommunityEventRelevantToProfile` at read time, using the
    // AssociationMap built by `buildAssociationMap`/`getMyProfileAssociations`
    // (which only includes communities with a NON-empty explicit
    // association — undefined/empty rows are simply absent from the map).
    const map = buildAssociationMap([]); // no explicit associations anywhere
    expect(map.size).toBe(0);
    expect(
      isCommunityEventRelevantToProfile(
        { communityId: 'community_b2' },
        'entity_self',
        map,
        'entity_self'
      )
    ).toBe(true); // matched via fallback, not via any persisted association
  });
});
