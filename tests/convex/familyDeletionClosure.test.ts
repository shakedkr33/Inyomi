import { expect, it } from 'bun:test';
import { listMyFamilyContacts } from '../../convex/members';
import { deleteMyAccount } from '../../convex/users';
import {
  executeAccountDeletion,
  LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE,
} from '../../lib/accountDeletionUi';
import { invoke, privacyFixture } from './helpers/privacyFixture';

function soleFamily() {
  const f = privacyFixture();
  f.tables.spaces = [
    { _id: 'space', name: 'הבית שלנו', ownerId: 'owner', type: 'family' },
  ];
  f.tables.members = [
    {
      _id: 'access',
      _creationTime: 1,
      kind: 'access',
      role: 'admin',
      userId: 'owner',
      spaceId: 'space',
      joinedAt: 1,
    },
    { _id: 'manual', kind: 'entity', spaceId: 'space', memberType: 'person' },
  ];
  f.tables.events = [
    {
      _id: 'event',
      createdBy: 'owner',
      spaceId: 'space',
      ownerScope: 'personal',
    },
  ];
  return f;
}

function addLinkedSuccessor(
  f: ReturnType<typeof soleFamily>,
  userId: string,
  joinedAt: number,
  creationTime: number
) {
  f.tables.users.push({ _id: userId, isActive: true });
  f.tables.members.push(
    {
      _id: `${userId}-profile`,
      _creationTime: creationTime - 1,
      kind: 'entity',
      role: 'member',
      userId,
      matchedUserId: userId,
      inviteStatus: 'joined',
      memberType: 'person',
      displayName: userId,
      spaceId: 'space',
      joinedAt,
    },
    {
      _id: `${userId}-access`,
      _creationTime: creationTime,
      kind: 'access',
      role: 'member',
      userId,
      spaceId: 'space',
      joinedAt,
    }
  );
}

for (const table of ['events', 'tasks', 'birthdays']) {
  it(`blocks closure before writes when ${table} contains another account's content`, async () => {
    const f = soleFamily();
    f.tables[table] ??= [];
    f.tables[table].push({
      _id: 'independent',
      createdBy: 'viewer',
      spaceId: 'space',
      ownerScope: 'personal',
    });
    const before = structuredClone(f.tables);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
        'סגירת מרחב'
      );
      expect(f.tables).toEqual(before);
    }
  });
}

it('closes a sole-owned family with exclusively owned manual profiles and content', async () => {
  const f = soleFamily();
  f.tables.tasks = [
    {
      _id: 'task',
      createdBy: 'owner',
      ownerScope: 'personal',
      spaceId: 'space',
    },
  ];
  f.tables.birthdays = [
    { _id: 'birthday', createdBy: 'owner', spaceId: 'space' },
  ];
  expect(await invoke(deleteMyAccount, f.ctx, {})).toMatchObject({
    success: true,
    deletedSpaceCount: 1,
  });
  for (const table of ['spaces', 'members', 'events', 'tasks', 'birthdays'])
    expect(f.tables[table]).toHaveLength(0);
  expect(f.tables.users.map((row) => row._id)).toEqual(['viewer']);
});

it('does not delete an owner-created event explicitly shared outside the closing family', async () => {
  const f = soleFamily();
  f.tables.events[0].sharedWithUserIds = ['viewer'];
  const before = structuredClone(f.tables);
  await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
    'סגירת מרחב'
  );
  expect(f.tables).toEqual(before);
});

it('does not delete an owner-created task still assigned to another account', async () => {
  const f = soleFamily();
  f.tables.tasks = [
    {
      _id: 'shared-task',
      createdBy: 'owner',
      spaceId: 'space',
      ownerScope: 'family',
      assignedToUserIds: ['viewer'],
    },
  ];
  const before = structuredClone(f.tables);
  await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
    'סגירת מרחב'
  );
  expect(f.tables).toEqual(before);
});

it('transfers ownership to one eligible linked contact and preserves shared family data', async () => {
  const f = soleFamily();
  addLinkedSuccessor(f, 'successor', 100, 100);
  f.tables.tasks = [
    {
      _id: 'task',
      createdBy: 'owner',
      ownerScope: 'personal',
      spaceId: 'space',
    },
  ];
  f.tables.birthdays = [
    { _id: 'birthday', createdBy: 'owner', spaceId: 'space' },
  ];

  expect(await invoke(deleteMyAccount, f.ctx, {})).toMatchObject({
    success: true,
    deletedSpaceCount: 0,
  });
  expect(f.tables.spaces).toEqual([
    expect.objectContaining({ _id: 'space', ownerId: 'successor' }),
  ]);
  expect(
    f.tables.members.find((row) => row._id === 'successor-access')
  ).toMatchObject({ role: 'admin', userId: 'successor', spaceId: 'space' });
  expect(f.tables.members.some((row) => row._id === 'access')).toBe(false);
  expect(f.tables.members.some((row) => row._id === 'manual')).toBe(true);
  expect(f.tables.events.map((row) => row._id)).toContain('event');
  expect(f.tables.tasks.map((row) => row._id)).toContain('task');
  expect(f.tables.birthdays.map((row) => row._id)).toContain('birthday');
});

it('selects the earliest eligible membership and leaves every other membership intact', async () => {
  const f = soleFamily();
  addLinkedSuccessor(f, 'later', 200, 10);
  addLinkedSuccessor(f, 'earlier', 100, 20);

  await invoke(deleteMyAccount, f.ctx, {});
  expect(f.tables.spaces[0].ownerId).toBe('earlier');
  expect(
    f.tables.members.find((row) => row._id === 'earlier-access')?.role
  ).toBe('admin');
  expect(
    f.tables.members.find((row) => row._id === 'later-access')
  ).toMatchObject({ role: 'member', userId: 'later' });
});

