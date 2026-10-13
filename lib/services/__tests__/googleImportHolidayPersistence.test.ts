/**
 * googleImportHolidayPersistence.test.ts
 *
 * Tests the real production helper `persistImportHolidaySelection`
 * (lib/services/googleImportHolidayPersistence.ts) that the Google
 * Calendar import screen (app/(authenticated)/import-calendar.tsx) calls
 * after a successful import to persist the user's InYomi holiday-category
 * selection.
 *
 * Storage dependencies are injected as fakes (no AsyncStorage mocking
 * required) so these tests exercise the exact real orchestration logic —
 * load → save preferences → conditionally sync the "showHolidays" calendar
 * layer filter — while fully controlling success/failure of each write.
 *
 * Also covers the import-success/import-failure sequencing contract that
 * the import screen's handleImport relies on: holiday-preference
 * persistence must only ever be attempted AFTER a successful Google
 * import, exactly once, and its outcome must never turn a successful
 * import into a failure.
 *
 * Run with: bun test lib/services/__tests__/googleImportHolidayPersistence.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { CalendarLayerFilters } from '../../storage/calendarLayerFilterPreferences';
import { DEFAULT_CALENDAR_LAYER_FILTERS } from '../../storage/calendarLayerFilterPreferences';
import type { HolidayOverlayPreferences } from '../../storage/holidayOverlayPreferences';
import type { HolidayCategoryId } from '../../types/holidayOverlay';
import {
  type PersistImportHolidaySelectionDeps,
  persistImportHolidaySelection,
} from '../googleImportHolidayPersistence';

// ── Fake dependency builders ────────────────────────────────────────────────────

type FakeDepsOptions = {
  existingCategories?: HolidayCategoryId[];
  existingFilters?: CalendarLayerFilters;
  saveHolidayPrefsSucceeds?: boolean;
  saveFiltersSucceeds?: boolean;
};

/** Records every call made to the injected save/load functions, in order. */
function makeFakeDeps(options: FakeDepsOptions = {}): {
  deps: PersistImportHolidaySelectionDeps;
  calls: string[];
  savedPrefs: HolidayOverlayPreferences[];
  savedFilters: CalendarLayerFilters[];
} {
  const calls: string[] = [];
  const savedPrefs: HolidayOverlayPreferences[] = [];
  const savedFilters: CalendarLayerFilters[] = [];

  const deps: PersistImportHolidaySelectionDeps = {
    loadHolidayOverlayPreferences: async () => {
      calls.push('loadHolidayOverlayPreferences');
      return {
        enabledCategories: options.existingCategories ?? [],
      };
    },
    saveHolidayOverlayPreferences: async (prefs) => {
      calls.push('saveHolidayOverlayPreferences');
      savedPrefs.push(prefs);
      return options.saveHolidayPrefsSucceeds ?? true;
    },
    loadCalendarLayerFilters: async () => {
      calls.push('loadCalendarLayerFilters');
      return options.existingFilters ?? { ...DEFAULT_CALENDAR_LAYER_FILTERS };
    },
    saveCalendarLayerFilters: async (filters) => {
      calls.push('saveCalendarLayerFilters');
      savedFilters.push(filters);
      return options.saveFiltersSucceeds ?? true;
    },
  };

  return { deps, calls, savedPrefs, savedFilters };
}

// ── Success paths ────────────────────────────────────────────────────────────────

