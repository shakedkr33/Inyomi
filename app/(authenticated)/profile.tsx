import { useAuthActions } from '@convex-dev/auth/react';
import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  APP_ENV,
  MOCK_PAYMENTS,
  PAYMENT_SYSTEM_ENABLED,
} from '@/config/appConfig';
import type { EffectiveAccess } from '@/config/devAccessConfig';
import {
  getDevPlanOverride,
  setDevPlanOverride,
  subscribeDevPlanOverride,
} from '@/config/devPlanOverride';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useRevenueCat } from '@/contexts/RevenueCatContext';
import { api } from '@/convex/_generated/api';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import { getAvatarInitials } from '@/lib/avatarInitials';
// Canonical family/profile membership signal (Stage 2B+3 locked rule) — the
// ACTUAL configured family members determine 'family' vs 'personal', never
// a stored/local spaceType flag. Reused here (not duplicated) to decide the
// unified profile card's subtitle. See lib/spaceTypeDerivation.ts.
import { getBillingPeriodFromProductIdentifier } from '@/lib/billingPeriod';
import { clearOnboardingDraft } from '@/lib/onboardingState';
import { APP_IS_RTL, rtl } from '@/lib/rtl';
import { deriveSpaceTypeFromFamilyMembers } from '@/lib/spaceTypeDerivation';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

declare const __DEV__: boolean;

// ============================================================================
// UnifiedProfileCard
// ============================================================================
// PART 1 — unifies the previous non-clickable "identity" card (avatar + name)
// and the separate clickable "הפרופיל שלי" card into a single clickable
// card. Preserves the existing avatar styling from the old identity card and
// the chevron/navigation affordance from the old profile-family card.
// ============================================================================

