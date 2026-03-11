import { useAuthActions } from '@convex-dev/auth/react';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  BackHandler,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.round(SCREEN_WIDTH * 0.75);
const SPRING = { damping: 26, stiffness: 130 } as const;
const PRIMARY = '#36a9e2';
const ICON_BG = '#F8FAFC';
const ICON_COLOR = '#64748b';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionHeaderText}>{label}</Text>
    </View>
  );
}

interface ToggleRowProps {
  icon: string;
  iconBg: string;
  iconColor: string;
  title: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}

function ToggleRow({
  icon,
  iconBg,
  iconColor,
  title,
  value,
  onToggle,
}: ToggleRowProps): React.JSX.Element {
  return (
    <View style={s.row}>
      <View style={[s.iconBox, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon as never} size={18} color={iconColor} />
      </View>
      <Text style={s.rowTitle}>{title}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#e2e8f0', true: `${PRIMARY}66` }}
        thumbColor={value ? PRIMARY : '#fff'}
        ios_backgroundColor="#e2e8f0"
        style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
      />
    </View>
  );
}

interface NavRowProps {
  icon: string;
  iconBg: string;
  iconColor: string;
  title: string;
  titleColor?: string;
  subtitle?: string;
  badge?: string;
  showChevron?: boolean;
  onPress: () => void;
}

function NavRow({
  icon,
  iconBg,
  iconColor,
  title,
  titleColor,
  subtitle,
  badge,
  showChevron = true,
  onPress,
}: NavRowProps): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[s.iconBox, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon as never} size={18} color={iconColor} />
      </View>
      <View style={s.rowContent}>
        <Text style={[s.rowTitle, titleColor ? { color: titleColor } : null]}>
          {title}
        </Text>
        {subtitle && <Text style={s.rowSubtitle}>{subtitle}</Text>}
      </View>
      {badge && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      )}
      {showChevron && (
        <MaterialIcons name="chevron-left" size={20} color="#cbd5e1" />
      )}
    </Pressable>
  );
}

