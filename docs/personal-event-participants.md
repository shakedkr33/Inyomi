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

The form offers the creator by their authenticated account display name plus eligible account-backed participants,
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

## Android participant sheet safe area follow-up

Implementation complete locally; physical-device verification pending. The two
participant sheets use local React Native Modals, not the birthday BottomSheet.
Their fixed Android bottom padding (24) did not account for system navigation
bar overlap in the edge-to-edge native configuration.

Each Android participant modal now measures its own safe area with a provider at
its root, outside keyboard avoidance. The sheet adds that window's bottom inset
once to its existing 24-point content padding; it has no bottom margin/offset.
This avoids reusing an app inset already consumed by a modal window. The background
still reaches the bottom. Android main content scrolls when constrained, and the
selected-participant list can shrink within its existing height limit. Contacts
and phone disambiguation share the same corrected sheet padding. Existing keyboard
avoidance, dismissal, selection and removal handlers remain unchanged. iOS keeps
its original 36-point padding, main content structure and keyboard behavior.

Local verification:

- `bun test lib/services/__tests__/participantSheetLayout.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts`: 379 passed, 0 failed.
- Six new component tests execute ParticipantsCard with mocked native hosts:
  modal-specific insets (0/16/48), inset updates, footer dismissal, 100 participants,
  last-participant removal, RTL selection and unchanged iOS padding/structure.
  These do not calculate Yoga geometry or simulate native keyboard/system bars.
- `bun run type-check`: only the Calendar FlashList `initialScrollIndexParams`
  error, reproduced before the change.
- `bunx biome check lib/components/event/ParticipantsCard.tsx lib/services/__tests__/participantSheetLayout.test.ts`:
  existing array-index-key error and redundant-fragment information in
  ParticipantsCard remain; new test file passes independently.
- `git diff --check`: passed.

Pending device QA: Android gesture and three-button navigation, small screens,
short/long participant lists, both footer and list-only sheets, contacts search
keyboard opening/closing repeatedly, phone disambiguation, last-row removal,
back/backdrop dismissal, RTL carousel gestures and selection. Check button touch
areas, background/rounded corners and absence of a gap. Repeat on iPhone to verify
appearance, animation, keyboard and selection parity. No native build, deployment,
backend/data change, commit or push was performed for this follow-up.

Other sheets were inspected but not changed: the birthday primitive already uses
insets; TaskAssigneeSheet independently uses fixed padding and remains a separate
potential Android QA risk. There is no shared primitive connecting it to these
participant modals, so this change does not fix all app sheets.

## Personal editor reassignment QA investigation

Status: device regression reported by the product owner; **not reproduced locally
and not fixed by this investigation**. Do not treat the passing tests as resolving
the QA report. No application or backend behavior was changed.

The current production path is RelatedTasksSection's `assignedParticipantIds` →
EventScreen state → the edit route's `personalTaskEdits(tasks, originalTasks)` →
`events.update.personalTaskChanges[].assignee` → `assignedToUserId` in the atomic
personal task plan. Details instead calls `eventTasks.setAssignee` directly.
Both paths persist the selected account in synthetic tests; the cause of the
reported difference on the device is still unconfirmed. No refresh workaround,
separate assignment mutation, or concurrency behavior change was introduced.

Seven added tests execute the actual route, EventScreen, assignment picker and
save callback against the actual events.update handler with synthetic DB/auth.
They cover both reassignment directions with one/three tasks, reopening, details/
Home/My Tasks read paths, recipient completion, creator management, error/retry,
untouched assignment preservation after a concurrent details update, and server
rejection after invitation removal. Existing tests cover participant-removal task
resolution and community assignment. Native components, Convex transport and
unrelated cards are mocked; actual subscriptions, native event timing and Convex
transaction concurrency are not exercised.

Verification:

- `bun test tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/eventTask*.test.ts tests/convex/communityTaskAssignmentSave.test.ts`: 473 passed, 0 failed, 10 files.
- `bunx tsc --noEmit -p convex/tsconfig.json`: passed.
- `bunx biome check tests/convex/personalEventPackage1.test.ts tests/convex/helpers/personalEventEditorHarness.ts`: passed.
- `git diff --check`: passed.

Pending evidence: repeat on iPhone/Android after a full Metro reload, confirming
both picker save and event save. If it persists, inspect whether the failing
`events.update` request contains B in `personalTaskChanges[].assignee`, whether
the mutation fails, and whether its stored result/read query agrees. Do not include
account IDs or personal event content in shared diagnostics. A stale client/backend
is only a possible explanation, not an established cause. These test/documentation
changes require no deployment and are not a device fix.

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


## Package 1 device QA follow-up — 2026-10-13

Scope: A–C implemented locally; D investigated only. The product owner reports
Development deployment and physical Android/iPhone verification of persistence,
recipient completion, creator updates and the earlier participant-sheet fix.
Those are user-reported results, not device tests performed in this follow-up.
They supersede the earlier unresolved reassignment report above. No deployment,
native build, migration, production-data change, commit or push was performed here.

### A. Personal Home accordion

Confirmed cause: `listEventTasksForHome` already authorizes all creator tasks,
but Home applied the community mine/unassigned filter to personal events too.
Home now preserves every server-authorized personal row. The existing community
subset, including for community managers, remains unchanged. All Home card
variants pass the event kind to the shared accordion; other community callers
retain the default community behavior.

