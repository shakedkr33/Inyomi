import { isCancelledEventWithinCommunityVisibilityWindow } from '../lib/eventsTabDateHelpers';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

type RsvpStatus = 'yes' | 'no' | 'maybe' | 'none' | undefined;

/**
 * Shared "counts as attending" rule for RSVP-gated community events.
 * Product decision: "maybe" is treated identically to "yes" for personal
 * calendar/Home inclusion. Every place that decides whether an RSVP-required
 * event belongs to a member's personal calendar/Home must go through this
 * helper so the rule can never drift out of sync between call sites again.
 */
export function isYesOrMaybeRsvp(rsvpStatus: RsvpStatus): boolean {
  return rsvpStatus === 'yes' || rsvpStatus === 'maybe';
}

/**
 * Stage 1C: shared "full range" default for optional community-event
 * date-bound query args (`from`/`to`, unix ms). When a caller omits one or
 * both bounds, this resolves to the same effectively-unbounded range the
 * community event queries used before Stage 1C bounding was added, so
 * omitting a bound is never a silent behavior change — it's an explicit
 * choice a caller must make. Used by both events.listByCommunity and
 * events.listByCommunityPaged so their "no bound supplied" behavior can
 * never drift apart.
 */
export function resolveCommunityDateRange(
  from: number | undefined,
  to: number | undefined
): { from: number; to: number } {
  return {
    from: from ?? 0,
    to: to ?? 9_999_999_999_999, // far future
  };
}

export type DuplicationSourceVerdict =
  | 'ok'
  | 'not_found'
  | 'community_mismatch'
  | 'forbidden';

/**
 * Stage 3 correction — Part 3: pure decision helper behind
 * `events.verifyDuplicationSource` (server-side defense-in-depth for
 * community event duplication). Extracted so the exact rule can be unit
 * tested without a Convex query harness — the query handler does nothing
 * but fetch `communityExists`/`canCreateCommunityEvent`/`event` and hand
 * them to this function unchanged.
 *
 * Order matters and matches the query: community existence, THEN
 * permission (never leak whether an event exists to someone who couldn't
 * create community events there anyway), THEN the actual community-match
 * check against the source event.
 */
export function resolveDuplicationSourceVerdict(args: {
  communityExists: boolean;
  canCreateCommunityEvent: boolean;
  event: { communityId?: Id<'communities'> } | null;
  targetCommunityId: Id<'communities'>;
}): DuplicationSourceVerdict {
  if (!args.communityExists) return 'not_found';
  if (!args.canCreateCommunityEvent) return 'forbidden';
  if (!args.event) return 'not_found';
  if (
    !args.event.communityId ||
    args.event.communityId !== args.targetCommunityId
  ) {
    return 'community_mismatch';
  }
  return 'ok';
}

/**
 * Stage 1D — the single source of truth for "does this community event
 * belong to the current viewer's personal calendar/Home?"
 *
 * This replaces two functions that used to encode slightly different rules
 * (`computeIsSavedToMyCalendar` and `shouldIncludeInPersonalHomeCalendar`):
 * both are now this one function, so "is this event on my calendar" can
 * never again drift out of sync between the per-event `isSavedToMyCalendar`
 * flag and the Home/Calendar aggregate inclusion filter.
 *
 * Personal calendar inclusion is INDEPENDENT of RSVP-answer state — an
 * RSVP-required event can be included while RSVP is still unanswered (via
 * `autoAddEnabled`), and an event that was RSVP'd "no" remains included if
 * another valid reason still applies (RSVP "no" means "not attending", not
 * "remove from my calendar"). See `computeRsvpAttentionState` below for the
 * separate, independent RSVP/attention dimension.
 *
 * Valid personal-inclusion reasons (any one is sufficient), checked in this
 * order:
 *   1. `hasOptOut`       — a per-event opt-out ALWAYS wins, over every other
 *                          reason below, including creator. Set by
 *                          removeCommunityEventFromMyCalendar /
 *                          removeEventFromCalendarAndUnclaim, cleared by
 *                          addCommunityEventToMyCalendar (or task
 *                          claim/assignment, which also clears it).
 *   2. `isCreator`       — the viewer created the event. Management role
 *                          (owner/admin) is intentionally NOT a reason here
 *                          — see events.ts for the Stage 1D removal of the
 *                          old owner/admin personal-calendar bypass.
 *   3. `autoAddEnabled`  — the viewer's active community membership has
 *                          `autoAddEventsToCalendar === true`. This is a
 *                          DYNAMIC signal (read from communityMembers at
 *                          query time) — no savedCommunityEvents row is
 *                          created to represent it, so it applies uniformly
 *                          to existing and future events with zero write
 *                          fan-out, and disappears immediately (with no
 *                          cleanup needed) if the member turns it off.
 *   4. `hasActiveSave`   — an explicit savedCommunityEvents row (creator
 *                          auto-save on event creation, or produced by task
 *                          claim/assignment) — valid for both open and
 *                          RSVP-required events.
 *   5. RSVP yes/maybe    — only meaningful for RSVP-required events.
 *   6. (open events only) legacy `rsvpStatus === 'yes'` fallback — preserved
 *      from Stage 1A for events that changed from RSVP-required to open
 *      while the user still had an old RSVP=yes row and no save row.
 */
