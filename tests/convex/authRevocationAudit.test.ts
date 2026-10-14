import { describe, expect, it } from 'bun:test';
import { generateKeyPair, jwtVerify, SignJWT } from 'jose';
import * as communities from '../../convex/communities';
import * as dailyMoods from '../../convex/dailyMoods';
import * as events from '../../convex/events';
import * as members from '../../convex/members';
import {
  getPushRecipients,
  markTokenDead,
} from '../../convex/pushNotifications';
import { registerPushToken } from '../../convex/pushTokens';
import { getSharePreview } from '../../convex/shareLinks';
import * as tasks from '../../convex/tasks';
import * as users from '../../convex/users';
import { refreshSessionImpl } from '../../node_modules/@convex-dev/auth/src/server/implementation/mutations/refreshSession';
import { signOutImpl } from '../../node_modules/@convex-dev/auth/src/server/implementation/mutations/signOut';
import { invoke, privacyFixture } from './helpers/privacyFixture';

// Actual handlers + installed Auth lifecycle, synthetic DB only. JOSE verifies
// ephemeral JWTs at the fixture boundary; this is NOT the hosted Convex verifier.
const keys = generateKeyPair('RS256');
async function authenticatedFixture(
  options: { subject?: string; expired?: boolean; wrongKey?: boolean } = {}
) {
  const f = privacyFixture();
  const { privateKey, publicKey } = await keys;
  const signingKey = options.wrongKey
    ? (await generateKeyPair('RS256')).privateKey
    : privateKey;
  const token = await new SignJWT({ sub: options.subject ?? 'owner|session' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://synthetic.invalid')
    .setAudience('convex')
    .setIssuedAt()
    .setExpirationTime(
      options.expired ? Math.floor(Date.now() / 1000) - 10 : '1h'
    )
    .sign(signingKey);
  f.ctx.auth.getUserIdentity = async () => {
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: 'https://synthetic.invalid',
      audience: 'convex',
    });
    if (!payload.sub) throw new Error('Missing synthetic subject');
    return { subject: payload.sub };
  };
  return f;
}
async function signOut(f: ReturnType<typeof privacyFixture>) {
  return signOutImpl(f.ctx as unknown as Parameters<typeof signOutImpl>[0]);
}
async function refresh(f: ReturnType<typeof privacyFixture>) {
  return refreshSessionImpl(
    f.ctx as unknown as Parameters<typeof refreshSessionImpl>[0],
    { refreshToken: 'refresh|session' },
    (() => {
      throw new Error('Unexpected provider call');
    }) as Parameters<typeof refreshSessionImpl>[2],
    {} as Parameters<typeof refreshSessionImpl>[3]
  );
}

