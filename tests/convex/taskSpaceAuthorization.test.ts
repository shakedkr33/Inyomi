import { describe, expect, it } from 'bun:test';
import * as events from '../../convex/events';
import * as tasks from '../../convex/tasks';

// Real registered handlers; local DB adapter only, no module mocks or network.
// This does not emulate Convex validators, transactions or index execution.
type Row = { _id: string; [field: string]: unknown };
type Predicate = (row: Row) => boolean;
const expressions = {
  field: (name: string) => (row: Row) => row[name],
  and:
    (...predicates: Predicate[]): Predicate =>
    (row) =>
      predicates.every((p) => p(row)),
  neq:
    (field: (row: Row) => unknown, value: unknown): Predicate =>
    (row) =>
      field(row) !== value,
  eq:
    (field: (row: Row) => unknown, value: unknown): Predicate =>
    (row) =>
      field(row) === value,
};
class ReadQuery {
  predicates: Predicate[] = [];
  constructor(private rows: Row[]) {}
  eq(field: string, value: unknown) {
    this.predicates.push((row) => row[field] === value);
    return this;
  }
  gte(field: string, value: number) {
    this.predicates.push((row) => Number(row[field]) >= value);
    return this;
  }
  lte(field: string, value: number) {
    this.predicates.push((row) => Number(row[field]) <= value);
    return this;
  }
  withIndex(_name: string, build: (query: ReadQuery) => unknown) {
    build(this);
    return this;
  }
  filter(build: (expr: typeof expressions) => Predicate) {
    this.predicates.push(build(expressions));
    return this;
  }
  order(_direction: string) {
    return this;
  }
  async collect() {
    return this.rows.filter((row) => this.predicates.every((p) => p(row)));
  }
  async paginate({ numItems }: { cursor: string | null; numItems: number }) {
    return {
      page: (await this.collect()).slice(0, numItems),
      isDone: true,
      continueCursor: '',
    };
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

const access: Row = {
  _id: 'access',
  userId: 'viewer',
  spaceId: 'family',
  kind: 'access',
  role: 'member',
};
function fixture(
  userId: string | null = 'viewer',
  extra: Record<string, Row[]> = {}
) {
  const tables: Record<string, Row[]> = {
    spaces: [{ _id: 'family', ownerId: 'owner', type: 'family' }],
    members: [access],
    users: [{ _id: 'viewer' }, { _id: 'owner' }],
    tasks: [],
    events: [],
    ...extra,
  };
  const writes: string[] = [];
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
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) =>
        Object.values(tables)
          .flat()
          .find((r) => r._id === id) ?? null,
      query: (table: string) => new ReadQuery(tables[table] ?? []),
      insert: async (table: string, fields: Record<string, unknown>) => {
        const id = `${table}-${writes.length}`;
        writes.push(id);
        tables[table] ??= [];
        tables[table].push({ ...fields, _id: id });
        return id;
      },
      patch: async (id: string, fields: Record<string, unknown>) => {
        const row = Object.values(tables)
          .flat()
          .find((r) => r._id === id);
        if (!row) throw new Error('Missing fixture row');
        Object.assign(row, fields);
        writes.push(`patch:${id}`);
      },
    },
    scheduler: {
      runAfter: async () => {
        writes.push('schedule');
      },
    },
  };
  return { ctx, tables, writes };
}
async function invoke(
  fn: unknown,
  ctx: ReturnType<typeof fixture>['ctx'],
  args: object
): Promise<unknown> {
  return (
    fn as { _handler: (ctx: unknown, args: object) => Promise<unknown> }
  )._handler(ctx, args);
}
const eventArgs = { title: 'Event', startTime: 100, endTime: 200 };
for (const [label, fn, args, table] of [
  ['event', events.create, eventArgs, 'events'],
  ['task', tasks.create, { title: 'Task' }, 'tasks'],
] as const) {
  describe(`${label} create space authorization`, () => {
    for (const scenario of [
      { name: 'family member', members: [access], allowed: true },
      { name: 'admin', members: [{ ...access, role: 'admin' }], allowed: true },
      {
        name: 'legacy access',
        members: [{ ...access, kind: undefined }],
        allowed: true,
      },
      {
        name: 'foreign space',
        members: [{ ...access, spaceId: 'other' }],
        allowed: false,
      },
      {
        name: 'entity only',
        members: [{ ...access, kind: 'entity', displayName: 'Viewer' }],
        allowed: false,
      },
      {
        name: 'legacy entity',
        members: [{ ...access, kind: undefined, displayName: 'Viewer' }],
        allowed: false,
      },
      { name: 'removed member', members: [], allowed: false },
      {
        name: 'another users access',
        members: [{ ...access, userId: 'owner' }],
        allowed: false,
      },
    ]) {
      it(scenario.name, async () => {
        const f = fixture('viewer', { members: scenario.members });
        const call = invoke(fn, f.ctx, { ...args, spaceId: 'family' });
        if (scenario.allowed) {
          const id = await call;
          expect(f.tables[table].find((r) => r._id === id)).toMatchObject({
            createdBy: 'viewer',
            spaceId: 'family',
          });
        } else {
          await expect(call).rejects.toThrow('אין הרשאה');
          expect(f.writes).toEqual([]);
        }
      });
    }
    it('unauthenticated', async () => {
      const f = fixture(null);
      await expect(
        invoke(fn, f.ctx, { ...args, spaceId: 'family' })
      ).rejects.toThrow('לא מחובר');
      expect(f.writes).toEqual([]);
    });
    it('missing space despite stale membership', async () => {
      const f = fixture('viewer', { spaces: [] });
      await expect(
        invoke(fn, f.ctx, { ...args, spaceId: 'family' })
      ).rejects.toThrow('המרחב לא נמצא');
      expect(f.writes).toEqual([]);
    });
    it('unknown target ID', async () => {
      const f = fixture();
      await expect(
        invoke(fn, f.ctx, { ...args, spaceId: 'missing' })
      ).rejects.toThrow();
      expect(f.writes).toEqual([]);
    });
    it('owner metadata alone does not grant access', async () => {
      const f = fixture('owner', { members: [] });
      await expect(
        invoke(fn, f.ctx, { ...args, spaceId: 'family' })
      ).rejects.toThrow();
      expect(f.writes).toEqual([]);
    });
    it('personal space with owner access', async () => {
      const f = fixture('viewer', {
        spaces: [{ _id: 'family', ownerId: 'viewer', type: 'personal' }],
      });
      await invoke(fn, f.ctx, { ...args, spaceId: 'family' });
      expect(f.tables[table][0].ownerScope).toBe('personal');
    });
    it('existing optional no-space creation remains supported', async () => {
      const f = fixture('viewer', { members: [] });
      await invoke(fn, f.ctx, args);
      expect(f.tables[table][0].spaceId).toBeUndefined();
    });
  });
}
it('explicit family and cross-space event shares are preserved', async () => {
  const f = fixture();
  f.tables.users = [{ _id: 'external', onboardingCompleted: true }];
  f.tables.members.push({
    _id: 'external-access',
    kind: 'access',
    userId: 'external',
    spaceId: 'family',
  });
  f.tables.members.push({
    _id: 'child',
    spaceId: 'family',
    kind: 'entity',
    userId: 'external',
    matchedUserId: 'external',
    inviteStatus: 'joined',
    memberType: 'person',
  });
  const sharing = {
    allFamily: true,
    sharedWithUserIds: ['external'],
    sharedWithFamilyMemberIds: ['child'],
  };
  await invoke(events.create, f.ctx, {
    ...eventArgs,
    ...sharing,
    spaceId: 'family',
  });
  expect(f.tables.events[0]).toMatchObject({
    ...sharing,
    ownerScope: 'family',
  });
});
it('explicit event sharing does not grant destination writes', async () => {
  const f = fixture('outsider');
  await expect(
    invoke(events.create, f.ctx, {
      ...eventArgs,
      spaceId: 'family',
      sharedWithUserIds: ['outsider'],
      allFamily: true,
    })
  ).rejects.toThrow();
  expect(f.writes).toEqual([]);
});
it('shopping list and explicit user/member assignments remain intact', async () => {
  const f = fixture();
  const assignment = {
    assignedTo: 'external',
    assignedToUserIds: ['external'],
    assignedToMemberId: 'child',
    assignedToMemberIds: ['child'],
  };
  const subtasks = [{ id: 'item', title: 'Milk', completed: false }];
  await invoke(tasks.create, f.ctx, {
    title: 'Shopping',
    category: 'shopping',
    spaceId: 'family',
    ...assignment,
    subtasks,
  });
  expect(f.tables.tasks[0]).toMatchObject({
    category: 'shopping',
    ...assignment,
    subtasks,
    ownerScope: 'family',
  });
});
for (const [label, fn, args] of [
  ['event', events.create, eventArgs],
  ['task', tasks.create, { title: 'Reminder' }],
] as const) {
  for (const role of ['owner', 'admin', 'member']) {
    it(`${label}: community ${role} permissions`, async () => {
      const f = fixture('viewer', {
        communities: [
          {
            _id: 'community',
            ownerId: role === 'owner' ? 'viewer' : 'owner',
            name: 'Community',
          },
        ],
        communityMembers: [
          {
            _id: 'cm',
            communityId: 'community',
            userId: 'viewer',
            role,
            status: 'active',
          },
        ],
      });
      const call = invoke(fn, f.ctx, {
        ...args,
        communityId: 'community',
        spaceId: 'family',
      });
      if (role === 'member') {
        await expect(call).rejects.toThrow();
        expect(f.writes).toEqual([]);
      } else {
        await call;
        expect(
          f.tables[label === 'event' ? 'events' : 'tasks'][0].ownerScope
        ).toBe('community');
      }
    });
  }
  it(`${label}: community admin cannot target foreign space`, async () => {
    const f = fixture('viewer', {
      members: [],
      communities: [{ _id: 'community', ownerId: 'viewer' }],
      communityMembers: [
        {
          _id: 'cm',
          communityId: 'community',
          userId: 'viewer',
          role: 'admin',
        },
      ],
    });
    await expect(
      invoke(fn, f.ctx, {
        ...args,
        communityId: 'community',
        spaceId: 'family',
      })
    ).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });
}

