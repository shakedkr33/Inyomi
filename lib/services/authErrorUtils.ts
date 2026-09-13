/**
 * Phone-auth error classification and Hebrew copy helpers.
 *
 * Kept as pure functions so they can be unit-tested independently of React Native.
 * Import this module in the verify screen instead of inlining the logic.
 */

export type PhoneAuthErrorKind =
  | 'invalid_code' // wrong / expired / already-used OTP
  | 'network_error' // connectivity problem
  | 'unknown_error'; // anything else

/**
 * Classify a thrown error from @convex-dev/auth signIn into one of the three
 * known categories.  Works on Error instances and plain strings.
 */
export function classifyPhoneAuthError(err: unknown): PhoneAuthErrorKind {
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();

  if (
    msg.includes('could not verify') ||
    msg.includes('invalid') ||
    msg.includes('incorrect') ||
    msg.includes('wrong') ||
    msg.includes('expired') ||
    msg.includes('already used') ||
    msg.includes('used code')
  ) {
    return 'invalid_code';
  }

  if (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('connection')
  ) {
    return 'network_error';
  }

  return 'unknown_error';
}

/**
 * Map an auth error to human-readable Hebrew copy.
 *
 * Two buckets only:
 *  • invalid/expired/used OTP  → tell the user the code is wrong / expired
 *  • everything else           → calm generic "try again in a moment"
 *
 * Neither message leaks Convex internals, request IDs, or stack traces.
 * All copy is gender-inclusive.
 */
export function mapPhoneAuthError(err: unknown): string {
  const kind = classifyPhoneAuthError(err);
  if (kind === 'invalid_code') {
    return 'הקוד לא נכון. אפשר לבדוק ולנסות שוב.';
  }
  return 'לא הצלחנו לאמת את הקוד כרגע. אפשר לנסות שוב בעוד רגע.';
}
