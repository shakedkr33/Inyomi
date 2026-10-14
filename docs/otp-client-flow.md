# Phone OTP client coordination

Implemented 2026-10-14 for the approved pre-TestFlight client reliability task.
Device verification remains pending. This does not resolve or establish the cause
of the October 14 delayed/out-of-order SMS incident; see
[audit evidence](audits/otp-resend-investigation.md).

## Client contract

- Phone entry normalizes through the existing `parseIsraeliPhone`. Initial send
  and resend both call `signIn('phone', { phone })`. Successful send normally
  returns `signingIn: false`; that is not a verification failure.
- A shared synchronous in-memory gate coordinates initial send, resend and
  verification across both screens. React disabled states are presentation only.
  A screen leaving does not cancel the SDK call: the transport gate remains held
  until its promise settles, then releases in `finally`. There is no timeout that
  would unlock a still-active operation, and no automatic retry or SMS request.
- Each focused screen/phone attempt has a distinct callback scope. Blur, phone
  changes and unmount invalidate it. Old results cannot clear current input,
  show a resend alert, set current errors, or execute the screen's navigation.
  A successful old send still establishes that phone's cooldown.
- Input stays editable for native keyboard/autofill continuity. Six digits trigger
  verification through the same gate. Input entered during a send is not queued.
  Successful resend clears digits; failure retains them for explicit correction
  or submission, without claiming they are still valid on the server.
- Only a verification result with `signingIn: true` triggers the screen's explicit
  navigation. The existing Apple Review initial bypass/provider routing remains.
- The existing 60-second client cooldown uses a per-phone absolute deadline from
  successful send completion. Remounting does not restart an existing deadline;
  background/foreground updates recompute elapsed time. Failed sends do not add
  a cooldown. A cold-start verify screen without in-memory history conservatively
  waits 60 seconds, as before. No OTP, deadline or phone is written to storage.
  This is UX throttling, not a security boundary; server restrictions still apply.
- Following the approved device-QA copy correction, successful resend shows
  “שלחנו קוד אימות נוסף” only after the send promise succeeds. It does not claim
  a different/new OTP value. Invalid-code, connectivity, rate-limit and unknown
  failures use separate inclusive Hebrew copy without raw backend errors.

## Important unresolved SDK boundary

Follow-up investigation and real-SDK diagnostic tests: [Late OTP completion](audits/otp-late-authentication.md). No safe runtime correction was established; this remains a release blocker.

The installed Convex Auth React `signIn` writes tokens before its promise resolves
(`node_modules/@convex-dev/auth/src/react/client.tsx`). The auth layout independently
redirects authenticated users. Therefore invalidating a screen callback **does not
cancel authentication or prevent that layout redirect** if verification succeeds
while leaving the screen. The shared gate prevents a second OTP operation while
that first call is pending, but cannot undo its token side effects.

Tests mock the SDK/network boundary and prove suppression of screen callbacks,
not cancellation of SDK token installation. The approved stale-response requirement
is consequently only partially fulfilled for an already-submitted verification.
Do not claim full stale-identity/navigation protection or release readiness.
Resolving this needs separately reviewed handling of non-cancellable authentication
(or a supported cancellation contract); do not add an automatic sign-out that could
race with another session. Provider algorithms and auth/session behavior were left
unchanged in this focused patch.

## Validation and device checklist

`lib/services/__tests__/otpClientFlow.test.ts` renders the real screens and hook
with controlled promises, a shared coordinator and mocked native/auth boundaries.
It covers duplicate taps, send/verify exclusion, autofill, failed resend, wrong
then valid code, unsigned results, phone changes, stale callbacks, initial send,
Apple Review routing, background cooldown and server rejection. iOS/Android
branches are exercised in mocks; this is not device testing.

Before approval on Android and iPhone, use designated QA accounts to check:

1. New and existing account login; six-digit autofill and manual entry; keyboard,
   RTL, screen-reader button labels and correct onboarding destination.
