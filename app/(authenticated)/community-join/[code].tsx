import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function JoinSkeleton() {
  return (
    <View style={styles.content}>
      <View style={[styles.skeletonLine, { width: '70%', height: 28 }]} />
      <View style={[styles.skeletonLine, { width: '90%', marginTop: 12 }]} />
      <View style={[styles.skeletonLine, { width: '60%', marginTop: 6 }]} />
      <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 20 }}>
        <View
          style={[
            styles.skeletonLine,
            { width: 56, height: 28, borderRadius: 14 },
          ]}
        />
        <View
          style={[
            styles.skeletonLine,
            { width: 72, height: 28, borderRadius: 14 },
          ]}
        />
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function JoinCommunityScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();

  const community = useQuery(api.communities.getCommunityByInviteCode, {
    inviteCode: code ?? '',
  });
  const joinCommunity = useMutation(api.communities.joinCommunityByCode);

  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!code) return;
    setJoining(true);
    try {
      const result = await joinCommunity({ inviteCode: code });

      if (result.status === 'joined') {
        Alert.alert('הצטרפת בהצלחה! 🎉', undefined, [
          {
            text: 'אישור',
            onPress: () =>
              router.replace(
                `/(authenticated)/communities/${result.communityId}` as Parameters<
                  typeof router.replace
                >[0]
              ),
          },
        ]);
      } else {
        // already_member – navigate directly
        router.replace(
          `/(authenticated)/communities/${result.communityId}` as Parameters<
            typeof router.replace
          >[0]
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהצטרפות לקהילה';
      Alert.alert('שגיאה', msg);
    } finally {
      setJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חזרה"
        >
          <MaterialIcons name="arrow-forward" size={24} color="#374151" />
        </Pressable>
        <Text style={styles.headerTitle}>הצטרפות לקהילה</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Loading */}
      {community === undefined && <JoinSkeleton />}

      {/* Invalid / not found */}
      {community === null && (
        <View style={styles.errorContainer}>
          <MaterialIcons name="link-off" size={64} color="#d1d5db" />
          <Text style={styles.errorTitle}>הקישור אינו תקין</Text>
          <Text style={styles.errorSubtitle}>
            הקישור שהזנת לא קיים או שהקהילה הוסרה
          </Text>
          <Pressable
            style={styles.backBtnLarge}
            onPress={() => router.back()}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזרה"
          >
            <Text style={styles.backBtnText}>חזרה</Text>
          </Pressable>
        </View>
      )}

      {/* Community found */}
      {community !== null && community !== undefined && (
        <View style={styles.content}>
          {/* שם */}
          <Text style={styles.communityName}>{community.name}</Text>

          {/* מספר חברים */}
          <View style={styles.memberRow}>
            <MaterialIcons name="people" size={18} color="#6b7280" />
            <Text style={styles.memberText}>
              {community.memberCount}{' '}
              {community.memberCount === 1 ? 'חבר' : 'חברים'}
            </Text>
          </View>

          {/* תיאור */}
          {!!community.description && (
            <Text style={styles.description}>{community.description}</Text>
          )}

          {/* תגיות */}
          {community.tags && community.tags.length > 0 && (
            <View style={styles.tagRow}>
              {community.tags.map((tag) => (
                <View key={tag} style={styles.tagChip}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* כפתורים */}
          <Pressable
            style={[styles.joinBtn, joining && styles.joinBtnDisabled]}
            onPress={handleJoin}
            disabled={joining}
            accessible
            accessibilityRole="button"
            accessibilityLabel="הצטרף לקהילה"
            accessibilityState={{ disabled: joining }}
          >
            {joining ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.joinBtnText}>הצטרף לקהילה</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.cancelBtn}
            onPress={() => router.back()}
            accessible
            accessibilityRole="button"
            accessibilityLabel="ביטול"
          >
            <Text style={styles.cancelBtnText}>ביטול</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Content
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'flex-end',
    gap: 10,
  },
  communityName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  memberRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  memberText: {
    fontSize: 15,
    color: '#6b7280',
  },
  description: {
    fontSize: 16,
    color: '#4b5563',
    textAlign: 'right',
    lineHeight: 24,
    writingDirection: 'rtl',
  },
  tagRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    backgroundColor: '#f0f9ff',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: `${PRIMARY}44`,
  },
  tagText: {
    fontSize: 14,
    color: PRIMARY,
    fontWeight: '600',
  },
  divider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb',
    marginVertical: 8,
  },
  joinBtn: {
    width: '100%',
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnDisabled: {
    opacity: 0.6,
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  cancelBtn: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    color: '#9ca3af',
  },
  // ── Error state
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 22,
  },
  backBtnLarge: {
    marginTop: 8,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  // ── Skeleton
  skeletonLine: {
    height: 16,
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    width: '80%',
  },
});
