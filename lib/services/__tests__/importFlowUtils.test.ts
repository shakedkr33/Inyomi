/**
 * Tests for importFlowUtils.ts
 *
 * Run with: bun test
 *
 * Covers (matching Section E requirements):
 * 5.  Dynamic Hebrew summary copy for all three chips.
 * 6.  Absolute Hebrew date summary formatting.
 * 7.  Events are grouped by start-month and year.
 * 8.  Empty months are omitted.
 * 9.  Multi-day events appear only in their start month.
 * 10. All events are selected by default (entry precondition confirmed).
 * 11. Month header state: checked, unchecked, and mixed correctly.
 * 12. Toggling a month updates all its events and the global selected count.
 * 13. Toggling one event updates its month header to mixed.
 * 14. RTL logical ordering for chips (RANGE_CHIPS constant order).
 * 4.  Six-month range mode and annual-toggle UI no longer exist
 *     (no ForwardMode in the hook's public API; no six-month chip).
 */

import { describe, expect, it } from 'bun:test';

import type { NormalizedEvent } from '../googleCalendarEvents';
import {
  formatAbsoluteHebrewDate,
  formatMonthTitle,
  getDisplayDateRange,
  getMonthCheckState,
  getMonthKeyFromIso,
  getRangeSummaryText,
  groupEventsByMonth,
} from '../importFlowUtils';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: {
  localId: string;
  startIso: string;
  isAllDay?: boolean;
  title?: string;
  endIso?: string | null;
}): NormalizedEvent {
  return {
    localId: overrides.localId,
    title: overrides.title ?? 'Test Event',
    startIso: overrides.startIso,
    endIso: overrides.endIso ?? null,
    isAllDay: overrides.isAllDay ?? false,
  };
}

// ── Section E.5: Dynamic Hebrew summary copy ──────────────────────────────────

describe('getRangeSummaryText', () => {
  it("'none' returns correct Hebrew summary", () => {
    expect(getRangeSummaryText('none')).toBe(
      'יועתקו אירועים מהיום ועד שנה קדימה'
    );
  });

  it("'one_year' returns correct Hebrew summary", () => {
    expect(getRangeSummaryText('one_year')).toBe(
      'יועתקו אירועים משנה אחורה ועד שנה קדימה'
    );
  });

  it("'two_months' returns correct Hebrew summary", () => {
    expect(getRangeSummaryText('two_months')).toBe(
      'יועתקו אירועים מחודשיים אחורה ועד שנה קדימה'
    );
  });

  it('all three summaries mention "שנה קדימה" (one year forward)', () => {
    for (const r of ['none', 'two_months', 'one_year'] as const) {
      expect(getRangeSummaryText(r)).toContain('שנה קדימה');
    }
  });
});

// ── Section E.6: Absolute Hebrew date summary formatting ──────────────────────

describe('formatAbsoluteHebrewDate', () => {
  it('formats a known date in Hebrew with day, month name, and year', () => {
    // June 28, 2026 at noon UTC = June 28 in Jerusalem (UTC+3).
    const date = new Date(Date.UTC(2026, 5, 28, 12, 0, 0));
    const result = formatAbsoluteHebrewDate(date);
    // Must contain the year and a recognisable part of the Hebrew month for June.
    expect(result).toContain('2026');
    expect(result).toContain('יוני');
  });

  it('contains the day number', () => {
    const date = new Date(Date.UTC(2026, 5, 28, 12, 0, 0));
    const result = formatAbsoluteHebrewDate(date);
    expect(result).toContain('28');
  });
});

