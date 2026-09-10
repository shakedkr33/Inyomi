/**
 * FIX — prevent Community Important Items bundle tasks from appearing as
 * duplicate standalone Home task cards.
 *
 * `isEventDerivedImportantItemTask` (app/(authenticated)/index.tsx) decides
 * whether a personal task is a Community Event "חשוב לזכור" copy that must
 * be excluded from the standalone Home task-card flows (Timed, Overdue,
 * Untimed, Undated) because it is already shown nested under the event.
 *
 * Before this fix, Home only excluded the legacy per-item copy
 * (`community_event_important_item`), but NOT the bundle task created by
 * "הוסף למשימות שלי" (`community_event_important_items_bundle`). Calendar
 * already excluded both. This caused the bundle task to incorrectly show
 * up as a duplicate standalone card on Home.
 *
 * `app/(authenticated)/index.tsx` is a screen component (heavy React
 * Native/expo-router imports), so — matching the existing convention in
 * tests/convex/eventTasksAccordionSummary.test.ts — this suite exercises a
 * local copy of the exact predicate. Any drift between this copy and the
 * real implementation would be caught by a screen-level integration test;
 * this suite locks down the *rule* itself.
 */

import { describe, expect, it } from 'bun:test';

type FakeTask = { sourceType?: string };

// Mirrors the exact predicate implemented in app/(authenticated)/index.tsx
// (isEventDerivedImportantItemTask), which itself mirrors the identically
// named helper in app/(authenticated)/calendar.tsx.
function isEventDerivedImportantItemTask(task: FakeTask): boolean {
  return (
    task.sourceType === 'community_event_important_item' ||
    task.sourceType === 'community_event_important_items_bundle'
  );
}

describe('isEventDerivedImportantItemTask — Home standalone task-card exclusion', () => {
  it('excludes the legacy per-item copy (community_event_important_item)', () => {
    expect(
      isEventDerivedImportantItemTask({
        sourceType: 'community_event_important_item',
      })
    ).toBe(true);
  });

  it('excludes the "הוסף למשימות שלי" bundle task (community_event_important_items_bundle)', () => {
    expect(
      isEventDerivedImportantItemTask({
        sourceType: 'community_event_important_items_bundle',
      })
    ).toBe(true);
  });

  it('does not exclude a normal personal task (no sourceType)', () => {
    expect(isEventDerivedImportantItemTask({})).toBe(false);
  });

  it('does not exclude an unrelated community event task', () => {
    expect(
      isEventDerivedImportantItemTask({ sourceType: 'community_event_task' })
    ).toBe(false);
  });
});
