import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as deletion from '../../accountDeletionUi';
import * as calendarRouting from '../../calendarImportOnboarding';
import * as onboardingRouting from '../../onboardingRouting';
import { createPushTokenLifecycle } from '../../pushTokenLifecycle';
import { createOtpDevelopmentLogger } from '../otpDevelopmentLogger';

// Real provider, Profile handler, authenticated/auth layouts and Welcome. Only
// network, native APIs and unrelated product surfaces are mocked. Subscription
// updates are delivered explicitly: this is not a hosted Convex/Router test.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const root = new URL('../../../', import.meta.url);
const sources = [
  'contexts/NotificationsContext.tsx',
  'app/(authenticated)/profile.tsx',
  'app/(authenticated)/_layout.tsx',
  'app/(auth)/_layout.tsx',
  'app/(auth)/index.tsx',
  'app/(auth)/sign-in.tsx',
  'lib/explicitLogoutNavigation.ts',
];
const compiled = new Map(
  sources.map((path) => [
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
const trees: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
});
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(
  options: {
    platform?: string;
    signedOut?: boolean;
    empty?: boolean;
    delayRevocation?: boolean;
  } = {}
) {
  const state = {
    authenticated: !options.signedOut,
    authLoading: false,
    accountId: options.signedOut ? (null as string | null | undefined) : 'A',
    notifications: options.empty
      ? []
      : [{ _id: 'notification-A', recipientUserId: 'A' }],
    queryError: null as Error | null,
    listPending: false,
    revenueCatLoading: false,
    draftHydrated: true,
    navReady: true,
    route: options.signedOut ? '/(auth)' : '/(authenticated)',
    onboarding: { firstName: 'Account A', onboardingCompleted: true } as Record<
      string,
      unknown
    >,
    foreground: true,
    signOutFails: false,
  };
  const calls: string[] = [];
  const navigation: unknown[] = [];
  const alerts: Array<{
    title: string;
    buttons?: Array<{ style?: string; onPress?: () => Promise<void> }>;
  }> = [];
  const activeSubscriptions = new Set<string>();
  const errors: Error[] = [];
  let tokenUnregister = deferred();
  const localSignOut = deferred();
  const serverRevocation = deferred();
  const lifecycle = createPushTokenLifecycle();
  let pendingTarget: string | null = null;
  let pendingListener = () => {};
  const router = {
    replace: (target: string) => {
      navigation.push(target);
      state.route = target;
    },
    navigate: (target: string) => navigation.push(target),
    push: (target: unknown) => navigation.push(target),
  };
  const api = Object.fromEntries(
    Object.entries({
      users: [
        'getMyId',
        'getCurrentUserStatus',
        'getMyProfile',
        'getFamilyBootstrapStatus',
        'deleteMyAccount',
      ],
      members: ['listMyFamilyContacts', 'getPendingPhoneMatches'],
      pushTokens: ['registerPushToken', 'unregisterPushToken'],
      onboarding: ['persistOnboardingAnswers'],
      userNotifications: ['list', 'markAllRead', 'archiveAll'],
    }).map(([group, names]) => [
      group,
      Object.fromEntries(names.map((name) => [name, `${group}:${name}`])),
    ])
  );
  const mutations = new Map<string, (args?: unknown) => Promise<unknown>>();
  const resetData = () => {
    calls.push('reset-data');
    state.onboarding = {};
  };
  const clearOnboardingDraft = async () => {
    calls.push('clear-draft');
  };
  const getQuery = (name: string): unknown => {
    if (name === 'users:getMyId') return state.accountId;
    if (name === 'userNotifications:list') {
      if (state.queryError) throw state.queryError;
      return state.listPending ? undefined : state.notifications;
    }
    if (name === 'users:getCurrentUserStatus')
      return state.accountId ? { onboardingComplete: true } : null;
    if (name === 'users:getMyProfile')
      return state.accountId
        ? { firstName: `Account ${state.accountId}` }
        : null;
    if (name === 'users:getFamilyBootstrapStatus')
      return { shouldPromptFamilyBootstrap: false };
    if (name === 'members:listMyFamilyContacts')
      return { members: [], selfEntityId: null };
    return undefined;
  };
  let refresh = async () => {};
  let renderUpdate = () => {};
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsx,
    'convex/react': {
      useConvexAuth: () => ({
        isAuthenticated: state.authenticated,
        isLoading: state.authLoading,
      }),
      useQuery: (name: string, args?: unknown) => {
        const enabled = args !== 'skip';
        React.useEffect(() => {
          if (!enabled) return;
          activeSubscriptions.add(name);
          return () => {
            activeSubscriptions.delete(name);
          };
        }, [name, enabled]);
        return enabled ? getQuery(name) : undefined;
      },
      useMutation: (name: string) => {
        if (!mutations.has(name))
          mutations.set(name, async () => {
            calls.push(name);
            if (name === 'pushTokens:unregisterPushToken')
              await tokenUnregister.promise;
            if (name === 'users:deleteMyAccount') {
              state.accountId = null;
              state.notifications = [];
              renderUpdate();
              return { success: true };
            }
          });
        return mutations.get(name);
      },
    },
    '@convex-dev/auth/react': {
      useAuthActions: () => ({
        signOut: async () => {
          calls.push('sign-out');
          if (state.signOutFails) throw new Error('synthetic client failure');
          if (options.delayRevocation) await serverRevocation.promise;
          // Model the server commit preceding token cleanup in the installed SDK.
          state.accountId = null;
          state.notifications = [];
          renderUpdate();
          await localSignOut.promise;
          state.authenticated = false;
          renderUpdate();
        },
      }),
    },
    'expo-router': {
      useRouter: () => router,
      useRootNavigationState: () =>
        state.navReady ? { key: 'root' } : undefined,
      useSegments: () => [state.route, 'profile'],
      useLocalSearchParams: () => ({}),
      Slot: () =>
        React.createElement(
          state.route === '/(auth)/sign-in' ? PhoneInput : Welcome
        ),
      useFocusEffect: (callback: () => void) =>
        React.useEffect(() => callback(), [callback]),
      Redirect: ({ href }: { href: string }) => {
        router.replace(href);
        return null;
      },
      Tabs: Object.assign(() => React.createElement(Profile), {
        Screen: () => null,
      }),
    },
    'react-native': {
      ...Object.fromEntries(
        [
          'View',
          'Text',
          'Image',
          'TouchableOpacity',
          'Pressable',
          'ScrollView',
          'Modal',
          'TextInput',
          'KeyboardAvoidingView',
        ].map((name) => [name, name])
      ),
      Platform: { OS: options.platform ?? 'android' },
      StyleSheet: { create: (s: unknown) => s },
      useWindowDimensions: () => ({ width: 390, height: 850 }),
      Alert: {
        alert: (
          title: string,
          _message: unknown,
          buttons: (typeof alerts)[number]['buttons']
        ) => alerts.push({ title, buttons }),
      },
    },
    'react-native-safe-area-context': {
      SafeAreaView: 'View',
      useSafeAreaInsets: () => ({ bottom: 0 }),
    },
    '@expo/vector-icons': { MaterialIcons: 'Icon' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'expo-device': {},
    '@react-native-async-storage/async-storage': {
      default: { getItem: async () => null },
    },
    '@/convex/_generated/api': { api },
    '@/config/appConfig': {},
    '@/config/legalUrls': {},
    '@/config/devPlanOverride': {
      getDevPlanOverride: () => null,
      subscribeDevPlanOverride: () => () => {},
    },
    '@/constants/theme': { colors: {} },
    '@/contexts/ActionSheetContext': {
      ActionSheetContext: React.createContext({}),
    },
    '@/contexts/OnboardingContext': {
      useOnboarding: () => ({
        data: state.onboarding,
        resetData,
        isDraftHydrated: state.draftHydrated,
        hydrateFromServer: (profile: Record<string, unknown>) => {
          if (options.delayRevocation) {
            // Model the context setter; the real layout decides eligibility.
            // A fresh onboarding session has not used its hydrate-once ref.
            state.onboarding = { ...profile, onboardingCompleted: true };
          }
        },
      }),
    },
    '@/contexts/RevenueCatContext': {
      useRevenueCat: () => ({ isLoading: state.revenueCatLoading }),
    },
    '@/hooks/useEffectiveAccess': { useEffectiveAccess: () => ({}) },
    '@/components/InYomiSplashScreen': { InYomiSplashScreen: 'Splash' },
    '@/components/UpgradeModal': { UpgradeModal: () => null },
    '@/lib/accountDeletionUi': deletion,
    '@/lib/avatarInitials': { getSelfProfileAvatarInitials: () => '' },
    '@/lib/billingPeriod': {
      getBillingPeriodFromProductIdentifier: () => null,
    },
    '@/lib/birthdayStorage': {
      clearPersistedBirthdays: async () => {
        calls.push('clear-birthdays');
      },
    },
    '@/lib/notificationsStorage': {
      clearAccountNotifications: async () => {
        calls.push('clear-account-inbox');
      },
    },
    '@/lib/openLegalUrl': {},
    '@/lib/hooks/useOtpRequestScope': {
      useOtpRequestScope: () => ({ busy: false, remaining: 0 }),
    },
    '@/lib/phoneUtils': { parseIsraeliPhone: () => null },
    '@/lib/services/appleReviewAuth': {},
    '@/lib/services/authErrorUtils': {},
    '@/lib/spaceTypeDerivation': {
      deriveSpaceTypeFromFamilyMembers: () => 'personal',
    },
    '@/lib/rtl': { APP_IS_RTL: true, rtl: {} },
    '@/lib/onboardingRouting': onboardingRouting,
    '@/lib/calendarImportOnboarding': calendarRouting,
    '@/lib/onboardingState': {
      clearOnboardingDraft,
      getOnboardingDraft: async () => null,
    },
    '@/lib/pendingEventLink': {},
    '@/lib/coldStartCaptureGate': { isColdStartCaptureComplete: () => true },
    '@/lib/importFlowTrace': { importTrace: () => {} },
    '@/lib/startupTrace': {
      startupTrace: () => {},
      startupTraceGates: () => {},
    },
    '@/lib/hooks/useStartupDestinationReady': {
      useStartupDestinationReady: () => ({
        onLayout: () => calls.push('auth-layout-ready'),
      }),
    },
    '@/lib/pushNotifications': {
      pushTokenLifecycle: lifecycle,
      unregisterDevicePushToken: async (
        unregister: (args: object) => Promise<void>
      ) => {
        await unregister({ token: 'synthetic-device-token' });
        calls.push('clear-delivered-push');
      },
      registerForPushNotifications: async () => null,
      rememberDevicePushToken: async () => {},
      setupNotificationHandlers: () => () => {},
      consumePendingNavigationTarget: () => {
        const target = pendingTarget;
        pendingTarget = null;
        return target;
      },
      peekPendingNavigationTarget: () => pendingTarget,
      subscribeToPendingNavigation: (fn: () => void) => {
        pendingListener = fn;
        return () => {};
      },
    },
  };
  function load<T>(path: string): T {
    const exports = {};
    const code = compiled.get(path);
    if (!code) throw new Error(`Missing test source: ${path}`);
    runInNewContext(code, {
      exports,
      __DEV__: false,
      console,
      setTimeout: () => 1,
      clearTimeout: () => {},
      require: (name: string) => {
        if (name.includes('/assets/')) return 1;
        if (!(name in mocks)) throw new Error(`Unexpected module: ${name}`);
        return mocks[name];
      },
    });
    return exports as T;
  }
  const logoutNavigation = load<
    typeof import('../../explicitLogoutNavigation')
  >('lib/explicitLogoutNavigation.ts');
  mocks['@/lib/explicitLogoutNavigation'] = logoutNavigation;
  const PhoneInput = load<{ default: React.ComponentType }>(
    'app/(auth)/sign-in.tsx'
  ).default;
  const { NotificationsProvider, useNotifications } = load<
    typeof import('../../../contexts/NotificationsContext')
  >('contexts/NotificationsContext.tsx');
  const Profile = load<{ default: React.ComponentType }>(
    'app/(authenticated)/profile.tsx'
  ).default;
  const Layout = load<{ default: React.ComponentType }>(
    'app/(authenticated)/_layout.tsx'
  ).default;
  const AuthLayout = load<{ default: React.ComponentType }>(
    'app/(auth)/_layout.tsx'
  ).default;
  const Welcome = load<{ default: React.ComponentType }>(
    'app/(auth)/index.tsx'
  ).default;
  let inbox!: ReturnType<typeof useNotifications>;
  function Observer() {
    inbox = useNotifications();
    return null;
  }
  class Boundary extends React.Component<
    React.PropsWithChildren,
    { failed: boolean }
  > {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error: Error) {
      errors.push(error);
    }
    render() {
      return this.state.failed
        ? React.createElement('Failure')
        : this.props.children;
    }
  }
  function App() {
    return React.createElement(
      Boundary,
      null,
      React.createElement(
        NotificationsProvider,
        null,
        React.createElement(Observer),
        React.createElement(
          state.route.startsWith('/(auth)') ? AuthLayout : Layout
        )
      )
    );
  }
  let tree!: ReactTestRenderer;
  renderUpdate = () => {
    if (state.foreground) tree.update(React.createElement(App));
  };
  refresh = async () => {
    // Simulate a suspended render while backgrounded; deliver network state on
    // the next foreground render. Native AppState/OS scheduling still needs QA.
    if (!state.foreground) return;
    await act(async () => {
      tree.update(React.createElement(App));
    });
  };
  return {
    state,
    calls,
    navigation,
    alerts,
    activeSubscriptions,
    errors,
    localSignOut,
    logoutNavigation,
    serverRevocation,
    refresh,
    get tokenUnregister() {
      return tokenUnregister;
    },
    resetPushResponse() {
      tokenUnregister = deferred();
    },
    get inbox() {
      return inbox;
    },
    get tree() {
      return tree;
    },
    async mount() {
      await act(async () => {
        tree = create(React.createElement(App));
        trees.push(tree);
      });
    },
    async beginLogout() {
      const button = tree.root
        .findAllByType('TouchableOpacity')
        .find((node) =>
          node
            .findAllByType('Text')
            .some((text) => text.props.children === 'התנתקות')
        );
      if (!button) throw new Error('Logout button missing');
      await act(async () => {
        await button.props.onPress();
      });
      let pending!: Promise<void>;
      const confirm = alerts
        .at(-1)
        ?.buttons?.find((b) => b.style === 'destructive')?.onPress;
      if (!confirm) throw new Error('Logout confirmation missing');
      await act(async () => {
        pending = confirm();
      });
      return { pending };
    },
    async pendingLink(target: string) {
      pendingTarget = target;
      pendingListener();
      await refresh();
    },
    async foreground() {
      state.foreground = true;
      await refresh();
    },
    async background() {
      state.foreground = false;
      await refresh();
    },
  };
}

