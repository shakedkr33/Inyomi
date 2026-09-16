// ============================================================================
// RevenueCat identity readiness — pure logic (no React / RN / RC SDK imports)
// ============================================================================
//
// These are pure predicates used by contexts/RevenueCatContext.tsx to decide:
//   1. Whether the RevenueCat SDK identity currently matches the authenticated
//      Convex user (isRevenueCatIdentityReady).
//   2. Whether an async CustomerInfo update-listener callback is still valid
//      for the identity/generation it was registered under
//      (shouldApplyCustomerInfo).
//   3. Whether the RevenueCat context should report isLoading = true
//      (computeRevenueCatIsLoading).
//
// Kept dependency-free and framework-free so they can be unit tested directly
// with bun test, and so the identity/race logic has a single source of truth
// shared between the render path, the async logIn path, and the listener path.

/**
 * Returns true only when the RevenueCat SDK identity is fully resolved AND
 * matches the currently authenticated Convex user for the current identity
 * generation.
 *
 * All four conditions must hold:
 *   1. convexUserId is a resolved, authenticated string (not undefined/null).
 *   2. activeRevenueCatUserId (the user a successful logIn() resolved to)
 *      equals convexUserId exactly — guards the A -> B render window where
 *      convexUserId is already B but the effect clearing A's state hasn't
 *      run yet.
 *   3. activeListenerGeneration > 0 — a listener has actually been registered
 *      for some identity (0 means "no successful logIn has completed yet").
 *   4. identityGeneration === activeListenerGeneration — no newer identity
 *      transition has started since the listener was registered.
 */
export function isRevenueCatIdentityReady(input: {
  convexUserId: string | null | undefined;
  activeRevenueCatUserId: string | null;
  activeListenerGeneration: number;
  identityGeneration: number;
}): boolean {
  const {
    convexUserId,
    activeRevenueCatUserId,
    activeListenerGeneration,
    identityGeneration,
  } = input;

  return (
    typeof convexUserId === 'string' &&
    activeRevenueCatUserId === convexUserId &&
    activeListenerGeneration > 0 &&
    identityGeneration === activeListenerGeneration
  );
}

/**
 * Returns true only when a CustomerInfo update-listener callback — closed
 * over the user/generation it was registered under — is still valid to
 * apply to state.
 *
 * All four conditions must hold:
 *   1. The current active RevenueCat user still matches the user the
 *      listener was registered for.
 *   2. The current identity generation still matches the generation the
 *      listener was registered for (no newer transition has started).
 *   3. The current listener generation still matches too (a new listener
 *      hasn't since replaced this one for the same user).
 *   4. The registered generation is non-zero (a generation of 0 means "no
 *      identity has ever been resolved" and must never apply state).
 */
export function shouldApplyCustomerInfo(input: {
  closedUserId: string;
  closedGeneration: number;
  currentActiveUserId: string | null;
  currentIdentityGeneration: number;
  currentListenerGeneration: number;
}): boolean {
  const {
    closedUserId,
    closedGeneration,
    currentActiveUserId,
    currentIdentityGeneration,
    currentListenerGeneration,
  } = input;

  return (
    currentActiveUserId === closedUserId &&
    currentIdentityGeneration === closedGeneration &&
    currentListenerGeneration === closedGeneration &&
    closedGeneration > 0
  );
}

/**
 * Computes the RevenueCat context's isLoading value for the real-SDK path.
 *
 * Evaluated in order:
 *   1. sdkMode === "unavailable"       -> false (never wait for a configure
 *      that will not happen).
 *   2. convexUserId === undefined      -> true (auth/user identity is still
 *      resolving; nothing else can be decided yet).
 *   3. convexUserId === null           -> false (signed out — there is no
 *      identity to wait for).
 *   4. isIdentityReady === true        -> false (identity fully resolved).
 *   5. failedForUserId === convexUserId -> false (safe fallback: logIn has
 *      already failed for this exact user; stop showing a loading spinner
 *      so the app can fall back to its existing trial/free behavior).
 *   6. otherwise                       -> true (still configuring / still
 *      syncing identity for the current user).
 */
/**
 * Authoritative "is this async identity-sensitive operation still allowed to
 * write state" check, used AFTER every await boundary inside
 * contexts/RevenueCatContext.tsx's identity-sensitive async paths
 * (updateCustomerData, applyResolvedIdentity's post-updateCustomerData /
 * post-import checks, etc).
 *
 * `currentGeneration` must come from `identityGenerationRef.current` (a ref,
 * never React state) — the ref is bumped synchronously and immediately by
 * the identity-transition effect on every convexUserId/sdkMode change and on
 * unmount/cleanup, so it is the only value guaranteed to already reflect a
 * transition that started while this operation's earlier await was pending.
 *
 * A generation mismatch alone is sufficient to reject a stale operation:
 * the identity-transition effect unconditionally increments the generation
 * on EVERY transition, including same-user re-logins (foreground retry) and
 * different-user switches, so no separate userId comparison is needed here.
 */
export function isIdentityGenerationCurrent(input: {
  expectedGeneration: number;
  currentGeneration: number;
}): boolean {
  return input.currentGeneration === input.expectedGeneration;
}

export function computeRevenueCatIsLoading(input: {
  sdkMode: 'configuring' | 'configured' | 'unavailable';
  convexUserId: string | null | undefined;
  isIdentityReady: boolean;
  failedForUserId: string | null;
}): boolean {
  const { sdkMode, convexUserId, isIdentityReady, failedForUserId } = input;

  if (sdkMode === 'unavailable') {
    return false;
  }
  if (convexUserId === undefined) {
    return true;
  }
  if (convexUserId === null) {
    return false;
  }
  if (isIdentityReady) {
    return false;
  }
  if (failedForUserId === convexUserId) {
    return false;
  }
  return true;
}
