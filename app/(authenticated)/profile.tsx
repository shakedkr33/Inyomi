import { useAuthActions } from '@convex-dev/auth/react';
import { MaterialIcons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  APP_ENV,
  IS_DEV_MODE,
  MOCK_PAYMENTS,
  PAYMENT_SYSTEM_ENABLED,
} from '@/config/appConfig';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useRevenueCat } from '@/contexts/RevenueCatContext';
import { api } from '@/convex/_generated/api';

// ============================================================================
// מסך פרופיל
// ============================================================================

export default function ProfileScreen() {
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
  const deleteMyAccount = useMutation(api.users.deleteMyAccount);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  const { data: onboardingData } = useOnboarding();
  const familyMembers = onboardingData.familyData?.familyMembers ?? [];
  const isPersonalOnly =
    onboardingData.spaceType === 'personal' && familyMembers.length === 0;
  const profileRowTitle = isPersonalOnly
    ? 'ניהול פרופיל אישי'
    : 'ניהול פרופיל משפחתי';
  const profileMemberCount = familyMembers.length;

  // ============================================================================
  // פעולות
  // ============================================================================

  const handleSignOut = async () => {
    Alert.alert(
      'התנתקות',
      'האם אתה בטוח שברצונך להתנתק?',
      [
        { text: 'ביטול', style: 'cancel' },
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
    Alert.alert(
      '⚠️ מחיקת חשבון',
      'האם אתה בטוח שברצונך למחוק את החשבון שלך?\n\nפעולה זו תמחק לצמיתות את:\n• פרטי החשבון שלך\n• כל הנתונים המשויכים אליך\n• היסטוריית השימוש שלך\n\n⚠️ לא ניתן לשחזר את הנתונים לאחר המחיקה!',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'המשך למחיקה',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '🚨 אישור סופי',
              'זוהי ההזדמנות האחרונה שלך לבטל!\n\nהחשבון שלך וכל הנתונים ימחקו לצמיתות ולא יהיה ניתן לשחזר אותם.\n\nהאם אתה בטוח לחלוטין?',
              [
                { text: 'ביטול - אל תמחק', style: 'cancel' },
                {
                  text: 'כן, מחק את החשבון',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteMyAccount();
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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerContainer}>
          {/* Left side — full logo (icon + InYomi text combined) */}
          <Image
            source={require('@/assets/images/logo-inyomi.png')}
            style={styles.headerLogo}
            resizeMode="contain"
            accessibilityLabel="InYomi logo"
          />
          {/* Right side — page title */}
          <Text style={styles.headerTitle}>פרופיל</Text>
        </View>

        {/* Profile card */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push('/(authenticated)/family-profile')}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="עריכת פרופיל"
        >
          <View style={styles.profileRow}>
            {/* Chevron on the left */}
            <MaterialIcons name="chevron-left" size={22} color="#9ca3af" />
            {/* Text stack in the middle */}
            <View style={styles.profileTexts}>
              {/* TODO: replace with real user name */}
              <Text style={styles.profileName}>שקד קריכלי</Text>
              <Text style={styles.profileSubtitle}>
                {isPremium ? 'מנוי פרימיום 👑' : 'מנוי חינמי'}
              </Text>
            </View>
            {/* Avatar on the right */}
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>ש</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Invite card */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => console.log('TODO: open invite flow')}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="הזמנת חברה"
        >
          <View style={styles.inviteRow}>
            <MaterialIcons name="chevron-left" size={20} color="#d1d5db" />
            <View style={styles.inviteTexts}>
              <Text style={styles.inviteTitle}>
                הזמיני חברה וקבלי חודש מתנה
              </Text>
              <Text style={styles.inviteSubtitle}>
                שתפי קישור ותרוויחי 30 יום בחינם
              </Text>
            </View>
            <MaterialIcons name="group-add" size={22} color="#9ca3af" />
          </View>
        </TouchableOpacity>

        {/* Section title */}
        <Text style={styles.sectionTitle}>הגדרות</Text>

        {/* Settings list card */}
        <View style={[styles.card, styles.settingsCard]}>
          <SettingsRow
            iconName="people-outline"
            label={profileRowTitle}
            note={
              profileMemberCount > 0
                ? `${profileMemberCount} מחוברים`
                : undefined
            }
            onPress={() => router.push('/(authenticated)/family-profile')}
          />
          <SettingsRow
            iconName={isPremium ? 'star' : 'star-outline'}
            label={isPremium ? 'מנוי פרימיום פעיל' : 'שדרוג ל-InYomi Pro'}
            note={!isPremium ? "גישה לכל הפיצ'רים ללא הגבלה" : undefined}
            onPress={() => presentPaywall()}
          />
          <SettingsRow
            iconName="headset-mic"
            label="ניהול מנוי ותמיכה"
            onPress={() => presentCustomerCenter()}
          />
          <SettingsRow
            iconName="notifications-none"
            label="התראות"
            onPress={() => console.log('TODO: notifications settings')}
          />
          <SettingsRow
            iconName="brightness-medium"
            label="תצוגה"
            note="בהיר / כהה / מערכת"
            onPress={() => console.log('TODO: display settings')}
          />
          <SettingsRow
            iconName="delete-outline"
            label="מחיקת חשבון"
            danger
            onPress={handleDeleteAccount}
          />
          <SettingsRow
            iconName="logout"
            label="התנתקות"
            danger
            hideChevron
            isLast
            onPress={handleSignOut}
          />
        </View>

        {/* Debug panel — only in dev mode */}
        {IS_DEV_MODE && (
          <View style={styles.debugContainer}>
            <TouchableOpacity
              onPress={() => setIsDebugOpen(!isDebugOpen)}
              style={[
                styles.debugHeader,
                isDebugOpen ? styles.debugHeaderOpen : styles.debugHeaderClosed,
              ]}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="פתח/סגור פאנל דיבאג"
            >
              <MaterialIcons
                name="chevron-left"
                size={20}
                color="#eab308"
                style={{
                  transform: [{ rotate: isDebugOpen ? '-90deg' : '0deg' }],
                }}
              />
              <Text style={styles.debugHeaderText}>
                קונסולת דיבאג (מצב פיתוח)
              </Text>
              <MaterialIcons name="bug-report" size={20} color="#eab308" />
            </TouchableOpacity>

            {isDebugOpen && (
              <View style={styles.debugBody}>
                <Text style={styles.debugSectionLabel}>מצב אפליקציה</Text>
                <View style={styles.debugRows}>
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

                <Text style={[styles.debugSectionLabel, { marginTop: 16 }]}>
                  בדיקות UI
                </Text>
                <View style={styles.debugRows}>
                  <DebugButton
                    iconName="credit-card"
                    label="פתח מסך תשלום (Preview)"
                    onPress={openPaywallPreview}
                  />
                  <DebugButton
                    iconName="login"
                    label="פתח מסך התחברות (Preview)"
                    onPress={openSignInPreview}
                  />
                  <DebugButton
                    iconName="person-add"
                    label="פתח מסך הרשמה (Preview)"
                    onPress={openSignUpPreview}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {IS_DEV_MODE && (
          <View style={styles.devBanner}>
            <Text style={styles.devBannerText}>מצב פיתוח פעיל</Text>
          </View>
        )}

        {/* Footer */}
        {/* TODO: use expo-constants for real version */}
        <Text style={styles.footer}>InYomi v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// SettingsRow
// ============================================================================

function SettingsRow({
  iconName,
  label,
  onPress,
  danger = false,
  note,
  hideChevron = false,
  isLast = false,
}: {
  iconName: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  note?: string;
  hideChevron?: boolean;
  isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.row, !isLast && styles.rowBorder]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* Chevron on the left */}
      {!hideChevron && (
        <MaterialIcons name="chevron-left" size={20} color="#d1d5db" />
      )}
      {/* Label + note in the middle */}
      <View
        style={[
          styles.rowTextContainer,
          hideChevron && styles.rowTextNoChevron,
        ]}
      >
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>
          {label}
        </Text>
        {note !== undefined && <Text style={styles.rowNote}>{note}</Text>}
      </View>
      {/* Icon on the right */}
      <MaterialIcons
        name={iconName as never}
        size={21}
        color={danger ? '#ef4444' : '#9ca3af'}
      />
    </TouchableOpacity>
  );
}

// ============================================================================
// Debug helpers
// ============================================================================

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugValue}>{value}</Text>
      <Text style={styles.debugLabel}>{label}</Text>
    </View>
  );
}

function DebugButton({
  iconName,
  label,
  onPress,
}: {
  iconName: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.debugButton}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialIcons name="chevron-left" size={16} color="#71717a" />
      <Text style={styles.debugButtonText}>{label}</Text>
      <MaterialIcons name={iconName as never} size={18} color="#4fc3f7" />
    </TouchableOpacity>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },
  scroll: {
    flex: 1,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 8,
    paddingRight: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerLogo: {
    width: 220,
    height: 88,
    backgroundColor: 'transparent',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
  },

  // ── Cards ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  settingsCard: {
    overflow: 'hidden',
  },

  // ── Profile card ───────────────────────────────────────────────────────────
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  profileTexts: {
    flex: 1,
    alignItems: 'flex-end',
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
  },
  profileSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 2,
  },

  // ── Invite card ────────────────────────────────────────────────────────────
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  inviteTexts: {
    flex: 1,
    alignItems: 'flex-end',
  },
  inviteTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111517',
    textAlign: 'right',
  },
  inviteSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 2,
  },

  // ── Section title ──────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    paddingHorizontal: 20,
    marginBottom: 8,
    textAlign: 'right',
  },

  // ── Settings rows ──────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rowTextContainer: {
    flex: 1,
    marginRight: 12,
    alignItems: 'flex-end',
  },
  rowTextNoChevron: {
    marginRight: 0,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111517',
    textAlign: 'right',
  },
  rowLabelDanger: {
    color: '#ef4444',
  },
  rowNote: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 2,
  },

  // ── Debug panel ────────────────────────────────────────────────────────────
  debugContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  debugHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  debugHeaderOpen: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  debugHeaderClosed: {
    borderRadius: 20,
  },
  debugHeaderText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#eab308',
    textAlign: 'right',
  },
  debugBody: {
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: 'rgba(234, 179, 8, 0.3)',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  debugSectionLabel: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 8,
  },
  debugRows: {
    gap: 8,
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  debugValue: {
    fontSize: 13,
    color: '#374151',
  },
  debugLabel: {
    fontSize: 13,
    color: '#9ca3af',
  },
  debugButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  debugButtonText: {
    flex: 1,
    fontSize: 14,
    color: '#111517',
    textAlign: 'right',
  },

  // ── Dev banner ─────────────────────────────────────────────────────────────
  devBanner: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  devBannerText: {
    color: '#eab308',
    textAlign: 'center',
    fontSize: 14,
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    fontSize: 12,
    color: '#d1d5db',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 40,
  },
});
