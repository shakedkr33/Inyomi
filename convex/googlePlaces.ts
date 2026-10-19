import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

export type PlacesError =
  | 'AUTH_REQUIRED'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE';
type Failure = { ok: false; error: PlacesError };
type Result<T> = { ok: true; value: T } | Failure;
export type PlaceSuggestion = { placeId: string; description: string };
type Coordinates = { lat: number; lng: number };
const fail = (error: PlacesError): Failure => ({ ok: false, error });
const sessionToken = v.string();
const validToken = (token: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    token
  );
const validPlaceId = (id: string) => /^[A-Za-z0-9_-]{1,512}$/.test(id);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Fixed windows are charged BEFORE calling Google, including failed upstream calls.
// Convex serializes conflicting mutation reads/writes, including absent index rows.
// One shared budget for autocomplete/details prevents bypass by switching endpoints.
export const reserve = internalMutation({
  args: {},
  handler: async (ctx): Promise<Failure | { ok: true }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return fail('AUTH_REQUIRED');
    const now = Date.now();
    const limits = [
      { scope: `user:${userId}`, duration: 60_000, limit: 60 },
      { scope: `user:${userId}`, duration: 86_400_000, limit: 1000 },
      { scope: 'global', duration: 60_000, limit: 600 },
      { scope: 'global', duration: 86_400_000, limit: 10_000 },
    ];
    const buckets = await Promise.all(
      limits.map(async ({ scope, duration, limit }) => {
        const start = Math.floor(now / duration) * duration;
        const key = `${scope}:${duration}:${start}`;
        const row = await ctx.db
          .query('placesRateLimits')
          .withIndex('by_key', (q) => q.eq('key', key))
          .unique();
        return { key, row, limit, expiresAt: start + duration };
      })
    );
    if (buckets.some(({ row, limit }) => (row?.count ?? 0) >= limit))
      return fail('RATE_LIMITED');
    for (const { key, row, expiresAt } of buckets) {
      if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
      else {
        const id = await ctx.db.insert('placesRateLimits', {
          key,
          count: 1,
          expiresAt,
        });
        await ctx.scheduler.runAt(
          expiresAt,
          internal.googlePlaces.expireBucket,
          { id }
        );
      }
    }
    return { ok: true };
  },
});

export const expireBucket = internalMutation({
  args: { id: v.id('placesRateLimits') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(id);
  },
});

// Do not propagate upstream bodies, URLs or exceptions: they can contain keys
// and private search text. No logs, cache, retries, or client-selected endpoints.
async function google(
  endpoint: 'autocomplete' | 'details',
  params: Record<string, string>
): Promise<Record<string, unknown> | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key?.trim()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL(
      `https://maps.googleapis.com/maps/api/place/${endpoint}/json`
    );
    url.search = new URLSearchParams({
      ...params,
      key,
      language: 'he',
    }).toString();
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return record(body) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const autocomplete = action({
  args: { input: v.string(), sessionToken },
  handler: async (ctx, args): Promise<Result<PlaceSuggestion[]>> => {
    const access = await ctx.runMutation(internal.googlePlaces.reserve, {});
    if (!access.ok) return access;
    const input = args.input.trim();
    if (
      input.length < 2 ||
      args.input.length > 200 ||
      Array.from(input).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
      ) ||
      !validToken(args.sessionToken)
    )
      return fail('INVALID_INPUT');
    const body = await google('autocomplete', {
      input,
      sessiontoken: args.sessionToken,
    });
    if (body?.status === 'ZERO_RESULTS') return { ok: true, value: [] };
    if (body?.status !== 'OK' || !Array.isArray(body.predictions))
      return fail('UNAVAILABLE');
    const suggestions: PlaceSuggestion[] = [];
    for (const item of body.predictions.slice(0, 5)) {
      if (
        !record(item) ||
        typeof item.description !== 'string' ||
        !item.description.trim() ||
        item.description.length > 1000 ||
        typeof item.place_id !== 'string' ||
        !validPlaceId(item.place_id)
      )
        return fail('UNAVAILABLE');
      suggestions.push({
        description: item.description,
        placeId: item.place_id,
      });
    }
    return { ok: true, value: suggestions };
  },
});

export const details = action({
  args: { placeId: v.string(), sessionToken },
  handler: async (ctx, args): Promise<Result<Coordinates>> => {
    const access = await ctx.runMutation(internal.googlePlaces.reserve, {});
    if (!access.ok) return access;
    if (!validPlaceId(args.placeId) || !validToken(args.sessionToken))
      return fail('INVALID_INPUT');
    const body = await google('details', {
      place_id: args.placeId,
      sessiontoken: args.sessionToken,
      fields: 'geometry/location',
    });
    if (
      body?.status !== 'OK' ||
      !record(body.result) ||
      !record(body.result.geometry) ||
      !record(body.result.geometry.location)
    )
      return fail('UNAVAILABLE');
    // Do not use content whose additional attribution cannot be displayed by this UI.
    if (
      Array.isArray(body.html_attributions) &&
      body.html_attributions.length > 0
    )
      return fail('UNAVAILABLE');
    const { lat, lng } = body.result.geometry.location;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      return fail('UNAVAILABLE');
    return { ok: true, value: { lat, lng } };
  },
});
