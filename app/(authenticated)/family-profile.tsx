import { MaterialIcons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { normalizeIsraeliPhone } from '../../lib/phoneUtils';
import { maskPhone } from '../../lib/utils/contactPhone';
import { api } from '../../convex/_generated/api';
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
import { colors, shadows } from '../../constants/theme';
import type { FamilyMember } from '../../contexts/OnboardingContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
// FIXED: verified family member status reactivity after matchedUserId update
import {
  MAX_PEOPLE,
  MAX_PETS,
  useFamilyProfileEditor,
} from '../../hooks/useFamilyProfileEditor';

// FIXED: share-sheet invitation implemented for "שלח הזמנה" and "שלח שוב"
const INVITE_LINK = 'https://inyomi.app/join';

export default function FamilyProfileScreen() {
  const router = useRouter();
  const { data } = useOnboarding();

  // FIXED: removed isPersonalOnly flag — screen is unified for all space types
  const screenTitle = 'ניהול פרופיל';

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
  const {
    firstName,
    setFirstName,
    lastName,
    setLastName,
    nickname,
    setNickname,
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
    // FIXED: wired correct actions per family-member status
    convertingToContactId,
    markMemberInvited,
    startConvertToContact,
    handleContactForConversion,
    cancelConversion,
  } = editor;

  // FIXED: profile form now collapses to saved display card after save
  // FIXED: profile card now opens collapsed if user already has saved data
  const [profileSaved, setProfileSaved] = useState(
    () => firstName.trim().length > 0
  );

  // FIXED: "הוספה מאנשי קשר" now opens contact picker directly, skipping intermediate sheet
  const [openSheetToContacts, setOpenSheetToContacts] = useState(false);

  // FIXED: delete confirmation dialog text aligned right (RTL)
  const [deleteTarget, setDeleteTarget] = useState<FamilyMember | null>(null);

  const handleFirstNameChange = (v: string) => { setFirstName(v); setProfileSaved(false); };
  const handleLastNameChange = (v: string) => { setLastName(v); setProfileSaved(false); };
  const handleNicknameChange = (v: string) => { setNickname(v); setProfileSaved(false); };

  const handleSaveProfile = () => {
    handleSavePersonalName();
    setProfileSaved(true);
  };

  // FIXED: displayName shows "firstName lastName (nickname)" format
  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
  const displayName = fullName
    ? nickname.trim()
      ? `${fullName} (${nickname.trim()})`
      : fullName
    : 'הפרופיל שלך';

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
    b: FamilyMember['inviteStatus'],
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
        localMember.inviteStatus,
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
  const displayMembers: FamilyMember[] = isAdmin
    ? mergedPersonMembers
    : allServerMembers
        .filter((m) => m._id !== selfEntityId)
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
            maskedPhone: contact.maskedPhone ?? (phone ? maskPhone(phone) : undefined),
          };
        });

  // Look up the real Convex entity row _id from serverFamilyContacts for a given local member.
  // Used to pass to removeMember so removeEntityMember is called with the correct Convex ID,
  // ensuring the deletion propagates in real-time to all family members (e.g. Yaniv).
  const findEntityRowId = (member: FamilyMember): string | undefined => {
    const rows = serverFamilyContacts?.members ?? [];
    const matched = rows.find((s) => {
      if (member.selectedPhoneNumber && s.selectedPhoneNumber) {
        return normalizePhone(s.selectedPhoneNumber) === normalizePhone(member.selectedPhoneNumber);
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
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f7f8' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Top bar */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-1">
          <Pressable
            onPress={() => router.back()}
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
          <Text
            className="text-base font-bold text-right"
            style={{ color: colors.slate }}
          >
            {screenTitle}
          </Text>
          <View className="w-10" />
        </View>

        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 200 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Owner card ────────────────────────────────────────────────── */}
          {/* FIXED: replaced ownerFullName with split fields, removed fake camera affordance */}
          {/* FIXED: profile form now collapses to saved display card after save */}
          <Text className="text-xs font-bold text-gray-400 text-right mb-2 pr-1">
            השם שלך
          </Text>

          {profileSaved ? (
            <Pressable
              onPress={() => setProfileSaved(false)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`ערוך פרופיל — ${displayName}`}
              className="bg-white p-4 rounded-2xl flex-row items-center justify-between mb-6"
              style={shadows.soft}
            >
              <View className="p-2">
                <MaterialIcons name="edit" size={18} color="#9ca3af" />
              </View>
              <View className="flex-row-reverse items-center gap-3 flex-1">
                <View
                  style={{ backgroundColor: personalColor }}
                  className="w-10 h-10 rounded-full items-center justify-center"
                >
                  <Text className="text-xs font-bold text-white opacity-80">
                    {displayName.substring(0, 2)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text className="font-bold text-[15px] text-gray-900">
                    {displayName}
                  </Text>
                  {/* FIXED: admin badge shown on the personal card for the space admin */}
                  {isAdmin && (
                    <View style={{
                      marginTop: 3,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 99,
                      backgroundColor: '#e8f5fd',
                      alignSelf: 'flex-end',
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#36a9e2' }}>
                        מנהל/ת המשפחה
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          ) : (
            <View className="bg-white rounded-3xl p-5 mb-6" style={shadows.soft}>
              <View className="flex-row-reverse items-center gap-4 mb-4">
                <View
                  className="w-14 h-14 rounded-full items-center justify-center"
                  style={{ backgroundColor: personalColor }}
                >
                  <Text style={{ color: 'white', fontSize: 22, fontWeight: '700' }}>
                    {(firstName || '?').charAt(0)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-gray-400 text-right mb-1">
                    שם פרטי ושם משפחה
                  </Text>
                  <View className="flex-row-reverse gap-2 mb-2">
                    <TextInput
                      value={firstName}
                      onChangeText={handleFirstNameChange}
                      placeholder="שם פרטי"
                      placeholderTextColor="#9ca3af"
                      className="flex-1 bg-[#f6f7f8] rounded-xl px-3 text-right text-base"
                      style={{ height: 44 }}
                      returnKeyType="next"
                      accessible={true}
                      accessibilityLabel="שם פרטי"
                    />
                    <TextInput
                      value={lastName}
                      onChangeText={handleLastNameChange}
                      placeholder="שם משפחה"
                      placeholderTextColor="#9ca3af"
                      className="flex-1 bg-[#f6f7f8] rounded-xl px-3 text-right text-base"
                      style={{ height: 44 }}
                      returnKeyType="next"
                      accessible={true}
                      accessibilityLabel="שם משפחה"
                    />
                  </View>
                  <TextInput
                    value={nickname}
                    onChangeText={handleNicknameChange}
                    placeholder="כינוי (אופציונלי)"
                    placeholderTextColor="#9ca3af"
                    className="bg-[#f6f7f8] rounded-xl px-3 text-right text-base mb-2"
                    style={{ height: 44 }}
                    returnKeyType="done"
                    onSubmitEditing={handleSaveProfile}
                    accessible={true}
                    accessibilityLabel="כינוי"
                  />
                  {/* FIXED: replaced ✓ icon button with labeled "שמירת פרטים" button */}
                  <Pressable
                    onPress={handleSaveProfile}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="שמירת פרטים"
                    className="mt-1 h-12 rounded-xl items-center justify-center"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <Text className="text-white font-bold text-base">שמירת פרטים</Text>
                  </Pressable>
                  {personalSaved ? (
                    <Text
                      className="text-xs text-right mt-1"
                      style={{ color: colors.primary }}
                    >
                      נשמר ✓
                    </Text>
                  ) : null}
                </View>
              </View>
              <Text className="text-xs text-gray-400 text-right mb-2">
                בחירת צבע אישי
              </Text>
              {/* FIXED: taken colors now pass { color, name } for initials overlay */}
              <ColorPicker
                selectedColor={personalColor}
                onSelectColor={setPersonalColor}
                takenColors={familyMembers.map((m) => ({ color: m.color, name: m.name }))}
                size={38}
              />
            </View>
          )}

          {/* ── Family members section ─────────────────────────────────────── */}
          {/* FIXED: implemented family-member card UI with status chips and masked phone */}
          <Text className="text-sm font-bold text-gray-700 text-right mb-1 pr-1">
            בני משפחה נוספים (עד {MAX_PEOPLE})
          </Text>

          {/* Explainer text */}
          <Text className="text-xs text-gray-400 text-right mb-4 pr-1 leading-relaxed">
            אפשר להוסיף בני משפחה דרך אנשי קשר כדי להזמין אותם בהמשך, או ליצור פרופיל פנימי לילדים ובני משפחה בלי סמארטפון לצורך שיוך וסינון.
          </Text>

          {/* FIXED: add buttons hidden for members — admin only */}
          {isAdmin && canAddPerson && (
            <View className="flex-row-reverse gap-2 mb-4">
              {/* FIXED: opens contact picker directly, skipping intermediate sheet */}
              {/* FIXED: added pressed state feedback to "הוספה מאנשי קשר" button */}
              {/* FIXED: restored button box with NativeWind layout + dynamic pressed state via style function */}
              <Pressable
                onPress={() => { setOpenSheetToContacts(true); openAddPersonSheet(); }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="הוספה מאנשי קשר"
                className="flex-1 flex-row-reverse items-center justify-center gap-2 py-3 rounded-xl border"
                style={({ pressed }) => ({
                  borderColor: colors.primary,
                  backgroundColor: pressed ? '#bde3f7' : '#e8f5fd',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <MaterialIcons name="contacts" size={16} color={colors.primary} />
                <Text className="font-semibold text-sm" style={{ color: colors.primary }}>
                  הוספה מאנשי קשר
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { cancelPending(); startManualAddPerson(); }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="הוספה ידנית"
                className="flex-1 flex-row-reverse items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 bg-white"
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
              {/* FIXED: edit form only shown for admins — isAdmin guard added */}
              {displayMembers
                .filter((m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx)
                .map((member) =>
                isAdmin && editingId === member.id && pendingMember ? (
                  renderEditCard(member)
                ) : (
                  <FamilyMemberManagementCard
                    key={member.id}
                    member={member}
                    isAdmin={isAdmin}
                    adminUserId={adminUserId}
                    onEdit={() => startEditMember(member)}
                    onRemove={() => handleDeleteMember(member)}
                    onSendInvite={() => handleSendInvite(member)}
                    onConvertToContact={() => {
                      setOpenSheetToContacts(true);
                      startConvertToContact(member);
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
          {isAdmin && !canAddPerson && (
            <Text className="text-xs text-gray-300 text-center mb-5">
              הגעת למכסה של {MAX_PEOPLE} בני משפחה.
            </Text>
          )}

          {/* FIXED: read-only explainer for member role */}
          {!isAdmin && (
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
          <Text className="text-sm font-bold text-gray-700 text-right mb-1 pr-1">
            חיות מחמד (עד {MAX_PETS})
          </Text>
          <Text className="text-xs text-gray-400 text-right mb-3 pr-1">
            {/* FIXED: updated pets section description text */}
            הוסיפו את חיית המחמד שלכם כדי לעקוב אחרי כל המשימות והאירועים שלה
          </Text>
          <View className="bg-white rounded-3xl p-5 mb-4" style={shadows.soft}>
              {petMembers.length === 0 && !isAddingNewPet ? (
              <View className="items-center py-3" style={styles.dashedBorder}>
                <MaterialIcons name="pets" size={38} color="#d1d5db" />
                <Text className="text-gray-400 font-semibold mt-2 mb-1 text-center">
                  עדיין לא הוספת חיות מחמד
                </Text>
                {/* FIXED: pet add button hidden for members */}
                {isAdmin && canAddPet && (
                  <Pressable
                    onPress={handleAddPet}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוספת חיית מחמד"
                    className="flex-row-reverse items-center gap-2 mt-3 px-5 py-2.5 rounded-full border border-gray-300"
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
                {/* FIXED: pet edit form only for admins */}
                {petMembers.map((member) =>
                  isAdmin && editingId === member.id && pendingMember ? (
                    renderEditCard(member)
                  ) : (
                    <FamilyMemberDisplayCard
                      key={member.id}
                      member={member}
                      isAdmin={isAdmin}
                      onEdit={() => startEditMember(member)}
                      onRemove={() => removeMember(member.id, findEntityRowId(member))}
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
                {/* FIXED: pet add/quota UI hidden for members */}
                {isAdmin && (canAddPet ? (
                  <Pressable
                    onPress={handleAddPet}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוספת חיית מחמד נוספת"
                    className="flex-row-reverse items-center justify-center gap-2 py-3 border border-dashed border-gray-200 rounded-xl mt-1"
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
          convertingToContactId ? handleContactForConversion : handleContactSelected
        }
        onManual={startManualAddPerson}
        openContactsDirectly={openSheetToContacts}
      />

      {/* FIXED: delete confirmation dialog text aligned right (RTL) */}
      <Modal
        visible={deleteTarget !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}
          onPress={() => setDeleteTarget(null)}
          accessible={false}
        >
          <Pressable
            style={{ width: '82%', backgroundColor: 'white', borderRadius: 18, padding: 24 }}
            onPress={() => {}}
            accessible={false}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'right', marginBottom: 8 }}>
              מחיקת בן משפחה
            </Text>
            <Text style={{ fontSize: 14, color: '#6b7280', textAlign: 'right', lineHeight: 22, marginBottom: 24 }}>
              {`האם למחוק את ${deleteTarget?.name ?? ''} מהפרופיל המשפחתי?`}
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
              <Pressable
                onPress={() => {
                  if (deleteTarget) {
                    console.log('[DELETE] deleteTarget:', deleteTarget?.name, deleteTarget?.id);
                    console.log('[DELETE] findEntityRowId result:', findEntityRowId(deleteTarget));
                    console.log('[DELETE] serverFamilyContacts members:', JSON.stringify(serverFamilyContacts?.members?.map(m => ({ _id: m._id, displayName: m.displayName, selectedPhone: m.selectedPhoneNumber }))));
                    removeMember(deleteTarget.id, findEntityRowId(deleteTarget));
                  }
                  setDeleteTarget(null);
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="מחיקה"
                style={{ flex: 1, backgroundColor: '#fee2e2', borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#dc2626' }}>מחיקה</Text>
              </Pressable>
              <Pressable
                onPress={() => setDeleteTarget(null)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="ביטול"
                style={{ flex: 1, backgroundColor: '#f1f5f9', borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#374151' }}>ביטול</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  dashedBorder: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 16,
    width: '100%',
  },
});
