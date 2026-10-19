import type { LocationSource } from './eventLocation';
/**
 * Pure "שכפל אירוע" (Part D) template-building helpers for community events.
 * Extracted out of app/(authenticated)/event/new.tsx so the actual
 * field-copy/field-drop rules can be unit tested without mounting the
 * screen, Convex queries, or EventScreen — same precedent as
 * lib/resolveActiveCommunityContext.ts / lib/eventsTabDateHelpers.ts.
 *
 * CRITICAL SAFETY RULES enforced here (do not relax without re-reading the
 * Stage 3 correction spec, Part D):
 *   - The original calendar DATE is NEVER reused — the caller always passes
 *     a freshly chosen `todayMidnight`, and only the ORIGINAL time-of-day +
 *     duration are reapplied on top of it (Part D5).
 *   - No participant/viewer state is ever read here — RSVP responses,
 *     saved-calendar rows, opt-outs, attendee lists (Part D6).
 *   - Duplicated tasks are always unassigned + incomplete (Part D7).
 *   - `reminders` on the source event are stored as RELATIVE
 *     offset-minutes-before-start (see convex/schema.ts), never an absolute
 *     timestamp, so copying them verbatim is safe (Part D9) — the
 *     notification layer recomputes the actual fire time from the NEW
 *     event's startTime.
 *   - "חשוב לזכור" items contain no absolute date/time field at all (see
 *     convex/schema.ts's `importantItems: { id, title }`), so they are
 *     copied as-is with freshly generated client-side ids (Part D8).
 */

export type DuplicateSourceEvent = {
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  allDay?: boolean;
  location?: string;
  onlineUrl?: string;
  locationUrl?: string;
  locationSource?: LocationSource;
  googlePlaceId?: string;
  requiresRsvp?: boolean;
  tasksVisibleToParticipants?: boolean;
  importantItems?: { id: string; title: string }[];
  reminders?: number[];
};

export type DuplicateSourceTask = {
  title: string;
};

export type DuplicateReminder = {
  preset: 'at_event' | 'hour_before' | 'day_before' | 'custom';
  offsetMinutes: number;
  customValue?: number;
  customUnit?: 'minutes' | 'hours' | 'days';
};

export type DuplicateImportantItem = { id: string; title: string };

export type DuplicateTask = {
  id: string;
  title: string;
  completed: boolean;
};

export type DuplicateEventTemplate = {
  title: string;
  date: number;
  startTime: string | undefined;
  endDate: number | undefined;
  endTime: string | undefined;
  isAllDay: boolean;
  location: string | undefined;
  onlineUrl: string | undefined;
  locationUrl: string | undefined;
  locationSource?: LocationSource;
  googlePlaceId?: string;
  notes: string | undefined;
  remindersEnabled: boolean;
  reminders: DuplicateReminder[];
  tasks: DuplicateTask[];
  importantItems: DuplicateImportantItem[];
  tasksVisibleToParticipants: boolean;
  requiresRsvp: boolean;
  participants: unknown[];
  attachments: unknown[];
};

/**
 * Stage 3 correction — Part 1: pure predicate for the duplicate-mode "new
 * date" confirmation gate. Extracted so the exact rule EventScreen's
 * `handleSave` enforces (block save while `requireDateConfirmation` is true
 * and the manager has not yet interacted with the date picker) can be unit
 * tested without mounting the screen. `requireDateConfirmation` must ONLY be
 * true for the community-event-duplication flow — never for ordinary
 * create/edit.
 */
export function isDuplicateSaveBlockedByUnconfirmedDate(
  requireDateConfirmation: boolean,
  dateConfirmed: boolean
): boolean {
  return requireDateConfirmation && !dateConfirmed;
}

