/**
 * Family Membership Lifecycle — Phase 0 insert-path coverage verification
 *
 * Confirms EVERY production `ctx.db.insert('events'|'tasks'|'captures', ...)`
 * call site stamps a definite `ownerScope` at insert time. This repo has no
 * Convex mutation test harness (see tests/convex/phoneMatchConfirmation
 * .test.ts's documented precedent), so each insert call's literal object is
 * verified via source inspection of the real files.
 *
 * `captures` has zero production insert call sites (confirmed by search) —
 * intentionally not covered here; see convex/ownerScope.ts's
 * stampCaptureOwnerScope doc comment.
 *
 * Run with: bun test tests/convex/ownerScopeInsertSiteCoverage.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function readSource(relPath: string): string {
  return readFileSync(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

/** All occurrences of `ctx.db.insert('TABLE', {` in `source`, each sliced up to its closing `});`. */
function allInsertBlocks(source: string, table: string): string[] {
  const marker = `ctx.db.insert('${table}', {`;
  const blocks: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const idx = source.indexOf(marker, searchFrom);
    if (idx === -1) break;
    const endIdx = source.indexOf('\n    });', idx);
    const endIdx2 = source.indexOf('\n      });', idx);
    const end =
      endIdx === -1
        ? endIdx2
        : endIdx2 === -1
          ? endIdx
          : Math.min(endIdx, endIdx2);
    blocks.push(source.slice(idx, end === -1 ? source.length : end));
    searchFrom = idx + marker.length;
  }
  return blocks;
}

describe('events — every production insert stamps ownerScope', () => {
  const eventsSrc = readSource('convex/events.ts');
  const eventBlocks = allInsertBlocks(eventsSrc, 'events');

  it('found exactly the 2 known event insert sites in convex/events.ts', () => {
    expect(eventBlocks.length).toBe(2);
  });

  it('every event insert block in events.ts stamps ownerScope', () => {
    for (const block of eventBlocks) {
      expect(block).toContain('ownerScope:');
    }
  });

  it('googleImport.ts device-calendar import stamps ownerScope as personal', () => {
    const src = readSource('convex/googleImport.ts');
    const block = allInsertBlocks(src, 'events')[0];
    expect(block).toBeDefined();
    expect(block).toContain("ownerScope: stampEventOwnerScope({ source: 'google_copy'");
  });

  it('linkedEvents.ts copyLinkedEvent stamps ownerScope (personal standalone copy)', () => {
    const src = readSource('convex/linkedEvents.ts');
    const block = allInsertBlocks(src, 'events')[0];
    expect(block).toBeDefined();
    expect(block).toContain('ownerScope: stampEventOwnerScope({ createdBy: userId })');
  });
});

describe('tasks — every production insert stamps ownerScope', () => {
  const tasksSrc = readSource('convex/tasks.ts');
  const taskBlocksInTasksFile = allInsertBlocks(tasksSrc, 'tasks');

  it('found exactly the 3 known task insert sites in convex/tasks.ts', () => {
    expect(taskBlocksInTasksFile.length).toBe(3);
  });

  it('every task insert block in tasks.ts stamps ownerScope', () => {
    for (const block of taskBlocksInTasksFile) {
      expect(block).toContain('ownerScope:');
    }
  });

  it('the personal important-items bundle copy is stamped literally personal, never via the communityId-based heuristic', () => {
    const bundleBlock = taskBlocksInTasksFile.find((b) =>
      b.includes("sourceType: 'community_event_important_items_bundle'")
    );
    expect(bundleBlock).toBeDefined();
    expect(bundleBlock).toContain("ownerScope: 'personal'");
  });

  it("the per-item toggleImportantItemCheck personal copy is stamped literally personal", () => {
    const perItemBlock = taskBlocksInTasksFile.find(
      (b) =>
        b.includes("sourceType: 'community_event_important_item'") &&
        b.includes('sourceImportantItemId: itemId')
    );
    expect(perItemBlock).toBeDefined();
    expect(perItemBlock).toContain("ownerScope: 'personal'");
  });

  it('events.ts syncCommunityEventImportantItemTasks canonical (unassigned) task is stamped literally community', () => {
    const eventsSrc = readSource('convex/events.ts');
    const taskBlocksInEventsFile = allInsertBlocks(eventsSrc, 'tasks');
    expect(taskBlocksInEventsFile.length).toBe(1);
    const canonicalBlock = taskBlocksInEventsFile[0];
    expect(canonicalBlock).toContain("sourceType: 'community_event_important_item'");
    expect(canonicalBlock).not.toContain('assignedTo:');
    expect(canonicalBlock).toContain("ownerScope: 'community'");
  });
});

describe('captures — no production insert path exists (disclosed, not a gap)', () => {
  it('convex/ has zero ctx.db.insert(\'captures\', ...) call sites', () => {
    const filesToCheck = [
      'convex/events.ts',
      'convex/tasks.ts',
      'convex/linkedEvents.ts',
      'convex/googleImport.ts',
      'convex/members.ts',
      'convex/users.ts',
      'convex/onboarding.ts',
    ];
    for (const file of filesToCheck) {
      expect(readSource(file)).not.toContain("ctx.db.insert('captures'");
    }
  });
});
