/**
 * ProfileAvatarCircle — Reusable profile avatar for Calendar and Community UIs.
 *
 * FIX 9: Source of truth is FamilyMemberCard.tsx (FamilyMemberDisplayCard).
 * Reproduces the same visual identity:
 *   - Person: colored circle + 2-char initials (white)
 *   - Pet: colored circle + MaterialIcons "pets" icon (white)
 *
 * Props come from listMyFamilyContacts.members — no copied/cached data.
 * Designed so future photo support is trivially addable (conditional Image
 * before initials/icon).
 *
 * Selected state (FIX 9 UI follow-up): outer ring + small checkmark badge.
 * The ring's footprint is a fixed size regardless of `selected` (only the
 * border color toggles between transparent and the brand primary), so
 * selecting/deselecting never changes this component's rendered dimensions
 * — no layout shift for sibling avatars in a carousel.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getAvatarInitials } from '@/lib/avatarInitials';
import { colors } from '@/theme/colors';

interface ProfileAvatarCircleProps {
  displayName: string;
  color: string;
  memberType: 'person' | 'pet';
  size: number;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}

// Ring footprint is constant so the wrapper's rendered size never depends on
// `selected` — only border color changes.
const RING_GAP = 3;
const RING_WIDTH = 2;
const CHECK_BADGE_SIZE = 16;

export function ProfileAvatarCircle({
  displayName,
  color,
  memberType,
  size,
  selected = false,
  onPress,
  testID,
}: ProfileAvatarCircleProps): React.JSX.Element {
  const initials = getAvatarInitials(displayName);
  const isPet = memberType === 'pet';
  const iconSize = Math.round(size * 0.45);
  const fontSize = Math.round(size * 0.3);
  const outerSize = size + (RING_GAP + RING_WIDTH) * 2;

  const circle = (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    >
      {isPet ? (
        <MaterialIcons name="pets" size={iconSize} color="#ffffff" />
      ) : (
        <Text style={[styles.initials, { fontSize }]} numberOfLines={1}>
          {initials}
        </Text>
      )}
    </View>
  );

  const wrappedCircle = (
    <View
      style={[
        styles.selectedRing,
        {
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          borderWidth: RING_WIDTH,
          borderColor: selected ? colors.primary : 'transparent',
        },
      ]}
    >
      {circle}
      {selected ? (
        <View style={styles.checkBadge} pointerEvents="none">
          <MaterialIcons name="check" size={11} color="#ffffff" />
        </View>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={displayName}
        accessibilityState={{ selected }}
        hitSlop={4}
        testID={testID}
      >
        {wrappedCircle}
      </Pressable>
    );
  }

  return wrappedCircle;
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#ffffff',
    fontWeight: '700',
    opacity: 0.9,
  },
  selectedRing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: CHECK_BADGE_SIZE,
    height: CHECK_BADGE_SIZE,
    borderRadius: CHECK_BADGE_SIZE / 2,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
