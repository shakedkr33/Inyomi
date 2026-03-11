import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, Text, TextInput, View } from 'react-native';
import { colors, shadows } from '../../constants/theme';
import type { FamilyMember } from '../../contexts/OnboardingContext';
import { ColorPicker } from './ColorPicker';

interface DisplayCardProps {
  member: FamilyMember;
  onEdit: () => void;
  onRemove: () => void;
}

export function FamilyMemberDisplayCard({
  member,
  onEdit,
  onRemove,
}: DisplayCardProps) {
  const initials = member.name.trim().substring(0, 2);
  const isPet = member.type === 'pet';

  return (
    <Pressable
      onPress={onEdit}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`ערוך את ${member.name}`}
      className="bg-white p-4 rounded-2xl flex-row items-center justify-between mb-3"
      style={shadows.soft}
    >
      {/* Remove button — left side (RTL end) */}
      <Pressable
        onPress={onRemove}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`הסר את ${member.name}`}
        className="p-2"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialIcons name="close" size={20} color="#9ca3af" />
      </Pressable>

      {/* Name + avatar — right side (RTL start) */}
      <View className="flex-row items-center gap-3">
        <Text className="font-bold text-[15px] text-gray-900">
          {member.name}
        </Text>
        <View
          style={{ backgroundColor: member.color }}
          className="w-10 h-10 rounded-full items-center justify-center"
        >
          {isPet ? (
            <MaterialIcons name="pets" size={18} color="white" />
          ) : (
            <Text className="text-xs font-bold opacity-80">{initials}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

interface EditCardProps {
  name: string;
  color: string;
  onChangeName: (text: string) => void;
  onChangeColor: (color: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  label?: string;
  /** Colors already taken by other family members — blocks selection + shows message */
  takenColors?: string[];
  /** Color palette to display; defaults to people palette inside ColorPicker */
  palette?: readonly string[];
}

export function FamilyMemberEditCard({
  name,
  color,
  onChangeName,
  onChangeColor,
  onConfirm,
  onCancel,
  label,
  takenColors,
  palette,
}: EditCardProps) {
  return (
    <View
      className="bg-white border-2 p-4 rounded-2xl mb-3"
      style={[shadows.soft, { borderColor: colors.primary }]}
    >
      {/* Header row: label right, cancel X left */}
      <View className="flex-row-reverse items-center justify-between mb-3">
        {label ? (
          <Text className="text-xs font-semibold text-gray-500">{label}</Text>
        ) : (
          <View />
        )}
        <Pressable
          onPress={onCancel}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="ביטול"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="p-1"
        >
          <MaterialIcons name="close" size={20} color="#9ca3af" />
        </Pressable>
      </View>

      {/* Input row: prominent V button on LEFT, text input fills rest */}
      <View
        className="flex-row items-center bg-[#f6f7f8] rounded-xl overflow-hidden mb-4"
        style={{ minHeight: 52 }}
      >
        <Pressable
          onPress={onConfirm}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="שמור"
          className="w-14 self-stretch items-center justify-center"
          style={{ backgroundColor: '#10b981' }}
        >
          <MaterialIcons name="check" size={24} color="white" />
        </Pressable>
        <TextInput
          value={name}
          onChangeText={onChangeName}
          placeholder="שם..."
          placeholderTextColor="#9ca3af"
          className="flex-1 px-3 text-base font-bold text-[#111517]"
          style={{ textAlign: 'right', height: 52 }}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={onConfirm}
        />
      </View>

      <ColorPicker
        selectedColor={color}
        onSelectColor={onChangeColor}
        takenColors={takenColors}
        palette={palette}
        size={38}
      />
    </View>
  );
}
