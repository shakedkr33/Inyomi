// ============================================================================
// rcIdentityReadyGuard.test.ts — pure-logic tests for RevenueCat identity guard
// ============================================================================
// Imports ONLY lib/revenuecat/identityReady.ts. No React, React Native,
// RevenueCat SDK, or context imports, and no mocking framework — these are
// plain pure-function tests.

import { describe, expect, it } from 'bun:test';
import {
  computeRevenueCatIsLoading,
  isIdentityGenerationCurrent,
  isRevenueCatIdentityReady,
  shouldApplyCustomerInfo,
} from '@/lib/revenuecat/identityReady';

describe('isRevenueCatIdentityReady', () => {
  it('1. Initial state (nothing resolved yet) is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: undefined,
        activeRevenueCatUserId: null,
        activeListenerGeneration: 0,
        identityGeneration: 0,
      })
    ).toBe(false);
  });

  it('2. Auth re-resolving with stale A identity state is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: undefined,
        activeRevenueCatUserId: 'A',
        activeListenerGeneration: 1,
        identityGeneration: 1,
      })
    ).toBe(false);
  });

  it('3. A logIn in flight (not yet resolved) is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'A',
        activeRevenueCatUserId: null,
        activeListenerGeneration: 0,
        identityGeneration: 1,
      })
    ).toBe(false);
  });

  it('4. A resolved (logIn succeeded, listener registered) is ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'A',
        activeRevenueCatUserId: 'A',
        activeListenerGeneration: 1,
        identityGeneration: 1,
      })
    ).toBe(true);
  });

  it('5. Render window: convexUserId already B but A state still present is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'B',
        activeRevenueCatUserId: 'A',
        activeListenerGeneration: 1,
        identityGeneration: 1,
      })
    ).toBe(false);
  });

  it('6. Signed out with stale A identity state is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: null,
        activeRevenueCatUserId: 'A',
        activeListenerGeneration: 1,
        identityGeneration: 1,
      })
    ).toBe(false);
  });

  it('7. B logIn in flight is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'B',
        activeRevenueCatUserId: null,
        activeListenerGeneration: 0,
        identityGeneration: 2,
      })
    ).toBe(false);
  });

  it('8. B resolved is ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'B',
        activeRevenueCatUserId: 'B',
        activeListenerGeneration: 2,
        identityGeneration: 2,
      })
    ).toBe(true);
  });

  it('9. Rapid A -> B -> C with B late-resolving is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'C',
        activeRevenueCatUserId: 'B',
        activeListenerGeneration: 2,
        identityGeneration: 3,
      })
    ).toBe(false);
  });

  it('10a. Same-user re-login in flight is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'A',
        activeRevenueCatUserId: null,
        activeListenerGeneration: 0,
        identityGeneration: 3,
      })
    ).toBe(false);
  });

  it('10b. Same-user re-login resolved is ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'A',
        activeRevenueCatUserId: 'A',
        activeListenerGeneration: 3,
        identityGeneration: 3,
      })
    ).toBe(true);
  });

  it('11. Same user but generation mismatch is not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'A',
        activeRevenueCatUserId: 'A',
        activeListenerGeneration: 1,
        identityGeneration: 2,
      })
    ).toBe(false);
  });

  it('12. Zero generation with matching user is still not ready', () => {
    expect(
      isRevenueCatIdentityReady({
        convexUserId: 'A',
        activeRevenueCatUserId: 'A',
        activeListenerGeneration: 0,
        identityGeneration: 0,
      })
    ).toBe(false);
  });
});

describe('shouldApplyCustomerInfo', () => {
  it('13. Stale A callback arriving after B became current is rejected', () => {
    expect(
      shouldApplyCustomerInfo({
        closedUserId: 'A',
        closedGeneration: 1,
        currentActiveUserId: 'B',
        currentIdentityGeneration: 2,
        currentListenerGeneration: 2,
      })
    ).toBe(false);
  });

  it('14. Callback arriving after a current-generation logIn failure is rejected', () => {
    expect(
      shouldApplyCustomerInfo({
        closedUserId: 'A',
        closedGeneration: 2,
        currentActiveUserId: null,
        currentIdentityGeneration: 2,
        currentListenerGeneration: 0,
      })
    ).toBe(false);
  });

  it('15. Valid current-generation callback is accepted', () => {
    expect(
      shouldApplyCustomerInfo({
        closedUserId: 'A',
        closedGeneration: 2,
        currentActiveUserId: 'A',
        currentIdentityGeneration: 2,
        currentListenerGeneration: 2,
      })
    ).toBe(true);
  });

  it('15b. Same user but stale closed generation is rejected', () => {
    expect(
      shouldApplyCustomerInfo({
        closedUserId: 'A',
        closedGeneration: 1,
        currentActiveUserId: 'A',
        currentIdentityGeneration: 2,
        currentListenerGeneration: 2,
      })
    ).toBe(false);
  });
});

