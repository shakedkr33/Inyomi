import type { ConvexReactClientOptions } from 'convex/react';

type ClientLogger = Exclude<
  ConvexReactClientOptions['logger'],
  boolean | undefined
>;
type Output = Pick<Console, 'log' | 'warn' | 'error'>;

// Match only the SDK's action-error envelope and this exact expected rejection.
// Unknown/new formats stay at error level. Never reuse broad UI classification
// to decide which diagnostics may be downgraded.
function isExpectedOtpRejection(args: unknown[]): boolean {
  if (args.length !== 1 || typeof args[0] !== 'string') return false;
  return /^\[CONVEX A\(auth:signIn\)\] (?:\[Request ID: [a-zA-Z0-9-]+\] Server Error\r?\n)?Uncaught Error: Could not verify code(?:\r?\n[ \t]+at [^\r\n]+)*\s*$/.test(
    args[0]
  );
}

/** Install only in development via the public Convex client logger option. */
export function createOtpDevelopmentLogger(
  isVerifying: () => boolean,
  output: Output = console
): ClientLogger {
  return {
    // The root client does not enable verbose logging; retain that default.
    logVerbose() {},
    log: (...args: unknown[]) => output.log(...args),
    warn: (...args: unknown[]) => output.warn(...args),
    error: (...args: unknown[]) => {
      if (isVerifying() && isExpectedOtpRejection(args)) {
        output.log(
          '[InYomi auth] OTP verification rejected; retry is available.'
        );
      } else {
        output.error(...args);
      }
    },
  };
}