for (const platform of ['android', 'ios']) {
  for (const empty of [false, true]) {
    it(`${platform}: logout ${empty ? 'without' : 'with'} notifications keeps root alive and reaches phone entry`, async () => {
      const h = harness({ platform, empty });
      await h.mount();
      expect(h.activeSubscriptions.has('userNotifications:list')).toBe(true);
      const { pending } = await h.beginLogout();
      expect(h.calls).not.toContain('sign-out');
      await act(async () => {
        h.tokenUnregister.resolve();
      });
      expect(h.calls.slice(-5)).toEqual([
        'pushTokens:unregisterPushToken',
        'clear-delivered-push',
        'clear-draft',
        'reset-data',
        'sign-out',
      ]);
      expect(h.state.authenticated).toBe(true);
      expect(h.inbox.notifications).toEqual([]);
      expect(h.activeSubscriptions.has('userNotifications:list')).toBe(false);
      // Neither RC logout nor onboarding hydration may block signed-out routing.
      h.state.revenueCatLoading = true;
      h.state.draftHydrated = false;
      await act(async () => {
        h.localSignOut.resolve();
        await pending;
      });
      await h.refresh();
      expect(h.navigation).toEqual(['/(auth)/sign-in']);
      expect(h.errors).toEqual([]);
      expect(
        h.tree.root.findAllByProps({ accessibilityLabel: 'מספר טלפון' })
      ).toHaveLength(1);
      const authSurface = h.tree.root
        .findAllByType('View')
        .find((node) => node.props.onLayout);
      if (!authSurface) throw new Error('Auth destination surface missing');
      authSurface.props.onLayout();
      expect(h.calls).toContain('auth-layout-ready');
      expect(h.state.onboarding).toEqual({});
    });
  }
}

