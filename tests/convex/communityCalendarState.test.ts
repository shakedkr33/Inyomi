/**
 * Tests for communityCalendarState.ts
 *
 * Run with: bun test
 *
 * Stage 1A regression coverage for the RSVP "maybe" consistency fix:
 * confirms that "yes" and "maybe" are treated identically for personal
 * calendar/Home inclusion, that "no" and unanswered RSVPs are excluded
 * (for ordinary, non-privileged members), and that the not-yet-wired
 * classification helper agrees with the same rule.
 *
 * Stage 1D adds coverage for the two independent dimensions introduced by
 * per-community auto-add and the owner/admin personal-calendar bypass
 * removal: `computeIsSavedToMyCalendar` (personal calendar inclusion —
 * replaces the old, now-retired `shouldIncludeInPersonalHomeCalendar`) and
 * `computeRsvpAttentionState` (RSVP/attention state). See the Stage 1D test
 * matrix for the full scenario list this section covers.
 */

import { describe, expect, it } from 'bun:test';

import type { Id } from '../../convex/_generated/dataModel';
import {
  classifyCommunityEventForEventsTab,
  classifyCommunityEventForViewer,
  computeCommunityEventPersonalCalendarState,
  computeIsSavedToMyCalendar,
  computeRsvpAttentionState,
  isEligibleForAdditionalCommunityEvent,
  isEligibleForEventsTabNonPersonalSection,
  isEligibleForMainMyEvents,
  isYesOrMaybeRsvp,
  resolveDuplicationSourceVerdict,
} from '../../convex/communityCalendarState';

describe('isYesOrMaybeRsvp', () => {
  it('returns true for "yes"', () => {
    expect(isYesOrMaybeRsvp('yes')).toBe(true);
  });

  it('returns true for "maybe"', () => {
    expect(isYesOrMaybeRsvp('maybe')).toBe(true);
  });

  it('returns false for "no"', () => {
    expect(isYesOrMaybeRsvp('no')).toBe(false);
  });

  it('returns false for "none"', () => {
    expect(isYesOrMaybeRsvp('none')).toBe(false);
  });

  it('returns false for unanswered (undefined)', () => {
    expect(isYesOrMaybeRsvp(undefined)).toBe(false);
  });
});

describe('computeIsSavedToMyCalendar — RSVP-required events, auto-add OFF (ordinary member)', () => {
  const base = {
    isCreator: false,
    autoAddEnabled: false,
    requiresRsvp: true,
    hasActiveSave: false,
    hasOptOut: false,
  };

  it('[matrix #3] includes RSVP = yes', () => {
    expect(computeIsSavedToMyCalendar({ ...base, rsvpStatus: 'yes' })).toBe(
      true
    );
  });

  it('[matrix #4] includes RSVP = maybe', () => {
    expect(computeIsSavedToMyCalendar({ ...base, rsvpStatus: 'maybe' })).toBe(
      true
    );
  });

  it('[matrix #5] excludes RSVP = no (no other inclusion source)', () => {
    expect(computeIsSavedToMyCalendar({ ...base, rsvpStatus: 'no' })).toBe(
      false
    );
  });

  it('[matrix #6] excludes unanswered RSVP', () => {
    expect(computeIsSavedToMyCalendar({ ...base, rsvpStatus: undefined })).toBe(
      false
    );
  });

  it('opt-out always wins, even over RSVP = yes', () => {
    expect(
      computeIsSavedToMyCalendar({
        ...base,
        rsvpStatus: 'yes',
        hasOptOut: true,
      })
    ).toBe(false);
  });

  it('an explicit save (e.g. from task claim) includes regardless of RSVP', () => {
    expect(
      computeIsSavedToMyCalendar({
        ...base,
        rsvpStatus: undefined,
        hasActiveSave: true,
      })
    ).toBe(true);
  });
});

describe('computeIsSavedToMyCalendar — non-RSVP/open events, auto-add OFF (ordinary member)', () => {
  const base = {
    isCreator: false,
    autoAddEnabled: false,
    requiresRsvp: false,
    hasOptOut: false,
  };

  it('[matrix #2] includes when saved to calendar', () => {
    expect(
      computeIsSavedToMyCalendar({
        ...base,
        rsvpStatus: 'none',
        hasActiveSave: true,
      })
    ).toBe(true);
  });

  it('[matrix #1] excludes when not saved', () => {
    expect(
      computeIsSavedToMyCalendar({
        ...base,
        rsvpStatus: 'none',
        hasActiveSave: false,
      })
    ).toBe(false);
  });
});

