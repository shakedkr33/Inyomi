# Focused Production P0 follow-up — 2026-10-13

Status: local implementation only; **external TestFlight release remains blocked**.
No cloud writes, deployment, migration, real SMS/push, build/submission, user-record
inspection/export, commit or push. Base revision: develop / 867e6f1. The audit's
remote observations describe the read-only baseline, not a new deployment.
Operational configuration and sequence live in [deployment.md](../deployment.md).

## Local fixes and scope

- Retain Production's legacy optional spaces.primarySources string array; no
  migration or schema-enforcement bypass. Pin only EAS production to existing
  peaceful-cricket-429. Dev/preview URLs remain sincere-panther-608.
- Remove unsupported initialScrollIndexParams from the installed FlashList 2.0.2.
  Its source/types do not implement that property (current online docs describe
  newer 2.x releases). Keep initialScrollIndex, today-index calculation, list data,
  selection, padding and RTL intact; no extra post-load scroll or upgrade.
- Centralize legal destinations on inyomi.com. Sign-in links now open the platform
  browser with a visible error on failure; deletion information is reachable both
  before registration and from Profile. Existing paywall WebViews are preserved.
  Endpoint reachability does not approve legal text. Profile no longer claims all
  personal information was permanently erased after account-row deletion.
- Explicit logout waits for device token deactivation while still authenticated.
  Failed deregistration blocks logout with an honest retry message. Registration
  and logout share a serial queue; late permission/token results are discarded.
  Token is persisted before registration, scoped by backend URL, so a process
  restart/lost registration response still leaves a deregistration handle. Old
  installs fall back to retrieving the device token without requesting permission.
  Next login re-registers, including the same user. Server unregister checks token
  ownership; registration checks current user/session/expiry and optional expected
  identity to reject post-deletion writes/account-switch races. No table changes
  were needed for push. Cached notification responses/presented notifications are
  cleared at explicit logout. This cannot recall notifications already handed to
  Expo/APNs/FCM, and automatic session expiry/old binaries remain separate risks.