it('Push unregister failure preserves account state and prevents signOut; retry succeeds', async () => {
  const h = harness();
  await h.mount();
  const { pending } = await h.beginLogout();
  await act(async () => {
    h.tokenUnregister.reject(new Error('offline'));
    await pending;
  });
  expect(h.calls).not.toContain('sign-out');
  expect(h.calls).not.toContain('reset-data');
  expect(h.state.onboarding.firstName).toBe('Account A');
  expect(h.alerts.at(-1)?.title).toBe('ההתנתקות לא הושלמה');
  expect(h.navigation).toEqual([]);
  expect(h.activeSubscriptions.has('userNotifications:list')).toBe(true);
  h.resetPushResponse();
  const retry = await h.beginLogout();
  await act(async () => {
    h.tokenUnregister.resolve();
  });
  await act(async () => {
    h.localSignOut.resolve();
    await retry.pending;
  });
  await h.refresh();
  expect(h.navigation).toEqual(['/(auth)/sign-in']);
});

it('revocation with pending list unsubscribes, hides stale data and disables notification mutations', async () => {
  const h = harness();
  h.state.listPending = true;
  await h.mount();
  expect(h.inbox.isLoading).toBe(true);
  h.state.accountId = null;
  await h.refresh();
  expect(h.activeSubscriptions.has('userNotifications:list')).toBe(false);
  expect(h.inbox.isLoading).toBe(false);
  h.inbox.markAllSeen();
  h.inbox.archiveAll();
  expect(h.calls).not.toContain('userNotifications:markAllRead');
  expect(h.calls).not.toContain('userNotifications:archiveAll');
  expect(h.errors).toEqual([]);
  // Existing recovery limitation: stale SDK authentication still holds splash.
  expect(h.tree.root.findAllByType('Splash').length).toBeGreaterThan(0);
  expect(h.navigation).toEqual([]);
});

