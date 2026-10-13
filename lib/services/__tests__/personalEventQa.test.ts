import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import type { Id } from '../../../convex/_generated/dataModel';
import * as summaries from '../../eventTasksSummary';
import { filterHomeVisibleEventTasks } from '../../homeEventTaskVisibility';
import { personalAssignmentChoices } from '../../personalEventEditing';
import * as personalPresentation from '../../personalEventTaskPresentation';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const root = new URL('../../../', import.meta.url);
const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : ((style ?? {}) as Record<string, unknown>);

// Execute production components. Insets/keyboard/native hosts are synthetic;
// this verifies wiring and interactions, not native layout geometry.
function mount(
  file: string,
  name: string,
  initial: Record<string, unknown>,
  platform = 'android',
  bottom = 48
) {
  const Insets = React.createContext(99);
  let inset = bottom;
  const hosts = Object.fromEntries(
    [
      'View',
      'Text',
      'TextInput',
      'Pressable',
      'ScrollView',
      'KeyboardAvoidingView',
      'Switch',
      'TouchableOpacity',
    ].map((key) => [key, key])
  );
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react-native': {
      ...hosts,
      Platform: { OS: platform },
      StyleSheet: { create: (s: unknown) => s },
      Modal: ({
        visible,
        children,
        ...props
      }: React.PropsWithChildren<{ visible: boolean }>) =>
        visible ? React.createElement('Modal', props, children) : null,
    },
    'react-native-safe-area-context': {
      SafeAreaProvider: ({ children }: React.PropsWithChildren) =>
        React.createElement(Insets.Provider, { value: inset }, children),
      useSafeAreaInsets: () => ({ bottom: React.useContext(Insets) }),
    },
    '@expo/vector-icons': { Ionicons: 'Icon', MaterialIcons: 'Icon' },
    'react-native-draggable-flatlist': {
      __esModule: true,
      default: ({
        data,
        renderItem,
      }: {
        data: { id: string }[];
        renderItem: (value: object) => React.ReactNode;
      }) =>
        data.map((item) =>
          React.createElement(
            React.Fragment,
            { key: item.id },
            renderItem({ item, drag() {}, isActive: false })
          )
        ),
      OpacityDecorator: ({ children }: React.PropsWithChildren) => children,
    },
    '@/lib/rtl': {
      rtl: { flexDirection: 'row', textAlign: 'right' },
      getTextAlign: () => 'right',
    },
    '@/lib/eventTasksSummary': summaries,
    '@/lib/personalEventTaskPresentation': personalPresentation,
    '@/theme/colors': { colors: {} },
  };
  const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: Record<
    string,
    React.ComponentType<Record<string, unknown>>
  > = {};
  runInNewContext(code, {
    exports,
    require: (key: string) => {
      if (!(key in mocks)) throw new Error(`Unexpected dependency ${key}`);
      return mocks[key];
    },
  });
  const Component = exports[name];
  let props = initial;
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Component, props));
  });
  const update = (next: Record<string, unknown> = {}) => {
    props = { ...props, ...next };
    act(() => renderer.update(React.createElement(Component, props)));
  };
  return {
    get root() {
      return renderer.root;
    },
    update,
    resize: (value: number) => {
      inset = value;
      update();
    },
    press: (label: string) => {
      const node = renderer.root.findAll(
        (node) =>
          ['Pressable', 'TouchableOpacity'].includes(String(node.type)) &&
          node.props.accessibilityLabel === label
      )[0];
      if (!node) throw new Error(`Missing button ${label}`);
      act(() => node.props.onPress());
    },
    dispose: () => act(() => renderer.unmount()),
  };
}

const owner = 'owner' as Id<'users'>;
const other = 'other' as Id<'users'>;
const choices = personalAssignmentChoices(
  owner,
  [{ id: 'profile', userId: other, name: 'שני', color: '#123456' }],
  { fullName: 'דנה', color: '#654321' }
);
const relatedProps = {
  tasks: [
    {
      id: 'task',
      title: 'כוסות',
      completed: false,
      assignedParticipantIds: [owner],
    },
  ],
  participants: choices,
  defaultAssigneeId: owner,
  completedCount: 0,
  tasksVisibleToParticipants: false,
  showToggle: true,
  onChange() {},
  onToggleVisibility() {},
  visibilityOffHelperText: '',
};
const relatedFile = 'lib/components/event/RelatedTasksSection.tsx';

