/**
 * SECURITY FIX — birthdays.ts / tasks.listByRelatedBirthday authorization
 * hardening.
 *
 * The audit found that convex/birthdays.ts trusted a client-supplied
 * spaceId with NO server-side membership check at all (listUpcoming,
 * create), had no ownership check on delete (remove), and derived
 * createdBy from a fragile by_email lookup instead of the authenticated
 * caller. tasks.listByRelatedBirthday returned every task matching an
 * arbitrary client-generated birthdayId string across ALL users.
 *
 *   - hasAccessRowForSpace (lib/spaceAccess.ts) is the pure, directly
 *     testable predicate behind birthdays.ts's requireSpaceAccess guard —
 *     covered behaviorally below (items 9, 10).
 *   - This repo has no live Convex query/mutation test harness (see
 *     tests/convex/getPendingPhoneMatches.test.ts's documented precedent),
 *     so the actual shipped convex/birthdays.ts and convex/tasks.ts source
 *     is inspected directly for the required guards (items 1-8, 11-13) —
 *     the same pattern used in tests/convex/eventTaskRsvpDecoupling.test.ts.
 *
 * Run with: bun test tests/convex/birthdaySpaceAccess.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  hasAccessRowForSpace,
  type SpaceAccessRow,
} from '../../lib/spaceAccess';

const BIRTHDAYS_SOURCE = readFileSync(
  new URL('../../convex/birthdays.ts', import.meta.url),
  'utf8'
);
const TASKS_SOURCE = readFileSync(
  new URL('../../convex/tasks.ts', import.meta.url),
  'utf8'
);

// ── Pure predicate: hasAccessRowForSpace ─────────────────────────────────────

describe('hasAccessRowForSpace', () => {
  const SPACE_MINE = 'space_mine';
  const SPACE_OTHER = 'space_other';

  it('returns false for a caller with no rows at all (no membership anywhere)', () => {
    expect(hasAccessRowForSpace([], SPACE_MINE)).toBe(false);
  });

  it('returns false when the caller has an entity row (not access) in the target space', () => {
    const rows: SpaceAccessRow[] = [
      { spaceId: SPACE_MINE, kind: 'entity', displayName: 'Child' },
    ];
    expect(hasAccessRowForSpace(rows, SPACE_MINE)).toBe(false);
  });

  it('returns false when the caller has access to a DIFFERENT space only', () => {
    const rows: SpaceAccessRow[] = [
      { spaceId: SPACE_OTHER, kind: 'access', userId: 'u1' },
    ];
    expect(hasAccessRowForSpace(rows, SPACE_MINE)).toBe(false);
  });

  it('returns true for an admin access row in the target space', () => {
    const rows: SpaceAccessRow[] = [
      { spaceId: SPACE_MINE, kind: 'access', userId: 'u1' },
    ];
    expect(hasAccessRowForSpace(rows, SPACE_MINE)).toBe(true);
  });

  it('returns true for a member (non-admin) access row in the target space', () => {
    const rows: SpaceAccessRow[] = [
      { spaceId: SPACE_MINE, kind: 'access', userId: 'u2' },
    ];
    expect(hasAccessRowForSpace(rows, SPACE_MINE)).toBe(true);
  });

  it('backward-compat: infers access kind for a pre-kind-field row (userId set, no displayName)', () => {
    const rows: SpaceAccessRow[] = [{ spaceId: SPACE_MINE, userId: 'u1' }];
    expect(hasAccessRowForSpace(rows, SPACE_MINE)).toBe(true);
  });

  it('backward-compat: infers entity kind for a pre-kind-field row with a displayName', () => {
    const rows: SpaceAccessRow[] = [
      { spaceId: SPACE_MINE, userId: 'u1', displayName: 'Grandma' },
    ];
    expect(hasAccessRowForSpace(rows, SPACE_MINE)).toBe(false);
  });

  it('a caller with mixed rows across spaces only matches the specific requested spaceId', () => {
    const rows: SpaceAccessRow[] = [
      { spaceId: SPACE_OTHER, kind: 'access', userId: 'u1' },
      { spaceId: SPACE_MINE, kind: 'entity', displayName: 'Pet' },
    ];
    expect(hasAccessRowForSpace(rows, SPACE_MINE)).toBe(false);
    expect(hasAccessRowForSpace(rows, SPACE_OTHER)).toBe(true);
  });
});

// ── convex/birthdays.ts — source-level authorization guards ─────────────────

describe('convex/birthdays.ts — listUpcoming requires authenticated space access', () => {
  it('requires an authenticated userId before returning any birthday data', () => {
    expect(BIRTHDAYS_SOURCE).toContain(
      'const userId = await getAuthUserId(ctx);'
    );
    expect(BIRTHDAYS_SOURCE).toContain(
      "if (!userId) throw new Error('לא מחובר למערכת');"
    );
  });

  it('calls requireSpaceAccess before querying the birthdays table', () => {
    const listUpcomingBody = BIRTHDAYS_SOURCE.slice(
      BIRTHDAYS_SOURCE.indexOf('export const listUpcoming'),
      BIRTHDAYS_SOURCE.indexOf('export const create')
    );
    expect(listUpcomingBody).toContain(
      'await requireSpaceAccess(ctx, userId, spaceId);'
    );
    // The access check must happen BEFORE the birthdays query runs.
    expect(listUpcomingBody.indexOf('requireSpaceAccess')).toBeLessThan(
      listUpcomingBody.indexOf("query('birthdays')")
    );
  });

  it('no longer contains the unauthenticated TODO that documented the missing check', () => {
    expect(BIRTHDAYS_SOURCE).not.toContain(
      'TODO: לחבר לאימות – לוודא שהמשתמש שייך ל-spaceId'
    );
  });
});

describe('convex/birthdays.ts — create requires authenticated space access + server-derived createdBy', () => {
  it('requires an authenticated userId and enforces space access before inserting', () => {
    const createBody = BIRTHDAYS_SOURCE.slice(
      BIRTHDAYS_SOURCE.indexOf('export const create'),
      BIRTHDAYS_SOURCE.indexOf('export const remove')
    );
    expect(createBody).toContain(
      'const authUserId = await getAuthUserId(ctx);'
    );
    expect(createBody).toContain(
      'await requireSpaceAccess(ctx, authUserId, args.spaceId);'
    );
    expect(createBody.indexOf('requireSpaceAccess')).toBeLessThan(
      createBody.indexOf("insert('birthdays'")
    );
  });

  it('derives createdBy from the authenticated caller, never from client args', () => {
    expect(BIRTHDAYS_SOURCE).toContain('createdBy: authUserId,');
    // The args validator must not accept a client-supplied createdBy field.
    const argsBlock = BIRTHDAYS_SOURCE.slice(
      BIRTHDAYS_SOURCE.indexOf('export const create'),
      BIRTHDAYS_SOURCE.indexOf('handler: async (ctx, args) => {')
    );
    expect(argsBlock).not.toContain('createdBy:');
  });

  it('no longer contains the unauthenticated TODO that documented the missing check', () => {
    expect(BIRTHDAYS_SOURCE).not.toContain(
      'TODO: לאמת שהמשתמש הנוכחי שייך ל-spaceId לפני יצירה'
    );
  });
});

describe('convex/birthdays.ts — remove requires authenticated space access + creator-only ownership', () => {
  it('requires an authenticated userId and verifies space access before checking ownership', () => {
    const removeBody = BIRTHDAYS_SOURCE.slice(
      BIRTHDAYS_SOURCE.indexOf('export const remove')
    );
    expect(removeBody).toContain('const userId = await getAuthUserId(ctx);');
    expect(removeBody).toContain(
      'await requireSpaceAccess(ctx, userId, existing.spaceId);'
    );
  });

  it('blocks deletion by any authenticated user who is not the creator', () => {
    const removeBody = BIRTHDAYS_SOURCE.slice(
      BIRTHDAYS_SOURCE.indexOf('export const remove')
    );
    expect(removeBody).toContain('if (existing.createdBy !== userId) {');
    expect(removeBody).toContain('throw new Error(PERMISSION_DENIED);');
    // The ownership check must run BEFORE the actual delete call.
    expect(removeBody.indexOf('existing.createdBy !== userId')).toBeLessThan(
      removeBody.indexOf('ctx.db.delete(id)')
    );
  });

  it('no longer contains the unauthenticated TODO that documented the missing ownership check', () => {
    expect(BIRTHDAYS_SOURCE).not.toContain(
      'TODO: לוודא שהמשתמש הנוכחי הוא יוצר הרשומה'
    );
  });
});

describe('convex/birthdays.ts — requireSpaceAccess delegates to the tested pure predicate', () => {
  it('uses hasAccessRowForSpace from lib/spaceAccess rather than a duplicated/weaker check', () => {
    expect(BIRTHDAYS_SOURCE).toContain(
      "import { hasAccessRowForSpace } from '../lib/spaceAccess';"
    );
    expect(BIRTHDAYS_SOURCE).toContain('hasAccessRowForSpace(rows, spaceId)');
  });
});

// ── convex/tasks.ts — listByRelatedBirthday authorization guard ─────────────

describe('convex/tasks.ts — listByRelatedBirthday scopes results to the caller', () => {
  it('requires an authenticated userId', () => {
    const body = TASKS_SOURCE.slice(
      TASKS_SOURCE.indexOf('export const listByRelatedBirthday'),
      TASKS_SOURCE.indexOf('export const listByRelatedBirthday') + 600
    );
    expect(body).toContain('const userId = await getAuthUserId(ctx);');
    expect(body).toContain('if (!userId) return [];');
  });

  it('filters the birthdayId-indexed rows through isPersonalTaskForUser before returning them', () => {
    const body = TASKS_SOURCE.slice(
      TASKS_SOURCE.indexOf('export const listByRelatedBirthday'),
      TASKS_SOURCE.indexOf('export const listByRelatedBirthday') + 900
    );
    expect(body).toContain(
      'rows.filter((task) => isPersonalTaskForUser(task, userId));'
    );
  });

  it('never returns the raw, unfiltered by_related_birthday query result', () => {
    const body = TASKS_SOURCE.slice(
      TASKS_SOURCE.indexOf('export const listByRelatedBirthday'),
      TASKS_SOURCE.indexOf('export const listByRelatedBirthday') + 900
    );
    // Must not directly `return await ctx.db.query(...).collect()` — the
    // filtered `rows` variable must be what gets returned instead.
    expect(body).not.toMatch(/return await ctx\.db\s*\n\s*\.query\('tasks'\)/);
  });
});
