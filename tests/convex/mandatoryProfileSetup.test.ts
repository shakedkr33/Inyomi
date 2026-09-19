/**
 * Phase 1 (was Stage 2B+3) — isMandatorySetupSaveDisabled (lib/mandatoryProfileSetup.ts)
 *
 * Mandatory Profile Setup: BOTH first name and last name are required —
 * the save button must stay disabled until neither is blank/whitespace-
 * only, and while a save is already in flight.
 *
 * Run with: bun test tests/convex/mandatoryProfileSetup.test.ts
 */

import { describe, expect, it } from 'bun:test';
import {
  canManageFamilyProfile,
  isMandatorySetupSaveDisabled,
} from '../../lib/mandatoryProfileSetup';

describe('isMandatorySetupSaveDisabled', () => {
  it('[TEST 1] empty first name blocks save (last name valid)', () => {
    expect(isMandatorySetupSaveDisabled('', 'כהן', false)).toBe(true);
  });

  it('[TEST 2] empty last name blocks save (first name valid)', () => {
    expect(isMandatorySetupSaveDisabled('דנה', '', false)).toBe(true);
  });

  it('[TEST 3] whitespace-only first name blocks save', () => {
    expect(isMandatorySetupSaveDisabled('   ', 'כהן', false)).toBe(true);
  });

  it('[TEST 4] whitespace-only last name blocks save', () => {
    expect(isMandatorySetupSaveDisabled('דנה', '   ', false)).toBe(true);
  });

  it('[TEST 5] both first and last name present → save allowed', () => {
    expect(isMandatorySetupSaveDisabled('דנה', 'כהן', false)).toBe(false);
  });

  it('both blank → blocks save', () => {
    expect(isMandatorySetupSaveDisabled('', '', false)).toBe(true);
  });

  it('valid names with surrounding whitespace still enable save', () => {
    expect(isMandatorySetupSaveDisabled('  דנה  ', '  כהן  ', false)).toBe(
      false
    );
  });

  it('save already in flight blocks save even with valid names (prevents duplicate submissions)', () => {
    expect(isMandatorySetupSaveDisabled('דנה', 'כהן', true)).toBe(true);
  });

  it('save in flight AND empty names → still disabled', () => {
    expect(isMandatorySetupSaveDisabled('', '', true)).toBe(true);
  });
});

describe('canManageFamilyProfile — QA fix: family/pet add actions must be available during mandatory setup', () => {
  it('mandatory setup + no real space admin role (the always-false case before a space exists) → can manage', () => {
    expect(canManageFamilyProfile(true, false)).toBe(true);
  });

  it('mandatory setup + real space admin role (defensive — should never actually happen pre-space) → can manage', () => {
    expect(canManageFamilyProfile(true, true)).toBe(true);
  });

  it('NOT mandatory setup (optional/settings) + real admin → can manage (unchanged existing behavior)', () => {
    expect(canManageFamilyProfile(false, true)).toBe(true);
  });

  it('NOT mandatory setup (optional/settings) + NOT admin (a family member) → cannot manage (unchanged existing behavior)', () => {
    expect(canManageFamilyProfile(false, false)).toBe(false);
  });
});