for (const [name, fn, args, dueDate] of [
  ['dated', tasks.listBySpace, { spaceId: 'family' }, 100],
  ['undated', tasks.listUndated, { spaceId: 'family' }, undefined],
  [
    'birthday',
    tasks.listByRelatedBirthday,
    { birthdayId: 'birthday' },
    undefined,
  ],
] as const) {
  describe(`${name} task reads`, () => {
    for (const scenario of [
      { name: 'unauthenticated', user: null, task: {}, allowed: false },
      {
        name: 'foreign space known to outsider',
        user: 'outsider',
        task: {},
        allowed: false,
      },
      {
        name: 'creator without membership',
        user: 'owner',
        task: {},
        allowed: true,
      },
      {
        name: 'primary assignee across spaces',
        user: 'outsider',
        task: { assignedTo: 'outsider' },
        allowed: true,
      },
      {
        name: 'secondary assignee across spaces',
        user: 'outsider',
        task: { assignedTo: 'owner', assignedToUserIds: ['owner', 'outsider'] },
        allowed: true,
      },
      {
        name: 'authorized assigned family member',
        user: 'viewer',
        task: { assignedTo: 'viewer' },
        allowed: true,
      },
      {
        name: 'unassigned personal task in family space',
        user: 'viewer',
        task: { ownerScope: 'personal' },
        allowed: false,
      },
      {
        name: 'legacy unassigned task grants no implicit family access',
        user: 'viewer',
        task: {},
        allowed: false,
      },
      {
        name: 'family ownership alone is not an explicit share',
        user: 'viewer',
        task: { ownerScope: 'family' },
        allowed: false,
      },
      {
        name: 'multi-assignee only does not expose to others',
        user: 'viewer',
        task: { assignedToUserIds: ['other'] },
        allowed: false,
      },
      {
        name: 'child profile assignment is not a share with all adults',
        user: 'viewer',
        task: { assignedToMemberId: 'child', assignedToMemberIds: ['child'] },
        allowed: false,
      },
      {
        name: 'removed member without assignment',
        user: 'removed',
        task: {},
        allowed: false,
      },
      {
        name: 'removed member retains explicit assignment',
        user: 'removed',
        task: { assignedTo: 'removed' },
        allowed: true,
      },
      {
        name: 'community reminder not disclosed through space',
        user: 'viewer',
        task: { communityId: 'community' },
        allowed: false,
      },
      {
        name: 'community assignment preserved',
        user: 'viewer',
        task: { communityId: 'community', assignedTo: 'viewer' },
        allowed: true,
      },
      {
        name: 'deleted task excluded for creator',
        user: 'owner',
        task: { deletedAt: 1 },
        allowed: false,
      },
    ]) {
      it(scenario.name, async () => {
        const task = {
          _id: 'task',
          title: 'Private',
          createdBy: 'owner',
          spaceId: 'family',
          relatedBirthdayId: 'birthday',
          dueDate,
          ...scenario.task,
        };
        const f = fixture(scenario.user, { tasks: [task] });
        const result = await invoke(fn, f.ctx, args);
        expect(result).toEqual(scenario.allowed ? [task] : []);
      });
    }
  });
}
it('community reminder visibility still depends on active membership', async () => {
  for (const status of ['active', 'left']) {
    const task = {
      _id: 'reminder',
      createdBy: 'owner',
      communityId: 'community',
      title: 'Reminder',
    };
    const f = fixture('viewer', {
      tasks: [task],
      communityMembers: [
        {
          _id: 'cm',
          communityId: 'community',
          userId: 'viewer',
          status,
          role: 'member',
        },
      ],
    });
    const result = await invoke(tasks.listByCommunity, f.ctx, {
      communityId: 'community',
    });
    expect(result).toEqual(status === 'active' ? [task] : []);
  }
});

