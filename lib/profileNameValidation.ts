// ============================================================================
// profileNameValidation.ts — pure field-level validation for the self-profile
// first/last name fields on app/(authenticated)/family-profile.tsx.
// ============================================================================
//
// QA fix: the mid-form "שמירת פרטים" card previously relied entirely on
// useFamilyProfileEditor's handleSavePersonalName silently returning
// `false` when a required field was blank — nothing in the UI explained
// WHY the tap appeared to do nothing (no red border, no error text, no
// focus change). This module is the single source of truth for WHICH
// fields are invalid and WHAT Hebrew copy to show, so the screen can
// render per-field errors instead of a silent no-op.
//
// First name is ALWAYS required (matches the existing, unchanged
// `if (!firstName.trim()) return false;` inside handleSavePersonalName).
// Last name is only required when `requireLastName` is true — true during
// mandatory Profile Setup (onboarding still incomplete, fresh OR claimed),
// false everywhere else (optional post-auth setup, Settings → "ניהול
// פרופיל"). Values are trimmed before being checked, so a whitespace-only
// value is treated as empty/invalid.
// ============================================================================

export const FIRST_NAME_REQUIRED_ERROR = 'יש להזין שם פרטי';
export const LAST_NAME_REQUIRED_ERROR = 'יש להזין שם משפחה';

export interface ProfileNameValidationResult {
  firstNameError: string | null;
  lastNameError: string | null;
}

/**
 * Pure validator for the self-profile first/last name fields.
 *
 * @param firstName raw (untrimmed) first-name field value
 * @param lastName raw (untrimmed) last-name field value
 * @param requireLastName whether last name is required in this context
 *   (true for mandatory Profile Setup, false for optional/settings edits)
 */
export function validateProfileName(
  firstName: string,
  lastName: string,
  requireLastName: boolean
): ProfileNameValidationResult {
  return {
    firstNameError: firstName.trim() ? null : FIRST_NAME_REQUIRED_ERROR,
    lastNameError:
      requireLastName && !lastName.trim() ? LAST_NAME_REQUIRED_ERROR : null,
  };
}

/** True if either field has a validation error. */
export function hasProfileNameValidationError(
  result: ProfileNameValidationResult
): boolean {
  return result.firstNameError !== null || result.lastNameError !== null;
}
