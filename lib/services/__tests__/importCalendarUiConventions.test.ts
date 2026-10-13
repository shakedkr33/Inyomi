/**
 * importCalendarUiConventions.test.ts
 *
 * Guards for the Google Calendar import screen's UI conventions:
 *   1. RTL — no hardcoded 'row-reverse' / physical textAlign 'right'. Under
 *      native RTL (I18nManager.isRTL, iOS + Android) those render
 *      left-to-right; the repo's lib/rtl.ts helpers must be used instead.
 *   2. Design system — colors come from the shared theme tokens
 *      (theme/colors.ts); the outdated screen-specific palette is gone.
 *   3. Inclusive Hebrew — no feminine-only / masculine-only instructions.
 *   4. formatEventStartLabel — the event row date/time label.
 *
 * Source inspection is used because the screen has no component-test harness
 * (same pattern as importCalendarAccessGate.test.ts).
 *
 * Run with: bun test lib/services/__tests__/importCalendarUiConventions.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { formatEventStartLabel } from '../importFlowUtils';

const SCREEN_SOURCE = readFileSync(
  new URL('../../../app/(authenticated)/import-calendar.tsx', import.meta.url),
  'utf8'
);

// Strip comments so explanatory text never trips the guards.
const CODE = SCREEN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /^\s*\/\/.*$/gm,
  ''
);

describe('import-calendar screen — RTL conventions', () => {
  it('never hardcodes flexDirection row-reverse', () => {
    expect(CODE).not.toContain('row-reverse');
  });

  it("never hardcodes physical textAlign: 'right'", () => {
    expect(CODE).not.toMatch(/textAlign:\s*'right'/);
  });

  it('uses the shared rtl helpers for row direction and text alignment', () => {
    expect(CODE).toContain("from '@/lib/rtl'");
    expect(CODE).toContain('rtl.flexDirection');
    expect(CODE).toContain('rtl.textAlign');
  });
});

describe('import-calendar screen — design system', () => {
  it('imports the shared theme tokens', () => {
    expect(CODE).toContain("from '@/theme/colors'");
  });

  it('no longer uses the outdated screen-specific palette', () => {
    const outdated = [
      '#36a9e2', // legacy blue
      '#f0f9ff', // legacy selected tint
      '#e0f2fe',
      '#0284c7',
      '#bae6fd',
      '#0f172a',
      '#1e293b',
      '#64748b',
      '#94a3b8',
      '#cbd5e1',
      '#e2e8f0',
      '#f1f5f9',
      '#f8fafc',
      '#22c55e',
      '#fef3c7',
      '#92400e',
      '#f59e0b',
    ];
    for (const hex of outdated) {
      expect(CODE.toLowerCase()).not.toContain(hex);
    }
  });

  it('the only remaining hardcoded color is the Google brand "G" blue', () => {
    const hexes = CODE.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes.map((h) => h.toLowerCase())).toEqual(['#4285f4']);
  });
});

describe('import-calendar screen — inclusive Hebrew copy', () => {
  // Feminine-only or masculine-only imperative / address forms that were
  // (or could be) used in this flow.
  const NON_INCLUSIVE = [
    'בחרי',
    'תרצי',
    'תבחרי',
    'בדקי',
    'לחצי',
    'נסי',
    'בחר/י',
    'נסה/י',
    'דלג', // masculine imperative — "דילוג" is used instead
    'העתק ל', // masculine imperative — "העתקה ל" is used instead
    'חזור"', // masculine imperative a11y label — "חזרה" is used instead
  ];

  it('contains no feminine-only / masculine-only instructions', () => {
    for (const form of NON_INCLUSIVE) {
      expect(CODE).not.toContain(form);
    }
  });

  it('keeps the approved retry copy', () => {
    expect(CODE).toContain('ניסיון נוסף');
  });
});

describe('formatEventStartLabel', () => {
  it('formats a timed event in Asia/Jerusalem wall-clock time', () => {
    // 08:00Z in March (before Israel DST on the 27th) is 10:00 IST (UTC+2).
    expect(formatEventStartLabel('2026-03-04T08:00:00Z', false)).toBe(
      '4 במרץ · 10:00'
    );
  });

  it('applies Israel daylight time in summer', () => {
    // 07:30Z in July is 10:30 IDT (UTC+3).
    expect(formatEventStartLabel('2026-07-10T07:30:00Z', false)).toBe(
      '10 ביולי · 10:30'
    );
  });

  it('renders midnight as 00:00, not 24:00', () => {
    // 22:00Z in March is 00:00 the next day in Jerusalem (UTC+2).
    expect(formatEventStartLabel('2026-03-03T22:00:00Z', false)).toBe(
      '4 במרץ · 00:00'
    );
  });

  it('honours an explicit offset in the RFC3339 start', () => {
    expect(formatEventStartLabel('2026-03-04T10:00:00+02:00', false)).toBe(
      '4 במרץ · 10:00'
    );
  });

  it('labels all-day events by their bare date without timezone drift', () => {
    expect(formatEventStartLabel('2026-03-04', true)).toBe('4 במרץ · כל היום');
    expect(formatEventStartLabel('2026-12-31', true)).toBe(
      '31 בדצמבר · כל היום'
    );
  });

  it('returns an empty string for unparseable input instead of throwing', () => {
    expect(formatEventStartLabel('not-a-date', false)).toBe('');
    expect(formatEventStartLabel('', true)).toBe('');
  });
});