for (const fn of [tasks.listByCommunity, tasks.listCommunityRemindersPaged]) {
  for (const scenario of [
    { name: 'unauthenticated', user: null, members: [], allowed: false },
    { name: 'outsider', user: 'viewer', members: [], allowed: false },
    {
      name: 'removed',
      user: 'viewer',
      members: [
        {
          _id: 'cm',
          userId: 'viewer',
          communityId: 'community',
          status: 'left',
        },
      ],
      allowed: false,
    },
    {
      name: 'active',
      user: 'viewer',
      members: [
        {
          _id: 'cm',
          userId: 'viewer',
          communityId: 'community',
          status: 'active',
        },
      ],
      allowed: true,
    },
    {
      name: 'legacy',
      user: 'viewer',
      members: [{ _id: 'cm', userId: 'viewer', communityId: 'community' }],
      allowed: true,
    },
  ]) {
    it(`community list ${fn === tasks.listByCommunity ? 'full' : 'paged'}: ${scenario.name}`, async () => {
      const task = {
        _id: 'reminder',
        communityId: 'community',
        createdBy: 'owner',
        title: 'Reminder',
      };
      const f = fixture(scenario.user, {
        tasks: [task],
        communityMembers: scenario.members,
      });
      const result = await invoke(fn, f.ctx, {
        communityId: 'community',
        cursor: null,
        numItems: 20,
      });
      const expected = scenario.allowed ? [task] : [];
      expect(result).toEqual(
        fn === tasks.listByCommunity
          ? expected
          : { page: expected, isDone: true, continueCursor: '' }
      );
    });
  }
}
for (const scenario of [
  { name: 'unauthenticated', user: null, event: {}, allowed: false },
  { name: 'creator', user: 'owner', event: {}, allowed: true },
  { name: 'unshared family event', user: 'viewer', event: {}, allowed: false },
  {
    name: 'explicit share',
    user: 'outsider',
    event: { sharedWithUserIds: ['outsider'] },
    allowed: true,
  },
  {
    name: 'family share',
    user: 'viewer',
    event: { allFamily: true },
    allowed: true,
  },
  {
    name: 'outsider despite family share',
    user: 'outsider',
    event: { allFamily: true },
    allowed: false,
  },
  {
    name: 'community outsider',
    user: 'viewer',
    event: { communityId: 'community' },
    allowed: false,
  },
]) {
  it(`event important items: ${scenario.name}`, async () => {
    const importantItems = [{ id: 'item', title: 'Private item' }];
    const f = fixture(scenario.user, {
      events: [
        {
          _id: 'event',
          createdBy: 'owner',
          spaceId: 'family',
          importantItems,
          ...scenario.event,
        },
      ],
    });
    expect(
      await invoke(tasks.listEventImportantItems, f.ctx, { eventId: 'event' })
    ).toEqual(scenario.allowed ? importantItems : []);
  });
}

