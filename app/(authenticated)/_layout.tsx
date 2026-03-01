import { MaterialIcons } from '@expo/vector-icons';
import { useConvexAuth } from 'convex/react';
import { Redirect, Tabs, useRootNavigationState, useRouter } from 'expo-router';
import { useContext, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PAYMENT_SYSTEM_ENABLED } from '@/config/appConfig';
import { ActionSheetContext } from '@/contexts/ActionSheetContext';
import { useRevenueCat } from '@/contexts/RevenueCatContext';

// ─── Regular Tab Button (icon + label wrapped in selection pill) ──────────────

type TabBtnProps = {
  iconName: string;
  label: string;
  onPress?: ((e: unknown) => void) | null;
  onLongPress?: ((e: unknown) => void) | null;
  accessibilityState?: { selected?: boolean };
};

function RegularTabButton({ iconName, label, onPress, onLongPress, accessibilityState }: TabBtnProps) {
  const focused = accessibilityState?.selected === true;
  const color = focused ? '#36a9e2' : '#6b7280';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tabButtonBase}
      accessible={true}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
    >
      <View style={focused ? styles.activeTabPill : styles.inactiveTabItem}>
        <MaterialIcons name={iconName as never} size={22} color={color} />
        <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
      </View>
    </Pressable>
  );
}

// ─── Central Plus Tab Button (raised circle) ──────────────────────────────────

function PlusCenterButton() {
  const { openActionSheet } = useContext(ActionSheetContext);
  return (
    <Pressable
      onPress={openActionSheet}
      style={styles.tabButtonBase}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel="הוסף פריט חדש"
    >
      <View style={styles.plusBtn}>
        <MaterialIcons name="add" size={32} color="white" />
      </View>
    </Pressable>
  );
}

// ─── Action Sheet Modal ───────────────────────────────────────────────────────

function ActionSheetModal({
  isVisible,
  onClose,
}: {
  isVisible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Modal
      animationType="slide"
      transparent
      visible={isVisible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.bottomSheetContainer}
      >
        <View style={styles.sheetPanel}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetInput}>
            <MaterialIcons name="auto-awesome" size={20} color="#36a9e2" />
            <TextInput
              style={styles.sheetTextInput}
              placeholder="על מה את חושבת? או הדביקי הודעה..."
              placeholderTextColor="#94a3b8"
            />
            <View style={styles.sheetInputIcons}>
              <MaterialIcons name="photo-camera" size={22} color="#94a3b8" />
              <MaterialIcons name="mic" size={22} color="#94a3b8" />
            </View>
          </View>
          <View style={styles.sheetActions}>
            <ActionButton
              icon="calendar-today"
              label="אירוע"
              onPress={() => {
                onClose();
                router.push('/(authenticated)/event/new');
              }}
            />
            <ActionButton
              icon="check"
              label="משימה"
              onPress={() => {
                onClose();
                router.push('/(authenticated)/task/new');
              }}
            />
            <ActionButton
              icon="cake"
              label="יום הולדת"
              onPress={() => {
                onClose();
                router.push('/birthdays');
              }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 8 }}>
      <View style={styles.actionBtnCircle}>
        <MaterialIcons name={icon as never} size={28} color="#36a9e2" />
      </View>
      <Text style={styles.actionBtnLabel}>{label}</Text>
    </Pressable>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function AuthenticatedLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isPremium, isLoading: isRevenueCatLoading } = useRevenueCat();
  const navigationState = useRootNavigationState();
  const [isActionSheetVisible, setIsActionSheetVisible] = useState(false);

  if (!navigationState?.key || isLoading || isRevenueCatLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#4A9FE2" />
      </View>
    );
  }

  if (!isAuthenticated && !__DEV__) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (PAYMENT_SYSTEM_ENABLED && !isPremium) {
    return <Redirect href="/(auth)/paywall" />;
  }

  return (
    <ActionSheetContext.Provider
      value={{ openActionSheet: () => setIsActionSheetVisible(true) }}
    >
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: '#36a9e2',
            tabBarInactiveTintColor: '#6b7280',
            tabBarStyle: {
              backgroundColor: '#ffffff',
              borderTopColor: '#f0f0f0',
              height: 90,
              paddingBottom: 25,
              paddingTop: 10,
              overflow: 'visible',
            },
            tabBarLabelStyle: { display: 'none' }, // labels rendered inside our custom buttons
          }}
        >
          {/* ── Visible tabs (left → right) ── */}
          <Tabs.Screen
            name="index"
            options={{
              tabBarButton: (props) => (
                <RegularTabButton {...(props as unknown as TabBtnProps)} iconName="home" label="בית" />
              ),
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              tabBarButton: (props) => (
                <RegularTabButton
                  {...(props as unknown as TabBtnProps)}
                  iconName="check-circle-outline"
                  label="משימות"
                />
              ),
            }}
          />
          {/* Central Plus */}
          <Tabs.Screen
            name="plus"
            options={{
              title: '',
              tabBarButton: () => <PlusCenterButton />,
            }}
          />
          <Tabs.Screen
            name="groups"
            options={{
              tabBarButton: (props) => (
                <RegularTabButton {...(props as unknown as TabBtnProps)} iconName="group" label="קבוצות" />
              ),
            }}
          />
          {/* Profile is accessible via avatar press / navigation, not from tab bar */}
          <Tabs.Screen name="profile" options={{ href: null }} />

          {/* ── Hidden screens ── */}
          <Tabs.Screen name="settings" options={{ href: null }} />
          <Tabs.Screen name="calendar" options={{ href: null }} />
          <Tabs.Screen name="birthdays" options={{ href: null }} />
          <Tabs.Screen name="event/new" options={{ href: null }} />
          <Tabs.Screen name="event/[id]" options={{ href: null }} />
          <Tabs.Screen name="task/new" options={{ href: null }} />
          <Tabs.Screen name="task/[id]" options={{ href: null }} />
          <Tabs.Screen name="import-calendar" options={{ href: null }} />
          <Tabs.Screen name="import-holidays" options={{ href: null }} />
          <Tabs.Screen name="family-profile" options={{ href: null }} />
        </Tabs>

        <ActionSheetModal
          isVisible={isActionSheetVisible}
          onClose={() => setIsActionSheetVisible(false)}
        />
      </View>
    </ActionSheetContext.Provider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Tab bar buttons
  tabButtonBase: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTabPill: {
    backgroundColor: 'rgba(54,169,226,0.12)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 56,
  },
  inactiveTabItem: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 56,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    marginTop: 2,
  },
  tabLabelActive: { color: '#36a9e2' },

  // Central plus button — raised circle
  plusBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    shadowColor: '#36a9e2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },

  // Action sheet
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  bottomSheetContainer: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  sheetPanel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 48,
  },
  sheetHandle: {
    width: 40,
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 24,
  },
  sheetInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    borderRadius: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 32,
  },
  sheetTextInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: 16,
    paddingHorizontal: 12,
    color: '#111517',
  },
  sheetInputIcons: { flexDirection: 'row-reverse', gap: 8 },
  sheetActions: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  actionBtnCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f0f7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnLabel: { fontSize: 14, fontWeight: '700', color: '#111418' },
});
