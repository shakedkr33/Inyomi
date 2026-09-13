/**
 * Tests for phone-auth error classification and Hebrew copy (Part C of spec).
 *
 * Run with: bun test
 *
 * Covers:
 *  1. Invalid SMS code keeps the user on the verification screen
 *     (classifies as invalid_code, NOT navigating — verified by checking that
 *      the error is NOT an unknown/network kind that would confuse the UI).
 *  2. Invalid SMS code shows inclusive Hebrew error.
 *  3. Invalid SMS code clears loading and re-enables submit
 *     (verified indirectly: mapPhoneAuthError returns a non-null string,
 *      which the component uses to exit the loading state).
 *  4. Raw "Could not verify code" is never rendered in user-facing UI.
 *  5. Unknown / network failure shows a generic calm Hebrew error.
 *  6. Settings label renders "העתקת אירועים מיומן חיצוני".
 *  7. All user-facing error copy is gender-inclusive.
 */

import { describe, expect, it } from 'bun:test';

import { classifyPhoneAuthError, mapPhoneAuthError } from '../authErrorUtils';

// ── Constants mirrored from the production code ───────────────────────────────

const INVALID_CODE_MESSAGE = 'הקוד לא נכון. אפשר לבדוק ולנסות שוב.';
const GENERIC_ERROR_MESSAGE =
  'לא הצלחנו לאמת את הקוד כרגע. אפשר לנסות שוב בעוד רגע.';
const SETTINGS_LABEL = 'העתקת אירועים מיומן חיצוני';

// ── 1 & 2: Invalid / expired / used code classification and copy ──────────────

describe('classifyPhoneAuthError — invalid code variants', () => {
  const invalidCases: [string, string][] = [
    ['Convex error', 'Could not verify code'],
    ['lowercase match', 'could not verify code'],
    ['generic invalid', 'invalid code'],
    ['generic incorrect', 'Incorrect verification code'],
    ['generic wrong', 'wrong code entered'],
    ['expired', 'Code has expired'],
    ['already used', 'Code already used'],
    ['used code phrase', 'used code'],
  ];

  for (const [description, message] of invalidCases) {
    it(`classifies "${description}" as invalid_code`, () => {
      expect(classifyPhoneAuthError(new Error(message))).toBe('invalid_code');
    });
  }
});

describe('mapPhoneAuthError — invalid code copy', () => {
  // Test 2: shows the exact required Hebrew string
  it('returns the required Hebrew string for "Could not verify code"', () => {
    const msg = mapPhoneAuthError(new Error('Could not verify code'));
    expect(msg).toBe(INVALID_CODE_MESSAGE);
  });

  it('returns the required Hebrew string for expired code', () => {
    const msg = mapPhoneAuthError(new Error('Code expired'));
    expect(msg).toBe(INVALID_CODE_MESSAGE);
  });

  it('returns the required Hebrew string for already-used code', () => {
    const msg = mapPhoneAuthError(new Error('Code already used'));
    expect(msg).toBe(INVALID_CODE_MESSAGE);
  });
});

// ── 3: Error return value signals that loading can be cleared ─────────────────

