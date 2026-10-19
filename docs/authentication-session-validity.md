# Live authentication validity — P0 correction

Status (2026-10-13): local implementation; not deployed. Hosted JWT validation,
transaction concurrency and physical-device QA remain pending. This closes the
application-function session bypass locally; it does **not** revoke previously
issued Storage URLs. External TestFlight remains blocked.

## Confirmed mechanism and supported correction

Installed `@convex-dev/auth` is 0.0.90. Its token generator signs RS256 JWTs with
`sub = userId|sessionId`, issuer `CONVEX_SITE_URL`, audience `convex`, default
one-hour access-token expiry. The configured total session lifetime is 30 days.
Convex handles cryptographic verification; the app must not reimplement it.
Both exported helpers getAuthUserId/getAuthSessionId only extract those IDs.
The library's isAuthenticated query likewise only checks identity presence.

Official guidance explicitly requires loading the session for immediate validity:
[session validity](https://labs.convex.dev/auth/advanced#session-validity),
[supported identity/session helpers](https://labs.convex.dev/auth/authz),
[Convex authentication in functions](https://docs.convex.dev/auth/functions-auth).
The installed source, rather than newer online APIs, determines implementation.

`convex/sessionAuth.ts` uses those supported helpers, then requires a persisted
session, matching session.userId, finite future expirationTime and an existing
user whose isActive is not false. It returns null for invalid authentication;
existing endpoint null/empty/error contracts remain. IDs come from the verified
identity, never client arguments. Legacy users with no explicit isActive=false
are not newly disabled. No cryptography, dependency patch, schema or migration.

Each protected query/mutation performs these reads in its own transaction;
there is no global cache or earlier client-only check. Session/user deletion
invalidates subscribed queries' database dependencies. Concurrent mutations use
Convex transaction validation, not a separate preflight query. Merely checking
user existence would not stop logout of one session for a still-existing user.
All ownership/membership/role/share checks remain after authentication.

## Entry-point inventory

- All 165 exported protected public queries/mutations (including aliases) route
  through this helper, directly or via existing authorization helpers. Includes
  events, tasks/eventTasks, RSVP, families, communities/admin, Google import,
  birthdays, moods, onboarding/profile, notifications and push registration.
- auth.isAuthenticated now reflects live validity. Auth signIn/signOut and
  internal store remain library-managed. At the original audit no protected
  application actions existed. The local
  [Google Places proxy](google-places.md) now adds two public actions; both call
  an internal mutation that validates the live session and atomically reserves
  usage before any external request. HTTP routes
  are exclusively the library's auth routes. No new HTTP middleware was added.
- Exactly two app public previews remain intentional exceptions:
  shareLinks.getSharePreview and communities.getCommunityByInviteCode. Revoked
  users can see the same public information as any anonymous visitor, not private
  account resources. Existing deletion/cancellation/revocation rules remain.
- Internal jobs, notification services, migrations/admin tools and Auth callbacks
  retain their existing trust boundary. No blanket session wrapper is applied.
  Existing QA allowlists/gates are unchanged. Future user-facing actions/HTTP
  handlers must validate through a server query and recheck at their protected
  mutation boundary; this DB-context helper deliberately does not accept ActionCtx.
- Attachment URL lookups and upload URL generation now require live sessions.
  Existing download URLs and already-issued upload capabilities bypass these
  functions after issuance. See the unresolved file-access boundary below.
- No backend RevenueCat webhook/entitlement enforcement exists to protect here;
  the legacy users.createOrUpdateUser endpoint can no longer reset subscription
  state, resurrect a user, or select a different user through email.

## Narrow exceptional paths

Most backend files only change the getAuthUserId import. No generated files were
edited. The supported helper is centralized, but Convex has no automatic global
application-auth middleware: every existing import must point to that helper.
The behavioral entry-point inventory test catches new public query/mutation
bypasses and deliberately excludes only the two named public previews.

users.createOrUpdateUser has no application callers; preserve its no-argument
ID response as a compatibility no-op for a live user. Actual creation continues
in the trusted Convex Auth callback. It no longer writes names, roles, email or
subscription state based on stale token claims. dailyMoods uses the canonical
validated user ID instead of the unrelated email lookup. removeEntityMember
checks authentication before loading the target, then retains its owner guard.
Apple Review cannot reactivate an explicitly disabled existing review user.
Push registration reuses the central check, preserving expectedUserId and token
ownership protections from the previous task. No client Push lifecycle change.

## Logout, deletion, refresh and offline limitations

Library signOutImpl deletes only the current session and its refresh tokens.
Other sessions of the same user remain valid. The existing account-deletion
mutation deletes all that user's sessions/refresh tokens and the user row in
one transaction. Blockers occur before writes; an error aborts the transaction.
No deletion ownership, storage or retention rules changed.

The installed refresh implementation checks its refresh record, session linkage
and expiration, but does not check the user row. Successful application deletion
removes both session and refresh records. If a user alone is missing with residual
Auth rows, the library may still mint a JWT; the new application guard denies it.
No refresh framework override was introduced. Fresh OTP authentication after a
completed deletion may legitimately create a new account; an old JWT cannot.

Existing explicit logout first waits for Push deregistration. Failure blocks
logout and presents retry feedback. A later failure of the Auth RPC is a separate
limitation: the library React signOut helper suppresses RPC errors and clears
local tokens. Therefore local logout success is **not proof of server revocation**.
This patch enforces successful server-side revocation; it does not claim to solve
unacknowledged offline logout. Do not replace the approved Push flow casually.
A follow-up can require an explicit acknowledged supported signOut call before
local token clearing, with retry handling, without patching the dependency.

After restart or an externally revoked session, old clients may still consider
the JWT authenticated until refresh, while protected queries return null/empty
or reject writes. The existing routing must be device-tested for an accessible
sign-in/retry path; no client auto-signout redesign is included here.

## Logout subscription correction (2026-10-14)

The user reports the session hardening is deployed to Development and reproduced
the logout failure on physical Android through Metro. No cloud access or deployment
was performed in this correction. The changes below are **local and undeployed**.
Earlier status/test counts in this document describe the earlier security task.

Confirmed code path: Profile waits for Push unregister/delivered-notification
cleanup, clears the onboarding draft and in-memory profile, then calls supported
Auth `signOut`. The installed SDK awaits the server call before clearing local
tokens. Deleting the session now invalidates the database dependencies of
`userNotifications.list`, while `useConvexAuth` can still report authenticated.
Before hardening, that endpoint only extracted the JWT user ID; after hardening
it correctly denies the revoked session, but its previous throw-on-no-session
contract was incompatible with its root-mounted subscription. `useQuery` throws
query errors during render, and NotificationsProvider wraps the routing Slot.
This removes the routing subtree before it can complete the unauthenticated
transition. That mechanism is reproduced with a component error boundary; it
explains the reported beige surface, but actual device paint was not observed here.
The OTP logger preserves this query error unchanged; it is not the cause.

The approved inbox contract is now: **no live session means an empty inbox**.
`list` still validates session/user first, returns `[]` before reading notification
rows when invalid, and reads only the validated recipient's non-archived rows when
valid. Read/archive mutations still reject invalid sessions. Unexpected DB/query
errors still propagate; there is no blanket error catch or logger suppression.
This contract also handles a previously subscribed request during deletion or
revocation, before the client can unsubscribe. Client `skip` alone cannot do that.

NotificationsProvider gates on both SDK authentication and the existing live
`users.getMyId` query. It hides cached rows whose recipient differs from that ID
and disables inbox writes while ineligible. The authenticated layout separately
routes resolved signed-out state requiring only a mounted root navigator; it does
not wait for RevenueCat/profile/draft readiness. Follow-up product clarification
(2026-10-14) changes **explicit Profile logout** to `/(auth)/sign-in` via a consumed
in-memory intent. Other signed-out transitions, including account deletion, retain
the `/(auth)` Welcome fallback. See `startup.md` for the current routing contract.
Protected notification-target consumption requires authentication. Authenticated
onboarding gates, route definitions, root bridge, splash animations and readiness
signals are unchanged. Profile additionally repeats its in-memory reset after
`signOut` resolves: while that request waits for the server, the layout can
rehydrate the still-valid old profile after the first reset (reproduced in a
failing regression test before this correction). The final reset prevents that
profile from remaining for the next account. Push-before-signOut ordering and
deletion cleanup are unchanged; the deletion destination comment is corrected.

Scope of cleanup: ordinary logout clears the onboarding draft/in-memory profile
and delivered Push notifications through the existing flow. Notification UI is
emptied by the provider. Existing birthdays remain in account-scoped storage;
their provider clears loaded state on identity change. RevenueCat's existing
generation guard resets local entitlement/customer state when its Convex identity
changes; it does not call `Purchases.logOut`. These existing implementations were
inspected, not replaced or newly verified on devices. No server profile/family
data is deleted by ordinary logout.

Remaining limitations: failed Push unregister still blocks logout with retry
feedback. `getPushRecipients` selects active tokens without checking auth sessions,
so silently clearing credentials is not a safe substitute for unregistering.
Externally revoked/expired sessions can still leave the SDK authenticated and the
existing authenticated layout on its loading splash until auth refresh resolves;
the inbox is safe/empty, but an accessible recovery flow remains pending. The
SDK's suppression of signOut RPC failure still means local logout is not proof of
server revocation. This patch does not solve those separate recovery/security
decisions, or the previously documented late-OTP-authentication risk.

Validation uses real Profile/provider/layout/Welcome components with mocked
network/native/router boundaries and real backend handlers plus installed server
signOut against synthetic records. It covers pending subscriptions, delayed SDK
cleanup, cached results across accounts, Push failure/retry, signed-out navigation,
cold start and suspended/background render delivery. OS lifecycle, native router
transitions, physical rendering, hosted reactive timing and real RevenueCat identity
switching are **not** proven by these mocks. Existing root startup tests separately
cover bridge/native-splash readiness with mocked native APIs.

The original logout correction required backend deployment; the subsequent iOS
startup task reports that deployment to Development and successful Android logout.
That deployment was user-reported, not remotely inspected during the startup task.
The new startup/explicit-logout changes are client-only and need Metro reload for
the existing development build. No dependency/native/config change requires a native
rebuild for this fix. A distributed release must include the updated JS through
its approved release process. No deployment, build, SMS, Push, migration, commit
or push occurred here.

Device QA pending on both iPhone and Android: logout with/without notifications;
offline logout failure and online retry; background/foreground mid-logout; restart
after logout; A logout then B login (profile/family, inbox, birthdays and entitlement
isolation); account deletion; live session expiration/revocation and recovery;
pending notification/shared links; Welcome layout/focus with no blank frame or
LogBox. TestFlight remains **No-Go pending device QA and unresolved blockers**.

Final local verification for this correction:

- New logout/inbox tests: **26 passed, 0 failed** (2 files).
- Focused regression suite below: **654 passed, 0 failed** (15 files).
- Full suite: **2,992 passed, 5 failed** (114 files), versus the supplied prior
  baseline of 2,966 passed / 5 failed. The same five baseline failures remain:
  ownerScope device-calendar import source assertion; family/cross-space share
  fixture; calendar-import onboarding skip text; two Android Google OAuth source
  guards. No additional final failure. They were not modified by this task.
- Application and Convex TypeScript, focused Biome (6 TS/TSX files) and
  `git diff --check`: passed. No device, native build or hosted validation.

Exact final commands (logs redirected to temporary files outside the repository):

```sh
bun --no-env-file test lib/services/__tests__/logoutLifecycle.test.ts tests/convex/notificationSessionLifecycle.test.ts
bun --no-env-file test lib/services/__tests__/logoutLifecycle.test.ts lib/services/__tests__/startupSplashLifecycle.test.ts lib/services/__tests__/accountDeletionUi.test.ts lib/services/__tests__/otpDevelopmentLogger.test.ts tests/convex/notificationSessionLifecycle.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/pushTokenLifecycle.test.ts tests/convex/pushLogoutDevice.test.ts tests/convex/postDeleteAccountOnboardingRace.test.ts tests/convex/mandatorySetupExitRedirect.test.ts tests/convex/birthdayStorageIsolation.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/productionPrivacyP0.test.ts
bun --no-env-file test
bun run type-check --incremental false
bun --no-env-file x --no-install tsc --noEmit --incremental false -p convex/tsconfig.json
bun --no-env-file x --no-install biome check contexts/NotificationsContext.tsx convex/userNotifications.ts 'app/(authenticated)/_layout.tsx' 'app/(authenticated)/profile.tsx' lib/services/__tests__/logoutLifecycle.test.ts tests/convex/notificationSessionLifecycle.test.ts
git diff --check
```

Task changes: `convex/userNotifications.ts`, `contexts/NotificationsContext.tsx`,
`app/(authenticated)/_layout.tsx`, `app/(authenticated)/profile.tsx`, the two new
logout/inbox test files above, and this document. Relevant pre-existing changes
were compared with HEAD `867e6f1` and preserved; final task diff was also compared
with copies of the working files captured before editing. No unrelated formatting
or generated files were added.

## Unresolved file-access boundary — release blocker

Convex storage.getUrl returns a capability URL. Once issued, fetching it does not
call the original query or its session check. The task attachment comment calling
it a "signed URL" must not be read as a session-revocation guarantee. Likewise an
already-issued upload URL can outlive the session for its platform validity window.
This task did not fetch existing URLs, inspect file/user records or delete files.
[Official file-serving options](https://docs.convex.dev/file-storage/serve-files).

Strict post-revocation file access needs an approved authenticated HTTP serving
path that verifies live auth and resource permission on each request, plus mobile
download/image compatibility and an explicit policy for previously issued direct
URLs. Switching future requests alone cannot revoke historical URLs. Invalidating
those may require approved storage object replacement and reference updates;
never delete/rekey shared objects as an ad-hoc security fix. That is outside this
focused change's authorization and migration restrictions. Stop that portion
here: do not label all attachment access revoked or Production ready.

## Compatibility and controlled rollout

Backend deployment is required, to each intended environment separately. No
client rebuild is required to enforce the query/mutation boundary on old clients;
no JWT format, session duration, provider, schema, bundle ID or function argument
changes are introduced. Valid stored sessions remain valid. Expired/missing,
mismatched, explicitly disabled or deleted identities are intentionally denied.
Twilio OTP and Apple Review credentials still use the existing providers.

After independent authorization: deploy/test in Development first with synthetic
accounts and an existing app version; verify null/error handling, reactive data
withdrawal, logout/refresh and two devices. Confirm no legitimate active session
is rejected. Then approve the exact revision, configure the existing Production
Auth prerequisites and deploy to peaceful-cricket-429. Never recreate environments
or migrate user data as part of this rollout. Old TestFlight builds using Dev
receive the backend enforcement only when Dev is deployed. Verify Production
with synthetic accounts before any external invitation; resolve remaining privacy,
legal, deletion/storage and integration blockers independently.

## Tests and evidence

The former unsafe-success reproducer is now a rejection test using an ephemeral
synthetic JWT, JOSE verification, actual event handlers and installed signOutImpl.
Coverage includes missing/revoked/expired/mismatched sessions, missing/disabled
users, invalid/expired JWTs at the simulated verifier, two sessions, actual
successful/blocked deleteMyAccount, refresh rejection, no resurrection, private
file URL issuance, family/community access, public previews and internal services.

The adapters do not emulate hosted cryptographic verification, Convex validators,
transaction rollback/concurrency or network delivery. No real keys/users/tokens,
SMS, push requests or cloud configuration were used. Existing authorization test
fixtures now explicitly create synthetic sessions so tests still exercise resource
permissions instead of all failing at authentication. The obsolete subscription
source assertion was replaced with a behavioral no-overwrite/no-resurrection test.

Final results:
- Focused security/deletion/resource/Push suite: **968 passed, 0 failed** in 11 files.
- Full suite: **2,914 passed, 5 failed**, 2,919 tests in 108 files. The five failures
  match the previous task baseline (ownerScope import assertion, family/cross-space
  event fixture, onboarding skip text, two Android OAuth source guards). No new
  failure remains; the old unsafe-success reproducer now asserts denial.
- Full application and Convex TypeScript: passed.
- Focused Biome, 32 task TS files: **6 errors, 7 warnings**, all reproduced in
  original HEAD versions with the same Biome config. Five files retain formatting
  errors; privacyAuthorization also retains import-order errors. Existing warnings
  are in eventRsvps, events, linkedEvents and members. No unrelated formatting sweep.
- `git diff --check`: passed. No device/hosted tests performed.

```sh
bun --no-env-file test tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/accountDeletion.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/productionPrivacyP0.test.ts tests/convex/pushTokenLifecycle.test.ts tests/convex/pushLogoutDevice.test.ts tests/convex/updateUserTypeRemoval.test.ts
bun --no-env-file test
bun run type-check --incremental false
bun --no-env-file x --no-install tsc --noEmit --incremental false -p convex/tsconfig.json
git diff --check
```

Reproduce the focused lint command with the exact file set below:
`bun x --no-install biome check --reporter=json` followed by the backend and test
paths in the inventory (32 files; documentation is not part of that lint command).

## Exact files changed in this task

Backend:

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
- `convex/sessionAuth.ts`
- `convex/shareLinks.ts`
- `convex/tasks.ts`
- `convex/userCalendarEntries.ts`
- `convex/userNotifications.ts`
- `convex/users.ts`

Tests (existing fixtures now include real synthetic session records):

- `tests/convex/authRevocationAudit.test.ts`
- `tests/convex/sessionEntryPoints.test.ts`
- `tests/convex/updateUserTypeRemoval.test.ts`
- `tests/convex/taskSpaceAuthorization.test.ts`
- `tests/convex/personalEventTaskSecurity.test.ts`
- `tests/convex/personalEventPackage1.test.ts`
- `tests/convex/privacyAuthorization.test.ts`
- `tests/convex/finalWriteAuthorization.test.ts`
- `tests/convex/googleImportDates.test.ts`

Documentation:
- `docs/authentication-session-validity.md` (this contract, evidence and rollout).
- `docs/event-read-authorization.md` (live-auth prerequisite).
- `docs/deployment.md` (rollout limitation).
- `docs/audits/production-readiness-p0.md` (superseding local correction notice).

All earlier uncommitted Production Readiness changes remain present. Existing
changes to event sharing, schema, EAS, legal URLs, mobile Push lifecycle and local
account-deletion cleanup are from the previous task, not new work in this task.
No generated files, dependencies, schema, mobile client or cloud configuration
were changed by this session-validity correction. No commit or push.
