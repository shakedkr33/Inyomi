/**
 * Security Wave 1 — convex/communities.ts H-04: `communities.getById` used
 * to return the RAW community document (unauthenticated, no membership
 * check) — including `inviteCode`, a join secret. It now requires
 * authentication + active community membership and returns an explicit
 * minimal projection.
 *
 * This repo has no Convex mutation/query test harness (see
 * tests/convex/phoneMatchConfirmation.test.ts's documented precedent).
 * These regression guards combine:
 *   (a) source inspection of the REAL convex/communities.ts file, proving
 *       the handler's auth/membership gates and its exact return shape, and
 *   (b) source inspection of the three real UI callers
 *       (EventDetailsBottomSheet.tsx, calendar.tsx, event/[id].tsx),
 *       proving they only ever read the fields the new projection still
 *       provides (name, archived) — so the projection change does not
 *       remove data any legitimate caller needs.
 *
 * Run with: bun test tests/convex/communitiesGetByIdAccessControlWave1.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const COMMUNITIES_SOURCE = readFileSync(
  new URL('../../convex/communities.ts', import.meta.url),
  'utf8'
);

function extractExportBlock(source: string, exportName: string): string {
  const startMarker = `export const ${exportName} = `;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find export "${exportName}" in source`);
  }
  const afterStart = startIdx + startMarker.length;
  const nextExportMatch =
    /export const \w+ = (mutation|query|internalMutation)\(\{/.exec(
      source.slice(afterStart)
    );
  const endIdx =
    nextExportMatch === null
      ? source.length
      : afterStart + nextExportMatch.index;
  return source.slice(startIdx, endIdx);
}

const getByIdBlock = extractExportBlock(COMMUNITIES_SOURCE, 'getById');

describe('H-04 — communities.getById requires authentication + active membership', () => {
  it('requires authentication and returns null for unauthenticated callers', () => {
    expect(getByIdBlock).toContain('getAuthUserId(ctx)');
    expect(getByIdBlock).toMatch(/if\s*\(!userId\)\s*return null;/);
  });

  it('returns null for a non-existent community', () => {
    expect(getByIdBlock).toMatch(/if\s*\(!community\)\s*return null;/);
  });

  it('requires the caller to be an active member of THIS exact community (by_community_user, isActiveCommunityMember)', () => {
    expect(getByIdBlock).toContain('by_community_user');
    expect(getByIdBlock).toMatch(
      /if\s*\(!isActiveCommunityMember\(membership\)\)\s*return null;/
    );
  });
});

describe('H-04 — communities.getById never returns the raw document or inviteCode', () => {
  it('does not return the raw db document (no `return community;` / `return await ctx.db.get(`)', () => {
    expect(getByIdBlock).not.toMatch(/return\s+community\s*;/);
    expect(getByIdBlock).not.toMatch(/return\s+await\s+ctx\.db\.get/);
  });

  it('does not reference inviteCode anywhere in the handler', () => {
    expect(getByIdBlock).not.toContain('inviteCode');
  });

  it('returns an explicit minimal projection containing only name/archived', () => {
    const returnMatch = /return\s*\{([\s\S]*?)\};/.exec(getByIdBlock);
    expect(returnMatch).not.toBeNull();
    const returnedShape = returnMatch?.[1] ?? '';
    expect(returnedShape).toContain('name:');
    expect(returnedShape).toContain('archived:');
    // No other community fields (ownerId, spaceId, category, tags, color,
    // createdAt, pinnedByUserIds, joinApprovalMode, inviteCode) may appear
    // in the returned object literal.
    const forbiddenFields = [
      'ownerId',
      'spaceId',
      'category',
      'tags',
      'color',
      'createdAt',
      'pinnedByUserIds',
      'joinApprovalMode',
      'inviteCode',
    ];
    for (const field of forbiddenFields) {
      expect(returnedShape).not.toContain(field);
    }
  });

  it('declares an explicit `returns` validator matching the minimal projection (no `v.any()` escape hatch)', () => {
    expect(getByIdBlock).toMatch(/returns:\s*v\.union\(/);
    expect(getByIdBlock).not.toMatch(/returns:\s*v\.any\(\)/);
  });
});

// ── Legitimate UI callers only need name/archived ───────────────────────────

const CALLER_FILES: { path: string; queryVar: string }[] = [
  {
    path: '../../components/EventDetailsBottomSheet.tsx',
    queryVar: 'communityRecord',
  },
  { path: '../../app/(authenticated)/calendar.tsx', queryVar: 'communityData' },
  {
    path: '../../app/(authenticated)/event/[id].tsx',
    queryVar: 'communityRecord',
  },
];

describe('H-04 — real UI callers only ever read fields the new projection still provides', () => {
  for (const { path, queryVar } of CALLER_FILES) {
    it(`${path.split('/').pop()} only reads .name / .archived off ${queryVar} (never .inviteCode or other raw fields)`, () => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source).toContain(`api.communities.getById`);

      // Collect every `${queryVar}.<field>` / `${queryVar}?.<field>` access.
      const accessPattern = new RegExp(`${queryVar}\\??\\.(\\w+)`, 'g');
      const accessedFields = new Set(
        Array.from(source.matchAll(accessPattern), (m) => m[1])
      );

      expect(accessedFields.size).toBeGreaterThan(0);
      for (const field of accessedFields) {
        expect(['name', 'archived']).toContain(field);
      }
      expect(source).not.toMatch(new RegExp(`${queryVar}\\??\\.inviteCode`));
    });
  }
});

// ── Join flow is unaffected and never returns inviteCode to the client ─────

describe('H-04 — the dedicated join flow (unaffected by this change) never echoes inviteCode back', () => {
  it('getCommunityByInviteCode resolves the invite code server-side but does not return it in its response', () => {
    const block = extractExportBlock(
      COMMUNITIES_SOURCE,
      'getCommunityByInviteCode'
    );
    const returnMatch = /return\s*\{([\s\S]*?)\};/.exec(block);
    expect(returnMatch).not.toBeNull();
    expect(returnMatch?.[1] ?? '').not.toContain('inviteCode');
  });
});