export function computeIsSavedToMyCalendar(args: {
  isCreator: boolean;
  autoAddEnabled: boolean;
  requiresRsvp: boolean | undefined;
  rsvpStatus: RsvpStatus;
  hasActiveSave: boolean;
  hasOptOut: boolean;
}): boolean {
  if (args.hasOptOut) return false;
  if (args.isCreator) return true;
  if (args.autoAddEnabled) return true;
  if (args.requiresRsvp === false) {
    if (args.hasActiveSave) return true;
    return args.rsvpStatus === 'yes';
  }
  if (args.hasActiveSave) return true;
  return isYesOrMaybeRsvp(args.rsvpStatus);
}

/**
 * Stage 1D — the second, INDEPENDENT dimension: does this event still need
 * an RSVP answer from the viewer? This is deliberately separate from
 * `computeIsSavedToMyCalendar` — an event can be `isInPersonalCalendar: true`
 * (e.g. via auto-add) while `rsvpAttentionState` is `'pending'`. Do not
 * conflate the two; Stage 2's "requires attention" UI depends on being able
 * to observe both independently.
 *
 * QA FIX (Issue 3) — CANONICAL CREATOR RSVP RULE: the event creator is the
 * organizer and never needs to RSVP to their own event, so `isCreator` is
 * checked FIRST and unconditionally short-circuits to `'not_applicable'` —
 * before even checking `requiresRsvp`. This exemption applies ONLY to the
 * event's actual creator (`event.createdBy === viewerUserId`), never merely
 * because the viewer happens to be a community owner/admin — a non-creator
 * owner/admin/member all go through the normal pending/answered rules
 * below. Creator status is independent of RSVP response: this never writes
 * or implies an RSVP "yes" record — see computeIsSavedToMyCalendar, which
 * separately grants the creator personal-calendar inclusion without
 * touching RSVP state at all.
 */
export type RsvpAttentionState = 'pending' | 'answered' | 'not_applicable';

export function computeRsvpAttentionState(args: {
  isCreator: boolean;
  requiresRsvp: boolean | undefined;
  rsvpStatus: RsvpStatus;
}): RsvpAttentionState {
  if (args.isCreator) return 'not_applicable';
  if (args.requiresRsvp !== true) return 'not_applicable';
  if (args.rsvpStatus === undefined || args.rsvpStatus === 'none') {
    return 'pending';
  }
  return 'answered'; // yes / maybe / no are all "answered" — no is a valid answer, not a removal.
}

/**
 * Stage 1D — convenience bundle of both independent dimensions for callers
 * (Stage 2 UI, future queries) that want both facts about an event in one
 * call without risking the two drifting out of sync. Not wired into any
 * query yet (see Stage 1D report) — it exists so Stage 2 has a ready-made,
 * tested foundation to build the "requires attention" UI on.
 */
export type CommunityEventPersonalCalendarState = {
  isInPersonalCalendar: boolean;
  rsvpAttentionState: RsvpAttentionState;
};

export function computeCommunityEventPersonalCalendarState(args: {
  isCreator: boolean;
  autoAddEnabled: boolean;
  requiresRsvp: boolean | undefined;
  rsvpStatus: RsvpStatus;
  hasActiveSave: boolean;
  hasOptOut: boolean;
}): CommunityEventPersonalCalendarState {
  return {
    isInPersonalCalendar: computeIsSavedToMyCalendar(args),
    rsvpAttentionState: computeRsvpAttentionState({
      isCreator: args.isCreator,
      requiresRsvp: args.requiresRsvp,
      rsvpStatus: args.rsvpStatus,
    }),
  };
}

