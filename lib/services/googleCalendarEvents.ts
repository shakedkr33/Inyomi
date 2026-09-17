/**
 * googleCalendarEvents — Google Calendar Events API service.
 *
 * Read-only. No Convex writes. No token persistence. No OAuth scope changes.
 * Events are fetched, normalized to minimal in-memory structures for the active
 * import flow, and discarded on app restart or navigation-away.
 *
 * Security contract:
 * - accessToken is passed in-memory and sent only in Authorization: Bearer header.
 *   It is never embedded in URLs, logged, or forwarded to any persistence layer.
 * - Raw event payloads, event titles, calendar IDs/names, and all PII are
 *   never logged (no console.log / console.error of sensitive data).
 * - All API errors produce only opaque error-kind values; no raw HTTP detail leaks.
 * - AbortSignal propagation ensures stale responses are discarded after cancel.
 * - Memory: the full normalized NormalizedEvent[] is retained only for the active
 *   flow (until cleared by the caller or by app restart). No raw API payloads,
 *   tokens, Google IDs, attendees, or full description text are retained.
 * - Retained (only what the user opted to import): the physical location text
 *   (with any embedded meeting URL stripped out) and, when present, a single
 *   canonical meeting-join URL (Google Meet / Zoom / Microsoft Teams) derived
 *   deterministically from conferenceData, hangoutLink, location or description.
 *   The full free-text description itself is inspected in-memory for a
 *   meeting URL but is never retained or persisted.
 */

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * How far into the past the event scan should reach.
 * 'none'        → start of today (Asia/Jerusalem)
 * 'one_month'   → one calendar month before today
 * 'two_months'  → two calendar months before today
 * End is always forwardMonths forward from today (default: 6).
 */
export type PastRange = 'none' | 'one_month' | 'two_months';

/** How far forward the scan should reach. */
export type ForwardMode = 'six_months' | 'one_year';

/** One calendar selected by the user plus its display title for error reporting. */
export type CalendarTarget = {
  /** Opaque Google calendar ID used only in API calls. Never logged. */
  id: string;
  /**
   * Display name exactly as returned by Google (summaryOverride ?? summary).
   * Used only when reporting a failed calendar by name. Never logged.
   */
  title: string;
};

/**
 * Minimal normalized in-memory representation of a single event.
 * Retained only for the active import flow. Cleared on app restart.
 *
 * Does NOT contain: OAuth tokens, Google event IDs, Google calendar names,
 * full description text, attendees, or raw API payloads.
 *
 * MAY contain (only when present on the source event and only the minimum
 * needed to populate InYomi's existing event location/link fields):
 * - `location`: physical location text, with any embedded meeting URL removed.
 * - `onlineUrl`: a single canonical Meet/Zoom/Teams meeting URL, chosen
 *   deterministically (see `extractLocationAndMeetingLink`).
 */
export type NormalizedEvent = {
  /** Stable client-side key for keying React rows. Not persisted. */
  localId: string;
  title: string;
  /** "YYYY-MM-DD" for all-day events, RFC3339 string for timed events. */
  startIso: string;
  /** "YYYY-MM-DD" or RFC3339 end when available; null otherwise. */
  endIso: string | null;
  isAllDay: boolean;
  /** Physical location text (meeting URLs removed), if any remains. */
  location?: string;
  /** Canonical meeting-join URL (Meet/Zoom/Teams), if one was found. */
  onlineUrl?: string;
};

/**
 * Final result of a preview fetch. Exactly one branch is returned.
 * No intermediate data is exposed to the caller.
 */
export type EventPreviewResult =
  | {
      kind: 'success';
      /** Total count of unique non-cancelled events in the range. */
      count: number;
      /** Up to three earliest event titles (or "אירוע ללא שם" if unnamed). */
      previewTitles: readonly string[];
      /**
       * Full chronologically-ordered normalized event list.
       * Retained in memory for the active flow only; cleared on clear() or
       * navigation-away. Never persisted or sent to Convex as raw API data.
       */
      events: readonly NormalizedEvent[];
    }
  | { kind: 'empty' }
  | {
      kind: 'partial_failure';
      /** Google-returned display names of calendars that failed. */
      failedCalendarTitles: readonly string[];
    }
  | { kind: 'auth_error' }
  | { kind: 'network_error' };

