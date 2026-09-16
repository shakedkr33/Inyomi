// ============================================================================
// Discount percentage calculation — pure helper
// ============================================================================
//
// Computes the intro-vs-regular discount percentage dynamically from actual
// store prices, instead of hardcoding "30%" in the paywall UI. Returns null
// when the inputs cannot produce a meaningful discount (e.g. regular price
// is zero, or intro price is not strictly less than regular price) so the
// caller can hide the discount badge rather than show a misleading value.

/**
 * @param introPrice   Numeric intro/launch price (e.g. 259 for an annual
 *                      launch offer).
 * @param regularPrice Numeric regular price (e.g. 369.9).
 * @returns             Rounded whole-number discount percentage, or null if
 *                      not computable (invalid inputs, or intro >= regular).
 */
export function calculateDiscountPercent(
  introPrice: number,
  regularPrice: number
): number | null {
  if (
    !Number.isFinite(introPrice) ||
    !Number.isFinite(regularPrice) ||
    regularPrice <= 0 ||
    introPrice < 0 ||
    introPrice >= regularPrice
  ) {
    return null;
  }

  return Math.round((1 - introPrice / regularPrice) * 100);
}
