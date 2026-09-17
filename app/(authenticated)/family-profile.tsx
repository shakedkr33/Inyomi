import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_IS_RTL, needsExplicitRTL, rtl, tw } from '@/lib/rtl';
import {
  ensureContactsAccess,
  presentContactsAccessDeniedAlert,
} from '@/lib/utils/contactsPermission';
import { AddPersonBottomSheet } from '../../components/onboarding/AddPersonBottomSheet';
import {
  ColorPicker,
  PET_COLORS,
  PROFILE_COLORS,
} from '../../components/onboarding/ColorPicker';
import {
  FamilyMemberDisplayCard,
  FamilyMemberEditCard,
  FamilyMemberManagementCard,
} from '../../components/onboarding/FamilyMemberCard';
import { UpgradeModal } from '../../components/UpgradeModal';
import { colors, shadows } from '../../constants/theme';
import type { FamilyMember } from '../../contexts/OnboardingContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { api } from '../../convex/_generated/api';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

import { useEffectiveAccess } from '../../hooks/useEffectiveAccess';
// FIXED: verified family member status reactivity after matchedUserId update
import {
  MAX_PEOPLE,
  MAX_PETS,
  useFamilyProfileEditor,
} from '../../hooks/useFamilyProfileEditor';
import { getSelfProfileAvatarInitials } from '../../lib/avatarInitials';
import {
  canManageFamilyProfile as canManageFamilyProfileHelper,
  isMandatorySetupSaveDisabled,
} from '../../lib/mandatoryProfileSetup';
import { normalizeIsraeliPhone } from '../../lib/phoneUtils';
import { maskPhone } from '../../lib/utils/contactPhone';

// FIXED: share-sheet invitation implemented for "שלח הזמנה" and "שלח שוב"
const INVITE_LINK = 'https://inyomi.app/join';

