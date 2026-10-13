# Personal event participants and task assignment — Package 1

Status: implemented locally for review; no deployment or real-device QA performed.
This contract follows the Package 1 request, not the broader personal-event redesign.

## Identity and persistence

`events.participantDetails` is an optional, additive array of stable IDs, display
names/colors, provenance (`family`, `contact`, `legacy`, `user`) and an optional
account ID. It is display state, never an authorization source. Existing
`participants` strings remain available to old readers; explicit invitation arrays
remain authoritative. No migration or historical relinking is performed.

`members.listMyFamilyContacts.linkedUserId` is additive. Entity profiles expose it
only under the existing `computeIsFullyJoined` invariant (matching account IDs,
joined status, completed onboarding, actual access row); access-kind self/admin
profiles use their account ID. Pets never supply an eligible account. A phone
match, including a legacy stamped `userId` without verified joining, is insufficient
for a new invitation. New user/profile invitations are validated on the server
against the creator's accessible family profiles. Existing explicit cross-space
invitations remain valid independently of current family membership.

Device contacts are display-only; no account discovery, phone-number disclosure or
invitation-delivery claim is introduced. Manual/pet profiles can be selected for
display but new selections do not enter authenticated invitation arrays. This also
prevents a later profile link from automatically converting that selection into an
invitation. Existing legacy invitation arrays are preserved on unrelated edits.

The family carousel and the + sheet share one ID-based selection transition. The
carousel displays all available family profiles, checked selection states, and + at
the end. There is no Everyone shortcut or new email entry. Legacy email/display
participants remain removable individually. `allFamily` is never reset by selecting
or removing explicit participants; its separate read-access semantics still apply.
Duplicate names are not used for identity. Historical names may be displayed beside
separate linked profiles rather than guessed to be the same person.

## Tasks, atomic edits and removal

Personal `eventTasks.create`/`createBatch` default new tasks to the server-authenticated
creator's account. Community defaults and assignment rules remain unchanged.
New personal assignments require a real user who is the creator or an explicitly
invited account with event access; profile-only invitations require verified linkage.
New manual assignments are rejected. A no-op retaining an existing manual assignment
is allowed; legacy records are not converted or silently cleared.

The form offers the creator as `אני` plus eligible account-backed participants,
deduplicated by user ID. The assignment selector is hidden when only the creator is
eligible. Existing unresolved/manual assignments retain their stored identity and
available display label until deliberately changed.

Optional `personalTaskChanges` and `deletedPersonalTaskIds` arguments on existing
`events.create`/`events.update` commit personal event fields and task edits together
in a single Convex mutation. Community flows continue using their existing pipeline.
Arguments are separated from persisted event fields. Task IDs must belong to the
specific event; new-event creation cannot reference existing task IDs. Assignment
and completion lifecycle restrictions remain server-enforced. No live records or
schema migration were run; the optional schema/API additions need controlled deployment.

Personal edits diff against an immutable form-load task snapshot, not later reactive
query results. Unchanged fields and assignments are omitted. This prevents a later
completion or assignment from being overwritten merely by editing the event title,
and prevents newly received tasks from being interpreted as deleted. Participant
fields are omitted entirely unless participant selection was deliberately edited.
Failure retains the form, and no task-assignment error is silently swallowed in the
personal save path. Attachment upload remains a preceding upload operation; a failed
save can leave an unreferenced uploaded blob, as in the existing upload architecture.

Removing an account-backed participant with tasks prompts for cancellation, transfer
to the creator, or explicit unassignment. Further eligible reassignment is available
through the task selector before saving. Task IDs and completion states survive.
The server compares old/new explicit access for every persisted assigned task that
will remain after the edit and requires resolution in the same mutation, including
a task assigned concurrently. Tasks explicitly deleted in the same save need no
reassignment, but deletion IDs must first pass authorization, lifecycle, uniqueness
and event-ownership validation. Deleting and editing the same task is rejected.
All validation precedes task writes; the event and task deletions commit together.
A stale form can be rejected and require reopening to resolve a newly received task.
Historical RSVP rows are retained, but removed invitations no longer authorize RSVP.
`allFamily` can still independently authorize event reading; it grants no RSVP right.
Manual historical names cannot be safely associated with participants by guessing;
removing a similarly named display participant never silently rewrites that assignment.

