import { expect, it } from 'bun:test';
import type { Id } from '../../convex/_generated/dataModel';
import * as events from '../../convex/events';
import * as tasks from '../../convex/eventTasks';
import {
  personalAssignmentChoices,
  personalTaskEdits,
  selectFamilyParticipants,
} from '../../lib/personalEventEditing';
import type { EventData, Participant } from '../../lib/types/event';

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
  gte(key: string, value: number) {
    this.predicates.push((row) => Number(row[key]) >= value);
    return this;
  }
  lte(key: string, value: number) {
    this.predicates.push((row) => Number(row[key]) <= value);
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
    users: [
      { _id: 'viewer', onboardingCompleted: true },
      { _id: 'owner', onboardingCompleted: true },
    ],
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

function ownerFixture() {
  const f = fixture('owner');
  f.tables.members.push({
    _id: 'owner-access',
    userId: 'owner',
    spaceId: 'space',
    kind: 'access',
    role: 'admin',
  });
  f.tables.events[0].sharedWithUserIds = ['viewer'];
  f.tables.eventTasks = [
    {
      _id: 'task',
      eventId: 'event',
      title: 'Keep',
      assignedToUserId: 'viewer',
      completed: true,
      completedAt: 10,
      order: 0,
    },
    {
      _id: 'manual',
      eventId: 'event',
      title: 'Legacy',
      assignedToManual: 'Name',
      completed: false,
      order: 1,
    },
  ];
  return f;
}
// Mimic the transaction boundary for rollback assertions. Production uses one
// Convex mutation; this adapter does not emulate concurrency or index isolation.
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

it('single and batch new personal tasks default to authenticated creator', async () => {
  const f = ownerFixture();
  const id = await invoke(tasks.create, f.ctx, {
    eventId: 'event',
    title: 'One',
  });
  await invoke(tasks.createBatch, f.ctx, {
    eventId: 'event',
    tasks: [{ title: 'Two' }, { title: 'Three' }],
  });
  const created = f.tables.eventTasks.slice(2);
  expect(created).toHaveLength(3);
  expect(created[0]._id).toBe(id);
  for (const task of created) expect(task.assignedToUserId).toBe('owner');
});
for (const assignee of [
  'owner',
  'viewer',
  'stranger',
  'manual',
  'pet',
  'phone',
]) {
  it(`server new assignment eligibility: ${assignee}`, async () => {
    const f = ownerFixture();
    f.tables.users.push({ _id: 'stranger' });
    f.tables.members.push({
      _id: 'phone',
      matchedUserId: 'stranger',
      spaceId: 'space',
      memberType: 'person',
    });
    const args = {
      id: 'task',
      assignee:
        assignee === 'manual'
          ? { type: 'manual', name: 'Name' }
          : { type: 'user', userId: assignee },
    };
    const before = structuredClone(f.tables);
    if (['owner', 'viewer'].includes(assignee)) {
      await invoke(tasks.setAssignee, f.ctx, args);
      expect(f.tables.eventTasks[0].assignedToUserId).toBe(assignee);
    } else {
      await expect(invoke(tasks.setAssignee, f.ctx, args)).rejects.toThrow();
      expect(f.tables).toEqual(before);
    }
  });
}
it('atomic event edit preserves manual, account assignments and allFamily', async () => {
  const f = ownerFixture();
  f.tables.events[0].allFamily = true;
  const oldTasks = structuredClone(f.tables.eventTasks);
  await invoke(events.update, f.ctx, { id: 'event', title: 'Changed' });
  expect(f.tables.eventTasks).toEqual(oldTasks);
  expect(f.tables.events[0]).toMatchObject({
    allFamily: true,
    sharedWithUserIds: ['viewer'],
    title: 'Changed',
  });
});
for (const replacement of [undefined, null, 'owner', 'stranger']) {
  it(`participant removal resolves assignments atomically: ${replacement}`, async () => {
    const f = ownerFixture();
    const before = structuredClone(f.tables);
    const args = {
      id: 'event',
      title: 'Changed',
      sharedWithUserIds: [],
      personalTaskChanges:
        replacement === undefined
          ? []
          : [{ id: 'task', assignee: replacement }],
    };
    if (replacement === undefined || replacement === 'stranger') {
      await expect(transaction(f, events.update, args)).rejects.toThrow();
      expect(f.tables).toEqual(before);
    } else {
      await transaction(f, events.update, args);
      expect(f.tables.events[0].sharedWithUserIds).toEqual([]);
      expect(f.tables.eventTasks[0]).toMatchObject({
        _id: 'task',
        completed: true,
        completedAt: 10,
        assignedToUserId: replacement ?? undefined,
      });
      expect(f.tables.eventTasks[1]).toEqual(before.eventTasks[1]);
    }
  });
}
it('concurrent newly assigned task blocks removal until deliberately resolved', async () => {
  const f = ownerFixture();
  f.tables.eventTasks.push({
    _id: 'newly-assigned',
    eventId: 'event',
    assignedToUserId: 'viewer',
    title: 'New',
    completed: false,
  });
  const before = structuredClone(f.tables);
  await expect(
    transaction(f, events.update, {
      id: 'event',
      sharedWithUserIds: [],
      personalTaskChanges: [{ id: 'task', assignee: null }],
    })
  ).rejects.toThrow();
  expect(f.tables).toEqual(before);
});
for (const scenario of [
  'verified',
  'phone',
  'legacy phone stamp',
  'pet',
  'manual',
]) {
  it(`invitation construction: ${scenario}`, async () => {
    const f = ownerFixture();
    f.tables.events[0].sharedWithUserIds = [];
    f.tables.members = f.tables.members.filter((r) => r.userId !== 'viewer');
    f.tables.members.push({
      _id: 'profile',
      spaceId: 'space',
      kind: 'entity',
      memberType: scenario === 'pet' ? 'pet' : 'person',
      userId: ['verified', 'legacy phone stamp'].includes(scenario)
        ? 'viewer'
        : undefined,
      inviteStatus: 'joined',
      matchedUserId: 'viewer',
    });
    if (scenario === 'verified')
      f.tables.members.push({
        _id: 'verified-access',
        kind: 'access',
        spaceId: 'space',
        userId: 'viewer',
      });
    const args = {
      id: 'event',
      sharedWithUserIds: ['viewer'],
      sharedWithFamilyMemberIds: ['profile'],
      participantDetails: [
        {
          id: 'profile',
          name: 'Name',
          color: '#123456',
          source: 'family',
          userId: 'viewer',
        },
      ],
    };
    if (scenario === 'verified') await invoke(events.update, f.ctx, args);
    else await expect(transaction(f, events.update, args)).rejects.toThrow();
  });
}
it('atomic creation includes tasks; invalid assignment creates no partial event', async () => {
  const f = ownerFixture();
  const args = {
    title: 'New',
    startTime: 100,
    endTime: 200,
    personalTaskChanges: [{ title: 'New task' }],
  };
  const id = await transaction(f, events.create, args);
  expect(f.tables.eventTasks.find((t) => t.eventId === id)).toMatchObject({
    assignedToUserId: 'owner',
    title: 'New task',
  });
  const before = structuredClone(f.tables);
  await expect(
    transaction(f, events.create, {
      ...args,
      personalTaskChanges: [{ title: 'Bad', assignee: 'stranger' }],
    })
  ).rejects.toThrow();
  expect(f.tables).toEqual(before);
});
for (const status of ['cancelled', 'deleted']) {
  it(`atomic task changes reject ${status} without event edits`, async () => {
    const f = ownerFixture();
    if (status === 'cancelled') f.tables.events[0].status = status;
    else f.tables.events[0].deletedAt = 0;
    const before = structuredClone(f.tables);
    await expect(
      transaction(f, events.update, {
        id: 'event',
        title: 'Bad',
        personalTaskChanges: [{ id: 'task', completed: false }],
      })
    ).rejects.toThrow();
    expect(f.tables).toEqual(before);
  });
}
it('discovery queries include personal invitee tasks but exclude private metadata and other tasks', async () => {
  const f = ownerFixture();
  const viewer = fixture('viewer');
  Object.assign(viewer.tables, f.tables);
  // The fixture context closes over the same tables object.
  for (const handler of [
    tasks.listMyAssignedEventTasks,
    tasks.listMyAssignedEventTasksForDate,
  ]) {
    const rows = (await invoke(handler, viewer.ctx, {
      from: 0,
      to: 500,
    })) as Row[];
    expect(rows.map((r) => r._id)).toEqual(['task']);
    expect(rows[0]).not.toHaveProperty('description');
    expect(rows[0]).not.toHaveProperty('attachments');
  }
  viewer.tables.events[0].sharedWithUserIds = [];
  expect(
    await invoke(tasks.listMyAssignedEventTasksForDate, viewer.ctx, {
      from: 0,
      to: 500,
    })
  ).toEqual([]);
});

const creator = 'owner' as Id<'users'>;
const linked = 'viewer' as Id<'users'>;
const base: EventData = {
  title: '',
  date: 100,
  isAllDay: true,
  recurrence: 'none',
  remindersEnabled: false,
  reminders: [],
  participants: [],
  tasks: [],
  tasksVisibleToParticipants: false,
  showAllTasksToAll: false,
  createdAt: 0,
  allFamily: true,
};
for (const count of [0, 1, 30]) {
  it(`family selection uses IDs, preserves allFamily and duplicate names: ${count}`, () => {
    const family = Array.from({ length: count }, (_, i) => ({
      _id: `profile:${i}`,
      displayName: 'Same',
      linkedUserId: i === 0 ? linked : undefined,
    }));
    const ids = family.map((p) => p._id);
    const selected = {
      ...base,
      ...selectFamilyParticipants(base, ids, family),
    };
    expect(selected.allFamily).toBe(true);
    expect(new Set(selected.participants.map((p) => p.id)).size).toBe(count);
    expect(selected.sharedWithUserIds).toEqual(count ? [linked] : []);
    expect(selected.sharedWithFamilyMemberIds).toEqual(
      count ? ['profile:0'] : []
    );
    const deselected = {
      ...selected,
      ...selectFamilyParticipants(selected, [], family),
    };
    expect(deselected.participants).toEqual([]);
    expect(deselected.allFamily).toBe(true);
  });
}
it('display-only contacts, email and manual/pet profiles never become assignment choices', () => {
  const participants: Participant[] = [
    {
      id: 'email',
      name: 'old@example.com',
      email: 'old@example.com',
      color: '#fff',
      source: 'legacy',
    },
    { id: 'phone', name: 'Phone', color: '#fff', source: 'contact' },
    { id: 'pet', name: 'Pet', color: '#fff', source: 'family' },
    { id: 'child', name: 'Child', color: '#fff', source: 'family' },
  ];
  expect(
    personalAssignmentChoices(creator, participants).map((p) => p.name)
  ).toEqual(['אני']);
  participants.push({
    id: 'profile',
    name: 'Verified',
    color: '#fff',
    source: 'family',
    userId: linked,
  });
  expect(
    personalAssignmentChoices(creator, participants).map((p) => p.id)
  ).toEqual([creator, linked]);
  expect(
    selectFamilyParticipants(
      { ...base, participants },
      ['pet', 'child'],
      []
    ).participants?.slice(0, 2)
  ).toEqual(participants.slice(0, 2));
});
it('assignment diff preserves unknown accounts/manual names and saves explicit clear', () => {
  const original = [
    {
      _id: 'task' as Id<'eventTasks'>,
      title: 'Keep',
      completed: true,
      order: 0,
      assignedToUserId: linked,
    },
    {
      _id: 'manual' as Id<'eventTasks'>,
      title: 'Old',
      completed: false,
      order: 1,
      assignedToManual: 'Same',
    },
  ];
  const form = [
    {
      id: 'task',
      title: 'Keep',
      completed: true,
      assignedParticipantIds: [linked],
    },
    {
      id: 'manual',
      title: 'Old',
      completed: false,
      assignedParticipantIds: ['legacy-task:manual'],
    },
  ];
  expect(personalTaskEdits(form, original).personalTaskChanges).toEqual([]);
  form[0].assignedParticipantIds = [];
  expect(personalTaskEdits(form, original).personalTaskChanges).toEqual([
    { id: 'task', assignee: null },
  ]);
});

for (const visible of [false, true]) {
  for (const invited of [false, true]) {
    it(`Home personal task visibility: ${visible}, invitation=${invited}`, async () => {
      const f = ownerFixture();
      const viewer = fixture('viewer');
      Object.assign(viewer.tables, f.tables);
      Object.assign(viewer.tables.events[0], {
        allFamily: true,
        tasksVisibleToParticipants: visible,
        sharedWithUserIds: invited ? ['viewer'] : [],
      });
      const rows = (await invoke(tasks.listEventTasksForHome, viewer.ctx, {
        eventIds: ['event'],
      })) as { tasks: Row[] }[];
      expect(rows[0].tasks.map((t) => t._id)).toEqual(
        visible && invited ? ['task', 'manual'] : ['task']
      );
    });
  }
}
it('unauthorized atomic edit and foreign task IDs cannot mutate any records', async () => {
  const f = ownerFixture();
  const viewer = fixture('viewer');
  Object.assign(viewer.tables, f.tables);
  const before = structuredClone(viewer.tables);
  await expect(
    transaction(viewer, events.update, {
      id: 'event',
      personalTaskChanges: [{ id: 'task', assignee: 'viewer' }],
    })
  ).rejects.toThrow();
  expect(viewer.tables).toEqual(before);
  await expect(
    transaction(f, events.update, {
      id: 'event',
      title: 'Changed',
      personalTaskChanges: [{ id: 'foreign-task', assignee: null }],
    })
  ).rejects.toThrow();
  expect(f.tables).toEqual(before);
});
it('preserves legacy participant snapshots without relinking on unrelated edits', async () => {
  const f = ownerFixture();
  Object.assign(f.tables.events[0], {
    participants: ['Same', 'Same', 'old@example.com'],
    sharedWithFamilyMemberIds: ['unresolved-profile'],
    allFamily: true,
  });
  const before = structuredClone(f.tables.events[0]);
  await invoke(events.update, f.ctx, {
    id: 'event',
    title: 'Changed',
    personalTaskChanges: [],
  });
  expect(f.tables.events[0]).toEqual({ ...before, title: 'Changed' });
});

it('profile-only legacy phone stamp is not eligible for a new assignment', async () => {
  const f = ownerFixture();
  f.tables.events[0].sharedWithUserIds = [];
  f.tables.events[0].sharedWithFamilyMemberIds = ['entity'];
  f.tables.members = f.tables.members.filter((row) => row._id !== 'access');
  await expect(
    invoke(tasks.setAssignee, f.ctx, {
      id: 'manual',
      assignee: { type: 'user', userId: 'viewer' },
    })
  ).rejects.toThrow();
  expect(f.tables.eventTasks[1].assignedToManual).toBe('Name');
});
it('unchanged task order without stored order fields does not write tasks', () => {
  const original = [
    {
      _id: 'task' as Id<'eventTasks'>,
      title: 'Same',
      completed: false,
      assignedToManual: 'Old',
    },
  ];
  expect(
    personalTaskEdits(
      [
        {
          id: 'task',
          title: 'Same',
          completed: false,
          assignedParticipantIds: ['legacy-task:task'],
        },
      ],
      original
    ).personalTaskChanges
  ).toEqual([]);
});

for (const userId of ['viewer', 'stranger', null]) {
  it(`assignment-only discovery reveals only the caller's task: ${userId}`, async () => {
    const f = fixture(userId);
    f.tables.events[0].sharedWithUserIds = [];
    f.tables.eventTasks = [
      {
        _id: 'private-task',
        eventId: 'event',
        title: 'Own task',
        completed: false,
        assignedToUserId: 'viewer',
      },
    ];
    const rows = await invoke(
      tasks.listMyPrivatePersonalAssignments,
      f.ctx,
      {}
    );
    expect(rows).toEqual(
      userId === 'viewer'
        ? [{ _id: 'private-task', title: 'Own task', completed: false }]
        : []
    );
    if (userId === 'viewer') {
      await invoke(tasks.toggleCompleted, f.ctx, { id: 'private-task' });
      expect(
        await invoke(tasks.listMyPrivatePersonalAssignments, f.ctx, {})
      ).toEqual([{ _id: 'private-task', title: 'Own task', completed: true }]);
    }
    f.tables.events[0].deletedAt = 0;
    expect(
      await invoke(tasks.listMyPrivatePersonalAssignments, f.ctx, {})
    ).toEqual([]);
  });
}

it('an ineligible historical account stays in the form but is not a new assignment choice', () => {
  const participant: Participant = {
    id: 'old',
    userId: linked,
    name: 'Historical',
    color: '#fff',
    source: 'user',
    assignmentEligible: false,
  };
  expect(
    personalAssignmentChoices(creator, [participant]).map((p) => p.id)
  ).toEqual([creator]);
  expect(participant.userId).toBe(linked);
});

it('changing another participant never relinks a historical display profile or revoked account', () => {
  const event: EventData = {
    ...base,
    participants: [
      { id: 'old-profile', name: 'Old', color: '#fff', source: 'family' },
      {
        id: 'revoked',
        userId: linked,
        name: 'Revoked',
        color: '#fff',
        source: 'user',
        assignmentEligible: false,
      },
    ],
    sharedWithUserIds: [],
    sharedWithFamilyMemberIds: [],
  };
  const result = selectFamilyParticipants(
    event,
    ['old-profile', 'new-display'],
    [
      { _id: 'old-profile', displayName: 'Old', linkedUserId: linked },
      { _id: 'new-display', displayName: 'New' },
    ]
  );
  expect(result.sharedWithUserIds).toEqual([]);
  expect(result.sharedWithFamilyMemberIds).toEqual([]);
  expect(
    result.participants?.find((p) => p.id === 'old-profile')?.userId
  ).toBeUndefined();
});

// Deployment blockers: exercise production handlers without rollback emulation
// for validation failures, so an accidental early write cannot be hidden.
const managementOperations = [
  ['create', tasks.create, { eventId: 'event', title: 'New' }],
  [
    'createBatch',
    tasks.createBatch,
    { eventId: 'event', tasks: [{ title: 'New' }] },
  ],
  ['update', tasks.update, { id: 'task', title: 'Changed' }],
  ['remove', tasks.remove, { id: 'task' }],
  [
    'reorder',
    tasks.reorder,
    { eventId: 'event', orderedIds: ['manual', 'task'] },
  ],
  [
    'visibility',
    tasks.updateEventTaskVisibility,
    { eventId: 'event', tasksVisibleToParticipants: true },
  ],
  ['assignment', tasks.setAssignee, { id: 'task', assignee: null }],
  ['completion', tasks.toggleCompleted, { id: 'task' }],
] as const;

for (const scenario of [
  {
    name: 'active creator',
    actor: 'owner',
    role: 'member',
    status: 'active',
    allowed: true,
  },
  {
    name: 'legacy active creator',
    actor: 'owner',
    role: 'member',
    status: undefined,
    allowed: true,
  },
  {
    name: 'left creator',
    actor: 'owner',
    role: 'member',
    status: 'left',
    allowed: false,
  },
  {
    name: 'removed creator',
    actor: 'owner',
    role: undefined,
    status: undefined,
    allowed: false,
  },
  {
    name: 'pending creator',
    actor: 'owner',
    role: 'member',
    status: 'pending',
    allowed: false,
  },
  {
    name: 'active owner',
    actor: 'manager',
    role: 'owner',
    status: 'active',
    allowed: true,
  },
  {
    name: 'active admin',
    actor: 'manager',
    role: 'admin',
    status: 'active',
    allowed: true,
  },
  {
    name: 'inactive admin',
    actor: 'manager',
    role: 'admin',
    status: 'left',
    allowed: false,
  },
  {
    name: 'regular non-assignee',
    actor: 'regular',
    role: 'member',
    status: 'active',
    allowed: false,
  },
  {
    name: 'unrelated user',
    actor: 'stranger',
    role: undefined,
    status: undefined,
    allowed: false,
  },
  {
    name: 'unauthenticated',
    actor: null,
    role: undefined,
    status: undefined,
    allowed: false,
  },
]) {
  for (const [operation, handler, args] of managementOperations) {
    it(`community management ${operation}: ${scenario.name}`, async () => {
      const f = ownerFixture();
      f.ctx.auth.getUserIdentity = async () =>
        scenario.actor ? { subject: `${scenario.actor}|session` } : null;
      f.tables.events[0].communityId = 'community';
      if (scenario.role)
        f.tables.communityMembers.push({
          _id: 'membership',
          communityId: 'community',
          userId: scenario.actor,
          role: scenario.role,
          status: scenario.status,
        });
      const before = structuredClone(f.tables);
      if (scenario.allowed) {
        await invoke(handler, f.ctx, args);
        expect(f.tables).not.toEqual(before);
      } else {
        await expect(invoke(handler, f.ctx, args)).rejects.toThrow();
        expect(f.tables).toEqual(before);
      }
    });
  }
}

for (const [operation, handler, args] of managementOperations) {
  it(`personal creator retains ${operation} without community membership`, async () => {
    const f = ownerFixture();
    await invoke(handler, f.ctx, args);
  });
}
for (const [operation, handler] of [
  ['completion', tasks.toggleCompleted],
  ['own release', tasks.setAssignee],
] as const) {
  it(`active ordinary assignee retains ${operation}`, async () => {
    const f = ownerFixture();
    f.ctx.auth.getUserIdentity = async () => ({ subject: 'viewer|session' });
    f.tables.events[0].communityId = 'community';
    f.tables.communityMembers.push({
      _id: 'member',
      communityId: 'community',
      userId: 'viewer',
      role: 'member',
      status: 'active',
    });
    await invoke(handler, f.ctx, { id: 'task', assignee: null });
    expect(
      operation === 'completion'
        ? f.tables.eventTasks[0].completed
        : f.tables.eventTasks[0].assignedToUserId
    ).toBe(operation === 'completion' ? false : undefined);
  });
}

for (const count of [1, 2]) {
  it(`atomic participant removal deletes ${count} assigned tasks and preserves unrelated data`, async () => {
    const f = ownerFixture();
    if (count === 2)
      f.tables.eventTasks.push({ ...f.tables.eventTasks[0], _id: 'second' });
    const before = structuredClone(f.tables);
    await invoke(events.update, f.ctx, {
      id: 'event',
      title: 'Changed',
      sharedWithUserIds: [],
      deletedPersonalTaskIds: count === 1 ? ['task'] : ['task', 'second'],
    });
    expect(f.tables.events[0]).toEqual({
      ...before.events[0],
      title: 'Changed',
      sharedWithUserIds: [],
    });
    expect(f.tables.eventTasks).toEqual([before.eventTasks[1]]);
    expect(f.tables.eventRsvps).toEqual(before.eventRsvps);
  });
}
for (const replacement of [undefined, null, 'owner', 'stranger']) {
  it(`deletion plus remaining assignment resolution: ${replacement}`, async () => {
    const f = ownerFixture();
    f.tables.eventTasks.push({ ...f.tables.eventTasks[0], _id: 'remaining' });
    const before = structuredClone(f.tables);
    const args = {
      id: 'event',
      sharedWithUserIds: [],
      deletedPersonalTaskIds: ['task'],
      personalTaskChanges:
        replacement === undefined
          ? []
          : [{ id: 'remaining', assignee: replacement }],
    };
    if (replacement === undefined || replacement === 'stranger') {
      await expect(invoke(events.update, f.ctx, args)).rejects.toThrow();
      expect(f.tables).toEqual(before);
    } else {
      await invoke(events.update, f.ctx, args);
      expect(f.tables.eventTasks.map((t) => t._id)).toEqual([
        'manual',
        'remaining',
      ]);
      expect(f.tables.eventTasks[1]).toMatchObject({
        assignedToUserId: replacement ?? undefined,
        completed: true,
        completedAt: 10,
      });
      expect(f.tables.eventTasks[0]).toEqual(before.eventTasks[1]);
    }
  });
}
for (const scenario of [
  'invalid',
  'foreign',
  'duplicate',
  'stale-deleted',
  'concurrent-assignment',
  'unauthorized',
  'unauthenticated',
  'cancelled',
  'deleted',
  'delete-and-edit',
]) {
  it(`atomic deletion rejects ${scenario} without any writes`, async () => {
    const f = ownerFixture();
    let deletedIds = ['task'];
    if (scenario === 'invalid') deletedIds = ['missing'];
    if (scenario === 'foreign') {
      f.tables.eventTasks.push({ _id: 'foreign', eventId: 'another-event' });
      deletedIds.push('foreign');
    }
    if (scenario === 'duplicate') deletedIds.push('task');
    if (scenario === 'stale-deleted') f.tables.eventTasks.shift();
    if (scenario === 'concurrent-assignment')
      f.tables.eventTasks.push({
        ...f.tables.eventTasks[0],
        _id: 'concurrent',
      });
    if (scenario === 'unauthorized')
      f.ctx.auth.getUserIdentity = async () => ({ subject: 'viewer|session' });
    if (scenario === 'unauthenticated')
      f.ctx.auth.getUserIdentity = async () => null;
    if (scenario === 'cancelled') f.tables.events[0].status = 'cancelled';
    if (scenario === 'deleted') f.tables.events[0].deletedAt = 0;
    const before = structuredClone(f.tables);
    await expect(
      invoke(events.update, f.ctx, {
        id: 'event',
        title: 'Must not save',
        sharedWithUserIds: [],
        deletedPersonalTaskIds: deletedIds,
        personalTaskChanges:
          scenario === 'delete-and-edit'
            ? [{ id: 'task', assignee: null }]
            : [],
      })
    ).rejects.toThrow();
    expect(f.tables).toEqual(before);
  });
}

it('client snapshot diff submits combined deletion and preserves tasks outside the snapshot', async () => {
  const f = ownerFixture();
  const edits = personalTaskEdits(
    [],
    [
      {
        _id: 'task' as Id<'eventTasks'>,
        title: 'Keep',
        completed: true,
        assignedToUserId: 'viewer' as Id<'users'>,
      },
    ]
  );
  expect(edits).toEqual({
    personalTaskChanges: [],
    deletedPersonalTaskIds: ['task'],
  });
  await invoke(events.update, f.ctx, {
    id: 'event',
    sharedWithUserIds: [],
    ...edits,
  });
  expect(f.tables.eventTasks.map((t) => t._id)).toEqual(['manual']);
});

for (const status of ['active', 'left', 'pending', 'removed']) {
  for (const operation of ['claim', 'unclaim']) {
    it(`ordinary member ${operation} requires active membership: ${status}`, async () => {
      const f = ownerFixture();
      f.ctx.auth.getUserIdentity = async () => ({ subject: 'viewer|session' });
      Object.assign(f.tables.events[0], {
        communityId: 'community',
        startTime: Date.now() + 60_000,
        tasksVisibleToParticipants: true,
      });
      Object.assign(f.tables.eventTasks[0], {
        completed: false,
        assignedToUserId: operation === 'claim' ? undefined : 'viewer',
      });
      if (status !== 'removed')
        f.tables.communityMembers.push({
          _id: 'membership',
          communityId: 'community',
          userId: 'viewer',
          status,
          role: 'member',
        });
      const before = structuredClone(f.tables);
      const handler =
        operation === 'claim' ? tasks.claimEventTask : tasks.unclaimEventTask;
      if (status === 'active') {
        await invoke(handler, f.ctx, { id: 'task' });
        expect(f.tables.eventTasks[0].assignedToUserId).toBe(
          operation === 'claim' ? 'viewer' : undefined
        );
        expect(f.tables.eventRsvps).toEqual(before.eventRsvps);
      } else {
        await expect(invoke(handler, f.ctx, { id: 'task' })).rejects.toThrow();
        expect(f.tables).toEqual(before);
      }
    });
  }
}
