import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  I18nManager,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UpgradeModal } from '@/components/UpgradeModal';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import { getAvatarInitials } from '@/lib/avatarInitials';
import { SubtaskAttachmentPreview } from '@/lib/components/task/SubtasksSection';
import { displayedSubtaskAttachment } from '@/lib/subtaskAttachment';
import { TASK_CATEGORY_LABELS } from '@/lib/types/task';
import { getHebrewDateInfo } from '@/lib/utils/hebrewDate';

// ─── RTL helpers (same pattern as EventDetailsBottomSheet) ────────────────────

const _isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  Constants.appOwnership === 'expo';

const isAndroidExpoGo = Platform.OS === 'android' && _isExpoGo;
const shouldSupplyInvertedRtlValues = isAndroidExpoGo || I18nManager.isRTL;
const HEB_TEXT_ALIGN: 'left' | 'right' = shouldSupplyInvertedRtlValues
  ? 'left'
  : 'right';
const HEB_ROW: 'row' | 'row-reverse' = shouldSupplyInvertedRtlValues
  ? 'row'
  : 'row-reverse';

// ─── Constants ────────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.72;

// ─── Reminder helpers ─────────────────────────────────────────────────────────

const REMINDER_TYPE_LABELS: Record<string, string> = {
  morning: 'בבוקר',
  evening: 'בערב',
  at_time: 'בזמן',
  hour_before: 'שעה לפני',
  custom: 'מותאם אישית',
};

type ReminderEntry = { label?: string | null; type?: string | null };