it('late account A list result is not shown after identity resolves to B', async () => {
  const h = harness();
  await h.mount();
  expect(h.inbox.unseenCount).toBe(1);
  h.state.accountId = undefined;
  await h.refresh();
  expect(h.inbox.notifications).toEqual([]);
  h.state.accountId = 'B';
  await h.refresh();
  expect(h.inbox.notifications).toEqual([]);
  h.state.notifications = [{ _id: 'notification-B', recipientUserId: 'B' }];
  await h.refresh();
  expect(h.inbox.notifications.map((n) => n._id)).toEqual(['notification-B']);
});

it('background/foreground during logout does not revive subscriptions or override phone entry with a protected link', async () => {
  const h = harness();
  await h.mount();
  const { pending } = await h.beginLogout();
  await h.background();
  await act(async () => {
    h.tokenUnregister.resolve();
  });
  expect(h.activeSubscriptions.has('userNotifications:list')).toBe(true);
  await h.foreground();
  expect(h.activeSubscriptions.has('userNotifications:list')).toBe(false);
  await act(async () => {
    h.localSignOut.resolve();
    await pending;
  });
  // Notification callbacks registered by the old layout cannot send logged-out
  // users to a protected destination while its unmount is still pending.
  await h.pendingLink('/(authenticated)/event/event-A');
  expect(h.navigation).toEqual(['/(auth)/sign-in']);
  expect(h.activeSubscriptions.has('userNotifications:list')).toBe(false);
  expect(h.errors).toEqual([]);
});

