/**
 * QA fix — required-name-field validation feedback (family-profile.tsx
 * self-profile card).
 *
 * Root cause: the mid-form "שמירת פרטים" save relied entirely on
 * useFamilyProfileEditor's handleSavePersonalName silently returning
 * `false` when a required field was blank — nothing in the UI explained
 * WHY. This pure helper (lib/profileNameValidation.ts) is the single
 * source of truth for which field(s) are invalid and the exact Hebrew
 * error copy, so the screen can render per-field errors instead.
 *
 * Run with: bun test tests/convex/profileNameValidation.test.ts
 */

import { describe, expect, it } from 'bun:test';
import {
  FIRST_NAME_REQUIRED_ERROR,
  hasProfileNameValidationError,
  LAST_NAME_REQUIRED_ERROR,
  validateProfileName,
} from '../../lib/profileNameValidation';

describe('validateProfileName', () => {
  it('[TEST 1] missing first name → visible first-name validation error', () => {
    const result = validateProfileName('', 'כהן', true);
    expect(result.firstNameError).toBe(FIRST_NAME_REQUIRED_ERROR);
    expect(result.firstNameError).toBe('יש להזין שם פרטי');
    expect(result.lastNameError).toBeNull();
  });

  it('[TEST 2] missing last name (requireLastName=true) → visible last-name validation error', () => {
    const result = validateProfileName('דנה', '', true);
    expect(result.firstNameError).toBeNull();
    expect(result.lastNameError).toBe(LAST_NAME_REQUIRED_ERROR);
    expect(result.lastNameError).toBe('יש להזין שם משפחה');
  });

  it('[TEST 3] both missing → both errors shown', () => {
    const result = validateProfileName('', '', true);
    expect(result.firstNameError).toBe(FIRST_NAME_REQUIRED_ERROR);
    expect(result.lastNameError).toBe(LAST_NAME_REQUIRED_ERROR);
  });

  it('[TEST 4] whitespace-only first name is treated as invalid', () => {
    const result = validateProfileName('   ', 'כהן', true);
    expect(result.firstNameError).toBe(FIRST_NAME_REQUIRED_ERROR);
  });

  it('[TEST 4b] whitespace-only last name is treated as invalid', () => {
    const result = validateProfileName('דנה', '   ', true);
    expect(result.lastNameError).toBe(LAST_NAME_REQUIRED_ERROR);
  });

  it('both valid (requireLastName=true) → no errors', () => {
    const result = validateProfileName('דנה', 'כהן', true);
    expect(result.firstNameError).toBeNull();
    expect(result.lastNameError).toBeNull();
    expect(hasProfileNameValidationError(result)).toBe(false);
  });

  it('[TEST 9] optional/non-mandatory flows (requireLastName=false): empty last name is valid', () => {
    const result = validateProfileName('דנה', '', false);
    expect(result.firstNameError).toBeNull();
    expect(result.lastNameError).toBeNull();
    expect(hasProfileNameValidationError(result)).toBe(false);
  });

  it('[TEST 9b] optional/non-mandatory flows still require first name', () => {
    const result = validateProfileName('', '', false);
    expect(result.firstNameError).toBe(FIRST_NAME_REQUIRED_ERROR);
    expect(result.lastNameError).toBeNull();
  });
});

describe('hasProfileNameValidationError', () => {
  it('true when either field has an error', () => {
    expect(
      hasProfileNameValidationError({
        firstNameError: FIRST_NAME_REQUIRED_ERROR,
        lastNameError: null,
      })
    ).toBe(true);
    expect(
      hasProfileNameValidationError({
        firstNameError: null,
        lastNameError: LAST_NAME_REQUIRED_ERROR,
      })
    ).toBe(true);
  });

  it('false when neither field has an error', () => {
    expect(
      hasProfileNameValidationError({
        firstNameError: null,
        lastNameError: null,
      })
    ).toBe(false);
  });
});