- Deleted source links are blocked at backend boundaries; see the canonical
  [event authorization rules](../event-read-authorization.md#deleted-source-links-production-p0-2026-10-13).
- Successful account deletion captures the account ID before reactive queries
  change, removes only that user's birthday key and legacy notification entries,
  and prevents in-flight/stale birthday writes from recreating it in this process.
  Birthday sheets clear on identity change. Other users' data and device-wide
  display/holiday/permission preferences are preserved. Backend failure performs
  none of this cleanup. Storage failure is reported; subsequent memory cleanup
  and sign-out are still attempted. The pre-existing onboarding-draft helper is
  best effort, so physical-device storage failure/crash recovery still needs QA.

All shared-code fixes also affect Development and Preview once that code is run
there. The EAS URL edit affects new Production builds only. Nothing changed in
any deployed environment or installed binary.

## Issued access tokens — original finding and local follow-up

Update: the focused [session-validity correction](../authentication-session-validity.md)
now rejects revoked/missing sessions and missing/disabled users across protected
application functions locally. The original finding below describes the baseline.
The audit reproducer has been converted to rejection/lifecycle regression tests.
No backend has been deployed. Hosted/device verification, already-issued Storage
URLs and unacknowledged offline logout remain separate limitations; external
TestFlight is still blocked. Historical test counts below describe the earlier task.

Installed Convex Auth's getAuthUserId reads the signed subject without querying
users/authSessions. getAuthSessionId likewise parses the subject. signOutImpl
removes the session and refresh tokens; the React signOut helper also suppresses
remote errors before clearing local tokens. Default access-JWT lifetime is one
hour; the application's 30-day session setting does not shorten it.

`tests/convex/authRevocationAudit.test.ts` uses an ephemeral synthetic RS256 JWT,
JOSE signature/issuer/audience verification, the actual installed signOutImpl and
the actual events.getById handler. After session/refresh deletion, the still-valid
JWT continues to read as creator. A second test removes the user row as well,
simulating the surviving shared-event/historical-creator state of account deletion:
the same actual read path still allows access. This test does not execute the full
account-deletion mutation or Convex's hosted JWT verifier. Passing this diagnostic
means the risk is reproduced, not remediated. No real credentials were used.

Do not release externally until a separately reviewed, framework-compatible live
session/user authorization boundary covers reads, writes, uploads and public
entry points consistently. Verify revoked/expired sessions, deleted users,
refresh, multiple devices, retained shared content and subscriptions, including
real hosted requests with synthetic accounts in a separately authorized task.
Do not merely reduce token lifetime or fix one screen and claim revocation.
The narrow guard added to push registration protects that endpoint only.

## Storage cleanup: investigation only, no deletions

Known typed reference locations:
- events.attachments[].storageId
- tasks.attachments[].storageId
- tasks.subtasks[].image.storageId
- tasks.subtasks[].attachment.storageId

Uploads are issued by events.generateUploadUrl before form save; abandonment or
failed save can leave unattached uploads. No inventory was read: **the existence
or count of actual orphan uploads is unknown**. Files can remain referenced by
surviving shared family/community events/tasks or legacy duplicated references.
Limited linked-event snapshots/copies do not carry attachments.

Existing taskUtils.safeDeleteStorageIfUnreferenced scans all events and tasks,
including trash references, and deletes only after none remain (with optional
one-document exclusion). It is used for attachment removal and some task deletion
paths, but not by runAccountDeletion. It catches all storage-delete errors, not
just missing-object errors, and a full scan per file is not a bounded multi-file
account deletion design. Do not invoke it blindly for all uploads by a user.

Required follow-up design before external release:
1. Approve retention/ownership for files used by surviving shared entities and
   historical uploader attribution. Review opaque/legacy representations separately.
2. Collect candidate storage IDs from precisely the records actually removed,
   before their references disappear. Recheck every surviving reference before
   deleting; preserve shared files. Establish bounded/idempotent processing,
   retry/error reporting and deletion-completion evidence.
3. Handle abandoned uploads separately: prove provenance and age and recheck for
   attachment after a grace period. Do not infer ownership from uploader alone.
4. Cover shared references, concurrent attach/detach, retry, missing storage objects,
   transaction limits and failure recovery with behavioral tests, then authorized
   synthetic-account hosted QA. Do not read/export existing users during this task.

## Blocked account deletion and support procedure

Current rules remain unchanged: an owned family/personal space with another real
access user blocks deletion; community ownership already transfers to the existing
approved deterministic successor, but inconsistent membership blocks. Ambiguous
legacy ownerScope/member remaps and the 4,000 planned-write guard can also block.
Source comments/state do not prove any particular Production account is blocked.

The existing /delete-account support page is reachable. Before release, establish
an operated request process: verify the requester, record/request a minimal
scoped deletion plan under separate authorization, explain genuinely shared data,
resolve family ownership only using an approved rule, execute reviewed bounded
cleanup, and confirm completion without exposing other users. A support link
alone does not supply this procedure or guarantee App Review compliance. Do not
remove other members or change ownership as a shortcut. Broad deletion changes
were deliberately not implemented here.

## Thirty-day trash lifecycle

Events/tasks stamp deleteExpiresAt at +30 days; listRecentlyDeleted does not filter
expired items, restore handlers do not enforce expiry, and no cron schedules final
purging. The UI says items are retained for 30 days. The unrelated 14-day cancelled
community-event internal mutation is deliberately unscheduled and is not a trash
cleanup job. No cron or expiry semantics were changed in this task.

Exact decisions required: whether day 30 ends restoration or guarantees physical
purge; which linked snapshots/shared records survive; handling eventTasks, RSVP,
calendar entries, personal opt-outs, reminders/scheduled functions, notification
history, import/copy dedup registries and attachments; retention/backups and
account-deletion interaction; batch size/retries and completion reporting. Align
UI/policy promises with the approved implementation before external release.

## Legal and integrations

Published privacy text's deletion assurances are inaccurate; the bilingual draft
is not approved/published. Public terms presently focus on website use, so the
owner must confirm suitability for the app/subscriptions. Do not treat reachable
/privacy, /terms or /delete-account pages as approval. No website text was changed.
App Store disclosures/privacy manifest and review account/device checks remain.
Child-account/store-compliance decisions belong to the separate ongoing audit.

RevenueCat server entitlement enforcement remains a known gap; no webhook or new
product gating was improvised. Native entitlements/AASA, mixed .app/.com share
URLs, old Dev pushes and purchase identity transitions remain operational risks.
Optional post-launch improvements include storage-reference indexing, removing
unused legacy schema fields after an approved migration, and broader observability;
these must not be confused with the pre-release privacy/auth blockers above.

## Verification scope

Actual-handler tests use synthetic DB/auth adapters, not hosted transactions.
Local orchestration tests simulate delayed/failing requests. Separate runtime
and multi-user iPhone/Android QA is required: first login/re-login, upgrade from
old Dev build, cold start, account switch, offline logout/retry, push after logout,
account deletion failure/success, other-account cache retention, active/cancelled/
deleted/restored sharing, previous independent copies, Google import, sandbox
purchase/restore, calendar initial position/selection and Hebrew RTL. Full commands
and final counts follow below.

### Final local verification

```sh
bun --no-env-file test tests/convex/productionConfig.test.ts tests/convex/productionPrivacyP0.test.ts tests/convex/pushTokenLifecycle.test.ts tests/convex/pushLogoutDevice.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/birthdayStorageIsolation.test.ts lib/services/__tests__/accountDeletionUi.test.ts
bun --no-env-file test
bun run type-check --incremental false
bun --no-env-file x --no-install tsc --noEmit --incremental false -p convex/tsconfig.json
git diff --check
```

- Focused: **85 passed, 0 failed**, 7 files.
- Full suite: **2,731 passed, 5 failed**, 2,736 tests in 107 files.
- Baseline `867e6f1`, isolated `git archive HEAD` copy using the same installed
  dependencies: **2,701 passed, the same 5 failed**, 2,706 tests in 102 files.
  No branch switch or dependency installation was performed.
- Both TypeScript checks and `git diff --check`: passed.
- Focused Biome: 29 changed/new TS/TSX/JSON files, **3 errors, 5 warnings**.
  Calendar has existing import ordering, formatting and unnecessary dependency
  errors, plus three warnings; events.ts and linkedEvents.ts each have one
  existing warning. Baseline comparisons confirmed these diagnostics. The
  Calendar patch removes only the unsupported prop; unrelated formatting was
  deliberately preserved.

Reproduce the exact focused Biome file selection without modifying files:

```python
import subprocess
files = subprocess.check_output(['git', 'diff', '--name-only'], text=True).splitlines()
files += subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True).splitlines()
files = [f for f in files if f.endswith(('.ts', '.tsx', '.json'))]
subprocess.run(['bun', 'x', '--no-install', 'biome', 'check', '--reporter=json', *files])
```

The five baseline failures are:
1. `tests/convex/ownerScopeInsertSiteCoverage.test.ts`: device-calendar ownerScope
   source assertion.
2. `tests/convex/taskSpaceAuthorization.test.ts`: explicit family/cross-space
   share fixture conflicts with the current allFamily event guard.
3. `tests/convex/calendarImportOnboarding.test.ts`: old skip-copy source assertion.
4. `lib/services/__tests__/googleOAuthClient.test.ts`: native Android failure
   source assertion.
5. Same file: Kotlin cancellation source assertion.

These failures remain unresolved; baseline reproduction is not a waiver for
release. No hosted, physical-device, SMS, push delivery or purchase test was run.
