/**
 * Holiday overlay preferences storage — Phase 2B foundation.
 *
 * Persists which InYomi holiday categories the user has enabled.
 * Uses AsyncStorage only. Never touches Convex.
 *
 * Safety contract:
 * - load never throws; malformed or missing data returns defaults.
 * - save never throws; storage failure is reported via its boolean return
 *   value (true = persisted, false = failed) so a caller that cares can
 *   surface a non-blocking warning. Existing callers that ignore the
 *   return value keep their current fire-and-forget behavior unchanged.
 * - Unknown category IDs in stored data are silently dropped.
 * - Duplicate category IDs are deduplicated on load.
 * - All returned objects are fresh copies; the default object is never mutated.
 *
 * "Holiday overlay enabled" is intentionally derived (see hasEnabledHolidayCategories),
 * not stored as a separate boolean field.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HolidayCategoryId } from '../types/holidayOverlay';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@inyomi/holiday-overlay-preferences:v1';

/**
 * The complete set of valid InYomi holiday category IDs.
 * Used to validate and filter stored values.
 */
const VALID_CATEGORY_IDS: ReadonlySet<HolidayCategoryId> = new Set([
  'jewish_holidays',
  'israeli_national_days',
  'fast_days',
  'rosh_chodesh',
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export type HolidayOverlayPreferences = {
  /** Category IDs the user has explicitly enabled. Empty means no overlay is shown. */
  enabledCategories: HolidayCategoryId[];
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_HOLIDAY_OVERLAY_PREFERENCES: HolidayOverlayPreferences = {
  enabledCategories: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a safe copy of the defaults; never exposes the shared default reference. */
function defaultCopy(): HolidayOverlayPreferences {
  return { enabledCategories: [] };
}

/**
 * Parse and validate an unknown value from AsyncStorage into HolidayOverlayPreferences.
 * - Non-object values → defaults.
 * - `enabledCategories` must be an array; non-arrays → empty array.
 * - Each element is validated against VALID_CATEGORY_IDS; unknowns are dropped.
 * - Duplicates are removed.
 */
function parsePreferences(raw: unknown): HolidayOverlayPreferences {
  if (typeof raw !== 'object' || raw === null) return defaultCopy();

  const record = raw as Record<string, unknown>;
  const rawCategories = record.enabledCategories;

  if (!Array.isArray(rawCategories)) return defaultCopy();

  const seen = new Set<HolidayCategoryId>();
  for (const entry of rawCategories) {
    if (typeof entry === 'string' && VALID_CATEGORY_IDS.has(entry as HolidayCategoryId)) {
      seen.add(entry as HolidayCategoryId);
    }
  }

  return { enabledCategories: Array.from(seen) };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load persisted holiday overlay preferences.
 *
 * Returns defaults when:
 * - storage is empty or the key has never been written
 * - the stored value is not valid JSON
 * - the stored value has an unexpected shape
 * - AsyncStorage throws for any reason
 *
 * Unknown category IDs are silently ignored.
 * Duplicate category IDs are deduplicated.
 */
export async function loadHolidayOverlayPreferences(): Promise<HolidayOverlayPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultCopy();
    return parsePreferences(JSON.parse(raw));
  } catch {
    return defaultCopy();
  }
}

/**
 * Persist holiday overlay preferences.
 *
 * Never throws — storage write failures resolve to `false` instead.
 * Callers that don't need to know the outcome can ignore the return value
 * exactly as before (fire-and-forget).
 */
export async function saveHolidayOverlayPreferences(
  prefs: HolidayOverlayPreferences
): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    // Storage write failure must never crash the app.
    return false;
  }
}

/**
 * Returns true when the user has enabled at least one holiday category.
 * Use this to derive "holiday overlay is active" without a stored boolean.
 */
export function hasEnabledHolidayCategories(
  prefs: HolidayOverlayPreferences
): boolean {
  return prefs.enabledCategories.length > 0;
}