Existing notification and sharing infrastructure is not redesigned. The new personal
form transaction does not add an invitation-delivery notification. Existing system/
WhatsApp share actions after save remain intact.

## Discovery and permissions

Existing indexed assignment queries now include personal assignments to the caller
when that caller can also read the event. Home uses the existing task accordion with
the same creator/invitee/visibility rules; community claim actions are not offered on
personal tasks. Calendar monthly and timeline views use the existing assigned-task
rows. My Tasks classifies them as personal, and event details/bottom sheet display
server-authorized tasks. Only creators/own assignees may complete them.

No other participants' tasks, attachments, description or inaccessible event metadata
are added to assignment queries. Cancelled/deleted events remain excluded from active
feeds, while existing authorized historical task reads remain available.

Legacy assignees with task access but no event read access are discoverable in
My Tasks through `listMyPrivatePersonalAssignments`, which returns only task ID,
title and completion. They render as undated personal tasks with no event link;
completion and explicit own-unassignment use the existing mutations. Date-based
Home/Calendar feeds omit them because the event date is not authorized. This is a
focused query on the existing assignment index and existing task list, not a new
parallel task system. The minimal presentation was used after the optional UI
preference question received no reply; no additional event permissions are granted.

## Validation and manual QA

Actual handlers run against synthetic DB/auth adapters in
`tests/convex/personalEventPackage1.test.ts`. Rollback assertions use a local transaction
wrapper; they do not verify Convex deployment, argument validation, transaction
isolation, or device rendering. Pure production form helpers cover stable selection,
duplicate names, creator choices and assignment preservation. Carousel gestures and
RTL have not been tested on devices.

Commands:

```sh
bun test tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts
bun test tests/convex
bunx tsc --noEmit -p convex/tsconfig.json
bunx tsc --noEmit
bunx biome check convex/personalEventEditing.ts convex/personalEventValidators.ts convex/eventTasks.ts lib/personalEventEditing.ts tests/convex/personalEventPackage1.test.ts
git diff --check
```

Final local results:

- Focused Package 1 + prior security suite: **250 passed, 0 failed** (40 + 210).
- All Convex tests: **2,101 passed, 2 failed**, 2,103 tests across 83 files.
- Convex TypeScript: passed. Frontend TypeScript: one reproduced pre-existing
  FlashList `initialScrollIndexParams` error in Calendar.
- Focused Biome command above: 5 files checked, 0 errors/warnings.
- Broader Biome across touched files is not clean: existing imports, formatting,
  unused code, array-key and dependency diagnostics remain. A Calendar dependency
  diagnostic concerns an unchanged pre-existing performance-log effect; it was not
  reproduced by the isolated baseline's path-dependent check, so its diagnostic
  provenance is not asserted. No unrelated cleanup was undertaken.
- `git diff --check`: passed. No device, real-account, deployed-backend or live-data
  checks performed. Final task diff reviewed against a pre-task filesystem snapshot;
  pre-existing uncommitted work was preserved.

The broad run's known unrelated failures were reproduced in an isolated copy of the
pre-package working tree: `ownerScopeInsertSiteCoverage.test.ts` (Google import source
text) and `calendarImportOnboarding.test.ts` (skip-flow source text). Full frontend
TypeScript also reproduces the pre-existing Calendar `initialScrollIndexParams`
FlashList error. Existing formatting/lint findings in other touched files are tracked
separately from the clean focused check; unrelated formatting was preserved.

Before controlled Development deployment, review the optional schema/API additions
and coordinate the backend before the updated client. Older builds may receive
intentional server rejection for new manual or unverified assignments; permissions
are not weakened for compatibility. No deployment/commit/push was performed.

