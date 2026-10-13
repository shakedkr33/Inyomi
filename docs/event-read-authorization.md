# Event read authorization

Status: implemented in the working tree; live two-account and iOS/Android verification pending.
Scope: P0 privacy authorization fixes. This is an engineering contract, not a public privacy policy.

## Personal events and attachments

`convex/eventAccess.ts` supplies the read check used by `events.getById`,
`events.getEventAttachmentUrl`, and the same-space personal branch of
`events.listByDateRange`, and personal-event `tasks.listEventImportantItems`:

- The creator may read their event.
- `sharedWithUserIds` grants access to the named authenticated user.
- `sharedWithFamilyMemberIds` grants access through a member row whose `userId`
  belongs to the caller, including explicit cross-space sharing.
- `allFamily: true` grants access to actual access-kind members of that event's
  space. A pending phone match alone does not grant access.
- Merely belonging to the same space, a participant display string, or an
  `ownerScope` value does not grant access to an unshared event.
- Google-imported personal events follow the same rules; later explicit sharing
  is supported without changing import/OAuth behavior.
- Attachment lookup additionally requires that the requested storage ID is
  referenced by the authorized event. Denied lookups return null before getUrl.

Calendar presentation filters (time range, cancellation, trash, personal opt-out)
remain separate from authorization. An authorized detail need not appear in every
calendar view. Community detail/attachments still require active membership in
that community, even for the creator; legacy membership status follows the
existing `isActiveCommunityMember` convention.

## Community task management follow-up (2026-10-13)

Community task management requires active membership even for the event creator.
The shared guard covers creation (single/batch), title editing, deletion and
reordering. Active creators and active owners/admins retain management permission;
ordinary members retain existing claim, own-release and completion rules. Assignment,
completion and visibility already check active membership separately. Personal-event
creator management is unchanged; family creator-orphan rules are not extended to
community tasks.

Leaving/removal deletes the membership row in current community flows. Missing rows,
`left` and `pending` deny management; an existing legacy row without a status remains
active under the established helper. There is no separate suspended status in the
current schema. No membership or ownership records are modified by this fix.

Both this guard and combined personal participant/task deletion have real-handler
regression coverage in `tests/convex/personalEventPackage1.test.ts`, with synthetic
DB/auth adapters. Local verification does not establish deployed transaction isolation
or device behavior; two-account iPhone/Android QA remains pending.

## Personal event task access

The focused personal-task security fix implements the current requested contract
at `eventTasks.listByEvent` and the mutation boundary:

- Creators read and manage their event's tasks. An authenticated account explicitly
  named by `assignedToUserId` can read and toggle its own task, even across spaces.
- Explicit user/profile invitees can read all tasks only when
  `tasksVisibleToParticipants === true`; otherwise they receive only their own
  assignments. Profile identity uses the existing trusted `members.userId` rule.
- `allFamily` alone grants no task-list access. Assignment alone grants no event
  details, attachments, RSVP eligibility, or task-management rights. Manual names
  and discovery-only phone matches are never authenticated task identities.
- Personal-task completion requires the creator or that task's assigned account.
  Personal reassignment requires the creator. Existing removal of one's own
  assignment is retained; unrelated users cannot claim an unassigned personal
  task through `setAssignee`. Existing legacy/manual records are not converted.
- Cancelled (`status === 'cancelled'`) and soft-deleted (`deletedAt !== undefined`)
  tasks remain readable under those same permissions. Completion, assignment,
  claim and unclaim mutations reject these event states, including community
  task mutations. No cancellation/deletion lifecycle or stored history is changed.
- Active community membership, manager permissions, task visibility and completion
  behavior remain unchanged for active community events.

The subsequent [Personal event Package 1 contract](personal-event-participants.md)
adds verified invitation construction, optional participant provenance, atomic personal
form saves and account-backed assignment defaults. Existing assignment feeds now
include readable personal events; assignment-only legacy tasks without event access
appear as undated rows in My Tasks, without source-event metadata or navigation. Historical records are not
migrated, and full event access is never granted to compensate for task discovery.

Local direct-handler regression coverage lives in
`tests/convex/personalEventTaskSecurity.test.ts`; deployment and iPhone/Android
multi-account verification remain pending.

Local security-fix verification (2026-10-12):

```sh
bun test tests/convex/personalEventTaskSecurity.test.ts
bun test tests/convex/eventTask*.test.ts tests/convex/eventRsvp*.test.ts tests/convex/community*.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/pendingRsvpAssignedTaskIndicator.test.ts tests/convex/eventsListByDateRangeCategory2.test.ts
bunx tsc --noEmit -p convex/tsconfig.json
bunx biome check convex/eventTasks.ts convex/eventRsvps.ts tests/convex/personalEventTaskSecurity.test.ts
bunx biome check tests/convex/eventTaskClaimVisibility.test.ts
git diff --check
```

