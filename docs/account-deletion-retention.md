# Account deletion and retention — 2026-10-14

Implementation on develop, starting at cf0a7c5. At the 2026-10-19 checkpoint,
the founder confirms Development deployment and device QA for Places/event
fixes only; this does not establish the deployed revision or hosted/device
verification of the Storage, retention or account-deletion changes here.
Earlier no-deployment/no-commit statements describe their implementation sessions.
Automatic Storage cleanup, backfill and physical purge remain unapproved and
disabled. Historical retention/provenance gaps remain unresolved. No Production
verification or release readiness is claimed; the checkpoint performs no
deployment, migration or cleanup.

## Approved follow-up decisions and implementation boundary

The final-lifecycle request approves retaining files only while legitimately
referenced; a 30-day recovery window followed by bounded cleanup, without an exact
physical-purge promise; automatic family succession to an eligible linked account;
and closure without a successor only when independent users/data are preserved.
Family ownership never transfers billing, purchases or RevenueCat identity.
These decisions supersede the earlier open policy questions below. Approval of
policy is not approval of a broad storage architecture or a future child-account
model.

**Family ownership succession is implemented locally.** Under the approved current
MVP rule, a successor is eligible only when a non-pet family contact entity has
`userId === matchedUserId`, `inviteStatus === 'joined'`, exactly one same-space
`kind:'access'` membership, and an existing `users` row with `isActive === true`.
Manual profiles, discovery-only phone matches, display names, unjoined contacts,
missing/deleted users, disabled users and mismatched/duplicate legacy linkage are
never selected. This treats a verified linked account as adult-capable for the
current product; it is not age verification or a legal adulthood determination.
No date of birth, attestation field or child-account model was added.

Selection uses the access membership's stable join order: valid `joinedAt` values
sort first and earliest; missing/invalid values sort after all valid values; ties
use `_creationTime`, then the access membership ID. The selected membership is
promoted to `admin`, `spaces.ownerId` is changed to its user, and every departing-
owner access row is removed in the same account-deletion mutation. The transaction
then verifies that owner ID and membership role agree before Auth state/user removal.
Shared events, tasks, birthdays, manual profiles and other memberships are excluded
from the closure cascade. If no eligible successor exists, safe closure remains;
an existing active access account with ambiguous profile linkage blocks before any
write rather than being treated as absent. A retry cannot repeat a committed transfer
because the old account's Auth session and user row are removed.

**New safe closure guards:** the planner previously cascaded every event/task/
birthday by spaceId even when createdBy belonged to another account. No remaining
access member does not prove exclusive ownership. The planner now blocks before
all writes if any such record has another/missing creator, rather than deleting,
reassigning or moving it. Explicit event user shares and task user assignments
to another account also block closure even when the departing owner created
the record; family membership is not required for those independent permissions.
An independently created record outside the closing
space is never deleted merely for selecting a manual family profile: known
surviving events referencing closing-space member IDs, and discovered retained
task assignments to those IDs, also block closure. The UI maps these blockers to
its existing safe support message. No IDs, subscription changes or new scans.

The existing sole-owner case still closes the family and removes its exclusive
manual profiles/content. This is NOT proof that every possible cross-space
dependency is covered: task discovery is bounded by the existing reachable/
created/assigned paths, not an inverse index of every member reference. Historical
participantDetails/participants are display provenance, not authoritative ownership.
There is no approved destination/remapping rule for retaining a referenced manual
profile after its space closes. Full closure needs that rule and an exhaustive
bounded reference inventory; do not silently drop participants or migrate records.

### Storage lifecycle Stage 1 — implemented locally

Stage 1 adds additive `storageUploadIntents`, `storageFiles` and
`storageReferences` tables. Current clients create an authenticated one-hour
upload intent, finalize it with the Storage ID returned by Convex, and bind it
only inside an authorized event/task write. One indexed reference row represents
one unique parent/file pair, regardless of repeated use inside that parent.
Event attachments, task attachments, subtask images and subtask attachments are
extracted by shared helpers and reconciled in the same mutation as the parent.

