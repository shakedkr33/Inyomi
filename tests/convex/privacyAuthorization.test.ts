import { describe, expect, it } from 'bun:test';
import * as rsvps from '../../convex/eventRsvps';
import * as events from '../../convex/events';
import {
  deleteLinkedEvent,
  getLinkedEventDetail,
  getLinkedEventsForSpace,
  saveLinkedEvent,
} from '../../convex/linkedEvents';
import { removeEntityMember, renameSpace, listMyFamilyContacts, getMySpaceRole, acceptPendingPhoneMatch, completeExistingUserFamilyJoin } from '../../convex/members';
import { updateMyProfile } from '../../convex/users';
import { finishOnboarding } from '../../convex/onboarding';
import * as links from '../../convex/shareLinks';

// Execute the real registered query handlers against an in-memory read adapter.
// No module mocks, deployed functions, network requests or real records are used.
// This tests authorization and query ordering, not Convex's runtime/index engine.
type Row = { _id: string; [field: string]: unknown };
type Predicate = (row: Row) => boolean;
const expressions = {
  field: (name: string) => (row: Row) => row[name],
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
  async first() {
    return (await this.collect())[0] ?? null;
  }
  async unique() {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error('Non-unique fixture');
    return rows[0] ?? null;
  }
}
const owner = 'owner';
const viewer = 'viewer';
const personal: Row = {
  _id: 'event',
  createdBy: owner,
  spaceId: 'family',
  title: 'Private',
  startTime: 100,
  endTime: 200,
  isAiGenerated: false,
  attachments: [{ storageId: 'file' }],
};
const access: Row = {
  _id: 'access',
  userId: viewer,
  spaceId: 'family',
  kind: 'access',
  role: 'member',
};
const entity: Row = {
  _id: 'entity',
  userId: viewer,
  matchedUserId: viewer,
  spaceId: 'family',
  kind: 'entity',
  displayName: 'Viewer',
  inviteStatus: 'joined',
};
function fixture(
  userId: string | null,
  event: Row = personal,
  extra: Record<string, Row[]> = {}
) {
  const tables: Record<string, Row[]> = {
    events: [event],
    members: [access, entity],
    users: [
      { _id: owner, fullName: 'Owner' },
      { _id: viewer, fullName: 'Viewer' },
    ],
    eventRsvps: [
      { _id: 'rsvp', eventId: 'event', userId: viewer, status: 'yes' },
    ],
    shareLinks: [
      {
        _id: 'link',
        eventId: 'event',
        createdBy: owner,
        token: 'test-token',
        revoked: false,
      },
    ],
    ...extra,
  };
  const reads: string[] = [];
  const ctx = {
    auth: {
      getUserIdentity: async () =>
        userId ? { subject: `${userId}|session` } : null,
    },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => {
        reads.push(`get:${id}`);
        return (
          Object.values(tables)
            .flat()
            .find((row) => row._id === id) ?? null
        );
      },
      query: (table: string) => {
        reads.push(table);
        return new ReadQuery(tables[table] ?? []);
      },
    },
    storage: {
      getUrl: async (id: string) => {
        reads.push('storage');
        return `https://files.test/${id}`;
      },
    },
  };
  return { ctx, reads, tables };
}
async function invoke(
  query: unknown,
  ctx: ReturnType<typeof fixture>['ctx'],
  args: object
): Promise<unknown> {
  // Convex exposes the original handler on registered functions; only this test
  // boundary substitutes the small DB/auth adapter for the runtime context.
  return (
    query as { _handler: (ctx: unknown, args: object) => Promise<unknown> }
  )._handler(ctx, args);
}

