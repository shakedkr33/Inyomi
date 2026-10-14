# Development session security — deployment preflight and device QA

Date: 2026-10-13. Branch: develop. HEAD/checkpoint: 867e6f1.

## Actual outcome: deployment blocked before execution

**No deployment command was run.** The authorized one-shot deployment count is
zero, not one. No retry, login/configuration wizard, environment creation, key
rotation, migration, manual record change, SMS/push, build, commit or push occurred.
Production was not queried or modified in this task.

Read-only metadata commands against sincere-panther-608 failed with
`401 Unauthorized: MissingAccessToken: An access token is required for this command`.
The CLI suggested authenticating with convex dev; that suggestion was NOT executed
because authentication/setup is not the verified one-shot deployment workflow.
The additional schema comparison stopped at its failed metadata read.

Commands attempted (metadata only, no --push):
```sh
node node_modules/convex/bin/main.js function-spec --env-file .env.local --deployment-name sincere-panther-608
node node_modules/convex/bin/main.js run _system/frontend/getSchemas '{}' --env-file .env.local --deployment-name sincere-panther-608 --codegen disable
```

Restore authorized CLI authentication through the normal operator login process
without sharing credentials in chat. Then repeat the target/schema preflight and
checks against the unchanged or newly approved revision. Only after it passes,
execute the previously authorized command exactly once:
```sh
npx convex dev --once --typecheck enable --codegen disable --tail-logs disable --env-file .env.local
```
Do not substitute convex deploy, add --prod, provision an environment or retry
an unsuccessful deployment automatically. Authentication restoration is not proof
of a correct target; recheck it immediately before execution.

## Target and local diff review

Parsed .env.local using the installed dotenv parser:
- CONVEX_DEPLOYMENT = dev:sincere-panther-608
- EXPO_PUBLIC_CONVEX_URL = https://sincere-panther-608.convex.cloud
- No CONVEX_DEPLOY_KEY or self-hosted override in that file.
- Shell contained no CONVEX* or EXPO_PUBLIC_CONVEX* overrides.
- .env also points to Development. No actual env file was edited.

62 pending files (50 tracked modifications, 12 untracked) match the two preceding
reviewed tasks. Full inventory is below. No generated files, lockfile/dependency
changes or destructive schema removals appear in the pending diff. Real .env files
are not pending changes; .env.example is documentation. No credential material was
identified in the reviewed additions. Existing changes were preserved.

The only schema delta against 867e6f1 is optional spaces.primarySources:string[].
The session helper reads users/authSessions by ID; it adds no table or index and
requires no migration. The prior audit reported these Auth tables in Development.
**Current deployed schema compatibility could not be freshly verified**, because
metadata access failed. Do not turn this code-level assessment into a deployment
approval or disable schema validation. No user records were inspected.

Session validity applies before resource permissions; public share/invite previews,
Auth entry points and internal services retain their distinct boundaries. The
165-endpoint behavioral inventory and regression tests were rerun. See the
[session contract](../authentication-session-validity.md) and
[earlier P0 report](production-readiness-p0.md) for implementation details.

## Verification performed

- Focused 11-file suite: **968 passed, 0 failed**.
- Full suite: **2,914 passed, 5 failed**, 2,919 tests across 108 files; exactly
  matches the preceding task baseline, with no new failure.
- Application TypeScript and Convex TypeScript: passed.
- git diff --check: passed.
- Existing five failures: ownerScope import source assertion; family/cross-space
  event fixture; onboarding skip-text assertion; Android OAuth error-state and
  Kotlin cancellation source assertions. They were not changed to make tests pass.

```sh
bun --no-env-file test tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/accountDeletion.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/productionPrivacyP0.test.ts tests/convex/pushTokenLifecycle.test.ts tests/convex/pushLogoutDevice.test.ts tests/convex/updateUserTypeRemoval.test.ts
bun --no-env-file test
bun run type-check --incremental false
bun --no-env-file x --no-install tsc --noEmit --incremental false -p convex/tsconfig.json
git diff --check
```

Safe unauthenticated HTTP reads of the existing Development deployment:
- /.well-known/openid-configuration: HTTP 200; issuer and jwks_uri point to
  sincere-panther-608.convex.site.