describe('account-backed editor avatars', () => {
  it('uses actual creator identity, changes after reassignment and preserves legacy display', () => {
    const h = mount(relatedFile, 'RelatedTasksSection', relatedProps);
    const avatar = () =>
      h.root
        .findAllByType('View')
        .find(
          (node) =>
            flatten(node.props.style).width === 20 && node.props.accessible
        );
    expect(avatar()?.props.accessibilityLabel).toBe('דנה');
    expect(flatten(avatar()?.props.style).backgroundColor).toBe('#654321');
    expect(avatar()?.findByType('Text').props.children).toBe('ד');
    h.update({
      tasks: [{ ...relatedProps.tasks[0], assignedParticipantIds: [other] }],
    });
    expect(avatar()?.props.accessibilityLabel).toBe('שני');
    expect(avatar()?.findByType('Text').props.children).toBe('ש');
    h.update({
      tasks: [
        {
          ...relatedProps.tasks[0],
          assignedParticipantIds: ['legacy'],
          assigneeId: 'legacy',
          assignee: { id: 'legacy', name: 'שם ישן', color: '#999' },
        },
      ],
    });
    expect(avatar()?.props.accessibilityLabel).toBe('שם ישן');
    h.dispose();
  });
  it('new task defaults to the creator account and renders that account after saving the draft', () => {
    let latest: unknown;
    const h = mount(relatedFile, 'RelatedTasksSection', {
      ...relatedProps,
      tasks: [],
      onChange: (value: unknown) => {
        latest = value;
      },
    });
    h.press('הוסף משימה חדשה');
    act(() => h.root.findByType('TextInput').props.onChangeText('משימה חדשה'));
    h.press('הוסף');
    expect(latest).toEqual([
      expect.objectContaining({
        assignedParticipantIds: [owner],
        title: 'משימה חדשה',
      }),
    ]);
    h.update({ tasks: latest });
    expect(
      h.root
        .findAllByType('View')
        .some((node) => node.props.accessibilityLabel === 'דנה')
    ).toBe(true);
    h.dispose();
  });
  it('does not borrow another account identity when creator has no profile or names are duplicated', () => {
    expect(choices[0].name).toBe('דנה'); // No creator participant profile.
    const sameNames = personalAssignmentChoices(
      owner,
      [{ id: 'p', userId: other, name: 'דנה', color: '#123456' }],
      { fullName: 'דנה' }
    );
    expect(sameNames.map((p) => p.id)).toEqual([owner, other]);
    expect(sameNames[0].color).toBe('#94a3b8');
    const unknown = personalAssignmentChoices(owner, choices.slice(1));
    expect(unknown[0].name).toBe('?');
    const h = mount(relatedFile, 'RelatedTasksSection', {
      ...relatedProps,
      participants: unknown,
    });
    expect(
      h.root
        .findAllByType('View')
        .some((node) => node.props.accessibilityLabel === 'חשבון לא מזוהה')
    ).toBe(true);
    h.dispose();
  });
});

