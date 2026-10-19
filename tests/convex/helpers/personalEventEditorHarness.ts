import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import * as communityAssignmentSave from '../../../lib/communityTaskAssignmentSave';
import * as assignmentDiff from '../../../lib/eventTaskAssignmentDiff';
import * as orderReconcile from '../../../lib/eventTaskOrderReconcile';
import * as meetingLink from '../../../lib/meetingLink';
import * as personalEditing from '../../../lib/personalEventEditing';
import * as personalPresentation from '../../../lib/personalEventTaskPresentation';
import type { EventTask } from '../../../lib/types/event';
import * as eventTypes from '../../../lib/types/event';

// Execute the actual route, form and assignment picker. Only native rendering,
// unrelated cards and the Convex transport are replaced; saving/diffing is real.
const root = new URL('../../../', import.meta.url);
const files = [
  'app/(authenticated)/event-edit/[id].tsx',
  'lib/components/event/EventScreen.tsx',
  'lib/components/event/RelatedTasksSection.tsx',
  'lib/components/event/LocationCard.tsx',
];
const compiled = new Map(
  files.map((file) => [
    file,
    ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
  ])
);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Row = { _id: string; [key: string]: unknown };
export function personalEventEditorHarness(options: {
  event: Row;
  tasks: Row[];
  familyContacts?: Row[];
  realLocationCard?: boolean;
  save: (args: Record<string, unknown>) => Promise<unknown>;
}) {
  const navigations: unknown[] = [];
  const alerts: unknown[][] = [];
  const payloads: Record<string, unknown>[] = [];
  const router = {
    replace: (value: unknown) => navigations.push(value),
    canGoBack: () => true,
    back: () => {},
  };
  const api = Object.fromEntries(
    [
      'events',
      'eventTasks',
      'users',
      'members',
      'communities',
      'shareLinks',
      'googlePlaces',
    ].map((domain) => [
      domain,
      new Proxy({}, { get: (_, name) => `${domain}.${String(name)}` }),
    ])
  );
  const queries: Record<string, unknown> = {
    'events.getById': options.event,
    'eventTasks.listByEvent': options.tasks,
    'users.getMyId': 'owner',
    'users.getCurrentUser': { _id: 'owner', fullName: 'A' },
    'eventTasks.listPersonalAssignees': [
      { userId: 'owner', fullName: 'A' },
      { userId: 'viewer', fullName: 'B' },
    ],
    'members.listMyFamilyContacts': { members: options.familyContacts ?? [] },
  };
  const native = Object.fromEntries(
    [
      'ActivityIndicator',
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
  const mockAction = async () => ({ ok: true, value: [] });
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'expo-crypto': { randomUUID: () => 'test-session' },
    'react-native': {
      ...native,
      Platform: { OS: 'android' },
      StyleSheet: { create: (styles: unknown) => styles },
      Modal: ({
        visible,
        children,
      }: React.PropsWithChildren<{ visible: boolean }>) =>
        visible ? children : null,
      Alert: { alert: (...args: unknown[]) => alerts.push(args) },
      Keyboard: { addListener: () => ({ remove() {} }), dismiss() {} },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      useWindowDimensions: () => ({ height: 800, width: 400 }),
    },
    'react-native-safe-area-context': {
      SafeAreaView: 'SafeAreaView',
      SafeAreaProvider: React.Fragment,
      useSafeAreaInsets: () => ({ bottom: 0 }),
    },
    '@expo/vector-icons': { MaterialIcons: 'Icon', Ionicons: 'Icon' },
    'react-native-draggable-flatlist': {
      __esModule: true,
      default: ({
        data,
        renderItem,
      }: {
        data: Row[];
        renderItem: (args: object) => React.ReactNode;
      }) =>
        data.map((item) =>
          React.createElement(
            React.Fragment,
            { key: String(item.id) },
            renderItem({ item, drag() {}, isActive: false })
          )
        ),
      OpacityDecorator: ({ children }: React.PropsWithChildren) => children,
    },
    'convex/react': {
      useAction: () => mockAction,
      useQuery: (key: string, args: unknown) =>
        args === 'skip' ? undefined : queries[key],
      useMutation: (key: string) => async (args: Record<string, unknown>) => {
        if (key !== 'events.update')
          throw new Error(`Unexpected mutation ${key}`);
        payloads.push(args);
        return options.save(args);
      },
    },
    'expo-router': {
      router,
      useRouter: () => router,
      useLocalSearchParams: () => ({ id: 'event' }),
    },
    '@/convex/_generated/api': { api },
    '@/constants/theme': { colors: { primaryDark: '#000' } },
    '@/lib/rtl': {
      needsExplicitRTL: () => false,
      rtl: { flexDirection: 'row', textAlign: 'right' },
    },
    '@/lib/types/event': eventTypes,
    '@/lib/meetingLink': meetingLink,
    '@/lib/personalEventEditing': personalEditing,
    '@/lib/personalEventTaskPresentation': personalPresentation,
    '@/lib/eventTaskAssignmentDiff': assignmentDiff,
    '@/lib/communityTaskAssignmentSave': communityAssignmentSave,
    '@/lib/eventTaskOrderReconcile': orderReconcile,
    '@/lib/eventDuplication': {
      isDuplicateSaveBlockedByUnconfirmedDate: () => false,
    },
    '@/lib/components/event/DateTimeCard': {
      DateTimeCard: 'DateTimeCard',
      roundToNextHour: (date: Date) => date,
      fmt2: (value: number) => String(value).padStart(2, '0'),
      applyDuration: (date: number) => ({ endDate: date, endTime: '11:00' }),
    },
    './GooglePlacesAttribution': {
      GooglePlacesAttribution: 'GooglePlacesAttribution',
    },
    '@/lib/components/event/LocationCard': { LocationCard: 'LocationCard' },
    ...Object.fromEntries(
      [
        'EventAttachmentsSection',
        'NotesCard',
        'ParticipantsCard',
        'RemindersCard',
      ].map((name) => [`@/lib/components/event/${name}`, { [name]: name }])
    ),
  };
  if (options.realLocationCard)
    delete mocks['@/lib/components/event/LocationCard'];
  const modules = new Map<string, Record<string, unknown>>();
  const load = (file: string): Record<string, unknown> => {
    const cached = modules.get(file);
    if (cached) return cached;
    const source = compiled.get(file);
    if (!source) throw new Error(`Unexpected module ${file}`);
    const exports = {};
    modules.set(file, exports);
    runInNewContext(source, {
      exports,
      AbortController,
      require: (name: string) =>
        name in mocks ? mocks[name] : load(`${name.replace('@/', '')}.tsx`),
      setTimeout: () => 0,
      clearTimeout() {},
      console: { error() {} },
    });
    return exports;
  };
  const Component = load(files[0]).default as React.ComponentType;
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Component));
  });
  const button = (label: string) => {
    const node = renderer.root
      .findAllByType('Pressable')
      .find((item) => item.props.accessibilityLabel === label);
    if (!node) throw new Error(`Missing button ${label}`);
    return node;
  };
  return {
    payloads,
    alerts,
    navigations,
    taskState: () =>
      renderer.root.findByType(
        load(files[2]).RelatedTasksSection as React.ComponentType
      ).props.tasks as EventTask[],
    changeTitle: (title: string) =>
      act(() =>
        renderer.root
          .findAllByType('TextInput')
          .find((node) => node.props.accessibilityLabel === 'שם האירוע')
          ?.props.onChangeText(title)
      ),
    get root() {
      return renderer.root;
    },
    press: async (label: string) => {
      await act(async () => {
        await button(label).props.onPress();
      });
    },
    dispose: () => act(() => renderer.unmount()),
  };
}
