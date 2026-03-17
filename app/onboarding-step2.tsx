import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { useOnboarding } from '../contexts/OnboardingContext';

const challenges = [
  {
    id: 'remembering',
    title: 'לזכור מה צריך להביא/לקחת',
    desc: 'ה-AI תזכיר לך ציוד לחוגים, למסגרות או לעבודה',
    icon: 'assignment',
  },
  {
    id: 'sync',
    title: 'סנכרון לו"ז עם בן/בת הזוג',
    desc: 'תיאום משימות משפחתיות',
    icon: 'calendar-today',
  },
  {
    id: 'home_tasks',
    title: 'ניהול משימות הבית',
    desc: 'ניקיון, קניות וסידורים',
    icon: 'home-work',
  },
];

export default function OnboardingStep2() {
  const router = useRouter();
  const { data, updateData } = useOnboarding();
  const [selected, setSelected] = useState<string[]>(data.challenges || []);

  const toggleSelection = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleContinue = () => {
    updateData({ challenges: selected });
    router.push('/onboarding-step3');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f7f8' }}>
      {/* Header */}
      <View className="pt-4 px-6">
        <View className="flex-row-reverse items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} className="p-2">
            <MaterialIcons
              name="arrow-forward"
              size={24}
              color={colors.slate}
            />
          </Pressable>
          <Text style={{ color: colors.sage }} className="font-bold">
            שלב 2 מתוך 4
          </Text>
          <View className="w-10" />
        </View>
        <View className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
          <View
            className="h-full w-2/4 rounded-full"
            style={{ backgroundColor: colors.sage }}
          />
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* Title & Description */}
        <View className="py-6">
          <Text
            style={{ color: colors.slate }}
            className="text-3xl font-extrabold text-center leading-tight"
          >
            מה האתגר היומי הגדול ביותר שלך?
          </Text>
          <Text
            style={{ color: colors.sage }}
            className="text-center font-bold mt-2"
          >
            ניתן לבחור יותר מאתגר אחד
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
                  <View style={styles.checkBadge}>
                    <MaterialIcons name="check" size={14} color="white" />
                  </View>
                )}

                <View className="flex-row-reverse items-center p-5">
                  <View
                    className="w-14 h-14 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: isSelected
                        ? colors.sage
                        : 'rgba(74, 159, 226, 0.1)',
                    }}
                  >
                    <MaterialIcons
                      name={item.icon as any}
                      size={28}
                      color={isSelected ? 'white' : colors.sage}
                    />
                  </View>

                  <View className="flex-1 mr-4">
                    <Text
                      style={{ color: colors.slate }}
                      className="text-right text-xl font-bold"
                    >
                      {item.title}
                    </Text>
                    <Text className="text-right text-gray-500 text-sm mt-1">
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
            ספר/י לנו קצת על עצמך כדי שנוכל להתאים את המערכת בדיוק לצרכים שלך
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
            backgroundColor: selected.length > 0 ? colors.sage : '#d1d5db',
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
  card: {
    backgroundColor: 'white',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  selectedCard: {
    borderColor: '#4A9FE2',
    borderWidth: 2,
  },
  checkBadge: {
    position: 'absolute',
    top: -10,
    left: -10,
    backgroundColor: '#4A9FE2',
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
