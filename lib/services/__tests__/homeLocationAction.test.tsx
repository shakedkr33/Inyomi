import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import type { HomeDailyItem } from '../../../components/home/HomeDailyCommandCenter';
import { colors } from '../../../theme/colors';
import * as navigation from '../../homeEventNavigation';
import * as meetingLink from '../../meetingLink';
import * as classification from '../../taskClassification';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const source = readFileSync(
  new URL(
    '../../../components/home/HomeDailyCommandCenter.tsx',
    import.meta.url
  ),
  'utf8'
);
// Export the real internal card only in this VM; production code is unmodified.
const code = ts.transpileModule(`${source}\nexport { UnifiedTimelineCard };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports: Record<string, unknown> = {};
runInNewContext(code, {
  exports,
  require: (name: string) => {
    if (name === 'convex/react') return { useMutation: () => async () => {} };
    if (name === '@/convex/_generated/api')
      return {
        api: new Proxy(
          {},
          { get: () => new Proxy({}, { get: (_, key) => String(key) }) }
        ),
      };
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'react-native')
      return {
        ...Object.fromEntries(
          ['View', 'Text', 'Image', 'Pressable', 'ScrollView'].map((n) => [
            n,
            n,
          ])
        ),
        StyleSheet: { create: (s: unknown) => s },
      };
    if (name === '@/lib/homeEventNavigation') return navigation;
    if (name === '@/lib/meetingLink') return meetingLink;
    if (name === '@/lib/taskClassification') return classification;
    if (name === '@/theme/colors') return { colors };
    if (name === '@/lib/rtl')
      return {
        rtl: { flexDirection: 'row', textAlign: 'right' },
        getTextAlign: () => 'right',
      };
    if (name === '@/lib/avatarInitials')
      return { getAvatarInitials: () => 'A' };
    return new Proxy({}, { get: (_, key) => String(key) });
  },
});
const Card = exports.UnifiedTimelineCard as React.ComponentType<{
  item: HomeDailyItem;
  temporalState: 'upcoming' | 'active';
  displayMode: 'compact' | 'featured';
  nowMs: number;
  onOpen: () => void;
  onNavigate: () => void;
  onOpenRemoteUrl: () => void;
}>;
for (const community of [false, true])
  for (const displayMode of ['compact', 'featured'] as const)
    for (const kind of [
      'google',
      'manual',
      'imported',
      'legacy',
      'link',
      'empty',
      'unsafe',
    ] as const) {
      it(`${community ? 'community' : 'personal'} ${displayMode} card renders and invokes ${kind} location action`, () => {
        let navigated = 0,
          opened = 0;
        const item = {
          id: 'event',
          title: 'Event',
          time: '10:00',
          type: 'event',
          completed: false,
          location: ['link', 'empty', 'unsafe'].includes(kind) ? '' : 'Address',
          googlePlaceId: kind === 'google' ? 'place' : undefined,
          locationUrl: kind === 'legacy' ? 'geo:1,2' : undefined,
          remoteUrl:
            kind === 'link'
              ? 'meet.google.com/abc'
              : kind === 'unsafe'
                ? 'javascript:alert(1)'
                : undefined,
          ...(community
            ? { communityId: 'community', groupName: 'Group' }
            : {}),
        } as HomeDailyItem;
        let renderer!: ReturnType<typeof create>;
        act(() => {
          renderer = create(
            <Card
              item={item}
              temporalState="upcoming"
              displayMode={displayMode}
              nowMs={Date.now()}
              onOpen={() => {}}
              onNavigate={() => {
                navigated++;
              }}
              onOpenRemoteUrl={() => {
                opened++;
              }}
            />
          );
        });
        const buttons = renderer.root.findAllByType('Pressable');
        const label = kind === 'link' ? 'הצטרפות לפגישה' : 'ניווט';
        const button = buttons.find(
          (n) => n.props.accessibilityLabel === label
        );
        if (kind === 'empty' || kind === 'unsafe')
          expect(button).toBeUndefined();
        else {
          expect(button).toBeDefined();
          act(() => button?.props.onPress());
          expect(navigated).toBe(kind === 'link' ? 0 : 1);
          expect(opened).toBe(kind === 'link' ? 1 : 0);
        }
        act(() => renderer.unmount());
      });
    }

it('real command center forwards the Place ID to the navigation picker callback', () => {
  const Center = exports.HomeDailyCommandCenter as React.ComponentType<
    Record<string, unknown>
  >;
  const calls: unknown[][] = [];
  const now = Date.now();
  const item = {
    id: 'event',
    title: 'Destination',
    time: '10:00',
    startAt: now + 3600000,
    endAt: now + 7200000,
    type: 'event',
    completed: false,
    location: 'Address',
    googlePlaceId: 'place_selected',
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <Center
        selectedDate={new Date(now)}
        nowMs={now}
        scheduledItems={[item]}
        allDayItems={[]}
        overdueTasks={[]}
        untimedTasks={[]}
        undatedTaskCount={0}
        undatedTasks={[]}
        completedTodayTasksAllSources={[]}
        birthdays={[]}
        hasAnyBirthdays={false}
        myImportantItemsBundleStatus={{}}
        onNavigate={(...args: unknown[]) => calls.push(args)}
      />
    );
  });
  const button = renderer.root
    .findAllByType('Pressable')
    .find((n) => n.props.accessibilityLabel === 'ניווט');
  expect(button).toBeDefined();
  act(() => button?.props.onPress());
  expect(calls).toEqual([['Address', undefined, 'place_selected']]);
  act(() => renderer.unmount());
});