describe('P0-03 real event detail + attachment + calendar handlers', () => {
  const scenarios: Array<{
    name: string;
    user: string | null;
    event?: Row;
    members?: Row[];
    allowed: boolean;
  }> = [
    { name: 'unauthenticated', user: null, allowed: false },
    { name: 'owner', user: owner, allowed: true },
    {
      name: 'same-family member without sharing',
      user: viewer,
      allowed: false,
    },
    { name: 'unrelated user', user: 'stranger', allowed: false },
    {
      name: 'explicit user sharing',
      user: viewer,
      event: { ...personal, sharedWithUserIds: [viewer] },
      allowed: true,
    },
    {
      name: 'explicit member sharing',
      user: viewer,
      event: { ...personal, sharedWithFamilyMemberIds: ['entity'] },
      allowed: true,
    },
    {
      name: 'cross-space member sharing',
      user: viewer,
      event: {
        ...personal,
        spaceId: 'other',
        sharedWithFamilyMemberIds: ['entity'],
      },
      allowed: true,
    },
    {
      name: 'all-family sharing',
      user: viewer,
      event: { ...personal, allFamily: true },
      allowed: true,
    },
    {
      name: 'all-family does not grant unrelated access',
      user: 'stranger',
      event: { ...personal, allFamily: true },
      allowed: false,
    },
    {
      name: 'discovery-only match',
      user: viewer,
      event: {
        ...personal,
        allFamily: true,
        sharedWithFamilyMemberIds: ['entity'],
      },
      members: [{ ...entity, userId: undefined }],
      allowed: false,
    },
    {
      name: 'entity alone does not grant all-family access',
      user: viewer,
      event: { ...personal, allFamily: true },
      members: [entity],
      allowed: false,
    },
    {
      name: 'legacy access row with explicit all-family sharing',
      user: viewer,
      event: { ...personal, allFamily: true },
      members: [{ ...access, kind: undefined }],
      allowed: true,
    },
    {
      name: 'legacy event missing sharing fields',
      user: viewer,
      allowed: false,
    },
    {
      name: 'ownerScope family is not a grant',
      user: viewer,
      event: { ...personal, ownerScope: 'family' },
      allowed: false,
    },
    {
      name: 'Google import private',
      user: viewer,
      event: { ...personal, source: 'google_copy', ownerScope: 'personal' },
      allowed: false,
    },
    {
      name: 'Google import owner',
      user: owner,
      event: { ...personal, source: 'google_copy', ownerScope: 'personal' },
      allowed: true,
    },
    {
      name: 'Google import explicitly shared later',
      user: viewer,
      event: {
        ...personal,
        source: 'google_copy',
        sharedWithUserIds: [viewer],
      },
      allowed: true,
    },
  ];
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const members = scenario.members ?? [access, entity];
      const { ctx, reads } = fixture(scenario.user, scenario.event, {
        members: [
          ...members,
          { ...access, _id: 'owner-access', userId: owner, role: 'admin' },
        ],
      });
      const detail = await invoke(events.getById, ctx, { eventId: 'event' });
      const attachment = await invoke(events.getEventAttachmentUrl, ctx, {
        eventId: 'event',
        storageId: 'file',
      });
      const calendar = await invoke(events.listByDateRange, ctx, {
        from: 0,
        to: 300,
      });
      if (scenario.allowed) {
        expect(detail).toEqual(expect.objectContaining({ _id: 'event' }));
        expect(attachment).toBe('https://files.test/file');
        expect(calendar).toEqual(
          expect.arrayContaining([expect.objectContaining({ _id: 'event' })])
        );
      } else {
        expect(detail).toBeNull();
        expect(attachment).toBeNull();
        expect(reads).not.toContain('storage');
        expect(calendar).toEqual([]);
      }
    });
  }
  for (const role of ['owner', 'admin', 'member']) {
    for (const status of ['active', 'pending', 'left']) {
      it(`community ${role}/${status}`, async () => {
        const { ctx } = fixture(
          viewer,
          { ...personal, communityId: 'community' },
          {
            communityMembers: [
              {
                _id: 'membership',
                communityId: 'community',
                userId: viewer,
                role,
                status,
              },
            ],
          }
        );
        const detail = await invoke(events.getById, ctx, { eventId: 'event' });
        const attachment = await invoke(events.getEventAttachmentUrl, ctx, {
          eventId: 'event',
          storageId: 'file',
        });
        expect(detail !== null).toBe(status === 'active');
        expect(attachment !== null).toBe(status === 'active');
      });
    }
  }
  it('community creator without active membership is denied', async () => {
    const { ctx } = fixture(owner, { ...personal, communityId: 'community' });
    expect(await invoke(events.getById, ctx, { eventId: 'event' })).toBeNull();
    expect(
      await invoke(events.getEventAttachmentUrl, ctx, {
        eventId: 'event',
        storageId: 'file',
      })
    ).toBeNull();
  });
  it('owner cannot use an unrelated storage ID; missing event fails closed', async () => {
    const { ctx, reads } = fixture(owner);
    expect(
      await invoke(events.getEventAttachmentUrl, ctx, {
        eventId: 'event',
        storageId: 'foreign',
      })
    ).toBeNull();
    expect(
      await invoke(events.getById, ctx, { eventId: 'missing' })
    ).toBeNull();
    expect(reads).not.toContain('storage');
  });
});

