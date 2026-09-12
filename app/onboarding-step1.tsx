import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { useOnboarding } from '../contexts/OnboardingContext';
import { APP_IS_RTL, tw } from '@/lib/rtl';
import { colors as tc } from '@/theme/colors';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

export default function OnboardingStep1() {
  const router = useRouter();
  const { data, updateData } = useOnboarding();
  const initialSpaceType =
    data.spaceType === 'business' ? '' : data.spaceType || '';
  const [selected, setSelected] = useState<
    'personal' | 'couple' | 'family' | ''
  >(initialSpaceType);

  const handleContinue = async () => {
    if (selected) {
      updateData({ spaceType: selected });
      await AsyncStorage.setItem('userType', selected);
      router.replace('/onboarding-step2');
    }
  };

  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: '#f6f7f8' }, ANDROID_MATCH_IOS_LAYOUT && styles.safeAreaRtl]}>
      {/* Header & Progress */}
      <View className="pt-4 px-4">
        {/* direction: 'ltr' pins this row's child order to physical
            left-to-right so the back button stays on the physical LEFT
            regardless of native RTL auto-flip (I18nManager.isRTL). */}
        <View
          className="flex-row items-center justify-between mb-4"
          style={{ direction: 'ltr' }}
        >
          <Pressable
            onPress={() => router.replace('/(auth)/sign-in')}
            className="p-2"
          >
            {/* "arrow-back" is the icon library's stable left-pointing
                glyph — used as-is (no transform) so it reliably points
                physical LEFT and is never re-mirrored by RTL. */}
            <MaterialIcons name="arrow-back" size={24} color={colors.slate} />
          </Pressable>
          <Text style={{ color: colors.slate }} className="text-sm font-medium">
            שלב 1 מתוך 2
          </Text>
          <View className="w-10" />
        </View>
        <View className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
          <View
            className="h-full w-1/2 rounded-full"
            style={{ backgroundColor: tc.primary }}
          />
        </View>
      </View>

      {/* Title */}
      <View className="pt-6 pb-6 px-6">
        <Text
          style={{ color: colors.slate }}
          className="text-[28px] font-extrabold text-center leading-tight"
        >
          עבור מי ננהל כאן את הלו"ז?
        </Text>
      </View>

      {/* Options Grid */}
      <View className="flex-1 px-6 items-center">
        {/* Only Me */}
        <Pressable
          onPress={() => setSelected('personal')}
          className="items-center mb-5"
        >
          <View
            className="w-28 h-28 rounded-full items-center justify-center shadow-sm border-2"
            style={
              selected === 'personal'
                ? { borderWidth: 4, borderColor: tc.primary, backgroundColor: tc.primaryLight }
                : { borderColor: '#e5e7eb', backgroundColor: 'white' }
            }
          >
            <MaterialIcons name="person" size={48} color={tc.primary} />
          </View>
          <Text
            style={{ color: colors.slate }}
            className="text-lg font-bold mt-2"
          >
            רק עבורי
          </Text>
        </Pressable>

        {/* Couple & Family */}
        <View className="flex-row justify-center gap-8 w-full">
          <Pressable
            onPress={() => setSelected('couple')}
            className="items-center"
          >
            <View
              className="w-28 h-28 rounded-full items-center justify-center shadow-sm border-2"
              style={
                selected === 'couple'
                  ? { borderWidth: 4, borderColor: tc.primary, backgroundColor: tc.primaryLight }
                  : { borderColor: '#e5e7eb', backgroundColor: 'white' }
              }
            >
              <MaterialIcons name="group" size={48} color={tc.primary} />
            </View>
            <Text
              style={{ color: colors.slate }}
              className="text-lg font-bold mt-2 text-center"
            >
              עבורי ועבור{'\n'}בן/בת הזוג
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelected('family')}
            className="items-center"
          >
            <View
              className="w-28 h-28 rounded-full items-center justify-center shadow-sm border-2"
              style={
                selected === 'family'
                  ? { borderWidth: 4, borderColor: tc.primary, backgroundColor: tc.primaryLight }
                  : { borderColor: '#e5e7eb', backgroundColor: 'white' }
              }
            >
              <MaterialIcons
                name="family-restroom"
                size={48}
                color={tc.primary}
              />
            </View>
            <Text
              style={{ color: colors.slate }}
              className="text-lg font-bold mt-2 text-center"
            >
              עבור כל{'\n'}המשפחה
            </Text>
          </Pressable>
        </View>
      </View>

      {/* AI Tip Box */}
      <View className="px-6 py-4">
        <View
          className={`rounded-2xl p-4 ${tw.flexRow} items-start border`}
          style={{
            backgroundColor: 'rgba(74, 159, 226, 0.06)',
            borderColor: 'rgba(74, 159, 226, 0.12)',
          }}
        >
          <MaterialIcons
            name="auto-awesome"
            size={20}
            color={tc.primary}
            style={{ marginLeft: 12 }}
          />
          <Text
            style={{ color: colors.slate }}
            className={`text-sm font-medium flex-1 leading-relaxed ${tw.textStart}`}
          >
            כך נוכל להתאים את InYomi למה שחשוב ביום־יום
          </Text>
        </View>
      </View>

      {/* Footer Button */}
      <View className="px-6 pb-10">
        <Pressable
          onPress={handleContinue}
          disabled={!selected}
          className="w-full h-16 rounded-full flex-row items-center justify-center gap-3 shadow-lg"
          style={{
            backgroundColor: selected ? tc.primary : '#d1d5db',
          }}
        >
          <MaterialIcons name="chevron-left" size={24} color="white" />
          <Text className="text-white text-xl font-bold">המשך</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeAreaRtl: {
    direction: 'rtl',
  },
});
