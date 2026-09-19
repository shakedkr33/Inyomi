package expo.modules.googlecalendarauth

import android.content.Context
import android.content.Intent
import android.content.IntentSender
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

/**
 * Minimal, side-effect-free input passed to [GoogleAuthorizationContract]'s
 * launcher. Deliberately does NOT carry the [IntentSender] returned by
 * AuthorizationClient: [IntentSender] (like [android.app.PendingIntent]) is
 * `Parcelable`, not `Serializable`, and expo-modules-core's activity-result
 * registry may attempt real Java serialization of the launch input if the
 * host Activity is destroyed and recreated while a request is in flight
 * (e.g. on rotation) — see `AppContextActivityResultRegistry.persistInstanceState`.
 * Including a non-Serializable field here would risk a
 * `NotSerializableException` crash in that case.
 *
 * The pending [IntentSender] is instead handed to the contract out-of-band
 * via [GoogleAuthorizationContract.pendingIntentSender], set immediately
 * before each `launch()` call and consumed exactly once by [GoogleAuthorizationContract.createIntent].
 */
internal data class GoogleAuthorizationLaunchInput(val requestId: Int = 0) : Serializable

/**
 * Raw result of the native Google consent Activity: the Android
 * `resultCode` and the returned `Intent` (if any). Interpreting this into
 * an `AuthorizationResult` (via
 * `AuthorizationClient.getAuthorizationResultFromIntent`) is left to the
 * caller ([ExpoGoogleCalendarAuthModule]) so all AuthorizationClient error
 * handling stays in one place instead of being split across contract and
 * module.
 */
internal data class GoogleAuthorizationActivityResult(
  val resultCode: Int,
  val intent: Intent?
)

/**
 * Bridges Google Identity Services' `PendingIntent`-based AuthorizationClient
 * consent flow into expo-modules-core's Serializable-input activity-result
 * contract API, by delegating to androidx's
 * [ActivityResultContracts.StartIntentSenderForResult].
 */
internal class GoogleAuthorizationContract :
  AppContextActivityResultContract<GoogleAuthorizationLaunchInput, GoogleAuthorizationActivityResult> {

  /**
   * Set by [ExpoGoogleCalendarAuthModule] immediately before calling
   * `authorizationLauncher.launch(...)`, and consumed exactly once by
   * [createIntent]. See [GoogleAuthorizationLaunchInput] for why this is
   * not passed through the Serializable launch input instead.
   */
  @Volatile
  var pendingIntentSender: IntentSender? = null

  override fun createIntent(context: Context, input: GoogleAuthorizationLaunchInput): Intent {
    val intentSender = requireNotNull(pendingIntentSender) {
      "GoogleAuthorizationContract.createIntent was called without a pending IntentSender set."
    }
    // Consume once: never leave a stale IntentSender referenced after use.
    pendingIntentSender = null

    val intentSenderRequest = IntentSenderRequest.Builder(intentSender).build()
    return ActivityResultContracts.StartIntentSenderForResult()
      .createIntent(context, intentSenderRequest)
  }

  override fun parseResult(
    input: GoogleAuthorizationLaunchInput,
    resultCode: Int,
    intent: Intent?
  ): GoogleAuthorizationActivityResult = GoogleAuthorizationActivityResult(resultCode, intent)
}