/**
 * Logical personal-inclusion state of a community event for the current
 * viewer, per the product rules confirmed in the Stage 1A audit:
 *   - RSVP yes/maybe            → 'my_event'
 *   - RSVP unanswered           → 'pending_rsvp'
 *   - RSVP no                   → 'other'
 *   - open event, saved         → 'my_event'
 *   - open event, not saved     → 'other'
 *   - privileged (caller-defined) → 'my_event'
 *   - explicit opt-out          → 'other' (opt-out always wins)
 *
 * STAGE 1D DECISION — kept intentionally UNCHANGED, on purpose:
 * This is a single mutually-exclusive enum, which cannot represent the new
 * "included via auto-add, but RSVP still pending" state without losing
 * information (that combination would have to collapse into either
 * 'my_event' or 'pending_rsvp', hiding the other fact from the caller).
 * Rather than force that lossy collapse into this enum, Stage 1D introduces
 * the two independent-dimension helpers above
 * (`computeIsSavedToMyCalendar` + `computeRsvpAttentionState` /
 * `computeCommunityEventPersonalCalendarState`) as the model going forward.
 *
 * STAGE 2A UPDATE: the community screen's "ראשי" (Main) tab — this
 * function's one former caller (`getCommunityEventPersonalState` in
 * app/(authenticated)/community/[id].tsx) — has migrated onto the
 * two-dimension model above via the new `listCommunityMainOverview` query,
 * and that wrapper was removed. This function is kept only for its
 * existing test coverage / as a documented historical reference; it is not
 * currently called from production code.
 */
export type CommunityEventPersonalState = 'my_event' | 'pending_rsvp' | 'other';

export function classifyCommunityEventForViewer(args: {
  privileged: boolean;
  requiresRsvp: boolean | undefined;
  rsvpStatus: RsvpStatus;
  hasActiveSave: boolean;
  hasOptOut: boolean;
}): CommunityEventPersonalState {
  if (args.hasOptOut) return 'other';
  if (args.privileged) return 'my_event';
  if (args.requiresRsvp === false) {
    if (args.hasActiveSave || isYesOrMaybeRsvp(args.rsvpStatus)) {
      return 'my_event';
    }
    return 'other';
  }
  if (isYesOrMaybeRsvp(args.rsvpStatus)) return 'my_event';
  if (args.rsvpStatus === undefined || args.rsvpStatus === 'none') {
    return 'pending_rsvp';
  }
  return 'other'; // rsvpStatus === 'no'
}

/**
 * QA FIX (Issue 2) — pure eligibility rule for "אירועים נוספים" (Additional
 * Events): upcoming community events that are visible to the viewer but not
 * yet part of their personal calendar/RSVP-attention state. Deliberately
 * reuses the SAME two independent Stage 1D dimensions
 * (`isInPersonalCalendar` / `rsvpAttentionState`) rather than introducing a
 * third parallel notion of inclusion — see computeCommunityEventPersonalCalendarState.
 *
 * An event is eligible when ALL of:
 *   - it is NOT already in the viewer's personal calendar (creator /
 *     auto-add / explicit save / RSVP yes-maybe all disqualify it here —
 *     it belongs in "האירועים שלי" instead)
 *   - it does NOT currently require an unanswered RSVP from the viewer
 *     (`rsvpAttentionState !== 'pending'` — those belong in "מחכים לתגובה")
 *   - the viewer has not explicitly answered "לא" to it (RSVP `'no'` is a
 *     deliberate answer, not a discovery gap — product decision: excluded)
 *
 * An explicit per-event opt-out (`hasOptOut`, already folded into
 * `isInPersonalCalendar` via computeIsSavedToMyCalendar) does NOT disqualify
 * an otherwise-eligible open event — by design, opting out of an
 * auto-added/saved OPEN event makes `isInPersonalCalendar` false again,
 * which is exactly what lets it resurface here with "הוסף ליומן" so the
 * user always has a reachable way to add it back (see addCommunityEventToMyCalendar,
 * which clears the opt-out).
 */
export function isEligibleForAdditionalCommunityEvent(args: {
  rsvpStatus: RsvpStatus;
  isInPersonalCalendar: boolean;
  rsvpAttentionState: RsvpAttentionState;
}): boolean {
  if (args.isInPersonalCalendar) return false;
  if (args.rsvpAttentionState === 'pending') return false;
  if (args.rsvpStatus === 'no') return false;
  return true;
}

