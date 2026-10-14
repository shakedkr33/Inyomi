import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  type OtpOperation,
  otpRequestCoordinator,
} from '../services/otpRequestCoordinator';

/** Screen-local callback validity plus a shared non-cancellable transport lock. */
export function useOtpRequestScope(
  phone: string,
  verificationScreen = false,
  attemptKey = phone
) {
  const scope = useRef({ active: false, phone, attemptKey, generation: 0 });
  const [remaining, setRemaining] = useState(0);
  const busy = useSyncExternalStore(
    otpRequestCoordinator.subscribe,
    otpRequestCoordinator.snapshot,
    otpRequestCoordinator.snapshot
  );
  const invalidate = useCallback(() => {
    scope.current.active = false;
    scope.current.generation++;
  }, []);
  useFocusEffect(
    useCallback(() => {
      scope.current = {
        active: true,
        phone,
        attemptKey,
        generation: scope.current.generation + 1,
      };
      if (phone && verificationScreen)
        otpRequestCoordinator.ensureCooldown(phone);
      const update = () => setRemaining(otpRequestCoordinator.remaining(phone));
      update();
      const unsubscribe = otpRequestCoordinator.subscribe(update);
      const timer = setInterval(update, 1000);
      const subscription = AppState.addEventListener('change', update);
      return () => {
        invalidate();
        clearInterval(timer);
        unsubscribe();
        subscription.remove();
      };
    }, [phone, verificationScreen, attemptKey, invalidate])
  );

  const run = async <T>(
    operation: OtpOperation,
    request: () => Promise<T>,
    success: (result: T) => void,
    failure: (error: unknown) => void
  ) => {
    const started = scope.current;
    if (!started.active || started.phone !== phone || !phone) return;
    const finish = otpRequestCoordinator.begin(phone, operation);
    if (!finish) return;
    const current = () => scope.current === started && started.active;
    let succeeded = false;
    try {
      const result = await request();
      succeeded = true;
      if (current()) success(result);
    } catch (error) {
      if (current()) failure(error);
    } finally {
      // Navigation cannot cancel Convex actions. Keep the transport lock until
      // settlement, even after blur, so another screen cannot overlap requests.
      finish(succeeded);
    }
  };
  const guard = (callback: () => void) => {
    const started = scope.current;
    return () => {
      if (scope.current === started && started.active) callback();
    };
  };
  return { busy, remaining, invalidate, run, guard };
}
