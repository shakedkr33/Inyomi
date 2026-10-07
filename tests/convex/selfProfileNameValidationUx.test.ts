/**
 * QA fix — required name fields must show validation feedback instead of
 * silently no-op'ing, and the final "שמירה והמשך" CTA must auto-save
 * unsaved profile details via the SAME canonical save function before
 * attempting the final family join.
 *
 * This repo has no React Native component/hook test harness (see
 * tests/convex/selfProfileLastNameRequired.test.ts's documented
 * precedent) — the pure validation/orchestration logic is covered
 * directly in tests/convex/profileNameValidation.test.ts and
 * tests/convex/mandatorySetupFinalSave.test.ts. This file verifies how
 * app/(authenticated)/family-profile.tsx wires those pure helpers, and
 * that the final family-join semantics remain untouched.
 *
 * Run with: bun test tests/convex/selfProfileNameValidationUx.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const FAMILY_PROFILE_SOURCE = readSource(
  '../../app/(authenticated)/family-profile.tsx'
);

describe('family-profile.tsx — field-level validation wiring (no more silent no-op)', () => {
  it('handleSaveProfile validates via the shared pure helper before saving', () => {
    const idx = FAMILY_PROFILE_SOURCE.indexOf(
      'const handleSaveProfile = () => {'
    );
    const endIdx = FAMILY_PROFILE_SOURCE.indexOf('\n  };', idx);
    const block = FAMILY_PROFILE_SOURCE.slice(idx, endIdx);
    expect(block).toContain('validateProfileName(');
    expect(block).toContain('firstName,');
    expect(block).toContain('lastName,');
    expect(block).toContain('isMandatorySetup');
  });

  it('handleSaveProfile sets both field-error states from the validation result', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'setFirstNameError(validation.firstNameError)'
    );
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'setLastNameError(validation.lastNameError)'
    );
  });

  it('handleSaveProfile returns early (does not save) when either field is invalid', () => {
    const idx = FAMILY_PROFILE_SOURCE.indexOf(
      'const handleSaveProfile = () => {'
    );
    const endIdx = FAMILY_PROFILE_SOURCE.indexOf('\n  };', idx);
    expect(idx).toBeGreaterThan(-1);
    const block = FAMILY_PROFILE_SOURCE.slice(idx, endIdx);
    expect(block).toContain(
      'if (validation.firstNameError || validation.lastNameError) return;'
    );
    // The guard must run BEFORE the actual save call.
    const guardIdx = block.indexOf(
      'if (validation.firstNameError || validation.lastNameError) return;'
    );
    const saveIdx = block.indexOf('handleSavePersonalName(isMandatorySetup)');
    expect(saveIdx).toBeGreaterThan(guardIdx);
  });

  it('[TEST 5/6] errors clear once the user types a non-blank value into that field', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'if (firstNameError && v.trim()) setFirstNameError(null);'
    );
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'if (lastNameError && v.trim()) setLastNameError(null);'
    );
  });

  it('the mid-form "שמירת פרטים" button is never given a disabled prop (stays tappable; only save-in-flight can legitimately disable a button elsewhere)', () => {
    const idx = FAMILY_PROFILE_SOURCE.indexOf(
      'accessibilityLabel="שמירת פרטים"'
    );
    expect(idx).toBeGreaterThan(-1);
    const pressableStart = FAMILY_PROFILE_SOURCE.lastIndexOf('<Pressable', idx);
    const pressableBlock = FAMILY_PROFILE_SOURCE.slice(pressableStart, idx);
    expect(pressableBlock).not.toContain('disabled');
  });

  it('error text/border reuses the existing app error/destructive color token (colors.error), no second design invented', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain('colors.error');
  });

  it('required fields are visually marked with "*" (first name always, last name only during mandatory setup)', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain('placeholder="שם פרטי *"');
    expect(FAMILY_PROFILE_SOURCE).toContain(
      "isMandatorySetup ? 'שם משפחה *' : 'שם משפחה'"
    );
  });
});

describe('family-profile.tsx — final CTA auto-saves unsaved profile details before joining', () => {
  it('handleSaveMandatorySetup routes through the shared pure orchestrator', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain('executeMandatorySetupFinalSave(');
  });

  it('the orchestrator is given the SAME canonical save function used by "שמירת פרטים" (handleSavePersonalName)', () => {
    const idx = FAMILY_PROFILE_SOURCE.indexOf(
      'const handleSaveMandatorySetup = (): void => {'
    );
    const endIdx = FAMILY_PROFILE_SOURCE.indexOf('\n  };', idx);
    const block = FAMILY_PROFILE_SOURCE.slice(idx, endIdx);
    expect(block).toContain('handleSavePersonalName(true)');
  });

  it('dirty-tracking does not rely solely on the card expanded/collapsed (profileSaved) flag', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain('lastSavedProfileName');
    expect(FAMILY_PROFILE_SOURCE).toContain('isProfileNameDirty');
  });

  it('final-save re-entrancy guard is claimed synchronously via a ref (protects against rapid double tap)', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'const finalSaveStateRef = useRef({ isSaving: false });'
    );
    expect(FAMILY_PROFILE_SOURCE).toContain('finalSaveStateRef.current');
  });
});

describe('final family join semantics remain completely unchanged', () => {
  it('"שמירת פרטים" (handleSaveProfile) never creates access, sets entity.userId/inviteStatus, or changes defaultSpaceId', () => {
    const idx = FAMILY_PROFILE_SOURCE.indexOf(
      'const handleSaveProfile = () => {'
    );
    const endIdx = FAMILY_PROFILE_SOURCE.indexOf('\n  };', idx);
    const block = FAMILY_PROFILE_SOURCE.slice(idx, endIdx);
    expect(block).not.toContain('executeFamilyJoin');
    expect(block).not.toContain('finishOnboarding');
    expect(block).not.toContain('saveAll');
    expect(block).not.toContain("kind:'access'");
    expect(block).not.toContain("inviteStatus:'joined'");
    expect(block).not.toContain('defaultSpaceId');
  });

  it('the final join mutation (saveAll → finishOnboarding) is still the ONLY path the final CTA reaches it through', () => {
    const occurrences = (
      FAMILY_PROFILE_SOURCE.match(/joinFamily: \(\) => saveAll\(\)/g) ?? []
    ).length;
    expect(occurrences).toBe(1);
  });

  it("the final join is only attempted via the orchestrator's joinFamily dependency, never called directly from onStart/saveProfileName callbacks", () => {
    const idx = FAMILY_PROFILE_SOURCE.indexOf(
      'const handleSaveMandatorySetup = (): void => {'
    );
    const endIdx = FAMILY_PROFILE_SOURCE.indexOf('\n  };', idx);
    const block = FAMILY_PROFILE_SOURCE.slice(idx, endIdx);
    const saveProfileNameBlockStart = block.indexOf('saveProfileName: () => {');
    const saveProfileNameBlockEnd = block.indexOf(
      '},',
      saveProfileNameBlockStart
    );
    const saveProfileNameBlock = block.slice(
      saveProfileNameBlockStart,
      saveProfileNameBlockEnd
    );
    expect(saveProfileNameBlock).not.toContain('saveAll');
  });
});