/** Part D9 — converts RELATIVE offset-minutes into the form's Reminder shape. */
export function offsetsToDuplicateReminders(
  offsets: number[] | undefined
): DuplicateReminder[] {
  if (!offsets || offsets.length === 0) {
    return [{ preset: 'hour_before', offsetMinutes: 60 }];
  }
  return offsets.map((offsetMinutes) => {
    if (offsetMinutes === 0) return { preset: 'at_event', offsetMinutes };
    if (offsetMinutes === 60) return { preset: 'hour_before', offsetMinutes };
    if (offsetMinutes === 1440) return { preset: 'day_before', offsetMinutes };
    return {
      preset: 'custom',
      offsetMinutes,
      customValue: offsetMinutes,
      customUnit: 'minutes',
    };
  });
}

let duplicateIdCounter = 0;
/** Deterministic-enough, collision-free within a single duplication pass. */
function createDuplicateId(): string {
  duplicateIdCounter += 1;
  return `dup-${Date.now()}-${duplicateIdCounter}`;
}

/**
 * Apply a duration (minutes) to a start date+time, handling cross-midnight —
 * duplicated here in pure form (mirrors
 * lib/components/event/DateTimeCard.tsx's `applyDuration`) so this module
 * has no dependency on a React component file.
 */
function applyDurationPure(
  startDateMs: number,
  startTime: string,
  durationMinutes: number
): { endDate: number; endTime: string } {
  const [h, m] = startTime.split(':').map(Number);
  const start = new Date(startDateMs);
  start.setHours(h ?? 0, m ?? 0, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    endDate: new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate()
    ).getTime(),
    endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

/**
 * Part D3–D9 — builds the pre-filled duplication template from a source
 * event + its task definitions. `todayMidnight` MUST be a freshly computed
 * "new date" (e.g. today) — see the module doc above; it is never the
 * source event's own start date.
 */
export function buildDuplicateEventTemplate(
  source: DuplicateSourceEvent,
  tasks: DuplicateSourceTask[],
  todayMidnight: number
): DuplicateEventTemplate {
  const start = new Date(source.startTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  const startTimeStr = source.allDay
    ? undefined
    : `${pad(start.getHours())}:${pad(start.getMinutes())}`;

  const durationMinutes = Math.max(
    0,
    Math.round((source.endTime - source.startTime) / 60_000)
  );

  let endDate: number | undefined;
  let endTime: string | undefined;
  if (!source.allDay && startTimeStr) {
    const applied = applyDurationPure(
      todayMidnight,
      startTimeStr,
      durationMinutes
    );
    endDate = applied.endDate;
    endTime = applied.endTime;
  }

  const remindersEnabled = Boolean(
    source.reminders && source.reminders.length > 0
  );

  // Part D7 — fresh, unassigned, incomplete tasks. Never copy assignee,
  // completion state, or activity history.
  const duplicatedTasks: DuplicateTask[] = tasks
    .filter((t) => t.title.trim().length > 0)
    .map((t) => ({
      id: createDuplicateId(),
      title: t.title,
      completed: false,
    }));

  // Part D8 — safe to copy as-is: no absolute date/time field exists on
  // importantItems.
  const duplicatedImportantItems: DuplicateImportantItem[] = (
    source.importantItems ?? []
  ).map((item) => ({
    id: createDuplicateId(),
    title: item.title,
  }));

  return {
    title: source.title,
    date: todayMidnight,
    startTime: startTimeStr,
    endDate,
    endTime,
    isAllDay: source.allDay ?? false,
    location: source.location,
    onlineUrl: source.onlineUrl,
    locationUrl: undefined,
    locationSource: source.locationSource,
    googlePlaceId:
      source.locationSource === 'google' ? source.googlePlaceId : undefined,
    notes: source.description,
    remindersEnabled,
    reminders: offsetsToDuplicateReminders(
      remindersEnabled ? source.reminders : undefined
    ),
    tasks: duplicatedTasks,
    importantItems: duplicatedImportantItems,
    tasksVisibleToParticipants: source.tasksVisibleToParticipants ?? false,
    requiresRsvp: source.requiresRsvp === true,
    // Part D6 — never copy participant/viewer state. This payload's input
    // type (DuplicateSourceEvent) does not even expose RSVP/save/opt-out
    // fields, so there is nothing to accidentally read here.
    participants: [],
    attachments: [],
  };
}
