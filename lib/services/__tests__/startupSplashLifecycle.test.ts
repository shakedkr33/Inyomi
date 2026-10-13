import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

// Execute the real root layout, readiness hook/signals and trace implementation
// in isolated module contexts. Only native APIs, providers and navigation focus
// are mocked; no application startup rules are duplicated in the harness.
const root = new URL('../../../', import.meta.url);
const paths = [
  'app/_layout.tsx',
  'lib/bridgeReadiness.ts',
  'lib/coldStartCaptureGate.ts',
  'lib/hooks/useStartupDestinationReady.ts',
  'lib/startupTrace.ts',
];
const compiled = new Map(
  paths.map((path) => [
    path,
    ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ])
);

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function harness(
  development: boolean,
  options: { focused?: boolean; capturePending?: boolean } = {}
) {
  let focused = options.focused ?? true;
  let showDestination = false;
  let now = 0;
  let nextTimer = 0;
  let hides = 0;
  let prevents = 0;
  let finishCapture: () => void = () => {};
  const capture = options.capturePending
    ? new Promise<void>((resolve) => {
        finishCapture = resolve;
      })
    : Promise.resolve();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames: (() => void)[] = [];
  const logs: string[] = [];
  const cache = new Map<string, Record<string, unknown>>();
  const passthrough = ({ children }: React.PropsWithChildren) => children;
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react-native': {
      View: 'View',
      StyleSheet: { absoluteFillObject: { position: 'absolute' } },
    },
    'react-native-gesture-handler': { GestureHandlerRootView: passthrough },
    'react-native-safe-area-context': { SafeAreaProvider: passthrough },
    '@convex-dev/auth/react': { ConvexAuthProvider: passthrough },
    'convex/react': {
      ConvexReactClient: class {},
      useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
      useQuery: () => null,
    },
    '@react-navigation/native': { useIsFocused: () => focused },
    'expo-secure-store': {},
    'expo-status-bar': { StatusBar: () => null },
    'expo-splash-screen': {
      preventAutoHideAsync: async () => {
        prevents += 1;
      },
      hideAsync: async () => {
        hides += 1;
      },
    },
    '../global.css': {},
    '@/components/InYomiSplashScreen': { InYomiSplashScreen: 'splash' },
    '@/contexts/NotificationsContext': { NotificationsProvider: passthrough },
    '@/contexts/RevenueCatContext': { RevenueCatProvider: passthrough },
    '../contexts/OnboardingContext': { OnboardingProvider: passthrough },
    '@/lib/components/birthday/BirthdaySheetsProvider': {
      BirthdaySheetsProvider: passthrough,
    },
    '@/convex/_generated/api': { api: { users: { getMyId: {} } } },
    '@/utils/convexConfig': { getConvexUrl: () => 'https://test.invalid' },
    '@/lib/rtlBootstrap': { bootstrapRTL: async () => {} },
    '@/lib/pushNotifications': {
      captureColdStartNotification: () => capture,
      setupAndroidChannels: async () => {},
      setupNotificationCategories: async () => {},
    },
  };

  function load<T>(path: string): T {
    const cached = cache.get(path);
    if (cached) return cached as T;
    const code = compiled.get(path);
    if (!code) throw new Error(`Unexpected source module: ${path}`);
    const exports = {};
    cache.set(path, exports);
    runInNewContext(code, {
      exports,
      __DEV__: development,
      require: (name: string) => {
        if (name in mocks) return mocks[name];
        return load(`${name.replace(/^@\//, '')}.ts`);
      },
      setTimeout: (callback: () => void, delay: number) => {
        const id = ++nextTimer;
        timers.set(id, { at: now + delay, callback });
        return id;
      },
      clearTimeout: (id: number) => timers.delete(id),
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      performance: { now: () => now },
      console: { log: (...args: string[]) => logs.push(args.join(' ')) },
    });
    return exports as T;
  }

  const { useStartupDestinationReady } = load<{
    useStartupDestinationReady: (key: string) => { onLayout: () => void };
  }>('lib/hooks/useStartupDestinationReady.ts');
  function Destination() {
    const { onLayout } = useStartupDestinationReady('home');
    return React.createElement('destination', { onLayout });
  }
  mocks['expo-router'] = {
    Slot: () =>
      showDestination
        ? React.createElement(Destination)
        : React.createElement('splash', { source: 'authenticated' }),
  };
  const { default: RootLayout } = load<{ default: React.ComponentType }>(
    'app/_layout.tsx'
  );
  const { reportDestinationReady } = load<{
    reportDestinationReady: (key: string) => void;
  }>('lib/bridgeReadiness.ts');
  const { startupTrace } = load<{
    startupTrace: (label: string) => void;
  }>('lib/startupTrace.ts');
  let tree: ReactTestRenderer;

  return {
    get hides() {
      return hides;
    },
    get prevents() {
      return prevents;
    },
    get rootSplash() {
      return tree.root
        .findAllByType('splash')
        .find((s) => s.props.source === 'root');
    },
    logs,
    timers,
    frames,
    reportDestinationReady,
    startupTrace,
    async mount() {
      await act(async () => {
        tree = create(React.createElement(RootLayout));
      });
    },
    async showDestination() {
      showDestination = true;
      await act(async () => tree.update(React.createElement(RootLayout)));
    },
    async layoutDestination() {
      await act(async () =>
        tree.root.findByType('destination').props.onLayout()
      );
    },
    async focusDestination() {
      focused = true;
      await act(async () => tree.update(React.createElement(RootLayout)));
    },
    async finishCapture() {
      await act(async () => finishCapture());
    },
    async advance(ms: number) {
      await act(async () => {
        now += ms;
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) {
            timers.delete(id);
            timer.callback();
          }
        }
      });
    },
    async unmount() {
      await act(async () => tree.unmount());
    },
  };
}

