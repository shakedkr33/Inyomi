package expo.modules.googlecalendarauth

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.Serializable

/**
 * JS-supplied options for `authorizeGoogleCalendar`.
 *
 * `forceAccountSelection` maps to `AuthorizationRequest.Prompt.SELECT_ACCOUNT`.
 * It defaults to false and is NOT used by the normal Calendar import flow.
 * It exists so a future "change Google account" feature can force the
 * account picker without requiring another native module change.
 */
internal class GoogleCalendarAuthorizeOptions : Record, Serializable {
  @Field
  val forceAccountSelection: Boolean = false
}

/**
 * JS-facing result of `authorizeGoogleCalendar`.
 *
 * - Success: `accessToken` is a non-null short-lived Google access token,
 *   `grantedScopes` lists the scopes the user actually granted, `cancelled`
 *   is false.
 * - Cancellation: `accessToken` is null, `grantedScopes` is empty,
 *   `cancelled` is true. This is a normal outcome, not an error.
 * - Failure: the async function rejects instead of resolving with this type
 *   (see GoogleCalendarAuthExceptions.kt for the structured error codes).
 */
internal class GoogleCalendarAuthResult(
  @Field val accessToken: String? = null,
  @Field val grantedScopes: List<String> = emptyList(),
  @Field val cancelled: Boolean = false
) : Record
