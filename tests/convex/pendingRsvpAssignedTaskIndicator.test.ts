/**
 * COMMUNITY MAIN — SHOW ASSIGNED TASK INDICATOR ON PENDING RSVP CARD.
 *
 * Covers `formatPendingRsvpAssignedTaskIndicator` (lib/eventTasksSummary.ts),
 * the pure copy function backing the small informational task-indicator
 * line rendered inside `MainPendingRsvpRow` on the community "ראשי" screen.
 * This is purely informational copy — it never affects RSVP or task
 * assignment behavior, both of which remain untouched.
 */

import { describe, expect, it } from 'bun:test';
import { formatPendingRsvpAssignedTaskIndicator } from '../../lib/eventTasksSummary';

describe('formatPendingRsvpAssignedTaskIndicator — pending RSVP card task indicator copy', () => {
  it('0 assigned tasks → renders nothing', () => {
    expect(formatPendingRsvpAssignedTaskIndicator(0)).toBeNull();
  });

  it('negative (defensive) → renders nothing', () => {
    expect(formatPendingRsvpAssignedTaskIndicator(-1)).toBeNull();
  });

  it('1 assigned task → singular copy', () => {
    expect(formatPendingRsvpAssignedTaskIndicator(1)).toBe('הוקצתה לך משימה');
  });

  it('2 assigned tasks → plural copy with count', () => {
    expect(formatPendingRsvpAssignedTaskIndicator(2)).toBe('הוקצו לך 2 משימות');
  });

  it('N > 2 assigned tasks → plural copy scales with count', () => {
    expect(formatPendingRsvpAssignedTaskIndicator(5)).toBe('הוקצו לך 5 משימות');
  });
});
