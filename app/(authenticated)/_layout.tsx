import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import * as Device from 'expo-device';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Tabs,
  useRootNavigationState,
  useRouter,
  useSegments,
} from 'expo-router';
import { useContext, useEffect, useRef, useState } from 'react';

// Same key exported from app/shared/[token].tsx — kept here as a literal to avoid
// dynamic-segment import issues in the module resolver.
const PENDING_SHARE_TOKEN_KEY = 'pendingShareToken';

import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InYomiSplashScreen } from '@/components/InYomiSplashScreen';
import { UpgradeModal, type UpgradeReason } from '@/components/UpgradeModal';
import { colors } from '@/constants/theme';
import {
  ActionSheetContext,
  type ActiveCommunityContext,
} from '@/contexts/ActionSheetContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useRevenueCat } from '@/contexts/RevenueCatContext';
import { api } from '@/convex/_generated/api';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import { PENDING_COMMUNITY_EVENT_ID_KEY } from '@/lib/pendingEventLink';
import {
  consumePendingNavigationTarget,
  registerForPushNotifications,
  setupNotificationHandlers,
  subscribeToPendingNavigation,
} from '@/lib/pushNotifications';
import { rtl } from '@/lib/rtl';

// ─── Regular Tab Button (icon + label wrapped in selection pill) ──────────────

type TabBtnProps = {
  iconName: string;
  label: string;
  onPress?: ((e: unknown) => void) | null;
  onLongPress?: ((e: unknown) => void) | null;
  // React Navigation passes focused state as aria-selected, not accessibilityState
  'aria-selected'?: boolean;
};

function RegularTabButton({
  iconName,
  label,
  onPress,
  onLongPress,
  'aria-selected': ariaSelected,
}: TabBtnProps) {
  const focused = ariaSelected === true;
  const color = focused ? colors.primaryDark : '#687477';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tabButtonBase}
      accessible={true}
      accessibilityRole="tab"
      aria-selected={focused}
    >
      <View style={focused ? styles.activeTabPill : styles.inactiveTabItem}>
        <MaterialIcons name={iconName as never} size={22} color={color} />
        <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Central Plus Tab Button (raised circle) ──────────────────────────────────

function PlusCenterButton() {
  const { openActionSheet } = useContext(ActionSheetContext);
  return (
    <Pressable
      onPress={openActionSheet}
      style={styles.tabButtonBase}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel="הוסף פריט חדש"
      accessibilityHint="פותח תפריט ליצירת אירוע, משימה או יום הולדת"
    >
      <LinearGradient
        colors={[colors.primaryDark, colors.primary]}
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={styles.plusBtn}
      >
        <MaterialIcons name="add" size={34} color="#002F43" />
      </LinearGradient>
    </Pressable>
  );
}

// ─── Action Sheet Modal ───────────────────────────────────────────────────────