Personal summary completion/total counts use exactly the displayed task list.
Assignments use `הוקצה ל־` and the server-resolved display name. The subscription
and completion mutation are unchanged; no polling or parallel task state exists.
Creators see all tasks; explicit invitees see only their own with visibility OFF
or the authorized list with visibility ON. Family-only readers cannot see all
tasks; unrelated callers cannot read or mutate by ID. Visibility alone still
confers no completion, editing, deletion or assignment privilege.

### B. Creator avatar

Confirmed code cause: `personalAssignmentChoices` created the correct account ID
with the literal display name `אני`. The avatar takes the first character of
that label, producing א even when no family profiles exist. A coinciding family
member initial did not prove that their identity was selected.

The form now resolves the creator name from `users.getCurrentUser`, checks its
ID against `getMyId`, and takes a profile color only through matching verified
`linkedUserId`. Missing identity uses `?` with an accessible neutral description;
missing profile color uses neutral gray. Mini avatars use the resolved personal
profile color and account name. Community avatar styling remains unchanged.
Account IDs, default ownership, single selection, save payloads and persisted
assignments are unchanged. Legacy/manual fallback is retained. Duplicate names
never choose identities. The picker intentionally now shows the actual creator
name instead of `אני`.

### C. Assignment sheet safe areas

The reported Save button belongs to the inline assignment modal in
`RelatedTasksSection`, not the separate `TaskAssigneeSheet` (which assigns
immediately and has no Save button). Both used fixed padding with no measured
modal bottom inset. Both now measure the Android modal window outside keyboard
avoidance and add its inset once inside the sheet background. Existing base
padding remains 32/36 respectively; no root/tab inset or bottom offset is added.

The editor list can shrink with a fixed Save footer. The standalone sheet also
scrolls its Android content, including the legacy manual controls, under height
constraints; its inner member list supports nested scrolling. iOS retains its
base spacing and existing standalone keyboard behavior, without the Android
provider/content scroller. Selection, animations, RTL directions, backdrop/back
handlers and business logic are unchanged. Native geometry, system-bar touch
bounds and actual keyboard behavior still require devices.

### Verification scope and manual checklist

Focused tests execute real components with mocked native hosts and real Convex
handlers with synthetic data. They cover creator/invitee/family/stranger access,
completion and reassignment followed by reads, updated component props, exact
assignment wording, counts, default/reassigned/reopened/unknown/duplicate/legacy
identities, modal-local insets 0/16/48 (different from root inset 99), inset changes,
100-row editor selection and Save, RTL alignment and preserved iOS padding.
They do not prove live Convex subscriptions, native geometry or two-device delivery.

Pending on both iPhone and Android in Hebrew RTL:

- Creator A with tasks assigned to A/B and legacy/manual rows: expand Home, verify
  all rows, names and completion/total counts; complete as B and reassign as A;
  verify live updates without reload and persisted identity after reopening.
- Invited B with task visibility OFF/ON: confirm own-only/all-authorized reading,
  own completion only and no reassignment/edit/delete entitlement. Check family-only
  viewer with and without an explicit assignment and an unrelated account.
- New task for a creator with/without a linked family profile; duplicate names;
  change assignment, save picker and event, close/reopen. Legacy manual task unchanged.
- Android three-button and gesture navigation: small screen, short/100-row list,
  final row and Save reachable, repeated keyboard open/close and inset changes,
  backdrop/back dismissal and no doubled gap. Check standalone manual controls too.
- iPhone: sheet position, animation, scrolling, keyboard, dismissal and touch
  targets. Both platforms: RTL row order, truncation and accessibility labels.
- Community Home and details: original subset, claims, completion permissions,
  labels and assignment workflow remain intact.

### Commands and local results for this follow-up

```sh
bun test lib/services/__tests__/personalEventQa.test.ts lib/services/__tests__/participantSheetLayout.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/eventTask*.test.ts tests/convex/communityTaskAssignmentSave.test.ts tests/convex/canonicalFamilyMembers.test.ts tests/convex/eventRsvp*.test.ts
bun run type-check
bunx tsc --noEmit -p convex/tsconfig.json
bunx biome check components/home/HomeDailyCommandCenter.tsx lib/homeEventTaskVisibility.ts lib/personalEventEditing.ts lib/components/event/RelatedTasksSection.tsx lib/components/event/TaskAssigneeSheet.tsx components/home/EventTasksAccordion.tsx lib/eventTasksSummary.ts lib/services/__tests__/personalEventQa.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/helpers/personalEventEditorHarness.ts
bunx biome check 'app/(authenticated)/index.tsx' lib/components/event/EventScreen.tsx
git diff --check
```

- Tests: **522 passed, 0 failed**, 14 files. Renderer deprecation warnings are from
  the existing test infrastructure. No native/device execution took place.
- Frontend TypeScript: fails only at `calendar.tsx:6508` for unsupported FlashList
  `initialScrollIndexParams`, reproduced before any edits. A temporary new nullable
  identity error was fixed before the final check; no new TS errors remain.
- Convex TypeScript: passed. No backend file/schema/API changes were required.
- Focused ten-file Biome command: passed. The separate Home/EventScreen check has
  two existing errors (EventScreen import ordering/formatting) and two existing
  unused import/variable warnings. The exact same findings were reproduced against
  pre-task snapshots using the same repository config; unrelated formatting remains.
- Diff whitespace: passed. Source, new files and changes against pre-task snapshots
  were reviewed. Existing ParticipantsCard and participant-sheet tests were not
  modified. Existing Package 1 tests/harness and documentation were extended while
  retaining the earlier local work. No deployment, commit or push occurred.

Files changed by this follow-up:

