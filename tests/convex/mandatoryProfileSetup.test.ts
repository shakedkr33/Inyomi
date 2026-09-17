/**
 * Stage 2B+3 — isMandatorySetupSaveDisabled (lib/mandatoryProfileSetup.ts)
 *
 * Mandatory Profile Setup: first name is required — the save button must
 * stay disabled until a non-whitespace first name is entered, and while a
 * save is already in flight.
 *
 * Run with: bun test tests/convex/mandatoryProfileSetup.test.ts
 */

import { describe, expect, it } from 'bun:test';
import {
  canManageFamilyProfile,
  isMandatorySetupSaveDisabled,
} from '../../lib/mandatoryProfileSetup';

describe('isMandatorySetupSaveDisabled', () => {
  it('empty first name blocks save', () => {
    expect(isMandatorySetupSaveDisabled('', false)).toBe(true);
  });

  it('whitespace-only first name blocks save', () => {
    expect(isMandatorySetupSaveDisabled('   ', false)).toBe(true);
  });

  it('valid non-empty first name enables save', () => {
    expect(isMandatorySetupSaveDisabled('דנה', false)).toBe(false);
  });

  it('valid first name with surrounding whitespace still enables save', () => {
    expect(isMandatorySetupSaveDisabled('  דנה  ', false)).toBe(false);
  });

  it('save already in flight blocks save even with a valid first name (prevents duplicate submissions)', () => {
    expect(isMandatorySetupSaveDisabled('דנה', true)).toBe(true);
  });

  it('save in flight AND empty name → still disabled', () => {
    expect(isMandatorySetupSaveDisabled('', true)).toBe(true);
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
