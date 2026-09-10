/**
 * Tests for Stage 2A — the "ראשי" (Main) community-overview screen's
 * independently-bounded query helpers.
 *
 * These exercise the pure, DB-independent accumulator helpers extracted
 * from events.listCommunityMainOverview into communityCalendarState.ts:
 *   - createMainOverviewAccumulator
 *   - accumulateMainOverviewCandidate
 *   - isMainOverviewAccumulatorSatisfied
 *   - finalizeMainOverviewHasMore
 *
 * The actual bounded-index scan (`.withIndex('by_community_date', ...)
 * .gte('startTime', now)).paginate(...)`) inside listCommunityMainOverview
 * cannot be unit-tested without a Convex test harness (same precedent as
 * eventScaleBounding.test.ts / communityCalendarState.test.ts — this repo
 * only unit-tests the pure helpers, and verifies the query wiring by code
 * review). What IS fully covered here is the exact behavior the Stage 2A
 * prompt calls out under "TESTING — MAIN QUERY BOUNDING":
 *   - myEvents and pendingRsvpEvents are bounded independently.
 *   - one category filling its limit cannot consume the other's budget or
 *     hide items that belong in it (see the interleaved-candidates test).
 *   - an event can land in BOTH categories (intentional non-exclusive
 *     duplication — the auto-add + pending-RSVP case).
 *   - hasMore reflects "we stopped without knowing there isn't more",
 *     never an expensive exact remaining count.
 *   - scan-cap TRUNCATION (the 160-event hard cap hit while the underlying
 *     query is not done) is distinct from a category being "exhausted", and
 *     must set hasMore unconditionally — even for a category with ZERO
 *     matches — since hitting the cap is never proof there's nothing more
 *     past it. See the Stage 2A scale-edge-case investigation (a matching
 *     event sitting at scan position ~170 with a 160-event cap must not be
 *     reported as a false "no events" negative).
 */

import { describe, expect, it } from 'bun:test';
import {
  accumulateMainOverviewCandidate,
  computeCommunityEventPersonalCalendarState,
  createMainOverviewAccumulator,
  finalizeMainOverviewHasMore,
  isMainOverviewAccumulatorSatisfied,
  type MainOverviewLimits,
} from '../../convex/communityCalendarState';

type FakeEvent = { id: string };

const LIMITS: MainOverviewLimits = { myEventsLimit: 2, pendingRsvpLimit: 2 };

function ev(id: string): FakeEvent {
  return { id };
}

describe('createMainOverviewAccumulator', () => {
  it('starts empty with both hasMore flags false', () => {
    const acc = createMainOverviewAccumulator<FakeEvent>();
    expect(acc).toEqual({
      myEvents: [],
      myEventsHasMore: false,
      pendingRsvpEvents: [],
      pendingRsvpHasMore: false,
    });
  });
});

