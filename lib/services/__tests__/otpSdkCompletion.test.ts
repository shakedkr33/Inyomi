import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

// Diagnostic tests of the installed SDK, not a replacement auth implementation.
// All credentials and responses are synthetic. No network or native storage.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<ReturnType<typeof create>> = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});
type Result = { tokens: { token: string; refreshToken: string } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function harness() {
  const source = readFileSync(
    new URL(
      '../../../node_modules/@convex-dev/auth/src/react/client.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    fileName: 'client.tsx',
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exported: Record<string, any> = {};
  runInNewContext(code, {
    exports: exported,
    require: (name: string) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'is-network-error') return { default: () => false };
      throw new Error(`Unexpected SDK dependency: ${name}`);
    },
    window: { addEventListener() {}, removeEventListener() {} },
    FormData,
    URL,
    URLSearchParams,
    setTimeout,
    navigator: { product: 'ReactNative' },
  });
  const storage = new Map<string, string>();
  const requests: Array<ReturnType<typeof deferred<Result>>> = [];
  const client = {
    authenticatedCall() {
      const request = deferred<Result>();
      requests.push(request);
      return request.promise;
    },
  };
  let actions: {
    signIn: (
      provider: string,
      args: Record<string, string>
    ) => Promise<{ signingIn: boolean }>;
  };
  let auth: {
    isAuthenticated: boolean;
    fetchAccessToken: (args: {
      forceRefreshToken: boolean;
    }) => Promise<string | null>;
  };
  function Probe() {
    actions = React.useContext(exported.ConvexAuthActionsContext);
    auth = exported.useAuth();
    return null;
  }
  const props = {
    client,
    storageNamespace: 'diagnostic',
    replaceURL() {},
    storage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  };
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(
        exported.AuthProvider,
        props,
        React.createElement(Probe)
      )
    );
    mounted.push(tree);
  });
  return {
    storage,
    requests,
    async start() {
      let result!: ReturnType<typeof actions.signIn>;
      await act(async () => {
        result = actions.signIn('phone', {
          phone: '+15555550101',
          code: '000000',
        });
      });
      return { result };
    },
    async complete(index: number, identity: string) {
      await act(async () => {
        requests[index].resolve({
          tokens: {
            token: `synthetic-${identity}`,
            refreshToken: `synthetic-refresh-${identity}`,
          },
        });
      });
    },
    async leaveScreen() {
      await act(async () => {
        tree.update(React.createElement(exported.AuthProvider, props, null));
      });
    },
    async token() {
      return auth.fetchAccessToken({ forceRefreshToken: false });
    },
    authenticated() {
      return auth.isAuthenticated;
    },
  };
}
it('installed SDK activates and stores credentials before the caller continuation', async () => {
  const h = await harness();
  const pending = await h.start();
  let storedAtContinuation = false;
  const observed = pending.result.then(() => {
    storedAtContinuation =
      h.storage.get('__convexAuthJWT_diagnostic') === 'synthetic-A';
  });
  await h.complete(0, 'A');
  await observed;
  expect(storedAtContinuation).toBe(true);
  expect(h.authenticated()).toBe(true);
  expect(await h.token()).toBe('synthetic-A');
});
it('leaving the caller screen does not cancel SDK credential persistence', async () => {
  const h = await harness();
  const pending = await h.start();
  await h.leaveScreen();
  await h.complete(0, 'A');
  await pending.result;
  expect(h.storage.get('__convexAuthJWT_diagnostic')).toBe('synthetic-A');
  expect(await h.token()).toBe('synthetic-A');
});
it('SDK has no attempt ordering if a caller bypasses the application coordinator', async () => {
  const h = await harness();
  const old = await h.start();
  const newer = await h.start();
  await h.complete(1, 'B');
  await newer.result;
  expect(await h.token()).toBe('synthetic-B');
  await h.complete(0, 'A');
  await old.result;
  expect(await h.token()).toBe('synthetic-A');
  // This demonstrates the SDK boundary, not a reachable second request through
  // InYomi's shared gate. No signOut or rollback is performed by this test.
});
it('definitive SDK rejection leaves unauthenticated state and permits explicit retry', async () => {
  const h = await harness();
  const pending = await h.start();
  const observed = pending.result.catch(() => 'rejected');
  await act(async () => {
    h.requests[0].reject(
      new Error('Connection lost while action was in flight')
    );
  });
  expect(await observed).toBe('rejected');
  expect(h.authenticated()).toBe(false);
  expect(h.storage.has('__convexAuthJWT_diagnostic')).toBe(false);
  const retry = await h.start();
  await h.complete(1, 'A');
  await retry.result;
  expect(h.authenticated()).toBe(true);
});

it('installed stack router permits push and phone-param changes without removing verify', async () => {
  const { StackRouter } = await import('@react-navigation/routers');
  const router = StackRouter({ initialRouteName: 'verify' });
  const options = {
    routeNames: ['verify', 'sign-in'],
    routeParamList: {},
    routeGetIdList: {},
  };
  const state = router.getInitialState(options);
  const originalKey = state.routes[0].key;
  const pushed = router.getStateForAction(
    state,
    { type: 'PUSH', payload: { name: 'sign-in' } },
    options
  );
  expect(pushed?.routes.some((route) => route.key === originalKey)).toBe(true);
  expect(pushed?.routes[pushed.index].name).toBe('sign-in');
  const changed = router.getStateForAction(
    state,
    {
      type: 'SET_PARAMS',
      source: originalKey,
      payload: { params: { phone: '+15555550102' } },
    },
    options
  );
  expect(changed?.routes[0].key).toBe(originalKey);
  expect(changed?.routes[0].params).toEqual({ phone: '+15555550102' });
});

it('installed Expo Slot does not install a router supplied through its router prop', async () => {
  // Feasibility check: the public Slot type accepts router, but SlotNavigator
  // chooses Expo's StackRouter directly. This is not a native navigation test.
  const source = readFileSync(
    new URL(
      '../../../node_modules/expo-router/build/views/Navigator.js',
      import.meta.url
    ),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    fileName: 'Navigator.tsx',
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const expoRouter = () => {};
  const proposedRouter = () => {};
  let selectedRouter: unknown;
  const exported: Record<string, any> = {};
  const boundaries: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsx,
    '@react-navigation/native': {
      useNavigationBuilder: (router: unknown) => {
        selectedRouter = router;
        return {
          state: { routes: [{ key: 'verify' }], index: 0 },
          descriptors: { verify: { render: () => null } },
          NavigationContent: ({ children }: { children: React.ReactNode }) =>
            children,
        };
      },
    },
    'react-native-is-edge-to-edge': {},
    'react-native-safe-area-context': {},
    './Screen': { Screen() {} },
    '../Route': { useContextKey: () => '/(auth)' },
    '../layouts/StackClient': { StackRouter: expoRouter },
    '../layouts/withLayoutContext': {
      useFilterScreenChildren: () => ({ screens: [], protectedScreens: [] }),
    },
    '../useScreens': { useSortedScreens: () => [] },
  };
  runInNewContext(code, {
    exports: exported,
    process: { env: { NODE_ENV: 'test' } },
    require: (name: string) => {
      if (!(name in boundaries))
        throw new Error(`Unexpected navigator dependency: ${name}`);
      return boundaries[name];
    },
  });
  await act(async () => {
    mounted.push(
      create(React.createElement(exported.Slot, { router: proposedRouter }))
    );
  });
  expect(selectedRouter).toBe(expoRouter);
  expect(selectedRouter).not.toBe(proposedRouter);
});