describe('computeIsSavedToMyCalendar — auto-add ON', () => {
  it('[matrix #7] open, unsaved -> included', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: false,
        rsvpStatus: 'none',
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });

  it('[matrix #8] RSVP-required, unanswered -> included (RSVP still pending — see computeRsvpAttentionState)', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });

  it('[matrix #9] RSVP = yes -> included', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: 'yes',
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });

  it('[matrix #10] RSVP = maybe -> included', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: 'maybe',
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });

  it('[matrix #11] RSVP = no -> included anyway (auto-add is independent of RSVP)', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: 'no',
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });

  it('[matrix #12] event opt-out -> excluded regardless of RSVP/save/auto-add', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: 'yes',
        hasActiveSave: true,
        hasOptOut: true,
      })
    ).toBe(false);
  });
});

describe('computeIsSavedToMyCalendar — manager (owner/admin) role is NOT a personal-inclusion reason', () => {
  it('[matrix #13] not creator, auto-add OFF, unanswered/unsaved -> NOT included (management role alone is irrelevant here — caller must not pass role-derived isCreator)', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(false);
  });

  it('[matrix #14] not creator, auto-add ON -> included because of AUTO-ADD, not management role', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });
});

describe('computeIsSavedToMyCalendar — creator', () => {
  it('[matrix #15] creator is included regardless of RSVP (existing behavior preserved)', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: true,
        autoAddEnabled: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });

  it('opt-out still wins over creator inclusion', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: true,
        autoAddEnabled: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: true,
      })
    ).toBe(false);
  });
});

describe('computeIsSavedToMyCalendar — auto-add OFF after being ON (no bulk removal, only auto-add-only inclusion drops)', () => {
  it('[matrix #19] event included ONLY because of auto-add -> no longer included once auto-add is OFF', () => {
    const includedWhileOn = computeIsSavedToMyCalendar({
      isCreator: false,
      autoAddEnabled: true,
      requiresRsvp: true,
      rsvpStatus: undefined,
      hasActiveSave: false,
      hasOptOut: false,
    });
    const includedWhileOff = computeIsSavedToMyCalendar({
      isCreator: false,
      autoAddEnabled: false,
      requiresRsvp: true,
      rsvpStatus: undefined,
      hasActiveSave: false,
      hasOptOut: false,
    });
    expect(includedWhileOn).toBe(true);
    expect(includedWhileOff).toBe(false);
  });

  it('[matrix #20] event with RSVP yes remains included once auto-add is OFF', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: false,
        requiresRsvp: true,
        rsvpStatus: 'yes',
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toBe(true);
  });

  it('[matrix #21] explicit manually-saved open event remains included once auto-add is OFF', () => {
    expect(
      computeIsSavedToMyCalendar({
        isCreator: false,
        autoAddEnabled: false,
        requiresRsvp: false,
        rsvpStatus: 'none',
        hasActiveSave: true,
        hasOptOut: false,
      })
    ).toBe(true);
  });
});

describe('computeRsvpAttentionState — independent RSVP/attention dimension', () => {
  it('open/non-RSVP events are always not_applicable', () => {
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: false,
        rsvpStatus: 'none',
      })
    ).toBe('not_applicable');
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: undefined,
        rsvpStatus: 'yes',
      })
    ).toBe('not_applicable');
  });

  it('RSVP-required + unanswered -> pending', () => {
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
      })
    ).toBe('pending');
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'none',
      })
    ).toBe('pending');
  });

  it('RSVP-required + yes/maybe/no -> answered', () => {
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'yes',
      })
    ).toBe('answered');
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'maybe',
      })
    ).toBe('answered');
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'no',
      })
    ).toBe('answered');
  });
});

/**
 * QA FIX (Issue 3) — the event CREATOR is the organizer and must never be
 * treated as needing to RSVP to their own event, regardless of RSVP
 * requirement or answer state. This exemption is scoped to the actual
 * creator ONLY — see the next describe block for non-creator owner/admin,
 * which must still follow normal RSVP rules.
 */
