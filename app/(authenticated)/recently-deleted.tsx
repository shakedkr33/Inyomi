import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { APP_IS_RTL, needsExplicitRTL, rtl } from '@/lib/rtl';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;

// ============================================================================
// Types
// ============================================================================

type TaskDeletedItem = {
  id: Id<'tasks'>;
  type: 'task';
  title: string;
  deletedAt: number | undefined;
  deleteExpiresAt: number | undefined;
};

type EventDeletedItem = {
  id: Id<'events'>;
  type: 'event';
  title: string;
  deletedAt: number | undefined;
  deleteExpiresAt: number | undefined;
};

type DeletedItem =
  | { kind: 'task'; item: TaskDeletedItem }
  | { kind: 'event'; item: EventDeletedItem };

// ============================================================================
// Helpers
// ============================================================================

function formatDeletedDate(deletedAt: number | undefined): string {
  if (!deletedAt) return '';
  return new Date(deletedAt).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
  });
}

function daysLeft(deleteExpiresAt: number | undefined): number | null {
  if (!deleteExpiresAt) return null;
  const diff = deleteExpiresAt - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

// ============================================================================
// Screen
// ============================================================================

export default function RecentlyDeletedScreen() {
  const router = useRouter();

  const deletedTasks = useQuery(api.tasks.listRecentlyDeleted);
  const deletedEvents = useQuery(api.events.listRecentlyDeletedPersonalEvents);

  const restoreTaskMutation = useMutation(api.tasks.restoreTask);
  const restoreEventMutation = useMutation(api.events.restorePersonalEvent);

  // Combine tasks and events into a single sorted list
  const combinedItems: DeletedItem[] = [
    ...(deletedTasks ?? []).map(
      (t): DeletedItem => ({
        kind: 'task',
        item: {
          id: t.id as Id<'tasks'>,
          type: 'task',
          title: t.title,
          deletedAt: t.deletedAt ?? undefined,
          deleteExpiresAt: t.deleteExpiresAt ?? undefined,
        },
      })
    ),
    ...(deletedEvents ?? []).map(
      (e): DeletedItem => ({
        kind: 'event',
        item: {
          id: e.id as Id<'events'>,
          type: 'event',
          title: e.title,
          deletedAt: e.deletedAt ?? undefined,
          deleteExpiresAt: e.deleteExpiresAt ?? undefined,
        },
      })
    ),
  ].sort((a, b) => {
    const aAt = a.item.deletedAt ?? 0;
    const bAt = b.item.deletedAt ?? 0;
    return bAt - aAt; // descending
  });

  const isEmpty = combinedItems.length === 0;

  const handleRestoreTask = async (id: Id<'tasks'>, title: string) => {
    try {
      await restoreTaskMutation({ id });
    } catch {
      Alert.alert(
        'שגיאה',
        `לא ניתן לשחזר את "${title}" כרגע. ייתכן שתקופת השחזור הסתיימה.`
      );
    }
  };

  const handleRestoreEvent = async (id: Id<'events'>, title: string) => {
    try {
      await restoreEventMutation({ eventId: id });
    } catch {
      Alert.alert(
        'שגיאה',
        `לא ניתן לשחזר את "${title}" כרגע. ייתכן שתקופת השחזור הסתיימה.`
      );
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, ANDROID_MATCH_IOS_LAYOUT ? styles.safeAreaRtl : null]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
          hitSlop={12}
        >
          <MaterialIcons name="chevron-right" size={28} color="#374151" />
        </Pressable>
        <Text style={styles.headerTitle}>נמחקו לאחרונה</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Explanatory text */}
        <Text style={styles.explanationText}>
          ניתן לשחזר פריטים עד למועד סיום השחזור המוצג. סיום תקופת השחזור אינו
          אישור למחיקה סופית של הנתונים.
        </Text>

        {isEmpty ? (
          /* Empty state */
          <View style={styles.emptyContainer}>
            <MaterialIcons name="delete-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>
              אין כאן פריטים שנמחקו לאחרונה.
            </Text>
          </View>
        ) : (
          /* Deleted items list */
          <View style={styles.listContainer}>
            {combinedItems.map((entry) => {
              const { item, kind } = entry;
              const days = daysLeft(item.deleteExpiresAt);
              const expired =
                item.deleteExpiresAt !== undefined &&
                item.deleteExpiresAt <= Date.now();
              const deletedDate = formatDeletedDate(item.deletedAt);
              const typeLabel = kind === 'task' ? 'משימה' : 'אירוע';

              return (
                <View
                  key={`${kind}-${String(item.id)}`}
                  style={styles.itemCard}
                >
                  <View style={styles.itemContent}>
                    <View style={styles.itemTypeRow}>
                      <View style={styles.typeChip}>
                        <Text style={styles.typeChipText}>{typeLabel}</Text>
                      </View>
                      {deletedDate ? (
                        <Text style={styles.deletedDateText}>
                          נמחק {deletedDate}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.itemTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {days !== null && days > 0 ? (
                      <Text style={styles.daysLeftText}>
                        {days === 1 ? 'נשאר יום אחד' : `נשארו ${days} ימים`}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    style={styles.restoreButton}
                    disabled={expired}
                    accessibilityState={{ disabled: expired }}
                    onPress={() => {
                      if (kind === 'task') {
                        void handleRestoreTask(
                          item.id as Id<'tasks'>,
                          item.title
                        );
                      } else {
                        void handleRestoreEvent(
                          item.id as Id<'events'>,
                          item.title
                        );
                      }
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`שחזור: ${item.title}`}
                    hitSlop={8}
                  >
                    <MaterialIcons name="restore" size={20} color="#36a9e2" />
                    <Text style={styles.restoreButtonText}>
                      {expired ? 'תקופת השחזור הסתיימה' : 'שחזור'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },
  safeAreaRtl: {
    direction: 'rtl',
  },
  header: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111517',
    textAlign: rtl.textAlign,
  },
  headerSpacer: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  explanationText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: rtl.textAlign,
    marginBottom: 16,
  },

  /* Empty state */
  emptyContainer: {
    marginTop: 60,
    alignItems: 'center',
    gap: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
    textAlign: 'center',
    paddingHorizontal: 24,
  },

  /* List */
  listContainer: {
    gap: 10,
  },
  itemCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  itemContent: {
    flex: 1,
    alignItems: needsExplicitRTL() ? 'flex-end' : 'flex-start',
    gap: 4,
  },
  itemTypeRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 8,
  },
  typeChip: {
    backgroundColor: '#f3f4f6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeChipText: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '600',
  },
  deletedDateText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111517',
    textAlign: rtl.textAlign,
  },
  daysLeftText: {
    fontSize: 12,
    color: '#f59e0b',
    textAlign: rtl.textAlign,
  },

  /* Restore button */
  restoreButton: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  restoreButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#36a9e2',
  },

  bottomSpacer: {
    height: 40,
  },
});
