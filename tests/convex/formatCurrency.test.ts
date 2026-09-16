/**
 * InYomi Together paywall — formatCurrency (lib/formatCurrency.ts)
 *
 * This helper is used ONLY for computed values (e.g. annual intro price / 12
 * for the monthly-equivalent display). Store-provided formatted strings are
 * always preferred and used directly where available.
 *
 * Run with: bun test tests/convex/formatCurrency.test.ts
 */

import { describe, expect, it } from 'bun:test';

import { formatCurrency } from '../../lib/formatCurrency';

// he-IL currency formatting includes RTL bidi control characters (U+200F)
// around the amount/symbol — expected ICU behavior, not a formatting bug.
// Strip them so assertions focus on the digits/symbol, matching what the
// screen actually renders (bidi marks are invisible to the user).
function stripBidiMarks(value: string): string {
  return value.replace(/[\u200e\u200f]/g, '');
}

describe('formatCurrency — exactly 2 fractional digits', () => {
  it('259 / 12 in ILS rounds to 21.58, not 21.60', () => {
    const monthlyEquivalent = 259 / 12; // 21.5833...
    const result = stripBidiMarks(
      formatCurrency(monthlyEquivalent, 'ILS', 'he-IL')
    );
    expect(result).toContain('21.58');
    expect(result).toContain('₪');
    expect(result).not.toContain('21.60');
    expect(result).not.toContain('21.6 ');
  });

  it('formats a whole number with 2 fractional digits', () => {
    const result = stripBidiMarks(formatCurrency(30, 'ILS', 'he-IL'));
    expect(result).toContain('30.00');
    expect(result).toContain('₪');
  });

  it('formats USD with an explicit locale', () => {
    expect(formatCurrency(21.58, 'USD', 'en-US')).toBe('$21.58');
  });
});

describe('formatCurrency — locale override vs device-locale fallback', () => {
  it('accepts an explicit BCP 47 locale', () => {
    const result = formatCurrency(21.583333, 'ILS', 'he-IL');
    expect(result).toContain('21.58');
  });

  it('falls back to the device/runtime default locale when omitted', () => {
    // Should not throw — Intl.NumberFormat(undefined, ...) is valid and
    // uses the current runtime's default locale.
    expect(() => formatCurrency(21.583333, 'ILS')).not.toThrow();
  });
});
