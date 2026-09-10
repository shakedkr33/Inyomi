/**
 * TASK SUMMARY FIX — Community Main carousel-card task CTA copy.
 *
 * Covers `formatCommunityMainTaskCtaText` (lib/eventTasksSummary.ts), the
 * pure function backing `CommunityMainTaskCta` on the community "ראשי"
 * screen's MainEventCard/AdditionalEventCard. Previously this label showed
 * ONLY the unassigned ("available to claim") count whenever one existed,
 * silently hiding the viewer's own assigned task on the same event. This
 * suite locks down the corrected combined mine/available copy.
 *
 * Also verifies (via `summarizeEventTaskCounts`, the shared source of the
 * "mine" count) that an owner/admin viewer's "mine" count only ever
 * reflects tasks actually assigned to them — never other members'
 * assignments, regardless of their management role.
 */

import { describe, expect, it } from 'bun:test';
import { summarizeEventTaskCounts } from '../../convex/eventTasks';
import { formatCommunityMainTaskCtaText } from '../../lib/eventTasksSummary';

describe('formatCommunityMainTaskCtaText — Community Main CTA copy', () => {
  it('mine = 0, available = 1 → singular "לשיבוץ"', () => {
    expect(formatCommunityMainTaskCtaText(0, 1)).toBe('משימה אחת לשיבוץ');
  });

  it('mine = 0, available = N > 1 → plural "לשיבוץ"', () => {
    expect(formatCommunityMainTaskCtaText(0, 3)).toBe('3 משימות לשיבוץ');
  });

  it('mine = 1, available = 0 → singular "שלך"', () => {
    expect(formatCommunityMainTaskCtaText(1, 0)).toBe('משימה אחת שלך');
  });

  it('mine = N > 1, available = 0 → plural "שלך"', () => {
    expect(formatCommunityMainTaskCtaText(2, 0)).toBe('2 משימות שלך');
  });

  it('mine > 0, available > 0 → combined "שלך · לשיבוץ" (both counts visible)', () => {
    expect(formatCommunityMainTaskCtaText(1, 1)).toBe('1 שלך · 1 לשיבוץ');
  });

  it('combined form scales for larger mixed counts', () => {
    expect(formatCommunityMainTaskCtaText(3, 5)).toBe('3 שלך · 5 לשיבוץ');
  });

  it('mine = 0, available = 0 → preserves existing "all assigned" copy', () => {
    expect(formatCommunityMainTaskCtaText(0, 0)).toBe('✓ כל המשימות שובצו');
  });
});

describe('"mine" count source — an admin/owner viewer never inherits other members’ assignments', () => {
  const eventTaskId = (n: number) => `eventTasks_${n}` as never;
  const userId = (name: string) => name as never;

  it('admin viewer with no personal assignment sees mine = 0 even though other tasks are assigned', () => {
    const adminUserId = userId('admin_user');
    const memberUserId = userId('member_user');
    const tasks = [
      {
        _id: eventTaskId(1),
        title: 'Task assigned to a member',
        assignedToUserId: memberUserId,
      },
      {
        _id: eventTaskId(2),
        title: 'Unassigned task',
      },
    ];

    const result = summarizeEventTaskCounts(undefined, tasks, adminUserId);

    expect(result.myAssignedTasks).toEqual([]);
    expect(result.hasMyAssignedTasks).toBe(false);
    // Available-to-claim (unassigned) is unaffected by viewer role.
    expect(result.totalTasksCount - result.assignedTasksCount).toBe(1);
  });

  it('admin viewer who also claimed a task sees exactly their own task as mine', () => {
    const adminUserId = userId('admin_user');
    const memberUserId = userId('member_user');
    const tasks = [
      {
        _id: eventTaskId(1),
        title: 'Task assigned to a member',
        assignedToUserId: memberUserId,
      },
      {
        _id: eventTaskId(2),
        title: "Admin's own task",
        assignedToUserId: adminUserId,
      },
    ];

    const result = summarizeEventTaskCounts(undefined, tasks, adminUserId);

    expect(result.myAssignedTasks).toEqual([
      { id: eventTaskId(2), title: "Admin's own task" },
    ]);
    expect(result.hasMyAssignedTasks).toBe(true);
  });
});
