# Family ownership, profile management and removal

Updated: 2026-10-12. Status: local permission hardening implemented and tested;
authenticated-member removal is deliberately blocked pending a safe migration.
No deployment, production-data changes, commit or push occurred.

## Confirmed product contract

- `spaces.ownerId` is the single family owner. Creation stamps the authenticated
  creator. An `admin` role alone is not ownership. No ownership migration or
  new role is introduced; existing live records were not inspected.
- Only the owner, with actual access to that space, manages other family
  profiles. Regular members read authorized profiles and edit their own account.
- An owner may edit a linked family profile's display name/color. This does not
  edit that person's `users` account. A later explicit self name edit still
  synchronizes the person's claimed family profiles. This supersedes the old
  prohibition on owner edits to claimed family display names.
- Removing an authenticated member must revoke membership, preserve the account,
  move their personal events/tasks to their personal space (creating it only if
  needed), and retain shared family content in the family space. Preserve IDs,
  links, reminders and recurrence; never duplicate or lose records.
- Explicit personal shares retain their existing authorization. Family ownership
  is not permission to read private personal events.
- The owner cannot remove themselves through ordinary member removal. Account
  deletion safeguards and community roles remain unchanged.

These decisions supersede this audit's earlier proposals and the historical
family/subscription/deletion audit where they conflict. Safe data movement was
explicitly made a prerequisite; a complex migration must not be implemented
without further review.

## Model and confirmed gaps

`members.kind = entity` is a profile; `access` is authenticated membership.
`resolveKind` supports legacy rows. Phone discovery (`matchedUserId`) is not
accepted identity (`userId`) or a membership grant. `executeFamilyJoin` grants
access after the authorized selection/completion flow. Onboarding establishes
`spaces.ownerId` and an owner access row.

Before this change, `updateMyProfile({ familyContacts })` had no owner gate,
allowing regular members to mutate the family list. Removal checked an admin
role, deleted only an entity and left access intact. Client failures were logged
while the profile immediately disappeared locally. Contact inputs could supply
account IDs/joined state, and profile reads could follow a legacy entity without
an access row. Manual renames could replace an entity because matching used the
new name rather than the previously persisted contact.

## Implemented boundary

- `requireSpaceOwner` checks authenticated identity, `spaces.ownerId` and an
  access-kind membership for the exact space. Used by rename, removal and family
  synchronization; self-only account edits do not require ownership.
- `getMySpaceRole.isOwner` drives the profile UI. Owner display derives from
  `spaces.ownerId`, not whichever admin happens to be returned first.
- Family profile listing requires real access. Pending onboarding preview remains
  a distinct existing flow. Event read rules are unchanged.
- Profile save and onboarding resolve discovery IDs server-side; neither creates
  an accepted `userId` relationship or trusts a client-supplied joined status.
  Existing claimed account relationships cannot be replaced through contact input.
- Synchronization prefers stable entity IDs; legacy contact IDs use their previous
  persisted contact to preserve identity on rename. Ambiguous matches fail closed.
- Manual/unconnected profile removal deletes the entity, not an account/access
  row, event, task or birthday. Existing historical records remain untouched;
  their profile-reference presentation still needs device QA.
- `assertProfileCanBeRemoved` blocks owner profiles, joined profiles and profiles
  associated by stored IDs with an access row. Both direct removal and bulk orphan
  cleanup enforce this guard. No access revocation is claimed or implemented.
- The UI distinguishes joined-account removal as unavailable. Removal awaits the
  server and reports errors. The existing manual profile + contacts-mirror save
  remains two requests; a second-request failure is reported, not concealed.

## Why authenticated removal stopped

This is not safely implemented by deleting access and changing a few space IDs:

1. `ownerScope` is optional on legacy events/tasks. `classifyEventForBackfill`
   and `classifyTaskForBackfill` explicitly return `ambiguous` for some records.
   Current sharing cannot safely reconstruct creation-time ownership.
2. Tasks can reference `sourceEventId` / `sourceImportantItemId` and member IDs;
   event important items, explicit profile shares and account assignments are
   distinct relationships. Moving a parent while leaving its dependent record
   can hide data or leave references in the wrong context.
3. `linkedEvents` has both recipient and destination-space identity. Captures,
   birthdays and import provenance also have space references. Recurrence lives
   on event/task records; `scheduledReminders` references stable event/task/user
   IDs plus scheduled function IDs. A migration must inventory these relations
   and recipient eligibility rather than cancel/recreate them indiscriminately.