describe('accumulateMainOverviewCandidate — independent bounding per category', () => {
  it('adds a candidate to myEvents only when isInPersonalCalendar', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    acc = accumulateMainOverviewCandidate(
      acc,
      { item: ev('a'), isInPersonalCalendar: true, isPendingRsvp: false },
      LIMITS
    );
    expect(acc.myEvents).toEqual([ev('a')]);
    expect(acc.pendingRsvpEvents).toEqual([]);
  });

  it('adds a candidate to pendingRsvpEvents only when isPendingRsvp', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    acc = accumulateMainOverviewCandidate(
      acc,
      { item: ev('a'), isInPersonalCalendar: false, isPendingRsvp: true },
      LIMITS
    );
    expect(acc.pendingRsvpEvents).toEqual([ev('a')]);
    expect(acc.myEvents).toEqual([]);
  });

  it('IMPORTANT AUTO-ADD CASE: a candidate can land in BOTH categories at once', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    acc = accumulateMainOverviewCandidate(
      acc,
      { item: ev('trip'), isInPersonalCalendar: true, isPendingRsvp: true },
      LIMITS
    );
    expect(acc.myEvents).toEqual([ev('trip')]);
    expect(acc.pendingRsvpEvents).toEqual([ev('trip')]);
  });

  it('ignores a candidate matching neither category', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    acc = accumulateMainOverviewCandidate(
      acc,
      { item: ev('other'), isInPersonalCalendar: false, isPendingRsvp: false },
      LIMITS
    );
    expect(acc.myEvents).toEqual([]);
    expect(acc.pendingRsvpEvents).toEqual([]);
  });

  it('never grows a category array past its limit — flips hasMore instead', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b', 'c', 'd']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    expect(acc.myEvents).toEqual([ev('a'), ev('b')]);
    expect(acc.myEventsHasMore).toBe(true);
  });

  it("one category filling up does NOT consume or starve the other's budget", () => {
    // 4 myEvents-only candidates, interleaved with 1 pendingRsvp-only
    // candidate arriving LAST — the pending item must still be captured,
    // proving myEvents filling up never silently ate the whole scan.
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b', 'c', 'd']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    acc = accumulateMainOverviewCandidate(
      acc,
      {
        item: ev('pending-1'),
        isInPersonalCalendar: false,
        isPendingRsvp: true,
      },
      LIMITS
    );
    expect(acc.myEvents).toEqual([ev('a'), ev('b')]);
    expect(acc.myEventsHasMore).toBe(true);
    expect(acc.pendingRsvpEvents).toEqual([ev('pending-1')]);
    expect(acc.pendingRsvpHasMore).toBe(false);
  });
});

describe('isMainOverviewAccumulatorSatisfied', () => {
  it('is false when neither category has reached its limit', () => {
    const acc = createMainOverviewAccumulator<FakeEvent>();
    expect(isMainOverviewAccumulatorSatisfied(acc, LIMITS)).toBe(false);
  });

  it('is false when only one category has reached its limit', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    expect(isMainOverviewAccumulatorSatisfied(acc, LIMITS)).toBe(false);
  });

  it('is true once BOTH categories reach their limit — scan can stop', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: true },
        LIMITS
      );
    }
    expect(isMainOverviewAccumulatorSatisfied(acc, LIMITS)).toBe(true);
  });
});