it('personal task keeps creator fallback assignment', async () => {
  const f = fixture();
  await invoke(tasks.create, f.ctx, { title: 'Personal', spaceId: 'family' });
  expect(f.tables.tasks[0]).toMatchObject({
    createdBy: 'viewer',
    assignedTo: 'viewer',
    assignedToUserIds: ['viewer'],
    ownerScope: 'personal',
  });
});
it('community event implicit destination retains authorized creation', async () => {
  const f = fixture('viewer', {
    communities: [{ _id: 'community', ownerId: 'viewer', name: 'Community' }],
  });
  await invoke(events.create, f.ctx, {
    ...eventArgs,
    communityId: 'community',
  });
  expect(f.tables.events[0].spaceId).toBe('family');
});
it('community event stale default cannot bypass destination authorization', async () => {
  const f = fixture('viewer', {
    members: [],
    users: [{ _id: 'viewer', defaultSpaceId: 'family' }],
    communities: [{ _id: 'community', ownerId: 'viewer', name: 'Community' }],
  });
  await expect(
    invoke(events.create, f.ctx, { ...eventArgs, communityId: 'community' })
  ).rejects.toThrow('אין הרשאה');
  expect(f.writes).toEqual([]);
});
it('community event without any destination keeps its existing owner rule', async () => {
  const f = fixture('viewer', {
    members: [],
    communities: [{ _id: 'community', ownerId: 'viewer', name: 'Community' }],
  });
  await invoke(events.create, f.ctx, {
    ...eventArgs,
    communityId: 'community',
  });
  expect(f.tables.events[0].spaceId).toBeUndefined();
});