- /.well-known/jwks.json: HTTP 200; one public key. Key material was not reported.

These are **pre-deployment observations**, not post-deployment checks and not an
OTP/refresh validation. Function availability and schema metadata remain unverified.
No authenticated records or existing share previews were fetched.

## Device QA protocol — run only after confirmed Development deployment

Record device model/OS, client version, backend, scenario, expected result, actual
result and pass/fail/not-run. Do not put phone numbers, JWTs, refresh tokens, event
content or private URLs in the report. All scenarios below are currently NOT RUN.

Use synthetic accounts A and B with data safe to retain. Use separate disposable
C accounts for deletion. Ensure every client and replay request targets Development.
The backend deployment alone does not update mobile Push logout/local-cache code:
use a client running the reviewed local changes for those scenarios, and separately
check compatibility with an existing client. No EAS build is authorized here.

### 1. Authentication — repeat on iPhone and Android

1. Sign in A using a controlled test phone and SMS OTP, only during the manual test.
2. Create identifiable synthetic event/task fixtures. Cold-start, reload, background
   and foreground; confirm the same account/data and normal permissions.
3. Exercise normal SDK refresh after access-token expiry; avoid claiming refresh
   succeeded merely because an existing token still works. Record only outcome.
4. Online logout, cold-start, sign in again; switch A → B → A on the same device.
   B must not see A's private resources or retained account UI state.
5. Validate Apple Review authentication separately with its designated synthetic
   account, without copying review secrets to reports.

### 2. Prove server revocation, not only navigation

Use a reviewed test harness/private HTTP client that holds synthetic credentials
in memory, with request/response body logging disabled. If that facility is not
available, mark server-replay QA NOT RUN; do not substitute a screenshot of login.

1. Before logout, retain A's current access token privately and verify a query for
   A's synthetic event succeeds. This establishes an actual positive control.
2. Log out A through the supported application path while online. With the **same**
   still-unexpired token, repeat the event query: expect null/denial, never content.
3. Replay a synthetic protected mutation and upload-URL request: expect denial and
   no created/modified fixture. The null/empty return contracts of read queries
   count as denial; HTTP 200 alone is not authorization success.
4. Attempt SDK refresh with the revoked synthetic session's refresh credential:
   it must not restore protected access. Never write tokens to shell arguments,
   persistent logs, screenshots or chat. Discard harness credentials afterward.
5. Verify independent B on another device still reads/writes its own fixtures.
6. Repeat with A signed in on two devices: logout on device 1 invalidates its
   token; device 2's independent active session continues working.
7. Keep a subscription open in the harness during revocation; confirm protected
   data is withdrawn after the session transaction commits. Check old-client UI
   handles null/error and offers a usable sign-in path.

### 3. Account deletion — disposable C only

1. C with genuinely personal synthetic data: verify access, delete via the app,
   then replay its previous token and refresh. Expect denial/no resurrection.
2. C owning a family with another synthetic real joined user: attempt deletion.
   Expect the existing blocker, no deletion and continued valid C authentication.
3. Confirm A/B sessions and shared data remain intact. Never use valuable A/B
   accounts as deletion fixtures or change ownership to force deletion through.
4. Confirm deleted C's local birthday/cache data is cleared; retained A/B local
   data must not be erased. Backend failure must not trigger success cleanup.

### 4. Authorization regression

- A private event/task is readable by A, denied to B; explicit invitation grants
  only the existing intended access. Removing access restores denial.
- Family access members, pending profiles and unrelated users remain distinct.
- Community active member/admin permissions, left/pending states, event tasks,
  assignment/claim/completion and RSVP retain existing rules.
- Active share preview works anonymously; deleted event preview/new linked save
  are blocked, cancellation semantics remain, independent prior copies survive.
- Event/task attachment-URL requests work for an active authorized session and
  fail after revocation. A previously issued direct URL is a known separate risk;
  do not count URL-query denial as revocation of previously issued URLs.
- Push registers for the active account; revoked/deleted credentials cannot
  register. Validate expected-account and ownership behavior on account switch.

### 5. Network, Push and lifecycle

