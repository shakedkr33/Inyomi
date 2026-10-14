import { expect, it } from 'bun:test';
import * as notifications from '../../convex/userNotifications';
import { signOutImpl } from '../../node_modules/@convex-dev/auth/src/server/implementation/mutations/signOut';
import { invoke, privacyFixture } from './helpers/privacyFixture';

function fixture() {
  const f = privacyFixture();
  f.tables.userNotifications = [
    { _id: 'a', recipientUserId: 'owner', createdAt: 2 },
    { _id: 'b', recipientUserId: 'viewer', createdAt: 1 },
    { _id: 'archived', recipientUserId: 'owner', archivedAt: 3 },
  ];
  const query = f.ctx.db.query;
  f.ctx.db.query = (table) => {
    const result = query(table);
    return Object.assign(result, { order: () => result });
  };
  return f;
}

it('real Auth signOut invalidates a still-subscribed inbox without throwing or returning another recipient', async () => {
  const f = fixture();
  expect(await invoke(notifications.list, f.ctx, {})).toEqual([
    f.tables.userNotifications[0],
  ]);
  await signOutImpl(f.ctx as unknown as Parameters<typeof signOutImpl>[0]);
  // The JWT identity remains present, just as it does before client token cleanup.
  expect(await f.ctx.auth.getUserIdentity()).not.toBeNull();
  expect(await invoke(notifications.list, f.ctx, {})).toEqual([]);
});

for (const state of [
  'anonymous',
  'revoked',
  'expired',
  'deleted',
  'disabled',
  'wrong-session-owner',
] as const) {
  it(`${state}: empty inbox without reading protected rows, writes still rejected`, async () => {
    const f = fixture();
    if (state === 'anonymous') f.ctx.auth.getUserIdentity = async () => null;
    if (state === 'revoked') f.tables.authSessions = [];
    if (state === 'expired')
      f.tables.authSessions[0].expirationTime = Date.now() - 1;
    if (state === 'deleted') await f.ctx.db.delete('owner');
    if (state === 'disabled') f.tables.users[0].isActive = false;
    if (state === 'wrong-session-owner')
      f.tables.authSessions[0].userId = 'viewer';
    f.ctx.db.query = () => {
      throw new Error('Must not read notification rows');
    };
    const before = structuredClone(f.tables);
    expect(await invoke(notifications.list, f.ctx, {})).toEqual([]);
    await expect(invoke(notifications.markAllRead, f.ctx, {})).rejects.toThrow(
      'Not authenticated'
    );
    await expect(invoke(notifications.archiveAll, f.ctx, {})).rejects.toThrow(
      'Not authenticated'
    );
    expect(f.tables).toEqual(before);
  });
}

it('a pending identity lookup resumes after revocation and returns an empty inbox', async () => {
  const f = fixture();
  let resume!: () => void;
  const wait = new Promise<void>((resolve) => {
    resume = resolve;
  });
  f.ctx.auth.getUserIdentity = async () => {
    await wait;
    return { subject: 'owner|session' };
  };
  const pending = invoke(notifications.list, f.ctx, {});
  f.tables.authSessions = [];
  resume();
  expect(await pending).toEqual([]);
});

it('read/archive mutations remain scoped to the live account', async () => {
  const f = fixture();
  await invoke(notifications.markAllRead, f.ctx, {});
  await invoke(notifications.archiveAll, f.ctx, {});
  expect(f.tables.userNotifications[0].readAt).toBeNumber();
  expect(f.tables.userNotifications[0].archivedAt).toBeNumber();
  expect(f.tables.userNotifications[1]).toEqual({
    _id: 'b',
    recipientUserId: 'viewer',
    createdAt: 1,
  });
});

it('unexpected database failure is propagated, not interpreted as an empty inbox', async () => {
  const f = fixture();
  f.ctx.db.query = () => {
    throw new Error('Unexpected database failure');
  };
  await expect(invoke(notifications.list, f.ctx, {})).rejects.toThrow(
    'Unexpected database failure'
  );
});
