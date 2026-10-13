/**
 * useGoogleCalendarList — Google Calendar List API retrieval hook.
 *
 * Accepts the in-memory access token exposed by useGoogleCalendarAuth.
 * Pages through the Google Calendar List API and surfaces the user's
 * accessible, visible calendars. Scoped to the calendar list only:
 * it never fetches events, calls Convex, or persists any data.
 *
 * API reference:
 *   GET https://www.googleapis.com/calendar/v3/users/me/calendarList
 *   Required scope: calendar.readonly (already held by the caller).
 *   Pagination: repeat with pageToken until nextPageToken is absent.
 *
 * Security contract:
 * - accessToken is accepted as a function argument and sent exclusively
 *   in the Authorization: Bearer request header. It is never embedded in
 *   URL query parameters, logged, stored outside React state, or forwarded
 *   to any persistence layer.
 * - Calendar IDs are retained only as opaque, in-memory identifiers.
 *   They are never rendered, logged, persisted, or parsed for identity.
 * - Only the minimal set of fields is extracted from the API response
 *   (id, summaryOverride, summary, primary). The full response objects
 *   are discarded immediately after extraction.
 * - Catch handlers never forward raw error messages, HTTP status codes,
 *   response bodies, or Google details to state, logs, or error services.
 * - HTTP 401 and 403 produce only the same generic Hebrew error string
 *   as any other failure — no auth details leak to the UI.
 * - AbortController ensures stale responses never overwrite newer state
 *   after a token change, a reload request, or component unmount.
 * - All state is GC'd with the component; nothing outlives React state.
 *
 * State machine:
 *   idle     – token is null or hook has not yet been triggered
 *   loading  – a calendar list fetch is in flight (initial or reload)
 *   ready    – fetch succeeded; at least one calendar was returned
 *   empty    – fetch succeeded but no accessible calendars were returned
 *   error    – network failure, non-2xx HTTP status, or JSON parse error
 *   Any state → idle (via clear() or token becoming null)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isGoogleHolidayCalendarId } from '../services/googleHolidayCalendarFilter';

// ── Public types ──────────────────────────────────────────────────────────────

export type CalendarListStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

export type CalendarItem = {
  /**
   * Opaque in-memory identifier used to call the Calendar Events API in
   * later phases. Must never be rendered, logged, or persisted.
   */
  id: string;
  /** Display title from summaryOverride ?? summary ?? UNNAMED_TITLE. */
  title: string;
  /** True when Google marks this as the user's primary calendar. */
  isPrimary: boolean;
};

export type UseGoogleCalendarListResult = {
  status: CalendarListStatus;
  /**
   * Mapped calendar entries; empty array in all non-ready states.
   * Google's own holiday calendars are never included here — InYomi is the
   * holiday source of truth (see googleHolidayCalendarFilter.ts).
   */
  calendars: readonly CalendarItem[];
  /**
   * Count of Google holiday calendars that were excluded from `calendars`
   * on the most recent successful fetch. 0 in all non-ready states.
   */
  filteredHolidayCount: number;
  /** Localised Hebrew error message; null unless status is 'error'. */
  errorMessage: string | null;
  /**
   * Re-fetch the calendar list with the current token.
   * Aborts any in-flight request. Does not reset the caller's selection state.
   */
  reload: () => Promise<void>;
  /** Reset to idle and discard all in-memory calendar data. */
  clear: () => void;
};

// ── Internal API shape ────────────────────────────────────────────────────────
// Minimal types matching the subset of the Calendar List API response that
// this hook consumes. Never exported, logged, or stored beyond the parse step.

type RawCalendarEntry = {
  id?: unknown;
  summary?: unknown;
  summaryOverride?: unknown;
  primary?: unknown;
};

type RawCalendarListPage = {
  items?: RawCalendarEntry[];
  nextPageToken?: unknown;
};

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Google Calendar List endpoint.
 * https://developers.google.com/calendar/api/v3/reference/calendarList/list
 */
const CALENDAR_LIST_URL =
  'https://www.googleapis.com/calendar/v3/users/me/calendarList';

/** Fallback display title when no summary field is available. */
const UNNAMED_TITLE = 'יומן ללא שם';

/** Generic Hebrew error shown for any fetch failure; intentionally opaque. */
const LOAD_ERROR_MSG = 'לא ניתן לטעון את היומנים. אפשר לנסות שוב.';

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches the authenticated user's calendar list using the supplied
 * in-memory access token. Automatically re-fetches when the token changes
 * and resets to idle when the token becomes null.
 *
 * Call reload() to re-fetch without clearing the caller's selection state.
 * Call clear() (or pass null as accessToken) to discard all data and
 * return to idle.
 */