Device checklist — run on both iPhone and Android, Hebrew RTL:

- New personal user with no family: create a task, verify creator default and hidden
  selector; save/reopen from Home, Calendar and My Tasks.
- Family with one and many profiles: long horizontal list, checkmarks, + at the end,
  carousel/sheet synchronization, duplicate names and accessibility announcements.
- Verified joined account, phone-only match, manual child and pet: all can be displayed
  appropriately; only verified invited accounts appear in assignment choices.
- Existing event with allFamily, legacy email/names and manual/unknown assignments:
  change title/date/location only, save/reopen and compare invitations/assignments.
- Two accounts: assign a task, view and complete from existing surfaces; visibility
  OFF hides other tasks, ON allows reading but not completing someone else's task.
- Remove an assignee: cancel the dialog, then transfer/unassign and save; verify task
  IDs/completion, revoked RSVP entitlement and retained historical responses.
- Simulate save failure/offline and retry: retain form data, no partial event/task save.
  Assign another task concurrently and verify the removal is rejected until resolved.
- Active community event regression, cancelled/deleted personal event restrictions,
  Google-imported personal event edit, and existing post-save share/back navigation.

## Files changed in this package

Pre-existing changes in these files were preserved. The earlier security fix's
`eventRsvps.ts` and other unrelated work were not changed by Package 1.

- `convex/personalEventValidators.ts` (new): optional participant/task-edit validators.
- `convex/personalEventEditing.ts` (new): invitation validation, eligibility and atomic task plan.
- `convex/schema.ts`: optional participant provenance array.
- `convex/events.ts`: optional atomic personal task arguments and invitation checks.
- `convex/eventTasks.ts`: creator defaults, eligible assignments, personal/private discovery and picker query.
- `convex/members.ts`: additive verified `linkedUserId` in family contact results.
- `lib/personalEventEditing.ts` (new): production selection, choices and task-diff helpers.
- `lib/eventTaskAssignmentDiff.ts`: account-based deliberate reassignment; untouched-state preservation.
- `lib/types/event.ts`: participant provenance, eligibility and local immutable task snapshot.
- `lib/components/event/ParticipantsCard.tsx`: shared carousel/sheet, stable contact IDs, no email/Everyone entry; removed sensitive contact debug logging in the touched flow.
- `lib/components/event/EventScreen.tsx`: verified selection, removal resolution, creator choices/default.
- `lib/components/event/RelatedTasksSection.tsx`: new-task default and conditional selector.
- `app/(authenticated)/event/new.tsx`: atomic personal create, no swallowed assignment failures.
- `app/(authenticated)/event-edit/[id].tsx`: identity-safe restoration and atomic snapshot-based personal save.
- `app/(authenticated)/event/[id].tsx`: authorized personal tasks/completion and account-only choices.
- `components/EventDetailsBottomSheet.tsx`: show server-authorized personal tasks to assignees/invitees.
- `app/(authenticated)/index.tsx`: include personal events in the existing Home task accordion query.
- `components/home/HomeDailyCommandCenter.tsx`: no community claim actions on personal tasks.
- `app/(authenticated)/calendar.tsx`: monthly personal assignment rows, matching timeline.
- `app/(authenticated)/tasks.tsx`: personal/undated private assignments and correct own-release mutation.
- `tests/convex/personalEventPackage1.test.ts` (new): handlers, persistence, identity and production helper tests.
- `tests/convex/personalEventTaskSecurity.test.ts`: valid creator account in the prior fixture.
- `tests/convex/eventTaskAssignmentDiff.test.ts`: account-backed reassignment expectation.
- `tests/convex/taskSpaceAuthorization.test.ts`: verified linkage in the cross-space invitation fixture.
- `docs/personal-event-participants.md` (new): this contract, validation, limitations and manual QA.
- `docs/event-read-authorization.md`: link to the subsequent Package 1 contract/discovery behavior.