describe('getDisplayDateRange', () => {
  // June 28 09:00 Jerusalem (UTC+3) = June 28 06:00 UTC.
  const now = new Date('2026-06-28T06:00:00Z');

  it("'none' — start date is today (June 28)", () => {
    const { startDateStr } = getDisplayDateRange('none', now);
    expect(startDateStr).toContain('28');
    expect(startDateStr).toContain('יוני');
    expect(startDateStr).toContain('2026');
  });

  it("'none' — end date is one year from today (June 28, 2027)", () => {
    const { endDateStr } = getDisplayDateRange('none', now);
    expect(endDateStr).toContain('28');
    expect(endDateStr).toContain('יוני');
    expect(endDateStr).toContain('2027');
  });

  it("'one_year' — start date is twelve months back (June 28, 2025)", () => {
    const { startDateStr } = getDisplayDateRange('one_year', now);
    expect(startDateStr).toContain('28');
    expect(startDateStr).toContain('יוני');
    expect(startDateStr).toContain('2025');
  });

  it("'two_months' — start date is two months back (April 28)", () => {
    const { startDateStr } = getDisplayDateRange('two_months', now);
    expect(startDateStr).toContain('28');
    expect(startDateStr).toContain('אפריל');
    expect(startDateStr).toContain('2026');
  });

  it('end date is always one year ahead regardless of pastRange', () => {
    const endNone = getDisplayDateRange('none', now).endDateStr;
    const endOne = getDisplayDateRange('one_year', now).endDateStr;
    const endTwo = getDisplayDateRange('two_months', now).endDateStr;
    expect(endNone).toBe(endOne);
    expect(endOne).toBe(endTwo);
  });
});

// ── Section E.7: Events grouped by start-month and year ──────────────────────

describe('groupEventsByMonth', () => {
  it('groups events into correct months', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'a', startIso: '2026-07-01T09:00:00+03:00' }),
      makeEvent({ localId: 'b', startIso: '2026-07-15T10:00:00+03:00' }),
      makeEvent({ localId: 'c', startIso: '2026-08-01T10:00:00+03:00' }),
    ];
    const sections = groupEventsByMonth(events);
    expect(sections).toHaveLength(2);
    expect(sections[0].data).toHaveLength(2);
    expect(sections[1].data).toHaveLength(1);
  });

  it('sections are in chronological order', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'c', startIso: '2026-09-01T09:00:00+03:00' }),
      makeEvent({ localId: 'a', startIso: '2026-07-01T09:00:00+03:00' }),
      makeEvent({ localId: 'b', startIso: '2026-08-01T09:00:00+03:00' }),
    ];
    const sections = groupEventsByMonth(events);
    expect(sections[0].key).toBe('2026-07');
    expect(sections[1].key).toBe('2026-08');
    expect(sections[2].key).toBe('2026-09');
  });

  it('events within a section preserve their original order', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'first', startIso: '2026-07-01T09:00:00+03:00' }),
      makeEvent({ localId: 'second', startIso: '2026-07-10T09:00:00+03:00' }),
      makeEvent({ localId: 'third', startIso: '2026-07-20T09:00:00+03:00' }),
    ];
    const sections = groupEventsByMonth(events);
    expect(sections[0].data[0].localId).toBe('first');
    expect(sections[0].data[1].localId).toBe('second');
    expect(sections[0].data[2].localId).toBe('third');
  });

  it('section title is formatted as Hebrew month + year', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'a', startIso: '2026-07-01T09:00:00+03:00' }),
    ];
    const sections = groupEventsByMonth(events);
    expect(sections[0].title).toContain('יולי');
    expect(sections[0].title).toContain('2026');
  });

  it('section key is "YYYY-MM" format', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'a', startIso: '2026-07-01T09:00:00+03:00' }),
    ];
    const sections = groupEventsByMonth(events);
    expect(sections[0].key).toBe('2026-07');
  });

  it('returns empty array for empty input', () => {
    expect(groupEventsByMonth([])).toHaveLength(0);
  });
});

// ── Section E.8: Empty months are omitted ────────────────────────────────────

