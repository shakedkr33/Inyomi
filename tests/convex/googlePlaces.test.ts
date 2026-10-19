import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  autocomplete,
  details,
  expireBucket,
  reserve,
} from '../../convex/googlePlaces';
import { privacyFixture } from './helpers/privacyFixture';

const token = '12345678-1234-4234-8234-123456789abc';
const originalFetch = globalThis.fetch;
const originalKey = process.env.GOOGLE_PLACES_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = originalKey;
});
function call<T>(entry: unknown, ctx: unknown, args: object): Promise<T> {
  return (
    entry as { _handler: (ctx: unknown, args: object) => Promise<T> }
  )._handler(ctx, args);
}
function harness(user: string | null = 'owner') {
  const f = privacyFixture(user);
  const scheduled: { id: string; time: number }[] = [];
  const ctx = {
    ...f.ctx,
    scheduler: {
      runAt: async (time: number, _fn: unknown, { id }: { id: string }) => {
        scheduled.push({ id, time });
      },
    },
  };
  // Serialize the fixture's mutation transactions, as Convex does for conflicts.
  // This tests concurrent action admission, NOT Convex's hosted OCC implementation.
  let tail: Promise<unknown> = Promise.resolve();
  const actionCtx = {
    runMutation: () => {
      const result = tail.then(() => call(reserve, ctx, {}));
      tail = result.catch(() => {});
      return result;
    },
  };
  const requests: URL[] = [];
  process.env.GOOGLE_PLACES_API_KEY = 'synthetic-server-secret';
  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      requests.push(new URL(String(url)));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  };
  respond({ status: 'ZERO_RESULTS' });
  return {
    ...f,
    ctx,
    actionCtx,
    scheduled,
    requests,
    respond,
    search: (input = 'תל אביב', sessionToken = token) =>
      call(autocomplete, actionCtx, { input, sessionToken }),
    details: (placeId = 'ChIJ_example', sessionToken = token) =>
      call(details, actionCtx, { placeId, sessionToken }),
  };
}