describe('computeRsvpAttentionState — creator RSVP exemption (Issue 3)', () => {
  it('[TEST 1] creator + requiresRsvp + unanswered -> NOT pending (not_applicable)', () => {
    expect(
      computeRsvpAttentionState({
        isCreator: true,
        requiresRsvp: true,
        rsvpStatus: undefined,
      })
    ).toBe('not_applicable');
  });

  it('creator + requiresRsvp + explicit "no" -> still not_applicable (creator exemption wins)', () => {
    expect(
      computeRsvpAttentionState({
        isCreator: true,
        requiresRsvp: true,
        rsvpStatus: 'no',
      })
    ).toBe('not_applicable');
  });

  it('[TEST 4] normal member (non-creator) + requiresRsvp + unanswered -> pending', () => {
    expect(
      computeRsvpAttentionState({
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
      })
    ).toBe('pending');
  });
});

describe('computeCommunityEventPersonalCalendarState — creator RSVP exemption + personal inclusion (Issue 3)', () => {
  it('[TEST 1 + 5] creator + requiresRsvp + unanswered -> NOT pending AND remains personally included', () => {
    expect(
      computeCommunityEventPersonalCalendarState({
        isCreator: true,
        autoAddEnabled: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toEqual({
      isInPersonalCalendar: true,
      rsvpAttentionState: 'not_applicable',
    });
  });

  it('[TEST 2] non-creator OWNER + requiresRsvp + unanswered -> pending RSVP (management role alone is not creator status)', () => {
    expect(
      computeCommunityEventPersonalCalendarState({
        isCreator: false, // caller must resolve isCreator from event.createdBy, never from role
        autoAddEnabled: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toEqual({ isInPersonalCalendar: false, rsvpAttentionState: 'pending' });
  });

  it('[TEST 3] non-creator ADMIN + requiresRsvp + unanswered -> pending RSVP', () => {
    expect(
      computeCommunityEventPersonalCalendarState({
        isCreator: false,
        autoAddEnabled: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toEqual({ isInPersonalCalendar: false, rsvpAttentionState: 'pending' });
  });
});

describe('computeCommunityEventPersonalCalendarState — both dimensions stay independently observable', () => {
  it('[matrix #8, combined] auto-add ON + RSVP unanswered -> included AND pending simultaneously', () => {
    expect(
      computeCommunityEventPersonalCalendarState({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toEqual({ isInPersonalCalendar: true, rsvpAttentionState: 'pending' });
  });

  it('[matrix #11, combined] auto-add ON + RSVP no -> included AND answered simultaneously', () => {
    expect(
      computeCommunityEventPersonalCalendarState({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: 'no',
        hasActiveSave: false,
        hasOptOut: false,
      })
    ).toEqual({ isInPersonalCalendar: true, rsvpAttentionState: 'answered' });
  });

  it('opt-out -> excluded regardless of RSVP attention state', () => {
    expect(
      computeCommunityEventPersonalCalendarState({
        isCreator: false,
        autoAddEnabled: true,
        requiresRsvp: true,
        rsvpStatus: undefined,
        hasActiveSave: false,
        hasOptOut: true,
      })
    ).toEqual({ isInPersonalCalendar: false, rsvpAttentionState: 'pending' });
  });
});

/**
 * Matrix items #16–#18 exercise write-path mutation behavior
 * (saveCommunityEventToPersonalCalendar / removeCommunityEventFromPersonalCalendar,
 * task claim/assignment) that requires a real MutationCtx and cannot be
 * driven through these pure-function unit tests. They were verified by code
 * review instead — see the Stage 1D report:
 *   #16 task assignment/claim  -> convex/eventTasks.ts (unchanged; still
 *       calls saveCommunityEventToPersonalCalendar and does not touch
 *       opt-outs).
 *   #17 RSVP event removed from calendar -> RSVP unchanged, opt-out created,
 *       event excluded -> convex/communityEventCalendarHelpers.ts's
 *       removeCommunityEventFromPersonalCalendar (opt-out write no longer
 *       gated on requiresRsvp === false).
 *   #18 explicit add-back -> opt-out cleared, event included per normal
 *       rules -> convex/communityEventCalendarHelpers.ts's
 *       saveCommunityEventToPersonalCalendar (already clears opt-out
 *       unconditionally) + convex/communityEventCalendar.ts's
 *       addCommunityEventToMyCalendar (RSVP-required guard removed).
 */

/**
 * QA FIX (Issue 2) — eligibility rule for the community Main "אירועים
 * נוספים" section: upcoming community events the viewer can still
 * discover and optionally add, i.e. NOT already personally included and
 * NOT an unanswered RSVP the viewer still owes a response to. See
 * convex/events.ts's listCommunityAdditionalEventsPaged for how this is
 * combined with computeCommunityEventPersonalCalendarState in the actual
 * paginated query.
 */
describe('isEligibleForAdditionalCommunityEvent — Issue 2 eligibility rule', () => {
  it('[TEST 12] open/non-RSVP event, not in personal calendar -> eligible', () => {
    expect(
      isEligibleForAdditionalCommunityEvent({
        rsvpStatus: 'none',
        isInPersonalCalendar: false,
        rsvpAttentionState: 'not_applicable',
      })
    ).toBe(true);
  });

  it('[TEST 13] event already personally included -> NOT eligible (avoid duplicate across sections)', () => {
    expect(
      isEligibleForAdditionalCommunityEvent({
        rsvpStatus: 'none',
        isInPersonalCalendar: true,
        rsvpAttentionState: 'not_applicable',
      })
    ).toBe(false);
  });

  it('[TEST 14] unanswered RSVP event -> NOT eligible (belongs in "מחכים לתגובה", not "אירועים נוספים")', () => {
    expect(
      isEligibleForAdditionalCommunityEvent({
        rsvpStatus: undefined,
        isInPersonalCalendar: false,
        rsvpAttentionState: 'pending',
      })
    ).toBe(false);
  });

  it('[COMMUNITY MAIN CORRECTION — supersedes former TEST 15] RSVP = "no" -> eligible (RSVP=no is a deliberate answer the viewer can change; Main must always surface a "שינוי תשובה" path)', () => {
    expect(
      isEligibleForAdditionalCommunityEvent({
        rsvpStatus: 'no',
        isInPersonalCalendar: false,
        rsvpAttentionState: 'answered',
      })
    ).toBe(true);
  });

  it('COMMUNITY MAIN CORRECTION: RSVP = "no" -> eligible even when isInPersonalCalendar is true (e.g. auto-add/save/task-assignment) — RSVP=no takes precedence over personal-calendar inclusion for THIS eligibility rule only; it does not remove the event from the personal calendar itself', () => {
    expect(
      isEligibleForAdditionalCommunityEvent({
        rsvpStatus: 'no',
        isInPersonalCalendar: true,
        rsvpAttentionState: 'answered',
      })
    ).toBe(true);
  });

  it('[TEST 16] previously auto-added then explicitly opted-out open event -> eligible again (re-addable via "הוסף ליומן")', () => {
    // Opt-out wins in computeIsSavedToMyCalendar, so isInPersonalCalendar is
    // false here even though auto-add is ON — that is exactly the signal
    // that should make it discoverable again.
    expect(
      isEligibleForAdditionalCommunityEvent({
        rsvpStatus: 'none',
        isInPersonalCalendar: false,
        rsvpAttentionState: 'not_applicable',
      })
    ).toBe(true);
  });

  it('RSVP-required event the viewer already answered yes/maybe but has NOT personally saved -> eligible (independent dimensions)', () => {
    // Defensive case: rsvpAttentionState 'answered' alone must not gate
    // eligibility — only actual personal-calendar inclusion does.
    expect(
      isEligibleForAdditionalCommunityEvent({
        rsvpStatus: 'maybe',
        isInPersonalCalendar: false,
        rsvpAttentionState: 'answered',
      })
    ).toBe(true);
  });
});

/**
 * COMMUNITY MAIN CORRECTION (RSVP hierarchy cleanup) — eligibility rule for
 * whether an event should count toward the `myEvents` limit in Community
 * Main's "האירועים שלי" carousel (`listCommunityMainOverview`). See the
 * full doc comment on `isEligibleForMainMyEvents` in
 * communityCalendarState.ts for the locked placement precedence this
 * matrix exercises: creator wins first, then not-in-personal-calendar,
 * then pending/RSVP=no exclusion for non-creators, then yes/maybe/non-RSVP.
 */
describe('isEligibleForMainMyEvents — Community Main placement precedence', () => {
  const pendingBase = {
    isInPersonalCalendar: true,
    requiresRsvp: true as const,
    rsvpStatus: undefined,
    rsvpAttentionState: 'pending' as const,
  };

  it('creator -> true, even when NOT in personal calendar (defensive — creators are always in personal calendar in practice)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: false,
        isCreator: true,
        requiresRsvp: true,
        rsvpStatus: undefined,
        rsvpAttentionState: 'not_applicable',
      })
    ).toBe(true);
  });

  it('creator -> true, in personal calendar, RSVP not applicable', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: true,
        isCreator: true,
        requiresRsvp: true,
        rsvpStatus: undefined,
        rsvpAttentionState: 'not_applicable',
      })
    ).toBe(true);
  });

  it('pending RSVP, non-creator, in personal calendar (e.g. auto-add) -> false (belongs in "מה חשוב עכשיו" ONLY)', () => {
    expect(
      isEligibleForMainMyEvents({ ...pendingBase, isCreator: false })
    ).toBe(false);
  });

  it('pending RSVP + auto-add, non-creator -> false (same rule — auto-add does not override the pending exclusion)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: true,
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: undefined,
        rsvpAttentionState: 'pending',
      })
    ).toBe(false);
  });

  it('RSVP="no", non-creator, in personal calendar -> false (belongs in "אירועים נוספים" ONLY)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: true,
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'no',
        rsvpAttentionState: 'answered',
      })
    ).toBe(false);
  });

  it('RSVP="no" + auto-add, non-creator -> false (same rule — auto-add does not override the RSVP=no exclusion)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: true,
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'no',
        rsvpAttentionState: 'answered',
      })
    ).toBe(false);
  });

  it('RSVP="yes" -> true when otherwise eligible (in personal calendar, non-creator)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: true,
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'yes',
        rsvpAttentionState: 'answered',
      })
    ).toBe(true);
  });

  it('RSVP="maybe" -> true when otherwise eligible (in personal calendar, non-creator)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: true,
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'maybe',
        rsvpAttentionState: 'answered',
      })
    ).toBe(true);
  });

  it('non-RSVP event, in personal calendar (e.g. explicit save), non-creator -> true (preserves existing personal-calendar eligibility, unaffected by pending/no rules)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: true,
        isCreator: false,
        requiresRsvp: false,
        rsvpStatus: 'none',
        rsvpAttentionState: 'not_applicable',
      })
    ).toBe(true);
  });

  it('not in personal calendar at all, non-creator -> false (nothing to show in "האירועים שלי")', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: false,
        isCreator: false,
        requiresRsvp: true,
        rsvpStatus: 'yes',
        rsvpAttentionState: 'answered',
      })
    ).toBe(false);
  });

  it('not in personal calendar, non-creator, RSVP-not-required -> false (still gated by isInPersonalCalendar first)', () => {
    expect(
      isEligibleForMainMyEvents({
        isInPersonalCalendar: false,
        isCreator: false,
        requiresRsvp: false,
        rsvpStatus: 'none',
        rsvpAttentionState: 'not_applicable',
      })
    ).toBe(false);
  });
});

