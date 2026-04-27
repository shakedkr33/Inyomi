import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const { height: screenHeight } = Dimensions.get('window');
const SHEET_HEIGHT = screenHeight * 0.9;

export interface EventItem {
  id: string;
  time: string;
  endTime?: string;
  title: string;
  location?: string;
  type: 'event' | 'task';
  iconColor: string;
  completed: boolean;
  allDay?: boolean;
  pending?: boolean;
  groupName?: string;
  description?: string;
  isRecurring?: boolean;
  recurringPattern?: string;
  reminders?: number[];
  canEdit?: boolean;
}

interface EventDetailsBottomSheetProps {
  event?: EventItem | null;
  eventId?: string | null;
  visible: boolean;
  onClose: () => void;
  onNavigate: (location: string) => void;
}

type Attachment = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

const googleMapsIcon = require('@/assets/images/navigation/google-maps.png');
const wazeIcon = require('@/assets/images/navigation/waze.png');

export function EventDetailsBottomSheet({
  event,
  eventId,
  visible,
  onClose,
  onNavigate: _onNavigate,
}: EventDetailsBottomSheetProps): React.JSX.Element | null {
  const router = useRouter();
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [navPickerOpen, setNavPickerOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 5 && Math.abs(gesture.dx) < Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => {
        sheetTranslateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_, gesture) => {
        if (isClosingRef.current) return;

        const shouldClose = gesture.dy > 80 || gesture.vy > 1.1;

        if (shouldClose) {
          isClosingRef.current = true;
          Animated.timing(sheetTranslateY, {
            toValue: SHEET_HEIGHT,
            duration: 160,
            useNativeDriver: true,
          }).start(() => {
            sheetTranslateY.setValue(0);
            onClose();
          });
          return;
        }

        Animated.spring(sheetTranslateY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
    }
  }, [visible]);

  const handleRequestClose = (): void => {
    if (isClosingRef.current) return;
    onClose();
  };
  const convexEventId =
    eventId && isValidConvexId(eventId) ? (eventId as Id<'events'>) : null;

  const cancelEventMutation = useMutation(api.events.cancelEvent);
  const createShareLinkMutation = useMutation(api.shareLinks.createShareLink);
  const eventDoc = useQuery(
    api.events.getById,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const eventTasks = useQuery(
    api.eventTasks.listByEvent,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const rsvps = useQuery(
    api.eventRsvps.listByEvent,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;

  const displayEvent =
    eventDoc && eventDoc !== null
      ? {
          id: eventDoc._id,
          title: eventDoc.title,
          timeLabel: formatDateTimeLabel(
            eventDoc.startTime,
            eventDoc.endTime,
            eventDoc.allDay
          ),
          groupName: event?.groupName,
          location: eventDoc.location,
          description: eventDoc.description,
          isRecurring: eventDoc.isRecurring,
          recurringPattern: eventDoc.recurringPattern,
          reminders: (eventDoc as { reminders?: number[] }).reminders,
          attachments: (eventDoc.attachments ?? []) as Attachment[],
          participants: eventDoc.participants ?? [],
          requiresRsvp: eventDoc.requiresRsvp,
          startTime: eventDoc.startTime,
          allDay: eventDoc.allDay,
          communityId: eventDoc.communityId,
          createdBy: eventDoc.createdBy,
          status: eventDoc.status,
          cancelReason: eventDoc.cancelReason,
        }
      : event
        ? {
            id: event.id,
            title: event.title,
            timeLabel: event.allDay
              ? 'כל היום'
              : event.endTime
                ? `${event.time}-${event.endTime}`
                : event.time,
            groupName: event.groupName,
            location: event.location,
            description: event.description,
            isRecurring: event.isRecurring,
            recurringPattern: event.recurringPattern,
            reminders: event.reminders,
            attachments: [] as Attachment[],
            participants: [],
            requiresRsvp: false,
            startTime: undefined,
            allDay: event.allDay,
            communityId: undefined,
            createdBy: undefined,
            status: undefined,
            cancelReason: undefined,
          }
        : null;

  const handleEdit = (): void => {
    if (!displayEvent) return;
    onClose();
    router.push({
      pathname: '/(authenticated)/event-edit/[id]',
      params: { id: displayEvent.id },
    });
  };

  const handleShare = (): void => {
    if (!displayEvent) return;
    const doShare = async (): Promise<void> => {
      const lines = [displayEvent.title];
      if (displayEvent.startTime) {
        let dateLine = new Date(displayEvent.startTime).toLocaleDateString(
          'he-IL',
          { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        );
        if (!displayEvent.allDay) {
          dateLine += ` · ${formatTime(displayEvent.startTime)}`;
        }
        lines.push(dateLine);
      } else if (displayEvent.timeLabel) {
        lines.push(displayEvent.timeLabel);
      }
      if (displayEvent.location) lines.push(`מיקום: ${displayEvent.location}`);
      const shareText = lines.join('\n');

      if (!displayEvent.communityId && convexEventId) {
        try {
          const { token } = await createShareLinkMutation({
            eventId: convexEventId,
          });
          await Share.share({
            message: `${shareText}\n\nhttps://inyomi.com/shared/${token}`,
          });
          return;
        } catch {
          // Fallback to text-only share below.
        }
      }

      await Share.share({ message: shareText });
    };

    doShare().catch(() => Alert.alert('שגיאה', 'לא ניתן לשתף כרגע'));
  };

  const handleCancel = (): void => {
    if (!convexEventId) return;
    Alert.alert('ביטול אירוע', 'האם לבטל את האירוע?', [
      { text: 'חזור', style: 'cancel' },
      {
        text: 'בטל אירוע',
        style: 'destructive',
        onPress: () => {
          cancelEventMutation({ eventId: convexEventId }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן לבטל את האירוע')
          );
        },
      },
    ]);
  };

  const handleNavigate = (): void => {
    const location = displayEvent?.location?.trim();
    if (!location) return;
    setNavPickerOpen(true);
  };

  const openNavigationUrl = (app: 'google' | 'waze'): void => {
    const location = displayEvent?.location?.trim();
    if (!location) return;
    const encoded = encodeURIComponent(location);
    const url =
      app === 'google'
        ? `https://www.google.com/maps/search/?api=1&query=${encoded}`
        : `https://waze.com/ul?q=${encoded}&navigate=yes`;
    setNavPickerOpen(false);
    Linking.openURL(url).catch(() =>
      Alert.alert('שגיאה', 'לא ניתן לפתוח ניווט כרגע')
    );
  };

  if (!visible || (!displayEvent && !convexEventId)) return null;

  const isLoading = convexEventId && eventDoc === undefined;
  const isNotFound = convexEventId && eventDoc === null;
  const hasLocation = Boolean(displayEvent?.location?.trim());
  const recurrenceLabel =
    displayEvent?.isRecurring === true
      ? formatRecurrenceLabel(displayEvent.recurringPattern)
      : 'ללא';
  const reminderLabels = (displayEvent?.reminders ?? [])
    .filter((r): r is number => typeof r === 'number')
    .map(formatReminderLabel);
  const tasks = eventTasks ?? [];
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 2);
  const rsvpRows = rsvps ?? [];
  const yesCount = rsvpRows.filter((r) => r.status === 'yes').length;
  const maybeCount = rsvpRows.filter((r) => r.status === 'maybe').length;
  const noCount = rsvpRows.filter((r) => r.status === 'no').length;
  const shouldShowParticipants =
    Boolean(displayEvent?.requiresRsvp) ||
    rsvpRows.length > 0 ||
    (displayEvent?.participants?.length ?? 0) > 0;
  const canEdit = Boolean(convexEventId || event?.canEdit !== false);
  const canCancel = Boolean(
    convexEventId &&
      displayEvent?.createdBy &&
      currentUserId &&
      displayEvent.createdBy === currentUserId &&
      displayEvent.status !== 'cancelled'
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleRequestClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={handleRequestClose} style={styles.backdrop} />

      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}
      >
        <View
          collapsable={false}
          style={styles.handleTouch}
          {...handlePanResponder.panHandlers}
        >
          <View style={styles.handle} />
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color="#36a9e2" size="large" />
          </View>
        ) : isNotFound || !displayEvent ? (
          <View style={styles.loadingState}>
            <MaterialIcons color="#d1d5db" name="error-outline" size={36} />
            <Text style={styles.emptyText}>אירוע לא נמצא</Text>
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              style={styles.scrollArea}
            >
              {displayEvent.status === 'cancelled' ? (
                <View style={styles.cancelledBadge}>
                  <Text style={styles.cancelledBadgeText}>אירוע בוטל</Text>
                  {displayEvent.cancelReason ? (
                    <Text style={styles.cancelReason}>
                      {displayEvent.cancelReason}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.heroCard}>
                <Text style={styles.sheetTitle}>{displayEvent.title}</Text>
                {displayEvent.groupName ? (
                  <Text style={styles.groupLabel}>
                    {displayEvent.groupName}
                  </Text>
                ) : null}
                <View style={styles.infoRow}>
                  <MaterialIcons color="#94a3b8" name="schedule" size={17} />
                  <Text style={styles.timeText}>{displayEvent.timeLabel}</Text>
                </View>

                {hasLocation ? (
                  <View style={styles.locationRow}>
                    <View style={styles.locationTextWrap}>
                      <MaterialIcons
                        color="#94a3b8"
                        name="location-on"
                        size={17}
                      />
                      <Text numberOfLines={1} style={styles.locationText}>
                        {displayEvent.location}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`נווט אל ${displayEvent.location}`}
                      accessibilityRole="button"
                      accessible={true}
                      onPress={handleNavigate}
                      style={styles.navigateBtn}
                    >
                      <MaterialIcons color="#fff" name="near-me" size={14} />
                      <Text style={styles.navigateBtnText}>נווט</Text>
                    </Pressable>
                  </View>
                ) : null}

                <View style={styles.quickActionsRow}>
                  <QuickAction
                    color="#36a9e2"
                    disabled={!canEdit}
                    icon="edit"
                    label="עריכה"
                    onPress={handleEdit}
                  />
                  <QuickAction
                    color="#2563eb"
                    disabled={false}
                    icon="share"
                    label="שיתוף"
                    onPress={handleShare}
                  />
                  <QuickAction
                    color="#dc2626"
                    disabled={!canCancel}
                    icon="event-busy"
                    label="ביטול"
                    onPress={handleCancel}
                  />
                </View>

                {displayEvent.description ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesLabel}>הערות</Text>
                    <Text style={styles.notesText}>
                      {displayEvent.description}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>תזמון</Text>
                <View style={styles.scheduleRow}>
                  <MaterialIcons color="#36a9e2" name="repeat" size={18} />
                  <Text style={styles.scheduleText}>
                    {`אירוע חוזר: ${recurrenceLabel}`}
                  </Text>
                </View>
                {reminderLabels.length > 0 ? (
                  <View style={styles.reminderRows}>
                    {reminderLabels.map((label) => (
                      <View key={label} style={styles.reminderDisplayRow}>
                        <MaterialIcons
                          color="#36a9e2"
                          name="notifications-none"
                          size={16}
                        />
                        <Text style={styles.reminderDisplayText}>{label}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              {convexEventId ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>משימות לאירוע</Text>
                  {eventTasks === undefined ? (
                    <Text style={styles.mutedText}>טוען משימות...</Text>
                  ) : tasks.length > 0 ? (
                    <View style={styles.compactList}>
                      {visibleTasks.map((task) => {
                        const assigneeDisplay = (
                          task as { assigneeDisplay?: string }
                        ).assigneeDisplay?.trim();
                        return (
                          <View key={task._id} style={styles.detailListRow}>
                            <MaterialIcons
                              color="#36a9e2"
                              name="checklist"
                              size={16}
                            />
                            <View style={styles.detailListContent}>
                              <Text style={styles.detailListTitle}>
                                {task.title}
                              </Text>
                              <Text style={styles.mutedText}>
                                {assigneeDisplay
                                  ? `הוקצה ל-${assigneeDisplay}`
                                  : 'לא הוקצה'}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                      {tasks.length > 2 ? (
                        <Pressable
                          accessibilityLabel={
                            showAllTasks ? 'הצג פחות משימות' : 'הצג עוד משימות'
                          }
                          accessibilityRole="button"
                          accessible={true}
                          onPress={() => setShowAllTasks((value) => !value)}
                          style={styles.showMoreBtn}
                        >
                          <Text style={styles.showMoreText}>
                            {showAllTasks
                              ? 'הצג פחות משימות'
                              : 'הצג עוד משימות'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : (
                    <Text style={styles.mutedText}>
                      לא נוספו משימות לאירוע הזה
                    </Text>
                  )}
                </View>
              ) : null}

              {shouldShowParticipants ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>משתתפים</Text>
                  {displayEvent.requiresRsvp ? (
                    <View style={styles.rsvpSummaryRow}>
                      <View style={[styles.rsvpChip, styles.rsvpYes]}>
                        <Text style={styles.rsvpChipText}>
                          {`כן ${yesCount}`}
                        </Text>
                      </View>
                      <View style={[styles.rsvpChip, styles.rsvpMaybe]}>
                        <Text style={styles.rsvpChipText}>
                          {`אולי ${maybeCount}`}
                        </Text>
                      </View>
                      <View style={[styles.rsvpChip, styles.rsvpNo]}>
                        <Text
                          style={styles.rsvpChipText}
                        >{`לא ${noCount}`}</Text>
                      </View>
                    </View>
                  ) : null}
                  {displayEvent.participants.length > 0 ? (
                    <View style={styles.participantsWrap}>
                      {displayEvent.participants.map((name) => (
                        <View key={name} style={styles.participantPill}>
                          <Text style={styles.participantPillText}>{name}</Text>
                        </View>
                      ))}
                    </View>
                  ) : rsvpRows.length === 0 ? (
                    <Text style={styles.mutedText}>אין משתתפים להצגה</Text>
                  ) : null}
                </View>
              ) : null}

              {displayEvent.attachments.length > 0 ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>קבצים מצורפים</Text>
                  <View style={styles.compactList}>
                    {displayEvent.attachments.map((attachment) => (
                      <AttachmentRow
                        attachment={attachment}
                        key={String(attachment.storageId)}
                        onPreviewImage={setPreviewImageUrl}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.bottomButtons}>
              <Pressable
                accessibilityLabel="סגירה"
                accessibilityRole="button"
                accessible={true}
                onPress={handleRequestClose}
                style={styles.closeBtn}
              >
                <Text style={styles.closeBtnText}>סגירה</Text>
              </Pressable>
            </View>
          </>
        )}

        <SafeAreaView edges={['bottom']} />
      </Animated.View>

      <Modal
        animationType="fade"
        onRequestClose={() => setNavPickerOpen(false)}
        transparent
        visible={navPickerOpen}
      >
        <Pressable
          onPress={() => setNavPickerOpen(false)}
          style={styles.navPickerBackdrop}
        />
        <View style={styles.navPickerSheet}>
          <Text style={styles.navPickerTitle}>פתיחה בניווט</Text>
          <Pressable
            accessibilityLabel="פתח ב-Google Maps"
            accessibilityRole="button"
            accessible={true}
            onPress={() => openNavigationUrl('google')}
            style={styles.navOption}
          >
            <Image
              resizeMode="contain"
              source={googleMapsIcon}
              style={styles.navAppIcon}
            />
            <Text style={styles.navOptionText}>Google Maps</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="פתח ב-Waze"
            accessibilityRole="button"
            accessible={true}
            onPress={() => openNavigationUrl('waze')}
            style={styles.navOption}
          >
            <Image
              resizeMode="contain"
              source={wazeIcon}
              style={styles.navAppIcon}
            />
            <Text style={styles.navOptionText}>Waze</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="ביטול"
            accessibilityRole="button"
            accessible={true}
            onPress={() => setNavPickerOpen(false)}
            style={styles.navCancel}
          >
            <Text style={styles.navCancelText}>ביטול</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setPreviewImageUrl(null)}
        transparent
        visible={previewImageUrl !== null}
      >
        <View style={styles.previewBackdrop}>
          <Pressable
            accessibilityLabel="סגור תצוגת תמונה"
            accessibilityRole="button"
            accessible={true}
            onPress={() => setPreviewImageUrl(null)}
            style={styles.previewCloseIcon}
          >
            <MaterialIcons color="#fff" name="close" size={24} />
          </Pressable>
          {previewImageUrl ? (
            <Image
              resizeMode="contain"
              source={{ uri: previewImageUrl }}
              style={styles.previewImage}
            />
          ) : null}
          <Pressable
            accessibilityLabel="סגירת תצוגה מקדימה"
            accessibilityRole="button"
            accessible={true}
            onPress={() => setPreviewImageUrl(null)}
            style={styles.previewCloseBtn}
          >
            <Text style={styles.previewCloseText}>סגירה</Text>
          </Pressable>
        </View>
      </Modal>
    </Modal>
  );
}

function QuickAction({
  color,
  disabled,
  icon,
  label,
  onPress,
}: {
  color: string;
  disabled: boolean;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessible={true}
      onPress={disabled ? undefined : onPress}
      style={styles.quickAction}
    >
      <View
        style={[
          styles.quickActionIcon,
          { backgroundColor: `${color}18` },
          disabled && styles.quickActionDisabled,
        ]}
      >
        <MaterialIcons
          color={disabled ? '#cbd5e1' : color}
          name={icon}
          size={20}
        />
      </View>
      <Text style={[styles.quickActionLabel, disabled && styles.disabledText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AttachmentRow({
  attachment,
  onPreviewImage,
}: {
  attachment: Attachment;
  onPreviewImage: (url: string) => void;
}): React.JSX.Element {
  const fileUrl = useQuery(api.events.getAttachmentUrl, {
    storageId: attachment.storageId,
  });
  const isImage = attachment.mimeType.startsWith('image/');

  const previewFile = (): void => {
    if (!fileUrl) {
      Alert.alert('קובץ מצורף', 'הקובץ עדיין לא זמין לפתיחה');
      return;
    }
    if (isImage) {
      onPreviewImage(fileUrl);
      return;
    }
    Alert.alert('קובץ מצורף', 'לא ניתן להציג את הקובץ באפליקציה');
  };

  const downloadFile = (): void => {
    if (!fileUrl) {
      Alert.alert('קובץ מצורף', 'הקובץ עדיין לא זמין להורדה');
      return;
    }
    Linking.openURL(fileUrl).catch(() =>
      Alert.alert('שגיאה', 'לא ניתן לפתוח את הקובץ')
    );
  };

  return (
    <View style={styles.attachmentCard}>
      {isImage && fileUrl ? (
        <Image
          accessibilityLabel={attachment.displayName || attachment.originalName}
          resizeMode="cover"
          source={{ uri: fileUrl }}
          style={styles.attachmentThumb}
        />
      ) : (
        <View style={styles.attachmentIconBox}>
          <MaterialIcons
            color="#36a9e2"
            name={isImage ? 'image' : 'insert-drive-file'}
            size={18}
          />
        </View>
      )}
      <View style={styles.detailListContent}>
        <Text numberOfLines={1} style={styles.detailListTitle}>
          {attachment.displayName || attachment.originalName}
        </Text>
        <Text style={styles.mutedText}>
          {[attachment.mimeType, formatFileSize(attachment.sizeBytes)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={styles.attachmentActions}>
          <Pressable
            accessibilityLabel="צפייה בקובץ"
            accessibilityRole="button"
            accessible={true}
            onPress={previewFile}
            style={styles.smallActionBtn}
          >
            <Text style={styles.smallActionText}>צפייה</Text>
          </Pressable>
          {fileUrl ? (
            <Pressable
              accessibilityLabel="הורדת קובץ"
              accessibilityRole="button"
              accessible={true}
              onPress={downloadFile}
              style={styles.smallActionBtn}
            >
              <Text style={styles.smallActionText}>הורדה</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    maxHeight: screenHeight * 0.95,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    alignSelf: 'center',
  },
  handleTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    marginTop: 10,
    marginBottom: 6,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    color: '#94a3b8',
    fontWeight: '600',
    textAlign: 'center',
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 18,
  },
  scrollContent: {
    paddingBottom: 14,
    gap: 8,
  },
  cancelledBadge: {
    alignSelf: 'stretch',
    backgroundColor: '#fee2e2',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  cancelledBadgeText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991b1b',
    textAlign: 'right',
  },
  cancelReason: {
    fontSize: 13,
    color: '#7f1d1d',
    textAlign: 'right',
  },
  heroCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    padding: 14,
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  sheetTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#111517',
    textAlign: 'right',
  },
  groupLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
    textAlign: 'right',
    marginTop: -3,
  },
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  timeText: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    textAlign: 'right',
    fontWeight: '800',
  },
  infoText: {
    fontSize: 15,
    color: '#374151',
    textAlign: 'right',
    flex: 1,
  },
  locationRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  locationTextWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  locationText: {
    flex: 1,
    fontSize: 14,
    color: '#334155',
    textAlign: 'right',
    fontWeight: '600',
  },
  navigateBtn: {
    backgroundColor: '#36a9e2',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
  },
  navigateBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  quickActionsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 2,
  },
  quickAction: {
    alignItems: 'center',
    gap: 4,
    minWidth: 66,
    minHeight: 58,
    justifyContent: 'center',
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionDisabled: {
    backgroundColor: '#f1f5f9',
  },
  quickActionLabel: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '700',
  },
  disabledText: {
    color: '#cbd5e1',
  },
  notesBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
    gap: 2,
  },
  notesLabel: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'right',
    fontWeight: '800',
  },
  notesText: {
    fontSize: 14,
    color: '#334155',
    textAlign: 'right',
    lineHeight: 20,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#f1f5f9',
    padding: 12,
    gap: 8,
  },
  scheduleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  scheduleText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    textAlign: 'right',
    fontWeight: '600',
  },
  reminderRows: {
    gap: 6,
  },
  reminderDisplayRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  reminderDisplayText: {
    flex: 1,
    fontSize: 14,
    color: '#334155',
    textAlign: 'right',
    fontWeight: '800',
  },
  compactList: {
    gap: 8,
  },
  detailListRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  detailListContent: {
    flex: 1,
    gap: 2,
  },
  detailListTitle: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    textAlign: 'right',
  },
  mutedText: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'right',
  },
  showMoreBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 32,
  },
  showMoreText: {
    color: '#36a9e2',
    fontWeight: '700',
    fontSize: 13,
  },
  rsvpSummaryRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  rsvpChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rsvpYes: {
    backgroundColor: '#dcfce7',
  },
  rsvpMaybe: {
    backgroundColor: '#fef3c7',
  },
  rsvpNo: {
    backgroundColor: '#fee2e2',
  },
  rsvpChipText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '700',
  },
  participantsWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantPill: {
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  participantPillText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  attachmentCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 8,
  },
  attachmentThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  attachmentIconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  smallActionBtn: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionText: {
    color: '#36a9e2',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomButtons: {
    paddingHorizontal: 24,
    paddingBottom: 18,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  closeBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 18,
    minHeight: 36,
  },
  closeBtnText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '800',
  },
  navPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.28)',
  },
  navPickerSheet: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 26,
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 14,
    gap: 8,
  },
  navPickerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 2,
  },
  navOption: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  navAppIcon: {
    width: 28,
    height: 28,
  },
  navOptionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'right',
  },
  navCancel: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  navCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748b',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  previewImage: {
    width: '100%',
    height: '72%',
  },
  previewCloseIcon: {
    position: 'absolute',
    top: 56,
    left: 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCloseBtn: {
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  previewCloseText: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '800',
  },
});

function isValidConvexId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length >= 8;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTimeLabel(
  startTime: number,
  endTime: number,
  allDay?: boolean
): string {
  const dateLabel = new Date(startTime).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  if (allDay) return `${dateLabel}, כל היום`;
  return `${dateLabel}, ${formatTime(startTime)}-${formatTime(endTime)}`;
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
  if (offsetMinutes === 1440) return 'תזכורת: 24 שעות לפני האירוע';
  if (offsetMinutes % 1440 === 0) {
    return `תזכורת: ${offsetMinutes / 1440} ימים לפני האירוע`;
  }
  if (offsetMinutes % 60 === 0) {
    return `תזכורת: ${offsetMinutes / 60} שעות לפני האירוע`;
  }
  return `תזכורת: ${offsetMinutes} דקות לפני האירוע`;
}
