import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const source = readFileSync(
  new URL('../../components/event/ParticipantsCard.tsx', import.meta.url),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Run the production component with native hosts mocked. These assertions cover
// layout wiring and interactions, not Yoga geometry or actual system/IME insets.
function harness(platform: string, bottom: number, count = 2) {
  const Insets = React.createContext(99); // Deliberately different app inset.
  let modalBottom = bottom;
  const changes: unknown[] = [];
  const familyChanges: unknown[] = [];
  const participants = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `משתתף ${i}`,
  }));
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react-native': {
      Platform: { OS: platform },
      StyleSheet: { create: (styles: unknown) => styles },
      View: 'View',
      Text: 'Text',
      TextInput: 'TextInput',
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      FlatList: 'FlatList',
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      Modal: ({
        visible,
        children,
      }: React.PropsWithChildren<{ visible: boolean }>) =>
        visible ? React.createElement('Modal', null, children) : null,
    },
    'react-native-safe-area-context': {
      SafeAreaProvider: ({ children }: React.PropsWithChildren) =>
        React.createElement(Insets.Provider, { value: modalBottom }, children),
      useSafeAreaInsets: () => ({ bottom: React.useContext(Insets) }),
    },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'expo-contacts': {},
    '@/lib/rtl': { rtl: { flexDirection: 'row', textAlign: 'right' } },
    '@/lib/utils/contactPhone': { normalizePhone: (value: string) => value },
    '@/lib/utils/contactsPermission': {},
  };
  const exports: { ParticipantsCard?: React.ComponentType<object> } = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  const Component = exports.ParticipantsCard;
  if (!Component) throw new Error('Missing ParticipantsCard export');
  const element = () =>
    React.createElement(Component, {
      participants,
      onChange: (value: unknown) => changes.push(value),
      familyMembers: [{ _id: 'family1', displayName: 'משפחה' }],
      sharedWithFamilyMemberIds: ['family1'],
      onFamilyChange: (...args: unknown[]) => familyChanges.push(args),
    });
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(element());
  });
  const press = (label: string) => {
    const node = renderer.root
      .findAllByType('Pressable')
      .find((item) => item.props.accessibilityLabel === label);
    if (!node) throw new Error(`Missing button: ${label}`);
    act(() => node.props.onPress());
  };
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten))
      : ((style ?? {}) as Record<string, unknown>);
  const sheet = () => {
    const node = renderer.root
      .findAllByType('Pressable')
      .find((item) => flatten(item.props.style).borderTopLeftRadius === 26);
    if (!node) throw new Error('Missing sheet');
    return node;
  };
  return {
    get root() {
      return renderer.root;
    },
    press,
    changes,
    familyChanges,
    padding: () => flatten(sheet().props.style).paddingBottom,
    resize: (inset: number) => {
      modalBottom = inset;
      act(() => renderer.update(element()));
    },
    dispose: () => act(() => renderer.unmount()),
  };
}

describe('participant modal layout', () => {
  for (const inset of [0, 16, 48]) {
    it(`uses only the modal bottom inset (${inset}), once, with a footer`, () => {
      const h = harness('android', inset);
      h.press('הוספת משתתפים');
      expect(h.padding()).toBe(24 + inset);
      expect(h.root.findByType('KeyboardAvoidingView').props.behavior).toBe(
        'height'
      );
      expect(
        h.root
          .findAllByType('ScrollView')
          .some(
            (node) =>
              !node.props.horizontal && node.props.style?.flexShrink === 1
          )
      ).toBe(true);
      h.resize(0); // Resized modal no longer overlaps navigation area (e.g. IME).
      expect(h.padding()).toBe(24);
      h.resize(inset);
      expect(h.padding()).toBe(24 + inset);
      h.press('שמור');
      expect(h.root.findAllByType('Modal')).toHaveLength(0);
      h.dispose();
    });
  }

  it('keeps a large list shrinkable and its final removal action intact', () => {
    const h = harness('android', 48, 100);
    h.press('הצג הכל 100');
    expect(h.padding()).toBe(72);
    const list = h.root.findByType('FlatList');
    expect(list.props.style[1].flexShrink).toBe(1);
    expect(list.props.data).toHaveLength(100);
    let row: ReturnType<typeof create>;
    act(() => {
      row = create(list.props.renderItem({ item: list.props.data[99] }));
    });
    act(() => row.root.findAllByType('Pressable')[0].props.onPress());
    expect(h.changes[0]).toHaveLength(99);
    expect((h.changes[0] as { id: string }[]).some((p) => p.id === 'p99')).toBe(
      false
    );
    act(() => row.unmount());
    h.dispose();
  });

  it('preserves RTL carousel direction, checked state and family selection', () => {
    const h = harness('android', 48);
    const carousel = h.root.findByType('ScrollView');
    expect(carousel.props.style.direction).toBe('rtl');
    expect(
      h.root
        .findAllByType('Pressable')
        .find((node) => node.props.accessibilityLabel === 'משפחה')?.props
        .accessibilityState.checked
    ).toBe(true);
    h.press('משפחה');
    expect(h.familyChanges).toEqual([[false, []]]);
    h.dispose();
  });

  it('preserves iOS padding and keyboard behavior without an extra main scroller', () => {
    const h = harness('ios', 48);
    h.press('הוספת משתתפים');
    expect(h.padding()).toBe(36);
    expect(h.root.findByType('KeyboardAvoidingView').props.behavior).toBe(
      'padding'
    );
    expect(
      h.root.findAllByType('ScrollView').every((node) => node.props.horizontal)
    ).toBe(true);
    h.press('שמור');
    h.press('הצג הכל 2');
    expect(h.padding()).toBe(36);
    h.dispose();
  });
});
