package expo.modules.googlecalendarauth

import android.app.Activity
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val MODULE_NAME = "ExpoGoogleCalendarAuth"

// GoogleSignInStatusCodes.SIGN_IN_CANCELLED (legacy cancel code some Play
// Services builds still report); inlined to avoid importing the legacy Sign-In API.
private const val SIGN_IN_CANCELLED = 12501

/**
 * The ONLY scope this module ever requests. Do not add identity, profile,
 * offline-access, or any other scope here — see AGENTS.md and the approved
 * implementation plan for why this stays intentionally narrow.
 */
private const val CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"

/**
 * ExpoGoogleCalendarAuth — Android-only native module wrapping Google
 * Identity Services' AuthorizationClient for read-only Google Calendar
 * access.
 *
 * This module has NO iOS implementation. iOS continues to use the existing
 * expo-auth-session browser Authorization Code + PKCE flow (see
 * lib/hooks/useGoogleCalendarAuth.ts). Both platforms converge on the same
 * plain `{ accessToken, grantedScopes, cancelled }` shape and the same
 * downstream Calendar import pipeline.
 *
 * Security contract (mirrors the existing iOS flow's documented contract):
 * - Only `calendar.readonly` is requested. No identity scopes, no offline
 *   access, no server auth code, no client secret.
 * - The access token is returned to JS and held in React state only by the
 *   caller; this module never persists it (no SecureStore/AsyncStorage/DB).
 * - Never logs accessToken, authorization codes, or any other credential
 *   material. Structured exceptions below carry only generic messages.
 */
class ExpoGoogleCalendarAuthModule : Module() {
  private val authorizationContract = GoogleAuthorizationContract()

  private lateinit var authorizationLauncher: AppContextActivityResultLauncher<
    GoogleAuthorizationLaunchInput,
    GoogleAuthorizationActivityResult
    >

  override fun definition() = ModuleDefinition {
    Name(MODULE_NAME)

    AsyncFunction("authorizeGoogleCalendar") Coroutine { options: GoogleCalendarAuthorizeOptions ->
      authorize(options.forceAccountSelection)
    }

    RegisterActivityContracts {
      authorizationLauncher = registerForActivityResult(authorizationContract)
    }
  }

