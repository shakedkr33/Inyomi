import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { LocalAssignee } from '@/lib/components/event/TaskAssigneeSheet';
import { TaskAssigneeSheet } from '@/lib/components/event/TaskAssigneeSheet';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

// ─── Types ────────────────────────────────────────────────────────────────────

type RsvpStatus = 'yes' | 'no' | 'maybe' | 'none';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes <= 0) return '';
  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRecurrenceLabel(pattern: string | undefined): string {
  if (pattern === 'daily') return 'כל יום';
  if (pattern === 'weekly') return 'כל שבוע';
  if (pattern === 'monthly') return 'כל חודש';
  if (pattern === 'yearly') return 'כל שנה';
  if (pattern === 'custom') return 'מותאם אישית';
  return 'ללא';
}

function formatReminderLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'תזכורת: בזמן האירוע';
  if (offsetMinutes === 60) return 'תזכורת: שעה לפני האירוע';
  if (offsetMinutes === 1440) return 'תזכורת: יום לפני האירוע';
  if (offsetMinutes % 1440 === 0) {
    return `תזכורת: ${offsetMinutes / 1440} ימים לפני האירוע`;
  }
  if (offsetMinutes % 60 === 0) {
    return `תזכורת: ${offsetMinutes / 60} שעות לפני האירוע`;
  }
  return `תזכורת: ${offsetMinutes} דקות לפני האירוע`;
}

function getReminderLabels(eventLike: unknown): string[] {
  const reminders = (eventLike as { reminders?: unknown }).reminders;
  if (!Array.isArray(reminders) || reminders.length === 0) return [];
  return reminders
    .filter((r): r is number => typeof r === 'number')
    .map(formatReminderLabel);
}

// ─── RSVP Options (module-level to avoid recreating in render) ────────────────

const RSVP_OPTIONS = [
  { status: 'yes' as const, label: 'כן', activeColor: '#22c55e' },
  { status: 'maybe' as const, label: 'אולי', activeColor: '#eab308' },
  { status: 'no' as const, label: 'לא', activeColor: '#ef4444' },
];

// ─── Overflow Menu ────────────────────────────────────────────────────────────

interface OverflowItem {
  label: string;
  iconName: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  danger?: boolean;
}

interface OverflowMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  items: OverflowItem[];
  onClose: () => void;
}

