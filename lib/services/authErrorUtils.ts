/**
 * Phone-auth error classification and Hebrew copy helpers.
 *
 * Kept as pure functions so they can be unit-tested independently of React Native.
 * Import this module in the verify screen instead of inlining the logic.
 */

export type PhoneAuthErrorKind =
  | 'invalid_code' // wrong / expired / already-used OTP
  | 'network_error' // connectivity problem
  | 'rate_limited' // retry only after the server permits it
  | 'unknown_error'; // anything else

/**
 * Classify a thrown error from @convex-dev/auth signIn into one of the known
 * categories.  Works on Error instances and plain strings.
 */
export function classifyPhoneAuthError(err: unknown): PhoneAuthErrorKind {
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();

  // Classify connectivity/limits before code errors. "Invalid" alone could
  // describe a server configuration or session failure, not an entered OTP.
  if (/\b(network|fetch|connection|offline)\b/.test(msg))
    return 'network_error';
  if (/too many (?:failed )?(?:attempts|requests)|rate[ -]?limit/.test(msg)) {
    return 'rate_limited';
  }
  if (
    /\bcould not verify code\b/.test(msg) ||
    /\b(?:invalid|incorrect|wrong|expired|used) (?:verification |otp )?code\b/.test(
      msg
    ) ||
    /\bcode (?:has )?(?:expired|already used)\b/.test(msg)
  )
    return 'invalid_code';

  return 'unknown_error';
}

/**
 * Map an auth error to human-readable Hebrew copy.
 *
 * Separate invalid codes, connectivity failures, and unknown failures.
 * Messages never expose Convex internals, request IDs, or stack traces.
 * All copy is gender-inclusive.
 */
export function mapPhoneAuthError(err: unknown): string {
  const kind = classifyPhoneAuthError(err);
  if (kind === 'invalid_code') {
    return 'הקוד שהוזן אינו תקין או שפג תוקפו. אפשר לנסות שוב.';
  }
  if (kind === 'rate_limited')
    return 'בוצעו ניסיונות רבים מדי. אפשר לנסות שוב בעוד זמן מה.';
  if (kind === 'network_error')
    return 'אין חיבור לאינטרנט. כדאי לבדוק את החיבור ולנסות שוב.';
  return 'לא הצלחנו לאמת את הקוד כרגע. אפשר לנסות שוב בעוד רגע.';
}

export function mapOtpSendError(err: unknown): string {
  const kind = classifyPhoneAuthError(err);
  if (kind === 'rate_limited') {
    return 'בוצעו ניסיונות רבים מדי. אפשר לנסות שוב בעוד זמן מה.';
  }
  if (kind === 'network_error') {
    return 'אין חיבור לאינטרנט. כדאי לבדוק את החיבור ולנסות שוב.';
  }
  return 'לא הצלחנו לשלוח קוד כרגע. אפשר לנסות שוב בעוד רגע.';
}