4. `tasks.listBySpace` and `listUndated` do not check active space membership;
   `isPersonalTaskForUser` admits ordinary unassigned tasks. Thus deleting access
   alone would not close all direct-ID reads. This adjacent authorization gap is
   reported, not changed as part of the stopped migration.
   Follow-up: the local Security Phase 1 fix now gates these task lists on
   creator/explicit-user assignment, not an unassigned-task fallback; see
   [task authorization](../task-space-authorization.md). This does not implement
   authenticated-member removal or migrate any personal content.
5. `resolveMySpaceId` still has a legacy entity fallback, while `users.getMySpace`
   can return a stale default. Owner contacts mirrors and pending phone matches
   could recreate discovery paths unless an eventual revocation transaction
   handles them consistently. Internal repair/backfill functions are not a safe
   removal/rejoin policy and were neither changed nor run.

## Options for the next approved step

Recommended: build a **read-only removal planner** first. For one stable
entity/access/user identity, classify and inventory all relevant records,
relationships, reminders, legacy ambiguity and write volume. Report every
blocker without changing data. Use synthetic fixtures first; live execution
requires separate authorization.

After reviewing the planner, implement an atomic, ID-preserving removal only
for cases proven safe; reject ambiguous/oversized cases without partial writes.
For legacy ambiguity, approve explicit per-record ownership resolution before
migration. If record volume needs staged movement, design a resumable migration
with an access barrier and recovery plan; do not silently batch partial revocation.

The alternative is to retain the current explicit block on authenticated-member
removal until the complete lifecycle is designed. No records are migrated now.

## Validation

Exact focused command:

```sh
bun test tests/convex/privacyAuthorization.test.ts tests/convex/familyMembershipPhase1Invariants.test.ts tests/convex/canonicalFamilyMembers.test.ts tests/convex/claimedMemberProtection.test.ts tests/convex/claimedUserCompletion.test.ts tests/convex/phoneMatchConfirmation.test.ts tests/convex/pendingFamilyPreviewOnboarding.test.ts tests/convex/usersAccessControlWave1.test.ts tests/convex/accountDeletion.test.ts
```

Result: 380 passed, 0 failed. Includes real handler fixtures for owner creation,
member write denial, self edit, owner profile edit, stable-ID rename, owner
protection, manual removal, joined-removal blocking, input forgery, profile read
access and authorized phone join. Existing private-event and account-deletion
regressions are included. Old claimed-name/retained-access characterization
expectations were updated to the confirmed contract, not merely suppressed.

- `bun test tests/convex`: 1645 passed, 1 failed. The remaining
  `calendarImportOnboarding.test.ts` failure expects the old `דלג` copy.
- `bun run type-check`: fails at `app/(authenticated)/calendar.tsx:6511` because
  FlashList does not accept `initialScrollIndexParams`.
- Both failures were reproduced in a separate local source copy with this task's
  files restored to their pre-edit snapshots; unrelated work was not changed.
- `git diff --check`: passed. Reviewed this task's diff against pre-edit snapshots.

The in-memory adapter does not emulate Convex argument validation, transactional
rollback or concurrency. Revocation/migration/rejoin prevention tests cannot be
claimed to pass: that feature is blocked, not implemented. No device QA ran.

## Two-account manual QA after an approved Development deployment

Run on iPhone and Android, with owner A and regular member B:

- A can add/edit a manual profile, edit B's family label, and rename the space.
  Verify Hebrew RTL, touch targets, disabled removal state and error wording.
- B sees read-only family cards and can save their own name/color; attempts to
  invoke family mutations directly fail. A cannot remove the owner profile.
- A removes a manual profile; B retains access; historical event/task/birthday
  data remains. Check reopening, disconnect/failure and duplicate-name cases.
- Joined removal clearly reports unavailable and leaves profile/access/data
  unchanged, including attempts through bulk synchronization.
- New-user onboarding and existing-account phone selection/join still work;
  discovery alone grants no access. Private events remain private; explicit
  shares, family-shared events and community events retain their distinct rules.
- Once removal is implemented: additionally test direct IDs/cached navigation,
  stale matches/rejoin, old/new personal spaces, personal and family data,
  recurrence, links and notifications in foreground/background/closed app.

Not ready to deploy as the completed removal feature. Permission hardening is
ready for review; a controlled Development release of that limited scope still
requires explicit approval and acknowledgement of the blocked lifecycle and
existing checks above.
