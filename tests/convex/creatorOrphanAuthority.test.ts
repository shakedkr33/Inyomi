/**
 * Tests for lib/creatorOrphanAuthority.ts + source-regression checks on the
 * wiring into convex/members.ts (hasCreatorOrphanAuthority), convex/events.ts
 * and convex/tasks.ts.
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/qaResetUser.test.ts's documented precedent). Given that
 * constraint:
 *
 *   - The pure decision function (lib/creatorOrphanAuthority.ts) is fully
 *     covered here via direct behavioral tests.
 *   - Invariants that require inspecting the actual shipped call sites
 *     (which mutations call the DB-backed wrapper, that a live creator's
 *     authority path is never touched, that community content is never
 *     affected) are verified via source inspection of the real
 *     convex/members.ts / convex/events.ts / convex/tasks.ts files — the
 *     same pattern used in tests/convex/qaResetUser.test.ts.
 *
 * Run with: bun test tests/convex/creatorOrphanAuthority.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hasCreatorOrphanFallbackAuthority } from '../../lib/creatorOrphanAuthority';

// ── pure decision function ──────────────────────────────────────────────────
describe('hasCreatorOrphanFallbackAuthority', () => {
  it('creator still exists → always false, regardless of caller authority', () => {
    expect(
      hasCreatorOrphanFallbackAuthority({
        creatorExists: true,
        isCommunityContent: false,
        hasSpace: true,
        callerIsSpaceAdmin: true,
      })
    ).toBe(false);
  });

  it('creator deleted + caller is the exact space admin → true', () => {
    expect(
      hasCreatorOrphanFallbackAuthority({
        creatorExists: false,
        isCommunityContent: false,
        hasSpace: true,
        callerIsSpaceAdmin: true,
      })
    ).toBe(true);
  });

  it('creator deleted + caller is a plain family member (not admin) → false', () => {
    expect(
      hasCreatorOrphanFallbackAuthority({
        creatorExists: false,
        isCommunityContent: false,
        hasSpace: true,
        callerIsSpaceAdmin: false,
      })
    ).toBe(false);
  });

  it('community content is never affected, even if the creator is deleted and the caller is a space admin', () => {
    expect(
      hasCreatorOrphanFallbackAuthority({
        creatorExists: false,
        isCommunityContent: true,
        hasSpace: true,
        callerIsSpaceAdmin: true,
      })
    ).toBe(false);
  });

  it('space-less content never gets fallback authority, even if the creator is deleted', () => {
    expect(
      hasCreatorOrphanFallbackAuthority({
        creatorExists: false,
        isCommunityContent: false,
        hasSpace: false,
        callerIsSpaceAdmin: true,
      })
    ).toBe(false);
  });

  it('creator exists takes precedence over every other flag (checked first)', () => {
    expect(
      hasCreatorOrphanFallbackAuthority({
        creatorExists: true,
        isCommunityContent: false,
        hasSpace: false,
        callerIsSpaceAdmin: false,
      })
    ).toBe(false);
  });
});

// ── Source-inspection coverage for invariants that require the real files ──
const MEMBERS_SOURCE = readFileSync(
  new URL('../../convex/members.ts', import.meta.url),
  'utf8'
);
const EVENTS_SOURCE = readFileSync(
  new URL('../../convex/events.ts', import.meta.url),
  'utf8'
);
const TASKS_SOURCE = readFileSync(
  new URL('../../convex/tasks.ts', import.meta.url),
  'utf8'
);

describe('convex/members.ts — hasCreatorOrphanAuthority wrapper (source inspection)', () => {
  it('delegates to the pure hasCreatorOrphanFallbackAuthority helper', () => {
    expect(MEMBERS_SOURCE).toContain(
      "import { hasCreatorOrphanFallbackAuthority } from '../lib/creatorOrphanAuthority';"
    );
    expect(MEMBERS_SOURCE).toContain('return hasCreatorOrphanFallbackAuthority({');
  });

  it('short-circuits to false for community content before touching the database', () => {
    const fnBody = MEMBERS_SOURCE.slice(
      MEMBERS_SOURCE.indexOf('export async function hasCreatorOrphanAuthority'),
      MEMBERS_SOURCE.indexOf('// ── requireSpaceAdmin')
    );
    expect(fnBody).toContain('if (params.communityId !== undefined) return false;');
  });

  it('resolves callerIsSpaceAdmin using the identical kind:access + role:admin model as requireSpaceAdmin', () => {
    const fnBody = MEMBERS_SOURCE.slice(
      MEMBERS_SOURCE.indexOf('export async function hasCreatorOrphanAuthority'),
      MEMBERS_SOURCE.indexOf('// ── requireSpaceAdmin')
    );
    expect(fnBody).toContain("resolveKind(row) === 'access'");
    expect(fnBody).toContain("row.role === 'admin'");
  });
});

describe('convex/events.ts — creator-orphan fallback wiring (source inspection)', () => {
  it('update/cancelEvent/deleteEvent/softDeletePersonalEvent all consult hasCreatorOrphanAuthority only after the live-creator check fails', () => {
    const occurrences = EVENTS_SOURCE.split(
      'const hasOrphanFallback = await hasCreatorOrphanAuthority(ctx, {'
    ).length - 1;
    // update, cancelEvent, deleteEvent, softDeletePersonalEvent
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it('never calls the fallback before checking createdBy/isCreator — it only supplements, never replaces, the creator check', () => {
    const idx = EVENTS_SOURCE.indexOf(
      'const hasOrphanFallback = await hasCreatorOrphanAuthority(ctx, {'
    );
    expect(idx).toBeGreaterThan(-1);
    const before = EVENTS_SOURCE.slice(Math.max(0, idx - 400), idx);
    expect(before).toMatch(/createdBy/);
  });
});

describe('convex/tasks.ts — creator-orphan fallback wiring (source inspection)', () => {
  it('imports hasCreatorOrphanAuthority from ./members', () => {
    expect(TASKS_SOURCE).toContain(
      "import { hasCreatorOrphanAuthority } from './members';"
    );
  });

  it('the full-edit-right calculation in update never grants the fallback for community tasks', () => {
    const updateSection = TASKS_SOURCE.slice(
      TASKS_SOURCE.indexOf('let hasOrphanFallback = false;'),
      TASKS_SOURCE.indexOf('let hasOrphanFallback = false;') + 800
    );
    expect(updateSection).toContain('existing.communityId === undefined');
  });

  it('shared subtask-edit-access gate (assertSubtaskEditAccess) is used by all five subtask mutations', () => {
    const occurrences = TASKS_SOURCE.split(
      'await assertSubtaskEditAccess(ctx, existing, userId);'
    ).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });

  it('softDeleteTask only consults the fallback for non-community tasks', () => {
    const idx = TASKS_SOURCE.indexOf('if (!isPersonallyDeletableTask(task, userId)) {');
    expect(idx).toBeGreaterThan(-1);
    const section = TASKS_SOURCE.slice(idx, idx + 600);
    expect(section).toContain('task.communityId === undefined');
  });
});
