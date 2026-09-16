// ============================================================================
// Centralized currency formatter for COMPUTED prices — pure helper
// ============================================================================
//
// This module is ONLY for values the app computes itself (e.g. an annual
// intro price divided by 12 to show a monthly equivalent). Store-provided
// formatted strings (StoreProduct.priceString, PricingPhase.price.formatted,
// etc.) must always be used directly when available — they already reflect
// the exact locale/format the store account uses.
//
// The `locale` parameter is optional and currently unused by any caller
// (device locale fallback via `Intl.NumberFormat(undefined, ...)`). It
// exists so that a future app-level locale selection can be threaded
// through to this helper without any changes to the paywall screen itself.

/**
 * Format a numeric amount as a currency string using Intl.NumberFormat.
 *
 * @param amount       Numeric value, e.g. 21.583333 (259 / 12).
 * @param currencyCode ISO 4217 currency code, e.g. 'ILS', 'USD'.
 * @param locale       Optional BCP 47 locale, e.g. 'he-IL'. Falls back to
 *                      the device/runtime default locale when omitted.
 * @returns             Formatted string with exactly 2 fractional digits,
 *                      e.g. "₪21.58".
 */
export function formatCurrency(
  amount: number,
  currencyCode: string,
  locale?: string
): string {
  return new Intl.NumberFormat(locale ?? undefined, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