- `app/(authenticated)/index.tsx`, new `lib/homeEventTaskVisibility.ts`: personal
  server-authorized rows, preserving the community presentation filter.
- `components/home/HomeDailyCommandCenter.tsx`, `components/home/EventTasksAccordion.tsx`,
  `lib/eventTasksSummary.ts`: personal task counts, progress and assignment wording.
- `lib/personalEventEditing.ts`, `lib/components/event/EventScreen.tsx`: actual
  authenticated creator identity and verified linked profile color.
- `lib/components/event/RelatedTasksSection.tsx`: avatar identity/color and editor
  assignment sheet insets/keyboard/list sizing.
- `lib/components/event/TaskAssigneeSheet.tsx`: standalone modal safe area and
  constrained Android content scrolling, retaining its assignment callbacks.
- New `lib/services/__tests__/personalEventQa.test.ts`, existing
  `tests/convex/personalEventPackage1.test.ts` and
  `tests/convex/helpers/personalEventEditorHarness.ts`: focused component/handler
  coverage and mock support for the additional identity query/inset provider.
- This document: corrected creator display contract, local QA results, outstanding
  device checks and separate read-only multi-assignee assessment. Reviewed alongside
  `docs/event-read-authorization.md`; no authorization specification changes needed.

## Multi-assignee feasibility — proposal only, not approved or implemented

### Current facts

`schema.eventTasks` has one `assignedToUserId` or `assignedToManual`, one
`completed` boolean (not `isCompleted`), and one `completedAt`. Indexes include
`by_event`, `by_event_order` and `by_assigned_user`. There is no reusable event-task
assignment table. The separate `tasks` table's plural assignee fields still have
a shared completion flag; community reminder per-user completion references
`tasks`, not `eventTasks`, and has unrelated membership/dismissal semantics.
Neither is a drop-in model for this requirement. The editor's array of selected
IDs is currently constrained to one; it does not establish multi-assignee support.

`toggleCompleted` permits the creator (or community manager) to toggle the entire
record and an assignee to do the same. The personal editor also writes completion
through `events.update`/`preparePersonalTaskChanges`. Home reads authorized event
rows, while My Tasks/date feeds find `assignedToUserId` and use parent `completed`
for pending/completed placement. All these contracts need coordinated changes.

### Recommended future model

Keep one canonical `eventTasks` record and its ID/title/order/event relationship.
For personal multi-assignee tasks, add a separate assignment table, conceptually:
`taskId`, `userId`, `completedAt?`, `assignedAt`, `assignedByUserId`, and an
assignment generation/version where needed for stale clients and notification
idempotency. Index by task, by user and by task+user. Enforce one active assignment
per pair in mutation code; an index alone is not a uniqueness rule. Use authenticated
user identity for writes; never trust a supplied completion user ID.

Completion is derived from the active assignments: all must be complete and the
set must be nonempty. Avoid two independently editable completion truths.
If legacy clients require a parent `completed` projection, maintain it only as a
transactional derived cache, never as an alternative authoritative write path.
Retain legacy single/manual mode until explicitly converted; do not rewrite old
manual names into accounts by name/phone matching. Existing parent IDs stay stable.

An embedded bounded array `{userId, completedAt}` is conceptually simpler for one
task read but makes per-user indexed discovery harder and concentrates concurrent
writes on the parent. Given existing Home/My Tasks/calendar assignment feeds,
a dedicated indexed table is the safer maintainable choice. Duplicating visible
task records or merely changing the single ID into an ID array does not satisfy
independent completion.

### Permissions, views and progress

- Each assignee can explicitly set/undo only their own assignment completion.
  Prefer idempotent `setCompleted(boolean)` over toggles so retries cannot undo work.
  The creator manages membership and reads every assignment, but cannot complete
  another person's portion under the proposed requirement. This deliberately differs
  from today's creator-wide completion right and must be enforced in every write path.
- Validate creator/explicit invitations and verified active accounts on assignment;
  reject manual-only profiles and pets. Retain the existing event/task visibility
  boundary; family membership alone and knowing an ID never grant broader access.
- Home creator sees one task with per-person states and `2 מתוך 3 השלימו`. A viewer's
  checkbox controls their own portion; creator identity does not bypass that rule.
  With visibility OFF, expose only authorized per-user details. Whether other
  assignees' names/aggregate counts may be shown needs an explicit privacy decision.
- My Tasks and date/calendar feeds query assignments by the authenticated user,
  join authorized active parent events/tasks and classify using that assignment's
  completion. A finishing their portion must not remove pending work from B or C.
- Recommended event progress remains completed canonical tasks / canonical tasks,
  with a multi-assignee task complete only at N/N. Per-task responsibility progress
  uses completed assignments / active assignments. Do not silently mix these two
  denominators. A responsibility-weighted event bar would be a separate product choice.

### Lifecycle and concurrency proposals

- Add: validate invitation and create a pending assignment; retain everyone else's
  completion. Adding to a completed task reopens its derived aggregate.
- Remove pending or completed: revoke that person's assignment access/discovery and
  recalculate against remaining active assignments; never reset other users' work.
  Removing the sole pending person can make the remaining task complete.
- Last assignee removed: do not treat 0/0 as completed. Decide whether to keep an
  unassigned task with separate explicit creator completion semantics or prevent
  removal of the last assignee in multi mode. This decision remains unresolved.
- Reassign: atomic removal/addition; new responsibility starts pending. Completion
  history retention and remove/re-add behavior require a product decision; recommended
  new assignment generation prevents silently restoring earlier completion.