describe('assignment sheets', () => {
  for (const platform of ['android', 'ios']) {
    for (const inset of [0, 16, 48]) {
      it(`${platform}: editor Save uses modal inset ${inset} once and list can shrink`, () => {
        let saved: unknown;
        const participants = Array.from({ length: 100 }, (_, i) => ({
          id: `p${i}`,
          name: `שם ${i}`,
          color: '#123456',
        }));
        const h = mount(
          relatedFile,
          'RelatedTasksSection',
          {
            ...relatedProps,
            participants,
            onChange: (value: unknown) => {
              saved = value;
            },
          },
          platform,
          inset
        );
        h.press('הקצה משימה: כוסות');
        const sheet = () =>
          h.root
            .findAllByType('Pressable')
            .find(
              (node) => flatten(node.props.style).borderTopLeftRadius === 24
            );
        expect(flatten(sheet()?.props.style).paddingBottom).toBe(
          32 + (platform === 'android' ? inset : 0)
        );
        expect(h.root.findByType('KeyboardAvoidingView').props.behavior).toBe(
          platform === 'android' ? 'height' : undefined
        );
        const list = h.root.findByType('ScrollView');
        expect(flatten(list.props.style).flexShrink).toBe(
          platform === 'android' ? 1 : undefined
        );
        expect(list.props.keyboardShouldPersistTaps).toBe('handled');
        h.resize(0);
        expect(flatten(sheet()?.props.style).paddingBottom).toBe(32);
        h.press('שם 99');
        h.press('שמור הקצאה');
        expect(saved).toEqual([
          { ...relatedProps.tasks[0], assignedParticipantIds: ['p99'] },
        ]);
        expect(h.root.findAllByType('Modal')).toHaveLength(0);
        h.dispose();
      });
      it(`${platform}: standalone assignment sheet uses modal inset ${inset} once`, () => {
        let selected: unknown;
        const h = mount(
          'lib/components/event/TaskAssigneeSheet.tsx',
          'TaskAssigneeSheet',
          {
            visible: true,
            members: [{ userId: other, fullName: 'שני' }],
            isCreator: true,
            manualName: '',
            onClose() {},
            onManualNameChange() {},
            onSelectManual() {},
            onSelectUser: (id: string) => {
              selected = id;
            },
          },
          platform,
          inset
        );
        const sheet = () =>
          h.root
            .findAllByType('View')
            .find(
              (node) => flatten(node.props.style).borderTopLeftRadius === 20
            );
        expect(flatten(sheet()?.props.style).paddingBottom).toBe(
          36 + (platform === 'android' ? inset : 0)
        );
        expect(h.root.findByType('KeyboardAvoidingView').props.behavior).toBe(
          platform === 'android' ? 'height' : 'padding'
        );
        expect(h.root.findByType('TextInput').props.textAlign).toBe('right');
        h.resize(0);
        expect(flatten(sheet()?.props.style).paddingBottom).toBe(36);
        h.press('שני');
        expect(selected).toBe(other);
        h.dispose();
      });
    }
  }
});

it('Home keeps all server-authorized personal tasks and community retains its previous subset', () => {
  const tasks = [
    { id: 'mine', isAssignedToCurrentUser: true, assignedToUserId: 'owner' },
    { id: 'other', isAssignedToCurrentUser: false, assignedToUserId: 'other' },
    { id: 'manual', isAssignedToCurrentUser: false, assignedToManual: 'שם' },
    { id: 'open', isAssignedToCurrentUser: false },
  ];
  expect(filterHomeVisibleEventTasks(tasks, true)).toEqual(tasks);
  expect(filterHomeVisibleEventTasks(tasks)).toEqual([tasks[0], tasks[3]]);
  // Verify the actual route passes event kind, not client role, to the tested filter.
  const route = readFileSync(
    new URL('app/(authenticated)/index.tsx', root),
    'utf8'
  );
  expect(route).toContain(
    'filterHomeVisibleEventTasks(mappedTasks, isPersonalEvent)'
  );
  expect(route).toContain('event._id === r.eventId && !event.communityId');
});

it('Home accordion renders current assignee, updates completion props and does not grant completion through visibility', () => {
  const calls: string[] = [];
  const tasks = [
    {
      id: 't',
      title: 'כוסות',
      completed: false,
      assignedToUserId: other,
      assigneeDisplay: 'שני',
      isAssignedToCurrentUser: false,
    },
  ];
  const h = mount(
    'components/home/EventTasksAccordion.tsx',
    'EventTasksAccordion',
    {
      tasks,
      isPersonalEvent: true,
      canManageTasks: true,
      tasksVisibleToParticipants: true,
      expanded: true,
      onToggle() {},
      onToggleCompleted: (id: string) => calls.push(id),
    }
  );
  expect(
    h.root
      .findAllByType('Text')
      .some((node) => node.props.children === 'הוקצה ל־שני')
  ).toBe(true);
  h.press('כוסות');
  expect(calls).toEqual(['t']);
  h.update({ tasks: [{ ...tasks[0], completed: true }] });
  expect(
    h.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityRole === 'checkbox')?.props
      .accessibilityState.checked
  ).toBe(true);
  h.update({ canManageTasks: false });
  expect(
    h.root
      .findAllByType('Pressable')
      .filter((node) => node.props.accessibilityRole === 'checkbox')
  ).toHaveLength(0);
  expect(
    h.root
      .findAllByType('View')
      .some(
        (node) =>
          node.props.accessibilityState?.disabled &&
          node.props.accessibilityState.checked
      )
  ).toBe(true);
  h.update({ tasks: [{ ...tasks[0], isAssignedToCurrentUser: true }] });
  h.press('כוסות');
  expect(calls).toEqual(['t', 't']);
  h.dispose();
});

