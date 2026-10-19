import { expect, it } from 'bun:test';
import { act } from 'react-test-renderer';
import { update } from '../../convex/events';
import { personalEventEditorHarness } from './helpers/personalEventEditorHarness';
import { invoke, privacyFixture } from './helpers/privacyFixture';

function setup(community = false, initialLink?: string) {
  const f = privacyFixture();
  const event = f.tables.events[0];
  Object.assign(event, {
    location: initialLink ? '' : 'Saved address',
    locationSource: initialLink ? undefined : 'google',
    googlePlaceId: initialLink ? undefined : 'saved_place',
    onlineUrl: initialLink,
    startTime: Date.now() + 86400000,
    endTime: Date.now() + 90000000,
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
  let fail = false;
  const open = () =>
    personalEventEditorHarness({
      event: structuredClone(event),
      tasks: [],
      realLocationCard: true,
      save: (args) => {
        if (fail) return Promise.reject(new Error('Save failed'));
        return invoke(update, f.ctx, JSON.parse(JSON.stringify(args)));
      },
    });
  const h = open();
  const input = (label: string) =>
    h.root
      .findAllByType('TextInput')
      .find((n) => n.props.accessibilityLabel === label);
  const type = (label: string, text: string) =>
    act(() => input(label)?.props.onChangeText(text));
  return {
    event,
    h,
    open,
    input,
    type,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}
for (const community of [false, true]) {
  it(`${community ? 'community' : 'personal'} drafts survive switches, failed save and retry; only active link persists`, async () => {
    const s = setup(community);
    const { h, event } = s;
    await h.press('קישור');
    s.type('קישור לפגישה', 'meet.google.com/abc?token=x#y');
    await h.press('כתובת');
    expect(s.input('חיפוש כתובת')?.props.value).toBe('Saved address');
    await h.press('קישור');
    expect(s.input('קישור לפגישה')?.props.value).toBe(
      'meet.google.com/abc?token=x#y'
    );
    await h.press('כתובת');
    await h.press('קישור');
    expect(h.payloads).toHaveLength(0);
    expect(event.googlePlaceId).toBe('saved_place');
    s.setFail(true);
    await h.press('שמור אירוע');
    expect(event.googlePlaceId).toBe('saved_place');
    await h.press('כתובת');
    expect(s.input('חיפוש כתובת')?.props.value).toBe('Saved address');
    await h.press('קישור');
    expect(s.input('קישור לפגישה')?.props.value).toBe(
      'meet.google.com/abc?token=x#y'
    );
    s.setFail(false);
    await h.press('שמור אירוע');
    expect(event.onlineUrl).toBe('https://meet.google.com/abc?token=x#y');
    expect(event.location).toBe('');
    expect(event.googlePlaceId).toBeUndefined();
    expect(event.locationUrl).toBe('');
    h.dispose();
    const reopened = s.open();
    await reopened.press('כתובת');
    expect(
      reopened.root.findByProps({ accessibilityLabel: 'חיפוש כתובת' }).props
        .value
    ).toBe('');
    reopened.dispose();
  });
  it(`${community ? 'community' : 'personal'} preserves Google selection on return, clears link on address save, invalidates ID on manual edit`, async () => {
    const { h, event, input, type } = setup(community);
    await h.press('קישור');
    type('קישור לפגישה', 'invalid inactive draft');
    await h.press('כתובת');
    await h.press('שמור אירוע');
    expect(event.location).toBe('Saved address');
    expect(event.googlePlaceId).toBe('saved_place');
    expect(event.onlineUrl).toBe('');
    type('חיפוש כתובת', 'Manual address');
    await h.press('קישור');
    await h.press('כתובת');
    expect(input('חיפוש כתובת')?.props.value).toBe('Manual address');
    await h.press('שמור אירוע');
    expect(event.locationSource).toBe('manual');
    expect(event.googlePlaceId).toBeUndefined();
    h.dispose();
  });
  it(`${community ? 'community' : 'personal'} validates active link, keeps drafts for correction, and cancel never writes`, async () => {
    const { h, event, type, input } = setup(
      community,
      'https://example.com/original'
    );
    await h.press('כתובת');
    type('חיפוש כתובת', 'Draft address');
    await h.press('קישור');
    expect(input('קישור לפגישה')?.props.value).toBe(
      'https://example.com/original'
    );
    type('קישור לפגישה', 'free text');
    await h.press('שמור אירוע');
    expect(h.payloads).toHaveLength(0);
    expect(h.alerts.flat()).toContain('יש להזין קישור תקין');
    await h.press('כתובת');
    expect(input('חיפוש כתובת')?.props.value).toBe('Draft address');
    await h.press('חזרה');
    await h.press('בטל שינויים');
    expect(h.payloads).toHaveLength(0);
    expect(event.onlineUrl).toBe('https://example.com/original');
    h.dispose();
  });
}
it('untouched legacy link allows unrelated save, explicit edit is validated', async () => {
  const { h, event, type } = setup(false, 'legacy invalid');
  h.changeTitle('Unrelated');
  await h.press('שמור אירוע');
  expect(event.onlineUrl).toBe('legacy invalid');
  type('קישור לפגישה', 'legacy invalid');
  await h.press('שמור אירוע');
  expect(h.payloads).toHaveLength(1);
  expect(h.alerts.flat()).toContain('יש להזין קישור תקין');
  h.dispose();
});
