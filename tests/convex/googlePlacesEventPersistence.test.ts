import { expect, it } from 'bun:test';
import { act } from 'react-test-renderer';
import { update } from '../../convex/events';
import type { LocationUpdate } from '../../lib/components/event/LocationCard';
import { personalEventEditorHarness } from './helpers/personalEventEditorHarness';
import { invoke, privacyFixture } from './helpers/privacyFixture';

for (const community of [false, true]) {
  for (const mode of [
    'untouched',
    'manual',
    'selected',
    'online',
    'closed',
  ] as const) {
    it(`${community ? 'community' : 'personal'} editor persists ${mode} location and reopens`, async () => {
      const f = privacyFixture();
      const event = f.tables.events[0];
      Object.assign(event, {
        spaceId: 'space',
        location: 'Old address',
        locationUrl: 'geo:1,2',
        startTime: Date.now() + 86400000,
        endTime: Date.now() + 90000000,
        allDay: false,
      });
      if (community) {
        event.communityId = 'community';
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
      const open = () =>
        personalEventEditorHarness({
          event: structuredClone(event),
          tasks: [],
          save: (args) =>
            invoke(update, f.ctx, JSON.parse(JSON.stringify(args))),
        });
      const h = open();
      const updates: Record<string, LocationUpdate> = {
        manual: {
          location: 'Manual address',
          onlineUrl: '',
          locationUrl: '',
          locationSource: 'manual',
          googlePlaceId: null,
        },
        selected: {
          location: 'Selected address',
          onlineUrl: '',
          locationUrl: '',
          locationSource: 'google',
          googlePlaceId: 'place_selected',
        },
        online: {
          location: '',
          onlineUrl: 'https://meet.example',
          locationUrl: '',
        },
        closed: { location: '', onlineUrl: '', locationUrl: '' },
      };
      if (mode !== 'untouched')
        act(() =>
          h.root.findByType('LocationCard').props.onChange(updates[mode])
        );
      else h.changeTitle('Keep old location');
      await h.press('שמור אירוע');
      expect(h.alerts).toEqual([]);
      expect(h.payloads).toHaveLength(1);
      expect(event.locationUrl).toBe(
        mode === 'untouched' ? 'geo:1,2' : updates[mode].locationUrl
      );
      expect(event.location).toBe(
        mode === 'untouched' ? 'Old address' : updates[mode].location
      );
      expect(event.googlePlaceId).toBe(
        mode === 'selected' ? 'place_selected' : undefined
      );
      expect(event.locationSource).toBe(
        mode === 'selected'
          ? 'google'
          : mode === 'manual'
            ? 'manual'
            : undefined
      );
      h.dispose();
      const reopened = open();
      expect(
        reopened.root.findByType('LocationCard').props.location ?? ''
      ).toBe(mode === 'untouched' ? 'Old address' : updates[mode].location);
      expect(
        reopened.root.findByType('LocationCard').props.onlineUrl ?? ''
      ).toBe(mode === 'untouched' ? '' : updates[mode].onlineUrl);
      reopened.dispose();
    });
  }
}

for (const source of ['google', 'imported'] as const) {
  it(`unrelated editor save preserves ${source} metadata and both imported location/link fields`, async () => {
    const f = privacyFixture();
    const event = f.tables.events[0];
    Object.assign(event, {
      location: 'Saved address',
      locationSource: source,
      googlePlaceId: source === 'google' ? 'saved_place' : undefined,
      onlineUrl: source === 'imported' ? 'https://meet.example' : undefined,
      startTime: Date.now() + 86400000,
      endTime: Date.now() + 90000000,
    });
    const h = personalEventEditorHarness({
      event: structuredClone(event),
      tasks: [],
      save: (args) => invoke(update, f.ctx, JSON.parse(JSON.stringify(args))),
    });
    h.changeTitle('Unrelated title');
    await h.press('שמור אירוע');
    expect(h.alerts).toEqual([]);
    expect(event.location).toBe('Saved address');
    expect(event.locationSource).toBe(source);
    expect(event.googlePlaceId).toBe(
      source === 'google' ? 'saved_place' : undefined
    );
    expect(event.onlineUrl).toBe(
      source === 'imported' ? 'https://meet.example' : undefined
    );
    h.dispose();
  });
}