it('personal progress counts others and legacy tasks, including updated completion, while community copy stays unchanged', () => {
  const tasks = [
    {
      completed: false,
      isAssignedToCurrentUser: true,
      assignedToUserId: owner,
    },
    {
      completed: false,
      isAssignedToCurrentUser: false,
      assignedToUserId: other,
    },
    {
      completed: true,
      isAssignedToCurrentUser: false,
      assignedToManual: 'Legacy',
    },
  ];
  expect(summaries.buildPersonalEventTasksSummaryLabel(tasks)).toBe(
    'משימות האירוע · 1 מתוך 3 הושלמו'
  );
  tasks[1].completed = true;
  expect(summaries.buildPersonalEventTasksSummaryLabel(tasks)).toBe(
    'משימות האירוע · 2 מתוך 3 הושלמו'
  );
  expect(
    summaries.buildEventTasksSummaryLabel(filterHomeVisibleEventTasks(tasks))
  ).toBe('יש לך משימה אחת');
});

it('personal toggle description is unchanged across states while community wording stays intact', () => {
  const copy = 'כשמופעל, המשתתפים רואים גם את המשימות של כולם';
  const h = mount(relatedFile, 'RelatedTasksSection', {
    ...relatedProps,
    visibilityHelperText: copy,
  });
  const texts = () =>
    h.root.findAllByType('Text').map((node) => node.props.children);
  expect(texts()).toContain(copy);
  h.update({ tasksVisibleToParticipants: true });
  expect(texts()).toContain(copy);
  h.update({ visibilityHelperText: undefined });
  expect(texts()).toContain(
    'כל חברי הקהילה יראו את המשימות וההקצאות ויוכלו להשתבץ'
  );
  h.dispose();
});

it('personal details hide the empty-list toggle and both detail entry points consume shared personal copy', () => {
  // Supplement the real editor/handler tests with wiring checks for the two large
  // route surfaces; these are not a native rendering or device assertion.
  const detail = readFileSync(
    new URL('app/(authenticated)/event/[id].tsx', root),
    'utf8'
  );
  const sheet = readFileSync(
    new URL('components/EventDetailsBottomSheet.tsx', root),
    'utf8'
  );
  expect(detail).toContain(
    '(event.communityId || eventTasksForDisplay.length > 0)'
  );
  expect(detail).toContain(
    '!event.communityId\n                      ? PERSONAL_TASK_VISIBILITY_DESCRIPTION'
  );
  expect(sheet).toContain(
    '!displayEvent.communityId\n                            ? PERSONAL_TASK_VISIBILITY_DESCRIPTION'
  );
});

it('both production detail label expressions preserve community wording and name personal assignees', () => {
  for (const file of [
    'app/(authenticated)/event/[id].tsx',
    'components/EventDetailsBottomSheet.tsx',
  ]) {
    const source = readFileSync(new URL(file, root), 'utf8');
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let expression: string | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(ast) === 'assignmentLabel'
      )
        expression = node.initializer?.getText(ast);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (!expression)
      throw new Error(`Missing production assignment label in ${file}`);
    for (const mine of [false, true]) {
      for (const community of [false, true]) {
        const label = runInNewContext(expression, {
          event: { communityId: community ? 'community' : undefined },
          displayEvent: { communityId: community ? 'community' : undefined },
          assigneeDisplay: 'שם חשבון',
          isAssignedToCurrentUser: mine,
          hasAssignee: true,
          isAssigned: true,
          task: {},
          ...personalPresentation,
        });
        const expected = !community
          ? 'הוקצה ל־שם חשבון'
          : mine
            ? file.startsWith('components')
              ? '✓ הוקצה אליי'
              : 'הוקצה אליי'
            : file.startsWith('components')
              ? 'הוקצה ל-שם חשבון'
              : 'הוקצה ל־שם חשבון';
        expect(label).toBe(expected);
      }
    }
  }
});

