/**
 * importFlowUtils — pure utility functions for the Google Calendar import flow.
 *
 * Kept in a dedicated module so they can be tested independently without
 * importing the React Native component tree.
 *
 * No React Native imports. No side effects. No persistence.
 */

import type { NormalizedEvent, PastRange } from './googleCalendarEvents';

// ── Types ─────────────────────────────────────────────────────────────────────

/** One month bucket produced by groupEventsByMonth(). */
export type EventSection = {
  /** Canonical sort key: "YYYY-MM". */
  key: string;
  /** Human-readable month title, e.g. "יולי 2026". */
  title: string;
  /** Events whose start date falls in this calendar month. */
  data: NormalizedEvent[];
};

/** Tri-state selection status for a month section header. */
export type MonthCheckState = 'all' | 'none' | 'some';

// ── Monthly grouping ──────────────────────────────────────────────────────────

/**
 * Extract a "YYYY-MM" key from an event's startIso, interpreted in the
 * Asia/Jerusalem timezone.
 *
 * - All-day events carry a bare "YYYY-MM-DD" start; the first 7 characters are
 *   the month key.
 * - Timed events carry an RFC3339 string; we parse it as a JS Date and extract
 *   the Jerusalem calendar month.
 */
export function getMonthKeyFromIso(
  startIso: string,
  isAllDay: boolean
): string {
  if (isAllDay) {
    return startIso.substring(0, 7);
  }
  const date = new Date(startIso);
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = new Map(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.get('year')}-${parts.get('month')}`;
}

/**
 * Format a "YYYY-MM" key as a human-readable Hebrew month + year.
 * Example: "2026-07" → "יולי 2026".
 *
 * The month name is the Hebraicised Gregorian name (he-IL default calendar).
 * Format: "{monthName} {year}" — constructed explicitly to avoid locale-variant
 * orderings of the Intl format string.
 */
export function formatMonthTitle(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month0 = Number(monthStr) - 1;
  // Create at noon UTC so timezone drift cannot shift the display date.
  const date = new Date(Date.UTC(year, month0, 15, 12, 0, 0));
  const monthName = new Intl.DateTimeFormat('he-IL', { month: 'long' }).format(
    date
  );
  return `${monthName} ${year}`;
}

/**
 * Group a chronologically-ordered event list into month sections.
 *
 * Rules:
 * - A multi-day event belongs only to the month of its start date.
 * - Empty months are omitted.
 * - Sections are returned in chronological order.
 * - Events within each section preserve their original (chronological) order.
 */
export function groupEventsByMonth(
  events: readonly NormalizedEvent[]
): EventSection[] {
  const sectionMap = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const key = getMonthKeyFromIso(event.startIso, event.isAllDay);
    const existing = sectionMap.get(key);
    if (existing) {
      existing.push(event);
    } else {
      sectionMap.set(key, [event]);
    }
  }
  return Array.from(sectionMap.keys())
    .sort()
    .map((key) => ({
      key,
      title: formatMonthTitle(key),
      data: sectionMap.get(key) as NormalizedEvent[],
    }));
}

// ── Tri-state selection ───────────────────────────────────────────────────────

/**
 * Derive the tri-state checkbox value for a single month section.
 *
 * - 'all'  — every event in the section is selected
 * - 'none' — no event is selected
 * - 'some' — some events are selected (indeterminate)
 */
export function getMonthCheckState(
  events: readonly NormalizedEvent[],
  selectedIds: Set<string>
): MonthCheckState {
  if (events.length === 0) return 'none';
  const selectedCount = events.filter((e) => selectedIds.has(e.localId)).length;
  if (selectedCount === events.length) return 'all';
  if (selectedCount === 0) return 'none';
  return 'some';
}

// ── Summary copy ──────────────────────────────────────────────────────────────

/**
 * Return the dynamic Hebrew summary sentence for a given past-range chip.
 *
 * 'none'       → "יועתקו אירועים מהיום ועד שנה קדימה"
 * 'two_months' → "יועתקו אירועים מחודשיים אחורה ועד שנה קדימה"
 * 'one_year'   → "יועתקו אירועים משנה אחורה ועד שנה קדימה"
 */
export function getRangeSummaryText(pastRange: PastRange): string {
  if (pastRange === 'none') return 'יועתקו אירועים מהיום ועד שנה קדימה';
  if (pastRange === 'two_months')
    return 'יועתקו אירועים מחודשיים אחורה ועד שנה קדימה';
  return 'יועתקו אירועים משנה אחורה ועד שנה קדימה';
}

// ── Absolute date formatting ──────────────────────────────────────────────────

/**
 * Format a Date as a Hebrew locale absolute date string.
 * Example: "28 ביוני 2026"
 *
 * Uses the Gregorian calendar (default for he-IL), Asia/Jerusalem timezone.
 */
export function formatAbsoluteHebrewDate(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Compute the human-readable start and end dates for the date-range summary
 * line, based on pastRange and a reference "now".
 *
 * Start:
 * - 'none'       → today in Jerusalem
 * - 'two_months' → two calendar months before today in Jerusalem
 * - 'one_year'   → twelve calendar months (one year) before today in Jerusalem
 *
 * End: always one calendar year (12 months) from today in Jerusalem.
 *
 * @param pastRange  - Selected chip value
 * @param now        - Injection point for testing (defaults to new Date())
 */
export function getDisplayDateRange(
  pastRange: PastRange,
  now: Date = new Date()
): { startDateStr: string; endDateStr: string } {
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = new Map(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const year = Number(parts.get('year'));
  const month0 = Number(parts.get('month')) - 1;
  const day = Number(parts.get('day'));

  // Compute the start calendar date for display.
  let startDisplayDate: Date;
  if (pastRange === 'none') {
    // Create at noon UTC to avoid any DST / cross-midnight shift when formatting.
    startDisplayDate = new Date(Date.UTC(year, month0, day, 12, 0, 0));
  } else if (pastRange === 'two_months') {
    const d = new Date(year, month0 - 2, day);
    startDisplayDate = new Date(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)
    );
  } else {
    const d = new Date(year, month0 - 12, day);
    startDisplayDate = new Date(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)
    );
  }

  // End: one calendar year from today.
  const endD = new Date(year, month0 + 12, day);
  const endDisplayDate = new Date(
    Date.UTC(endD.getFullYear(), endD.getMonth(), endD.getDate(), 12, 0, 0)
  );

  return {
    startDateStr: formatAbsoluteHebrewDate(startDisplayDate),
    endDateStr: formatAbsoluteHebrewDate(endDisplayDate),
  };
}

// ── Event row date/time label ─────────────────────────────────────────────────

/**
 * Human-readable start label for an event row in the import preview.
 * Display only — never used for ordering, grouping or persistence.
 *
 * - Timed events:  "4 במרץ · 10:00"   (Asia/Jerusalem wall-clock time)
 * - All-day events: "4 במרץ · כל היום" (bare YYYY-MM-DD, no timezone shift)
 *
 * Returns an empty string for an unparseable value so the row simply omits
 * the secondary line instead of throwing during render.
 */
export function formatEventStartLabel(
  startIso: string,
  isAllDay: boolean
): string {
  // All-day starts are bare dates: anchor at noon UTC so the Jerusalem
  // calendar day can never drift when formatting.
  const date = isAllDay
    ? new Date(`${startIso.substring(0, 10)}T12:00:00Z`)
    : new Date(startIso);
  if (Number.isNaN(date.getTime())) return '';

  const dayMonth = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'long',
  }).format(date);

  if (isAllDay) return `${dayMonth} · כל היום`;

  const parts = new Map(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${dayMonth} · ${parts.get('hour')}:${parts.get('minute')}`;
}
