import { expect, it } from 'bun:test';
import { createPushTokenLifecycle } from '../../lib/pushTokenLifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('logout cancels a late permission result before any server registration', async () => {
  const lifecycle = createPushTokenLifecycle();
  lifecycle.activate('A');
  const token = deferred<string>();
  const started = deferred<void>();
  const calls: string[] = [];
  const registering = lifecycle.register(
    'A',
    () => {
      started.resolve();
      return token.promise;
    },
    async () => {
      calls.push('remember');
    },
    async () => {
      calls.push('register');
    }
  );
  await started.promise;
  const logout = lifecycle.beforeSignOut(async () => {
    calls.push('unregister');
  });
  token.resolve('token');
  await Promise.all([registering, logout]);
  expect(calls).toEqual(['unregister']);
});

it('waits for an already-dispatched registration before unregistering', async () => {
  const lifecycle = createPushTokenLifecycle();
  lifecycle.activate('A');
  const reply = deferred<void>();
  const started = deferred<void>();
  const calls: string[] = [];
  const registering = lifecycle.register(
    'A',
    async () => 'token',
    async () => {
      calls.push('remember');
    },
    () => {
      calls.push('register');
      started.resolve();
      return reply.promise;
    }
  );
  await started.promise;
  const logout = lifecycle.beforeSignOut(async () => {
    calls.push('unregister');
  });
  expect(calls).toEqual(['remember', 'register']);
  reply.resolve();
  await Promise.all([registering, logout]);
  expect(calls).toEqual(['remember', 'register', 'unregister']);
});

it('failed unregister rejects logout; the same account can register after next login', async () => {
  const lifecycle = createPushTokenLifecycle();
  const deactivate = lifecycle.activate('A');
  await expect(
    lifecycle.beforeSignOut(async () => {
      throw new Error('offline');
    })
  ).rejects.toThrow('offline');
  deactivate();
  lifecycle.activate('A');
  const calls: string[] = [];
  await lifecycle.register(
    'A',
    async () => 'token',
    async () => {},
    async () => {
      calls.push('register');
    }
  );
  expect(calls).toEqual(['register']);
});

it('switching accounts discards stale registration and registers the new account', async () => {
  const lifecycle = createPushTokenLifecycle();
  lifecycle.activate('A');
  const token = deferred<string>();
  const started = deferred<void>();
  const calls: string[] = [];
  const a = lifecycle.register(
    'A',
    () => {
      started.resolve();
      return token.promise;
    },
    async () => {},
    async () => {
      calls.push('A');
    }
  );
  await started.promise;
  lifecycle.activate('B');
  const b = lifecycle.register(
    'B',
    async () => 'token',
    async () => {},
    async () => {
      calls.push('B');
    }
  );
  token.resolve('token');
  await Promise.all([a, b]);
  expect(calls).toEqual(['B']);
});

it('failed registration retains its remembered token and does not poison logout queue', async () => {
  const lifecycle = createPushTokenLifecycle();
  lifecycle.activate('A');
  let remembered: string | null = null;
  await expect(
    lifecycle.register(
      'A',
      async () => 'token',
      async (token) => {
        remembered = token;
      },
      async () => {
        throw new Error('lost response');
      }
    )
  ).rejects.toThrow();
  await lifecycle.beforeSignOut(async () => {
    expect(remembered).toBe('token');
  });
});
