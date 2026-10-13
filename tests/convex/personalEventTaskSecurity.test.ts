import { describe, expect, it } from 'bun:test';
import * as rsvps from '../../convex/eventRsvps';
import { getById, getEventAttachmentUrl } from '../../convex/events';
import * as tasks from '../../convex/eventTasks';

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
    eventRsvps: [
      { _id: 'other-rsvp', eventId: 'event', userId: 'owner', status: 'yes' },
    ],
    eventTasks: [
      { _id: 'other-task', eventId: 'event', assignedToUserId: 'owner' },
    ],
    communityMembers: [],
  });
  let sequence = 0;
  const get = async (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  const ctx = {
    auth: {
      getUserIdentity: async () =>
        userId ? { subject: `${userId}|session` } : null,
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

function taskFixture(userId: string | null = 'viewer') {
  const f = fixture(userId);
  f.tables.eventTasks = [
    {
      _id: 'mine',
      eventId: 'event',
      title: 'Mine',
      assignedToUserId: 'viewer',
      completed: false,
      order: 0,
    },
    {
      _id: 'other',
      eventId: 'event',
      title: 'Other',
      assignedToUserId: 'owner',
      completed: false,
      order: 1,
    },
    {
      _id: 'free',
      eventId: 'event',
      title: 'Free',
      completed: false,
      order: 2,
    },
    {
      _id: 'manual',
      eventId: 'event',
      title: 'Legacy',
      assignedToManual: 'Viewer',
      completed: false,
      order: 3,
    },
  ];
  return f;
}
async function ids(f: ReturnType<typeof fixture>) {
  const rows = (await invoke(tasks.listByEvent, f.ctx, {
    eventId: 'event',
  })) as Row[];
  return rows.map((r) => r._id);
}
async function denied(
  f: ReturnType<typeof fixture>,
  handler: unknown,
  args: object
) {
  const before = structuredClone(f.tables);
  await expect(invoke(handler, f.ctx, args)).rejects.toThrow();
  expect(f.tables).toEqual(before);
}

describe('personal task server authorization', () => {
  for (const visible of [false, true]) {
    for (const scenario of [
      'creator',
      'assignee',
      'cross-space assignee',
      'user invitee',
      'profile invitee',
      'phone only',
      'manual profile',
      'allFamily',
      'unrelated',
      'anonymous',
    ]) {
      it(`visibility=${visible}: ${scenario}`, async () => {
        const f = taskFixture(
          scenario === 'creator'
            ? 'owner'
            : scenario === 'anonymous'
              ? null
              : 'viewer'
        );
        const event = f.tables.events[0];
        event.tasksVisibleToParticipants = visible;
        if (!['assignee', 'cross-space assignee'].includes(scenario))
          f.tables.eventTasks[0].assignedToUserId = 'someone';
        if (scenario === 'cross-space assignee') f.tables.members = [];
        if (scenario === 'user invitee') event.sharedWithUserIds = ['viewer'];
        if (
          ['profile invitee', 'phone only', 'manual profile'].includes(scenario)
        ) {
          event.sharedWithFamilyMemberIds = ['entity'];
          f.tables.members[1].spaceId = 'other-space';
          if (scenario !== 'profile invitee')
            f.tables.members[1].userId = undefined;
          if (scenario === 'manual profile')
            f.tables.members[1].matchedUserId = undefined;
        }
        if (scenario === 'allFamily') event.allFamily = true;
        const all =
          scenario === 'creator' ||
          (visible && ['user invitee', 'profile invitee'].includes(scenario));
        expect(await ids(f)).toEqual(
          all
            ? ['mine', 'other', 'free', 'manual']
            : scenario.includes('assignee')
              ? ['mine']
              : []
        );
      });
    }
  }
  it('allFamily assignee receives only own task even with visibility enabled', async () => {
    const f = taskFixture();
    Object.assign(f.tables.events[0], {
      allFamily: true,
      tasksVisibleToParticipants: true,
    });
    expect(await ids(f)).toEqual(['mine']);
  });
  it('assignee toggles both ways but gains no event or attachment access', async () => {
    const f = taskFixture();
    f.tables.members = [];
    f.tables.events[0].attachments = [{ storageId: 'file' }];
    expect(await invoke(getById, f.ctx, { eventId: 'event' })).toBeNull();
    expect(
      await invoke(getEventAttachmentUrl, f.ctx, {
        eventId: 'event',
        storageId: 'file',
      })
    ).toBeNull();
    await invoke(tasks.toggleCompleted, f.ctx, { id: 'mine' });
    expect(f.tables.eventTasks[0].completed).toBe(true);
    expect(f.tables.eventTasks[0].completedAt).toBeNumber();
    expect(await ids(f)).toEqual(['mine']);
    await invoke(tasks.toggleCompleted, f.ctx, { id: 'mine' });
    expect(f.tables.eventTasks[0].completed).toBe(false);
    expect(f.tables.eventTasks[0].completedAt).toBeUndefined();
  });
  for (const who of ['viewer', 'stranger', null]) {
    it(`denies management and other completion to ${who}`, async () => {
      const f = taskFixture(who);
      for (const [handler, args] of [
        [tasks.toggleCompleted, { id: 'other' }],
        [tasks.toggleCompleted, { id: 'manual' }],
        [tasks.update, { id: 'mine', title: 'Changed' }],
        [tasks.remove, { id: 'mine' }],
        [tasks.create, { eventId: 'event', title: 'New' }],
        [tasks.createBatch, { eventId: 'event', tasks: [{ title: 'New' }] }],
        [tasks.setAssignee, { id: 'other', assignee: null }],
        [
          tasks.setAssignee,
          { id: 'free', assignee: { type: 'user', userId: who ?? 'viewer' } },
        ],
        [
          tasks.setAssignee,
          { id: 'mine', assignee: { type: 'user', userId: 'someone' } },
        ],
      ] as const)
        await denied(f, handler, args);
      if (who !== 'viewer')
        await denied(f, tasks.toggleCompleted, { id: 'mine' });
    });
  }
  it('read-only invitee cannot complete another task', async () => {
    const f = taskFixture();
    Object.assign(f.tables.events[0], {
      sharedWithUserIds: ['viewer'],
      tasksVisibleToParticipants: true,
    });
    expect(await ids(f)).toHaveLength(4);
    await denied(f, tasks.toggleCompleted, { id: 'other' });
  });
  it('creator manages tasks and preserves legacy manual data until explicitly cleared', async () => {
    const f = taskFixture('owner');
    const legacy = structuredClone(f.tables.eventTasks[3]);
    await invoke(tasks.toggleCompleted, f.ctx, { id: 'mine' });
    await invoke(tasks.update, f.ctx, { id: 'mine', title: 'Updated' });
    await invoke(tasks.setAssignee, f.ctx, {
      id: 'mine',
      assignee: { type: 'user', userId: 'owner' },
    });
    expect(f.tables.eventTasks[0]).toMatchObject({
      title: 'Updated',
      assignedToUserId: 'owner',
      completed: true,
    });
    expect(f.tables.eventTasks[3]).toEqual(legacy);
    await invoke(tasks.setAssignee, f.ctx, { id: 'manual', assignee: null });
    expect(f.tables.eventTasks[3].assignedToManual).toBeUndefined();
    await invoke(tasks.remove, f.ctx, { id: 'free' });
    await invoke(tasks.create, f.ctx, { eventId: 'event', title: 'New' });
    expect(await ids(f)).toHaveLength(4);
  });
  it('retains own-assignment removal on active personal events', async () => {
    const f = taskFixture();
    await invoke(tasks.setAssignee, f.ctx, { id: 'mine', assignee: null });
    expect(await ids(f)).toEqual([]);
    await denied(f, tasks.toggleCompleted, { id: 'mine' });
  });
});

for (const community of [false, true]) {
  for (const state of ['cancelled', 'deleted', 'deleted-zero']) {
    for (const userId of ['owner', 'viewer']) {
      it(`historical tasks: community=${community}, ${state}, ${userId}`, async () => {
        const f = taskFixture(userId);
        if (state === 'cancelled') f.tables.events[0].status = state;
        else f.tables.events[0].deletedAt = state === 'deleted-zero' ? 0 : 123;
        if (community) {
          f.tables.events[0].communityId = 'community';
          f.tables.communityMembers = [
            {
              _id: 'membership',
              communityId: 'community',
              userId,
              role: userId === 'owner' ? 'owner' : 'member',
              status: 'active',
            },
          ];
        }
        expect(await ids(f)).toEqual(
          userId === 'owner' ? ['mine', 'other', 'free', 'manual'] : ['mine']
        );
        await denied(f, tasks.toggleCompleted, { id: 'mine' });
        await denied(f, tasks.setAssignee, { id: 'mine', assignee: null });
        await denied(f, tasks.setAssignee, {
          id: 'free',
          assignee: { type: 'user', userId },
        });
        if (community) {
          await denied(f, tasks.claimEventTask, { id: 'free' });
          await denied(f, tasks.unclaimEventTask, { id: 'mine' });
        }
      });
    }
  }
}

for (const visible of [false, true]) {
  for (const role of ['owner', 'admin', 'member', 'left', 'missing']) {
    it(`community completion and visibility: ${role}, ${visible}`, async () => {
      const f = taskFixture();
      Object.assign(f.tables.events[0], {
        communityId: 'community',
        tasksVisibleToParticipants: visible,
      });
      if (role !== 'missing')
        f.tables.communityMembers = [
          {
            _id: 'membership',
            communityId: 'community',
            userId: 'viewer',
            role,
            status: role === 'left' ? 'left' : 'active',
          },
        ];
      const active = !['left', 'missing'].includes(role);
      const manager = ['owner', 'admin'].includes(role);
      expect(await ids(f)).toEqual(
        !active
          ? []
          : visible || manager
            ? ['mine', 'other', 'free', 'manual']
            : ['mine']
      );
      if (active) {
        await invoke(tasks.toggleCompleted, f.ctx, { id: 'mine' });
        expect(f.tables.eventTasks[0].completed).toBe(true);
        expect(f.tables.communityActivities).toHaveLength(1);
      } else await denied(f, tasks.toggleCompleted, { id: 'mine' });
      if (manager) await invoke(tasks.toggleCompleted, f.ctx, { id: 'other' });
      else await denied(f, tasks.toggleCompleted, { id: 'other' });
    });
  }
}

for (const [name, handler, args] of [
  ['yes', rsvps.upsertRsvp, { eventId: 'event', status: 'yes' }],
  ['no', rsvps.upsertRsvp, { eventId: 'event', status: 'no' }],
  ['maybe', rsvps.upsertRsvp, { eventId: 'event', status: 'maybe' }],
  ['none', rsvps.upsertRsvp, { eventId: 'event', status: 'none' }],
  ['unclaim', rsvps.setRsvpNoAndUnclaimMyEventTasks, { eventId: 'event' }],
] as const) {
  for (const community of [false, true]) {
    for (const state of ['active', 'cancelled', 'deleted', 'deleted-zero']) {
      for (const userId of ['owner', 'viewer', 'stranger', null]) {
        it(`RSVP ${name}: community=${community}, ${state}, ${userId}`, async () => {
          const f = taskFixture(userId);
          const event = f.tables.events[0];
          event.sharedWithUserIds = ['viewer'];
          if (state === 'cancelled') event.status = state;
          if (state.startsWith('deleted'))
            event.deletedAt = state === 'deleted-zero' ? 0 : 123;
          if (community) {
            event.communityId = 'community';
            f.tables.communityMembers = ['owner', 'viewer'].map((id) => ({
              _id: `membership-${id}`,
              communityId: 'community',
              userId: id,
              role: id === 'owner' ? 'owner' : 'member',
              status: 'active',
            }));
          }
          f.tables.eventRsvps.push({
            _id: 'my-rsvp',
            eventId: 'event',
            userId: 'viewer',
            status: 'maybe',
          });
          if (name === 'no') f.tables.eventTasks = [];
          const authorized = userId === 'owner' || userId === 'viewer';
          if (state === 'active' && authorized) {
            await invoke(handler, f.ctx, args);
            expect(
              f.tables.eventRsvps.find((r) => r.userId === userId)?.status
            ).toBe(name === 'unclaim' ? 'no' : name);
          } else {
            const before = structuredClone(f.tables);
            if (authorized)
              await expect(invoke(handler, f.ctx, args)).rejects.toThrow(
                state === 'cancelled' ? 'האירוע בוטל' : 'האירוע נמחק'
              );
            else await expect(invoke(handler, f.ctx, args)).rejects.toThrow();
            expect(f.tables).toEqual(before);
            if (authorized) {
              const history = (await invoke(rsvps.listByEvent, f.ctx, {
                eventId: 'event',
              })) as Row[];
              expect(history.length).toBeGreaterThan(0);
            }
          }
        });
      }
    }
  }
}
