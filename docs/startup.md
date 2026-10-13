# Startup splash lifecycle

Approved behavior: Development keeps the React root bridge as a Dev Launcher
fallback. Preview and Production keep the native Expo splash until the final
destination is ready, with no React root bridge and no minimum splash duration.

`app/_layout.tsx` calls `preventAutoHideAsync()` at module initialization. The
existing `__DEV__` value selects the presentation; no separate environment flag
is used. Current EAS Preview and Production profiles use release builds.

| Mode | Normal native hide trigger | Root bridge | Emergency fallback |
| --- | --- | --- | --- |
| Development | Bridge container layout and logo load, followed by the existing animation-frame callback | Remains until final destination readiness; early readiness is buffered until bridge layout | Remove bridge 10 seconds after its layout |
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