2. Rapid resend taps; autofill during pending resend; wrong code then valid code;
   send failure/network restoration and explicit retry; provider rate rejection.
3. Back/gesture/system-back and phone change during send and verify. In particular
   inspect the unresolved SDK completion case above, not just the screen callback.
4. Background beyond 60 seconds and cold start: no unsolicited SMS, no stuck
   buttons, no queued verification. Review-account login still uses its provider.
5. Delayed/reordered SMS: arrival order must not be used to identify valid code.
   Correlate provider and Convex request evidence before attributing the incident.

No Convex deployment or native dependency change is needed for this patch. Metro
reload suffices in a compatible development client. Existing TestFlight binaries
need the updated JS delivered through an approved compatible update or a later
build; Metro does not change installed release binaries. No build, deployment,
real SMS, provider setting, commit or push was performed for this patch.

## Automated results — 2026-10-14

- Focused run below: **288 passed, 0 failed**, including 14 new client scenarios,
  existing OTP lifecycle, session revocation/entry points, Apple Review and onboarding.
- Full `bun --no-env-file test`: **2,939 passed, 5 failed**. Compared with the
  verified 2,925/5 baseline: 14 additional passes, no additional failures.
  The same failures remain in ownerScopeInsertSiteCoverage, taskSpaceAuthorization,
  calendarImportOnboarding and the two googleOAuthClient source assertions.
- Application and Convex TypeScript passed. Focused Biome and `git diff --check`
  passed. No real SMS or device validation occurred.

Commands:

```sh
bun --no-env-file test lib/services/__tests__/otpClientFlow.test.ts lib/services/__tests__/verifyErrorHandling.test.ts tests/convex/otpResendLifecycle.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/appleReviewAuthSecurity.test.ts tests/convex/onboardingRouting.test.ts tests/convex/onboardingState.test.ts tests/convex/onboardingDraftHydration.test.ts tests/convex/onboardingBottomTabsHidden.test.ts
bun --no-env-file test
bun run type-check --incremental false
bunx --no-install tsc --noEmit -p convex/tsconfig.json --incremental false
bunx --no-install biome check 'app/(auth)/sign-in.tsx' 'app/(auth)/verify.tsx' lib/hooks/useOtpRequestScope.ts lib/services/otpRequestCoordinator.ts lib/services/authErrorUtils.ts lib/services/__tests__/otpClientFlow.test.ts lib/services/__tests__/verifyErrorHandling.test.ts
git diff --check
```


## Device-QA follow-up: resend copy and expected-error logging

Implemented client-only after the October 14 QA report. This change does not
resolve the separate late-authentication identity race documented above.

Confirmed SDK path: Convex `RequestManager.onResponse` calls `logForFunction`
for a failed action BEFORE delivering its failure to the caller. The default
logger calls `console.error`. Thus an application catch does not prevent the
React Native development error display. LogBox data is global to the running app,
not the verification route; navigating Home does not clear a recorded error.
The reported log alone does not prove an unhandled app promise or production crash.

The root ConvexReactClient now uses the supported `logger` constructor option
ONLY when `__DEV__` is true. Production builds retain the default logger.
`otpDevelopmentLogger.ts` demotes only one exact SDK action-error envelope:
`[CONVEX A(auth:signIn)] Uncaught Error: Could not verify code`, optionally with
the known request-ID header and stack frames, while the shared coordinator reports
an active **verify** operation. It emits a sanitized information-level diagnostic
instead of an error-level entry. It does not print OTPs, phone numbers or tokens.

All other errors, security warnings, rate limits, send failures, other functions,
extra arguments and unrecognized message formats retain normal logging. No LogBox
ignore rule, console monkey patch, generic sign-out or SDK modification was added.
A new SDK error format may therefore still show LogBox: preserve diagnostics until
that format is separately reviewed. Previously recorded LogBox entries are not
programmatically dismissed; reload the development app before validating this fix.