describe('issued access JWT: live session and user boundary', () => {
  it('active JWT/session/user retains owner access', async () => {
    const f = await authenticatedFixture();
    expect(
      await invoke(events.getById, f.ctx, { eventId: 'event' })
    ).toMatchObject({ title: 'Live' });
  });
  for (const state of [
    'revoked',
    'missing',
    'expired-session',
    'wrong-owner',
    'deleted-user',
    'disabled-user',
    'missing-session-claim',
    'anonymous',
  ] as const) {
    it(`denies protected reads and writes: ${state}`, async () => {
      const f = await authenticatedFixture(
        state === 'missing-session-claim' ? { subject: 'owner' } : {}
      );
      if (state === 'revoked') await signOut(f);
      if (state === 'missing') f.tables.authSessions = [];
      if (state === 'expired-session')
        f.tables.authSessions[0].expirationTime = Date.now() - 1;
      if (state === 'wrong-owner') f.tables.authSessions[0].userId = 'viewer';
      if (state === 'deleted-user') await f.ctx.db.delete('owner');
      if (state === 'disabled-user') f.tables.users[0].isActive = false;
      if (state === 'anonymous') f.ctx.auth.getUserIdentity = async () => null;
      const before = structuredClone(f.tables);
      expect(
        await invoke(events.getById, f.ctx, { eventId: 'event' })
      ).toBeNull();
      expect(await invoke(users.getMyId, f.ctx, {})).toBeNull();
      await expect(
        invoke(events.generateUploadUrl, f.ctx, {})
      ).rejects.toThrow();
      await expect(
        invoke(users.createOrUpdateUser, f.ctx, {})
      ).rejects.toThrow();
      await expect(
        invoke(registerPushToken, f.ctx, {
          token: 'synthetic',
          platform: 'ios',
        })
      ).rejects.toThrow();
      expect(f.tables).toEqual(before);
    });
  }
  for (const options of [{ expired: true }, { wrongKey: true }]) {
    it(`rejects JWT at simulated cryptographic boundary: ${JSON.stringify(options)}`, async () => {
      const f = await authenticatedFixture(options);
      await expect(
        invoke(events.getById, f.ctx, { eventId: 'event' })
      ).rejects.toThrow();
    });
  }
  it('logout revokes A and refresh, preserving independent B and another user', async () => {
    const f = await authenticatedFixture();
    f.tables.authSessions.push(
      { _id: 'session-b', userId: 'owner', expirationTime: Date.now() + 60000 },
      {
        _id: 'viewer-session',
        userId: 'viewer',
        expirationTime: Date.now() + 60000,
      }
    );
    await signOut(f);
    expect(
      await invoke(events.getById, f.ctx, { eventId: 'event' })
    ).toBeNull();
    expect(await refresh(f)).toBeNull();
    const b = await authenticatedFixture({ subject: 'owner|session-b' });
    f.ctx.auth = b.ctx.auth;
    expect(
      await invoke(events.getById, f.ctx, { eventId: 'event' })
    ).toMatchObject({ title: 'Live' });
    expect(f.tables.authSessions.map((s) => s._id).sort()).toEqual([
      'session-b',
      'viewer-session',
    ]);
  });
  it('real successful account deletion removes all own sessions, not another account', async () => {
    const f = await authenticatedFixture();
    f.tables.events[0].ownerScope = 'family';
    f.tables.events[0].sharedWithUserIds = ['viewer'];
    f.tables.authSessions.push(
      { _id: 'session-b', userId: 'owner', expirationTime: Date.now() + 60000 },
      {
        _id: 'viewer-session',
        userId: 'viewer',
        expirationTime: Date.now() + 60000,
      }
    );
    expect(await invoke(users.deleteMyAccount, f.ctx, {})).toMatchObject({
      success: true,
    });
    expect(f.tables.users.map((u) => u._id)).toEqual(['viewer']);
    expect(f.tables.authSessions.map((s) => s._id)).toEqual(['viewer-session']);
    expect(
      await invoke(events.getById, f.ctx, { eventId: 'event' })
    ).toBeNull();
    expect(await refresh(f)).toBeNull();
    await expect(invoke(users.createOrUpdateUser, f.ctx, {})).rejects.toThrow();
    expect(f.tables.events[0]._id).toBe('event');
  });
  it('blocked deletion performs no writes or session revocation', async () => {
    const f = await authenticatedFixture();
    f.tables.spaces[0].ownerId = 'owner';
    f.tables.spaces[0].type = 'family';
    const before = structuredClone(f.tables);
    await expect(invoke(users.deleteMyAccount, f.ctx, {})).rejects.toThrow();
    expect(f.tables).toEqual(before);
    expect(
      await invoke(events.getById, f.ctx, { eventId: 'event' })
    ).toMatchObject({ title: 'Live' });
  });
});

it('revoked membership/creator cannot read content, issue attachment URLs or mutate it', async () => {
  const f = await authenticatedFixture();
  f.tables.events[0].attachments = [{ storageId: 'file' }];
  f.tables.tasks = [
    {
      _id: 'task',
      createdBy: 'owner',
      assignedTo: 'owner',
      attachments: [{ storageId: 'file' }],
    },
  ];
  const storageCalls: string[] = [];
  const ctx = {
    ...f.ctx,
    storage: {
      getUrl: async (id: string) => {
        storageCalls.push(id);
        return 'https://synthetic.invalid/file';
      },
    },
  };
  expect(
    await invoke(events.getEventAttachmentUrl, ctx, {
      eventId: 'event',
      storageId: 'file',
    })
  ).toBe('https://synthetic.invalid/file');
  expect(
    await invoke(tasks.getTaskAttachmentUrl, ctx, {
      taskId: 'task',
      storageId: 'file',
    })
  ).toBe('https://synthetic.invalid/file');
  await signOut(f);
  const before = structuredClone(f.tables);
  expect(
    await invoke(events.getEventAttachmentUrl, ctx, {
      eventId: 'event',
      storageId: 'file',
    })
  ).toBeNull();
  expect(
    await invoke(tasks.getTaskAttachmentUrl, ctx, {
      taskId: 'task',
      storageId: 'file',
    })
  ).toBeNull();
  expect(
    await invoke(tasks.getTaskDetails, ctx, { taskId: 'task' })
  ).toBeNull();
  await expect(
    invoke(events.softDeletePersonalEvent, ctx, { eventId: 'event' })
  ).rejects.toThrow();
  expect(storageCalls).toHaveLength(2);
  expect(f.tables).toEqual(before);
});

