// FIXED: added EventAttachmentDraft type and attachments field to EventData
import type { Id } from '@/convex/_generated/dataModel';

// ─── Attachments ──────────────────────────────────────────────────────────────

/**
 * Frontend attachment draft.
 * - New file (selected, not yet uploaded): localUri set, storageId undefined
 * - Saved file (already on server): storageId set, localUri undefined
 * localUri is never sent to Convex.
 */
export interface EventAttachmentDraft {
  /** Set after upload. Undefined for newly selected files. */
  storageId?: Id<'_storage'>;
  originalName: string;
  /** Editable by the user before save. */
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  /** Frontend draft only — never persisted to Convex. */
  localUri?: string;
}

export interface Participant {
  id: string;
  /** Display name used throughout the app. For contact-sourced participants this
   *  is populated from localDisplayName at creation time. */
  name: string;
  email?: string;
  /** Stable identifier — normalised phone number from device contacts. */
  phone?: string;
  /** The device contact's name as seen by the creator. Kept separate so it
   *  is never confused with a future server-resolved shared display name. */
  localDisplayName?: string;
  // TODO: for shared event view, resolve sharedDisplayName via user lookup by phone before rendering to non-creator participants
  avatarUrl?: string;
  color: string;
}

export interface EventTask {
  id: string;
  title: string;
  completed: boolean;
  /** @deprecated single-assignee; prefer assignedParticipantIds */
  assigneeId?: string;
  /** @deprecated resolved object; prefer assignedParticipantIds */
  assignee?: Participant;
  /** IDs of Participant objects assigned to this task (multi-select) */
  assignedParticipantIds?: string[];
  dueDate?: number;
  colorDot?: string;
}

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

// ─── Reminders ────────────────────────────────────────────────────────────────

/** @deprecated kept for backward-compat reading; write path now uses Reminder[] */
export type ReminderType =
  | 'hour_before'
  | 'morning_same_day'
  | 'day_before_evening';

export type ReminderPreset = 'at_event' | 'hour_before' | 'day_before' | 'custom';
export type ReminderUnit = 'minutes' | 'hours' | 'days';

export interface Reminder {
  preset: ReminderPreset;
  /**
   * Exact offset in minutes before event start.
   * For all-day events this is interpreted relative to 09:00 local time on
   * the event day (e.g. hour_before = 08:00, day_before = 09:00 previous day).
   * The server/notification layer should use this field directly.
   */
  offsetMinutes: number;
  /** Numeric value entered by user — only when preset === 'custom' */
  customValue?: number;
  /** Time unit chosen by user — only when preset === 'custom' */
  customUnit?: ReminderUnit;
}

const REMINDER_DEFAULTS: Record<ReminderPreset, Omit<Reminder, 'preset'>> = {
  at_event:    { offsetMinutes: 0 },
  hour_before: { offsetMinutes: 60 },
  day_before:  { offsetMinutes: 1440 },
  custom:      { offsetMinutes: 30, customValue: 30, customUnit: 'minutes' },
};

/** Build a Reminder with the correct default offsetMinutes for a given preset. */
export function makeReminder(preset: ReminderPreset): Reminder {
  return { preset, ...REMINDER_DEFAULTS[preset] };
}

// ─── EventData ────────────────────────────────────────────────────────────────

export interface EventData {
  id?: string;
  title: string;
  date: number;         // start date as midnight Unix ms
  startTime?: string;   // "HH:MM"
  endDate?: number;     // end date as midnight Unix ms (cross-midnight safe)
  endTime?: string;     // "HH:MM"
  isAllDay: boolean;
  recurrence: RecurrenceType;
  location?: string;    // physical address → events.location
  onlineUrl?: string;   // meeting link → events.onlineUrl
  locationCoords?: { lat: number; lng: number };
  notes?: string;
  remindersEnabled: boolean;
  reminders: Reminder[];
  participants: Participant[];
  tasks: EventTask[];
  showAllTasksToAll: boolean;
  createdAt: number;
  // FIXED: added family sharing fields to EventData
  allFamily?: boolean;
  sharedWithFamilyMemberIds?: string[];
  // FIXED: file attachments (max 2, frontend draft — localUri stripped before saving)
  attachments?: EventAttachmentDraft[];
}
