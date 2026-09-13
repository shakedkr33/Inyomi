/**
 * COMMUNITY EVENT TASK CLAIM BUTTON — focused fix.
 *
 * Determines whether a regular (non-manager) community-event viewer may see
 * the self-claim/unclaim action ("אני אקח") for a Community Event Task in
 * the canonical full-screen Event Details screen
 * (app/(authenticated)/event/[id].tsx).
 *
 * ROOT CAUSE THIS FIXES: the claim action previously required
 * `myCommunityMembership` (sourced from a separate `getCommunityMembers`
 * query) in addition to `participantsCanSeeTasks`. The task LIST itself is
 * already server-authorized — `convex/eventTasks.ts`'s `listByEvent` only
 * returns tasks the viewer is allowed to see (it independently verifies
 * active community membership server-side before returning anything, see
 * `isActiveCommunityMember` there). Requiring a second, independently
 * timed client query (`getCommunityMembers`) to resolve before revealing an
 * action on data that was already authorized and returned created a
 * contradictory UI state: the task title was visible, but "אני אקח" was
 * hidden until the second query happened to resolve.
 *
 * This helper removes that second client-side authorization dependency.
 * The real permission boundary remains entirely server-side: `listByEvent`
 * (visibility) and `claimEventTask` (the mutation's own authorization
 * check) are unchanged.
 *
 * Deliberately independent of RSVP status — RSVP and Community Event Task
 * participation are separate axes (see the two-axis model comments in
 * convex/eventTasks.ts). Unanswered RSVP must never hide or block a claim.
 */
export function canShowCommunityEventSelfClaimAction(params: {
  /** Whether this event belongs to a community (vs. a Personal Event). */
  isCommunityEvent: boolean;
  /**
   * The event's `tasksVisibleToParticipants` flag, resolved to a boolean
   * (`event.tasksVisibleToParticipants === true`). When `false`, regular
   * members never see unassigned tasks in the first place (server-side
   * filtering in `listByEvent` already enforces this before the task ever
   * reaches the client), so this stays a required condition.
   */
  participantsCanSeeTasks: boolean;
}): boolean {
  return params.isCommunityEvent && params.participantsCanSeeTasks;
}
