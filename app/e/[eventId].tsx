import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConvexAuth, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useStartupDestinationReady } from '@/lib/hooks/useStartupDestinationReady';
import { PENDING_COMMUNITY_EVENT_ID_KEY } from '@/lib/pendingEventLink';

const PRIMARY = '#36a9e2';

function isValidConvexId(value: string | undefined): boolean {
  return typeof value === 'string' && value.length >= 8;
}

export default function CommunityEventLinkScreen(): React.JSX.Element {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const validEventId = isValidConvexId(eventId)
    ? (eventId as Id<'events'>)
    : null;

  const resolution = useQuery(
    api.events.resolveCommunityEventLink,
    validEventId ? { eventId: validEventId } : 'skip'
  );

  // This top-level route can be reached directly on a cold start
  // (community event link), bypassing both the (auth) and (authenticated)
  // child InYomiSplashScreen layouts. The loading/redirect-pending branch
  // below is transient (it may still redirect to sign-in, the resolved
  // event, or the community-join screen) so it must NOT report readiness —
  // only the two genuinely terminal branches (not-member, event
  // unavailable) do, via handleTerminalLayout.
  const { onLayout: handleTerminalLayout } =
    useStartupDestinationReady('community-event');

  useEffect(() => {
    if (authLoading || isAuthenticated || !eventId) return;
    AsyncStorage.setItem(PENDING_COMMUNITY_EVENT_ID_KEY, eventId)
      .catch(() => {})
      .finally(() => {
        router.replace('/(auth)/sign-in');
      });
  }, [authLoading, eventId, isAuthenticated, router]);

  useEffect(() => {
    if (resolution?.status !== 'authRequired' || !eventId) return;
    AsyncStorage.setItem(PENDING_COMMUNITY_EVENT_ID_KEY, eventId)
      .catch(() => {})
      .finally(() => {
        router.replace('/(auth)/sign-in');
      });
  }, [eventId, resolution?.status, router]);

  useEffect(() => {
    if (resolution?.status !== 'ok') return;
    router.replace({
      pathname: '/(authenticated)/event/[id]',
      params: { id: resolution.eventId },
    });
  }, [resolution, router]);

  const handleGoHome = (): void => {
    router.replace('/(authenticated)/communities');
  };

  if (
    authLoading ||
    (!isAuthenticated && eventId) ||
    (validEventId && resolution === undefined) ||
    resolution?.status === 'ok' ||
    resolution?.status === 'authRequired'
  ) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator color={PRIMARY} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (resolution?.status === 'notMember') {
    return (
      <SafeAreaView
        style={styles.container}
        edges={['top', 'bottom']}
        onLayout={handleTerminalLayout}
      >
        <View style={styles.centered}>
          <MaterialIcons name="groups" size={56} color="#94a3b8" />
          <Text style={styles.title}>
            האירוע שייך לקהילה שעדיין לא הצטרפת אליה
          </Text>
          <Text style={styles.subtitle}>
            כדי לראות את פרטי האירוע, צריך להצטרף לקהילה.
          </Text>
          <Pressable
            accessible={true}
            accessibilityLabel="הצטרפות לקהילה"
            accessibilityRole="button"
            onPress={() =>
              router.replace({
                pathname: '/(authenticated)/community-join/[code]',
                params: { code: resolution.inviteCode },
              })
            }
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>הצטרפות לקהילה</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'bottom']}
      onLayout={handleTerminalLayout}
    >
      <View style={styles.centered}>
        <MaterialIcons name="event-busy" size={56} color="#94a3b8" />
        <Text style={styles.title}>האירוע הזה כבר לא זמין</Text>
        <Text style={styles.subtitle}>
          יכול להיות שהוא נמחק, בוטל או שהקישור כבר לא פעיל.
        </Text>
        {isAuthenticated ? (
          <Pressable
            accessible={true}
            accessibilityLabel="חזרה לקהילות"
            accessibilityRole="button"
            onPress={handleGoHome}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>חזרה לקהילות</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  title: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 30,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  primaryButton: {
    minHeight: 48,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 48,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: PRIMARY,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
});
