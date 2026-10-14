# OTP resend investigation — 2026-10-14

> Follow-up: the separately authorized client coordination patch is documented
> in [Phone OTP client coordination](../otp-client-flow.md). The investigation
> below records the pre-patch state; the incident attribution and SDK cancellation
> limitations remain unresolved.

Status: **diagnostic work only; reported Android incident is not fixed or fully
attributed**. The request explicitly requires a diagnostic plan instead of a
speculative change when the incident's root cause cannot be established. No app,
provider, Auth-library, schema, credential or configuration changes were made.
Prior Production Readiness/session-security work is preserved. No deployment,
paid/provider call, real SMS, user-data access, migration, build, commit or push.

## Evidence and limits

User-confirmed physical Android sequence: after logout, first SMS delayed, resend,
two distinct codes arrive, later-arriving code fails, earlier-arriving code works
and Home opens. Receipt order is not generation, persistence or send order.
The error is thrown by installed Auth signInImpl when verification returns null;
it does not identify why verification failed. The exact deployed code revision,
server request ordering and Twilio verification/attempt metadata were not supplied.
No causal link to the new session helper has been established. Phone-code issuance
and verification use library Auth mutations, not the application's session helper;
the helper protects application access after authentication.

## Current lifecycle, verified in source

- Installed @convex-dev/auth: 0.0.90. No Twilio SDK: convex/auth.ts uses fetch.
- sign-in.tsx normalizes the phone using parseIsraeliPhone and awaits
  signIn('phone', {phone}) before navigating. Review phone skips SMS initially.
- verify.tsx resends with the same route phone and provider 'phone'. Verification
  uses 'phone', except the existing phone-only Apple Review routing.
- Each Auth send generates a new six-digit value in InYomi, then commits a
  replacement hashed authVerificationCodes record for the same provider account.
  Only one record per account remains. The phone provider maxAge is 20 minutes.
- Only AFTER that mutation commits does the action invoke the delivery callback.
  InYomi POSTs To/Channel/CustomCode to Twilio Verify /Verifications. No Twilio
  Verification SID is stored or correlated, and no VerificationCheck is called.
- Verification searches the hash of the entered code, checks expiry/provider and
  phone/account match, consumes the found challenge and creates a session. This
  flow has no client challenge ID to reset; the route phone is the correlation.
  The library's generic verifier storage is not an SMS attempt-selection feature.
- Wrong codes increment the existing server failed-verification rate limit
  (default token bucket capacity 10, replenished over an hour). Successful
  verification resets it. Expired/used codes are rejected. A thrown mutation
  rolls back; a null result can commit failed-attempt/consumption changes before
  the outer action throws Could not verify code.
- Frontend cooldown is 60 seconds; it is a UX restriction, not server send
  throttling. Provider send limits may additionally apply; dashboard state unknown.
- On verify success the screen navigates to family-bootstrap. It does not inspect
  the returned signingIn boolean. Wrong-code errors map to Hebrew and retain the
  screen. That error mapping alone is not a component/navigation test.

## Provider contract: what is and is not established

Twilio documents token reuse during the validity window, normally 10 minutes.
Custom codes require Custom Verification Code to be enabled, and Twilio asks for
verification outcome feedback. Its Verification resource documents cancellation
for starting a different-code session and approval after application verification.

