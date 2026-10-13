/**
 * googleHolidayCalendarFilter.test.ts
 *
 * Focused, dependency-free tests for the production
 * `isGoogleHolidayCalendarId` detection helper (lib/services/
 * googleHolidayCalendarFilter.ts), which excludes Google's own holiday
 * calendars from the Google Calendar import flow's selectable calendar
 * list (see lib/hooks/useGoogleCalendarList.ts).
 *
 * The detection logic itself has been reviewed and approved and is NOT
 * changed by this file — these tests only lock in its documented,
 * approved behavior as a regression guard.
 *
 * Run with: bun test lib/services/__tests__/googleHolidayCalendarFilter.test.ts
 */

import { describe, expect, it } from 'bun:test';

import { isGoogleHolidayCalendarId } from '../googleHolidayCalendarFilter';

// ── A/B: Google built-in holiday calendars are detected ────────────────────────

describe('isGoogleHolidayCalendarId — Google-provisioned holiday calendars', () => {
  it('detects the Israeli holidays calendar', () => {
    expect(
      isGoogleHolidayCalendarId('en.israel#holiday@group.v.calendar.google.com')
    ).toBe(true);
  });

  it('detects the Jewish holidays calendar variant', () => {
    expect(
      isGoogleHolidayCalendarId('jewish#holiday@group.v.calendar.google.com')
    ).toBe(true);
  });

  it('detects other locale/region holiday-calendar variants sharing the same suffix', () => {
    expect(
      isGoogleHolidayCalendarId('en.usa#holiday@group.v.calendar.google.com')
    ).toBe(true);
    expect(
      isGoogleHolidayCalendarId(
        'en.christian#holiday@group.v.calendar.google.com'
      )
    ).toBe(true);
  });
});

// ── C/D: real user calendars are never excluded ─────────────────────────────────

describe('isGoogleHolidayCalendarId — real user calendars are never excluded', () => {
  it('returns false for the primary calendar ID (user email)', () => {
    expect(isGoogleHolidayCalendarId('someuser@gmail.com')).toBe(false);
  });

  it('returns false for a normal Google-created secondary calendar ID', () => {
    expect(
      isGoogleHolidayCalendarId('a1b2c3d4e5f6@group.calendar.google.com')
    ).toBe(false);
  });
});

// ── E: detection is ID-based only, never display-name-based ────────────────────

describe('isGoogleHolidayCalendarId — detection is ID-based only, never display-name-based', () => {
  // The helper only accepts an ID string; it has no knowledge of display
  // names. A user-created calendar always has a normal Google-issued
  // secondary-calendar ID regardless of what the user names it — these IDs
  // must remain allowed (return false) even when the (separately tracked)
  // display name contains holiday wording.
  it('a user-created calendar visually titled "חגים שלי" is not excluded', () => {
    const userCreatedCalendarId = 'q7r8s9t1u2v3@group.calendar.google.com';
    expect(isGoogleHolidayCalendarId(userCreatedCalendarId)).toBe(false);
  });

  it('a user-created calendar visually titled "Holidays" is not excluded', () => {
    const userCreatedCalendarId = 'k4l5m6n7o8p9@group.calendar.google.com';
    expect(isGoogleHolidayCalendarId(userCreatedCalendarId)).toBe(false);
  });

  it('a user-created calendar visually titled "חגים משפחתיים" is not excluded', () => {
    const userCreatedCalendarId = 'w1x2y3z4a5b6@group.calendar.google.com';
    expect(isGoogleHolidayCalendarId(userCreatedCalendarId)).toBe(false);
  });

  it('the literal substring "holiday" inside an unrelated ID does not trigger a false positive', () => {
    // Contains "holiday" but does not end with the exact required suffix.
    expect(
      isGoogleHolidayCalendarId('my-holiday-planning@group.calendar.google.com')
    ).toBe(false);
  });
});

// ── F: similar-looking but invalid IDs must not accidentally match ─────────────

describe('isGoogleHolidayCalendarId — similar-looking but invalid IDs must not match', () => {
  it('missing the ".v." segment entirely', () => {
    expect(isGoogleHolidayCalendarId('holiday@group.calendar.google.com')).toBe(
      false
    );
  });

  it('missing the ".v." segment, with a locale/"#holiday" prefix', () => {
    expect(
      isGoogleHolidayCalendarId('en.israel#holiday@group.calendar.google.com')
    ).toBe(false);
  });

  it('missing the "#holiday" segment entirely', () => {
    expect(
      isGoogleHolidayCalendarId('en.israel@group.v.calendar.google.com')
    ).toBe(false);
  });

  it('empty string', () => {
    expect(isGoogleHolidayCalendarId('')).toBe(false);
  });
});

// ── G/H: calendar-list/filter-level behavior using the real detection helper ────
// No hook/component mocking is introduced — this exercises the exact same
// pure predicate the production hook (useGoogleCalendarList) applies to
// each raw calendar-list entry, against a realistic mixed list.

describe('calendar-list filtering — Google holiday calendars excluded, legitimate calendars retained', () => {
  type RawCalendar = { id: string; title: string };

  const rawCalendars: RawCalendar[] = [
    { id: 'someuser@gmail.com', title: 'someuser@gmail.com' },
    {
      id: 'en.israel#holiday@group.v.calendar.google.com',
      title: 'חגים בישראל',
    },
    {
      id: 'jewish#holiday@group.v.calendar.google.com',
      title: 'חגים יהודיים',
    },
    { id: 'a1b2c3d4e5f6@group.calendar.google.com', title: 'עבודה' },
    { id: 'q7r8s9t1u2v3@group.calendar.google.com', title: 'חגים שלי' },
    { id: 'k4l5m6n7o8p9@group.calendar.google.com', title: 'Holidays' },
  ];

  const selectable = rawCalendars.filter(
    (c) => !isGoogleHolidayCalendarId(c.id)
  );

  it('excludes both Google holiday calendars from the selectable list', () => {
    const ids = selectable.map((c) => c.id);
    expect(ids).not.toContain('en.israel#holiday@group.v.calendar.google.com');
    expect(ids).not.toContain('jewish#holiday@group.v.calendar.google.com');
  });

  it('retains the primary calendar', () => {
    expect(selectable.some((c) => c.id === 'someuser@gmail.com')).toBe(true);
  });

  it('retains a normal secondary calendar', () => {
    expect(
      selectable.some((c) => c.id === 'a1b2c3d4e5f6@group.calendar.google.com')
    ).toBe(true);
  });

  it('retains user-created calendars whose display name contains holiday wording', () => {
    expect(selectable.some((c) => c.title === 'חגים שלי')).toBe(true);
    expect(selectable.some((c) => c.title === 'Holidays')).toBe(true);
  });

  it('excludes exactly the 2 Google holiday calendars out of 6 raw entries', () => {
    expect(rawCalendars.length).toBe(6);
    expect(selectable.length).toBe(4);
  });
});
