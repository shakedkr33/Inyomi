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

// ─── RSVP Options (module-level to avoid recreating in render) ────────────────

const RSVP_OPTIONS = [
  { status: 'yes' as const, label: 'כן', activeColor: '#22c55e' },
  { status: 'maybe' as const, label: 'אולי', activeColor: '#eab308' },
  { status: 'no' as const, label: 'לא', activeColor: '#ef4444' },
];

// ─── Assignee Sheet ───────────────────────────────────────────────────────────

interface AssigneeSheetProps {
  visible: boolean;
  task: {
    _id: string;
    assigneeDisplay?: string;
    assignedToUserId?: string;
    assignedToManual?: string;
  } | null;
  members: Array<{ userId: Id<'users'>; fullName: string; email?: string }>;
  currentUserId?: Id<'users'>;
  isCreator: boolean;
  manualName: string;
  onManualNameChange: (v: string) => void;
  onSelectUser: (userId: Id<'users'>) => void;
  onSelectManual: () => void;
  onUnassign: () => void;
  onClose: () => void;
}

function AssigneeSheet({
  visible,
  task,
  members,
  currentUserId,
  isCreator,
  manualName,
  onManualNameChange,
  onSelectUser,
  onSelectManual,
  onUnassign,
  onClose,
}: AssigneeSheetProps) {
  if (!visible) return null;

  const hasAssignee = !!task?.assigneeDisplay?.trim();
  const hasManual = !!task?.assignedToManual?.trim();
  const hasUserId = !!task?.assignedToUserId;
  const isAssignedToCurrentUser =
    currentUserId && task?.assignedToUserId === currentUserId;
  const canUnassign =
    hasAssignee &&
    (hasManual ? isCreator : isCreator || isAssignedToCurrentUser);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.assigneeSheetContainer}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={onClose}
        />
        <View style={styles.assigneeSheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.assigneeSheetTitle}>הקצאת משימה</Text>

        {hasAssignee && canUnassign ? (
          <TouchableOpacity
            onPress={onUnassign}
            style={styles.unassignBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="בטל הקצאה"
          >
            <Ionicons name="person-remove-outline" size={18} color="#ef4444" />
            <Text style={styles.unassignBtnText}>בטל הקצאה</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.assigneeSectionLabel}>חברי קהילה</Text>
        <ScrollView
          style={styles.membersScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {members.map((m) => (
            <TouchableOpacity
              key={m.userId}
              onPress={() => onSelectUser(m.userId)}
              style={styles.memberRow}
              accessible
              accessibilityRole="button"
              accessibilityLabel={m.fullName}
            >
              <Ionicons name="person" size={20} color={PRIMARY} />
              <Text style={styles.memberRowName} numberOfLines={1}>
                {m.fullName}
                {currentUserId === m.userId ? ' (אני)' : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.assigneeSectionLabel, { marginTop: 16 }]}>
          הקלד שם
        </Text>
        <View style={styles.manualAssignRow}>
          <TouchableOpacity
            onPress={onSelectManual}
            style={[
              styles.manualAssignBtn,
              !manualName.trim() && styles.manualAssignBtnDisabled,
            ]}
            disabled={!manualName.trim()}
            accessible
            accessibilityRole="button"
            accessibilityLabel="הקצה לפי שם"
          >
            <Text style={styles.manualAssignBtnText}>הקצה</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.manualAssignInput}
            value={manualName}
            onChangeText={onManualNameChange}
            placeholder="שם..."
            placeholderTextColor="#9ca3af"
            textAlign="right"
            accessible
            accessibilityLabel="הקלד שם ממונה"
          />
        </View>
        </View>
      </View>
    </Modal>
  );
}

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

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const eventId = id as Id<'events'>;

  const event = useQuery(api.events.getById, { eventId });
  const rsvps = useQuery(api.eventRsvps.listByEvent, { eventId });
  const eventTasks = useQuery(api.eventTasks.listByEvent, { eventId });
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;

  const upsertRsvp = useMutation(api.eventRsvps.upsertRsvp);
  const cancelEventMutation = useMutation(api.events.cancelEvent);
  const toggleEventTask = useMutation(api.eventTasks.toggleCompleted);
  const updateEventTask = useMutation(api.eventTasks.update);
  const removeEventTask = useMutation(api.eventTasks.remove);
  const setTaskAssignee = useMutation(api.eventTasks.setAssignee);

  const communityMembersData = useQuery(
    api.communities.getCommunityMembers,
    event?.communityId ? { communityId: event.communityId } : 'skip'
  );

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
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
      upsertRsvp({ eventId, status }).catch(() =>
        Alert.alert('שגיאה', 'לא ניתן לשמור תגובה')
      );
    },
    [eventId, upsertRsvp]
  );

  const handleCancelEvent = useCallback(async () => {
    if (!event) return;
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

  const handleShare = useCallback(() => {
    if (!event) return;
    let message = event.title;
    message += `\n${formatFullDate(event.startTime)}`;
    if (!event.allDay) message += ` • ${formatTime(event.startTime)}`;
    if (event.location) message += `\n📍 ${event.location}`;
    // Delay so ⋯ menu modal has fully dismissed before system Share sheet opens
    setTimeout(async () => {
      try {
        await Share.share({ message });
      } catch (e) {
        console.error('Share failed:', e);
      }
    }, 300);
  }, [event]);

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

  const canManageTaskAssignment = useCallback(
    (task: { assignedToUserId?: string; assignedToManual?: string }) => {
      const communityId = event?.communityId;
      const membersList = communityMembersData?.members ?? [];
      const isCreatorLocal =
        currentUserId !== undefined && event?.createdBy === currentUserId;
      const isMember = membersList.some((m) => m.userId === currentUserId);
      if (!communityId || !isMember) return false;
      const hasManual = !!task.assignedToManual?.trim();
      if (hasManual) return isCreatorLocal;
      const assigned = !!task.assignedToUserId;
      if (!assigned) return true;
      return (
        isCreatorLocal ||
        (currentUserId && task.assignedToUserId === currentUserId)
      );
    },
    [event?.communityId, event?.createdBy, communityMembersData, currentUserId]
  );

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
  const isCommunityMember = members.some((m) => m.userId === currentUserId);

  const yesCount = rsvps?.filter((r) => r.status === 'yes').length ?? 0;
  const maybeCount = rsvps?.filter((r) => r.status === 'maybe').length ?? 0;
  const noCount = rsvps?.filter((r) => r.status === 'no').length ?? 0;
  const hasAnyRsvps = yesCount > 0 || maybeCount > 0 || noCount > 0;

  // Local variable to satisfy TypeScript in closures (event.onlineUrl may be undefined)
  const onlineUrl = event.onlineUrl;

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

          {/* Location */}
          {event.location ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={18} color={PRIMARY} />
              <Text style={styles.detailText}>{event.location}</Text>
            </View>
          ) : null}

          {/* Online URL */}
          {onlineUrl ? (
            <View style={styles.detailRow}>
              <Ionicons name="videocam-outline" size={18} color={PRIMARY} />
              <TouchableOpacity
                onPress={() => {
                  Linking.openURL(onlineUrl).catch(() => {});
                }}
                accessible
                accessibilityRole="link"
                accessibilityLabel="קישור לפגישה"
              >
                <Text style={styles.linkText}>קישור לפגישה</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Description */}
          {event.description ? (
            <>
              <View style={styles.separator} />
              <Text style={styles.descriptionText}>{event.description}</Text>
            </>
          ) : null}
        </View>

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

        {/* ── Section 3: משימות */}
        {eventTasks !== undefined && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>משימות</Text>
            {eventTasks.length === 0 ? (
              <View style={styles.emptyParticipants}>
                <Ionicons
                  name="checkmark-done-outline"
                  size={32}
                  color="#d1d5db"
                />
                <Text style={styles.emptyParticipantsText}>
                  אין משימות לאירוע זה
                </Text>
              </View>
            ) : (
              <View style={styles.tasksList}>
                {eventTasks.map((task) => {
                  const isEditing = editingTaskId === task._id;
                  const canAssign = canManageTaskAssignment(task);
                  const assigneeDisplay = (task as { assigneeDisplay?: string })
                    ?.assigneeDisplay;
                  return (
                    <View key={task._id} style={styles.taskRow}>
                      <Pressable
                        onPress={() =>
                          toggleEventTask({ id: task._id }).catch(() =>
                            Alert.alert('שגיאה', 'לא ניתן לעדכן משימה')
                          )
                        }
                        style={styles.taskCheckbox}
                        accessible
                        accessibilityRole="checkbox"
                        accessibilityLabel={task.title}
                        accessibilityState={{ checked: task.completed }}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            task.completed && styles.checkboxChecked,
                          ]}
                        >
                          {task.completed && (
                            <Ionicons
                              name="checkmark"
                              size={13}
                              color="#fff"
                            />
                          )}
                        </View>
                      </Pressable>
                      {isEditing ? (
                        <TextInput
                          style={[styles.input, styles.taskInput]}
                          value={editingTitle}
                          onChangeText={setEditingTitle}
                          onBlur={async () => {
                            const t = editingTitle.trim();
                            setEditingTaskId(null);
                            if (t && t !== task.title) {
                              try {
                                await updateEventTask({
                                  id: task._id,
                                  title: t,
                                });
                              } catch {
                                Alert.alert('שגיאה', 'לא ניתן לעדכן משימה');
                              }
                            }
                          }}
                          onSubmitEditing={async () => {
                            const t = editingTitle.trim();
                            setEditingTaskId(null);
                            if (t && t !== task.title) {
                              try {
                                await updateEventTask({
                                  id: task._id,
                                  title: t,
                                });
                              } catch {
                                Alert.alert('שגיאה', 'לא ניתן לעדכן משימה');
                              }
                            }
                          }}
                          autoFocus
                          accessible
                          accessibilityLabel="ערוך כותרת"
                        />
                      ) : (
                        <View style={styles.taskContent}>
                          <Pressable
                            style={styles.taskTitleWrap}
                            onPress={() => {
                              setEditingTaskId(task._id);
                              setEditingTitle(task.title);
                            }}
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel={`ערוך: ${task.title}`}
                          >
                            <Text
                              style={[
                                styles.taskTitle,
                                task.completed && styles.taskTitleDone,
                              ]}
                              numberOfLines={2}
                            >
                              {task.title}
                            </Text>
                          </Pressable>
                          {canAssign && !assigneeDisplay ? (
                            <TouchableOpacity
                              onPress={() => {
                                setAssigneeSheetTaskId(task._id);
                                setManualAssigneeName('');
                              }}
                              style={styles.assignBtn}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel="הקצה משימה"
                            >
                              <Ionicons
                                name="person-add-outline"
                                size={14}
                                color={PRIMARY}
                              />
                              <Text style={styles.assignBtnText}>
                                הקצה
                              </Text>
                            </TouchableOpacity>
                          ) : canAssign && assigneeDisplay ? (
                            <TouchableOpacity
                              onPress={() => {
                                setAssigneeSheetTaskId(task._id);
                                setManualAssigneeName('');
                              }}
                              style={styles.assigneeChip}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel={`הקצאה: ${assigneeDisplay}`}
                            >
                              <Text
                                style={styles.assigneeChipText}
                                numberOfLines={1}
                              >
                                {assigneeDisplay}
                              </Text>
                              <Ionicons
                                name="chevron-back"
                                size={12}
                                color="#6b7280"
                              />
                            </TouchableOpacity>
                          ) : assigneeDisplay ? (
                            <Text
                              style={styles.taskAssignee}
                              numberOfLines={1}
                            >
                              {assigneeDisplay}
                            </Text>
                          ) : null}
                        </View>
                      )}
                      {isCreator && !isEditing && (
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert(
                              'מחק משימה',
                              'האם למחוק את המשימה?',
                              [
                                { text: 'ביטול', style: 'cancel' },
                                {
                                  text: 'מחק',
                                  style: 'destructive',
                                  onPress: () =>
                                    removeEventTask({ id: task._id }).catch(
                                      () =>
                                        Alert.alert(
                                          'שגיאה',
                                          'לא ניתן למחוק משימה'
                                        )
                                    ),
                                },
                              ]
                            );
                          }}
                          style={styles.taskDeleteBtn}
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel="מחק משימה"
                        >
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color="#9ca3af"
                          />
                        </TouchableOpacity>
                      )}
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
          {hasAnyRsvps ? (
            <>
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
              {/* TODO: show participant names when a denormalized query is available */}
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
      <AssigneeSheet
        visible={!!assigneeSheetTaskId}
        task={
          assigneeSheetTaskId
            ? eventTasks?.find((t) => t._id === assigneeSheetTaskId) ?? null
            : null
        }
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
          }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן להקצות משימה')
          );
          setAssigneeSheetTaskId(null);
        }}
        onSelectManual={() => {
          if (!assigneeSheetTaskId || !manualAssigneeName.trim()) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: { type: 'manual', name: manualAssigneeName.trim() },
          }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן להקצות משימה')
          );
          setAssigneeSheetTaskId(null);
          setManualAssigneeName('');
        }}
        onUnassign={() => {
          if (!assigneeSheetTaskId) return;
          setTaskAssignee({
            id: assigneeSheetTaskId as Id<'eventTasks'>,
            assignee: null,
          }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן לבטל הקצאה')
          );
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
  tasksList: { gap: 10 },
  taskRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  taskCheckbox: { padding: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  taskContent: { flex: 1, gap: 4 },
  taskTitleWrap: {},
  taskTitle: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: '#9ca3af',
  },
  taskAssignee: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
  },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
  },
  assignBtnText: { fontSize: 12, color: PRIMARY, fontWeight: '600' },
  assigneeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
  },
  assigneeChipText: {
    fontSize: 12,
    color: '#6b7280',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#fafafa',
  },
  taskInput: { minHeight: 36 },
  taskDeleteBtn: { padding: 4 },

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

  // ── Assignee sheet
  assigneeSheetContainer: { flex: 1 },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  assigneeSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  assigneeSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 12,
  },
  unassignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 8,
  },
  unassignBtnText: { fontSize: 15, color: '#ef4444', fontWeight: '600' },
  assigneeSectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    textAlign: 'right',
  },
  membersScroll: { maxHeight: 200, marginTop: 8 },
  memberRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  memberRowName: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
    textAlign: 'right',
  },
  manualAssignRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  manualAssignInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  manualAssignBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  manualAssignBtnDisabled: { backgroundColor: '#9ca3af', opacity: 0.7 },
  manualAssignBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