function ActionSheetModal({
  isVisible,
  onClose,
  isExpiredFree,
  onGatedPress,
  communityContext,
}: {
  isVisible: boolean;
  onClose: () => void;
  isExpiredFree: boolean;
  onGatedPress: (reason: UpgradeReason) => void;
  communityContext: ActiveCommunityContext | null;
}) {
  const router = useRouter();

  // Gate personal/family create actions when trial has expired.
  // Community actions are not gated by the personal-trial paywall (unchanged
  // from the previous top community "+" behavior, which never gated either).
  function handleGatedCreateAction(
    action: () => void,
    reason: UpgradeReason = 'general'
  ) {
    if (isExpiredFree) {
      onGatedPress(reason);
      return;
    }
    action();
  }

  // Stage 2B: while inside a community, personal actions get the "אישי"
  // suffix so they read unambiguously alongside/without the community group.
  // Outside a community (communityContext === null) labels are UNCHANGED.
  const personalEventLabel = communityContext ? 'אירוע אישי' : 'אירוע';
  const personalTaskLabel = communityContext ? 'משימה אישית' : 'משימה';
  const showCommunityActions =
    communityContext?.canCreateCommunityContent === true;

  return (
    <Modal
      animationType="slide"
      transparent
      visible={isVisible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.bottomSheetContainer}
      >
        <View style={styles.sheetPanel}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetInput}>
            <MaterialIcons
              name="auto-awesome"
              size={20}
              color={colors.primaryDark}
            />
            <TextInput
              style={styles.sheetTextInput}
              placeholder="על מה את חושבת? או הדביקי הודעה..."
              placeholderTextColor="#94a3b8"
            />
            <View style={styles.sheetInputIcons}>
              <MaterialIcons name="photo-camera" size={22} color="#94a3b8" />
              <MaterialIcons name="mic" size={22} color="#94a3b8" />
            </View>
          </View>

          {showCommunityActions && communityContext ? (
            <>
              <Text style={styles.sheetSectionTitle}>
                {`בקהילה הזו · ${communityContext.communityName}`}
              </Text>
              <View style={styles.sheetActions}>
                <ActionButton
                  icon="event"
                  label="אירוע בקהילה"
                  onPress={() => {
                    onClose();
                    router.push(
                      `/(authenticated)/event/new?communityId=${communityContext.communityId}` as Parameters<
                        typeof router.push
                      >[0]
                    );
                  }}
                />
                <ActionButton
                  icon="notifications-active"
                  label="תזכורת בקהילה"
                  onPress={() => {
                    onClose();
                    router.push(
                      `/(authenticated)/community-reminder/new?communityId=${communityContext.communityId}` as Parameters<
                        typeof router.push
                      >[0]
                    );
                  }}
                />
              </View>
              <Text style={styles.sheetSectionTitle}>אישי</Text>
            </>
          ) : null}

          <View style={styles.sheetActions}>
            <ActionButton
              icon="calendar-today"
              label={personalEventLabel}
              onPress={() =>
                handleGatedCreateAction(() => {
                  onClose();
                  router.push('/(authenticated)/event/new');
                }, 'personal')
              }
            />
            <ActionButton
              icon="check"
              label={personalTaskLabel}
              onPress={() =>
                handleGatedCreateAction(() => {
                  onClose();
                  router.push('/(authenticated)/task/new');
                }, 'personal')
              }
            />
            <ActionButton
              icon="cake"
              label="יום הולדת"
              onPress={() => {
                onClose();
                router.push('/birthdays');
              }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 8 }}>
      <View style={styles.actionBtnCircle}>
        <MaterialIcons
          name={icon as never}
          size={28}
          color={colors.primaryDark}
        />
      </View>
      <Text style={styles.actionBtnLabel}>{label}</Text>
    </Pressable>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function AuthenticatedLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isLoading: isRevenueCatLoading } = useRevenueCat();
  // FIXED: deferred saveAll() to authenticated layout to avoid auth race condition
  // hasCompletedOnboardingLocally lets a just-registered user through while Convex
  // propagates the finishOnboarding mutation result (avoids redirect loop).
  const {
    data: onboardingData,
    updateData,
    hydrateFromServer,
    isDraftHydrated,
  } = useOnboarding();
  // FIXED: Stage 1 — the local pre-auth draft (if any) is now hydrated into
  // OnboardingContext once at app start (see OnboardingContext.tsx), so
  // onboardingData.spaceType already reflects both a same-session answer
  // and a restored draft. isDraftHydrated (below, via isReadyToRoute) gates
  // routing decisions until that one-time async check has settled.
  const hasCompletedOnboardingLocally = !!onboardingData.spaceType;
  const finishOnboarding = useMutation(api.onboarding.finishOnboarding);
  // Ref guard prevents a second mutation call if a render occurs while the first is in-flight.
  const savingRef = useRef(false);

  const { isExpiredFree } = useEffectiveAccess();

  const insets = useSafeAreaInsets();
  // On Android the system navigation bar (gesture or 3-button) overlaps the tab
  // bar unless we push it up by the bottom inset. Use at least 16 px as a floor
  // so the bar clears even on devices that report a 0 inset incorrectly.
  const androidBottomPadding =
    Platform.OS === 'android' ? Math.max(insets.bottom, 16) : 25;
  // Keep the visual content area height (icon + label) constant across devices:
  // original content height = 90 (total) − 25 (paddingBottom) = 65 px.
  const tabBarHeight =
    Platform.OS === 'android' ? 65 + androidBottomPadding : 90;

  const navigationState = useRootNavigationState();
  const router = useRouter();
  const segments = useSegments();
  const registerPushToken = useMutation(api.pushTokens.registerPushToken);
  const [isActionSheetVisible, setIsActionSheetVisible] = useState(false);
  const [activeCommunityContext, setActiveCommunityContext] =
    useState<ActiveCommunityContext | null>(null);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<UpgradeReason>('general');

  // Fetch onboarding status — skip the query while not yet authenticated to avoid
  // an unnecessary round-trip and potential auth errors
  const userStatus = useQuery(
    api.users.getCurrentUserStatus,
    isAuthenticated ? {} : 'skip'
  );

  const shouldCheckFamilyBootstrap =
    isAuthenticated &&
    (hasCompletedOnboardingLocally || userStatus?.onboardingComplete === true);
  const familyBootstrapStatus = useQuery(
    api.users.getFamilyBootstrapStatus,
    shouldCheckFamilyBootstrap ? {} : 'skip'
  );

  // FIXED: context now rehydrates from Convex on authenticated app start.
  // Fetches fullName, profileColor, spaceType for the current user.
  // Skip when not authenticated to avoid a needless round-trip.
  const myProfile = useQuery(
    api.users.getMyProfile,
    isAuthenticated ? {} : 'skip'
  );
  // Guard: only hydrate once per session.
  const hydratedRef = useRef(false);

  useEffect(() => {
    // Only hydrate for confirmed returning users (onboardingComplete on server)
    // whose context is still empty (app was restarted). The !onboardingData.onboardingCompleted
    // guard ensures a just-completed onboarding session is never overwritten.
    if (
      !isAuthenticated ||
      !userStatus?.onboardingComplete ||
      onboardingData.onboardingCompleted ||
      !myProfile ||
      hydratedRef.current
    )
      return;

    hydratedRef.current = true;
    hydrateFromServer(myProfile);
  }, [
    isAuthenticated,
    userStatus,
    myProfile,
    onboardingData.onboardingCompleted,
    hydrateFromServer,
  ]);

  // FIXED: deferred saveAll() to authenticated layout to avoid auth race condition.
  // Called once after the Convex session is confirmed active (userStatus has resolved),
  // so the server never sees an unauthenticated finishOnboarding call.
  useEffect(() => {
    if (
      !isAuthenticated ||
      userStatus === undefined ||
      userStatus === null ||
      userStatus.onboardingComplete ||
      !hasCompletedOnboardingLocally ||
      onboardingData.onboardingCompleted ||
      savingRef.current
    )
      return;

    savingRef.current = true;
    finishOnboarding({
      fullName:
        [onboardingData.firstName, onboardingData.lastName]
          .filter(Boolean)
          .join(' ') ||
        onboardingData.firstName ||
        'משתמש',
      profileColor: onboardingData.personalColor ?? '#36a9e2',
      spaceType: onboardingData.spaceType ?? 'personal',
      challenges: onboardingData.challenges ?? [],
      childCount: onboardingData.childCount,
      familyContacts: onboardingData.familyData?.familyMembers,
    })
      .catch((err: unknown) =>
        console.warn('[Onboarding] finishOnboarding failed:', err)
      )
      .finally(() => updateData({ onboardingCompleted: true }));
  }, [
    isAuthenticated,
    userStatus,
    hasCompletedOnboardingLocally,
    onboardingData.onboardingCompleted,
    onboardingData.firstName,
    onboardingData.lastName,
    onboardingData.personalColor,
    onboardingData.spaceType,
    onboardingData.challenges,
    onboardingData.childCount,
    onboardingData.familyData,
    finishOnboarding,
    updateData,
  ]);

  // FIXED: restore pending share intent after successful authentication
  // If user was redirected to sign-in from a shared event preview screen,
  // the token is stored in AsyncStorage and we navigate back to the preview after login.
  useEffect(() => {
    if (!isAuthenticated) return;
    AsyncStorage.getItem(PENDING_SHARE_TOKEN_KEY)
      .then((pendingToken) => {
        if (!pendingToken) return;
        return AsyncStorage.removeItem(PENDING_SHARE_TOKEN_KEY).then(() => {
          router.push({
            pathname: '/shared/[token]',
            params: { token: pendingToken },
          });
        });
      })
      .catch(() => {});
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    AsyncStorage.getItem(PENDING_COMMUNITY_EVENT_ID_KEY)
      .then((pendingEventId) => {
        if (!pendingEventId) return;
        return AsyncStorage.removeItem(PENDING_COMMUNITY_EVENT_ID_KEY).then(
          () => {
            router.replace({
              pathname: '/e/[eventId]',
              params: { eventId: pendingEventId },
            });
          }
        );
      })
      .catch(() => {});
  }, [isAuthenticated, router]);

  // Register push token and wire notification tap handler once onboarding is done
  useEffect(() => {
    if (userStatus?.onboardingComplete !== true) return;

    let cleanup: (() => void) | undefined;

    const init = async () => {
      let token: string | null = null;
      try {
        token = await registerForPushNotifications();
      } catch (err) {
        console.warn('[Push] registerForPushNotifications threw:', err);
      }

      if (token) {
        try {
          await registerPushToken({
            token,
            platform: Platform.OS as 'ios' | 'android',
            deviceId: Device.modelId ?? undefined,
          });
        } catch (err) {
          console.warn('[Push] registerPushToken mutation failed:', err);
        }
      }

      cleanup = setupNotificationHandlers();
    };

    init();

    return () => {
      cleanup?.();
    };
  }, [userStatus?.onboardingComplete, registerPushToken, router]);

  // Wait for: navigation tree, auth state, RevenueCat, and user profile to resolve
  const isUserStatusLoading = isAuthenticated && userStatus === undefined;
  const isSyncingOnboarding =
    isAuthenticated &&
    hasCompletedOnboardingLocally &&
    userStatus?.onboardingComplete !== true;
  const isFamilyBootstrapLoading =
    shouldCheckFamilyBootstrap &&
    !isSyncingOnboarding &&
    familyBootstrapStatus === undefined;
  const segmentStrings = segments as string[];
  const isFamilyBootstrapRoute = segmentStrings.includes('family-bootstrap');
  const isProfileSetupRoute = segmentStrings.includes('family-profile-setup');
  const needsOnboardingRedirect =
    isAuthenticated &&
    userStatus !== undefined &&
    !userStatus?.onboardingComplete &&
    !hasCompletedOnboardingLocally;
  const needsProfileSetupRedirect =
    isAuthenticated &&
    !isFamilyBootstrapRoute &&
    !isProfileSetupRoute &&
    (isSyncingOnboarding ||
      (userStatus?.onboardingComplete === true &&
        familyBootstrapStatus !== undefined &&
        familyBootstrapStatus !== null &&
        !familyBootstrapStatus.hasConfiguredFamily &&
        !familyBootstrapStatus.joinedExistingSpace &&
        familyBootstrapStatus.familySetupSkippedAt === null));
  // FIXED: family profile persistence — for returning users, hold the spinner until hydrateFromServer
  // has actually run (onboardingCompleted flips true). Without this gate, tabs render with empty
  // OnboardingContext before the hydration effect fires, causing a flash of personal-only state in
  // profile.tsx and stale-init of useFamilyProfileEditor's useState in family-profile.tsx.
  // myProfile !== null guard prevents an infinite spinner if the user record is missing (edge case).
  const needsHydration =
    isAuthenticated &&
    userStatus?.onboardingComplete === true &&
    !onboardingData.onboardingCompleted &&
    myProfile !== null;

  const isReadyToRoute =
    !!navigationState?.key &&
    !isLoading &&
    !isRevenueCatLoading &&
    isDraftHydrated &&
    !isUserStatusLoading &&
    !isFamilyBootstrapLoading &&
    !needsHydration;

  // ─── Push notification navigation ──────────────────────────────────────────
  // Keep a ref that always mirrors the current readiness so the subscription
  // callback (which closes over a stale value) can check it synchronously.
  const isReadyToRouteRef = useRef(isReadyToRoute);
  useEffect(() => {
    isReadyToRouteRef.current = isReadyToRoute;
  }, [isReadyToRoute]);

  // Subscribe to targets that arrive while the component is mounted (warm /
  // background taps, or a cold-start target that was stored before readiness).
  useEffect(() => {
    const navigateToPendingTarget = () => {
      if (!isReadyToRouteRef.current) return;
      const target = consumePendingNavigationTarget();
      if (!target) return;
      router.replace(target as Parameters<typeof router.replace>[0]);
    };

    const unsubscribe = subscribeToPendingNavigation(() => {
      navigateToPendingTarget();
    });

    // Also attempt immediately in case the target was stored before this
    // effect ran (e.g. cold-start capture completed before layout mounted).
    navigateToPendingTarget();

    return unsubscribe;
  }, [router]);

  // When routing becomes ready, check whether a pending target was stored
  // before readiness arrived (the subscription callback would have returned
  // early because isReadyToRouteRef was still false at that moment).
  useEffect(() => {
    if (!isReadyToRoute) return;
    const target = consumePendingNavigationTarget();
    if (target) {
      router.replace(target as Parameters<typeof router.replace>[0]);
    }
  }, [isReadyToRoute, router]);

  useEffect(() => {
    if (!isReadyToRoute) return;

    if (!isAuthenticated) {
      router.replace('/(auth)/sign-in');
      return;
    }

    if (needsOnboardingRedirect) {
      router.replace('/onboarding-hero');
      return;
    }

    if (needsProfileSetupRedirect) {
      router.replace('/(authenticated)/family-bootstrap');
      return;
    }
  }, [
    isAuthenticated,
    isReadyToRoute,
    needsOnboardingRedirect,
    needsProfileSetupRedirect,
    router,
  ]);

  if (
    !isReadyToRoute ||
    !isAuthenticated ||
    needsOnboardingRedirect ||
    needsProfileSetupRedirect
  ) {
    return <InYomiSplashScreen />;
  }

  return (
    <ActionSheetContext.Provider
      value={{
        openActionSheet: () => setIsActionSheetVisible(true),
        setActiveCommunityContext,
      }}
    >
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primaryDark,
            tabBarInactiveTintColor: '#94a3b8',
            tabBarStyle: {
              backgroundColor: '#ffffff',
              borderTopColor: '#f0f0f0',
              height: tabBarHeight,
              paddingBottom: androidBottomPadding,
              paddingTop: 10,
              overflow: 'visible',
              // Keep tab order physically LTR on every platform regardless of I18nManager.isRTL.
              // Android with supportsRTL=true would otherwise mirror the row, moving "בית" to the right.
              // Screen content RTL is unaffected — this only controls the tab bar container direction.
              direction: 'ltr',
            },
            tabBarLabelStyle: { display: 'none' }, // labels rendered inside our custom buttons
          }}
        >
          {/* ── Visible tabs (left → right): בית | יומן | + | משימות | קהילות ── */}
          <Tabs.Screen
            name="index"
            options={{
              tabBarButton: (props) => (
                <RegularTabButton
                  {...(props as unknown as TabBtnProps)}
                  iconName="home"
                  label="בית"
                />
              ),
            }}
          />
          <Tabs.Screen
            name="calendar"
            options={{
              tabBarButton: (props) => (
                <RegularTabButton
                  {...(props as unknown as TabBtnProps)}
                  iconName="calendar-month"
                  label="יומן"
                />
              ),
            }}
          />
          {/* Central Plus */}
          <Tabs.Screen
            name="plus"
            options={{
              title: '',
              tabBarButton: () => <PlusCenterButton />,
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              tabBarButton: (props) => (
                <RegularTabButton
                  {...(props as unknown as TabBtnProps)}
                  iconName="check-circle-outline"
                  label="משימות"
                />
              ),
            }}
          />
          <Tabs.Screen
            name="communities"
            options={{
              tabBarButton: (props) => (
                <RegularTabButton
                  {...(props as unknown as TabBtnProps)}
                  iconName="people"
                  label="קהילות"
                />
              ),
            }}
          />
          {/* groups מחליף ל-communities – מוסתר */}
          <Tabs.Screen name="groups" options={{ href: null }} />
          {/* Profile is accessible via avatar press / navigation, not from tab bar */}
          <Tabs.Screen name="profile" options={{ href: null }} />

          {/* ── Hidden screens ── */}
          <Tabs.Screen name="birthdays" options={{ href: null }} />
          <Tabs.Screen name="event/new" options={{ href: null }} />
          <Tabs.Screen name="event/[id]" options={{ href: null }} />
          <Tabs.Screen name="task/new" options={{ href: null }} />
          <Tabs.Screen name="task/[id]" options={{ href: null }} />
          <Tabs.Screen name="import-calendar" options={{ href: null }} />
          <Tabs.Screen name="import-holidays" options={{ href: null }} />
          <Tabs.Screen name="family-profile" options={{ href: null }} />
          <Tabs.Screen name="family-profile-setup" options={{ href: null }} />
          <Tabs.Screen name="family-bootstrap" options={{ href: null }} />
          <Tabs.Screen name="community-create" options={{ href: null }} />
          <Tabs.Screen name="community-edit/[id]" options={{ href: null }} />
          <Tabs.Screen name="event-edit/[id]" options={{ href: null }} />
          <Tabs.Screen name="community-join/[code]" options={{ href: null }} />
          <Tabs.Screen name="community-members/[id]" options={{ href: null }} />
          <Tabs.Screen name="community/[id]" options={{ href: null }} />
          <Tabs.Screen name="community-reminder/new" options={{ href: null }} />
          <Tabs.Screen
            name="community-reminder/edit/[id]"
            options={{ href: null }}
          />
          {/* FIXED: linked-event detail screen — hidden from tab bar */}
          <Tabs.Screen name="linked-event/[id]" options={{ href: null }} />
          {/* Subscription sales screen — accessible via CTAs, not a tab */}
          <Tabs.Screen name="subscription" options={{ href: null }} />
          {/* Recently Deleted — accessible from Profile/Settings only, not a tab */}
          <Tabs.Screen name="recently-deleted" options={{ href: null }} />
          {/* Holiday overlay settings — accessible via deep-link only, not a tab */}
          <Tabs.Screen
            name="holiday-overlay-settings"
            options={{ href: null }}
          />
        </Tabs>

        <ActionSheetModal
          isVisible={isActionSheetVisible}
          onClose={() => setIsActionSheetVisible(false)}
          isExpiredFree={isExpiredFree}
          onGatedPress={(reason) => {
            setIsActionSheetVisible(false);
            setUpgradeReason(reason);
            setUpgradeModalVisible(true);
          }}
          communityContext={activeCommunityContext}
        />

        <UpgradeModal
          visible={upgradeModalVisible}
          reason={upgradeReason}
          onClose={() => setUpgradeModalVisible(false)}
        />
      </View>
    </ActionSheetContext.Provider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Tab bar buttons
  tabButtonBase: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTabPill: {
    backgroundColor: 'rgba(85,192,251,0.22)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 5,
    alignItems: 'center',
    gap: 2,
  },
  inactiveTabItem: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    gap: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tabLabelActive: { color: colors.primaryDark, fontWeight: '700' },

  // Central plus button — raised circle
  plusBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },

  // Action sheet
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  bottomSheetContainer: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  sheetPanel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 48,
  },
  sheetHandle: {
    width: 40,
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 24,
  },
  sheetInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    borderRadius: 16,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 32,
  },
  sheetTextInput: {
    flex: 1,
    textAlign: rtl.inputTextAlign,
    fontSize: 16,
    paddingHorizontal: 12,
    color: '#111517',
  },
  sheetInputIcons: { flexDirection: rtl.flexDirection, gap: 8 },
  sheetSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    textAlign: rtl.textAlign,
    marginBottom: 12,
  },
  sheetActions: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  actionBtnCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f0f7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnLabel: { fontSize: 14, fontWeight: '700', color: '#111418' },
});