Public logger contract:
[ConvexReactClientOptions.logger](https://docs.convex.dev/api/interfaces/react.ConvexReactClientOptions#logger).
The installed SDK's RequestManager is executed in the new logger test with
synthetic responses to prove the log-before-caller ordering and narrow demotion.

Inline error lifecycle: input edits and new requests clear the prior error; a
successful verification explicitly clears it before normal navigation. Input
attempt identity prevents a rejected old set of digits from labelling edited
input. Repeated autofill of identical digits does not invalidate that error guard
and still produces one request. Existing phone/focus callback guards remain.
An edit during a pending request never queues automatic verification; manual
submission remains available after the request settles. No OTP is persisted.

The coordinator now retains the active operation kind instead of a boolean, with
the same boolean busy snapshot and same settlement/cooldown behavior. This permits
logging classification without introducing another lock or authentication flow.
The UI classifier no longer treats every occurrence of “invalid”/“expired” as a
wrong OTP; configuration/session failures remain generic and explicit rate-limit
responses get retry-later copy. Server rate limits are unchanged.

Manual QA pending on both iPhone and Android:
1. Reload the development app. Enter a wrong OTP: friendly inline message, one
   request, keyboard usable, no new red LogBox for the recognized rejection.
2. Correct the OTP: error clears, login/navigation succeeds. Repeat identical
   autofill while pending and edit to another code while a rejection is delayed.
3. Resend: success alone shows the approved message and starts the same 60-second
   cooldown. Failure shows friendly copy and no success alert. Autofill during
   resend does not queue verification.
4. Check network failure, server rejection and throttling remain diagnosable;
   unexpected errors must still appear normally. Verify Apple Review login.

No Convex deployment, provider configuration or native dependency change is needed.
A full Metro reload in the existing compatible development client installs the
root logger; Fast Refresh alone may leave historical LogBox entries. An installed
TestFlight binary needs an approved JS update or later build to receive this patch.
No build/update publication, SMS, migration, commit or push was performed.

### Follow-up validation results

- OTP/error/logger + SDK/session/Apple Review/onboarding: **315 passed, 0 failed**.
- Startup lifecycle: **8 passed, 0 failed**, including release default logging and
  development logger installation. Initial full-run harness import errors were
  fixed by loading the two new real modules; startup expectations were preserved.
- Full suite: **2,966 passed, the same 5 baseline failures**. This task adds 21
  passing cases to the preceding 2,945/5 working-tree baseline (the request's
  2,944/5 predates one existing Slot diagnostic). No remaining new failures.
- Application/Convex TypeScript, focused Biome and `git diff --check`: passed.
- iPhone/Android device verification: not run. This is implementation complete
  with device verification pending, not TestFlight readiness approval.

Exact follow-up commands:

```sh
bun --no-env-file test lib/services/__tests__/otpDevelopmentLogger.test.ts lib/services/__tests__/otpSdkCompletion.test.ts lib/services/__tests__/otpClientFlow.test.ts lib/services/__tests__/verifyErrorHandling.test.ts tests/convex/otpResendLifecycle.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/appleReviewAuthSecurity.test.ts tests/convex/onboardingRouting.test.ts tests/convex/onboardingState.test.ts tests/convex/onboardingDraftHydration.test.ts tests/convex/onboardingBottomTabsHidden.test.ts
bun --no-env-file test lib/services/__tests__/startupSplashLifecycle.test.ts
bun --no-env-file test
bun run type-check --incremental false
bunx --no-install tsc --noEmit -p convex/tsconfig.json --incremental false
bunx --no-install biome check 'app/(auth)/verify.tsx' app/_layout.tsx lib/services/authErrorUtils.ts lib/services/otpRequestCoordinator.ts lib/services/otpDevelopmentLogger.ts lib/services/__tests__/otpClientFlow.test.ts lib/services/__tests__/verifyErrorHandling.test.ts lib/services/__tests__/otpDevelopmentLogger.test.ts lib/services/__tests__/startupSplashLifecycle.test.ts
git diff --check
```