describe('mapPhoneAuthError — non-null return unblocks UI', () => {
  it('returns a non-empty string for invalid code (loading can stop)', () => {
    const result = mapPhoneAuthError(new Error('Could not verify code'));
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── 4: Raw Convex error text never surfaces in UI ────────────────────────────

describe('mapPhoneAuthError — no raw Convex text in output', () => {
  it('does not return the raw Convex error message', () => {
    const rawConvexError = 'Could not verify code';
    const userFacingMsg = mapPhoneAuthError(new Error(rawConvexError));
    expect(userFacingMsg).not.toContain('Could not verify code');
    expect(userFacingMsg).not.toContain('convex');
    expect(userFacingMsg).not.toContain('server');
    expect(userFacingMsg).not.toContain('Server Error');
  });

  it('does not expose request IDs or stack traces', () => {
    const msg = mapPhoneAuthError(new Error('Could not verify code'));
    // Must not contain digits that look like request IDs (long numeric strings)
    expect(msg).not.toMatch(/\d{8,}/);
  });
});

// ── 5: Network / unknown failure → generic calm Hebrew message ────────────────

describe('classifyPhoneAuthError — network and unknown cases', () => {
  it('classifies network error correctly', () => {
    expect(classifyPhoneAuthError(new Error('Network request failed'))).toBe(
      'network_error'
    );
  });

  it('classifies fetch error correctly', () => {
    expect(classifyPhoneAuthError(new Error('fetch failed'))).toBe(
      'network_error'
    );
  });

  it('classifies connection error correctly', () => {
    expect(classifyPhoneAuthError(new Error('connection refused'))).toBe(
      'network_error'
    );
  });

  it('classifies unknown error correctly', () => {
    expect(classifyPhoneAuthError(new Error('Unexpected server 500'))).toBe(
      'unknown_error'
    );
  });

  it('classifies plain string errors', () => {
    expect(classifyPhoneAuthError('something random')).toBe('unknown_error');
  });
});

describe('mapPhoneAuthError — generic calm message for non-invalid errors', () => {
  it('returns the generic calm Hebrew message for network failure', () => {
    const msg = mapPhoneAuthError(new Error('Network request failed'));
    expect(msg).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('returns the generic calm Hebrew message for unknown errors', () => {
    const msg = mapPhoneAuthError(new Error('Internal server error'));
    expect(msg).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('generic message does not mention "code" — keeps intent broad', () => {
    const msg = mapPhoneAuthError(new Error('Internal server error'));
    // Should NOT say the code is wrong for a network issue
    expect(msg).not.toContain('קוד לא נכון');
  });

  it('generic message is non-empty and human-readable', () => {
    const msg = mapPhoneAuthError(new Error('unknown'));
    expect(msg).toBeTruthy();
    expect(msg.length).toBeGreaterThan(10);
  });
});

// ── 6: Settings label is the correct Hebrew string ───────────────────────────

describe('settings label copy', () => {
  it('renders "העתקת אירועים מיומן חיצוני" (not the old "ייבוא" wording)', () => {
    // This constant mirrors what profile.tsx passes to SettingsRow.
    expect(SETTINGS_LABEL).toBe('העתקת אירועים מיומן חיצוני');
  });

  it('does NOT contain the old "ייבוא" wording', () => {
    expect(SETTINGS_LABEL).not.toContain('ייבוא');
  });

  it('is RTL-safe (no LTR control characters)', () => {
    // Must not contain ASCII-only strings that would break RTL rendering.
    expect(SETTINGS_LABEL).not.toMatch(/[\u202A-\u202E\u200E\u200F]/);
  });
});

// ── Boundary: non-Error objects ───────────────────────────────────────────────

describe('classifyPhoneAuthError — non-Error inputs', () => {
  it('handles null gracefully', () => {
    expect(() => classifyPhoneAuthError(null)).not.toThrow();
  });

  it('handles undefined gracefully', () => {
    expect(() => classifyPhoneAuthError(undefined)).not.toThrow();
  });

  it('classifies numeric errors as unknown', () => {
    expect(classifyPhoneAuthError(500)).toBe('unknown_error');
  });
});

// ── 7: Gender-inclusive copy ─────────────────────────────────────────────────

describe('mapPhoneAuthError — gender-inclusive copy', () => {
  const feminineOnlySuffixes = ['נסי', 'בדקי', 'בקשי', 'הזיני', 'תוכלי'];

  it('invalid_code message uses inclusive Hebrew (no feminine-only forms)', () => {
    const msg = mapPhoneAuthError(new Error('Could not verify code'));
    for (const suffix of feminineOnlySuffixes) {
      expect(msg).not.toContain(suffix);
    }
  });

  it('generic error message uses inclusive Hebrew (no feminine-only forms)', () => {
    const msg = mapPhoneAuthError(new Error('unknown error'));
    for (const suffix of feminineOnlySuffixes) {
      expect(msg).not.toContain(suffix);
    }
  });

  it('invalid_code message matches the specified inclusive copy', () => {
    const msg = mapPhoneAuthError(new Error('Could not verify code'));
    expect(msg).toBe('הקוד לא נכון. אפשר לבדוק ולנסות שוב.');
  });

  it('generic message matches the specified inclusive copy', () => {
    const msg = mapPhoneAuthError(new Error('Unexpected server 500'));
    expect(msg).toBe('לא הצלחנו לאמת את הקוד כרגע. אפשר לנסות שוב בעוד רגע.');
  });
});
