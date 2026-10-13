/**
 * googleImportHolidayPersistence — persists the InYomi holiday-category
 * selection made during the Google Calendar import flow.
 *
 * Extracted from app/(authenticated)/import-calendar.tsx so the exact
 * persistence sequence (load → save preferences → conditionally sync the
 * calendar-layer "showHolidays" filter) is unit-testable against real
 * storage helpers, instead of only via source-text inspection of the
 * screen component.
 *
 * Product rule (unchanged): the Google Calendar import itself is
 * authoritative and irreversible. Holiday-preference persistence is a
 * secondary side effect that must NEVER block, roll back, or fail the
 * import:
 * - This function never throws.
 * - It returns `true` only when every storage write in the sequence
 *   succeeded, and `false` otherwise — so the caller (the import screen)
 *   can surface a non-blocking warning without affecting the
 *   already-completed import.
 *
 * The "showHolidays" zero↔non-zero boundary sync rule mirrors
 * app/(authenticated)/holiday-overlay-settings.tsx exactly and must stay
 * in sync with it.
 */

import {
  loadCalendarLayerFilters,
  saveCalendarLayerFilters,
} from '../storage/calendarLayerFilterPreferences';
import {
  loadHolidayOverlayPreferences,
  saveHolidayOverlayPreferences,
} from '../storage/holidayOverlayPreferences';
import type { HolidayCategoryId } from '../types/holidayOverlay';

/**
 * Storage dependencies, injectable for testing. Defaults to the real
 * AsyncStorage-backed helpers used everywhere else in the app.
 */
export type PersistImportHolidaySelectionDeps = {
  loadHolidayOverlayPreferences: typeof loadHolidayOverlayPreferences;
  saveHolidayOverlayPreferences: typeof saveHolidayOverlayPreferences;
  loadCalendarLayerFilters: typeof loadCalendarLayerFilters;
  saveCalendarLayerFilters: typeof saveCalendarLayerFilters;
};

const defaultDeps: PersistImportHolidaySelectionDeps = {
  loadHolidayOverlayPreferences,
  saveHolidayOverlayPreferences,
  loadCalendarLayerFilters,
  saveCalendarLayerFilters,
};

/**
 * Persists the holiday-category selection chosen during the import flow's
 * "holidays" step, applying the identical zero↔non-zero showHolidays sync
 * rule as the standalone holiday-overlay settings screen.
 *
 * Never throws. Returns `true` only when every write succeeded; `false`
 * when any write failed (the caller should then show a non-blocking
 * warning — the Google import itself must remain successful either way).
 */
export async function persistImportHolidaySelection(
  selectedHolidayCategories: ReadonlySet<HolidayCategoryId>,
  deps: PersistImportHolidaySelectionDeps = defaultDeps
): Promise<boolean> {
  try {
    const existingPrefs = await deps.loadHolidayOverlayPreferences();
    const prevCount = existingPrefs.enabledCategories.length;
    const newCount = selectedHolidayCategories.size;

    let succeeded = await deps.saveHolidayOverlayPreferences({
      enabledCategories: Array.from(selectedHolidayCategories),
    });

    if (prevCount === 0 && newCount > 0) {
      const existingFilters = await deps.loadCalendarLayerFilters();
      const filtersSucceeded = await deps.saveCalendarLayerFilters({
        ...existingFilters,
        showHolidays: true,
      });
      succeeded = succeeded && filtersSucceeded;
    } else if (prevCount > 0 && newCount === 0) {
      const existingFilters = await deps.loadCalendarLayerFilters();
      const filtersSucceeded = await deps.saveCalendarLayerFilters({
        ...existingFilters,
        showHolidays: false,
      });
      succeeded = succeeded && filtersSucceeded;
    }

    return succeeded;
  } catch {
    // Defensive: even an unexpected thrown error must never propagate to
    // the caller — the Google import must never be affected by this.
    return false;
  }
}
