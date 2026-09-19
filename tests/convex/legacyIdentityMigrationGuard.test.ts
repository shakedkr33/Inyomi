/**
 * Phase 1 final correction — legacy silent-name-migration guard
 *
 *   - deriveNameFromServerProfile (lib/legacyNameHydration.ts) and
 *     buildProfileNameSavePatch (lib/identityEditGuard.ts) are pure
 *     functions, tested directly.
 *   - Their wiring into hooks/useFamilyProfileEditor.ts,
 *     contexts/OnboardingContext.tsx, and convex/users.ts is verified via
 *     source inspection, following the same established pattern as
 *     tests/convex/claimedMemberProtection.test.ts /
 *     tests/convex/claimedUserCompletion.test.ts.
 *
 * Run with: bun test tests/convex/legacyIdentityMigrationGuard.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildProfileNameSavePatch } from '../../lib/identityEditGuard';
import { deriveNameFromServerProfile } from '../../lib/legacyNameHydration';

// ── [claim/legacy test 9] hydration derives local display values ──────────
describe('deriveNameFromServerProfile — legacy fullName-only hydration', () => {
  it('[test 9] legacy user (firstName/lastName undefined, fullName only) derives split display values', () => {
    const result = deriveNameFromServerProfile({
      firstName: undefined,
      lastName: undefined,
      fullName: 'דנה כהן לוי',
    });
    expect(result).toEqual({ firstName: 'דנה', lastName: 'כהן לוי' });
  });

  it('prefers canonical split fields when the server already has them (Phase 1 user)', () => {
    const result = deriveNameFromServerProfile({
      firstName: 'דנה',
      lastName: 'כהן',
      fullName: 'שם אחר לגמרי',
    });
    expect(result).toEqual({ firstName: 'דנה', lastName: 'כהן' });
  });

  it('empty/missing fullName and no split fields → both empty strings', () => {
    const result = deriveNameFromServerProfile({});
    expect(result).toEqual({ firstName: '', lastName: '' });
  });
});

// ── buildProfileNameSavePatch — the core save-intent guard ─────────────────
describe('buildProfileNameSavePatch — identityEdited gate', () => {
  it('[test 11/12] identityEdited=false → returns {} (no firstName/lastName/fullName keys at all)', () => {
    const patch = buildProfileNameSavePatch({
      identityEdited: false,
      firstName: 'דנה',
      lastName: 'כהן לוי',
    });
    expect(patch).toEqual({});
    expect(Object.keys(patch).length).toBe(0);
  });

  it('[test 13] identityEdited=false leaves no way for fullName to be forwarded, even with non-empty local state', () => {
    const patch = buildProfileNameSavePatch({
      identityEdited: false,
      firstName: 'Legacy',
      lastName: 'Name',
    });
    expect(patch.fullName).toBeUndefined();
  });

  it('[test 17/18] identityEdited=true → sends trimmed firstName, lastName, and regenerated fullName', () => {
    const patch = buildProfileNameSavePatch({
      identityEdited: true,
      firstName: '  דנה  ',
      lastName: '  כהן  ',
    });
    expect(patch).toEqual({
      fullName: 'דנה כהן',
      firstName: 'דנה',
      lastName: 'כהן',
    });
  });

  it('identityEdited=true with a blank last name still sends firstName and a single-word fullName', () => {
    const patch = buildProfileNameSavePatch({
      identityEdited: true,
      firstName: 'דנה',
      lastName: '   ',
    });
    expect(patch).toEqual({
      fullName: 'דנה',
      firstName: 'דנה',
      lastName: undefined,
    });
  });
});

// ── [test 14] no firstName/lastName keys → convex/users.ts sync gate stays closed ──
describe('buildProfileNameSavePatch output vs. updateMyProfile migration/sync gate', () => {
  it('[test 14] an unrelated save (identityEdited=false) produces a patch that never satisfies updateMyProfile\'s "args.firstName !== undefined || args.lastName !== undefined" gate', () => {
    const patch = buildProfileNameSavePatch({
      identityEdited: false,
      firstName: 'דנה',
      lastName: 'כהן לוי',
    });
    // Mirrors convex/users.ts updateMyProfile's exact migration/sync gate.
    const wouldMigrateOrSync =
      patch.firstName !== undefined || patch.lastName !== undefined;
    expect(wouldMigrateOrSync).toBe(false);
  });

  it('an explicit edit (identityEdited=true) DOES satisfy the same gate', () => {
    const patch = buildProfileNameSavePatch({
      identityEdited: true,
      firstName: 'דנה',
      lastName: 'כהן',
    });
    const wouldMigrateOrSync =
      patch.firstName !== undefined || patch.lastName !== undefined;
    expect(wouldMigrateOrSync).toBe(true);
  });
});

// ── Source-inspection: stateful wiring in useFamilyProfileEditor.ts ────────
const EDITOR_SOURCE = readFileSync(
  new URL('../../hooks/useFamilyProfileEditor.ts', import.meta.url),
  'utf8'
);

describe('useFamilyProfileEditor — identityEdited wiring [tests 10, 15, 16, 20]', () => {
  it('[test 10] identityEdited state is initialized to false, never derived from hydrated firstName/lastName', () => {
    expect(EDITOR_SOURCE).toContain(
      'const [identityEdited, setIdentityEdited] = useState(false);'
    );
  });

  it('[test 15] the exported setFirstName wrapper marks identity as edited before updating state', () => {
    const block = EDITOR_SOURCE.slice(
      EDITOR_SOURCE.indexOf('const setFirstName = (value: string) => {'),
      EDITOR_SOURCE.indexOf('const setLastName = (value: string) => {')
    );
    expect(block).toContain('setIdentityEdited(true);');
    expect(block).toContain('setFirstNameState(value);');
  });

  it('[test 16] the exported setLastName wrapper marks identity as edited before updating state', () => {
    const block = EDITOR_SOURCE.slice(
      EDITOR_SOURCE.indexOf('const setLastName = (value: string) => {'),
      EDITOR_SOURCE.indexOf('const [ownerFullName')
    );
    expect(block).toContain('setIdentityEdited(true);');
    expect(block).toContain('setLastNameState(value);');
  });

  it('saveProfile (optional/returning-user path) builds its name payload via buildProfileNameSavePatch keyed on identityEdited', () => {
    const saveProfileStart = EDITOR_SOURCE.indexOf(
      'const saveProfile = (): Promise<void> => {'
    );
    const saveProfileBlock = EDITOR_SOURCE.slice(
      saveProfileStart,
      EDITOR_SOURCE.indexOf('\n  return {', saveProfileStart)
    );
    expect(saveProfileBlock).toContain('buildProfileNameSavePatch({');
    expect(saveProfileBlock).toContain('identityEdited,');
    expect(saveProfileBlock).toContain('...namePatch,');
  });

  it('[test 20] saveAll (mandatory onboarding) is NOT gated by identityEdited — it always forwards trimmed firstName/lastName to finishOnboarding', () => {
    const saveAllBlock = EDITOR_SOURCE.slice(
      EDITOR_SOURCE.indexOf('const saveAll = ()'),
      EDITOR_SOURCE.indexOf(
        'Persist profile updates to Convex for returning users'
      )
    );
    expect(saveAllBlock).not.toContain('identityEdited');
    expect(saveAllBlock).not.toContain('buildProfileNameSavePatch');
    expect(saveAllBlock).toContain('firstName: trimmedFirstName,');
    expect(saveAllBlock).toContain('lastName: trimmedLastName,');
  });
});

// ── Source-inspection: hydration never touches identityEdited ─────────────
const ONBOARDING_CONTEXT_SOURCE = readFileSync(
  new URL('../../contexts/OnboardingContext.tsx', import.meta.url),
  'utf8'
);

describe('OnboardingContext — hydration is structurally decoupled from identityEdited [test 10]', () => {
  it('hydrateFromServer never references identityEdited/setIdentityEdited (the flag lives only in useFamilyProfileEditor, hydration cannot touch it)', () => {
    expect(ONBOARDING_CONTEXT_SOURCE).not.toContain('identityEdited');
  });

  it('hydrateFromServer derives names via the pure, testable deriveNameFromServerProfile helper', () => {
    expect(ONBOARDING_CONTEXT_SOURCE).toContain(
      'deriveNameFromServerProfile(profile)'
    );
  });
});

// ── Source-inspection: convex/users.ts sync gate is unchanged and still correct ──
const USERS_SOURCE = readFileSync(
  new URL('../../convex/users.ts', import.meta.url),
  'utf8'
);

describe('updateMyProfile — [test 14/19] sync gate still tied to explicit args, not local UI state', () => {
  it('the migration/sync gate is exactly "args.firstName !== undefined || args.lastName !== undefined" — unchanged by this correction, and now only ever true when the caller explicitly edited', () => {
    expect(USERS_SOURCE).toContain(
      'if (args.firstName !== undefined || args.lastName !== undefined) {'
    );
  });

  it('[test 19] the claimed-entity displayName sync only runs when canonicalFullNameForSync was set inside that same gate', () => {
    const gateIdx = USERS_SOURCE.indexOf(
      'if (args.firstName !== undefined || args.lastName !== undefined) {'
    );
    const syncIdx = USERS_SOURCE.indexOf('if (canonicalFullNameForSync) {');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeGreaterThan(gateIdx);
  });
});