- Participant removal must inspect every assignment in the same atomic event edit;
  concurrent assignments must prevent unnoticed invitation removal, as Package 1 does
  for the existing single field. Full stale-array replacement would lose new work;
  send assignment deltas/version checks and explicit completion intent instead.
- Concurrent completions update separate assignment rows; any parent aggregate cache
  must be recalculated atomically. Test simultaneous completion, completion vs removal,
  double taps/retries, and stale editor saves against a real development runtime.
- Cancelled/soft-deleted events retain authorized history but reject completion and
  disappear from active feeds, matching current rules. Hard deletion/account deletion
  must clean up assignment references and scheduled notifications. Existing hard event
  deletion does not itself cascade event-task rows; do not rely on an assumed cascade.
  Account deletion currently scans single-assignee indexes and needs explicit updates.

### Notifications and rollout compatibility

Today `setAssignee` has an assignment notification path, excludes the actor and
unchanged recipient, and requires participant visibility ON. It uses the existing
`community_task_assigned` category even though the final branch can run for a personal
event. The atomic personal form path has no corresponding notification scheduling.
Completion records community activity; no independent per-assignee completion push
contract exists here. Event cancellation contains a TODO for notifying task assignees.
These are current-code observations, not a claim that notification delivery is verified.

A future implementation must establish one assignment lifecycle notification path
across both editor and direct mutation, targeting only newly added users, excluding
the actor as approved, and deduplicating by task/user/assignment generation/action.
Removal/cancellation must suppress obsolete pending deliveries; senders must recheck
entity existence/access. Per-person completion notifications, recipient exclusions
and whether the creator receives each or only final completion need approved copy
and trigger rules. Do not multiply notifications automatically for every write.

Additive schema alone is insufficient backward compatibility. Old clients understand
one ID/one completion flag: they can hide new assignees, complete everyone, or save
stale single-assignee state over the new assignments. Version the new endpoints and
mark multi-mode records; reject legacy assignment/completion writes for those records
(including atomic edits), while permitting legacy single-mode work. Choose a minimum
supported client or safe read-only upgrade path before enabling multi mode. Hiding it
only in the client is not a security boundary.

Roll out backend compatibility guards first, updated clients second, and activation
only after old-build tests. A bounded idempotent migration or lazy transactional
conversion can copy an old account assignment/completion into one child assignment
without changing task IDs. Preserve optional fields and legacy manual records;
reconcile counts, partial conversion retries and rollback before activation. No
migration, API change or rollout was performed for this investigation.

### Cost and Early Access recommendation

For T tasks and A assignments, creator/event reads add O(A) assignment rows; own-task
feeds can stay indexed by user instead of scanning all events. A completion normally
writes one assignment, plus any derived parent cache/notification state. Reads and
reactive invalidations grow with fan-out, not duplicate visible task titles. Batch
related lookups and avoid one subscription per avatar. Absolute latency/billing
cannot be estimated responsibly without usage/cardinality and a benchmark. The
larger cost is maintaining permissions, two completion meanings, lifecycle,
notifications, migration and old-client compatibility across shared consumers.

**Recommendation: Option 1 — keep single-assignee tasks for Early Access.** Independent
responsibility is useful when several people must each perform the same action, but
there is no usage evidence here proving it is a launch blocker. Option 1 preserves
the now-device-tested Package 1 persistence contract and needs no new schema/rollout.
Option 2 provides that daily value earlier but is a cross-cutting feature, not a
picker tweak: substantial implementation and two-user/device QA, integrity/security
risk and older-build deployment dependencies. Start personal-only after launch if
validated by usage; keep community manager/claim/RSVP rules unchanged until separately
specified. No dates or effort estimates are asserted without a detailed implementation
plan. Scope D remains read-only; every model/lifecycle rule above is a recommendation,
not a newly approved product rule.

## Explicit personal sharing and task visibility correction — 2026-10-13

Status: implemented and tested locally; Development deployment and physical-device
verification pending. This is the subsequent approved sharing request, separate
from the earlier avatar/sheet follow-up. It changes two backend handlers; the prior
statement that no backend deployment was needed applies only to that earlier task.

### Sharing and legacy access

Investigation found that the form already starts without `allFamily`, the participant
carousel has no Everyone control, and `selectFamilyParticipants` preserves rather
than enables the flag. `participantDetails` contains presentation/provenance only;
verified account/user invitation arrays grant access. The picker does not change
`createdBy`. New manual profiles can appear without receiving account access.
New account selections are checked by `validatePersonalInvitations`; existing
explicit external account invitations remain valid without a new family relationship.

Previously the new-event route forwarded a possibly stale `data.allFamily` and
`events.create` accepted true. The personal creation route now explicitly sends false;
the server persists false for personal creation and rejects an explicit true before
writing. Omitted/false flags remain accepted. Community creation is unchanged.
Google import/OAuth and other unrelated creation infrastructure are unchanged.

Legacy stored true values continue granting event access to real access-kind members
of that event's space via `canReadPersonalEvent`. The personal edit route now omits
`allFamily` entirely: ordinary editing and participant changes preserve its current
server value, including concurrent updates. No UI to narrow legacy sharing was added;
no migration, schema removal, live-data rewrite or ownership change occurred. Server
handling for legacy events remains intact. Removing an explicit invitation from a
legacy allFamily event does not remove the independent family-wide event-read grant.
A future narrowing control needs deliberate product approval and user choice.

