/**
 * googleImport — Convex mutations and queries for the one-time Google Calendar import.
 *
 * Security contract:
 * - Uses getAuthUserId(ctx) exclusively; never ctx.auth.getUserIdentity().
 * - No Google access token, authorization code, or raw API payload is accepted
 *   or stored. The client sends only the normalized event data it chose to import.
 * - The import lock (googleImportStatus) is the authoritative one-time gate.
 *   The backend rejects or safely returns an already-completed result even if
 *   the frontend UI is stale or the mutation is called concurrently.
 * - All event writes and the import status record are created in a single Convex
 *   mutation transaction. On any failure, neither partial events nor a status
 *   record are written.
 */

import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { resolveMySpaceId } from './members';
import { stampEventOwnerScope } from './ownerScope';
import { requireSpaceWriteAccess } from './spaceWriteAccess';

// ── hasCompletedGoogleImport ──────────────────────────────────────────────────

export const hasCompletedGoogleImport = query({
  args: {},
  returns: v.union(
    v.object({ completed: v.literal(false) }),
    v.object({
      completed: v.literal(true),
      importedCount: v.number(),
      completedAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const record = await ctx.db
      .query('googleImportStatus')
      .withIndex('by_user_provider', (q) =>
        q.eq('userId', userId).eq('provider', 'google')
      )
      .unique();

    if (!record) return { completed: false as const };

    return {
      completed: true as const,
      importedCount: record.importedCount,
      completedAt: record.completedAt,
    };
  },
});

// ── importGoogleCalendar ──────────────────────────────────────────────────────

/** Minimal normalized event as sent from the client. No tokens, no raw payloads. */
const importedEventArg = v.object({
  title: v.string(),
  /** "YYYY-MM-DD" for all-day, RFC3339 string for timed events. */
  startIso: v.string(),
  /** "YYYY-MM-DD" or RFC3339 end, or null when not available. */
  endIso: v.union(v.string(), v.null()),
  isAllDay: v.boolean(),
  /** Physical location text (any embedded meeting URL already stripped). */
  location: v.optional(v.string()),
  /** Canonical meeting-join URL (Meet/Zoom/Teams) — same field the manual
   * event editor's "קישור" tab writes to (events.onlineUrl). */
  onlineUrl: v.optional(v.string()),
});

/**
 * Compute the Asia/Jerusalem UTC offset (in minutes) for the given moment.
 * Mirrors the identical helper in lib/services/googleCalendarEvents.ts.
 * Duplicated here (rather than imported) because this is a small, self
 * contained calculation and convex/ functions do not share a runtime module
 * graph with the client-only lib/services bundle.
 */
function getJerusalemOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jerusalem',
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
  // Intl can return '24' for midnight in some environments.
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

/**
 * Resolve a calendar date to midnight in Jerusalem, independently of the
 * server timezone. dayOffset is calendar arithmetic, not elapsed hours.
 * MVP only: timestamps do not preserve all-day dates on devices in other zones.
 */
function allDayDateToMs(iso: string, dayOffset = 0): number {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  const wallMidnight = date.getTime();
  let candidate = wallMidnight;

  // Re-evaluate the IANA offset at the candidate instant, not at noon.
  // On DST transition days the first estimate can use the post-transition
  // offset; refining it resolves the offset that actually applies at midnight.
  for (let attempt = 0; attempt < 4; attempt++) {
    const resolved =
      wallMidnight - getJerusalemOffsetMinutes(new Date(candidate)) * 60_000;
    if (resolved === candidate) return resolved;
    candidate = resolved;
  }
  // Do not silently persist a shifted date if midnight cannot be resolved.
  throw new Error('לא ניתן לחשב את תאריך האירוע לייבוא.');
}

/** Timed RFC3339 timestamps retain their supplied offset unchanged. */
function isoToMs(iso: string, isAllDay: boolean): number {
  return isAllDay ? allDayDateToMs(iso) : new Date(iso).getTime();
}

/** Missing end: next calendar midnight for all-day, one hour for timed. */
function deriveEndMs(
  startIso: string,
  startMs: number,
  isAllDay: boolean
): number {
  return isAllDay ? allDayDateToMs(startIso, 1) : startMs + 3_600_000;
}

async function insertImportedEvents(
  ctx: MutationCtx,
  userId: Id<'users'>,
  spaceId: Id<'spaces'>,
  events: ReadonlyArray<{
    title: string;
    startIso: string;
    endIso: string | null;
    isAllDay: boolean;
    location?: string;
    onlineUrl?: string;
  }>,
  now: number
): Promise<void> {
  for (const ev of events) {
    const startMs = isoToMs(ev.startIso, ev.isAllDay);
    const endMs = ev.endIso
      ? isoToMs(ev.endIso, ev.isAllDay)
      : deriveEndMs(ev.startIso, startMs, ev.isAllDay);

    await ctx.db.insert('events', {
      title: ev.title,
      startTime: startMs,
      endTime: endMs,
      allDay: ev.isAllDay,
      // Same canonical fields the manual event create/edit "כתובת"/"קישור"
      // tabs read and write (LocationCard → EventData.location/onlineUrl).
      location: ev.location,
      onlineUrl: ev.onlineUrl,
      spaceId,
      createdBy: userId,
      createdAt: now,
      isAiGenerated: false,
      source: 'google_copy',
      // Stamped once at import — see convex/ownerScope.ts. A one-time
      // Google Calendar import is always owned solely by the importing
      // user (never shared/community at import time).
      ownerScope: stampEventOwnerScope({
        source: 'google_copy',
        createdBy: userId,
      }),
    });
  }
}

export const importGoogleCalendar = mutation({
  args: {
    events: v.array(importedEventArg),
  },
  returns: v.union(
    v.object({ success: v.literal(true), importedCount: v.number() }),
    v.object({ alreadyCompleted: v.literal(true), importedCount: v.number() })
  ),
  handler: async (ctx, { events }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    // ── One-time lock check ──────────────────────────────────────────────────
    // This is the authoritative server-side gate. A stale or concurrent client
    // cannot bypass this check. If already completed, return idempotently.
    const existing = await ctx.db
      .query('googleImportStatus')
      .withIndex('by_user_provider', (q) =>
        q.eq('userId', userId).eq('provider', 'google')
      )
      .unique();

    if (existing) {
      return {
        alreadyCompleted: true as const,
        importedCount: existing.importedCount,
      };
    }

    // ── Resolve the user's personal space ────────────────────────────────────
    const spaceId = await resolveMySpaceId(ctx, userId);
    if (!spaceId)
      throw new Error('לא נמצא יומן אישי. יש להשלים את ההגדרה תחילה.');
    // Resolution may return a legacy entity; it is not a write permission.
    await requireSpaceWriteAccess(ctx, userId, spaceId);

    const now = Date.now();

    // ── Insert events + status record atomically ─────────────────────────────
    // Convex mutations run as a single transaction: if any insert throws,
    // none of the writes (including the status record below) are committed.
    await insertImportedEvents(ctx, userId, spaceId, events, now);

    await ctx.db.insert('googleImportStatus', {
      userId,
      provider: 'google',
      completedAt: now,
      importedCount: events.length,
    });

    return { success: true as const, importedCount: events.length };
  },
});
