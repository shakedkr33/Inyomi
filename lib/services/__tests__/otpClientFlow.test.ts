import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { parseIsraeliPhone } from '../../phoneUtils';
import * as review from '../appleReviewAuth';
import * as errors from '../authErrorUtils';
import { createOtpRequestCoordinator } from '../otpRequestCoordinator';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const root = new URL('../../../', import.meta.url);
const mounted: Array<ReturnType<typeof create>> = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});
function deferred() {
  let resolve!: (result: { signingIn: boolean }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ signingIn: boolean }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(
  screen = 'verify',
  platform = 'android',
  coordinator = createOtpRequestCoordinator(() => time)
) {
  let focused = true;
  let phone = '+15555550101';
  let foreground: () => void = () => {};
  const calls: Array<{
    provider: string;
    args: Record<string, string>;
    pending: ReturnType<typeof deferred>;
  }> = [];
  const navigation: unknown[] = [];
  const alerts: unknown[][] = [];
  const router = {
    push: (value: unknown) => navigation.push(value),
    replace: (value: unknown) => navigation.push(value),
    back: () => navigation.push('back'),
  };
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsx,
    '@convex-dev/auth/react': {
      useAuthActions: () => ({
        signIn: (provider: string, args: Record<string, string>) => {
          const pending = deferred();
          calls.push({ provider, args, pending });
          return pending.promise;
        },
      }),
    },
    'expo-router': {
      useRouter: () => router,
      useLocalSearchParams: () => ({ phone }),
      useFocusEffect: (callback: () => (() => void) | undefined) =>
        // biome-ignore lint/correctness/useExhaustiveDependencies: harness explicitly rerenders when simulated focus changes.
        React.useEffect(
          () => (focused ? callback() : undefined),
          [callback, focused]
        ),
    },
    'react-native': {
      ...Object.fromEntries(
        [
          'View',
          'Text',
          'TextInput',
          'Pressable',
          'ScrollView',
          'KeyboardAvoidingView',
          'ActivityIndicator',
          'Image',
        ].map((x) => [x, x])
      ),
      Platform: { OS: platform },
      StyleSheet: { create: (x: unknown) => x },
      Alert: { alert: (...args: unknown[]) => alerts.push(args) },
      AppState: {
        addEventListener: (_: string, callback: () => void) => {
          foreground = callback;
          return { remove() {} };
        },
      },
    },
    'react-native-safe-area-context': { SafeAreaView: 'View' },
    '@/lib/rtl': { needsExplicitRTL: () => false },
    '@/lib/services/appleReviewAuth': review,
    '@/lib/services/authErrorUtils': errors,
    '@/lib/phoneUtils': { parseIsraeliPhone },
    '@/lib/openLegalUrl': { openLegalUrl() {} },
    '@/config/legalUrls': {
      ACCOUNT_DELETION_URL: 'https://synthetic.invalid/delete',
      PRIVACY_POLICY_URL: 'https://synthetic.invalid/privacy',
      TERMS_OF_SERVICE_URL: 'https://synthetic.invalid/terms',
    },
    '../services/otpRequestCoordinator': { otpRequestCoordinator: coordinator },
  };
  function load(file: string) {
    const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const exports = {};
    runInNewContext(code, {
      exports,
      require: (id: string) => {
        if (id.startsWith('@/assets/')) return 1;
        if (!(id in mocks)) throw new Error(`Missing test boundary: ${id}`);
        return mocks[id];
      },
      setInterval,
      clearInterval,
    });
    return exports as Record<string, React.ComponentType>;
  }
  mocks['@/lib/hooks/useOtpRequestScope'] = load(
    'lib/hooks/useOtpRequestScope.ts'
  );
  const Component = load(`app/(auth)/${screen}.tsx`).default;
  let tree: ReturnType<typeof create>;
  return {
    calls,
    navigation,
    alerts,
    coordinator,
    async mount() {
      await act(async () => {
        tree = create(React.createElement(Component));
        mounted.push(tree);
      });
    },
    input() {
      return tree.root.findByType('TextInput');
    },
    button(label: string) {
      const button = tree.root
        .findAllByType('Pressable')
        .find((x) => x.props.accessibilityLabel === label);
      if (!button) throw new Error(`Missing button: ${label}`);
      return button;
    },
    async press(label: string) {
      await act(async () => {
        this.button(label).props.onPress();
      });
    },
    async code(value: string) {
      await act(async () => {
        this.input().props.onChangeText(value);
      });
    },
    async complete(index: number, result = true) {
      await act(async () => {
        calls[index].pending.resolve({ signingIn: result });
      });
    },
    async fail(index: number, message = 'Network request failed') {
      await act(async () => {
        calls[index].pending.reject(new Error(message));
      });
    },
    async advance() {
      time += 61_000;
      await act(async () => {
        foreground();
      });
    },
    async changePhone(value: string) {
      phone = value;
      await act(async () => {
        tree.update(React.createElement(Component));
      });
    },
    async blur() {
      focused = false;
      await act(async () => {
        tree.update(React.createElement(Component));
      });
    },
    text() {
      return JSON.stringify(tree.toJSON());
    },
  };
}
let time = 0;
for (const platform of ['android', 'ios']) {
  it(`${platform}: duplicate resend + autofill produce one send and no queued verify`, async () => {
    const h = harness('verify', platform);
    await h.mount();
    await h.advance();
    await act(async () => {
      const press = h.button('שליחה חוזרת של קוד').props.onPress;
      press();
      press();
      h.input().props.onChangeText('123456');
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].args.code).toBeUndefined();
    expect(h.input().props.editable).toBe(true);
    await h.complete(0, false);
    expect(h.calls).toHaveLength(1);
    expect(h.input().props.value).toBe('');
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0][0]).toBe('שלחנו קוד אימות נוסף');
    expect(h.alerts[0][1]).toBeUndefined();
    expect(h.coordinator.remaining('+15555550101')).toBe(60);
    await h.code('654321');
    expect(h.calls).toHaveLength(2);
    await h.complete(1);
    expect(h.navigation).toEqual(['/(authenticated)/family-bootstrap']);
  });
}
it('verify blocks resend and rapid manual submit; wrong code permits retry', async () => {
  const h = harness();
  await h.mount();
  await h.advance();
  await h.code('123456');
  await h.press('שליחה חוזרת של קוד');
  await h.press('אימות קוד');
  expect(h.calls).toHaveLength(1);
  await h.fail(0, 'Could not verify code');
  expect(h.text()).toContain('פג תוקפו');
  await h.code('654321');
  expect(h.text()).not.toContain('פג תוקפו');
  await h.complete(1);
  expect(h.navigation).toHaveLength(1);
  expect(h.text()).not.toContain('פג תוקפו');
  expect(h.coordinator.snapshot()).toBe(false);
});
it('network resend failure releases lock, preserves digits, and does not queue autofill', async () => {
  const h = harness();
  await h.mount();
  await h.advance();
  await h.press('שליחה חוזרת של קוד');
  await h.code('123456');
  await h.fail(0);
  expect(h.alerts).toHaveLength(0);
  expect(h.text()).toContain('אין חיבור לאינטרנט');
  expect(h.input().props.value).toBe('123456');
  expect(h.calls).toHaveLength(1);
  expect(h.coordinator.remaining('+15555550101')).toBe(0);
  await h.press('שליחה חוזרת של קוד');
  expect(h.calls).toHaveLength(2);
  await h.complete(1, false);
});
it('phone change discards stale resend success and keeps transport locked until settlement', async () => {
  const h = harness();
  await h.mount();
  await h.advance();
  await h.press('שליחה חוזרת של קוד');
  await h.changePhone('+15555550102');
  await h.code('654321');
  expect(h.calls).toHaveLength(1);
  await h.complete(0, false);
  expect(h.alerts).toHaveLength(0);
  expect(h.input().props.value).toBe('654321');
  await h.press('אימות קוד');
  expect(h.calls[1].args.phone).toBe('+15555550102');
  await h.fail(1);
});
it('blur discards the screen callback after late success (SDK boundary mocked)', async () => {
  const h = harness();
  await h.mount();
  await h.code('123456');
  await h.blur();
  await h.complete(0);
  expect(h.navigation).toHaveLength(0);
  expect(h.alerts).toHaveLength(0);
  expect(h.coordinator.snapshot()).toBe(false);
});
it('unsigned result never navigates', async () => {
  const h = harness();
  await h.mount();
  await h.code('123456');
  await h.complete(0, false);
  expect(h.navigation).toHaveLength(0);
  expect(h.text()).toContain('פג תוקפו');
});
it('background elapsed time expires cooldown without an SMS or a queued operation', async () => {
  const h = harness();
  await h.mount();
  expect(h.coordinator.remaining('+15555550101')).toBe(60);
  await h.advance();
  expect(h.coordinator.remaining('+15555550101')).toBe(0);
  expect(h.calls).toHaveLength(0);
});
it('initial duplicate taps are synchronous; successful send uses normalized phone', async () => {
  const h = harness('sign-in');
  await h.mount();
  await h.code('0501234567');
  const label = 'שלח קוד';
  await act(async () => {
    h.button(label).props.onPress();
    h.button(label).props.onPress();
  });
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].args.phone).toBe('+972501234567');
  await h.complete(0, false);
  expect(h.navigation).toEqual([
    { pathname: '/(auth)/verify', params: { phone: '+972501234567' } },
  ]);
});
it('initial failure permits explicit retry; phone edit suppresses old completion', async () => {
  const h = harness('sign-in');
  await h.mount();
  await h.code('0501234567');
  const label = 'שלח קוד';
  await h.press(label);
  await h.fail(0);
  expect(h.text()).toContain('אין חיבור לאינטרנט');
  await h.press(label);
  await h.code('0507654321');
  await h.complete(1, false);
  expect(h.navigation).toHaveLength(0);
  await h.press(label);
  expect(h.calls).toHaveLength(3);
  await h.fail(2);
});
it('Apple Review initial entry sends no SMS; verification uses its existing provider', async () => {
  const h = harness('sign-in');
  await h.mount();
  await h.code(review.APPLE_REVIEW_PHONE);
  const label = 'שלח קוד';
  await h.press(label);
  expect(h.calls).toHaveLength(0);
  expect(h.navigation).toHaveLength(1);
  const v = harness();
  await v.mount();
  await v.changePhone(review.APPLE_REVIEW_PHONE);
  await v.code('123456');
  expect(v.calls[0].provider).toBe('apple-review');
  await v.fail(0, 'Could not verify code');
});