describe('unified personal assignment UX', () => {
  it('editor labels, selected identity, unassign and reassign preserve local task and completion', () => {
    const original = { ...relatedProps.tasks[0], completed: true };
    let draft = [original];
    const h = mount(relatedFile, 'RelatedTasksSection', {
      ...relatedProps,
      personalAssignment: true,
      tasks: draft,
      onChange: (tasks: typeof draft) => {
        draft = tasks;
      },
    });
    const text = (value: string) =>
      h.root.findAllByType('Text').some((n) => n.props.children === value);
    expect(text('הוקצה ל־דנה')).toBe(true);
    h.press('שנה הקצאה: כוסות');
    expect(text('שינוי הקצאה')).toBe(true);
    expect(
      h.root.findAll(
        (n) =>
          n.props.accessibilityLabel === 'דנה' &&
          n.props.accessibilityRole === 'checkbox'
      )[0].props.accessibilityState.checked
    ).toBe(true);
    h.press('בטל הקצאה');
    expect(draft).toEqual([{ ...original, assignedParticipantIds: [] }]);
    expect(original.assignedParticipantIds).toEqual([owner]);
    h.update({ tasks: draft });
    expect(text('לא הוקצה')).toBe(true);
    h.press('הקצה: כוסות');
    expect(text('הקצאת משימה')).toBe(true);
    h.press('שני');
    expect(draft[0].assignedParticipantIds).toEqual([]);
    h.press('שמור הקצאה');
    expect(draft).toEqual([{ ...original, assignedParticipantIds: [other] }]);
    h.update({ tasks: draft });
    expect(text('הוקצה ל־שני')).toBe(true);
    h.press('שנה הקצאה: כוסות');
    act(() => h.root.findByType('Modal').props.onRequestClose());
    expect(draft[0].assignedParticipantIds).toEqual([other]);
    h.dispose();
  });
  for (const platform of ['ios', 'android']) {
    it(`${platform}: personal details sheet selects by ID, shows account avatar and restricts actions`, () => {
      const selected: string[] = [];
      let cleared = 0;
      const props = {
        visible: true,
        personalAssignment: true,
        isCreator: true,
        currentAssignee: { type: 'user', userId: other, display: 'שם זהה' },
        members: [
          { userId: owner, fullName: 'שם זהה', color: '#123456' },
          { userId: other, fullName: 'שם זהה', color: '#654321' },
        ],
        currentUserId: owner,
        manualName: '',
        allowManualAssignee: false,
        onManualNameChange() {},
        onSelectManual() {},
        onClose() {},
        onSelectUser: (id: string) => selected.push(id),
        onUnassign: () => {
          cleared++;
        },
      };
      const h = mount(
        'lib/components/event/TaskAssigneeSheet.tsx',
        'TaskAssigneeSheet',
        props,
        platform,
        48
      );
      const rows = () =>
        h.root.findAll(
          (n) =>
            n.props.accessibilityLabel === 'שם זהה' &&
            n.props.accessibilityRole === 'button'
        );
      expect(rows().map((n) => n.props.accessibilityState.selected)).toEqual([
        false,
        true,
      ]);
      expect(
        h.root
          .findAllByType('View')
          .some((n) => flatten(n.props.style).backgroundColor === '#654321')
      ).toBe(true);
      act(() => rows()[0].props.onPress());
      expect(selected).toEqual([owner]);
      h.press('בטל הקצאה');
      expect(cleared).toBe(1);
      h.update({ busy: true });
      expect(rows().every((n) => n.props.disabled)).toBe(true);
      h.update({ busy: false, currentAssignee: null });
      expect(
        h.root.findAll((n) => n.props.accessibilityLabel === 'בטל הקצאה')
      ).toHaveLength(0);
      h.update({ isCreator: false, currentAssignee: props.currentAssignee });
      expect(h.root.findAllByType('TouchableOpacity')).toHaveLength(0);
      h.dispose();
    });
  }
});
