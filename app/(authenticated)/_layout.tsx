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
import {
  shouldExitCalendarImportToHome,
  shouldRedirectToCalendarImport,
} from '@/lib/calendarImportOnboarding';
import {
  isColdStartCaptureComplete,
  onColdStartCaptureComplete,
} from '@/lib/coldStartCaptureGate';
import { consumeSignedOutDestination } from '@/lib/explicitLogoutNavigation';
import { importTrace } from '@/lib/importFlowTrace';
import { resolvePostAuthOnboardingRoute } from '@/lib/onboardingRouting';
import { clearOnboardingDraft } from '@/lib/onboardingState';
import { PENDING_COMMUNITY_EVENT_ID_KEY } from '@/lib/pendingEventLink';
import {
  consumePendingNavigationTarget,
  peekPendingNavigationTarget,
  pushTokenLifecycle,
  registerForPushNotifications,
  rememberDevicePushToken,
  setupNotificationHandlers,
  subscribeToPendingNavigation,
} from '@/lib/pushNotifications';
import { rtl } from '@/lib/rtl';
import { startupTrace, startupTraceGates } from '@/lib/startupTrace';

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
  // Stage 2B+3: onboarding completion now happens ONLY via the mandatory
  // Profile Setup screen's explicit save (finishOnboarding is called from
  // hooks/useFamilyProfileEditor.ts saveAll(), never automatically from
  // this layout). hasCompletedOnboardingLocally still means "Q1/Q2
  // answered" — it now gates persisting those answers and checking for
  // phone matches, NOT auto-completing onboarding.
  const {
    data: onboardingData,
    hydrateFromServer,
    isDraftHydrated,
  } = useOnboarding();
  // FIXED: Stage 1 — the local pre-auth draft (if any) is now hydrated into
  // OnboardingContext once at app start (see OnboardingContext.tsx), so
  // onboardingData.spaceType already reflects both a same-session answer
  // and a restored draft. isDraftHydrated (below, via isReadyToRoute) gates
  // routing decisions until that one-time async check has settled.
  const hasCompletedOnboardingLocally = !!onboardingData.spaceType;

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
  const pushUserId = useQuery(api.users.getMyId, isAuthenticated ? {} : 'skip');
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

  // ROOT-CAUSE FIX (post-delete onboarding race): getCurrentUserStatus
  // (convex/users.ts) returns `null` for an authenticated identity whose
  // `users` row no longer exists — this is EXACTLY the transient window
  // right after a successful deleteMyAccount, before this screen's own
  // signOut() call (profile.tsx → runAccountDeletionCleanup) has cleared
  // the auth token. This explicit guard exists so every consumer below
  // (persist-answers effect, routing decision, hydration, push-token
  // registration) can be audited/tested independently of the inline
  // `userStatus === null` checks that already (correctly) no-op for this
  // state. isDeletedAccountState must NEVER trigger onboarding
  // persistence, retry scheduling, or an onboarding route — the splash
  // screen stays up (via isOnboardingDecisionPending below) until
  // isAuthenticated flips false and normal unauthenticated routing takes
  // over.
  const isDeletedAccountState = isAuthenticated && userStatus === null;

  // Stage 2B+3: family-bootstrap's optional "haven't configured family yet"
  // nudge is only for users who are ALREADY onboardingCompleted — the
  // incomplete-onboarding path never routes through family-bootstrap at
  // all anymore (see the new decision tree below). Only query it once the
  // server confirms completion, matching "preserve existing behavior for
  // completed users" exactly.
  const shouldCheckFamilyBootstrap =
    isAuthenticated && userStatus?.onboardingComplete === true;
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

  // ── Stage 2B+3: security cutover — persist Q1/Q2 answers, then resolve
  // phone matches. finishOnboarding is NEVER called from this layout —
  // only from the mandatory Profile Setup screen's explicit save (see
  // hooks/useFamilyProfileEditor.ts saveAll()). Q1 (onboardingIntent) is
  // analytics/personalization only and must never decide space
  // architecture or auto-complete onboarding.
  const persistOnboardingAnswersMutation = useMutation(
    api.onboarding.persistOnboardingAnswers
  );
  const [answersPersisted, setAnswersPersisted] = useState(false);
  const [persistRetryTick, setPersistRetryTick] = useState(0);
  const persistInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Only the exact controlled Q1 literals are valid onboardingIntent values
  // (legacy 'business' data must never be sent — persistOnboardingAnswers'
  // validator would reject it anyway).
  const validOnboardingIntent =
    onboardingData.spaceType === 'personal' ||
    onboardingData.spaceType === 'couple' ||
    onboardingData.spaceType === 'family'
      ? onboardingData.spaceType
      : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — persistRetryTick (last dep) is a trigger-only value to force a retry after a 3s backoff; it is never read inside the effect body.
  useEffect(() => {
    // isDeletedAccountState: never persist onboarding answers (and never
    // schedule a retry) for a deleted/missing app user — see its doc
    // comment above. userStatus === null already implies this, but the
    // explicit check keeps the invariant self-evident at this call site.
    if (
      !isAuthenticated ||
      userStatus === undefined ||
      userStatus === null ||
      isDeletedAccountState ||
      userStatus.onboardingComplete ||
      !hasCompletedOnboardingLocally ||
      answersPersisted ||
      persistInFlightRef.current
    )
      return;

    persistInFlightRef.current = true;
    persistOnboardingAnswersMutation({
      onboardingIntent: validOnboardingIntent,
      onboardingChallenges: onboardingData.challenges as
        | (
            | 'incoming_from_everywhere'
            | 'remember_tasks_and_appointments'
            | 'shared_schedule_coordination'
            | 'everything_in_one_place'
          )[]
        | undefined,
    })
      .then(() => {
        if (isMountedRef.current) setAnswersPersisted(true);
      })
      .catch((err: unknown) => {
        console.warn('[Onboarding] persistOnboardingAnswers failed:', err);
        // Preserve retryable state — do not silently complete onboarding
        // and avoid a tight redirect loop by backing off before retrying.
        setTimeout(() => {
          if (isMountedRef.current) setPersistRetryTick((t) => t + 1);
        }, 3000);
      })
      .finally(() => {
        persistInFlightRef.current = false;
      });
  }, [
    isAuthenticated,
    userStatus,
    isDeletedAccountState,
    hasCompletedOnboardingLocally,
    answersPersisted,
    validOnboardingIntent,
    onboardingData.challenges,
    persistOnboardingAnswersMutation,
    persistRetryTick,
  ]);

  const phoneMatchResolvedAt = userStatus?.phoneMatchResolvedAt ?? null;

  // Only check for pending phone matches once answers are persisted and the
  // user hasn't already made their phone-match decision this onboarding.
  const shouldCheckPendingPhoneMatches =
    isAuthenticated &&
    userStatus?.onboardingComplete === false &&
    hasCompletedOnboardingLocally &&
    answersPersisted &&
    !phoneMatchResolvedAt;
  const pendingPhoneMatches = useQuery(
    api.members.getPendingPhoneMatches,
    shouldCheckPendingPhoneMatches ? {} : 'skip'
  );

  const onboardingRouteDecision = resolvePostAuthOnboardingRoute({
    onboardingComplete: userStatus?.onboardingComplete,
    hasLocalOnboardingAnswers: hasCompletedOnboardingLocally,
    answersPersisted,
    phoneMatchResolvedAt,
    pendingMatches: pendingPhoneMatches,
  });

  // Stage 2B+3: clear the pre-auth onboarding_draft only once the SERVER
  // confirms onboardingCompleted === true — never merely because
  // persistOnboardingAnswers succeeded, the match query resolved, the user
  // declined, or the Profile Setup screen opened. This preserves crash
  // recovery (an app kill mid-onboarding must still resume correctly).
  const draftClearedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (userStatus?.onboardingComplete !== true) return;
    if (draftClearedRef.current) return;
    draftClearedRef.current = true;
    clearOnboardingDraft().catch(() => {});
  }, [isAuthenticated, userStatus?.onboardingComplete]);

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

  // Serialize registration and explicit logout, including late permission
  // prompts and requests already in flight. Re-register on account changes.
  useEffect(() => {
    if (userStatus?.onboardingComplete !== true || !pushUserId) return;
    const deactivate = pushTokenLifecycle.activate(pushUserId);
    const cleanup = setupNotificationHandlers();
    void pushTokenLifecycle
      .register(
        pushUserId,
        registerForPushNotifications,
        rememberDevicePushToken,
        (token) =>
          registerPushToken({
            token,
            expectedUserId: pushUserId,
            platform: Platform.OS as 'ios' | 'android',
            deviceId: Device.modelId ?? undefined,
          })
      )
      .catch(() => {
        console.warn('[Push] Token registration failed');
      });
    return () => {
      deactivate();
      cleanup();
    };
  }, [userStatus?.onboardingComplete, pushUserId, registerPushToken]);

  // Wait for: navigation tree, auth state, RevenueCat, and user profile to resolve
  const isUserStatusLoading = isAuthenticated && userStatus === undefined;
  const isFamilyBootstrapLoading =
    shouldCheckFamilyBootstrap && familyBootstrapStatus === undefined;

  // ── Cold-start notification capture gate ──────────────────────────────────
  // captureColdStartNotification() (app/_layout.tsx) is async — it must
  // resolve before we can know whether this cold start was launched by a
  // notification tap. shouldBlockForColdStartNav (below) is a PURELY VISUAL
  // guard on top of the existing splash/Tabs branch: it does not change
  // isReadyToRoute, any redirect decision, or notification-target
  // semantics — it only prevents Tabs (and therefore Home) from rendering
  // for one extra frame while a cold-start notification target might still
  // be captured and consumed. See lib/coldStartCaptureGate.ts.
  const [coldStartCheckDone, setColdStartCheckDone] = useState(
    isColdStartCaptureComplete
  );
  useEffect(() => {
    if (coldStartCheckDone) return;
    return onColdStartCaptureComplete(() => setColdStartCheckDone(true));
  }, [coldStartCheckDone]);

  // Non-destructively peek (once, right after the capture check settles)
  // whether a cold-start notification target was actually captured, so the
  // guard below only blocks when there is something to consume.
  const coldStartHadPendingNavRef = useRef<boolean | null>(null);
  if (coldStartCheckDone && coldStartHadPendingNavRef.current === null) {
    coldStartHadPendingNavRef.current = peekPendingNavigationTarget() !== null;
  }
  const [coldStartNavConsumed, setColdStartNavConsumed] = useState(false);

  // Block until (a) the capture check has completed AND (b) if a target
  // was found, it has been consumed (router.replace already dispatched).
  const shouldBlockForColdStartNav =
    !coldStartCheckDone ||
    (coldStartHadPendingNavRef.current === true && !coldStartNavConsumed);

  // TEMPORARY (Step A baseline instrumentation) — each fires once, the
  // first time its corresponding "loading" flag settles to false.
  const userStatusReadyTracedRef = useRef(false);
  useEffect(() => {
    if (!isUserStatusLoading && !userStatusReadyTracedRef.current) {
      userStatusReadyTracedRef.current = true;
      startupTrace('T4_USER_STATUS_READY');
    }
  }, [isUserStatusLoading]);

  // TEMPORARY (Step B instrumentation fix) — isFamilyBootstrapLoading starts
  // false by default (shouldCheckFamilyBootstrap is false until userStatus
  // confirms onboardingComplete), so a naive "first time this settles to
  // false" guard fired immediately on mount, before the query this trace is
  // meant to time had even started. Now only trace the genuine
  // true → false transition (it was actually blocking, then unblocked),
  // i.e. the meaningful final unblock event — not the trivial initial
  // default. GATES snapshots remain the source of truth for the underlying
  // boolean; this only fixes when the ONE-TIME trace fires.
  const wasFamilyBootstrapLoadingRef = useRef(false);
  const familyBootstrapReadyTracedRef = useRef(false);
  useEffect(() => {
    if (isFamilyBootstrapLoading) {
      wasFamilyBootstrapLoadingRef.current = true;
      return;
    }
    if (
      wasFamilyBootstrapLoadingRef.current &&
      !familyBootstrapReadyTracedRef.current
    ) {
      familyBootstrapReadyTracedRef.current = true;
      startupTrace('T5_FAMILY_BOOTSTRAP_READY');
    }
  }, [isFamilyBootstrapLoading]);

  const segmentStrings = segments as string[];
  const isFamilyBootstrapRoute = segmentStrings.includes('family-bootstrap');
  const isProfileSetupRoute = segmentStrings.includes('family-profile-setup');
  const isPhoneMatchConfirmationRoute = segmentStrings.includes(
    'phone-match-confirmation'
  );
  const isImportCalendarRoute = segmentStrings.includes('import-calendar');

  // Part 7: tracks whether family-profile-setup was ever visited while
  // onboarding was still incomplete (the MANDATORY case) during this
  // mounted session, so the exit redirect below never fires for the
  // OPTIONAL post-auth nudge (reached only once onboardingComplete is
  // already true). See needsMandatorySetupExitRedirect's doc comment.
  const wasMandatorySetupRef = useRef(false);
  useEffect(() => {
    if (isProfileSetupRoute && userStatus?.onboardingComplete === false) {
      wasMandatorySetupRef.current = true;
    }
  }, [isProfileSetupRoute, userStatus?.onboardingComplete]);

  // Stage 2B+3: onboarding-incomplete routing is entirely driven by the
  // pure decision tree in lib/onboardingRouting.ts — see its doc comment
  // for the full locked product flow. 'wait' means keep showing the splash
  // (e.g. persisting Q1/Q2 answers, or the pending-phone-match query is
  // still loading) without redirecting anywhere yet.
  const needsOnboardingRedirect =
    isAuthenticated && onboardingRouteDecision === 'onboarding-questions';
  const needsPhoneMatchConfirmationRedirect =
    isAuthenticated &&
    onboardingRouteDecision === 'phone-match-confirmation' &&
    !isPhoneMatchConfirmationRoute;
  const needsMandatoryProfileSetupRedirect =
    isAuthenticated &&
    onboardingRouteDecision === 'mandatory-profile-setup' &&
    !isProfileSetupRoute;
  const isOnboardingDecisionPending =
    isAuthenticated && onboardingRouteDecision === 'wait';

  // ── Calendar Import onboarding step (final step before first Home) ───────
  // onboardingCompleted is NOT redefined by this step. A separate server
  // flag (userStatus.calendarImportPromptPending — required-and-unresolved,
  // false for every pre-existing user) gates the first arrival at Home: once
  // the existing decision tree says 'normal', a still-pending user is sent
  // to the import screen instead of Home. Evaluated here (server state, not
  // local storage) so cold start respects it too, and resolved by an
  // explicit import-or-skip on that screen (resolveCalendarImportPrompt).
  const calendarImportPromptPending = userStatus?.calendarImportPromptPending;
  const needsCalendarImportRedirect =
    isAuthenticated &&
    shouldRedirectToCalendarImport({
      onboardingDecision: onboardingRouteDecision,
      calendarImportPromptPending,
      isOnImportCalendarRoute: isImportCalendarRoute,
    });

  // The key is OMITTED when not pending so the navigator's own tabBarStyle
  // (height, direction) is preserved for the Settings/Home import entries.
  const importCalendarOnboardingTabBarOptions =
    calendarImportPromptPending === true
      ? { tabBarStyle: { display: 'none' as const } }
      : {};

  // Tracks whether the import screen was entered while the step was still
  // pending, so the exit redirect below never fires for the normal
  // Settings/Home entry points (where the step is never pending).
  const wasCalendarOnboardingRef = useRef(false);
  useEffect(() => {
    if (isImportCalendarRoute && calendarImportPromptPending === true) {
      wasCalendarOnboardingRef.current = true;
    }
  }, [isImportCalendarRoute, calendarImportPromptPending]);

  // Same architecture as needsMandatorySetupExitRedirect: this layout is the
  // ONLY place that leaves the import screen after the step resolves, driven
  // by rendered server state — never router.back() and never an imperative
  // navigate racing the mutation's own .then().
  const needsCalendarImportExitRedirect =
    isAuthenticated &&
    shouldExitCalendarImportToHome({
      isOnImportCalendarRoute: isImportCalendarRoute,
      calendarImportPromptPending,
      wasCalendarOnboardingActive: wasCalendarOnboardingRef.current,
    });

  // Family-bootstrap's optional "haven't configured family yet" nudge —
  // unchanged for already-completed users (see shouldCheckFamilyBootstrap
  // above, which now only queries this for onboardingComplete === true).
  const needsFamilyBootstrapRedirect =
    isAuthenticated &&
    !isFamilyBootstrapRoute &&
    !isProfileSetupRoute &&
    userStatus?.onboardingComplete === true &&
    calendarImportPromptPending !== true &&
    familyBootstrapStatus !== undefined &&
    familyBootstrapStatus !== null &&
    !familyBootstrapStatus.hasConfiguredFamily &&
    !familyBootstrapStatus.joinedExistingSpace &&
    familyBootstrapStatus.familySetupSkippedAt === null;

  // Part 7 QA fix (NAVIGATE "index" unhandled after Save): family-profile.tsx's
  // handleSaveMandatorySetup used to call router.navigate('/(authenticated)')
  // itself from inside saveAll().then(). That screen is mounted as a
  // Tabs.Screen, so this worked most of the time — but the instant
  // finishOnboarding's write makes userStatus.onboardingComplete flip to
  // true, needsHydration (below) becomes true until hydrateFromServer's own
  // effect runs, which makes isReadyToRoute false for one or more renders —
  // during which this component renders <InYomiSplashScreen /> INSTEAD OF
  // <Tabs>. If the imperative navigate call landed in that exact window, the
  // Tabs navigator it targeted no longer existed, producing exactly the
  // reported "NAVIGATE {name:'index'}" unhandled warning. Same root cause
  // class as the phone-match-confirmation race documented above — the fix
  // is the same: this layout is the ONLY place that performs this
  // transition, driven by rendered state, never an imperative call from
  // inside the mutation's own .then(). wasMandatorySetupRef distinguishes
  // this (mandatory, onboarding-incomplete-on-entry) from the OPTIONAL
  // post-auth family-profile-setup nudge (reached only when
  // onboardingComplete is ALREADY true — see family-bootstrap.tsx), which
  // must never be force-exited on entry.
  const needsMandatorySetupExitRedirect =
    isAuthenticated &&
    isProfileSetupRoute &&
    userStatus?.onboardingComplete === true &&
    wasMandatorySetupRef.current;
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

  // TEMPORARY (Step B instrumentation fix) — needsHydration also starts
  // false by default (isAuthenticated is false before auth resolves), so
  // the previous "first time this settles to false" guard fired
  // immediately on mount for every user, before hydration could possibly
  // have been needed or run. Now only trace the genuine true → false
  // transition — the meaningful final unblock event (hydrateFromServer
  // actually ran and cleared the gate), not the trivial initial default.
  // Gate logic (needsHydration itself) is unchanged.
  const wasNeedsHydrationRef = useRef(false);
  const profileHydratedTracedRef = useRef(false);
  useEffect(() => {
    if (needsHydration) {
      wasNeedsHydrationRef.current = true;
      return;
    }
    if (wasNeedsHydrationRef.current && !profileHydratedTracedRef.current) {
      profileHydratedTracedRef.current = true;
      startupTrace('T6_PROFILE_HYDRATED');
    }
  }, [needsHydration]);

  const isReadyToRoute =
    !!navigationState?.key &&
    !isLoading &&
    !isRevenueCatLoading &&
    isDraftHydrated &&
    !isUserStatusLoading &&
    !isFamilyBootstrapLoading &&
    !needsHydration;

  // TEMPORARY (Step A baseline instrumentation) — fires once, the first
  // time this layout's own routing gate becomes ready.
  const readyToRouteTracedRef = useRef(false);
  useEffect(() => {
    if (isReadyToRoute && !readyToRouteTracedRef.current) {
      readyToRouteTracedRef.current = true;
      startupTrace('T7_READY_TO_ROUTE');
    }
  }, [isReadyToRoute]);

  // TEMPORARY diagnostics (lib/importFlowTrace.ts) for the Calendar Import
  // onboarding bug — boolean/enum-only. Shows whether this layout swaps
  // <Tabs> for the splash (which would unmount the import screen and drop its
  // in-memory Google auth state) and which gate caused it. Remove with the fix.
  const importTraceIsSplash =
    !isReadyToRoute ||
    !isAuthenticated ||
    needsOnboardingRedirect ||
    needsPhoneMatchConfirmationRedirect ||
    needsMandatoryProfileSetupRedirect ||
    needsCalendarImportRedirect ||
    needsFamilyBootstrapRedirect ||
    isOnboardingDecisionPending ||
    shouldBlockForColdStartNav;
  useEffect(() => {
    importTrace('layout_gates', {
      isSplash: importTraceIsSplash,
      isReadyToRoute,
      isAuthLoading: isLoading,
      isAuthenticated,
      isRevenueCatLoading,
      isUserStatusLoading,
      isFamilyBootstrapLoading,
      needsHydration,
      isImportCalendarRoute,
      calendarImportPromptPending,
      needsCalendarImportRedirect,
      needsCalendarImportExitRedirect,
      needsFamilyBootstrapRedirect,
      shouldBlockForColdStartNav,
    });
  }, [
    importTraceIsSplash,
    isReadyToRoute,
    isLoading,
    isAuthenticated,
    isRevenueCatLoading,
    isUserStatusLoading,
    isFamilyBootstrapLoading,
    needsHydration,
    isImportCalendarRoute,
    calendarImportPromptPending,
    needsCalendarImportRedirect,
    needsCalendarImportExitRedirect,
    needsFamilyBootstrapRedirect,
    shouldBlockForColdStartNav,
  ]);

  // TEMPORARY (Step A baseline instrumentation) — boolean-only snapshot of
  // every gate feeding isReadyToRoute plus the redirect-decision booleans,
  // re-emitted whenever any of them changes.
  useEffect(() => {
    startupTraceGates({
      isAuthLoading: isLoading,
      isRevenueCatLoading,
      isDraftHydrated,
      isUserStatusLoading,
      isFamilyBootstrapLoading,
      needsHydration,
      isReadyToRoute,
      isAuthenticated,
      needsOnboardingRedirect,
      needsPhoneMatchConfirmationRedirect,
      needsMandatoryProfileSetupRedirect,
      needsFamilyBootstrapRedirect,
      isOnboardingDecisionPending,
      coldStartCheckDone,
      shouldBlockForColdStartNav,
    });
  }, [
    isLoading,
    isRevenueCatLoading,
    isDraftHydrated,
    isUserStatusLoading,
    isFamilyBootstrapLoading,
    needsHydration,
    isReadyToRoute,
    isAuthenticated,
    needsOnboardingRedirect,
    needsPhoneMatchConfirmationRedirect,
    needsMandatoryProfileSetupRedirect,
    needsFamilyBootstrapRedirect,
    isOnboardingDecisionPending,
    coldStartCheckDone,
    shouldBlockForColdStartNav,
  ]);

  // ─── Push notification navigation ──────────────────────────────────────────
  // Keep a ref that always mirrors the current readiness so the subscription
  // callback (which closes over a stale value) can check it synchronously.
  const isReadyToRouteRef = useRef(isAuthenticated && isReadyToRoute);
  useEffect(() => {
    isReadyToRouteRef.current = isAuthenticated && isReadyToRoute;
  }, [isAuthenticated, isReadyToRoute]);

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
  // early because isReadyToRouteRef was still false at that moment). Also
  // gated on coldStartCheckDone so this never fires before the cold-start
  // notification capture has actually resolved (see the cold-start gate
  // above) — otherwise this could run, find nothing yet, and unblock
  // shouldBlockForColdStartNav's peek before the real target exists.
  useEffect(() => {
    if (!isAuthenticated || !isReadyToRoute || !coldStartCheckDone) return;
    const target = consumePendingNavigationTarget();
    if (target) {
      router.replace(target as Parameters<typeof router.replace>[0]);
    }
    // Unblock the cold-start guard exactly once. If the subscription
    // handler above already consumed the target first, `target` here is
    // null — that is fine, router.replace already happened there; this
    // still needs to flip coldStartNavConsumed so shouldBlockForColdStartNav
    // stops blocking.
    if (coldStartHadPendingNavRef.current && !coldStartNavConsumed) {
      setColdStartNavConsumed(true);
    }
  }, [
    isAuthenticated,
    isReadyToRoute,
    coldStartCheckDone,
    coldStartNavConsumed,
    router,
  ]);

  const signedOutDestinationRef = useRef<ReturnType<
    typeof consumeSignedOutDestination
  > | null>(null);
  useEffect(() => {
    // Logout only needs resolved Auth and a mounted root navigator. Waiting
    // for subscription/profile/onboarding gates can strand a signed-out user.
    if (isAuthenticated) {
      signedOutDestinationRef.current = null;
      return;
    }
    if (!isLoading && !isAuthenticated && navigationState?.key) {
      // Only an explicit Profile logout chooses phone entry. Deletion and
      // other signed-out transitions retain their existing Welcome fallback.
      signedOutDestinationRef.current ??= consumeSignedOutDestination();
      router.replace(signedOutDestinationRef.current);
    }
  }, [isLoading, isAuthenticated, navigationState?.key, router]);

  useEffect(() => {
    if (!isReadyToRoute) return;
    if (!isAuthenticated) return;

    if (needsOnboardingRedirect) {
      // Straight to Q1 — the single Welcome screen is the pre-auth
      // app/(auth)/index.tsx; a signed-in user must never see a second one.
      router.replace('/onboarding-step1');
      return;
    }

    if (needsPhoneMatchConfirmationRedirect) {
      router.replace('/(authenticated)/phone-match-confirmation');
      return;
    }

    if (needsMandatoryProfileSetupRedirect) {
      router.replace('/(authenticated)/family-profile-setup');
      return;
    }

    if (needsCalendarImportRedirect) {
      // The mandatory-setup exit (below) must not fire later for the
      // optional post-auth nudge — this redirect supersedes it.
      wasMandatorySetupRef.current = false;
      importTrace('layout_redirect_to_import_calendar');
      router.replace('/(authenticated)/import-calendar');
      return;
    }

    if (needsFamilyBootstrapRedirect) {
      router.replace('/(authenticated)/family-bootstrap');
      return;
    }

    if (needsCalendarImportExitRedirect) {
      wasCalendarOnboardingRef.current = false;
      router.navigate('/(authenticated)');
      return;
    }

    if (needsMandatorySetupExitRedirect) {
      // Same-navigator tab switch (router.navigate, not replace — see the
      // REPLACE-vs-NAVIGATE precedent documented in
      // tests/convex/mandatoryProfileSetupRoutingFix.test.ts). This only
      // runs once Tabs has actually (re)mounted for this render, because
      // isReadyToRoute/needsHydration have already resolved by the time
      // this effect body executes.
      wasMandatorySetupRef.current = false;
      router.navigate('/(authenticated)');
      return;
    }
  }, [
    isAuthenticated,
    isReadyToRoute,
    needsOnboardingRedirect,
    needsPhoneMatchConfirmationRedirect,
    needsMandatoryProfileSetupRedirect,
    needsFamilyBootstrapRedirect,
    needsCalendarImportRedirect,
    needsCalendarImportExitRedirect,
    needsMandatorySetupExitRedirect,
    router,
  ]);

  // HOME MUST NEVER BE REACHED WHILE onboardingCompleted === false — every
  // incomplete-onboarding decision from resolvePostAuthOnboardingRoute
  // ('wait' or an active redirect) keeps the splash showing here.
  // shouldBlockForColdStartNav is a purely visual addition (see above) —
  // it never changes any of the other conditions or redirect targets.
  if (
    !isReadyToRoute ||
    !isAuthenticated ||
    needsOnboardingRedirect ||
    needsPhoneMatchConfirmationRedirect ||
    needsMandatoryProfileSetupRedirect ||
    needsCalendarImportRedirect ||
    needsFamilyBootstrapRedirect ||
    isOnboardingDecisionPending ||
    shouldBlockForColdStartNav
  ) {
    // This is an intermediate routing/loading surface, NOT a finite
    // startup destination — it must NOT report readiness. The root bridge
    // stays up underneath it until the actual focused destination screen
    // (Home, or whichever redirect target Tabs ends up focusing) reports
    // readiness via useStartupDestinationReady. See lib/bridgeReadiness.ts.
    return <InYomiSplashScreen source="authenticated" />;
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
          {/* While the Calendar Import onboarding step is pending the bottom
              tab bar is hidden (see importCalendarOnboardingTabBarOptions),
              so the step cannot be sidestepped. */}
          <Tabs.Screen
            name="import-calendar"
            options={{ href: null, ...importCalendarOnboardingTabBarOptions }}
          />
          <Tabs.Screen name="import-holidays" options={{ href: null }} />
          <Tabs.Screen name="family-profile" options={{ href: null }} />
          {/* Part 8: family-profile-setup is ONLY ever reached as part of
              mandatory onboarding (needsMandatoryProfileSetupRedirect
              above) — the normal Settings entry point uses the separate
              `family-profile` route above, which keeps the default tab
              bar. tabBarStyle: { display: 'none' } here hides the
              persistent bottom tab bar only while this screen is
              focused; React Navigation restores the navigator's own
              screenOptions.tabBarStyle automatically once the user
              leaves this screen (same static-per-screen pattern already
              used below for `subscription`). */}
          <Tabs.Screen
            name="family-profile-setup"
            options={{ href: null, tabBarStyle: { display: 'none' } }}
          />
          <Tabs.Screen name="family-bootstrap" options={{ href: null }} />
          {/* Part 8: mandatory phone-match confirmation is also
              onboarding-only — hide the bottom tab bar here too. */}
          <Tabs.Screen
            name="phone-match-confirmation"
            options={{ href: null, tabBarStyle: { display: 'none' } }}
          />
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
          {/* Subscription sales screen — accessible via CTAs, not a tab.
              tabBarStyle: { display: 'none' } hides the persistent tab bar
              only while this screen is focused; React Navigation restores
              the navigator's own screenOptions.tabBarStyle automatically
              when navigating to any other tab screen (no manual restore
              needed since this is a static per-screen option, not an
              imperative navigation.setOptions call). */}
          <Tabs.Screen
            name="subscription"
            options={{ href: null, tabBarStyle: { display: 'none' } }}
          />
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