it('daily mood and legacy user endpoint use the live owner, never an email-selected account', async () => {
  const f = await authenticatedFixture();
  expect(await invoke(users.createOrUpdateUser, f.ctx, {})).toBe('owner');
  await invoke(dailyMoods.upsertMood, f.ctx, {
    date: '2026-10-13',
    moodValue: 3,
  });
  expect(f.tables.dailyMoods[0].userId).toBe('owner');
  await signOut(f);
  expect(
    await invoke(dailyMoods.getMoodForDate, f.ctx, { date: '2026-10-13' })
  ).toBeNull();
  await expect(
    invoke(dailyMoods.upsertMood, f.ctx, { date: '2026-10-13', moodValue: 0 })
  ).rejects.toThrow();
  expect(f.tables.dailyMoods[0].moodValue).toBe(3);
});

it('active sessions still require event ownership and family membership', async () => {
  const f = privacyFixture('viewer');
  expect(await invoke(events.getById, f.ctx, { eventId: 'event' })).toBeNull();
  await expect(
    invoke(events.softDeletePersonalEvent, f.ctx, { eventId: 'event' })
  ).rejects.toThrow();
  f.tables.spaces.push({ _id: 'foreign', ownerId: 'owner', type: 'family' });
  await expect(
    invoke(members.renameSpace, f.ctx, { spaceId: 'foreign', name: 'No' })
  ).rejects.toThrow();
});

it('public share and invite previews remain public; revocation does not grant private access', async () => {
  const f = privacyFixture(null);
  expect(
    await invoke(getSharePreview, f.ctx, { token: 'share' })
  ).toMatchObject({ status: 'ok' });
  f.tables.communities = [
    {
      _id: 'community',
      name: 'Public preview',
      inviteCode: 'INVITE',
      archived: false,
    },
  ];
  expect(
    await invoke(communities.getCommunityByInviteCode, f.ctx, {
      inviteCode: 'invite',
    })
  ).not.toBeNull();
  f.tables.shareLinks[0].revoked = true;
  expect(
    await invoke(getSharePreview, f.ctx, { token: 'share' })
  ).toMatchObject({ status: 'revoked' });
});

it('internal notification service operations do not require a user session', async () => {
  const f = privacyFixture(null);
  f.tables.pushTokens = [
    {
      _id: 'push',
      userId: 'owner',
      token: 'synthetic',
      platform: 'ios',
      isActive: true,
    },
  ];
  expect(
    await invoke(getPushRecipients, f.ctx, { recipientUserIds: ['owner'] })
  ).toMatchObject([{ enabled: true, tokens: [{ token: 'synthetic' }] }]);
  await invoke(markTokenDead, f.ctx, { token: 'synthetic' });
  expect(f.tables.pushTokens[0].isActive).toBe(false);
});

it('family and community membership cannot outlive authentication', async () => {
  const f = await authenticatedFixture();
  f.tables.members.push({
    _id: 'owner-access',
    userId: 'owner',
    kind: 'access',
    spaceId: 'space',
    role: 'member',
  });
  f.tables.communities = [
    { _id: 'community', name: 'Private community', archived: false },
  ];
  f.tables.communityMembers = [
    {
      _id: 'membership',
      communityId: 'community',
      userId: 'owner',
      role: 'member',
      status: 'active',
    },
  ];
  f.tables.events[0].communityId = 'community';
  expect(await invoke(members.getMyResolvedSpaceId, f.ctx, {})).toBe('space');
  expect(
    await invoke(communities.getCommunity, f.ctx, { communityId: 'community' })
  ).toMatchObject({ name: 'Private community' });
  expect(
    await invoke(events.getById, f.ctx, { eventId: 'event' })
  ).toMatchObject({ title: 'Live' });
  await signOut(f);
  expect(await invoke(members.getMyResolvedSpaceId, f.ctx, {})).toBeNull();
  expect(
    await invoke(communities.getCommunity, f.ctx, { communityId: 'community' })
  ).toBeNull();
  expect(await invoke(events.getById, f.ctx, { eventId: 'event' })).toBeNull();
  await expect(
    invoke(communities.updateCommunity, f.ctx, {
      communityId: 'community',
      name: 'No',
    })
  ).rejects.toThrow();
  expect(f.tables.communities[0].name).toBe('Private community');
});
