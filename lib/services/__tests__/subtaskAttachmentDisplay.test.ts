import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import {
  displayedSubtaskAttachment,
  replaceSubtaskAttachment,
} from '../../subtaskAttachment';
import type { SubTask } from '../../types/task';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const source = readFileSync(
  new URL('../../components/task/SubtasksSection.tsx', import.meta.url),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const legacy = {
  storageId: 'old',
  mimeType: 'image/png',
  sizeBytes: 1,
  createdAt: 1,
};
const attachment = {
  ...legacy,
  storageId: 'new',
  id: 'a',
  type: 'image' as const,
  originalName: 'a.png',
  displayName: 'תמונה',
};
const base = { id: 's', title: 'QA', completed: false };

async function harness(
  options: {
    subtask?: SubTask;
    local?: boolean;
    noTask?: boolean;
    response?: string | null;
    reject?: boolean;
    pending?: boolean;
  } = {}
) {
  const requests: unknown[] = [];
  const opened: string[] = [];
  const timers = new Set<() => void>();
  let response =
    options.response === undefined
      ? 'https://example.test/image'
      : options.response;
  let reject = options.reject;
  const client = {
    query: async (_query: unknown, args: unknown) => {
      requests.push(args);
      if (options.pending) return new Promise(() => {});
      if (reject) throw new Error('offline');
      return response;
    },
  };
  const mocks: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'convex/react': { useConvex: () => client },
    '@expo/vector-icons': { MaterialIcons: 'Icon' },
    'react-native': Object.fromEntries([
      ...[
        'ActivityIndicator',
        'Image',
        'Pressable',
        'Text',
        'View',
        'TextInput',
        'Switch',
        'TouchableOpacity',
      ].map((name) => [name, name]),
      ['StyleSheet', { create: (s: unknown) => s }],
      [
        'Linking',
        {
          openURL: async (uri: string) => {
            opened.push(uri);
          },
        },
      ],
    ]),
    'react-native-draggable-flatlist': {},
    '@/convex/_generated/api': {
      api: { tasks: { getTaskAttachmentUrl: 'scoped' } },
    },
    '@/lib/components/attachments/AttachmentSourceSheet': {},
    '@/lib/components/task/SubtaskImagePreviewModal': {},
    '@/lib/rtl': { rtl: {} },
    '@/lib/subtaskAttachment': {
      displayedSubtaskAttachment,
      replaceSubtaskAttachment,
    },
  };
  const exports: Record<string, React.ComponentType<object>> = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
      return mocks[name];
    },
    setTimeout: (fn: () => void) => {
      timers.add(fn);
      return fn;
    },
    clearTimeout: (fn: () => void) => timers.delete(fn),
  });
  const att = displayedSubtaskAttachment(
    options.subtask ?? { ...base, attachment }
  );
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      React.createElement(exports.SubtaskAttachmentPreview, {
        taskId: options.noTask ? undefined : 'task',
        attachment: options.local
          ? { ...att, storageId: undefined, localUri: 'file:///picked.png' }
          : att,
        onImageThumbnailPress: (uri: string) => opened.push(uri),
      })
    );
  });
  return {
    requests,
    opened,
    root: () => renderer.root,
    retry: async () => {
      response = 'https://example.test/retry';
      reject = false;
      await act(async () =>
        renderer.root.findByType('Pressable').props.onPress()
      );
    },
    timeout: () =>
      act(() => {
        for (const fn of timers) fn();
      }),
    close: () => act(() => renderer.unmount()),
  };
}