/**
 * STAGE 3 CORRECTION (Part C) — the full "אירועים" tab has BROADER
 * discoverability requirements than Main: unlike
 * `isEligibleForAdditionalCommunityEvent` (used by Main's
 * `listCommunityMainOverview` / `listCommunityAdditionalEventsPaged`, which
 * deliberately excludes `rsvpStatus === 'no'` as "a deliberate answer, not a
 * discovery gap"), the Events tab is the community's COMPLETE browse/history
 * surface and must never let a visible upcoming event disappear just
 * because the viewer once answered "לא" — the user may change their mind,
 * and the card exposes "שינוי תשובה" (see classifyCommunityEventForEventsTab
 * below) precisely so they can. This is intentionally a SEPARATE pure rule
 * from `isEligibleForAdditionalCommunityEvent` — Main's discovery semantics
 * are NOT changed by this correction; only the Events-tab-specific
 * `classifyCommunityEventForEventsTab` classification below now calls this
 * instead of the shared Main/`isEligibleForAdditionalCommunityEvent` helper.
 *
 * An event is eligible for the Events tab's non-personal ("אירועים נוספים")
 * section when BOTH:
 *   - it is NOT already in the viewer's personal calendar (creator /
 *     auto-add / explicit save / RSVP yes-maybe all disqualify it here —
 *     it belongs in "האירועים שלי" instead)
 *   - it does NOT currently require an unanswered RSVP from the viewer
 *     (`rsvpAttentionState !== 'pending'` — those belong in "מחכים לתגובה")
 *
 * Deliberately does NOT exclude `rsvpStatus === 'no'` — that is the entire
 * point of this correction.
 */
export function isEligibleForEventsTabNonPersonalSection(args: {
  isInPersonalCalendar: boolean;
  rsvpAttentionState: RsvpAttentionState;
}): boolean {
  if (args.isInPersonalCalendar) return false;
  if (args.rsvpAttentionState === 'pending') return false;
  return true;
}

/**
 * Stage 3 — full "אירועים" (Events) tab bucket classification. Reuses the
 * exact same two independent Stage 1D dimensions every other community
 * calendar query already relies on
 * (computeCommunityEventPersonalCalendarState +
 * isEligibleForEventsTabNonPersonalSection) rather than introducing a THIRD
 * parallel notion of "which section does this event belong to" — this is
 * intentionally just a thin bundle over those two existing helpers so the
 * Events tab query can classify a paginated page of events with one call
 * per event, without forking any business rule.
 *
 * An event may resolve `isMyEvent: true` AND `isPendingRsvp: true` at the
 * same time (e.g. auto-add ON + RSVP unanswered) — this is intentional, see
 * computeCommunityEventPersonalCalendarState's doc comment.
 *
 * STAGE 3 CORRECTION (Part C): `isAdditionalEligible` now uses
 * `isEligibleForEventsTabNonPersonalSection`, which — unlike Main's
 * `isEligibleForAdditionalCommunityEvent` — does NOT exclude
 * `rsvpStatus === 'no'`. A plain RSVP-required event the viewer answered
 * "no" to (with no auto-add/save/creator reason) therefore now resolves
 * `isAdditionalEligible: true` here (so it remains discoverable + able to
 * "שינוי תשובה"), even though the exact same event would still be excluded
 * from Main's separate "אירועים נוספים" via `isEligibleForAdditionalCommunityEvent`
 * — that Main behavior is unchanged.
 */
export type CommunityEventsTabClassification = {
  isMyEvent: boolean;
  isPendingRsvp: boolean;
  isAdditionalEligible: boolean;
};

export function classifyCommunityEventForEventsTab(args: {
  isCreator: boolean;
  autoAddEnabled: boolean;
  requiresRsvp: boolean | undefined;
  rsvpStatus: RsvpStatus;
  hasActiveSave: boolean;
  hasOptOut: boolean;
}): CommunityEventsTabClassification {
  const state = computeCommunityEventPersonalCalendarState(args);
  return {
    isMyEvent: state.isInPersonalCalendar,
    isPendingRsvp: state.rsvpAttentionState === 'pending',
    isAdditionalEligible: isEligibleForEventsTabNonPersonalSection({
      isInPersonalCalendar: state.isInPersonalCalendar,
      rsvpAttentionState: state.rsvpAttentionState,
    }),
  };
}

export async function loadActiveSavedEventIds(
  ctx: QueryCtx,
  userId: Id<'users'>
): Promise<Set<string>> {
  const rows = await ctx.db
    .query('savedCommunityEvents')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  const set = new Set<string>();
  for (const r of rows) {
    if (r.removedAt === undefined) {
      set.add(r.eventId as string);
    }
  }
  return set;
}

export async function loadOptOutEventIds(
  ctx: QueryCtx,
  userId: Id<'users'>
): Promise<Set<string>> {
  const rows = await ctx.db
    .query('communityEventPersonalCalendarOptOuts')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  return new Set(rows.map((r) => r.eventId as string));
}

/**
 * Stage 1D: `autoAddEnabled` is a single flag for the whole batch because
 * every caller of this helper already scopes `events` to one community per
 * call (listByCommunity / listByCommunityPaged) — the viewer's
 * autoAddEventsToCalendar preference for that community is read once by the
 * caller (from a membership row it already fetched for its own membership
 * check) and passed in here, rather than re-querying per event.
 *
 * `savedIds` / `optOutIds` may be passed in by a caller that already loaded
 * them (e.g. to reuse for its own personal-inclusion filtering before
 * calling this) to avoid loading them twice in the same request.
 */
