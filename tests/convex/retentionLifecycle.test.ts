import { describe, expect, it, spyOn } from 'bun:test';
import type { Id } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';
import * as events from '../../convex/events';
import * as tasks from '../../convex/tasks';
import { safeDeleteStorageIfUnreferenced } from '../../convex/taskUtils';
import { deleteMyAccount } from '../../convex/users';
import { executeAccountDeletion } from '../../lib/accountDeletionUi';
import { invoke, privacyFixture } from './helpers/privacyFixture';

// Actual handlers with synthetic records. The adapter does not simulate hosted
// rollback, validators or transaction limits; blocked plans must perform no writes.
describe('account deletion persistence', () => {
  it('deletes personal data/auth, preserves shared history, rejects old session and retry', async () => {
    const f = privacyFixture();
    f.tables.events[0].ownerScope = 'personal';
    f.tables.events.push({
      _id: 'shared',
      createdBy: 'owner',
      ownerScope: 'family',
      spaceId: 'space',
    });
    f.tables.tasks = [
      { _id: 'task', createdBy: 'owner', ownerScope: 'personal' },
    ];
    f.tables.authAccounts = [{ _id: 'auth', userId: 'owner' }];
    f.tables.pushTokens = [{ _id: 'push', userId: 'owner' }];
    expect(await invoke(deleteMyAccount, f.ctx, {})).toMatchObject({
      success: true,
      deletedEventCount: 1,
      deletedTaskCount: 1,
    });
    expect(f.tables.events.map((row) => row._id)).toEqual(['shared']);
    expect(f.tables.events[0].createdBy).toBe('owner');
    expect(f.tables.users.map((row) => row._id)).toEqual(['viewer']);
    for (const table of [
      'tasks',
      'authAccounts',
      'authSessions',
      'authRefreshTokens',
      'pushTokens',
      'shareLinks',
    ])
      expect(f.tables[table]).toHaveLength(0);
    expect(
      await invoke(events.getById, f.ctx, { eventId: 'shared' })
    ).toBeNull();
    await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow();
  });

  it('ambiguous family linkage preserves all rows on repeated attempts', async () => {
    const f = privacyFixture();
    f.tables.spaces[0].ownerId = 'owner';
    f.tables.spaces[0].name = 'הבית שלנו';
    const viewer = f.tables.users.find((row) => row._id === 'viewer');
    if (!viewer) throw new Error('Missing synthetic viewer');
    viewer.isActive = true;
    const before = structuredClone(f.tables);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
        'נתוני הקישור'
      );
      expect(f.tables).toEqual(before);
    }
  });

  it('preserves community content through the existing successor transfer', async () => {
    const f = privacyFixture();
    f.tables.events[0].ownerScope = 'community';
    f.tables.events[0].communityId = 'community';
    f.tables.communities = [
      { _id: 'community', ownerId: 'owner', name: 'Shared' },
    ];
    f.tables.communityMembers = [
      {
        _id: 'ownerMembership',
        communityId: 'community',
        userId: 'owner',
        role: 'owner',
        status: 'active',
      },
      {
        _id: 'successor',
        communityId: 'community',
        userId: 'viewer',
        role: 'admin',
        status: 'active',
        joinedAt: 1,
        _creationTime: 1,
      },
    ];
    const ctx = {
      ...f.ctx,
      scheduler: { runAfter: async () => 'synthetic-job' },
    };
    expect(await invoke(deleteMyAccount, ctx, {})).toMatchObject({
      success: true,
      transferredCommunityCount: 1,
    });
    expect(f.tables.communities[0].ownerId).toBe('viewer');
    expect(f.tables.communityMembers).toHaveLength(1);
    expect(f.tables.communityMembers[0].role).toBe('owner');
    expect(f.tables.events[0].createdBy).toBe('owner');
    expect(f.tables.userNotifications[0].recipientUserId).toBe('viewer');
  });

  it('blocks over-limit deletion before writes and permits retry when the fixture is within limits', async () => {
    const f = privacyFixture();
    f.tables.events[0].ownerScope = 'personal';
    f.tables.userNotifications = Array.from({ length: 4001 }, (_, i) => ({
      _id: `notification-${i}`,
      recipientUserId: 'owner',
    }));
    const before = structuredClone(f.tables);
    await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
      'הסף הבטוח'
    );
    expect(f.tables).toEqual(before);
    // Synthetic fixture change only; not a proposed production workaround.
    f.tables.userNotifications = [];
    expect(await invoke(deleteMyAccount, f.ctx, {})).toMatchObject({
      success: true,
    });
  });
});

