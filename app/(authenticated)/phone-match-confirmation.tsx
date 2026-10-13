import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useStartupDestinationReady } from '@/lib/hooks/useStartupDestinationReady';
import { APP_IS_RTL, rtl } from '@/lib/rtl';
import { colors as tc } from '@/theme/colors';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

type PendingMatchCandidate = {
  memberId: string;
  spaceName: string;
  displayName?: string;
  memberNames: string[];
};

/**
 * Part 3: shows the matched family-profile card — "הפרופיל המשפחתי" as the
 * primary concept with every existing member's display name wrapped in a
 * compact list (never a phone number, never a fabricated surname), and the
 * space name (e.g. "הבית שלנו") only as secondary metadata below it.
 */
function MatchCardBody({
  match,
}: {
  match: PendingMatchCandidate;
}): React.JSX.Element {
  return (
    <View style={styles.matchCardText}>
      <Text style={[styles.matchPrimaryLabel, { textAlign: rtl.textAlign }]}>
        הפרופיל המשפחתי
      </Text>
      {match.memberNames.length > 0 ? (
        <View
          style={[styles.memberNamesWrap, { flexDirection: rtl.flexDirection }]}
        >
          {match.memberNames.map((name) => (
            <View key={name} style={styles.memberChip}>
              <Text style={styles.memberChipText}>{name}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text
        style={[styles.matchSpaceNameSecondary, { textAlign: rtl.textAlign }]}
      >
        {match.spaceName}
      </Text>
    </View>
  );
}

/**
 * Stage 2B+3 security cutover — explicit phone-match confirmation.
 *
 * Reached only when onboarding is incomplete AND getPendingPhoneMatches
 * returned one or more discovery-only matches (see convex/members.ts
 * matchOnPhone). A phone match alone never grants access — the user must
 * explicitly confirm here via acceptPendingPhoneMatch before any access is
 * created, or explicitly decline via declinePhoneMatches to set up their
 * own separate profile instead.
 */
export default function PhoneMatchConfirmationScreen(): React.JSX.Element {
  // Finite startup destination — this screen is a genuine, focused
  // redirect target (reached via router.replace from the authenticated
  // layout). A loading indicator here is an acceptable destination
  // surface (see lib/hooks/useStartupDestinationReady.ts) since, unlike
  // the top-level deep-link routes, there is no further redirect pending
  // once this route is reached.
  const { onLayout: handlePhoneMatchDestinationLayout } =
    useStartupDestinationReady('phone-match');
  const pendingMatches = useQuery(api.members.getPendingPhoneMatches, {});
  const acceptPendingPhoneMatch = useMutation(
    api.members.acceptPendingPhoneMatch
  );
  const declinePhoneMatches = useMutation(api.members.declinePhoneMatches);

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const matches = pendingMatches ?? [];
  const isMultiple = matches.length > 1;
  // No auto-selection for multiple matches — the single-match case can
  // safely default to that one candidate since there is nothing to choose.
  const effectiveSelectedId =
    selectedMemberId ?? (matches.length === 1 ? matches[0].memberId : null);

  // Part 7 QA fix: this screen used to imperatively navigate itself
  // (router.navigate) immediately after acceptPendingPhoneMatch /
  // declinePhoneMatches / an externally-emptied match list resolved. That
  // raced against the authenticated layout's OWN reactive redirect effect
  // (app/(authenticated)/_layout.tsx), which recomputes
  // resolvePostAuthOnboardingRoute from the exact same server state
  // (phoneMatchResolvedAt / pendingMatches) and already redirects on its
  // own the instant either mutation's write becomes visible. When both
  // fired for the same transition, whichever dispatched second could hit a
  // Tabs navigator that had already unmounted (the layout renders the
  // splash screen instead of <Tabs> while a redirect decision is pending),
  // producing: `The action 'NAVIGATE' with payload {"name":"index"} was
  // not handled by any navigator.` The fix is architectural, not a
  // guessed patch: there must be exactly ONE place that decides/performs
  // this transition. This screen now only calls the mutations and reports
  // errors — it never navigates itself. The authenticated layout is the
  // single source of truth for where an onboarding-incomplete user goes
  // next.
  const handleAccept = (): void => {
    if (!effectiveSelectedId || isAccepting || isDeclining) return;
    setErrorMessage(null);
    setIsAccepting(true);
    acceptPendingPhoneMatch({
      memberId: effectiveSelectedId as Id<'members'>,
    }).catch(() => {
      setErrorMessage('לא הצלחנו להמשיך לפרופיל כרגע. אפשר לנסות שוב.');
      setIsAccepting(false);
    });
    // No .finally()/success navigation — on success this screen stays in
    // its loading state until the authenticated layout's reactive
    // redirect (driven by phoneMatchResolvedAt) moves the user forward.
  };

  const handleDecline = (): void => {
    if (isAccepting || isDeclining) return;
    setErrorMessage(null);
    setIsDeclining(true);
    declinePhoneMatches({}).catch(() => {
      setErrorMessage('אירעה שגיאה. אפשר לנסות שוב.');
      setIsDeclining(false);
    });
  };

  if (pendingMatches === undefined) {
    return (
      <SafeAreaView
        style={styles.loadingContainer}
        onLayout={handlePhoneMatchDestinationLayout}
      >
        <ActivityIndicator color={tc.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, ANDROID_MATCH_IOS_LAYOUT && styles.rtlRoot]}
      onLayout={handlePhoneMatchDestinationLayout}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <MaterialIcons name="person-search" size={40} color={tc.primary} />
        </View>

        {/* Part 3: lead with the family-profile concept, never the paid
            "InYomi Together" subscription name — see AGENTS.md
            terminology note. */}
        <Text style={[styles.title, { textAlign: rtl.textAlign }]}>
          מצאנו שכבר יש לך פרופיל משותף ב-InYomi
        </Text>
        <Text style={[styles.subtitle, { textAlign: rtl.textAlign }]}>
          אפשר להמשיך לפרופיל המשפחתי הקיים שלך, או להגדיר פרופיל נפרד.
        </Text>

        {isMultiple ? (
          <View style={styles.multiList}>
            {matches.map((m) => {
              const isSelected = selectedMemberId === m.memberId;
              return (
                <Pressable
                  key={m.memberId}
                  onPress={() => setSelectedMemberId(m.memberId)}
                  accessible={true}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={
                    m.memberNames.length > 0
                      ? `הפרופיל המשפחתי — ${m.memberNames.join(', ')}`
                      : 'הפרופיל המשפחתי'
                  }
                  style={[
                    styles.matchCard,
                    isSelected && styles.matchCardSelected,
                  ]}
                >
                  <MaterialIcons
                    name={
                      isSelected
                        ? 'radio-button-checked'
                        : 'radio-button-unchecked'
                    }
                    size={22}
                    color={isSelected ? tc.primary : '#cbd5e1'}
                  />
                  <MatchCardBody match={m} />
                </Pressable>
              );
            })}
          </View>
        ) : matches.length === 1 ? (
          <View style={styles.singleMatchCard}>
            <MatchCardBody match={matches[0]} />
          </View>
        ) : null}

        {errorMessage ? (
          <Text style={[styles.errorText, { textAlign: rtl.textAlign }]}>
            {errorMessage}
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleAccept}
          disabled={!effectiveSelectedId || isAccepting || isDeclining}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="המשך לפרופיל המשפחתי"
          style={[
            styles.primaryButton,
            (!effectiveSelectedId || isAccepting || isDeclining) &&
              styles.buttonDisabled,
          ]}
        >
          {isAccepting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>המשך לפרופיל המשפחתי</Text>
          )}
        </Pressable>
        <Pressable
          onPress={handleDecline}
          disabled={isAccepting || isDeclining}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="להגדיר פרופיל נפרד"
          style={[
            styles.secondaryButton,
            (isAccepting || isDeclining) && styles.buttonDisabled,
          ]}
        >
          {isDeclining ? (
            <ActivityIndicator color={tc.primary} />
          ) : (
            <Text style={styles.secondaryButtonText}>להגדיר פרופיל נפרד</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f8' },
  rtlRoot: { direction: 'rtl' },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f6f7f8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 24 },
  iconWrap: {
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: tc.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginTop: 8,
  },
  multiList: { marginTop: 24, gap: 12 },
  matchCard: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    padding: 16,
  },
  matchCardSelected: {
    borderColor: tc.primary,
    backgroundColor: tc.primaryLight,
  },
  matchCardText: { flex: 1 },
  singleMatchCard: {
    marginTop: 24,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: tc.primary,
    padding: 16,
  },
  matchPrimaryLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  memberNamesWrap: {
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  memberChip: {
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  memberChipText: { fontSize: 12, color: '#374151', fontWeight: '600' },
  matchSpaceNameSecondary: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 8,
  },
  errorText: { color: '#dc2626', fontSize: 13, marginTop: 16 },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    paddingTop: 8,
    gap: 10,
  },
  primaryButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: tc.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: tc.primary, fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
});
