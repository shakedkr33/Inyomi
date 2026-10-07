/**
 * QA fix — claimed pending-family mandatory onboarding shows an empty
 * family list.
 *
 * Root cause (confirmed via code inspection, see the approved plan):
 * app/(authenticated)/family-profile.tsx never called
 * api.members.getMyPendingFamilyPreview. For a claimed-but-not-yet-joined
 * user, canManageFamilyProfile is false, so the screen fell back to
 * listMyFamilyContacts — which always returns an empty list for these
 * users, because resolveMySpaceId (convex/members.ts) looks up `members`
 * rows by `userId`, and `entity.userId` is only written at final join
 * (executeFamilyJoin). getMyPendingFamilyPreview already existed and reads
 * `user.pendingMatchMemberId` directly instead, returning a safe read-only
 * preview of the existing family's OTHER members/pets — but nothing on
 * this screen ever called it.
 *
 * The fix wires that existing query in as the display source specifically
 * for isClaimedMandatorySetup === true, alongside the existing
 * (unit-tested) canManageFamilyProfile gating — no mutation, no schema,
 * no final-join-transaction change.
 *
 * This repo has no React Navigation/React Native component test harness
 * (see tests/convex/mandatoryProfileSetupRoutingFix.test.ts's documented
 * precedent) — these invariants are verified via source inspection of the
 * real file, the same pattern used there.
 *
 * Run with: bun test tests/convex/pendingFamilyPreviewOnboarding.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const FAMILY_PROFILE_SOURCE = readSource(
  '../../app/(authenticated)/family-profile.tsx'
);

describe('claimed pending-family preview — read-only display source', () => {
  it('calls getMyPendingFamilyPreview, skipped unless isClaimedMandatorySetup is true', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      "api.members.getMyPendingFamilyPreview,\n    isClaimedMandatorySetup ? {} : 'skip'"
    );
  });

  it('derives isClaimedMandatorySetup BEFORE issuing the preview query (no use-before-define)', () => {
    const claimedIdx = FAMILY_PROFILE_SOURCE.indexOf(
      'const isClaimedMandatorySetup = isClaimedMandatorySetupHelper('
    );
    const previewIdx = FAMILY_PROFILE_SOURCE.indexOf(
      'const pendingFamilyPreview = useQuery('
    );
    expect(claimedIdx).toBeGreaterThan(-1);
    expect(previewIdx).toBeGreaterThan(-1);
    expect(claimedIdx).toBeLessThan(previewIdx);
  });

  it('displayMembers sources the claimed-preview branch before the always-empty listMyFamilyContacts fallback', () => {
    const match = FAMILY_PROFILE_SOURCE.match(
      /const displayMembers: FamilyMember\[\] = canManageFamilyProfile\s*\n\s*\? mergedPersonMembers\s*\n\s*: isClaimedMandatorySetup\s*\n\s*\? previewPersonMembers\s*\n\s*: allServerMembers/
    );
    expect(match).not.toBeNull();
  });

  it('displayPetMembers sources the claimed-preview branch before the always-empty listMyFamilyContacts fallback', () => {
    const match = FAMILY_PROFILE_SOURCE.match(
      /const displayPetMembers: FamilyMember\[\] = canManageFamilyProfile\s*\n\s*\? petMembers\s*\n\s*: isClaimedMandatorySetup\s*\n\s*\? previewPetMembers\s*\n\s*: allServerMembers/
    );
    expect(match).not.toBeNull();
  });

  it('preview rows never carry phone/matchedUserId/inviteStatus (getMyPendingFamilyPreview never returns them)', () => {
    const previewBlockMatch = FAMILY_PROFILE_SOURCE.match(
      /const previewPersonMembers[\s\S]*?const previewPetMembers[\s\S]*?\}\)\);/
    );
    expect(previewBlockMatch).not.toBeNull();
    const block = previewBlockMatch?.[0] ?? '';
    expect(block).not.toContain('matchedUserId');
    expect(block).not.toContain('inviteStatus');
    expect(block).not.toContain('selectedPhoneNumber');
  });
});

describe('claimed pending-family preview — Add/Edit/Delete controls remain gated by canManageFamilyProfile only', () => {
  it('the "add from contacts" / "add manually" person buttons are still gated by canManageFamilyProfile && canAddPerson', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'canManageFamilyProfile && canAddPerson &&'
    );
  });

  it('the "add pet" affordances are still gated by canManageFamilyProfile && canAddPet', () => {
    const addPetOccurrences = (
      FAMILY_PROFILE_SOURCE.match(
        /canManageFamilyProfile &&\s*\n?\s*canAddPet/g
      ) ?? []
    ).length;
    // Empty-pets-state add button + non-empty-state add-another-pet button.
    expect(addPetOccurrences).toBeGreaterThanOrEqual(1);
  });

  it('person rows pass isAdmin={canManageFamilyProfile} to FamilyMemberManagementCard (edit/remove hidden when false)', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain('isAdmin={canManageFamilyProfile}');
  });

  it('pet rows only wire onEdit/onRemove when canManageFamilyProfile is true (undefined otherwise)', () => {
    const match = FAMILY_PROFILE_SOURCE.match(
      /onEdit=\{\s*\n\s*canManageFamilyProfile\s*\n\s*\? \(\) => startEditMember\(member\)\s*\n\s*: undefined\s*\n\s*\}/
    );
    expect(match).not.toBeNull();
  });

  it('canManageFamilyProfileHelper is derived exactly once, from the single unit-tested pure helper', () => {
    // This is the exact rule that keeps Add/Edit/Delete hidden for claimed
    // pending users: (isMandatorySetup && !isClaimedSetup) || isRealSpaceAdmin.
    // See lib/mandatoryProfileSetup.ts and tests/convex/mandatoryProfileSetup.test.ts
    // for the unit-tested truth table. This screen must keep deriving
    // canManageFamilyProfile from that single helper — never a second,
    // competing condition.
    const occurrences = (
      FAMILY_PROFILE_SOURCE.match(/canManageFamilyProfileHelper\(/g) ?? []
    ).length;
    expect(occurrences).toBe(1);
  });
});

describe('claimed pending-family preview — remains display-only (no membership mutation introduced)', () => {
  it('the new preview wiring introduces no new useMutation call', () => {
    const mutationOccurrences = (
      FAMILY_PROFILE_SOURCE.match(/useMutation\(/g) ?? []
    ).length;
    // Unchanged from before this fix: markFamilySetupSkipped +
    // undoClaimedFamilyMatch. The preview fix adds a useQuery, not a
    // useMutation.
    expect(mutationOccurrences).toBe(2);
  });

  it('never calls executeFamilyJoin, acceptPendingPhoneMatch, or finishOnboarding as a mutation from this screen (doc-comment mentions are fine)', () => {
    expect(FAMILY_PROFILE_SOURCE).not.toMatch(
      /useMutation\(\s*api\.members\.executeFamilyJoin/
    );
    expect(FAMILY_PROFILE_SOURCE).not.toMatch(
      /useMutation\(\s*api\.members\.acceptPendingPhoneMatch/
    );
    expect(FAMILY_PROFILE_SOURCE).not.toMatch(
      /useMutation\(\s*api\.onboarding\.finishOnboarding/
    );
    // The only two useMutation call sites remain the pre-existing ones.
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'useMutation(api.users.markFamilySetupSkipped)'
    );
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'api.members.undoClaimedFamilyMatch'
    );
  });

  it("firstName/lastName requirement for the joining user's own profile is unchanged", () => {
    // QA fix (required-name validation feedback): the final CTA no longer
    // silently returns on `if (!firstName.trim() || !lastName.trim())` —
    // it now validates via the shared pure helper (requireLastName=true)
    // and shows field-level errors instead. The BOTH-required rule itself
    // is unchanged, just enforced through
    // lib/profileNameValidation.ts's validateProfileName instead of an
    // inline silent-no-op guard — see
    // tests/convex/selfProfileNameValidationUx.test.ts and
    // tests/convex/mandatorySetupFinalSave.test.ts for the new coverage.
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'validateProfileName(firstName, lastName, true)'
    );
  });
});

describe('QA fix — pending-family preview rows derive sourceType/isConnected from the safe booleans instead of hardcoding manual', () => {
  const previewBlockMatch = FAMILY_PROFILE_SOURCE.match(
    /const previewPersonMembers[\s\S]*?const previewPetMembers[\s\S]*?\}\)\);/
  );
  const block = previewBlockMatch?.[0] ?? '';

  it('previewPersonMembers block exists', () => {
    expect(previewBlockMatch).not.toBeNull();
  });

  it('derives sourceType from m.hasPhoneNumber — never hardcodes manual for every row (the original bug)', () => {
    expect(block).toContain('m.hasPhoneNumber');
    // The old hardcoded-always-manual bug looked like:
    //   sourceType: 'manual' as const,
    // directly inside the previewPersonMembers .map() — it must be gone.
    const personMapMatch = block.match(
      /const previewPersonMembers[\s\S]*?\}\)\);/
    );
    expect(personMapMatch?.[0] ?? '').not.toContain(
      "sourceType: 'manual' as const,\n    }));"
    );
  });

  it('passes isConnected through from the preview so connected rows are never labeled manual', () => {
    expect(block).toContain('isConnected: m.isConnected');
  });

  it('still never carries the actual phone/matchedUserId/inviteStatus fields (unchanged privacy invariant)', () => {
    expect(block).not.toContain('matchedUserId');
    expect(block).not.toContain('inviteStatus');
    expect(block).not.toContain('selectedPhoneNumber');
  });
});

describe('QA fix — approved copy for the read-only family-profile explainer', () => {
  it('uses the approved inclusive copy, not the old masculine/feminine-split phrasing', () => {
    expect(FAMILY_PROFILE_SOURCE).toContain(
      'עריכת הפרופיל המשפחתי זמינה למנהלי המשפחה בלבד.'
    );
    expect(FAMILY_PROFILE_SOURCE).not.toContain(
      'רק מנהל/ת המשפחה יכול/ה לערוך את הפרופיל המשפחתי'
    );
  });
});

describe('QA fix — card alignment: horizontal padding moved off the ScrollView onto contentContainerStyle', () => {
  it('the member/pet/profile ScrollView no longer sets px-6 directly on its own className', () => {
    expect(FAMILY_PROFILE_SOURCE).not.toContain('className="flex-1 px-6"');
  });

  it('contentContainerStyle now carries paddingHorizontal: 24 (matches the removed px-6 value, 6 * 4px)', () => {
    const scrollViewMatch = FAMILY_PROFILE_SOURCE.match(
      /<ScrollView\s+className="flex-1"[\s\S]*?contentContainerStyle=\{\{[\s\S]*?\}\}/
    );
    expect(scrollViewMatch).not.toBeNull();
    expect(scrollViewMatch?.[0] ?? '').toContain('paddingHorizontal: 24');
  });
});