describe('Google Places authenticated actions', () => {
  it('rejects anonymous, expired, missing, mismatched, disabled and deleted identities before Google', async () => {
    for (const state of [
      'anonymous',
      'expired',
      'missing',
      'mismatched',
      'disabled',
      'deleted',
    ]) {
      const h = harness(state === 'anonymous' ? null : 'owner');
      if (state === 'expired')
        h.tables.authSessions[0].expirationTime = Date.now() - 1;
      if (state === 'missing') h.tables.authSessions = [];
      if (state === 'mismatched') h.tables.authSessions[0].userId = 'viewer';
      if (state === 'disabled') h.tables.users[0].isActive = false;
      if (state === 'deleted') h.tables.users = [];
      expect(await h.search()).toEqual({ ok: false, error: 'AUTH_REQUIRED' });
      expect(await h.details()).toEqual({ ok: false, error: 'AUTH_REQUIRED' });
      expect(h.requests).toHaveLength(0);
      expect(h.tables.placesRateLimits ?? []).toHaveLength(0);
    }
  });
  it('bounds input, IDs and tokens; no arbitrary endpoint or upstream parameters', async () => {
    const h = harness();
    for (const input of ['', 'a', '  ', 'x'.repeat(201), 'ab\ncd'])
      expect(await h.search(input)).toEqual({
        ok: false,
        error: 'INVALID_INPUT',
      });
    for (const id of [
      '',
      'x'.repeat(513),
      '../details',
      'abc&key=other',
      'https://evil.test',
    ])
      expect(await h.details(id)).toEqual({
        ok: false,
        error: 'INVALID_INPUT',
      });
    expect(await h.search('ab', 'bad')).toEqual({
      ok: false,
      error: 'INVALID_INPUT',
    });
    expect(h.requests).toHaveLength(0);
  });
  it('returns only five safe suggestions and shares the session token with minimal details', async () => {
    const h = harness();
    h.respond({
      status: 'OK',
      predictions: Array.from({ length: 7 }, (_, i) => ({
        description: `Address ${i}`,
        place_id: `id_${i}`,
        secret: 'never returned',
      })),
    });
    expect(await h.search('London')).toEqual({
      ok: true,
      value: Array.from({ length: 5 }, (_, i) => ({
        description: `Address ${i}`,
        placeId: `id_${i}`,
      })),
    });
    h.respond({
      status: 'OK',
      result: {
        geometry: { location: { lat: 32, lng: 34 }, viewport: {} },
        name: 'unused',
      },
    });
    expect(await h.details()).toEqual({
      ok: true,
      value: { lat: 32, lng: 34 },
    });
    expect(
      h.requests.map((url) => url.searchParams.get('sessiontoken'))
    ).toEqual([token, token]);
    expect(h.requests[1].searchParams.get('fields')).toBe('geometry/location');
    expect(h.requests[0].searchParams.get('input')).toBe('London');
    expect(h.requests[0].searchParams.get('language')).toBe('he');
  });
  it('fails closed on quota, denied configuration, HTTP and malformed data without exposing/logging private values', async () => {
    const h = harness();
    const logs = [
      spyOn(console, 'log'),
      spyOn(console, 'warn'),
      spyOn(console, 'error'),
    ];
    try {
      for (const body of [
        null,
        {},
        {
          status: 'OVER_QUERY_LIMIT',
          error_message: 'synthetic-server-secret',
        },
        { status: 'REQUEST_DENIED' },
        { status: 'OK', predictions: [null] },
      ]) {
        h.respond(body);
        expect(await h.search()).toEqual({ ok: false, error: 'UNAVAILABLE' });
      }
      h.respond({}, 429);
      expect(await h.details()).toEqual({ ok: false, error: 'UNAVAILABLE' });
      h.respond({
        status: 'OK',
        result: { geometry: { location: { lat: 999, lng: 34 } } },
      });
      expect(await h.details()).toEqual({ ok: false, error: 'UNAVAILABLE' });
      globalThis.fetch = (async () => {
        throw new Error('synthetic-server-secret private query');
      }) as typeof fetch;
      expect(await h.search()).toEqual({ ok: false, error: 'UNAVAILABLE' });
      globalThis.fetch = (async () => new Response('not-json')) as typeof fetch;
      expect(await h.search()).toEqual({ ok: false, error: 'UNAVAILABLE' });
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
  it('does not use a public credential when the server key is absent', async () => {
    const h = harness();
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(await h.search()).toEqual({ ok: false, error: 'UNAVAILABLE' });
    expect(h.requests).toHaveLength(0);
  });
  it('aborts timed out requests once without retries', async () => {
    const h = harness();
    let calls = 0;
    globalThis.fetch = ((_url, init) =>
      new Promise((_resolve, reject) => {
        calls++;
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('timeout'))
        );
      })) as typeof fetch;
    expect(await h.search()).toEqual({ ok: false, error: 'UNAVAILABLE' });
    expect(calls).toBe(1);
  }, 7000);
  it('admits only 60 concurrent actions for one user across endpoints', async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: 75 }, () => h.search())
    );
    expect(results.filter((r) => (r as { ok: boolean }).ok)).toHaveLength(60);
    expect(
      results.filter((r) => (r as { error: string }).error === 'RATE_LIMITED')
    ).toHaveLength(15);
    expect(h.requests).toHaveLength(60);
    expect(await h.details()).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(h.tables.placesRateLimits).toHaveLength(4);
    expect(h.scheduled).toHaveLength(4);
  });
  it('enforces user/day and global minute/day caps and expires only elapsed buckets', async () => {
    for (const [prefix, duration, count] of [
      ['user:owner', 86400000, 1000],
      ['global', 60000, 600],
      ['global', 86400000, 10000],
    ] as const) {
      const h = harness();
      await h.search();
      const row = h.tables.placesRateLimits.find((r) =>
        String(r.key).startsWith(`${prefix}:${duration}:`)
      );
      if (!row) throw new Error('missing budget');
      row.count = count;
      expect(await h.search()).toEqual({ ok: false, error: 'RATE_LIMITED' });
      expect(h.requests).toHaveLength(1);
      await call(expireBucket, h.ctx, { id: row._id });
      expect(h.tables.placesRateLimits).toContain(row);
      row.expiresAt = Date.now() - 1;
      await call(expireBucket, h.ctx, { id: row._id });
      expect(h.tables.placesRateLimits).not.toContain(row);
    }
  });
});
