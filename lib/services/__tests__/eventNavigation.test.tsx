import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import * as eventLocation from '../../eventLocation';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const code = ts.transpileModule(
  readFileSync(
    new URL('../../../components/NavigationPickerModal.tsx', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
).outputText;

it('real picker opens Google by ID and Waze by address, including manual addresses', async () => {
  const opened: string[] = [];
  let closed = 0;
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === '@/lib/eventLocation') return eventLocation;
      if (name.endsWith('.png')) return 1;
      if (name === 'react-native')
        return {
          ...Object.fromEntries(
            ['Modal', 'Pressable', 'View', 'Text', 'Image'].map((n) => [n, n])
          ),
          StyleSheet: { create: (s: unknown) => s },
          Linking: {
            openURL: async (url: string) => {
              opened.push(url);
            },
          },
          Alert: {
            alert: () => {
              throw new Error('Unexpected alert');
            },
          },
        };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const Picker = exports.NavigationPickerModal as (props: {
    visible: boolean;
    location: string;
    googlePlaceId?: string;
    onClose: () => void;
  }) => React.JSX.Element;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <Picker
        visible
        location="כתובת"
        googlePlaceId="place"
        onClose={() => {
          closed++;
        }}
      />
    );
  });
  await act(async () =>
    renderer.root
      .findByProps({ accessibilityLabel: 'פתיחה ב-Google Maps' })
      .props.onPress()
  );
  await act(async () =>
    renderer.root
      .findByProps({ accessibilityLabel: 'פתיחה ב-Waze' })
      .props.onPress()
  );
  expect(opened[0]).toContain('query_place_id=place');
  expect(opened[1]).toBe(
    `https://waze.com/ul?q=${encodeURIComponent('כתובת')}&navigate=yes`
  );
  expect(closed).toBe(2);
  act(() =>
    renderer.update(
      <Picker
        visible
        location="Manual"
        onClose={() => {
          closed++;
        }}
      />
    )
  );
  await act(async () =>
    renderer.root
      .findByProps({ accessibilityLabel: 'פתיחה ב-Waze' })
      .props.onPress()
  );
  expect(opened[2]).toContain('q=Manual');
  act(() => renderer.unmount());
});