it('initial send and a different verification screen share the transport lock', async () => {
  const shared = createOtpRequestCoordinator(() => time);
  const initial = harness('sign-in', 'android', shared);
  await initial.mount();
  await initial.code('0501234567');
  await initial.press('שלח קוד');
  await initial.blur();
  const next = harness('verify', 'android', shared);
  await next.mount();
  await next.code('123456');
  expect(next.calls).toHaveLength(0);
  await initial.complete(0, false);
  expect(initial.navigation).toHaveLength(0);
  expect(next.calls).toHaveLength(0);
  await next.press('אימות קוד');
  expect(next.calls).toHaveLength(1);
  await next.fail(0);
});
it('late resend rejection does not replace the new phone error or code state', async () => {
  const h = harness();
  await h.mount();
  await h.advance();
  await h.press('שליחה חוזרת של קוד');
  await h.changePhone('+15555550102');
  await h.code('12');
  await h.fail(0);
  expect(h.text()).not.toContain('אין חיבור לאינטרנט');
  expect(h.input().props.value).toBe('12');
  expect(h.coordinator.snapshot()).toBe(false);
});
it('rate-limit rejection is safe copy and requires an explicit retry', async () => {
  const h = harness();
  await h.mount();
  await h.advance();
  await h.press('שליחה חוזרת של קוד');
  await h.fail(0, 'Too many requests: synthetic server detail');
  expect(h.text()).toContain('ניסיונות רבים מדי');
  expect(h.text()).not.toContain('synthetic server detail');
  expect(h.calls).toHaveLength(1);
  expect(h.coordinator.snapshot()).toBe(false);
  await h.press('שליחה חוזרת של קוד');
  expect(h.calls).toHaveLength(2);
  const stalePress = h.button('שליחה חוזרת של קוד').props.onPress;
  await h.complete(1, false);
  await act(async () => {
    stalePress();
  });
  expect(h.calls).toHaveLength(2);
});

