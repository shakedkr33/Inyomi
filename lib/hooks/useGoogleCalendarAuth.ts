/**
 * useGoogleCalendarAuth — Google Calendar read-only authorization hook.
 *
 * Implements an OAuth 2.0 Authorization Code + PKCE flow using the low-level
 * expo-auth-session APIs. It is intentionally scoped to authorization only:
 * it obtains a short-lived access token for calendar.readonly and hands it
 * to the caller. It does not fetch calendars, normalize events, or call Convex.
 *
 * Security contract:
 * - Only the calendar.readonly scope is requested. No identity scopes.
 * - The client ID is read and validated exclusively at hook call-time from
 *   a platform-specific env var — EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID on iOS,
 *   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID on Android (see
 *   lib/services/googleOAuthClient.ts). Neither is ever hardcoded, and
 *   selection never falls back across platforms.
 * - The redirect URI is derived from the validated client ID (iOS) or the
 *   app's package name (Android — Google's Android OAuth client type has
 *   no redirect-URI field; see googleOAuthClient.ts for why) inside the
 *   hook. No Google URI is ever constructed from invalid or absent
 *   configuration.
 * - The access token lives in React state only; it is never written to
 *   AsyncStorage, SecureStore, module globals, analytics, or any Convex function.
 * - The authorization code and PKCE verifier are used only for the token
 *   exchange and then discarded. Neither is stored or logged.
 * - The refresh token returned by Google (if any) is immediately discarded.
 * - No Gmail address or user identity is requested or retained.
 * - No console.log / console.error call involves OAuth parameters.
 *
 * State machine:
 *   idle → authorizing → exchanging → authorized
 *                 ↓           ↓
 *               denied      error
 *   Any state → idle (via clearAuthorization or silent cancel/dismiss)
 *
 * Android platform note:
 * Android's ACTIVE authorization path uses the native
 * expo-google-calendar-auth module (Google Identity Services'
 * AuthorizationClient) instead of the browser/Custom-URI PKCE flow below —
 * see startAndroidAuthorization(). The browser/PKCE code in this file is
 * preserved unchanged and stays reachable (useAuthRequest is still called
 * unconditionally, per Rules of Hooks) so it can be restored as a rollback
 * if the native AuthorizationClient flow fails physical-device QA. iOS is
 * completely unaffected and continues to use the browser/PKCE flow below
 * as its only path.
 */

import {
  CodeChallengeMethod,
  exchangeCodeAsync,
  makeRedirectUri,
  Prompt,
  ResponseType,
  useAuthRequest,
} from 'expo-auth-session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  deriveGoogleOAuthNativeScheme,
  resolvePlatformGoogleOAuthClientId,
} from '@/lib/services/googleOAuthClient';
import {
  authorizeGoogleCalendar,
  type GoogleCalendarAuthResult,
} from '@/modules/expo-google-calendar-auth/src';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Static Google OAuth 2.0 discovery endpoints.
 * Using static values avoids a network round-trip to fetch the discovery doc
 * and makes the endpoints auditable without inspecting network traffic.
 */
const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
} as const;

const CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';

/**
 * Inert placeholder values used by useAuthRequest when the real configuration
 * is absent. These strings are never sent to any authorization server:
 * passing null discovery to useAuthRequest prevents the AuthRequest from
 * loading, so promptAsync cannot open a browser even if the screen renders.
 */
const INERT_CLIENT_ID = 'not-configured';
const INERT_REDIRECT_URI = 'inyomi://oauth-not-configured';

// ── Configuration helpers ────────────────────────────────────────────────────
//
// Client-id validation, platform selection, and native-scheme derivation are
// pure functions that live in lib/services/googleOAuthClient.ts (kept out of
// this file because it must stay unit-testable without a react-native
// runtime). This file only wires those pure results into `makeRedirectUri`.

// ── Public types ─────────────────────────────────────────────────────────────

export type GoogleCalendarAuthStatus =
  | 'idle'
  | 'authorizing'
  | 'exchanging'
  | 'authorized'
  | 'denied'
  | 'error';