// ── Internal types ────────────────────────────────────────────────────────────

/** Minimal extraction from one event item; GC'd after processing. */
type MinimalEvent = {
  dedupKey: string;
  title: string;
  startNormalized: string;
  endNormalized: string | null;
  isAllDay: boolean;
  location?: string;
  onlineUrl?: string;
};

type RawEventDateTime = {
  dateTime?: unknown;
  date?: unknown;
};

type RawConferenceEntryPoint = {
  entryPointType?: unknown;
  uri?: unknown;
};

type RawConferenceData = {
  entryPoints?: unknown;
};

/** Exported only for unit testing extractLocationAndMeetingLink(). */
export type RawEvent = {
  id?: unknown;
  iCalUID?: unknown;
  status?: unknown;
  summary?: unknown;
  start?: unknown;
  end?: unknown;
  location?: unknown;
  description?: unknown;
  conferenceData?: unknown;
  hangoutLink?: unknown;
};

type RawEventsPage = {
  items?: RawEvent[];
  nextPageToken?: unknown;
};

type SingleCalendarOutcome =
  | { kind: 'ok'; events: MinimalEvent[] }
  | { kind: 'auth_error' }
  | { kind: 'network_error' }
  | { kind: 'api_error' };

// ── Constants ─────────────────────────────────────────────────────────────────

const JERUSALEM_TZ = 'Asia/Jerusalem';
const EVENTS_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const MAX_CONCURRENCY = 3;
const MAX_RESULTS_PER_PAGE = 2500;
const PREVIEW_LIMIT = 3;
const UNNAMED_EVENT = 'אירוע ללא שם';

// ── Date range utilities ──────────────────────────────────────────────────────

/**
 * Get the Jerusalem UTC offset in whole minutes at the given moment.
 * Works for both UTC+2 (winter) and UTC+3 (summer DST).
 */
function getJerusalemOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = new Map(fmt.formatToParts(date).map((p) => [p.type, p.value]));

  let hour = Number(parts.get('hour') ?? '0');
  // Intl can return '24' for midnight in some environments
  if (hour === 24) hour = 0;

  const jlmFakeUtcMs = Date.UTC(
    Number(parts.get('year')),
    Number(parts.get('month')) - 1,
    Number(parts.get('day')),
    hour,
    Number(parts.get('minute') ?? '0'),
    Number(parts.get('second') ?? '0')
  );

  const actualUtcMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  );

  return Math.round((jlmFakeUtcMs - actualUtcMs) / 60000);
}

/** Extract today's date components in the Jerusalem timezone. */
function getJerusalemToday(date: Date): {
  year: number;
  month0: number;
  day: number;
} {
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = new Map(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.get('year')),
    month0: Number(parts.get('month')) - 1,
    day: Number(parts.get('day')),
  };
}

/**
 * Build a valid RFC3339 date+time+offset string for the Jerusalem timezone.
 * Accepts 0-based month (month0).
 */
function toRFC3339(
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  offsetMinutes: number
): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOff = Math.abs(offsetMinutes);
  const offH = String(Math.floor(absOff / 60)).padStart(2, '0');
  const offM = String(absOff % 60).padStart(2, '0');
  const Y = String(year).padStart(4, '0');
  const M = String(month0 + 1).padStart(2, '0');
  const D = String(day).padStart(2, '0');
  const H = String(hour).padStart(2, '0');
  const MIN = String(minute).padStart(2, '0');
  const S = String(second).padStart(2, '0');
  return `${Y}-${M}-${D}T${H}:${MIN}:${S}${sign}${offH}:${offM}`;
}

/**
 * Compute RFC3339 timeMin and timeMax for a given PastRange and forward span.
 *
 * - timeMin: start of the past-range day at 00:00:00 Jerusalem
 * - timeMax: exclusive upper bound — 00:00:00 on the day AFTER the forward
 *   endpoint.  The Google Calendar `timeMax` parameter is exclusive, so using
 *   the start of the following day guarantees every event on the final day is
 *   included.
 *
 * Exported for unit testing.
 *
 * @param pastRange    - How far into the past to reach
 * @param now          - Injection point for testing (defaults to new Date())
 * @param forwardMonths - How many months forward from today (default: 6)
 */
