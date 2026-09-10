/**
 * FIX — align Community Event tasks behavior between Home and Calendar
 * (PART 2 — Home accordion summary line).
 *
 * Plain TypeScript, no React Native imports, so it can be unit-tested
 * directly (see tests/convex/eventTasksAccordionSummary.test.ts) without a
 * React Native test harness.
 */

/** Minimal task shape needed to compute the mine/unassigned breakdown. */
export type EventTasksSummaryTask = {
  isAssignedToCurrentUser: boolean;
  assignedToUserId?: string;
  assignedToManual?: string;
};

/**
 * Builds the Home accordion summary line from an already-filtered task
 * list (unassigned + mine only — see `filterHomeVisibleEventTasks` in
 * `app/(authenticated)/index.tsx`). Replaces the old generic
 * "משימות האירוע · X" label with a breakdown the viewer can act on:
 *   - only unassigned  → "2 משימות ממתינות לשיבוץ"
 *   - only mine         → "יש לך 2 משימות"
 *   - both              → "יש לך 1 · 2 משימות ממתינות לשיבוץ"
 * Not used by the Community Bottom Sheet, which keeps the original label.
 */
export function buildEventTasksSummaryLabel(
  tasks: EventTasksSummaryTask[]
): string {
  let mineCount = 0;
  let unassignedCount = 0;
  for (const t of tasks) {
    if (t.isAssignedToCurrentUser) {
      mineCount += 1;
    } else if (!t.assignedToUserId && !t.assignedToManual?.trim()) {
      unassignedCount += 1;
    }
  }

  const minePart =
    mineCount === 0
      ? null
      : mineCount === 1
        ? 'יש לך משימה אחת'
        : `יש לך ${mineCount} משימות`;

  const unassignedPart =
    unassignedCount === 0
      ? null
      : unassignedCount === 1
        ? 'משימה אחת ממתינה לשיבוץ'
        : `${unassignedCount} משימות ממתינות לשיבוץ`;

  if (minePart && unassignedPart) return `${minePart} · ${unassignedPart}`;
  return minePart ?? unassignedPart ?? '';
}

/**
 * Community Main carousel-card task CTA copy (MainEventCard /
 * AdditionalEventCard, via `CommunityMainTaskCta` in
 * `app/(authenticated)/community/[id].tsx`). Extracted here so the exact
 * rule can be unit-tested directly (no ctx/db or React Native imports).
 *
 * Previously the button showed ONLY the unassigned ("available to claim")
 * count whenever one existed, silently hiding the viewer's own assigned
 * task on the same event. The label must always reflect BOTH — the
 * viewer's own responsibility ("mine") and whether help is still needed
 * ("available") — so callers understand both facts at a glance:
 *
 *   - mine = 0, available = 1     → "משימה אחת לשיבוץ"
 *   - mine = 0, available = N > 1 → "N משימות לשיבוץ"
 *   - mine = 1, available = 0     → "משימה אחת שלך"
 *   - mine = N > 1, available = 0 → "N משימות שלך"
 *   - mine > 0, available > 0     → "{mine} שלך · {available} לשיבוץ"
 *   - mine = 0, available = 0     → "✓ כל המשימות שובצו" (existing
 *     zero/zero behavior, preserved as-is).
 *
 * Deliberately separate from `buildEventTasksSummaryLabel` (Home) and from
 * the Community "אירועים" tab's own status line — neither of those is
 * touched by this helper, and this helper must never affect their copy.
 */
export function formatCommunityMainTaskCtaText(
  mineCount: number,
  availableCount: number
): string {
  if (availableCount <= 0 && mineCount <= 0) {
    return '✓ כל המשימות שובצו';
  }

  if (availableCount > 0 && mineCount > 0) {
    return `${mineCount} שלך · ${availableCount} לשיבוץ`;
  }

  if (availableCount > 0) {
    return availableCount === 1
      ? 'משימה אחת לשיבוץ'
      : `${availableCount} משימות לשיבוץ`;
  }

  return mineCount === 1 ? 'משימה אחת שלך' : `${mineCount} משימות שלך`;
}