describe('computeRevenueCatIsLoading', () => {
  it('16a. SDK unavailable never loads forever', () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'unavailable',
        convexUserId: 'A',
        isIdentityReady: false,
        failedForUserId: null,
      })
    ).toBe(false);
  });

  it('16b. Auth still resolving is loading', () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'configuring',
        convexUserId: undefined,
        isIdentityReady: false,
        failedForUserId: null,
      })
    ).toBe(true);
  });

  it('16c. Signed out is not loading', () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'configured',
        convexUserId: null,
        isIdentityReady: false,
        failedForUserId: null,
      })
    ).toBe(false);
  });

  it('16d. Waiting for configure to complete is loading', () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'configuring',
        convexUserId: 'A',
        isIdentityReady: false,
        failedForUserId: null,
      })
    ).toBe(true);
  });

  it('16e. A -> B render window (identity not yet ready for B) is loading', () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'configured',
        convexUserId: 'B',
        isIdentityReady: false,
        failedForUserId: null,
      })
    ).toBe(true);
  });

  it('16f. Identity ready is never loading', () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'configured',
        convexUserId: 'A',
        isIdentityReady: true,
        failedForUserId: null,
      })
    ).toBe(false);
  });

  it('16g. logIn failure for the current user exits loading safely', () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'configured',
        convexUserId: 'A',
        isIdentityReady: false,
        failedForUserId: 'A',
      })
    ).toBe(false);
  });

  it("16h. A's failure does not suppress loading for a different current user B", () => {
    expect(
      computeRevenueCatIsLoading({
        sdkMode: 'configured',
        convexUserId: 'B',
        isIdentityReady: false,
        failedForUserId: 'A',
      })
    ).toBe(true);
  });
});

// ============================================================================
// PHASE 1 RACE CORRECTION — isIdentityGenerationCurrent
// ============================================================================
// Covers the async-generation race fix in contexts/RevenueCatContext.tsx:
// updateCustomerData and applyResolvedIdentity re-check this AFTER every
// await boundary before writing any identity-sensitive state (isPremium,
// subscriptionTier, customerData) or registering/committing a listener.
describe('isIdentityGenerationCurrent', () => {
  it('17.1. Current generation -> update allowed', () => {
    expect(
      isIdentityGenerationCurrent({
        expectedGeneration: 3,
        currentGeneration: 3,
      })
    ).toBe(true);
  });

  it('17.2. Generation changed during async work -> completion rejected', () => {
    // e.g. logIn(A) -> await getAppUserID() -> user logs out/switches to C,
    // bumping identityGenerationRef -> A's updateCustomerData resumes and
    // must discard its result rather than writing state for C's session.
    expect(
      isIdentityGenerationCurrent({
        expectedGeneration: 3,
        currentGeneration: 4,
      })
    ).toBe(false);
  });

  it('17.3. Stale generation cannot become the active listener owner', () => {
    // applyResolvedIdentity's final re-check immediately before committing
    // listenerRemovalRef / activeRevenueCatUserId / activeListenerGeneration.
    expect(
      isIdentityGenerationCurrent({
        expectedGeneration: 1,
        currentGeneration: 2,
      })
    ).toBe(false);
  });

  it('17.5. Genuinely current identity update still applies', () => {
    expect(
      isIdentityGenerationCurrent({
        expectedGeneration: 5,
        currentGeneration: 5,
      })
    ).toBe(true);
  });

  it('17.6. Previous-user generation cannot overwrite current-user customer metadata', () => {
    // A's generation (2) is superseded by C's generation (4) after an
    // A -> C account switch — A's in-flight updateCustomerData must reject.
    expect(
      isIdentityGenerationCurrent({
        expectedGeneration: 2,
        currentGeneration: 4,
      })
    ).toBe(false);
  });
});

// ============================================================================
// PHASE 1 RACE CORRECTION — combined listener entry + post-await validation
// ============================================================================
// Models the exact two-stage guard used by applyResolvedIdentity's
// identity-bound CustomerInfo listener: shouldApplyCustomerInfo validates the
// callback at ENTRY (synchronous), and isIdentityGenerationCurrent validates
// again after updateCustomerData's internal await resolves, immediately
// before any state is committed.
describe('listener callback entry-valid, generation changes before async completion', () => {
  it('17.4. Entry-valid callback whose generation goes stale during the awaited update is rejected at commit time', () => {
    const closedUserId = 'A';
    const closedGeneration = 2;

    // Entry check — valid at the moment the CustomerInfo push arrives.
    const acceptedAtEntry = shouldApplyCustomerInfo({
      closedUserId,
      closedGeneration,
      currentActiveUserId: 'A',
      currentIdentityGeneration: 2,
      currentListenerGeneration: 2,
    });
    expect(acceptedAtEntry).toBe(true);

    // While updateCustomerData's internal `await Purchases.getAppUserID()`
    // is in flight, the user logs out and switches to C — bumping the
    // generation. The post-await re-check must now reject the commit, even
    // though the callback was valid when it started.
    const stillCurrentAfterAwait = isIdentityGenerationCurrent({
      expectedGeneration: closedGeneration,
      currentGeneration: 3,
    });
    expect(stillCurrentAfterAwait).toBe(false);
  });
});
