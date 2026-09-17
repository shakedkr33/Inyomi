import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { APP_IS_RTL, rtl } from '@/lib/rtl';
import { colors as tc } from '@/theme/colors';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

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
  const router = useRouter();
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

  // Defense in depth: if this screen is somehow reached with zero pending
  // matches (e.g. a match was resolved elsewhere in the meantime), route
  // onward to mandatory Profile Setup instead of showing an empty screen.
  // FIXED: routing bug — this screen is mounted as a Tabs.Screen inside the
  // authenticated Tabs navigator (see app/(authenticated)/_layout.tsx).
  // Bottom tab navigators do not implement the REPLACE navigation action
  // (only stack navigators do), so router.replace() to a sibling
  // Tabs.Screen from here would fail with: `The action 'REPLACE' with
  // payload {"name":"index","params":{}} was not handled by any
  // navigator.` router.navigate() performs a normal tab switch instead,
  // which IS handled by the Tabs navigator.
  useEffect(() => {
    if (pendingMatches !== undefined && pendingMatches.length === 0) {
      router.navigate('/(authenticated)/family-profile-setup');
    }
  }, [pendingMatches, router]);

  const handleAccept = (): void => {
    if (!effectiveSelectedId || isAccepting || isDeclining) return;
    setErrorMessage(null);
    setIsAccepting(true);
    acceptPendingPhoneMatch({
      memberId: effectiveSelectedId as Id<'members'>,
    })
      .then(() => {
        // onboardingCompleted is now server-side true — continue through
        // canonical routing (the authenticated layout will send the user
        // Home once userStatus reflects the completed mutation).
        // FIXED: router.navigate() — see routing-bug comment above.
        router.navigate('/(authenticated)');
      })
      .catch(() => {
        setErrorMessage('לא הצלחנו להמשיך לפרופיל כרגע. אפשר לנסות שוב.');
      })
      .finally(() => setIsAccepting(false));
  };

  const handleDecline = (): void => {
    if (isAccepting || isDeclining) return;
    setErrorMessage(null);
    setIsDeclining(true);
    declinePhoneMatches({})
      .then(() => {
        // FIXED: router.navigate() — see routing-bug comment above.
        router.navigate('/(authenticated)/family-profile-setup');
      })
      .catch(() => {
        setErrorMessage('אירעה שגיאה. אפשר לנסות שוב.');
      })
      .finally(() => setIsDeclining(false));
  };

  if (pendingMatches === undefined) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator color={tc.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, ANDROID_MATCH_IOS_LAYOUT && styles.rtlRoot]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <MaterialIcons name="person-search" size={40} color={tc.primary} />
        </View>

        <Text style={[styles.title, { textAlign: rtl.textAlign }]}>
          מצאנו שכבר יש לך פרופיל משותף ב־InYomi.{'\n'}אפשר להמשיך אליו עכשיו.
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
                    m.displayName
                      ? `${m.spaceName} — ${m.displayName}`
                      : m.spaceName
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
                  <View style={styles.matchCardText}>
                    <Text
                      style={[
                        styles.matchSpaceName,
                        { textAlign: rtl.textAlign },
                      ]}
                    >
                      {m.spaceName}
                    </Text>
                    {m.displayName ? (
                      <Text
                        style={[
                          styles.matchDisplayName,
                          { textAlign: rtl.textAlign },
                        ]}
                      >
                        {m.displayName}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : matches.length === 1 ? (
          <View style={styles.singleMatchCard}>
            <Text style={[styles.matchSpaceName, { textAlign: rtl.textAlign }]}>
              {matches[0].spaceName}
            </Text>
            {matches[0].displayName ? (
              <Text
                style={[styles.matchDisplayName, { textAlign: rtl.textAlign }]}
              >
                {matches[0].displayName}
              </Text>
            ) : null}
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
          accessibilityLabel="המשך לפרופיל"
          style={[
            styles.primaryButton,
            (!effectiveSelectedId || isAccepting || isDeclining) &&
              styles.buttonDisabled,
          ]}
        >
          {isAccepting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>המשך לפרופיל</Text>
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
  matchSpaceName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  matchDisplayName: { fontSize: 13, color: '#6b7280', marginTop: 2 },
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
