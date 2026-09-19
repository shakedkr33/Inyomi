/**
 * googleOAuthClient.ts — pure, RN-free Google OAuth client-id / redirect
 * resolution for the Google Calendar import flow.
 *
 * Extracted out of lib/hooks/useGoogleCalendarAuth.ts so this logic is
 * unit-testable with plain `bun test`. That hook file transitively imports
 * 'react-native' (via expo-auth-session), which crashes under `bun test`
 * because this project has no RN preset configured for the test runner —
 * see utils/revenueCatConfig.ts's documented comment for the same pattern
 * (pure logic extracted to an RN-free file; the RN-touching wrapper stays
 * in the hook/config file and is exercised only at runtime).
 *
 * ── Platform-aware client id selection ──────────────────────────────────
 * - iOS uses the existing, already-configured EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.
 * - Android uses the new EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID.
 * Selection never falls back across platforms: a missing/malformed
 * platform-specific client id resolves to `null` for THAT platform only,
 * so the flow always fails clearly (see useGoogleCalendarAuth's existing
 * "not configured" error state) instead of silently authorizing against
 * the wrong platform's OAuth client.
 *
 * ── Platform-aware native redirect scheme ───────────────────────────────
 * - iOS: Google's "iOS" OAuth client type ties its custom URI scheme
 *   redirect to the client id itself — reverse the client id's
 *   dot-separated components: "X.apps.googleusercontent.com" →
 *   "com.googleusercontent.apps.X:/oauthredirect". This is unchanged from
 *   the existing, working iOS flow.
 * - Android: Google's "Android" OAuth client type has NO redirect-URI field
 *   in the Cloud Console at all — it instead verifies the caller via
 *   package name + signing SHA-1. The redirect URI used by the
 *   system-browser Authorization Code flow must therefore be the app's own
 *   package-name custom URI scheme, NOT the reversed client id:
 *   "com.shakedkr.inyomi:/oauthredirect". This matches expo-auth-session's
 *   own default native redirect for Android
 *   (`${Application.applicationId}:/oauthredirect`) and Google's documented
 *   Android custom-scheme convention
 *   (developers.google.com/identity/protocols/oauth2/native-app).
 *
 * IMPORTANT — Google Cloud Console prerequisite this code cannot fix:
 * Google disabled the "Custom URI scheme" redirect method by default for
 * NEW Android OAuth clients (see Google's "Improving user safety in OAuth
 * flows..." developer blog post). A newly created Android client must have
 * "Custom URI scheme" explicitly enabled under "Advanced Settings" on that
 * client's Cloud Console configuration page, or every authorization
 * attempt will fail with "Custom URI scheme is not supported on Android"
 * or `redirect_uri_mismatch`, regardless of how correct this code is.
 */

export type GoogleOAuthPlatform = 'ios' | 'android';

const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/**
 * The app's Android package name (matches app.json `expo.android.package`
 * and android/app/src/main/AndroidManifest.xml's applicationId / manifest
 * package attribute). Kept as an explicit constant — like
 * GOOGLE_CLIENT_ID_SUFFIX above — rather than read from expo-constants at
 * runtime, so this pure module stays free of any RN/Expo module import.
 * Must be kept in sync with app.json if the Android package name ever
 * changes.
 */
export const ANDROID_PACKAGE_NAME = 'com.shakedkr.inyomi';

/**
 * Validate and return a trimmed Google OAuth client ID, or null.
 *
 * Accepts only a non-empty string ending in ".apps.googleusercontent.com".
 * A missing, non-string, empty, or structurally inconsistent value returns
 * null.
 */
export function resolveGoogleOAuthClientId(
  raw: string | undefined
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) return null;
  return trimmed;
}

export type GoogleOAuthClientIdEnv = {
  iosClientId: string | undefined;
  androidClientId: string | undefined;
};

/**
 * Select and validate the Google OAuth client ID for the given platform.
 *
 * Never falls back to the other platform's client id: if the
 * platform-specific env value is missing, empty, or malformed, this returns
 * null for that platform — it never substitutes the other platform's
 * client id.
 */
export function resolvePlatformGoogleOAuthClientId(
  platform: GoogleOAuthPlatform,
  env: GoogleOAuthClientIdEnv
): string | null {
  const raw = platform === 'ios' ? env.iosClientId : env.androidClientId;
  return resolveGoogleOAuthClientId(raw);
}

/**
 * Derive the native custom-URI-scheme redirect target for the given
 * platform and an already-validated client id. Returns the scheme string
 * to pass as `makeRedirectUri({ native })` — never a full URL, and never
 * derived from an unvalidated client id.
 */
export function deriveGoogleOAuthNativeScheme(
  platform: GoogleOAuthPlatform,
  clientId: string
): string {
  if (platform === 'android') {
    return `${ANDROID_PACKAGE_NAME}:/oauthredirect`;
  }
  const reversed = clientId.split('.').reverse().join('.');
  return `${reversed}:/oauthredirect`;
}