function OverflowMenu({
  visible,
  position,
  items,
  onClose,
}: OverflowMenuProps) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.popoverBackdrop} onPress={onClose} />
      <View style={[styles.popover, { top: position.y, left: position.x }]}>
        {items.map((m, idx) => (
          <Pressable
            key={m.label}
            style={[
              styles.popoverItem,
              idx < items.length - 1 && styles.popoverBorder,
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

// FIXED: guard against non-Convex route params (e.g. mock item ids like "1", "2")
// Convex IDs are base62-encoded strings; a length < 8 is never a valid Id<'events'>.
function isValidConvexId(value: string | undefined): boolean {
  return typeof value === 'string' && value.length >= 8;
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Guard: only cast to Id<'events'> when the param looks like a real Convex ID.
  // If the guard fails we skip all queries (pass 'skip') and show the not-found state.
  const eventId = isValidConvexId(id) ? (id as Id<'events'>) : null;

  const event = useQuery(
    api.events.getById,
    eventId ? { eventId } : 'skip'
  );
  const rsvps = useQuery(
    api.eventRsvps.listByEvent,
    eventId ? { eventId } : 'skip'
  );
  const eventTasks = useQuery(
    api.eventTasks.listByEvent,
    eventId ? { eventId } : 'skip'
  );
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;

  const upsertRsvp = useMutation(api.eventRsvps.upsertRsvp);
  const cancelEventMutation = useMutation(api.events.cancelEvent);
  const removeEventTask = useMutation(api.eventTasks.remove);
  const setTaskAssignee = useMutation(api.eventTasks.setAssignee);
  // FIXED: link-based sharing for personal events (no communityId)
  const createShareLinkMutation = useMutation(api.shareLinks.createShareLink);

  const communityMembersData = useQuery(
    api.communities.getCommunityMembers,
    event?.communityId ? { communityId: event.communityId } : 'skip'
  );

  const [assigneeSheetTaskId, setAssigneeSheetTaskId] = useState<string | null>(
    null
  );
  const [manualAssigneeName, setManualAssigneeName] = useState('');

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 8, y: 80 });
  const menuBtnRef = useRef<View>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const handleMenuPress = useCallback(() => {
    if (!menuBtnRef.current) {
      setMenuPos({ x: 8, y: 80 });
      setMenuOpen(true);
      return;
    }
    menuBtnRef.current.measureInWindow((x, y, _w, h) => {
      // Popover anchored to left; ensure it doesn't overflow left edge (x >= 0)
      const popoverX = Math.max(0, x);
      setMenuPos({ x: popoverX, y: y + h + 4 });
      setMenuOpen(true);
    });
  }, []);

  const handleRsvp = useCallback(
    (status: RsvpStatus) => {
      if (!eventId) return;
      upsertRsvp({ eventId, status }).catch(() =>
        Alert.alert('שגיאה', 'לא ניתן לשמור תגובה')
      );
    },
    [eventId, upsertRsvp]
  );

  const handleCancelEvent = useCallback(async () => {
    if (!event || !eventId) return;
    setShowCancelDialog(false);
    try {
      await cancelEventMutation({
        eventId,
        cancelReason: cancelReason.trim() || undefined,
      });
      setCancelReason('');
      if (event.communityId) {
        router.replace({
          pathname: '/(authenticated)/community/[id]',
          params: { id: event.communityId },
        });
      } else {
        router.replace(
          '/(authenticated)/communities' as Parameters<typeof router.replace>[0]
        );
      }
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לבטל את האירוע');
    }
  }, [event, eventId, cancelEventMutation, cancelReason, router]);

  // FIXED: always embed URL inside message — never use the separate `url` field.
  // Passing `url` as a second Share.share argument causes iOS UIActivityViewController
  // to treat it as an attachment object; WhatsApp then shows only the URL card and
  // silently drops the message text. Embedding the https:// link directly inside
  // `message` is reliable on both iOS and Android: messaging apps auto-linkify it.
  const handleShare = useCallback(() => {
    if (!event) return;
    const isPersonalEvent = !event.communityId;

    const doShare = async () => {
      // Build the human-readable text block (title + date + location)
      const lines: string[] = [event.title];
      let dateLine = formatFullDate(event.startTime);
      if (!event.allDay) dateLine += ` · ${formatTime(event.startTime)}`;
      lines.push(dateLine);
      if (event.location) lines.push(`📍 ${event.location}`);
      const shareText = lines.join('\n');

      if (isPersonalEvent && eventId) {
        try {
          const { token } = await createShareLinkMutation({ eventId });

          // FIXED: clickable HTTPS share link
          const shareUrl = `https://inyomi.com/shared/${token}`;
          const finalMessage = `${shareText}\n\n${shareUrl}`;
          await Share.share({ message: finalMessage });
          return;
        } catch {
          // Fall back to text-only share if link generation fails
        }
      }

      // Community events or fallback: text-only share
      try {
        await Share.share({ message: shareText });
      } catch (e) {
        console.error('Share failed:', e);
      }
    };

    // Delay so ⋯ menu modal has fully dismissed before system Share sheet opens
    setTimeout(() => { doShare(); }, 300);
  }, [event, eventId, createShareLinkMutation]);

  // FIXED: make saved event addresses tappable without changing stored data.
  const handleOpenLocation = useCallback(() => {
    const location = event?.location?.trim();
    if (!location) return;

    const encodedLocation = encodeURIComponent(location);
    const primaryUrl =
      Platform.OS === 'ios'
        ? `maps://?q=${encodedLocation}`
        : `geo:0,0?q=${encodedLocation}`;
    const fallbackUrl = `https://maps.google.com/?q=${encodedLocation}`;

    Linking.openURL(primaryUrl).catch(() => {
      Linking.openURL(fallbackUrl).catch(() => {
        Alert.alert('שגיאה', 'לא ניתן לפתוח את המיקום');
      });
    });
  }, [event?.location]);

  const overflowItems = useMemo<OverflowItem[]>(() => {
    const items: OverflowItem[] = [
      {
        label: 'עריכת אירוע',
        iconName: 'create-outline',
        onPress: () => {
          router.push({
            pathname: '/(authenticated)/event-edit/[id]',
            params: { id: eventId },
          });
        },
      },
      {
        label: 'שיתוף אירוע',
        iconName: 'share-outline',
        onPress: handleShare,
      },
    ];
    if (event?.status !== 'cancelled') {
      items.push({
        label: 'בטל אירוע',
        iconName: 'close-circle-outline',
        danger: true,
        onPress: () => setShowCancelDialog(true),
      });
    }
    return items;
  }, [handleShare, event?.status, eventId, router]);

  // ── Invalid route param (e.g. mock item ids like "1", "2")
  if (!eventId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
          <Text style={styles.notFoundText}>אירוע לא נמצא</Text>
          <TouchableOpacity
            style={styles.errorBackBtn}
            onPress={() => router.replace('/(authenticated)' as Parameters<typeof router.replace>[0])}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.errorBackBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading
  if (event === undefined) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Not found
  if (event === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
          <Text style={styles.notFoundText}>אירוע לא נמצא</Text>
          <TouchableOpacity
            style={styles.errorBackBtn}
            onPress={() =>
              router.replace(
                '/(authenticated)/communities' as Parameters<
                  typeof router.replace
                >[0]
              )
            }
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.errorBackBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Derived state (event is non-null from here)
  const isCreator =
    currentUserId !== undefined && event.createdBy === currentUserId;
  const myRsvp = rsvps?.find((r) => r.userId === currentUserId);
  const currentStatus: RsvpStatus = (myRsvp?.status as RsvpStatus) ?? 'none';
  const members = communityMembersData?.members ?? [];

  const assignedCount =
    eventTasks?.filter(
      (t) => !!t.assignedToUserId || !!t.assignedToManual?.trim()
    ).length ?? 0;

  const yesCount = rsvps?.filter((r) => r.status === 'yes').length ?? 0;
  const maybeCount = rsvps?.filter((r) => r.status === 'maybe').length ?? 0;
  const noCount = rsvps?.filter((r) => r.status === 'no').length ?? 0;
  const hasAnyRsvps = yesCount > 0 || maybeCount > 0 || noCount > 0;
  const participantNames = (event.participants ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const hasParticipants = participantNames.length > 0;
  const recurrenceLabel =
    event.isRecurring === true
      ? formatRecurrenceLabel(event.recurringPattern)
      : 'ללא';
  const reminderLabels = getReminderLabels(event);

  // Local variable to satisfy TypeScript in closures (event.onlineUrl may be undefined)
  const onlineUrl = event.onlineUrl;

  // ── Assignee sheet: derive current assignee from the task being managed
  const _assigneeSheetTask = assigneeSheetTaskId
    ? (eventTasks?.find((t) => t._id === assigneeSheetTaskId) ?? null)
    : null;
  const currentAssigneeForSheet: LocalAssignee | null =
    _assigneeSheetTask?.assignedToUserId
      ? {
          type: 'user',
          userId: _assigneeSheetTask.assignedToUserId,
          display:
            (_assigneeSheetTask as { assigneeDisplay?: string })
              .assigneeDisplay ?? '',
        }
      : _assigneeSheetTask?.assignedToManual?.trim()
        ? { type: 'manual', name: _assigneeSheetTask.assignedToManual.trim() }
        : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header (RTL): right=back, center=title, left=⋯ */}
      <View style={[styles.header, styles.headerRtl]}>
        {/* First child → right in RTL: back button */}
        <TouchableOpacity
          onPress={() => {
            if (event?.communityId) {
              router.replace({
                pathname: '/(authenticated)/community/[id]',
                params: { id: event.communityId },
              });
            } else {
              router.replace(
                '/(authenticated)/communities' as Parameters<
                  typeof router.replace
                >[0]
              );
            }
          }}
          style={styles.headerIconBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <Ionicons name="chevron-forward" size={22} color="#374151" />
        </TouchableOpacity>

        {/* Center: title */}
        <Text style={styles.headerTitle} numberOfLines={2}>
          {event.title}
        </Text>

        {/* Last child → left in RTL: ⋯ for creator */}
        <View ref={menuBtnRef} style={styles.headerIconBtn}>
          {isCreator && (
            <TouchableOpacity
              onPress={handleMenuPress}
              style={styles.headerIconBtn}
              accessible
              accessibilityRole="button"
              accessibilityLabel="אפשרויות"
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#374151" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Cancelled banner */}
        {event.status === 'cancelled' ? (
          <View style={styles.cancelledBanner}>
            <View style={styles.cancelledBannerRow}>
              <Ionicons name="close-circle" size={18} color="#dc2626" />
              <Text style={styles.cancelledBannerTitle}>אירוע זה בוטל</Text>
            </View>
            {event.cancelReason ? (
              <Text style={styles.cancelledBannerReason}>
                {`סיבת הביטול: ${event.cancelReason}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* ── Section 1: פרטי האירוע */}
        <View style={styles.card}>
          {/* Date */}
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={18} color={PRIMARY} />
            <Text style={styles.detailText}>
              {formatFullDate(event.startTime)}
            </Text>
          </View>

          {/* Time */}
          {event.allDay ? (
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={18} color={PRIMARY} />
              <Text style={styles.detailText}>כל היום</Text>
            </View>
          ) : (
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={18} color={PRIMARY} />
              <Text style={styles.detailText}>
                {`${formatTime(event.startTime)} — ${formatTime(event.endTime)}`}
              </Text>
            </View>
          )}

          {/* Location — address text */}
          {event.location ? (
            <TouchableOpacity
              style={styles.detailRow}
              onPress={handleOpenLocation}
              accessible
              accessibilityRole="link"
              accessibilityLabel="פתח מיקום במפות"
            >
              <Ionicons name="location-outline" size={18} color={PRIMARY} />
              <Text style={styles.linkText}>{event.location}</Text>
            </TouchableOpacity>
          ) : null}

          {/* Online URL — meeting/video link */}
          {onlineUrl ? (
            <View style={styles.detailRow}>
              <Ionicons name="videocam-outline" size={18} color={PRIMARY} />
              <TouchableOpacity
                onPress={() => {
                  Linking.openURL(onlineUrl).catch(() => {});
                }}
                accessible
                accessibilityRole="link"
                accessibilityLabel="הצטרפות לפגישה"
              >
                <Text style={styles.linkText}>הצטרפות לפגישה</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Description as notes/details */}
          {event.description ? (
            <>
              <View style={styles.separator} />
              <Text style={styles.descriptionLabel}>הערות</Text>
              <Text style={styles.descriptionText}>{event.description}</Text>
            </>
          ) : null}
        </View>

        {/* ── Scheduling */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>תזמון</Text>
          <View style={styles.scheduleRow}>
            <Ionicons name="repeat-outline" size={18} color={PRIMARY} />
            <Text style={styles.scheduleText}>
              {`אירוע חוזר: ${recurrenceLabel}`}
            </Text>
          </View>
          {reminderLabels.length > 0 ? (
            <View style={styles.reminderRows}>
              {reminderLabels.map((label) => (
                <View key={label} style={styles.reminderDisplayRow}>
                  <Ionicons
                    name="notifications-outline"
                    size={16}
                    color={PRIMARY}
                  />
                  <Text style={styles.reminderDisplayText}>{label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Attachments */}
        {event.attachments && event.attachments.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>קבצים מצורפים</Text>
            <View style={styles.attachmentsList}>
              {event.attachments.map((attachment) => {
                const sizeLabel = formatFileSize(attachment.sizeBytes);
                return (
                  <View
                    key={attachment.storageId}
                    style={styles.attachmentRow}
                  >
                    <Ionicons
                      name={
                        attachment.mimeType.startsWith('image/')
                          ? 'image-outline'
                          : 'document-outline'
                      }
                      size={20}
                      color={PRIMARY}
                    />
                    <View style={styles.attachmentContent}>
                      <Text style={styles.attachmentName} numberOfLines={1}>
                        {attachment.displayName || attachment.originalName}
                      </Text>
                      <Text style={styles.attachmentMeta} numberOfLines={1}>
                        {[attachment.mimeType, sizeLabel]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ── Section 2: RSVP / passive state */}
        {
          !isCreator && event.requiresRsvp === true ? (
            /* Case A: requiresRsvp + non-creator */
            <View
              style={[
                styles.card,
                event.status === 'cancelled' && styles.rsvpDisabled,
              ]}
            >
              <Text style={styles.rsvpTitle}>האם תשתתף?</Text>
              <View style={styles.rsvpRow}>
                {RSVP_OPTIONS.map((opt) => {
                  const isActive = currentStatus === opt.status;
                  const disabled = event.status === 'cancelled';
                  return (
                    <TouchableOpacity
                      key={opt.status}
                      style={[
                        styles.rsvpBtn,
                        {
                          backgroundColor: isActive
                            ? opt.activeColor
                            : '#f3f4f6',
                        },
                      ]}
                      onPress={
                        disabled ? undefined : () => handleRsvp(opt.status)
                      }
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={opt.label}
                      accessibilityState={{ selected: isActive, disabled }}
                    >
                      <Text
                        style={[
                          styles.rsvpBtnText,
                          isActive && styles.rsvpBtnTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : !isCreator ? (
            /* Case B: no requiresRsvp + non-creator */
            <View style={styles.card}>
              <View style={styles.passiveRow}>
                <Ionicons name="calendar-outline" size={18} color={PRIMARY} />
                <Text style={styles.passiveText}>
                  אירוע זה אינו דורש אישור הגעה
                </Text>
              </View>
              {/* TODO: add "הוסף ליומן" action when calendar integration is ready */}
            </View>
          ) : null /* Case C: creator — no RSVP section */
        }

        {/* ── Section 3: משימות לאירוע */}
        {eventTasks !== undefined && (
          <View style={styles.card}>
            {/* Header: title + assignment summary */}
            <View style={styles.taskSectionHeader}>
              {eventTasks.length > 0 ? (
                <Text
                  style={[
                    styles.taskSummary,
                    assignedCount === eventTasks.length
                      ? styles.taskSummaryAllDone
                      : null,
                  ]}
                >
                  {`${assignedCount}/${eventTasks.length} הוקצו`}
                </Text>
              ) : null}
              <Text style={styles.sectionTitle}>משימות לאירוע</Text>
            </View>

            {eventTasks.length === 0 ? (
              <View style={styles.emptyParticipants}>
                <Ionicons name="list-outline" size={32} color="#d1d5db" />
                <Text style={styles.emptyParticipantsText}>
                  לא נוספו משימות לאירוע הזה
                </Text>
              </View>
            ) : (
              <View style={styles.tasksList}>
                {eventTasks.map((task) => {
                  const assigneeDisplay = (
                    task as { assigneeDisplay?: string }
                  ).assigneeDisplay?.trim();
                  const isAssigned = !!assigneeDisplay;
                  return (
                    <View key={task._id} style={styles.taskRow}>
                      {/* Actions — left side in RTL (creator only) */}
                      {isCreator && (
                        <View style={styles.taskActions}>
                          <TouchableOpacity
                            onPress={() => {
                              setAssigneeSheetTaskId(task._id);
                              setManualAssigneeName('');
                            }}
                            style={styles.taskActionBtn}
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel={
                              isAssigned ? 'שנה הקצאה' : 'הקצה משימה'
                            }
                          >
                            <Ionicons
                              name={
                                isAssigned ? 'person' : 'person-add-outline'
                              }
                              size={18}
                              color={isAssigned ? PRIMARY : '#9ca3af'}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              Alert.alert('מחק משימה', 'האם למחוק את המשימה?', [
                                { text: 'ביטול', style: 'cancel' },
                                {
                                  text: 'מחק',
                                  style: 'destructive',
                                  onPress: () =>
                                    removeEventTask({
                                      id: task._id,
                                    }).catch(() =>
                                      Alert.alert(
                                        'שגיאה',
                                        'לא ניתן למחוק משימה'
                                      )
                                    ),
                                },
                              ]);
                            }}
                            style={styles.taskActionBtn}
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel="מחק משימה"
                          >
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color="#d1d5db"
                            />
                          </TouchableOpacity>
                        </View>
                      )}
                      {/* Content — right side in RTL */}
                      <View style={styles.taskContent}>
                        <Text style={styles.taskTitle} numberOfLines={2}>
                          {task.title}
                        </Text>
                        {isAssigned ? (
                          <Text
                            style={styles.taskAssignedLabel}
                            numberOfLines={1}
                          >
                            {`הוקצה ל־${assigneeDisplay}`}
                          </Text>
                        ) : (
                          <Text style={styles.taskUnassignedLabel}>
                            לא הוקצה
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── Section 4: משתתפים */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>משתתפים</Text>
          {hasAnyRsvps || hasParticipants ? (
            <>
              {hasAnyRsvps ? (
                <View style={styles.pillsRow}>
                  {yesCount > 0 && (
                    <View style={[styles.pill, styles.pillYes]}>
                      <Text
                        style={[styles.pillText, styles.pillYesText]}
                      >{`מגיעים (${yesCount})`}</Text>
                    </View>
                  )}
                  {maybeCount > 0 && (
                    <View style={[styles.pill, styles.pillMaybe]}>
                      <Text
                        style={[styles.pillText, styles.pillMaybeText]}
                      >{`אולי (${maybeCount})`}</Text>
                    </View>
                  )}
                  {noCount > 0 && (
                    <View style={[styles.pill, styles.pillNo]}>
                      <Text
                        style={[styles.pillText, styles.pillNoText]}
                      >{`לא מגיעים (${noCount})`}</Text>
                    </View>
                  )}
                </View>
              ) : null}

              {hasParticipants ? (
                <View style={styles.participantChips}>
                  {participantNames.map((name) => (
                    <View key={name} style={styles.participantChip}>
                      <Text style={styles.participantChipText}>{name}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.emptyParticipants}>
              <Ionicons name="people-outline" size={32} color="#d1d5db" />
              <Text style={styles.emptyParticipantsText}>
                עדיין אין תגובות לאירוע זה
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Creator overflow menu */}
      <OverflowMenu
        visible={menuOpen}
        position={menuPos}
        items={overflowItems}
        onClose={() => setMenuOpen(false)}
      />

      {/* ── Assignee sheet */}
      <TaskAssigneeSheet
        visible={!!assigneeSheetTaskId}
        currentAssignee={currentAssigneeForSheet}
        members={members}
        currentUserId={currentUserId}
        isCreator={isCreator}
        manualName={manualAssigneeName}
        onManualNameChange={setManualAssigneeName}
        onSelectUser={(userId: Id<'users'>) => {
          if (!assigneeSheetTaskId) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: { type: 'user', userId },
          }).catch(() => Alert.alert('שגיאה', 'לא ניתן להקצות משימה'));
          setAssigneeSheetTaskId(null);
        }}
        onSelectManual={() => {
          if (!assigneeSheetTaskId || !manualAssigneeName.trim()) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: { type: 'manual', name: manualAssigneeName.trim() },
          }).catch(() => Alert.alert('שגיאה', 'לא ניתן להקצות משימה'));
          setAssigneeSheetTaskId(null);
          setManualAssigneeName('');
        }}
        onUnassign={() => {
          if (!assigneeSheetTaskId) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: null,
          }).catch(() => Alert.alert('שגיאה', 'לא ניתן לבטל הקצאה'));
          setAssigneeSheetTaskId(null);
        }}
        onClose={() => {
          setAssigneeSheetTaskId(null);
          setManualAssigneeName('');
        }}
      />

      {/* ── Cancel dialog */}
      <Modal visible={showCancelDialog} transparent animationType="fade">
        <View style={styles.cancelDialogCenter}>
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.4)' },
            ]}
            onPress={() => {
              setShowCancelDialog(false);
              setCancelReason('');
            }}
          />
          <View style={styles.cancelDialogCard}>
            <Text style={styles.cancelDialogTitle}>בטל אירוע</Text>
            <Text style={styles.cancelDialogBody}>
              האם אתה בטוח שברצונך לבטל את האירוע? האירוע יוסר ממסך הקהילה
              ויופיע בלשונית
              {" 'אירועים' תחת 'אירועים שבוטלו' "}
              למשך 14 ימים.
            </Text>
            <TextInput
              style={styles.cancelDialogInput}
              placeholder="סיבת ביטול (אופציונלי)"
              placeholderTextColor="#9ca3af"
              value={cancelReason}
              onChangeText={setCancelReason}
              textAlign="right"
              multiline
              numberOfLines={2}
            />
            <View style={styles.cancelDialogButtons}>
              <TouchableOpacity
                style={styles.cancelDialogBtnBack}
                onPress={() => {
                  setShowCancelDialog(false);
                  setCancelReason('');
                }}
                accessible
                accessibilityRole="button"
                accessibilityLabel="חזור"
              >
                <Text style={styles.cancelDialogBtnBackText}>חזור</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelDialogBtnConfirm}
                onPress={handleCancelEvent}
                accessible
                accessibilityRole="button"
                accessibilityLabel="בטל אירוע"
              >
                <Text style={styles.cancelDialogBtnConfirmText}>בטל אירוע</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f8' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  // ── Header (RTL: first=right, last=left)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 8,
  },
  headerRtl: {
    flexDirection: 'row-reverse',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },

  // ── Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  // ── Detail rows
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'flex-end',
  },
  detailText: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
    flex: 1,
  },
  linkText: {
    fontSize: 14,
    color: PRIMARY,
    textAlign: 'right',
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  descriptionText: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
    lineHeight: 22,
  },
  descriptionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  scheduleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  scheduleText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
    fontWeight: '600',
  },
  reminderRows: {
    gap: 8,
  },
  reminderDisplayRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e8f5fd',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reminderDisplayText: {
    flex: 1,
    fontSize: 14,
    color: PRIMARY,
    textAlign: 'right',
    fontWeight: '600',
  },

  // ── Attachments
  attachmentsList: {
    gap: 8,
  },
  attachmentRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    padding: 12,
  },
  attachmentContent: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  attachmentName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  attachmentMeta: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
  },

  // ── RSVP
  rsvpTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  rsvpRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rsvpBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpBtnText: {
    fontSize: 15,
    color: '#6b7280',
    fontWeight: '600',
  },
  rsvpBtnTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  rsvpDisabled: { opacity: 0.4 },

  // ── Cancelled banner
  cancelledBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
    gap: 6,
  },
  cancelledBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-end',
  },
  cancelledBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#dc2626',
    textAlign: 'right',
  },
  cancelledBannerReason: {
    fontSize: 13,
    color: '#dc2626',
    textAlign: 'right',
  },

  // ── Cancel dialog
  cancelDialogCenter: {
    flex: 1,
    justifyContent: 'center',
  },
  cancelDialogCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 24,
  },
  cancelDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
    color: '#111827',
  },
  cancelDialogBody: {
    marginTop: 8,
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'right',
  },
  cancelDialogInput: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
  },
  cancelDialogButtons: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 8,
  },
  cancelDialogBtnBack: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDialogBtnBackText: {
    color: '#374151',
  },
  cancelDialogBtnConfirm: {
    flex: 1,
    backgroundColor: '#ef4444',
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDialogBtnConfirmText: {
    color: '#fff',
    fontWeight: '700',
  },

  // ── Passive state
  passiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'flex-end',
  },
  passiveText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'right',
    flex: 1,
  },

  // ── Participants
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillYes: { backgroundColor: '#dcfce7' },
  pillYesText: { color: '#16a34a' },
  pillMaybe: { backgroundColor: '#fef9c3' },
  pillMaybeText: { color: '#ca8a04' },
  pillNo: { backgroundColor: '#fee2e2' },
  pillNoText: { color: '#dc2626' },
  participantChips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantChip: {
    borderRadius: 999,
    backgroundColor: '#e8f5fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  participantChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
  },
  emptyParticipants: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  emptyParticipantsText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },

  // ── Tasks
  taskSectionHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskSummary: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '600',
  },
  taskSummaryAllDone: {
    color: '#16a34a',
  },
  tasksList: { gap: 0 },
  taskRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  taskContent: { flex: 1, gap: 3 },
  taskTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    textAlign: 'right',
  },
  taskAssignedLabel: {
    fontSize: 12,
    color: PRIMARY,
    fontWeight: '600',
    textAlign: 'right',
  },
  taskUnassignedLabel: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
  },
  taskActions: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
  },
  taskActionBtn: { padding: 4 },

  // ── Error states
  notFoundText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  errorBackBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 8,
  },
  errorBackBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },

  // ── Overflow popover
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
    width: 215,
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
  popoverBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  popoverLabel: { fontSize: 15, color: '#374151', textAlign: 'right', flex: 1 },
  popoverDanger: { color: '#ef4444' },
});