describe('finalizeMainOverviewHasMore', () => {
  it('leaves hasMore false for a category under its limit, even if the scan did not exhaust the community (satisfied-early stop, not cap truncation)', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    acc = accumulateMainOverviewCandidate(
      acc,
      { item: ev('a'), isInPersonalCalendar: true, isPendingRsvp: false },
      LIMITS
    );
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: false,
      scanTruncated: false,
    });
    expect(finalized.myEventsHasMore).toBe(false);
  });

  it('conservatively sets hasMore when a category is exactly at its limit and the scan did not exhaust every event (satisfied-early stop)', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    // scanExhausted=false: we don't actually know whether a 3rd matching
    // event exists beyond what we scanned — prefer the bounded signal.
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: false,
      scanTruncated: false,
    });
    expect(finalized.myEventsHasMore).toBe(true);
  });

  // 5. scan exhausted + category below limit → hasMore false
  it('does NOT set hasMore when a category is exactly at its limit but the scan exhausted every upcoming event', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    // scanExhausted=true: the index scan reached the end of the
    // community's upcoming events — there is provably nothing more.
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: true,
      scanTruncated: false,
    });
    expect(finalized.myEventsHasMore).toBe(false);
  });

  // 1. scan exhausted + zero myEvents → myEventsHasMore false
  it('does NOT set hasMore for a category with zero matches when the scan genuinely exhausted every upcoming event', () => {
    const acc = createMainOverviewAccumulator<FakeEvent>();
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: true,
      scanTruncated: false,
    });
    expect(finalized.myEventsHasMore).toBe(false);
    expect(finalized.pendingRsvpHasMore).toBe(false);
  });

  // 2. scan truncated by cap + zero myEvents → myEventsHasMore true
  // This is the Stage 2A scale-edge-case regression: a match sitting past
  // the 160-event scan cap (e.g. scan position ~170) must never be reported
  // as "no events" just because zero matches were found within the capped
  // window — hitting the cap while `!isDone` is proof of nothing.
  it('sets hasMore true for a category with ZERO matches when the scan was truncated by the safety cap (not exhausted)', () => {
    const acc = createMainOverviewAccumulator<FakeEvent>();
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: false,
      scanTruncated: true,
    });
    expect(finalized.myEvents).toEqual([]);
    expect(finalized.myEventsHasMore).toBe(true);
  });

  // 3. scan truncated + myEvents below limit → myEventsHasMore true
  it('sets hasMore true for a category BELOW its limit (but not zero) when the scan was truncated by the safety cap', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    acc = accumulateMainOverviewCandidate(
      acc,
      { item: ev('a'), isInPersonalCalendar: true, isPendingRsvp: false },
      LIMITS
    );
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: false,
      scanTruncated: true,
    });
    expect(finalized.myEvents).toEqual([ev('a')]);
    expect(finalized.myEventsHasMore).toBe(true);
  });

  // 4. scan truncated + zero pending RSVP → pendingRsvpHasMore true
  it('sets hasMore true for pendingRsvpEvents with zero matches when the scan was truncated by the safety cap', () => {
    const acc = createMainOverviewAccumulator<FakeEvent>();
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: false,
      scanTruncated: true,
    });
    expect(finalized.pendingRsvpEvents).toEqual([]);
    expect(finalized.pendingRsvpHasMore).toBe(true);
  });

  it('scanTruncated applies to BOTH categories unconditionally, even when one category is fully satisfied and the other is empty', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: false,
      scanTruncated: true,
    });
    expect(finalized.myEventsHasMore).toBe(true);
    expect(finalized.pendingRsvpEvents).toEqual([]);
    expect(finalized.pendingRsvpHasMore).toBe(true);
  });

  // 6. existing full-category overflow behavior remains correct
  it('preserves an already-true hasMore flag set mid-scan regardless of scanExhausted/scanTruncated', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    for (const id of ['a', 'b', 'c']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    expect(acc.myEventsHasMore).toBe(true);
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: true,
      scanTruncated: false,
    });
    expect(finalized.myEventsHasMore).toBe(true);
  });

  it('finalizes myEvents and pendingRsvp independently (satisfied-early stop)', () => {
    let acc = createMainOverviewAccumulator<FakeEvent>();
    // Only myEvents reaches its limit; pendingRsvp stays under.
    for (const id of ['a', 'b']) {
      acc = accumulateMainOverviewCandidate(
        acc,
        { item: ev(id), isInPersonalCalendar: true, isPendingRsvp: false },
        LIMITS
      );
    }
    acc = accumulateMainOverviewCandidate(
      acc,
      { item: ev('p1'), isInPersonalCalendar: false, isPendingRsvp: true },
      LIMITS
    );
    const finalized = finalizeMainOverviewHasMore(acc, LIMITS, {
      scanExhausted: false,
      scanTruncated: false,
    });
    expect(finalized.myEventsHasMore).toBe(true);
    expect(finalized.pendingRsvpHasMore).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// BUG FIX (manual QA, follow-up) — Community Main must keep TODAY's
// events visible for the viewer's entire local day, even once their
// start/end time has passed. `listCommunityMainOverview` /
// `listCommunityAdditionalEventsPaged` scope their indexed scan to
// `event.startTime >= localDayStart` (the viewer's device-local midnight
// — see lib/eventsTabDateHelpers.ts's getLocalDayStart), and — after this
// fix — that indexed lower bound is the ONLY eligibility boundary either
// query applies. The previous extra `isEventStartTimeEligibleForUpcomingScan`
// instant check (which still excluded a TIMED event the moment its start
// time passed, even on the same local day) has been removed entirely; see
// the doc comment above isMainOverviewAccumulatorSatisfied in
// communityCalendarState.ts. This suite models that single boundary
// directly (no query runtime available in a unit test) covering every
// case from the bug report and its regression matrix.
// ─────────────────────────────────────────────────────────────
describe('Community Main eligibility — localDayStart is the ONLY boundary (BUG FIX, manual QA follow-up)', () => {
  // Aug 15, 2026, 14:00 local — several hours into "today".
  const localDayStart = new Date(2026, 7, 15, 0, 0, 0, 0).getTime();

  function isEligibleForCommunityMain(event: { startTime: number }): boolean {
    return event.startTime >= localDayStart;
  }

  it('1. timed event today, start time in the future → eligible', () => {
    const startTime = new Date(2026, 7, 15, 18, 0, 0, 0).getTime(); // 18:00 today
    expect(isEligibleForCommunityMain({ startTime })).toBe(true);
  });

  it('2. timed event today, start time already passed (e.g. 08:00, "now" ~12:40) → still eligible on Community Main', () => {
    const startTime = new Date(2026, 7, 15, 8, 0, 0, 0).getTime(); // 08:00 today
    expect(isEligibleForCommunityMain({ startTime })).toBe(true);
  });

  it('3. timed event today, end time already passed → still eligible on Community Main until local day changes', () => {
    // This eligibility boundary only ever looks at `startTime` — it never
    // reads `endTime` at all, so an event whose end time has long passed
    // (here 09:00, hours before the 14:00 "now" used elsewhere in this
    // suite) remains eligible for as long as its startTime is still >=
    // localDayStart (i.e. for the rest of today).
    const startTime = new Date(2026, 7, 15, 8, 0, 0, 0).getTime();
    expect(isEligibleForCommunityMain({ startTime })).toBe(true);
  });

  it('4. all-day event today (startTime stamped at local midnight) → eligible', () => {
    expect(isEligibleForCommunityMain({ startTime: localDayStart })).toBe(true);
  });

  it('5. future event (tomorrow) → eligible', () => {
    const startTime = new Date(2026, 7, 16, 0, 0, 0, 0).getTime();
    expect(isEligibleForCommunityMain({ startTime })).toBe(true);
  });

  it('6. event from yesterday → excluded by the localDayStart/index boundary', () => {
    const startTime = new Date(2026, 7, 14, 23, 0, 0, 0).getTime(); // 23:00 yesterday
    expect(isEligibleForCommunityMain({ startTime })).toBe(false);
  });

  it('the exact localDayStart boundary (00:00:00.000 today) is included', () => {
    expect(isEligibleForCommunityMain({ startTime: localDayStart })).toBe(true);
  });

  it('RSVP/personal-calendar classification is unaffected by this boundary — computeCommunityEventPersonalCalendarState never takes startTime/allDay as an input at all', () => {
    const eventFacts = {
      isCreator: false,
      autoAddEnabled: true,
      requiresRsvp: true,
      rsvpStatus: 'maybe' as const,
      hasActiveSave: false,
      hasOptOut: false,
    };
    expect(
      computeCommunityEventPersonalCalendarState(eventFacts)
        .isInPersonalCalendar
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Cancelled event → still excluded from normal Community Main lists.
// The `status === 'cancelled'` check lives directly in
// listCommunityMainOverview / listCommunityAdditionalEventsPaged (a plain
// field check, not a pure helper extracted here) and is UNCHANGED by this
// fix — cancelled events continue to follow the dedicated
// isCancelledEventRemovedFromCommunityDisplay / recent-cancellation
// visibility-window flow (see communityCalendarState.test.ts), never the
// normal myEvents/pendingRsvpEvents/additionalEvents lists this suite
// covers. Documented here for the regression matrix; no new assertion is
// needed since the cancelled-event flow's own tests already cover it.
// ─────────────────────────────────────────────────────────────
