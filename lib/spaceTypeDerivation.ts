// ============================================================================
// spaceTypeDerivation.ts — Stage 2B+3 pure helper
// ============================================================================
//
// LOCKED PRODUCT RULE: the actual configured family members determine the
// new space's type when mandatory onboarding Profile Setup is completed —
// NEVER Q1 (onboardingIntent). Q1 is analytics/personalization only.
//
//   - Self only                                  → 'personal'
//   - Self + at least one actual PERSON member    → 'family'
//   - Pets alone must NOT make the space 'family'
//
// A member's `type` is 'person' | 'pet' | undefined. Rows/entries without
// an explicit type are treated as 'person' — this mirrors the existing
// convention already used across the backend (see convex/members.ts /
// convex/schema.ts memberType comments: "Rows without memberType were
// created before this field existed — treat as 'person'").
// ============================================================================

export interface SpaceTypeDerivationMember {
  type?: 'person' | 'pet';
}

export function deriveSpaceTypeFromFamilyMembers(
  familyMembers: SpaceTypeDerivationMember[]
): 'personal' | 'family' {
  const hasHumanFamilyMember = familyMembers.some((m) => m.type !== 'pet');
  return hasHumanFamilyMember ? 'family' : 'personal';
}