/**
 * Stage 3 — full "אירועים" tab bucket classification. Exercises the exact
 * scenarios enumerated in the Stage 3 prompt's "TESTS — REQUIRED" section
 * (items 4-11), on top of the classification bundle used by
 * events.listCommunityEventsTabPaged.
 */
describe('classifyCommunityEventForEventsTab — Stage 3 Events tab buckets', () => {
  const base = {
    isCreator: false,
    autoAddEnabled: false,
    requiresRsvp: true,
    hasActiveSave: false,
    hasOptOut: false,
  };

  it('[TEST 4] personally-included open event (explicit save) -> isMyEvent only', () => {
    expect(
      classifyCommunityEventForEventsTab({
        ...base,
        requiresRsvp: false,
        hasActiveSave: true,
        rsvpStatus: 'none',
      })
    ).toEqual({
      isMyEvent: true,
      isPendingRsvp: false,
      isAdditionalEligible: false,
    });
  });

  it('[TEST 5] unanswered RSVP, no other inclusion reason -> isPendingRsvp only', () => {
    expect(
      classifyCommunityEventForEventsTab({ ...base, rsvpStatus: undefined })
    ).toEqual({
      isMyEvent: false,
      isPendingRsvp: true,
      isAdditionalEligible: false,
    });
  });

  it('[TEST 6] Auto-Add ON + unanswered RSVP -> BOTH isMyEvent and isPendingRsvp', () => {
    expect(
      classifyCommunityEventForEventsTab({
        ...base,
        autoAddEnabled: true,
        rsvpStatus: undefined,
      })
    ).toEqual({
      isMyEvent: true,
      isPendingRsvp: true,
      isAdditionalEligible: false,
    });
  });

  it('[TEST 7] creator + RSVP-required event -> isMyEvent, NOT pending', () => {
    expect(
      classifyCommunityEventForEventsTab({
        ...base,
        isCreator: true,
        rsvpStatus: undefined,
      })
    ).toEqual({
      isMyEvent: true,
      isPendingRsvp: false,
      isAdditionalEligible: false,
    });
  });

  it('[TEST 8] non-creator admin/owner (isCreator: false) + unanswered RSVP -> pending', () => {
    expect(
      classifyCommunityEventForEventsTab({ ...base, rsvpStatus: undefined })
    ).toEqual({
      isMyEvent: false,
      isPendingRsvp: true,
      isAdditionalEligible: false,
    });
  });

  it('[TEST 9] additional-eligible open event (not personal, not pending, rsvpStatus != no) -> isAdditionalEligible only', () => {
    expect(
      classifyCommunityEventForEventsTab({
        ...base,
        requiresRsvp: false,
        rsvpStatus: 'none',
      })
    ).toEqual({
      isMyEvent: false,
      isPendingRsvp: false,
      isAdditionalEligible: true,
    });
  });

  it('[TEST 10] explicit opt-out on an otherwise auto-added open event -> re-addable via isAdditionalEligible', () => {
    expect(
      classifyCommunityEventForEventsTab({
        ...base,
        autoAddEnabled: true,
        requiresRsvp: false,
        rsvpStatus: 'none',
        hasOptOut: true,
      })
    ).toEqual({
      isMyEvent: false,
      isPendingRsvp: false,
      isAdditionalEligible: true,
    });
  });

  it('[STAGE 3 CORRECTION — supersedes former TEST 11] RSVP = "no" + not personal + upcoming -> remains discoverable via isAdditionalEligible (Events tab has broader discoverability than Main)', () => {
    expect(
      classifyCommunityEventForEventsTab({ ...base, rsvpStatus: 'no' })
    ).toEqual({
      isMyEvent: false,
      isPendingRsvp: false,
      isAdditionalEligible: true,
    });
  });

  it('RSVP = "no" but Auto-Add ON -> still isMyEvent (independent of RSVP), never additional', () => {
    expect(
      classifyCommunityEventForEventsTab({
        ...base,
        autoAddEnabled: true,
        rsvpStatus: 'no',
      })
    ).toEqual({
      isMyEvent: true,
      isPendingRsvp: false,
      isAdditionalEligible: false,
    });
  });

  it('RSVP = "no" + explicit opt-out on an otherwise auto-added event -> not my event, still discoverable via isAdditionalEligible', () => {
    expect(
      classifyCommunityEventForEventsTab({
        ...base,
        autoAddEnabled: true,
        rsvpStatus: 'no',
        hasOptOut: true,
      })
    ).toEqual({
      isMyEvent: false,
      isPendingRsvp: false,
      isAdditionalEligible: true,
    });
  });
});

