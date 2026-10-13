import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const root = new URL('../../../', import.meta.url);
const source = readFileSync(
  new URL('app/(authenticated)/event/[id].tsx', root),
  'utf8'
);
const ast = ts.createSourceFile(
  'details.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function find(select: (n: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  function visit(n: ts.Node) {
    if (select(n)) result = n;
    else ts.forEachChild(n, visit);
  }
  visit(ast);
  if (!result) throw new Error('Missing route implementation');
  return result;
}
function compile(text: string) {
  return ts.transpileModule(text, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
}
function callback(name: string, context: object) {
  const node = find(
    (n) => ts.isVariableDeclaration(n) && n.name.getText(ast) === name
  ) as ts.VariableDeclaration;
  return runInNewContext(compile(`(${node.initializer?.getText(ast)})`), {
    useCallback: (fn: unknown) => fn,
    ...context,
  });
}
type Element = React.ReactElement<{
  children?: React.ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
  style?: unknown;
}>;
function all(node: React.ReactNode): Element[] {
  if (!React.isValidElement(node)) return [];
  const el = node as Element;
  return [el, ...React.Children.toArray(el.props.children).flatMap(all)];
}
const flatten = (value: unknown): Record<string, unknown> =>
  Array.isArray(value)
    ? Object.assign({}, ...value.map(flatten))
    : ((value ?? {}) as Record<string, unknown>);
function load(direction: 'row' | 'row-reverse') {
  const exports: {
    PersonalEventActions?: (props: Record<string, unknown>) => Element | null;
  } = {};
  runInNewContext(
    compile(
      readFileSync(
        new URL('lib/components/event/PersonalEventActions.tsx', root),
        'utf8'
      )
    ),
    {
      exports,
      require: (name: string) => {
        if (name === 'react/jsx-runtime') return jsxRuntime;
        if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
        if (name === '@/lib/rtl')
          return { rtl: { flexDirection: direction, textAlign: 'right' } };
        if (name === 'react-native')
          return {
            View: 'View',
            Text: 'Text',
            Pressable: 'Button',
            StyleSheet: { create: (s: unknown) => s },
          };
        throw new Error(name);
      },
    }
  );
  if (!exports.PersonalEventActions) throw new Error('Missing component');
  return exports.PersonalEventActions;
}
const event = {
  createdBy: 'creator',
  title: 'אירוע ארוך',
  startTime: 100,
  endTime: 200,
  allDay: false,
  location: 'מקום',
};
const props = {
  event,
  currentUserId: 'creator',
  onEdit() {},
  onShare() {},
  onCancel() {},
};
for (const role of [
  'invitee',
  'legacy-family',
  'linked-viewer',
  'unauthorized',
  undefined,
]) {
  test(`${role}: read access never grants personal management actions`, () => {
    expect(load('row')({ ...props, currentUserId: role })).toBeNull();
  });
}
test('creator sees edit/share/cancel, cancelled event omits cancel, community renders no personal actions', () => {
  const render = load('row');
  const labels = (e: Element | null) =>
    all(e)
      .filter((n) => n.props.onPress)
      .map((n) => n.props.accessibilityLabel);
  expect(labels(render(props))).toEqual(['עריכה', 'שיתוף', 'ביטול אירוע']);
  expect(
    labels(render({ ...props, event: { ...event, status: 'cancelled' } }))
  ).toEqual(['עריכה', 'שיתוף']);
  expect(
    render({ ...props, event: { ...event, communityId: 'community' } })
  ).toBeNull();
});
for (const direction of ['row', 'row-reverse'] as const) {
  test(`${direction}: action layout wraps without absolute positioning or fixed heights`, () => {
    const tree = load(direction)(props);
    expect(flatten(tree?.props.style)).toMatchObject({
      flexWrap: 'wrap',
      flexDirection: direction,
      width: '100%',
    });
    for (const node of all(tree).filter((n) => n.props.onPress)) {
      expect(flatten(node.props.style)).toMatchObject({
        flexBasis: '45%',
        minWidth: 0,
        minHeight: 44,
      });
      expect(flatten(node.props.style).height).toBeUndefined();
      expect(flatten(node.props.style).position).toBeUndefined();
    }
  });
}
test('route wiring invokes existing edit/share and opens confirmation without cancelling', async () => {
  const pushed: unknown[] = [];
  const links: unknown[] = [];
  const shared: unknown[] = [];
  const dialogs: boolean[] = [];
  let scheduled: (() => void) | undefined;
  const edit = callback('handleEditPress', {
    event,
    eventId: 'event-id',
    router: { push: (args: unknown) => pushed.push(args) },
    handleGatedAction: (fn: () => void) => fn(),
  });
  const share = callback('handleShare', {
    event,
    eventId: 'event-id',
    eventImportantItems: [],
    communityRecord: undefined,
    createShareLinkMutation: async (args: unknown) => {
      links.push(args);
      return { token: 'existing-token' };
    },
    formatFullDate: () => 'תאריך',
    formatTime: () => 'שעה',
    Share: { share: async (args: unknown) => shared.push(args) },
    setTimeout: (fn: () => void) => {
      scheduled = fn;
    },
  });
  const element = find(
    (n) =>
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(ast) === 'PersonalEventActions'
  );
  const render = load('row');
  const wired = runInNewContext(compile(`(${element.getText(ast)})`), {
    exports: {},
    require: () => jsxRuntime,
    PersonalEventActions: render,
    event,
    currentUserId: 'creator',
    handleEditPress: edit,
    handleShare: share,
    setShowCancelDialog: (value: boolean) => dialogs.push(value),
  }) as React.ReactElement<Record<string, unknown>>;
  const buttons = all(render(wired.props)).filter((n) => n.props.onPress);
  buttons.forEach((n) => {
    n.props.onPress?.();
  });
  expect(pushed).toEqual([
    {
      pathname: '/(authenticated)/event-edit/[id]',
      params: { id: 'event-id' },
    },
  ]);
  expect(dialogs).toEqual([true]);
  scheduled?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(links).toEqual([{ eventId: 'event-id' }]);
  expect(shared).toEqual([
    {
      message:
        'אירוע ארוך\nתאריך · שעה\n📍 מקום\n\nhttps://inyomi.com/shared/existing-token',
    },
  ]);
});
test('existing confirmation calls cancellation with the reason, never delete', async () => {
  const calls: unknown[] = [];
  const cancel = callback('handleCancelEvent', {
    event,
    eventId: 'event-id',
    cancelReason: '  סיבה  ',
    setShowCancelDialog: (value: boolean) => calls.push(value),
    cancelEventMutation: async (args: unknown) => calls.push(args),
    setCancelReason: (value: string) => calls.push(value),
    router: { replace: (value: unknown) => calls.push(value) },
    Alert: {
      alert() {
        throw new Error('Unexpected failure');
      },
    },
  });
  await cancel();
  expect(calls).toEqual([
    false,
    { eventId: 'event-id', cancelReason: 'סיבה' },
    '',
    '/(authenticated)/communities',
  ]);
});
test('route no longer renders an overflow component or ellipsis action', () => {
  const tags: string[] = [];
  const icons: string[] = [];
  function visit(n: ts.Node) {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n))
      tags.push(n.tagName.getText(ast));
    if (
      ts.isJsxAttribute(n) &&
      n.name.getText(ast) === 'name' &&
      n.initializer &&
      ts.isStringLiteral(n.initializer)
    )
      icons.push(n.initializer.text);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  expect(tags).not.toContain('OverflowMenu');
  expect(icons).not.toContain('ellipsis-vertical');
});