export async function enrichEventsWithCalendarFlags<T extends Doc<'events'>>(
  ctx: QueryCtx,
  userId: Id<'users'>,
  events: T[],
  rsvpByEventId: Map<string, 'yes' | 'no' | 'maybe' | 'none'>,
  opts?: {
    autoAddEnabled?: boolean;
    savedIds?: Set<string>;
    optOutIds?: Set<string>;
  }
): Promise<Array<T & { isSavedToMyCalendar: boolean }>> {
  const savedIds =
    opts?.savedIds ?? (await loadActiveSavedEventIds(ctx, userId));
  const optOutIds = opts?.optOutIds ?? (await loadOptOutEventIds(ctx, userId));
  const autoAddEnabled = opts?.autoAddEnabled ?? false;
  return events.map((ev) => {
    const id = ev._id as string;
    const rsvpStatus = rsvpByEventId.get(id);
    return {
      ...ev,
      isSavedToMyCalendar: computeIsSavedToMyCalendar({
        isCreator: ev.createdBy === userId,
        autoAddEnabled,
        requiresRsvp: ev.requiresRsvp,
        rsvpStatus,
        hasActiveSave: savedIds.has(id),
        hasOptOut: optOutIds.has(id),
      }),
    };
  });
}

/**
 * Stage 2A — pure, DB-independent bounding logic for the "ראשי" (Main)
 * community-overview screen. Extracted from events.listCommunityMainOverview
 * so the "independently bounded per category" behavior can be unit tested
 * without a Convex test harness (same precedent as resolveCommunityDateRange
 * / summarizeEventTaskCounts — see eventScaleBounding.test.ts).
 *
 * The query walks the community's upcoming events (oldest-first, via the
 * existing `by_community_date` index) in small chunks and feeds each
 * candidate through `accumulateMainOverviewCandidate` one at a time, so it
 * can stop as soon as both categories are satisfied (or a hard scan cap is
 * hit) instead of collecting the whole community. "האירועים שלי" and
 * "מחכים לתגובה" are independent, NON-exclusive categories (an auto-added,
 * RSVP-unanswered event belongs to both) — see computeCommunityEventPersonalCalendarState.
 */
export type MainOverviewLimits = {
  myEventsLimit: number;
  pendingRsvpLimit: number;
};

export type MainOverviewAccumulatorState<T> = {
  myEvents: T[];
  myEventsHasMore: boolean;
  pendingRsvpEvents: T[];
  pendingRsvpHasMore: boolean;
};

export function createMainOverviewAccumulator<
  T,
>(): MainOverviewAccumulatorState<T> {
  return {
    myEvents: [],
    myEventsHasMore: false,
    pendingRsvpEvents: [],
    pendingRsvpHasMore: false,
  };
}

/**
 * Feeds one scanned event through the accumulator. Each event is checked
 * against BOTH categories independently — an event can be appended to
 * `myEvents`, to `pendingRsvpEvents`, to both, or to neither, matching the
 * two-dimension model. Once a category's limit is reached, further
 * candidates for that category flip its `hasMore` flag instead of growing
 * the array further (the array itself never exceeds its limit).
 */
export function accumulateMainOverviewCandidate<T>(
  state: MainOverviewAccumulatorState<T>,
  candidate: {
    item: T;
    isInPersonalCalendar: boolean;
    isPendingRsvp: boolean;
  },
  limits: MainOverviewLimits
): MainOverviewAccumulatorState<T> {
  let { myEvents, myEventsHasMore, pendingRsvpEvents, pendingRsvpHasMore } =
    state;

  if (candidate.isInPersonalCalendar) {
    if (myEvents.length < limits.myEventsLimit) {
      myEvents = [...myEvents, candidate.item];
    } else {
      myEventsHasMore = true;
    }
  }
  if (candidate.isPendingRsvp) {
    if (pendingRsvpEvents.length < limits.pendingRsvpLimit) {
      pendingRsvpEvents = [...pendingRsvpEvents, candidate.item];
    } else {
      pendingRsvpHasMore = true;
    }
  }

  return { myEvents, myEventsHasMore, pendingRsvpEvents, pendingRsvpHasMore };
}