describe('isEligibleForEventsTabNonPersonalSection — Stage 3 correction (Part C)', () => {
  it('matches isEligibleForAdditionalCommunityEvent for every case EXCEPT rsvpStatus === "no"', () => {
    const scenarios: Array<{
      isInPersonalCalendar: boolean;
      rsvpAttentionState: 'pending' | 'answered' | 'not_applicable';
    }> = [
      { isInPersonalCalendar: false, rsvpAttentionState: 'not_applicable' },
      { isInPersonalCalendar: false, rsvpAttentionState: 'pending' },
      { isInPersonalCalendar: false, rsvpAttentionState: 'answered' },
      { isInPersonalCalendar: true, rsvpAttentionState: 'not_applicable' },
      { isInPersonalCalendar: true, rsvpAttentionState: 'pending' },
      { isInPersonalCalendar: true, rsvpAttentionState: 'answered' },
    ];
    for (const scenario of scenarios) {
      expect(isEligibleForEventsTabNonPersonalSection(scenario)).toBe(
        isEligibleForAdditionalCommunityEvent({
          ...scenario,
          rsvpStatus: 'yes',
        })
      );
    }
  });

  it('COMMUNITY MAIN CORRECTION: for isInPersonalCalendar=false + RSVP="no", both functions now agree (both eligible) — the two are no longer opposites for this case', () => {
    const args = {
      isInPersonalCalendar: false,
      rsvpAttentionState: 'answered' as const,
    };
    expect(isEligibleForEventsTabNonPersonalSection(args)).toBe(true);
    expect(
      isEligibleForAdditionalCommunityEvent({ ...args, rsvpStatus: 'no' })
    ).toBe(true);
  });

  it('COMMUNITY MAIN CORRECTION: for isInPersonalCalendar=true + RSVP="no", the two now diverge in the OPPOSITE direction — Main additional-eligibility wins (true, RSVP=no takes precedence) while the Events tab non-personal section still excludes it (false, since the event already belongs to isMyEvent there)', () => {
    const args = {
      isInPersonalCalendar: true,
      rsvpAttentionState: 'answered' as const,
    };
    expect(isEligibleForEventsTabNonPersonalSection(args)).toBe(false);
    expect(
      isEligibleForAdditionalCommunityEvent({ ...args, rsvpStatus: 'no' })
    ).toBe(true);
  });
});