describe('persistImportHolidaySelection — success paths', () => {
  it('returns true when preferences save succeeds and no boundary crossed (0 → 0)', async () => {
    const { deps, calls } = makeFakeDeps({ existingCategories: [] });
    const result = await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(),
      deps
    );
    expect(result).toBe(true);
    // No boundary crossed (stayed at 0) → calendar-layer sync must not run.
    expect(calls).not.toContain('saveCalendarLayerFilters');
    expect(calls).not.toContain('loadCalendarLayerFilters');
  });

  it('returns true and syncs showHolidays=true on the 0 → non-zero boundary', async () => {
    const { deps, savedFilters, calls } = makeFakeDeps({
      existingCategories: [],
    });
    const result = await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps
    );
    expect(result).toBe(true);
    expect(calls).toContain('saveCalendarLayerFilters');
    expect(savedFilters).toHaveLength(1);
    expect(savedFilters[0].showHolidays).toBe(true);
  });

  it('returns true and syncs showHolidays=false on the non-zero → 0 boundary', async () => {
    const { deps, savedFilters } = makeFakeDeps({
      existingCategories: ['jewish_holidays'],
    });
    const result = await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(),
      deps
    );
    expect(result).toBe(true);
    expect(savedFilters).toHaveLength(1);
    expect(savedFilters[0].showHolidays).toBe(false);
  });

  it('does NOT touch the calendar-layer filter when staying non-zero → non-zero', async () => {
    const { deps, calls } = makeFakeDeps({
      existingCategories: ['jewish_holidays'],
    });
    const result = await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(['fast_days']),
      deps
    );
    expect(result).toBe(true);
    expect(calls).not.toContain('saveCalendarLayerFilters');
  });

  it('persists the exact selected category set', async () => {
    const { deps, savedPrefs } = makeFakeDeps({ existingCategories: [] });
    await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(['jewish_holidays', 'fast_days']),
      deps
    );
    expect(savedPrefs).toHaveLength(1);
    expect(new Set(savedPrefs[0].enabledCategories)).toEqual(
      new Set<HolidayCategoryId>(['jewish_holidays', 'fast_days'])
    );
  });

  it('calls load before save (correct internal ordering)', async () => {
    const { deps, calls } = makeFakeDeps({ existingCategories: [] });
    await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps
    );
    expect(calls.indexOf('loadHolidayOverlayPreferences')).toBeLessThan(
      calls.indexOf('saveHolidayOverlayPreferences')
    );
    expect(calls.indexOf('saveHolidayOverlayPreferences')).toBeLessThan(
      calls.indexOf('loadCalendarLayerFilters')
    );
  });
});

// ── Failure paths ────────────────────────────────────────────────────────────────

