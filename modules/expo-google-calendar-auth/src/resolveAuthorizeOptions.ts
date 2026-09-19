/**
 * resolveAuthorizeOptions.ts — pure, RN-free option-defaulting logic for
 * expo-google-calendar-auth.
 *
 * Extracted out of index.ts so this logic is unit-testable with plain
 * `bun test`. index.ts transitively imports 'expo-modules-core', which
 * imports 'react-native', which crashes under `bun test` because this
 * project has no RN preset configured for the test runner — see
 * lib/services/googleOAuthClient.ts's file-level comment for the same
 * documented pattern (pure logic extracted to an RN-free file; the
 * RN-touching wrapper stays in index.ts and is exercised only at runtime).
 */

export type GoogleCalendarAuthorizeOptionsInput = {
  /**
   * Forces the native Google account picker to appear even if a default
   * account already exists (maps to
   * `AuthorizationRequest.Prompt.SELECT_ACCOUNT` natively). Defaults to
   * false. The normal Google Calendar import flow must NOT set this to
   * true — it exists only so a future "change Google account" feature can
   * be added without another native module migration.
   */
  forceAccountSelection?: boolean;
};

export type ResolvedGoogleCalendarAuthorizeOptions = {
  forceAccountSelection: boolean;
};

/**
 * Fills in defaults for authorizeGoogleCalendar()'s options parameter.
 *
 * forceAccountSelection defaults to false — the normal Google Calendar
 * import flow must never force the native account picker. This option
 * exists only so a future "change Google account" feature can pass `true`
 * without requiring another native module change.
 */
export function resolveAuthorizeOptions(
  options: GoogleCalendarAuthorizeOptionsInput | undefined
): ResolvedGoogleCalendarAuthorizeOptions {
  return {
    forceAccountSelection: options?.forceAccountSelection ?? false,
  };
}