/**
 * BUG FIX (manual QA, follow-up) — Community Main is a "what is happening
 * in this community today / next" surface, not a strict "not yet started"
 * scan. A previous fix made TODAY's all-day event (whose `startTime` is
 * stamped at local midnight) eligible for the whole day, but a SEPARATE
 * `startTime >= now` check still applied to TIMED events, so a today
 * event whose start time (or end time) had already passed still vanished
 * from Community Main mid-day, even though the identical event correctly
 * stayed visible on the "אירועים" tab (see event/new.tsx's community save
 * handler for the all-day startTime-at-local-midnight convention, and
 * hasEventEndedByNow in lib/eventsTabDateHelpers.ts for the Events tab's
 * own, unchanged "has this event ended" rule).
 *
 * The extra `isEventStartTimeEligibleForUpcomingScan(event, now)` instant
 * check that used to live here has been removed rather than redefined:
 * `listCommunityMainOverview` / `listCommunityAdditionalEventsPaged`
 * already scope their indexed scan to `startTime >= localDayStart` (the
 * viewer's device-local midnight), which is now the ONLY eligibility
 * boundary these two queries need — any event reached by that scan
 * belongs to today or a future local day and must remain eligible for the
 * rest of today, regardless of its own start/end time. This intentionally
 * makes eligibility for Community Main purely a function of the caller-
 * supplied `localDayStart`, never the server's own clock.
 */

/** True once both categories have reached their limit — the scan loop can stop. */
export function isMainOverviewAccumulatorSatisfied<T>(
  state: MainOverviewAccumulatorState<T>,
  limits: MainOverviewLimits
): boolean {
  return (
    state.myEvents.length >= limits.myEventsLimit &&
    state.pendingRsvpEvents.length >= limits.pendingRsvpLimit
  );
}

/**
 * Called once after the scan loop ends. Two distinct "we didn't see
 * everything" situations must both be handled, and they are NOT the same:
 *
 *   - `scanExhausted === false` (the loop stopped early because both
 *     categories were already satisfied, or the safety cap was hit) and a
 *     category's array is sitting exactly at its limit — we cannot be sure
 *     there isn't more beyond what we saw, so conservatively mark that
 *     category `hasMore`. This mirrors the "prefer a bounded signal over an
 *     expensive exact total" rule: we never scan the whole community just to
 *     answer this precisely.
 *
 *   - `scanTruncated === true` (the hard safety cap — MAIN_OVERVIEW_MAX_SCANNED
 *     — was hit while the underlying query was NOT done, i.e.
 *     `scanned >= MAIN_OVERVIEW_MAX_SCANNED && !isDone`) — hitting the cap is
 *     NEVER evidence a category is exhausted, even when its array is still
 *     under its limit (including empty). Unlike the case above, this must
 *     apply UNCONDITIONALLY — regardless of how many matches a category
 *     found within the scanned window — because the cap can be hit while a
 *     category has zero matches purely due to where matching events happen
 *     to sit in the community's chronological event order (see the Stage 2A
 *     scale-edge-case investigation: a match at scan position ~170 with a
 *     160-event cap must still surface `hasMore: true`, not a false "no
 *     events" negative).
 */
/**
 * Stage 4 — Community "תזכורות" tab: per-event eligibility rule for whether
 * an event's "חשוב לזכור" (important items) should surface as a grouped
 * reminder card. Deliberately reuses `computeIsSavedToMyCalendar` (Stage 1D)
 * as the ONLY personal-relevance signal — never a separate parallel notion
 * of "personally relevant enough to see this event's important items".
 *
 * An event's important-items group is eligible when ALL of:
 *   - it has at least one important item (nothing to remind about otherwise)
 *   - it is not cancelled (a cancelled event should stop producing active
 *     reminder mental load — the event/items remain historically visible via
 *     Event Details, this only hides it from the active Reminders tab)
 *   - it is in the viewer's personal calendar (`isInPersonalCalendar`)
 *
 * "Has this event already ended" is intentionally NOT decided here — that
 * requires true local wall-clock day-boundary semantics (see
 * lib/eventsTabDateHelpers.hasEventEndedByNow, which depends on the
 * viewer's device-local timezone). Deciding it in a Convex query would run
 * on the server's runtime timezone instead, which is not equivalent. The
 * exact same "אירועים" tab already makes this same choice (bounds its
 * server query, then filters "has ended" client-side with
 * `hasEventEndedByNow`) — see events.listCommunityEventReminderGroupsPaged
 * and the Stage 4 report for the full reasoning.
 */
export function isEventImportantItemsGroupEligible(args: {
  importantItemsCount: number;
  isCancelled: boolean;
  isInPersonalCalendar: boolean;
}): boolean {
  if (args.importantItemsCount === 0) return false;
  if (args.isCancelled) return false;
  return args.isInPersonalCalendar;
}