describe('P0-01 real RSVP handler', () => {
  for (const user of [null, 'stranger', viewer]) {
    it(`denies unshared personal event to ${user}, including stale RSVP owner`, async () => {
      const { ctx, reads } = fixture(user);
      expect(
        await invoke(rsvps.getRsvpForUser, ctx, {
          eventId: 'event',
          userId: viewer,
        })
      ).toBeNull();
      expect(reads).not.toContain('eventRsvps');
    });
  }
  it('organizer can read an invitee RSVP', async () => {
    const { ctx } = fixture(owner);
    expect(
      await invoke(rsvps.getRsvpForUser, ctx, {
        eventId: 'event',
        userId: viewer,
      })
    ).toEqual(expect.objectContaining({ status: 'yes' }));
  });
  for (const share of [
    { sharedWithUserIds: [viewer] },
    { sharedWithFamilyMemberIds: ['entity'] },
  ]) {
    it('invited participant can read self but not another invitee', async () => {
      const { ctx } = fixture(viewer, { ...personal, ...share });
      expect(
        await invoke(rsvps.getRsvpForUser, ctx, {
          eventId: 'event',
          userId: viewer,
        })
      ).toEqual(expect.objectContaining({ status: 'yes' }));
      expect(
        await invoke(rsvps.getRsvpForUser, ctx, {
          eventId: 'event',
          userId: owner,
        })
      ).toBeNull();
    });
  }
  for (const role of ['owner', 'admin', 'member']) {
    for (const status of ['active', 'pending', 'left']) {
      it(`community RSVP access ${role}/${status} agrees with listByEvent`, async () => {
        const { ctx } = fixture(
          'manager',
          { ...personal, communityId: 'community' },
          {
            communityMembers: [
              {
                _id: 'membership',
                communityId: 'community',
                userId: 'manager',
                role,
                status,
              },
            ],
          }
        );
        const result = await invoke(rsvps.getRsvpForUser, ctx, {
          eventId: 'event',
          userId: viewer,
        });
        const list = await invoke(rsvps.listByEvent, ctx, { eventId: 'event' });
        expect(result !== null).toBe(status === 'active');
        expect(list).toEqual(
          status === 'active'
            ? [expect.objectContaining({ userId: viewer })]
            : []
        );
      });
    }
  }
  it('pending phone match cannot read personal RSVP through either query', async () => {
    const { ctx } = fixture(
      viewer,
      { ...personal, sharedWithFamilyMemberIds: ['entity'] },
      {
        members: [
          access,
          { ...entity, userId: undefined, inviteStatus: 'invited' },
        ],
      }
    );
    expect(
      await invoke(rsvps.getRsvpForUser, ctx, {
        eventId: 'event',
        userId: viewer,
      })
    ).toBeNull();
    expect(await invoke(rsvps.listByEvent, ctx, { eventId: 'event' })).toEqual(
      []
    );
  });
  it('allFamily grants event read but not personal RSVP invitation', async () => {
    const { ctx } = fixture(viewer, { ...personal, allFamily: true });
    expect(
      await invoke(rsvps.getRsvpForUser, ctx, {
        eventId: 'event',
        userId: viewer,
      })
    ).toBeNull();
    expect(await invoke(rsvps.listByEvent, ctx, { eventId: 'event' })).toEqual(
      []
    );
  });
  it('missing event does not expose an orphan RSVP', async () => {
    const { ctx, reads } = fixture(owner, personal, { events: [] });
    expect(
      await invoke(rsvps.getRsvpForUser, ctx, {
        eventId: 'event',
        userId: viewer,
      })
    ).toBeNull();
    expect(reads).not.toContain('eventRsvps');
  });
});

describe('P0-02 real share link handlers', () => {
  for (const user of [null, viewer, 'stranger']) {
    it(`denies link management to ${user} even with explicit event read access`, async () => {
      const { ctx, reads } = fixture(user, {
        ...personal,
        sharedWithUserIds: [viewer],
      });
      expect(
        await invoke(links.getMyShareLink, ctx, { eventId: 'event' })
      ).toBeNull();
      expect(reads).not.toContain('shareLinks');
    });
  }
  it('creator retrieves existing link via query and create mutation', async () => {
    const { ctx } = fixture(owner);
    expect(
      await invoke(links.getMyShareLink, ctx, { eventId: 'event' })
    ).toEqual(expect.objectContaining({ token: 'test-token' }));
    expect(
      await invoke(links.createShareLink, ctx, { eventId: 'event' })
    ).toEqual({ token: 'test-token' });
  });
  it('unauthorized user cannot create or revoke a link', async () => {
    const { ctx } = fixture(viewer);
    await expect(
      invoke(links.createShareLink, ctx, { eventId: 'event' })
    ).rejects.toThrow();
    await expect(
      invoke(links.revokeShareLink, ctx, { eventId: 'event' })
    ).rejects.toThrow();
  });
  it('valid public token exposes preview, not attachments or RSVP', async () => {
    const { ctx } = fixture(null);
    const result = await invoke(links.getSharePreview, ctx, {
      token: 'test-token',
    });
    expect(result).toEqual(
      expect.objectContaining({ status: 'ok', title: 'Private' })
    );
    expect(result).not.toHaveProperty('attachments');
    expect(await invoke(events.getById, ctx, { eventId: 'event' })).toBeNull();
  });
  for (const token of ['test-token', 'invalid']) {
    it(`revoked/invalid token ${token} cannot expose preview`, async () => {
      const { ctx } = fixture(owner, personal, {
        shareLinks: [
          { _id: 'link', eventId: 'event', token: 'test-token', revoked: true },
        ],
      });
      expect(
        await invoke(links.getMyShareLink, ctx, { eventId: 'event' })
      ).toBeNull();
      expect(await invoke(links.getSharePreview, ctx, { token })).toEqual({
        status: 'revoked',
      });
    });
  }
  it('missing event cannot expose its old link', async () => {
    const { ctx } = fixture(owner, personal, { events: [] });
    expect(
      await invoke(links.getMyShareLink, ctx, { eventId: 'event' })
    ).toBeNull();
    expect(
      await invoke(links.getSharePreview, ctx, { token: 'test-token' })
    ).toEqual({ status: 'not_found' });
  });
  it('saved recipient keeps limited linked detail, without full event access', async () => {
    const { ctx } = fixture(viewer, personal, {
      linkedEvents: [
        {
          _id: 'saved',
          sourceEventId: 'event',
          savedByUserId: viewer,
          ownerUserId: owner,
          sourceStatus: 'active',
        },
      ],
    });
    expect(
      await invoke(getLinkedEventDetail, ctx, { linkedEventId: 'saved' })
    ).toEqual(expect.objectContaining({ title: 'Private', isLinked: true }));
    expect(await invoke(events.getById, ctx, { eventId: 'event' })).toBeNull();
  });
});

