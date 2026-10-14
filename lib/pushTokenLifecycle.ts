// Serializes this device's registration and explicit logout. Dependencies are
// injected so delayed network/storage operations can be tested without Expo.
export function createPushTokenLifecycle() {
  let generation = 0;
  let activeUserId: string | null = null;
  let paused = false;
  let pending: Promise<unknown> = Promise.resolve();

  return {
    activate(userId: string) {
      paused = false;
      activeUserId = userId;
      const current = ++generation;
      return () => {
        if (generation === current) {
          generation++;
          activeUserId = null;
        }
      };
    },
    register(
      userId: string,
      getToken: () => Promise<string | null>,
      rememberToken: (token: string) => Promise<void>,
      registerToken: (token: string) => Promise<unknown>
    ): Promise<void> {
      const current = generation;
      const isCurrent = () =>
        !paused && generation === current && activeUserId === userId;
      const operation = pending.then(async () => {
        if (!isCurrent()) return;
        const token = await getToken();
        if (!token || !isCurrent()) return;
        // Persist before the mutation: a lost response/process restart must
        // not lose the token needed to unregister on the next logout attempt.
        await rememberToken(token);
        if (!isCurrent()) return;
        await registerToken(token);
      });
      pending = operation.catch(() => {});
      return operation;
    },
    async beforeSignOut(unregister: () => Promise<void>): Promise<void> {
      paused = true;
      generation++;
      await pending;
      // Do not sign out on failure. The caller displays a retryable error.
      await unregister();
    },
    resume() {
      paused = false;
    },
  };
}