Results: new suite 210 passed / 0 failed (129 passed / 81 failed before the fix);
existing regressions 552 passed / 0 failed. The first regression run had one
source-text assertion failure expecting the old visibility expression; its
expected expression was updated while preserving the visibility assertion.
Convex TypeScript and diff whitespace checks passed. Source/new-test Biome has
0 errors and the same 4 RSVP optional-chain warnings observed before editing.
The existing claim-visibility test has 2 pre-existing Biome errors (import order
and formatting), reproduced against its HEAD contents using the repository's
Biome config; unrelated formatting was preserved. Tests invoke real handlers
with synthetic records, without Convex transaction/runtime emulation.
No deployment, live data mutation, migration, commit or push was performed.

## RSVP reads and writes

`eventRsvps.getRsvpForUser` and `listByEvent` require authentication and an
existing event. Active community members (including owner/admin/member) can read
that community event's RSVP records. For personal events the creator can read
all RSVP records; explicitly invited users can read only their own. `allFamily`
alone is not an RSVP invitation. Discovery-only phone matches are not accepted
as personal RSVP identities.

`upsertRsvp` and `setRsvpNoAndUnclaimMyEventTasks` now use that same explicit
invitation predicate (`canReadPersonalEvent` with `allFamily: false`). Only the
server-authenticated caller's RSVP and, for cancellation, their own assignments
can change. No on-behalf-of write endpoint exists here. Creator access is retained
for personal events; community owners/admins/creators still need active membership
(legacy missing status retains its established active interpretation). Pending,
left and absent community membership deny writes. Explicit cross-space personal
invitations remain independent of family membership; removing membership alone
does not remove an explicit user/member-row invitation. A phone match or family
membership alone is never an invitation. Existing assigned-task refusal and
explicit cancellation/unclaim behavior are unchanged.

Both RSVP write mutations additionally share `assertEventAcceptsRsvp`, called
after invitation/membership authorization and before any writes. Cancellation
rejects with `האירוע בוטל`; any defined `deletedAt` rejects with `האירוע נמחק`.
The creator has no lifecycle bypass. The rule applies to every RSVP status and
the combined decline/unclaim mutation, for personal and community events alike.
Existing responses and assignments are untouched on rejection; authorized RSVP
history reads retain their existing behavior. `removedFromCommunityAt` is a
presentation flag on already-cancelled community events, not a separate RSVP
eligibility state.

### Family RSVP regression review (2026-10-12)

Outcome: Case B for `allFamily` alone; no authorization change. The pre-security
`canAccessPersonalEventRsvp` helper also required creator identity or an explicit
user/profile invitation and did not consider `allFamily`. Personal RSVP exists,
but is invitation-based: `EventDetailsBottomSheet.isPersonalInvitee`, Home and
calendar pending-invite presentation all check explicit invitation arrays.
A member who can only read through `allFamily` has no personal RSVP controls.

The “כולם” selector in `ParticipantsCard` passes the current family profile IDs;
`EventScreen.onFamilyChange` saves both `allFamily` and explicit profile/user
invitations. Those named recipients retain RSVP access through the invitation.
A later family member not in that saved snapshot gains visibility, not RSVP.
The label therefore must not be interpreted as a dynamic invitation to every
future member. Removing access alone also does not revoke a separate explicit
invitation; this review does not change that existing rule.

Existing client inconsistencies, outside this correction's scope:
`EventScreen` derives `sharedWithUserIds` from `matchedUserId`, and
`listMyFamilyContacts.selfEntityId` still accepts `matchedUserId`. The former can
persist a phone-discovered account as an explicit invitee (which the server then
accepts as an explicit invitation); the latter can show RSVP controls which the
hardened server rejects if only a profile invitation exists. Thus rejecting
phone-only identities at the RSVP endpoints is not proof that invitation
construction is fully hardened. Also, the full event route gates response
controls on `requiresRsvp`, while personal invitee controls live in the bottom
sheet; full-route personal RSVP parity is not established by this review.

The expanded `finalWriteAuthorization.test.ts` exercises both registered write
handlers with synthetic records: all-family visibility alone, manual profiles,
phone-only profiles without access, removed access and access to another space
are denied; all-family events with explicit user/profile invitations allow only
the caller's response, even with a forged target user ID passed to the handler.
Existing creator, community-role and read-authorization coverage is retained.
Direct handler invocation does not emulate Convex argument validation or device
flows. iPhone, Android and two-account verification remain pending.

Review validation commands (local synthetic data only):