describe('classifyCommunityEventForViewer — foundation helper agrees with shouldIncludeInPersonalHomeCalendar', () => {
  const base = {
    privileged: false,
    requiresRsvp: true,
    hasActiveSave: false,
    hasOptOut: false,
  };

  it('RSVP yes -> my_event', () => {
    expect(
      classifyCommunityEventForViewer({ ...base, rsvpStatus: 'yes' })
    ).toBe('my_event');
  });

  it('RSVP maybe -> my_event', () => {
    expect(
      classifyCommunityEventForViewer({ ...base, rsvpStatus: 'maybe' })
    ).toBe('my_event');
  });

  it('RSVP no -> other', () => {
    expect(classifyCommunityEventForViewer({ ...base, rsvpStatus: 'no' })).toBe(
      'other'
    );
  });

  it('RSVP unanswered -> pending_rsvp', () => {
    expect(
      classifyCommunityEventForViewer({ ...base, rsvpStatus: undefined })
    ).toBe('pending_rsvp');
  });

  it('open event saved -> my_event', () => {
    expect(
      classifyCommunityEventForViewer({
        ...base,
        requiresRsvp: false,
        rsvpStatus: 'none',
        hasActiveSave: true,
      })
    ).toBe('my_event');
  });

  it('open event not saved -> other', () => {
    expect(
      classifyCommunityEventForViewer({
        ...base,
        requiresRsvp: false,
        rsvpStatus: 'none',
        hasActiveSave: false,
      })
    ).toBe('other');
  });

  it('privileged user -> my_event regardless of RSVP', () => {
    expect(
      classifyCommunityEventForViewer({
        ...base,
        privileged: true,
        rsvpStatus: undefined,
      })
    ).toBe('my_event');
  });

  it('opt-out -> other even with RSVP yes', () => {
    expect(
      classifyCommunityEventForViewer({
        ...base,
        rsvpStatus: 'yes',
        hasOptOut: true,
      })
    ).toBe('other');
  });
});

