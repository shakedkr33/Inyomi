import { describe, expect, it } from 'bun:test';
import type { MutationCtx } from '../../convex/_generated/server';
import * as events from '../../convex/events';
import {
  extractEventStorageIds,
  extractTaskStorageIds,
  releaseStorageReferencesForParent,
  syncStorageReferencesForParent,
} from '../../convex/storageLifecycle';
import * as tasks from '../../convex/tasks';

type Row = { _id: string; [key: string]: unknown };
type Predicate = (row: Row) => boolean;

class Query {
  private predicates: Predicate[] = [];
  constructor(private readonly rows: Row[]) {}
  eq(key: string, value: unknown) {
    this.predicates.push((row) => row[key] === value);
    return this;
  }
  withIndex(_name: string, build: (q: Query) => unknown) {
    build(this);
    return this;
  }
  async collect() {
    return this.rows.filter((row) =>
      this.predicates.every((test) => test(row))
    );
  }
  async first() {
    return (await this.collect())[0] ?? null;
  }
  async unique() {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error('Non-unique fixture result');
    return rows[0] ?? null;
  }
}

function fixture(currentUserId = 'owner') {
  const tables: Record<string, Row[]> = {
    users: [
      { _id: 'owner', isActive: true },
      { _id: 'other', isActive: true },
    ],
    authSessions: [
      {
        _id: 'session',
        userId: currentUserId,
        expirationTime: Date.now() + 60_000,
      },
    ],
    authRefreshTokens: [{ _id: 'refresh', sessionId: 'session' }],
    events: [],
    tasks: [],
    eventTasks: [],
    members: [],
    communities: [],
    communityMembers: [],
    storageUploadIntents: [],
    storageFiles: [],
    storageReferences: [],
    taskParticipantSettings: [],
    scheduledReminders: [],
    savedCommunityEvents: [],
  };
  const storageObjects = new Set<string>();
  let sequence = 0;
  let physicalDeletes = 0;
  const get = async (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  const ctx = {
    auth: {
      getUserIdentity: async () => ({
        subject: `${currentUserId}|session`,
      }),
    },
    db: {
      get,
      normalizeId: (_table: string, id: string) => id,
      query: (table: string) => new Query(tables[table] ?? []),
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}:new:${++sequence}`;
        tables[table] ??= [];
        tables[table].push({ ...value, _id: id });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        const row = await get(id);
        if (!row) throw new Error('Missing fixture row');
        Object.assign(row, value);
      },
      delete: async (id: string) => {
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) rows.splice(index, 1);
        }
      },
      system: {
        get: async (id: string) =>
          storageObjects.has(id) ? { _id: id, size: 1 } : null,
      },
    },
    storage: {
      generateUploadUrl: async () => 'https://upload.invalid',
      delete: async (id: string) => {
        physicalDeletes += 1;
        storageObjects.delete(id);
      },
      getUrl: async (id: string) =>
        storageObjects.has(id) ? `https://storage.invalid/${id}` : null,
    },
    scheduler: {
      runAfter: async () => 'scheduled',
      cancel: async () => undefined,
    },
  };
  return {
    ctx,
    tables,
    storageObjects,
    physicalDeleteCount: () => physicalDeletes,
  };
}

function invoke(
  handler: unknown,
  ctx: ReturnType<typeof fixture>['ctx'],
  args: object
) {
  return (
    handler as {
      _handler: (context: typeof ctx, values: object) => Promise<unknown>;
    }
  )._handler(ctx, args);
}

async function transaction(
  f: ReturnType<typeof fixture>,
  handler: unknown,
  args: object
) {
  const before = structuredClone(f.tables);
  try {
    return await invoke(handler, f.ctx, args);
  } catch (error) {
    for (const key of Object.keys(f.tables)) delete f.tables[key];
    Object.assign(f.tables, before);
    throw error;
  }
}

const attachment = (storageId: string) => ({
  storageId,
  originalName: `${storageId}.jpg`,
  displayName: storageId,
  mimeType: 'image/jpeg',
  sizeBytes: 10,
});

