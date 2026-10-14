# InYomi — controlled Production deployment

This is an operator runbook, not authorization to execute it. Local P0 changes
are prepared; no deployment/build/cloud configuration/data migration was performed.
External TestFlight distribution remains blocked by the privacy/authentication
items in [the focused readiness report](audits/production-readiness-p0.md).
The later [session-validity correction](authentication-session-validity.md) is
also local only: validate it in Development before Production. It protects app
functions but does not revoke already-issued Storage URLs or guarantee that an
offline client logout reached the server.

## Existing environments and build selection

Team `shaked0129`, project `InYomi` (the old `infera` comment in local env files
is stale). Use the existing deployments; do not create another environment.

| EAS profile | Convex deployment | Distribution |
| --- | --- | --- |
| development | sincere-panther-608 | internal, development client |
| preview | sincere-panther-608 | internal, release build |
| production | peaceful-cricket-429 | store: TestFlight and eventual App Store |

`eas.json` pins `EXPO_PUBLIC_CONVEX_URL` directly for each profile. Production
uses `https://peaceful-cricket-429.convex.cloud`; other profiles are unchanged.
The installed EAS CLI resolves `{ ...serverEnvVars, ...buildProfile.env }`, so
profile values win over duplicate EAS variables. Expo embeds public variables
in the JS bundle. The existing process value wins over dotenv loading. Local
`.env` / `.env.local` remain Development-only and are excluded by `.gitignore`;
there is no custom app.config script or build hook overriding this URL.
`utils/convexConfig.ts` reads that single public variable and fails if absent.
Do not use `__DEV__` to select the backend: preview is also a release build.

This guarantees the intended URL for the checked-in standard EAS production
profile, not arbitrary manually overridden Metro commands or existing binaries.
Verify the resolved public URL again with the actual EAS CLI/version used for
the build. Never add JWT, Twilio or admin secrets to EXPO_PUBLIC variables.
Native bundle IDs, EAS project ID, pricing and entitlement IDs stay unchanged.

## Schema compatibility

Read-only audit on 2026-10-13: Production had 28 schema tables versus 33 locally.
The new tables are notificationLog, pushTokens, scheduledReminders,
userCalendarEntries and userNotifications. Existing-table additions are optional;
provider in googleImportStatus widens from literal google to string. Index
additions still require Convex validation/backfill at deployment time.

Production allows `spaces.primarySources?: string[]`. It is retained locally
as optional solely for validation compatibility; no business logic reads/writes
it. This preserves old records and accepts Development records without it.
No table/field data is removed and no migration is required by this local patch.
Actual Production records were not inspected, so final schema validation remains
mandatory. Do not disable schemaValidation or run existing backfill functions
just to make a deployment succeed.

Future removal is separate work: establish no active writers (including old
clients), approve a retention/removal decision, obtain an authorized aggregate
compatibility assessment, stage any required field removal in bounded batches,
and remove the optional validator only after the absence of remaining values
is verified. No such assessment/migration is authorized by this task.

## Configuration checklist (operator actions still required)

| Service | Requirement | Where | Safe validation |
| --- | --- | --- | --- |
| Convex Auth | Production JWT_PRIVATE_KEY + matching JWKS missing in audit; never reuse Dev signing keys | Existing Production deployment environment settings | Public JWKS endpoint returns 200 and expected public keys; controlled OTP login after deployment |
| Auth redirects | Review Production SITE_URL, absent in audit; relevant for OAuth/magic-link redirects, distinct from native Google Calendar import | Convex Production settings | Confirm intended app redirect; CONVEX_SITE_URL remains deployment-provided |
| Twilio | Four TWILIO_* names exist; Account SID differs across environments while API key/service are shared | Existing Twilio Verify service and Convex Production settings | Verify account/subaccount, API key permissions, CustomCode and destination permissions; later authorized synthetic-account OTP smoke test |
| Apple Review | APP_REVIEW_PHONE / APP_REVIEW_OTP exist and match Dev values | Convex Production and App Store Connect review information | Confirm server-only fresh secret, routing-compatible phone, synthetic non-admin account; no real user content |
| Google Calendar iOS | EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID missing in EAS production/preview | EAS variables; existing Google OAuth client/consent screen | Correct bundle ID and native reverse-client scheme; enable Calendar API and include three testers if consent is Testing |
| Google Calendar Android | EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID absent from EAS audit | EAS / Google client | Native AuthorizationClient path, package and correct release signing certificate; device test |
| Push | Production code/tables missing in audit; APNs/Expo service credentials not audited | EAS credentials / Apple developer setup | Check final signed IPA entitlement, physical iPhone registration, foreground/background/terminated delivery; sender has no Expo access-token header, so check whether push security is enabled |
| RevenueCat | Platform SDK key names exist in EAS; offerings/products/store setup unverified | EAS, RevenueCat and App Store Connect | Correct iOS SDK key, entitlements/products, TestFlight sandbox purchase/restore with Production Convex identity; no Test Store key in release |
| Google Places | Public restricted key exists in each EAS environment | EAS / Google Cloud | API enablement, billing and compatible application/API restrictions; location search on device |
| Universal Links | app.json uses inyomi.app; native entitlement lacks associated domains; some shared URLs use inyomi.com | Native project and existing domain hosting | Approve canonical link mapping, valid AASA/assetlinks, cold/warm opens; no domain/bundle changes made here |
| Legal | Canonical /privacy, /terms, /delete-account on inyomi.com are reachable; text approval is outstanding | Existing website / App Store Connect | Owner approval of published policy and terms, correct disclosures, working deletion support process; HTTP 200 is insufficient |

