// Synthetic records only. Runs actual registered handlers/auth helpers; this is
// not a substitute for Convex's transaction isolation or hosted JWT validation.
export type Row = { _id: string; [key: string]: unknown };
type Predicate = (row: Row) => boolean;
const expressions = {
  field: (key: string) => (row: Row) => row[key],
  eq:
    (field: (row: Row) => unknown, value: unknown): Predicate =>
    (row) =>
      field(row) === value,
};
class Query {
  private predicates: Predicate[] = [];
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

export function privacyFixture(userId: string | null = 'owner') {
  const tables: Record<string, Row[]> = {
    users: [{ _id: 'owner' }, { _id: 'viewer' }],
    authSessions: [
      { _id: 'session', userId, expirationTime: Date.now() + 60000 },
    ],
    authRefreshTokens: [{ _id: 'refresh', sessionId: 'session' }],
    spaces: [{ _id: 'space', ownerId: 'viewer', type: 'personal' }],
    members: [
      { _id: 'member', kind: 'access', userId: 'viewer', spaceId: 'space' },
    ],
    events: [
      {
        _id: 'event',
        createdBy: 'owner',
        title: 'Live',
        startTime: 100,
        endTime: 200,
      },
    ],
    shareLinks: [
      {
        _id: 'link',
        eventId: 'event',
        createdBy: 'owner',
        token: 'share',
        revoked: false,
        createdAt: 1,
      },
    ],
    linkedEvents: [],
    pushTokens: [],
  };
  let sequence = 0;
  const ctx = {
    auth: {
      getUserIdentity: async () =>
        userId ? { subject: `${userId}|session` } : null,
    },
    db: {
      get: async (id: string) =>
        Object.values(tables)
          .flat()
          .find((row) => row._id === id) ?? null,
      query: (name: string) => new Query(tables[name] ?? []),
      insert: async (name: string, value: object) => {
        const _id = `new-${++sequence}`;
        tables[name] ??= [];
        tables[name].push({ ...value, _id });
        return _id;
      },
      patch: async (id: string, patch: object) => {
        const row = Object.values(tables)
          .flat()
          .find((r) => r._id === id);
        if (!row) throw new Error('Missing fixture row');
        Object.assign(row, patch);
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
export function invoke(
  handler: unknown,
  ctx: ReturnType<typeof privacyFixture>['ctx'],
  args: object
) {
  return (
    handler as { _handler: (ctx: typeof ctx, args: object) => Promise<unknown> }
  )._handler(ctx, args);
}