it('cold start with cleared credentials mounts existing Welcome without inbox subscription', async () => {
  const h = harness({ signedOut: true });
  await h.mount();
  expect(h.inbox.notifications).toEqual([]);
  expect(h.activeSubscriptions.has('userNotifications:list')).toBe(false);
  expect(
    h.tree.root.findAllByProps({ accessibilityLabel: 'בואו נתחיל' })
  ).toHaveLength(1);
});

it('unexpected notification query errors remain visible and demonstrate why a root-provider throw removes routing', async () => {
  const h = harness();
  await h.mount();
  h.state.queryError = new Error('Unexpected notification service failure');
  await h.refresh();
  expect(h.errors.map((e) => e.message)).toEqual([
    'Unexpected notification service failure',
  ]);
  expect(h.tree.root.findAllByType('Failure')).toHaveLength(1);
  expect(h.tree.root.findAllByType('TouchableOpacity')).toHaveLength(0);
});

it('logout followed by B login cannot render A notifications from a late cached result', async () => {
  const h = harness();
  await h.mount();
  const { pending } = await h.beginLogout();
  await act(async () => {
    h.tokenUnregister.resolve();
  });
  await act(async () => {
    h.localSignOut.resolve();
    await pending;
  });
  await h.refresh();
  h.state.authenticated = true;
  h.state.accountId = 'B';
  h.state.notifications = [{ _id: 'notification-A', recipientUserId: 'A' }];
  await h.refresh();
  await h.refresh();
  expect(h.inbox.notifications).toEqual([]);
  expect(h.state.onboarding.firstName).toBeUndefined();
  h.state.notifications = [{ _id: 'notification-B', recipientUserId: 'B' }];
  await h.refresh();
  expect(h.inbox.notifications.map((n) => n._id)).toEqual(['notification-B']);
});

