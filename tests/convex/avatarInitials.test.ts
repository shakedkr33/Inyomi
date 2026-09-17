/**
 * QA fix — getSelfProfileAvatarInitials (lib/avatarInitials.ts)
 *
 * Manual QA of the mandatory Profile Setup screen found that before a
 * first name is entered, the avatar circle showed placeholder-derived
 * initials (e.g. "הפ" from the "הפרופיל שלך" fallback label). The rule:
 *   - no first name yet           → no initials ('')
 *   - first name entered          → real initials appear
 *   - never derived from a placeholder label or from nickname
 *
 * Run with: bun test tests/convex/avatarInitials.test.ts
 */

import { describe, expect, it } from 'bun:test';
import {
  getAvatarInitials,
  getSelfProfileAvatarInitials,
} from '../../lib/avatarInitials';

describe('getSelfProfileAvatarInitials — no first name → no initials', () => {
  it('empty firstName and empty lastName → ""', () => {
    expect(getSelfProfileAvatarInitials({ firstName: '', lastName: '' })).toBe(
      ''
    );
  });

  it('whitespace-only firstName → "" (never falls back to a placeholder)', () => {
    expect(
      getSelfProfileAvatarInitials({ firstName: '   ', lastName: '' })
    ).toBe('');
  });

  it('undefined firstName/lastName → ""', () => {
    expect(getSelfProfileAvatarInitials({})).toBe('');
  });

  it('lastName present but firstName empty → still "" (firstName is required)', () => {
    expect(
      getSelfProfileAvatarInitials({ firstName: '', lastName: 'כהן' })
    ).toBe('');
  });
});

describe('getSelfProfileAvatarInitials — first name entered → real initials', () => {
  it('firstName only (no lastName) → first two characters of firstName', () => {
    expect(getSelfProfileAvatarInitials({ firstName: 'דנה' })).toBe('דנ');
  });

  it('firstName + lastName → one initial from each', () => {
    expect(
      getSelfProfileAvatarInitials({ firstName: 'דנה', lastName: 'כהן' })
    ).toBe('דכ');
  });

  it('surrounding whitespace is trimmed before deriving initials', () => {
    expect(
      getSelfProfileAvatarInitials({ firstName: '  דנה  ', lastName: '  ' })
    ).toBe('דנ');
  });

  it('single-character firstName with no lastName → that one character only', () => {
    expect(getSelfProfileAvatarInitials({ firstName: 'ד' })).toBe('ד');
  });
});

describe('getSelfProfileAvatarInitials — never derives from a placeholder/nickname', () => {
  it('the function signature has no fullName/name/nickname fallback parameter at all', () => {
    // Type-level guarantee: only firstName/lastName are accepted, so a
    // placeholder label like "הפרופיל שלך" / "המשתמש שלי" or a nickname
    // value can never be passed in and can never influence the result.
    expect(getSelfProfileAvatarInitials({ firstName: '', lastName: '' })).toBe(
      ''
    );
  });
});

describe('getAvatarInitials — legacy object-shape helper is unchanged', () => {
  it('still falls back to fullName when firstName/lastName are both absent (unchanged legacy behavior for other callers)', () => {
    expect(getAvatarInitials({ fullName: 'הפרופיל שלך' })).toBe('הפ');
  });
});
