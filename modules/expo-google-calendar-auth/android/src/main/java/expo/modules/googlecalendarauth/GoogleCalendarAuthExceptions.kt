package expo.modules.googlecalendarauth

import expo.modules.kotlin.exception.CodedException

/**
 * Google Play Services is missing, disabled, or out of date on this
 * device, so AuthorizationClient cannot run.
 *
 * JS error code: "PLAY_SERVICES_UNAVAILABLE"
 */
internal class PlayServicesUnavailableException(cause: Throwable? = null) :
  CodedException(
    "PLAY_SERVICES_UNAVAILABLE",
    "Google Play Services is unavailable or out of date on this device.",
    cause
  )

/**
 * AuthorizationClient.authorize() failed — e.g. an ApiException from Google
 * Play Services, a Google Cloud configuration mismatch (wrong package name
 * or SHA-1), or a network error. Never includes credential/token data.
 *
 * JS error code: "AUTHORIZATION_FAILED"
 */
internal class AuthorizationFailedException(cause: Throwable? = null) :
  CodedException(
    "AUTHORIZATION_FAILED",
    "Google Calendar authorization failed.",
    cause
  )

/**
 * The consent Activity returned a result, but
 * AuthorizationClient.getAuthorizationResultFromIntent could not extract an
 * AuthorizationResult from it.
 *
 * JS error code: "INTENT_RESULT_FAILED"
 */
internal class IntentResultFailedException(cause: Throwable? = null) :
  CodedException(
    "INTENT_RESULT_FAILED",
    "Could not read the Google Calendar authorization result.",
    cause
  )
