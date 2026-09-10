/**
 * ProfileAssociationSheet — Bottom sheet for associating Family Profiles
 * with a Community. FIX 9.
 *
 * Auto-save: each tap calls setCommunityProfileAssociation immediately.
 * Optimistic toggle with revert on failure.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileAvatarCircle } from '@/components/ProfileAvatarCircle';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import {
  computeAssociationToggleResult,
  getSelectableProfiles,
  isProfileVisuallySelectedInAssociationSheet,
} from '@/lib/calendarProfileFilter';

interface ProfileAssociationSheetProps {
  communityId: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * Self-contained: fetches its own current association state via
 * `getCommunity` (the single source of truth for `myAssociatedProfileIds`).
 * This lets any screen open the same sheet for a given communityId without
 * needing to separately fetch/pass the community's association state —
 * avoiding a second, divergent association implementation.
 */
export function ProfileAssociationSheet({
  communityId,
  visible,
  onClose,
}: ProfileAssociationSheetProps): React.JSX.Element | null {
  const slideAnim = useRef(new Animated.Value(400)).current;
  const insets = useSafeAreaInsets();
  const familyContacts = useQuery(api.members.listMyFamilyContacts);
  const community = useQuery(api.communities.getCommunity, {
    communityId: communityId as Id<'communities'>,
  });
  const currentProfileIds = useMemo(
    () => (community?.myAssociatedProfileIds ?? []) as string[],
    [community?.myAssociatedProfileIds]
  );
  const selfEntityId = (familyContacts?.selfEntityId ?? null) as string | null;
  const setAssociation = useMutation(
    api.communities.setCommunityProfileAssociation
  );

  // Optimistic local state — tracks which profiles are selected
  const [optimisticIds, setOptimisticIds] = useState<Set<string>>(
    () => new Set(currentProfileIds)
  );
  // Track in-flight mutation to prevent double-tap
  const [saving, setSaving] = useState(false);

  // Sync optimistic state with server when sheet opens or server data changes
  const lastServerIdsRef = useRef<string>(JSON.stringify(currentProfileIds));
  const serverIdsStr = JSON.stringify(currentProfileIds);
  if (serverIdsStr !== lastServerIdsRef.current && !saving) {
    lastServerIdsRef.current = serverIdsStr;
    setOptimisticIds(new Set(currentProfileIds));
  }

  // Build canonical profile list — includes self + deduplicates
  const profiles = useMemo(() => {
    if (!familyContacts?.members) return [];
    return getSelectableProfiles(
      familyContacts.members.map((m) => ({
        _id: m._id as string,
        displayName: (m.displayName ?? '') as string,
        color: (m.color ?? '#36a9e2') as string,
        memberType: (m.memberType ?? 'person') as 'person' | 'pet',
        matchedUserId: m.matchedUserId as string | undefined,
      }))
    );
  }, [familyContacts?.members]);

  // Animate on visibility change
  const animateIn = useCallback(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [slideAnim]);

  // Run the entrance animation exactly once per open transition
  // (visible: false -> true). This must NOT re-run on every render while the
  // sheet stays open — e.g. when the `getCommunity` query resolves/updates,
  // when profile selection state changes, or when the mutation completes —
  // otherwise the sheet visibly resets and re-presents (the "double
  // open"/"jump on select" bug). Sheet lifecycle (this effect) is kept
  // separate from association state (selection/save), which must never
  // control mount/animation.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (visible && !wasVisible) {
      slideAnim.setValue(400);
      animateIn();
    }
  }, [visible, animateIn, slideAnim]);

  // FIX 9 FINAL UX FOLLOW-UP: no explicit association ([]) means Self is
  // the implicit default for filtering purposes (see
  // lib/calendarProfileFilter.ts). Mirror that same rule visually here so
  // the sheet never needs explanatory copy — the selected Self avatar IS
  // the explanation. This is a display-only derivation; it never writes
  // Self into `optimisticIds`/persisted state.
  const isProfileVisuallySelected = useCallback(
    (profileId: string) =>
      isProfileVisuallySelectedInAssociationSheet(
        Array.from(optimisticIds),
        selfEntityId,
        profileId
      ),
    [optimisticIds, selfEntityId]
  );

  const handleToggleProfile = useCallback(
    async (profileId: string) => {
      if (saving) return;

      const nextIdsArray = computeAssociationToggleResult(
        Array.from(optimisticIds),
        selfEntityId,
        profileId
      );
      // `null` = no-op: tapping the implicitly-selected Self profile while
      // there is no explicit association yet must not persist anything.
      if (nextIdsArray === null) return;

      const nextIds = new Set(nextIdsArray);

      // Optimistic toggle
      setOptimisticIds(nextIds);

      // Persist
      setSaving(true);
      try {
        await setAssociation({
          communityId: communityId as Id<'communities'>,
          profileIds: nextIdsArray as Id<'members'>[],
        });
      } catch {
        // Revert on failure
        setOptimisticIds(optimisticIds);
        Alert.alert('שגיאה', 'לא ניתן לעדכן שיוך פרופילים');
      } finally {
        setSaving(false);
      }
    },
    [saving, optimisticIds, setAssociation, communityId, selfEntityId]
  );

  if (!visible) return null;

  const hasProfiles = profiles.length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={sheetStyles.overlay}>
        <Pressable style={sheetStyles.backdrop} onPress={onClose} />
        <Animated.View
          style={[
            sheetStyles.sheet,
            { transform: [{ translateY: slideAnim }] },
          ]}
          accessibilityViewIsModal
        >
          {/* Handle */}
          <View style={sheetStyles.handleRow}>
            <View style={sheetStyles.handle} />
          </View>

          {/* Title + close */}
          <View style={sheetStyles.titleRow}>
            <View style={sheetStyles.titleTextGroup}>
              <Text style={sheetStyles.title}>שיוך לפרופיל משפחה</Text>
              {community?.name ? (
                <Text
                  style={sheetStyles.communityName}
                  numberOfLines={2}
                  accessibilityLabel={`הקהילה: ${community.name}`}
                >
                  {community.name}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessible
              accessibilityRole="button"
              accessibilityLabel="סגור"
              style={sheetStyles.closeBtn}
            >
              <MaterialIcons name="close" size={20} color="#647b87" />
            </Pressable>
          </View>

          {hasProfiles ? (
            <>
              <Text style={sheetStyles.subtitle}>
                בחרו את בני המשפחה ששייכים לקהילה זו · ניתן לבחור יותר מפרופיל
                אחד
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={sheetStyles.carouselContent}
                style={sheetStyles.carousel}
              >
                {profiles.map((profile) => {
                  const isSelected = isProfileVisuallySelected(profile._id);
                  return (
                    <View key={profile._id} style={sheetStyles.profileItem}>
                      <ProfileAvatarCircle
                        displayName={profile.displayName}
                        color={profile.color}
                        memberType={profile.memberType}
                        size={44}
                        selected={isSelected}
                        onPress={() => handleToggleProfile(profile._id)}
                      />
                      <Text
                        style={[
                          sheetStyles.profileName,
                          isSelected && sheetStyles.profileNameSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {profile.displayName}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          ) : (
            <View style={sheetStyles.emptyState}>
              <MaterialIcons name="family-restroom" size={32} color="#9ca3af" />
              <Text style={sheetStyles.emptyText}>
                הוסיפו פרופילים משפחתיים כדי לשייך קהילה
              </Text>
            </View>
          )}

          <View style={{ height: Math.max(24, insets.bottom) }} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
    direction: 'rtl',
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
  },
  titleRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  titleTextGroup: {
    flex: 1,
    marginStart: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'right',
  },
  communityName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#647b87',
    textAlign: 'right',
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 16,
  },
  carousel: {
    maxHeight: 90,
  },
  carouselContent: {
    gap: 14,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  profileItem: {
    alignItems: 'center',
    width: 56,
  },
  profileName: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  profileNameSelected: {
    color: '#1e293b',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
