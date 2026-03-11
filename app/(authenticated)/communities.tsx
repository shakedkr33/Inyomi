import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

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
  };
  role: UserRole;
  pinned: boolean;
}

interface MenuPosition {
  x: number;
  y: number;
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <View style={styles.cardWrapper}>
      <View style={styles.cardInner}>
        <View style={[styles.skeletonLine, { width: '65%' }]} />
        <View style={[styles.skeletonLine, { width: '35%', marginTop: 8 }]} />
        <View
          style={[
            styles.skeletonLine,
            { width: '50%', marginTop: 6, height: 10 },
          ]}
        />
      </View>
      <View style={[styles.colorBar, { backgroundColor: '#e5e7eb' }]} />
    </View>
  );
}

// ─── Community Card ───────────────────────────────────────────────────────────

interface CardProps {
  item: CommunityItem;
  onPinToggle: () => void;
  onMenuPress: (ref: View | null) => void;
  onPress: () => void;
}

function CommunityCard({ item, onPinToggle, onMenuPress, onPress }: CardProps) {
  const { community, pinned } = item;
  const menuRef = useRef<View>(null);
  const firstTag = community.tags?.[0];

  return (
    <Pressable
      style={styles.cardWrapper}
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`קהילה: ${community.name}`}
    >
      <View style={styles.cardInner}>
        {/* שורה עליונה: שם (ימין) + אייקונים (שמאל) */}
        <View style={styles.cardTopRow}>
          {/* שם – עד 2 שורות */}
          <Text style={styles.cardName} numberOfLines={2}>
            {community.name}
          </Text>
          {/* אייקונים בפינה שמאל-עליונה */}
          <View style={styles.cardActions}>
            <TouchableOpacity
              onPress={onPinToggle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessible
              accessibilityRole="button"
              accessibilityLabel={pinned ? 'בטל הצמדה' : 'הצמד'}
            >
              <Ionicons
                name={pinned ? 'pin' : 'pin-outline'}
                size={pinned ? 18 : 16}
                color={pinned ? PRIMARY : '#bbb'}
                style={
                  pinned ? { transform: [{ rotate: '-15deg' }] } : undefined
                }
              />
            </TouchableOpacity>
            <View ref={menuRef}>
              <TouchableOpacity
                onPress={() => onMenuPress(menuRef.current)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessible
                accessibilityRole="button"
                accessibilityLabel="אפשרויות"
              >
                <Ionicons name="ellipsis-vertical" size={16} color="#999" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* tag ראשון */}
        {firstTag ? (
          <View style={styles.tagChip}>
            <Text style={styles.tagText}>{firstTag}</Text>
          </View>
        ) : (
          <View style={styles.tagPlaceholder} />
        )}

        {/* מספר חברים – TODO: חבר ל-memberCount אמיתי מ-getCommunityMembers */}
        <Text style={styles.memberCount}>חברים</Text>

        {/* פעילות קרובה – TODO: חבר ל-nextActivityLabel מהשרת */}
        <Text style={styles.nextActivity} numberOfLines={1}>
          אין פעילויות קרובות
        </Text>
      </View>

      {/* פס צבע בצד ימין */}
      <View
        style={[
          styles.colorBar,
          { backgroundColor: community.color ?? PRIMARY },
        ]}
      />
    </Pressable>
  );
}

// ─── Popover Menu (generic) ───────────────────────────────────────────────────

interface PopoverMenuItem {
  label: string;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  danger?: boolean;
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
            key={m.label}
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
            accessibilityLabel={m.label}
          >
            <Text
              style={[styles.popoverLabel, m.danger && styles.popoverDanger]}
            >
              {m.label}
            </Text>
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

  const communitiesData = useQuery(api.communities.listMyCommunities);
  const togglePinned = useMutation(api.communities.togglePinned);
  const deleteCommunity = useMutation(api.communities.deleteCommunity);

  const [activeFilter, setActiveFilter] = useState<FilterChip>('הכל');
  const [menuItem, setMenuItem] = useState<CommunityItem | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition>({ x: 16, y: 200 });

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

