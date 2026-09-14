/**
 * SECURITY FIX — cross-user birthday privacy leak (lib/birthdayStorage.ts)
 *
 * A critical audit found that birthday data was persisted under a single
 * global AsyncStorage key (`inyomi_birthdays_v1`) shared by every account on
 * the device. User B could read User A's birthdays after an account switch.
 *
 * This suite covers the local-storage half of the fix:
 *   1. Different users resolve to different storage keys.
 *   2. User A's saved birthdays are invisible to User B's load.
 *   3. User A's birthdays remain available when A signs back in.
 *   4. Persisting for User A never writes User B's key.
 *   5. The legacy global key is never read by the new API.
 *   6. Legacy data is never automatically attributed to any user
 *      (purgeLegacyGlobalBirthdayStorage deletes it; never migrates it).
 *
 * Provider-level in-memory isolation (BirthdaySheetsProvider — immediate
 * state clearing on identity change + stale-load race guard) has no live
 * React Native test harness in this repo, so it is covered via source
 * inspection below (same convention as
 * tests/convex/eventTaskRsvpDecoupling.test.ts).
 *
 * Run with: bun test tests/convex/birthdayStorageIsolation.test.ts
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';

// ── In-memory fake for @react-native-async-storage/async-storage ────────────
// mock.module must run before the module under test is imported, so this
// file uses a dynamic `await import` below instead of a static `import`.
const store = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
    multiRemove: async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    },
  },
}));

const {
  getBirthdayStorageKey,
  loadPersistedBirthdays,
  persistBirthdays,
  purgeLegacyGlobalBirthdayStorage,
} = await import('../../lib/birthdayStorage');

const LEGACY_GLOBAL_KEY = 'inyomi_birthdays_v1';
const LEGACY_MARKER_KEY = 'inyomi_birthdays_migration_v1';

const USER_A = 'user_A_convexId';
const USER_B = 'user_B_convexId';

function birthday(id: string, name: string) {
  return {
    id,
    name,
    day: 1,
    month: 1,
    year: null,
    photoUri: null,
    contactId: null,
    source: 'manual' as const,
    phoneNumber: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  store.clear();
});

// ── 1. Different users → different storage keys ─────────────────────────────

describe('getBirthdayStorageKey', () => {
  it('produces different keys for different user ids', () => {
    expect(getBirthdayStorageKey(USER_A)).not.toBe(
      getBirthdayStorageKey(USER_B)
    );
  });

  it('is deterministic for the same user id', () => {
    expect(getBirthdayStorageKey(USER_A)).toBe(getBirthdayStorageKey(USER_A));
  });

  it('never resolves to the legacy global key for any real user id', () => {
    expect(getBirthdayStorageKey(USER_A)).not.toBe(LEGACY_GLOBAL_KEY);
    expect(getBirthdayStorageKey(USER_B)).not.toBe(LEGACY_GLOBAL_KEY);
  });
});

// ── 2 & 4. Cross-user isolation on load + write ──────────────────────────────

describe('User A / User B storage isolation', () => {
  it('User B loading never sees birthdays saved by User A', async () => {
    await persistBirthdays(USER_A, [birthday('1719601234567', 'A TEST')]);

    const bLoaded = await loadPersistedBirthdays(USER_B);
    expect(bLoaded).toBeNull();
  });

  it('User A and User B can each persist independently without clobbering each other', async () => {
    // Build each object ONCE and reuse it for both the write and the
    // expectation — birthday() stamps Date.now(), so calling it twice with
    // the same args can produce two different timestamps and a flaky test.
    const aBirthday = birthday('1', 'A TEST');
    const bBirthday = birthday('2', 'B TEST');
    await persistBirthdays(USER_A, [aBirthday]);
    await persistBirthdays(USER_B, [bBirthday]);

    const aLoaded = await loadPersistedBirthdays(USER_A);
    const bLoaded = await loadPersistedBirthdays(USER_B);

    expect(aLoaded).toEqual([aBirthday]);
    expect(bLoaded).toEqual([bBirthday]);
  });

  it("persisting for User A writes only User A's key, never User B's", async () => {
    const aBirthday = birthday('1', 'A TEST');
    const bBirthday = birthday('2', 'B TEST');
    await persistBirthdays(USER_B, [bBirthday]);
    await persistBirthdays(USER_A, [aBirthday]);

    expect(store.get(getBirthdayStorageKey(USER_A))).toBe(
      JSON.stringify([aBirthday])
    );
    expect(store.get(getBirthdayStorageKey(USER_B))).toBe(
      JSON.stringify([bBirthday])
    );
  });
});

// ── 3. User A signs back in → data preserved (no sign-out deletion) ─────────

describe("Re-authentication preserves the same user's scoped data", () => {
  it("User A's birthdays remain available across a simulated sign-out/sign-in (no deletion occurs anywhere in this module)", async () => {
    const aBirthday = birthday('1', 'A TEST');
    await persistBirthdays(USER_A, [aBirthday]);

    // Simulated "sign out": nothing in this module is invoked to delete
    // per-user data — deletion only ever targets the legacy global key.
    // Simulated "sign back in":
    const reloaded = await loadPersistedBirthdays(USER_A);

    expect(reloaded).toEqual([aBirthday]);
  });
});

// ── loadPersistedBirthdays / persistBirthdays — require a userId ────────────

describe('loadPersistedBirthdays / persistBirthdays — require an explicit userId', () => {
  it('loadPersistedBirthdays returns null for an empty userId (never reads a global fallback)', async () => {
    expect(await loadPersistedBirthdays('')).toBeNull();
  });

  it('persistBirthdays throws for an empty userId (never writes a global fallback)', async () => {
    await expect(persistBirthdays('', [])).rejects.toThrow();
  });

  it('returns null (not a throw) for corrupt stored JSON', async () => {
    store.set(getBirthdayStorageKey(USER_A), 'not-json{{{');
    await expect(loadPersistedBirthdays(USER_A)).resolves.toBeNull();
  });
});

// ── 5 & 6. Legacy global key: never read, never migrated, safely purged ─────

describe('Legacy global key (inyomi_birthdays_v1) handling', () => {
  it('a new authenticated user never sees legacy global data via loadPersistedBirthdays', async () => {
    store.set(
      LEGACY_GLOBAL_KEY,
      JSON.stringify([birthday('999', 'LEGACY OWNER UNKNOWN')])
    );

    const loaded = await loadPersistedBirthdays(USER_A);
    expect(loaded).toBeNull();
  });

  it('purgeLegacyGlobalBirthdayStorage deletes the legacy key without ever reading/copying it into a scoped key', async () => {
    store.set(
      LEGACY_GLOBAL_KEY,
      JSON.stringify([birthday('999', 'LEGACY OWNER UNKNOWN')])
    );
    store.set(LEGACY_MARKER_KEY, 'done');

    await purgeLegacyGlobalBirthdayStorage();

    expect(store.has(LEGACY_GLOBAL_KEY)).toBe(false);
    expect(store.has(LEGACY_MARKER_KEY)).toBe(false);
    // No scoped key was created as a side effect of the purge.
    expect(store.has(getBirthdayStorageKey(USER_A))).toBe(false);
  });

  it('purgeLegacyGlobalBirthdayStorage is idempotent (safe to call repeatedly / when the key is already gone)', async () => {
    await expect(purgeLegacyGlobalBirthdayStorage()).resolves.toBeUndefined();
    await expect(purgeLegacyGlobalBirthdayStorage()).resolves.toBeUndefined();
    expect(store.has(LEGACY_GLOBAL_KEY)).toBe(false);
  });

  it('purging the legacy key never touches an already-persisted user-scoped key', async () => {
    const aBirthday = birthday('1', 'A TEST');
    await persistBirthdays(USER_A, [aBirthday]);
    store.set(LEGACY_GLOBAL_KEY, JSON.stringify([birthday('999', 'LEGACY')]));

    await purgeLegacyGlobalBirthdayStorage();

    expect(await loadPersistedBirthdays(USER_A)).toEqual([aBirthday]);
  });
});

// ── Provider-level in-memory isolation — source-inspection guards ──────────
// No live RN component test harness exists in this repo for the provider's
// effect/lifecycle logic, so these assert the critical security properties
// directly against the shipped source (same convention as
// tests/convex/eventTaskRsvpDecoupling.test.ts).

const PROVIDER_SOURCE = readFileSync(
  new URL(
    '../../lib/components/birthday/BirthdaySheetsProvider.tsx',
    import.meta.url
  ),
  'utf8'
);

describe('BirthdaySheetsProvider — source-level security guards', () => {
  it('never imports/uses the removed legacy seed-migration API', () => {
    expect(PROVIDER_SOURCE).not.toContain('runBirthdayLegacySeedMigration');
  });

  it('calls the legacy-purge helper (never a legacy read/migrate helper)', () => {
    expect(PROVIDER_SOURCE).toContain('purgeLegacyGlobalBirthdayStorage');
  });

  it('clears in-memory birthdays synchronously on every identity change, before the async load starts', () => {
    // The identity-change block must set state to empty ("birthdaysRef.current = []"
    // followed by "setBirthdays([])") ahead of the "const load = async ()" call
    // in the same effect body.
    const clearIndex = PROVIDER_SOURCE.indexOf(
      'loadedUserIdRef.current = nextUserId;\n    birthdaysRef.current = [];\n    setBirthdays([]);'
    );
    const loadDeclIndex = PROVIDER_SOURCE.indexOf('const load = async ()');
    expect(clearIndex).toBeGreaterThan(-1);
    expect(loadDeclIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(loadDeclIndex);
  });

  it('guards the resolved load against a stale/superseded identity (race protection)', () => {
    expect(PROVIDER_SOURCE).toContain(
      'if (loadedUserIdRef.current !== requestUserId) return;'
    );
  });

  it('commitBirthdays persists using the captured active user id, not a live/shared ref read post-await', () => {
    expect(PROVIDER_SOURCE).toContain(
      'const activeUserId = loadedUserIdRef.current;'
    );
    expect(PROVIDER_SOURCE).toContain(
      'await persistBirthdays(activeUserId, next);'
    );
  });

  it('commitBirthdays refuses to persist when no authenticated user is loaded', () => {
    expect(PROVIDER_SOURCE).toContain('if (!activeUserId) {');
  });

  it("never deletes a signed-out user's persisted data (sign-out branch only returns, no removeItem/clear call)", () => {
    const signOutBlock = PROVIDER_SOURCE.slice(
      PROVIDER_SOURCE.indexOf('if (nextUserId === null) {'),
      PROVIDER_SOURCE.indexOf('if (nextUserId === null) {') + 260
    );
    expect(signOutBlock).not.toMatch(/removeItem|persistBirthdays\(/);
  });

  it('re-runs the load effect on every currentUser identity change, not only once per mount', () => {
    // The old one-shot "hasLoadedRef" gate must be gone.
    expect(PROVIDER_SOURCE).not.toContain('hasLoadedRef');
  });
});
