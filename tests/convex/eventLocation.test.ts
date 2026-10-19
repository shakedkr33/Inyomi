import { expect, it } from 'bun:test';
import { create, update } from '../../convex/events';
import { importGoogleCalendar } from '../../convex/googleImport';
import { getLinkedEventsForSpace } from '../../convex/linkedEvents';
import { buildDuplicateEventTemplate } from '../../lib/eventDuplication';
import {
  eventNavigationUrl,
  hasPhysicalLocation,
} from '../../lib/eventLocation';
import { invoke, privacyFixture } from './helpers/privacyFixture';

for (const community of [false, true]) {
  it(`${community ? 'community' : 'personal'} persists selection, replacements, manual/link/empty transitions and unchanged saves`, async () => {
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
    const id = await invoke(create, f.ctx, {
      title: 'Location',
      startTime: 100,
      endTime: 200,
      ...(community ? { communityId: 'community' } : {}),
      location: 'First',
      locationSource: 'google',
      googlePlaceId: 'first',
      locationUrl: 'geo:1,2',
    });
    const row = f.tables.events.find((e) => e._id === id);
    if (!row) throw new Error('Event was not created');
    expect(row.googlePlaceId).toBe('first');
    expect(row.locationUrl).toBe('');
    const save = (fields: object) => invoke(update, f.ctx, { id, ...fields });
    await save({ title: 'Unrelated' });
    expect(row.googlePlaceId).toBe('first');
    await save({
      location: 'First',
      onlineUrl: '',
      locationSource: 'google',
      googlePlaceId: 'first',
    });
    expect(row.googlePlaceId).toBe('first');
    await save({
      location: 'Second',
      locationSource: 'google',
      googlePlaceId: 'second',
    });
    expect(row.location).toBe('Second');
    expect(row.googlePlaceId).toBe('second');
    await save({
      location: 'Manual',
      locationSource: 'manual',
      googlePlaceId: null,
    });
    expect(row.locationSource).toBe('manual');
    expect(row.googlePlaceId).toBeUndefined();
    await save({
      location: '',
      onlineUrl: 'https://meet.example',
      googlePlaceId: null,
      locationSource: null,
    });
    expect(row.googlePlaceId).toBeUndefined();
    expect(row.locationSource).toBeUndefined();
    await save({
      location: 'Third',
      onlineUrl: '',
      locationSource: 'google',
      googlePlaceId: 'third',
    });
    expect(row.googlePlaceId).toBe('third');
    await save({ location: '', googlePlaceId: null, locationSource: null });
    expect(row.location).toBe('');
    expect(row.googlePlaceId).toBeUndefined();
    await save({ onlineUrl: 'https://meet.example' });
    await save({ onlineUrl: '' });
    expect(row.onlineUrl).toBe('');
  });
}

it('preserves legacy coordinates on unchanged old-client saves but clears them and provenance on replacement', async () => {
  const f = privacyFixture();
  const row = f.tables.events[0];
  Object.assign(row, { location: 'Old', locationUrl: 'geo:1,2' });
  await invoke(update, f.ctx, { id: 'event', location: 'Old', onlineUrl: '' });
  expect(row.locationUrl).toBe('geo:1,2');
  expect(row.locationSource).toBeUndefined();
  Object.assign(row, { locationSource: 'google', googlePlaceId: 'old' });
  await invoke(update, f.ctx, {
    id: 'event',
    location: 'Changed by old client',
    locationUrl: 'geo:3,4',
  });
  expect(row.locationUrl).toBe('');
  expect(row.googlePlaceId).toBeUndefined();
  expect(row.locationSource).toBeUndefined();
});

it('duplicates addresses and Google IDs without copying legacy coordinates', () => {
  const template = buildDuplicateEventTemplate(
    {
      title: 'Old',
      startTime: 100,
      endTime: 200,
      location: 'Address',
      locationUrl: 'geo:1,2',
      locationSource: 'google',
      googlePlaceId: 'place',
    },
    [],
    Date.now()
  );
  expect(template.location).toBe('Address');
  expect(template.googlePlaceId).toBe('place');
  expect(template.locationUrl).toBeUndefined();
});

it('uses Place IDs only in Google, address fallback in Waze, legacy coordinates and rejects meeting URLs', () => {
  expect(eventNavigationUrl('google', 'A & B', 'place')).toBe(
    'https://www.google.com/maps/search/?api=1&query=A%20%26%20B&query_place_id=place'
  );
  expect(eventNavigationUrl('waze', 'A & B', 'place', 1, 2)).toBe(
    'https://waze.com/ul?q=A%20%26%20B&navigate=yes'
  );
  expect(eventNavigationUrl('google', 'Manual')).toContain('query=Manual');
  expect(eventNavigationUrl('waze', 'Imported')).toContain('q=Imported');
  expect(eventNavigationUrl('google', 'Legacy', undefined, 1, 2)).toContain(
    'destination=1,2'
  );
  expect(eventNavigationUrl('waze', 'Legacy', undefined, 1, 2)).toContain(
    'll=1,2'
  );
  expect(eventNavigationUrl('google', 'https://meet.example')).toBeNull();
  expect(hasPhysicalLocation('Address', 'https://meet.example')).toBe(false);
  expect(eventNavigationUrl('waze', '')).toBeNull();
});

it('imports address provenance without inventing IDs or coordinates', async () => {
  const f = privacyFixture('viewer');
  f.tables.members[0].role = 'admin';
  await invoke(importGoogleCalendar, f.ctx, {
    events: [
      {
        title: 'Imported',
        startIso: '2026-10-19T10:00:00+03:00',
        endIso: null,
        isAllDay: false,
        location: 'Imported address',
      },
    ],
  });
  const imported = f.tables.events.find((e) => e.title === 'Imported');
  if (!imported) throw new Error('Event was not imported');
  expect(imported.location).toBe('Imported address');
  expect(imported.locationSource).toBe('imported');
  expect(imported.googlePlaceId).toBeUndefined();
  expect(imported.locationUrl).toBeUndefined();
});

it('linked calendar reads preserve the source ID but deleted snapshots stay address-only', async () => {
  const f = privacyFixture('viewer');
  Object.assign(f.tables.events[0], {
    location: 'Shared',
    locationSource: 'google',
    googlePlaceId: 'shared_place',
    onlineUrl: 'https://private-link.example',
  });
  f.tables.linkedEvents = [
    {
      _id: 'linked',
      sourceEventId: 'event',
      spaceId: 'space',
      savedByUserId: 'viewer',
      ownerUserId: 'owner',
      sourceStatus: 'active',
      snapshotTitle: 'Snapshot',
      snapshotStartTime: 100,
      snapshotEndTime: 200,
      snapshotLocation: 'Snapshot address',
      savedAt: 1,
    },
  ];
  const args = { spaceId: 'space', from: 0, to: 300 };
  const live = await invoke(getLinkedEventsForSpace, f.ctx, args);
  expect(live[0].googlePlaceId).toBe('shared_place');
  expect(live[0].location).toBe('Shared');
  expect(live[0].onlineUrl).toBeUndefined();
  f.tables.linkedEvents[0].sourceStatus = 'deleted';
  const deleted = await invoke(getLinkedEventsForSpace, f.ctx, args);
  expect(deleted[0].location).toBe('Snapshot address');
  expect(deleted[0].googlePlaceId).toBeUndefined();
});
