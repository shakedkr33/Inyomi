import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type JoinApprovalMode,
  JoinApprovalSettingsModal,
} from '@/components/JoinApprovalSettingsModal';
import { MainScreenHeader } from '@/components/MainScreenHeader';
import { ProfileAssociationSheet } from '@/components/ProfileAssociationSheet';
import { colors } from '@/constants/theme';
import { useNotifications } from '@/contexts/NotificationsContext';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { NotificationsDrawer } from '@/lib/components/notifications/NotificationsDrawer';
import { APP_IS_RTL, rtl } from '@/lib/rtl';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = colors.primaryDark;
const PILL_BG = '#EAF7FD';
const DIVIDER_COLOR = '#E8EDF3';
const MUTED_TEXT = '#8A94A6';
const TITLE_COLOR = '#111827';
const MENU_BTN_BG = '#F3F6FA';
const MENU_ICON_COLOR = '#7A8699';
const GRID_HORIZONTAL_PADDING = 16;
const GRID_COLUMN_GAP = 14;

const FILTER_CHIPS = [
  'הכל',
  'גן',
  'בית ספר',
  'חוג',
  'משפחה',
  'עבודה',
  'אישי',
] as const;
type FilterChip = (typeof FILTER_CHIPS)[number];

type UserRole = 'owner' | 'admin' | 'member';

interface CommunityItem {
  community: {
    _id: Id<'communities'>;
    name: string;
    description?: string;
    tags?: string[];
    inviteCode: string;
    createdAt: number;
    color?: string;
    joinApprovalMode?: 'manual' | 'automatic';
  };
  role: UserRole;
  pinned: boolean;
  notificationsEnabled: boolean;
  membersCount: number;
  hasNewEvents: boolean;
  /** רק לבעלים/מנהלים — מספר ממתינים לאישור */
  pendingMembersCount: number;
  membershipStatus: 'active' | 'left' | 'pending';
  nextActivity: {
    id: Id<'events'>;
    title: string;
    startsAt: number;
    status?: 'active' | 'cancelled';
    allDay?: boolean;
  } | null;
}

interface MenuPosition {
  x: number;
  y: number;
}

/** Hebrew relative date/time for the next community event (device local timezone). */
function formatUpcomingEventTimeLine(
  startsAt: number,
  referenceNow: number,
  allDay?: boolean
): string {
  const d = new Date(startsAt);
  if (allDay) {
    const startOfEventDay = new Date(d);
    startOfEventDay.setHours(0, 0, 0, 0);
    const startOfNowDay = new Date(referenceNow);
    startOfNowDay.setHours(0, 0, 0, 0);
    const dayDiff = Math.round(
      (startOfEventDay.getTime() - startOfNowDay.getTime()) / 86_400_000
    );
    const datePart = d.toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    if (dayDiff === 0) return `היום · ${datePart}`;
    if (dayDiff === 1) return `מחר · ${datePart}`;
    return datePart;
  }

  const timeStr = d.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const startOfEventDay = new Date(d);
  startOfEventDay.setHours(0, 0, 0, 0);
  const startOfNowDay = new Date(referenceNow);
  startOfNowDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfEventDay.getTime() - startOfNowDay.getTime()) / 86_400_000
  );
  if (dayDiff === 0) return `היום ב־${timeStr}`;
  if (dayDiff === 1) return `מחר ב־${timeStr}`;
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = d.toLocaleDateString('he-IL', { weekday: 'long' });
    return `${weekday} ב־${timeStr}`;
  }
  return d.toLocaleString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ActivitySummaryProps {
  nextActivity: CommunityItem['nextActivity'];
  referenceNow: number;
}