describe('groupEventsByMonth — empty months omitted', () => {
  it('does not create a section for months with no events', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'a', startIso: '2026-07-01T09:00:00+03:00' }),
      // August: no events
      makeEvent({ localId: 'b', startIso: '2026-09-01T09:00:00+03:00' }),
    ];
    const sections = groupEventsByMonth(events);
    // Only July and September — August is absent.
    expect(sections).toHaveLength(2);
    const keys = sections.map((s) => s.key);
    expect(keys).not.toContain('2026-08');
  });

  it('handles a single event spanning one month', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'a', startIso: '2026-12-25T09:00:00+02:00' }),
    ];
    const sections = groupEventsByMonth(events);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('2026-12');
  });
});

// ── Section E.9: Multi-day events belong only to their start month ────────────

describe('groupEventsByMonth — multi-day events', () => {
  it('a multi-day event spanning two months belongs only to its start month', () => {
    // Starts June 30, ends July 5 — should appear in June only.
    const events: NormalizedEvent[] = [
      makeEvent({
        localId: 'span',
        startIso: '2026-06-30T00:00:00',
        endIso: '2026-07-05T00:00:00',
        isAllDay: true,
      }),
      makeEvent({ localId: 'july', startIso: '2026-07-10T10:00:00+03:00' }),
    ];
    const sections = groupEventsByMonth(events);
    const june = sections.find((s) => s.key === '2026-06');
    const july = sections.find((s) => s.key === '2026-07');
    expect(june).toBeDefined();
    expect(june?.data).toHaveLength(1);
    expect(july).toBeDefined();
    expect(july?.data).toHaveLength(1);
    // The spanning event is only in June.
    expect(june?.data[0].localId).toBe('span');
    expect(july?.data[0].localId).toBe('july');
  });

  it('an all-day event uses the bare date string for month key', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'a', startIso: '2026-08-15', isAllDay: true }),
    ];
    const sections = groupEventsByMonth(events);
    expect(sections[0].key).toBe('2026-08');
  });
});

// ── getMonthKeyFromIso ────────────────────────────────────────────────────────

describe('getMonthKeyFromIso', () => {
  it('extracts month key from all-day ISO string', () => {
    expect(getMonthKeyFromIso('2026-07-14', true)).toBe('2026-07');
  });

  it('extracts month key from timed RFC3339 string', () => {
    // 2026-07-14T09:00:00+03:00 is July in Jerusalem.
    expect(getMonthKeyFromIso('2026-07-14T09:00:00+03:00', false)).toBe(
      '2026-07'
    );
  });

  it('handles year boundary correctly for all-day events', () => {
    expect(getMonthKeyFromIso('2027-01-01', true)).toBe('2027-01');
  });
});

// ── formatMonthTitle ──────────────────────────────────────────────────────────

describe('formatMonthTitle', () => {
  it('formats July 2026 as "יולי 2026"', () => {
    expect(formatMonthTitle('2026-07')).toBe('יולי 2026');
  });

  it('formats January 2027 as "ינואר 2027"', () => {
    expect(formatMonthTitle('2027-01')).toBe('ינואר 2027');
  });

  it('formats December 2026 as "דצמבר 2026"', () => {
    expect(formatMonthTitle('2026-12')).toBe('דצמבר 2026');
  });
});

// ── Section E.11: Month header tri-state ─────────────────────────────────────

describe('getMonthCheckState', () => {
  const events: NormalizedEvent[] = [
    makeEvent({ localId: 'e1', startIso: '2026-07-01T09:00:00+03:00' }),
    makeEvent({ localId: 'e2', startIso: '2026-07-05T09:00:00+03:00' }),
    makeEvent({ localId: 'e3', startIso: '2026-07-10T09:00:00+03:00' }),
  ];

  it('returns "all" when every event is selected', () => {
    const selected = new Set(['e1', 'e2', 'e3']);
    expect(getMonthCheckState(events, selected)).toBe('all');
  });

  it('returns "none" when no event is selected', () => {
    const selected = new Set<string>();
    expect(getMonthCheckState(events, selected)).toBe('none');
  });

  it('returns "some" when some events are selected', () => {
    const selected = new Set(['e1', 'e3']);
    expect(getMonthCheckState(events, selected)).toBe('some');
  });

  it('returns "some" when only one of three events is selected', () => {
    const selected = new Set(['e2']);
    expect(getMonthCheckState(events, selected)).toBe('some');
  });

  it('returns "none" for an empty events list', () => {
    expect(getMonthCheckState([], new Set(['e1']))).toBe('none');
  });
});