function Divider(): React.JSX.Element {
  return <View style={s.divider} />;
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export function SettingsDrawer({
  isOpen,
  onClose,
}: SettingsDrawerProps): React.JSX.Element | null {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuthActions();

  const [modalVisible, setModalVisible] = useState(false);
  const [morningDigest, setMorningDigest] = useState(true);
  const [eveningDigest, setEveningDigest] = useState(true);
  const [smartReminders, setSmartReminders] = useState(true);

  const translateX = useSharedValue(DRAWER_WIDTH);

  // Load persisted toggle states
  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const [m, e, sr] = await Promise.all([
          AsyncStorage.getItem('@settings/morning'),
          AsyncStorage.getItem('@settings/evening'),
          AsyncStorage.getItem('@settings/smart'),
        ]);
        if (m !== null) setMorningDigest(m === 'true');
        if (e !== null) setEveningDigest(e === 'true');
        if (sr !== null) setSmartReminders(sr === 'true');
      } catch {}
    };
    load();
  }, []);

  // Animate open / close
  useEffect(() => {
    if (isOpen) {
      setModalVisible(true);
      translateX.value = withSpring(0, SPRING);
    } else if (modalVisible) {
      translateX.value = withSpring(DRAWER_WIDTH, SPRING, () => {
        runOnJS(setModalVisible)(false);
      });
    }
  }, [isOpen, modalVisible, translateX]);

  // Android back button closes drawer instead of navigating back
  useEffect(() => {
    if (!isOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [isOpen, onClose]);

  const saveToggle = async (key: string, value: boolean): Promise<void> => {
    try {
      await AsyncStorage.setItem(key, String(value));
    } catch {}
  };

  const handleMorning = (v: boolean): void => {
    setMorningDigest(v);
    saveToggle('@settings/morning', v);
  };
  const handleEvening = (v: boolean): void => {
    setEveningDigest(v);
    saveToggle('@settings/evening', v);
  };
  const handleSmart = (v: boolean): void => {
    setSmartReminders(v);
    saveToggle('@settings/smart', v);
  };

  const navigateTo = (href: string): void => {
    onClose();
    // slight delay to let the drawer close animation start before navigating
    setTimeout(() => router.push(href as never), 280);
  };

  const handleSignOut = (): void => {
    Alert.alert('יציאה', 'האם לצאת מהחשבון?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'יציאה',
        onPress: async () => {
          onClose();
          try {
            await signOut();
          } catch {}
        },
      },
    ]);
  };

  const handleDeleteAccount = (): void => {
    Alert.alert(
      'מחיקת חשבון',
      'פעולה זו אינה הפיכה.\nכל הנתונים שלך יימחקו לצמיתות.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'מחק חשבון',
          style: 'destructive',
          onPress: async () => {
            onClose();
            try {
              await signOut();
            } catch {}
          },
        },
      ]
    );
  };

  // Swipe right → close
  const panGesture = Gesture.Pan()
    .activeOffsetX([8, Number.POSITIVE_INFINITY])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (e.translationX > 0) translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const shouldClose =
        e.translationX > DRAWER_WIDTH * 0.3 || e.velocityX > 700;
      if (shouldClose) {
        translateX.value = withSpring(DRAWER_WIDTH, SPRING);
        runOnJS(onClose)();
      } else {
        translateX.value = withSpring(0, SPRING);
      }
    });

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, DRAWER_WIDTH], [1, 0]),
  }));

  if (!modalVisible) return null;

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      {/*
       * Backdrop and drawer are SIBLINGS — backdrop never wraps the drawer,
       * so its Pressable cannot intercept touches inside the drawer.
       */}
      <View style={s.modalRoot}>
        {/* Dimmed backdrop — only covers the area to the left of the drawer */}
        <Animated.View style={[s.backdrop, backdropStyle]}>
          <Pressable
            style={{ flex: 1 }}
            onPress={onClose}
            accessible={true}
            accessibilityLabel="סגור תפריט"
          />
        </Animated.View>

        {/* Drawer panel */}
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              s.drawerPanel,
              { paddingBottom: insets.bottom },
              drawerStyle,
            ]}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={{ paddingTop: insets.top + 8 }}
            >
              {/* Close button */}
              <View style={s.drawerHeader}>
                <Pressable
                  style={s.closeBtn}
                  onPress={onClose}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="סגור"
                >
                  <MaterialIcons name="close" size={20} color="#64748b" />
                </Pressable>
              </View>

              {/* Profile */}
              <View style={s.profileSection}>
                <View style={s.avatarCircle}>
                  <Text style={s.avatarInitials}>שי</Text>
                </View>
                <Text style={s.profileName}>ישראל ישראלי</Text>
                <Text style={s.profileEmail}>israel@email.com</Text>
                <Pressable
                  style={s.editProfileBtn}
                  onPress={() => navigateTo('/(authenticated)/family-profile')}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="עריכת פרופיל"
                >
                  <Text style={s.editProfileBtnText}>עריכת פרופיל</Text>
                </Pressable>
              </View>

              <Divider />

              {/* Notifications */}
              <SectionHeader label="התראות" />
              <ToggleRow
                icon="wb-sunny"
                iconBg={ICON_BG}
                iconColor={ICON_COLOR}
                title="סיכום בוקר"
                value={morningDigest}
                onToggle={handleMorning}
              />
              <ToggleRow
                icon="nights-stay"
                iconBg={ICON_BG}
                iconColor={ICON_COLOR}
                title="סיכום ערב"
                value={eveningDigest}
                onToggle={handleEvening}
              />
              <ToggleRow
                icon="psychology"
                iconBg={ICON_BG}
                iconColor={ICON_COLOR}
                title="תזכורות חכמות"
                value={smartReminders}
                onToggle={handleSmart}
              />

              <Divider />

              {/* Data */}
              <SectionHeader label="נתונים" />
              <NavRow
                icon="event"
                iconBg={ICON_BG}
                iconColor={ICON_COLOR}
                title="ייבוא יומן חיצוני"
                onPress={() => navigateTo('/(authenticated)/import-calendar')}
              />
              <NavRow
                icon="celebration"
                iconBg={ICON_BG}
                iconColor={ICON_COLOR}
                title="ייבוא חגים ישראליים"
                onPress={() => navigateTo('/(authenticated)/import-holidays')}
              />

              <Divider />

              {/* Account */}
              <SectionHeader label="חשבון" />
              <NavRow
                icon="logout"
                iconBg="#F8FAFC"
                iconColor="#64748b"
                title="יציאה מהחשבון"
                showChevron={false}
                onPress={handleSignOut}
              />
              <NavRow
                icon="delete-forever"
                iconBg="#FEF2F2"
                iconColor="#EF4444"
                title="מחיקת חשבון"
                titleColor="#EF4444"
                showChevron={false}
                onPress={handleDeleteAccount}
              />

              <Text style={s.versionText}>גרסה 2.4.0</Text>
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  modalRoot: {
    flex: 1,
    flexDirection: 'row-reverse', // drawer on right, backdrop on left
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  drawerPanel: {
    width: DRAWER_WIDTH,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ─── Profile ────────────────────────────────────
  profileSection: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 24,
    gap: 6,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${PRIMARY}20`,
    borderWidth: 3,
    borderColor: `${PRIMARY}40`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarInitials: {
    fontSize: 26,
    fontWeight: '700',
    color: PRIMARY,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  profileEmail: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },
  editProfileBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: PRIMARY,
  },
  editProfileBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
  },
  // ─── Section header ──────────────────────────────
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 20,
    marginVertical: 4,
  },
  // ─── Row ─────────────────────────────────────────
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    minHeight: 52,
  },
  rowPressed: {
    backgroundColor: '#f8fafc',
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
    alignItems: 'flex-end',
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    textAlign: 'right',
  },
  rowSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
    marginTop: 1,
  },
  badge: {
    backgroundColor: `${PRIMARY}15`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: PRIMARY,
  },
  // ─── Footer ──────────────────────────────────────
  versionText: {
    textAlign: 'center',
    fontSize: 11,
    color: '#cbd5e1',
    paddingVertical: 24,
  },
});