function UnifiedProfileCard({
  displayName,
  avatarInitial,
  avatarColor,
  subtitle,
  onPress,
}: {
  displayName: string;
  avatarInitial: string;
  avatarColor: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${displayName}, ${subtitle}`}
    >
      <View style={styles.accountRow}>
        <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
          <Text style={styles.avatarInitial}>{avatarInitial}</Text>
        </View>
        <View style={styles.accountTexts}>
          <Text style={styles.accountName}>{displayName}</Text>
          <Text style={styles.familySubtitle}>{subtitle}</Text>
        </View>
        <MaterialIcons name="chevron-left" size={22} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

// ============================================================================
// SubscriptionStatusCard
// ============================================================================

// PART 2 — single-paid-plan model. The app has exactly ONE paid offering,
// "InYomi Together" (see app/(authenticated)/subscription.tsx). isPersonal
// and isFamily both represent an active paid entitlement (legacy two-tier
// RevenueCat entitlements — see contexts/RevenueCatContext.tsx) but the
// Settings UI must never surface that legacy split to the user.
const UPGRADE_LABEL = 'שדרוג ל-InYomi Together';
const MANAGE_LABEL = 'ניהול המנוי';

const BILLING_PERIOD_LABEL: Record<'annual' | 'monthly', string> = {
  annual: 'מנוי שנתי',
  monthly: 'מנוי חודשי',
};

function SubscriptionStatusCard({
  isPersonal,
  isFamily,
  isTrialActive,
  isQaOverride,
  trialDaysRemaining,
  trialTotalDays,
  billingPeriod,
  onUpgradePress,
  onManagePress,
}: {
  isPersonal: boolean;
  isFamily: boolean;
  isTrialActive: boolean;
  isQaOverride: boolean;
  trialDaysRemaining: number | null;
  trialTotalDays: number;
  billingPeriod: 'annual' | 'monthly' | null;
  onUpgradePress: () => void;
  onManagePress: () => void;
}) {
  // QA / dev override — show muted test badge, no purchase UI
  if (isQaOverride) {
    return (
      <View style={styles.card}>
        <View style={styles.subContent}>
          <View style={[styles.subBadgeRow, styles.subBadgeQa]}>
            <MaterialIcons name="science" size={14} color="#ca8a04" />
            <Text style={[styles.subBadgeText, styles.subBadgeTextQa]}>
              מצב בדיקה
            </Text>
          </View>
          <Text style={styles.subTitle}>גישת בדיקה פעילה</Text>
          <Text style={styles.subSubtitle}>מצב זה מיועד לבדיקה בלבד</Text>
        </View>
      </View>
    );
  }

  // STATE C — Paid (InYomi Together). isPersonal / isFamily are both a paid
  // entitlement (legacy two-tier RevenueCat model) — treated identically
  // here since there is only one user-facing paid plan.
  if (isPersonal || isFamily) {
    return (
      <View style={styles.card}>
        <View style={styles.subContent}>
          <View style={[styles.subBadgeRow, styles.subBadgeActive]}>
            <MaterialIcons name="check-circle" size={14} color="#16a34a" />
            <Text style={[styles.subBadgeText, styles.subBadgeTextActive]}>
              פעיל
            </Text>
          </View>
          <Text style={styles.subTitle}>InYomi Together</Text>
          {billingPeriod !== null && (
            <Text style={styles.subSubtitle}>
              {BILLING_PERIOD_LABEL[billingPeriod]}
            </Text>
          )}
          <TouchableOpacity
            onPress={onManagePress}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={MANAGE_LABEL}
            style={styles.subManageBtn}
          >
            <Text style={styles.subManageBtnText}>{MANAGE_LABEL}</Text>
            <MaterialIcons name="chevron-left" size={15} color="#36a9e2" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // STATE A — Trial
  if (isTrialActive) {
    const daysLabel =
      trialDaysRemaining === null
        ? `תקופת ניסיון פעילה מתוך ${trialTotalDays}`
        : trialDaysRemaining === 1
          ? `נותר יום אחד מתוך ${trialTotalDays}`
          : `נותרו ${trialDaysRemaining} ימים מתוך ${trialTotalDays}`;

    return (
      <View style={styles.card}>
        <View style={styles.subContent}>
          <View style={[styles.subBadgeRow, styles.subBadgeTrial]}>
            <MaterialIcons name="hourglass-empty" size={14} color="#2563eb" />
            <Text style={[styles.subBadgeText, styles.subBadgeTextTrial]}>
              ניסיון
            </Text>
          </View>
          <Text style={styles.subTitle}>תקופת ניסיון</Text>
          <Text style={styles.subSubtitle}>{daysLabel}</Text>
          <TouchableOpacity
            onPress={onUpgradePress}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={UPGRADE_LABEL}
            style={styles.subUpgradeBtn}
          >
            <Text style={styles.subUpgradeBtnText}>{UPGRADE_LABEL}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // STATE B — Free (trial expired). Do not implement/enforce the 3-community
  // limit here — this is copy-only; enforcement (if any) lives elsewhere.
  return (
    <View style={styles.card}>
      <View style={styles.subContent}>
        <View style={[styles.subBadgeRow, styles.subBadgeFree]}>
          <MaterialIcons name="lock-open" size={14} color="#6b7280" />
          <Text style={[styles.subBadgeText, styles.subBadgeTextFree]}>
            חינמי
          </Text>
        </View>
        <Text style={styles.subTitle}>מסלול חינמי</Text>
        <Text style={styles.subSubtitle}>
          ניתן ליצור עד 3 קהילות ולהצטרף לקהילות ללא הגבלה
        </Text>
        <TouchableOpacity
          onPress={onUpgradePress}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={UPGRADE_LABEL}
          style={styles.subUpgradeBtn}
        >
          <Text style={styles.subUpgradeBtnText}>{UPGRADE_LABEL}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ============================================================================
// ProfileScreen
// ============================================================================

export default function ProfileScreen() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { signOut } = useAuthActions();
  const {
    isPremium,
    isConfigured,
    isExpoGo,
    customerData,
    subscriptionTier,
    presentCustomerCenter,
  } = useRevenueCat();
  const deleteMyAccount = useMutation(api.users.deleteMyAccount);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isDebugUnlocked, setIsDebugUnlocked] = useState(false);

  const [devPlan, setDevPlanState] = useState<EffectiveAccess | null>(() =>
    getDevPlanOverride()
  );
  useEffect(() => {
    return subscribeDevPlanOverride(() => {
      setDevPlanState(getDevPlanOverride());
    });
  }, []);

  const {
    effectiveAccess,
    isTrialActive,
    isPersonal,
    isFamily,
    isQaOverride,
    trialDaysRemaining,
    trialTotalDays,
  } = useEffectiveAccess();

  // PART 1 — unified profile card subtitle. Reuses the canonical live
  // family/profile membership source (convex/members.ts#listMyFamilyContacts
  // — the same query the calendar profile filter and community association
  // picker already use) rather than a stale/local onboarding flag: the
  // previous ProfileFamilyCard used onboardingData.spaceType, which is the
  // Q1 onboarding-intent answer and is documented (lib/spaceTypeDerivation.ts)
  // as "analytics/personalization only — must never decide architecture" and
  // is never updated again after a member is added/removed post-onboarding.
  const familyContactsResult = useQuery(api.members.listMyFamilyContacts);
  const hasAdditionalFamilyMembers =
    familyContactsResult !== undefined &&
    deriveSpaceTypeFromFamilyMembers(
      familyContactsResult.members
        .filter((m) => m._id !== familyContactsResult.selfEntityId)
        .map((m) => ({ type: m.memberType }))
    ) === 'family';
  const profileSubtitle = hasAdditionalFamilyMembers
    ? 'הפרופיל המשפחתי'
    : 'הפרופיל שלי';

  const { data: onboardingData, resetData } = useOnboarding();
  const rawFirstName = onboardingData.firstName ?? '';
  const rawLastName = onboardingData.lastName ?? '';
  const rawNickname = onboardingData.nickname ?? '';
  const displayName =
    rawNickname.trim() ||
    [rawFirstName, rawLastName].filter(Boolean).join(' ').trim() ||
    'המשתמש שלי';
  const avatarInitial =
    getAvatarInitials({
      firstName: rawFirstName,
      lastName: rawLastName,
      fullName: displayName,
    }) || 'מ';
  const avatarColor = onboardingData.personalColor || '#36a9e2';

  // ── Handlers ────────────────────────────────────────────────────────────────

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
              // FIXED: Stage 1 — clear temporary onboarding state BEFORE
              // signOut() so a second person using this device never
              // inherits it. Done deterministically here rather than
              // relying on code that runs after auth-state navigation may
              // have already unmounted this screen. This only clears the
              // local pre-auth draft + in-memory OnboardingContext (never
              // server-side user/profile/onboarding data). If signOut then
              // fails, the still-signed-in user's profile display simply
              // re-hydrates from the server (see the authenticated
              // layout's existing hydrateFromServer effect).
              await clearOnboardingDraft();
              resetData();
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

  const handleClose = (): void => {
    const destination =
      returnTo && returnTo.length > 0 ? returnTo : '/(authenticated)';
    router.replace(destination as never);
  };

  const openPaywallPreview = () => router.push('/(auth)/paywall?preview=true');
  const openSignInPreview = () => router.push('/(auth)/sign-in?preview=true');
  const openSignUpPreview = () => router.push('/(auth)/sign-up?preview=true');

  // PART 2/3 — billing period + subscription management. Derived strictly
  // from the active RevenueCat entitlement's product identifier — never
  // guessed. See lib/billingPeriod.ts#getBillingPeriodFromProductIdentifier.
  const billingPeriod = getBillingPeriodFromProductIdentifier(
    customerData?.activeProductIdentifier ?? null
  );

  // PART 3 — a paid user must never be routed back to the sales paywall to
  // manage an existing subscription. presentCustomerCenter() is the existing
  // canonical RevenueCat management entry point (contexts/RevenueCatContext.tsx):
  // it presents the native Customer Center UI (App Store management on iOS,
  // Google Play management on Android) and already has its own calm
  // fallback chain (RevenueCat managementURL → iOS showManageSubscriptions →
  // explanatory alert) if that UI cannot be presented — never the paywall.
  const handleManageSubscription = async () => {
    await presentCustomerCenter();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null,
      ]}
      edges={['top']}
    >
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Header ── */}
        {/* direction:'ltr' locks to physical row regardless of native RTL flip — matches MainScreenHeader pattern */}
        <View
          style={styles.headerContainer}
          onLayout={(e) =>
            console.log('[header] container', e.nativeEvent.layout)
          }
        >
          {/* Physical LEFT: X first, then logo immediately to its right */}
          <View
            style={styles.headerLeftGroup}
            onLayout={(e) =>
              console.log('[header] leftGroup', e.nativeEvent.layout)
            }
          >
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="סגור הגדרות"
              hitSlop={8}
              onLayout={(e) =>
                console.log('[header] xButton', e.nativeEvent.layout)
              }
            >
              <MaterialIcons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
            <Image
              source={require('@/assets/images/logo-inyomi-current.png')}
              style={styles.headerLogo}
              resizeMode="contain"
              accessibilityLabel="InYomi logo"
              onLayout={(e) =>
                console.log('[header] logo', e.nativeEvent.layout)
              }
            />
          </View>
          {/* Physical RIGHT: title */}
          <View style={styles.headerTitleGroup}>
            <Text style={styles.headerTitle}>הגדרות</Text>
          </View>
        </View>

        {/* ── Account / Profile — unified card (PART 1) ── */}
        <Text style={styles.sectionTitle}>החשבון שלי</Text>
        <UnifiedProfileCard
          displayName={displayName}
          avatarInitial={avatarInitial}
          avatarColor={avatarColor}
          subtitle={profileSubtitle}
          onPress={() =>
            router.push('/(authenticated)/family-profile' as never)
          }
        />

        {/* ── Subscription ── */}
        <Text style={styles.sectionTitle}>המנוי</Text>
        <SubscriptionStatusCard
          isPersonal={isPersonal}
          isFamily={isFamily}
          isTrialActive={isTrialActive}
          isQaOverride={isQaOverride}
          trialDaysRemaining={trialDaysRemaining}
          trialTotalDays={trialTotalDays}
          billingPeriod={billingPeriod}
          onUpgradePress={() =>
            router.push('/(authenticated)/subscription' as never)
          }
          onManagePress={handleManageSubscription}
        />

        {/* ── Settings ── */}
        <Text style={styles.sectionTitle}>הגדרות</Text>
        <View style={[styles.card, styles.settingsCard]}>
          <SettingsRow
            label="העתקת אירועים מיומן חיצוני"
            onPress={() => router.push('/(authenticated)/import-calendar')}
          />
          <SettingsRow
            label="התראות"
            onPress={() => console.log('TODO: notifications settings')}
          />
          <SettingsRow
            label="חגים ומועדים"
            note="בחירת חגים וימים מיוחדים להצגה ביומן"
            onPress={() =>
              router.push('/(authenticated)/holiday-overlay-settings')
            }
          />
          <SettingsRow
            label="נמחקו לאחרונה"
            isLast
            onPress={() => router.push('/(authenticated)/recently-deleted')}
          />
        </View>

        {/* ── Destructive actions ── */}
        <View style={[styles.card, styles.settingsCard, styles.dangerCard]}>
          <SettingsRow label="התנתקות" danger onPress={handleSignOut} />
          <SettingsRow
            label="מחיקת חשבון"
            danger
            hideChevron
            isLast
            onPress={handleDeleteAccount}
          />
        </View>

        {/* ── Debug panel — only in __DEV__ builds ── */}
        {__DEV__ && isDebugUnlocked && (
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
                  <DebugRow label="effectiveAccess" value={effectiveAccess} />
                  <DebugRow
                    label="subscriptionTier"
                    value={subscriptionTier ?? 'null'}
                  />
                  <DebugRow
                    label="Entitlements פעילים"
                    value={
                      customerData !== null &&
                      customerData !== undefined &&
                      customerData.activeEntitlements.length > 0
                        ? customerData.activeEntitlements.join(', ')
                        : 'none'
                    }
                  />
                  {customerData !== null && customerData !== undefined && (
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
                <Text style={[styles.debugSectionLabel, { marginTop: 16 }]}>
                  סימולציית מסלול מנוי (בדיקות בלבד)
                </Text>
                {devPlan !== null && (
                  <View style={styles.devOverrideBanner}>
                    <Text style={styles.devOverrideBannerText}>
                      {`⚠️ מצב בדיקה פעיל: ${
                        devPlan === 'trial_expired_free'
                          ? 'Free'
                          : devPlan === 'personal'
                            ? 'Plus'
                            : devPlan === 'family'
                              ? 'Family'
                              : devPlan
                      }`}
                    </Text>
                  </View>
                )}
                <View style={styles.devPlanRow}>
                  {(
                    [
                      { label: 'Free', value: 'trial_expired_free' },
                      { label: 'Plus', value: 'personal' },
                      { label: 'Family', value: 'family' },
                    ] as { label: string; value: EffectiveAccess }[]
                  ).map(({ label, value }) => (
                    <TouchableOpacity
                      key={value}
                      onPress={() => setDevPlanOverride(value)}
                      style={[
                        styles.devPlanBtn,
                        devPlan === value && styles.devPlanBtnActive,
                      ]}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`הפעל סימולציית מסלול ${label}`}
                    >
                      <Text
                        style={[
                          styles.devPlanBtnText,
                          devPlan === value && styles.devPlanBtnTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => setDevPlanOverride(null)}
                    style={styles.devPlanBtnClear}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="איפוס סימולציית מסלול"
                  >
                    <Text style={styles.devPlanBtnClearText}>איפוס</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.devOverrideNote}>
                  {devPlan !== null
                    ? 'האיפוס יחזיר את לוגיקת הגישה האמיתית.'
                    : 'בחר מסלול לסימולציה. השינוי נשמר גם לאחר reload.'}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* RTL Debug shortcut — __DEV__ only */}
        {__DEV__ && (
          <TouchableOpacity
            onPress={() => router.push('/(authenticated)/rtl-debug')}
            style={styles.rtlDebugBtn}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="RTL Debug"
          >
            <Text style={styles.rtlDebugBtnText}>RTL Debug</Text>
          </TouchableOpacity>
        )}

        {/* Version footer — long-press unlocks debug panel (__DEV__ only) */}
        <TouchableOpacity
          onLongPress={
            __DEV__ ? () => setIsDebugUnlocked((v) => !v) : undefined
          }
          delayLongPress={800}
          accessible={false}
        >
          <Text style={styles.footer}>InYomi v1.0.0</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// SettingsRow
// ============================================================================

function SettingsRow({
  label,
  onPress,
  danger = false,
  note,
  hideChevron = false,
  isLast = false,
}: {
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
      <View style={styles.rowTextContainer}>
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>
          {label}
        </Text>
        {note !== undefined && <Text style={styles.rowNote}>{note}</Text>}
      </View>
      {!hideChevron && (
        <MaterialIcons name="chevron-left" size={20} color="#d1d5db" />
      )}
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
  safeAreaRtl: {
    direction: 'rtl',
  },
  scroll: {
    flex: 1,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  // direction:'ltr' locks physical row on all platforms — same pattern as MainScreenHeader.tsx
  headerContainer: {
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 96,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerLogo: {
    width: 132,
    height: 90,
  },
  headerTitleGroup: {
    alignItems: 'flex-end',
  },
  headerLeftGroup: {
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Section title ──────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    paddingHorizontal: 20,
    marginBottom: 8,
    textAlign: rtl.textAlign,
  },

  // ── Card base ──────────────────────────────────────────────────────────────
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
  dangerCard: {
    marginTop: 4,
  },

  // ── Account card ───────────────────────────────────────────────────────────
  accountRow: {
    flexDirection: rtl.flexDirection,
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
  accountTexts: {
    flex: 1,
    alignItems: rtl.alignStart,
  },
  accountName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111517',
    textAlign: rtl.textAlign,
  },

  // ── Unified profile card — contextual subtitle (PART 1) ───────────────────
  familySubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },

  // ── Subscription card ──────────────────────────────────────────────────────
  subContent: {
    padding: 16,
  },
  subBadgeRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    alignSelf: rtl.alignStart,
    marginBottom: 10,
  },
  subBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  subBadgeActive: {
    backgroundColor: '#dcfce7',
  },
  subBadgeTextActive: {
    color: '#16a34a',
  },
  subBadgeTrial: {
    backgroundColor: '#dbeafe',
  },
  subBadgeTextTrial: {
    color: '#2563eb',
  },
  subBadgeFree: {
    backgroundColor: '#f3f4f6',
  },
  subBadgeTextFree: {
    color: '#6b7280',
  },
  subBadgeQa: {
    backgroundColor: '#fef9c3',
  },
  subBadgeTextQa: {
    color: '#ca8a04',
  },
  subTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111517',
    textAlign: rtl.textAlign,
  },
  subSubtitle: {
    fontSize: 14,
    color: '#374151',
    textAlign: rtl.textAlign,
    marginTop: 4,
  },
  subUpgradeBtn: {
    marginTop: 14,
    alignSelf: rtl.alignStart,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#36a9e2',
  },
  subUpgradeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    textAlign: rtl.textAlign,
  },
  subManageBtn: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 2,
    marginTop: 12,
    alignSelf: rtl.alignStart,
  },
  subManageBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#36a9e2',
    textAlign: rtl.textAlign,
  },

  // ── Settings rows ──────────────────────────────────────────────────────────
  row: {
    flexDirection: rtl.flexDirection,
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
    alignItems: rtl.alignStart,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111517',
    textAlign: rtl.textAlign,
  },
  rowLabelDanger: {
    color: '#ef4444',
  },
  rowNote: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },

  // ── RTL Debug button ───────────────────────────────────────────────────────
  rtlDebugBtn: {
    alignSelf: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fef9c3',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde047',
  },
  rtlDebugBtnText: {
    fontSize: 12,
    color: '#854d0e',
    fontWeight: '600',
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
    textAlign: rtl.textAlign,
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
    textAlign: rtl.textAlign,
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
    textAlign: rtl.textAlign,
  },

  // ── Dev plan override selector ─────────────────────────────────────────────
  devOverrideBanner: {
    backgroundColor: '#fef9c3',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#fde047',
    alignItems: 'center',
  },
  devOverrideBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#854d0e',
    textAlign: 'center',
  },
  devPlanRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  devPlanBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  devPlanBtnActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#3b82f6',
  },
  devPlanBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  devPlanBtnTextActive: {
    color: '#1d4ed8',
  },
  devPlanBtnClear: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  devPlanBtnClearText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#dc2626',
  },
  devOverrideNote: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 2,
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
