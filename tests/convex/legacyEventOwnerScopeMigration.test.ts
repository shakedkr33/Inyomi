/**
 * Tests for lib/legacyEventOwnerScopeMigration.ts — pure planning/safety
 * helpers behind convex/backfills.ts `migrateApprovedLegacyEventOwnerScope`
 * (ONE-TIME, INTERNAL, GUARDED migration for EXACTLY 10 reviewed legacy
 * event ids — NOT a general classifier change).
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/getPendingPhoneMatches.test.ts's documented precedent), so
 * the safety-critical decision logic is fully covered here as pure
 * behavioral tests, and the shipped mutation's structural invariants
 * (internalMutation-only, guard ordering) are verified via source
 * inspection of convex/backfills.ts.
 *
 * Run with: bun test tests/convex/legacyEventOwnerScopeMigration.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  APPROVED_LEGACY_EVENT_IDS,
  buildLegacyEventMigrationPlan,
  buildOwnerScopePatch,
  evaluateLegacyEventForMigration,
  isApprovedLegacyEventId,
  type LegacyEventMigrationInput,
} from '../../lib/legacyEventOwnerScopeMigration';
import { resolveExecutionMode } from '../../lib/qaReset';

const CREATED_BY = 'user_yaniv';
const OTHER_USER = 'user_other';
const APPROVED_ID = APPROVED_LEGACY_EVENT_IDS[0];
const NOT_APPROVED_ID = 'k5NotOnTheApprovedAllowlist000000';

function makeEvent(
  overrides: Partial<LegacyEventMigrationInput> = {}
): LegacyEventMigrationInput {
  return {
    _id: APPROVED_ID,
    title: 'ירקות',
    spaceId: 'space_1',
    createdBy: CREATED_BY,
    ...overrides,
  };
}

// ── allowlist ────────────────────────────────────────────────────────────────
describe('isApprovedLegacyEventId', () => {
  it('contains exactly 10 hardcoded ids', () => {
    expect(APPROVED_LEGACY_EVENT_IDS.length).toBe(10);
  });

  it('accepts every hardcoded id', () => {
    for (const id of APPROVED_LEGACY_EVENT_IDS) {
      expect(isApprovedLegacyEventId(id)).toBe(true);
    }
  });

  it('rejects any id outside the allowlist', () => {
    expect(isApprovedLegacyEventId(NOT_APPROVED_ID)).toBe(false);
    expect(isApprovedLegacyEventId('random_event_id')).toBe(false);
  });
});

// ── per-event precondition evaluation ───────────────────────────────────────
describe('evaluateLegacyEventForMigration', () => {
  it('is eligible (not yet corrected) for the exact reviewed legacy shape', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent(),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(true);
    expect(item.alreadyCorrected).toBe(false);
    expect(item.expectedNewOwnerScope).toBe('personal');
    expect(item.currentOwnerScope).toBeUndefined();
  });

  it('blocks an id outside the hardcoded allowlist, even with a matching shape', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ _id: NOT_APPROVED_ID }),
      NOT_APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/allowlist/i);
  });

  it('blocks when the event no longer exists', () => {
    const item = evaluateLegacyEventForMigration(null, APPROVED_ID, CREATED_BY);
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/no longer exists/i);
  });

  it('blocks when createdBy no longer matches the expected reviewed user', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ createdBy: OTHER_USER }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/createdBy/i);
  });

  it('blocks when the event now has a communityId', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ communityId: 'community_1' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/community/i);
  });

  it('blocks a Google-imported copy', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ source: 'google_copy' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/imported copy/i);
  });

  it('blocks a device-imported copy', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ source: 'device_copy' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
  });

  it('blocks when allFamily is now true', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ allFamily: true }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/allFamily/i);
  });

  it('blocks when sharedWithFamilyMemberIds is now non-empty', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ sharedWithFamilyMemberIds: ['member_1'] }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/sharedWithFamilyMemberIds/i);
  });

  it('blocks when sharedWithUserIds now references another user', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ sharedWithUserIds: [OTHER_USER] }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/sharedWithUserIds/i);
  });

  it('allows sharedWithUserIds containing only the creator (no-op self-share)', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ sharedWithUserIds: [CREATED_BY] }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(true);
  });

  it('treats an already-personal event as eligible AND already corrected (idempotent)', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ ownerScope: 'personal' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(true);
    expect(item.alreadyCorrected).toBe(true);
    expect(item.currentOwnerScope).toBe('personal');
  });

  it('NEVER treats a family-scoped event as eligible — must not overwrite', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ ownerScope: 'family' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.alreadyCorrected).toBe(false);
    expect(item.reason).toMatch(/family/i);
  });

  it('NEVER treats a community-scoped event as eligible — must not overwrite', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ ownerScope: 'community' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(item.eligible).toBe(false);
    expect(item.reason).toMatch(/community/i);
  });
});

// ── batch plan / all-or-nothing semantics ───────────────────────────────────
describe('buildLegacyEventMigrationPlan', () => {
  it('is safe to execute only when every one of the 10 targets is eligible', () => {
    const items = APPROVED_LEGACY_EVENT_IDS.map((id) =>
      evaluateLegacyEventForMigration(makeEvent({ _id: id }), id, CREATED_BY)
    );
    const plan = buildLegacyEventMigrationPlan(items);
    expect(plan.targetCount).toBe(10);
    expect(plan.eligibleCount).toBe(10);
    expect(plan.blockedCount).toBe(0);
    expect(plan.blockers).toEqual([]);
    expect(plan.safeToExecute).toBe(true);
  });

  it('a single contradictory/changed record blocks the ENTIRE batch — no partial execution', () => {
    const ids = [...APPROVED_LEGACY_EVENT_IDS];
    const items = ids.map((id, index) => {
      if (index === 3) {
        // This one record has since become family-scoped.
        return evaluateLegacyEventForMigration(
          makeEvent({ _id: id, ownerScope: 'family' }),
          id,
          CREATED_BY
        );
      }
      return evaluateLegacyEventForMigration(makeEvent({ _id: id }), id, CREATED_BY);
    });
    const plan = buildLegacyEventMigrationPlan(items);
    expect(plan.eligibleCount).toBe(9);
    expect(plan.blockedCount).toBe(1);
    expect(plan.safeToExecute).toBe(false);
    expect(plan.blockers.length).toBe(1);
  });

  it('an already-personal record does not block the batch (idempotent re-run stays safe)', () => {
    const ids = [...APPROVED_LEGACY_EVENT_IDS];
    const items = ids.map((id, index) =>
      evaluateLegacyEventForMigration(
        makeEvent({ _id: id, ownerScope: index === 0 ? 'personal' : undefined }),
        id,
        CREATED_BY
      )
    );
    const plan = buildLegacyEventMigrationPlan(items);
    expect(plan.eligibleCount).toBe(10);
    expect(plan.safeToExecute).toBe(true);
  });
});

// ── patch construction — only `ownerScope` is ever touched ─────────────────
describe('buildOwnerScopePatch', () => {
  it('returns exactly { ownerScope: "personal" } for an eligible, not-yet-corrected item', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent(),
      APPROVED_ID,
      CREATED_BY
    );
    const patch = buildOwnerScopePatch(item);
    expect(patch).toEqual({ ownerScope: 'personal' });
    expect(Object.keys(patch ?? {})).toEqual(['ownerScope']);
  });

  it('returns null (no write) for an already-corrected item — idempotent', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ ownerScope: 'personal' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(buildOwnerScopePatch(item)).toBeNull();
  });

  it('returns null (no write) for a blocked item', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ ownerScope: 'family' }),
      APPROVED_ID,
      CREATED_BY
    );
    expect(buildOwnerScopePatch(item)).toBeNull();
  });

  it('returns null (no write) for an out-of-allowlist item — no non-target event can be modified', () => {
    const item = evaluateLegacyEventForMigration(
      makeEvent({ _id: NOT_APPROVED_ID }),
      NOT_APPROVED_ID,
      CREATED_BY
    );
    expect(buildOwnerScopePatch(item)).toBeNull();
  });
});

// ── execution-mode gating (shared with resetQaUser) ─────────────────────────
describe('resolveExecutionMode (reused for this migration)', () => {
  it('defaults to dry-run with no writes possible', () => {
    const { isDryRun, canExecuteLive } = resolveExecutionMode({});
    expect(isDryRun).toBe(true);
    expect(canExecuteLive).toBe(false);
  });

  it('dryRun: false alone (without execute: true) never allows live execution', () => {
    const { canExecuteLive } = resolveExecutionMode({ dryRun: false });
    expect(canExecuteLive).toBe(false);
  });

  it('execute: true alone (without dryRun: false) never allows live execution', () => {
    const { canExecuteLive } = resolveExecutionMode({ execute: true });
    expect(canExecuteLive).toBe(false);
  });

  it('requires BOTH dryRun: false AND execute: true to allow live execution', () => {
    const { isDryRun, canExecuteLive } = resolveExecutionMode({
      dryRun: false,
      execute: true,
    });
    expect(isDryRun).toBe(false);
    expect(canExecuteLive).toBe(true);
  });
});

// ── source-inspection: shipped mutation shape invariants ───────────────────
const BACKFILLS_SOURCE = readFileSync(
  new URL('../../convex/backfills.ts', import.meta.url),
  'utf8'
);

describe('convex/backfills.ts — migrateApprovedLegacyEventOwnerScope shape invariants (source inspection)', () => {
  it('is exported as internalMutation, never a public mutation', () => {
    expect(BACKFILLS_SOURCE).toContain(
      'export const migrateApprovedLegacyEventOwnerScope = internalMutation({'
    );
  });

  it('never imports the public `mutation` helper — internalMutation/internalQuery only', () => {
    const serverImportLine = BACKFILLS_SOURCE.split('\n').find((line) =>
      line.includes("from './_generated/server'")
    );
    expect(serverImportLine).toBeDefined();
    expect(serverImportLine).not.toMatch(/[,{]\s*mutation\s*[,}]/);
  });

  it('gates live writes behind both QA_RESET_ENABLED and QA_RESET_ALLOWED_PHONES guards', () => {
    expect(BACKFILLS_SOURCE).toContain('QA_RESET_ENABLED');
    expect(BACKFILLS_SOURCE).toContain('QA_RESET_ALLOWED_PHONES');
  });

  it('never calls classifyEventForBackfill inside the targeted migration (no global loosening)', () => {
    const migrationSection = BACKFILLS_SOURCE.slice(
      BACKFILLS_SOURCE.indexOf(
        'export const migrateApprovedLegacyEventOwnerScope'
      )
    );
    expect(migrationSection).not.toContain('classifyEventForBackfill(');
  });
});