Neither a participant display name, a manual profile, nor discovery-only
`matchedUserId` grants event access. Existing historical explicit profile invitations
continue using their established member `userId` read contract; new selections require
verified linkage. No historical profiles are relinked. Existing task-only legacy
assignments remain task-only: this correction adds no event/attachment/RSVP access.

`events.getById` and `listByDateRange` already enforce the same personal read contract.
Home and Calendar use those authorized results; their family-profile filters are
presentation filters, not grants. Share-link previews/saved-link limited projections
remain separate and unchanged; possessing a link does not grant full event/task rights.
RSVP already requires creator or explicit invitation, rejects phone-only/family-only
inference, and blocks cancelled/deleted events. No RSVP implementation change was needed.

### Task visibility and copy

The server visibility filter already matched the approved contract and was retained:

| Viewer (new explicit-sharing event) | OFF | ON |
| --- | --- | --- |
| Creator | All tasks | All tasks |
| Invited assigned account | Own tasks | All tasks, own first |
| Invited account without tasks | No tasks | All tasks |
| Unselected family member / unrelated account | No event access | No event access |

Legacy `allFamily` retains event access but does not itself grant access to other
people's tasks, with either toggle value. Existing own-assignment permissions remain.
Only creators manage tasks; participants can complete only their own assignments.
Visibility never grants completion, editing, deletion or reassignment privileges.

Personal invitees with visibility ON now receive their own rows first from both
`eventTasks.listByEvent` and `listEventTasksForHome`, then all other authorized rows
in stable source order. Unlike the existing community Home ordering, unassigned
personal tasks do not jump ahead of other people's tasks. The shared pure ordering
helper only rearranges authorized query results; no ordering is persisted and no
task is duplicated. Creator ordering and community query/filter behavior are unchanged.

Details and the Calendar/Home detail sheet consume `listByEvent`; Home uses its
existing reactive batch query. Calendar assignment previews and My Tasks intentionally
remain own-assignment feeds, not full event-task lists. Event-detail surfaces show
actual account/manual labels using `הוקצה ל־`; community labels retain their original
wording. Reactive completion and assignment writes remain unchanged.

Personal create/edit and details use the title `משימות גלויות למשתתפים` and the
shared description `כשמופעל, המשתתפים רואים גם את המשימות של כולם` in both states.
The detail sheet's informational description agrees. Community wording is untouched.
The personal details toggle is absent when there are no tasks; creator create/edit
controls retain their existing position. No layout, RTL direction, accessibility
role or participant-carousel interaction was redesigned.

### Validation and limits

Final commands and results are recorded below. Tests invoke actual query/mutation
handlers with synthetic data, actual editor components with mocked native hosts,
and production detail-label expressions. Supplemental route wiring assertions cover
the empty-list toggle and shared copy; these do not prove native rendering.
Coverage includes new private creation, rejected broad creation without partial writes,
linked participant selection/removal, creator identity, manual display-only profiles,
phone-only matches, external invitees, unselected family members, Calendar/detail/Home
agreement, OFF/ON matrices, own-first ordering, foreign-task mutation denial, live-data
re-read/prop updates, legacy editing, RSVP lifecycle and unchanged community ordering.

```sh
bun test tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/eventTask*.test.ts tests/convex/eventRsvp*.test.ts tests/convex/homeEvent*.test.ts tests/convex/calendarProfileFilter.test.ts tests/convex/communityCalendarState.test.ts tests/convex/eventsListByDateRangeCategory2.test.ts tests/convex/pendingRsvpAssignedTaskIndicator.test.ts tests/convex/communityTaskAssignmentSave.test.ts lib/services/__tests__/personalEventQa.test.ts lib/services/__tests__/participantSheetLayout.test.ts
bunx tsc --noEmit -p convex/tsconfig.json
bun run type-check
bunx biome check convex/events.ts convex/eventTasks.ts 'app/(authenticated)/event/new.tsx' 'app/(authenticated)/event-edit/[id].tsx' 'app/(authenticated)/event/[id].tsx' components/EventDetailsBottomSheet.tsx lib/components/event/EventScreen.tsx lib/components/event/RelatedTasksSection.tsx lib/personalEventTaskPresentation.ts tests/convex/personalEventPackage1.test.ts tests/convex/helpers/personalEventEditorHarness.ts lib/services/__tests__/personalEventQa.test.ts
git diff --check
```

Final results: **907 passed, 0 failed**, 21 files. Convex TypeScript passed.
Frontend TypeScript has only the known Calendar FlashList `initialScrollIndexParams`
error at line 6508, reproduced before this correction in the preceding task.
The full focused Biome command retains three existing errors (details formatting;
EventScreen imports/formatting) and two existing unused-variable warnings. The same
findings were reproduced against pre-task snapshots with the repository config;
new helper, backend task query, new/edit routes, detail sheet, related task component
and test files have no new findings. `git diff --check` passed. Earlier work and the
new file were reviewed against pre-task snapshots. No commit/push/deployment occurred.

The initial new Calendar tests needed the synthetic adapter's existing-query `order`
method; that fixture gap was corrected. A reassignment test was switched to the real
atomic editor mutation so this sharing test does not require a fake notification
scheduler. Final diff review caught and corrected a temporary community-label
regression; production-expression tests now cover both personal/community labels.
No unrelated failing tests were modified.

Pending iPhone and Android QA, in Hebrew RTL and with separate authenticated accounts:

1. Creator A creates a personal event without selections: family member B cannot see
   it in Home/Calendar or open its ID. Select linked B and a manual profile; only B
   gains account access. Verify a previously invited external account remains invited.
