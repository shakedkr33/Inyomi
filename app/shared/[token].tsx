// FIXED: public shared-event preview screen
//        works for both authenticated and unauthenticated users
//        native deep link (custom scheme): inyomi:///shared/TOKEN
//        Universal Link (HTTPS — active once AASA file is hosted): https://inyomi.app/shared/TOKEN
//        Expo Router maps both to this file automatically via app.json associatedDomains
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

// ─── Constants ────────────────────────────────────────────────────────────────
const PRIMARY = '#36a9e2';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── PENDING_SHARE_KEY: stored in AsyncStorage for intent preservation ────────
export const PENDING_SHARE_TOKEN_KEY = 'pendingShareToken';

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function SharedEventPreview(): React.JSX.Element {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  const preview = useQuery(
    api.shareLinks.getSharePreview,
    token ? { token } : 'skip'
  );
  const spaceId = useQuery(api.users.getMySpace, isAuthenticated ? {} : 'skip');
  const saveLinkedEvent = useMutation(api.linkedEvents.saveLinkedEvent);

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // This top-level route can be reached directly on a cold start (native
  // deep link / universal link), bypassing both the (auth) and
  // (authenticated) child InYomiSplashScreen layouts. The initial loading
  // branch below is transient (still resolving auth/preview) so it must
  // NOT report readiness — only the genuinely terminal branches
  // (invalid link, saved, main preview) do, via handleTerminalLayout.
  const { onLayout: handleTerminalLayout } =
    useStartupDestinationReady('shared-event');

  const handleSave = useCallback(async () => {
    if (!token || !spaceId) return;
    setSaving(true);
    try {
      await saveLinkedEvent({
        shareToken: token,
        spaceId: spaceId as Id<'spaces'>,
      });
      setSaved(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'לא ניתן לשמור את האירוע';
      Alert.alert('שגיאה', msg);
    } finally {
      setSaving(false);
    }
  }, [token, spaceId, saveLinkedEvent]);

  const handleLoginIntent = useCallback(async () => {
    // Store token so (authenticated)/_layout.tsx can restore the intent after login
    if (token) {
      await AsyncStorage.setItem(PENDING_SHARE_TOKEN_KEY, token);
    }
    router.push('/(auth)/sign-in');
  }, [token, router]);

  // ── Loading states
  if (authLoading || preview === undefined) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Invalid / revoked link
  if (!preview || preview.status !== 'ok') {
    return (
      <SafeAreaView
        style={s.safe}
        edges={['top']}
        onLayout={handleTerminalLayout}
      >
        <View style={s.headerBar}>
          <Pressable
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace('/(authenticated)')
            }
            style={s.backBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={s.backBtnText}>‹ חזור</Text>
          </Pressable>
        </View>
        <View style={s.centered}>
          <Text style={s.errorIcon}>🔗</Text>
          <Text style={s.errorTitle}>קישור לא פעיל</Text>
          <Text style={s.errorSub}>
            {preview?.status === 'not_found'
              ? 'האירוע לא נמצא'
              : 'קישור זה אינו פעיל עוד'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Success state (already saved)
  if (saved) {
    return (
      <SafeAreaView
        style={s.safe}
        edges={['top']}
        onLayout={handleTerminalLayout}
      >
        <View style={s.centered}>
          <Text style={s.successIcon}>✅</Text>
          <Text style={s.successTitle}>האירוע נוסף ליומן שלך</Text>
          <Text style={s.successSub}>{preview.title}</Text>
          <Pressable
            style={s.primaryBtn}
            onPress={() => router.replace('/(authenticated)')}
            accessible
            accessibilityRole="button"
            accessibilityLabel="עבור ליומן"
          >
            <Text style={s.primaryBtnText}>עבור ליומן</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isPastEvent = preview.endTime < Date.now();

  return (
    <SafeAreaView
      style={s.safe}
      edges={['top']}
      onLayout={handleTerminalLayout}
    >
      {/* Header */}
      <View style={s.headerBar}>
        <Pressable
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace('/(authenticated)')
          }
          style={s.backBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <Text style={s.backBtnText}>‹ חזור</Text>
        </Pressable>
        <Text style={s.headerTitle}>הזמנה לאירוע</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Cancelled notice */}
        {preview.eventStatus === 'cancelled' && (
          <View style={s.cancelledBanner}>
            <Text style={s.cancelledBannerText}>⚠️ אירוע זה בוטל</Text>
          </View>
        )}

        {/* Past event notice */}
        {isPastEvent && preview.eventStatus !== 'cancelled' && (
          <View style={s.pastBanner}>
            <Text style={s.pastBannerText}>אירוע שעבר</Text>
          </View>
        )}

        {/* Event card */}
        <View style={s.card}>
          <Text style={s.eventTitle}>{preview.title}</Text>

          {preview.ownerName && (
            <Text style={s.ownerLabel}>
              {`שלח על ידי ${preview.ownerName}`}
            </Text>
          )}

          <View style={s.divider} />

          {/* Date */}
          <View style={s.detailRow}>
            <Text style={s.detailText}>
              {formatFullDate(preview.startTime)}
            </Text>
            <Text style={s.detailIcon}>📅</Text>
          </View>

          {/* Time */}
          <View style={s.detailRow}>
            <Text style={s.detailText}>
              {preview.allDay
                ? 'כל היום'
                : `${formatTime(preview.startTime)} — ${formatTime(preview.endTime)}`}
            </Text>
            <Text style={s.detailIcon}>⏰</Text>
          </View>

          {/* Location */}
          {preview.location && (
            <View style={s.detailRow}>
              <Text style={s.detailText}>{preview.location}</Text>
              <Text style={s.detailIcon}>📍</Text>
            </View>
          )}
        </View>

        {/* CTA */}
        {isAuthenticated ? (
          <Pressable
            style={[s.primaryBtn, saving && s.primaryBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            accessible
            accessibilityRole="button"
            accessibilityLabel="הוסף ליומן שלי"
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.primaryBtnText}>הוסף ליומן שלי</Text>
            )}
          </Pressable>
        ) : (
          <>
            <Pressable
              style={s.primaryBtn}
              onPress={handleLoginIntent}
              accessible
              accessibilityRole="button"
              accessibilityLabel="התחבר כדי לשמור"
            >
              <Text style={s.primaryBtnText}>התחברי כדי לשמור</Text>
            </Pressable>
            <Text style={s.loginHint}>
              יש להתחבר כדי להוסיף את האירוע ליומן שלך
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 60,
  },
  backBtnText: {
    fontSize: 16,
    color: PRIMARY,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  scrollContent: {
    padding: 20,
    gap: 16,
    paddingBottom: 48,
  },

  // ── Error state
  errorIcon: { fontSize: 48 },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center',
  },
  errorSub: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },

  // ── Success state
  successIcon: { fontSize: 48 },
  successTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  successSub: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },

  // ── Banners
  cancelledBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  cancelledBannerText: {
    color: '#dc2626',
    fontWeight: '600',
    fontSize: 14,
  },
  pastBanner: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  pastBannerText: {
    color: '#6b7280',
    fontSize: 13,
  },

  // ── Event card
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  eventTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  ownerLabel: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  detailText: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
    flex: 1,
  },
  detailIcon: {
    fontSize: 16,
  },

  // ── CTA
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  loginHint: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: -8,
  },
});
