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
  'components/InYomiSplashScreen.tsx',
  'app/(auth)/_layout.tsx',
  'app/(auth)/index.tsx',
  'lib/bridgeReadiness.ts',
  'lib/coldStartCaptureGate.ts',
  'lib/hooks/useStartupDestinationReady.ts',
  'lib/startupTrace.ts',
  'lib/services/otpDevelopmentLogger.ts',
  'lib/services/otpRequestCoordinator.ts',
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
  options: {
    focused?: boolean;
    capturePending?: boolean;
    authenticated?: boolean;
    platform?: 'ios' | 'android';
    hideFails?: boolean;
  } = {}
) {
  let focused = options.focused ?? true;
  let showDestination = false;
  let now = 0;
  let nextTimer = 0;
  let clientOptions: { logger?: unknown } | undefined;
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
      Image: 'Image',
      Text: 'Text',
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      Platform: { OS: options.platform ?? 'ios' },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: {
        create: (value: unknown) => value,
        absoluteFillObject: { position: 'absolute' },
      },
    },
    'react-native-gesture-handler': { GestureHandlerRootView: passthrough },
    'react-native-safe-area-context': {
      SafeAreaProvider: passthrough,
      SafeAreaView: 'SafeAreaView',
    },
    '@convex-dev/auth/react': { ConvexAuthProvider: passthrough },
    'convex/react': {
      ConvexReactClient: class {
        constructor(_address: string, options?: { logger?: unknown }) {
          clientOptions = options;
        }
      },
      useConvexAuth: () => ({
        isAuthenticated: options.authenticated ?? true,
        isLoading: false,
      }),
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
        if (options.hideFails) throw new Error('synthetic native failure');
      },
    },
    '../global.css': {},
    '@/config/appConfig': {},
    '@/constants/theme': { colors: {} },
    '@/lib/rtl': { APP_IS_RTL: true },
    '@/lib/onboardingState': { getOnboardingDraft: async () => null },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
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
        if (name.includes('/assets/')) return 1;
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
  const authSlot = React.createContext(false);
  const router = { replace: (_target: string) => {} };
  mocks['expo-router'] = {
    useSegments: () => ['(auth)'],
    useLocalSearchParams: () => ({}),
    useRouter: () => router,
    Slot: () => {
      const insideAuth = React.useContext(authSlot);
      if (insideAuth) return React.createElement(Welcome);
      if (!showDestination)
        return React.createElement(InYomiSplashScreen, { source: 'auth' });
      return options.authenticated === false
        ? React.createElement(
            authSlot.Provider,
            { value: true },
            React.createElement(AuthLayout)
          )
        : React.createElement(Destination);
    },
  };
  const { InYomiSplashScreen } = load<
    typeof import('../../../components/InYomiSplashScreen')
  >('components/InYomiSplashScreen.tsx');
  mocks['@/components/InYomiSplashScreen'] = { InYomiSplashScreen };
  const AuthLayout = load<{ default: React.ComponentType }>(
    'app/(auth)/_layout.tsx'
  ).default;
  const Welcome = load<{ default: React.ComponentType }>(
    'app/(auth)/index.tsx'
  ).default;
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
    get clientOptions() {
      return clientOptions;
    },
    get hides() {
      return hides;
    },
    get prevents() {
      return prevents;
    },
    get rootSplash() {
      return tree.root
        .findAllByType(InYomiSplashScreen)
        .find((s) => s.props.source === 'root');
    },
    get splashes() {
      return tree.root.findAllByType(InYomiSplashScreen);
    },
    get welcomeVisible() {
      return (
        tree.root.findAllByProps({ accessibilityLabel: 'בואו נתחיל' })
          .length === 1 &&
        tree.root.findAllByType(InYomiSplashScreen).length === 0
      );
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
        options.authenticated === false
          ? tree.root
              .findByType(AuthLayout)
              .findAllByType('View')[0]
              .props.onLayout()
          : tree.root.findByType('destination').props.onLayout()
      );
    },
    async settleWelcome() {
      const welcome = tree.root.findByType(Welcome);
      const heroSlot = welcome
        .findAllByType('View')
        .find((v) => v.props.onLayout);
      if (!heroSlot) throw new Error('Welcome hero slot missing');
      await act(async () =>
        heroSlot.props.onLayout({
          nativeEvent: { layout: { width: 300, height: 400 } },
        })
      );
      await act(async () => {
        for (const image of welcome.findAllByType('Image'))
          image.props.onLoad();
      });
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
    expect(h.clientOptions).toBeUndefined();
    h.startupTrace('GATES');
    h.startupTrace('T1_AUTH_RESOLVED');
    expect(h.logs).toEqual([]);
    h.startupTrace('NATIVE_SPLASH_FAILSAFE');
    expect(h.logs.length).toBe(1);
  });
});