function seedManagedUpload(
  f: ReturnType<typeof fixture>,
  storageId: string,
  options?: { userId?: string; expiresAt?: number; state?: string }
) {
  const intentId = `intent-${storageId}`;
  const userId = options?.userId ?? 'owner';
  f.storageObjects.add(storageId);
  f.tables.storageUploadIntents.push({
    _id: intentId,
    userId,
    state: options?.state ?? 'uploaded',
    createdAt: 1,
    expiresAt: options?.expiresAt ?? Date.now() + 60_000,
    updatedAt: 1,
    storageId,
  });
  f.tables.storageFiles.push({
    _id: `file-${storageId}`,
    storageId,
    origin: 'managed',
    uploadedBy: userId,
    uploadIntentId: intentId,
    registeredAt: 1,
    updatedAt: 1,
  });
  return intentId;
}

describe('Stage 1 storage reference tracking', () => {
  it('rejects another account acquiring an unverified intent file', async () => {
    const f = fixture('other');
    seedManagedUpload(f, 'file');
    f.tables.storageFiles[0].origin = 'legacy';
    delete f.tables.storageFiles[0].uploadedBy;
    const before = structuredClone(f.tables);
    await expect(
      transaction(f, tasks.create, {
        title: 'QA',
        attachments: [attachment('file')],
      })
    ).rejects.toThrow();
    expect(f.tables).toEqual(before);
  });

  it('binds an unverified receipt without granting uploader or cleanup authority', async () => {
    const f = fixture();
    const { intentId } = (await invoke(
      events.createStorageUploadIntent,
      f.ctx,
      {}
    )) as { intentId: string };
    f.storageObjects.add('new');
    await invoke(events.registerStorageUpload, f.ctx, {
      intentId,
      storageId: 'new',
    });
    await invoke(tasks.create, f.ctx, {
      title: 'QA',
      attachments: [attachment('new')],
    });
    expect(f.tables.storageUploadIntents[0].state).toBe('bound');
    expect(f.tables.storageReferences).toHaveLength(1);
    expect(f.tables.storageFiles[0].uploadedBy).toBeUndefined();
    expect(f.tables.storageFiles[0].cleanupEligibleAt).toBeUndefined();
    const before = structuredClone(f.tables);
    await invoke(events.registerStorageUpload, f.ctx, {
      intentId,
      storageId: 'new',
    });
    expect(f.tables).toEqual(before);
    await expect(
      transaction(f, events.registerStorageUpload, {
        intentId,
        storageId: 'different',
      })
    ).rejects.toThrow();
    expect(f.tables).toEqual(before);
  });

  for (const kind of ['registered', 'reference', 'parent']) {
    it(`rejects registration of ${kind} files without modifying existing data`, async () => {
      const f = fixture('other');
      f.storageObjects.add('file');
      if (kind === 'registered') seedManagedUpload(f, 'file');
      if (kind === 'reference')
        f.tables.storageReferences.push({
          _id: 'ref',
          storageId: 'file',
          parentType: 'event',
          parentId: 'p',
        });
      if (kind === 'parent')
        f.tables.events.push({
          _id: 'p',
          createdBy: 'owner',
          attachments: [attachment('file')],
        });
      const { intentId } = (await invoke(
        events.createStorageUploadIntent,
        f.ctx,
        {}
      )) as { intentId: string };
      const before = structuredClone(f.tables);
      await expect(
        transaction(f, events.registerStorageUpload, {
          intentId,
          storageId: 'file',
        })
      ).rejects.toThrow();
      expect(f.tables).toEqual(before);
    });
  }

  it('rejects expired receipt replay and inconsistent registry binding', async () => {
    const f = fixture();
    const intentId = seedManagedUpload(f, 'file', {
      expiresAt: Date.now() - 1,
    });
    await expect(
      transaction(f, events.registerStorageUpload, {
        intentId,
        storageId: 'file',
      })
    ).rejects.toThrow();
    f.tables.storageUploadIntents[0].expiresAt = Date.now() + 60_000;
    f.tables.storageFiles[0].uploadIntentId = 'different';
    const before = structuredClone(f.tables);
    await expect(
      transaction(f, events.registerStorageUpload, {
        intentId,
        storageId: 'file',
      })
    ).rejects.toThrow();
    expect(f.tables).toEqual(before);
  });

  for (const community of [false, true]) {
    it(`rejects unauthorized inline ${community ? 'community' : 'personal'} removal`, async () => {
      const f = fixture('other');
      f.tables.tasks.push({
        _id: 'task',
        title: 'QA',
        createdBy: 'owner',
        ...(community ? { communityId: 'c' } : {}),
        subtasks: [{ id: 's', image: { storageId: 'file' } }],
      });
      const before = structuredClone(f.tables);
      await expect(
        transaction(f, tasks.setSubtaskAttachment, {
          id: 'task',
          subtaskId: 's',
        })
      ).rejects.toThrow();
      expect(f.tables).toEqual(before);
    });
  }

  for (const user of ['owner', 'other']) {
    it(`does not attribute an unknown object to registering user ${user}`, async () => {
      const f = fixture(user);
      f.storageObjects.add('unknown');
      const { intentId } = (await invoke(
        events.createStorageUploadIntent,
        f.ctx,
        {}
      )) as { intentId: string };
      await invoke(events.registerStorageUpload, f.ctx, {
        intentId,
        storageId: 'unknown',
      });
      expect(f.tables.storageFiles[0]).toMatchObject({ origin: 'legacy' });
      expect(f.tables.storageFiles[0]).not.toHaveProperty('uploadedBy');
      expect(f.tables.storageFiles[0]).not.toHaveProperty('cleanupEligibleAt');
    });
  }

  for (const community of [false, true]) {
    for (const mode of ['image', 'attachment', 'both']) {
      for (const replace of [false, true]) {
        it(`inline ${community ? 'community' : 'personal'} ${mode} ${replace ? 'replacement' : 'removal'} preserves the other slot`, async () => {
          const f = fixture();
          if (community) {
            f.tables.communities.push({ _id: 'c', ownerId: 'owner' });
            f.tables.communityMembers.push({
              _id: 'cm',
              communityId: 'c',
              userId: 'owner',
              role: 'owner',
              status: 'active',
            });
          }
          for (const id of ['image', 'attachment', 'new'])
            seedManagedUpload(f, id);
          const value = (id: string) => ({
            id,
            type: 'image',
            storageId: id,
            mimeType: 'image/png',
            sizeBytes: 1,
            createdAt: 1,
          });
          const id = await invoke(tasks.create, f.ctx, {
            title: 'QA',
            ...(community ? { communityId: 'c' } : {}),
            subtasks: [
              {
                id: 's',
                title: 'QA',
                completed: false,
                ...(mode !== 'attachment' ? { image: value('image') } : {}),
                ...(mode !== 'image'
                  ? { attachment: value('attachment') }
                  : {}),
              },
            ],
          });
          // Full editor save/reopen must retain every legitimate slot too.
          const created = await f.ctx.db.get(id as string);
          await invoke(tasks.update, f.ctx, {
            id,
            subtasks: created?.subtasks,
          });
          const reopened = await f.ctx.db.get(id as string);
          expect([...extractTaskStorageIds(reopened as never)].sort()).toEqual(
            (mode === 'both' ? ['attachment', 'image'] : [mode]).sort()
          );
          const displayedId = mode === 'image' ? 'image' : 'attachment';
          expect(
            await invoke(tasks.getTaskAttachmentUrl, f.ctx, {
              taskId: id,
              storageId: displayedId,
            })
          ).toBe(`https://storage.invalid/${displayedId}`);
          expect(
            await invoke(tasks.getTaskAttachmentUrl, f.ctx, {
              taskId: id,
              storageId: 'new',
            })
          ).toBeNull();
          await invoke(tasks.setSubtaskAttachment, f.ctx, {
            id,
            subtaskId: 's',
            ...(replace ? { attachment: value('new') } : {}),
          });
          const expected = [
            ...(mode === 'both' ? ['image'] : []),
            ...(replace ? ['new'] : []),
          ].sort();
          const parent = await f.ctx.db.get(id as string);
          expect([...extractTaskStorageIds(parent as never)].sort()).toEqual(
            expected
          );
          expect(
            f.tables.storageReferences
              .filter((r) => r.parentId === id)
              .map((r) => r.storageId)
              .sort()
          ).toEqual(expected);
          expect(f.physicalDeleteCount()).toBe(0);
          f.tables.authSessions[0].userId = 'other';
          const outsider = {
            ...f.ctx,
            auth: {
              getUserIdentity: async () => ({ subject: 'other|session' }),
            },
          };
          expect(
            await invoke(tasks.getTaskAttachmentUrl, outsider, {
              taskId: id,
              storageId: expected[0] ?? displayedId,
            })
          ).toBeNull();
        });
      }
    }
  }

  it('extracts unique IDs from every approved event/task location', () => {
    expect([
      ...extractEventStorageIds({
        attachments: [attachment('a'), attachment('a')],
      }),
    ]).toEqual(['a']);
    expect(
      [
        ...extractTaskStorageIds({
          attachments: [attachment('a')],
          subtasks: [
            {
              id: '1',
              title: 'One',
              completed: false,
              image: {
                storageId: 'b',
                mimeType: 'image/png',
                sizeBytes: 1,
                createdAt: 1,
              },
            },
            {
              id: '2',
              title: 'Two',
              completed: false,
              attachment: {
                id: 'x',
                type: 'file',
                storageId: 'c',
                mimeType: 'text/plain',
                sizeBytes: 1,
                createdAt: 1,
              },
            },
            {
              id: '3',
              title: 'Three',
              completed: false,
              attachment: {
                id: 'y',
                type: 'file',
                storageId: 'a',
                mimeType: 'text/plain',
                sizeBytes: 1,
                createdAt: 1,
              },
            },
          ],
        }),
      ].sort()
    ).toEqual(['a', 'b', 'c']);
  });

  it('creates one indexed reference for one or multiple event attachments', async () => {
    const f = fixture();
    const eventId = (await invoke(events.create, f.ctx, {
      title: 'Event',
      startTime: 1,
      endTime: 2,
      attachments: [attachment('a'), attachment('b')],
    })) as string;
    expect(f.tables.storageReferences).toHaveLength(2);
    expect(f.tables.storageReferences.map((row) => row.parentId)).toEqual([
      eventId,
      eventId,
    ]);
    expect(f.tables.storageFiles.every((row) => row.origin === 'legacy')).toBe(
      true
    );
  });

  it('binds managed personal and community event uploads to authorized writes', async () => {
    const personal = fixture();
    const intentId = seedManagedUpload(personal, 'managed-event');
    const eventId = await invoke(events.create, personal.ctx, {
      title: 'Personal',
      startTime: 1,
      endTime: 2,
      attachments: [attachment('managed-event')],
    });
    expect(
      personal.tables.storageUploadIntents.find((row) => row._id === intentId)
    ).toMatchObject({
      state: 'bound',
      boundParentType: 'event',
      boundParentId: eventId,
    });

    const community = fixture();
    community.tables.communities.push({
      _id: 'community',
      name: 'C',
      ownerId: 'owner',
      archived: false,
    });
    community.tables.communityMembers.push({
      _id: 'membership',
      communityId: 'community',
      userId: 'owner',
      status: 'active',
      role: 'owner',
    });
    community.tables.spaces = [
      { _id: 'space', ownerId: 'owner', type: 'personal' },
    ];
    community.tables.members = [
      {
        _id: 'access',
        userId: 'owner',
        spaceId: 'space',
        kind: 'access',
        role: 'admin',
      },
    ];
    seedManagedUpload(community, 'community-file');
    const communityEventId = await invoke(events.create, community.ctx, {
      title: 'Community',
      startTime: 1,
      endTime: 2,
      communityId: 'community',
      attachments: [attachment('community-file')],
    });
    expect(community.tables.storageReferences).toContainEqual(
      expect.objectContaining({
        parentId: communityEventId,
        storageId: 'community-file',
      })
    );
  });

  it('tracks task attachments plus subtask image and attachment without duplicates', async () => {
    const f = fixture();
    seedManagedUpload(f, 'same');
    seedManagedUpload(f, 'image');
    seedManagedUpload(f, 'file');
    const id = await invoke(tasks.create, f.ctx, {
      title: 'Task',
      attachments: [attachment('same')],
      subtasks: [
        {
          id: 'one',
          title: 'One',
          completed: false,
          image: {
            storageId: 'image',
            mimeType: 'image/png',
            sizeBytes: 1,
            createdAt: 1,
          },
        },
        {
          id: 'two',
          title: 'Two',
          completed: false,
          attachment: {
            id: 'att',
            type: 'file',
            storageId: 'file',
            mimeType: 'text/plain',
            sizeBytes: 1,
            createdAt: 1,
          },
        },
        {
          id: 'three',
          title: 'Three',
          completed: false,
          attachment: {
            id: 'dup',
            type: 'file',
            storageId: 'same',
            mimeType: 'text/plain',
            sizeBytes: 1,
            createdAt: 1,
          },
        },
      ],
    });
    expect(
      f.tables.storageReferences.map((row) => row.storageId).sort()
    ).toEqual(['file', 'image', 'same']);
    expect(f.tables.storageReferences.every((row) => row.parentId === id)).toBe(
      true
    );
    expect(
      f.tables.storageUploadIntents.every((row) => row.state === 'bound')
    ).toBe(true);
  });

  it('tracks a community task attachment through the task lifecycle', async () => {
    const f = fixture();
    f.tables.communities.push({
      _id: 'community',
      name: 'C',
      ownerId: 'owner',
      archived: false,
    });
    f.tables.communityMembers.push({
      _id: 'membership',
      communityId: 'community',
      userId: 'owner',
      status: 'active',
      role: 'owner',
    });
    seedManagedUpload(f, 'community-task-file');
    const taskId = await invoke(tasks.create, f.ctx, {
      title: 'Community task',
      communityId: 'community',
      attachments: [attachment('community-task-file')],
    });
    expect(f.tables.storageReferences).toContainEqual(
      expect.objectContaining({
        parentType: 'task',
        parentId: taskId,
        storageId: 'community-task-file',
      })
    );
  });

  it('reconciles attachment replacement/removal and subtask removal', async () => {
    const f = fixture();
    f.tables.tasks.push({
      _id: 'task',
      title: 'Task',
      createdBy: 'owner',
      assignedTo: 'owner',
      completed: false,
      isAiGenerated: false,
      createdAt: 1,
      attachments: [
        { ...attachment('old'), uploadedBy: 'owner', uploadedAt: 1 },
      ],
      subtasks: [
        {
          id: 'sub',
          title: 'Sub',
          completed: false,
          attachment: {
            id: 'x',
            type: 'file',
            storageId: 'sub-file',
            mimeType: 'text/plain',
            sizeBytes: 1,
            createdAt: 1,
          },
        },
      ],
    });
    await syncStorageReferencesForParent(f.ctx as unknown as MutationCtx, {
      parentType: 'task',
      parentId: 'task',
      before: new Set(),
      after: new Set(['old', 'sub-file']) as never,
      actorUserId: 'owner' as never,
    });
    await invoke(tasks.update, f.ctx, {
      id: 'task',
      attachments: [attachment('new')],
    });
    expect(
      f.tables.storageReferences.map((row) => row.storageId).sort()
    ).toEqual(['new', 'sub-file']);
    await invoke(tasks.removeSubtask, f.ctx, { id: 'task', subtaskId: 'sub' });
    expect(f.tables.storageReferences.map((row) => row.storageId)).toEqual([
      'new',
    ]);
  });

  it('does not bind an upload when parent validation fails', async () => {
    const f = fixture();
    const intentId = seedManagedUpload(f, 'managed');
    await expect(
      transaction(f, events.create, {
        title: 'Invalid',
        startTime: 1,
        endTime: 2,
        attachments: [attachment('managed'), attachment('b'), attachment('c')],
      })
    ).rejects.toThrow();
    expect(
      f.tables.storageUploadIntents.find((row) => row._id === intentId)?.state
    ).toBe('uploaded');
    expect(f.tables.storageReferences).toHaveLength(0);
  });

  it('rejects expired intents and another user uploads', async () => {
    const expired = fixture();
    seedManagedUpload(expired, 'expired', { expiresAt: Date.now() - 1 });
    await expect(
      transaction(expired, events.create, {
        title: 'Expired',
        startTime: 1,
        endTime: 2,
        attachments: [attachment('expired')],
      })
    ).rejects.toThrow('פג');

    const foreign = fixture();
    seedManagedUpload(foreign, 'foreign', { userId: 'other' });
    await expect(
      transaction(foreign, tasks.create, {
        title: 'Foreign',
        attachments: [attachment('foreign')],
      })
    ).rejects.toThrow('מחשבון אחר');
  });

  it('rejects cross-parent reuse, including a legacy parent with no registry rows', async () => {
    const f = fixture();
    f.tables.events.push({
      _id: 'legacy-event',
      createdBy: 'owner',
      attachments: [attachment('legacy-shared')],
    });
    await expect(
      transaction(f, tasks.create, {
        title: 'Hijack',
        attachments: [attachment('legacy-shared')],
      })
    ).rejects.toThrow('לא ניתן לצרף');
    expect(f.tables.storageReferences).toHaveLength(0);

    const managed = fixture();
    seedManagedUpload(managed, 'managed-shared');
    await invoke(events.create, managed.ctx, {
      title: 'First',
      startTime: 1,
      endTime: 2,
      attachments: [attachment('managed-shared')],
    });
    await expect(
      transaction(managed, tasks.create, {
        title: 'Second',
        attachments: [attachment('managed-shared')],
      })
    ).rejects.toThrow('לא ניתן לצרף');
  });

  it('keeps legacy compatibility without claiming uploader ownership', async () => {
    const f = fixture();
    await invoke(events.create, f.ctx, {
      title: 'Legacy',
      startTime: 1,
      endTime: 2,
      attachments: [attachment('legacy')],
    });
    expect(f.tables.storageFiles[0]).toMatchObject({
      storageId: 'legacy',
      origin: 'legacy',
    });
    expect(f.tables.storageFiles[0]).not.toHaveProperty('uploadedBy');
    expect(f.tables.storageUploadIntents).toHaveLength(0);
  });

  it('keeps sync idempotent and one parent/file row under repeated acquisition', async () => {
    const f = fixture();
    const args = {
      parentType: 'event' as const,
      parentId: 'event',
      before: new Set() as never,
      after: new Set(['file']) as never,
      actorUserId: 'owner' as never,
    };
    await syncStorageReferencesForParent(f.ctx as unknown as MutationCtx, args);
    await syncStorageReferencesForParent(f.ctx as unknown as MutationCtx, args);
    expect(f.tables.storageFiles).toHaveLength(1);
    expect(f.tables.storageReferences).toHaveLength(1);
  });

  it('releases only the deleted parent and never physically deletes storage', async () => {
    const f = fixture();
    f.tables.storageReferences.push(
      {
        _id: 'ref-a',
        storageId: 'shared',
        parentType: 'event',
        parentId: 'a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: 'ref-b',
        storageId: 'shared',
        parentType: 'event',
        parentId: 'b',
        createdAt: 1,
        updatedAt: 1,
      }
    );
    await releaseStorageReferencesForParent(
      f.ctx as unknown as MutationCtx,
      'event',
      'a'
    );
    expect(f.tables.storageReferences).toEqual([
      expect.objectContaining({ _id: 'ref-b' }),
    ]);
    expect(f.physicalDeleteCount()).toBe(0);
  });

  it('creates/finalizes upload intents idempotently and rejects foreign finalization', async () => {
    const f = fixture();
    const created = (await invoke(
      events.createStorageUploadIntent,
      f.ctx,
      {}
    )) as { intentId: string; uploadUrl: string };
    f.storageObjects.add('uploaded');
    await invoke(events.registerStorageUpload, f.ctx, {
      intentId: created.intentId,
      storageId: 'uploaded',
    });
    await invoke(events.registerStorageUpload, f.ctx, {
      intentId: created.intentId,
      storageId: 'uploaded',
    });
    expect(f.tables.storageFiles).toHaveLength(1);
    expect(f.tables.storageFiles[0]).toMatchObject({
      origin: 'legacy',
    });
    expect(f.tables.storageFiles[0]).not.toHaveProperty('uploadedBy');

    const foreign = fixture('other');
    foreign.tables.storageUploadIntents.push({
      ...f.tables.storageUploadIntents[0],
    });
    foreign.storageObjects.add('uploaded');
    await expect(
      invoke(events.registerStorageUpload, foreign.ctx, {
        intentId: created.intentId,
        storageId: 'uploaded',
      })
    ).rejects.toThrow('אינה שייכת');

    const expired = fixture();
    const expiredIntent = (await invoke(
      events.createStorageUploadIntent,
      expired.ctx,
      {}
    )) as { intentId: string };
    const row = expired.tables.storageUploadIntents.find(
      (item) => item._id === expiredIntent.intentId
    );
    if (!row) throw new Error('Missing intent fixture');
    row.expiresAt = Date.now() - 1;
    expired.storageObjects.add('late-upload');
    await expect(
      invoke(events.registerStorageUpload, expired.ctx, {
        intentId: expiredIntent.intentId,
        storageId: 'late-upload',
      })
    ).rejects.toThrow('פג');
  });
});
