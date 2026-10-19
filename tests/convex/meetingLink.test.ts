import { expect, it } from 'bun:test';
import { create, update } from '../../convex/events';
import {
  createMeetingLinkOpener,
  normalizeMeetingLink,
} from '../../lib/meetingLink';
import { invoke, privacyFixture } from './helpers/privacyFixture';

for (const url of [
  'https://meet.google.com/abc-defg-hij',
  'http://example.org/room?token=A%2Fb#join',
  'https://zoom.us/j/123?pwd=aB%2B%3D',
  'https://teams.microsoft.com/l/meetup-join/A%40B?context=%7B%22a%22%3A1%7D#x',
]) {
  it(`preserves URL tokens: ${new URL(url).hostname}`, () =>
    expect(normalizeMeetingLink(url)).toBe(url));
}
it('normalizes a scheme-less URL without altering its invitation', () =>
  expect(
    normalizeMeetingLink(' meet.google.com/abc-defg-hij?authuser=1#x ')
  ).toBe('https://meet.google.com/abc-defg-hij?authuser=1#x'));
for (const input of [
  'not a link',
  'hello',
  'javascript:alert(1)',
  'file:///tmp/a',
  'data:text/plain,x',
  'ftp://example.com/x',
  'https:/example.com',
  'https://',
  'https:////example.com',
  'https://a..com',
  'https://example.com/%ZZ',
  'https://name:password@example.com',
  'https://example.com\\evil',
]) {
  it(`rejects invalid/unsafe input ${input}`, () =>
    expect(normalizeMeetingLink(input)).toBeNull());
}
it('opens normalized links, suppresses double taps, reports failures and permits retry', async () => {
  const calls: string[] = [];
  const errors: string[] = [];
  let reject!: (e: Error) => void;
  const open = createMeetingLinkOpener(
    (url) => {
      calls.push(url);
      return new Promise((_, fail) => {
        reject = fail;
      });
    },
    (message) => errors.push(message)
  );
  const first = open('meet.google.com/a');
  await open('meet.google.com/a');
  expect(calls).toEqual(['https://meet.google.com/a']);
  reject(new Error('Unavailable'));
  await first;
  expect(errors[0]).toContain('לא ניתן לפתוח');
  const second = open('https://zoom.us/j/1');
  reject(new Error('Unavailable'));
  await second;
  expect(calls).toHaveLength(2);
  await open('javascript:alert(1)');
  expect(calls).toHaveLength(2);
  expect(errors.at(-1)).toBe('יש להזין קישור תקין');
});
for (const community of [false, true]) {
  it(`${community ? 'community' : 'personal'} mutation enforces new URLs and preserves untouched legacy`, async () => {
    const f = privacyFixture();
    if (community) {
      f.tables.communities = [
        { _id: 'community', name: 'Group', ownerId: 'owner' },
      ];
      f.tables.communityMembers = [
        {
          _id: 'cm',
          communityId: 'community',
          userId: 'owner',
          role: 'owner',
          status: 'active',
        },
      ];
    }
    const args = {
      title: 'Meeting',
      startTime: 100,
      endTime: 200,
      ...(community ? { communityId: 'community' } : {}),
    };
    await expect(
      invoke(create, f.ctx, { ...args, onlineUrl: 'free text' })
    ).rejects.toThrow('יש להזין קישור תקין');
    const id = await invoke(create, f.ctx, {
      ...args,
      onlineUrl: 'meet.google.com/abc?token=x#z',
      location: 'Obsolete',
      locationSource: 'google',
      googlePlaceId: 'old',
      locationUrl: 'geo:1,2',
    });
    const row = f.tables.events.find((row) => row._id === id);
    if (!row) throw new Error('Missing event');
    expect(row.onlineUrl).toBe('https://meet.google.com/abc?token=x#z');
    expect(row.location).toBe('');
    expect(row.googlePlaceId).toBeUndefined();
    expect(row.locationUrl).toBe('');
    row.onlineUrl = 'legacy invalid text';
    await invoke(update, f.ctx, { id, title: 'Unrelated' });
    expect(row.onlineUrl).toBe('legacy invalid text');
    await expect(
      invoke(update, f.ctx, { id, onlineUrl: 'javascript:alert(1)' })
    ).rejects.toThrow('יש להזין קישור תקין');
    await invoke(update, f.ctx, {
      id,
      location: 'Manual',
      locationSource: 'manual',
      googlePlaceId: null,
    });
    expect(row.onlineUrl).toBe('');
    expect(row.location).toBe('Manual');
  });
}
