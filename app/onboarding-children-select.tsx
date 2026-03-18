import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { useOnboarding } from '../contexts/OnboardingContext';

const COUNTS = [1, 2, 3, 4, '5+'] as const;

export default function OnboardingChildrenSelect() {
  const router = useRouter();
  const { data, updateData } = useOnboarding();

  // Restore previous selection from context so navigating back preserves the choice
  const [selected, setSelected] = useState<number | '5+' | null>(() => {
    if (!data.childCount) return null;
    return data.childCount >= 5 ? '5+' : (data.childCount as number);
  });
  const [customCount, setCustomCount] = useState(() => {
    if (data.childCount && data.childCount >= 5)
      return data.childCount.toString();
    return '';
  });

  const handleSelect = (value: number | '5+') => {
    setSelected(value);
    if (value !== '5+') {
      setCustomCount('');
      // Persist immediately so back-navigation restores this choice
      updateData({ childCount: value as number });
    } else {
      updateData({ childCount: undefined });
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
    (selected !== '5+' ||
      (customCount !== '' && Number.parseInt(customCount, 10) > 0));

  const handleContinue = async () => {
    if (!canContinue) return;
    const count = getFinalCount();
    updateData({ childCount: count });
    await AsyncStorage.setItem('childrenCount', count.toString());
    router.push('/onboarding-step2');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.beige }}>
      {/* Header — label removed, back button kept */}
      <View className="pt-4 px-6">
        <View className="flex-row-reverse items-center mb-2">
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
        </View>
      </View>

      {/* Scrollable middle — title, circles, illustration */}
      <View className="flex-1 justify-between pt-2 pb-4">
        {/* Title — no subtitle */}
        <View className="items-center px-8">
          <Text
            style={{ color: colors.slate }}
            className="text-[26px] font-extrabold text-center leading-tight"
          >
            כמה ילדים יש לך?
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
            <View className="mt-5 items-center">
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
                    const parsed = Number.parseInt(num, 10);
                    if (parsed > 0) updateData({ childCount: parsed });
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

        {/* Illustration area — soft family icon in a light blue dashed circle */}
        <View
          className="items-center"
          style={{ marginTop: 40, marginBottom: 40 }}
        >
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: 'rgba(54, 169, 226, 0.07)',
              borderWidth: 1.5,
              borderColor: 'rgba(54, 169, 226, 0.18)',
              borderStyle: 'dashed',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialIcons
              name="family-restroom"
              size={52}
              color="rgba(54, 169, 226, 0.45)"
            />
          </View>
        </View>
      </View>

      {/* Bottom section — helper box anchored directly above CTA, matches step 1 */}
      <View className="px-6 mb-3">
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

      {/* Continue Button + bottom indicator */}
      <View className="px-6 pb-8">
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

        {/* Bottom indicator bar — onboarding visual language */}
        <View className="items-center mt-3">
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: 'rgba(74, 159, 226, 0.25)',
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