describe('linked event space authorization', () => {
  const args = { spaceId: 'family', from: 100, to: 200 };
  const saved: Row = {
    _id: 'saved',
    sourceEventId: 'event',
    savedByUserId: viewer,
    ownerUserId: owner,
    spaceId: 'family',
    sourceStatus: 'active',
    snapshotTitle: 'Snapshot',
    snapshotStartTime: 100,
    snapshotEndTime: 200,
    savedAt: 50,
  };

  for (const scenario of [
    { name: 'unauthenticated', user: null, members: [access] },
    {
      name: 'stranger knowing the space ID',
      user: 'stranger',
      members: [access],
    },
    {
      name: 'member of another space',
      user: viewer,
      members: [{ ...access, spaceId: 'other' }],
    },
    {
      name: 'removed access with a remaining entity',
      user: viewer,
      members: [entity],
    },
    { name: 'former member with no remaining rows', user: viewer, members: [] },
    {
      name: 'pending phone invitation',
      user: viewer,
      members: [{ ...entity, userId: undefined, inviteStatus: 'invited' }],
    },
    {
      name: 'legacy entity without access',
      user: viewer,
      members: [{ ...entity, kind: undefined }],
    },
  ]) {
    it(`denies ${scenario.name} before reading linked rows or sources`, async () => {
      const { ctx, reads } = fixture(scenario.user, personal, {
        members: scenario.members,
        linkedEvents: [saved],
      });
      expect(await invoke(getLinkedEventsForSpace, ctx, args)).toEqual([]);
      expect(reads).not.toContain('linkedEvents');
      expect(reads).not.toContain('get:event');
      if (scenario.user === null) expect(reads).toEqual([]);
    });
  }

  for (const member of [
    access,
    { ...access, role: 'admin' },
    { ...access, kind: undefined },
  ]) {
    it(`allows ${member.role} membership with kind ${member.kind}`, async () => {
      const { ctx } = fixture(viewer, personal, {
        members: [entity, member],
        // Preserve the existing space-wide list, including saves by co-members.
        linkedEvents: [{ ...saved, savedByUserId: 'co-member' }],
      });
      expect(await invoke(getLinkedEventsForSpace, ctx, args)).toEqual([
        expect.objectContaining({
          _id: 'saved',
          title: 'Private',
          isLinked: true,
        }),
      ]);
    });
  }

  it('revokes list access when the access row is removed between requests', async () => {
    const members = [access, entity];
    const { ctx } = fixture(viewer, personal, {
      members,
      linkedEvents: [saved],
    });
    expect(await invoke(getLinkedEventsForSpace, ctx, args)).toHaveLength(1);
    members.splice(0, 1);
    expect(await invoke(getLinkedEventsForSpace, ctx, args)).toEqual([]);
  });

  it('preserves linked events in the recipient personal space', async () => {
    const { ctx } = fixture(viewer, personal, {
      spaces: [{ _id: 'personal-space', type: 'personal' }],
      members: [{ ...access, spaceId: 'personal-space', role: 'admin' }],
      linkedEvents: [{ ...saved, spaceId: 'personal-space' }],
    });
    expect(
      await invoke(getLinkedEventsForSpace, ctx, {
        ...args,
        spaceId: 'personal-space',
      })
    ).toEqual([expect.objectContaining({ _id: 'saved', title: 'Private' })]);
  });

  it('single linked-event permission does not grant space access', async () => {
    const { ctx } = fixture(viewer, personal, {
      members: [],
      linkedEvents: [saved],
    });
    expect(await invoke(getLinkedEventsForSpace, ctx, args)).toEqual([]);
    expect(
      await invoke(getLinkedEventDetail, ctx, { linkedEventId: 'saved' })
    ).toEqual(expect.objectContaining({ title: 'Private', isLinked: true }));
    expect(await invoke(events.getById, ctx, { eventId: 'event' })).toBeNull();
  });

  it('explicit source-event sharing does not grant space access', async () => {
    const { ctx } = fixture(
      viewer,
      { ...personal, sharedWithUserIds: [viewer] },
      {
        members: [],
        linkedEvents: [saved],
      }
    );
    expect(await invoke(getLinkedEventsForSpace, ctx, args)).toEqual([]);
    expect(await invoke(events.getById, ctx, { eventId: 'event' })).toEqual(
      expect.objectContaining({ title: 'Private' })
    );
  });

  it('preserves live data, snapshots, date boundaries, projection and space isolation', async () => {
    const { ctx } = fixture(
      viewer,
      { ...personal, status: 'cancelled' },
      {
        linkedEvents: [
          saved,
          {
            ...saved,
            _id: 'deleted',
            sourceStatus: 'deleted',
            snapshotEndTime: 100,
          },
          {
            ...saved,
            _id: 'missing',
            sourceEventId: 'missing-source',
            snapshotStartTime: 200,
          },
          {
            ...saved,
            _id: 'past',
            sourceStatus: 'deleted',
            snapshotEndTime: 99,
          },
          {
            ...saved,
            _id: 'future',
            sourceStatus: 'deleted',
            snapshotStartTime: 201,
          },
          { ...saved, _id: 'other-space', spaceId: 'other' },
        ],
      }
    );
    const result = await invoke(getLinkedEventsForSpace, ctx, args);
    expect(result).toEqual([
      expect.objectContaining({
        _id: 'saved',
        title: 'Private',
        sourceStatus: 'cancelled',
      }),
      expect.objectContaining({
        _id: 'deleted',
        title: 'Snapshot',
        sourceStatus: 'deleted',
      }),
      expect.objectContaining({
        _id: 'missing',
        title: 'Snapshot',
        sourceStatus: 'deleted',
      }),
    ]);
    for (const row of result as object[]) {
      expect(row).not.toHaveProperty('attachments');
      expect(row).not.toHaveProperty('shareToken');
    }
  });
});

