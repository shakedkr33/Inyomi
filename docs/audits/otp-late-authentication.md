# Late OTP completion and account identity — 2026-10-14

Decision: **No-Go for this race. Investigation complete; runtime fix stopped.**
The user explicitly requires stopping rather than applying an unsupported or
speculative fix. Only diagnostic tests and documentation were changed in this
follow-up. All pre-existing uncommitted OTP, security and readiness work remains.

## Verified lifecycle and ownership

Installed `@convex-dev/auth` 0.0.90:

1. `app/(auth)/verify.tsx` invokes `signIn` through `useOtpRequestScope` and the
   synchronous shared coordinator. Phone and digits are captured for the request.
2. SDK `src/react/client.tsx:223` reads/removes the OAuth verifier and invokes
   `client.authenticatedCall('auth:signIn', ...)`. There is no AbortSignal,
   cancellation handle, app attempt ID or credential-acceptance callback.
3. Server `src/server/implementation/signIn.ts` passes the code to
   `callVerifyCodeAndSignIn`; its mutation validates/consumes the challenge and
   calls the existing session logic. Invalid verification throws. Successful
   verification returns the session credentials. No server code changed here.
4. SDK `client.tsx:253` awaits `setToken` before returning `signingIn`.
   `setToken` at line 91 sets `token.current` FIRST, then persists JWT and refresh
   token through the storage adapter, then updates React token/loading state.
5. The root `ConvexAuthProvider` stays mounted above the route Slot. Removing a
   verification screen does not cancel the provider's async operation.
   `app/_layout.tsx` uses SecureStore through the TokenStorage adapter.
6. Convex's auth integration consumes this token. `app/(auth)/_layout.tsx` renders
   an authenticated Redirect independently of the verification callback.
   React rendering/Convex token acknowledgement and the caller continuation are
   asynchronous: there is no guarantee that redirect renders before continuation.
   The guaranteed ordering is token activation/storage before signIn resolves.
7. `useOtpRequestScope` suppresses obsolete screen callbacks only. It does not
   intercept the SDK's earlier token writes. The gate stays held until settlement.

The meaningful application control point is BEFORE calling signIn. The installed
public API supplies no veto between the response and token activation. Passing an
AbortSignal in the sign-in params would not create cancellation support.

## Options evaluated

| Option | Evidence and conclusion |
| --- | --- |
| A: supported cancellation | Not exposed by installed signIn signature/implementation or the public React API. No attempt generation, pre-persistence veto or session-specific result is returned. Do not patch internals. |
| B: lock navigation | `usePreventRemove` can stop navigation actions that remove the route, including pop/back and applicable swipe removal. It does not block push, SET_PARAMS or conditional parent unmount. Root/auth layouts use Expo Router Slot; installed Slot uses StackRouter and renders the focused descriptor, not an explicit native Stack with a configured swipe gesture. A lone hook/disabled button is insufficient. No claim that all navigation locking is impossible; a broader invariant across routers, links and identity would need its own proof. |
| C: attempt-aware cleanup | No existing app abstraction receives an exact session handle before activation. TokenStorage gets keys/values, not a trusted attempt context; token.current is already set before setItem. Rejecting storage writes is not a safe veto. Generic signOut is unsafe and prohibited; no cleanup was added. |
| D: backend/SDK contract | Deferred. A supported SDK pre-activation attempt contract would be preferable to custom JWT or rollback code. A backend architectural change is not proven necessary, but would require a separate plan if supported client alternatives cannot meet the invariant. |

