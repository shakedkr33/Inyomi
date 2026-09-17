import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_IS_RTL, rtl } from '@/lib/rtl';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================================================
// Types
// ============================================================================

export type UpgradeReason = 'personal' | 'family' | 'general';

export interface UpgradeModalProps {
  visible: boolean;
  onClose: () => void;
  reason?: UpgradeReason;
  onUpgradePress?: () => void;
}

// ============================================================================
// Copy
// ============================================================================

const TITLE = 'החודש החינמי הסתיים';

const BODY =
  'המידע שלך נשמר וזמין לצפייה. כדי להמשיך ליצור ולערוך אירועים ומשימות אישיים או משפחתיים, אפשר לשדרג ל-InYomi Together. הקהילות נשארות פתוחות בחינם.';

// Reserved for future use.
// In Phase 3, this may be used to deep-link or preselect the relevant plan
// inside the subscription screen.
function getPrimaryLabel(_reason: UpgradeReason): string {
  return 'לשדרוג למנוי';
}

const SECONDARY_LABEL = 'להמשיך עם הקהילות בחינם';

// ============================================================================
// Component
// ============================================================================

/**
 * UpgradeModal — shown when the user attempts a gated action after trial expiry.
 *
 * Tone: calm, informative, no pressure. Data is never lost.
 * RTL-safe Hebrew layout throughout.
 *
 * Default behavior: closes modal and navigates to the subscription screen.
 * Callers may override via onUpgradePress for custom flows.
 */
export function UpgradeModal({
  visible,
  onClose,
  reason = 'general',
  onUpgradePress,
}: UpgradeModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 25,
        stiffness: 120,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  if (!visible) return null;

  const handleUpgrade = () => {
    if (onUpgradePress) {
      onUpgradePress();
    } else {
      onClose();
      router.push('/(authenticated)/subscription' as never);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={[s.overlay, ANDROID_MATCH_IOS_LAYOUT && { direction: 'rtl' }]}>
        {/* Backdrop — tap to dismiss */}
        <Pressable
          style={s.backdrop}
          onPress={onClose}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="סגור"
        />

        {/* Sheet */}
        <Animated.View
          style={[
            s.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Drag handle */}
          <View style={s.handleRow}>
            <View style={s.handle} />
          </View>

          {/* Content */}
          <View style={s.content}>
            {/* Title */}
            <Text style={[s.title, { textAlign: rtl.textAlign }]}>{TITLE}</Text>

            {/* Body */}
            <Text style={[s.body, { textAlign: rtl.textAlign }]}>{BODY}</Text>

            {/* Divider */}
            <View style={s.divider} />

            {/* Primary action */}
            <TouchableOpacity
              style={s.primaryButton}
              onPress={handleUpgrade}
              activeOpacity={0.8}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={getPrimaryLabel(reason)}
            >
              <Text style={s.primaryLabel}>{getPrimaryLabel(reason)}</Text>
            </TouchableOpacity>

            {/* Secondary action */}
            <TouchableOpacity
              style={s.secondaryButton}
              onPress={onClose}
              activeOpacity={0.7}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={SECONDARY_LABEL}
            >
              <Text style={s.secondaryLabel}>{SECONDARY_LABEL}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ============================================================================
// Styles
// ============================================================================

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d1d5db',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 12,
    lineHeight: 28,
  },
  body: {
    fontSize: 15,
    color: '#4b5563',
    lineHeight: 24,
    marginBottom: 24,
  },
  divider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#36a9e2',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 4,
  },
  secondaryLabel: {
    fontSize: 15,
    color: '#6b7280',
    fontWeight: '500',
  },
});