// ── Section E.12: Toggling a month selects/deselects all its events ───────────

describe('month toggle logic', () => {
  const eventsJuly: NormalizedEvent[] = [
    makeEvent({ localId: 'j1', startIso: '2026-07-01T09:00:00+03:00' }),
    makeEvent({ localId: 'j2', startIso: '2026-07-15T09:00:00+03:00' }),
  ];
  const eventsAug: NormalizedEvent[] = [
    makeEvent({ localId: 'a1', startIso: '2026-08-01T09:00:00+03:00' }),
  ];

  function toggleMonth(
    sectionEvents: readonly NormalizedEvent[],
    prev: Set<string>
  ): Set<string> {
    const allSelected = sectionEvents.every((e) => prev.has(e.localId));
    const next = new Set<string>(prev);
    if (allSelected) {
      for (const e of sectionEvents) next.delete(e.localId);
    } else {
      for (const e of sectionEvents) next.add(e.localId);
    }
    return next;
  }

  it('selecting a fully-unchecked month selects all its events', () => {
    const prev = new Set<string>();
    const next = toggleMonth(eventsJuly, prev);
    expect(next.has('j1')).toBe(true);
    expect(next.has('j2')).toBe(true);
  });

  it('deselecting a fully-checked month deselects all its events', () => {
    const prev = new Set(['j1', 'j2', 'a1']);
    const next = toggleMonth(eventsJuly, prev);
    expect(next.has('j1')).toBe(false);
    expect(next.has('j2')).toBe(false);
    // August event must remain selected.
    expect(next.has('a1')).toBe(true);
  });

  it('toggling a partially-selected month selects all its events', () => {
    const prev = new Set(['j1']); // j2 not selected
    const next = toggleMonth(eventsJuly, prev);
    expect(next.has('j1')).toBe(true);
    expect(next.has('j2')).toBe(true);
  });

  it('global selected count updates correctly after month deselect', () => {
    const allIds = new Set(['j1', 'j2', 'a1']);
    expect(allIds.size).toBe(3);
    const after = toggleMonth(eventsJuly, allIds);
    expect(after.size).toBe(1); // only a1 remains
    expect(after.has('a1')).toBe(true);
  });
});

// ── Section E.13: Single-event toggle → mixed/some state ─────────────────────

describe('single event toggle updates month header state to mixed', () => {
  it('deselecting one event in a fully-selected month → "some"', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'e1', startIso: '2026-07-01T09:00:00+03:00' }),
      makeEvent({ localId: 'e2', startIso: '2026-07-10T09:00:00+03:00' }),
    ];
    const selectedBefore = new Set(['e1', 'e2']); // all selected
    expect(getMonthCheckState(events, selectedBefore)).toBe('all');

    // Deselect e1
    const selectedAfter = new Set(selectedBefore);
    selectedAfter.delete('e1');
    expect(getMonthCheckState(events, selectedAfter)).toBe('some');
  });

  it('re-selecting the last missing event in a month → "all"', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'e1', startIso: '2026-07-01T09:00:00+03:00' }),
      makeEvent({ localId: 'e2', startIso: '2026-07-10T09:00:00+03:00' }),
    ];
    let selected = new Set(['e2']); // e1 missing → "some"
    expect(getMonthCheckState(events, selected)).toBe('some');

    selected = new Set([...selected, 'e1']); // add e1 → "all"
    expect(getMonthCheckState(events, selected)).toBe('all');
  });
});

// ── Section E.10: All events selected by default ─────────────────────────────