/**
 * Stage 1B: app/(authenticated)/community/[id].tsx's "האירועים שלי" /
 * "אירועים נוספים" split now calls classifyCommunityEventForViewer via a
 * thin local wrapper (getCommunityEventPersonalState) that maps:
 *   - privileged  -> event creator ONLY (not owner/admin role — see Stage 1B
 *                    report: this preserves the screen's pre-existing,
 *                    confirmed behavior, which differs from the
 *                    owner/admin bypass used by Home/Calendar aggregates)
 *   - hasOptOut   -> always false (this screen has no opt-out signal wired
 *                    into its RSVP-event grouping today; unchanged from
 *                    pre-Stage-1B behavior)
 * These tests exercise that exact parameter mapping so a future change to
 * either the wrapper or the shared helper can't silently regress the
 * screen's "my events" split.
 */
describe('classifyCommunityEventForViewer — community screen mapping (creator-only privileged, no opt-out signal)', () => {
  const screenMapping = (
    rsvpStatus: 'yes' | 'no' | 'maybe' | 'none',
    isCreator: boolean
  ) =>
    classifyCommunityEventForViewer({
      privileged: isCreator,
      requiresRsvp: true,
      rsvpStatus,
      hasActiveSave: false,
      hasOptOut: false,
    });

  it('RSVP yes, not creator -> my_event (shown in "האירועים שלי")', () => {
    expect(screenMapping('yes', false)).toBe('my_event');
  });

  it('RSVP maybe, not creator -> my_event (now shown in "האירועים שלי")', () => {
    expect(screenMapping('maybe', false)).toBe('my_event');
  });

  it('RSVP no, not creator -> other (shown in "אירועים נוספים")', () => {
    expect(screenMapping('no', false)).toBe('other');
  });

  it('RSVP unanswered, not creator -> pending_rsvp (shown in "אירועים נוספים" for now)', () => {
    expect(screenMapping('none', false)).toBe('pending_rsvp');
  });

  it('creator, RSVP unanswered -> my_event (creator bypass preserved)', () => {
    expect(screenMapping('none', true)).toBe('my_event');
  });

  it('creator, RSVP no -> my_event (creator bypass preserved even over RSVP no)', () => {
    expect(screenMapping('no', true)).toBe('my_event');
  });
});