describe('restore deadlines', () => {
  for (const kind of ['event', 'task'] as const) {
    for (const offset of [-1, 0, 1, undefined]) {
      it(`${kind}: deadline offset ${offset}`, async () => {
        const f = privacyFixture();
        const row = {
          _id: kind,
          createdBy: 'owner',
          deletedBy: 'owner',
          deletedAt: 1,
          deleteExpiresAt: offset === undefined ? undefined : 10000 + offset,
        };
        f.tables[kind === 'event' ? 'events' : 'tasks'] = [row];
        const clock = spyOn(Date, 'now').mockReturnValue(10000);
        try {
          const restore = () =>
            invoke(
              kind === 'event'
                ? events.restorePersonalEvent
                : tasks.restoreTask,
              f.ctx,
              kind === 'event' ? { eventId: kind } : { id: kind }
            );
          if (offset !== undefined && offset <= 0) {
            await expect(restore()).rejects.toThrow('תקופת השחזור');
            expect(row.deletedAt).toBe(1);
            expect(f.tables.shareLinks[0].revoked).toBe(false);
          } else {
            await restore();
            expect(row.deletedAt).toBeUndefined();
          }
        } finally {
          clock.mockRestore();
        }
      });
    }
  }
  it('does not restore a non-deleted task with a stale deletedBy', async () => {
    const f = privacyFixture();
    f.tables.tasks = [{ _id: 'task', createdBy: 'owner', deletedBy: 'owner' }];
    await expect(
      invoke(tasks.restoreTask, f.ctx, { id: 'task' })
    ).rejects.toThrow('המשימה לא נמחקה');
  });
});

describe('deleted content access', () => {
  for (const userId of ['owner', 'viewer']) {
    it(`blocks task details and file URL for ${userId}, including deletedAt zero`, async () => {
      const f = privacyFixture(userId);
      f.tables.tasks = [
        {
          _id: 'task',
          createdBy: 'owner',
          assignedTo: 'viewer',
          deletedAt: 0,
          attachments: [{ storageId: 'file' }],
        },
      ];
      expect(
        await invoke(tasks.getTaskDetails, f.ctx, { id: 'task' })
      ).toBeNull();
      // No storage adapter: any URL-generation attempt would fail this test.
      expect(
        await invoke(tasks.getTaskAttachmentUrl, f.ctx, {
          taskId: 'task',
          storageId: 'file',
        })
      ).toBeNull();
    });
  }
  it('deleted account cannot generate attachment URLs or uploads', async () => {
    const f = privacyFixture();
    f.tables.users = [{ _id: 'viewer' }];
    expect(
      await invoke(events.getEventAttachmentUrl, f.ctx, {
        eventId: 'event',
        storageId: 'file',
      })
    ).toBeNull();
    expect(
      await invoke(tasks.getTaskAttachmentUrl, f.ctx, {
        taskId: 'task',
        storageId: 'file',
      })
    ).toBeNull();
    await expect(invoke(events.generateUploadUrl, f.ctx, {})).rejects.toThrow();
  });
});

describe('existing storage cleanup boundary', () => {
  function fixture() {
    const f = privacyFixture();
    let exists = true;
    let deletes = 0;
    const ctx = {
      ...f.ctx,
      db: {
        ...f.ctx.db,
        system: { get: async () => (exists ? { _id: 'file' } : null) },
      },
      storage: {
        delete: async () => {
          deletes++;
          exists = false;
        },
      },
    };
    const clean = () =>
      safeDeleteStorageIfUnreferenced(
        ctx as unknown as MutationCtx,
        'file' as Id<'_storage'>
      );
    return { ...f, ctx, clean, deletes: () => deletes };
  }
  it('removes an unreferenced candidate once and tolerates retry', async () => {
    const f = fixture();
    await f.clean();
    await f.clean();
    expect(f.deletes()).toBe(1);
  });
  for (const location of ['event', 'task', 'image', 'attachment']) {
    it(`preserves a surviving ${location} reference, including trash`, async () => {
      const f = fixture();
      const attachment = { storageId: 'file' };
      if (location === 'event') f.tables.events[0].attachments = [attachment];
      else
        f.tables.tasks = [
          {
            _id: 'other',
            deletedAt: 1,
            ...(location === 'task'
              ? { attachments: [attachment] }
              : { subtasks: [{ [location]: attachment }] }),
          },
        ];
      await f.clean();
      expect(f.deletes()).toBe(0);
    });
  }
  it('propagates storage failure instead of claiming cleanup', async () => {
    const f = fixture();
    f.ctx.storage.delete = async () => {
      throw new Error('storage unavailable');
    };
    await expect(f.clean()).rejects.toThrow('storage unavailable');
  });
  it('can retry a failed storage cleanup without losing the candidate', async () => {
    const f = fixture();
    const deleteFile = f.ctx.storage.delete;
    f.ctx.storage.delete = async () => {
      throw new Error('temporary failure');
    };
    await expect(f.clean()).rejects.toThrow('temporary failure');
    expect(f.deletes()).toBe(0);
    f.ctx.storage.delete = deleteFile;
    await f.clean();
    await f.clean();
    expect(f.deletes()).toBe(1);
  });
  it('excludes only the removed parent and preserves another parent using the same file', async () => {
    const f = fixture();
    f.tables.events[0].attachments = [{ storageId: 'file' }];
    f.tables.tasks = [{ _id: 'other', attachments: [{ storageId: 'file' }] }];
    const cleanRemovedEvent = () =>
      safeDeleteStorageIfUnreferenced(
        f.ctx as unknown as MutationCtx,
        'file' as Id<'_storage'>,
        { eventId: 'event' as Id<'events'> }
      );
    await cleanRemovedEvent();
    expect(f.deletes()).toBe(0);
    f.tables.tasks = [];
    await cleanRemovedEvent();
    expect(f.deletes()).toBe(1);
  });
});

for (const response of [undefined, null, {}, { success: false }]) {
  it(`does not confirm deletion for ${JSON.stringify(response)}`, async () => {
    expect((await executeAccountDeletion(async () => response)).ok).toBe(false);
  });
}
