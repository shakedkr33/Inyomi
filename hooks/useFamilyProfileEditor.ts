import { useMutation } from 'convex/react';
import { useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { api } from '@/convex/_generated/api';

import {
  PET_COLORS,
  PROFILE_COLORS,
} from '../components/onboarding/ColorPicker';
import type { SelectedContactData } from '../components/onboarding/AddPersonBottomSheet';
import type { FamilyMember } from '../contexts/OnboardingContext';
import { useOnboarding } from '../contexts/OnboardingContext';
// FIXED: added family-member status fields — maskPhone used when setting selectedPhoneNumber
import { maskPhone } from '../lib/utils/contactPhone';

export const MAX_PEOPLE = 5;
export const MAX_PETS = 5;

export interface PendingMember {
  name: string;
  color: string;
  type?: 'person' | 'pet';
  contactId?: string;
  phone?: string;
  email?: string;
  // FIXED: added family-member status fields — additive only
  sourceType?: 'contact' | 'manual';
  selectedPhoneNumber?: string;
  maskedPhone?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
  matchedUserId?: string;
}

/**
 * Shared state + handler logic for the family profile editor.
 *
 * Used by:
 *  - app/onboarding-step4.tsx  (starts with empty familyMembers)
 *  - app/(authenticated)/family-profile.tsx  (initialised from saved context data)
 */
export function useFamilyProfileEditor(
  initialFamilyMembers: FamilyMember[] = []
) {
  const { data, updateData } = useOnboarding();
  const finishOnboarding = useMutation(api.onboarding.finishOnboarding);
  const updateMyProfile = useMutation(api.users.updateMyProfile);
  // FIXED: removeMember now deletes from Convex members table, propagates to all devices
  const removeEntityMember = useMutation(api.members.removeEntityMember);

  // ── Core profile state ────────────────────────────────────────────────────
  // FIXED: added owner personal field hydration — reads firstName/lastName/nickname/personalColor from context
  const [firstName, setFirstName] = useState(data.firstName || '');
  const [lastName, setLastName] = useState(data.lastName || '');
  const [nickname, setNickname] = useState(data.nickname || '');
  const [personalColor, setPersonalColor] = useState<string>(
    data.personalColor || PROFILE_COLORS[5]
  );

  // Used in the Family Space owner card (pre-filled from firstName + lastName)
  const [ownerFullName, setOwnerFullName] = useState(
    data.firstName
      ? [data.firstName, data.lastName].filter(Boolean).join(' ')
      : ''
  );
  // FIXED: deduplicated family members on initialization to prevent false canAddPerson
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>(() =>
    (initialFamilyMembers ?? []).filter(
      (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i
    )
  );

  // ── Save-confirmation flash ───────────────────────────────────────────────
  const [ownerSaved, setOwnerSaved] = useState(false);
  const ownerSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [personalSaved, setPersonalSaved] = useState(false);
  const personalSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // ── Bottom sheet + inline edit ────────────────────────────────────────────
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [pendingMember, setPendingMember] = useState<PendingMember | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  // FIXED: wired correct actions per family-member status
  // Tracks which existing member is being converted to a contact-linked record.
  // Null when adding a new member via the normal flow.
  const [convertingToContactId, setConvertingToContactId] = useState<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const personMembers = familyMembers.filter((m) => m.type !== 'pet');
  const petMembers = familyMembers.filter((m) => m.type === 'pet');
  const canAddPerson = personMembers.length < MAX_PEOPLE;
  const canAddPet = petMembers.length < MAX_PETS;
  const isAddingNewPerson =
    !editingId && !!pendingMember && pendingMember.type !== 'pet';
  const isAddingNewPet = !editingId && pendingMember?.type === 'pet';

  // ── Color helpers ─────────────────────────────────────────────────────────

  const getAvailablePersonColor = (excludeId?: string): string => {
    const taken = new Set<string>([
      personalColor,
      ...personMembers.filter((m) => m.id !== excludeId).map((m) => m.color),
    ]);
    return (
      (PROFILE_COLORS.find((c) => !taken.has(c)) as string) ?? PROFILE_COLORS[0]
    );
  };

  const getAvailablePetColor = (excludeId?: string): string => {
    const taken = new Set<string>(
      petMembers.filter((m) => m.id !== excludeId).map((m) => m.color)
    );
    return (PET_COLORS.find((c) => !taken.has(c)) as string) ?? PET_COLORS[0];
  };

  // FIXED: taken colors now return { color, name } so initials can be rendered in swatches
  const getTakenColorsForPerson = (excludeId?: string) => {
    const ownerName =
      [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || 'אני';
    return [
      { color: personalColor, name: ownerName },
      ...personMembers
        .filter((m) => m.id !== excludeId)
        .map((m) => ({ color: m.color, name: m.name })),
    ];
  };

  const getTakenColorsForPet = (excludeId?: string) =>
    petMembers
      .filter((m) => m.id !== excludeId)
      .map((m) => ({ color: m.color, name: m.name }));

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openAddPersonSheet = () => {
    if (!canAddPerson) return;
    setEditingId(null);
    setPendingMember(null);
    setIsBottomSheetOpen(true);
  };

  const handleAddPet = () => {
    if (!canAddPet) return;
    setEditingId(null);
    setPendingMember({ name: '', color: getAvailablePetColor(), type: 'pet' });
  };

  const handleContactSelected = (data: SelectedContactData) => {
    // FIXED: added family-member status fields — contact-sourced members get sourceType + phone details
    const selectedPhone = data.phone ?? '';
    setPendingMember({
      name: data.name,
      color: getAvailablePersonColor(),
      type: 'person',
      contactId: data.contactId,
      phone: selectedPhone,
      email: data.email,
      sourceType: 'contact',
      selectedPhoneNumber: selectedPhone || undefined,
      maskedPhone: selectedPhone ? maskPhone(selectedPhone) : undefined,
      inviteStatus: 'none',
    });
  };

  const startManualAddPerson = () => {
    // FIXED: added family-member status fields — manual members get sourceType: 'manual'
    setPendingMember({
      name: '',
      color: getAvailablePersonColor(),
      type: 'person',
      sourceType: 'manual',
    });
  };

  const confirmPendingMember = () => {
    if (!pendingMember?.name.trim()) return;
    // Prevent adding the same contact twice
    if (pendingMember.contactId && !editingId) {
      const alreadyAdded = familyMembers.some(
        (m) => m.contactId === pendingMember.contactId
      );
      if (alreadyAdded) {
        cancelPending();
        return;
      }
    }
    const newMember: FamilyMember = {
      id: editingId ?? Date.now().toString(),
      name: pendingMember.name.trim(),
      color: pendingMember.color,
      type: pendingMember.type ?? 'person',
      contactId: pendingMember.contactId,
      phone: pendingMember.phone,
      email: pendingMember.email,
      // FIXED: preserve status fields through confirm
      sourceType: pendingMember.sourceType,
      selectedPhoneNumber: pendingMember.selectedPhoneNumber,
      maskedPhone: pendingMember.maskedPhone,
      inviteStatus: pendingMember.inviteStatus,
      matchedUserId: pendingMember.matchedUserId,
    };
    if (editingId) {
      setFamilyMembers((prev) => {
        const updated = prev.map((m) => (m.id === editingId ? newMember : m));
        updateMyProfile({ familyContacts: updated }).catch((e) => console.error('[CONFIRM] updateMyProfile error:', e));
        return updated;
      });
    } else {
      setFamilyMembers((prev) => {
        const updated = [...prev, newMember];
        console.log('[CONFIRM] calling updateMyProfile with', updated.length, 'contacts:', JSON.stringify(updated.map(m => ({ name: (m as any).name, selectedPhoneNumber: (m as any).selectedPhoneNumber }))));
        updateMyProfile({ familyContacts: updated })
          .then(() => console.log('[CONFIRM] updateMyProfile success'))
          .catch((e) => console.error('[CONFIRM] updateMyProfile error:', e));
        return updated;
      });
    }
    cancelPending();
  };

  const cancelPending = () => {
    setPendingMember(null);
    setEditingId(null);
    Keyboard.dismiss();
  };

  const startEditMember = (member: FamilyMember) => {
    setEditingId(member.id);
    setPendingMember({
      name: member.name,
      color: member.color,
      type: member.type,
      contactId: member.contactId,
      phone: member.phone,
      email: member.email,
      // FIXED: preserve status fields through edit
      sourceType: member.sourceType,
      selectedPhoneNumber: member.selectedPhoneNumber,
      maskedPhone: member.maskedPhone,
      inviteStatus: member.inviteStatus,
      matchedUserId: member.matchedUserId,
    });
  };

  // FIXED: removeMember now deletes from Convex members table, propagates to all devices
  // Two-pronged: removes from local state AND from the Convex members table.
  // removeEntityMember uses the member's id as the Convex _id (valid for members that
  // were hydrated from the server where id === members._id).
  // updateMyProfile syncs the remaining contacts blob so newly-added (Date.now id) members
  // are also removed from the server on next save.
  // convexEntityId: the real Convex _id from the members table for this entity row.
  // Callers who have access to serverFamilyContacts (family-profile.tsx) should look it
  // up and pass it so the entity row is deleted immediately, propagating to all devices.
  const removeMember = (id: string, convexEntityId?: string) => {
    console.log('[REMOVE] localId:', id, 'convexEntityId:', convexEntityId);
    const updated = familyMembers.filter((m) => m.id !== id);
    setFamilyMembers(updated);
    // Prefer the explicit convexEntityId; fall back to id if it looks like a Convex ID
    const entityIdToDelete = convexEntityId ?? (!/^\d+$/.test(id) ? id : undefined);
    console.log('[REMOVE] calling removeEntityMember?', !!entityIdToDelete, 'id:', entityIdToDelete);
    if (entityIdToDelete) {
      removeEntityMember({ memberId: entityIdToDelete as any }).catch((e) => console.error('[REMOVE] removeEntityMember error:', e));
    }
    updateMyProfile({ familyContacts: updated }).catch((e) => console.error('[REMOVE] updateMyProfile error:', e));
  };

  // FIXED: markMemberInvited now persists inviteStatus=invited to Convex immediately
  // Previously only updated local state — the members table row stayed 'none' forever.
  // Now computes the updated array first, then calls both setFamilyMembers and updateMyProfile.
  const markMemberInvited = (id: string) => {
    const updated = familyMembers.map((m) =>
      m.id === id ? { ...m, inviteStatus: 'invited' as const } : m
    );
    setFamilyMembers(updated);
    updateMyProfile({ familyContacts: updated }).catch(() => {});
  };

  // FIXED: "הפוך לאיש קשר" — opens the contact sheet targeting an existing member.
  // Opens the sheet in contacts mode; the caller also sets openSheetToContacts.
  const startConvertToContact = (member: FamilyMember) => {
    setConvertingToContactId(member.id);
    setEditingId(null);
    setPendingMember(null);
    setIsBottomSheetOpen(true);
  };

  // FIXED: "הפוך לאיש קשר" updates existing record in place, preserves existing fields.
  // Called instead of handleContactSelected when convertingToContactId is set.
  const handleContactForConversion = (data: SelectedContactData) => {
    if (!convertingToContactId) return;
    const selectedPhone = data.phone ?? '';
    setFamilyMembers((prev) =>
      prev.map((m) => {
        if (m.id !== convertingToContactId) return m;
        // Preserved: id, name, color, type, matchedUserId, and any other existing fields.
        // Updated: contact-link fields only.
        return {
          ...m,
          contactId: data.contactId,
          phone: selectedPhone,
          sourceType: 'contact' as const,
          selectedPhoneNumber: selectedPhone || undefined,
          maskedPhone: selectedPhone ? maskPhone(selectedPhone) : undefined,
          inviteStatus: 'none' as const,
        };
      })
    );
    setConvertingToContactId(null);
  };

  const cancelConversion = () => {
    setConvertingToContactId(null);
  };

  const handleSavePersonalName = () => {
    if (!firstName.trim()) return;
    updateData({
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      nickname: nickname.trim() || undefined,
      personalColor,
    });
    Keyboard.dismiss();
    if (personalSavedTimerRef.current)
      clearTimeout(personalSavedTimerRef.current);
    setPersonalSaved(true);
    personalSavedTimerRef.current = setTimeout(
      () => setPersonalSaved(false),
      1500
    );
  };

  const handleSaveOwnerName = () => {
    if (!ownerFullName.trim()) return;
    updateData({ firstName: ownerFullName.trim(), personalColor });
    Keyboard.dismiss();
    if (ownerSavedTimerRef.current) clearTimeout(ownerSavedTimerRef.current);
    setOwnerSaved(true);
    ownerSavedTimerRef.current = setTimeout(() => setOwnerSaved(false), 1500);
  };

  /**
   * Sync the current profile to OnboardingContext only — no Convex write.
   * // FIXED: removed premature saveAll() — deferred to post-OTP
   * Call this from onboarding step 4 before navigating to OTP.
   */
  const syncToContext = () => {
    const splitName = [firstName.trim(), lastName.trim()]
      .filter(Boolean)
      .join(' ');
    const nameSource = splitName || ownerFullName.trim() || 'משתמש';

    updateData({
      firstName: firstName.trim() || nameSource,
      lastName: lastName.trim() || undefined,
      nickname: nickname.trim() || undefined,
      personalColor,
      familyData: {
        owner: {
          firstName: firstName.trim() || nameSource,
          lastName: lastName.trim() || undefined,
          color: personalColor,
        },
        familyMembers,
      },
    });
  };

  /**
   * Persist the full profile to OnboardingContext and to Convex.
   * Returns the mutation Promise so callers can await completion before navigating.
   */
  const saveAll = (): Promise<{ spaceId: string }> => {
    // Build full name: prefer split firstName+lastName, fall back to ownerFullName
    const splitName = [firstName.trim(), lastName.trim()]
      .filter(Boolean)
      .join(' ');
    const nameSource = splitName || ownerFullName.trim() || 'משתמש';

    // Update in-memory context
    updateData({
      firstName: firstName.trim() || nameSource,
      lastName: lastName.trim() || undefined,
      nickname: nickname.trim() || undefined,
      personalColor,
      familyData: {
        owner: {
          firstName: firstName.trim() || nameSource,
          lastName: lastName.trim() || undefined,
          color: personalColor,
        },
        familyMembers,
      },
    });

    // Persist to Convex — sets onboardingCompleted: true on the user record
    // Only called for new users from the authenticated layout; returning users use saveProfile()
    return finishOnboarding({
      fullName: nameSource,
      profileColor: personalColor,
      spaceType: data.spaceType ?? 'personal',
      challenges: data.challenges ?? [],
      sources: data.sources ?? [],
      childCount: data.childCount,
    });
  };

  /**
   * Persist profile updates to Convex for returning users (no new space created).
   * // FIXED: family profile persistence — use this instead of saveAll() in family-profile.tsx
   */
  const saveProfile = (): Promise<void> => {
    const splitName = [firstName.trim(), lastName.trim()]
      .filter(Boolean)
      .join(' ');
    const nameSource = splitName || ownerFullName.trim() || 'משתמש';

    updateData({
      firstName: firstName.trim() || nameSource,
      lastName: lastName.trim() || undefined,
      nickname: nickname.trim() || undefined,
      personalColor,
      familyData: {
        owner: {
          firstName: firstName.trim() || nameSource,
          lastName: lastName.trim() || undefined,
          color: personalColor,
        },
        familyMembers,
      },
    });

    // FIXED: deduplicated members before persisting to prevent future duplicates
    const deduped = familyMembers.filter(
      (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i
    );
    return updateMyProfile({
      fullName: nameSource,
      profileColor: personalColor,
      familyContacts: deduped,
    });
  };

  return {
    // state
    firstName,
    setFirstName,
    lastName,
    setLastName,
    nickname,
    setNickname,
    personalColor,
    setPersonalColor,
    ownerFullName,
    setOwnerFullName,
    familyMembers,
    pendingMember,
    setPendingMember,
    editingId,
    isBottomSheetOpen,
    setIsBottomSheetOpen,
    ownerSaved,
    personalSaved,
    // derived
    personMembers,
    petMembers,
    canAddPerson,
    canAddPet,
    isAddingNewPerson,
    isAddingNewPet,
    // color helpers
    getAvailablePersonColor,
    getAvailablePetColor,
    getTakenColorsForPerson,
    getTakenColorsForPet,
    // save helpers
    syncToContext,
    saveAll,
    saveProfile,
    // handlers
    openAddPersonSheet,
    handleAddPet,
    handleContactSelected,
    startManualAddPerson,
    confirmPendingMember,
    cancelPending,
    startEditMember,
    removeMember,
    handleSavePersonalName,
    handleSaveOwnerName,
    // FIXED: wired correct actions per family-member status
    convertingToContactId,
    markMemberInvited,
    startConvertToContact,
    handleContactForConversion,
    cancelConversion,
  };
}