Official references checked alongside the installed source:
- [Convex Auth React API](https://labs.convex.dev/auth/api_reference/react)
- [React Navigation usePreventRemove limitations](https://reactnavigation.org/docs/use-prevent-remove/)

## Lifecycle and navigation limits

- Visible Back is already disabled while requests are busy, but this is not a
  security boundary. No Android hardware-back listener or native gesture guard
  was added. Native hardware/gesture behavior has not been exercised.
- A push may focus another screen without removing verify from navigation state.
  SET_PARAMS can change a phone with the same route key. Diagnostic tests exercise
  these transitions using the installed StackRouter, not a hand-written model.
- Expo Router linking (`build/getLinkingConfig.js`) subscribes to external links.
  A screen-only Back handler cannot establish coverage of external navigation.
- Parent conditional rendering and the auth layout's Redirect are outside a
  screen-only removal guard. Blocking redirects after token activation does not
  restore correct authentication identity or prevent authenticated queries.
- Backgrounding does not invalidate/cancel the SDK promise. If JS resumes, it can
  continue. A killed JS process cannot run its old continuation, but credentials
  written before death may hydrate on cold start; a memory-only attempt guard
  cannot retroactively reject them. Process death timing is not device-tested.
- Installed Convex `src/browser/sync/request_manager.ts:193` rejects previously
  sent actions when reconnecting, and sends previously unsent actions. Thus a
  definitive rejection releases the existing gate; offline time itself is not
  guaranteed to settle the promise promptly. A timeout that merely unlocks UI
  can leave the SDK call able to authenticate later. No such timeout was added.
- A second OTP operation through the current shared coordinator is blocked until
  the first settles. The diagnostic two-concurrent-SDK-calls case deliberately
  bypasses it to demonstrate SDK behavior; it is NOT evidence that the current
  screens can issue those two requests concurrently.

## Tests and security meaning

`lib/services/__tests__/otpSdkCompletion.test.ts` executes the installed SDK React
AuthProvider with real React hooks, controlled transport promises, synthetic
credentials and in-memory storage. It does not replace signIn with a mock and
never sends SMS/network calls. Five diagnostic tests establish:

1. Token storage happens before the caller continuation and auth becomes active.
2. Removing the caller screen does not stop SDK persistence/activation.
3. SDK alone has no ordering protection for concurrent calls (gate bypass only).
4. Definitive transport rejection leaves unauthenticated state; retry can succeed.
5. StackRouter push/phone-param change need not remove the original route.

Passing these tests demonstrates the remaining defect, not a fix. Existing client
flow tests cover duplicate requests, failure unlock, phone changes, screen callback
suppression, autofill/resend/cooldown, and Apple Review. Session/security and
onboarding regressions were rerun. No native navigation coverage was invented.

## Separate implementation plan

1. Establish a supported contract that rejects an obsolete attempt BEFORE token
   activation and storage. Check upstream-supported SDK capabilities or a reviewed
   upstream enhancement; do not monkey-patch dependency code or decode/rewrite JWTs.
2. Alternatively, prototype an auth-flow-wide identity/navigation lock using
   supported navigation APIs. Prove all pushes, params, nested/parent removals,
   external links, redirects and same-tick events preserve the active identity.
   Define safe recovery for unresolved offline requests before calling it an MVP.
   A hook that covers only Back is not an acceptable replacement.
3. Test the real SDK boundary plus mounted application routing together, including
   late A after intended B, cold hydration and no generic sign-out of B. If neither
   supported route nor SDK contract is feasible, design an attempt-bound backend
   contract separately; retain existing Convex Auth rather than a new JWT system.
4. Validate Android hardware Back, iPhone gestures, background/foreground, killed
   process hydration and network interruptions on actual devices before release.

No app/runtime code was changed, so this follow-up requires no Convex deployment,
Metro reload or native rebuild. No deployment, EAS build, real SMS, migration,
Production access, commit or push occurred. The previous client patch still needs
its normal delivery to device builds; this investigation does not deliver it.

## Verification results

- New diagnostics: **5 pass / 0 fail**.
- Focused OTP/session/Apple Review/onboarding run: **293 pass / 0 fail**.
- Full suite: **2,944 pass / 5 fail**, versus prior **2,939 / 5**. No new failures.
  Same baseline failures: ownerScopeInsertSiteCoverage; taskSpaceAuthorization;
  calendarImportOnboarding; two googleOAuthClient Android/Kotlin source assertions.
- Application TypeScript, Convex TypeScript, focused Biome and diff whitespace
  checks passed. Tests use React test renderer (its deprecation warning remains).
- No iPhone or Android native behavior, real SMS delivery, or deployed behavior
  was tested. Back/swipe/external navigation prevention tests cannot pass as a
  claimed fix because no navigation lock was implemented.

Exact commands:

```sh
bun --no-env-file test lib/services/__tests__/otpSdkCompletion.test.ts
bun --no-env-file test lib/services/__tests__/otpSdkCompletion.test.ts lib/services/__tests__/otpClientFlow.test.ts lib/services/__tests__/verifyErrorHandling.test.ts tests/convex/otpResendLifecycle.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/appleReviewAuthSecurity.test.ts tests/convex/onboardingRouting.test.ts tests/convex/onboardingState.test.ts tests/convex/onboardingDraftHydration.test.ts tests/convex/onboardingBottomTabsHidden.test.ts
bun --no-env-file test
bun run type-check --incremental false
bunx --no-install tsc --noEmit -p convex/tsconfig.json --incremental false
bunx --no-install biome check lib/services/__tests__/otpSdkCompletion.test.ts
git diff --check
```

## Pending manual QA after an approved fix

Use designated test accounts on both Android and iPhone:
- Normal existing/new login and Apple Review: correct identity and destination.
- Delayed verification: visible Back, Android hardware Back, iPhone navigation
  gesture where supported, external link and programmatic navigation. Confirm
  the approved lock or cancellation guarantee, not merely the absence of a callback.
- Disconnect/reconnect: wrong OTP and definitive network error release restrictions;
  an unresolved request must not silently authenticate after identity changes.
- Rapid resend plus autofill: single request, no queued stale verification.
- Consecutive A/B phone attempts and switching accounts: A must never replace B,
  and no cleanup from A may sign out B. Check active account identity, not only UI.
- Background/foreground and killed-process restart before/after credential writes:
  correct identity, safe hydration and no unsolicited SMS.

## Follow-up: feasibility of the approved entire-flow lock

Scope: the subsequent **Safe OTP Verification Lock & Authentication Identity
Protection** request. This section supersedes the earlier options review only
with respect to the additional navigation feasibility evidence below. It does
not announce a runtime fix.

**Verdict:** a complete lock has not been established within the existing Slot
boundaries and the prohibition on a broader navigation rewrite. Do not install a
screen-only lock. This is not a claim that a client-only solution is impossible.

Additional verified implementation details:

- Both root and auth layouts use Slot. Installed Expo Router 6.0.24
  `build/views/Navigator.js` SlotNavigator invokes useNavigationBuilder with Expo's
  StackRouter directly. Supplying the `router` prop advertised by Slot's type does
  not install a custom factory. A sixth diagnostic test now executes the installed
  Slot module and confirms which router reaches the navigation builder.
- Public Expo Navigator does accept a router factory, but replacing the two Slots
  with custom navigators changes a shared routing boundary. Delegation must retain
  Expo's existing StackRouter behavior (singular/preview and nested routing), not
  silently substitute the plain React Navigation StackRouter. There is no completed,
  tested adapter here. No internal imports, unsupported Slot prop injection or
  dependency patches were added as a workaround.
- React Navigation's UNSTABLE_router override exists in the installed core, but is
  not exposed in the installed Slot props. Its existence is not proof that a root
  app-wide guard can be inserted through a supported Slot contract.
- Expo's installed `build/fork/useLinking.native.js` can dispatch an action or call
  resetRoot for an external URL. App code currently has no +native-intent entry
  point. Filtering external URL events alone does not cover internal push/replace,
  SET_PARAMS, or parent conditional unmount.
- Blocking rendered content with an overlay while allowing navigation underneath
  is not a proven complete lock: underlying destination effects can still run,
  and the intended route/phone can change. Such an overlay was not implemented.

Reachable paths and required ownership:

| Path | Current behavior / requirement for a complete implementation |
| --- | --- |
| Visible Back | Disabled while pending; event-level enforcement must read the authoritative lock synchronously. |
| Android system Back | NavigationContainer/system path, not the Pressable. Needs root handling, including the root-exit case. |
| iPhone swipe | No native-stack gesture is configured by these Slots; do not invent swipe support or claim physical verification. Any future gesture-generated removal must obey the same guard. |
| router.back/push/replace | Screen callbacks and parent routes dispatch into different navigator levels. Both root and auth-level transitions must preserve the pending attempt. |
| Parent auth Redirect | Currently reacts to SDK auth state independently of signIn settlement. It must defer safely during the verification transaction, then resume once settled. |
| External URL | Expo linking dispatch/resetRoot can bypass an auth-screen listener. Public routes include /e/[eventId] and /shared/[token]. Outside verification their behavior must remain unchanged. |
| Route phone params | Same route key can receive a different phone; a complete guard must block that transition before the screen adopts it. |
| Unmount/remount | Existing shared gate survives screen unmount; SDK call also survives. Screen-local guards alone cannot pin visible identity. |
| SDK token activation | Must be treated as part of the pending transaction; no generic rollback/signOut is permitted. |
| Background/foreground | Retain the pending attempt and lock; do not infer cancellation from app state. |
| Process termination | Old JS continuation cannot execute after process death. A token already written may hydrate. Initial auth hydration must finish before accepting a new attempt. This needs device tests. |
| Network unresolved/failure | Keep the lock for an unresolved promise, however long offline lasts. Release on definitive rejection only. Do not promise a short fixed wait or add timeout unlocking. |

The existing gate proves that a second send/verify through InYomi's current OTP
handlers cannot start while the first is pending. It does NOT prove an immutable
visible phone or complete navigation protection; those remain the blocker.

### Minimal alternative to approve before expanding navigation scope

Approve a bounded navigation-boundary implementation/prototype, with no change to
Convex Auth or backend. Concrete scope:

1. `lib/services/otpRequestCoordinator.ts`: extend the single authoritative gate
   with an immutable attempt identity and operation kind; retain it until definitive
   SDK settlement. Do not add a competing lock or persist OTPs.
2. New `lib/components/auth/OtpFlowNavigator.tsx`: supported Navigator adapter for
   the two existing root/auth boundaries, with unchanged behavior when unlocked.
   Before implementation, establish how it preserves Expo routing behavior and
   intercepts action dispatch, parameter changes and nested/root state replacement.
   If that cannot be achieved through public APIs, stop the prototype.
3. `app/_layout.tsx` and `app/(auth)/_layout.tsx`: use that boundary, ensure parent
   redirects cannot unmount the active flow before settlement, and host the pending
   indication above the route screen. Preserve startup and public-link behavior.
4. `lib/hooks/useOtpRequestScope.ts`, `app/(auth)/verify.tsx` and
   `app/(auth)/sign-in.tsx`: consume the same immutable identity and gate; show
   “מאמתים את הקוד, יש להמתין...” and release restrictions only after settlement.
5. Add mounted nested-navigation + real SDK tests for internal/external navigation,
   same-tick changes, unmount, success and failure. Then run physical iPhone and
   Android QA before any release approval. Native mocks are not release evidence.

This is a proposed scope, not a proven implementation. It requires explicit scope
approval because it replaces shared navigation boundaries, exceeding a hook or
screen fix under the request's "No broad navigation refactoring" constraint.
No approval is needed to retain the current investigation/tests; they are complete.
No SDK change or backend deployment is proposed. A later JS-only implementation
would use Metro for development; installed TestFlight apps need an approved JS
update/build. This diagnostic-only follow-up itself needs neither.

Follow-up validation: **294 focused passes / 0 failures**; full suite **2,945
passes / the same 5 baseline failures** (one additional diagnostic pass relative
to 2,944/5). Application and Convex TypeScript, focused Biome and git diff
whitespace checks passed.
The exact focused/full/type-check commands are the same as the earlier command
block above and include the expanded SDK-completion test file. No native tests,
SMS or app changes were made. Changed artifacts in this follow-up are only this
report and `lib/services/__tests__/otpSdkCompletion.test.ts`.
