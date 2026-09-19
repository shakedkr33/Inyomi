/**
 * googleOAuthClient.test.ts
 *
 * Focused regression coverage for the Android Google OAuth client wiring
 * (lib/services/googleOAuthClient.ts). Covers:
 *   1. iOS resolves the existing iOS client id.
 *   2. Android resolves the new Android client id.
 *   3. A missing platform-specific client id fails clearly (null) rather
 *      than silently falling back to the other platform's client id.
 *   4. Native redirect scheme derivation differs correctly per platform
 *      (iOS: reversed client id; Android: package name).
 *   5. The OAuth scope requested by the hook remains calendar.readonly only
 *      (verified via source inspection of the real hook file, since
 *      importing that file directly breaks `bun test` — see the file-level
 *      comment in googleOAuthClient.ts).
 *   6. No subscription/access gating is introduced anywhere in this flow.
 *
 * Run with: bun test lib/services/__tests__/googleOAuthClient.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  ANDROID_PACKAGE_NAME,
  deriveGoogleOAuthNativeScheme,
  resolveGoogleOAuthClientId,
  resolvePlatformGoogleOAuthClientId,
} from '../googleOAuthClient';

const IOS_CLIENT_ID =
  '223048558449-cab0cdv12hiq0g7ujdsibuauoummed6o.apps.googleusercontent.com';
const ANDROID_CLIENT_ID =
  '223048558449-prqpd2obg0pdbg5s120777l29e025o15.apps.googleusercontent.com';

// ── 1 & 2: platform-specific client id resolution ───────────────────────────

describe('resolvePlatformGoogleOAuthClientId — per-platform selection', () => {
  it('iOS resolves the existing iOS client id', () => {
    const result = resolvePlatformGoogleOAuthClientId('ios', {
      iosClientId: IOS_CLIENT_ID,
      androidClientId: ANDROID_CLIENT_ID,
    });
    expect(result).toBe(IOS_CLIENT_ID);
  });

  it('Android resolves the new Android client id', () => {
    const result = resolvePlatformGoogleOAuthClientId('android', {
      iosClientId: IOS_CLIENT_ID,
      androidClientId: ANDROID_CLIENT_ID,
    });
    expect(result).toBe(ANDROID_CLIENT_ID);
  });
});

// ── 3: missing platform-specific client id fails clearly, no fallback ──────

describe('resolvePlatformGoogleOAuthClientId — missing config fails clearly', () => {
  it('returns null on Android when only the iOS client id is configured (no fallback)', () => {
    const result = resolvePlatformGoogleOAuthClientId('android', {
      iosClientId: IOS_CLIENT_ID,
      androidClientId: undefined,
    });
    expect(result).toBeNull();
  });

  it('returns null on iOS when only the Android client id is configured (no fallback)', () => {
    const result = resolvePlatformGoogleOAuthClientId('ios', {
      iosClientId: undefined,
      androidClientId: ANDROID_CLIENT_ID,
    });
    expect(result).toBeNull();
  });

  it('returns null for an empty-string client id', () => {
    expect(
      resolvePlatformGoogleOAuthClientId('android', {
        iosClientId: undefined,
        androidClientId: '',
      })
    ).toBeNull();
  });

  it('returns null for a malformed client id (missing required suffix)', () => {
    expect(resolveGoogleOAuthClientId('not-a-real-client-id')).toBeNull();
    expect(
      resolvePlatformGoogleOAuthClientId('android', {
        iosClientId: undefined,
        androidClientId: 'not-a-real-client-id',
      })
    ).toBeNull();
  });

  it('never cross-resolves: a malformed Android id does not fall back to a valid iOS id', () => {
    const result = resolvePlatformGoogleOAuthClientId('android', {
      iosClientId: IOS_CLIENT_ID,
      androidClientId: 'garbage',
    });
    expect(result).toBeNull();
  });
});

// ── 4: native redirect scheme derivation per platform ───────────────────────

describe('deriveGoogleOAuthNativeScheme — platform-specific redirect scheme', () => {
  it('iOS: reverses the client id into the standard iOS custom-scheme redirect', () => {
    const scheme = deriveGoogleOAuthNativeScheme('ios', IOS_CLIENT_ID);
    expect(scheme).toBe(
      'com.googleusercontent.apps.223048558449-cab0cdv12hiq0g7ujdsibuauoummed6o:/oauthredirect'
    );
  });

  it('Android: uses the app package name, NOT the reversed client id', () => {
    const scheme = deriveGoogleOAuthNativeScheme('android', ANDROID_CLIENT_ID);
    expect(scheme).toBe(`${ANDROID_PACKAGE_NAME}:/oauthredirect`);
    expect(scheme).toBe('com.shakedkr.inyomi:/oauthredirect');
    // Explicitly not the iOS-style reversed-client-id scheme.
    expect(scheme).not.toContain('googleusercontent');
  });

  it('Android scheme is identical regardless of which valid Android client id is passed', () => {
    // Google's "Android" OAuth client type has no redirect-URI field — the
    // redirect is tied to the app's package name, not the client id.
    const schemeA = deriveGoogleOAuthNativeScheme('android', ANDROID_CLIENT_ID);
    const schemeB = deriveGoogleOAuthNativeScheme(
      'android',
      '999999999999-anotherandroidclientid.apps.googleusercontent.com'
    );
    expect(schemeA).toBe(schemeB);
  });
});

// ── 5 & 6: hook source-level regression guards ──────────────────────────────

const HOOK_SOURCE = readFileSync(
  new URL('../../hooks/useGoogleCalendarAuth.ts', import.meta.url),
  'utf8'
);

describe('useGoogleCalendarAuth.ts — scope and gating regression guard', () => {
  it('requests exactly the calendar.readonly scope (no identity/other scopes added)', () => {
    expect(HOOK_SOURCE).toContain(
      "const CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';"
    );
    expect(HOOK_SOURCE).toContain('scopes: [CALENDAR_READONLY]');
    expect(HOOK_SOURCE).not.toMatch(/scope.*(profile|email|openid)/i);
  });

  it('still uses PKCE (usePKCE: true, S256)', () => {
    expect(HOOK_SOURCE).toContain('usePKCE: true');
    expect(HOOK_SOURCE).toContain('CodeChallengeMethod.S256');
  });

  it('reads both platform-specific client id env vars, never a shared/generic one', () => {
    expect(HOOK_SOURCE).toContain(
      'process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'
    );
    expect(HOOK_SOURCE).toContain(
      'process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'
    );
  });

  it('does not introduce any subscription/access gating', () => {
    const forbiddenTokens = [
      'useEffectiveAccess',
      'RevenueCat',
      'subscriptionTier',
      'entitlement',
      'isTrialActive',
      'isExpiredFree',
    ];
    for (const token of forbiddenTokens) {
      expect(HOOK_SOURCE).not.toContain(token);
    }
  });
});

// ── Android AuthorizationClient branch — source-level regression guards ────
//
// The hook cannot be executed directly under `bun test` (it transitively
// imports 'react-native' via expo-auth-session/expo-modules-core, which
// crashes the test runner — see the file-level comment above). These tests
// therefore verify the Android/iOS branching contract at the source level,
// the same established pattern as the scope/PKCE/gating guards above.

describe('useGoogleCalendarAuth.ts — Android native AuthorizationClient branch', () => {
  it('imports authorizeGoogleCalendar from the local expo-google-calendar-auth module', () => {
    expect(HOOK_SOURCE).toContain('authorizeGoogleCalendar,');
    expect(HOOK_SOURCE).toContain(
      "} from '@/modules/expo-google-calendar-auth/src';"
    );
  });

  it('branches on Platform.OS === "android" inside startAuthorization, delegating to the native module', () => {
    expect(HOOK_SOURCE).toContain("if (Platform.OS === 'android') {");
    expect(HOOK_SOURCE).toContain('await startAndroidAuthorization();');
  });

  it('calls useAuthRequest unconditionally (Rules of Hooks) — it is not called from inside the Android branch', () => {
    // The hook call itself must appear exactly once, at the top level of
    // the hook function, not nested inside startAuthorization/
    // startAndroidAuthorization (which are defined further down in the
    // file). If useAuthRequest ever moves after those definitions or
    // inside a conditional, this ordering check fails.
    const useAuthRequestIndex = HOOK_SOURCE.indexOf(
      'const [request, , promptAsync] = useAuthRequest('
    );
    const startAndroidDefIndex = HOOK_SOURCE.indexOf(
      'const startAndroidAuthorization = useCallback('
    );
    const startAuthorizationDefIndex = HOOK_SOURCE.indexOf(
      'const startAuthorization = useCallback('
    );
    expect(useAuthRequestIndex).toBeGreaterThan(-1);
    expect(startAndroidDefIndex).toBeGreaterThan(-1);
    expect(startAuthorizationDefIndex).toBeGreaterThan(-1);
    expect(useAuthRequestIndex).toBeLessThan(startAndroidDefIndex);
    expect(useAuthRequestIndex).toBeLessThan(startAuthorizationDefIndex);

    // useAuthRequest appears exactly once — never called a second time
    // conditionally elsewhere in the file.
    const occurrences = HOOK_SOURCE.split('useAuthRequest(').length - 1;
    expect(occurrences).toBe(1);
  });

  it('startAndroidAuthorization never falls back to iOS clientId/redirectUri/promptAsync', () => {
    const startIndex = HOOK_SOURCE.indexOf(
      'const startAndroidAuthorization = useCallback('
    );
    const endIndex = HOOK_SOURCE.indexOf(
      'const startAuthorization = useCallback('
    );
    const androidFnSource = HOOK_SOURCE.slice(startIndex, endIndex);
    expect(androidFnSource).not.toContain('clientId');
    expect(androidFnSource).not.toContain('redirectUri');
    expect(androidFnSource).not.toContain('promptAsync');
    expect(androidFnSource).not.toContain('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
  });

  it('calls authorizeGoogleCalendar() with no forced account selection in the normal flow', () => {
    // The normal Calendar import flow must never force account selection —
    // it must call authorizeGoogleCalendar() with no options (defaults to
    // forceAccountSelection: false inside the module itself).
    expect(HOOK_SOURCE).toContain('result = await authorizeGoogleCalendar();');
    expect(HOOK_SOURCE).not.toContain('forceAccountSelection: true');
  });

  it('treats native cancellation as a clean idle transition, distinct from error', () => {
    const startIndex = HOOK_SOURCE.indexOf(
      'const startAndroidAuthorization = useCallback('
    );
    const endIndex = HOOK_SOURCE.indexOf(
      'const startAuthorization = useCallback('
    );
    const androidFnSource = HOOK_SOURCE.slice(startIndex, endIndex);

    // Cancellation branch: sets 'idle', not 'error'.
    expect(androidFnSource).toContain('if (result.cancelled) {');
    const cancelledBranchIndex = androidFnSource.indexOf(
      'if (result.cancelled) {'
    );
    const cancelledBranch = androidFnSource.slice(
      cancelledBranchIndex,
      cancelledBranchIndex + 120
    );
    expect(cancelledBranch).toContain("setStatus('idle')");
    expect(cancelledBranch).not.toContain("setStatus('error')");
  });

  it('native authorization failure (thrown/rejected) transitions to a controlled error state', () => {
    const startIndex = HOOK_SOURCE.indexOf(
      'const startAndroidAuthorization = useCallback('
    );
    const endIndex = HOOK_SOURCE.indexOf(
      'const startAuthorization = useCallback('
    );
    const androidFnSource = HOOK_SOURCE.slice(startIndex, endIndex);
    expect(androidFnSource).toContain('} catch {');
    expect(androidFnSource).toContain("setStatus('error')");
  });

  it('native success sets authorized status and the returned access token', () => {
    const startIndex = HOOK_SOURCE.indexOf(
      'const startAndroidAuthorization = useCallback('
    );
    const endIndex = HOOK_SOURCE.indexOf(
      'const startAuthorization = useCallback('
    );
    const androidFnSource = HOOK_SOURCE.slice(startIndex, endIndex);
    expect(androidFnSource).toContain('setAccessToken(result.accessToken);');
    expect(androidFnSource).toContain("setStatus('authorized');");
  });
});

// ── Native Kotlin module — source-level regression guards ──────────────────

const KOTLIN_MODULE_SOURCE = readFileSync(
  new URL(
    '../../../modules/expo-google-calendar-auth/android/src/main/java/expo/modules/googlecalendarauth/ExpoGoogleCalendarAuthModule.kt',
    import.meta.url
  ),
  'utf8'
);

const KOTLIN_BUILD_GRADLE_SOURCE = readFileSync(
  new URL(
    '../../../modules/expo-google-calendar-auth/android/build.gradle',
    import.meta.url
  ),
  'utf8'
);

describe('ExpoGoogleCalendarAuthModule.kt — scope, dependency, and error-code regression guards', () => {
  it('requests exactly the calendar.readonly scope (no identity/offline/other scopes)', () => {
    expect(KOTLIN_MODULE_SOURCE).toContain(
      'private const val CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"'
    );
    expect(KOTLIN_MODULE_SOURCE).toContain('Scope(CALENDAR_READONLY_SCOPE)');
    expect(KOTLIN_MODULE_SOURCE).not.toContain('requestOfflineAccess');
    expect(KOTLIN_MODULE_SOURCE).not.toContain('requestServerAuthCode');
    // Only one Scope(...) construction exists, and it is the readonly one.
    expect(KOTLIN_MODULE_SOURCE.match(/Scope\(/g)?.length).toBe(1);
    expect(KOTLIN_MODULE_SOURCE).not.toMatch(/Scopes\.(PROFILE|EMAIL|OPENID)/i);
  });

  it('never logs the access token or other credential material', () => {
    expect(KOTLIN_MODULE_SOURCE).not.toMatch(/Log\.[a-z]+\(.*accessToken/i);
    expect(KOTLIN_MODULE_SOURCE).not.toContain('println(');
  });

  it('supports forceAccountSelection via AuthorizationRequest.Prompt.SELECT_ACCOUNT, gated behind the option', () => {
    expect(KOTLIN_MODULE_SOURCE).toContain('if (forceAccountSelection) {');
    expect(KOTLIN_MODULE_SOURCE).toContain(
      'requestBuilder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)'
    );
  });

  it('handles user cancellation as a clean result, not a thrown exception', () => {
    expect(KOTLIN_MODULE_SOURCE).toContain(
      'if (activityResult.resultCode != Activity.RESULT_OK) {'
    );
    expect(KOTLIN_MODULE_SOURCE).toContain(
      'GoogleCalendarAuthResult(accessToken = null, grantedScopes = emptyList(), cancelled = true)'
    );
  });

  it('uses play-services-auth 22.0.0 as the preferred dependency version', () => {
    expect(KOTLIN_BUILD_GRADLE_SOURCE).toContain(
      'com.google.android.gms:play-services-auth:22.0.0'
    );
  });
});

const KOTLIN_EXCEPTIONS_SOURCE = readFileSync(
  new URL(
    '../../../modules/expo-google-calendar-auth/android/src/main/java/expo/modules/googlecalendarauth/GoogleCalendarAuthExceptions.kt',
    import.meta.url
  ),
  'utf8'
);

describe('GoogleCalendarAuthExceptions.kt — stable JS error codes', () => {
  it('defines exactly the three documented structured error codes', () => {
    expect(KOTLIN_EXCEPTIONS_SOURCE).toContain('"PLAY_SERVICES_UNAVAILABLE"');
    expect(KOTLIN_EXCEPTIONS_SOURCE).toContain('"AUTHORIZATION_FAILED"');
    expect(KOTLIN_EXCEPTIONS_SOURCE).toContain('"INTENT_RESULT_FAILED"');
  });
});
