import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors } from '../../constants/theme';

/** 6 balanced colors for people */
export const PROFILE_COLORS = [
  '#F4A7B9', // Pink
  '#B5B2E4', // Lavender
  '#A8D8B0', // Mint green
  '#E8C89A', // Peach
  '#89C4F4', // Sky blue
  '#7BC8C0', // Teal
] as const;

/** 5 playful colors for pets — completely separate from people's palette */
export const PET_COLORS = [
  '#FF6B6B', // Coral
  '#FFA94D', // Orange
  '#FFD43B', // Yellow
  '#FF8FD0', // Hot pink
  '#9775FA', // Violet
] as const;

interface ColorPickerProps {
  selectedColor: string;
  onSelectColor: (color: string) => void;
  /** Colors that are already in use — blocked from selection */
  takenColors?: string[];
  /** Custom palette; defaults to PROFILE_COLORS */
  palette?: readonly string[];
  size?: number;
}

export function ColorPicker({
  selectedColor,
  onSelectColor,
  takenColors = [],
  palette = PROFILE_COLORS,
  size = 44,
}: ColorPickerProps) {
  const borderRadius = size / 2;
  const [conflictMessage, setConflictMessage] = useState('');
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePress = (color: string) => {
    if (takenColors.includes(color)) {
      if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
      setConflictMessage('הצבע הזה כבר תפוס, בחר/י צבע אחר.');
      conflictTimerRef.current = setTimeout(() => setConflictMessage(''), 2000);
      return;
    }
    setConflictMessage('');
    onSelectColor(color);
  };

  return (
    <View>
      <View className="flex-row justify-between">
        {palette.map((color) => (
          <Pressable
            key={color}
            onPress={() => handlePress(color)}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`צבע ${color}`}
            style={{
              width: size,
              height: size,
              borderRadius,
              backgroundColor: color,
              borderWidth: selectedColor === color ? 2.5 : 0,
              borderColor:
                selectedColor === color ? colors.slate : 'transparent',
              opacity: takenColors.includes(color) ? 0.35 : 1,
            }}
          />
        ))}
      </View>
      {conflictMessage ? (
        <Text className="text-xs text-right mt-2" style={{ color: '#f59e0b' }}>
          {conflictMessage}
        </Text>
      ) : null}
    </View>
  );
}