export type UseGoogleCalendarAuthResult = {
  status: GoogleCalendarAuthStatus;
  /** In-memory access token; null in every state except 'authorized'. */
  accessToken: string | null;
  /** Localised Hebrew error message; null unless status is 'denied' or 'error'. */
  errorMessage: string | null;
  /** Begin the OAuth flow. Safe to call only when status is 'idle'. */
  startAuthorization: () => Promise<void>;
  /** Reset to idle and discard the in-memory token and any error state. */
  clearAuthorization: () => void;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Runs the Google Calendar read-only Authorization Code + PKCE flow and
 * surfaces the result as a simple status machine.
 *
 * Call startAuthorization() to begin the flow. On success, status becomes
 * 'authorized' and accessToken holds the short-lived Google access token.
 * Call clearAuthorization() to reset the hook to idle and discard the token.
 */
export function useGoogleCalendarAuth(): UseGoogleCalendarAuthResult {
  const [status, setStatus] = useState<GoogleCalendarAuthStatus>('idle');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guard: do not set state on an unmounted component.
  const isMounted = useRef(true);
  // Guard: prevent triggering a second token exchange for the same auth code.
  const isExchanging = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      // Signal all in-flight async work to discard their results.
      isMounted.current = false;
      isExchanging.current = false;
      // React state (accessToken, errorMessage) is GC'd with the component.
      // They are never persisted outside React state.
    };
  }, []);

  // ── Configuration validation ───────────────────────────────────────────────
  //
  // Validate the platform-specific client ID on every render call.
  // process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID / _ANDROID_CLIENT_ID are
  // inlined at build time, so the result is effectively constant across
  // renders. Platform.OS is likewise constant for the life of the app.
  //
  // Redirect URI derivation is intentionally deferred to this point (inside
  // the hook) so that no Google URI is ever constructed from absent or
  // malformed configuration at module initialization time.

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const clientId = resolvePlatformGoogleOAuthClientId(platform, {
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });
  const redirectUri =
    clientId !== null
      ? makeRedirectUri({
          native: deriveGoogleOAuthNativeScheme(platform, clientId),
        })
      : null;
  const hasValidConfig = clientId !== null && redirectUri !== null;

  // ── Auth request setup ─────────────────────────────────────────────────────
  //
  // When configuration is absent (hasValidConfig === false):
  // - INERT_CLIENT_ID / INERT_REDIRECT_URI are placeholder strings that are
  //   never sent to any server.
  // - Passing null as the discovery document prevents the AuthRequest from
  //   loading, so request === null and promptAsync cannot open a browser.
  //
  // When configuration is valid:
  // - The real clientId and derivedRedirectUri are used.
  // - GOOGLE_DISCOVERY enables the request to load and promptAsync to run.

  const [request, , promptAsync] = useAuthRequest(
    {
      clientId: clientId ?? INERT_CLIENT_ID,
      responseType: ResponseType.Code,
      redirectUri: redirectUri ?? INERT_REDIRECT_URI,
      scopes: [CALENDAR_READONLY],
      usePKCE: true,
      codeChallengeMethod: CodeChallengeMethod.S256,
      prompt: Prompt.Consent,
    },
    hasValidConfig ? GOOGLE_DISCOVERY : null
  );

  const clearAuthorization = useCallback((): void => {
    isExchanging.current = false;
    setStatus('idle');
    setAccessToken(null);
    setErrorMessage(null);
  }, []);

  // ── Android native authorization (ACTIVE path on Android) ──────────────────
  //
  // Uses Google Identity Services' AuthorizationClient via the local
  // expo-google-calendar-auth module instead of the browser/PKCE flow.
  // Never requests forceAccountSelection — that option exists in the native
  // API only so a future "change Google account" feature can use it without
  // another native migration; the normal import flow always omits it.
  //
  // This does not need clientId/redirectUri: AuthorizationClient resolves
  // the Google Cloud OAuth client via the app's package name + signing
  // SHA-1, not a client ID passed at runtime.
  const startAndroidAuthorization = useCallback(async (): Promise<void> => {
    if (isMounted.current) {
      setStatus('authorizing');
      setErrorMessage(null);
      setAccessToken(null);
    }

    let result: GoogleCalendarAuthResult;
    try {
      result = await authorizeGoogleCalendar();
    } catch {
      if (isMounted.current) {
        setStatus('error');
        setErrorMessage('לא ניתן להשלים את ההרשאה. נסי שוב.');
        setAccessToken(null);
      }
      return;
    }

    if (!isMounted.current) return;

    // User cancellation is a clean outcome, not an error.
    if (result.cancelled) {
      setStatus('idle');
      setAccessToken(null);
      return;
    }

    if (!result.accessToken) {
      setStatus('error');
      setErrorMessage('לא ניתן להשלים את ההרשאה. נסי שוב.');
      setAccessToken(null);
      return;
    }

    setAccessToken(result.accessToken);
    setStatus('authorized');
  }, []);

  const startAuthorization = useCallback(async (): Promise<void> => {
    // Android's ACTIVE path never touches clientId/redirectUri/useAuthRequest
    // below — see the Android platform note in the file-level comment.
    if (Platform.OS === 'android') {
      await startAndroidAuthorization();
      return;
    }

    // Configuration gate: fail with a generic message if the client ID is
    // missing, empty, or structurally inconsistent. Do not expose variable
    // names, client ID values, or redirect URIs in the user-facing message.
    if (!hasValidConfig || clientId === null || redirectUri === null) {
      if (isMounted.current) {
        setStatus('error');
        setErrorMessage('לא ניתן להשלים את ההרשאה. נסי שוב.');
      }
      return;
    }

    // The AuthRequest must finish loading before promptAsync is usable.
    // When hasValidConfig is false the request is null (discovery is null),
    // so this guard is a secondary safety net.
    if (!request) return;

    if (isMounted.current) {
      setStatus('authorizing');
      setErrorMessage(null);
      setAccessToken(null);
    }

    let result;
    try {
      result = await promptAsync();
    } catch {
      if (isMounted.current) {
        setStatus('error');
        setErrorMessage('לא ניתן להשלים את ההרשאה. נסי שוב.');
      }
      return;
    }

    if (!isMounted.current) return;

    // Cancel / dismiss: return silently to idle without any error message.
    if (result.type === 'cancel' || result.type === 'dismiss') {
      setStatus('idle');
      setAccessToken(null);
      return;
    }

    // Error result from the authorization server.
    if (result.type === 'error') {
      const serverError = result.params?.error;
      if (serverError === 'access_denied') {
        setStatus('denied');
        setErrorMessage('לא ניתנה הרשאה לגישה ליומן. ניתן לנסות שוב.');
      } else {
        setStatus('error');
        setErrorMessage('לא ניתן להשלים את ההרשאה. נסי שוב.');
      }
      setAccessToken(null);
      return;
    }

    // Unexpected non-success result type.
    if (result.type !== 'success') {
      setStatus('idle');
      return;
    }

    const authCode = result.params?.code;
    if (!authCode) {
      setStatus('error');
      setErrorMessage('לא ניתן להשלים את ההרשאה. נסי שוב.');
      setAccessToken(null);
      return;
    }

    // Prevent duplicate exchanges if this callback somehow fires twice.
    if (isExchanging.current) return;
    isExchanging.current = true;

    setStatus('exchanging');

    try {
      const codeVerifier = request.codeVerifier;
      const tokenResponse = await exchangeCodeAsync(
        {
          // Use the same clientId and redirectUri that were used in the
          // authorization request — both come from the same validated config.
          clientId,
          code: authCode,
          redirectUri,
          // Pass the PKCE verifier so the authorization server can validate
          // the code challenge that was included in the authorization request.
          extraParams: codeVerifier
            ? { code_verifier: codeVerifier }
            : undefined,
        },
        { tokenEndpoint: GOOGLE_DISCOVERY.tokenEndpoint }
      );

      if (!isMounted.current) return;

      // Retain only the access token. Discard the full TokenResponse object,
      // the refresh token, expiry metadata, and any other OAuth response fields.
      const token = tokenResponse.accessToken;
      setAccessToken(token);
      setStatus('authorized');
    } catch {
      if (!isMounted.current) return;
      setStatus('error');
      setErrorMessage('לא ניתן להשלים את ההרשאה. נסי שוב.');
      setAccessToken(null);
    } finally {
      isExchanging.current = false;
    }
  }, [
    startAndroidAuthorization,
    request,
    promptAsync,
    hasValidConfig,
    clientId,
    redirectUri,
  ]);

  return {
    status,
    accessToken,
    errorMessage,
    startAuthorization,
    clearAuthorization,
  };
}
