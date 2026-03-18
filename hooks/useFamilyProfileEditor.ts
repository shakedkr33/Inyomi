import { useMutation } from 'convex/react';
import * as Contacts from 'expo-contacts';
import { useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { api } from '@/convex/_generated/api';

import {
  PET_COLORS,
  PROFILE_COLORS,
} from '../components/onboarding/ColorPicker';
import type { FamilyMember } from '../contexts/OnboardingContext';
import { useOnboarding } from '../contexts/OnboardingContext';

export const MAX_PEOPLE = 5;
export const MAX_PETS = 5;

export interface PendingMember {
  name: string;
  color: string;
  type?: 'person' | 'pet';
  contactId?: string;
  phone?: string;
  email?: string;
}

const MOBILE_LABELS = new Set(['mobile', 'iphone', 'cell', 'נייד', 'cellular']);

function getBestPhone(
  phoneNumbers?: Contacts.PhoneNumber[]
): string | undefined {
  if (!phoneNumbers?.length) return undefined;
  const mobile = phoneNumbers.find((p) =>
    MOBILE_LABELS.has((p.label ?? '').toLowerCase())
  );
  return (mobile ?? phoneNumbers[0]).number ?? undefined;
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

  // ── Core profile state ────────────────────────────────────────────────────
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
  const [familyMembers, setFamilyMembers] =
    useState<FamilyMember[]>(initialFamilyMembers);

  // ── Save-confirmation flash ───────────────────────────────────────────────
  const [ownerSaved, setOwnerSaved] = useState(false);
  const ownerSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [personalSaved, setPersonalSaved] = useState(false);
  const personalSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // ── Contact picker guard ──────────────────────────────────────────────────
  const isPickingContactRef = useRef(false);

  // ── Bottom sheet + inline edit ────────────────────────────────────────────
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [pendingMember, setPendingMember] = useState<PendingMember | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);

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

  const getTakenColorsForPerson = (excludeId?: string): string[] => [
    personalColor,
    ...personMembers.filter((m) => m.id !== excludeId).map((m) => m.color),
  ];

  const getTakenColorsForPet = (excludeId?: string): string[] =>
    petMembers.filter((m) => m.id !== excludeId).map((m) => m.color);

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

  const pickContact = async () => {
    if (isPickingContactRef.current) return;
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') return;

    isPickingContactRef.current = true;
    try {
      const contact = await Contacts.presentContactPickerAsync();
      if (contact) {
        const phone = getBestPhone(contact.phoneNumbers);
        const email = contact.emails?.[0]?.email;
        const rawName = contact.name?.trim();
        const combinedName = [
          contact.firstName?.trim(),
          contact.lastName?.trim(),
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
        const name = rawName || combinedName || 'איש קשר';
        setPendingMember({
          name,
          color: getAvailablePersonColor(),
          type: 'person',
          contactId: contact.id,
          phone,
          email,
        });
      }
    } catch {
      // user cancelled or native picker error — do nothing
    } finally {
      isPickingContactRef.current = false;
    }
  };

  const startManualAddPerson = () => {
    setPendingMember({
      name: '',
      color: getAvailablePersonColor(),
      type: 'person',
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
    };
    if (editingId) {
      setFamilyMembers((prev) =>
        prev.map((m) => (m.id === editingId ? newMember : m))
      );
    } else {
      setFamilyMembers((prev) => [...prev, newMember]);
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
    });
  };

  const removeMember = (id: string) => {
    setFamilyMembers((prev) => prev.filter((m) => m.id !== id));
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

  /** Delay allows the bottom sheet animation to finish before the native picker opens. */
  const handleFromContacts = () => {
    setTimeout(() => pickContact(), 350);
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
    return finishOnboarding({
      fullName: nameSource,
      profileColor: personalColor,
      spaceType: data.spaceType ?? 'personal',
      challenges: data.challenges ?? [],
      sources: data.sources ?? [],
      childCount: data.childCount,
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
    // handlers
    openAddPersonSheet,
    handleAddPet,
    startManualAddPerson,
    confirmPendingMember,
    cancelPending,
    startEditMember,
    removeMember,
    handleSavePersonalName,
    handleSaveOwnerName,
    handleFromContacts,
    saveAll,
  };
}