/**
 * Stage 4 — pure batch filter composing the Stage 1D personal-calendar
 * dimension with `isEventImportantItemsGroupEligible` for a full page of
 * community events. Extracted so events.listCommunityEventReminderGroupsPaged
 * can be unit tested without a Convex query harness (same precedent as
 * `filterEventsEligibleForReminderGroups`'s siblings above) — the query
 * handler does nothing but fetch the page + personal-calendar signal maps
 * and hand them to this function unchanged.
 */
export function filterEventsEligibleForReminderGroups<
  T extends {
    _id: string;
    createdBy: string;
    status?: 'active' | 'cancelled';
    requiresRsvp?: boolean;
    importantItems?: Array<{ id: string; title: string }>;
  },
>(
  events: T[],
  userId: string,
  rsvpByEventId: Map<string, RsvpStatus>,
  opts: {
    autoAddEnabled: boolean;
    savedIds: Set<string>;
    optOutIds: Set<string>;
  }
): T[] {
  return events.filter((ev) => {
    const idStr = ev._id;
    const isInPersonalCalendar = computeIsSavedToMyCalendar({
      isCreator: ev.createdBy === userId,
      autoAddEnabled: opts.autoAddEnabled,
      requiresRsvp: ev.requiresRsvp,
      rsvpStatus: rsvpByEventId.get(idStr),
      hasActiveSave: opts.savedIds.has(idStr),
      hasOptOut: opts.optOutIds.has(idStr),
    });
    return isEventImportantItemsGroupEligible({
      importantItemsCount: ev.importantItems?.length ?? 0,
      isCancelled: ev.status === 'cancelled',
      isInPersonalCalendar,
    });
  });
}

/**
 * FIX C — pure decision helper behind `events.removeCancelledCommunityEvent`
 * (soft Community-display removal of a cancelled Community Event, WITHOUT
 * ever deleting the underlying event/RSVPs/tasks/attachments — see that
 * mutation's doc comment). Extracted so the exact rule — including the
 * 24-hour boundary — can be unit tested without a Convex mutation harness
 * (same precedent as `resolveDuplicationSourceVerdict` above).
 *
 * The mutation handler does nothing but resolve `event` /
 * `canManage` (creator OR active community owner/admin — the SAME
 * permission the query/mutation handlers already derive elsewhere in this
 * file, never a new permission model) and `now`, then hands them to this
 * function unchanged.
 *
 * Order matters:
 *   1. `not_found`            — event does not exist.
 *   2. `not_community_event`  — this mutation only ever applies to
 *      Community Events; a Personal Event is always rejected here,
 *      regardless of who is asking. Personal Event delete/soft-delete
 *      behavior is entirely untouched by this mutation.
 *   3. `forbidden`            — checked BEFORE any further business-rule
 *      checks below, so a non-member/inactive-member/regular-member caller
 *      always gets the exact same rejection regardless of the event's
 *      cancellation/removal state (never leaks whether the event is
 *      cancelled, already removed, or past its window to an unauthorized
 *      caller).
 *   4. `not_cancelled`        — only a `status === 'cancelled'` event is
 *      eligible for early Community removal.
 *   5. `missing_cancelled_at` — defensive: a cancelled event must always
 *      have `cancelledAt` set by `cancelEvent`; treat its absence as
 *      ineligible rather than throwing/behaving unpredictably.
 *   6. `already_removed`      — idempotent: calling this again for an
 *      event that was already removed is a deliberate no-op success, not
 *      an error (see the mutation handler).
 *   7. `window_expired`       — outside the SAME 24-hour visibility window
 *      the Community screen already uses to show/hide cancelled events
 *      (`isCancelledEventWithinCommunityVisibilityWindow`) — early removal
 *      can never apply once the event would no longer be shown anyway.
 *   8. `ok`                   — eligible; the mutation may set
 *      `removedFromCommunityAt`.
 */
export type CommunityEventEarlyRemovalVerdict =
  | 'ok'
  | 'not_found'
  | 'not_community_event'
  | 'forbidden'
  | 'not_cancelled'
  | 'missing_cancelled_at'
  | 'already_removed'
  | 'window_expired';

export function resolveCommunityEventEarlyRemovalVerdict(args: {
  event: {
    communityId?: Id<'communities'>;
    status?: 'active' | 'cancelled';
    cancelledAt?: number;
    removedFromCommunityAt?: number;
  } | null;
  canManage: boolean;
  now: number;
}): CommunityEventEarlyRemovalVerdict {
  const { event, canManage, now } = args;
  if (!event) return 'not_found';
  if (!event.communityId) return 'not_community_event';
  if (!canManage) return 'forbidden';
  if (event.status !== 'cancelled') return 'not_cancelled';
  if (event.cancelledAt === undefined) return 'missing_cancelled_at';
  if (event.removedFromCommunityAt !== undefined) return 'already_removed';
  if (
    !isCancelledEventWithinCommunityVisibilityWindow(event.cancelledAt, now)
  ) {
    return 'window_expired';
  }
  return 'ok';
}

