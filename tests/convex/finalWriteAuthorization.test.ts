import { describe, expect, it } from 'bun:test';
import {
  setRsvpNoAndUnclaimMyEventTasks,
  upsertRsvp,
} from '../../convex/eventRsvps';
import { setAssignee } from '../../convex/eventTasks';
import { importGoogleCalendar } from '../../convex/googleImport';
import { copyLinkedEvent } from '../../convex/linkedEvents';
import { finishOnboarding } from '../../convex/onboarding';

// Actual handlers and auth/resolvers. Synthetic DB; no transaction/runtime emulation.
type Row = { _id: string; [key: string]: unknown };
type Predicate = (row: Row) => boolean;
const expressions = {
  field: (key: string) => (row: Row) => row[key],
  eq:
    (field: (row: Row) => unknown, value: unknown): Predicate =>
    (row) =>
      field(row) === value,
};
class Query {
  predicates: Predicate[] = [];
  constructor(private rows: Row[]) {}
  eq(key: string, value: unknown) {
    this.predicates.push((row) => row[key] === value);
    return this;
  }
  withIndex(_name: string, build: (q: Query) => unknown) {
    build(this);
    return this;
  }
  filter(build: (e: typeof expressions) => Predicate) {
    this.predicates.push(build(expressions));
    return this;
  }
  async collect() {
    return this.rows.filter((row) => this.predicates.every((p) => p(row)));
  }
  async first() {
    return (await this.collect())[0] ?? null;
  }
  async unique() {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error('Non-unique fixture');
    return rows[0] ?? null;
  }
}
const access = {
  _id: 'access',
  userId: 'viewer',
  spaceId: 'space',
  kind: 'access',
  role: 'member',
};
const entity = {
  _id: 'entity',
  userId: 'viewer',
  matchedUserId: 'viewer',
  spaceId: 'space',
  kind: 'entity',
  displayName: 'Viewer',
  inviteStatus: 'joined',
};
function fixture(userId: string | null = 'viewer') {
  const tables: Record<string, Row[]> = structuredClone({
    users: [{ _id: 'viewer' }, { _id: 'owner' }],
    spaces: [{ _id: 'space', type: 'family', ownerId: 'owner' }],
    members: [access, entity],
    events: [
      {
        _id: 'event',
        createdBy: 'owner',
        spaceId: 'space',
        title: 'Live',
        startTime: 100,
        endTime: 200,
        allDay: true,
        description: 'Private',
      },
    ],
    linkedEvents: [
      {
        _id: 'linked',
        sourceEventId: 'event',
        savedByUserId: 'viewer',
        spaceId: 'space',
        sourceStatus: 'active',
        snapshotTitle: 'Snapshot',
        snapshotStartTime: 10,
        snapshotEndTime: 20,
      },
    ],
    eventRsvps: [
      { _id: 'other-rsvp', eventId: 'event', userId: 'owner', status: 'yes' },
    ],
    eventTasks: [
      { _id: 'other-task', eventId: 'event', assignedToUserId: 'owner' },
    ],
    communityMembers: [],
    googleImportStatus: [],
  });
  let sequence = 0;
  const get = async (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  // Real auth boundary requires persisted synthetic users and sessions.
  tables.users ??= [];
  if (userId && !tables.users.some((row) => row._id === userId)) {
    tables.users.push({ _id: userId });
  }
  tables.authSessions = tables.users.map((row) => ({
    _id: `${row._id}-session`,
    userId: row._id,
    expirationTime: Date.now() + 60000,
  }));
  const ctx = {
    auth: {
      getUserIdentity: async () =>
        userId ? { subject: `${userId}|${userId}-session` } : null,
    },
    db: {
      get,
      query: (table: string) => new Query(tables[table] ?? []),
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}:new:${++sequence}`;
        tables[table] ??= [];
        tables[table].push({ ...value, _id: id });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        const row = await get(id);
        if (!row) throw new Error('Missing fixture');
        Object.assign(row, value);
      },
      delete: async (id: string) => {
        for (const rows of Object.values(tables)) {
          const i = rows.findIndex((row) => row._id === id);
          if (i >= 0) rows.splice(i, 1);
        }
      },
    },
  };
  return { ctx, tables };
}
function invoke(
  handler: unknown,
  ctx: ReturnType<typeof fixture>['ctx'],
  args: object
) {
  return (
    handler as {
      _handler: (context: typeof ctx, args: object) => Promise<unknown>;
    }
  )._handler(ctx, args);
}
const importArgs = {
  events: [
    { title: 'Imported', startIso: '2026-03-27', endIso: null, isAllDay: true },
  ],
};

for (const [name, handler, args] of [
  ['upsert', upsertRsvp, { eventId: 'event', status: 'yes' }],
  ['cancel and unclaim', setRsvpNoAndUnclaimMyEventTasks, { eventId: 'event' }],
] as const) {
  describe(`RSVP ${name}`, () => {
    for (const scenario of [
      'unauthenticated',
      'phone match',
      'unrelated',
      'allFamily only',
      'allFamily manual profile',
      'allFamily phone without access',
      'allFamily removed access',
      'allFamily foreign access',
      'former family without invitation',
      'pending community',
      'left community',
      'absent community',
      'left community creator',
    ]) {
      it(`rejects ${scenario} without writes`, async () => {
        const { ctx, tables } = fixture(
          scenario === 'unauthenticated' ? null : 'viewer'
        );
        if (scenario === 'phone match') {
          tables.members[1].userId = undefined;
          tables.events[0].sharedWithFamilyMemberIds = ['entity'];
        }
        if (scenario.startsWith('allFamily')) tables.events[0].allFamily = true;
        if (scenario === 'allFamily manual profile') {
          tables.members = [
            { ...entity, userId: undefined, matchedUserId: undefined },
          ];
          tables.events[0].sharedWithFamilyMemberIds = ['entity'];
        }
        if (scenario === 'allFamily phone without access') {
          tables.members = [
            { ...entity, userId: undefined, inviteStatus: 'invited' },
          ];
          tables.events[0].sharedWithFamilyMemberIds = ['entity'];
        }
        if (scenario === 'allFamily removed access')
          tables.members = [structuredClone(entity)];
        if (scenario === 'allFamily foreign access')
          tables.members = [{ ...access, spaceId: 'different' }];
        if (scenario === 'former family without invitation')
          tables.members = [];
        if (scenario.includes('community')) {
          tables.events[0].communityId = 'community';
          if (scenario.endsWith('creator'))
            tables.events[0].createdBy = 'viewer';
          if (scenario !== 'absent community')
            tables.communityMembers = [
              {
                _id: 'cm',
                communityId: 'community',
                userId: 'viewer',
                role: 'admin',
                status: scenario.startsWith('pending') ? 'pending' : 'left',
              },
            ];
        }
        const before = structuredClone(tables);
        await expect(invoke(handler, ctx, args)).rejects.toThrow();
        expect(tables).toEqual(before);
      });
    }
    for (const scenario of [
      'creator',
      'explicit user',
      'explicit entity',
      'cross-space entity',
      'allFamily explicit user',
      'allFamily explicit entity',
      'community owner',
      'community admin',
      'community member',
      'legacy community member',
    ]) {
      it(`allows ${scenario} and only changes caller RSVP/tasks`, async () => {
        const { ctx, tables } = fixture();
        if (scenario === 'creator') tables.events[0].createdBy = 'viewer';
        if (scenario.startsWith('allFamily')) tables.events[0].allFamily = true;
        if (scenario.endsWith('explicit user')) {
          tables.events[0].sharedWithUserIds = ['viewer'];
          if (!scenario.startsWith('allFamily')) tables.members = [];
        }
        if (scenario.includes('entity')) {
          tables.events[0].sharedWithFamilyMemberIds = ['entity'];
          if (scenario.startsWith('cross'))
            tables.members[1].spaceId = 'different';
        }
        if (scenario.includes('community')) {
          tables.events[0].communityId = 'community';
          tables.communityMembers = [
            {
              _id: 'cm',
              communityId: 'community',
              userId: 'viewer',
              role: scenario.split(' ').at(-1),
              status: scenario.startsWith('legacy') ? undefined : 'active',
            },
          ];
        }
        const otherRsvp = structuredClone(tables.eventRsvps[0]);
        const otherTask = structuredClone(tables.eventTasks[0]);
        // Extra userId cannot redirect identity even at the handler boundary.
        await invoke(handler, ctx, { ...args, userId: 'owner' });
        expect(
          tables.eventRsvps.find((row) => row.userId === 'viewer')?.status
        ).toBe(name === 'upsert' ? 'yes' : 'no');
        expect(tables.eventRsvps[0]).toEqual(otherRsvp);
        expect(tables.eventTasks[0]).toEqual(otherTask);
      });
    }
  });
}
it('preserves RSVP responses while requiring the creator to release personal assignments', async () => {
  const { ctx, tables } = fixture();
  tables.events[0].sharedWithUserIds = ['viewer'];
  for (const status of ['yes', 'maybe', 'none', 'no']) {
    await invoke(upsertRsvp, ctx, { eventId: 'event', status });
    expect(
      tables.eventRsvps.filter((row) => row.userId === 'viewer')
    ).toHaveLength(1);
    expect(tables.eventRsvps[1].status).toBe(status);
  }
  tables.eventTasks.push({
    _id: 'my-task',
    eventId: 'event',
    assignedToUserId: 'viewer',
    assignedToManual: 'Viewer',
    title: 'Keep',
  });
  await expect(
    invoke(upsertRsvp, ctx, { eventId: 'event', status: 'no' })
  ).rejects.toThrow();
  const before = structuredClone(tables);
  await expect(
    invoke(setRsvpNoAndUnclaimMyEventTasks, ctx, { eventId: 'event' })
  ).rejects.toThrow();
  expect(tables).toEqual(before);
  const creatorCtx = {
    ...ctx,
    auth: { getUserIdentity: async () => ({ subject: 'owner|owner-session' }) },
  };
  await invoke(setAssignee, creatorCtx, { id: 'my-task', assignee: null });
  expect(
    await invoke(setRsvpNoAndUnclaimMyEventTasks, ctx, { eventId: 'event' })
  ).toEqual({ unclaimedTasks: 0, rsvpStatus: 'no' });
  expect(tables.eventTasks[1]).toMatchObject({
    _id: 'my-task',
    title: 'Keep',
    assignedToUserId: undefined,
    assignedToManual: undefined,
  });
});

describe('copy destination', () => {
  for (const scenario of [
    'unauthenticated',
    'foreign recipient',
    'foreign destination',
    'deleted destination',
    'former member',
    'entity only',
  ]) {
    it(`rejects ${scenario} and preserves source/link`, async () => {
      const { ctx, tables } = fixture(
        scenario === 'unauthenticated' ? null : 'viewer'
      );
      if (scenario === 'foreign recipient')
        tables.linkedEvents[0].savedByUserId = 'owner';
      if (scenario === 'foreign destination')
        tables.linkedEvents[0].spaceId = 'foreign';
      if (scenario === 'deleted destination') tables.spaces = [];
      if (scenario === 'former member' || scenario === 'entity only')
        tables.members = [structuredClone(entity)];
      const before = structuredClone(tables);
      await expect(
        invoke(copyLinkedEvent, ctx, { linkedEventId: 'linked' })
      ).rejects.toThrow();
      expect(tables).toEqual(before);
    });
  }
  for (const sourceStatus of ['active', 'cancelled', 'deleted', 'missing']) {
    it(`copies ${sourceStatus}, preserves other references and prevents repeat`, async () => {
      const { ctx, tables } = fixture();
      tables.linkedEvents[0].sourceStatus =
        sourceStatus === 'missing' ? 'active' : sourceStatus;
      if (sourceStatus === 'missing') tables.events = [];
      if (sourceStatus === 'cancelled') tables.events[0].status = 'cancelled';
      tables.linkedEvents.push({
        ...tables.linkedEvents[0],
        _id: 'other-link',
        savedByUserId: 'other',
      });
      const source = structuredClone(tables.events);
      const otherLink = structuredClone(tables.linkedEvents[1]);
      const result = (await invoke(copyLinkedEvent, ctx, {
        linkedEventId: 'linked',
      })) as { newEventId: string };
      const copy = await ctx.db.get(result.newEventId);
      expect(copy).toMatchObject({
        title: ['deleted', 'missing'].includes(sourceStatus)
          ? 'Snapshot'
          : 'Live',
        spaceId: 'space',
        createdBy: 'viewer',
        ownerScope: 'personal',
      });
      expect(copy?.description).toBeUndefined();
      expect(tables.events.slice(0, source.length)).toEqual(source);
      expect(tables.linkedEvents).toEqual([otherLink]);
      const before = structuredClone(tables);
      await expect(
        invoke(copyLinkedEvent, ctx, { linkedEventId: 'linked' })
      ).rejects.toThrow();
      expect(tables).toEqual(before);
    });
  }
});

describe('import destination', () => {
  for (const scenario of [
    'unauthenticated',
    'entity only',
    'legacy entity',
    'phone only',
    'missing space',
    'no membership',
    'foreign access',
    'stale entity before own admin',
  ]) {
    it(`rejects ${scenario} without events or import lock`, async () => {
      const { ctx, tables } = fixture(
        scenario === 'unauthenticated' ? null : 'viewer'
      );
      if (scenario.includes('entity'))
        tables.members = [structuredClone(entity)];
      if (scenario === 'legacy entity') tables.members[0].kind = undefined;
      if (scenario === 'phone only')
        tables.members = [{ ...entity, userId: undefined }];
      if (scenario === 'missing space') tables.spaces = [];
      if (scenario === 'no membership') tables.members = [];
      if (scenario === 'foreign access')
        tables.members = [{ ...access, userId: 'owner' }];
      if (scenario === 'stale entity before own admin')
        tables.members.push({ ...access, role: 'admin', spaceId: 'own-space' });
      const before = structuredClone(tables);
      await expect(
        invoke(importGoogleCalendar, ctx, importArgs)
      ).rejects.toThrow();
      expect(tables).toEqual(before);
    });
  }
  for (const scenario of [
    'personal admin',
    'family admin',
    'family member',
    'legacy access',
  ]) {
    it(`allows ${scenario}, stamps caller and retains one-time lock`, async () => {
      const { ctx, tables } = fixture();
      tables.spaces[0].type = scenario.startsWith('personal')
        ? 'personal'
        : 'family';
      tables.members = [
        {
          ...access,
          role: scenario.includes('admin') ? 'admin' : 'member',
          kind: scenario === 'legacy access' ? undefined : 'access',
        },
      ];
      expect(await invoke(importGoogleCalendar, ctx, importArgs)).toEqual({
        success: true,
        importedCount: 1,
      });
      expect(tables.events.at(-1)).toMatchObject({
        createdBy: 'viewer',
        spaceId: 'space',
        source: 'google_copy',
        ownerScope: 'personal',
      });
      tables.members = [];
      const before = structuredClone(tables);
      expect(await invoke(importGoogleCalendar, ctx, importArgs)).toEqual({
        alreadyCompleted: true,
        importedCount: 1,
      });
      expect(tables).toEqual(before);
    });
  }
  for (const scenario of ['personal', 'family', 'family join']) {
    it(`real finishOnboarding → import: ${scenario}`, async () => {
      const { ctx, tables } = fixture();
      tables.members = [];
      if (scenario === 'family join') {
        tables.members = [
          { ...entity, userId: undefined, inviteStatus: 'invited' },
        ];
        tables.users[0].pendingMatchMemberId = 'entity';
      }
      const result = (await invoke(finishOnboarding, ctx, {
        firstName: 'Test',
        lastName: 'User',
        profileColor: '#123456',
        spaceType: scenario === 'personal' ? 'personal' : 'family',
        challenges: [],
      })) as { spaceId: string };
      expect(
        tables.members.some(
          (row) =>
            row.kind === 'access' &&
            row.userId === 'viewer' &&
            row.spaceId === result.spaceId
        )
      ).toBe(true);
      expect(await invoke(importGoogleCalendar, ctx, importArgs)).toEqual({
        success: true,
        importedCount: 1,
      });
      expect(tables.events.at(-1)?.spaceId).toBe(result.spaceId);
    });
  }
});