function ActivitySummary({ nextActivity, referenceNow }: ActivitySummaryProps) {
  // Inside direction:'ltr' cardWrapper, Yoga's RTL flip is suppressed on Android
  // (because ANDROID_MATCH_IOS_LAYOUT adds an explicit direction:'rtl' root that the
  // card's direction:'ltr' overrides cleanly). On Android we must use physical 'right'.
  // On iOS the global I18nManager.isRTL=true is not cancelled by direction:'ltr',
  // so rtl.textAlign='left' still lands on physical right via Yoga flip (no change).
  const titleAlign = ANDROID_MATCH_IOS_LAYOUT ? 'right' : (rtl.textAlign ?? 'right');
  const rowDir = rtl.flexDirection;

  if (nextActivity) {
    const timeLine = formatUpcomingEventTimeLine(
      nextActivity.startsAt,
      referenceNow,
      nextActivity.allDay
    );
    const showTitle = nextActivity.title.trim().length > 0;
    return (
      <View style={styles.activityBlock}>
        <View style={[styles.activityRow, { flexDirection: rowDir }]}>
          <Ionicons color={PRIMARY} name="calendar-outline" size={18} />
          <View style={styles.activityTextCol}>
            <Text
              style={[
                styles.activityLabel,
                { color: PRIMARY, textAlign: titleAlign },
              ]}
            >
              אירוע קרוב
            </Text>
            <Text
              style={[
                styles.activitySub,
                { color: TITLE_COLOR, textAlign: titleAlign },
              ]}
              numberOfLines={1}
            >
              {timeLine}
            </Text>
            {showTitle ? (
              <Text
                style={[styles.activityEventTitle, { textAlign: titleAlign }]}
                numberOfLines={1}
              >
                {nextActivity.title}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.activityBlock}>
      <View style={[styles.activityRow, { flexDirection: rowDir }]}>
        <Ionicons color="#9CA3AF" name="calendar-outline" size={17} />
        <View style={styles.activityTextCol}>
          <Text style={[styles.activityNoneLabel, { textAlign: titleAlign }]}>
            אין פעילות קרובה
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────

interface SkeletonCardProps {
  width: number;
}

function SkeletonCard({ width }: SkeletonCardProps) {
  return (
    <View style={[styles.cardWrapper, { width }]}>
      <View style={styles.cardInner}>
        <View style={styles.skeletonTopRow}>
          <View style={[styles.skeletonCircle]} />
          <View style={[styles.skeletonPill]} />
        </View>
        <View style={[styles.skeletonLine, { width: '88%', marginTop: 14 }]} />
        <View style={[styles.skeletonLine, { width: '45%', marginTop: 10 }]} />
        <View style={styles.skeletonDivider} />
        <View style={[styles.skeletonLine, { width: '72%', height: 12 }]} />
        <View style={{ flex: 1, minHeight: 4 }} />
      </View>
      <View style={styles.accentStrip} />
    </View>
  );
}

// ─── Community Card ───────────────────────────────────────────────────────────

interface CardProps {
  item: CommunityItem;
  onMenuPress: (ref: View | null) => void;
  onPress: () => void;
  referenceNow: number;
  width: number;
}

function CommunityCard({
  item,
  onMenuPress,
  onPress,
  referenceNow,
  width,
}: CardProps) {
  const { community } = item;
  const menuRef = useRef<View>(null);
  const firstTag = community.tags?.[0];
  // Inside direction:'ltr' cardWrapper, Android's explicit direction:'rtl' root makes
  // the card's direction:'ltr' a clean override — Yoga no longer flips 'left' to right.
  // Use physical 'right' on Android. iOS global RTL is unaffected (no change there).
  const titleAlign = ANDROID_MATCH_IOS_LAYOUT ? 'right' : (rtl.textAlign ?? 'right');
  const rowDir = rtl.flexDirection;
  const membersCount = Number.isFinite(item.membersCount)
    ? item.membersCount
    : 0;
  const canManage = item.role === 'owner' || item.role === 'admin';
  const pendingCount = item.pendingMembersCount ?? 0;
  const showPendingMenuBadge = canManage && pendingCount > 0;
  const pendingBadgeLabel = pendingCount <= 9 ? String(pendingCount) : '+9';

  const membersMetaLine = canManage
    ? `בניהולך · ${membersCount} חברים`
    : `${membersCount} חברים`;

  return (
    <Pressable
      style={[styles.cardWrapper, { width }]}
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`פתח קהילה ${community.name}`}
    >
      <View style={styles.cardInner}>
        {/*
          LTR wrapper: physical left = menu, physical right = category pill.
        */}
        <View style={styles.cardTopRow}>
          <View
            ref={menuRef}
            collapsable={false}
            style={styles.menuTriggerWrap}
          >
            <TouchableOpacity
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => onMenuPress(menuRef.current)}
              style={styles.menuTrigger}
              accessible
              accessibilityRole="button"
              accessibilityLabel={
                showPendingMenuBadge
                  ? `תפריט פעולות לקהילה, ${pendingCount} ממתינים לאישור`
                  : 'תפריט פעולות לקהילה'
              }
            >
              <Ionicons
                color={MENU_ICON_COLOR}
                name="ellipsis-horizontal"
                size={18}
              />
            </TouchableOpacity>
            {showPendingMenuBadge ? (
              <View style={styles.menuPendingBadge} pointerEvents="none">
                <Text style={styles.menuPendingBadgeText}>
                  {pendingBadgeLabel}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.cardTopRight}>
            {firstTag ? (
              <View style={styles.categoryPill}>
                <Text
                  style={[styles.categoryPillText, { textAlign: titleAlign }]}
                >
                  {firstTag}
                </Text>
              </View>
            ) : (
              <View style={styles.categoryPillPlaceholder} />
            )}
          </View>
        </View>

        <Text
          style={[styles.cardTitle, { textAlign: titleAlign }]}
          numberOfLines={2}
        >
          {community.name}
        </Text>

        <View style={[styles.membersRow, { flexDirection: rowDir }]}>
          <Ionicons color={MUTED_TEXT} name="people-outline" size={16} />
          <Text
            style={[
              styles.membersText,
              { textAlign: titleAlign, flex: 1, minWidth: 0 },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {membersMetaLine}
          </Text>
        </View>

        <View style={styles.divider} />

        <ActivitySummary
          nextActivity={item.nextActivity}
          referenceNow={referenceNow}
        />

        {item.hasNewEvents ? (
          <Text
            style={[styles.newEventsHint, { textAlign: titleAlign }]}
            numberOfLines={1}
          >
            יש אירועים חדשים
          </Text>
        ) : null}
      </View>

      <View style={styles.accentStrip} />
    </Pressable>
  );
}

// ─── Popover Menu (generic) ───────────────────────────────────────────────────

interface PopoverMenuItem {
  label: string;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  danger?: boolean;
  /** נגישות — אם לא מוגדר, משתמשים ב־label */
  accessibilityLabel?: string;
  /** טקסט משני מתחת לשורת התווית (למשל הקשר ממתינים) */
  subtitle?: string;
}

interface PopoverMenuProps {
  visible: boolean;
  position: MenuPosition;
  onClose: () => void;
  items: PopoverMenuItem[];
}

function PopoverMenu({ visible, position, onClose, items }: PopoverMenuProps) {
  if (!visible || items.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={styles.popoverBackdrop} onPress={onClose} />
      <View style={[styles.popover, { top: position.y, right: position.x }]}>
        {items.map((m, idx) => (
          <Pressable
            key={`${idx}-${m.label}`}
            style={[
              styles.popoverItem,
              idx < items.length - 1 && styles.popoverItemBorder,
            ]}
            onPress={() => {
              onClose();
              m.onPress();
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              m.accessibilityLabel ??
              (m.subtitle ? `${m.label}, ${m.subtitle}` : m.label)
            }
          >
            <View style={styles.popoverLabelCol}>
              <Text
                style={[styles.popoverLabel, m.danger && styles.popoverDanger]}
              >
                {m.label}
              </Text>
              {m.subtitle ? (
                <Text style={styles.popoverSubtitle}>{m.subtitle}</Text>
              ) : null}
            </View>
            <Ionicons
              name={m.iconName}
              size={18}
              color={m.danger ? '#ef4444' : '#374151'}
            />
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommunitiesScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const {
    unseenCount,
    markAllSeen,
    isLoading: notificationsLoading,
  } = useNotifications();

  const [viewerNow, setViewerNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setViewerNow(Date.now());
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  const communitiesData = useQuery(api.communities.listMyCommunities, {
    viewerNow,
  });
  const togglePinned = useMutation(api.communities.togglePinned);
  const deleteCommunity = useMutation(api.communities.deleteCommunity);
  const toggleNotifications = useMutation(api.communities.toggleNotifications);
  const leaveCommunity = useMutation(api.communities.leaveCommunity);
  const joinCommunityByCode = useMutation(api.communities.joinCommunityByCode);
  const updateJoinApprovalMode = useMutation(
    api.communities.updateCommunityJoinApprovalMode
  );

  const [activeFilter, setActiveFilter] = useState<FilterChip>('הכל');
  const [menuItem, setMenuItem] = useState<CommunityItem | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition>({ x: 16, y: 200 });
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinApprovalModalItem, setJoinApprovalModalItem] =
    useState<CommunityItem | null>(null);
  const [joinApprovalDraft, setJoinApprovalDraft] =
    useState<JoinApprovalMode>('automatic');
  const [joinApprovalSaving, setJoinApprovalSaving] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  // FIX 9 follow-up: same ProfileAssociationSheet used by community/[id].tsx,
  // reused here for the main Communities list ⋯ menu.
  const [profileAssociationCommunityId, setProfileAssociationCommunityId] =
    useState<Id<'communities'> | null>(null);

  const handleBellPress = (): void => {
    if (!isNotificationsOpen) {
      setIsNotificationsOpen(true);
    }
    if (!notificationsLoading) {
      markAllSeen();
    }
  };

  const extractInviteCode = useCallback((rawInput: string): string => {
    const trimmed = rawInput.trim();
    if (!trimmed) return '';
    const normalized = trimmed.replace(/\/+$/, '');
    const parts = normalized.split('/');
    const lastSegment = parts[parts.length - 1] ?? '';
    return lastSegment.trim().toUpperCase();
  }, []);

  // ── סינון לפי chip
  const filtered = (communitiesData ?? []).filter((row) => {
    if (activeFilter === 'הכל') return true;
    return row.community.tags?.includes(activeFilter) ?? false;
  });

  // ── פתיחת תפריט עם מיקום
  const handleMenuPress = useCallback(
    (item: CommunityItem, viewRef: View | null) => {
      if (!viewRef) {
        setMenuPos({ x: 16, y: 200 });
        setMenuItem(item);
        return;
      }
      viewRef.measure((_fx, _fy, _w, _h, _px, py) => {
        setMenuPos({ x: 16, y: py + _h + 4 });
        setMenuItem(item);
      });
    },
    []
  );

  const handleTogglePin = useCallback(
    (communityId: Id<'communities'>) => {
      togglePinned({ communityId }).catch(() =>
        Alert.alert('שגיאה', 'לא ניתן לשנות הצמדה')
      );
    },
    [togglePinned]
  );

  const handleDelete = useCallback(
    (item: CommunityItem) => {
      Alert.alert(
        'מחיקת קהילה',
        `מחיקת הקהילה תמחק גם את כל האירועים והמשימות שלה.\nהאם להמשיך?`,
        [
          { text: 'ביטול', style: 'cancel' },
          {
            text: 'מחיקה',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteCommunity({ communityId: item.community._id });
                setMenuItem(null);
              } catch {
                Alert.alert('שגיאה', 'לא ניתן למחוק את הקהילה');
              }
            },
          },
        ]
      );
    },
    [deleteCommunity]
  );

  const handleShareJoinLink = useCallback((item: CommunityItem) => {
    const inviteCode = item.community.inviteCode;
    if (!inviteCode) {
      Alert.alert('שגיאה', 'לא נמצא קישור הזמנה לקהילה זו');
      return;
    }
    const inviteUrl = `https://inyomi.app/join/${inviteCode}`;
    const message = `הצטרפו לקהילה "${item.community.name}" באפליקציית Inyomi: ${inviteUrl}`;

    setTimeout(async () => {
      try {
        await Share.share({ message });
      } catch {
        Alert.alert('שגיאה', 'לא ניתן לשתף כרגע');
      }
    }, 300);
  }, []);

  const handleToggleNotifications = useCallback(
    async (communityId: Id<'communities'>) => {
      try {
        const result = await toggleNotifications({ communityId });
        const msg = result.notificationsEnabled
          ? 'ההתראות הופעלו לקהילה הזו'
          : 'ההתראות כבויות לקהילה הזו';
        Alert.alert('התראות', msg, [{ text: 'אישור' }]);
      } catch {
        Alert.alert('שגיאה', 'לא ניתן לעדכן התראות כרגע');
      }
    },
    [toggleNotifications]
  );

  const handleLeaveCommunity = useCallback(
    (communityId: Id<'communities'>) => {
      Alert.alert(
        'לעזוב את הקהילה?',
        'לא תראי יותר את האירועים והמשימות של הקהילה הזו.',
        [
          { text: 'ביטול', style: 'cancel' },
          {
            text: 'עזיבה',
            style: 'destructive',
            onPress: async () => {
              try {
                await leaveCommunity({ communityId });
              } catch (err) {
                Alert.alert(
                  'שגיאה',
                  err instanceof Error ? err.message : 'לא ניתן לעזוב את הקהילה'
                );
              }
            },
          },
        ]
      );
    },
    [leaveCommunity]
  );

  const handleSaveJoinApproval = useCallback(async () => {
    if (!joinApprovalModalItem) return;
    setJoinApprovalSaving(true);
    try {
      await updateJoinApprovalMode({
        communityId: joinApprovalModalItem.community._id,
        joinApprovalMode: joinApprovalDraft,
      });
      setJoinApprovalModalItem(null);
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשמור את ההגדרות');
    } finally {
      setJoinApprovalSaving(false);
    }
  }, [joinApprovalDraft, joinApprovalModalItem, updateJoinApprovalMode]);

  const handleJoinByCode = useCallback(async () => {
    const inviteCode = extractInviteCode(joinCodeInput);
    if (!inviteCode) {
      Alert.alert('שגיאה', 'הכניסי קוד הצטרפות');
      return;
    }

    setJoinLoading(true);
    try {
      const result = await joinCommunityByCode({ inviteCode });
      if (result.status === 'invalid_code') {
        Alert.alert(
          'שגיאה',
          'לא הצלחנו להצטרף לקהילה. בדקי שהקוד נכון ונסי שוב.'
        );
        return;
      }
      if (result.status === 'pending_approval') {
        setJoinModalOpen(false);
        setJoinCodeInput('');
        Alert.alert(
          'בקשת ההצטרפות נשלחה',
          'בקשת ההצטרפות נשלחה וממתינה לאישור מנהל הקהילה'
        );
        return;
      }
      if (result.status === 'already_member') {
        setJoinModalOpen(false);
        setJoinCodeInput('');
        Alert.alert('הצלחה', 'את כבר חברה בקהילה הזו');
        return;
      }
      if (result.status === 'joined') {
        setJoinModalOpen(false);
        setJoinCodeInput('');
        Alert.alert('הצלחה', 'הצטרפת לקהילה');
      }
    } catch {
      Alert.alert(
        'שגיאה',
        'לא הצלחנו להצטרף לקהילה. בדקי שהקוד נכון ונסי שוב.'
      );
    } finally {
      setJoinLoading(false);
    }
  }, [extractInviteCode, joinCodeInput, joinCommunityByCode]);

  // ── בניית פריטי תפריט דינמית לפי הקהילה הנבחרת
  const buildMenuItems = useCallback(
    (item: CommunityItem): PopoverMenuItem[] => {
      const { community, role, pinned, notificationsEnabled } = item;
      const isOwner = role === 'owner';
      const isAdmin = role === 'admin';
      const isMember = role === 'member';
      const pendingForMenu = item.pendingMembersCount ?? 0;

      const items: PopoverMenuItem[] = [
        {
          label: pinned ? 'בטל נעיצה' : 'נעץ קהילה',
          iconName: pinned ? 'pin' : 'pin-outline',
          onPress: () => handleTogglePin(community._id),
        },
        ...(isOwner || isAdmin
          ? [
              {
                label: 'ערוך קהילה',
                iconName: 'create-outline' as const,
                onPress: () => {
                  router.push({
                    pathname: '/(authenticated)/community-edit/[id]',
                    params: { id: community._id, returnTo: 'list' },
                  });
                },
              },
            ]
          : []),
        ...(isOwner || isAdmin
          ? [
              {
                label: 'ניהול חברים',
                ...(pendingForMenu > 0
                  ? {
                      subtitle: `${pendingForMenu} ממתינים לאישור`,
                    }
                  : {}),
                iconName: 'people-outline' as const,
                onPress: () => {
                  router.push(
                    `/(authenticated)/community-members/${community._id}` as Parameters<
                      typeof router.push
                    >[0]
                  );
                },
              },
              {
                label: 'הגדרות הצטרפות',
                iconName: 'settings-outline' as const,
                accessibilityLabel: 'הגדרות הצטרפות לקהילה',
                onPress: () => {
                  setJoinApprovalDraft(
                    item.community.joinApprovalMode ?? 'automatic'
                  );
                  setJoinApprovalModalItem(item);
                },
              },
              {
                label: 'שיתוף קישור הצטרפות',
                iconName: 'share-outline' as const,
                onPress: () => handleShareJoinLink(item),
              },
            ]
          : []),
        ...(isMember
          ? [
              {
                label: notificationsEnabled ? 'אל תקבל התראות' : 'קבל התראות',
                iconName: notificationsEnabled
                  ? ('notifications-off-outline' as const)
                  : ('notifications-outline' as const),
                onPress: () => handleToggleNotifications(community._id),
              },
            ]
          : []),
        // FIX 9 follow-up: same personal-setting entry as the Community detail
        // ⋯ menu — visible to every active member, not owner/admin-gated.
        {
          label: 'שיוך לפרופיל משפחה',
          iconName: 'people-outline',
          onPress: () => {
            // Same menu-dismiss -> sheet-open sequencing already used in
            // community/[id].tsx for this exact action: let the overflow
            // menu's own Modal finish dismissing before presenting the
            // ProfileAssociationSheet Modal, avoiding a native modal
            // present/dismiss collision (visible as a "double open").
            setMenuItem(null);
            setTimeout(
              () => setProfileAssociationCommunityId(community._id),
              200
            );
          },
        },
        {
          label: 'הצג ביומן',
          iconName: 'calendar-outline',
          onPress: () => {
            // TODO: add communityId filter to calendar screen
            router.push(
              `/(authenticated)/calendar?communityId=${community._id}` as Parameters<
                typeof router.push
              >[0]
            );
          },
        },
      ];

      if (isMember) {
        items.push({
          label: 'עזיבת הקהילה',
          iconName: 'exit-outline',
          danger: true,
          onPress: () => handleLeaveCommunity(community._id),
        });
      }

      // מחיקה – owner בלבד
      if (isOwner) {
        items.push({
          label: 'מחיקת קהילה',
          iconName: 'trash-outline',
          danger: true,
          onPress: () => handleDelete(item),
        });
      }

      return items;
    },
    [
      handleTogglePin,
      handleDelete,
      handleShareJoinLink,
      handleToggleNotifications,
      handleLeaveCommunity,
      router,
    ]
  );

  const isLoading = communitiesData === undefined;
  const availableGridWidth = screenWidth - GRID_HORIZONTAL_PADDING * 2;
  const cardWidth = (availableGridWidth - GRID_COLUMN_GAP) / 2;

  return (
    <SafeAreaView style={[styles.container, ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null]} edges={['top']}>
      <View style={styles.headerSurface}>
        <MainScreenHeader
          title="הקהילות שלי"
          showAdd={true}
          onAdd={() => router.push('/(authenticated)/community-create')}
          onNotificationsPress={handleBellPress}
          notificationsCount={unseenCount}
          returnTo="/(authenticated)/communities"
        />
      </View>

      <View style={styles.secondaryActionRow}>
        <TouchableOpacity
          style={styles.joinByCodeBtn}
          onPress={() => setJoinModalOpen(true)}
          accessible
          accessibilityRole="button"
          accessibilityLabel="יש לך קוד הצטרפות?"
        >
          <Text
            style={[
              styles.joinByCodeText,
              { textAlign: rtl.textAlign ?? 'right' },
            ]}
          >
            יש לך קוד הצטרפות?
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Chips סינון */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chipsRow, { flexDirection: rtl.flexDirection }]}
        style={styles.chipsScroll}
      >
        {FILTER_CHIPS.map((chip) => {
          const active = chip === activeFilter;
          return (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setActiveFilter(chip)}
              accessible
              accessibilityRole="button"
              accessibilityLabel={chip}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Grid */}
      {isLoading ? (
        <FlatList
          data={[0, 1, 2, 3]}
          keyExtractor={(i) => String(i)}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContent}
          renderItem={() => <SkeletonCard width={cardWidth} />}
        />
      ) : filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="people-outline" size={60} color="#d1d5db" />
          <Text style={styles.emptyTitle}>
            {activeFilter === 'הכל'
              ? 'עדיין אין קהילות'
              : `אין קהילות בקטגוריה "${activeFilter}"`}
          </Text>
          {activeFilter === 'הכל' && (
            <Pressable
              style={styles.createBtn}
              onPress={() => router.push('/(authenticated)/community-create')}
              accessible
              accessibilityRole="button"
              accessibilityLabel="צור קהילה ראשונה"
            >
              <Text style={styles.createBtnText}>+ צור קהילה ראשונה</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList<CommunityItem>
          data={filtered}
          keyExtractor={(item) => item.community._id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <CommunityCard
              item={item}
              onMenuPress={(ref) => handleMenuPress(item, ref)}
              onPress={() => {
                router.push(
                  `/(authenticated)/community/${item.community._id}` as Parameters<
                    typeof router.push
                  >[0]
                );
              }}
              referenceNow={viewerNow}
              width={cardWidth}
            />
          )}
        />
      )}

      {/* ── Popover תפריט */}
      <PopoverMenu
        visible={menuItem !== null}
        position={menuPos}
        onClose={() => setMenuItem(null)}
        items={menuItem ? buildMenuItems(menuItem) : []}
      />

      {/* FIX 9 follow-up: same ProfileAssociationSheet as the Community
          detail screen — single shared implementation, reused here. */}
      {profileAssociationCommunityId ? (
        <ProfileAssociationSheet
          communityId={profileAssociationCommunityId}
          visible={profileAssociationCommunityId !== null}
          onClose={() => setProfileAssociationCommunityId(null)}
        />
      ) : null}

      <NotificationsDrawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        direction="rtl"
      />

      <Modal
        visible={joinModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setJoinModalOpen(false)}
      >
        <Pressable
          style={styles.joinModalBackdrop}
          onPress={() => setJoinModalOpen(false)}
        />
        <View style={styles.joinModalCard}>
          <Text style={styles.joinModalTitle}>הצטרפות לקהילה</Text>
          <TextInput
            value={joinCodeInput}
            onChangeText={setJoinCodeInput}
            style={styles.joinInput}
            placeholder="הכניסי קוד הצטרפות"
            placeholderTextColor="#9ca3af"
            autoCapitalize="characters"
            textAlign="right"
            editable={!joinLoading}
            accessible
            accessibilityLabel="קוד הצטרפות"
          />
          <View style={styles.joinModalButtons}>
            <TouchableOpacity
              style={styles.joinCancelBtn}
              onPress={() => setJoinModalOpen(false)}
              disabled={joinLoading}
              accessible
              accessibilityRole="button"
              accessibilityLabel="ביטול"
            >
              <Text style={styles.joinCancelText}>ביטול</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.joinSubmitBtn,
                joinLoading && styles.joinSubmitBtnDisabled,
              ]}
              onPress={handleJoinByCode}
              disabled={joinLoading}
              accessible
              accessibilityRole="button"
              accessibilityLabel="הצטרפות"
            >
              <Text style={styles.joinSubmitText}>
                {joinLoading ? 'מצטרפת...' : 'הצטרפות'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <JoinApprovalSettingsModal
        visible={joinApprovalModalItem !== null}
        value={joinApprovalDraft}
        saving={joinApprovalSaving}
        onChange={setJoinApprovalDraft}
        onClose={() => setJoinApprovalModalItem(null)}
        onSave={handleSaveJoinApproval}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  safeAreaRtl: {
    direction: 'rtl',
  },

  // ── Header
  headerSurface: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign ?? 'right',
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionRow: {
    backgroundColor: '#fff',
    flexDirection: rtl.flexDirection,
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  joinByCodeBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  joinByCodeText: {
    fontSize: 14,
    color: '#6b7280',
  },

  // ── Chips
  chipsScroll: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    maxHeight: 52,
  },
  chipsRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: PRIMARY },
  chipText: { fontSize: 13, color: '#555', fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  // ── Grid
  listContent: { padding: GRID_HORIZONTAL_PADDING, gap: 14 },
  columnWrapper: {
    flexDirection: rtl.flexDirection,
    gap: GRID_COLUMN_GAP,
    justifyContent: 'flex-start',
  },

  // ── Card — LTR row: accent strip stays on the physical right edge
  cardWrapper: {
    backgroundColor: '#fff',
    borderRadius: 24,
    direction: 'ltr',
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 218,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 4,
  },
  accentStrip: {
    width: 6,
    backgroundColor: PRIMARY,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
  },
  cardInner: {
    flex: 1,
    width: '100%',
    padding: 16,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    minHeight: 218,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
    gap: 10,
    minHeight: 34,
  },
  menuTriggerWrap: {
    width: 34,
    height: 34,
    position: 'relative',
  },
  menuTrigger: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: MENU_BTN_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuPendingBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuPendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  cardTopRight: {
    flex: 1,
    alignItems: rtl.alignStart,
    justifyContent: 'flex-start',
    minWidth: 0,
  },
  categoryPill: {
    backgroundColor: PILL_BG,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
    writingDirection: 'rtl',
    textAlign: rtl.textAlign,
  },
  categoryPillPlaceholder: {
    minHeight: 30,
  },
  cardTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: TITLE_COLOR,
    marginTop: 12,
    writingDirection: 'rtl',
    textAlign: rtl.textAlign,
    lineHeight: 26,
  },
  membersRow: {
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    justifyContent: 'flex-end',
    width: '100%',
  },
  membersText: {
    fontSize: 13,
    color: MUTED_TEXT,
    writingDirection: 'rtl',
  },
  divider: {
    height: 1,
    backgroundColor: DIVIDER_COLOR,
    marginVertical: 14,
  },
  activityBlock: {
    width: '100%',
  },
  activityRow: {
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
  },
  activityTextCol: {
    flex: 1,
    minWidth: 0,
  },
  activityLabel: {
    fontSize: 14,
    fontWeight: '700',
    writingDirection: 'rtl',
  },
  activitySub: {
    fontSize: 13,
    marginTop: 3,
    writingDirection: 'rtl',
  },
  activityNoneLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: MUTED_TEXT,
    writingDirection: 'rtl',
  },
  activityEventTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: MUTED_TEXT,
    marginTop: 4,
    writingDirection: 'rtl',
  },
  newEventsHint: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
    marginTop: 8,
    writingDirection: 'rtl',
  },
  // ── Skeleton
  skeletonTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  skeletonCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#e8eef5',
  },
  skeletonPill: {
    width: 56,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#e8eef5',
  },
  skeletonDivider: {
    height: 1,
    backgroundColor: DIVIDER_COLOR,
    marginVertical: 14,
    width: '100%',
  },
  skeletonLine: {
    height: 14,
    backgroundColor: '#e5e7eb',
    borderRadius: 7,
    alignSelf: rtl.alignStart,
  },

  // ── Empty
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  createBtn: {
    marginTop: 8,
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── Popover
  popoverBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  popover: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderRadius: 12,
    width: 210,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  popoverLabelCol: {
    flex: 1,
    minWidth: 0,
    alignItems: rtl.alignStart,
  },
  popoverItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  popoverLabel: {
    fontSize: 15,
    color: '#374151',
    textAlign: 'right',
    alignSelf: 'stretch',
  },
  popoverSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'right',
    marginTop: 2,
    writingDirection: 'rtl',
  },
  popoverDanger: { color: '#ef4444' },
  joinModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  joinModalCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '33%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  joinModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 12,
  },
  joinInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#111827',
    backgroundColor: '#fafafa',
  },
  joinModalButtons: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-start',
    gap: 10,
    marginTop: 14,
  },
  joinCancelBtn: {
    minHeight: 44,
    minWidth: 90,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  joinCancelText: {
    fontSize: 15,
    color: '#4b5563',
    fontWeight: '600',
  },
  joinSubmitBtn: {
    minHeight: 44,
    minWidth: 90,
    borderRadius: 10,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  joinSubmitBtnDisabled: {
    opacity: 0.7,
  },
  joinSubmitText: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '700',
  },
});
