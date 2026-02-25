import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation } from 'convex/react';
import { useRouter } from 'expo-router';
import {
  Bug,
  ChevronLeft,
  CreditCard,
  Crown,
  Headset,
  LogIn,
  LogOut,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnboarding } from '@/contexts/OnboardingContext';

import {
  APP_ENV,
  IS_DEV_MODE,
  MOCK_PAYMENTS,
  PAYMENT_SYSTEM_ENABLED,
} from '@/config/appConfig';
import { useRevenueCat } from '@/contexts/RevenueCatContext';
import { api } from '@/convex/_generated/api';
import { tw } from '@/lib/rtl';

// ============================================================================
// מסך הגדרות
// ============================================================================

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const {
    isPremium,
    isConfigured,
    isExpoGo,
    presentPaywall,
    presentCustomerCenter,
    customerData,
  } = useRevenueCat();
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const deleteMyAccount = useMutation(api.users.deleteMyAccount);

  const { data: onboardingData } = useOnboarding();
  const familyMembers = onboardingData.familyData?.familyMembers ?? [];
  const isPersonalOnly = onboardingData.spaceType === 'personal' && familyMembers.length === 0;
  const profileRowTitle = isPersonalOnly ? 'ניהול פרופיל אישי' : 'ניהול פרופיל משפחתי';
  const profileMemberCount = familyMembers.length;

  // ============================================================================
  // פעולות
  // ============================================================================

  const handleSignOut = async () => {
    Alert.alert(
      'התנתקות',
      'האם אתה בטוח שברצונך להתנתק?',
      [
        {
          text: 'ביטול',
          style: 'cancel',
        },
        {
          text: 'התנתק',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch {
              Alert.alert('שגיאה', 'אירעה שגיאה בהתנתקות');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleDeleteAccount = async () => {
    // אזהרה ראשונה
    Alert.alert(
      '⚠️ מחיקת חשבון',
      'האם אתה בטוח שברצונך למחוק את החשבון שלך?\n\nפעולה זו תמחק לצמיתות את:\n• פרטי החשבון שלך\n• כל הנתונים המשויכים אליך\n• היסטוריית השימוש שלך\n\n⚠️ לא ניתן לשחזר את הנתונים לאחר המחיקה!',
      [
        {
          text: 'ביטול',
          style: 'cancel',
        },
        {
          text: 'המשך למחיקה',
          style: 'destructive',
          onPress: () => {
            // אזהרה שנייה - אישור סופי
            Alert.alert(
              '🚨 אישור סופי',
              'זוהי ההזדמנות האחרונה שלך לבטל!\n\nהחשבון שלך וכל הנתונים ימחקו לצמיתות ולא יהיה ניתן לשחזר אותם.\n\nהאם אתה בטוח לחלוטין?',
              [
                {
                  text: 'ביטול - אל תמחק',
                  style: 'cancel',
                },
                {
                  text: 'כן, מחק את החשבון',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteMyAccount();
                      // התנתקות אוטומטית לאחר מחיקת החשבון
                      await signOut();
                      Alert.alert(
                        'החשבון נמחק',
                        'החשבון שלך נמחק בהצלחה. תודה שהשתמשת באפליקציה שלנו.'
                      );
                    } catch (_error) {
                      Alert.alert(
                        'שגיאה',
                        'אירעה שגיאה במחיקת החשבון. אנא נסה שוב או צור קשר עם התמיכה.'
                      );
                    }
                  },
                },
              ],
              { cancelable: true }
            );
          },
        },
      ],
      { cancelable: true }
    );
  };

  // ניווט לדפי דיבאג
  const openPaywallPreview = () => {
    router.push('/(auth)/paywall?preview=true');
  };

  const openSignInPreview = () => {
    router.push('/(auth)/sign-in?preview=true');
  };

  const openSignUpPreview = () => {
    router.push('/(auth)/sign-up?preview=true');
  };

  // ============================================================================
  // רינדור
  // ============================================================================

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      <ScrollView className="flex-1">
        {/* כותרת */}
        <View className="px-6 pt-6 pb-4">
          <Text className={`text-[#ededed] text-3xl font-bold ${tw.textStart}`}>
            הגדרות
          </Text>
        </View>

        {/* ניהול פרופיל */}
        <View className="mx-4 mb-4">
          <TouchableOpacity
            onPress={() => router.push('/(authenticated)/family-profile')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={profileRowTitle}
            className={`${tw.flexRow} items-center gap-3 p-4 rounded-xl bg-zinc-900 border border-zinc-800`}
          >
            <ChevronLeft size={20} color="#71717a" />
            <View className="flex-1">
              <Text className={`text-white text-base font-semibold ${tw.textStart}`}>
                {profileRowTitle}
              </Text>
              {profileMemberCount > 0 && (
                <Text className={`text-zinc-400 text-xs mt-0.5 ${tw.textStart}`}>
                  {profileMemberCount} מחוברים
                </Text>
              )}
            </View>
            <Users size={20} color="#a1a1aa" />
          </TouchableOpacity>
        </View>

        {/* סטטוס מנוי */}
        <View className="mx-4 mb-4 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <View className={`${tw.flexRow} items-center justify-between`}>
            <View
              className={`px-3 py-1 rounded-full ${
                isPremium ? 'bg-[#4fc3f7]/20' : 'bg-zinc-700'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  isPremium ? 'text-[#4fc3f7]' : 'text-zinc-400'
                }`}
              >
                {isPremium ? 'פרימיום' : 'חינמי'}
              </Text>
            </View>
            <Text
              className={`text-white text-base font-medium ${tw.textStart}`}
            >
              סטטוס מנוי
            </Text>
          </View>
        </View>

        {/* ניהול מנוי - שדרוג או Customer Center */}
        <View className="mx-4 mb-4 gap-3">
          {!isPremium && (
            <TouchableOpacity
              onPress={() => presentPaywall()}
              className={`${tw.flexRow} items-center gap-3 p-4 rounded-xl bg-[#4fc3f7]/10 border border-[#4fc3f7]/30`}
            >
              <ChevronLeft size={20} color="#4fc3f7" />
              <Text
                className={`flex-1 text-[#4fc3f7] text-base font-bold ${tw.textStart}`}
              >
                שדרוג ל-InYomi Pro
              </Text>
              <Crown size={20} color="#4fc3f7" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => presentCustomerCenter()}
            className={`${tw.flexRow} items-center gap-3 p-4 rounded-xl bg-zinc-900 border border-zinc-800`}
          >
            <ChevronLeft size={20} color="#71717a" />
            <Text className={`flex-1 text-white text-base ${tw.textStart}`}>
              ניהול מנוי ותמיכה
            </Text>
            <Headset size={20} color="#a1a1aa" />
          </TouchableOpacity>
        </View>

        {/* כפתור התנתקות */}
        <View className="mx-4 mb-4">
          <TouchableOpacity
            onPress={handleSignOut}
            className={`${tw.flexRow} items-center gap-3 p-4 rounded-xl bg-zinc-900 border border-zinc-800`}
          >
            <ChevronLeft size={20} color="#71717a" />
            <Text className={`flex-1 text-red-400 text-base ${tw.textStart}`}>
              התנתקות
            </Text>
            <LogOut size={20} color="#f87171" />
          </TouchableOpacity>
        </View>

        {/* כפתור מחיקת חשבון - כפתור הרסני */}
        <View className="mx-4 mb-4">
          <TouchableOpacity
            onPress={handleDeleteAccount}
            className={`${tw.flexRow} items-center gap-3 p-4 rounded-xl bg-red-950/30 border-2 border-red-900`}
          >
            <ChevronLeft size={20} color="#991b1b" />
            <Text
              className={`flex-1 text-red-500 text-base font-bold ${tw.textStart}`}
            >
              מחיקת חשבון
            </Text>
            <Trash2 size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>

        {/* פאנל דיבאג - רק במצב פיתוח */}
        {IS_DEV_MODE && (
          <View className="mx-4 mb-4">
            {/* כותרת פאנל דיבאג */}
            <TouchableOpacity
              onPress={() => setIsDebugOpen(!isDebugOpen)}
              className={`${tw.flexRow} items-center gap-3 p-4 rounded-t-xl ${
                isDebugOpen ? '' : 'rounded-b-xl'
              } bg-yellow-500/10 border border-yellow-500/30`}
            >
              <ChevronLeft
                size={20}
                color="#eab308"
                style={{
                  transform: [{ rotate: isDebugOpen ? '-90deg' : '0deg' }],
                }}
              />
              <Text
                className={`flex-1 text-yellow-400 text-base font-medium ${tw.textStart}`}
              >
                קונסולת דיבאג (מצב פיתוח)
              </Text>
              <Bug size={20} color="#eab308" />
            </TouchableOpacity>

            {/* תוכן פאנל דיבאג */}
            {isDebugOpen && (
              <View className="p-4 rounded-b-xl bg-zinc-900 border border-t-0 border-yellow-500/30">
                {/* מצב אפליקציה */}
                <View className="mb-4">
                  <Text
                    className={`text-zinc-400 text-sm mb-2 ${tw.textStart}`}
                  >
                    מצב אפליקציה
                  </Text>
                  <View className="gap-2">
                    <DebugRow label="סביבה" value={APP_ENV} />
                    <DebugRow
                      label="מערכת תשלומים"
                      value={PAYMENT_SYSTEM_ENABLED ? 'פעיל' : 'כבוי'}
                    />
                    <DebugRow
                      label="תשלומים מדומים"
                      value={MOCK_PAYMENTS ? 'פעיל' : 'כבוי'}
                    />
                    <DebugRow
                      label="RevenueCat מוגדר"
                      value={isConfigured ? 'כן' : 'לא'}
                    />
                    <DebugRow label="Expo Go" value={isExpoGo ? 'כן' : 'לא'} />
                    <DebugRow
                      label="סטטוס פרימיום"
                      value={isPremium ? 'פרימיום' : 'חינמי'}
                    />
                    <DebugRow label="Entitlement" value="InYomi Pro" />
                    {customerData && (
                      <DebugRow
                        label="App User ID"
                        value={customerData.appUserID.substring(0, 20)}
                      />
                    )}
                  </View>
                </View>

                {/* כפתורי ניווט לבדיקות UI */}
                <View className="mb-2">
                  <Text
                    className={`text-zinc-400 text-sm mb-3 ${tw.textStart}`}
                  >
                    בדיקות UI
                  </Text>
                  <View className="gap-3">
                    <DebugButton
                      icon={CreditCard}
                      label="פתח מסך תשלום (Preview)"
                      onPress={openPaywallPreview}
                    />
                    <DebugButton
                      icon={LogIn}
                      label="פתח מסך התחברות (Preview)"
                      onPress={openSignInPreview}
                    />
                    <DebugButton
                      icon={UserPlus}
                      label="פתח מסך הרשמה (Preview)"
                      onPress={openSignUpPreview}
                    />
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* באנר מצב פיתוח */}
        {IS_DEV_MODE && (
          <View className="mx-4 mb-6 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <Text className="text-yellow-400 text-center text-sm">
              מצב פיתוח פעיל
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// רכיבי עזר
// ============================================================================

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View className={`${tw.flexRow} items-center justify-between py-1`}>
      <Text className="text-zinc-300 text-sm">{value}</Text>
      <Text className="text-zinc-500 text-sm">{label}</Text>
    </View>
  );
}

function DebugButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`${tw.flexRow} items-center gap-3 p-3 rounded-lg bg-zinc-800 border border-zinc-700`}
    >
      <ChevronLeft size={16} color="#71717a" />
      <Text className={`flex-1 text-white text-sm ${tw.textStart}`}>
        {label}
      </Text>
      <Icon size={18} color="#4fc3f7" />
    </TouchableOpacity>
  );
}