it('SDK signed-out state hides any lingering identity/result cache immediately', async () => {
  const h = harness();
  await h.mount();
  h.state.authenticated = false;
  await h.refresh();
  expect(h.inbox.notifications).toEqual([]);
  expect(h.inbox.isLoading).toBe(false);
  expect(h.activeSubscriptions.has('userNotifications:list')).toBe(false);
  expect(h.navigation).toEqual(['/(auth)']);
});

it('logout routing waits for resolved Auth and the root navigator, then bypasses user-data gates', async () => {
  const h = harness();
  await h.mount();
  h.state.authenticated = false;
  h.state.authLoading = true;
  h.state.revenueCatLoading = true;
  await h.refresh();
  expect(h.navigation).toEqual([]);
  h.state.authLoading = false;
  h.state.navReady = false;
  await h.refresh();
  expect(h.navigation).toEqual([]);
  h.state.navReady = true;
  await h.refresh();
  expect(h.navigation).toEqual(['/(auth)']);
});

it('authenticated pending event, task, family and community targets retain their existing destinations', async () => {
  for (const target of [
    '/(authenticated)/event/synthetic',
    '/(authenticated)/task/synthetic',
    '/(authenticated)/family-profile',
    '/(authenticated)/communities',
  ]) {
    const h = harness();
    await h.mount();
    await h.pendingLink(target);
    expect(h.navigation).toEqual([target]);
    expect(h.errors).toEqual([]);
  }
});

