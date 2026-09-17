/**
 * Stage 2B+3 — deriveSpaceTypeFromFamilyMembers (lib/spaceTypeDerivation.ts)
 *
 * LOCKED PRODUCT RULE: the actual configured family members determine the
 * new space's type — never Q1 (onboardingIntent), which is
 * analytics/personalization only.
 *
 * Run with: bun test tests/convex/spaceTypeDerivation.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { deriveSpaceTypeFromFamilyMembers } from '../../lib/spaceTypeDerivation';

describe('deriveSpaceTypeFromFamilyMembers', () => {
  it('Self only (empty array) → personal', () => {
    expect(deriveSpaceTypeFromFamilyMembers([])).toBe('personal');
  });

  it('Self + one person family member → family', () => {
    expect(deriveSpaceTypeFromFamilyMembers([{ type: 'person' }])).toBe(
      'family'
    );
  });

  it('Self + multiple person family members → family', () => {
    expect(
      deriveSpaceTypeFromFamilyMembers([{ type: 'person' }, { type: 'person' }])
    ).toBe('family');
  });

  it('Self + pet ONLY → still personal (pets alone must not make the space family)', () => {
    expect(deriveSpaceTypeFromFamilyMembers([{ type: 'pet' }])).toBe(
      'personal'
    );
  });

  it('Self + multiple pets only → still personal', () => {
    expect(
      deriveSpaceTypeFromFamilyMembers([{ type: 'pet' }, { type: 'pet' }])
    ).toBe('personal');
  });

  it('Self + a pet AND a person → family (any human member tips it to family)', () => {
    expect(
      deriveSpaceTypeFromFamilyMembers([{ type: 'pet' }, { type: 'person' }])
    ).toBe('family');
  });

  it('member with no explicit type (legacy row) is treated as a person → family', () => {
    expect(deriveSpaceTypeFromFamilyMembers([{}])).toBe('family');
  });

  it('member with no explicit type mixed with a pet → family (untyped defaults to person)', () => {
    expect(deriveSpaceTypeFromFamilyMembers([{ type: 'pet' }, {}])).toBe(
      'family'
    );
  });
});
