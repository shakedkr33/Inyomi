import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import ts from 'typescript';
import { personalAssignmentPresentation } from '../../personalEventTaskPresentation';

// Execute the actual route expressions with native hosts; backend persistence is
// covered separately by personalEventPackage1. No copied assignment/UI logic.
function expression(
  file: string,
  select: (node: ts.Node) => ts.Node | undefined
) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let result: ts.Node | undefined;
  function visit(node: ts.Node) {
    result ??= select(node);
    if (!result) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!result) throw new Error(`Missing production expression in ${file}`);
  return ts.transpileModule(`(${result.getText(source)})`, {
    compilerOptions: { jsx: ts.JsxEmit.React },
  }).outputText;
}
const personal = expression('app/(authenticated)/event/[id].tsx', (node) =>
  ts.isConditionalExpression(node) &&
  node.condition.getText() === 'isCommunityEvent' &&
  node.whenFalse.getText().includes('personalAssignmentPresentation')
    ? node.whenFalse
    : undefined
);
const swipe = expression('app/(authenticated)/tasks.tsx', (node) =>
  ts.isVariableDeclaration(node) && node.name.getText() === 'renderSwipeAction'
    ? node.initializer
    : undefined
);
type Element = React.ReactElement<{
  children?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}>;
function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [
    element,
    ...React.Children.toArray(element.props.children).flatMap(elements),
  ];
}
const hosts = {
  React,
  personalAssignmentPresentation,
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'Button',
  Pressable: 'Button',
  MaterialIcons: 'Icon',
  styles: {},
};
for (const own of [true, false]) {
  test(`personal creator clears ${own ? 'own' : 'participant'} assignment by opening the sheet and can assign again`, async () => {
    const calls: unknown[] = [];
    const context = {
      ...hosts,
      isAssignedToCurrentUser: own,
      isAssigned: true,
      assignmentLabel: 'שם',
      canManageTasks: true,
      event: {},
      task: { _id: 'task' },
      handleGatedAction: (action: () => void) => action(),
      setTaskAssignee: async (args: unknown) => {
        calls.push(args);
      },
      setAssigneeSheetTaskId: (id: string) => calls.push(id),
      setManualAssigneeName: () => {},
      Alert: {
        alert: () => {
          throw new Error('Unexpected error');
        },
      },
    };
    const assigned = runInNewContext(personal, context);
    elements(assigned)
      .find((node) => node.props.accessibilityLabel === 'שנה הקצאה')
      ?.props.onPress?.();
    await Promise.resolve();
    expect(calls).toEqual(['task']);
    expect(
      elements(assigned).some(
        (node) => node.props.accessibilityLabel === 'בטל הקצאה'
      )
    ).toBe(false);
    const cleared = runInNewContext(personal, {
      ...context,
      isAssigned: false,
    });
    expect(
      elements(cleared).some((node) => node.props.children === 'לא הוקצה')
    ).toBe(true);
    elements(cleared)
      .find((node) => node.props.accessibilityLabel === 'הקצה')
      ?.props.onPress?.();
    expect(calls[1]).toBe('task');
  });
}
for (const assigned of [true, false]) {
  test(`participant has no personal assignment action (assigned=${assigned})`, () => {
    const tree = runInNewContext(personal, {
      ...hosts,
      isAssignedToCurrentUser: assigned,
      isAssigned: assigned,
      assignmentLabel: 'שם',
      canManageTasks: false,
    });
    expect(elements(tree).filter((node) => node.props.onPress)).toHaveLength(0);
  });
}
test('My Tasks opens personal event; community retains unclaim action', () => {
  const calls: string[] = [];
  for (const communityId of [undefined, 'community']) {
    const render = runInNewContext(swipe, {
      ...hosts,
      canDelete: false,
      task: { kind: 'eventTask', communityId },
      onOpenEvent: () => calls.push('open'),
      onUnclaimEventTask: () => calls.push('unclaim'),
    });
    const tree = render() as Element;
    expect(tree.props.accessibilityLabel).toBe(
      communityId ? 'ביטול הקצאה' : 'פתיחה באירוע'
    );
    tree.props.onPress?.();
  }
  expect(calls).toEqual(['open', 'unclaim']);
});

test('existing avatar renderer keeps Hebrew initials, capacity, overflow and community label', () => {
  const code = ts.transpileModule(
    readFileSync(
      new URL('../../../components/ProfileCircles.tsx', import.meta.url),
      'utf8'
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }
  ).outputText;
  const exports: { ProfileCircles?: (props: object) => Element | null } = {};
  runInNewContext(code, {
    React,
    exports,
    require: (name: string) => {
      if (name !== 'react-native') throw new Error(name);
      return { ...hosts, StyleSheet: { create: (style: unknown) => style } };
    },
  });
  const render = exports.ProfileCircles;
  if (!render) throw new Error('Missing renderer');
  const profiles = ['דנה', 'שני', 'רון', 'אור'].map((name, id) => ({
    id: String(id),
    name,
    color: '#123456',
  }));
  for (const context of ['sharedWith', 'alsoAddedToCalendar']) {
    const tree = render({ profiles, extraCount: 2, context });
    expect(tree?.props.accessibilityLabel).toBe(
      context === 'sharedWith' ? 'משותף עם' : 'גם הוסיפו ליומן'
    );
    const texts = elements(tree)
      .filter((node) => node.type === 'Text')
      .map((node) => React.Children.toArray(node.props.children).join(''));
    expect(texts).toEqual(['דנ', 'שנ', 'רו', '+3']);
  }
  expect(render({ profiles: [], context: 'sharedWith' })).toBeNull();
  expect(
    render({
      profiles: [{ id: 'legacy', name: '', color: '#000' }],
      context: 'sharedWith',
    })
  ).toBeNull();
});

test('personal details mutation is immediate, guarded against duplicates and retains sheet on failure', async () => {
  const code = expression('app/(authenticated)/event/[id].tsx', (node) =>
    ts.isVariableDeclaration(node) &&
    node.name.getText() === 'savePersonalAssignment'
      ? node.initializer
      : undefined
  );
  const calls: unknown[] = [];
  const closed: unknown[] = [];
  let finish: (() => void) | undefined;
  const pending = { current: false };
  const context = {
    assigneeSheetTaskId: 'task',
    event: { createdBy: 'owner' },
    currentUserId: 'owner',
    personalAssignmentPending: pending,
    setAssignmentSaving() {},
    setAssigneeSheetTaskId: (id: unknown) => closed.push(id),
    setTaskAssignee: (args: unknown) => {
      calls.push(args);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    Alert: { alert: (...args: unknown[]) => calls.push(args) },
  };
  const save = runInNewContext(code, context);
  const first = save(null);
  await save({ type: 'user', userId: 'viewer' });
  expect(calls).toEqual([{ id: 'task', assignee: null }]);
  expect(closed).toEqual([]);
  finish?.();
  await first;
  expect(closed).toEqual([null]);
  expect(pending.current).toBe(false);
  const failed = runInNewContext(code, {
    ...context,
    setTaskAssignee: async () => {
      throw new Error('offline');
    },
  });
  await failed(null);
  expect(closed).toEqual([null]);
  expect(calls).toHaveLength(2);
  const forbidden = runInNewContext(code, {
    ...context,
    currentUserId: 'viewer',
  });
  await forbidden(null);
  expect(calls).toHaveLength(2);
});
