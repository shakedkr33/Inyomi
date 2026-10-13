/**
 * googleHolidayCalendarFilter — detects Google's own "Holiday calendars".
 *
 * Product rule: Google holiday calendars must never be imported into InYomi.
 * InYomi already has its own Hebcal-backed holiday overlay (see
 * lib/services/hebcalHolidayProvider.ts / lib/services/holidayOverlayMapper.ts)
 * and is the single source of truth for holidays shown in the app. Importing
 * Google's holiday calendars on top of that would create duplicate, untracked
 * "events" that InYomi cannot manage the same way.
 *
 * Detection heuristic:
 * Google provisions its built-in/subscribable holiday calendars (e.g.
 * "Holidays in Israel", "Jewish Holidays", "Holidays in United States") with
 * calendar IDs that always end in the fixed suffix
 * "#holiday@group.v.calendar.google.com" — regardless of the viewer's locale
 * or the calendar's display name. This is the same well-known, documented
 * pattern third-party calendar integrations rely on to distinguish Google's
 * holiday calendars from a user's own calendars. Matching on the ID (not the
 * localized `summary` text) keeps detection reliable across every language.
 *
 * A user's own primary calendar ID (their account email address) can never
 * match this suffix, so this filter never risks excluding real calendars.
 */

const GOOGLE_HOLIDAY_CALENDAR_ID_SUFFIX =
  '#holiday@group.v.calendar.google.com';

/**
 * Returns true when the given Google Calendar ID belongs to one of Google's
 * own holiday calendars (national/religious holiday calendars Google offers
 * under "Browse calendars of interest" or auto-subscribes by region).
 */
export function isGoogleHolidayCalendarId(id: string): boolean {
  return id.endsWith(GOOGLE_HOLIDAY_CALENDAR_ID_SUFFIX);
}