/**
 * FIX C — pure predicate behind the `removedFromCommunityAt` filter in
 * `events.listCommunityEventsTabPaged` (the authoritative Community
 * cancelled-events ["אירועים שבוטלו"] data source). A cancelled event a
 * manager has early-removed from Community display must be excluded here
 * — extracted so this exact rule can be unit tested without a Convex query
 * harness (same precedent as `resolveCommunityEventEarlyRemovalVerdict`
 * above). Only ever hides the event from THIS query's result page; never
 * deletes anything.
 */
export function isCancelledEventRemovedFromCommunityDisplay(event: {
  status?: 'active' | 'cancelled';
  removedFromCommunityAt?: number;
}): boolean {
  return (
    event.status === 'cancelled' && event.removedFromCommunityAt !== undefined
  );
}

/**
 * FIX C.2 — pure eligibility rule behind
 * `events.listRecentCancelledCommunityEvents` (Community Main's "מה חשוב
 * עכשיו" recent-cancellation candidates). Reuses the SAME shared 24-hour
 * boundary helper (`isCancelledEventWithinCommunityVisibilityWindow`) FIX C
 * already introduced for "אירועים שבוטלו" / early removal — never a second,
 * independently-drifting definition of the window.
 *
 * An event is eligible when ALL of:
 *   - it belongs to the requested community (defense-in-depth mirror of the
 *     query's own `by_community_cancelled_at` index scope — see
 *     `selectRecentCancelledCommunityEvents` below)
 *   - `status === 'cancelled'`
 *   - `cancelledAt` is present
 *   - `removedFromCommunityAt` is NOT set (FIX C early removal — the exact
 *     same rule `isCancelledEventRemovedFromCommunityDisplay` encodes for
 *     "אירועים שבוטלו", so a manager's early removal disappears the
 *     cancellation from BOTH surfaces in lockstep)
 *   - still inside the shared 24h Community visibility window
 */
export function isRecentCancelledCommunityEventEligible(args: {
  communityId: Id<'communities'>;
  event: {
    communityId?: Id<'communities'>;
    status?: 'active' | 'cancelled';
    cancelledAt?: number;
    removedFromCommunityAt?: number;
  };
  now: number;
}): boolean {
  const { communityId, event, now } = args;
  if (event.communityId !== communityId) return false;
  if (event.status !== 'cancelled') return false;
  if (event.cancelledAt === undefined) return false;
  if (event.removedFromCommunityAt !== undefined) return false;
  return isCancelledEventWithinCommunityVisibilityWindow(
    event.cancelledAt,
    now
  );
}

/**
 * FIX C.2 — filters, sorts (newest cancellation first), and bounds a batch
 * of candidate events down to the small set `listRecentCancelledCommunityEvents`
 * returns. Extracted as a pure function so the exact retrieval/filtering/
 * ordering/limit rules can be unit tested without a Convex query harness —
 * the query handler does nothing but fetch a small, index-bounded page
 * (via `by_community_cancelled_at`, already narrowed to the 24h window at
 * the DB level) and hand it to this function unchanged.
 */
export function selectRecentCancelledCommunityEvents<
  T extends {
    communityId?: Id<'communities'>;
    status?: 'active' | 'cancelled';
    cancelledAt?: number;
    removedFromCommunityAt?: number;
  },
>(
  events: T[],
  communityId: Id<'communities'>,
  now: number,
  limit: number
): T[] {
  return events
    .filter((ev) =>
      isRecentCancelledCommunityEventEligible({ communityId, event: ev, now })
    )
    .sort((a, b) => (b.cancelledAt ?? 0) - (a.cancelledAt ?? 0))
    .slice(0, Math.max(limit, 0));
}

export function finalizeMainOverviewHasMore<T>(
  state: MainOverviewAccumulatorState<T>,
  limits: MainOverviewLimits,
  scanStatus: { scanExhausted: boolean; scanTruncated: boolean }
): MainOverviewAccumulatorState<T> {
  const { scanExhausted, scanTruncated } = scanStatus;
  return {
    ...state,
    myEventsHasMore:
      state.myEventsHasMore ||
      scanTruncated ||
      (state.myEvents.length >= limits.myEventsLimit && !scanExhausted),
    pendingRsvpHasMore:
      state.pendingRsvpHasMore ||
      scanTruncated ||
      (state.pendingRsvpEvents.length >= limits.pendingRsvpLimit &&
        !scanExhausted),
  };
}
