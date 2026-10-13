/**
 * Security Wave 2A — P2-H03: Apple Review authentication bypass.
 *
 * AUDIT FINDING: the verify screen (app/(auth)/verify.tsx) previously
 * decided whether to call the 'apple-review' Convex Auth provider by
 * hardcoding BOTH the Apple Review demo phone number AND its fixed OTP
 * (`phone === '+972510000000' && digits === '123456'`) directly in shipped
 * client code. Since convex/auth.ts validates that SAME fixed phone+OTP
 * pair against its APP_REVIEW_PHONE / APP_REVIEW_OTP env vars, anyone who
 * inspected the JS bundle could read the OTP and authenticate as the
 * Apple Review demo account.
 *
 * FIX: lib/services/appleReviewAuth.ts's shouldUseAppleReviewProvider()
 * decides routing from the phone number ONLY. The OTP is never referenced
 * anywhere in client code — the server (convex/auth.ts) is the only party
 * that knows/validates it.
 *
 * This repo has no Convex mutation/query test harness (see
 * tests/convex/usersAccessControlWave1.test.ts's documented precedent).
 * These regression guards verify via source inspection of the REAL
 * app/(auth)/verify.tsx, lib/services/appleReviewAuth.ts and convex/auth.ts
 * files, plus behavioral tests of the extracted pure routing function.
 *
 * Run with: bun test tests/convex/appleReviewAuthSecurity.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  APPLE_REVIEW_PHONE,
  shouldUseAppleReviewProvider,
} from '../../lib/services/appleReviewAuth';

const VERIFY_SCREEN_SOURCE = readFileSync(
  new URL('../../app/(auth)/verify.tsx', import.meta.url),
  'utf8'
);
const AUTH_SERVER_SOURCE = readFileSync(
  new URL('../../convex/auth.ts', import.meta.url),
  'utf8'
);
const APPLE_REVIEW_AUTH_HELPER_SOURCE = readFileSync(
  new URL('../../lib/services/appleReviewAuth.ts', import.meta.url),
  'utf8'
);

// The real fixed Apple Review OTP used in this project's Convex environment
// (APP_REVIEW_OTP). This value is ONLY used here, inside the test file, to
// prove it does NOT appear in any shipped client source file — it is never
// asserted as a "correct" value and is never sent to the server by these
// tests.
const REAL_REVIEW_OTP_FOR_STATIC_CHECK_ONLY = '123456';

describe('P2-H03 — Apple Review OTP is not embedded in client code', () => {
  it('the verify screen no longer hardcodes the review OTP digits', () => {
    expect(VERIFY_SCREEN_SOURCE).not.toContain(
      REAL_REVIEW_OTP_FOR_STATIC_CHECK_ONLY
    );
  });

  it('the verify screen no longer inlines the review-phone + OTP pair check', () => {
    expect(VERIFY_SCREEN_SOURCE).not.toMatch(/digits\s*===\s*['"]123456['"]/);
  });

  it('the verify screen delegates provider routing to shouldUseAppleReviewProvider', () => {
    expect(VERIFY_SCREEN_SOURCE).toContain('shouldUseAppleReviewProvider');
    expect(VERIFY_SCREEN_SOURCE).toMatch(
      /shouldUseAppleReviewProvider\(phone\)/
    );
  });

  it('the extracted routing helper takes no code/OTP parameter at all', () => {
    // Guards against a future regression that adds a `code` parameter back
    // into the routing decision, which would require embedding the OTP
    // again to make the check meaningful.
    expect(shouldUseAppleReviewProvider.length).toBe(1);
    expect(APPLE_REVIEW_AUTH_HELPER_SOURCE).not.toMatch(
      /shouldUseAppleReviewProvider\([^)]*code/i
    );
  });

  it('the routing helper source itself contains no OTP literal', () => {
    expect(APPLE_REVIEW_AUTH_HELPER_SOURCE).not.toContain(
      REAL_REVIEW_OTP_FOR_STATIC_CHECK_ONLY
    );
  });
});

describe('P2-H03 — shouldUseAppleReviewProvider behavior', () => {
  it('returns true only for the exact Apple Review demo phone number', () => {
    expect(shouldUseAppleReviewProvider(APPLE_REVIEW_PHONE)).toBe(true);
  });

  it('returns false for any other phone number, regardless of shape', () => {
    expect(shouldUseAppleReviewProvider('+972501234567')).toBe(false);
    expect(shouldUseAppleReviewProvider('+972510000001')).toBe(false);
    expect(shouldUseAppleReviewProvider('')).toBe(false);
  });

  it('returns false for null/undefined (e.g. deep-link reload before phone param resolves)', () => {
    expect(shouldUseAppleReviewProvider(null)).toBe(false);
    expect(shouldUseAppleReviewProvider(undefined)).toBe(false);
  });

  it('knowing the review phone number alone selects the provider but does NOT authenticate — the server still requires the correct OTP', () => {
    // This test documents the security property, it does not call any
    // server code: shouldUseAppleReviewProvider only decides WHICH Convex
    // Auth provider signIn() is called with. The 'apple-review' provider's
    // authorize() in convex/auth.ts independently compares the submitted
    // code against process.env.APP_REVIEW_OTP and returns null (auth
    // failure) on any mismatch — see the next describe block.
    expect(shouldUseAppleReviewProvider(APPLE_REVIEW_PHONE)).toBe(true);
  });
});

describe('P2-H03 — server-side review authentication remains real and fails closed', () => {
  it('the apple-review provider still independently validates phone AND code against server env vars', () => {
    expect(AUTH_SERVER_SOURCE).toMatch(
      /phone\s*!==\s*reviewEnv\.phone\s*\|\|\s*code\s*!==\s*reviewEnv\.otp/
    );
  });

  it('review authentication fails closed (returns null) when APP_REVIEW_PHONE/APP_REVIEW_OTP env vars are absent', () => {
    expect(AUTH_SERVER_SOURCE).toMatch(
      /if\s*\(!reviewEnv\)\s*\{\s*return null;/
    );
  });

  it('the review OTP/phone env vars are never read from client-visible EXPO_PUBLIC_* variables', () => {
    // APP_REVIEW_PHONE / APP_REVIEW_OTP must be plain Convex backend env
    // vars (server-only), never EXPO_PUBLIC_-prefixed (which would bundle
    // them into the client).
    expect(AUTH_SERVER_SOURCE).toContain('process.env.APP_REVIEW_PHONE');
    expect(AUTH_SERVER_SOURCE).toContain('process.env.APP_REVIEW_OTP');
    expect(AUTH_SERVER_SOURCE).not.toContain('EXPO_PUBLIC_APP_REVIEW');
  });

  it('the Apple Review demo user is created/kept as a normal, non-admin user', () => {
    const reviewUserSource = readFileSync(
      new URL('../../convex/appleReviewAuth.ts', import.meta.url),
      'utf8'
    );
    // Must never hardcode role: 'admin' for the review account.
    expect(reviewUserSource).not.toMatch(/role:\s*['"]admin['"]/);
  });
});

describe('P2-H03 — normal phone authentication is unchanged', () => {
  it('the verify screen still calls the real "phone" provider for every non-review phone number', () => {
    expect(VERIFY_SCREEN_SOURCE).toMatch(
      /signIn\(isAppleReviewLogin \? 'apple-review' : 'phone'/
    );
  });
});
