/**
 * Apple Review demo-account provider routing.
 *
 * SECURITY (Pass 2 / P2-H03): the verify screen previously decided which
 * Convex Auth provider to call — 'apple-review' vs 'phone' — by hardcoding
 * BOTH the Apple Review demo phone number AND its fixed 6-digit OTP
 * literal directly in client code (a `phone === <demo phone> && digits ===
 * <fixed OTP>` check). That OTP is a real, reusable authentication secret: anyone who
 * inspected the shipped JS bundle could read it and sign in as the Apple
 * Review demo account, because the server (convex/auth.ts) validates the
 * SAME fixed phone+OTP pair against its APP_REVIEW_PHONE / APP_REVIEW_OTP
 * environment variables.
 *
 * FIX: provider routing now depends ONLY on the phone number, never on the
 * OTP. The phone number alone is not a secret — App Review can only ever
 * authenticate if the digits entered ALSO match the server's
 * APP_REVIEW_OTP env var (checked in convex/auth.ts's ConvexCredentials
 * 'apple-review' provider). If the user enters any other 6-digit code for
 * this phone, `signIn('apple-review', ...)` is still called, but the
 * server's authorize() returns null and sign-in fails — exactly like a
 * wrong OTP for normal phone auth. This function intentionally does NOT
 * import or reference the OTP value anywhere on the client.
 *
 * Recognizing the phone number itself (to route to 'apple-review' instead
 * of 'phone', and to avoid triggering a real Twilio SMS send for this
 * fixed demo number) is safe: it grants no access by itself, and the same
 * phone number is already visible in app/(auth)/sign-in.tsx and
 * lib/components/birthday/BirthdaySheetsProvider.tsx for the same reason.
 */

/** Phone number used by the Apple App Review demo account. Not a secret. */
export const APPLE_REVIEW_PHONE = '+972510000000';

/**
 * Returns true when the given phone number is the Apple Review demo
 * account's phone number — meaning the verify screen should call the
 * 'apple-review' Convex Auth provider instead of 'phone'.
 *
 * Deliberately takes NO code/OTP parameter: the OTP must never be known to
 * the client. The server is the only party that can decide whether a given
 * OTP is correct.
 */
export function shouldUseAppleReviewProvider(
  phone: string | null | undefined
): boolean {
  return phone === APPLE_REVIEW_PHONE;
}