Keep QA_RESET_ENABLED, QA_RESET_ALLOWED_PHONES and QA_FULL_ACCESS_PHONES absent
from Production. Payments are enabled and MOCK_PAYMENTS is false. RevenueCat
server-side entitlement synchronization/enforcement is still absent; it is not
fixed by these environment settings. Do not introduce new paid-access rules in
this deployment task.

## Minimal manual sequence — blocked until release gates are resolved

1. Resolve the authentication-revocation, deletion/storage and policy-content
   blockers in the linked report. Approve the exact source revision and run
   relevant tests/type checks. Verify existing backup/recovery coverage without
   exporting user records in this task. Decide how existing Dev users transition.
2. Configure Auth keys securely on peaceful-cricket-429 only, review SITE_URL,
   Twilio and Apple Review settings. Do not run the auth setup wizard against
   a default/ambiguous target or print private keys into logs.
3. Before backend deployment, verify selected team/project and existing prod
   deployment read-only. Check whether CONVEX_DEPLOY_KEY is set: it can override
   normal target selection. Stop if the target is anything other than
   peaceful-cricket-429 or a command proposes creating a deployment.
4. After explicit operational authorization, use the installed Convex CLI's
   production deploy command (`bun x --no-install convex deploy`) with the
   verified project/credential context. Keep schema enforcement and type checks
   enabled. This command performs writes/code generation; even dry-run was NOT
   used in this task. Do not add an unsupported --deployment-name flag to deploy.
   Review and stop on any schema error. No migration or Dev data import is part
   of this sequence. A rollback must remain compatible with newly written data;
   switching the app back to Development is not a data-safe rollback plan.
5. Smoke-test with specifically designated synthetic Production accounts: JWKS,
   login/re-login, onboarding, cross-user authorization, event/task workflows,
   deletion and restored/deleted sharing, Google import, push logout/re-login,
   purchase/restore. Do not test destructive operations on existing user records.
6. Configure missing EAS public OAuth variables, review native signing/links,
   resolve build.production and confirm the Production URL. Only then create an
   iOS production build and verify its backend/version on a physical device.
7. Submit that tested build to TestFlight review with approved privacy metadata,
   export compliance and working review access. Invite the three external testers
   only after approval. Reuse the same Production deployment and user identities
   for the eventual launch; do not reset their data or recreate their accounts.

Old TestFlight binaries continue using Dev. The most recent audited EAS iOS
store build was 1.0.0 (27), reported commit f9c0c8d; actual installation/submission
was not verified. Updating the URL creates a new auth namespace and separate
Convex user IDs; old records, sharing links, device registrations, notifications
and RevenueCat identity do not migrate automatically. Keep existing Dev data
intact, coordinate the switch and do not promise continuity for Dev accounts
without a separate approved plan. New testers starting on Production can retain
those Production accounts through launch, subject to that environment being kept.

Sources: [Convex deployment](https://docs.convex.dev/production/overview),
[Auth setup](https://labs.convex.dev/auth/setup/manual),
[EAS variables](https://docs.expo.dev/eas/environment-variables/usage/),
[Expo native projects](https://docs.expo.dev/workflow/continuous-native-generation/),
[external TestFlight](https://developer.apple.com/testflight/).
