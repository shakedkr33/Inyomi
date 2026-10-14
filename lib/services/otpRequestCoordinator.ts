export const OTP_COOLDOWN_MS = 60_000;
export type OtpOperation = 'send' | 'verify';

/** One in-memory transport lock across both auth screens. No OTPs are stored. */
export function createOtpRequestCoordinator(now = Date.now) {
  let activeOperation: OtpOperation | null = null;
  const deadlines = new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => activeOperation !== null,
    operation: () => activeOperation,
    remaining(phone: string) {
      return Math.max(
        0,
        Math.ceil(((deadlines.get(phone) ?? 0) - now()) / 1000)
      );
    },
    // A cold-start verification screen has no persisted send timestamp. Keep
    // the existing conservative 60s wait, without sending anything automatically.
    ensureCooldown(phone: string) {
      if (!deadlines.has(phone)) deadlines.set(phone, now() + OTP_COOLDOWN_MS);
    },
    begin(phone: string, operation: OtpOperation) {
      if (
        activeOperation !== null ||
        (operation === 'send' && this.remaining(phone) > 0)
      )
        return null;
      activeOperation = operation;
      notify();
      let finished = false;
      return (succeeded: boolean) => {
        if (finished) return;
        finished = true;
        if (operation === 'send' && succeeded) {
          deadlines.set(phone, now() + OTP_COOLDOWN_MS);
        }
        activeOperation = null;
        notify();
      };
    },
  };
}
export const otpRequestCoordinator = createOtpRequestCoordinator();
