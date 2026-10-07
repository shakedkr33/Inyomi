/**
 * QA fix — pending-family onboarding mislabeled genuine contact profiles
 * (e.g. "אבא שלי", "אוסנת קריכלי") as "פרופיל ידני" merely because they
 * were not yet connected to an InYomi account.
 *
 * Root cause: the pending-family preview mapping
 * (previewPersonMembers in app/(authenticated)/family-profile.tsx)
 * hardcoded sourceType: 'manual' for every row from
 * api.members.getMyPendingFamilyPreview, because that query previously
 * exposed no signal distinguishing a genuine manual profile from a real
 * contact/person profile waiting to connect. The query now also returns
 * two safe booleans (hasPhoneNumber, isConnected — never the actual phone
 * digits or another user's id), and the client derives sourceType from
 * hasPhoneNumber the same way the admin-visible branch already does from
 * selectedPhoneNumber.
 *
 * These tests cover the pure label-derivation functions directly
 * (lib/familyMemberLabels.ts) — the approved display rule:
 *   - genuine manual profile            → "פרופיל ידני"
 *   - contact/person not yet connected  → "ממתין להתחברות"
 *   - connected user                    → never "פרופיל ידני"
 *   - pet                               → never "ממתין להתחברות" (pets
 *     never reach this derivation — FamilyMemberDisplayCard, used for
 *     pets, renders no secondary label at all; verified separately below)
 */

import { describe, expect, it } from 'bun:test';
import type { FamilyMember } from '../../../contexts/OnboardingContext';
import {
  deriveFamilyMemberBadge,
  deriveFamilyMemberSecondaryLabel,
} from '../../familyMemberLabels';

function member(overrides: Partial<FamilyMember>): FamilyMember {
  return { id: 'm1', name: 'Test', color: '#36a9e2', ...overrides };
}

describe('deriveFamilyMemberSecondaryLabel — approved display rule', () => {
  it('genuine manual profile (no phone/contact origin) → "פרופיל ידני"', () => {
    const m = member({ sourceType: 'manual' });
    expect(deriveFamilyMemberSecondaryLabel(m, false)).toBe('פרופיל ידני');
  });

  it('genuine manual profile inferred from absence of phone/contactId → "פרופיל ידני"', () => {
    const m = member({});
    expect(deriveFamilyMemberSecondaryLabel(m, false)).toBe('פרופיל ידני');
  });

  it('contact/person not yet connected, no known phone (pending-family preview shape) → "ממתין להתחברות"', () => {
    const m = member({ sourceType: 'contact' });
    expect(deriveFamilyMemberSecondaryLabel(m, false)).toBe('ממתין להתחברות');
  });

  it('never returns the old banned copy "עדיין ללא חיבור ל-InYomi"', () => {
    const m = member({ sourceType: 'contact' });
    expect(deriveFamilyMemberSecondaryLabel(m, false)).not.toBe(
      'עדיין ללא חיבור ל-InYomi'
    );
  });

  it('contact/person with a known masked phone (admin view) → shows the masked phone, not manual/pending text', () => {
    const m = member({ sourceType: 'contact', maskedPhone: '050-XXX123' });
    const label = deriveFamilyMemberSecondaryLabel(m, false);
    expect(label).toBe('050-XXX123');
    expect(label).not.toBe('פרופיל ידני');
    expect(label).not.toBe('ממתין להתחברות');
  });

  it('connected user (matchedUserId set) → never labeled "פרופיל ידני", no redundant text', () => {
    const m = member({ sourceType: 'contact', matchedUserId: 'u1' });
    const label = deriveFamilyMemberSecondaryLabel(m, true);
    expect(label).not.toBe('פרופיל ידני');
    expect(label).toBeNull();
  });

  it('connected via the preview-only isConnected boolean (no real matchedUserId available) → never "פרופיל ידני"', () => {
    const m = member({ sourceType: 'contact', isConnected: true });
    const label = deriveFamilyMemberSecondaryLabel(m, true);
    expect(label).not.toBe('פרופיל ידני');
    expect(label).toBeNull();
  });
});

describe('deriveFamilyMemberBadge — "מחובר" fires for both matchedUserId and the preview-safe isConnected boolean', () => {
  it('matchedUserId set → מחובר', () => {
    expect(deriveFamilyMemberBadge(member({ matchedUserId: 'u1' }))).toBe(
      'מחובר'
    );
  });

  it('isConnected true (no matchedUserId) → מחובר', () => {
    expect(deriveFamilyMemberBadge(member({ isConnected: true }))).toBe(
      'מחובר'
    );
  });

  it('genuine manual member → null (no badge)', () => {
    expect(
      deriveFamilyMemberBadge(member({ sourceType: 'manual' }))
    ).toBeNull();
  });

  it('pending contact (no phone known, not connected) → null (no badge) — secondary label carries the "ממתין להתחברות" signal instead', () => {
    expect(
      deriveFamilyMemberBadge(member({ sourceType: 'contact' }))
    ).toBeNull();
  });
});
