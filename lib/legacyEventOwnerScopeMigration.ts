// ============================================================================
// legacyEventOwnerScopeMigration.ts — pure planning/safety helpers for
// convex/backfills.ts `migrateApprovedLegacyEventOwnerScope` (DEV/INTERNAL
// ONE-TIME MIGRATION TOOL — NOT a general classifier change).
// ============================================================================
//
// Context: convex/ownerScope.ts's `classifyEventForBackfill` deliberately
// remains fail-closed for pre-sharing-fields-era legacy events — it cannot
// safely distinguish "originally personal" from "originally family" intent
// for every ambiguous row, and it must never guess. A manual, product-owner
// -reviewed audit confirmed exactly 10 specific legacy events (all created
// by one specific reviewed user) were, in fact, personal. This module is
// the smallest possible ONE-TIME correction path for EXACTLY those 10
// hardcoded event ids — it must never be reused as a general rule and must
// never be applied to any id outside this allowlist.
//
// Every function here is pure (no ctx.db access, no network, no wall-clock
// reads) so the safety-critical precondition/plan logic can be unit tested
// without a live Convex backend — same convention as lib/qaReset.ts.
// convex/backfills.ts performs the actual ctx.db reads/writes and calls
// into these helpers with already-fetched data.
//
// FAIL-CLOSED PHILOSOPHY (mirrors lib/qaReset.ts exactly):
//   - Each of the 10 target events is independently re-validated against
//     the reviewed legacy shape every time this runs — never trusted
//     because "it was reviewed once".
//   - If ANY of the 10 targets fails a precondition, the ENTIRE batch is
//     marked unsafe (`safeToExecute: false`) — there is no partial /
//     best-effort execution. A caller must never be able to stamp 9 out of
//     10 rows while the 10th silently fails.
//   - An event whose `ownerScope` is already `'personal'` is safe/idempotent
//     (already corrected, zero-op) — NOT a blocker.
//   - An event whose `ownerScope` is now `'family'` or `'community'` is
//     ALWAYS a blocker — this correction must never overwrite a scope that
//     something else (a newer classifier run, a live edit) has since set.
// ============================================================================

export const APPROVED_LEGACY_EVENT_IDS = [
  'k57e7ntxkh7ye09w2v72amr7f586n8z2',
  'k57e2dj2th768jcssg6f7ws12s88typh',
  'k57bth8p460ct7bmxw2zqthg7d88t7ty',
  'k57ch5s30qqf9e95ahmck4f4mh88vaab',
  'k57976jkx0chhyz4gxgrjhtved88vgq8',
  'k575epear4agdgvft17vsk208988tx9k',
  'k57btnbcmm4dfyx88fj9shrg7s88tgax',
  'k5711fm328zxbs35pbw2y2yrg588vgbf',
  'k5792z939b9n0mp4yemz3nxgx58e1j3p',
  'k57aefcjsrdv90p55x1degczzh8eq87p',
] as const;

export type ApprovedLegacyEventId = (typeof APPROVED_LEGACY_EVENT_IDS)[number];

/** Set form for O(1) allowlist membership checks. */
const APPROVED_ID_SET: ReadonlySet<string> = new Set(
  APPROVED_LEGACY_EVENT_IDS
);

export function isApprovedLegacyEventId(id: string): boolean {
  return APPROVED_ID_SET.has(id);
}

export type LegacyEventOwnerScope = 'personal' | 'family' | 'community';

/** Minimal shape this migration needs from an `events` row. */
export interface LegacyEventMigrationInput {
  _id: string;
  title: string;
  spaceId?: string;
  createdBy: string;
  communityId?: unknown;
  source?: 'manual' | 'google_copy' | 'device_copy';
  allFamily?: boolean;
  sharedWithFamilyMemberIds?: unknown[];
  sharedWithUserIds?: string[];
  ownerScope?: LegacyEventOwnerScope;
}

export interface LegacyEventMigrationItem {
  eventId: string;
  title: string;
  spaceId: string | undefined;
  currentOwnerScope: LegacyEventOwnerScope | undefined;
  expectedNewOwnerScope: 'personal';
  eligible: boolean;
  /** True when ownerScope is already 'personal' — a safe zero-op, not a blocker. */
  alreadyCorrected: boolean;
  reason?: string;
}

function blockedItem(
  eventId: string,
  reason: string,
  partial: Partial<LegacyEventMigrationItem> = {}
): LegacyEventMigrationItem {
  return {
    eventId,
    title: partial.title ?? '(unavailable)',
    spaceId: partial.spaceId,
    currentOwnerScope: partial.currentOwnerScope,
    expectedNewOwnerScope: 'personal',
    eligible: false,
    alreadyCorrected: false,
    reason,
  };
}

/**
 * Re-validates a single target event against the exact reviewed legacy
 * shape. `expectedEventId` is the hardcoded allowlist id the caller looked
 * this row up by — passed separately from `event._id` so a `null` (row no
 * longer exists) can still be reported against the correct id.
 */
