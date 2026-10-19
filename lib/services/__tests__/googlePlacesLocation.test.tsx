import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import type { LocationUpdate } from '../../components/event/LocationCard';
import { buildGeoUri } from '../../utils/geoUri';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const code = ts.transpileModule(
  readFileSync(
    new URL('../../components/event/LocationCard.tsx', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
).outputText;
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function harness(initial = '') {
  const requests: {
    kind: string;
    args: Record<string, string>;
    pending: ReturnType<typeof deferred>;
  }[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  const changes: LocationUpdate[] = [];
  let sequence = 0;
  const actions = Object.fromEntries(
    ['autocomplete', 'details'].map((kind) => [
      kind,
      (args: Record<string, string>) => {
        const pending = deferred();
        requests.push({ kind, args, pending });
        return pending.promise;
      },
    ])
  );
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'convex/react': { useAction: (kind: string) => actions[kind] },
    'expo-crypto': { randomUUID: () => `session-${++sequence}` },
    '@/convex/_generated/api': {
      api: {
        googlePlaces: { autocomplete: 'autocomplete', details: 'details' },
      },
    },
    '@/lib/rtl': {
      rtl: {
        textAlign: 'right',
        inputTextAlign: 'right',
        flexDirection: 'row',
      },
    },
    '@/lib/utils/geoUri': { buildGeoUri },
    './GooglePlacesAttribution': {
      GooglePlacesAttribution: 'GooglePlacesAttribution',
    },
    '@expo/vector-icons': { Ionicons: 'Icon', MaterialIcons: 'Icon' },
    'react-native': {
      ...Object.fromEntries(
        ['View', 'Text', 'TextInput', 'Pressable', 'ScrollView'].map((k) => [
          k,
          k,
        ])
      ),
      StyleSheet: { create: (s: unknown) => s },
      Keyboard: { dismiss() {} },
    },
  };
  const exports: {
    LocationCard?: React.ComponentType<{
      location: string;
      onChange: (update: LocationUpdate) => void;
    }>;
  } = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
      return mocks[name];
    },
    AbortController,
    setTimeout: (callback: () => void, ms: number) => {
      const id = ++sequence;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const Component = exports.LocationCard;
  if (!Component) throw new Error('LocationCard export missing');
  function Parent() {
    const [value, setValue] = React.useState<LocationUpdate>({
      location: initial,
      onlineUrl: '',
    });
    return (
      <Component
        {...value}
        onChange={(update) => {
          changes.push(update);
          setValue(update);
        }}
      />
    );
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Parent />, { createNodeMock: () => ({ blur() {} }) });
  });
  const button = (label: string) => {
    const node = renderer.root
      .findAllByType('Pressable')
      .find((n) => n.props.accessibilityLabel === label);
    if (!node) throw new Error(`Missing button ${label}`);
    return node;
  };
  if (!initial) act(() => button('הוספת מיקום').props.onPress());
  const input = () => renderer.root.findByType('TextInput');
  return {
    requests,
    changes,
    renderer,
    focus: () => act(() => input().props.onFocus()),
    type: (text: string) => act(() => input().props.onChangeText(text)),
    press: async (label: string) => {
      await act(async () => {
        void button(label).props.onPress();
      });
    },
    tick: async () => {
      await act(async () => {
        for (const [id, timer] of timers)
          if (timer.ms === 250) {
            timers.delete(id);
            timer.callback();
          }
      });
    },
    resolve: async (index: number, value: unknown) => {
      await act(async () => requests[index].pending.resolve(value));
    },
    dispose: () => act(() => renderer.unmount()),
  };
}
const suggestions = {
  ok: true,
  value: [{ placeId: 'id', description: 'כתובת נבחרת' }],
};
describe('LocationCard real component with deferred Convex transport', () => {
  it('has no runtime import of server code, Google URLs or key environment variables', () => {
    expect(code).not.toContain('EXPO_PUBLIC_GOOGLE_PLACES_API_KEY');
    expect(code).not.toContain('GOOGLE_PLACES_API_KEY');
    expect(code).not.toContain('maps.googleapis.com');
    expect(code).not.toContain('require("@/convex/googlePlaces")');
  });
  it('debounces, bounds input and ignores stale autocomplete; renders attribution', async () => {
    const h = harness();
    h.focus();
    h.type('א');
    await h.tick();
    expect(h.requests).toHaveLength(0);
    h.type('תל');
    h.type('תל אביב');
    expect(h.requests).toHaveLength(0);
    await h.tick();
    expect(h.requests).toHaveLength(1);
    h.type('London');
    await h.tick();
    expect(h.requests).toHaveLength(2);
    await h.resolve(1, suggestions);
    expect(
      h.renderer.root.findAllByType('GooglePlacesAttribution')
    ).toHaveLength(1);
    await h.resolve(0, {
      ok: true,
      value: [{ placeId: 'stale', description: 'old' }],
    });
    expect(
      h.renderer.root
        .findAllByType('Pressable')
        .some((n) => n.props.accessibilityLabel === 'בחירת כתובת: old')
    ).toBe(false);
    h.type('x'.repeat(201));
    await h.tick();
    expect(h.requests).toHaveLength(2);
    h.dispose();
  });
  it('shares tokens, clears old coordinates on selection/manual edits, suppresses late details and rotates sessions', async () => {
    const h = harness('existing saved address');
    expect(h.changes).toHaveLength(0);
    h.focus();
    await h.tick();
    await h.resolve(0, suggestions);
    await h.press('בחירת כתובת: כתובת נבחרת');
    expect(h.requests[1].args.sessionToken).toBe(
      h.requests[0].args.sessionToken
    );
    expect(h.changes.at(-1)?.locationUrl).toBe('');
    h.type('manual');
    await h.resolve(1, { ok: true, value: { lat: 32, lng: 34 } });
    expect(h.changes.at(-1)).toEqual({
      location: 'manual',
      onlineUrl: '',
      locationUrl: '',
      locationSource: 'manual',
      googlePlaceId: null,
    });
    h.focus();
    await h.tick();
    expect(h.requests[2].args.sessionToken).not.toBe(
      h.requests[0].args.sessionToken
    );
    await h.resolve(2, suggestions);
    await h.press('בחירת כתובת: כתובת נבחרת');
    await h.resolve(3, { ok: true, value: { lat: 32, lng: 34 } });
    expect(h.changes.at(-1)?.locationUrl).toBe('');
    expect(h.changes.at(-1)?.locationSource).toBe('google');
    expect(h.changes.at(-1)?.googlePlaceId).toBe(suggestions.value[0].placeId);
    await h.press('קישור');
    h.type('meet.google.com/abc');
    await h.press('כתובת');
    expect(h.changes.at(-1)?.location).toBe('כתובת נבחרת');
    expect(h.changes.at(-1)?.googlePlaceId).toBe(suggestions.value[0].placeId);
    await h.press('קישור');
    expect(h.changes.at(-1)?.onlineUrl).toBe('meet.google.com/abc');
    h.dispose();
  });
  it('keeps manual entry on errors and switching mode/closing invalidates pending details', async () => {
    const h = harness();
    h.focus();
    h.type('address');
    await h.tick();
    await h.resolve(0, { ok: false, error: 'UNAVAILABLE' });
    expect(h.changes.at(-1)?.location).toBe('address');
    h.type('next');
    await h.tick();
    await h.resolve(1, suggestions);
    await h.press('בחירת כתובת: כתובת נבחרת');
    await h.press('קישור');
    await h.resolve(2, { ok: true, value: { lat: 32, lng: 34 } });
    expect(h.changes.at(-1)).toEqual({
      location: '',
      onlineUrl: '',
      locationUrl: '',
      locationSource: null,
      googlePlaceId: null,
      onlineUrlEdited: false,
    });
    h.type('https://meet.example');
    expect(h.changes.at(-1)?.onlineUrl).toBe('https://meet.example');
    await h.press('הסרת מיקום');
    expect(h.changes.at(-1)?.locationUrl).toBe('');
    h.dispose();
  });
  it('unmount invalidates pending autocomplete and details', async () => {
    const h = harness();
    h.focus();
    h.type('address');
    await h.tick();
    await h.resolve(0, suggestions);
    await h.press('בחירת כתובת: כתובת נבחרת');
    h.dispose();
    const count = h.changes.length;
    await h.resolve(1, { ok: true, value: { lat: 32, lng: 34 } });
    expect(h.changes).toHaveLength(count);
  });
});
