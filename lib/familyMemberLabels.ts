// ============================================================================
// familyMemberLabels.ts — pure family-member card badge/subtitle derivation
// ============================================================================
//
// Extracted from components/onboarding/FamilyMemberCard.tsx so these two
// pure functions can be unit-tested directly (this repo has no React
// Native component test harness — see tests/convex/*PhaseInvariants* doc
// comments for the documented precedent — and FamilyMemberCard.tsx itself
// cannot be imported from a bun test because it imports 'react-native' /
// '@expo/vector-icons', which crash the bun test runtime). No behavior
// change versus the previous in-component implementation.
// ============================================================================

import type { FamilyMember } from '../contexts/OnboardingContext';

// Only 3 real badge values — manual members return null (no badge rendered)
export type FamilyMemberBadge = 'מחובר' | 'שלח שוב' | 'שלח הזמנה' | null;

/**
 * Returns the connection-status badge for a family-member card.
 *
 * Backward compat: members without `sourceType` are inferred from
 * phone/contactId presence. QA fix: also treats `member.isConnected`
 * (read-only pending-family preview rows never carry a real
 * `matchedUserId` — see convex/members.ts#getMyPendingFamilyPreview — but
 * DO carry this safe boolean) as equivalent to a connected member.
 */
export function deriveFamilyMemberBadge(
  member: FamilyMember
): FamilyMemberBadge {
  if (member.matchedUserId || member.isConnected) return 'מחובר';
  const effectiveSourceType =
    member.sourceType ??
    (member.phone || member.contactId ? 'contact' : 'manual');
  const effectivePhone =
    member.selectedPhoneNumber ??
    (effectiveSourceType === 'contact' ? member.phone : undefined);
  if (effectiveSourceType === 'contact' && member.inviteStatus === 'invited')
    return 'שלח שוב';
  if (effectiveSourceType === 'contact' && effectivePhone) return 'שלח הזמנה';
  return null; // manual member — no badge
}

/**
 * Returns the family-member card's secondary (subtitle) line per the
 * approved display rule:
 *
 *   - connected (matchedUserId / isConnected): `null` — no manual/pending
 *     text at all (the "מחובר" badge already communicates this; avoid
 *     redundant/incorrect text).
 *   - contact/person with a known phone (admin view): the masked phone.
 *   - contact/person without a known phone (e.g. the read-only
 *     pending-family preview, which never exposes phone digits):
 *     "ממתין להתחברות" — NEVER "פרופיל ידני", since this is a real contact
 *     profile, just not yet connected to an InYomi account.
 *   - genuine manual profile (no phone/contact origin at all):
 *     "פרופיל ידני".
 *
 * Root cause of the prior bug: the pending-family preview mapping
 * (previewPersonMembers in app/(authenticated)/family-profile.tsx)
 * hardcoded `sourceType: 'manual'` for every row regardless of its real
 * origin, because the preview query exposed no distinguishing signal — so
 * every row fell through to the "פרופיל ידני" fallback text, even for
 * genuine contact profiles waiting to connect.
 */
export function deriveFamilyMemberSecondaryLabel(
  member: FamilyMember,
  isConnected: boolean
): string | null {
  const effectiveSourceType =
    member.sourceType ??
    (member.phone || member.contactId ? 'contact' : 'manual');
  const effectivePhone =
    member.maskedPhone ??
    (effectiveSourceType === 'contact' ? member.phone : undefined);
  if (effectivePhone) return effectivePhone;
  if (isConnected) return null;
  return effectiveSourceType === 'contact' ? 'ממתין להתחברות' : 'פרופיל ידני';
}
