/**
 * expo-google-calendar-auth — local Expo Module (Android only).
 *
 * Wraps Google Identity Services' native AuthorizationClient to obtain a
 * read-only Google Calendar access token, replacing the browser/Custom-URI
 * OAuth flow on Android. This module has NO iOS implementation — iOS
 * continues to use the existing expo-auth-session browser Authorization
 * Code + PKCE flow (see lib/hooks/useGoogleCalendarAuth.ts). Callers must
 * only invoke this module on Android.
 *
 * Security contract:
 * - Only calendar.readonly is ever requested by the native layer.
 * - No offline access, no server auth code, no client secret.
 * - The returned accessToken must be held by the caller in memory only
 *   (React state) — this module does not persist anything itself.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  type GoogleCalendarAuthorizeOptionsInput,
  resolveAuthorizeOptions,
} from './resolveAuthorizeOptions';

export type GoogleCalendarAuthorizeOptions =
  GoogleCalendarAuthorizeOptionsInput;

export type GoogleCalendarAuthResult = {
  /** Short-lived Google access token, or null when cancelled. */
  accessToken: string | null;
  /** Scopes actually granted by the user; empty when cancelled. */
  grantedScopes: string[];
  /** True when the user cancelled the native consent UI. Not an error. */
  cancelled: boolean;
};

type ExpoGoogleCalendarAuthNativeModule = {
  authorizeGoogleCalendar(
    options: Required<GoogleCalendarAuthorizeOptions>
  ): Promise<GoogleCalendarAuthResult>;
};

// requireOptionalNativeModule (not requireNativeModule) so that importing
// this file never throws on a platform without a native implementation
// (iOS, web). Only calling authorizeGoogleCalendar() on such a platform
// throws — matching how callers already gate this module behind
// Platform.OS === 'android'.
const nativeModule =
  requireOptionalNativeModule<ExpoGoogleCalendarAuthNativeModule>(
    'ExpoGoogleCalendarAuth'
  );

/**
 * Authorize read-only access to Google Calendar via Android's native
 * AuthorizationClient. Android only.
 *
 * @throws Error if called on a platform with no native implementation
 * (e.g. iOS, web) — callers must gate calls behind `Platform.OS === 'android'`.
 * @throws native structured errors (Promise rejection) for real
 * authorization failures — see the module's Kotlin implementation for the
 * exact error codes (e.g. "PLAY_SERVICES_UNAVAILABLE", "AUTHORIZATION_FAILED",
 * "INTENT_RESULT_FAILED").
 */
export async function authorizeGoogleCalendar(
  options?: GoogleCalendarAuthorizeOptions
): Promise<GoogleCalendarAuthResult> {
  if (!nativeModule) {
    throw new Error(
      'ExpoGoogleCalendarAuth native module is not available on this platform.'
    );
  }
  return nativeModule.authorizeGoogleCalendar(resolveAuthorizeOptions(options));
}