it('editing during pending verification prevents an old rejection from labelling new digits', async () => {
  const h = harness();
  await h.mount();
  await h.code('123456');
  await h.code('654321');
  expect(h.calls).toHaveLength(1);
  await h.fail(0, 'Could not verify code');
  expect(h.text()).not.toContain('פג תוקפו');
  expect(h.input().props.value).toBe('654321');
  expect(h.coordinator.snapshot()).toBe(false);
  await h.press('אימות קוד');
  expect(h.calls).toHaveLength(2);
  await h.complete(1);
  expect(h.navigation).toHaveLength(1);
});
it('old phone verification failure cannot contaminate subsequent successful login', async () => {
  const h = harness();
  await h.mount();
  await h.code('123456');
  await h.changePhone('+15555550102');
  await h.code('654321');
  expect(h.calls).toHaveLength(1);
  await h.fail(0, 'Could not verify code');
  expect(h.text()).not.toContain('פג תוקפו');
  await h.press('אימות קוד');
  expect(h.calls[1].args.phone).toBe('+15555550102');
  await h.complete(1);
  expect(h.text()).not.toContain('פג תוקפו');
  expect(h.navigation).toHaveLength(1);
});

it('duplicate autofill of unchanged digits keeps the failed attempt error and sends once', async () => {
  const h = harness();
  await h.mount();
  await act(async () => {
    const change = h.input().props.onChangeText;
    change('123456');
    change('123456');
  });
  expect(h.calls).toHaveLength(1);
  await h.fail(0, 'Could not verify code');
  expect(h.text()).toContain('פג תוקפו');
  expect(h.coordinator.snapshot()).toBe(false);
});