describe('release native splash lifecycle', () => {
  it('waits for final layout, focus and capture; hides immediately once without a root bridge', async () => {
    const h = harness(false, { focused: false, capturePending: true });
    expect(h.prevents).toBe(1);
    expect(h.hides).toBe(0);
    await h.mount();
    expect(h.rootSplash).toBeUndefined();
    const queuedFailsafe = [...h.timers.values()][0].callback;
    await h.showDestination();
    expect(h.hides).toBe(0);
    await h.layoutDestination();
    expect(h.hides).toBe(0);
    await h.focusDestination();
    expect(h.hides).toBe(0);
    await h.finishCapture();
    expect(h.hides).toBe(1);
    expect(h.timers.size).toBe(0);
    expect(h.frames.length).toBe(0);
    h.reportDestinationReady('other-destination');
    queuedFailsafe();
    await h.advance(10_000);
    expect(h.hides).toBe(1);
    expect(h.logs.join('\n')).toContain('T_FINAL_DESTINATION_READY');
    expect(h.logs.join('\n')).toContain('"reason":"destination"');
    expect(h.logs.join('\n')).toContain('T0_HIDE_NATIVE_SPLASH_RESOLVED');
    expect(h.logs.join('\n')).not.toContain('NATIVE_SPLASH_FAILSAFE');
    await h.unmount();
  });

  it('honors readiness latched before the root subscription without starting a timer', async () => {
    const h = harness(false);
    h.reportDestinationReady('auth');
    await h.mount();
    expect(h.hides).toBe(1);
    expect(h.timers.size).toBe(0);
    expect(h.rootSplash).toBeUndefined();
    await h.unmount();
  });

  it('uses the 10-second failsafe only when no destination reports ready', async () => {
    const h = harness(false);
    await h.mount();
    await h.advance(9_999);
    expect(h.hides).toBe(0);
    await h.advance(1);
    expect(h.hides).toBe(1);
    expect(h.logs.join('\n')).toContain('NATIVE_SPLASH_FAILSAFE');
    expect(h.logs.join('\n')).toContain('"reason":"failsafe"');
    await h.showDestination();
    await h.layoutDestination();
    expect(h.hides).toBe(1);
    await h.unmount();
  });

  it('cleans up the failsafe and subscription on unmount', async () => {
    const h = harness(false);
    await h.mount();
    await h.unmount();
    expect(h.timers.size).toBe(0);
    h.reportDestinationReady('home');
    await h.advance(10_000);
    expect(h.hides).toBe(0);
  });

  it('does not enable unrelated release startup logs', () => {
    const h = harness(false);
    h.startupTrace('GATES');
    h.startupTrace('T1_AUTH_RESOLVED');
    expect(h.logs).toEqual([]);
    h.startupTrace('NATIVE_SPLASH_FAILSAFE');
    expect(h.logs.length).toBe(1);
  });
});

describe('development bridge lifecycle', () => {
  for (const order of ['layout-first', 'image-first']) {
    it(`retains layout + image + animation-frame handoff (${order})`, async () => {
      const h = harness(true);
      await h.mount();
      const splash = h.rootSplash;
      expect(splash).toBeDefined();
      const layout = splash?.parent?.props.onLayout;
      const image = splash?.props.onImageLoad;
      const callbacks =
        order === 'layout-first' ? [layout, image] : [image, layout];
      await act(async () => callbacks[0]());
      expect(h.frames.length).toBe(0);
      expect(h.hides).toBe(0);
      await act(async () => callbacks[1]());
      expect(h.hides).toBe(0);
      expect(h.frames.length).toBe(1);
      await act(async () => h.frames.shift()?.());
      expect(h.hides).toBe(1);
      expect(h.rootSplash).toBeDefined();
      await h.showDestination();
      await h.layoutDestination();
      expect(h.rootSplash).toBeUndefined();
      expect(h.timers.size).toBe(0);
      expect(h.hides).toBe(1);
      await h.unmount();
    });
  }

  it('buffers an early destination signal until bridge layout', async () => {
    const h = harness(true);
    h.reportDestinationReady('home');
    await h.mount();
    expect(h.rootSplash).toBeDefined();
    await act(async () => {
      h.rootSplash?.props.onImageLoad();
      h.rootSplash?.parent?.props.onLayout();
    });
    expect(h.rootSplash).toBeUndefined();
    await act(async () => h.frames.shift()?.());
    expect(h.hides).toBe(1);
    expect(h.timers.size).toBe(0);
    await h.unmount();
  });
});