Sources:
- [Verify validity/retry rules](https://www.twilio.com/docs/verify/api/rate-limits-and-timeouts)
- [Custom code configuration and feedback](https://www.twilio.com/docs/verify/api/customization-options)
- [Verification resource and status transitions](https://www.twilio.com/docs/verify/api/verification)

These documents do not prove what happened to the two requests in the affected
Service. Do not assume a resend CustomCode always replaces the delivered token,
or assume that Twilio kept the first code. InYomi neither records the response
SID/status nor sends an approval update after local verification. The 20-minute
Auth lifetime and normal 10-minute Verify window are different lifecycles.
A model in which Twilio delivers only the older code while Convex stores a newer
one predicts the older code FAILING; it alone does not explain the reported
successful earlier-arriving SMS. Do not claim that model as the incident cause.

## Confirmed local failure mechanisms, not incident attribution

1. **Out-of-order delivery:** two completed sequential requests leave only the
   second persisted code valid. If its SMS arrives first, entering the last SMS
   fails and entering the earlier-arriving SMS succeeds. This reproduces the
   reported outcome without a stale client challenge or session regression.
2. **Concurrent requests:** the last committed challenge wins, even if generated
   by the earlier-started request. A synthetic delayed generator demonstrates
   this. No evidence yet that concurrent requests occurred on the device.
3. **Send failure after commit:** a rejected/timed-out delivery callback leaves
   the replacement challenge stored and the old code invalid. Returning to the
   old digits after a resend failure cannot guarantee successful verification.

Frontend weaknesses established by code inspection, not device-causal proof:
- Initial send and resend use React state guards, so rapid taps before a render
  can issue concurrent requests. Only verification has a synchronous ref guard.
- The hidden input remains editable intentionally to preserve native focus;
  auto-submit calls verify, which does not check isResending. Therefore an OTP
  autofill/edit can attempt verification during resend, despite disabled buttons.
- Phone route changes do not explicitly reset code, cooldown or in-flight result
  relevance. Screen remount behavior needs component/device validation.
- Resend success clears digits after backend success, correctly avoids success
  on rejection, but promises a *new* code. Delivery does not prove receipt or
  which received SMS is newest by issuance. Apple Review resend also uses the
  phone provider even though initial review login sends no SMS.

No speculative application fix was made. A unified synchronous send/verify guard,
phone-scoped stale-result handling and neutral resend copy are bounded candidate
changes after the reproduction is correlated; they would not solve provider-side
code mismatch by themselves. Do not make the hidden input non-editable as a
shortcut: it previously caused native focus/keyboard regressions.

## Security findings and limits

The new tests preserve single active challenge, phone matching, expiry, replay
rejection and the existing failed-verification rate limit. They do not establish
server SMS-send throttling. Two devices/requests for one phone replace the same
account challenge, not independently selected challenge sessions.

Do not enable AUTH_LOG_LEVEL=DEBUG to investigate: the installed library logs
createVerificationCode arguments including raw code/phone at debug level. InYomi
currently logs raw Twilio error bodies; those must be treated as potentially
sensitive. The current Math.random OTP generator is also an existing security
hardening concern, not established as the cause of resend failure. No raw logs,
real codes, phone numbers, tokens or credentials were read or printed here.

## Exact diagnostic evidence needed next

Use a fresh synthetic phone/account in Development under separately authorized
manual QA. Do not query or export existing authVerificationCodes/user records.

1. Record deployed revision, device/client version, UTC timestamps and sanitized
   request IDs for initial send, resend, failure and successful verification.
2. Correlate each accepted send to its Twilio Verification SID and send attempt
   timestamp/status; compare whether SID is reused, and note error codes/429s.
   Keep identifiers private in the operator's tools; share only sanitized findings.
3. Inspect the existing Verify Service's CustomCode-enabled state, configured
   validity and supported CustomCode behavior on a repeated pending verification.
   Do not toggle settings or cancel live verifications during diagnosis.
4. Establish generation/persistence order separately from SMS delivery order.
   Label synthetic attempts A/B privately; never log raw OTP, phone, SMS body,
   access/refresh token or an unsalted six-digit code hash (easily enumerable).
   If telemetry is needed, propose a random nonsecret correlation ID and a
   redacted operation/status trail in a separately reviewed patch.
5. Repeat sequential resend, rapid taps, typing/autofill during resend, failed
   resend, delayed/reversed delivery, phone change and re-entry after a wrong code.
   Record outcomes rather than assuming the most recently received SMS is valid.
6. If Twilio reuses the pending code despite CustomCode, choose and verify one
   supported lifecycle before implementation. Cancellation/approval introduces
   concurrency and configuration considerations; do not add it blindly. Do not
   read/store plaintext codes, preserve older challenges or extend validity to
   make this test pass, and do not add a second OTP system.

## Automated evidence

Added tests/convex/otpResendLifecycle.test.ts: 11 diagnostic tests invoke the actual
installed signInImpl, createVerificationCodeImpl and verifyCodeAndSignInImpl with
synthetic DB/delivery adapters. It covers initial send, replacement, reversed
arrival, concurrent commit ordering, provider/network failure after commit,
modeled retained-code delivery, wrong-then-correct code, expiry, phone mismatch,
replay and server rate limits. The provider-reuse case is explicitly a model.
No production code imports unsupported internals; only tests reference installed
source. Tests generate no JWTs and never call Twilio. The transaction adapter is
not hosted Convex concurrency validation. SMS order is simulated, not real delivery.

Rapid-tap UI, native autofill/focus, phone-route changes, cooldown timing and actual
Apple Review login remain NOT device/component verified by these new tests.
Existing Apple Review/session/onboarding regression suites are run separately;
passing those is not proof of this OTP incident's resolution.

## Rollout / device QA

No application/backend behavior changed, so this diagnostic work needs neither
Convex deployment nor a native build/Metro reload. Any later backend correction
will require Development deployment; TS-only UI changes normally need Metro reload
in a development client and a newly distributed bundle/build for installed testers.
No native dependency change is currently proposed.

On both Android and iPhone, manually test synthetic accounts with slow delivery,
resend after cooldown, reversed SMS order, rapid taps, OTP autofill during resend,
offline resend/retry, invalid-then-valid entry, phone change, expiry and replay.
Preserve review-provider routing and check existing sessions on another device.
A narrow frontend correction must preserve RTL, accessibility and native focus.

**NO-GO for claiming this OTP issue resolved or distributing externally.** Next
step: obtain the missing request/provider ordering evidence, then select the
smallest confirmed correction. Storage-URL, logout and other readiness blockers
remain separate. Production is untouched.

## Final verification results

- New diagnostic file: **11 passed, 0 failed**.
- Focused OTP/Auth/session/Apple Review/onboarding suite: **260 passed, 0 failed**.
- Full suite: **2,925 passed, 5 failed**, 2,930 tests across 109 files. Compared with
  the previous 2,914/5 baseline: 11 additional passing tests, same five failures.
- App and Convex TypeScript: passed. Focused Biome on the new test: passed.
- git diff --check: passed. No device, provider or deployed behavior verified.

```sh
bun --no-env-file test tests/convex/otpResendLifecycle.test.ts
bun --no-env-file test tests/convex/otpResendLifecycle.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/appleReviewAuthSecurity.test.ts lib/services/__tests__/verifyErrorHandling.test.ts tests/convex/postDeleteAccountOnboardingRace.test.ts
bun --no-env-file test
bun run type-check --incremental false
bun --no-env-file x --no-install tsc --noEmit --incremental false -p convex/tsconfig.json
bun x --no-install biome check tests/convex/otpResendLifecycle.test.ts
git diff --check
```

Only this report and tests/convex/otpResendLifecycle.test.ts were added in this
turn. Existing application/provider/client files and prior local work were not
modified. The absent incident correlation evidence was requested from the user;
no secrets or personal data are needed in the reply.