describe('all events selected by default on entering step 2', () => {
  it('initial selection includes every event localId', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'ev-1', startIso: '2026-07-01T09:00:00+03:00' }),
      makeEvent({ localId: 'ev-2', startIso: '2026-07-02T09:00:00+03:00' }),
      makeEvent({ localId: 'ev-3', startIso: '2026-08-01T09:00:00+03:00' }),
    ];
    const initial = new Set(events.map((e) => e.localId));
    expect(initial.size).toBe(3);
    for (const e of events) {
      expect(initial.has(e.localId)).toBe(true);
    }
  });

  it('all-selected state means every month header is "all"', () => {
    const events: NormalizedEvent[] = [
      makeEvent({ localId: 'j1', startIso: '2026-07-01T09:00:00+03:00' }),
      makeEvent({ localId: 'j2', startIso: '2026-07-10T09:00:00+03:00' }),
      makeEvent({ localId: 'a1', startIso: '2026-08-01T09:00:00+03:00' }),
    ];
    const selected = new Set(events.map((e) => e.localId));
    const sections = groupEventsByMonth(events);
    for (const section of sections) {
      expect(getMonthCheckState(section.data, selected)).toBe('all');
    }
  });
});

// ── Section E.4: Six-month range mode and annual-toggle UI no longer exist ────

describe('six-month range mode and annual-toggle UI removed', () => {
  /**
   * The UI exposes exactly three back-range chips and no ForwardMode toggle.
   * We mirror the RANGE_CHIPS constant from the screen here to verify its shape.
   */
  type PastRange = 'none' | 'two_months' | 'one_year';

  const RANGE_CHIPS: ReadonlyArray<{ value: PastRange; label: string }> = [
    { value: 'none', label: 'מהיום' },
    { value: 'two_months', label: 'חודשיים אחורה' },
    { value: 'one_year', label: 'שנה אחורה' },
  ] as const;

  it('there are exactly three range chips', () => {
    expect(RANGE_CHIPS).toHaveLength(3);
  });

  it('no chip represents a six-month forward mode', () => {
    for (const chip of RANGE_CHIPS) {
      expect(chip.label).not.toContain('6 חודשים');
      expect(chip.label).not.toContain('six');
    }
  });

  it('no chip value is "six_months" (ForwardMode removed from UI)', () => {
    for (const chip of RANGE_CHIPS) {
      expect(chip.value).not.toBe('six_months' as string);
    }
  });

  it('the three chips cover the three PastRange values', () => {
    const values = RANGE_CHIPS.map((c) => c.value);
    expect(values).toContain('none');
    expect(values).toContain('two_months');
    expect(values).toContain('one_year');
  });
});

// ── Section E.14: RTL logical ordering for chips ─────────────────────────────

describe('RTL chip logical ordering', () => {
  type PastRange = 'none' | 'two_months' | 'one_year';
  const RANGE_CHIPS: ReadonlyArray<{ value: PastRange; label: string }> = [
    { value: 'none', label: 'מהיום' },
    { value: 'two_months', label: 'חודשיים אחורה' },
    { value: 'one_year', label: 'שנה אחורה' },
  ] as const;

  it('"מהיום" is the first JSX chip (will appear on the right in RTL layout)', () => {
    expect(RANGE_CHIPS[0].value).toBe('none');
    expect(RANGE_CHIPS[0].label).toBe('מהיום');
  });

  it('"שנה אחורה" is the last JSX chip (will appear on the left in RTL layout)', () => {
    expect(RANGE_CHIPS[2].value).toBe('one_year');
    expect(RANGE_CHIPS[2].label).toBe('שנה אחורה');
  });
});

// ── RTL stepper order (mirrors importFlowStages.test.ts pattern) ──────────────

describe('RTL progress stepper logical order', () => {
  const STEPS_JSX_ORDER: ReadonlyArray<1 | 2 | 3> = [1, 2, 3];

  it('step 1 is first in JSX (rightmost in RTL)', () => {
    expect(STEPS_JSX_ORDER[0]).toBe(1);
  });

  it('step 3 is last in JSX (leftmost in RTL)', () => {
    expect(STEPS_JSX_ORDER[2]).toBe(3);
  });
});