  /**
   * Runs one authorization attempt end-to-end:
   * 1. Already-authorized (previously granted scopes): AuthorizationClient
   *    resolves immediately with an access token, no UI is shown.
   * 2. First-time / re-consent needed: AuthorizationClient returns a
   *    resolution (PendingIntent). We launch it, then parse the returned
   *    Intent for the final AuthorizationResult.
   * 3. User cancels the consent UI: returned as a clean
   *    `{ cancelled: true }` result, never as a thrown exception.
   * 4. Any other failure: thrown as a structured CodedException so the
   *    Promise rejects with a stable code (see GoogleCalendarAuthExceptions.kt).
   */
  private suspend fun authorize(forceAccountSelection: Boolean): GoogleCalendarAuthResult {
    val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()

    ensurePlayServicesAvailable(activity)

    val requestBuilder = AuthorizationRequest.builder()
      .setRequestedScopes(listOf(Scope(CALENDAR_READONLY_SCOPE)))
    if (forceAccountSelection) {
      requestBuilder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
    }
    val request = requestBuilder.build()

    val authorizationResult = try {
      awaitAuthorization(activity, request)
    } catch (e: Exception) {
      // TEMPORARY diagnostics: exception class + ApiException status code only.
      // Never log the message, token, or any credential material.
      Log.w(
        MODULE_NAME,
        "authorize() failed: exception=${e.javaClass.simpleName} statusCode=${(e as? ApiException)?.statusCode}"
      )
      throw AuthorizationFailedException(e)
    }

    // Already-authorized path: no UI needed, token returned directly.
    if (!authorizationResult.hasResolution()) {
      return authorizationResult.toModuleResult()
    }

    // First-time / re-consent path: launch the native Google consent UI.
    val pendingIntent = authorizationResult.pendingIntent
      ?: throw AuthorizationFailedException()

    authorizationContract.pendingIntentSender = pendingIntent.intentSender
    val activityResult = authorizationLauncher.launch(GoogleAuthorizationLaunchInput())

    val resultIntent = activityResult.intent

    // The registry reports a failure to even start the consent UI as
    // RESULT_CANCELED plus this extra. That is a real failure, not a user cancel.
    if (resultIntent?.hasExtra(StartIntentSenderForResult.EXTRA_SEND_INTENT_EXCEPTION) == true) {
      Log.w(
        MODULE_NAME,
        "consent launch failed: resultCode=${activityResult.resultCode} sendIntentException=true"
      )
      throw AuthorizationFailedException()
    }

    // Diagnostic only: never log the intent contents or any token.
    Log.i(
      MODULE_NAME,
      "consent result: resultCode=${activityResult.resultCode} hasIntent=${resultIntent != null}"
    )

    // No data at all: only a RESULT_CANCELED can be treated as user cancellation
    // (back button, dismiss). RESULT_OK without data is a real error.
    if (resultIntent == null) {
      if (activityResult.resultCode == Activity.RESULT_OK) {
        throw IntentResultFailedException()
      }
      return cancelledResult()
    }

    // Always ask Google for the real outcome instead of trusting `resultCode`
    // alone (this mirrors Google's documented sample, which parses the Intent
    // without checking resultCode). A genuine user cancel surfaces as an
    // ApiException with a CANCELED status; any other status is a real failure
    // (e.g. DEVELOPER_ERROR for a package/SHA-1 mismatch) and must not be
    // silently swallowed as a cancel.
    val finalResult = try {
      Identity.getAuthorizationClient(activity)
        .getAuthorizationResultFromIntent(resultIntent)
    } catch (e: ApiException) {
      Log.w(
        MODULE_NAME,
        "getAuthorizationResultFromIntent failed: statusCode=${e.statusCode} resultCode=${activityResult.resultCode}"
      )
      if (e.statusCode == CommonStatusCodes.CANCELED || e.statusCode == SIGN_IN_CANCELLED) {
        return cancelledResult()
      }
      throw IntentResultFailedException(e)
    } catch (e: Exception) {
      Log.w(
        MODULE_NAME,
        "getAuthorizationResultFromIntent failed: exception=${e.javaClass.simpleName} resultCode=${activityResult.resultCode}"
      )
      throw IntentResultFailedException(e)
    }

    return finalResult.toModuleResult()
  }

  private fun cancelledResult(): GoogleCalendarAuthResult =
    GoogleCalendarAuthResult(accessToken = null, grantedScopes = emptyList(), cancelled = true)

  private fun ensurePlayServicesAvailable(activity: Activity) {
    val status = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity)
    if (status != ConnectionResult.SUCCESS) {
      throw PlayServicesUnavailableException()
    }
  }

  /**
   * Wraps AuthorizationClient's listener-based `authorize()` Task in a
   * suspend function. Deliberately implemented with a plain
   * suspendCancellableCoroutine instead of adding the
   * `kotlinx-coroutines-play-services` dependency, to keep this module's
   * dependency surface to exactly `play-services-auth`.
   */
  private suspend fun awaitAuthorization(
    activity: Activity,
    request: AuthorizationRequest
  ): AuthorizationResult = suspendCancellableCoroutine { continuation ->
    Identity.getAuthorizationClient(activity)
      .authorize(request)
      .addOnSuccessListener { result ->
        if (continuation.isActive) continuation.resume(result)
      }
      .addOnFailureListener { exception ->
        if (continuation.isActive) continuation.resumeWithException(exception)
      }
  }

  private fun AuthorizationResult.toModuleResult(): GoogleCalendarAuthResult =
    GoogleCalendarAuthResult(
      accessToken = accessToken,
      grantedScopes = grantedScopes.orEmpty(),
      cancelled = false
    )
}
