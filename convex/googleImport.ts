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
 * Parse an ISO date string to UTC milliseconds.
 * "YYYY-MM-DD" → midnight UTC.
 * RFC3339 strings include timezone offset and parse directly.
 */
function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Derive a sensible end-time when the client did not supply one.
 * All-day: one full day after start.
 * Timed: one hour after start.
 */
function deriveEndMs(startMs: number, isAllDay: boolean): number {
  return isAllDay ? startMs + 86_400_000 : startMs + 3_600_000;
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
    const startMs = isoToMs(ev.startIso);
    const endMs = ev.endIso ? isoToMs(ev.endIso) : deriveEndMs(startMs, ev.isAllDay);

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
    if (!spaceId) throw new Error('לא נמצא יומן אישי. אנא השלימי את ההגדרה תחילה.');

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