describe('persistImportHolidaySelection — failure paths', () => {
  it('returns false when saveHolidayOverlayPreferences fails, even with no boundary crossed', async () => {
    const { deps } = makeFakeDeps({
      existingCategories: ['jewish_holidays'],
      saveHolidayPrefsSucceeds: false,
    });
    const result = await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(['fast_days']),
      deps
    );
    expect(result).toBe(false);
  });

  it('returns false when the boundary-sync calendar-layer save fails', async () => {
    const { deps } = makeFakeDeps({
      existingCategories: [],
      saveFiltersSucceeds: false,
    });
    const result = await persistImportHolidaySelection(
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps
    );
    expect(result).toBe(false);
  });

  it('never throws even if a dependency throws unexpectedly', async () => {
    const throwingDeps: PersistImportHolidaySelectionDeps = {
      loadHolidayOverlayPreferences: async () => {
        throw new Error('unexpected storage error');
      },
      saveHolidayOverlayPreferences: async () => true,
      loadCalendarLayerFilters: async () => ({
        ...DEFAULT_CALENDAR_LAYER_FILTERS,
      }),
      saveCalendarLayerFilters: async () => true,
    };
    let result: boolean | undefined;
    let threw = false;
    try {
      result = await persistImportHolidaySelection(
        new Set<HolidayCategoryId>(['jewish_holidays']),
        throwingDeps
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBe(false);
  });

  it('does not log the actual error object or any PII on failure (defensive contract)', () => {
    // The implementation uses a bare `catch {}` with no logging at all —
    // verified by source inspection since there is nothing to invoke.
    const source = readFileSync(
      new URL('../googleImportHolidayPersistence.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/console\.(log|warn|error)/);
  });
});

// ── Import-success / import-failure sequencing contract ────────────────────────
// Mirrors the exact try/catch sequencing in
// app/(authenticated)/import-calendar.tsx's handleImport: the Google import
// mutation runs first; holiday-preference persistence is only attempted
// after it resolves successfully, exactly once, and its outcome can never
// convert a successful import into an error state.

type ImportRunResult = {
  stage: 'success' | 'error';
  holidayPreferenceWarning: boolean;
  persistCallCount: number;
  callOrder: string[];
};

async function runImportThenPersist(
  runImportMutation: () => Promise<void>,
  selectedHolidayCategories: ReadonlySet<HolidayCategoryId>,
  deps: PersistImportHolidaySelectionDeps,
  callOrder: string[]
): Promise<ImportRunResult> {
  try {
    await runImportMutation();
  } catch {
    // Mirrors handleImport's catch block: on import failure, holiday
    // preference persistence must never be attempted.
    return {
      stage: 'error',
      holidayPreferenceWarning: false,
      persistCallCount: 0,
      callOrder,
    };
  }
  const persisted = await persistImportHolidaySelection(
    selectedHolidayCategories,
    deps
  );
  callOrder.push('persist');
  return {
    stage: 'success',
    holidayPreferenceWarning: !persisted,
    persistCallCount: 1,
    callOrder,
  };
}

describe('import → persist sequencing contract', () => {
  it('import success + preference success → success stage, no warning', async () => {
    const { deps } = makeFakeDeps({ existingCategories: [] });
    const callOrder: string[] = [];
    const result = await runImportThenPersist(
      async () => {
        callOrder.push('import');
      },
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps,
      callOrder
    );
    expect(result.stage).toBe('success');
    expect(result.holidayPreferenceWarning).toBe(false);
    expect(result.persistCallCount).toBe(1);
    expect(callOrder).toEqual(['import', 'persist']);
  });

  it('import success + preference failure → import remains successful, warning is set (not an error)', async () => {
    const { deps } = makeFakeDeps({
      existingCategories: [],
      saveHolidayPrefsSucceeds: false,
    });
    const callOrder: string[] = [];
    const result = await runImportThenPersist(
      async () => {
        callOrder.push('import');
      },
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps,
      callOrder
    );
    expect(result.stage).toBe('success');
    expect(result.holidayPreferenceWarning).toBe(true);
    expect(result.persistCallCount).toBe(1);
  });

  it('import failure → error stage, holiday-preference persistence is never attempted', async () => {
    const { deps, calls } = makeFakeDeps({ existingCategories: [] });
    const callOrder: string[] = [];
    const result = await runImportThenPersist(
      async () => {
        callOrder.push('import');
        throw new Error('network error');
      },
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps,
      callOrder
    );
    expect(result.stage).toBe('error');
    expect(result.holidayPreferenceWarning).toBe(false);
    expect(result.persistCallCount).toBe(0);
    expect(calls).toEqual([]);
    expect(callOrder).toEqual(['import']);
  });

  it('holiday preferences are NOT saved before the import mutation resolves', async () => {
    const { deps, calls } = makeFakeDeps({ existingCategories: [] });
    const callOrder: string[] = [];
    await runImportThenPersist(
      async () => {
        // Import "resolves" only after this callback returns; persistence
        // must not have happened by this point.
        expect(calls).toEqual([]);
        callOrder.push('import');
      },
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps,
      callOrder
    );
    expect(callOrder).toEqual(['import', 'persist']);
  });

  it('no duplicate persistence attempts occur for a single import run', async () => {
    const { deps } = makeFakeDeps({ existingCategories: [] });
    const callOrder: string[] = [];
    const result = await runImportThenPersist(
      async () => {
        callOrder.push('import');
      },
      new Set<HolidayCategoryId>(['jewish_holidays']),
      deps,
      callOrder
    );
    expect(result.persistCallCount).toBe(1);
    expect(callOrder.filter((c) => c === 'persist')).toHaveLength(1);
  });
});

// ── Normal back/forward navigation never persists preferences ──────────────────
// Structural guard: persistImportHolidaySelection (and therefore any
// storage write) must only be reachable from the import screen's
// handleImport — not from stage navigation (setStage calls used by the
// "שינוי" edit links / back links throughout the flow).

describe('normal back/forward navigation does not persist preferences (structural guard)', () => {
  it('the import screen calls persistHolidaySelection only inside handleImport, never from setStage/back-navigation call sites', () => {
    const source = readFileSync(
      new URL(
        '../../../app/(authenticated)/import-calendar.tsx',
        import.meta.url
      ),
      'utf8'
    );
    const occurrences = source.split('persistHolidaySelection(').length - 1;
    // Exactly one call site: inside handleImport. (Additional occurrences of
    // the identifier itself — definition, dependency array — do not include
    // the trailing "(" call syntax.)
    expect(occurrences).toBe(1);

    const callIdx = source.indexOf('persistHolidaySelection()');
    expect(callIdx).toBeGreaterThan(-1);
    const handleImportIdx = source.indexOf('const handleImport');
    expect(handleImportIdx).toBeGreaterThan(-1);
    expect(handleImportIdx).toBeLessThan(callIdx);
    const precedingContext = source.slice(handleImportIdx, callIdx);
    // No setStage/back-navigation call occurs between the start of
    // handleImport and the persistHolidaySelection() call — only the
    // import mutation itself runs first.
    expect(precedingContext).toContain('await importMutation(');
    expect(precedingContext).not.toContain('setStage(');
  });
});