2. For B with and without assigned tasks, test OFF/ON in details, Home and Calendar's
   detail sheet: own-only/empty versus full list, own-first stable order, names and
   completion state. Complete B's task; observe A's screen update without reload.
   Verify B cannot complete/edit/reassign A's task and cannot edit visibility.
3. Save/reopen the toggle in create/edit/details; verify exact Hebrew copy, no toggle
   in empty personal details, RTL wrapping and accessible switch state.
4. Legacy allFamily event: unselected family B retains event access after A edits its
   title or participants. B receives no new task-list/RSVP permission. Removing B's
   explicit invitation from a non-allFamily event revokes access after required task
   resolution; cancellation/deletion rejects RSVP changes.
5. Community event: original copy, Home subset, ordering, claims and management
   permissions. Repeat participant-carousel selection and sheet dismissal checks.

Deployment is required for the creation guard and query ordering to take effect.
No deployment was performed. No schema migration is required. An older installed
client that creates a personal event with `allFamily: true` will be rejected rather
than silently creating broader access; older clients omitting/sending false continue
working. Review that expected compatibility behavior before controlled deployment.
Existing allFamily records remain readable under their prior rules. Device layout,
real subscription delivery and old-client user experience are not verified locally.

Changed in this correction: `convex/events.ts`, `convex/eventTasks.ts`,
`app/(authenticated)/event/new.tsx`, `app/(authenticated)/event-edit/[id].tsx`,
`app/(authenticated)/event/[id].tsx`, `components/EventDetailsBottomSheet.tsx`,
`lib/components/event/EventScreen.tsx`, `lib/components/event/RelatedTasksSection.tsx`,
new `lib/personalEventTaskPresentation.ts`, `tests/convex/personalEventPackage1.test.ts`,
`tests/convex/helpers/personalEventEditorHarness.ts`,
`lib/services/__tests__/personalEventQa.test.ts`, and this document. Reviewed alongside
`docs/event-read-authorization.md`; existing authorization rules there remain accurate.
All earlier uncommitted QA fixes and participant-sheet work were preserved.

## Final Package 1 QA corrections (2026-10-13)

Status: implemented locally; deployment and new iPhone/Android two-account QA
pending. The product owner reported the preceding sharing, visibility toggle,
reassignment and completion version passed two-device QA on Development. That
report does not verify the corrections below.

### Personal assignment removal

The personal details action incorrectly called community-only `unclaimEventTask`.
It now calls existing `setAssignee({ id, assignee: null })`, restricted server-side
to the personal event creator. The creator can clear their own or another person's
assignment; all four assignment fields clear atomically. Task ID, title, completion
and completion timestamp survive clearing and subsequent reassignment. An unassigned
row says `לא הוקצה`; the creator can open the existing assignment sheet again.

The approved creator-only rule supersedes the previous self-release exception.
Participants cannot claim or self-release through direct mutations, details,
My Tasks or the combined RSVP decline/release operation. My Tasks opens personal
event details instead of exposing self-release. The existing assigned-task RSVP
refusal remains: participants ask the creator to release the task before declining.
Ordinary RSVP values and community claim/unclaim/decline behavior are unchanged.
Completion remains available for the participant's own authenticated assignment.

Existing reactive details/Home/My Tasks queries recalculate visibility: creators
retain all rows; invited participants retain unassigned rows only with visibility
ON; the removed assignment leaves their assigned-task list. No polling, task
deletions, automatic reassignment, schema migration or multi-assignee support.

### Personal Home participant circles

Home previously projected only `sharedWithFamilyMemberIds`, whereas details also
resolved `sharedWithUserIds`. Account-only invitations therefore disappeared from
the creator's Home card even after reload. This was not an RSVP filter or renderer
failure.

After event-read authorization, `events.listByDateRange` now adds a display-only
`personalHomeParticipants` projection for explicit personal events. It resolves
creator and explicit user invitations from account IDs, merges verified linked
member IDs, deduplicates by identity and preserves manual/legacy display metadata.
Account names/colors take priority over stale display metadata; no phone/name
matching grants identity. Missing account names have a neutral fallback. Home
excludes the current viewer's own circle and keeps other participants regardless
of pending/yes/no RSVP. The existing ProfileCircles renderer retains capacity,
overflow, Hebrew initials and layout. Community cards and legacy allFamily cards
keep their previous paths. Older backend responses retain the existing fallback;
this fix requires deployment of the updated backend as well as updated UI.

The new projection adds account/profile reads per authorized personal event;
it introduces no new event access rights or background synchronization.

### Verification of this correction

Automated checks (local in-memory registered Convex handlers and actual production
UI expressions/components with mocked native hosts; not real-device layout tests):

```sh
bun test tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/eventTask*.test.ts tests/convex/eventRsvp*.test.ts tests/convex/homeEvent*.test.ts tests/convex/calendarProfileFilter.test.ts tests/convex/communityCalendarState.test.ts tests/convex/eventsListByDateRangeCategory2.test.ts tests/convex/pendingRsvpAssignedTaskIndicator.test.ts tests/convex/communityTaskAssignmentSave.test.ts lib/services/__tests__/personalEventQa.test.ts lib/services/__tests__/participantSheetLayout.test.ts
bun test lib/services/__tests__/personalEventFinalQa.test.ts
bunx tsc --noEmit -p convex/tsconfig.json
bun run type-check
bunx biome check 'app/(authenticated)/event/[id].tsx' 'app/(authenticated)/index.tsx' 'app/(authenticated)/tasks.tsx' components/EventDetailsBottomSheet.tsx convex/eventTasks.ts convex/eventRsvps.ts convex/events.ts convex/personalHomeParticipants.ts lib/personalHomeParticipants.ts tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/privacyAuthorization.test.ts lib/services/__tests__/personalEventFinalQa.test.ts
git diff --check
```

