import { describe, expect, it } from 'bun:test';
import * as events from '../../convex/events';
import * as linked from '../../convex/linkedEvents';
import * as push from '../../convex/pushTokens';
import * as shares from '../../convex/shareLinks';
import { invoke, privacyFixture } from './helpers/privacyFixture';

describe('deleted source sharing through actual handlers', () => {
  for (const deletedAt of [0, 123]) {
    it(`denies legacy unrevoked links and new saves, deletedAt=${deletedAt}`, async () => {
      const f = privacyFixture('viewer');
      f.tables.events[0].deletedAt = deletedAt;
      expect(
        await invoke(shares.getSharePreview, f.ctx, { token: 'share' })
      ).toEqual({ status: 'not_found' });
      await expect(
        invoke(linked.saveLinkedEvent, f.ctx, {
          shareToken: 'share',
          spaceId: 'space',
        })
      ).rejects.toThrow();
      expect(f.tables.linkedEvents).toHaveLength(0);
      const owner = privacyFixture();
      owner.tables.events[0].deletedAt = deletedAt;
      await expect(
        invoke(shares.createShareLink, owner.ctx, { eventId: 'event' })
      ).rejects.toThrow();
      expect(
        await invoke(shares.getMyShareLink, owner.ctx, { eventId: 'event' })
      ).toBeNull();
    });
  }
  it('soft deletion revokes the old token even after restoration; copies survive', async () => {
    const f = privacyFixture();
    f.tables.events.push({
      _id: 'independent',
      createdBy: 'viewer',
      title: 'Copy',
    });
    await invoke(events.softDeletePersonalEvent, f.ctx, { eventId: 'event' });
    expect(f.tables.shareLinks[0].revoked).toBe(true);
    expect(
      await invoke(shares.getSharePreview, f.ctx, { token: 'share' })
    ).toEqual({ status: 'revoked' });
    await invoke(events.restorePersonalEvent, f.ctx, { eventId: 'event' });
    expect(
      await invoke(shares.getSharePreview, f.ctx, { token: 'share' })
    ).toEqual({ status: 'revoked' });
    expect(f.tables.events.find((r) => r._id === 'independent')?.title).toBe(
      'Copy'
    );
    await invoke(shares.createShareLink, f.ctx, { eventId: 'event' });
    expect(f.tables.shareLinks.filter((r) => !r.revoked)).toHaveLength(1);
  });
  it('keeps cancellation distinct: preview and save remain allowed', async () => {
    const f = privacyFixture('viewer');
    f.tables.events[0].status = 'cancelled';
    expect(
      await invoke(shares.getSharePreview, f.ctx, { token: 'share' })
    ).toMatchObject({ status: 'ok', eventStatus: 'cancelled' });
    await invoke(linked.saveLinkedEvent, f.ctx, {
      shareToken: 'share',
      spaceId: 'space',
    });
    expect(f.tables.linkedEvents[0].sourceStatus).toBe('cancelled');
  });
  it('restoring legacy trash does not reactivate an old unrevoked public link', async () => {
    const f = privacyFixture();
    f.tables.events[0].deletedAt = 1;
    f.tables.events[0].deletedBy = 'owner';
    await invoke(events.restorePersonalEvent, f.ctx, { eventId: 'event' });
    expect(f.tables.shareLinks[0].revoked).toBe(true);
  });
  it('saved recipient uses the pre-deletion snapshot, not live deleted data', async () => {
    const f = privacyFixture('viewer');
    await invoke(linked.saveLinkedEvent, f.ctx, {
      shareToken: 'share',
      spaceId: 'space',
    });
    f.tables.events[0].deletedAt = 1000;
    f.tables.events[0].title = 'Private trash change';
    const id = f.tables.linkedEvents[0]._id;
    expect(
      await invoke(linked.getLinkedEventDetail, f.ctx, { linkedEventId: id })
    ).toMatchObject({ title: 'Live', sourceStatus: 'deleted' });
    await invoke(linked.copyLinkedEvent, f.ctx, { linkedEventId: id });
    expect(f.tables.events.at(-1)?.title).toBe('Live');
  });
  it('unauthorized callers cannot manage active links or save to another space', async () => {
    const f = privacyFixture('viewer');
    await expect(
      invoke(shares.createShareLink, f.ctx, { eventId: 'event' })
    ).rejects.toThrow();
    f.tables.members = [];
    await expect(
      invoke(linked.saveLinkedEvent, f.ctx, {
        shareToken: 'share',
        spaceId: 'space',
      })
    ).rejects.toThrow();
    expect(f.tables.linkedEvents).toHaveLength(0);
  });
});

describe('push ownership and late registration', () => {
  it('only disables the caller token; re-login can register it again', async () => {
    const f = privacyFixture();
    f.tables.pushTokens.push({
      _id: 'other',
      token: 'other-device',
      userId: 'viewer',
      isActive: true,
    });
    await invoke(push.registerPushToken, f.ctx, {
      token: 'device',
      platform: 'ios',
      expectedUserId: 'owner',
    });
    await invoke(push.unregisterPushToken, f.ctx, { token: 'other-device' });
    expect(f.tables.pushTokens[0].isActive).toBe(true);
    await invoke(push.unregisterPushToken, f.ctx, { token: 'device' });
    expect(f.tables.pushTokens[1].isActive).toBe(false);
    await invoke(push.registerPushToken, f.ctx, {
      token: 'device',
      platform: 'ios',
    });
    expect(f.tables.pushTokens[1].isActive).toBe(true);
  });
  for (const reason of [
    'signed-out',
    'deleted',
    'expired',
    'switched',
    'anonymous',
  ]) {
    it(`rejects registration for ${reason}`, async () => {
      const f = privacyFixture(reason === 'anonymous' ? null : 'owner');
      if (reason === 'signed-out') f.tables.authSessions = [];
      if (reason === 'deleted') f.tables.users = [];
      if (reason === 'expired') f.tables.authSessions[0].expirationTime = 0;
      await expect(
        invoke(push.registerPushToken, f.ctx, {
          token: 'device',
          platform: 'ios',
          expectedUserId: reason === 'switched' ? 'viewer' : 'owner',
        })
      ).rejects.toThrow();
      expect(f.tables.pushTokens).toHaveLength(0);
    });
  }
});