```sh
bun test tests/convex/finalWriteAuthorization.test.ts tests/convex/privacyAuthorization.test.ts
bun test tests/convex/familyMembershipPhase1Invariants.test.ts tests/convex/canonicalFamilyMembers.test.ts tests/convex/calendarProfileFilter.test.ts tests/convex/communityCalendarState.test.ts tests/convex/eventTaskRsvpDecoupling.test.ts tests/convex/eventRsvpUnanswered.test.ts tests/convex/pendingRsvpAssignedTaskIndicator.test.ts tests/convex/eventTaskClaimVisibility.test.ts tests/convex/communityTaskAssignmentSave.test.ts tests/convex/eventTasksCommunityAssigneeIntegrity.test.ts
bunx tsc --noEmit -p convex/tsconfig.json
bunx biome check tests/convex/finalWriteAuthorization.test.ts convex/eventRsvps.ts convex/eventAccess.ts
git diff --check
```

Results: 180 + 244 tests passed, including 12 added family RSVP cases; Convex
TypeScript passed. Final Biome check passed with four existing optional-chain
warnings in unchanged `eventRsvps.ts`. The initial check caught two formatting
issues in the added test fixtures, corrected before the final check. Diff
whitespace check passed. No server/UI implementation, deployment, live data,
commit or push was changed/performed by this review.

## Share links and linked recipients

`shareLinks.getMyShareLink` requires the event creator, matching existing create
and revoke permission. Being an editor, family admin, invitee, or community admin
alone does not grant share-token management. No current UI callers of this query
or `getRsvpForUser` were found; they remain callable server endpoints.

Public `getSharePreview` continues to accept a valid non-revoked token without
login and returns its existing limited projection. Saved linked-event recipients
retain their separate limited-detail path; holding a link does not grant full
source-event or attachment access.

`linkedEvents.getLinkedEventsForSpace` requires an authenticated caller with
an access-kind `members` row for the exact requested space, using
`hasAccessRowForSpace` and rows queried by the authenticated user ID. Admins,
ordinary members (including accepted family invitees), and legacy access rows
are supported. A family entity, pending phone invitation, explicit source-event
share, or saved linked event alone does not grant space-list access. Denied
requests return `[]` before reading linked rows or source events.

Authorized members retain the existing space-wide limited projection, including
events saved by other members, live/cancelled source data, deleted-source
snapshots, and date-range filtering. Personal-space access uses the same rule.
The recipient-only `getLinkedEventDetail` path remains independent of membership.
Removing the access row revokes list access even if an entity or saved link remains.

`linkedEvents.saveLinkedEvent` requires the same authenticated access-kind
membership in the exact destination space, and verifies the space still exists
before reading the share link or inserting a record. A token authorizes the
source, not the destination. Unauthorized writes throw a permission error;
deleted destinations cannot receive orphan records through stale memberships.
Valid/non-revoked token, existing source, no saving one's own source, and the
per-recipient/source duplicate checks remain unchanged. Authorized personal and
family destinations retain the existing limited snapshot and cancelled status.

`linkedEvents.copyLinkedEvent` now requires ownership of the saved link and
`requireSpaceWriteAccess` for its stored destination before reading source data
or writing. The destination must exist and the caller must still have an access
row there, including legacy access inference. Stale links, entity-only profiles
and former membership cannot grant destination writes. A denied request retains
the saved record. Successful copies keep the existing limited live/snapshot data,
personal ownership, source event and other recipients' references; only the
caller's saved link is consumed, so retrying that ID cannot create another copy.
Public previews and historical records are unchanged.

## Validation and limits

`tests/convex/privacyAuthorization.test.ts` invokes real registered handlers
against an in-memory DB/auth/storage adapter, including denied reads and calendar
agreement. It does not emulate Convex's deployment/runtime or real device flows.
No schema, OAuth, import, account-deletion, subscription, scheduling or UI change
is part of these fixes.

The linked-space regression cases reproduced unauthorized reads before the fix
and exercise the registered handler with the same local adapter. Deployment,
two-account checks, and iPhone/Android Home/calendar checks remain pending.

Write tests use an in-memory insert/delete adapter with follow-up reads. They
cover denied writes, valid save/display/removal, duplicate and stale data cases.
These direct-handler tests do not validate malformed Convex IDs: the existing
`v.id('spaces')` argument validator remains in place; runtime rejection still
needs verification on a controlled deployment.

Family profile management now requires ownership. Authenticated-member removal
is blocked until safe personal-data migration and complete revocation are
implemented; see [the focused audit](audits/family-profile-removal-authorization.md).
The event authorization rules above remain unchanged.

Destination authorization for `events.create` and `tasks.create`, plus the
confirmed task-read rules, are documented in
[Task reads and space write authorization](task-space-authorization.md).
