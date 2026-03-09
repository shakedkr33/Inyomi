import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

const ROLE_LABELS: Record<'owner' | 'admin' | 'member', string> = {
  owner: 'בעלים',
  admin: 'מנהל',
  member: 'חבר',
};

// ─── Member Row ───────────────────────────────────────────────────────────────

interface MemberInfo {
  userId: Id<'users'>;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  fullName: string;
  email: string;
}

function MemberRow({ member }: { member: MemberInfo }) {
  return (
    <View style={styles.memberRow}>
      {/* badge role בצד שמאל */}
      <View
        style={[
          styles.roleBadge,
          member.role === 'owner' && styles.roleBadgeOwner,
        ]}
      >
        <Text
          style={[
            styles.roleText,
            member.role === 'owner' && styles.roleTextOwner,
          ]}
        >
          {ROLE_LABELS[member.role]}
        </Text>
      </View>

      {/* שם + אימייל בצד ימין */}
      <View style={styles.memberInfo}>
        <Text style={styles.memberName} numberOfLines={1}>
          {member.fullName}
        </Text>
        {member.email ? (
          <Text style={styles.memberEmail} numberOfLines={1}>
            {member.email}
          </Text>
        ) : null}
      </View>

      {/* אייקון */}
      <View style={styles.memberAvatar}>
        <Ionicons name="person" size={20} color={PRIMARY} />
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommunityMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const data = useQuery(api.communities.getCommunityMembers, {
    communityId: id as Id<'communities'>,
  });

  const handleInvite = () => {
    if (!data?.community.inviteCode) {
      Alert.alert('שגיאה', 'לא נמצא קישור הזמנה לקהילה זו');
      return;
    }
    const url = `https://inyomi.app/join/${data.community.inviteCode}`;
    Share.share({
      message: `הצטרפו לקהילה "${data.community.name}" באפליקציית Inyomi: ${url}`,
    });
    // TODO: add contacts picker flow – check which contacts are Inyomi users,
    //       send internal invite vs share link
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── כותרת */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {data?.community.name ?? 'ניהול חברים'}
        </Text>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace(
                `/(authenticated)/community/${id}` as Parameters<typeof router.replace>[0]
              );
            }
          }}
          style={styles.backBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <Ionicons name="chevron-forward" size={24} color="#374151" />
        </TouchableOpacity>
      </View>

      {/* ── תת-כותרת */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderText}>
          {data ? `${data.members.length} חברים` : ''}
        </Text>
        <Text style={styles.subHeaderTitle}>חברי הקהילה</Text>
      </View>

      {/* ── רשימת חברים */}
      {data === undefined ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : data === null ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>לא נמצאה קהילה זו</Text>
        </View>
      ) : (
        <FlatList<MemberInfo>
          data={data.members}
          keyExtractor={(m) => m.userId}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => <MemberRow member={item} />}
        />
      )}

      {/* ── כפתור הזמנת חברים */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.inviteBtn}
          onPress={handleInvite}
          accessible
          accessibilityRole="button"
          accessibilityLabel="הזמנת חברים לקהילה"
        >
          <Ionicons name="share-outline" size={20} color="#fff" style={styles.inviteIcon} />
          <Text style={styles.inviteBtnText}>הזמנת חברים</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  // ── Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    flex: 1,
  },
  backBtn: {
    padding: 4,
  },

  // ── Sub-header
  subHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  subHeaderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
  },
  subHeaderText: {
    fontSize: 13,
    color: '#9ca3af',
  },

  // ── List
  listContent: { paddingBottom: 100 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 20,
  },

  // ── Member Row
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    gap: 12,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  memberEmail: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
    textAlign: 'right',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  roleBadgeOwner: { backgroundColor: '#e0f2fe' },
  roleText: { fontSize: 11, color: '#6b7280', fontWeight: '600' },
  roleTextOwner: { color: PRIMARY },

  // ── Loading / Error
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: { fontSize: 16, color: '#6b7280', textAlign: 'center' },

  // ── Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f1f5f9',
  },
  inviteBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  inviteIcon: {},
  inviteBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