export function evaluateLegacyEventForMigration(
  event: LegacyEventMigrationInput | null,
  expectedEventId: string,
  expectedCreatedBy: string
): LegacyEventMigrationItem {
  if (!isApprovedLegacyEventId(expectedEventId)) {
    return blockedItem(
      expectedEventId,
      'Event id is not in the hardcoded approved allowlist of 10 reviewed events.'
    );
  }

  if (!event) {
    return blockedItem(expectedEventId, 'Event no longer exists.');
  }

  if (event._id !== expectedEventId) {
    // Defensive: caller must always look this row up by expectedEventId.
    return blockedItem(
      expectedEventId,
      'Fetched event id does not match the requested target id.',
      { title: event.title, spaceId: event.spaceId }
    );
  }

  const base: Partial<LegacyEventMigrationItem> = {
    title: event.title,
    spaceId: event.spaceId,
    currentOwnerScope: event.ownerScope,
  };

  if (event.createdBy !== expectedCreatedBy) {
    return blockedItem(
      expectedEventId,
      "createdBy no longer matches the expected reviewed user — refusing.",
      base
    );
  }

  if (event.communityId) {
    return blockedItem(
      expectedEventId,
      'Event now has a communityId — community classification must take precedence.',
      base
    );
  }

  if (event.source === 'google_copy' || event.source === 'device_copy') {
    return blockedItem(
      expectedEventId,
      'Event is a Google/device imported copy — never eligible for this manual correction.',
      base
    );
  }

  if (event.allFamily === true) {
    return blockedItem(
      expectedEventId,
      'Event now has allFamily:true — a family-sharing signal is present.',
      base
    );
  }

  if ((event.sharedWithFamilyMemberIds?.length ?? 0) > 0) {
    return blockedItem(
      expectedEventId,
      'Event now has sharedWithFamilyMemberIds — a family-sharing signal is present.',
      base
    );
  }

  if (
    (event.sharedWithUserIds ?? []).some((id) => id !== event.createdBy)
  ) {
    return blockedItem(
      expectedEventId,
      'Event now has sharedWithUserIds referencing another user — a family-sharing signal is present.',
      base
    );
  }

  if (event.ownerScope === 'family' || event.ownerScope === 'community') {
    return blockedItem(
      expectedEventId,
      `Event ownerScope is already '${event.ownerScope}' — must never be overwritten by this correction.`,
      base
    );
  }

  if (event.ownerScope === 'personal') {
    return {
      eventId: expectedEventId,
      title: event.title,
      spaceId: event.spaceId,
      currentOwnerScope: 'personal',
      expectedNewOwnerScope: 'personal',
      eligible: true,
      alreadyCorrected: true,
    };
  }

  if (event.ownerScope !== undefined) {
    return blockedItem(
      expectedEventId,
      'Event has an unexpected/unrecognized existing ownerScope value.',
      base
    );
  }

  return {
    eventId: expectedEventId,
    title: event.title,
    spaceId: event.spaceId,
    currentOwnerScope: undefined,
    expectedNewOwnerScope: 'personal',
    eligible: true,
    alreadyCorrected: false,
  };
}

export interface LegacyEventMigrationPlan {
  safeToExecute: boolean;
  targetCount: number;
  eligibleCount: number;
  blockedCount: number;
  blockers: string[];
  items: readonly LegacyEventMigrationItem[];
}

/**
 * Aggregates the per-event evaluations into the overall plan. `safeToExecute`
 * is true only when EVERY one of the 10 target items is eligible — a single
 * blocked item refuses the entire batch (no partial execution is ever
 * possible), matching the resetQaUser "one blocker refuses everything" model.
 */
export function buildLegacyEventMigrationPlan(
  items: readonly LegacyEventMigrationItem[]
): LegacyEventMigrationPlan {
  const blockers = items
    .filter((item) => !item.eligible)
    .map((item) => `${item.eventId}: ${item.reason ?? 'blocked'}`);

  return {
    safeToExecute:
      blockers.length === 0 && items.length === APPROVED_LEGACY_EVENT_IDS.length,
    targetCount: APPROVED_LEGACY_EVENT_IDS.length,
    eligibleCount: items.filter((item) => item.eligible).length,
    blockedCount: items.filter((item) => !item.eligible).length,
    blockers,
    items,
  };
}

/**
 * The ONLY patch this migration is ever allowed to apply. Returns `null`
 * when no write is needed (already 'personal' — idempotent no-op) so the
 * caller never issues a redundant/unnecessary db.patch call. Never includes
 * any field other than `ownerScope`.
 */
export function buildOwnerScopePatch(
  item: LegacyEventMigrationItem
): { ownerScope: 'personal' } | null {
  if (!item.eligible || item.alreadyCorrected) return null;
  return { ownerScope: 'personal' };
}
