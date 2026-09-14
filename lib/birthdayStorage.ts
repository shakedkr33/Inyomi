import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Birthday } from '@/lib/types/birthday';

// ─── Legacy (pre-isolation-fix) global key ───────────────────────────────────
// SECURITY FIX (cross-user privacy leak): this key used to be shared by
// EVERY account on the device — User B could read User A's birthdays after
// an account switch, because nothing here scoped the key to a user.
//
// This key (and its now-unused seed-migration marker) must NEVER be read
// again, and its contents must NEVER be attributed to any specific account:
// legacy records carry no userId/spaceId/ownerId, so there is no safe way to
// determine who they belonged to. Automatically "migrating" them into the
// current user's scoped storage could hand User A's private birthdays to
// User B. See purgeLegacyGlobalBirthdayStorage below for the one-time,
// ownership-free cleanup.
const LEGACY_GLOBAL_STORAGE_KEY = 'inyomi_birthdays_v1';
const LEGACY_MIGRATION_MARKER_KEY = 'inyomi_birthdays_migration_v1';

// ─── Current (per-user) storage ───────────────────────────────────────────────
// v2: scoped by the authenticated Convex user id — inyomi_birthdays_v2_<userId>.
// Every read/write requires an explicit userId; there is no global fallback.
const STORAGE_KEY_PREFIX = 'inyomi_birthdays_v2_';

/** Returns the per-user storage key. Never share this key across users. */
export function getBirthdayStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

// ─── Core storage helpers ─────────────────────────────────────────────────────

/**
 * Loads the authenticated user's persisted birthdays.
 *
 * Requires a non-empty userId — callers must know the authenticated user's
 * id before reading. Never reads the legacy global key as a fallback.
 */
export async function loadPersistedBirthdays(
  userId: string
): Promise<Birthday[] | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(getBirthdayStorageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as Birthday[];
  } catch {
    return null;
  }
}

/**
 * Persists birthdays under the authenticated user's scoped key.
 *
 * Requires a non-empty userId — throws rather than silently writing to a
 * global/unscoped location. Never writes the legacy global key.
 */
export async function persistBirthdays(
  userId: string,
  birthdays: Birthday[]
): Promise<void> {
  if (!userId) {
    throw new Error('persistBirthdays requires an authenticated userId');
  }
  await AsyncStorage.setItem(
    getBirthdayStorageKey(userId),
    JSON.stringify(birthdays)
  );
}

// ─── One-time legacy key purge (safe, idempotent, no ownership guess) ────────

/**
 * Permanently deletes the old global birthday key (and its now-unused
 * seed-migration marker) so it can never leak into any account again.
 *
 * Does NOT read the legacy key's contents into any user's scoped storage —
 * legacy records carry no userId/spaceId, so there is no safe way to decide
 * which account they belonged to. Deleting is the only safe option.
 * `AsyncStorage.multiRemove` on already-missing keys is a harmless no-op, so
 * this is naturally idempotent and safe to call on every app start.
 */
export async function purgeLegacyGlobalBirthdayStorage(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      LEGACY_GLOBAL_STORAGE_KEY,
      LEGACY_MIGRATION_MARKER_KEY,
    ]);
  } catch (error) {
    if (__DEV__) {
      console.error('[Birthdays] Failed to purge legacy global storage', error);
    }
  }
}
