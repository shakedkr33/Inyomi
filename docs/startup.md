# Startup splash lifecycle

Approved behavior: Development keeps the React root bridge as a Dev Launcher
fallback. Preview and Production keep the native Expo splash until the final
destination is ready, with no React root bridge and no minimum splash duration.

`app/_layout.tsx` calls `preventAutoHideAsync()` at module initialization. The
existing `__DEV__` value selects the presentation; no separate environment flag
is used. Current EAS Preview and Production profiles use release builds.

| Mode | Normal native hide trigger | Root bridge | Emergency fallback |
| --- | --- | --- | --- |
| Development | Bridge layout + logo load + existing animation-frame callback, or final destination readiness when removing the bridge, whichever schedules the handoff first | Remains until final destination readiness; early readiness is buffered until bridge layout | Remove bridge 10 seconds after its layout |
| Preview / Production | Existing final-destination readiness signal, immediately | Not rendered | Hide native splash 10 seconds after the root subscription mounts |

The destination signal is unchanged: `useStartupDestinationReady` requires the
destination's layout, navigation focus, and completed cold-start notification
capture. `reportDestinationReady` latches and replays the first signal. Auth,
onboarding, family/profile, subscription and notification routing gates retain
their existing behavior. Child loading splashes remain mounted when their
layouts require them, underneath native splash during normal release startup.

Release readiness and the emergency timer share the native hide-once ref. A
normal signal cancels the timer; an already-latched signal hides immediately
without starting one. Unmount clears the timer and subscription. The emergency
path reveals whatever app/loading state exists; it never redirects or changes
business state. Reaching the timer in normal QA is a failure, not expected timing.

Release logging is limited to `T_FINAL_DESTINATION_READY`,
`T0_HIDE_NATIVE_SPLASH`, `T0_HIDE_NATIVE_SPLASH_RESOLVED`,
`T0_HIDE_NATIVE_SPLASH_FAILED`, and `NATIVE_SPLASH_FAILSAFE`. Hide events contain
only environment, reason, and the fixed destination key. Other startup/gate logs
remain development-only. API completion is not proof of physical screen paint.

Implementation has component-level coverage with mocked native APIs. Android
and iOS release-device rendering and delivery remain to be verified. A rejected
native hide call is logged without error contents; it is not retried, preserving
the exactly-once call requirement. The JS timer cannot recover a stalled JS runtime.

## iOS Development startup correction (2026-10-14)

The reported iPhone logs show destination readiness and React bridge removal,
but do not include a native hide request/completion. This does **not** establish
which visible layer remained on that device. The confirmed code defect is an
event-order race already present in checkpoint `b63d640` and HEAD `867e6f1`:
bridge layout → auth destination ready → bridge removed → its image never gets
to call `onLoad` → native hide is never requested. A regression test failed before
the correction with the bridge absent and zero hide calls. Recent OTP logging and
session/notification changes did not introduce this root lifecycle code. A timing
difference between devices can expose the race; its exact device trigger remains
unverified.

RootLayout now requests native hide on the existing final-destination signal
when removing the development bridge, sharing the existing hide-once guard with
the early image handoff. This also applies if the old bridge failsafe already
removed the React layer before readiness arrived. No new timer or delay was
added. The early layout/image/frame path, focus/capture gates and release path
remain. Native hide rejection is now diagnosed in the development image path,
without logging an error object, retrying or claiming successful removal.

Layers inspected:

- iOS `Info.plist` selects `SplashScreen.storyboard`; Expo's native loading view
  uses it. The installed `SplashScreenManager.swift` can show that view again on
  Reload. The inspected Swift/JS package source does not prove the exact contents
  of the already-installed device binary.
- Development RootLayout has an absolute React bridge over Slot. It is removed
  by destination readiness; there is no opacity animation in that layer.
- Auth/authenticated layouts use child splashes during their routing gates.
- Welcome has a separate absolute splash while checking the draft/loading artwork.
  Its existing image callbacks/failsafe are unchanged. Auth readiness reports the
  **auth wrapper's** layout/focus, not proof that this child overlay has disappeared.

To distinguish those React layers, development startup traces now report mount
and unmount with fixed `source` values: `root`, `auth`, `authenticated`, `welcome`.
Welcome previously shared `auth`, making the supplied unmount line ambiguous.
Unmount also reports `hadLayout`. These diagnostics never log route parameters,
identities or personal data, and are filtered out of release by startupTrace.
They can be removed after physical-device diagnosis; they do not affect rendering.

`hideAsync()` resolution is **not proof of visible native removal**: the installed
JS implementation calls `hide()`, and the iOS manager dispatches view removal to
the main queue. If the logo remains after this correction, capture a complete
fresh runtime trace from `T0_ROOT_MODULE`: `T0_HIDE_NATIVE_SPLASH`, its
`RESOLVED`/`FAILED` event, `T_BRIDGE_REMOVED`, and every child splash mount/unmount.
Correlate with the visible frame. If all React layers are unmounted and native
hide resolves but the logo remains, inspect the running iOS view hierarchy before
any native workaround; do not infer a native fix from mocked tests alone.

## Explicit logout destination

The current product decision supersedes the earlier logout task's Welcome target:
**explicit Profile logout goes directly to `/(auth)/sign-in` (phone entry)**.
`lib/explicitLogoutNavigation.ts` stores a single in-memory intent only after Push
unregister and local draft cleanup, just before supported Auth signOut. Failure
cancels that attempt's intent. The authenticated layout consumes it only after
Auth resolves signed out and the root navigator exists, retaining its selected
destination across effect reruns. It never navigates based on the intent while
still authenticated. The intent contains no account data and does not persist
across a full JS Reload/restart.