The legacy `events.generateUploadUrl` API remains available for installed clients.
An unregistered Storage ID accepted through that compatibility route is recorded
as `origin:'legacy'` without `uploadedBy`; it is never relabelled as owned by the
submitting account. Until a verified backfill exists, new acquisitions still use
the existing event/task document scan as a compatibility guard. Therefore an
empty reference index is not evidence that a file is unused.

Ordinary event/task create/update, subtask attachment replacement/removal, task
hard removal, personal event hard removal and the unscheduled cancelled-event
hard-delete helper maintain/release registry rows. Account-deletion/family cascade
and developer reset paths are deliberately not modified because they overlap the
concurrent ownership/deletion work; they can leave conservative stale references.
Cleanup remains disabled, so stale rows cannot cause physical data loss.

No backfill, migration, reconciliation run, cleanup worker, cleanup cron, account-
deletion file cleanup or new `storage.delete` call was added. Existing ordinary
attachment deletion behavior is unchanged. A Convex Development deployment and
updated client build are required before the revised upload flow can be exercised
on devices; neither was performed here.

### Later storage stages still requiring approval and verification

#### Local provenance and inline-image corrections

Direct-upload finalization now records `origin:'legacy'` without `uploadedBy`,
while retaining `uploadIntentId` for authenticated workflow authorization and
expiration/binding checks. Existing managed rows are not rewritten; their labels
and uploader claims are not verified provenance either. Existing parent reads and
unchanged references remain authorized by their parent, not by upload receipts.
Matching receipt retries require the same authenticated intent and registry binding;
unbound expired receipts and mismatched IDs are rejected. A bound retry is only a
historical receipt acknowledgment, not proof that the object still exists.