export default function FamilyProfileScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const isFamilyProfileSetupPath =
    pathname?.includes('family-profile-setup') ?? false;
  const markFamilySetupSkipped = useMutation(api.users.markFamilySetupSkipped);
  const { data } = useOnboarding();

  // Stage 2B+3: family-profile-setup is reached in two distinct contexts —
  // MANDATORY (onboarding still incomplete: first name required, no skip,
  // must explicitly complete onboarding) or OPTIONAL (returning user who is
  // already onboardingCompleted, reached via family-bootstrap's existing
  // "hasn't configured family yet" nudge — unchanged behavior). The route
  // itself cannot tell these apart; only the server's onboarding-complete
  // status can.
  const userStatus = useQuery(
    api.users.getCurrentUserStatus,
    isFamilyProfileSetupPath ? {} : 'skip'
  );
  const isMandatorySetup =
    isFamilyProfileSetupPath && userStatus?.onboardingComplete === false;
  // Kept for readability at call sites below — same boolean, existing name.
  const isOptionalPostAuthSetup = isFamilyProfileSetupPath && !isMandatorySetup;

  const screenTitle = !isFamilyProfileSetupPath
    ? 'ניהול פרופיל'
    : isMandatorySetup
      ? 'השלמת הפרופיל שלך'
      : 'רוצה להשלים את הפרופיל שלך?';

  // Initialise from previously saved context data (unlike onboarding which starts empty)
  const editor = useFamilyProfileEditor(data.familyData?.familyMembers ?? []);

  // FIXED: family-profile now merges live Convex matchedUserId into local member state
  // Subscribe to the members table directly so matchedUserId / inviteStatus are always
  // current — no polling, no useEffect, no risk of infinite loop.
  const serverFamilyContacts = useQuery(api.members.listMyFamilyContacts);

  // FIXED: role-aware family profile screen
  // getMySpaceRole → tells if current user is admin or member in their space
  // getSpaceAdminId → returns the userId of the admin, for showing the admin badge
  // on any entity row whose matchedUserId matches the admin (e.g. admin added by a member)
  const mySpaceRole = useQuery(api.members.getMySpaceRole);
  const spaceAdminUserId = useQuery(api.members.getSpaceAdminId);
  // FIXED: admin badge shown only for admin user
  // Previously defaulted to `true` while loading, causing the badge to flash for members.
  // mySpaceRole?.role === 'admin' is false for undefined (loading) and null (no space),
  // so there is no incorrect flash.
  const isAdmin = mySpaceRole?.role === 'admin';
  const adminUserId = spaceAdminUserId ?? undefined;
  // FIXED: mandatory Profile Setup happens BEFORE any space exists, so
  // mySpaceRole is always null at that point and isAdmin is always false —
  // which previously hid every family-member/pet "add" action during
  // mandatory onboarding (bug: no usable add action available). During
  // mandatory setup the user is editing their OWN in-progress, not-yet-
  // persisted family/pet list (local editor state only — nothing is written
  // to the members table until saveAll()/finishOnboarding runs), so there is
  // no real admin/member distinction to enforce yet. canManageFamilyProfile
  // gates add/edit/remove affordances; isAdmin (unchanged) still gates the
  // "מנהל/ת המשפחה" badge and the real per-space role for completed users.
  // See lib/mandatoryProfileSetup.ts for the (unit-tested) pure rule.
  const canManageFamilyProfile = canManageFamilyProfileHelper(
    isMandatorySetup,
    isAdmin
  );
  const {
    firstName,
    setFirstName,
    lastName,
    setLastName,
    personalColor,
    setPersonalColor,
    familyMembers,
    pendingMember,
    setPendingMember,
    editingId,
    isBottomSheetOpen,
    setIsBottomSheetOpen,
    personalSaved,
    personMembers,
    petMembers,
    canAddPerson,
    canAddPet,
    isAddingNewPerson,
    isAddingNewPet,
    getTakenColorsForPerson,
    getTakenColorsForPet,
    openAddPersonSheet,
    handleAddPet,
    startManualAddPerson,
    confirmPendingMember,
    cancelPending,
    startEditMember,
    removeMember,
    handleSavePersonalName,
    handleContactSelected,
    saveProfile,
    saveAll,
    // FIXED: wired correct actions per family-member status
    convertingToContactId,
    markMemberInvited,
    startConvertToContact,
    handleContactForConversion,
    cancelConversion,
  } = editor;

  // FIXED: routing bug — this screen is mounted as a Tabs.Screen inside the
  // authenticated Tabs navigator (see app/(authenticated)/_layout.tsx). Bottom
  // tab navigators do not implement the REPLACE navigation action (only
  // stack navigators do), so replacing to the sibling index tab from here
  // produced: `The action 'REPLACE' with payload {"name":"index","params":{}}
  // was not handled by any navigator.` router.navigate() performs a normal
  // tab switch instead, which IS handled by the Tabs navigator.
  const handleSkipOptionalSetup = (): void => {
    markFamilySetupSkipped()
      .then(() => router.navigate('/(authenticated)'))
      .catch(() => router.navigate('/(authenticated)'));
  };

  const [isSavingOptionalSetup, setIsSavingOptionalSetup] = useState(false);
  // Stage 2B+3: mandatory Profile Setup completion (onboarding still
  // incomplete). Uses the canonical finishOnboarding path via saveAll() —
  // no second competing completion mutation.
  const [isSavingMandatorySetup, setIsSavingMandatorySetup] = useState(false);
  const [mandatorySetupError, setMandatorySetupError] = useState<string | null>(
    null
  );
  const { effectiveAccess } = useEffectiveAccess();
  const canExpandFamilyProfile =
    effectiveAccess === 'trial_active' || effectiveAccess === 'family';
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);

  function handleGatedFamilyExpansionAction(action: () => void): void {
    if (!canExpandFamilyProfile) {
      setUpgradeModalVisible(true);
      return;
    }
    action();
  }

  const handleSaveOptionalSetup = (): void => {
    if (isSavingOptionalSetup) return;

    setIsSavingOptionalSetup(true);
    saveProfile()
      .then(() => router.navigate('/(authenticated)'))
      .catch(() => {
        Alert.alert('שגיאה', 'לא הצלחנו לשמור כרגע. אפשר לנסות שוב.');
      })
      .finally(() => setIsSavingOptionalSetup(false));
  };

  // Stage 2B+3: mandatory completion — first name is required (save button
  // is disabled until it is non-empty, see the footer below), there is no
  // skip button, and the canonical finishOnboarding path (via saveAll())
  // explicitly completes onboarding before navigating Home. On failure the
  // user stays on this screen with a retryable error — Home is never
  // reached with onboardingCompleted still false.
  const handleSaveMandatorySetup = (): void => {
    if (isSavingMandatorySetup) return;
    if (!firstName.trim()) return;

    setMandatorySetupError(null);
    setIsSavingMandatorySetup(true);
    saveAll()
      .then(() => {
        router.navigate('/(authenticated)');
      })
      .catch(() => {
        setMandatorySetupError('לא הצלחנו לשמור כרגע. אפשר לנסות שוב.');
      })
      .finally(() => setIsSavingMandatorySetup(false));
  };

  // FIXED: profile form now collapses to saved display card after save
  // FIXED: profile card now opens collapsed if user already has saved data
  const [profileSaved, setProfileSaved] = useState(
    () => firstName.trim().length > 0
  );

  // FIXED: "הוספה מאנשי קשר" now opens contact picker directly, skipping intermediate sheet
  const [openSheetToContacts, setOpenSheetToContacts] = useState(false);

  // FIXED: delete confirmation dialog text aligned right (RTL)
  const [deleteTarget, setDeleteTarget] = useState<FamilyMember | null>(null);

  const handleFirstNameChange = (v: string) => {
    setFirstName(v);
    setProfileSaved(false);
  };
  const handleLastNameChange = (v: string) => {
    setLastName(v);
    setProfileSaved(false);
  };

  const handleSaveProfile = () => {
    handleSavePersonalName();
    setProfileSaved(true);
  };

  // FIXED: nickname removed from self-profile UI (locked product decision)
  // — display name is derived from firstName + lastName only. Any legacy
  // nickname value still stored client-side is preserved but no longer
  // rendered or relied upon here.
  const fullName = [firstName.trim(), lastName.trim()]
    .filter(Boolean)
    .join(' ');
  const displayName = fullName || 'הפרופיל שלך';
  // FIXED: "הפ" placeholder-initials bug — getSelfProfileAvatarInitials
  // returns '' (no letters, color circle only) until firstName is entered;
  // it never falls back to a placeholder label like "הפרופיל שלך".
  const profileInitials = getSelfProfileAvatarInitials({ firstName, lastName });

  // FIXED: family-profile now merges live Convex matchedUserId into local member state
  // personMembers comes from OnboardingContext (editing source of truth).
  // serverFamilyContacts is a live Convex query — it updates automatically when
  // matchedUserId / inviteStatus changes in the members table (e.g. after OTP registration).
  // We merge the two: display logic uses server data, edit/save logic keeps local state.

  // FIXED: phone comparison normalizes both sides before comparing.
  // The Convex members table stores E.164 (+972...) but local state stores the raw contact
  // phone (05...). Without normalization, serverMatch is always undefined and matchedUserId
  // never propagates to the display.
  const normalizePhone = (p: string | undefined): string | undefined =>
    p ? (normalizeIsraeliPhone(p) ?? p) : undefined;

  // FIXED: inviteStatus merge uses max-rank instead of ?? to avoid server's stale 'none'
  // overwriting local 'invited'. ('none' is truthy so ?? would always pick 'none'.)
  const statusRank: Record<string, number> = { none: 0, invited: 1, joined: 2 };
  const maxInviteStatus = (
    a: FamilyMember['inviteStatus'],
    b: FamilyMember['inviteStatus']
  ): FamilyMember['inviteStatus'] => {
    const ra = statusRank[a ?? 'none'] ?? 0;
    const rb = statusRank[b ?? 'none'] ?? 0;
    return ra >= rb ? a : b;
  };

  const mergedPersonMembers = personMembers.map((localMember) => {
    const localNorm = normalizePhone(localMember.selectedPhoneNumber);
    const serverMatch = localNorm
      ? serverFamilyContacts?.members.find(
          (s) => normalizePhone(s.selectedPhoneNumber) === localNorm
        )
      : undefined;
    if (!serverMatch) return localMember;
    return {
      ...localMember,
      matchedUserId: serverMatch.matchedUserId ?? localMember.matchedUserId,
      inviteStatus: maxInviteStatus(
        serverMatch.inviteStatus as FamilyMember['inviteStatus'],
        localMember.inviteStatus
      ),
    };
  });

  // FIXED: member users now see all family members except themselves.
  // selfEntityId identifies the signed-in user's own entity row so it can be excluded.
  // mergedPersonMembers is always empty for non-admin users (their OnboardingContext
  // has no family data). Non-admin users read the list straight from the server query.
  // FIXED: admin user now appears in family list for member users — adminEntry prepended
  // server-side; matchedUserId on that entry equals spaceAdminUserId so the existing
  // adminUserId badge logic in FamilyMemberManagementCard fires automatically.
  const selfEntityId = serverFamilyContacts?.selfEntityId;
  const allServerMembers = serverFamilyContacts?.members ?? [];

  // FIXED: member users now see all family members except themselves.
  // FIXED: admin entry now includes phone from users record, shown as linked user not manual.
  // sourceType derived from selectedPhoneNumber so FamilyMemberManagementCard shows the
  // correct secondary label (masked phone) instead of "פרופיל ידני".
  // FIXED: pets visible to non-admin members — allServerMembers now carries memberType
  // from the database; non-admin view filters out pets here and shows them in the pets section.
  // FIXED: during mandatory setup canManageFamilyProfile is true (no space
  // exists yet, so isAdmin is always false there) — must still read the
  // local in-progress editor state (mergedPersonMembers), not the server
  // query branch, or newly-added members added before the space exists
  // would never render in the list.
  const displayMembers: FamilyMember[] = canManageFamilyProfile
    ? mergedPersonMembers
    : allServerMembers
        .filter((m) => m._id !== selfEntityId && m.memberType !== 'pet')
        .map((contact) => {
          const phone = contact.selectedPhoneNumber;
          return {
            id: contact._id,
            name: contact.displayName ?? '',
            color: contact.color ?? '#36a9e2',
            type: 'person' as const,
            selectedPhoneNumber: phone,
            matchedUserId: contact.matchedUserId,
            inviteStatus: contact.inviteStatus as FamilyMember['inviteStatus'],
            sourceType: phone ? ('contact' as const) : ('manual' as const),
            maskedPhone:
              contact.maskedPhone ?? (phone ? maskPhone(phone) : undefined),
          };
        });

  // FIXED: non-admin members now see pets in the pets section.
  // Admin reads from local editor state (petMembers) so in-progress edits are reflected.
  // Non-admin reads from the server query filtered to memberType === 'pet'.
  const displayPetMembers: FamilyMember[] = canManageFamilyProfile
    ? petMembers
    : allServerMembers
        .filter((m) => m.memberType === 'pet')
        .map((contact) => ({
          id: contact._id,
          name: contact.displayName ?? '',
          color: contact.color ?? '#36a9e2',
          type: 'pet' as const,
          selectedPhoneNumber: contact.selectedPhoneNumber,
          matchedUserId: contact.matchedUserId,
          inviteStatus: contact.inviteStatus as FamilyMember['inviteStatus'],
          sourceType: 'manual' as const,
        }));

  // Look up the real Convex entity row _id from serverFamilyContacts for a given local member.
  // Used to pass to removeMember so removeEntityMember is called with the correct Convex ID,
  // ensuring the deletion propagates in real-time to all family members (e.g. Yaniv).
  const findEntityRowId = (member: FamilyMember): string | undefined => {
    const rows = serverFamilyContacts?.members ?? [];
    const matched = rows.find((s) => {
      if (member.selectedPhoneNumber && s.selectedPhoneNumber) {
        return (
          normalizePhone(s.selectedPhoneNumber) ===
          normalizePhone(member.selectedPhoneNumber)
        );
      }
      return s.displayName === member.name;
    });
    return matched?._id;
  };

  // FIXED: removed redundant bottom "שמירה" button — each section has its own save action
  // router.back() is called directly from the top-bar back button.

  // FIXED: share-sheet invitation implemented for "שלח הזמנה" and "שלח שוב"
  const handleSendInvite = async (member: FamilyMember) => {
    const message = `היי, הזמנתי אותך להצטרף ל-InYomi כדי לצפות באירועים ובמשימות שאני משתפת איתך. אפשר להצטרף דרך הקישור: ${INVITE_LINK}`;
    try {
      const result = await Share.share({ message });
      // Mark as invited on any sharing action (dismissed = user closed without sharing)
      if (result.action !== Share.dismissedAction) {
        markMemberInvited(member.id);
      }
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשתף כרגע.');
    }
  };

  // FIXED: delete confirmation dialog text aligned right (RTL) — uses custom modal
  const handleDeleteMember = (member: FamilyMember) => {
    setDeleteTarget(member);
  };

  // ── Shared edit card renderer ─────────────────────────────────────────────

  const renderEditCard = (member: FamilyMember) => {
    if (editingId !== member.id || !pendingMember) return null;
    const isPet = member.type === 'pet';
    return (
      <FamilyMemberEditCard
        key={`edit-${member.id}`}
        name={pendingMember.name}
        color={pendingMember.color}
        palette={isPet ? PET_COLORS : PROFILE_COLORS}
        takenColors={
          isPet
            ? getTakenColorsForPet(member.id)
            : getTakenColorsForPerson(member.id)
        }
        onChangeName={(t) => setPendingMember((p) => p && { ...p, name: t })}
        onChangeColor={(c) => setPendingMember((p) => p && { ...p, color: c })}
        onConfirm={confirmPendingMember}
        onCancel={cancelPending}
        label="עריכה:"
      />
    );
  };

  return (
    <SafeAreaView
      style={[
        { flex: 1, backgroundColor: '#f6f7f8' },
        ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null,
      ]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Top bar */}
        {/* FIXED: bumped horizontal margin from px-5 to px-6 (matches the
            24px horizontal margin convention already used elsewhere in the
            onboarding flow, e.g. phone-match-confirmation.tsx) — QA reported
            content feeling pushed against the screen edge. */}
        <View
          className={`${tw.flexRow} items-center justify-between px-6 pt-3 pb-1`}
        >
          {isMandatorySetup ? (
            // Stage 2B+3: no back navigation in mandatory mode — there is
            // no valid destination while onboarding is still incomplete
            // (Home must never be reached with onboardingCompleted false).
            <View className="p-2 w-10" />
          ) : (
            <Pressable
              onPress={() =>
                isOptionalPostAuthSetup
                  ? router.navigate('/(authenticated)')
                  : router.back()
              }
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="חזרה"
              className="p-2"
            >
              <MaterialIcons
                name="arrow-forward"
                size={24}
                color={colors.slate}
              />
            </Pressable>
          )}
          <Text
            className={`text-base font-bold ${tw.textStart}`}
            style={{ color: colors.slate }}
          >
            {screenTitle}
          </Text>
          <View className="w-10" />
        </View>

        {isOptionalPostAuthSetup ? (
          <View className="px-6 pb-3">
            <Text
              className={`${tw.textStart} text-sm leading-relaxed text-gray-600`}
            >
              אפשר לדלג עכשיו ולהשלים את זה בהמשך דרך ההגדרות.
            </Text>
          </View>
        ) : null}
        {isMandatorySetup ? (
          <View className="px-6 pb-3">
            <Text
              className={`${tw.textStart} text-sm leading-relaxed text-gray-600`}
            >
              השם הפרטי הוא שדה חובה להשלמת ההרשמה. בני משפחה הם אופציונליים.
            </Text>
          </View>
        ) : null}

        <ScrollView
          className="flex-1 px-6"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 200 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Owner card ────────────────────────────────────────────────── */}
          {/* FIXED: replaced ownerFullName with split fields, removed fake camera affordance */}
          {/* FIXED: profile form now collapses to saved display card after save */}
          <Text
            className={`text-xs font-bold text-gray-400 ${tw.textStart} mb-2 pr-1`}
          >
            השם שלך
          </Text>

          {profileSaved ? (
            <Pressable
              onPress={() => setProfileSaved(false)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`ערוך פרופיל — ${displayName}`}
              className={`bg-white p-4 rounded-2xl ${tw.flexRow} items-center justify-between mb-6`}
              style={shadows.soft}
            >
              {/* Name + avatar — first child renders on the physical RIGHT (RTL
                  start) with tw.flexRow + justify-between, matching the
                  FamilyMemberDisplayCard convention. */}
              <View className={`${tw.flexRow} items-center gap-3 flex-1`}>
                <View
                  style={{ backgroundColor: personalColor }}
                  className="w-10 h-10 rounded-full items-center justify-center"
                >
                  <Text className="text-xs font-bold text-white opacity-80">
                    {profileInitials}
                  </Text>
                </View>
                <View
                  style={{
                    alignItems: needsExplicitRTL() ? 'flex-end' : 'flex-start',
                  }}
                >
                  <Text className="font-bold text-[15px] text-gray-900">
                    {displayName}
                  </Text>
                  {/* FIXED: admin badge shown on the personal card for the space admin */}
                  {isAdmin && (
                    <View
                      style={{
                        marginTop: 3,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 99,
                        backgroundColor: '#e8f5fd',
                        alignSelf: rtl.alignStart,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: '700',
                          color: '#36a9e2',
                        }}
                      >
                        מנהל/ת המשפחה
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              {/* Edit pencil — second child renders on the physical LEFT (RTL end) */}
              <View className="p-2">
                <MaterialIcons name="edit" size={18} color="#9ca3af" />
              </View>
            </Pressable>
          ) : (
            <View
              className="bg-white rounded-3xl p-5 mb-6"
              style={shadows.soft}
            >
              <View className={`${tw.flexRow} items-center gap-4 mb-4`}>
                <View
                  className="w-14 h-14 rounded-full items-center justify-center"
                  style={{ backgroundColor: personalColor }}
                >
                  <Text
                    style={{ color: 'white', fontSize: 22, fontWeight: '700' }}
                  >
                    {profileInitials}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text
                    className={`text-xs text-gray-400 ${tw.textStart} mb-1`}
                  >
                    שם פרטי ושם משפחה
                  </Text>
                  <View className={`${tw.flexRow} gap-2 mb-2`}>
                    <TextInput
                      value={firstName}
                      onChangeText={handleFirstNameChange}
                      placeholder="שם פרטי"
                      placeholderTextColor="#9ca3af"
                      className="flex-1 bg-[#f6f7f8] rounded-xl px-3 text-base"
                      style={{ height: 44, textAlign: rtl.inputTextAlign }}
                      returnKeyType="next"
                      accessible={true}
                      accessibilityLabel="שם פרטי"
                    />
                    <TextInput
                      value={lastName}
                      onChangeText={handleLastNameChange}
                      placeholder="שם משפחה"
                      placeholderTextColor="#9ca3af"
                      className="flex-1 bg-[#f6f7f8] rounded-xl px-3 text-base"
                      style={{ height: 44, textAlign: rtl.inputTextAlign }}
                      returnKeyType="done"
                      onSubmitEditing={handleSaveProfile}
                      accessible={true}
                      accessibilityLabel="שם משפחה"
                    />
                  </View>
                  {/* FIXED: nickname field removed from self-profile UI (locked
                      product decision) — first/last name only. */}
                  {/* FIXED: replaced ✓ icon button with labeled "שמירת פרטים" button */}
                  <Pressable
                    onPress={handleSaveProfile}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="שמירת פרטים"
                    className="mt-1 h-12 rounded-xl items-center justify-center"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <Text className="text-white font-bold text-base">
                      שמירת פרטים
                    </Text>
                  </Pressable>
                  {personalSaved ? (
                    <Text
                      className={`text-xs ${tw.textStart} mt-1`}
                      style={{ color: colors.primary }}
                    >
                      נשמר ✓
                    </Text>
                  ) : null}
                </View>
              </View>
              <Text className={`text-xs text-gray-400 ${tw.textStart} mb-2`}>
                בחירת צבע אישי
              </Text>
              {/* FIXED: taken colors now pass { color, name } for initials overlay */}
              <ColorPicker
                selectedColor={personalColor}
                onSelectColor={setPersonalColor}
                takenColors={familyMembers.map((m) => ({
                  color: m.color,
                  name: m.name,
                }))}
                size={38}
              />
            </View>
          )}

          {/* ── Family members section ─────────────────────────────────────── */}
          {/* FIXED: implemented family-member card UI with status chips and masked phone */}
          <Text
            className={`text-sm font-bold text-gray-700 ${tw.textStart} mb-1 pr-1`}
          >
            בני משפחה נוספים (עד {MAX_PEOPLE})
          </Text>

          {/* Explainer text */}
          <Text
            className={`text-xs text-gray-400 ${tw.textStart} mb-4 pr-1 leading-relaxed`}
          >
            אפשר להוסיף בני משפחה דרך אנשי קשר כדי להזמין אותם בהמשך, או ליצור
            פרופיל פנימי לילדים ובני משפחה בלי סמארטפון לצורך שיוך וסינון.
          </Text>

          {/* FIXED: add buttons hidden for members — admin (or mandatory
              setup, where there is no space/admin yet) only */}
          {canManageFamilyProfile && canAddPerson && (
            <View className={`${tw.flexRow} gap-2 mb-4`}>
              {/* FIXED: opens contact picker directly, skipping intermediate sheet */}
              {/* FIXED: added pressed state feedback to "הוספה מאנשי קשר" button */}
              {/* FIXED: restored button box with NativeWind layout + dynamic pressed state via style function */}
              <Pressable
                onPress={() => {
                  handleGatedFamilyExpansionAction(() => {
                    void (async () => {
                      const { granted, canAskAgain } =
                        await ensureContactsAccess();
                      if (!granted) {
                        presentContactsAccessDeniedAlert(canAskAgain);
                        return;
                      }
                      setOpenSheetToContacts(true);
                      openAddPersonSheet();
                    })();
                  });
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="הוספה מאנשי קשר"
                className={`flex-1 ${tw.flexRow} items-center justify-center gap-2 py-3 rounded-xl border`}
                style={({ pressed }) => ({
                  borderColor: colors.primary,
                  backgroundColor: pressed ? '#bde3f7' : '#e8f5fd',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <MaterialIcons
                  name="contacts"
                  size={16}
                  color={colors.primary}
                />
                <Text
                  className="font-semibold text-sm"
                  style={{ color: colors.primary }}
                >
                  הוספה מאנשי קשר
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  handleGatedFamilyExpansionAction(() => {
                    cancelPending();
                    startManualAddPerson();
                  });
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="הוספה ידנית"
                className={`flex-1 ${tw.flexRow} items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 bg-white`}
              >
                <MaterialIcons name="person-add" size={16} color="#6b7280" />
                <Text className="font-semibold text-sm text-gray-600">
                  הוספה ידנית
                </Text>
              </Pressable>
            </View>
          )}

          {/* Member list */}
          {displayMembers.length === 0 && !isAddingNewPerson ? (
            <View className="items-center py-5 mb-5">
              <MaterialIcons name="group" size={36} color="#d1d5db" />
              <Text className="text-gray-400 text-center mt-2 text-sm">
                עדיין לא הוספת בני משפחה
              </Text>
            </View>
          ) : (
            <View className="mb-5">
              {/* FIXED: prevented duplicate card render for same family member */}
              {/* FIXED: edit form only shown for admins (or mandatory setup) */}
              {displayMembers
                .filter(
                  (m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx
                )
                .map((member) =>
                  canManageFamilyProfile &&
                  editingId === member.id &&
                  pendingMember ? (
                    renderEditCard(member)
                  ) : (
                    <FamilyMemberManagementCard
                      key={member.id}
                      member={member}
                      isAdmin={canManageFamilyProfile}
                      adminUserId={adminUserId}
                      onEdit={() => startEditMember(member)}
                      onRemove={() => handleDeleteMember(member)}
                      onSendInvite={() => handleSendInvite(member)}
                      onConvertToContact={() => {
                        void (async () => {
                          const { granted, canAskAgain } =
                            await ensureContactsAccess();
                          if (!granted) {
                            presentContactsAccessDeniedAlert(canAskAgain);
                            return;
                          }
                          setOpenSheetToContacts(true);
                          startConvertToContact(member);
                        })();
                      }}
                    />
                  )
                )}
              {isAddingNewPerson && pendingMember && (
                <FamilyMemberEditCard
                  name={pendingMember.name}
                  color={pendingMember.color}
                  palette={PROFILE_COLORS}
                  takenColors={getTakenColorsForPerson()}
                  onChangeName={(t) =>
                    setPendingMember((p) => p && { ...p, name: t })
                  }
                  onChangeColor={(c) =>
                    setPendingMember((p) => p && { ...p, color: c })
                  }
                  onConfirm={confirmPendingMember}
                  onCancel={cancelPending}
                  label="הוספת בן משפחה:"
                />
              )}
            </View>
          )}

          {/* FIXED: max-quota message only relevant for admins */}
          {canManageFamilyProfile && !canAddPerson && (
            <Text className="text-xs text-gray-300 text-center mb-5">
              הגעת למכסה של {MAX_PEOPLE} בני משפחה.
            </Text>
          )}

          {/* FIXED: read-only explainer for member role — never shown during
              mandatory setup (canManageFamilyProfile is true there, so this
              is naturally hidden), since a brand-new user has no family
              space yet and the copy would be confusing. Unchanged for
              existing completed non-admin family members. */}
          {!canManageFamilyProfile && (
            <Text
              style={{
                fontSize: 12,
                color: '#9ca3af',
                textAlign: 'center',
                marginBottom: 16,
                paddingHorizontal: 16,
                lineHeight: 18,
              }}
            >
              רק מנהל/ת המשפחה יכול/ה לערוך את הפרופיל המשפחתי
            </Text>
          )}

          {/* ── Pets section ───────────────────────────────────────────────── */}
          <Text
            className={`text-sm font-bold text-gray-700 ${tw.textStart} mb-1 pr-1`}
          >
            חיות מחמד (עד {MAX_PETS})
          </Text>
          <Text className={`text-xs text-gray-400 ${tw.textStart} mb-3 pr-1`}>
            {/* FIXED: updated pets section description text */}
            הוסיפו את חיית המחמד שלכם כדי לעקוב אחרי כל המשימות והאירועים שלה
          </Text>
          <View className="bg-white rounded-3xl p-5 mb-4" style={shadows.soft}>
            {displayPetMembers.length === 0 && !isAddingNewPet ? (
              <View className="items-center py-3" style={styles.dashedBorder}>
                <MaterialIcons name="pets" size={38} color="#d1d5db" />
                <Text className="text-gray-400 font-semibold mt-2 mb-1 text-center">
                  עדיין לא הוספת חיות מחמד
                </Text>
                {/* FIXED: pet add button hidden for members (or shown during
                    mandatory setup, where there is no space/admin yet) */}
                {canManageFamilyProfile && canAddPet && (
                  <Pressable
                    onPress={() =>
                      handleGatedFamilyExpansionAction(handleAddPet)
                    }
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוספת חיית מחמד"
                    className={`${tw.flexRow} items-center gap-2 mt-3 px-5 py-2.5 rounded-full border border-gray-300`}
                  >
                    <MaterialIcons
                      name="pets"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={{ color: colors.primary }}
                      className="font-semibold"
                    >
                      הוספת חיית מחמד
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                {/* FIXED: pet edit form only for admins (or mandatory setup) */}
                {displayPetMembers.map((member) =>
                  canManageFamilyProfile &&
                  editingId === member.id &&
                  pendingMember ? (
                    renderEditCard(member)
                  ) : (
                    <FamilyMemberDisplayCard
                      key={member.id}
                      member={member}
                      isAdmin={canManageFamilyProfile}
                      onEdit={
                        canManageFamilyProfile
                          ? () => startEditMember(member)
                          : undefined
                      }
                      onRemove={
                        canManageFamilyProfile
                          ? () =>
                              removeMember(member.id, findEntityRowId(member))
                          : undefined
                      }
                    />
                  )
                )}
                {isAddingNewPet && pendingMember && (
                  <FamilyMemberEditCard
                    name={pendingMember.name}
                    color={pendingMember.color}
                    palette={PET_COLORS}
                    takenColors={getTakenColorsForPet()}
                    onChangeName={(t) =>
                      setPendingMember((p) => p && { ...p, name: t })
                    }
                    onChangeColor={(c) =>
                      setPendingMember((p) => p && { ...p, color: c })
                    }
                    onConfirm={confirmPendingMember}
                    onCancel={cancelPending}
                    label="הוספת חיית מחמד:"
                  />
                )}
                {/* FIXED: pet add/quota UI hidden for members (or shown
                    during mandatory setup) */}
                {canManageFamilyProfile &&
                  (canAddPet ? (
                    <Pressable
                      onPress={() =>
                        handleGatedFamilyExpansionAction(handleAddPet)
                      }
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="הוספת חיית מחמד נוספת"
                      className={`${tw.flexRow} items-center justify-center gap-2 py-3 border border-dashed border-gray-200 rounded-xl mt-1`}
                    >
                      <MaterialIcons
                        name="pets"
                        size={18}
                        color={colors.primary}
                      />
                      <Text
                        style={{ color: colors.primary }}
                        className="font-semibold"
                      >
                        הוספת חיית מחמד
                      </Text>
                    </Pressable>
                  ) : (
                    <Text className="text-xs text-gray-300 text-center mt-2">
                      הגעת למכסה של {MAX_PETS} חיות מחמד.
                    </Text>
                  ))}
              </>
            )}
          </View>
        </ScrollView>

        {isFamilyProfileSetupPath ? (
          <View className="border-t border-gray-200 bg-[#f6f7f8] px-6 pb-4 pt-4">
            {mandatorySetupError ? (
              <Text className={`${tw.textStart} mb-2 text-sm text-red-600`}>
                {mandatorySetupError}
              </Text>
            ) : null}
            <Pressable
              onPress={
                isMandatorySetup
                  ? handleSaveMandatorySetup
                  : handleSaveOptionalSetup
              }
              disabled={
                isMandatorySetup
                  ? isMandatorySetupSaveDisabled(
                      firstName,
                      isSavingMandatorySetup
                    )
                  : isSavingOptionalSetup
              }
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="שמירה והמשך"
              className="mb-3 h-12 items-center justify-center rounded-2xl bg-[#36a9e2]"
              style={{
                opacity:
                  isMandatorySetup && !firstName.trim() ? 0.5 : undefined,
              }}
            >
              <Text className="font-bold text-base text-white">
                שמירה והמשך
              </Text>
            </Pressable>
            {/* Stage 2B+3: no skip button in mandatory mode — onboarding
                must be explicitly completed before Home is reachable. */}
            {isOptionalPostAuthSetup ? (
              <Pressable
                onPress={handleSkipOptionalSetup}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="דלגי עכשיו"
                className="h-12 items-center justify-center rounded-xl py-2"
              >
                <Text className="text-center text-base text-gray-600">
                  דלגי עכשיו
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* FIXED: "הפוך לאיש קשר" updates existing record in place, preserves existing fields */}
      <AddPersonBottomSheet
        visible={isBottomSheetOpen}
        onClose={() => {
          setIsBottomSheetOpen(false);
          setOpenSheetToContacts(false);
          cancelConversion();
        }}
        onContactSelected={
          convertingToContactId
            ? handleContactForConversion
            : handleContactSelected
        }
        onManual={startManualAddPerson}
        openContactsDirectly={openSheetToContacts}
      />

      <UpgradeModal
        visible={upgradeModalVisible}
        reason="family"
        onClose={() => setUpgradeModalVisible(false)}
      />

      {/* FIXED: delete confirmation dialog text aligned right (RTL) */}
      <Modal
        visible={deleteTarget !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onPress={() => setDeleteTarget(null)}
          accessible={false}
        >
          <Pressable
            style={{
              width: '82%',
              backgroundColor: 'white',
              borderRadius: 18,
              padding: 24,
            }}
            onPress={() => {}}
            accessible={false}
          >
            <Text
              style={{
                fontSize: 17,
                fontWeight: '700',
                color: '#111827',
                textAlign: rtl.textAlign,
                marginBottom: 8,
              }}
            >
              מחיקת בן משפחה
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: '#6b7280',
                textAlign: rtl.textAlign,
                lineHeight: 22,
                marginBottom: 24,
              }}
            >
              {`האם למחוק את ${deleteTarget?.name ?? ''} מהפרופיל המשפחתי?`}
            </Text>
            <View style={{ flexDirection: rtl.flexDirection, gap: 10 }}>
              <Pressable
                onPress={() => {
                  if (deleteTarget) {
                    console.log(
                      '[DELETE] deleteTarget:',
                      deleteTarget?.name,
                      deleteTarget?.id
                    );
                    console.log(
                      '[DELETE] findEntityRowId result:',
                      findEntityRowId(deleteTarget)
                    );
                    console.log(
                      '[DELETE] serverFamilyContacts members:',
                      JSON.stringify(
                        serverFamilyContacts?.members?.map((m) => ({
                          _id: m._id,
                          displayName: m.displayName,
                          selectedPhone: m.selectedPhoneNumber,
                        }))
                      )
                    );
                    removeMember(
                      deleteTarget.id,
                      findEntityRowId(deleteTarget)
                    );
                  }
                  setDeleteTarget(null);
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="מחיקה"
                style={{
                  flex: 1,
                  backgroundColor: '#fee2e2',
                  borderRadius: 10,
                  paddingVertical: 13,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{ fontSize: 15, fontWeight: '600', color: '#dc2626' }}
                >
                  מחיקה
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setDeleteTarget(null)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="ביטול"
                style={{
                  flex: 1,
                  backgroundColor: '#f1f5f9',
                  borderRadius: 10,
                  paddingVertical: 13,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{ fontSize: 15, fontWeight: '600', color: '#374151' }}
                >
                  ביטול
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeAreaRtl: {
    direction: 'rtl',
  },
  dashedBorder: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 16,
    width: '100%',
  },
});