  // ── בניית פריטי תפריט דינמית לפי הקהילה הנבחרת
  const buildMenuItems = useCallback(
    (item: CommunityItem): PopoverMenuItem[] => {
      const { community, role, pinned } = item;

      const inviteUrl = community.inviteCode
        ? `https://inyomi.app/join/${community.inviteCode}`
        : null;

      const items: PopoverMenuItem[] = [
        {
          label: pinned ? 'בטל הצמדה' : 'הצמדה',
          iconName: pinned ? 'pin' : 'pin-outline',
          onPress: () => handleTogglePin(community._id),
        },
        ...(role === 'owner' || role === 'admin'
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
        {
          label: 'ניהול חברים',
          iconName: 'people-outline',
          onPress: () => {
            router.push(
              `/(authenticated)/community-members/${community._id}` as Parameters<
                typeof router.push
              >[0]
            );
          },
        },
        {
          label: 'קישור הצטרפות',
          iconName: 'share-outline',
          onPress: () => {
            if (!inviteUrl) {
              Alert.alert('שגיאה', 'לא נמצא קישור הזמנה לקהילה זו');
              return;
            }
            Share.share({
              message: `הצטרפו לקהילה "${community.name}" באפליקציית Inyomi: ${inviteUrl}`,
            });
          },
        },
        {
          label: 'קבל התראות',
          iconName: 'notifications-outline',
          onPress: () => {
            Alert.alert(
              'התראות קהילה',
              'מעכשיו תקבלו התראה על כל אירוע חדש או שינוי באירועי הקהילה.',
              [{ text: 'אישור' }]
            );
            // TODO: connect to notifications
          },
        },
        {
          label: 'השתק',
          iconName: 'volume-mute-outline',
          onPress: () => {
            // TODO: add toggleMuteCommunity mutation to convex/communities.ts
            Alert.alert('בקרוב', 'אפשרות ההשתקה תהיה זמינה בקרוב');
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

      // מחיקה – owner בלבד
      if (role === 'owner') {
        items.push({
          label: 'מחיקת קהילה',
          iconName: 'trash-outline',
          danger: true,
          onPress: () => handleDelete(item),
        });
      }

      return items;
    },
    [handleTogglePin, handleDelete, router]
  );

  const isLoading = communitiesData === undefined;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── כותרת */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>הקהילות שלי</Text>
        <Pressable
          onPress={() => router.push('/(authenticated)/community-create')}
          style={styles.addBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="צור קהילה חדשה"
        >
          <MaterialIcons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* ── Chips סינון */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        style={styles.chipsScroll}
      >
        {[...FILTER_CHIPS].reverse().map((chip) => {
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
          renderItem={() => <SkeletonCard />}
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
              onPinToggle={() => handleTogglePin(item.community._id)}
              onMenuPress={(ref) => handleMenuPress(item, ref)}
              onPress={() => {
                router.push(
                  `/(authenticated)/community/${item.community._id}` as Parameters<
                    typeof router.push
                  >[0]
                );
              }}
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
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },

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
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Chips
  chipsScroll: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    maxHeight: 52,
  },
  chipsRow: {
    flexDirection: 'row',
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
  listContent: { padding: 16, gap: 12 },
  columnWrapper: { gap: 12 },

  // ── Card
  cardWrapper: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 140,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  colorBar: {
    width: 5,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  cardInner: {
    flex: 1,
    padding: 12,
    alignItems: 'flex-end',
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
  },
  cardName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    flex: 1,
    writingDirection: 'rtl',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 4,
  },
  tagChip: {
    marginTop: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-end',
  },
  tagText: { fontSize: 11, color: '#6b7280', fontWeight: '500' },
  tagPlaceholder: { height: 18, marginTop: 8 },
  memberCount: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
    textAlign: 'right',
  },
  nextActivity: {
    fontSize: 11,
    color: '#aaa',
    marginTop: 3,
    textAlign: 'right',
  },

  // ── Skeleton
  skeletonLine: {
    height: 14,
    backgroundColor: '#e5e7eb',
    borderRadius: 7,
    alignSelf: 'flex-end',
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
  popoverItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  popoverLabel: {
    fontSize: 15,
    color: '#374151',
    textAlign: 'right',
    flex: 1,
  },
  popoverDanger: { color: '#ef4444' },
});