/**
 * Stage 3 correction — Part 3: pure decision logic behind
 * `events.verifyDuplicationSource` (server-side defense-in-depth for
 * community event duplication). See convex/events.ts for the query that
 * fetches communityExists/canCreateCommunityEvent/event and delegates the
 * actual decision to this function unchanged.
 */
describe('resolveDuplicationSourceVerdict (Stage 3 correction, Part 3)', () => {
  const communityA = 'community-a' as Id<'communities'>;
  const communityB = 'community-b' as Id<'communities'>;

  it('[matching community] allows duplication when the source event belongs to the target community and the caller can create events there', () => {
    expect(
      resolveDuplicationSourceVerdict({
        communityExists: true,
        canCreateCommunityEvent: true,
        event: { communityId: communityA },
        targetCommunityId: communityA,
      })
    ).toBe('ok');
  });

  it('[different community] rejects duplication when the source event belongs to a DIFFERENT community than the one being duplicated into', () => {
    expect(
      resolveDuplicationSourceVerdict({
        communityExists: true,
        canCreateCommunityEvent: true,
        event: { communityId: communityB },
        targetCommunityId: communityA,
      })
    ).toBe('community_mismatch');
  });

  it('rejects when the target community does not exist (or is archived)', () => {
    expect(
      resolveDuplicationSourceVerdict({
        communityExists: false,
        canCreateCommunityEvent: true,
        event: { communityId: communityA },
        targetCommunityId: communityA,
      })
    ).toBe('not_found');
  });

  it('rejects when the caller is not an owner/admin of the target community, even if the event matches', () => {
    expect(
      resolveDuplicationSourceVerdict({
        communityExists: true,
        canCreateCommunityEvent: false,
        event: { communityId: communityA },
        targetCommunityId: communityA,
      })
    ).toBe('forbidden');
  });

  it('permission is checked BEFORE community-match, so a forbidden caller never learns whether the event matches', () => {
    expect(
      resolveDuplicationSourceVerdict({
        communityExists: true,
        canCreateCommunityEvent: false,
        event: { communityId: communityB },
        targetCommunityId: communityA,
      })
    ).toBe('forbidden');
  });

  it('rejects when the source event does not exist', () => {
    expect(
      resolveDuplicationSourceVerdict({
        communityExists: true,
        canCreateCommunityEvent: true,
        event: null,
        targetCommunityId: communityA,
      })
    ).toBe('not_found');
  });

  it('rejects a personal (non-community) event — communityId undefined can never match any target', () => {
    expect(
      resolveDuplicationSourceVerdict({
        communityExists: true,
        canCreateCommunityEvent: true,
        event: { communityId: undefined },
        targetCommunityId: communityA,
      })
    ).toBe('community_mismatch');
  });
});