// Local mutation adapter: persists into the read fixture so follow-up queries
// exercise actual saved/deleted records. Does not emulate Convex transactions
// or argument validation; all fixtures are synthetic.
function mutationFixture(
  userId: string | null,
  event: Row = personal,
  extra: Record<string, Row[]> = {}
) {
  const base = fixture(userId, event, {
    spaces: [{ _id: 'family', type: 'family', ownerId: owner }],
    linkedEvents: [],
    ...extra,
  });
  const writes: string[] = [];
  const ctx = {
    ...base.ctx,
    db: {
      ...base.ctx.db,
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `inserted-${writes.length}`;
        writes.push(`insert:${table}`);
        base.tables[table] ??= [];
        base.tables[table].push({ ...value, _id: id });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        const row = Object.values(base.tables).flat().find((row) => row._id === id);
        if (!row) throw new Error('Missing fixture row');
        writes.push(`patch:${id}`);
        Object.assign(row, value);
      },
      delete: async (id: string) => {
        writes.push(`delete:${id}`);
        for (const rows of Object.values(base.tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) rows.splice(index, 1);
        }
      },
    },
  };
  return { ...base, ctx, writes };
}

describe('linked-event write authorization', () => {
  const args = { shareToken: 'test-token', spaceId: 'family' };
  for (const scenario of [
    { name: 'unauthenticated', user: null, members: [access] },
    {
      name: 'unrelated authenticated user',
      user: 'stranger',
      members: [access],
    },
    {
      name: 'access to another space',
      user: viewer,
      members: [{ ...access, spaceId: 'other' }],
    },
    { name: 'former member', user: viewer, members: [entity] },
    {
      name: 'pending invite',
      user: viewer,
      members: [{ ...entity, userId: undefined, inviteStatus: 'invited' }],
    },
  ]) {
    it(`blocks ${scenario.name} without writes or link reads`, async () => {
      const { ctx, writes, reads } = mutationFixture(scenario.user, personal, {
        members: scenario.members,
      });
      await expect(invoke(saveLinkedEvent, ctx, args)).rejects.toThrow();
      expect(writes).toEqual([]);
      expect(reads).not.toContain('shareLinks');
    });
  }

  it('a valid token and explicit source sharing do not grant destination access', async () => {
    const { ctx, writes } = mutationFixture(
      viewer,
      { ...personal, sharedWithUserIds: [viewer] },
      { members: [] }
    );
    expect(
      await invoke(events.getById, ctx, { eventId: 'event' })
    ).not.toBeNull();
    await expect(invoke(saveLinkedEvent, ctx, args)).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  for (const member of [
    access,
    { ...access, role: 'admin' },
    { ...access, kind: undefined },
  ]) {
    it(`saves, displays and removes for ${member.role}/${member.kind}`, async () => {
      const { ctx, tables } = mutationFixture(viewer, personal, {
        members: [member, entity],
      });
      await invoke(saveLinkedEvent, ctx, args);
      const saved = tables.linkedEvents[0];
      expect(saved).toMatchObject({
        savedByUserId: viewer,
        ownerUserId: owner,
        spaceId: 'family',
        sourceEventId: 'event',
        sourceStatus: 'active',
        snapshotTitle: 'Private',
      });
      expect(saved).not.toHaveProperty('attachments');
      expect(
        await invoke(getLinkedEventsForSpace, ctx, {
          spaceId: 'family',
          from: 100,
          to: 200,
        })
      ).toHaveLength(1);
      expect(
        await invoke(getLinkedEventDetail, ctx, { linkedEventId: saved._id })
      ).not.toBeNull();
      await expect(invoke(saveLinkedEvent, ctx, args)).rejects.toThrow(
        'כבר שמרת'
      );
      expect(tables.linkedEvents).toHaveLength(1);
      await invoke(deleteLinkedEvent, ctx, { linkedEventId: saved._id });
      expect(tables.linkedEvents).toEqual([]);
      expect(tables.events).toEqual([personal]);
    });
  }

  it('supports saving a cancelled source into an authorized personal space', async () => {
    const { ctx, tables } = mutationFixture(
      viewer,
      { ...personal, status: 'cancelled' },
      {
        spaces: [{ _id: 'personal-space', type: 'personal', ownerId: viewer }],
        members: [{ ...access, spaceId: 'personal-space', role: 'admin' }],
      }
    );
    await invoke(saveLinkedEvent, ctx, { ...args, spaceId: 'personal-space' });
    expect(tables.linkedEvents[0]).toMatchObject({
      spaceId: 'personal-space',
      sourceStatus: 'cancelled',
    });
  });

  for (const scenario of [
    {
      name: 'invalid token',
      args: { ...args, shareToken: 'invalid' },
      extra: {},
    },
    {
      name: 'revoked token',
      args,
      extra: {
        shareLinks: [
          { _id: 'link', token: 'test-token', eventId: 'event', revoked: true },
        ],
      },
    },
    { name: 'deleted source', args, extra: { events: [] } },
    {
      name: 'stale destination',
      args: { ...args, spaceId: 'missing-space' },
      extra: {},
    },
    {
      name: 'deleted destination with stale access row',
      args,
      extra: { spaces: [] },
    },
  ]) {
    it(`rejects ${scenario.name} without writes`, async () => {
      const { ctx, writes } = mutationFixture(viewer, personal, scenario.extra);
      await expect(
        invoke(saveLinkedEvent, ctx, scenario.args)
      ).rejects.toThrow();
      expect(writes).toEqual([]);
    });
  }

  it('preserves prohibition on saving the source owner own event', async () => {
    const { ctx, writes } = mutationFixture(owner, personal, {
      members: [{ ...access, userId: owner }],
    });
    await expect(invoke(saveLinkedEvent, ctx, args)).rejects.toThrow('בבעלותך');
    expect(writes).toEqual([]);
  });
});

describe('family profile removal guards pending safe migration', () => {
  const admin = {
    ...access,
    _id: 'admin-access',
    userId: owner,
    role: 'admin',
  };

  it('removes only a manual child profile, preserving ownership and family data', async () => {
    const child = {
      ...entity,
      _id: 'child',
      userId: undefined,
      matchedUserId: undefined,
      displayName: 'Child',
      inviteStatus: 'none',
    };
    const { ctx, tables, writes } = mutationFixture(owner, personal, {
      members: [admin, access, entity, child],
    });
    await invoke(removeEntityMember, ctx, { memberId: 'child' });
    expect(writes).toEqual(['delete:child']);
    expect(tables.members).toEqual([admin, access, entity]);
    expect(tables.events).toEqual([personal]);
    expect(tables.spaces[0].ownerId).toBe(owner);
  });

  it('blocks joined-profile deletion rather than claiming to revoke access', async () => {
    const members = [admin, access, entity];
    const { ctx, writes, tables } = mutationFixture(owner, personal, { members });
    await expect(invoke(removeEntityMember, ctx, { memberId: 'entity' }))
      .rejects.toThrow('עדיין אינם זמינים');
    expect(writes).toEqual([]);
    expect(tables.members).toEqual([admin, access, entity]);
    expect(tables.events).toEqual([personal]);
  });

  for (const user of [null, viewer, 'stranger']) {
    it(`prevents profile removal by non-admin ${user}`, async () => {
      const { ctx, writes } = mutationFixture(user, personal, {
        members: [admin, access, entity],
      });
      await expect(
        invoke(removeEntityMember, ctx, { memberId: 'entity' })
      ).rejects.toThrow();
      expect(writes).toEqual([]);
    });
  }

  it('does not allow even the admin to delete an access row through profile removal', async () => {
    const { ctx, writes } = mutationFixture(owner, personal, {
      members: [admin, access, entity],
    });
    await expect(
      invoke(removeEntityMember, ctx, { memberId: 'access' })
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});


describe('owner-only family management through registered handlers', () => {
  const admin = {
    ...access,
    _id: 'owner-access',
    userId: owner,
    role: 'admin',
  };
  const child = {
    _id: 'child',
    spaceId: 'family',
    kind: 'entity',
    role: 'member',
    displayName: 'Child',
  };
  const contacts = [{ id: 'child', name: 'Child', color: '#123456' }];

  for (const familyContacts of [
    contacts,
    [],
    [{ id: 'entity', name: 'Changed' }],
  ]) {
    it(`rejects a member family write before any persistence: ${JSON.stringify(familyContacts)}`, async () => {
      const { ctx, writes } = mutationFixture(viewer, personal, {
        members: [admin, access, entity, child],
      });
      await expect(
        invoke(updateMyProfile, ctx, { familyContacts })
      ).rejects.toThrow('הרשאה');
      expect(writes).toEqual([]);
    });
  }

  it('allows a regular member to edit their own account and claimed profile', async () => {
    const mine = { ...entity };
    const { ctx, tables } = mutationFixture(viewer, personal, {
      members: [admin, access, mine, child],
    });
    await invoke(updateMyProfile, ctx, {
      firstName: 'New',
      lastName: 'Name',
      profileColor: '#abcdef',
    });
    expect(tables.users.find((row) => row._id === viewer)?.fullName).toBe(
      'New Name'
    );
    expect(mine.displayName).toBe('New Name');
    expect(child.displayName).toBe('Child');
    expect(tables.events).toEqual([personal]);
  });

  it('allows the owner to edit a manual profile without changing its stable ID', async () => {
    const profile = { ...child };
    const { ctx, tables } = mutationFixture(owner, personal, {
      members: [admin, profile],
    });
    await invoke(updateMyProfile, ctx, {
      familyContacts: [{ ...contacts[0], name: 'Renamed' }],
    });
    expect(tables.members).toHaveLength(2);
    expect(profile._id).toBe('child');
    expect(profile.displayName).toBe('Renamed');
    expect(tables.events).toEqual([personal]);
  });

  it('allows owner edits to the joined family profile without changing the personal account', async () => {
    const profile = { ...entity, selectedPhoneNumber: '+972501234567' };
    const { ctx, tables } = mutationFixture(owner, personal, {
      members: [admin, access, profile],
    });
    await invoke(updateMyProfile, ctx, {
      familyContacts: [
        {
          id: 'entity',
          name: 'Family label',
          selectedPhoneNumber: '+972501234567',
          matchedUserId: owner,
        },
      ],
    });
    expect(profile.displayName).toBe('Family label');
    expect(profile.userId).toBe(viewer);
    expect(profile.matchedUserId).toBe(viewer);
    expect(tables.users.find((row) => row._id === viewer)?.fullName).toBe(
      'Viewer'
    );
  });

  it('does not permit bulk synchronization to delete a joined profile', async () => {
    const { ctx, tables } = mutationFixture(owner, personal, {
      members: [admin, access, entity],
    });
    await expect(
      invoke(updateMyProfile, ctx, { familyContacts: [] })
    ).rejects.toThrow('עדיין אינם זמינים');
    expect(tables.members).toEqual([admin, access, entity]);
  });

  it('ignores a forged authenticated identity and joined status on a new contact', async () => {
    const { ctx, tables } = mutationFixture(owner, personal, {
      members: [admin],
    });
    await invoke(updateMyProfile, ctx, {
      familyContacts: [
        {
          id: 'local',
          name: 'New',
          selectedPhoneNumber: '+972501234567',
          matchedUserId: viewer,
          inviteStatus: 'joined',
        },
      ],
    });
    const added = tables.members.find((row) => row.kind === 'entity');
    expect(added?.userId).toBeUndefined();
    expect(added?.matchedUserId).toBeUndefined();
    expect(added?.inviteStatus).toBe('none');
  });

  it('does not confer owner rights through an admin role or IDs from another space', async () => {
    const { ctx, writes } = mutationFixture(viewer, personal, {
      members: [admin, { ...access, role: 'admin' }, child],
    });
    expect(await invoke(getMySpaceRole, ctx, {})).toMatchObject({
      isOwner: false,
    });
    await expect(
      invoke(renameSpace, ctx, { spaceId: 'family', name: 'Changed' })
    ).rejects.toThrow();
    await expect(
      invoke(removeEntityMember, ctx, { memberId: 'child' })
    ).rejects.toThrow();
    await expect(
      invoke(updateMyProfile, ctx, { familyContacts: contacts })
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it('protects an owner entity even when targeted by its exact ID', async () => {
    const ownerEntity = {
      ...entity,
      _id: 'owner-entity',
      userId: owner,
      matchedUserId: owner,
    };
    const { ctx, writes } = mutationFixture(owner, personal, {
      members: [admin, ownerEntity],
    });
    await expect(
      invoke(removeEntityMember, ctx, { memberId: ownerEntity._id })
    ).rejects.toThrow('בעלות');
    expect(writes).toEqual([]);
  });

  it('denies family profile reads through an entity without authenticated access', async () => {
    const { ctx, reads } = fixture(viewer, personal, {
      members: [entity, child, admin],
    });
    expect(await invoke(listMyFamilyContacts, ctx, {})).toEqual({
      selfEntityId: null,
      members: [],
    });
    expect(reads).not.toContain('users');
  });

  it('creates the first space with the authenticated creator as sole owner', async () => {
    const { ctx, tables } = mutationFixture(viewer, personal, {
      members: [],
      spaces: [],
    });
    await invoke(finishOnboarding, ctx, {
      firstName: 'New',
      lastName: 'Person',
      spaceType: 'family',
      challenges: [],
      familyContacts: [],
    });
    expect(tables.spaces).toHaveLength(1);
    expect(tables.spaces[0].ownerId).toBe(viewer);
    expect(tables.members).toEqual([
      expect.objectContaining({
        userId: viewer,
        kind: 'access',
        role: 'admin',
      }),
    ]);
  });
  it('onboarding contact input cannot forge a joined account relationship', async () => {
    const { ctx, tables } = mutationFixture(viewer, personal, {
      members: [],
      spaces: [],
    });
    await invoke(finishOnboarding, ctx, {
      firstName: 'New',
      lastName: 'Person',
      spaceType: 'family',
      challenges: [],
      familyContacts: [
        {
          id: 'local',
          name: 'Contact',
          selectedPhoneNumber: '+972501234567',
          matchedUserId: owner,
          inviteStatus: 'joined',
        },
      ],
    });
    const contact = tables.members.find((row) => row.kind === 'entity');
    expect(contact?.userId).toBeUndefined();
    expect(contact?.matchedUserId).toBeUndefined();
    expect(contact?.inviteStatus).toBe('none');
  });

  it('preserves a legacy local-ID profile on rename and its historical references', async () => {
    const profile = { ...child };
    const event = { ...personal, sharedWithFamilyMemberIds: ['child'] };
    const { ctx, tables } = mutationFixture(owner, event, {
      members: [admin, profile],
      users: [{ _id: owner, familyContacts: [{ id: '12345', name: 'Child' }] }],
    });
    await invoke(updateMyProfile, ctx, {
      familyContacts: [{ id: '12345', name: 'Renamed' }],
    });
    expect(tables.members).toHaveLength(2);
    expect(profile.displayName).toBe('Renamed');
    expect(tables.events[0].sharedWithFamilyMemberIds).toEqual(['child']);
  });

  it('keeps server phone discovery separate from the authorized join flow', async () => {
    const profile: Row = {
      ...child,
      selectedPhoneNumber: '+972501234567',
      matchedUserId: viewer,
      inviteStatus: 'invited',
    };
    const { ctx, tables } = mutationFixture(viewer, personal, {
      members: [admin, profile],
      users: [
        { _id: owner },
        { _id: viewer, phone: '+972501234567', onboardingCompleted: true },
      ],
    });
    await invoke(acceptPendingPhoneMatch, ctx, { memberId: 'child' });
    expect(tables.members.filter((row) => row.userId === viewer)).toEqual([]);
    await invoke(completeExistingUserFamilyJoin, ctx, { memberId: 'child' });
    expect(profile.userId).toBe(viewer);
    expect(profile.inviteStatus).toBe('joined');
    expect(
      tables.members.filter(
        (row) => row.kind === 'access' && row.userId === viewer
      )
    ).toHaveLength(1);
    expect(tables.spaces[0].ownerId).toBe(owner);
  });
});