Results: 920 regression tests plus 6 new UI tests pass. Convex TypeScript passes.
UI TypeScript reports only the known unrelated `calendar.tsx:6508` FlashList
`initialScrollIndexParams` error. Focused Biome retains pre-existing formatting,
import-order and lint findings, confirmed against the snapshot taken before this
correction; no broad formatting cleanup was performed. Diff whitespace check passes.

Pending iPhone and Android QA with authenticated accounts A (creator) and B:

- Clear A's and B's assignments, including a completed task; reopen and confirm the
  same task remains unassigned with completion preserved. Assign again from A.
- Toggle visibility OFF/ON: verify B loses/retains the unassigned row in details and
  Home appropriately, and loses it from My Tasks. A always retains the task.
- B cannot claim, release or change assignments; B can complete only own tasks.
  Assigned B cannot use RSVP decline to release a task; after A clears it, decline
  works. Check live updates on the other device and after reopening.
- Invite B by linked account: A sees B and B sees A on Home for pending/yes/no RSVP,
  with correct account name/color and no creator duplicate. Check identical names,
  more than three invitees, manual/legacy data and Hebrew RTL on narrow screens.
- Check existing community card circles and community claim/unclaim/RSVP flows.

Convex Development deployment is required (events, eventTasks, eventRsvps and the
new projection helper); none was run. No live data changes, commit or push.

## Unified personal assignment presentation (2026-10-13)

Implemented locally; native device verification pending. This supersedes the
previous personal task row's separate removal button, without changing permissions
or assignment persistence semantics.

The editor had a fixed `הקצה` label regardless of assignment, while details had
an icon-only change action and a separate removal action. Personal create/edit
and full event details now use shared presentation copy:

- Unassigned: `לא הוקצה`, action `הקצה`, sheet title `הקצאת משימה`.
- Assigned: `הוקצה ל־[name]`, action `שנה הקצאה`, sheet title `שינוי הקצאה`.
- Removal: `בטל הקצאה` inside the existing sheet only. The task survives with
  its identity and completion unchanged. Assignment management remains available
  when the creator is the sole eligible account.

Names, colors and current selection resolve by account ID. The personal assignee
query now returns the creator's actual account name and each account's profile
color (neutral fallback), rather than replacing the creator name with `אני`.
The details sheet marks the viewer separately and preserves the selected identity
when display names are identical. Missing account/profile data has a neutral
read-only representation; it does not authorize a manual profile.

Editor selection still uses the existing sheet Save and local `onChange` flow;
explicit removal updates the same event draft. Only `שמור אירוע` persists that
draft through the existing atomic update. Closing without event save does not
persist changes. Participant-removal resolution, dirty checks and concurrency
handling are unchanged. Full details still write immediately via `setAssignee`;
a synchronous guard prevents overlapping personal requests, controls disable
while pending, and a failure keeps the sheet open for retry. No new mutation.

Personal assignment actions remain creator-only; server authorization, completion
permissions, visibility, Home/My Tasks queries and community branches are unchanged.
The Home event details bottom sheet retains its existing read-only personal
assignment presentation; its community actions were inspected and left unchanged.
Existing Android modal safe-area providers/inset calculations and scroll behavior
remain intact. Personal action targets use at least 44 dp; long labels may truncate
within their available width. Native RTL/layout verification is still required.

Files changed in this correction (all preceding local work preserved):
`lib/personalEventTaskPresentation.ts`, `lib/components/event/RelatedTasksSection.tsx`,
`lib/components/event/TaskAssigneeSheet.tsx`, `lib/components/event/EventScreen.tsx`,
`app/(authenticated)/event/[id].tsx`, `convex/eventTasks.ts`,
`lib/services/__tests__/personalEventQa.test.ts`,
`lib/services/__tests__/personalEventFinalQa.test.ts`,
`tests/convex/personalEventPackage1.test.ts`, and this document.
Reviewed the prior sections and `event-read-authorization.md`; authorization
requirements there remain unchanged.

Validation commands and results:

```sh
bun test tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/eventTask*.test.ts tests/convex/eventRsvp*.test.ts tests/convex/homeEvent*.test.ts tests/convex/calendarProfileFilter.test.ts tests/convex/communityCalendarState.test.ts tests/convex/eventsListByDateRangeCategory2.test.ts tests/convex/pendingRsvpAssignedTaskIndicator.test.ts tests/convex/communityTaskAssignmentSave.test.ts lib/services/__tests__/personalEventQa.test.ts lib/services/__tests__/participantSheetLayout.test.ts lib/services/__tests__/personalEventFinalQa.test.ts
bunx tsc --noEmit -p convex/tsconfig.json
bun run type-check
bunx biome check lib/components/event/RelatedTasksSection.tsx lib/components/event/TaskAssigneeSheet.tsx lib/components/event/EventScreen.tsx 'app/(authenticated)/event/[id].tsx' lib/personalEventTaskPresentation.ts convex/eventTasks.ts lib/services/__tests__/personalEventQa.test.ts lib/services/__tests__/personalEventFinalQa.test.ts tests/convex/personalEventPackage1.test.ts
git diff --check
```