function buildReminderLabel(
  reminders: ReminderEntry[] | null | undefined,
  reminderType: string | null | undefined
): string {
  if (reminders && reminders.length > 0) {
    const labels = reminders
      .map((r) => r.label?.trim() || REMINDER_TYPE_LABELS[r.type ?? ''] || '')
      .filter(Boolean);
    if (labels.length > 0) return labels.join('، ');
  }
  if (reminderType && reminderType in REMINDER_TYPE_LABELS) {
    return REMINDER_TYPE_LABELS[reminderType];
  }
  return 'ללא';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number, hasTime?: boolean): string {
  const d = new Date(ts);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  if (hasTime) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hh}:${mm}`;
  }
  return `${day}/${month}/${year}`;
}

function getCategoryLabel(category?: string | null): string | null {
  if (!category) return null;
  if (category in TASK_CATEGORY_LABELS) {
    return TASK_CATEGORY_LABELS[category as keyof typeof TASK_CATEGORY_LABELS];
  }
  // If it's already a Hebrew UI label (community/event), show as-is but filter noisy values
  if (category === 'קהילות' || category === 'אירועי יומן') return category;
  return null;
}

function tomorrowMs(
  currentDueDate?: number | null,
  hasTime?: boolean | null
): number {
  const now = new Date();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  );

  if (hasTime && currentDueDate) {
    const existing = new Date(currentDueDate);
    tomorrow.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
  } else {
    tomorrow.setHours(8, 0, 0, 0);
  }
  return tomorrow.getTime();
}

function canShowPostpone(task: {
  dueDate?: number | null;
  dueAt?: number | null;
  completed?: boolean;
  completedAt?: number | null;
}): boolean {
  const dueTs = task.dueAt ?? task.dueDate;
  if (!dueTs) return false;
  if (task.completed || task.completedAt) return false;

  const due = new Date(dueTs);
  const today = new Date();
  const dueStart = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate()
  ).getTime();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();

  return dueStart <= todayStart;
}

// ─── Avatar Circle ────────────────────────────────────────────────────────────

function AvatarCircle({
  name,
  color,
  size = 26,
}: {
  name: string;
  color: string | null;
  size?: number;
}): React.JSX.Element {
  const initial = getAvatarInitials(name);
  const bg = color ?? '#36a9e2';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '700' }}>
        {initial}
      </Text>
    </View>
  );
}

// ─── Detail Row ───────────────────────────────────────────────────────────────

function DetailRow({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={s.detailRow}>
      <MaterialIcons
        name={icon as never}
        size={18}
        color="#94a3b8"
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

// ─── Assignment Section ───────────────────────────────────────────────────────
// Shows:
//   • "נוצרה ע״י [name]"  — only when viewer is NOT the creator
//   • "משויך ל: [names]"  — when assignees exist
//   • "משימה אישית"       — when no assignees

function AssignmentSection({
  creatorProfile,
  currentUserIsCreator,
  assignees,
  currentUserId,
}: {
  creatorProfile: { id: string; name: string; color: string | null } | null;
  currentUserIsCreator: boolean;
  assignees: { id: string; name: string; color: string | null }[];
  currentUserId: string | null;
}): React.JSX.Element {
  const visibleAssignees = assignees.filter(
    (a) => a.id !== currentUserId && a.name.trim().length > 0
  );

  return (
    <>
      {/* "נוצרה ע״י" — shown only to non-creator viewers */}
      {!currentUserIsCreator && creatorProfile ? (
        <DetailRow icon="person-outline">
          <View style={[s.inlineRow, { flexDirection: HEB_ROW }]}>
            <AvatarCircle
              name={creatorProfile.name}
              color={creatorProfile.color}
            />
            <Text style={[s.detailText, { textAlign: HEB_TEXT_ALIGN }]}>
              {`נוצרה ע״י ${creatorProfile.name}`}
            </Text>
          </View>
        </DetailRow>
      ) : null}

      {/* "משויך ל" — shown only when there are visible (non-viewer) assignees */}
      {visibleAssignees.length > 0 ? (
        <DetailRow icon="people">
          <View
            style={[
              s.inlineRow,
              { flexDirection: HEB_ROW, flexWrap: 'wrap', gap: 6 },
            ]}
          >
            {visibleAssignees.map((a) => (
              <AvatarCircle key={a.id} name={a.name} color={a.color} />
            ))}
            <Text style={[s.detailText, { textAlign: HEB_TEXT_ALIGN }]}>
              {'משויך ל:'}
            </Text>
          </View>
        </DetailRow>
      ) : null}
    </>
  );
}

// ─── Attachment Thumbnail ─────────────────────────────────────────────────────
// Resolves a Convex storage ID to a URL and renders an image thumb or file chip.

type TaskAttachment = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  uploadedBy: Id<'users'>;
};

function AttachmentThumbnail({
  attachment,
  taskId,
  onImagePress,
}: {
  attachment: TaskAttachment;
  taskId: Id<'tasks'> | null;
  onImagePress: (url: string) => void;
}): React.JSX.Element | null {
  const url = useQuery(
    api.tasks.getTaskAttachmentUrl,
    taskId ? { taskId, storageId: attachment.storageId } : 'skip'
  );
  const isImage = attachment.mimeType.startsWith('image/');

  if (isImage) {
    if (url === undefined) {
      return (
        <View style={s.thumbPlaceholder}>
          <ActivityIndicator color="#36a9e2" size="small" />
        </View>
      );
    }
    if (!url) return null;
    return (
      <Pressable
        onPress={() => onImagePress(url)}
        style={s.thumbPressable}
        hitSlop={4}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`פתח תמונה: ${attachment.displayName}`}
      >
        <Image source={{ uri: url }} style={s.thumb} resizeMode="cover" />
      </Pressable>
    );
  }

  // Non-image file — show a compact chip with name
  return (
    <View
      style={s.fileChip}
      accessible
      accessibilityLabel={`קובץ: ${attachment.displayName}`}
    >
      <MaterialIcons name="insert-drive-file" size={16} color="#36a9e2" />
      <Text style={s.fileChipText} numberOfLines={1}>
        {attachment.displayName || attachment.originalName}
      </Text>
    </View>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TaskDetailsBottomSheetProps {
  taskId: string | null;
  visible: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskDetailsBottomSheet({
  taskId,
  visible,
  onClose,
}: TaskDetailsBottomSheetProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  // Animate in/out
  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 28,
        stiffness: 130,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const task = useQuery(
    api.tasks.getTaskDetails,
    taskId ? { id: taskId as Id<'tasks'> } : 'skip'
  );
  const toggleCompleted = useMutation(api.tasks.toggleCompleted);
  const updateTask = useMutation(api.tasks.update);
  const softDelete = useMutation(api.tasks.softDeleteTask);

  const [isToggling, setIsToggling] = useState(false);
  const [isPostponing, setIsPostponing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const { isExpiredFree } = useEffectiveAccess();
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);

  // Personal reminder for the current user.
  // Creators: reminder lives directly on the task doc (task.reminders / task.reminderType).
  // Participants: reminder lives in taskParticipantSettings — fetched via getMyTaskReminder.
  const isCreatorLoaded = task !== undefined && task !== null;
  const myTaskReminder = useQuery(
    api.tasks.getMyTaskReminder,
    taskId && isCreatorLoaded && !task.currentUserIsCreator
      ? { taskId: taskId as Id<'tasks'> }
      : 'skip'
  );

  const reminderLabel = useMemo(() => {
    if (!task) return null;
    if (task.currentUserIsCreator) {
      return buildReminderLabel(
        (task as { reminders?: ReminderEntry[] }).reminders,
        (task as { reminderType?: string }).reminderType
      );
    }
    return buildReminderLabel(
      myTaskReminder?.reminders as ReminderEntry[] | null | undefined,
      myTaskReminder?.reminderType
    );
  }, [task, myTaskReminder]);

  const handleToggle = useCallback(async () => {
    if (!task) return;
    setIsToggling(true);
    try {
      await toggleCompleted({ id: task._id });
    } finally {
      setIsToggling(false);
    }
  }, [task, toggleCompleted]);

  const handlePostpone = useCallback(async () => {
    if (!task) return;
    setIsPostponing(true);
    try {
      const newDue = tomorrowMs(task.dueDate ?? task.dueAt, task.hasTime);
      await updateTask({
        id: task._id,
        dueDate: newDue,
        ...(task.hasTime ? { hasTime: true, dueAt: newDue } : {}),
      });
    } finally {
      setIsPostponing(false);
    }
  }, [task, updateTask]);

  const handleDelete = useCallback(() => {
    if (!task || isDeleting) return;

    const isShared =
      task.assignees.some(
        (a) => a.kind === 'user' && a.id !== task.currentUserId
      ) || task.assignees.some((a) => a.kind === 'member');
    const title = isShared ? 'למחוק את המשימה המשותפת?' : 'למחוק את המשימה?';
    const message = isShared
      ? 'המשימה תוסר לכל המשתתפים. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.'
      : 'המשימה תוסר. אפשר לשחזר אותה מ״נמחקו לאחרונה״ בהגדרות.';

    Alert.alert(title, message, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          setIsDeleting(true);
          try {
            onClose();
            await softDelete({ id: task._id });
          } catch {
            Alert.alert('שגיאה', 'לא הצלחנו למחוק את המשימה. נסה שוב.');
          } finally {
            setIsDeleting(false);
          }
        },
      },
    ]);
  }, [task, isDeleting, softDelete, onClose]);

  const handleEdit = useCallback(() => {
    if (!taskId) return;
    onClose();
    router.push({
      pathname: '/(authenticated)/task/[id]',
      params: { id: taskId },
    } as never);
  }, [taskId, router, onClose]);

  if (!visible) return null;

  const isCommunityTask = Boolean(task?.communityId);
  const shouldGatePersonalFamilyActions = isExpiredFree && !isCommunityTask;

  const handleGatedAction = (action: () => void): void => {
    if (shouldGatePersonalFamilyActions) {
      setUpgradeModalVisible(true);
      return;
    }
    action();
  };

  const isEditable =
    task &&
    !task.communityId &&
    !task.sourceEventId &&
    task.sourceType !== 'community_event_important_item' &&
    task.category !== 'קהילות' &&
    task.category !== 'אירועי יומן';

  // Mirrors isPersonallyDeletableDisplayTask from tasks.tsx:
  // creator-only, not a community reminder (communityId with no sourceType).
  // Does NOT require zero assignees — owner can delete shared tasks (matches swipe delete).
  const isDeletable =
    !!task &&
    task.currentUserIsCreator === true &&
    !(task.communityId && !task.sourceType);

  const showPostpone = task ? canShowPostpone(task) : false;

  const dueTs = task?.dueAt ?? task?.dueDate;
  const categoryLabel = task ? getCategoryLabel(task.category) : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        {/* Backdrop */}
        <Pressable style={s.backdrop} onPress={onClose} />

        {/* Sheet */}
        <Animated.View
          style={[
            s.sheet,
            {
              height: SHEET_HEIGHT,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            {/* Handle */}
            <View style={s.handleRow}>
              <View style={s.handle} />
            </View>

            {task === undefined ? (
              <View
                style={{
                  height: 160,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIndicator color="#36a9e2" />
              </View>
            ) : task === null ? (
              <View
                style={{
                  height: 160,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#94a3b8', fontSize: 15 }}>
                  המשימה לא נמצאה
                </Text>
              </View>
            ) : (
              <>
                {/* ── Header: title + edit + close ── */}
                <View style={[s.header, { flexDirection: HEB_ROW }]}>
                  {/* Close (X) button — left side in RTL = physical right */}
                  <Pressable
                    onPress={onClose}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="סגור"
                    style={s.closeBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="close" size={22} color="#64748b" />
                  </Pressable>

                  <Text
                    style={[s.title, { textAlign: HEB_TEXT_ALIGN, flex: 1 }]}
                    numberOfLines={2}
                  >
                    {task.title}
                  </Text>

                  {isEditable ? (
                    <Pressable
                      onPress={() => handleGatedAction(handleEdit)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="עריכת משימה"
                      style={s.editBtn}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <MaterialIcons name="edit" size={16} color="#36a9e2" />
                      <Text style={s.editBtnLabel}>עריכה</Text>
                    </Pressable>
                  ) : null}
                </View>

                {/* Status badge */}
                <View
                  style={[
                    s.badgeRow,
                    { flexDirection: HEB_ROW, justifyContent: 'flex-start' },
                  ]}
                >
                  <View
                    style={[
                      s.badge,
                      {
                        backgroundColor: task.completed ? '#dcfce7' : '#fef3c7',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        s.badgeText,
                        { color: task.completed ? '#16a34a' : '#d97706' },
                      ]}
                    >
                      {task.completed ? 'בוצע ✓' : 'לביצוע'}
                    </Text>
                  </View>
                </View>

                {/* ── Action block — fixed position between badge and scroll ── */}
                <View style={s.actionBlock}>
                  {task.completed ? (
                    <Pressable
                      onPress={handleToggle}
                      disabled={isToggling}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="בטל סימון"
                      style={({ pressed }) => ({
                        opacity: pressed || isToggling ? 0.75 : 1,
                      })}
                    >
                      <View style={s.undoActionButton}>
                        {isToggling ? (
                          <ActivityIndicator size="small" color="#16a34a" />
                        ) : (
                          <Text style={s.undoActionText}>בטל סימון ✓</Text>
                        )}
                      </View>
                    </Pressable>
                  ) : (
                    <>
                      {/* Primary: סמן כבוצע */}
                      <Pressable
                        onPress={handleToggle}
                        disabled={isToggling || isPostponing}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel="סמן כבוצע"
                        style={({ pressed }) => ({
                          opacity: pressed || isToggling ? 0.75 : 1,
                        })}
                      >
                        <View style={s.primaryActionButton}>
                          {isToggling ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={s.primaryActionText}>סמן כבוצע</Text>
                          )}
                        </View>
                      </Pressable>

                      {/* Secondary row: דחה למחר + מחק */}
                      {showPostpone || isDeletable ? (
                        <View style={s.secondaryActionsRow}>
                          {showPostpone ? (
                            <Pressable
                              onPress={() => handleGatedAction(handlePostpone)}
                              disabled={isPostponing || isToggling}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel="דחה למחר"
                              style={({ pressed }) => ({
                                flex: 1,
                                opacity: pressed || isPostponing ? 0.75 : 1,
                              })}
                            >
                              <View style={s.secondaryPostponeButton}>
                                {isPostponing ? (
                                  <ActivityIndicator
                                    size="small"
                                    color="#0284c7"
                                  />
                                ) : (
                                  <Text style={s.secondaryPostponeText}>
                                    דחה למחר
                                  </Text>
                                )}
                              </View>
                            </Pressable>
                          ) : null}

                          {isDeletable ? (
                            <Pressable
                              onPress={handleDelete}
                              disabled={
                                isToggling || isPostponing || isDeleting
                              }
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel="מחק משימה"
                              style={({ pressed }) => ({
                                flex: 1,
                                opacity: pressed || isDeleting ? 0.75 : 1,
                              })}
                            >
                              <View style={s.deleteActionButton}>
                                {isDeleting ? (
                                  <ActivityIndicator
                                    size="small"
                                    color="#dc2626"
                                  />
                                ) : (
                                  <Text style={s.deleteActionText}>מחק</Text>
                                )}
                              </View>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </>
                  )}
                </View>

                {/* ── Scrollable content ── */}
                <ScrollView
                  style={s.detailsScroll}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16),
                  }}
                >
                  <View style={s.detailsCard}>
                    {/* Due date */}
                    {dueTs ? (
                      <DetailRow icon="event">
                        <Text
                          style={[s.detailText, { textAlign: HEB_TEXT_ALIGN }]}
                        >
                          {formatDate(dueTs, task.hasTime)}
                        </Text>
                        {(() => {
                          const hebrewDate =
                            getHebrewDateInfo(dueTs).fullHebrewDate;
                          return hebrewDate ? (
                            <Text
                              style={[
                                s.hebrewDateHint,
                                { textAlign: HEB_TEXT_ALIGN },
                              ]}
                            >
                              {hebrewDate}
                            </Text>
                          ) : null;
                        })()}
                      </DetailRow>
                    ) : null}

                    {/* Category (Hebrew only) */}
                    {categoryLabel ? (
                      <DetailRow icon="label-outline">
                        <Text
                          style={[s.detailText, { textAlign: HEB_TEXT_ALIGN }]}
                        >
                          {categoryLabel}
                        </Text>
                      </DetailRow>
                    ) : null}

                    {/* Creator + assignees */}
                    <AssignmentSection
                      creatorProfile={task.creatorProfile ?? null}
                      currentUserIsCreator={task.currentUserIsCreator}
                      assignees={task.assignees}
                      currentUserId={task.currentUserId ?? null}
                    />

                    {/* Notes */}
                    {task.description ? (
                      <DetailRow icon="notes">
                        <Text
                          style={[
                            s.detailText,
                            { textAlign: HEB_TEXT_ALIGN, lineHeight: 20 },
                          ]}
                        >
                          {task.description}
                        </Text>
                      </DetailRow>
                    ) : null}

                    {/* Personal reminder */}
                    {reminderLabel !== null ? (
                      <DetailRow icon="notifications-none">
                        <View
                          style={[
                            s.inlineRow,
                            {
                              flexDirection: HEB_ROW,
                              justifyContent: 'flex-end',
                            },
                          ]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                s.reminderRowLabel,
                                { textAlign: HEB_TEXT_ALIGN },
                              ]}
                            >
                              התזכורת שלך
                            </Text>
                            <Text
                              style={[
                                s.detailText,
                                { textAlign: HEB_TEXT_ALIGN },
                              ]}
                            >
                              {reminderLabel}
                            </Text>
                          </View>
                        </View>
                      </DetailRow>
                    ) : null}
                  </View>

                  {/* Subtasks — simple list, no toggleable circles */}
                  {task.subtasks && task.subtasks.length > 0 ? (
                    <View style={s.subtasksCard}>
                      <Text
                        style={[
                          s.subtasksHeader,
                          { textAlign: HEB_TEXT_ALIGN },
                        ]}
                      >
                        {`תתי־משימות (${task.subtasks.filter((sub) => sub.completed).length}/${task.subtasks.length})`}
                      </Text>
                      {task.subtasks.map((sub) => (
                        <View
                          key={sub.id}
                          style={[s.subtaskRow, { flexDirection: HEB_ROW }]}
                        >
                          <Text
                            style={[
                              s.subtaskBullet,
                              {
                                color: sub.completed ? '#22c55e' : '#cbd5e1',
                              },
                            ]}
                          >
                            {sub.completed ? '✓' : '–'}
                          </Text>
                          <Text
                            style={[
                              s.subtaskText,
                              {
                                textAlign: HEB_TEXT_ALIGN,
                                color: sub.completed ? '#94a3b8' : '#334155',
                                textDecorationLine: sub.completed
                                  ? 'line-through'
                                  : 'none',
                              },
                            ]}
                          >
                            {sub.title}
                          </Text>
                          <SubtaskAttachmentPreview
                            taskId={taskId as Id<'tasks'>}
                            attachment={displayedSubtaskAttachment(sub)}
                            onImageThumbnailPress={setSelectedImageUrl}
                          />
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {/* Attachments / Files & Images */}
                  {task.attachments && task.attachments.length > 0 ? (
                    <View style={s.attachmentsCard}>
                      <Text
                        style={[
                          s.subtasksHeader,
                          { textAlign: HEB_TEXT_ALIGN },
                        ]}
                      >
                        קבצים ותמונות
                      </Text>
                      <View style={s.attachmentsRow}>
                        {(task.attachments as TaskAttachment[]).map((att) => (
                          <AttachmentThumbnail
                            key={att.storageId as string}
                            attachment={att}
                            taskId={taskId as Id<'tasks'> | null}
                            onImagePress={(url) => setSelectedImageUrl(url)}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}
                </ScrollView>
              </>
            )}
          </View>
        </Animated.View>

        {/* Image lightbox — rendered inside the same Modal so it sits above the sheet */}
        {selectedImageUrl ? (
          <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={() => setSelectedImageUrl(null)}
          >
            <View style={s.lightboxOverlay}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setSelectedImageUrl(null)}
                accessible={false}
              />
              <Pressable
                style={s.lightboxCloseBtn}
                onPress={() => setSelectedImageUrl(null)}
                accessible
                accessibilityRole="button"
                accessibilityLabel="סגור תמונה"
                hitSlop={12}
              >
                <MaterialIcons name="close" size={24} color="#fff" />
              </Pressable>
              <Image
                source={{ uri: selectedImageUrl }}
                style={s.lightboxImage}
                resizeMode="contain"
                accessible
                accessibilityLabel="תמונה מצורפת"
              />
            </View>
          </Modal>
        ) : null}
        <UpgradeModal
          visible={upgradeModalVisible}
          reason="general"
          onClose={() => setUpgradeModalVisible(false)}
        />
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 8,
  },
  handleRow: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d1d5db',
  },

  closeBtn: {
    padding: 4,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 36,
    minHeight: 36,
  },

  header: {
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 10,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#111418',
    lineHeight: 26,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#f0f7ff',
    borderRadius: 10,
    minHeight: 36,
  },
  editBtnLabel: { fontSize: 14, fontWeight: '600', color: '#36a9e2' },

  badgeRow: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: { fontSize: 12, fontWeight: '600' },

  detailsScroll: { flex: 1, paddingHorizontal: 16 },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 2,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f4f8',
  },
  detailText: { fontSize: 14, color: '#475569' },
  hebrewDateHint: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  inlineRow: {
    alignItems: 'center',
    gap: 8,
  },

  subtasksCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  subtasksHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  subtaskRow: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
  },
  subtaskBullet: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 14,
    textAlign: 'center',
  },
  subtaskText: { flex: 1, fontSize: 14 },

  actionBlock: {
    width: '100%',
    paddingHorizontal: 32,
    marginTop: 12,
    marginBottom: 14,
  },
  secondaryActionsRow: {
    width: '100%',
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 10,
    alignItems: 'center',
  },

  primaryActionButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },

  undoActionButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: '#f0fdf4',
    borderWidth: 1.5,
    borderColor: '#bbf7d0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  undoActionText: {
    color: '#16a34a',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },

  secondaryPostponeButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#eff8fd',
    borderWidth: 1,
    borderColor: '#bae6fd',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryPostponeText: {
    color: '#0284c7',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },

  deleteActionButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  deleteActionText: {
    color: '#dc2626',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },

  reminderRowLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },

  // ── Attachments ──────────────────────────────────────────────────────────────
  attachmentsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  attachmentsRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  thumbPressable: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
  },
  thumbPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#e8f5fd',
    borderRadius: 10,
    maxWidth: 160,
  },
  fileChipText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
  },

  // ── Image lightbox ───────────────────────────────────────────────────────────
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCloseBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  lightboxImage: {
    width: '90%',
    height: '75%',
    borderRadius: 12,
  },
});