it('existing OTP logger preserves the reported notification authorization error even during verification', () => {
  const errors: unknown[][] = [];
  const logger = createOtpDevelopmentLogger(() => true, {
    log: () => {
      throw new Error('Notification errors must not be demoted');
    },
    warn: () => {},
    error: (...args: unknown[]) => errors.push(args),
  });
  const message =
    '[CONVEX Q(userNotifications:list)] [Request ID: synthetic] Server Error\nUncaught Error: Not authenticated';
  logger.error(message);
  expect(errors).toEqual([[message]]);
});

it('a delayed signOut cannot leave a profile rehydrated between the initial reset and server revocation', async () => {
  const h = harness({ delayRevocation: true });
  await h.mount();
  const { pending } = await h.beginLogout();
  await act(async () => {
    h.tokenUnregister.resolve();
  });
  await h.refresh();
  // The real layout still has A's valid server profile before revocation.
  expect(h.state.onboarding.firstName).toBe('Account A');
  await act(async () => {
    h.serverRevocation.resolve();
  });
  await act(async () => {
    h.localSignOut.resolve();
    await pending;
  });
  await h.refresh();
  expect(h.state.onboarding).toEqual({});
  expect(h.navigation).toEqual(['/(auth)/sign-in']);
});

it('account deletion uses the actual Profile confirmation/cleanup flow and retains Welcome', async () => {
  const h = harness();
  await h.mount();
  const button = h.tree.root
    .findAllByType('TouchableOpacity')
    .find((node) =>
      node
        .findAllByType('Text')
        .some((text) => text.props.children === 'מחיקת חשבון')
    );
  if (!button) throw new Error('Delete account button missing');
  await act(async () => {
    button.props.onPress();
  });
  for (let step = 0; step < 3; step++) {
    const confirm = h.alerts
      .at(-1)
      ?.buttons?.find((b) => b.style !== 'cancel')?.onPress;
    if (!confirm) throw new Error('Delete account confirmation missing');
    await act(async () => {
      await confirm();
    });
  }
  expect(h.calls).toContain('users:deleteMyAccount');
  expect(h.calls).toContain('clear-birthdays');
  expect(h.calls).toContain('clear-account-inbox');
  expect(h.calls).toContain('sign-out');
  await act(async () => {
    h.localSignOut.resolve();
  });
  await h.refresh();
  expect(h.navigation).toEqual(['/(auth)']);
  expect(
    h.tree.root.findAllByProps({ accessibilityLabel: 'בואו נתחיל' })
  ).toHaveLength(1);
});

it('a failed explicit signOut does not change the destination of a later session expiry', async () => {
  const h = harness();
  h.state.signOutFails = true;
  await h.mount();
  const { pending } = await h.beginLogout();
  await act(async () => {
    h.tokenUnregister.resolve();
    await pending;
  });
  expect(h.alerts.at(-1)?.title).toBe('ההתנתקות לא הושלמה');
  expect(h.navigation).toEqual([]);
  h.state.authenticated = false;
  h.state.accountId = null;
  await h.refresh();
  expect(h.navigation).toEqual(['/(auth)']);
});

it('explicit logout intent is consumed once and cannot make account B skip Welcome on later invalidation', async () => {
  const h = harness();
  await h.mount();
  const { pending } = await h.beginLogout();
  await act(async () => {
    h.tokenUnregister.resolve();
  });
  await act(async () => {
    h.localSignOut.resolve();
    await pending;
  });
  await h.refresh();
  expect(h.navigation).toEqual(['/(auth)/sign-in']);
  h.state.authenticated = true;
  h.state.accountId = 'B';
  await h.refresh();
  await h.refresh();
  h.state.authenticated = false;
  h.state.accountId = null;
  await h.refresh();
  expect(h.navigation.at(-1)).toBe('/(auth)');
});
