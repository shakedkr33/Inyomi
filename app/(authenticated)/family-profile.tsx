import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

import { AddPersonBottomSheet } from '../../components/onboarding/AddPersonBottomSheet';
import { ColorPicker, PET_COLORS, PROFILE_COLORS } from '../../components/onboarding/ColorPicker';
import {
  FamilyMemberDisplayCard,
  FamilyMemberEditCard,
} from '../../components/onboarding/FamilyMemberCard';
import { colors, shadows } from '../../constants/theme';
import type { FamilyMember } from '../../contexts/OnboardingContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import {
  MAX_PEOPLE,
  MAX_PETS,
  useFamilyProfileEditor,
} from '../../hooks/useFamilyProfileEditor';

export default function FamilyProfileScreen() {
  const router = useRouter();
  const { data } = useOnboarding();

  const isPersonalOnly = data.spaceType === 'personal';
  const screenTitle = isPersonalOnly ? 'ניהול פרופיל אישי' : 'ניהול פרופיל משפחתי';

  // Initialise from previously saved context data (unlike onboarding which starts empty)
  const editor = useFamilyProfileEditor(data.familyData?.familyMembers ?? []);
  const {
    firstName, setFirstName,
    personalColor, setPersonalColor,
    ownerFullName, setOwnerFullName,
    familyMembers,
    pendingMember, setPendingMember,
    editingId,
    isBottomSheetOpen, setIsBottomSheetOpen,
    ownerSaved, personalSaved,
    personMembers, petMembers,
    canAddPerson, canAddPet,
    isAddingNewPerson, isAddingNewPet,
    getTakenColorsForPerson, getTakenColorsForPet,
    openAddPersonSheet, handleAddPet,
    startManualAddPerson, confirmPendingMember, cancelPending,
    startEditMember, removeMember,
    handleSavePersonalName, handleSaveOwnerName,
    handleFromContacts,
    saveAll,
  } = editor;

  const handleSaveAndClose = () => {
    saveAll();
    router.back();
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
        takenColors={isPet ? getTakenColorsForPet(member.id) : getTakenColorsForPerson(member.id)}
        onChangeName={(t) => setPendingMember((p) => p && { ...p, name: t })}
        onChangeColor={(c) => setPendingMember((p) => p && { ...p, color: c })}
        onConfirm={confirmPendingMember}
        onCancel={cancelPending}
        label="עריכה:"
      />
    );
  };

  // ── Render: Personal-only mode ────────────────────────────────────────────

  if (isPersonalOnly) {
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
              <MaterialIcons name="arrow-forward" size={24} color={colors.slate} />
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
            contentContainerStyle={{ paddingTop: 24, paddingBottom: 180 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Personal profile card */}
            <View className="bg-white rounded-3xl p-5" style={shadows.soft}>
              <View className="items-center mb-5">
                <View className="relative">
                  <View
                    className="w-20 h-20 rounded-full items-center justify-center"
                    style={{ backgroundColor: '#e9edf0' }}
                  >
                    <MaterialIcons name="person" size={40} color="#b0bec5" />
                  </View>
                  <View
                    className="absolute bottom-0 right-0 w-7 h-7 rounded-full items-center justify-center"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <MaterialIcons name="camera-alt" size={14} color="white" />
                  </View>
                </View>
              </View>

              <Text className="text-sm font-bold text-gray-700 text-right mb-2">
                השם שלך
              </Text>
              <View
                className="flex-row items-center bg-[#f6f7f8] rounded-2xl overflow-hidden"
                style={{ minHeight: 56 }}
              >
                <Pressable
                  onPress={handleSavePersonalName}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="שמור שם"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                  className="w-14 self-stretch items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <MaterialIcons name="check" size={24} color="white" />
                </Pressable>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="דנה כהן"
                  placeholderTextColor="#9ca3af"
                  className="flex-1 px-3 text-base text-right"
                  style={{ height: 56 }}
                  returnKeyType="done"
                  onSubmitEditing={handleSavePersonalName}
                />
              </View>
              {personalSaved ? (
                <Text className="text-xs text-right mt-1 mb-4" style={{ color: colors.primary }}>
                  נשמר ✓
                </Text>
              ) : (
                <View className="mb-5" />
              )}

              <Text className="text-sm font-bold text-gray-700 text-right mb-3">
                בחירת צבע אישי
              </Text>
              <ColorPicker
                selectedColor={personalColor}
                onSelectColor={setPersonalColor}
              />
            </View>
          </ScrollView>

          {/* Bottom save button */}
          <View
            className="px-5 pb-10 pt-4"
            style={{ backgroundColor: 'rgba(246,247,248,0.97)' }}
          >
            <Pressable
              onPress={handleSaveAndClose}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="שמירה וסגירה"
              className="w-full h-16 rounded-2xl items-center justify-center"
              style={[{ backgroundColor: colors.primary }, shadows.primaryCta]}
            >
              <Text className="text-white font-bold text-lg">שמירה</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Render: Family mode ───────────────────────────────────────────────────

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
            <MaterialIcons name="arrow-forward" size={24} color={colors.slate} />
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
          <Text className="text-xs font-bold text-gray-400 text-right mb-2 pr-1">
            השם שלך
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
                <Text className="text-xs text-gray-400 text-right mb-1">השם שלך</Text>
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
                    placeholder="דנה כהן"
                    placeholderTextColor="#9ca3af"
                    className="flex-1 px-3 text-right text-base"
                    style={{ height: 44 }}
                    returnKeyType="done"
                    onSubmitEditing={handleSaveOwnerName}
                  />
                </View>
                {ownerSaved ? (
                  <Text className="text-xs text-right mt-1" style={{ color: colors.primary }}>
                    נשמר ✓
                  </Text>
                ) : null}
              </View>
            </View>
            <Text className="text-xs text-gray-400 text-right mb-2">
              בחירת צבע אישי
            </Text>
            <ColorPicker
              selectedColor={personalColor}
              onSelectColor={setPersonalColor}
              takenColors={familyMembers.map((m) => m.color)}
              size={38}
            />
          </View>

          {/* ── People section ─────────────────────────────────────────────── */}
          <Text className="text-sm font-bold text-gray-700 text-right mb-1 pr-1">
            בני משפחה נוספים (עד {MAX_PEOPLE})
          </Text>
          <Text className="text-xs text-gray-400 text-right mb-3 pr-1 leading-relaxed">
            הוסיפ/י ילדים, בן/בת זוג, הורים – כל מי שחשוב לך.
          </Text>
          <View className="bg-white rounded-3xl p-5 mb-5" style={shadows.soft}>
            {personMembers.length === 0 && !isAddingNewPerson ? (
              <View className="items-center py-3" style={styles.dashedBorder}>
                <MaterialIcons name="group" size={38} color="#d1d5db" />
                <Text className="text-gray-400 font-semibold mt-2 mb-1 text-center">
                  עדיין לא הוספת בני משפחה
                </Text>
                <Text className="text-xs text-gray-300 text-center mb-4 px-4">
                  הוסיפי ילדים, בן/בת זוג, הורים — כל מי שחשוב לך
                </Text>
                {canAddPerson && (
                  <Pressable
                    onPress={openAddPersonSheet}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוספת בן משפחה"
                    className="flex-row-reverse items-center gap-2 px-5 py-2.5 rounded-full border border-gray-300"
                  >
                    <MaterialIcons name="person-add" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary }} className="font-semibold">
                      הוספת בן משפחה +
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                {personMembers.map((member) =>
                  editingId === member.id && pendingMember
                    ? renderEditCard(member)
                    : (
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
                    onChangeName={(t) => setPendingMember((p) => p && { ...p, name: t })}
                    onChangeColor={(c) => setPendingMember((p) => p && { ...p, color: c })}
                    onConfirm={confirmPendingMember}
                    onCancel={cancelPending}
                    label="הוספת בן משפחה:"
                  />
                )}
                {canAddPerson ? (
                  <Pressable
                    onPress={openAddPersonSheet}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="הוספת בן משפחה נוסף"
                    className="flex-row-reverse items-center justify-center gap-2 py-3 border border-dashed border-gray-200 rounded-xl mt-1"
                  >
                    <MaterialIcons name="person-add" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary }} className="font-semibold">
                      הוספת בן משפחה +
                    </Text>
                  </Pressable>
                ) : (
                  <Text className="text-xs text-gray-300 text-center mt-2">
                    הגעת למכסה של {MAX_PEOPLE} בני משפחה.
                  </Text>
                )}
              </>
            )}
          </View>

          {/* ── Pets section ───────────────────────────────────────────────── */}
          <Text className="text-sm font-bold text-gray-700 text-right mb-1 pr-1">
            חיות מחמד (עד {MAX_PETS})
          </Text>
          <Text className="text-xs text-gray-400 text-right mb-3 pr-1">
            חיות המחמד שלכם — לא נחסיר מהם ימי הולדת 🐾
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
                    <MaterialIcons name="pets" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary }} className="font-semibold">
                      הוספת חיית מחמד
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                {petMembers.map((member) =>
                  editingId === member.id && pendingMember
                    ? renderEditCard(member)
                    : (
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
                    onChangeName={(t) => setPendingMember((p) => p && { ...p, name: t })}
                    onChangeColor={(c) => setPendingMember((p) => p && { ...p, color: c })}
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
                    <MaterialIcons name="pets" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary }} className="font-semibold">
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
            השינויים נשמרים כשתלחצ/י על "שמירה" למטה.
          </Text>
        </ScrollView>

        {/* Bottom save button */}
        <View
          className="px-5 pb-10 pt-4"
          style={{ backgroundColor: 'rgba(246,247,248,0.97)' }}
        >
          <Pressable
            onPress={handleSaveAndClose}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="שמירה וחזרה להגדרות"
            className="w-full h-16 rounded-2xl items-center justify-center"
            style={[{ backgroundColor: colors.primary }, shadows.primaryCta]}
          >
            <Text className="text-white font-bold text-lg">שמירה</Text>
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