it('excludes manual, unlinked, phone/name-only, inactive and deleted accounts', async () => {
  const f = soleFamily();
  f.tables.users.push({ _id: 'inactive', isActive: false });
  f.tables.members.push(
    {
      _id: 'phone-only',
      kind: 'entity',
      role: 'member',
      selectedPhoneNumber: '+972500000000',
      displayName: 'Phone only',
      matchedUserId: 'viewer',
      spaceId: 'space',
    },
    {
      _id: 'inactive-profile',
      kind: 'entity',
      role: 'member',
      userId: 'inactive',
      matchedUserId: 'inactive',
      inviteStatus: 'joined',
      spaceId: 'space',
    },
    {
      _id: 'inactive-access',
      kind: 'access',
      role: 'member',
      userId: 'inactive',
      spaceId: 'space',
      joinedAt: 1,
    },
    {
      _id: 'deleted-access',
      kind: 'access',
      role: 'member',
      userId: 'missing-user',
      spaceId: 'space',
      joinedAt: 0,
    }
  );

  expect(await invoke(deleteMyAccount, f.ctx, {})).toMatchObject({
    deletedSpaceCount: 1,
  });
  expect(f.tables.spaces).toHaveLength(0);
});

it('blocks ambiguous active access linkage before destructive writes', async () => {
  const f = soleFamily();
  f.tables.users.push({ _id: 'ambiguous', isActive: true });
  f.tables.members.push({
    _id: 'ambiguous-access',
    _creationTime: 10,
    kind: 'access',
    role: 'member',
    userId: 'ambiguous',
    spaceId: 'space',
    joinedAt: 10,
  });
  const before = structuredClone(f.tables);
  await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
    'נתוני הקישור'
  );
  expect(f.tables).toEqual(before);
});

it('blocks a transfer before writes when retained content points to an owner access row with no safe profile remap', async () => {
  const f = soleFamily();
  addLinkedSuccessor(f, 'successor', 100, 100);
  f.tables.events[0].sharedWithFamilyMemberIds = ['access'];
  const before = structuredClone(f.tables);

  await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
    'מפנה לפרופיל הבעלים'
  );
  expect(f.tables).toEqual(before);
});

it('leaves independently owned content, communities and successor subscription identity untouched', async () => {
  const f = soleFamily();
  addLinkedSuccessor(f, 'successor', 100, 100);
  f.tables.events.push({
    _id: 'independent',
    createdBy: 'viewer',
    ownerScope: 'family',
    spaceId: 'space',
  });
  f.tables.communities = [
    { _id: 'community', ownerId: 'viewer', name: 'Unrelated community' },
  ];
  f.tables.communityMembers = [
    {
      _id: 'community-viewer',
      communityId: 'community',
      userId: 'viewer',
      role: 'owner',
    },
  ];
  f.tables.subscriptions = [
    { _id: 'owner-subscription', userId: 'owner', productId: 'owner-product' },
    {
      _id: 'successor-subscription',
      userId: 'successor',
      productId: 'successor-product',
    },
  ];

  await invoke(deleteMyAccount, f.ctx, {});
  expect(f.tables.events.some((row) => row._id === 'independent')).toBe(true);
  expect(f.tables.communities).toEqual([
    { _id: 'community', ownerId: 'viewer', name: 'Unrelated community' },
  ]);
  expect(f.tables.communityMembers).toEqual([
    expect.objectContaining({
      _id: 'community-viewer',
      userId: 'viewer',
      role: 'owner',
    }),
  ]);
  expect(f.tables.subscriptions).toEqual([
    expect.objectContaining({
      _id: 'successor-subscription',
      productId: 'successor-product',
    }),
  ]);
});

it('does not duplicate a completed transfer on retry and revokes the deleted owner session', async () => {
  const f = soleFamily();
  addLinkedSuccessor(f, 'successor', 100, 100);
  await invoke(deleteMyAccount, f.ctx, {});
  const afterSuccess = structuredClone(f.tables);

  await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow('לא מחובר');
  expect(f.tables).toEqual(afterSuccess);
  expect(await invoke(listMyFamilyContacts, f.ctx, {})).toEqual({
    selfEntityId: null,
    members: [],
  });
  expect(f.tables.members.filter((row) => row.role === 'admin')).toHaveLength(
    1
  );
});

it('preserves an independent event and its selected manual profile by blocking unsafe closure', async () => {
  const f = soleFamily();
  f.tables.events.push({
    _id: 'external',
    createdBy: 'viewer',
    ownerScope: 'personal',
    sharedWithFamilyMemberIds: ['manual'],
  });
  const before = structuredClone(f.tables);
  const result = await executeAccountDeletion(() =>
    invoke(deleteMyAccount, f.ctx, {})
  );
  expect(result).toEqual({
    ok: false,
    message: LEGACY_UNSAFE_DATA_ACCOUNT_DELETION_ERROR_MESSAGE,
  });
  expect(f.tables).toEqual(before);
});

it('preserves a discovered retained task assigned to a closing-space profile', async () => {
  const f = soleFamily();
  f.tables.tasks = [
    {
      _id: 'shared',
      createdBy: 'viewer',
      ownerScope: 'family',
      assignedTo: 'owner',
      assignedToMemberIds: ['manual'],
    },
  ];
  const before = structuredClone(f.tables);
  await expect(invoke(deleteMyAccount, f.ctx, {})).rejects.toThrow(
    'סגירת מרחב'
  );
  expect(f.tables).toEqual(before);
});