Repeat with permissions granted and denied:
1. Online logout: token deactivation precedes local logout; relogin re-registers.
2. Offline logout: note the explicit retry warning and whether the authenticated
   UI remains usable. Restore connectivity and retry. If the user is trapped or
   cannot recover, record a separate blocker with device/version/permission state.
3. Interrupt connectivity between Push deregistration and Auth signOut. A local
   logout is not proof of server revocation: use the replay procedure above.
4. Background/foreground, cold start after logout and account switching must not
   restore the prior session or route into prior-account notification content.
5. Any actual SMS/push delivery must be manually initiated for synthetic fixtures;
   none was triggered by this task. Already handed-off OS pushes cannot be recalled.

## Go / No-Go and remaining risks

- Local implementation: reviewed; tests match baseline.
- Development deployment: **not performed — authentication blocker**.
- Device QA: plan ready; validating the new hosted code must wait for deployment.
- Production: untouched; **NO-GO** until hosted/device verification and independent
  privacy/deletion/legal/integration blockers are resolved.

Already-issued Storage download/upload capabilities remain outside per-request
session validation. Auth's client helper may suppress server signOut network
errors, so offline local token clearing is not proof of revocation. Existing
clients may mishandle JWT-valid/session-invalid null/error states. These are
explicit QA/release risks, not results verified on devices.

## Exact pending-file inventory reviewed

- `.env.example`
- `app/(auth)/sign-in.tsx`
- `app/(authenticated)/_layout.tsx`
- `app/(authenticated)/calendar.tsx`
- `app/(authenticated)/profile.tsx`
- `app/(authenticated)/subscription.tsx`
- `config/appConfig.ts`
- `config/legalUrls.ts`
- `convex/appleReviewAuth.ts`
- `convex/auth.ts`
- `convex/birthdays.ts`
- `convex/communities.ts`
- `convex/communityActivities.ts`
- `convex/communityEventCalendar.ts`
- `convex/dailyMoods.ts`
- `convex/eventRsvps.ts`
- `convex/eventTasks.ts`
- `convex/events.ts`
- `convex/googleImport.ts`
- `convex/linkedEvents.ts`
- `convex/members.ts`
- `convex/onboarding.ts`
- `convex/personalEventCalendar.ts`
- `convex/profileCircles.ts`
- `convex/pushTokens.ts`
- `convex/schema.ts`
- `convex/shareLinks.ts`
- `convex/tasks.ts`
- `convex/userCalendarEntries.ts`
- `convex/userNotifications.ts`
- `convex/users.ts`
- `docs/README.md`
- `docs/deployment.md`
- `docs/event-read-authorization.md`
- `eas.json`
- `lib/accountDeletionUi.ts`
- `lib/birthdayStorage.ts`
- `lib/components/birthday/BirthdaySheetsProvider.tsx`
- `lib/notificationsStorage.ts`
- `lib/pushNotifications.ts`
- `lib/services/__tests__/accountDeletionUi.test.ts`
- `tests/convex/birthdayStorageIsolation.test.ts`
- `tests/convex/finalWriteAuthorization.test.ts`
- `tests/convex/googleImportDates.test.ts`
- `tests/convex/personalEventPackage1.test.ts`
- `tests/convex/personalEventTaskSecurity.test.ts`
- `tests/convex/postDeleteAccountOnboardingRace.test.ts`
- `tests/convex/privacyAuthorization.test.ts`
- `tests/convex/taskSpaceAuthorization.test.ts`
- `tests/convex/updateUserTypeRemoval.test.ts`
- `convex/sessionAuth.ts`
- `docs/audits/production-readiness-p0.md`
- `docs/authentication-session-validity.md`
- `lib/openLegalUrl.ts`
- `lib/pushTokenLifecycle.ts`
- `tests/convex/authRevocationAudit.test.ts`
- `tests/convex/helpers/privacyFixture.ts`
- `tests/convex/productionConfig.test.ts`
- `tests/convex/productionPrivacyP0.test.ts`
- `tests/convex/pushLogoutDevice.test.ts`
- `tests/convex/pushTokenLifecycle.test.ts`
- `tests/convex/sessionEntryPoints.test.ts`

This report is the only repository file added by this deployment-preparation task.
