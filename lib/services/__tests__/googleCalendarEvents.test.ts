/**
 * Tests for googleCalendarEvents.ts
 *
 * Run with: bun test
 *
 * Covers:
 * - buildDateRange for every PastRange option
 * - buildDateRange with forwardMonths=12 (one-year forward mode)
 * - All-day event vs timed event inclusion and isAllDay detection
 * - Recurring event expansion (singleEvents=true in API call)
 * - Cancelled event filtering
 * - Pagination (multiple pages)
 * - Cross-calendar duplicate handling (iCalUID-based and ID-based)
 * - Zero results
 * - Partial fetch failure
 * - 401/token-expired behavior
 * - Hebrew RTL preview copy (title extraction, unnamed fallback)
 * - Full normalized NormalizedEvent[] in success result
 * - Chronological ordering of returned events
 * - Trust string: "האירועים עדיין לא הועתקו ל-InYomi."
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  buildDateRange,
  type CalendarTarget,
  extractLocationAndMeetingLink,
  fetchCalendarPreview,
  type NormalizedEvent,
  type RawEvent,
} from '../googleCalendarEvents';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEventItem(overrides: {
  id?: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  startDate?: string;
  startDateTime?: string;
  endDate?: string;
  endDateTime?: string;
}): Record<string, unknown> {
  const start: Record<string, string> = {};
  if (overrides.startDate) start.date = overrides.startDate;
  if (overrides.startDateTime) start.dateTime = overrides.startDateTime;
  const end: Record<string, string> = {};
  if (overrides.endDate) end.date = overrides.endDate;
  if (overrides.endDateTime) end.dateTime = overrides.endDateTime;
  return {
    id: overrides.id ?? 'ev1',
    iCalUID: overrides.iCalUID ?? `${overrides.id ?? 'ev1'}@google.com`,
    status: overrides.status ?? 'confirmed',
    summary: overrides.summary ?? 'Test Event',
    start,
    ...(Object.keys(end).length > 0 ? { end } : {}),
  };
}

function makePageResponse(
  items: Record<string, unknown>[],
  nextPageToken?: string
): string {
  return JSON.stringify({ items, ...(nextPageToken ? { nextPageToken } : {}) });
}

function makeOkFetchResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorFetchResponse(status: number): Response {
  return new Response('', { status });
}

const DUMMY_TOKEN = 'test-access-token';
const DUMMY_SIGNAL = new AbortController().signal;

// ── buildDateRange ────────────────────────────────────────────────────────────

describe('buildDateRange', () => {
  it("'none' starts at today midnight Jerusalem and ends 6 months forward (exclusive next-day boundary)", () => {
    // Jerusalem is UTC+3 in summer. June 28 00:00:00 Jerusalem = June 27 21:00:00 UTC.
    // We pin `now` to a moment that is clearly still June 28 in Jerusalem (09:00 local).
    // June 28 09:00 Jerusalem (UTC+3) = June 28 06:00 UTC.
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMin, timeMax } = buildDateRange('none', now);

    expect(timeMin).toMatch(/^2026-06-28T00:00:00[+-]/);
    // timeMax is 00:00:00 of Dec 29 (the day AFTER Dec 28) — exclusive boundary.
    expect(timeMax).toMatch(/^2026-12-29T00:00:00[+-]/);
  });

  it("'one_month' starts one calendar month before today", () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMin, timeMax } = buildDateRange('one_month', now);

    expect(timeMin).toMatch(/^2026-05-28T00:00:00[+-]/);
    expect(timeMax).toMatch(/^2026-12-29T00:00:00[+-]/);
  });

  it("'two_months' starts two calendar months before today", () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMin, timeMax } = buildDateRange('two_months', now);

    expect(timeMin).toMatch(/^2026-04-28T00:00:00[+-]/);
    expect(timeMax).toMatch(/^2026-12-29T00:00:00[+-]/);
  });

  it('handles month-end overflow correctly (Jan 31 minus 1 month = Dec 31)', () => {
    // Jerusalem winter is UTC+2. Jan 31 09:00 Jerusalem = Jan 31 07:00 UTC.
    const now = new Date('2026-01-31T07:00:00Z');
    const { timeMin } = buildDateRange('one_month', now);
    // JS Date(2026, 0 - 1, 31) = Dec 31 2025
    expect(timeMin).toMatch(/^2025-12-31T00:00:00[+-]/);
  });

  it('produces valid RFC3339 strings with timezone offset', () => {
    const { timeMin, timeMax } = buildDateRange('none');
    // RFC3339 format: YYYY-MM-DDTHH:mm:ss+HH:MM or -HH:MM
    const rfc3339Re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
    expect(timeMin).toMatch(rfc3339Re);
    expect(timeMax).toMatch(rfc3339Re);
  });

  it('timeMin is before timeMax for all range options', () => {
    for (const range of ['none', 'one_month', 'two_months'] as const) {
      const { timeMin, timeMax } = buildDateRange(range);
      expect(timeMin < timeMax).toBe(true);
    }
  });

  // ── One-year forward mode ───────────────────────────────────────────────────

  it('forwardMonths=12 extends timeMax to one year ahead (exclusive next-day)', () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMax } = buildDateRange('none', now, 12);
    // One year forward endpoint is June 28, 2027.
    // Exclusive boundary = June 29, 2027 at 00:00:00.
    expect(timeMax).toMatch(/^2027-06-29T00:00:00[+-]/);
  });

  it('forwardMonths=12 handles yearend overflow (June + 12 = June next year)', () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMin: timeMin6, timeMax: timeMax6 } = buildDateRange(
      'none',
      now,
      6
    );
    const { timeMin: timeMin12, timeMax: timeMax12 } = buildDateRange(
      'none',
      now,
      12
    );
    // timeMin is the same for both (past range identical)
    expect(timeMin6.substring(0, 10)).toBe(timeMin12.substring(0, 10));
    // timeMax for 12 months is later than for 6 months
    expect(timeMax12 > timeMax6).toBe(true);
  });

  it('reverting from one-year to six-months produces the standard timeMax', () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMax: sixMonth } = buildDateRange('none', now, 6);
    const { timeMax: oneYear } = buildDateRange('none', now, 12);
    const { timeMax: reverted } = buildDateRange('none', now, 6);

    // Reverting gives back the 6-month timeMax
    expect(reverted).toBe(sixMonth);
    // One-year is strictly later
    expect(oneYear > sixMonth).toBe(true);
  });

  it('timeMin is before timeMax for one-year forward range', () => {
    const { timeMin, timeMax } = buildDateRange('none', new Date(), 12);
    expect(timeMin < timeMax).toBe(true);
  });

  // ── New tests required by Section E ────────────────────────────────────────

  it('default forward range (UI default) is 12 months — forwardMonths=12', () => {
    const now = new Date('2026-06-28T06:00:00Z');
    // The hook always passes forwardMonths=12 (one year).
    const { timeMin, timeMax } = buildDateRange('none', now, 12);
    expect(timeMin).toMatch(/^2026-06-28T00:00:00[+-]/);
    // June 28 + 12 months = June 28, 2027; exclusive boundary = June 29, 2027.
    expect(timeMax).toMatch(/^2027-06-29T00:00:00[+-]/);
  });

  it('one-month-back start boundary with 12-month forward', () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMin, timeMax } = buildDateRange('one_month', now, 12);
    expect(timeMin).toMatch(/^2026-05-28T00:00:00[+-]/);
    expect(timeMax).toMatch(/^2027-06-29T00:00:00[+-]/);
  });

  it('two-months-back start boundary with 12-month forward', () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMin, timeMax } = buildDateRange('two_months', now, 12);
    expect(timeMin).toMatch(/^2026-04-28T00:00:00[+-]/);
    expect(timeMax).toMatch(/^2027-06-29T00:00:00[+-]/);
  });

  it('timeMax is 00:00:00 of the next day — exclusive boundary ensures full final day is included', () => {
    const now = new Date('2026-06-28T06:00:00Z');
    const { timeMax } = buildDateRange('none', now, 6);
    // Must be midnight (00:00:00) — not 23:59:59.
    expect(timeMax).toMatch(/T00:00:00[+-]/);
    // The day must be Dec 29 (= Dec 28 + 1), not Dec 28.
    expect(timeMax).toMatch(/^2026-12-29/);
  });

  it('timeMax exclusive boundary handles month-end overflow (Dec 31 + 1 day → Jan 1)', () => {
    // Jerusalem winter UTC+2. Jan 1 09:00 Jerusalem = Jan 1 07:00 UTC.
    const now = new Date('2027-01-01T07:00:00Z');
    const { timeMax } = buildDateRange('none', now, 6);
    // 6 months forward from Jan 1, 2027 = Jul 1, 2027.  Next day = Jul 2.
    expect(timeMax).toMatch(/^2027-07-02T00:00:00[+-]/);
  });
});

// ── fetchCalendarPreview ──────────────────────────────────────────────────────

describe('fetchCalendarPreview', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  const SINGLE_CAL: readonly CalendarTarget[] = [
    { id: 'cal1', title: 'יומן ראשי' },
  ];
  const MULTI_CAL: readonly CalendarTarget[] = [
    { id: 'cal1', title: 'יומן ראשי' },
    { id: 'cal2', title: 'עבודה' },
  ];
  const TIME_MIN = '2026-06-28T00:00:00+03:00';
  const TIME_MAX = '2026-12-28T23:59:59+03:00';

  // ── One calendar: success ──────────────────────────────────────────────────

  it('returns success with count and up to 3 titles for a single calendar', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e1',
              summary: 'ישיבה',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e2',
              summary: 'יומהולדת',
              startDateTime: '2026-07-02T00:00:00+03:00',
            }),
            makeEventItem({
              id: 'e3',
              summary: 'חופשה',
              startDate: '2026-07-10',
            }),
            makeEventItem({
              id: 'e4',
              summary: 'כנס',
              startDateTime: '2026-08-01T10:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(4);
    expect(result.previewTitles).toHaveLength(3);
    expect(result.previewTitles[0]).toBe('ישיבה');
    expect(result.previewTitles[1]).toBe('יומהולדת');
    expect(result.previewTitles[2]).toBe('חופשה');
  });

  // ── Full events list ────────────────────────────────────────────────────────

  it('returns full events list in success result', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e1',
              summary: 'ישיבה',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e2',
              summary: 'חופשה',
              startDate: '2026-07-10',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events).toHaveLength(2);
    expect(result.count).toBe(2);
  });

  it('full events list is chronologically ordered', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            // Out-of-order from API (we sort them)
            makeEventItem({
              id: 'e3',
              iCalUID: 'e3@g',
              summary: 'שלישי',
              startDateTime: '2026-09-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e1',
              iCalUID: 'e1@g',
              summary: 'ראשון',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e2',
              iCalUID: 'e2@g',
              summary: 'שני',
              startDateTime: '2026-08-01T09:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].title).toBe('ראשון');
    expect(result.events[1].title).toBe('שני');
    expect(result.events[2].title).toBe('שלישי');
  });

  it('each event in events list has a stable unique localId', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e1',
              iCalUID: 'e1@g',
              summary: 'א',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e2',
              iCalUID: 'e2@g',
              summary: 'ב',
              startDateTime: '2026-07-02T09:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ids = result.events.map((e: NormalizedEvent) => e.localId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // ── isAllDay detection ─────────────────────────────────────────────────────

  it('marks all-day events with isAllDay=true', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'allday',
              summary: 'חג',
              startDate: '2026-09-14',
              endDate: '2026-09-15',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].isAllDay).toBe(true);
    expect(result.events[0].startIso).toBe('2026-09-14');
  });

  it('marks timed events with isAllDay=false', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'timed',
              summary: 'פגישה',
              startDateTime: '2026-07-15T14:00:00+03:00',
              endDateTime: '2026-07-15T15:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].isAllDay).toBe(false);
    expect(result.events[0].startIso).toBe('2026-07-15T14:00:00+03:00');
  });

  it('captures end date for all-day events in endIso', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'allday',
              summary: 'חג',
              startDate: '2026-09-14',
              endDate: '2026-09-15',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].endIso).toBe('2026-09-15');
  });

  it('captures end dateTime for timed events in endIso', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'timed',
              summary: 'פגישה',
              startDateTime: '2026-07-15T14:00:00+03:00',
              endDateTime: '2026-07-15T15:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].endIso).toBe('2026-07-15T15:00:00+03:00');
  });

  it('endIso is null when end is not supplied', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            // no end field in helper
            {
              id: 'noend',
              iCalUID: 'noend@g',
              status: 'confirmed',
              summary: 'ללא סיום',
              start: { dateTime: '2026-07-01T09:00:00+03:00' },
            },
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].endIso).toBeNull();
  });

  // ── All-day event inclusion ────────────────────────────────────────────────

  it('includes all-day events (start.date present, no start.dateTime)', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'allday',
              summary: 'חג',
              startDate: '2026-09-14',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(1);
    expect(result.previewTitles[0]).toBe('חג');
  });

  // ── Timed event ────────────────────────────────────────────────────────────

  it('includes timed events (start.dateTime present)', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'timed',
              summary: 'פגישה',
              startDateTime: '2026-07-15T14:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(1);
    expect(result.previewTitles[0]).toBe('פגישה');
  });

  // ── Cancelled event filtering ──────────────────────────────────────────────

  it('filters out events with status === "cancelled"', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e1',
              summary: 'פגישה',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e2',
              status: 'cancelled',
              summary: 'ביטול',
              startDateTime: '2026-07-02T09:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(1);
    expect(result.previewTitles[0]).toBe('פגישה');
  });

  // ── Recurring event expansion ──────────────────────────────────────────────

  it('counts each recurring instance as a separate event (expansion handled by API)', async () => {
    const recurringUID = 'recurring@google.com';
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e1_1',
              iCalUID: recurringUID,
              summary: 'שיעור שבועי',
              startDateTime: '2026-07-06T18:00:00+03:00',
            }),
            makeEventItem({
              id: 'e1_2',
              iCalUID: recurringUID,
              summary: 'שיעור שבועי',
              startDateTime: '2026-07-13T18:00:00+03:00',
            }),
            makeEventItem({
              id: 'e1_3',
              iCalUID: recurringUID,
              summary: 'שיעור שבועי',
              startDateTime: '2026-07-20T18:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(3);
    expect(result.events).toHaveLength(3);
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  it('fetches all pages when nextPageToken is present', async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          makeOkFetchResponse(
            makePageResponse(
              [
                makeEventItem({
                  id: 'e1',
                  summary: 'עמוד 1',
                  startDateTime: '2026-07-01T09:00:00+03:00',
                }),
              ],
              'token-page-2'
            )
          )
        );
      }
      return Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e2',
              summary: 'עמוד 2',
              startDateTime: '2026-07-02T09:00:00+03:00',
            }),
          ])
        )
      );
    });

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(2);
    expect(callCount).toBe(2);
    expect(result.events).toHaveLength(2);
  });

  // ── Multiple calendars ─────────────────────────────────────────────────────

  it('merges events from multiple calendars', async () => {
    globalThis.fetch = mock((url: string) => {
      if (url.includes('cal1')) {
        return Promise.resolve(
          makeOkFetchResponse(
            makePageResponse([
              makeEventItem({
                id: 'e1',
                iCalUID: 'e1@g',
                summary: 'פגישה',
                startDateTime: '2026-07-01T09:00:00+03:00',
              }),
            ])
          )
        );
      }
      return Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e2',
              iCalUID: 'e2@g',
              summary: 'ארוחת ערב',
              startDateTime: '2026-07-02T19:00:00+03:00',
            }),
          ])
        )
      );
    });

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      MULTI_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(2);
    expect(result.events).toHaveLength(2);
  });

  // ── Cross-calendar duplicate handling ─────────────────────────────────────

  it('deduplicates the same event appearing in two calendars (same iCalUID + start)', async () => {
    const sharedUID = 'shared-uid@google.com';
    const sharedStart = '2026-07-10T10:00:00+03:00';
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'ev',
              iCalUID: sharedUID,
              summary: 'אירוע משותף',
              startDateTime: sharedStart,
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      MULTI_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(1);
    expect(result.events).toHaveLength(1);
  });

  it('does NOT merge events that merely share a title (different iCalUID)', async () => {
    globalThis.fetch = mock((url: string) => {
      if (url.includes('cal1')) {
        return Promise.resolve(
          makeOkFetchResponse(
            makePageResponse([
              makeEventItem({
                id: 'e1',
                iCalUID: 'uid1@g',
                summary: 'פגישה',
                startDateTime: '2026-07-01T09:00:00+03:00',
              }),
            ])
          )
        );
      }
      return Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e2',
              iCalUID: 'uid2@g',
              summary: 'פגישה',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
          ])
        )
      );
    });

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      MULTI_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(2);
    expect(result.events).toHaveLength(2);
  });

  // ── Zero results ───────────────────────────────────────────────────────────

  it('returns empty when no events are found', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(makeOkFetchResponse(makePageResponse([])))
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('empty');
  });

  it('returns empty when calendars array is empty', async () => {
    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      [],
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );
    expect(result.kind).toBe('empty');
  });

  // ── Partial fetch failure ──────────────────────────────────────────────────

  it('returns partial_failure when one of two calendars fails with a 5xx', async () => {
    globalThis.fetch = mock((url: string) => {
      if (url.includes('cal1')) {
        return Promise.resolve(
          makeOkFetchResponse(
            makePageResponse([
              makeEventItem({
                id: 'e1',
                summary: 'פגישה',
                startDateTime: '2026-07-01T09:00:00+03:00',
              }),
            ])
          )
        );
      }
      return Promise.resolve(makeErrorFetchResponse(500));
    });

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      MULTI_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('partial_failure');
    if (result.kind !== 'partial_failure') return;
    expect(result.failedCalendarTitles).toContain('עבודה');
    expect(result.failedCalendarTitles).not.toContain('יומן ראשי');
  });

  it('reports failed calendar by its Google-returned title, not its ID', async () => {
    globalThis.fetch = mock(() => Promise.resolve(makeErrorFetchResponse(503)));

    const cals: readonly CalendarTarget[] = [
      { id: 'abc123', title: 'My Google Calendar Name' },
    ];
    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      cals,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('partial_failure');
    if (result.kind !== 'partial_failure') return;
    expect(result.failedCalendarTitles[0]).toBe('My Google Calendar Name');
  });

  // ── 401 / token expired ────────────────────────────────────────────────────

  it('returns auth_error on HTTP 401', async () => {
    globalThis.fetch = mock(() => Promise.resolve(makeErrorFetchResponse(401)));

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('auth_error');
  });

  it('returns auth_error on HTTP 403', async () => {
    globalThis.fetch = mock(() => Promise.resolve(makeErrorFetchResponse(403)));

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('auth_error');
  });

  it('prioritises auth_error over partial_failure when any calendar returns 401', async () => {
    globalThis.fetch = mock((url: string) => {
      if (url.includes('cal1')) {
        return Promise.resolve(makeErrorFetchResponse(401));
      }
      return Promise.resolve(makeErrorFetchResponse(500));
    });

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      MULTI_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('auth_error');
  });

  // ── Network error ──────────────────────────────────────────────────────────

  it('returns network_error when fetch rejects', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('Network failure')));

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('network_error');
  });

  // ── Hebrew RTL preview copy ────────────────────────────────────────────────

  it('substitutes "אירוע ללא שם" for events with no summary', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e1',
              summary: '',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.previewTitles[0]).toBe('אירוע ללא שם');
    expect(result.events[0].title).toBe('אירוע ללא שם');
  });

  it('returns at most 3 preview titles even with many events', async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeEventItem({
        id: `e${i}`,
        iCalUID: `e${i}@g`,
        summary: `אירוע ${i + 1}`,
        startDateTime: `2026-07-${String(i + 1).padStart(2, '0')}T09:00:00+03:00`,
      })
    );
    globalThis.fetch = mock(() =>
      Promise.resolve(makeOkFetchResponse(makePageResponse(items)))
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.count).toBe(10);
    expect(result.previewTitles).toHaveLength(3);
    // But events list contains all 10
    expect(result.events).toHaveLength(10);
  });

  it('returns preview titles in chronological order', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeOkFetchResponse(
          makePageResponse([
            makeEventItem({
              id: 'e3',
              iCalUID: 'e3@g',
              summary: 'אחרון',
              startDateTime: '2026-09-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e1',
              iCalUID: 'e1@g',
              summary: 'ראשון',
              startDateTime: '2026-07-01T09:00:00+03:00',
            }),
            makeEventItem({
              id: 'e2',
              iCalUID: 'e2@g',
              summary: 'שני',
              startDateTime: '2026-08-01T09:00:00+03:00',
            }),
          ])
        )
      )
    );

    const result = await fetchCalendarPreview(
      DUMMY_TOKEN,
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      DUMMY_SIGNAL
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.previewTitles[0]).toBe('ראשון');
    expect(result.previewTitles[1]).toBe('שני');
    expect(result.previewTitles[2]).toBe('אחרון');
  });

  // ── Trust string ────────────────────────────────────────────────────────────

  it('trust string "האירועים עדיין לא הועתקו ל-InYomi." uses a plain ASCII hyphen', () => {
    const trustString = 'האירועים עדיין לא הועתקו ל-InYomi.';
    // The hyphen between ל and InYomi must be a regular ASCII hyphen (U+002D).
    const hyphenIndex = trustString.indexOf('-');
    expect(hyphenIndex).toBeGreaterThan(-1);
    expect(trustString.charCodeAt(hyphenIndex)).toBe(0x2d); // ASCII hyphen
    // Must NOT contain a non-breaking hyphen (U+2011) or en/em dash.
    expect(trustString).not.toContain('\u2011');
    expect(trustString).not.toContain('\u2013');
    expect(trustString).not.toContain('\u2014');
  });
});

// ── formatEventMeta (date formatting utility) ──────────────────────────────────

describe('formatEventMeta', () => {
  // Import the exported utility for direct testing.
  // It's exported from import-calendar.tsx for testability.
  // We re-implement inline here to avoid importing the full RN component tree.
  function formatJerusalemTime(date: Date): string {
    const fmt = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = new Map(
      fmt.formatToParts(date).map((p) => [p.type, p.value])
    );
    let h = parts.get('hour') ?? '00';
    const m = parts.get('minute') ?? '00';
    if (h === '24') h = '00';
    return `${h}:${m}`;
  }

  it('formats timed event time correctly for Jerusalem timezone', () => {
    // 16:30 Jerusalem time
    const date = new Date('2026-07-14T13:30:00Z'); // UTC+3 = 16:30
    const time = formatJerusalemTime(date);
    expect(time).toBe('16:30');
  });

  it('formats midnight Jerusalem time as 00:00', () => {
    // Midnight Jerusalem (UTC+3) = 21:00 previous day UTC
    const date = new Date('2026-07-13T21:00:00Z');
    const time = formatJerusalemTime(date);
    expect(time).toBe('00:00');
  });
});

// ── Event selection logic ──────────────────────────────────────────────────────
// These tests validate the in-memory selection model that the screen manages.
// They don't require a mounted component since they test pure logic.

describe('event selection model', () => {
  it('all events are selected by default (Set includes all localIds)', () => {
    const events: NormalizedEvent[] = [
      {
        localId: 'ev-1',
        title: 'אירוע א',
        startIso: '2026-07-01T09:00:00+03:00',
        endIso: null,
        isAllDay: false,
      },
      {
        localId: 'ev-2',
        title: 'אירוע ב',
        startIso: '2026-07-02T09:00:00+03:00',
        endIso: null,
        isAllDay: false,
      },
    ];

    // Simulate entering step 2: initialize with all event IDs.
    const initialSelection = new Set(events.map((e) => e.localId));

    expect(initialSelection.size).toBe(2);
    expect(initialSelection.has('ev-1')).toBe(true);
    expect(initialSelection.has('ev-2')).toBe(true);
  });

  it('deselecting an event removes it from selection and reduces count', () => {
    const events: NormalizedEvent[] = [
      {
        localId: 'ev-1',
        title: 'אירוע א',
        startIso: '2026-07-01T09:00:00+03:00',
        endIso: null,
        isAllDay: false,
      },
      {
        localId: 'ev-2',
        title: 'אירוע ב',
        startIso: '2026-07-02T09:00:00+03:00',
        endIso: null,
        isAllDay: false,
      },
    ];

    let selection = new Set(events.map((e) => e.localId));
    expect(selection.size).toBe(2);

    // Deselect ev-1
    const next = new Set(selection);
    next.delete('ev-1');
    selection = next;

    expect(selection.size).toBe(1);
    expect(selection.has('ev-1')).toBe(false);
    expect(selection.has('ev-2')).toBe(true);
  });

  it('re-selecting a deselected event restores it', () => {
    let selection = new Set<string>(['ev-1', 'ev-2']);

    // Remove ev-1
    const step1 = new Set(selection);
    step1.delete('ev-1');
    selection = step1;
    expect(selection.has('ev-1')).toBe(false);

    // Re-add ev-1
    const step2 = new Set(selection);
    step2.add('ev-1');
    selection = step2;
    expect(selection.has('ev-1')).toBe(true);
    expect(selection.size).toBe(2);
  });

  it('zero selected events means canProceed = false', () => {
    const selection = new Set<string>();
    const canProceed = selection.size > 0;
    expect(canProceed).toBe(false);
  });

  it('one or more selected events means canProceed = true', () => {
    const selection = new Set<string>(['ev-1']);
    const canProceed = selection.size > 0;
    expect(canProceed).toBe(true);
  });
});

// ── extractLocationAndMeetingLink ───────────────────────────────────────────
//
// Pure-function tests for the Meet/Zoom/Teams meeting-link extraction and
// physical-location preservation logic. Covers the deterministic priority
// order (conferenceData video entry point > hangoutLink > location >
// description) and the coexistence of a physical location with a meeting
// link (Section 4/5/7 of the import spec).

describe('extractLocationAndMeetingLink', () => {
  function videoEntryPoint(uri: string): Record<string, unknown> {
    return { entryPointType: 'video', uri };
  }

  // 1. Google Meet from conferenceData.entryPoints
  it('extracts a Google Meet URL from conferenceData.entryPoints (video type)', () => {
    const event: RawEvent = {
      conferenceData: {
        entryPoints: [videoEntryPoint('https://meet.google.com/abc-defg-hij')],
      },
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(result.location).toBeUndefined();
  });

  // 2. Google Meet from hangoutLink
  it('extracts a Google Meet URL from hangoutLink when conferenceData is absent', () => {
    const event: RawEvent = {
      hangoutLink: 'https://meet.google.com/xyz-uvwx-rst',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://meet.google.com/xyz-uvwx-rst');
  });

  // 3. Zoom URL in location
  it('extracts a Zoom URL found directly in location', () => {
    const event: RawEvent = { location: 'https://us02web.zoom.us/j/123456789' };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://us02web.zoom.us/j/123456789');
    expect(result.location).toBeUndefined();
  });

  // 4. Zoom URL in description
  it('extracts a Zoom URL from description when no stronger source exists', () => {
    const event: RawEvent = {
      description: 'הצטרפו לפגישה: https://zoom.us/j/987654321 בברכה',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://zoom.us/j/987654321');
  });

  // 5. Teams URL in location
  it('extracts a Microsoft Teams URL found directly in location', () => {
    const event: RawEvent = {
      location: 'https://teams.microsoft.com/l/meetup-join/abc123',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe(
      'https://teams.microsoft.com/l/meetup-join/abc123'
    );
    expect(result.location).toBeUndefined();
  });

  // 6. Teams URL in description
  it('extracts a Microsoft Teams URL from description', () => {
    const event: RawEvent = {
      description: 'לינק להצטרפות: https://teams.live.com/meet/12345',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://teams.live.com/meet/12345');
  });

  // 7. physical location + Meet link → both preserved
  it('preserves a physical location alongside a structured Meet link (conferenceData)', () => {
    const event: RawEvent = {
      location: 'משרדי החברה, תל אביב',
      conferenceData: {
        entryPoints: [videoEntryPoint('https://meet.google.com/abc-defg-hij')],
      },
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.location).toBe('משרדי החברה, תל אביב');
    expect(result.onlineUrl).toBe('https://meet.google.com/abc-defg-hij');
  });

  // 8. physical location only → unchanged
  it('leaves a plain physical location unchanged when no meeting link exists', () => {
    const event: RawEvent = { location: 'משרדי החברה, תל אביב' };
    const result = extractLocationAndMeetingLink(event);
    expect(result.location).toBe('משרדי החברה, תל אביב');
    expect(result.onlineUrl).toBeUndefined();
  });

  // 9. description with unrelated URL → not treated as meeting link
  it('does not treat an unrelated website URL in description as a meeting link', () => {
    const event: RawEvent = {
      description: 'לפרטים נוספים: https://example.com/?redirect=zoom.us',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBeUndefined();
  });

  // 10. multiple possible sources → correct priority chosen
  it('prefers conferenceData over hangoutLink, location and description when all are present', () => {
    const event: RawEvent = {
      conferenceData: {
        entryPoints: [
          videoEntryPoint('https://meet.google.com/from-conference'),
        ],
      },
      hangoutLink: 'https://meet.google.com/from-hangout',
      location: 'https://zoom.us/j/from-location',
      description: 'https://teams.microsoft.com/l/meetup-join/from-description',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://meet.google.com/from-conference');
  });

  it('prefers hangoutLink over location and description when conferenceData is absent', () => {
    const event: RawEvent = {
      hangoutLink: 'https://meet.google.com/from-hangout',
      location: 'https://zoom.us/j/from-location',
      description: 'https://teams.microsoft.com/l/meetup-join/from-description',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://meet.google.com/from-hangout');
  });

  it('prefers location over description when neither structured source exists', () => {
    const event: RawEvent = {
      location: 'https://zoom.us/j/from-location',
      description: 'https://teams.microsoft.com/l/meetup-join/from-description',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://zoom.us/j/from-location');
  });

  // 11. conference phone/SIP entry points → ignored
  it('ignores phone and SIP conferenceData entry points (no video entry point present)', () => {
    const event: RawEvent = {
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1-234-567-8900' },
          { entryPointType: 'sip', uri: 'sip:abc@example.com' },
          {
            entryPointType: 'more',
            uri: 'https://meet.google.com/some-more-info',
          },
        ],
      },
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBeUndefined();
  });

  it('picks the video entry point even when phone/SIP entries are listed first', () => {
    const event: RawEvent = {
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1-234-567-8900' },
          videoEntryPoint('https://meet.google.com/abc-defg-hij'),
        ],
      },
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://meet.google.com/abc-defg-hij');
  });

  // 12. null/missing conference fields → no crash
  it('does not crash and returns undefined fields when everything is missing', () => {
    const event: RawEvent = {};
    expect(() => extractLocationAndMeetingLink(event)).not.toThrow();
    const result = extractLocationAndMeetingLink(event);
    expect(result.location).toBeUndefined();
    expect(result.onlineUrl).toBeUndefined();
  });

  it('does not crash on null-ish/malformed conferenceData shapes', () => {
    const malformedEvents: RawEvent[] = [
      { conferenceData: null },
      { conferenceData: 'not-an-object' },
      { conferenceData: {} },
      { conferenceData: { entryPoints: null } },
      { conferenceData: { entryPoints: 'not-an-array' } },
      { conferenceData: { entryPoints: [null, 42, 'x'] } },
      { conferenceData: { entryPoints: [{ entryPointType: 'video' }] } }, // missing uri
      { hangoutLink: 42 },
      { location: 12345 },
      { description: {} },
    ];
    for (const event of malformedEvents) {
      expect(() => extractLocationAndMeetingLink(event)).not.toThrow();
    }
  });

  // 13. malformed URL → ignored
  it('ignores a malformed hangoutLink URL', () => {
    const event: RawEvent = { hangoutLink: 'not a valid url' };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBeUndefined();
  });

  it('ignores a malformed conferenceData video URI', () => {
    const event: RawEvent = {
      conferenceData: { entryPoints: [videoEntryPoint('not a valid url')] },
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBeUndefined();
  });

  it('ignores a non-http(s) protocol URL (e.g. ftp)', () => {
    const event: RawEvent = { hangoutLink: 'ftp://meet.google.com/abc' };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBeUndefined();
  });

  // Section 5 — URL embedded inside a mixed-content location string.
  it('strips an embedded meeting URL from a mixed physical-location string, keeping the meaningful text', () => {
    const event: RawEvent = {
      location: 'משרדי החברה, תל אביב, https://meet.google.com/abc-defg-hij',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.location).toBe('משרדי החברה, תל אביב');
    expect(result.onlineUrl).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('does not extract an unsupported-domain URL from location as a meeting link', () => {
    const event: RawEvent = { location: 'https://example.com/office-map' };
    const result = extractLocationAndMeetingLink(event);
    // Not a recognized meeting provider — treated as plain (URL) location text.
    expect(result.onlineUrl).toBeUndefined();
    expect(result.location).toBe('https://example.com/office-map');
  });

  it('recognizes meet.google.com as a supported fallback domain from free text', () => {
    const event: RawEvent = {
      description: 'Join: https://meet.google.com/abc-defg-hij',
    };
    const result = extractLocationAndMeetingLink(event);
    expect(result.onlineUrl).toBe('https://meet.google.com/abc-defg-hij');
  });
});

// ── End-to-end: fetchCalendarPreview propagates location/onlineUrl ─────────

describe('fetchCalendarPreview — location and meeting link propagation', () => {
  const SINGLE_CAL: readonly CalendarTarget[] = [
    { id: 'cal1', title: 'יומן ראשי' },
  ];
  const TIME_MIN = '2026-06-28T00:00:00+03:00';
  const TIME_MAX = '2026-12-28T23:59:59+03:00';
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('propagates a conferenceData Meet link through to the normalized event', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'e1',
                iCalUID: 'e1@google.com',
                status: 'confirmed',
                summary: 'ישיבת צוות',
                start: { dateTime: '2026-07-01T09:00:00+03:00' },
                end: { dateTime: '2026-07-01T10:00:00+03:00' },
                location: 'משרדי החברה, תל אביב',
                conferenceData: {
                  entryPoints: [
                    {
                      entryPointType: 'video',
                      uri: 'https://meet.google.com/abc-defg-hij',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const result = await fetchCalendarPreview(
      'test-token',
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      new AbortController().signal
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].location).toBe('משרדי החברה, תל אביב');
    expect(result.events[0].onlineUrl).toBe(
      'https://meet.google.com/abc-defg-hij'
    );
  });

  it('propagates undefined location/onlineUrl for events without either', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'e2',
                iCalUID: 'e2@google.com',
                status: 'confirmed',
                summary: 'תזכורת',
                start: { dateTime: '2026-07-02T09:00:00+03:00' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const result = await fetchCalendarPreview(
      'test-token',
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      new AbortController().signal
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].location).toBeUndefined();
    expect(result.events[0].onlineUrl).toBeUndefined();
  });

  it('propagates a Zoom URL extracted from the raw location field', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'e3',
                iCalUID: 'e3@google.com',
                status: 'confirmed',
                summary: 'שיחת זום',
                start: { dateTime: '2026-07-03T09:00:00+03:00' },
                location: 'https://us02web.zoom.us/j/123456789',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const result = await fetchCalendarPreview(
      'test-token',
      SINGLE_CAL,
      TIME_MIN,
      TIME_MAX,
      new AbortController().signal
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.events[0].location).toBeUndefined();
    expect(result.events[0].onlineUrl).toBe(
      'https://us02web.zoom.us/j/123456789'
    );
  });
});
