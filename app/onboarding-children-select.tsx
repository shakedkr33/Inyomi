import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';

const COUNTS = [1, 2, 3, 4, '5+'] as const;

export default function OnboardingChildrenSelect() {
  const router = useRouter();
  // No default — user must make an explicit selection
  const [selected, setSelected] = useState<number | '5+' | null>(null);
  const [customCount, setCustomCount] = useState('');

  const handleSelect = (value: number | '5+') => {
    setSelected(value);
    if (value !== '5+') {
      setCustomCount('');
    }
  };

  const getFinalCount = (): number => {
    if (selected === '5+') {
      const parsed = Number.parseInt(customCount, 10);
      return parsed > 0 && parsed <= 10 ? parsed : 5;
    }
    return selected as number;
  };

  // Continue is allowed only when the user has made a real choice,
  // and if 5+ is chosen a valid custom number must be entered.
  const canContinue =
    selected !== null &&
    (selected !== '5+' || (customCount !== '' && Number.parseInt(customCount, 10) > 0));

  const handleContinue = async () => {
    if (!canContinue) return;
    const count = getFinalCount();
    await AsyncStorage.setItem('childrenCount', count.toString());
    router.push('/onboarding-step2');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.beige }}>
      {/* Header */}
      <View className="pt-4 px-6">
        <View className="flex-row-reverse items-center justify-between mb-2">
          <Pressable
            onPress={() => router.replace('/onboarding-step1')}
            className="p-2"
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזור לשלב הקודם"
          >
            <MaterialIcons
              name="arrow-forward"
              size={24}
              color={colors.slate}
            />
          </Pressable>
          <Text style={{ color: colors.slate }} className="text-sm font-medium">
            מיקוד משפחתי
          </Text>
          <View className="w-10" />
        </View>
      </View>

      <View className="flex-1 justify-between pb-10 pt-4">
        {/* Title */}
        <View className="items-center px-8">
          <Text
            style={{ color: colors.slate }}
            className="text-[26px] font-extrabold text-center leading-tight mb-2"
          >
            כמה ילדים יש במשפחה?
          </Text>
          <Text
            style={{ color: colors.slateLight }}
            className="text-[15px] text-center leading-relaxed"
          >
            זה יעזור לנו להתאים את הלוז והתזכורות למשפחה שלכם
          </Text>
        </View>

        {/* Selection Circles */}
        <View className="items-center px-6">
          <View className="flex-row items-center justify-center gap-4">
            {COUNTS.map((num) => {
              const isActive = selected === num;
              return (
                <Pressable
                  key={num.toString()}
                  onPress={() => handleSelect(num)}
                  className="items-center"
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`${num} ילדים`}
                >
                  <View
                    className="w-16 h-16 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: isActive ? colors.sage : colors.white,
                      borderWidth: isActive ? 3 : 2,
                      borderColor: isActive ? '#36a9e2' : '#E8E4DD',
                    }}
                  >
                    <Text
                      className="text-xl font-bold"
                      style={{ color: isActive ? colors.white : colors.slate }}
                    >
                      {num}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Custom Input for 5+ */}
          {selected === '5+' && (
            <View className="mt-6 items-center">
              <Text
                style={{ color: colors.slateLight }}
                className="text-sm font-medium mb-2"
              >
                הזיני מספר מדויק (עד 10)
              </Text>
              <TextInput
                value={customCount}
                onChangeText={(text) => {
                  const num = text.replace(/[^0-9]/g, '');
                  if (num === '' || Number.parseInt(num, 10) <= 10) {
                    setCustomCount(num);
                  }
                }}
                placeholder="5"
                placeholderTextColor={colors.slateMuted}
                keyboardType="number-pad"
                maxLength={2}
                className="w-20 h-12 rounded-2xl text-center text-xl font-bold"
                style={{
                  backgroundColor: colors.white,
                  borderWidth: 1.5,
                  borderColor: colors.sage,
                  color: colors.slate,
                }}
              />
            </View>
          )}
        </View>

        {/* Helper Box — consistent with onboarding step 1 */}
        <View className="px-6">
          <View
            className="rounded-2xl p-4 flex-row-reverse items-start border"
            style={{
              backgroundColor: 'rgba(74, 159, 226, 0.06)',
              borderColor: 'rgba(74, 159, 226, 0.12)',
            }}
          >
            <MaterialIcons
              name="auto-awesome"
              size={20}
              color={colors.sage}
              style={{ marginLeft: 12 }}
            />
            <Text
              style={{ color: colors.slate }}
              className="text-sm font-medium flex-1 leading-relaxed text-right"
            >
              זה יעזור לנו להתאים את הלוז בצורה טובה יותר למשפחה שלכם
            </Text>
          </View>
        </View>

        {/* Continue Button */}
        <View className="px-6">
          <Pressable
            onPress={handleContinue}
            disabled={!canContinue}
            className="w-full h-16 rounded-full flex-row items-center justify-center gap-3"
            style={{ backgroundColor: canContinue ? colors.sage : '#d1d5db' }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="המשך"
            accessibilityState={{ disabled: !canContinue }}
          >
            <Text className="text-white text-xl font-bold">המשך</Text>
            <MaterialIcons name="chevron-left" size={24} color="white" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
