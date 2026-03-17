import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddPersonBottomSheet } from '../components/onboarding/AddPersonBottomSheet';
import {
  ColorPicker,
  PET_COLORS,
  PROFILE_COLORS,
} from '../components/onboarding/ColorPicker';
import {
  FamilyMemberDisplayCard,
  FamilyMemberEditCard,
} from '../components/onboarding/FamilyMemberCard';
import { colors, shadows } from '../constants/theme';
import type { FamilyMember } from '../contexts/OnboardingContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import {
  MAX_PEOPLE,
  MAX_PETS,
  useFamilyProfileEditor,
} from '../hooks/useFamilyProfileEditor';

// ── Shared progress header ────────────────────────────────────────────────────

function ProgressHeader({
  onBack,
  backLabel,
}: {
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <View className="pt-4 px-6">
      <View className="flex-row-reverse items-center justify-between mb-4">
        <Pressable
          onPress={onBack}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          className="p-2"
        >
          <MaterialIcons name="arrow-forward" size={24} color={colors.slate} />
        </Pressable>
        <Text style={{ color: colors.sage }} className="font-bold">
          שלב 4 מתוך 4
        </Text>
        <View className="w-10" />
      </View>
      <View className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
        <View
          className="h-full w-full rounded-full"
          style={{ backgroundColor: colors.sage }}
        />
      </View>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingStep4() {
  const router = useRouter();
  const { data } = useOnboarding();

  const initialView: 'personal' | 'family' =
    data.spaceType === 'personal' ? 'personal' : 'family';
  const cameFromPersonal = data.spaceType === 'personal';

  const [currentView, setCurrentView] = useState<'personal' | 'family'>(
    initialView
  );

  const editor = useFamilyProfileEditor();
  const {
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
    handleSaveOwnerName,
    handleFromContacts,
    saveAll,
  } = editor;

  // ── Navigation ────────────────────────────────────────────────────────────

  const handlePersonalContinue = () => {
    // Pre-fill owner name from split fields so the family view is pre-populated
    const fullName = [firstName.trim(), lastName.trim()]
      .filter(Boolean)
      .join(' ');
    setOwnerFullName(fullName || firstName);
    setCurrentView('family');
  };

  const handleFamilyBack = () => {
    if (cameFromPersonal) {
      setCurrentView('personal');
    } else {
      router.back();
    }
  };

  const handleFamilyFinish = async () => {
    await saveAll();
    router.replace('/(authenticated)');
  };

  // ── Edit card renderer ────────────────────────────────────────────────────

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

  // ── Render: Personal profile view ─────────────────────────────────────────

  if (currentView === 'personal') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f7f8' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ProgressHeader onBack={() => router.back()} backLabel="חזרה" />

          <ScrollView
            className="flex-1 px-5"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: 20, paddingBottom: 160 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Section title */}
            <Text
              className="text-[24px] font-bold text-center mb-1 leading-tight"
              style={{ color: colors.slate }}
            >
              הפרופיל שלך ב-InYomi
            </Text>
            <Text className="text-sm text-gray-400 text-center mb-6">
              כאן נגדיר איך תופיע/י בתוך הלוז
            </Text>

            {/* Profile card */}
            <View className="bg-white rounded-3xl p-5 mb-4" style={shadows.soft}>

              {/* Name row: first + last on same line */}
              <Text className="text-sm font-bold text-gray-700 text-right mb-2">
                שם פרטי ושם משפחה
              </Text>
              <View className="flex-row-reverse gap-2 mb-1">
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="שם פרטי"
                  placeholderTextColor="#9ca3af"
                  className="flex-1 bg-[#f6f7f8] rounded-2xl px-3 text-right text-base"
                  style={{ height: 50 }}
                  returnKeyType="next"
                  accessible={true}
                  accessibilityLabel="שם פרטי"
                />
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="שם משפחה"
                  placeholderTextColor="#9ca3af"
                  className="flex-1 bg-[#f6f7f8] rounded-2xl px-3 text-right text-base"
                  style={{ height: 50 }}
                  returnKeyType="next"
                  accessible={true}
                  accessibilityLabel="שם משפחה"
                />
              </View>

              {/* Nickname — optional */}
              <Text className="text-xs text-gray-400 text-right mb-1 mt-3">
                כינוי (אופציונלי — לשימוש פנימי)
              </Text>
              <View
                className="flex-row items-center bg-[#f6f7f8] rounded-2xl overflow-hidden mb-1"
                style={{ minHeight: 50 }}
              >
                <Pressable
                  onPress={handleSavePersonalName}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="שמור פרטים"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                  className="w-14 self-stretch items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <MaterialIcons name="check" size={22} color="white" />
                </Pressable>
                <TextInput
                  value={nickname}
                  onChangeText={setNickname}
                  placeholder="למשל: דנה׳לה, אבא, אמא..."
                  placeholderTextColor="#9ca3af"
                  className="flex-1 px-3 text-base text-right"
                  style={{ height: 50 }}
                  returnKeyType="done"
                  onSubmitEditing={handleSavePersonalName}
                  accessible={true}
                  accessibilityLabel="כינוי"
                />
              </View>
              {personalSaved ? (
                <Text
                  className="text-xs text-right mt-1 mb-3"
                  style={{ color: colors.primary }}
                >
                  נשמר ✓
                </Text>
              ) : (
                <View className="mb-4" />
              )}

              {/* Color picker */}
              <Text className="text-sm font-bold text-gray-700 text-right mb-3">
                בחירת צבע אישי
              </Text>
              <Text className="text-xs text-gray-400 text-right mb-3">
                הצבע שלך יזהה אותך בלוז, במשימות ובאירועים משותפים
              </Text>
              <ColorPicker
                selectedColor={personalColor}
                onSelectColor={setPersonalColor}
              />
            </View>

            {/* Sharing prompt card */}
            <View className="bg-white rounded-3xl p-5" style={shadows.soft}>
              <Text className="text-base font-bold text-gray-900 text-right mb-1">
                רוצה לשתף את הלוז עם מישהו?
              </Text>
              <Text className="text-sm text-gray-400 text-right mb-4">
                הוסיפ/י את האנשים שתרצה/י לשתף איתם אירועים, משימות ותזכורות
              </Text>
              <Pressable
                onPress={handlePersonalContinue}
                accessible={true}
                accessibilityRole="link"
                accessibilityLabel="הוסיפי אנשים לשיתוף"
              >
                <Text
                  className="text-right font-semibold"
                  style={{ color: colors.primary }}
                >
                  הוסיפ/י אנשים לשיתוף ←
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Footer CTA */}
          <View
            className="px-5 pb-10 pt-4"
            style={{ backgroundColor: 'rgba(246,247,248,0.97)' }}
          >
            <Pressable
              onPress={handlePersonalContinue}
              disabled={!firstName.trim()}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="המשך"
              className="w-full h-16 rounded-2xl items-center justify-center"
              style={[
                {
                  backgroundColor: firstName.trim()
                    ? colors.primary
                    : '#e5e7eb',
                },
                shadows.primaryCta,
              ]}
            >
              <Text className="text-white font-bold text-lg">המשך</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Render: Sharing / family view ─────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f7f8' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ProgressHeader onBack={handleFamilyBack} backLabel="חזרה" />

        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 200 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Owner card ─────────────────────────────────────────────────── */}
          <Text className="text-xs font-bold text-gray-400 text-right mb-2 pr-1">
            הפרופיל שלך
          </Text>
          <View className="bg-white rounded-3xl p-5 mb-6" style={shadows.soft}>
            <View className="flex-row-reverse items-center gap-4 mb-4">
              <View
                className="w-14 h-14 rounded-full items-center justify-center"
                style={{ backgroundColor: personalColor }}
              >
                <MaterialIcons name="person" size={28} color="white" />
              </View>
              <View className="flex-1">
                <Text className="text-xs text-gray-400 text-right mb-1">
                  השם שלך
                </Text>
                <View
                  className="flex-row items-center bg-[#f6f7f8] rounded-xl overflow-hidden"
                  style={{ minHeight: 44 }}
                >
                  <Pressable
                    onPress={handleSaveOwnerName}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="שמור שם"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                    className="w-12 self-stretch items-center justify-center"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <MaterialIcons name="check" size={20} color="white" />
                  </Pressable>
                  <TextInput
                    value={ownerFullName}
                    onChangeText={setOwnerFullName}
                    placeholder="שם פרטי ושם משפחה"
                    placeholderTextColor="#9ca3af"
                    className="flex-1 px-3 text-right text-base"
                    style={{ height: 44 }}
                    returnKeyType="done"
                    onSubmitEditing={handleSaveOwnerName}
                  />
                </View>
                {ownerSaved ? (
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
              צבע אישי
            </Text>
            <ColorPicker
              selectedColor={personalColor}
              onSelectColor={setPersonalColor}
              takenColors={familyMembers.map((m) => m.color)}
              size={38}
            />
          </View>

          {/* ── People / sharing section ──────────────────────────────────── */}
          <Text className="text-sm font-bold text-gray-700 text-right mb-1 pr-1">
            עם מי תרצה/י לשתף את הלוז? (עד {MAX_PEOPLE})
          </Text>
          <Text className="text-xs text-gray-400 text-right mb-2 pr-1 leading-relaxed">
            הוסיפ/י את האנשים שתרצה/י לשתף איתם אירועים, משימות ותזכורות
          </Text>

          {/* Disclaimer */}
          <View
            className="rounded-2xl px-4 py-3 mb-4 flex-row-reverse items-start border"
            style={{
              backgroundColor: 'rgba(74, 159, 226, 0.05)',
              borderColor: 'rgba(74, 159, 226, 0.15)',
            }}
          >
            <MaterialIcons
              name="info-outline"
              size={16}
              color={colors.sage}
              style={{ marginLeft: 8, marginTop: 1 }}
            />
            <Text className="flex-1 text-xs text-gray-500 text-right leading-relaxed">
              האנשים שתוסיף/י כאן לא ישותפו אוטומטית. בכל אירוע, משימה או
              תזכורת תוכל/י לבחור עם מי לשתף.
            </Text>
          </View>

          <View className="bg-white rounded-3xl p-5 mb-5" style={shadows.soft}>
            {personMembers.length === 0 && !isAddingNewPerson ? (
              <View className="items-center py-3" style={styles.dashedBorder}>
                <MaterialIcons name="group" size={38} color="#d1d5db" />
                <Text className="text-gray-400 font-semibold mt-2 mb-1 text-center">
                  עדיין לא הוספת אנשים
                </Text>
                <Text className="text-xs text-gray-300 text-center mb-4 px-4">
                  הוסיפ/י ילדים, בן/בת זוג, הורים — כל מי שתרצה/י לשתף איתו
                </Text>
                {canAddPerson && (
                  <Pressable
                    onPress={openAddPersonSheet}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוספת אדם לשיתוף"
                    className="flex-row-reverse items-center gap-2 px-5 py-2.5 rounded-full border border-gray-300"
                  >
                    <MaterialIcons
                      name="person-add"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={{ color: colors.primary }}
                      className="font-semibold"
                    >
                      הוסיפ/י אדם +
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                {personMembers.map((member) =>
                  editingId === member.id && pendingMember ? (
                    renderEditCard(member)
                  ) : (
                    <FamilyMemberDisplayCard
                      key={member.id}
                      member={member}
                      onEdit={() => startEditMember(member)}
                      onRemove={() => removeMember(member.id)}
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
                    label="הוספת אדם:"
                  />
                )}
                {canAddPerson ? (
                  <Pressable
                    onPress={openAddPersonSheet}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוספת אדם נוסף"
                    className="flex-row-reverse items-center justify-center gap-2 py-3 border border-dashed border-gray-200 rounded-xl mt-1"
                  >
                    <MaterialIcons
                      name="person-add"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={{ color: colors.primary }}
                      className="font-semibold"
                    >
                      הוסיפ/י אדם נוסף +
                    </Text>
                  </Pressable>
                ) : (
                  <Text className="text-xs text-gray-300 text-center mt-2">
                    הגעת למכסה של {MAX_PEOPLE} אנשים.
                  </Text>
                )}
              </>
            )}
          </View>

          {/* ── Pets section — secondary ──────────────────────────────────── */}
          <Text className="text-xs font-bold text-gray-400 text-right mb-1 pr-1">
            חיות מחמד (אופציונלי, עד {MAX_PETS})
          </Text>
          <Text className="text-xs text-gray-400 text-right mb-3 pr-1">
            כדי שלא נפספס ימי הולדת 🐾
          </Text>
          <View className="bg-white rounded-3xl p-5 mb-4" style={shadows.soft}>
            {petMembers.length === 0 && !isAddingNewPet ? (
              <View className="items-center py-3" style={styles.dashedBorder}>
                <MaterialIcons name="pets" size={38} color="#d1d5db" />
                <Text className="text-gray-400 font-semibold mt-2 mb-1 text-center">
                  עדיין לא הוספת חיות מחמד
                </Text>
                {canAddPet && (
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
                {petMembers.map((member) =>
                  editingId === member.id && pendingMember ? (
                    renderEditCard(member)
                  ) : (
                    <FamilyMemberDisplayCard
                      key={member.id}
                      member={member}
                      onEdit={() => startEditMember(member)}
                      onRemove={() => removeMember(member.id)}
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
                {canAddPet ? (
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
                )}
              </>
            )}
          </View>

          <Text className="text-xs text-gray-400 text-center px-4 mt-1">
            תוכל/י לערוך ולהוסיף אנשים גם בהגדרות בהמשך.
          </Text>
        </ScrollView>

        {/* Footer CTA */}
        <View
          className="px-5 pb-10 pt-4"
          style={{ backgroundColor: 'rgba(246,247,248,0.97)' }}
        >
          <Pressable
            onPress={handleFamilyFinish}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="סיימנו, בואו נתחיל!"
            className="w-full h-16 rounded-2xl items-center justify-center"
            style={[{ backgroundColor: colors.primary }, shadows.primaryCta]}
          >
            <Text className="text-white font-bold text-lg">
              סיימנו, בואו נתחיל!
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <AddPersonBottomSheet
        visible={isBottomSheetOpen}
        onClose={() => setIsBottomSheetOpen(false)}
        onFromContacts={handleFromContacts}
        onManual={startManualAddPerson}
      />
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
