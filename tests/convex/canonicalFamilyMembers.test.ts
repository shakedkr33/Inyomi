/**
 * Tests for lib/canonicalFamilyMembers.ts — FIX 9 FOLLOW-UP
 *
 * Pure function tests for the canonical Self Family Profile normalization
 * used by `convex/members.ts` (`listMyFamilyContacts`):
 *   - Primary/admin user's canonical Self profile appears exactly once
 *     (synthesized from their own access row).
 *   - Joined family member's Self profile still appears exactly once
 *     (their existing entity row — no synthesis, no duplicate).
 *   - No duplicate Self representation under any input combination.
 *   - The unrelated "other user's synthetic entry" (e.g. admin shown to a
 *     non-admin viewer) never interacts with the viewer's own Self.
 *
 * Run with: bun test tests/convex/canonicalFamilyMembers.test.ts
 */

import { describe, expect, it } from 'bun:test';

import { buildCanonicalFamilyMembers } from '../../lib/canonicalFamilyMembers';

type Entity = { _id: string; displayName: string; matchedUserId?: string };
type SelfCandidate = {
  _id: string;
  displayName: string;
  matchedUserId: string;
};
type OtherEntry = { _id: string; displayName: string; matchedUserId?: string };

describe('buildCanonicalFamilyMembers', () => {
  it('admin (no entity Self row): synthesizes Self exactly once from access row', () => {
    const entities: Entity[] = [{ _id: 'entity_child', displayName: 'Child' }];
    const syntheticSelfCandidate: SelfCandidate = {
      _id: 'access_admin',
      displayName: 'Admin',
      matchedUserId: 'user_admin',
    };

    const result = buildCanonicalFamilyMembers({
      entities,
      selfEntityId: null,
      syntheticSelfCandidate,
      otherAccessEntry: null,
    });

    expect(result.selfId).toBe('access_admin');
    expect(result.members).toHaveLength(2);
    expect(result.members.filter((m) => m._id === 'access_admin')).toHaveLength(
      1
    );
  });

  it('joined member (has entity Self row): does NOT inject synthetic candidate', () => {
    const entities: Entity[] = [
      { _id: 'entity_me', displayName: 'Me', matchedUserId: 'user_me' },
      { _id: 'entity_sibling', displayName: 'Sibling' },
    ];
    // Even if a synthetic candidate is (defensively) provided, it must be
    // ignored — the real entity row is the canonical Self.
    const syntheticSelfCandidate: SelfCandidate = {
      _id: 'access_me',
      displayName: 'Me (synthetic)',
      matchedUserId: 'user_me',
    };

    const result = buildCanonicalFamilyMembers({
      entities,
      selfEntityId: 'entity_me',
      syntheticSelfCandidate,
      otherAccessEntry: null,
    });

    expect(result.selfId).toBe('entity_me');
    expect(result.members).toHaveLength(2);
    expect(result.members.some((m) => m._id === 'access_me')).toBe(false);
  });

  it('no duplicate Self: exactly one entry with the resolved selfId', () => {
    const entities: Entity[] = [
      { _id: 'entity_me', displayName: 'Me', matchedUserId: 'user_me' },
    ];
    const result = buildCanonicalFamilyMembers({
      entities,
      selfEntityId: 'entity_me',
      syntheticSelfCandidate: null,
      otherAccessEntry: null,
    });
    const matches = result.members.filter((m) => m._id === result.selfId);
    expect(matches).toHaveLength(1);
  });

  it('otherAccessEntry (e.g. admin shown to a non-admin viewer) is independent of Self', () => {
    const entities: Entity[] = [
      { _id: 'entity_me', displayName: 'Me', matchedUserId: 'user_me' },
    ];
    const otherAccessEntry: OtherEntry = {
      _id: 'access_admin',
      displayName: 'Admin',
      matchedUserId: 'user_admin',
    };

    const result = buildCanonicalFamilyMembers({
      entities,
      selfEntityId: 'entity_me',
      syntheticSelfCandidate: null,
      otherAccessEntry,
    });

    expect(result.selfId).toBe('entity_me');
    expect(result.members).toHaveLength(2);
    expect(result.members.some((m) => m._id === 'access_admin')).toBe(true);
  });

  it('admin viewing their own list: otherAccessEntry is null, synthetic Self still injected', () => {
    // Mirrors real caller behavior: `adminEntry` is only built when the
    // viewer is NOT the admin, so when the viewer IS the admin,
    // otherAccessEntry is null and syntheticSelfCandidate carries Self.
    const entities: Entity[] = [{ _id: 'entity_child', displayName: 'Child' }];
    const syntheticSelfCandidate: SelfCandidate = {
      _id: 'access_admin',
      displayName: 'Admin',
      matchedUserId: 'user_admin',
    };

    const result = buildCanonicalFamilyMembers({
      entities,
      selfEntityId: null,
      syntheticSelfCandidate,
      otherAccessEntry: null,
    });

    expect(result.selfId).toBe('access_admin');
    expect(result.members.filter((m) => m._id === 'access_admin')).toHaveLength(
      1
    );
  });

  it('no Self representation available: selfId is null, no synthetic entry added', () => {
    const entities: Entity[] = [{ _id: 'entity_child', displayName: 'Child' }];
    const result = buildCanonicalFamilyMembers({
      entities,
      selfEntityId: null,
      syntheticSelfCandidate: null,
      otherAccessEntry: null,
    });

    expect(result.selfId).toBeNull();
    expect(result.members).toHaveLength(1);
  });

  it('handles fully empty input', () => {
    const result = buildCanonicalFamilyMembers({
      entities: [] as Entity[],
      selfEntityId: null,
      syntheticSelfCandidate: null,
      otherAccessEntry: null,
    });
    expect(result.selfId).toBeNull();
    expect(result.members).toHaveLength(0);
  });
});