it('Everyone assignments persist and remain visible to each assigned account', async () => {
  const f = fixture('viewer', {
    members: [
      access,
      { ...access, _id: 'other-access', userId: 'other' },
      { _id: 'child', spaceId: 'family', kind: 'entity', displayName: 'Child' },
    ],
    users: [
      { _id: 'viewer', fullName: 'Creator' },
      { _id: 'other', fullName: 'Other' },
    ],
  });
  const taskId = await invoke(tasks.create, f.ctx, {
    title: 'Everyone',
    spaceId: 'family',
    assignedTo: 'viewer',
    assignedToUserIds: ['viewer', 'other'],
    assignedToMemberIds: ['child'],
  });
  expect(f.tables.tasks[0]).toMatchObject({
    assignedToUserIds: ['viewer', 'other'],
    assignedToMemberIds: ['child'],
  });
  for (const user of ['viewer', 'other', 'unassigned']) {
    const reader = fixture(user, f.tables);
    const result = await invoke(tasks.listUndated, reader.ctx, {
      spaceId: 'family',
    });
    expect(result).toEqual(user === 'unassigned' ? [] : f.tables.tasks);
    if (user !== 'unassigned') {
      const detail = await invoke(tasks.getTaskDetails, reader.ctx, {
        id: taskId,
      });
      expect(detail).toMatchObject({
        assignedToMemberIds: ['child'],
        assignees: [
          { id: 'viewer', name: 'Creator', kind: 'user', color: null },
          { id: 'other', name: 'Other', kind: 'user', color: null },
          { id: 'child', name: 'Child', kind: 'member', color: null },
        ],
      });
    }
  }
});
