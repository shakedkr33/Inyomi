import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPushTokenLifecycle } from '../../lib/pushTokenLifecycle';

// Execute the real Expo-facing wrapper with only native/network/storage APIs
// replaced. A new module instance models a cold start with persisted storage.
const compiled = ts.transpileModule(
  readFileSync(
    new URL('../../lib/pushNotifications.ts', import.meta.url),
    'utf8'
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;
function device(store = new Map<string, string>(), failTokenFetch = false) {
  const calls: string[] = [];
  const native = {
    getExpoPushTokenAsync: async () => {
      calls.push('fetch-token');
      if (failTokenFetch) throw new Error('offline');
      return { data: 'device-token' };
    },
    requestPermissionsAsync: async () => {
      throw new Error('Must not prompt on logout');
    },
    clearLastNotificationResponseAsync: async () => {
      calls.push('clear-response');
    },
    dismissAllNotificationsAsync: async () => {
      calls.push('dismiss');
    },
  };
  const modules: Record<string, unknown> = {
    '@react-native-async-storage/async-storage': {
      default: {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          store.set(key, value);
        },
      },
    },
    'expo-constants': {
      default: { easConfig: { projectId: 'synthetic-project' } },
    },
    'expo-device': { isDevice: true },
    'expo-notifications': native,
    'react-native': { Platform: { OS: 'ios' } },
    '@/utils/convexConfig': { getConvexUrl: () => 'https://synthetic.invalid' },
    './pushTokenLifecycle': { createPushTokenLifecycle },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    console,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
      return modules[name];
    },
  });
  return {
    calls,
    api: exports as {
      rememberDevicePushToken: (token: string) => Promise<void>;
      unregisterDevicePushToken: (
        fn: (args: { token: string }) => Promise<unknown>
      ) => Promise<void>;
    },
  };
}

it('cold-start logout deactivates the remembered token before clearing delivered notifications', async () => {
  const store = new Map<string, string>();
  await device(store).api.rememberDevicePushToken('remembered');
  const restarted = device(store, true);
  await restarted.api.unregisterDevicePushToken(async ({ token }) => {
    expect(token).toBe('remembered');
    restarted.calls.push('unregister');
  });
  expect(restarted.calls).toEqual(['unregister', 'clear-response', 'dismiss']);
});

it('legacy install retrieves token without a permission prompt', async () => {
  const d = device();
  await d.api.unregisterDevicePushToken(async ({ token }) => {
    expect(token).toBe('device-token');
  });
  expect(d.calls).toEqual(['fetch-token', 'clear-response', 'dismiss']);
});

it('offline legacy token retrieval rejects instead of silently completing logout', async () => {
  const d = device(new Map(), true);
  await expect(
    d.api.unregisterDevicePushToken(async () => {
      throw new Error('Must not be reached');
    })
  ).rejects.toThrow('offline');
  expect(d.calls).toEqual(['fetch-token']);
});

it('server deregistration failure is propagated and keeps the retry handle', async () => {
  const store = new Map<string, string>();
  const d = device(store);
  await d.api.rememberDevicePushToken('remembered');
  await expect(
    d.api.unregisterDevicePushToken(async () => {
      throw new Error('server unavailable');
    })
  ).rejects.toThrow();
  expect([...store.values()]).toEqual(['remembered']);
  expect(d.calls).toEqual([]);
});