export function useGoogleCalendarList(
  accessToken: string | null
): UseGoogleCalendarListResult {
  const [status, setStatus] = useState<CalendarListStatus>('idle');
  const [calendars, setCalendars] = useState<readonly CalendarItem[]>([]);
  const [filteredHolidayCount, setFilteredHolidayCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guard: prevent state updates on an unmounted component.
  const isMounted = useRef(true);
  // Tracks the current AbortController so any in-flight fetch can be cancelled.
  const controllerRef = useRef<AbortController | null>(null);

  // Lifecycle guard: mark unmounted and cancel any in-flight fetch.
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const clear = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (isMounted.current) {
      setStatus('idle');
      setCalendars([]);
      setFilteredHolidayCount(0);
      setErrorMessage(null);
    }
  }, []);

  /**
   * Core fetch routine. Aborts any previously in-flight request, then pages
   * through the Calendar List API until all pages are collected or an error
   * occurs. Token is sent only in the Authorization header.
   */
  const runFetch = useCallback(async (token: string): Promise<void> => {
    // Abort any prior in-flight fetch before starting a new one.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;

    if (isMounted.current) {
      setStatus('loading');
      setCalendars([]);
      setFilteredHolidayCount(0);
      setErrorMessage(null);
    }

    const collected: CalendarItem[] = [];
    let holidayCount = 0;
    let pageToken: string | undefined;

    try {
      do {
        // Build URL with pagination token if present.
        // The access token is never placed in the URL.
        const url = new URL(CALENDAR_LIST_URL);
        url.searchParams.set('maxResults', '250');
        if (pageToken !== undefined) {
          url.searchParams.set('pageToken', pageToken);
        }

        let response: Response;
        try {
          response = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          });
        } catch {
          // Covers AbortError and network failures.
          if (signal.aborted) return;
          if (isMounted.current) {
            setStatus('error');
            setErrorMessage(LOAD_ERROR_MSG);
          }
          return;
        }

        if (signal.aborted) return;

        // 401 / 403: token expired or insufficient scope.
        // Show only the generic message — do not surface auth details.
        if (response.status === 401 || response.status === 403) {
          if (isMounted.current) {
            setStatus('error');
            setErrorMessage(LOAD_ERROR_MSG);
          }
          return;
        }

        if (!response.ok) {
          if (isMounted.current) {
            setStatus('error');
            setErrorMessage(LOAD_ERROR_MSG);
          }
          return;
        }

        let page: RawCalendarListPage;
        try {
          page = (await response.json()) as RawCalendarListPage;
        } catch {
          if (signal.aborted) return;
          if (isMounted.current) {
            setStatus('error');
            setErrorMessage(LOAD_ERROR_MSG);
          }
          return;
        }

        if (signal.aborted) return;

        // Extract only the minimal fields; discard the rest of the response.
        for (const entry of page.items ?? []) {
          // Skip entries with missing or non-string IDs.
          if (typeof entry.id !== 'string' || !entry.id) continue;

          // Google holiday calendars must never be importable — InYomi is the
          // holiday source of truth. Exclude them from the selectable list.
          if (isGoogleHolidayCalendarId(entry.id)) {
            holidayCount += 1;
            continue;
          }

          // Prefer summaryOverride (user-set label) over summary (calendar name).
          const override =
            typeof entry.summaryOverride === 'string'
              ? entry.summaryOverride.trim()
              : '';
          const summary =
            typeof entry.summary === 'string' ? entry.summary.trim() : '';
          const title = override || summary || UNNAMED_TITLE;

          collected.push({
            id: entry.id,
            title,
            isPrimary: entry.primary === true,
          });
        }

        // Advance to the next page if the API provided a token.
        pageToken =
          typeof page.nextPageToken === 'string' && page.nextPageToken
            ? page.nextPageToken
            : undefined;
      } while (pageToken !== undefined && !signal.aborted);

      if (signal.aborted) return;

      if (isMounted.current) {
        setCalendars(collected);
        setFilteredHolidayCount(holidayCount);
        setStatus(collected.length === 0 ? 'empty' : 'ready');
        setErrorMessage(null);
      }
    } catch {
      // Outer safety net for unexpected errors (URL construction, etc.).
      if (signal.aborted) return;
      if (isMounted.current) {
        setStatus('error');
        setErrorMessage(LOAD_ERROR_MSG);
      }
    }
  }, []);

  // React to token changes: clear on null, fetch on non-null.
  useEffect(() => {
    if (accessToken === null) {
      clear();
      return;
    }
    void runFetch(accessToken);
    // Abort the in-flight fetch if the token changes before it completes.
    return () => {
      controllerRef.current?.abort();
    };
  }, [accessToken, runFetch, clear]);

  const reload = useCallback(async (): Promise<void> => {
    if (accessToken === null) return;
    await runFetch(accessToken);
  }, [accessToken, runFetch]);

  return {
    status,
    calendars,
    filteredHolidayCount,
    errorMessage,
    reload,
    clear,
  };
}
