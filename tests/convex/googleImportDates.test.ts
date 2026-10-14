import { describe, expect, it, spyOn } from 'bun:test';
import {
  hasCompletedGoogleImport,
  importGoogleCalendar,
} from '../../convex/googleImport';
import {
  fetchCalendarPreview,
  type NormalizedEvent,
} from '../../lib/services/googleCalendarEvents';
import { formatEventStartLabel } from '../../lib/services/importFlowUtils';

// Real registered handlers, auth and space resolution; synthetic DB only.
// This adapter does not simulate Convex transactions or concurrent mutations.
type Row = Record<string, unknown>;
class Query {
  private predicates: Array<(row: Row) => boolean> = [];
  constructor(private rows: Row[]) {}
  eq(field: string, value: unknown) {
    this.predicates.push((row) => row[field] === value);
    return this;
  }
  withIndex(_name: string, build: (query: Query) => unknown) {
    build(this);
    return this;
  }
  collect() {
    return Promise.resolve(
      this.rows.filter((row) =>
        this.predicates.every((predicate) => predicate(row))
      )
    );
  }
  async unique() {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error('Non-unique fixture');
    return rows[0] ?? null;
  }
}
function fixture(userId: string | null = 'importer') {
  const tables: Record<string, Row[]> = {
    spaces: [{ _id: 'space' }],
    members: [
      { userId: 'importer', kind: 'access', role: 'admin', spaceId: 'space' },
    ],
    events: [],
    googleImportStatus: [],
  };
  // Real auth boundary requires persisted synthetic users and sessions.
  tables.users ??= [];
  if (userId && !tables.users.some((row) => row._id === userId)) {
    tables.users.push({ _id: userId });
  }
  tables.authSessions = tables.users.map((row) => ({
    _id: `${row._id}-session`,
    userId: row._id,
    expirationTime: Date.now() + 60000,
  }));
  const ctx = {
    auth: {
      getUserIdentity: () =>
        Promise.resolve(
          userId ? { subject: `${userId}|${userId}-session` } : null
        ),
    },
    db: {
      get: async (id: string) =>
        Object.values(tables)
          .flat()
          .find((row) => row._id === id) ?? null,
      query: (table: string) => new Query(tables[table]),
      insert: (table: string, row: Row) => {
        tables[table].push(row);
        return Promise.resolve(`${table}:${tables[table].length}`);
      },
    },
  };
  return { ctx, tables };
}
function invoke(
  handler: unknown,
  ctx: ReturnType<typeof fixture>['ctx'],
  args: object
) {
  // Convex exposes _handler at runtime. The cast is confined to this adapter.
  return (
    handler as {
      _handler: (context: typeof ctx, args: object) => Promise<unknown>;
    }
  )._handler(ctx, args);
}
function event(startIso: string, endIso: string | null, isAllDay = true) {
  return { title: 'Synthetic import', startIso, endIso, isAllDay };
}
function localDateTime(ms: unknown, timeZone = 'Asia/Jerusalem') {
  if (typeof ms !== 'number') throw new Error('Expected stored timestamp');
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

const ranges = [
  [
    'DST start',
    '2026-03-27',
    '2026-03-28',
    '2026-03-26T22:00:00Z',
    '2026-03-27T21:00:00Z',
  ],
  [
    'DST end',
    '2026-10-25',
    '2026-10-26',
    '2026-10-24T21:00:00Z',
    '2026-10-25T22:00:00Z',
  ],
  [
    'summer',
    '2026-07-01',
    '2026-07-02',
    '2026-06-30T21:00:00Z',
    '2026-07-01T21:00:00Z',
  ],
  [
    'winter',
    '2026-01-15',
    '2026-01-16',
    '2026-01-14T22:00:00Z',
    '2026-01-15T22:00:00Z',
  ],
  [
    'multi-day DST start',
    '2026-03-26',
    '2026-03-29',
    '2026-03-25T22:00:00Z',
    '2026-03-28T21:00:00Z',
  ],
  [
    'multi-day DST end',
    '2026-10-24',
    '2026-10-27',
    '2026-10-23T21:00:00Z',
    '2026-10-26T22:00:00Z',
  ],
  [
    'exclusive end at DST start',
    '2026-03-26',
    '2026-03-27',
    '2026-03-25T22:00:00Z',
    '2026-03-26T22:00:00Z',
  ],
  [
    'exclusive end at DST end',
    '2026-10-24',
    '2026-10-25',
    '2026-10-23T21:00:00Z',
    '2026-10-24T21:00:00Z',
  ],
  [
    'leap day',
    '2028-02-29',
    '2028-03-01',
    '2028-02-28T22:00:00Z',
    '2028-02-29T22:00:00Z',
  ],
  [
    'year boundary',
    '2026-12-31',
    '2027-01-01',
    '2026-12-30T22:00:00Z',
    '2026-12-31T22:00:00Z',
  ],
] as const;

describe('Google import all-day persistence in Jerusalem', () => {
  for (const [name, start, end, utcStart, utcEnd] of ranges) {
    it(name, async () => {
      const { ctx, tables } = fixture();
      await invoke(importGoogleCalendar, ctx, { events: [event(start, end)] });
      const stored = tables.events[0];
      expect(stored.startTime).toBe(Date.parse(utcStart));
      expect(stored.endTime).toBe(Date.parse(utcEnd));
      expect(stored.allDay).toBe(true);
      expect(localDateTime(stored.startTime)).toBe(`${start} 00:00`);
      expect(localDateTime(stored.endTime)).toBe(`${end} 00:00`);
    });
  }
  for (const [name, start, end, utcStart, utcEnd] of ranges.filter(
    ([name]) => !name.includes('multi-day')
  )) {
    if (name.startsWith('exclusive')) continue;
    it(`missing end: ${name}`, async () => {
      const { ctx, tables } = fixture();
      await invoke(importGoogleCalendar, ctx, { events: [event(start, null)] });
      expect(tables.events[0].startTime).toBe(Date.parse(utcStart));
      expect(tables.events[0].endTime).toBe(Date.parse(utcEnd));
      expect(localDateTime(tables.events[0].endTime)).toBe(`${end} 00:00`);
    });
  }
  it('documents the device-zone limitation, without claiming international all-day support', async () => {
    const { ctx, tables } = fixture();
    await invoke(importGoogleCalendar, ctx, {
      events: [event('2026-03-27', '2026-03-28')],
    });
    expect(localDateTime(tables.events[0].startTime, 'America/New_York')).toBe(
      '2026-03-26 18:00'
    );
    expect(localDateTime(tables.events[0].startTime, 'Asia/Tokyo')).toBe(
      '2026-03-27 07:00'
    );
  });
});

describe('Google import unchanged contracts', () => {
  for (const [start, end] of [
    ['2026-03-27T01:30:00+02:00', '2026-03-27T03:30:00+03:00'],
    ['2026-10-25T01:30:00+03:00', '2026-10-25T01:30:00+02:00'],
    ['2026-03-08T01:30:00-05:00', '2026-03-08T03:30:00-04:00'],
    ['2026-07-01T09:00:00+09:00', '2026-07-01T10:00:00+09:00'],
    ['2026-03-27T00:00:00Z', null],
  ] as const) {
    it(`timed timestamps: ${start}`, async () => {
      const { ctx, tables } = fixture();
      await invoke(importGoogleCalendar, ctx, {
        events: [event(start, end, false)],
      });
      expect(tables.events[0].startTime).toBe(Date.parse(start));
      expect(tables.events[0].endTime).toBe(
        end ? Date.parse(end) : Date.parse(start) + 3_600_000
      );
      expect(tables.events[0].allDay).toBe(false);
    });
  }
  it('preserves metadata, ownership, status and the retry lock', async () => {
    const { ctx, tables } = fixture();
    const input = {
      ...event('2026-03-27', '2026-03-28'),
      location: 'Synthetic location',
      onlineUrl: 'https://meet.google.com/test',
    };
    expect(await invoke(hasCompletedGoogleImport, ctx, {})).toEqual({
      completed: false,
    });
    expect(
      await invoke(importGoogleCalendar, ctx, { events: [input] })
    ).toEqual({ success: true, importedCount: 1 });
    const snapshot = structuredClone(tables);
    expect(
      await invoke(importGoogleCalendar, ctx, {
        events: [event('2026-07-01', null)],
      })
    ).toEqual({ alreadyCompleted: true, importedCount: 1 });
    expect(tables).toEqual(snapshot);
    expect(tables.events[0]).toMatchObject({
      title: input.title,
      location: input.location,
      onlineUrl: input.onlineUrl,
      createdBy: 'importer',
      spaceId: 'space',
      source: 'google_copy',
      ownerScope: 'personal',
    });
    expect(tables.events[0].sharedWithUserIds).toBeUndefined();
    expect(await invoke(hasCompletedGoogleImport, ctx, {})).toEqual({
      completed: true,
      importedCount: 1,
      completedAt: tables.googleImportStatus[0].completedAt,
    });
  });
  it('rejects unauthenticated imports without writes', async () => {
    const { ctx, tables } = fixture(null);
    await expect(
      invoke(importGoogleCalendar, ctx, { events: [event('2026-03-27', null)] })
    ).rejects.toThrow();
    expect(tables.events).toHaveLength(0);
    expect(tables.googleImportStatus).toHaveLength(0);
  });
  it('preserves preview dates and dedup through normalization and the actual import', async () => {
    const items = ['2026-03-27', '2026-10-25'].map((date, i) => ({
      id: `event-${i}`,
      iCalUID: `uid-${i}`,
      summary: 'Synthetic',
      start: { date },
      end: { date: i === 0 ? '2026-03-28' : '2026-10-26' },
    }));
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [...items, ...items] }))
    );
    let events: readonly NormalizedEvent[];
    try {
      const preview = await fetchCalendarPreview(
        'synthetic-token',
        [{ id: 'synthetic', title: 'Synthetic' }],
        '2026-01-01T00:00:00Z',
        '2027-01-01T00:00:00Z',
        new AbortController().signal
      );
      expect(preview.kind).toBe('success');
      if (preview.kind !== 'success') throw new Error('Expected preview');
      expect(preview.count).toBe(2);
      events = preview.events;
    } finally {
      fetchSpy.mockRestore();
    }
    const { ctx, tables } = fixture();
    await invoke(importGoogleCalendar, ctx, {
      events: events.map(({ localId: _localId, ...input }) => input),
    });
    expect(
      events.map((input) =>
        formatEventStartLabel(input.startIso, input.isAllDay)
      )
    ).toEqual(['27 במרץ · כל היום', '25 באוקטובר · כל היום']);
    expect(tables.events.map((row) => localDateTime(row.startTime))).toEqual([
      '2026-03-27 00:00',
      '2026-10-25 00:00',
    ]);
  });
});