describe('subtask attachment production preview', () => {
  for (const [name, subtask] of Object.entries({
    legacy: { ...base, image: legacy },
    modern: { ...base, attachment },
    both: { ...base, image: legacy, attachment },
  })) {
    it(`${name}: resolves the displayed slot using the task-scoped query and opens`, async () => {
      const h = await harness({ subtask });
      expect(h.requests).toEqual([
        { taskId: 'task', storageId: name === 'legacy' ? 'old' : 'new' },
      ]);
      expect(h.root().findByType('Image').props.source.uri).toBe(
        'https://example.test/image'
      );
      act(() => h.root().findByType('Pressable').props.onPress());
      expect(h.opened).toEqual(['https://example.test/image']);
      h.close();
    });
  }
  it('pre-save local image needs no remote access', async () => {
    const h = await harness({ local: true, noTask: true });
    expect(h.requests).toEqual([]);
    expect(h.root().findByType('Image').props.source.uri).toBe(
      'file:///picked.png'
    );
    h.close();
  });
  for (const options of [
    { response: null },
    { reject: true },
    { noTask: true },
  ]) {
    it(`missing/inaccessible/failed URL is recoverable: ${JSON.stringify(options)}`, async () => {
      const h = await harness(options);
      expect(h.root().findAllByType('ActivityIndicator')).toHaveLength(0);
      expect(
        h.root().findByType('Pressable').props.accessibilityLabel
      ).toContain('ניסיון חוזר');
      if (!options.noTask) {
        await h.retry();
        expect(h.root().findByType('Image').props.source.uri).toContain(
          '/retry'
        );
      }
      h.close();
    });
  }
  it('pending URL lookup times out instead of spinning indefinitely', async () => {
    const h = await harness({ pending: true });
    expect(h.root().findAllByType('ActivityIndicator')).toHaveLength(1);
    h.timeout();
    expect(h.root().findAllByType('ActivityIndicator')).toHaveLength(0);
    h.close();
  });
  it('image download failure permits a fresh authorized URL lookup', async () => {
    const h = await harness();
    act(() => h.root().findByType('Image').props.onError());
    await h.retry();
    expect(h.requests).toHaveLength(2);
    h.close();
  });
  it('stalled image downloads time out, but successful downloads do not', async () => {
    const stalled = await harness();
    stalled.timeout();
    expect(
      stalled.root().findByType('Pressable').props.accessibilityLabel
    ).toContain('ניסיון חוזר');
    stalled.close();
    const loaded = await harness();
    act(() => loaded.root().findByType('Image').props.onLoad());
    loaded.timeout();
    expect(loaded.root().findAllByType('Image')).toHaveLength(1);
    loaded.close();
  });
  it('non-image attachment opens with the system handler', async () => {
    const h = await harness({
      subtask: {
        ...base,
        attachment: {
          ...attachment,
          type: 'file',
          mimeType: 'application/pdf',
        },
      },
    });
    await act(async () => h.root().findByType('Pressable').props.onPress());
    expect(h.opened).toHaveLength(1);
    h.close();
  });
  it('removal/replacement acts only on the displayed slot', () => {
    expect(
      replaceSubtaskAttachment({ ...base, image: legacy }, undefined).image
    ).toBeUndefined();
    expect(
      replaceSubtaskAttachment({ ...base, image: legacy }, attachment).image
    ).toBeUndefined();
    const removed = replaceSubtaskAttachment(
      { ...base, image: legacy, attachment },
      undefined
    );
    expect(displayedSubtaskAttachment(removed)?.storageId).toBe('old');
    expect(
      replaceSubtaskAttachment(
        { ...base, image: legacy, attachment },
        { ...attachment, storageId: 'replacement' }
      ).image
    ).toEqual(legacy);
  });
  it('editor and details wire the same authorized preview with task identity', () => {
    const editor = readFileSync(
      new URL('../../components/task/TaskEditorScreen.tsx', import.meta.url),
      'utf8'
    );
    const details = readFileSync(
      new URL(
        '../../../components/tasks/TaskDetailsBottomSheet.tsx',
        import.meta.url
      ),
      'utf8'
    );
    expect(editor).toMatch(/<SubtasksSection\s+taskId=\{taskId\}/);
    expect(details).toMatch(
      /<SubtaskAttachmentPreview[\s\S]*?taskId=\{taskId as Id<'tasks'>\}[\s\S]*?displayedSubtaskAttachment\(sub\)/
    );
  });
});
