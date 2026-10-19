# Task reads and space write authorization

Status: implemented locally; controlled deployment, two-account and device QA
pending. No records, schema, ownership values or IDs were migrated.

## Confirmed product rule

`tasks.listBySpace`, `listUndated` and `listByRelatedBirthday` use the existing
task-participant rule from task details: the authenticated creator, `assignedTo`,
or a user in `assignedToUserIds`. Unauthenticated/unauthorized reads return `[]`.
An unassigned task is visible only to its creator, even in a family space.
Neither `spaceId`, membership nor `ownerScope` grants implicit task access.
Explicit user assignments retain access across spaces and after membership
removal; removing membership alone does not revoke a separate assignment.

Retention correction (2026-10-14): `getTaskDetails` and
`getTaskAttachmentUrl` return null for **all** soft-deleted tasks, including
personal/assigned tasks and their creator. Trash remains available through its
dedicated list/restore endpoints. This supersedes the former details-handler
exception for soft-deleted personal tasks. See [deletion and retention](account-deletion-retention.md).

There is no task-level “share with the whole family” field. The TaskEditorScreen
“Everyone” action selects every visible assignee and persists account IDs in
`assignedToUserIds` and profiles without accounts in `assignedToMemberIds` (with
the existing legacy single-assignee fields). Every explicitly assigned account
retains access. Member-only assignments remain stored and displayed to authorized
participants; they do not authenticate an account or grant all adults access.
No legacy task is reclassified. `ownerScope` remains creation-time ownership,
not a current sharing permission. The existing creator fallback on new tasks
with no explicit assignees is unchanged.

`listCommunityRemindersPaged` and `listByCommunity` require authentication and
active membership, using `isActiveCommunityMember`, before reading tasks.
Denied pagination returns an empty terminal page. Existing reminder filtering,
personal dismissal/completion semantics and legacy membership handling remain.
`listEventImportantItems` checks `canReadPersonalEvent` for a personal event;
its existing community membership check remains in place.

## Space writes

`events.create` and `tasks.create` call `requireSpaceWriteAccess` whenever a
destination space is present. It queries memberships by the authenticated user
and reuses `hasAccessRowForSpace`: an access-kind admin/member row for that exact
space is required, including legacy access inference. Entity-only rows, phone
matches, ownership metadata, explicit event shares and community-admin status
do not grant destination writes. The space must exist; the current schema has
no active/archived field on spaces. Denials happen before inserts or scheduling.

Event creation also validates its existing implicit community-event destination.
Optional no-space creation remains supported. Community creation role checks,
assignment normalization, shopping subtasks, ownership stamping, notifications
and sharing fields are unchanged. A stale default/entity-only resolved space
now fails closed; membership repair is outside this task.

## Investigation and callers

- Home calls `listUndated` with its resolved space; BirthdayCardSheet calls
  `listByRelatedBirthday`. No application caller of `listBySpace` was found,
  but it remains a public endpoint.
- TaskEditorScreen calls `tasks.create` with `users.getMySpace`; community
  reminder creation also supplies that space when available.
- Both personal/family and community branches of `event/new.tsx` call
  `events.create`, using the existing user/member space resolvers.
- The community reminders tab calls `listCommunityRemindersPaged`; no current
  UI caller of `listByCommunity` was found. EventDetailsBottomSheet and the
  event-detail route call `listEventImportantItems`.
- `listMyTasks` selects creators and explicit user assignees; task details and
  attachment reads already gate personal tasks on participant identity. These
  paths and assignment write semantics were not broadened or refactored.
- Onboarding creates access rows; Google import inserts through its separate
  server-resolved import path. Neither calls these create handlers. Those flows,
  subscriptions, OAuth and account/family lifecycle remain unchanged.

## Root causes and verification

The former personal-task predicate admitted any ordinary task whose legacy
`assignedTo` was absent, even when other assignment fields were populated.
Knowing a foreign space or birthday ID was enough to retrieve such records.
Both create handlers authenticated the caller but omitted destination-space
authorization. The two community lists had no authentication/membership gate;
personal event important items checked authentication but not event access.

`tests/convex/taskSpaceAuthorization.test.ts` invokes real registered handlers
against an in-memory auth/DB adapter, including writes and subsequent reads.
It covers denied access, active/legacy membership, creators, cross-space
assignees, personal/unassigned tasks, “Everyone” with accountless profiles,
community roles, shopping lists, sharing and missing destinations. Pre-change
handler snapshots reproduced the authorization failures.

The adapter does not emulate Convex runtime ID validation, transactions, real
pagination cursors or device delivery. The existing `v.id` validators are intact.
No deployed backend is claimed fixed. Before a controlled Development rollout,
review these local changes and the existing repository check failures.

Manual QA on **both iPhone and Android**, using accounts A and B:

1. In one family, A creates personal/unassigned tasks and a task assigned with
   “Everyone,” including an accountless child profile. Verify B sees only its
   assigned task; reopen details and verify the child assignment remains.
2. Verify explicit assignments still read across spaces. With no assignment or
   access row, B cannot read A's tasks via space/birthday IDs. Do not use the
   currently blocked member-removal flow to manufacture this fixture.
3. Verify authorized personal/family event, task and shopping-list creation;
   direct calls targeting a foreign/missing space must fail without writes.
4. Verify community owner/admin creation, member creation denial, active-member
   reminder visibility and outsider/left-member denial, including pagination.
5. Verify private/shared event important items, RSVP, share preview and saved
   linked events. Complete onboarding and Google import with a new test account.

Related context: [event reads](event-read-authorization.md),
[family removal audit](audits/family-profile-removal-authorization.md), and
[onboarding import](onboarding-calendar-import.md). Historical lifecycle audit
statements suggesting blanket family visibility do not override the explicit
task visibility decision above.

## Local check results (2026-10-12)

- `bun test tests/convex/taskSpaceAuthorization.test.ts`: 110 passed, 0 failed.
- `bun test tests/convex/privacyAuthorization.test.ts tests/convex/eventRsvpUnanswered.test.ts tests/convex/eventTaskRsvpDecoupling.test.ts tests/convex/familyMembershipPhase1Invariants.test.ts tests/convex/googleImportAccess.test.ts`:
  177 passed, 0 failed, including event authorization, share links, linked events,
  RSVP, family membership and import access.
- `bun test tests/convex lib/services/__tests__`: 2,133 passed, 3 failed across
  93 files. The failures also appeared before the task-read fix, and inspect
  unchanged onboarding/OAuth sources rather than these handlers:
  `calendarImportOnboarding.test.ts` skip-button source assertion; two
  `googleOAuthClient.test.ts` assertions for Android authorization errors and
  native cancellation. These unrelated failures were not modified.
- `bun run type-check`: fails on the same baseline TS2322 at
  `app/(authenticated)/calendar.tsx:6511`: unsupported FlashList
  `initialScrollIndexParams`. Before/after diagnostic output is identical.
- `bun run lint`: 89 errors, 21 warnings both before and after this work.
  Existing `tasks.ts` formatting and an unused variable in `events.ts` remain;
  broad formatting changes were deliberately avoided.
- `bunx biome check convex/spaceWriteAccess.ts tests/convex/taskSpaceAuthorization.test.ts`:
  passed. `git diff --check`: passed.

A temporary isolated copy with the pre-change task/event handler snapshots ran
105 of the new cases: 56 passed and 49 failed, reproducing the missing guards.
The final five cases were added afterward for creator fallback, community
implicit/no-space destinations, stale defaults and Everyone persistence.
No deployment, background synchronization, migration, commit or push ran.
