import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@inyomi/calendar-layer-filter-preferences:v1';

export type CalendarLayerFilters = {
  showCommunity: boolean;
  showTasks: boolean;
  showHolidays: boolean;
  showShabbatTimes: boolean;
};

/**
 * Default filters applied only when no valid saved preference exists.
 * - Community and tasks are ON by default.
 * - Holidays and Shabbat times are OFF (features not yet available).
 */
export const DEFAULT_CALENDAR_LAYER_FILTERS: CalendarLayerFilters = {
  showCommunity: true,
  showTasks: true,
  showHolidays: false,
  showShabbatTimes: false,
};

/**
 * FIX 9: "הצג הכל" — sets ALL layer filters to ON.
 * NOT the same as DEFAULT (which has showHolidays: false).
 * This genuinely shows all available calendar content.
 */
export const SHOW_ALL_CALENDAR_LAYER_FILTERS: CalendarLayerFilters = {
  showCommunity: true,
  showTasks: true,
  showHolidays: true,
  showShabbatTimes: true,
};

/**
 * Load persisted calendar layer filter preferences.
 * Falls back to defaults if storage is empty, missing, or malformed.
 * Never throws — storage failure returns defaults safely.
 */
export async function loadCalendarLayerFilters(): Promise<CalendarLayerFilters> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CALENDAR_LAYER_FILTERS };

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_CALENDAR_LAYER_FILTERS };
    }

    const p = parsed as Record<string, unknown>;
    return {
      showCommunity:
        typeof p.showCommunity === 'boolean'
          ? p.showCommunity
          : DEFAULT_CALENDAR_LAYER_FILTERS.showCommunity,
      showTasks:
        typeof p.showTasks === 'boolean'
          ? p.showTasks
          : DEFAULT_CALENDAR_LAYER_FILTERS.showTasks,
      showHolidays:
        typeof p.showHolidays === 'boolean'
          ? p.showHolidays
          : DEFAULT_CALENDAR_LAYER_FILTERS.showHolidays,
      showShabbatTimes:
        typeof p.showShabbatTimes === 'boolean'
          ? p.showShabbatTimes
          : DEFAULT_CALENDAR_LAYER_FILTERS.showShabbatTimes,
    };
  } catch {
    return { ...DEFAULT_CALENDAR_LAYER_FILTERS };
  }
}

/**
 * Persist calendar layer filter preferences immediately.
 * Never throws — storage failure is silently ignored.
 */
export async function saveCalendarLayerFilters(
  filters: CalendarLayerFilters
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Storage write failure must never crash the calendar
  }
}
