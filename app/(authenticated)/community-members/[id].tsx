import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { rtl } from '@/lib/rtl';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#00668E';

const ROLE_LABELS: Record<'owner' | 'admin' | 'member', string> = {
  owner: 'בעלים',
  admin: 'מנהל',
  member: 'חבר',
};

// ─── Member Row ───────────────────────────────────────────────────────────────

interface MemberInfo {
  membershipId: Id<'communityMembers'>;
  userId: Id<'users'>;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  fullName: string;
  email: string;
}

interface MemberRowProps {
  member: MemberInfo;
  showRemove?: boolean;
  onRemove?: () => void;
  roleActionLabel?: string;
  onRoleAction?: () => void;
}

function MemberRow({
  member,
  showRemove,
  onRemove,
  roleActionLabel,
  onRoleAction,
}: MemberRowProps) {
  return (
    <View style={styles.memberRow}>
      {/* כפתור הסרה — מופיע בצד שמאל כשרלוונטי */}
      {showRemove ? (
        <TouchableOpacity
          onPress={onRemove}
          style={styles.removeBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`הסר את ${member.fullName}`}
        >
          <Ionicons name="person-remove-outline" size={20} color="#9ca3af" />
        </TouchableOpacity>
      ) : null}

      {roleActionLabel && onRoleAction ? (
        <TouchableOpacity
          onPress={onRoleAction}
          style={styles.roleActionBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${roleActionLabel} עבור ${member.fullName}`}
        >
          <Text style={styles.roleActionText}>{roleActionLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {/* badge role */}
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

      {/* שם + אימייל */}
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
  const { id, returnTab } = useLocalSearchParams<{
    id: string;
    returnTab?: string;
  }>();
  const router = useRouter();

  const data = useQuery(api.communities.getCommunityMembers, {
    communityId: id as Id<'communities'>,
  });
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;

  const leaveCommunity = useMutation(api.communities.leaveCommunity);
  const removeMember = useMutation(api.communities.removeMember);
  const promoteMemberToAdmin = useMutation(
    api.communities.promoteMemberToAdmin
  );
  const demoteAdminToMember = useMutation(api.communities.demoteAdminToMember);
  const approvePendingMember = useMutation(
    api.communities.approvePendingMember
  );
  const rejectPendingMember = useMutation(api.communities.rejectPendingMember);

  const communityId = id as Id<'communities'>;

  const isOwner =
    currentUserId !== undefined &&
    (data?.members.some(
      (m) => m.userId === currentUserId && m.role === 'owner'
    ) ??
      false);
  const isAdmin =
    currentUserId !== undefined &&
    (data?.members.some(
      (m) => m.userId === currentUserId && m.role === 'admin'
    ) ??
      false);
  const canInvite = isOwner || isAdmin;
  const canManage = data?.canManage ?? false;
  const pendingMembers = data?.pendingMembers ?? [];
  const [inviteCodeOpen, setInviteCodeOpen] = useState(false);

  const handleApprovePending = (member: MemberInfo) => {
    Alert.alert('אישור הצטרפות', `לאשר את ${member.fullName} לקהילה?`, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'אישור',
        onPress: async () => {
          try {
            await approvePendingMember({
              communityId,
              memberId: member.membershipId,
            });
          } catch (err) {
            Alert.alert(
              'שגיאה',
              err instanceof Error ? err.message : 'לא ניתן לאשר'
            );
          }
        },
      },
    ]);
  };

  const handleRejectPending = (member: MemberInfo) => {
    Alert.alert('דחיית בקשה', `לדחות את בקשת ההצטרפות של ${member.fullName}?`, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'דחייה',
        style: 'destructive',
        onPress: async () => {
          try {
            await rejectPendingMember({
              communityId,
              memberId: member.membershipId,
            });
          } catch (err) {
            Alert.alert(
              'שגיאה',
              err instanceof Error ? err.message : 'לא ניתן לדחות'
            );
          }
        },
      },
    ]);
  };

  const handleShareInviteLink = () => {
    if (!data?.community.inviteCode) {
      Alert.alert('שגיאה', 'לא נמצא קישור הזמנה לקהילה זו');
      return;
    }
    const code = data.community.inviteCode;
    const url = `https://inyomi.app/join/${code}`;
    Share.share({
      message: `הצטרפי לקהילה "${data.community.name}" באיניומי:\n${url}\n\nאו הזיני קוד הצטרפות:\n${code}`,
    });
    // TODO: add contacts picker flow – check which contacts are Inyomi users,
    //       send internal invite vs share link
  };

  const handleCopyInviteCode = async () => {
    const code = data?.community.inviteCode;
    if (!code) {
      Alert.alert('שגיאה', 'לא נמצא קוד הזמנה לקהילה זו');
      return;
    }
    await Clipboard.setStringAsync(code);
    Alert.alert('הצלחה', 'הקוד הועתק');
  };

  const handleLeave = () => {
    Alert.alert('עזיבת הקהילה', 'האם אתה בטוח שברצונך לעזוב את הקהילה?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'עזוב',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveCommunity({ communityId });
            router.replace(
              '/(authenticated)/communities' as Parameters<
                typeof router.replace
              >[0]
            );
          } catch (err) {
            Alert.alert(
              'שגיאה',
              err instanceof Error ? err.message : 'לא ניתן לעזוב את הקהילה'
            );
          }
        },
      },
    ]);
  };

  const handleRemove = (member: MemberInfo) => {
    Alert.alert(
      'הסרת חבר',
      `האם אתה בטוח שברצונך להסיר את ${member.fullName} מהקהילה?`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'הסר',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMember({
                communityId,
                targetUserId: member.userId,
              });
            } catch (err) {
              Alert.alert(
                'שגיאה',
                err instanceof Error ? err.message : 'לא ניתן להסיר את החבר'
              );
            }
          },
        },
      ]
    );
  };

  const handlePromoteToAdmin = (member: MemberInfo) => {
    Alert.alert(
      'הגדרה כמנהל/ת',
      `להגדיר את ${member.fullName} כמנהל/ת קהילה?`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'אישור',
          onPress: async () => {
            try {
              await promoteMemberToAdmin({
                communityId,
                targetUserId: member.userId,
              });
            } catch (err) {
              Alert.alert(
                'שגיאה',
                err instanceof Error ? err.message : 'לא ניתן לעדכן הרשאה'
              );
            }
          },
        },
      ]
    );
  };

  const handleDemoteToMember = (member: MemberInfo) => {
    Alert.alert('הסרה מניהול', `להסיר את ${member.fullName} מתפקיד מנהל/ת?`, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'אישור',
        onPress: async () => {
          try {
            await demoteAdminToMember({
              communityId,
              targetUserId: member.userId,
            });
          } catch (err) {
            Alert.alert(
              'שגיאה',
              err instanceof Error ? err.message : 'לא ניתן לעדכן הרשאה'
            );
          }
        },
      },
    ]);
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
            router.replace(
              `/(authenticated)/community/${id}?tab=${returnTab ?? 'ראשי'}` as Parameters<
                typeof router.replace
              >[0]
            );
          }}
          style={styles.backBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <Ionicons name="chevron-forward" size={24} color="#374151" />
        </TouchableOpacity>
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
          keyExtractor={(m) => m.membershipId}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <>
              {canManage && pendingMembers.length > 0 ? (
                <View style={styles.pendingSection}>
                  <Text style={styles.pendingSectionTitle}>ממתינים לאישור</Text>
                  {pendingMembers.map((m) => (
                    <View key={m.membershipId} style={styles.pendingCard}>
                      <View style={styles.memberRow}>
                        <View style={styles.memberAvatar}>
                          <Ionicons name="person" size={20} color={PRIMARY} />
                        </View>
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName} numberOfLines={1}>
                            {m.fullName}
                          </Text>
                          {m.email ? (
                            <Text style={styles.memberEmail} numberOfLines={1}>
                              {m.email}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.pendingActions}>
                        <TouchableOpacity
                          style={styles.rejectPendingBtn}
                          onPress={() => handleRejectPending(m)}
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel={`דחיית בקשת ${m.fullName}`}
                        >
                          <Text style={styles.rejectPendingBtnText}>דחייה</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.approvePendingBtn}
                          onPress={() => handleApprovePending(m)}
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel={`אישור ${m.fullName}`}
                        >
                          <Text style={styles.approvePendingBtnText}>
                            אישור
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.subHeader}>
                <Text style={styles.subHeaderText}>
                  {`${data.members.length} חברים`}
                </Text>
                <Text style={styles.subHeaderTitle}>חברי הקהילה</Text>
              </View>
            </>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              showRemove={isOwner && item.userId !== currentUserId}
              onRemove={() => handleRemove(item)}
              roleActionLabel={
                isOwner && item.role === 'member'
                  ? 'הגדר כמנהל/ת'
                  : isOwner && item.role === 'admin'
                    ? 'הסר מניהול'
                    : undefined
              }
              onRoleAction={
                isOwner && item.role === 'member'
                  ? () => handlePromoteToAdmin(item)
                  : isOwner && item.role === 'admin'
                    ? () => handleDemoteToMember(item)
                    : undefined
              }
            />
          )}
        />
      )}

      {/* ── Footer: עזיבה + הזמנה */}
      <View style={styles.footer}>
        {currentUserId !== undefined && !isOwner ? (
          <TouchableOpacity
            style={styles.leaveBtn}
            onPress={handleLeave}
            accessible
            accessibilityRole="button"
            accessibilityLabel="עזיבת הקהילה"
          >
            <Ionicons name="exit-outline" size={18} color="#6b7280" />
            <Text style={styles.leaveBtnText}>עזיבת הקהילה</Text>
          </TouchableOpacity>
        ) : null}
        {canInvite ? (
          <TouchableOpacity
            style={styles.inviteBtn}
            onPress={() => setInviteCodeOpen(true)}
            accessible
            accessibilityRole="button"
            accessibilityLabel="הזמנת חברים לקהילה"
          >
            <Ionicons
              name="share-outline"
              size={20}
              color="#fff"
              style={styles.inviteIcon}
            />
            <Text style={styles.inviteBtnText}>הזמנת חברים</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal
        visible={inviteCodeOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteCodeOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setInviteCodeOpen(false)}
        />
        <View style={styles.codeModal}>
          <TouchableOpacity
            style={styles.codeCloseBtn}
            onPress={() => setInviteCodeOpen(false)}
            accessible
            accessibilityRole="button"
            accessibilityLabel="סגירה"
          >
            <Ionicons name="close" size={20} color="#6b7280" />
          </TouchableOpacity>
          <Text style={styles.codeTitle}>קוד ההצטרפות לקהילה</Text>
          <Text style={styles.codeText}>
            {data?.community.inviteCode ?? '—'}
          </Text>
          <Text style={styles.codeHelper}>
            אפשר להזין את הקוד במסך הקהילות כדי להצטרף.
          </Text>
          <View style={styles.codeActions}>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={handleCopyInviteCode}
              accessible
              accessibilityRole="button"
              accessibilityLabel="העתקת קוד"
            >
              <Text style={styles.copyBtnText}>העתקת קוד</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.closeBtnSecondary}
              onPress={handleShareInviteLink}
              accessible
              accessibilityRole="button"
              accessibilityLabel="שיתוף קישור"
            >
              <Text style={styles.closeBtnSecondaryText}>שיתוף קישור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  pendingSection: {
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#f8fafc',
  },
  pendingSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'right',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  pendingCard: {
    backgroundColor: '#fff',
    marginBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  pendingActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  approvePendingBtn: {
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvePendingBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  rejectPendingBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  rejectPendingBtnText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '600',
  },

  // ── List
  listContent: { paddingBottom: 140 },
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
    alignItems: rtl.alignStart,
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
  removeBtn: {
    padding: 4,
  },
  roleActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  roleActionText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
    textAlign: 'right',
  },

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
    gap: 10,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    paddingVertical: 12,
  },
  leaveBtnText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '600',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  codeModal: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '30%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
  },
  codeCloseBtn: {
    alignSelf: 'flex-start',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    marginBottom: 8,
  },
  codeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 12,
  },
  codeText: {
    fontSize: 34,
    fontWeight: '800',
    color: PRIMARY,
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 8,
  },
  codeHelper: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 14,
  },
  codeActions: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  copyBtn: {
    flex: 1,
    minHeight: 44,
    backgroundColor: PRIMARY,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  closeBtnSecondary: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnSecondaryText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
});