932 tests pass across 22 files; Convex TypeScript and whitespace checks pass.
Frontend TypeScript reports only the existing unrelated FlashList
`initialScrollIndexParams` error at `calendar.tsx:6508`. Focused Biome retains
3 existing errors (formatting/import order) and 1 unused-variable warning in
EventScreen/details, confirmed against a before-task snapshot. Native UI hosts
are mocked; these tests do not prove physical layout or live-device updates.

Pending QA on iPhone and Android (gesture and three-button navigation), A creator
and B invitee: new/default, assigned, completed and unassigned tasks; change/remove/
reassign with one or many eligible accounts; selected row and correct avatar with
identical/long names; open/close without changes; editor discard versus event save;
removed participant resolution; details offline failure/retry and rapid taps;
B's read-only actions and own-task completion; Home/My Tasks live updates;
small screens, long lists, keyboard and bottom safe areas; community UI regression.

Development deployment is required for the personal assignee display query change.
An older backend can render neutral avatar colors and the old creator label until
updated. No schema change, live-data write, deployment, commit or push was performed.

## Personal details visible actions — pre-TestFlight correction (2026-10-13)

Implemented locally; physical iPhone/Android validation pending. This is a focused
replacement of the personal header overflow menu, not the Package 2 redesign.

Confirmed code cause: the old menu used `measureInWindow` coordinates as `left`
and a fixed width of 215, clamping only the minimum x to zero. It never constrained
x + width to the screen width or reconciled physical coordinates with native RTL.
The screenshot itself was not attached to this task; device reproduction was
reported by the product owner, while the positioning defect was confirmed in code.

The personal creator now sees a wrapping two-column action area directly after the
main information card, before scheduling/reminders: `עריכה`, `שיתוף`, and
`ביטול אירוע`. Cancellation spans the remaining row. Buttons reuse community colors,
borders, icons and 44 dp minimum targets, use the RTL helper, and allow text/height
to grow. There is no absolute-positioned menu, coordinate calculation or horizontal
scroll. The header retains its balancing spacer; safe-area and bottom navigation
code is unchanged. Community action rendering and handlers remain unchanged.

Permission/action audit:

- Only the authenticated creator sees these personal actions, matching the old
  menu gate. Explicit invitees, legacy family readers, linked-event readers and
  unauthenticated/unauthorized viewers gain no management actions. Existing backend
  authorization remains authoritative. Legacy creator-orphan backend authority was
  not added to the UI. An independent copied event uses its own creator identity.
- Edit invokes the existing gated `event-edit/[id]` navigation; the editor is unchanged.
- Share invokes existing `createShareLink` and system sharing. Creator-only link
  creation, existing token reuse, HTTPS URL in message and text-only fallback are
  unchanged. No new share mechanism or read permission.
- Duplicate is deferred: the route's duplication handler supports community events
  only, gated by owner/admin. Linked-event independent-copy functionality elsewhere
  is a separate flow and is not exposed here.
- Cancel opens the existing confirmation with optional reason; confirmation calls
  existing `cancelEvent`. It patches cancellation fields and propagates sourceStatus
  to linked records; tasks/RSVP are retained and their existing cancellation guards
  apply. Independent copies do not inherit source cancellation. Share links are not
  revoked by cancellation. The existing post-cancel navigation is unchanged.
- No delete action was added. `deleteEvent` is permanent deletion with linked-source
  tombstones; `softDeletePersonalEvent` is a separate 30-day trash flow which rejects
  active events with explicit invitees. Neither was called by the old menu, and
  neither is exposed by this correction. Cancellation remains cancellation.

Changed files: `app/(authenticated)/event/[id].tsx`, new
`lib/components/event/PersonalEventActions.tsx`, new
`lib/services/__tests__/personalEventActions.test.ts`, and this document.
Reviewed `event-read-authorization.md`, sharing/linked-event handlers and cancellation/
delete handlers; their contracts were not changed. Existing local work is preserved.

Validation:

```sh
bun test lib/services/__tests__/personalEventActions.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/homeEventNavigation.test.ts tests/convex/community*.test.ts tests/convex/creatorOrphanAuthority.test.ts lib/services/__tests__/personalEventFinalQa.test.ts lib/services/__tests__/personalEventQa.test.ts
bun run type-check
bunx biome check 'app/(authenticated)/event/[id].tsx' lib/components/event/PersonalEventActions.tsx lib/services/__tests__/personalEventActions.test.ts
git diff --check
```

915 tests pass across 16 files, including 11 new tests executing the production
component and actual route handlers/wiring. Checks cover role visibility, cancelled
state, edit navigation, existing share token/message, confirmation-only cancellation
entry, cancellation payload, absence of overflow/duplicate/delete, RTL helper usage
and flexible layout constraints. Backend authorization/navigation/community regressions
pass. Direct before/after comparison also confirmed unchanged edit/share/cancel
handlers, cancellation dialog and community action construction.

Frontend TypeScript retains only the known `calendar.tsx:6508` FlashList
`initialScrollIndexParams` error. Focused Biome retains one pre-existing details
format error (confirmed against the before-task snapshot); new files pass. Whitespace
check passes. No backend file changed, so no new Convex deployment is required for
this correction (earlier local backend changes retain their deployment requirements).
No deployment, live-data writes, commit or push occurred.

Pending physical-device QA: iPhone safe areas and Android gesture/three-button
navigation; narrow widths and large accessibility fonts; long Hebrew titles,
RTL icon order, VoiceOver/TalkBack labels, no overlap/clipping; creator edit/share,
back navigation, cancel dismissal and confirmation; invited/family/linked readers
without management actions; cancelled events without cancellation button; existing
community action behavior. Mocked layout checks do not establish device readiness
or TestFlight readiness.