The direct-upload API returns the Storage ID to the client. Its exposed metadata
does not identify the issuing application intent or authenticated uploader (see
[Convex upload APIs](https://docs.convex.dev/file-storage/upload-files)). Thus a
new upload and an old unregistered/unreferenced object cannot be reliably
distinguished here. Existing indexed or embedded event/task references and registry
bindings block new cross-parent acquisition, but unknown-object adoption remains
an unresolved security limitation of the compatibility path. This bounded fix does
not claim to solve it. A separately scoped authenticated server-controlled upload
flow is needed for trustworthy provenance; timestamps are not a substitute.

Verified provenance: none established by this direct-upload path. Legacy/unverified
provenance: all its receipts, including historical managed entries. Active references:
current parent relationships (including retained trash), not ownership evidence.
Bound intents: historical workflow state, not active references or object existence.
Storage existence: a separate metadata observation; absence does not establish who
deleted it. No references, or no registry row, does not establish safe deletion.
No cleanup eligibility is assigned and no new deletion path is added.

Inline subtask replacement/removal now follows the rendered `attachment ?? image`
slot. An attachment takes precedence and a separate legacy image is preserved.
For image-only records, removal clears image; replacement converts the displayed
image into attachment without retaining the replaced image. Old client payloads
remain accepted. Concurrent edits still use the persisted slot at mutation time;
no new stale-client concurrency protocol is introduced.

Subtask attachment display correction (local, not deployed): Task Editor passes
the task ID for authorized URL resolution; Task Details renders the same preview
and allows opening images and files without inline editing. Local drafts use their
local URI, not an unscoped Storage lookup. URL/download failures offer retry;
pending lookups and image downloads time out after 15 seconds. Home is unchanged.
The editor now retains both historical slots through draft normalization and save,
and `tasks.sanitizeSubtasks` preserves both instead of discarding the legacy image.
Removing the preferred attachment intentionally reveals the retained legacy image;
another explicit removal is needed to remove that image. Reference synchronization
and authorization remain unchanged; no Storage object is physically deleted.
The backend preservation correction requires a separately authorized deployment
before both-slot save/reopen can be verified on hosted Development. Android and
iPhone QA remain pending; JavaScript display changes can be loaded through Metro.

Stage 2 design may proceed, but backfill, mutating reconciliation, automatic cleanup
and physical purge remain blocked pending provenance/reference coverage and separate
approval. Device and hosted verification of these local corrections is outstanding.

Local correction validation commands (no hosted calls):

```sh
bun test tests/convex/storageReferenceTracking.test.ts
bun test tests/convex/storageReferenceTracking.test.ts tests/convex/retentionLifecycle.test.ts tests/convex/familyDeletionClosure.test.ts
bun test tests/convex/storageReferenceTracking.test.ts tests/convex/retentionLifecycle.test.ts tests/convex/familyDeletionClosure.test.ts tests/convex/taskSpaceAuthorization.test.ts tests/convex/tasksGetTaskDetailsAccessControlWave1.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/communityTaskAssignmentSave.test.ts
bunx tsc --noEmit
bunx tsc -p convex/tsconfig.json --noEmit
bunx biome check convex/storageLifecycle.ts convex/schema.ts convex/tasks.ts tests/convex/storageReferenceTracking.test.ts
git diff --check
```

Core storage/retention/closure: 78 passed, 0 failed. Broader authorization suite:
336 passed, 1 failed (the explicit-family/cross-space event-share failure already
observed in the preceding QA baseline). Both TypeScript checks passed. Biome retains
the previously observed unrelated tasks.ts formatting failure at the orphan-fallback
condition/full-edit expression; no formatting of that unrelated block was performed.
Whitespace check passed. New regression cases exercise actual handlers with synthetic
DB/storage adapters; they do not prove hosted ownership, transport, or concurrency.
Pending iPhone/Android: personal/community legacy image removal and replacement,
both-slot preservation, reload persistence, valid attachment opening, and older-client
payload compatibility. No deployment, migration, backfill or cleanup was performed.

Stage 1 implements reference bookkeeping, NOT verified upload provenance. The remaining
contracts for future cleanup are:

- File registry: storageId, upload intent, authenticated uploader, creation time,
  attachment state and cleanup state/attempt/error. Uploader is provenance, not
  authority to delete every copy. Reference rows identify parent table/ID and
  storageId, indexed by file and parent; references are deduplicated transactionally.
- Upload intent: issue before upload, bind finalization to the authenticated user.
  A client-submitted storageId alone is not trusted proof of upload ownership.
  The current direct-upload implementation does NOT establish that binding.
  All current and historical receipts remain unverified and ineligible for orphan
  deletion based on uploader claims, origin labels, or intent ownership.
  Do not relabel legacy unregistered files as owned by whoever submits their ID.
- Acquire/release refs in every event/task/subtask create/update/delete path;
  include trash and retained copies. Remaining cascade gaps must be closed before
  coverage can be certified. A worker checks final references and file state in
  the same mutation as deletion; concurrent acquisition must participate in that state.
- Failed storage/delete/finalization remains pending with observable attempts.
  Bounded scheduler retries, completion records and a reconciliation cursor handle
  interrupted jobs; absence of metadata is idempotent completion, not generic
  suppression of storage errors. Retain unknown files pending investigation.
- Legacy cutover requires a separately authorized paginated reference backfill
  with coverage/version evidence and concurrent dual writes. Never enable deletion
  merely because a newly added empty index has zero references. No migration run.
- Approve an abandoned-upload grace period; only proven old unreferenced uploads
  qualify. Test multiple parents, trash, copies, new references racing deletion,
  lost upload responses, retry after failure, unknown legacy records and batch
  boundaries with actual handlers and mocked storage. Stage 1 registry tests do
  not substitute for the still-missing worker and reconciliation proof.

Thirty-day physical cleanup remains unscheduled. It must use the same complete
dependency/reference lifecycle, with bounded indexed expiry discovery, retry
state and rechecks for restored/retained records. An independent destructive cron
would bypass those guarantees and was not added.

### Subscription and release boundary

No subscription code, purchases or provider data changed. Existing deletion
behavior, including deletion of the account's legacy app subscriptions rows,
remains unchanged. useEffectiveAccess currently derives access from the current
user's RevenueCat/trial state; ownership is not a payer mapping. Future family
entitlement reassessment must be wired at ownership transfer/closure, member
departure and payer entitlement changes, using an approved payer/space model.
This is a separate audit's responsibility; it is not permission to rewrite gating.

- Before external TestFlight: hosted/device verification of atomic succession;
  safe closure/remapping of independent references; approved storage architecture,
  bounded file/trash cleanup and existing URL-security decision; operational
  deletion fallback; hosted and iPhone/Android QA. Local cache failure limitations
  described below also remain. No claim of external-release readiness.
- Before public launch: verified provider/backup/log operations, store/privacy
  disclosures and approved family entitlement model/enforcement if offered.
- Post-launch improvement: richer cleanup dashboards and unrelated performance
  work beyond the minimum bounded reliable lifecycle.

Convex Development deployment will be required to exercise these backend changes
on devices after review and authorization. No deployment performed; existing
hosted behavior is unchanged. Test both platforms with sole/manual family,
one/multiple eligible successors, ambiguous linkage, retained external records,
failed/retried deletion,
old sessions/push/file URLs, account switch, Hebrew RTL and store subscription.

## Existing lifecycle and data classification

| Operation/data | Current behavior |
| --- | --- |
| Personal event soft deletion | Creator/orphan-authority checks; invited active events must first be cancelled. Sets deletedAt/deletedBy and deleteExpiresAt (+30 days); revokes original share links. |
| Cancellation | Distinct from deletion; cancelled events and their share previews can remain visible. No automatic physical erasure. |
| Event hard deletion | Deletes event, tombstones linkedEvents to use saved snapshots. Does not provide a complete dependent-record/file cascade. |
| Task soft deletion | Sets trash metadata; preserves record, subtasks and attachments. Ordinary lists already exclude trash. Details and attachment URLs now exclude all trash too. |
| Task hard removal | Existing remove mutation cancels pending task jobs, deletes participant settings, checks attachment references, then deletes task. |
| Restore | Only deleting user; record must be deleted. An explicit deleteExpiresAt <= server Date.now() now rejects before any write. Legacy missing expiry retains existing behavior; no inferred deadline or migration. Restored events do not republish old links. |
| Account deletion | One mutation: read/plan, blockers and 4,000 planned-write gate, writes, residual checks, Auth dependencies, user row last. Server exceptions roll back the transaction. A lost client response is not proof of rollback. |
| Exclusively owned content | Personal-scope events/tasks and user-scoped tables removed. Sole-owned spaces and communities cascade their content. Files are NOT cascaded by account deletion. |
| Shared content | Other spaces/communities survive with historical createdBy; account assignments/access/memberships are removed/remapped. External family entities retain independently recorded names/phones but clear account links. This describes implementation, not approval of indefinite retention. |
| Independent recipient copies | Survive source/account deletion. Saved linked events use limited snapshots when source is deleted. These snapshots/copies do not copy typed attachments. |
| Family departure/removal | Owner account deletion now transfers ownership to the deterministic eligible linked successor, or safely closes when none exists. This does not create a general self-service transfer/leave path; authenticated-member removal remains deliberately blocked. |
| Community departure/deletion | Non-owner leave removes membership; owner leave rejects. deleteCommunity archives rather than erases. Account deletion already transfers to earliest eligible admin/member, or hard-deletes a sole-owned community. No new transfer rule introduced. |
| Security/billing/provider records | App Auth sessions/tokens/accounts and user-scoped notification/subscription records removed by account deletion; external provider data and backup/log retention are separate. No new legal retention category or deadline inferred. |

Source: convex/accountDeletion.ts, events.ts, tasks.ts, communities.ts, members.ts;
lib/accountDeletion.ts. Historical family-space-subscription-deletion-lifecycle
audit describes a now-replaced stub and must not override this implementation.
Relevant newer decisions: [family removal](audits/family-profile-removal-authorization.md),
[event access](event-read-authorization.md), [task access](task-space-authorization.md),
[session validity](authentication-session-validity.md), and
[previous readiness audit](audits/production-readiness-p0.md).

## Safe changes in this task

- events.ts/tasks.ts enforce explicit restore deadlines, including equality;
  tasks also rejects non-trash restore. No permanent-deletion job added.
- tasks.getTaskDetails/getTaskAttachmentUrl reject deleted personal/assigned
  tasks even for creators. Previous code guarded only general community reminders.
- taskUtils.safeDeleteStorageIfUnreferenced checks `_storage` metadata for an
  already-missing file; other storage failures propagate. Previously every delete
  error was swallowed. Existing update/remove callers now abort on cleanup errors.
  Existing all-event/all-task reference scans remain; no new call sites were added.
- accountDeletionUi requires explicit `{success:true}`. Unknown/network failure
  no longer claims no changes occurred. Unsafe family-data blockers use the
  existing support path. Profile adds the existing
  deletion-information URL to the failure dialog and explains retained data/files.
- Trash UI describes restoration rather than guaranteed physical retention,
  disables expired rows at render, and uses inclusive errors. Server validation
  remains authoritative if a screen stays open across the deadline.

## Storage inventory, Stage 1 boundary and later design

Typed `_storage` references: events.attachments, tasks.attachments,
tasks.subtasks.image and tasks.subtasks.attachment. Profiles/communities do not
have typed storage IDs; opaque capture imageUrl/URLs or local image references
must not be assumed to establish deletion ownership. Updated clients use
events.createStorageUploadIntent and events.registerStorageUpload; the legacy
events.generateUploadUrl path remains compatible. Managed abandoned uploads now
have durable provenance but no deletion policy or worker. Actual orphan counts are
unknown; no inventory was inspected.

Existing attachment write guards and Stage 1 acquisition checks reject new
unauthorized cross-document references, but legitimate legacy shared references
remain possible and can be represented by multiple parent rows. Existing cleanup
checks both parent tables including trash. Account deletion can release no registry
rows yet and can leave exclusive orphans/stale references. No orphan-discovery job
exists. A registry test is not evidence of account-level cleanup.

Previously issued URLs are bearer access, not revocable sessions. Denying new URL
generation does not revoke a downloaded/copied URL. Convex documents that deleting
the file revokes its URL; serving preserved shared files with per-request access
would require an explicitly approved serving change. See
[Convex storage security](https://docs.convex.dev/file-storage/overview).

Next-stage work, not implemented:
1. Close the documented hard-delete integration gaps and prove every parent writer
   participates before declaring registry coverage complete.
2. Run a separately authorized bounded backfill/reconciliation with durable
   coverage/version evidence. Legacy files remain unknown until that proof exists.
3. Collect unique candidate IDs before removing parent references. Bounded cleanup
   jobs recheck the authoritative index, preserve live/trash references, delete
   only after the final reference, and record pending/failed/completed outcomes.
   Concurrent attachment must update the same index in the transaction.
4. Retry idempotently; missing object means done, operational errors remain pending.
   Abandoned uploads need an approved grace period and final attach-state check.
5. Keep account revocation distinct from data-erasure completion, with durable
   status visible to support. Test large accounts/concurrency/legacy cutover before
   enabling this. No global full-table delete or global file purge.

## Blockers and usable support prerequisites

| Blocker | Protection / smallest next step |
| --- | --- |
| Ambiguous active family linkage | An active account has access but no unique strict linked contact/access pair. Resolve the exact records under reviewed authorization; never select by phone/name or close the space as if that account were absent. |
| Inconsistent community membership | Existing deterministic transfer cannot safely choose a successor. Resolve exact contradictory memberships under reviewed authorization; do not guess or remove members. |
| Ambiguous legacy scope/member remap | Prevents destruction/reassignment of shared records. Request scoped evidence and approve classification; never blanket-backfill personal ownership. |
| >4,000 planned writes / runtime read limits | Guard is an estimate, not guaranteed transaction capacity. Planner itself contains broad reads. Needs staged bounded planning/deletion with revocation and resumable completion state; do not raise the limit. |
| File dependency/provenance unknown | Currently does not block account-row deletion, but prevents claiming full erasure. Needs reference coverage and cleanup status above. |

Retry of an explicit blocked mutation performs no writes; a network timeout may
follow a committed deletion. Retry must not recreate the old user or repeat a
completed ownership transfer. The old session is rejected after successful deletion.

Before calling support a workable deletion route, an owner must:
1. Assign a named operator and monitored channel behind the existing deletion page;
   test intake and acknowledgment with synthetic requests, including a signed-out user.
2. Verify identity through an authenticated request or a reviewed recovery process;
   never ask for passwords, OTP forwarding or tokens. Record minimal request ID,
   account linkage and consent in access-controlled support storage.
3. Supply a production-safe, scoped read-only planner and least-privilege execution
   tool with audit trail. Current accountDeletionPreview is QA-only and allowlisted;
   do not enable QA reset or relax its guards for support requests.
4. Review retained shared entities, recipient copies, ownership consent and provider
   actions. Unresolved ownership means blocked status, not successful erasure.
5. Execute only separately authorized, bounded reviewed operations, verify residual
   assignments/auth/files and retries, then communicate completed versus pending data.
6. Define a service target and escalation owner before publishing a promise. No
   operator, channel operation or safe production execution tooling was verified here.

## Thirty-day retention dependencies

New soft deletions set +30 days. This task enforces the stored restoration boundary;
there is still **no physical purge cron**. Expired rows remain in trash, disabled.
Legacy no-expiry rows are undecided. No promise of erasure on day 30 is justified.

Before a purge: decide saved snapshots/independent copies, eventTasks, RSVP,
calendar entries, personal opt-outs, task settings, reminder jobs, notification
history, copy/import dedup registries and storage references. Account cascades
do not use one complete common lifecycle helper. reminderScheduler.fireReminder
checks deleted/archived tasks; that does not prove every legacy/event notification
path is cancelled. Preserve dedup records where intended; do not attach a cron to
the existing hard-delete function and assume its dependency coverage is sufficient.

## Device cleanup and authorization verification limits

Existing birthday cleanup is account-keyed, waits for queued writes and suppresses
late writes/loads for that ID in the current process. Tests retained and rerun;
not reimplemented. Other accounts' keys survive. Successful deletion invokes
notification-cache filtering, onboarding reset and sign-out; backend failure does
not invoke cleanup. Birthday sheets reset on identity change. Auth/session guards
remain in place for reads/writes/uploads/push/join operations.

Limitations found: onboarding draft is device-global and its removal swallows
errors; the root SecureStore adapter also swallows removal errors. Therefore local
cleanup success is not proof of secure physical erasure. Birthday tombstones are
in-memory; failed removal followed by a process crash needs device recovery QA.
Legacy notification storage uses read/modify/write without a serialized queue;
late concurrent writers are not proven safe. Native image-picker/image caches
have no account-scoped deletion ledger. No broad cache/directory wipe introduced.

RevenueCat invalidates local identity generation/customer state and guards late
responses. Purchases.logOut is intentionally unused; next login switches identity.
This does not delete the provider customer/native SDK cache. Google authorization
keeps access tokens in component state, discards refresh tokens and clears the
import flow's state; deletion does not revoke Google's authorization grant.

## Provider operations checklist (not performed)

For every request: verify identity, identify the exact provider account/project,
collect minimal scoped IDs under separate authority, review billing/required
retention, record a provider ticket/result, and report unresolved exceptions.

- Convex: application Auth deletion is implemented. Storage, deployment logs,
  backups and expiry need separately verified operational retention; do not equate
  deleting users with purging backups/files. Confirm with provider support.
- RevenueCat: Convex user ID maps to customer identity; receipts/entitlements and
  aliases can remain. Review aliases and active purchases before an operator uses
  dashboard customer deletion or the [customer API](https://www.revenuecat.com/docs/api-v2/customer).
  Do not promise cancellation of App Store/Play subscriptions; customers manage
  those separately. See [customer support actions](https://www.revenuecat.com/docs/dashboard-and-metrics/supporting-your-customers).
- Twilio Verify: phone, verification/delivery metadata are sent by auth.ts. No
  provider deletion integration exists. Operator requests the applicable Verify
  erasure/retention procedure with scoped service/account/recipient/time identifiers;
  cancelling a verification is not proof of log erasure. Verify current terms with
  [Twilio retention guidance](https://help.twilio.com/articles/4410585868443).
- Expo/APNs/FCM: app push tokens are deleted, but already queued/delivered messages
  cannot be recalled by that transaction. Expo documents transient queue/memory
  handling rather than database content storage in its [FAQ](https://docs.expo.dev/push-notifications/faq/).
  Separately confirm Apple/Google delivery/log rules; do not invent a deadline.
- Google Calendar: imported app records/registry follow account deletion; original
  Google calendar data remains external. User can revoke the connection; an
  automatic token-revocation integration would need separate review of Google's
  [revocation contract](https://developers.google.com/identity/openid-connect/reference).
- Website/email/support: no website provider or mail-retention inventory is
  established by this mobile repo. Operator must identify hosting/forms/mailbox/
  analytics vendors and delete scoped submissions where applicable. No website
  privacy copy was edited or published; the earlier audit's policy conflict remains.

## Release gates and decisions

Before external TestFlight: approve shared-file retention and URL security model;
close account-file/orphan cleanup and blocked-owner support path; resolve trash
purge policy/implementation and inaccurate public promises; verify local failure/
crash cleanup plus controlled hosted and device sessions/storage/deletion tests.
These are remaining gates, not claims that this task delivered release readiness.

Before public store launch: verified provider request operations, store-subscription
and disclosure review, backup/log retention and sustainable support capacity.
Defer broader performance/observability refinements and unrelated existing bugs;
bounded cleanup and integrity are prerequisites, not optional optimizations.

Earlier questions resolved by the follow-up: shared-file retention and bounded
post-recovery cleanup are approved; automatic eligible linked-account family
succession replaces the proposed support-only transfer. Remaining decisions are
referenced-profile preservation/destination, approval of the concrete
storage architecture and upload grace period, bearer-URL access and support operation.

Next focused task: approve the storage-reference/upload registry and retention
contract, implement bounded bookkeeping and synthetic lifecycle tests, then review
a separate staged-account/support design. No architectural follow-up executed here.

## Earlier safe-patch validation and changed files

Implementation: convex/events.ts (expiry), convex/tasks.ts (expiry/trash reads),
convex/taskUtils.ts (storage errors), lib/accountDeletionUi.ts (explicit success
and honest failure), app/(authenticated)/profile.tsx (retention/support wording),
app/(authenticated)/recently-deleted.tsx (expiry UI). Tests:
tests/convex/retentionLifecycle.test.ts and
lib/services/__tests__/accountDeletionUi.test.ts. Documentation: this file,
task-space-authorization.md, audits/production-readiness-p0.md. No initial local
changes existed; final tracked diff and both new files were reviewed.

Commands actually run (all local, synthetic records):

```sh
bun --no-env-file test tests/convex/retentionLifecycle.test.ts lib/services/__tests__/accountDeletionUi.test.ts
bun --no-env-file test tests/convex/retentionLifecycle.test.ts tests/convex/accountDeletion.test.ts tests/convex/birthdayStorageIsolation.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/notificationSessionLifecycle.test.ts tests/convex/familyMembershipPhase1Invariants.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/productionPrivacyP0.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/communityTaskAssignmentSave.test.ts lib/services/__tests__/accountDeletionUi.test.ts
bun --no-env-file test
bun run type-check --incremental false
bun --no-env-file x --no-install tsc --noEmit --incremental false -p convex/tsconfig.json
bun --no-env-file x --no-install biome check --reporter=json convex/events.ts convex/tasks.ts convex/taskUtils.ts lib/accountDeletionUi.ts 'app/(authenticated)/profile.tsx' 'app/(authenticated)/recently-deleted.tsx' lib/services/__tests__/accountDeletionUi.test.ts tests/convex/retentionLifecycle.test.ts
git diff --check
```

- New lifecycle + UI suite: 61 passed / 0 failed. Broader focused suite: 783 / 0.
- Before edits, full suite: 3,006 passed / 5 failed. Final full suite: 3,033 passed /
  the same 5 failed, 3,038 tests in 115 files. No new final failures.
- Existing failures: device-calendar ownerScope insert assertion; explicit family/
  cross-space event share regression; onboarding import skip assertion; Android
  Google authorization error assertion; native Google cancellation assertion.
  These were reproduced before edits, not assumed from the supplied baseline.
- App/Convex TypeScript and diff whitespace check passed.
- Focused Biome: 2 formatting errors (tasks.ts and recently-deleted.tsx), 1 unused
  variable warning (events.ts). Confirmed against `git show HEAD:<path>` copies
  with the same Biome configuration; unrelated baseline formatting preserved.

Coverage of requested scenarios:

| Scenario | Evidence / remaining limitation |
| --- | --- |
| Personal account deletion | Actual deleteMyAccount, subsequent rows/session reads; synthetic DB adapter. |
| Blocked deletion/retry | Ambiguous family linkage and volume preflight preserve rows; retry tested; no hosted rollback simulation. |
| Shared data preservation | Shared event creator retained; community content/ownership transfer verified. |
| Exclusive file cleanup | Existing helper removes an unreferenced candidate/excluded parent; account cascade remains missing. |
| Shared files | Event/task/subtask image/subtask attachment references, including trash, preserve files. |
| Orphans | Given unreferenced candidate tested; orphan discovery/provenance not implemented or tested. |
| Expired content | Real task details/URL denied; restore rejects at/after explicit deadline. |
| Restoration boundaries | -1/0/+1 ms, missing legacy expiry, non-trash rejection; existing sharing tests retained. |
| Switching/local cleanup | Existing birthday-isolation and cleanup orchestration tests passed; crash/native cache limits above. |
| Deleted-session authorization | Actual deletion then protected read/retry; auth revocation and entry-point suites passed. |
| File URL after deletion | New URL denied for deleted account/trash; issued URLs require separately authorized hosted QA. |
| Ownership invariants | Actual family/community transfer handlers plus deterministic planner tests; owner ID/role consistency verified in-transaction. |
| Idempotent cleanup | Missing storage object and repeated cleanup; repeated blocked deletion. |
| No false success | Malformed/negative responses rejected; storage error propagates; known cache failure still attempts sign-out. |
| Personal/community regressions | Focused event package, family, assignment and privacy suites passed; unrelated baseline failure disclosed. |

Not run: iPhone, Android, hosted JWT/transaction/storage behavior, two real test
accounts, provider-side requests, cold-start/offline/crash scenarios, RTL visual
and screen-reader checks. Required device cases include successful/blocked deletion,
old JWT and old file URL, stale restore screen, account switching/late writes,
storage failure then restart, shared owner/member data and active store subscription.
Implementation complete for the listed safe patches; verification pending for
hosted/device behavior. Broader deletion/retention scope is blocked as listed above.

## Final-lifecycle follow-up validation

The ownership-successor follow-up adds the deterministic pure planner in
lib/accountDeletion.ts, atomic planning/writes/verification in
convex/accountDeletion.ts, an accurate read-only preview shape, and actual-handler
regressions in tests/convex/familyDeletionClosure.test.ts. Earlier closure, UI,
retention and unrelated uncommitted work was preserved. No entitlement, product,
purchase or RevenueCat integration file changed.

The foreign event/task/birthday deletion bug was reproduced before the fix: the
initial 6-case suite had 3 failures because deletion succeeded instead of blocking.
The final suite covers exclusive manual-profile closure, independent data, external
event/user shares, task/user assignments, manual-profile references, unchanged
rows on blocked retries, and truthful UI failure. The successor follow-up adds
actual-handler coverage for one/multiple eligible linked contacts, deterministic
ordering, manual/unlinked/phone-only/invalid exclusions, ambiguous linkage,
shared-data survival, unchanged community/subscription state and post-success retry.

Commands:

```sh
bun test tests/convex/familyDeletionClosure.test.ts tests/convex/accountDeletion.test.ts tests/convex/retentionLifecycle.test.ts
bun test tests/convex/familyDeletionClosure.test.ts tests/convex/accountDeletion.test.ts tests/convex/retentionLifecycle.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/notificationSessionLifecycle.test.ts tests/convex/familyMembershipPhase1Invariants.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/taskSpaceAuthorization.test.ts tests/convex/communityTaskAssignmentSave.test.ts lib/services/__tests__/accountDeletionUi.test.ts
bun test
bun run type-check -- --incremental false
bun x tsc -p convex/tsconfig.json --noEmit
bun x biome check convex/accountDeletion.ts convex/accountDeletionPreview.ts lib/accountDeletion.ts tests/convex/accountDeletion.test.ts tests/convex/familyDeletionClosure.test.ts tests/convex/retentionLifecycle.test.ts
git diff --check
```

Ownership/account-deletion core: 199 passed / 0 failed. Broader focused suite:
1,082 passed / 1 failed; the one
failure is the unchanged explicit-family-share fixture already listed in the
earlier baseline. Final full suite: 3,051 passed / the same five baseline failures,
3,056 tests across 116 files. App and Convex TypeScript, focused Biome and diff
whitespace check passed.
Hosted/devices/providers were not
tested; synthetic DB adapters do not prove transaction rollback/concurrency or
physical storage deletion. Existing missing orphan-worker/purge
behavior is deliberately not represented as implemented by tests.