export function buildDateRange(
  pastRange: PastRange,
  now: Date = new Date(),
  forwardMonths = 6
): { timeMin: string; timeMax: string } {
  const { year, month0, day } = getJerusalemToday(now);
  const offsetMinutes = getJerusalemOffsetMinutes(now);

  // Start: depends on pastRange. JS Date handles month underflow (e.g. Jan-1 → Dec).
  let startYear = year;
  let startMonth0 = month0;
  let startDay = day;

  if (pastRange === 'one_month') {
    const d = new Date(year, month0 - 1, day);
    startYear = d.getFullYear();
    startMonth0 = d.getMonth();
    startDay = d.getDate();
  } else if (pastRange === 'two_months') {
    const d = new Date(year, month0 - 2, day);
    startYear = d.getFullYear();
    startMonth0 = d.getMonth();
    startDay = d.getDate();
  }

  // End: one day after the forward endpoint so the full final day is included.
  // JS handles day overflow (e.g. Dec 31 + 1 → Jan 1 next year).
  const endNextDay = new Date(year, month0 + forwardMonths, day + 1);
  const endYear = endNextDay.getFullYear();
  const endMonth0 = endNextDay.getMonth();
  const endDay = endNextDay.getDate();

  return {
    timeMin: toRFC3339(
      startYear,
      startMonth0,
      startDay,
      0,
      0,
      0,
      offsetMinutes
    ),
    timeMax: toRFC3339(endYear, endMonth0, endDay, 0, 0, 0, offsetMinutes),
  };
}

// ── Event extraction helpers ──────────────────────────────────────────────────

/** Extract the normalised start string used for sorting and dedup. */
function extractStartNormalized(event: RawEvent): string {
  const s = event.start as RawEventDateTime | undefined;
  if (!s) return '';
  if (typeof s.dateTime === 'string' && s.dateTime) return s.dateTime;
  if (typeof s.date === 'string' && s.date) return s.date;
  return '';
}

/** Extract the normalised end string if available. */
function extractEndNormalized(event: RawEvent): string | null {
  const e = event.end as RawEventDateTime | undefined;
  if (!e) return null;
  if (typeof e.dateTime === 'string' && e.dateTime) return e.dateTime;
  if (typeof e.date === 'string' && e.date) return e.date;
  return null;
}

/**
 * Detect whether an event is an all-day event.
 * All-day events have start.date but NOT start.dateTime.
 */
function detectAllDay(event: RawEvent): boolean {
  const s = event.start as RawEventDateTime | undefined;
  if (!s) return false;
  return typeof s.date === 'string' && !!s.date && !s.dateTime;
}

/**
 * Compute a stable deduplication key.
 * Primary: iCalUID + normalised start (catches recurring-instance cross-calendar dupes).
 * Fallback: calendarId + eventId + normalised start (opaque, no PII, just IDs).
 */
function computeDedupKey(event: RawEvent, calendarId: string): string {
  const iCalUID =
    typeof event.iCalUID === 'string' && event.iCalUID
      ? event.iCalUID.trim()
      : '';
  const start = extractStartNormalized(event);
  if (iCalUID) return `i:${iCalUID}::${start}`;
  const eventId = typeof event.id === 'string' ? event.id : '';
  return `g:${calendarId}::${eventId}::${start}`;
}

/** Extract a display-safe title, substituting the unnamed fallback when empty. */
function extractTitle(event: RawEvent): string {
  const summary = typeof event.summary === 'string' ? event.summary.trim() : '';
  return summary || UNNAMED_EVENT;
}

// ── Meeting-link extraction ───────────────────────────────────────────────────
//
// Populates InYomi's existing canonical event fields (`location`, `onlineUrl`)
// from a Google Calendar event. Provider-neutral: does not introduce
// per-provider fields. See extractLocationAndMeetingLink() for the
// deterministic priority order.

/** Known meeting-provider hostnames (exact match or subdomain thereof). */
const SUPPORTED_MEETING_DOMAINS = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
] as const;

function isSupportedMeetingHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return SUPPORTED_MEETING_DOMAINS.some(
    (domain) => h === domain || h.endsWith(`.${domain}`)
  );
}

/** Parse a candidate string as an http(s) URL; returns null if invalid. */
function parseHttpUrl(candidate: string): URL | null {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Matches http(s) URLs embedded in free text (stops at whitespace/brackets/quotes). */
const EMBEDDED_URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Find the first http(s) URL in free text whose hostname matches a known
 * meeting provider. Returns null if none found or the text is empty.
 * Deterministic: always returns the first match in left-to-right order.
 */
function findFirstSupportedMeetingUrl(text: string | undefined): string | null {
  if (!text) return null;
  const matches = text.match(EMBEDDED_URL_RE);
  if (!matches) return null;
  for (const raw of matches) {
    // Strip trailing punctuation commonly attached when a URL is embedded in
    // prose (e.g. "...at https://meet.google.com/abc-defg-hij.").
    const cleaned = raw.replace(/[),.;:!?'"<>\]]+$/, '');
    const parsed = parseHttpUrl(cleaned);
    if (parsed && isSupportedMeetingHostname(parsed.hostname)) return cleaned;
  }
  return null;
}

/**
 * Extract the video entry point URI from Google `conferenceData.entryPoints`.
 * Only `entryPointType === 'video'` is considered — phone/SIP/more entry
 * points are deliberately ignored. If multiple video entry points exist,
 * the first one is chosen deterministically.
 */
function extractConferenceVideoUrl(conferenceData: unknown): string | null {
  if (!conferenceData || typeof conferenceData !== 'object') return null;
  const entryPoints = (conferenceData as RawConferenceData).entryPoints;
  if (!Array.isArray(entryPoints)) return null;
  for (const entry of entryPoints) {
    if (!entry || typeof entry !== 'object') continue;
    const { entryPointType, uri } = entry as RawConferenceEntryPoint;
    if (entryPointType !== 'video') continue;
    if (typeof uri !== 'string' || !uri) continue;
    if (parseHttpUrl(uri)) return uri;
  }
  return null;
}

/** Extract and validate the classic `hangoutLink` field (legacy Meet events). */
function extractHangoutLink(hangoutLink: unknown): string | null {
  if (typeof hangoutLink !== 'string' || !hangoutLink) return null;
  return parseHttpUrl(hangoutLink) ? hangoutLink : null;
}

/**
 * Split a Google `location` string into cleaned physical-location text and an
 * optional supported meeting URL found within it. If the meeting URL was the
 * entire location value, the returned location is undefined.
 */
function splitLocationText(rawLocation: unknown): {
  cleanedLocation: string | undefined;
  meetingUrl: string | null;
} {
  const location = typeof rawLocation === 'string' ? rawLocation.trim() : '';
  if (!location) return { cleanedLocation: undefined, meetingUrl: null };

  const meetingUrl = findFirstSupportedMeetingUrl(location);
  if (!meetingUrl) return { cleanedLocation: location, meetingUrl: null };

  const withoutUrl = location.split(meetingUrl).join(' ');
  const cleaned = withoutUrl
    .replace(/^[\s,|\-–—]+/, '')
    .replace(/[\s,|\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { cleanedLocation: cleaned || undefined, meetingUrl };
}

/**
 * Deterministically derive InYomi's canonical `location` and `onlineUrl`
 * fields from a Google Calendar event's raw fields.
 *
 * Priority for `onlineUrl` (first match wins):
 *   1. `conferenceData.entryPoints` — entry with entryPointType === 'video'.
 *   2. `hangoutLink` (legacy classic Google Meet field).
 *   3. A supported meeting URL (Meet/Zoom/Teams) embedded in `location`.
 *   4. A supported meeting URL embedded in `description`.
 *
 * `location` always reflects the physical-location text with any embedded
 * meeting URL removed, regardless of which source ultimately won the
 * `onlineUrl` priority above — so the address never doubles as a raw URL.
 *
 * Never mutates the original description; only inspects it in-memory.
 */
export function extractLocationAndMeetingLink(event: RawEvent): {
  location: string | undefined;
  onlineUrl: string | undefined;
} {
  const { cleanedLocation, meetingUrl: locationMeetingUrl } = splitLocationText(
    event.location
  );

  const conferenceUrl = extractConferenceVideoUrl(event.conferenceData);
  const hangoutUrl = conferenceUrl
    ? null
    : extractHangoutLink(event.hangoutLink);
  const descriptionUrl =
    conferenceUrl || hangoutUrl || locationMeetingUrl
      ? null
      : findFirstSupportedMeetingUrl(
          typeof event.description === 'string' ? event.description : undefined
        );

  const onlineUrl =
    conferenceUrl ??
    hangoutUrl ??
    locationMeetingUrl ??
    descriptionUrl ??
    undefined;

  return { location: cleanedLocation, onlineUrl };
}

// ── Local ID generator ────────────────────────────────────────────────────────

let _localIdSeq = 0;

/**
 * Generate a stable client-side key for a normalized event row.
 * Not persisted, not sent to Convex, and not used for deduplication.
 */
function makeLocalId(): string {
  return `ev-${Date.now()}-${++_localIdSeq}`;
}

// ── Google Events API URL builder ─────────────────────────────────────────────

function buildEventsUrl(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  pageToken?: string
): string {
  const url = new URL(
    `${EVENTS_API_BASE}/${encodeURIComponent(calendarId)}/events`
  );
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('showDeleted', 'false');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('maxResults', String(MAX_RESULTS_PER_PAGE));
  if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
  return url.toString();
}

// ── Single-calendar fetch (all pages) ─────────────────────────────────────────

/**
 * Fetch and page through all events for one calendar.
 * Expands recurring events (singleEvents=true), filters cancelled events,
 * and returns a flat array of minimal event objects.
 *
 * Never logs token, calendar ID, event titles, or response bodies.
 */
async function fetchSingleCalendar(
  calendarId: string,
  accessToken: string,
  timeMin: string,
  timeMax: string,
  signal: AbortSignal
): Promise<SingleCalendarOutcome> {
  const events: MinimalEvent[] = [];
  let pageToken: string | undefined;

  try {
    do {
      let response: Response;
      try {
        response = await fetch(
          buildEventsUrl(calendarId, timeMin, timeMax, pageToken),
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal,
          }
        );
      } catch {
        if (signal.aborted) return { kind: 'network_error' };
        return { kind: 'network_error' };
      }

      if (signal.aborted) return { kind: 'network_error' };

      if (response.status === 401 || response.status === 403) {
        return { kind: 'auth_error' };
      }

      if (!response.ok) {
        return { kind: 'api_error' };
      }

      let page: RawEventsPage;
      try {
        page = (await response.json()) as RawEventsPage;
      } catch {
        if (signal.aborted) return { kind: 'network_error' };
        return { kind: 'api_error' };
      }

      if (signal.aborted) return { kind: 'network_error' };

      for (const event of page.items ?? []) {
        // Defensively filter cancelled events (singleEvents=true + showDeleted=false
        // should already exclude most, but the spec requires this belt-and-braces check).
        if (event.status === 'cancelled') continue;

        const startNormalized = extractStartNormalized(event);
        if (!startNormalized) continue;

        const { location, onlineUrl } = extractLocationAndMeetingLink(event);

        events.push({
          dedupKey: computeDedupKey(event, calendarId),
          title: extractTitle(event),
          startNormalized,
          endNormalized: extractEndNormalized(event),
          isAllDay: detectAllDay(event),
          location,
          onlineUrl,
        });
      }

      pageToken =
        typeof page.nextPageToken === 'string' && page.nextPageToken
          ? page.nextPageToken
          : undefined;
    } while (pageToken !== undefined && !signal.aborted);

    if (signal.aborted) return { kind: 'network_error' };
    return { kind: 'ok', events };
  } catch {
    if (signal.aborted) return { kind: 'network_error' };
    return { kind: 'api_error' };
  }
}

// ── Bounded-concurrency runner ─────────────────────────────────────────────────

/**
 * Run an array of async tasks with at most `maxConcurrency` running at once.
 * Preserves result order. A task error propagates to the caller.
 */
async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length) as T[];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const slots = Math.min(maxConcurrency, tasks.length);
  await Promise.all(Array.from({ length: slots }, () => worker()));
  return results;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Fetch events for all selected calendars, deduplicate, count, and return
 * a preview of up to three chronologically earliest titles plus the full
 * normalized event list for the import flow.
 *
 * Uses bounded concurrency (MAX_CONCURRENCY = 3) so the UI remains stable
 * with many selected calendars.
 *
 * Memory: the returned EventPreviewResult is the only data the caller should
 * retain. All intermediate MinimalEvent arrays are GC'd after return. The
 * full NormalizedEvent[] is retained only for the active flow; the caller
 * must call clear() on navigation-away or app restart.
 *
 * @param accessToken  - In-memory Google access token (never logged).
 * @param calendars    - Selected calendars with id + display title.
 * @param timeMin      - RFC3339 start of range (inclusive).
 * @param timeMax      - RFC3339 end of range (inclusive).
 * @param signal       - AbortSignal to cancel in-flight requests.
 */
export async function fetchCalendarPreview(
  accessToken: string,
  calendars: readonly CalendarTarget[],
  timeMin: string,
  timeMax: string,
  signal: AbortSignal
): Promise<EventPreviewResult> {
  if (calendars.length === 0) return { kind: 'empty' };

  const tasks = calendars.map(
    (cal) => () =>
      fetchSingleCalendar(cal.id, accessToken, timeMin, timeMax, signal).then(
        (outcome): { cal: CalendarTarget; outcome: SingleCalendarOutcome } => ({
          cal,
          outcome,
        })
      )
  );

  let outcomes: Array<{ cal: CalendarTarget; outcome: SingleCalendarOutcome }>;
  try {
    outcomes = await runWithConcurrency(tasks, MAX_CONCURRENCY);
  } catch {
    return { kind: 'network_error' };
  }

  if (signal.aborted) return { kind: 'network_error' };

  // Auth error takes priority: if any calendar returned 401/403 the token is
  // invalid for the whole session.
  const hasAuthError = outcomes.some((r) => r.outcome.kind === 'auth_error');
  if (hasAuthError) return { kind: 'auth_error' };

  // Collect failures (network or API errors).
  const failures = outcomes.filter((r) => r.outcome.kind !== 'ok');

  if (failures.length > 0) {
    const hasSuccesses = failures.length < outcomes.length;

    if (hasSuccesses) {
      return {
        kind: 'partial_failure',
        failedCalendarTitles: failures.map((f) => f.cal.title),
      };
    }

    const allNetworkErrors = failures.every(
      (r) => r.outcome.kind === 'network_error'
    );
    if (allNetworkErrors) return { kind: 'network_error' };

    return {
      kind: 'partial_failure',
      failedCalendarTitles: failures.map((f) => f.cal.title),
    };
  }

  // All calendars succeeded. Merge, deduplicate, count, sort, preview.
  const seen = new Set<string>();
  let count = 0;
  const pool: MinimalEvent[] = [];

  for (const { outcome } of outcomes) {
    if (outcome.kind !== 'ok') continue;
    for (const ev of outcome.events) {
      if (seen.has(ev.dedupKey)) continue;
      seen.add(ev.dedupKey);
      count++;
      pool.push(ev);
    }
  }

  if (count === 0) return { kind: 'empty' };

  // Sort chronologically. ISO date strings and RFC3339 strings sort correctly
  // lexicographically: "YYYY-MM-DD" < "YYYY-MM-DDTHH:..." for the same day
  // (all-day events naturally precede timed events on the same day).
  pool.sort((a, b) => a.startNormalized.localeCompare(b.startNormalized));

  const previewTitles = pool.slice(0, PREVIEW_LIMIT).map((p) => p.title);

  // Build the full normalized event list (in-memory, flow lifetime only).
  const events: NormalizedEvent[] = pool.map((p) => ({
    localId: makeLocalId(),
    title: p.title,
    startIso: p.startNormalized,
    endIso: p.endNormalized,
    isAllDay: p.isAllDay,
    location: p.location,
    onlineUrl: p.onlineUrl,
  }));

  return { kind: 'success', count, previewTitles, events };
}