describe('development bridge lifecycle', () => {
  it('hides native splash when destination readiness removes the bridge before its logo loads', async () => {
    const h = harness(true);
    await h.mount();
    await act(async () => h.rootSplash?.parent?.props.onLayout());
    await h.showDestination();
    await h.layoutDestination();
    expect(h.rootSplash).toBeUndefined();
    // There can be no onLoad from an unmounted logo. No timer should be
    // needed to request the native handoff to the already-ready destination.
    expect(h.hides).toBe(1);
    expect(h.frames).toHaveLength(0);
    expect(h.timers.size).toBe(0);
    await h.unmount();
  });

  for (const order of ['layout-first', 'image-first']) {
    it(`retains layout + image + animation-frame handoff (${order})`, async () => {
      const h = harness(true);
      expect(h.clientOptions?.logger).toBeDefined();
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

for (const platform of ['ios', 'android'] as const) {
  for (const development of [true, false]) {
    it(`${platform} ${development ? 'development' : 'release'}: real auth/Welcome and splash components hand off when destination wins the image race`, async () => {
      const h = harness(development, { platform, authenticated: false });
      await h.mount();
      if (development) {
        await act(async () => h.rootSplash?.parent?.props.onLayout());
      }
      await h.showDestination();
      await h.layoutDestination();
      expect(h.hides).toBe(1);
      expect(h.rootSplash).toBeUndefined();
      // Auth wrapper layout does not mean Welcome's own overlay is gone.
      expect(h.splashes.map((s) => s.props.source)).toEqual(['welcome']);
      await h.settleWelcome();
      expect(h.splashes).toHaveLength(0);
      expect(h.welcomeVisible).toBe(true);
      expect(h.logs.join('\n')).toContain('T0_HIDE_NATIVE_SPLASH_RESOLVED');
      if (development) {
        expect(h.logs.join('\n')).toContain('T0_CHILD_SPLASH_UNMOUNTED');
        expect(h.logs.join('\n')).toContain('"source":"welcome"');
      }
      await h.unmount();
    });
  }

  it(`${platform}: full unauthenticated Reload gets its own native handoff; warm renders do not reintroduce the bridge`, async () => {
    for (let runtime = 0; runtime < 2; runtime++) {
      const h = harness(true, { platform, authenticated: false });
      await h.mount();
      await act(async () => h.rootSplash?.parent?.props.onLayout());
      await h.showDestination();
      await h.layoutDestination();
      await h.settleWelcome();
      expect(h.prevents).toBe(1);
      expect(h.hides).toBe(1);
      // Same runtime, repeated destination layout/focus = warm render.
      await h.showDestination();
      await h.layoutDestination();
      await h.focusDestination();
      expect(h.hides).toBe(1);
      expect(h.welcomeVisible).toBe(true);
      await h.unmount();
    }
  });
}

it('buffered ready destination still hides native splash if bridge layout arrives before any logo load', async () => {
  const h = harness(true, { authenticated: false });
  await h.mount();
  await h.showDestination();
  await h.layoutDestination();
  expect(h.rootSplash).toBeDefined();
  expect(h.hides).toBe(0);
  await act(async () => h.rootSplash?.parent?.props.onLayout());
  expect(h.hides).toBe(1);
  expect(h.rootSplash).toBeUndefined();
  await h.unmount();
});

it('destination readiness and a queued image handoff request hide only once', async () => {
  const h = harness(true);
  await h.mount();
  await act(async () => {
    h.rootSplash?.parent?.props.onLayout();
    h.rootSplash?.findByType('Image').props.onLoad();
  });
  expect(h.frames).toHaveLength(1);
  await h.showDestination();
  await h.layoutDestination();
  await act(async () => h.frames.shift()?.());
  expect(h.hides).toBe(1);
  expect(h.splashes).toHaveLength(0);
  await h.unmount();
});

it('development hide failure is diagnosed without claiming native removal or starting retries', async () => {
  const h = harness(true, { hideFails: true });
  await h.mount();
  await act(async () => h.rootSplash?.parent?.props.onLayout());
  await h.showDestination();
  await h.layoutDestination();
  expect(h.logs.join('\n')).toContain('T0_HIDE_NATIVE_SPLASH_FAILED');
  expect(h.logs.join('\n')).not.toContain('T0_HIDE_NATIVE_SPLASH_RESOLVED');
  expect(h.logs.join('\n')).not.toContain('synthetic native failure');
  expect(h.hides).toBe(1);
  expect(h.timers.size).toBe(0);
  await h.unmount();
});

it('destination readiness after the existing bridge failsafe still requests native hide', async () => {
  const h = harness(true);
  await h.mount();
  await act(async () => h.rootSplash?.parent?.props.onLayout());
  await h.advance(10_000);
  expect(h.rootSplash).toBeUndefined();
  expect(h.hides).toBe(0);
  await h.showDestination();
  await h.layoutDestination();
  expect(h.hides).toBe(1);
  await h.unmount();
});
