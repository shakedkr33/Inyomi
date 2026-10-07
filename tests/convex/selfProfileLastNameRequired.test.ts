/**
 * QA fix — last name must be required (alongside first name) for the
 * joining user's own profile during mandatory Profile Setup (fresh OR
 * claimed-pending), before "שמירת פרטים" (the mid-form self-profile save)
 * is allowed to actually persist.
 *
 * Root cause: handleSavePersonalName (hooks/useFamilyProfileEditor.ts)
 * only guarded on `firstName.trim()` — it saved `lastName.trim() ||
 * undefined` unconditionally, so pressing "שמירת פרטים" with an empty
 * last name during mandatory setup silently succeeded. The FINAL
 * "שמירה והמשך" button was already correctly blocked by
 * isMandatorySetupSaveDisabled (see tests/convex/mandatoryProfileSetup.test.ts),
 * so the bug only affected this earlier mid-form save step giving no
 * feedback before the user hit the already-correct final gate.
 *
 * Fix: handleSavePersonalName now takes a `requireLastName` parameter
 * (default false, preserving the unrelated optional/returning-user edit
 * path's existing "neither name required" behavior — see saveProfile()'s
 * doc comment) and returns whether the save actually happened.
 * app/(authenticated)/family-profile.tsx's handleSaveProfile passes
 * isMandatorySetup and only collapses the card to its "saved" display
 * state when the save actually occurred.
 *
 * This repo has no React Native component/hook test harness (hooks here
 * import 'react-native' directly, e.g. Keyboard, which crashes the bun
 * test runtime — same documented precedent as
 * tests/convex/pendingFamilyPreviewOnboarding.test.ts) — these invariants
 * are verified via source inspection of the real files.
 *
 * Run with: bun test tests/convex/selfProfileLastNameRequired.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const EDITOR_SOURCE = readSource('../../hooks/useFamilyProfileEditor.ts');
const FAMILY_PROFILE_SOURCE = readSource(
  '../../app/(authenticated)/family-profile.tsx'
);

function extractFunctionBlock(source: string, signature: string): string {
  const startIdx = source.indexOf(signature);
  expect(startIdx).toBeGreaterThan(-1);
  const endIdx = source.indexOf('\n  };', startIdx);
  expect(endIdx).toBeGreaterThan(startIdx);
  return source.slice(startIdx, endIdx);
}

describe('handleSavePersonalName — last name required when requireLastName is true', () => {
  const block = extractFunctionBlock(
    EDITOR_SOURCE,
    'const handleSavePersonalName = (requireLastName = false): boolean => {'
  );

  it('[TEST 1] blocks the save when last name is empty and requireLastName is true (first name present)', () => {
    expect(block).toContain(
      'if (requireLastName && !lastName.trim()) return false;'
    );
  });

  it('[TEST 2] whitespace-only last name counts as empty — .trim() is applied before the check', () => {
    // The same guard line covers whitespace-only, since '   '.trim() === ''.
    expect(block).toContain('!lastName.trim()');
  });

  it('[TEST 3] blocks the save when first name is empty regardless of last name (unchanged)', () => {
    expect(block).toContain('if (!firstName.trim()) return false;');
  });

  it('[TEST 4] both present (and requireLastName true) → save proceeds and returns true', () => {
    expect(block).toContain('return true;');
    // The firstName/lastName early-return guards must run BEFORE the
    // actual updateData() persistence call, never after.
    const firstNameGuardIdx = block.indexOf(
      'if (!firstName.trim()) return false;'
    );
    const lastNameGuardIdx = block.indexOf(
      'if (requireLastName && !lastName.trim()) return false;'
    );
    const updateDataIdx = block.indexOf('updateData({');
    expect(firstNameGuardIdx).toBeGreaterThan(-1);
    expect(lastNameGuardIdx).toBeGreaterThan(firstNameGuardIdx);
    expect(updateDataIdx).toBeGreaterThan(lastNameGuardIdx);
  });

  it('requireLastName defaults to false — the optional/returning-user edit path (saveProfile(), unchanged) never forces last name', () => {
    expect(EDITOR_SOURCE).toContain(
      'const handleSavePersonalName = (requireLastName = false): boolean => {'
    );
  });

  it('never calls finishOnboarding/executeFamilyJoin — saving profile details must not perform the final family join', () => {
    expect(block).not.toContain('finishOnboarding');
    expect(block).not.toContain('executeFamilyJoin');
  });
});

describe('family-profile.tsx handleSaveProfile — wires requireLastName from isMandatorySetup, collapses only on real save', () => {
  it('[TEST 5] passes isMandatorySetup as requireLastName to handleSavePersonalName', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'const didSave = handleSavePersonalName(isMandatorySetup);'
    );
  });

  it('[TEST 6] only flips profileSaved (collapses the card) when the save actually happened', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain('if (didSave) setProfileSaved(true);');
  });

  it('final join still only happens via the separate final "שמירה והמשך" flow (handleSaveMandatorySetup → saveAll → finishOnboarding), never from handleSaveProfile', () => {
    const handleSaveProfileIdx = FAMILY_PROFILE_SOURCE.indexOf(
      'const handleSaveProfile = () => {'
    );
    const handleSaveProfileEndIdx = FAMILY_PROFILE_SOURCE.indexOf(
      '\n  };',
      handleSaveProfileIdx
    );
    expect(handleSaveProfileIdx).toBeGreaterThan(-1);
    expect(handleSaveProfileEndIdx).toBeGreaterThan(handleSaveProfileIdx);
    const handleSaveProfileBlock = FAMILY_PROFILE_SOURCE.slice(
      handleSaveProfileIdx,
      handleSaveProfileEndIdx
    );
    expect(handleSaveProfileBlock).not.toContain('saveAll');
    expect(handleSaveProfileBlock).not.toContain('finishOnboarding');
  });

  it('the final mandatory-setup save button is still gated by isMandatorySetupSaveDisabled (unchanged BOTH-required rule)', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'isMandatorySetupSaveDisabled('
    );
  });

  it('pending-family read-only restrictions remain untouched by this fix (canManageFamilyProfileHelper still derived exactly once)', () => {
    const occurrences = (
      FAMILY_PROFILE_SOURCE.match(/canManageFamilyProfileHelper\(/g) ?? []
    ).length;
    expect(occurrences).toBe(1);
  });
});