First-launch Welcome/onboarding, normal unauthenticated app opening, the current
account-deletion Welcome fallback, and session-expiry routing are preserved.
No second auth flow, signOut rollback or general router adapter was introduced.
Push, live-session checks, OTP coordination and the previous notification/logout
cleanup corrections are unchanged. External revocation recovery limitations in
`authentication-session-validity.md` remain separate.

## Current validation and device QA

Local changes only: no Convex/native/config/assets changes, deployment, build,
migration, commit or push. Metro **full Reload** in the existing development build
is sufficient to load this JS correction for QA; no new native build or Convex
deployment is required by this task. This is not proof that the reported iPhone
symptom is resolved.

On physical iPhone and Android, verify:

1. Unauthenticated cold launch and Developer Menu Reload: Welcome or the existing
   draft-driven sign-in destination appears; no permanent logo or beige gap.
2. Authenticated cold launch: Home or the intended onboarding/deep-link destination;
   existing capture/focus protections remain, without an intermediate Home flash.
3. Background/foreground: no bridge/native logo reappears. Repeat the slow/cached
   artwork cases; no normal startup should rely on the 10-second failsafe.
4. Explicit Profile logout: Push cleanup succeeds, then phone entry appears
   directly with no Welcome flash. Offline failure stays signed in with feedback.
5. Account deletion retains Welcome; later A→B login does not inherit the prior
   account's inbox/profile. App restart without credentials retains its normal
   unauthenticated opening behavior. Check Hebrew RTL and Back on phone entry.

Both regressions remain **No-Go for release until device verification**. The
reproduced startup code race and explicit-logout destination are corrected locally;
native visibility, OS Reload and physical paint are still unverified.

Final automated results for this correction:

- Startup/logout component tests: **38 passed, 0 failed** (19 in each file).
  Root, auth layout, Welcome and splash components are real; native views, router
  transitions and network are simulated. Home readiness uses the real hook with
  a test destination, not a physical Home screen.
- Focused startup/logout/OTP/session/notification/deletion suite: **367 passed,
  0 failed**, 13 files.
- Full suite: **3,006 passed, 5 failed**, 114 files (prior baseline: 2,992 / 5).
  The same failures remain: device-calendar ownerScope source assertion,
  family/cross-space event fixture, calendar-import skip text, two Android Google
  OAuth source guards. No new final failures; these files were not modified.
- Application and Convex TypeScript, focused Biome (8 files), and
  `git diff --check`: passed. No physical-device/native/hosted tests performed.

Exact validation commands (output captured outside the repository):

```sh
bun --no-env-file test lib/services/__tests__/startupSplashLifecycle.test.ts lib/services/__tests__/logoutLifecycle.test.ts
bun --no-env-file test lib/services/__tests__/startupSplashLifecycle.test.ts lib/services/__tests__/logoutLifecycle.test.ts lib/services/__tests__/otpClientFlow.test.ts lib/services/__tests__/otpSdkCompletion.test.ts lib/services/__tests__/otpDevelopmentLogger.test.ts lib/services/__tests__/verifyErrorHandling.test.ts lib/services/__tests__/accountDeletionUi.test.ts tests/convex/authRevocationAudit.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/notificationSessionLifecycle.test.ts tests/convex/pushTokenLifecycle.test.ts tests/convex/pushLogoutDevice.test.ts tests/convex/postDeleteAccountOnboardingRace.test.ts
bun --no-env-file test
bun run type-check --incremental false
bun --no-env-file x --no-install tsc --noEmit --incremental false -p convex/tsconfig.json
bun --no-env-file x --no-install biome check app/_layout.tsx 'app/(auth)/index.tsx' 'app/(authenticated)/_layout.tsx' 'app/(authenticated)/profile.tsx' components/InYomiSplashScreen.tsx lib/explicitLogoutNavigation.ts lib/services/__tests__/startupSplashLifecycle.test.ts lib/services/__tests__/logoutLifecycle.test.ts
git diff --check
```

Changed files: `app/_layout.tsx`, `app/(auth)/index.tsx` (diagnostic source only),
`app/(authenticated)/_layout.tsx`, `app/(authenticated)/profile.tsx`,
`components/InYomiSplashScreen.tsx` (diagnostics only),
`lib/explicitLogoutNavigation.ts` (new), the two startup/logout test files above,
`docs/startup.md`, `docs/authentication-session-validity.md` (superseding destination
decision and user-reported Development deployment). The auth route-group layout
itself is unchanged. All unrelated pre-existing uncommitted files were checked
against initial content hashes and preserved; the task diff was reviewed.

## Preview QA

Build Android with `eas build --platform android --profile preview`. Install the
resulting APK and stop Metro. For a returning signed-in user, force-stop without
clearing data, then launch from the app icon and record native splash to Home.
Repeat for signed-out, onboarding-incomplete, notification and supported shared
link destinations, including their existing error states. There should be one
continuous branded startup surface until the intended destination, no React root
bridge, no intervening Home for redirected launches, and no emergency timeout.

Repeat these destination cases on an iPhone with a Preview/Production-style
release build. Check Android splash system bars separately; this architecture
change does not modify native resources or system-bar settings.
