import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { useOnboarding } from '../contexts/OnboardingContext';
import { markOnboardingSeen } from '../lib/onboardingState';
import { APP_IS_RTL, tw } from '@/lib/rtl';
import { colors as tc } from '@/theme/colors';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

const MAX_SELECTIONS = 2;

// Internal stable IDs kept separate from the Hebrew display copy so this
// answer can later be used for analytics/personalization without depending
// on display text.
const challenges = [
  {
    id: 'incoming_from_everywhere',
    title: 'לרכז ולתעד אירועים ומשימות שמגיעים מכל מקום',
    desc: 'וואטסאפ, SMS, מיילים והודעות',
    icon: 'inbox',
  },
  {
    id: 'remember_tasks_and_appointments',
    title: 'לזכור מטלות, תורים ודברים שצריך לעשות',
    desc: 'בלי שדברים חשובים יתפספסו',
    icon: 'event-available',
  },
  {
    id: 'shared_schedule_coordination',
    title: 'לתאם את הלו"ז המשותף',
    desc: 'תיאום בין בני הבית, מי עושה מה ומתי',
    icon: 'sync-alt',
  },
  {
    id: 'everything_in_one_place',
    title: 'להתנהל בין יותר מדי מקומות',
    desc: 'יומן, פתקים, הודעות, מיילים ואפליקציות שונות',
    icon: 'dashboard',
  },
] as const;

export default function OnboardingStep2() {
  const router = useRouter();
  const { data, updateData } = useOnboarding();
  const [selected, setSelected] = useState<string[]>(data.challenges || []);

  const toggleSelection = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      if (prev.length >= MAX_SELECTIONS) {
        // Already at the max — ignore the tap instead of silently
        // replacing one of the existing selections.
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleContinue = async () => {
    updateData({ challenges: selected });
    try {
      await markOnboardingSeen();
    } catch {}
    router.replace('/(auth)/sign-in');
  };

  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: '#f6f7f8' }, ANDROID_MATCH_IOS_LAYOUT && styles.safeAreaRtl]}>
      {/* Header & Progress */}
      <View className="pt-4 px-6">
        {/* direction: 'ltr' pins this row's child order to physical
            left-to-right so the back button stays on the physical LEFT
            regardless of native RTL auto-flip (I18nManager.isRTL) —
            matches onboarding-step1. */}
        <View
          className="flex-row items-center justify-between mb-4"
          style={{ direction: 'ltr' }}
        >
          <Pressable
            onPress={() => router.replace('/onboarding-step1')}
            className="p-2"
          >
            {/* "arrow-back" is the icon library's stable left-pointing
                glyph — used as-is (no transform) so it reliably points
                physical LEFT and is never re-mirrored by RTL. */}
            <MaterialIcons name="arrow-back" size={24} color={colors.slate} />
          </Pressable>
          <Text style={{ color: colors.slate }} className="text-sm font-medium">
            שלב 2 מתוך 2
          </Text>
          <View className="w-10" />
        </View>
        <View className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
          <View
            className="h-full w-full rounded-full"
            style={{ backgroundColor: tc.primary }}
          />
        </View>
      </View>

      {/* Horizontal padding lives on contentContainerStyle (not className)
          so the scrollable content — including the option cards — gets a
          reliable, symmetric paddingHorizontal instead of depending on how
          ScrollView's own `style` padding interacts with RTL. */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & Instruction */}
        <View className="pt-6 pb-6">
          <Text
            style={{ color: colors.slate }}
            className="text-[28px] font-extrabold text-center leading-tight"
          >
            מה הכי מעמיס ביום־יום?
          </Text>
          <Text
            style={{ color: tc.primary }}
            className="text-center font-bold mt-2"
          >
            אפשר לבחור עד 2 אפשרויות
          </Text>
        </View>

        {/* Challenge Cards */}
        <View className="gap-4 pb-6">
          {challenges.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <Pressable
                key={item.id}
                onPress={() => toggleSelection(item.id)}
                style={[styles.card, isSelected && styles.selectedCard]}
              >
                {isSelected && (
                  <View style={[styles.checkBadge, { backgroundColor: tc.primary }]}>
                    <MaterialIcons name="check" size={14} color="white" />
                  </View>
                )}

                <View className={`${tw.flexRow} items-center gap-4 p-5`}>
                  <View
                    className="w-14 h-14 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: isSelected ? tc.primary : tc.primaryLight,
                    }}
                  >
                    <MaterialIcons
                      name={item.icon}
                      size={28}
                      color={isSelected ? 'white' : tc.primary}
                    />
                  </View>

                  <View className="flex-1">
                    <Text
                      style={{ color: colors.slate }}
                      className={`${tw.textStart} text-lg font-bold`}
                    >
                      {item.title}
                    </Text>
                    <Text className={`${tw.textStart} text-gray-500 text-sm mt-1`}>
                      {item.desc}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Helper Box — consistent with onboarding step 1 */}
      <View className="px-6 pt-3 pb-3 bg-[#f6f7f8]">
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
            כך נוכל לעזור לעשות יותר סדר בחיים
          </Text>
        </View>
      </View>

      {/* Footer Button */}
      <View className="px-6 pb-10 pt-2 bg-[#f6f7f8]">
        <Pressable
          onPress={handleContinue}
          disabled={selected.length === 0}
          className="w-full h-16 rounded-3xl flex-row items-center justify-center shadow-lg"
          style={{
            backgroundColor: selected.length > 0 ? tc.primary : '#d1d5db',
          }}
        >
          <MaterialIcons
            name="arrow-back"
            size={24}
            color="white"
            style={{ transform: [{ scaleX: -1 }] }}
          />
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
  card: {
    // Stretch to the full (already symmetrically padded) content width
    // from contentContainerStyle above. `width: '100%'` previously used
    // here did not fix centering because the actual asymmetry came from
    // the ScrollView's own padding, not from the card's own sizing.
    alignSelf: 'stretch',
    backgroundColor: 'white',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  selectedCard: {
    borderColor: tc.primary,
    borderWidth: 2,
  },
  checkBadge: {
    position: 'absolute',
    top: -10,
    left: -10,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    borderWidth: 2,
    borderColor: 'white',
  },
});
