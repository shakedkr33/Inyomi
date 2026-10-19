import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  I18nManager,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AppConfirmationDialog } from '@/components/AppConfirmationDialog';
import { NavigationPickerModal } from '@/components/NavigationPickerModal';
import { RsvpBlockedByTaskDialog } from '@/components/RsvpBlockedByTaskDialog';
import { UpgradeModal } from '@/components/UpgradeModal';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import { hasPhysicalLocation } from '@/lib/eventLocation';
import { canManageEventReminderItem } from '@/lib/eventReminderPermissions';
import {
  canViewUnansweredRsvp,
  computeUnansweredCommunityMembers,
  unansweredMemberDisplayName,
} from '@/lib/eventRsvpUnanswered';
import { isCancelledEventWithinCommunityVisibilityWindow } from '@/lib/eventsTabDateHelpers';
import {
  getOpenCommunityCalendarActionLabel,
  getRsvpCalendarActionLabel,
  isOpenCommunityCalendarActionVisible,
  isOpenCommunityInformationalLabelVisible,
  isRsvpCalendarActionVisible,
} from '@/lib/openCommunityCalendarUi';
import { PERSONAL_TASK_VISIBILITY_DESCRIPTION } from '@/lib/personalEventTaskPresentation';
import { getConvexErrorCode } from '@/lib/utils/convexError';
import { parseGeoUri } from '@/lib/utils/geoUri';
import { getHebrewDateInfo } from '@/lib/utils/hebrewDate';

/**
 * Inside a Modal, RTL alignment must be handled manually per environment.
 *
 * Expo Go detection: use both fields because executionEnvironment can be
 * unreliable on some Android SDK versions — appOwnership is a safer fallback.
 */
const _isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  Constants.appOwnership === 'expo';

/**
 * - iOS:                 Modal does NOT auto-flip → explicit 'right' / 'row-reverse'
 * - Android Expo Go:     visual debugging showed RN still flips these values inside
 *                        this Modal even when I18nManager.isRTL is false, so supply
 *                        'left'/'row' to get visual right alignment / RTL rows.
 * - Android native RTL:  OS flips 'right'→'left' automatically inside Modal
 *                        → use 'left'/'row' so OS corrects them to 'right'/'row-reverse'
 */
const isAndroidExpoGo = Platform.OS === 'android' && _isExpoGo;
const shouldSupplyInvertedRtlValues = isAndroidExpoGo || I18nManager.isRTL;
const HEB_TEXT_ALIGN: 'left' | 'right' = shouldSupplyInvertedRtlValues
  ? 'left'
  : 'right';
const HEB_ROW: 'row' | 'row-reverse' = shouldSupplyInvertedRtlValues
  ? 'row'
  : 'row-reverse';
const HEB_FLEX_END: 'flex-start' | 'flex-end' = shouldSupplyInvertedRtlValues
  ? 'flex-start'
  : 'flex-end';
// Use writingDirection only on Text components. Do not add it to View
// containers: on Android it can affect native layoutDirection and break visual RTL.
const HEB_WRITING_DIRECTION: 'rtl' | undefined = isAndroidExpoGo
  ? undefined
  : 'rtl';

const { height: screenHeight } = Dimensions.get('window');
const SHEET_HEIGHT = screenHeight * 0.9;
const RSVP_DETAIL_MODAL_MAX_HEIGHT = screenHeight * 0.62;
const RSVP_DETAIL_SCROLL_MAX_HEIGHT = RSVP_DETAIL_MODAL_MAX_HEIGHT - 160;
const INYOMI_EVENT_LINK_BASE = 'https://inyomi.app/e';
const CALENDAR_REMOVE_CONFIRM_TITLE = 'להסיר מהיומן?';
const CALENDAR_REMOVE_CONFIRM_MESSAGE =
  'שימי לב, הוקצו לך משימות באירוע הזה. האירוע יוסר מהיומן שלך, אבל המשימות עדיין יופיעו במסך המשימות.';
const CALENDAR_REMOVE_CONFIRMATION_CODE =
  'CALENDAR_REMOVE_REQUIRES_ACTIVE_TASK_CONFIRMATION';

/** RSVP — strong fills + borders so controls read as real buttons on light cards */
const MEMBER_RSVP_OPTIONS = [
  {
    status: 'yes' as const,
    label: 'כן',
    selectedBg: '#dcfce7',
    selectedBorder: '#16a34a',
    selectedText: '#14532d',
  },
  {
    status: 'maybe' as const,
    label: 'אולי',
    selectedBg: '#fef3c7',
    selectedBorder: '#d97706',
    selectedText: '#92400e',
  },
  {
    status: 'no' as const,
    label: 'לא',
    selectedBg: '#fee2e2',
    selectedBorder: '#dc2626',
    selectedText: '#991b1b',
  },
] as const;

function getBottomSheetRsvpHelperText(
  status: 'yes' | 'no' | 'maybe' | 'none'
): string | null {
  if (status === 'yes') {
    return 'אישרת הגעה';
  }
  if (status === 'maybe') {
    return 'סימנת אולי';
  }
  if (status === 'no') {
    return 'סימנת שלא תגיע/י';
  }
  return null;
}

function rsvpRowDisplayName(row: {
  displayName?: string;
  userId: string;
}): string {
  const trimmed = row.displayName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'משתמש';
}

function uniqueById<T>(items: readonly T[], getId: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique;
}

export interface EventItem {
  id: string;
  time: string;
  endTime?: string;
  title: string;
  location?: string;
  /** geo:lat,lng URI — present when the event was saved with autocomplete coordinates */
  locationUrl?: string;
  googlePlaceId?: string;
  onlineUrl?: string;
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
  /** Convex community id when this row is a community (or saved community) event */
  communityId?: string;
  /** From listByDateRange / listCommunity… when known */
  isSavedToMyCalendar?: boolean;
  importantItems?: Array<{ id: string; title: string }>;
  tasksVisibleToParticipants?: boolean;
}

interface EventDetailsBottomSheetProps {
  event?: EventItem | null;
  eventId?: string | null;
  visible: boolean;
  onClose: () => void;
  onDragClose?: () => void;
  onNavigate: (location: string) => void;
}

type Attachment = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

export function EventDetailsBottomSheet({
  event,
  eventId,
  visible,
  onClose,
  onDragClose,
  onNavigate: _onNavigate,
}: EventDetailsBottomSheetProps): React.JSX.Element | null {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [showAllTasks, setShowAllTasks] = useState(false);

  const [navPickerOpen, setNavPickerOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [blockedRsvpTaskCount, setBlockedRsvpTaskCount] = useState<
    number | null
  >(null);
  const [pendingRsvpStatus, setPendingRsvpStatus] = useState<
    'yes' | 'no' | 'maybe' | null
  >(null);
  const [
    calendarRemoveConfirmationEventId,
    setCalendarRemoveConfirmationEventId,
  ] = useState<Id<'events'> | null>(null);
  const [participantRsvpDetailsOpen, setParticipantRsvpDetailsOpen] =
    useState(false);
  const { isExpiredFree } = useEffectiveAccess();
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [personalNoConfirmOpen, setPersonalNoConfirmOpen] = useState(false);
  const [removeFromCalendarConfirmOpen, setRemoveFromCalendarConfirmOpen] =
    useState(false);
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const [isClosingState, setIsClosingState] = useState(false);
  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 5 && Math.abs(gesture.dx) < Math.abs(gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) => {
        sheetTranslateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_, gesture) => {
        if (isClosingRef.current) return;

        const shouldClose = gesture.dy > 80 || gesture.vy > 1.1;

        if (shouldClose) {
          isClosingRef.current = true;
          setIsClosingState(true);
          onDragClose?.();
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
      setIsClosingState(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setParticipantRsvpDetailsOpen(false);
    }
  }, [visible]);

  const handleRequestClose = (): void => {
    if (isClosingRef.current) return;
    onClose();
  };
  const convexEventId =
    eventId && isValidConvexId(eventId) ? (eventId as Id<'events'>) : null;

  const cancelEventMutation = useMutation(api.events.cancelEvent);
  // FIX C — Community Events never call deleteEvent (hard delete); early
  // Community-display removal of a cancelled Community Event goes through
  // this dedicated soft-removal mutation instead (see convex/events.ts).
  const removeCancelledCommunityEventMutation = useMutation(
    api.events.removeCancelledCommunityEvent
  );
  const softDeletePersonalEventMutation = useMutation(
    api.events.softDeletePersonalEvent
  );
  const addImportantItemsToMyTasks = useMutation(
    api.tasks.addEventImportantItemsToMyTasks
  );
  const updateEventMutation = useMutation(api.events.update);
  const upsertRsvpMutation = useMutation(api.eventRsvps.upsertRsvp);
  const setRsvpNoAndUnclaimMyEventTasks = useMutation(
    api.eventRsvps.setRsvpNoAndUnclaimMyEventTasks
  );
  const removePersonalEventFromMyCalendar = useMutation(
    api.personalEventCalendar.removePersonalEventFromMyCalendar
  );
  const addCommunityEventToMyCalendar = useMutation(
    api.communityEventCalendar.addCommunityEventToMyCalendar
  );
  const removeCommunityEventFromMyCalendar = useMutation(
    api.communityEventCalendar.removeCommunityEventFromMyCalendar
  );
  const claimEventTask = useMutation(api.eventTasks.claimEventTask);
  const unclaimEventTask = useMutation(api.eventTasks.unclaimEventTask);
  const toggleEventTaskCompleted = useMutation(api.eventTasks.toggleCompleted);

  const eventDoc = useQuery(
    api.events.getById,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const importantItemsCopyState = useQuery(
    api.tasks.hasUserCopiedAllImportantItemsFromEvent,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );

  const eventTasks = useQuery(
    api.eventTasks.listByEvent,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const eventImportantItems = useQuery(
    api.tasks.listEventImportantItems,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const rsvps = useQuery(
    api.eventRsvps.listByEvent,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const myAssignedEventTasksState = useQuery(
    api.eventRsvps.hasMyAssignedEventTasksForEvent,
    convexEventId ? { eventId: convexEventId } : 'skip'
  );
  const currentUserId = useQuery(api.users.getMyId) ?? undefined;
  const familyContactsForDetails = useQuery(api.members.listMyFamilyContacts);

  const showCalendarRemoveConfirmation = useCallback(
    (eventIdToRemove: Id<'events'>): void => {
      setCalendarRemoveConfirmationEventId(eventIdToRemove);
    },
    []
  );

  const handleConfirmCalendarRemoval = useCallback((): void => {
    if (!calendarRemoveConfirmationEventId) return;
    const eventIdToRemove = calendarRemoveConfirmationEventId;
    setCalendarRemoveConfirmationEventId(null);
    removeCommunityEventFromMyCalendar({
      eventId: eventIdToRemove,
      confirmRemoveWithActiveTask: true,
    }).catch(() => Alert.alert('שגיאה', 'לא ניתן לעדכן את היומן'));
  }, [calendarRemoveConfirmationEventId, removeCommunityEventFromMyCalendar]);

  const handleCancelCalendarRemoval = useCallback(
    (): void => setCalendarRemoveConfirmationEventId(null),
    []
  );

  const handleOpenCalendarToggle = useCallback((): void => {
    if (!convexEventId || eventDoc === undefined || eventDoc === null) return;
    const isSaved = eventDoc.isSavedToMyCalendar === true;
    if (isSaved && myAssignedEventTasksState?.hasAssignedTasks === true) {
      showCalendarRemoveConfirmation(convexEventId);
      return;
    }
    const run = isSaved
      ? removeCommunityEventFromMyCalendar
      : addCommunityEventToMyCalendar;
    run({ eventId: convexEventId }).catch((error) => {
      const errorCode = getConvexErrorCode(error);
      if (
        isSaved &&
        (errorCode === CALENDAR_REMOVE_CONFIRMATION_CODE ||
          errorCode === 'CALENDAR_REMOVE_BLOCKED_BY_ACTIVE_TASK')
      ) {
        showCalendarRemoveConfirmation(convexEventId);
        return;
      }
      Alert.alert('שגיאה', 'לא ניתן לעדכן את היומן');
    });
  }, [
    convexEventId,
    eventDoc,
    myAssignedEventTasksState,
    addCommunityEventToMyCalendar,
    removeCommunityEventFromMyCalendar,
    showCalendarRemoveConfirmation,
  ]);
  const showRsvpNoBlockedDialog = useCallback(
    (count: number): void => {
      if (!convexEventId) return;
      if (
        !(
          (eventDoc ?? event)?.communityId ||
          (currentUserId && eventDoc?.createdBy === currentUserId)
        )
      ) {
        Alert.alert(
          'לא ניתן לבטל הקצאה',
          'לביטול ההקצאה יש לפנות ליוצרי האירוע'
        );
        return;
      }
      setBlockedRsvpTaskCount(count);
    },
    [convexEventId, eventDoc, event, currentUserId]
  );
  const handleRsvp = useCallback(
    (status: 'yes' | 'no' | 'maybe') => {
      if (!convexEventId || pendingRsvpStatus) return;
      const localAssignedCount = (eventTasks ?? []).filter(
        (task) => task.assignedToUserId === currentUserId
      ).length;
      const assignedCount =
        myAssignedEventTasksState?.count ?? localAssignedCount;
      if (status === 'no' && assignedCount > 0) {
        showRsvpNoBlockedDialog(assignedCount);
        return;
      }
      setPendingRsvpStatus(status);
      upsertRsvpMutation({ eventId: convexEventId, status })
        .catch((error) => {
          if (
            status === 'no' &&
            getConvexErrorCode(error) === 'RSVP_NO_BLOCKED_BY_ACTIVE_TASK'
          ) {
            showRsvpNoBlockedDialog(assignedCount > 0 ? assignedCount : 1);
            return;
          }
          Alert.alert('שגיאה', 'לא ניתן לשמור תגובה');
        })
        .finally(() => {
          setPendingRsvpStatus(null);
        });
    },
    [
      convexEventId,
      currentUserId,
      eventTasks,
      myAssignedEventTasksState,
      pendingRsvpStatus,
      showRsvpNoBlockedDialog,
      upsertRsvpMutation,
    ]
  );
  const [isCopyingImportantItems, setIsCopyingImportantItems] = useState(false);
  const [importantItemsCopiedLocally, setImportantItemsCopiedLocally] =
    useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset local copy state when the selected event or sheet visibility changes.
  useEffect(() => {
    setImportantItemsCopiedLocally(false);
    setIsCopyingImportantItems(false);
  }, [convexEventId, visible]);

  const permCommunityId = eventDoc?.communityId;
  const communityRecord = useQuery(
    api.communities.getById,
    permCommunityId ? { communityId: permCommunityId } : 'skip'
  );
  const communityMembersResult = useQuery(
    api.communities.getCommunityMembers,
    permCommunityId ? { communityId: permCommunityId } : 'skip'
  );

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
          dateTimeParts: formatDateTimeParts(
            eventDoc.startTime,
            eventDoc.endTime,
            eventDoc.allDay
          ),
          groupName: event?.groupName,
          location: eventDoc.location,
          locationUrl: (eventDoc as { locationUrl?: string }).locationUrl,
          googlePlaceId: (eventDoc as { googlePlaceId?: string }).googlePlaceId,
          onlineUrl: (eventDoc as { onlineUrl?: string }).onlineUrl,
          description: eventDoc.description,
          isRecurring: eventDoc.isRecurring,
          recurringPattern: eventDoc.recurringPattern,
          reminders: (eventDoc as { reminders?: number[] }).reminders,
          attachments: (eventDoc.attachments ?? []) as Attachment[],
          importantItems: eventDoc.importantItems ?? [],
          participants: eventDoc.participants ?? [],
          requiresRsvp: eventDoc.requiresRsvp,
          startTime: eventDoc.startTime,
          allDay: eventDoc.allDay,
          communityId: eventDoc.communityId,
          createdBy: eventDoc.createdBy,
          tasksVisibleToParticipants: eventDoc.tasksVisibleToParticipants,
          status: eventDoc.status,
          cancelledAt: eventDoc.cancelledAt,
          removedFromCommunityAt: eventDoc.removedFromCommunityAt,
          cancelReason: eventDoc.cancelReason,
          isSavedToMyCalendar: eventDoc.isSavedToMyCalendar === true,
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
            locationUrl: event.locationUrl,
            googlePlaceId: event.googlePlaceId,
            onlineUrl: event.onlineUrl,
            description: event.description,
            isRecurring: event.isRecurring,
            recurringPattern: event.recurringPattern,
            reminders: event.reminders,
            attachments: [] as Attachment[],
            importantItems: event.importantItems ?? [],
            participants: [],
            requiresRsvp: false,
            startTime: undefined,
            allDay: event.allDay,
            communityId: event.communityId,
            createdBy: undefined,
            tasksVisibleToParticipants: event.tasksVisibleToParticipants,
            status: undefined,
            cancelledAt: undefined,
            removedFromCommunityAt: undefined,
            cancelReason: undefined,
            isSavedToMyCalendar: event.isSavedToMyCalendar === true,
          }
        : null;

  const isCommunityEvent = Boolean(displayEvent?.communityId);
  const shouldGatePersonalFamilyActions = isExpiredFree && !isCommunityEvent;

  const handleGatedAction = (action: () => void): void => {
    if (shouldGatePersonalFamilyActions) {
      setUpgradeModalVisible(true);
      return;
    }
    action();
  };

  const handleEdit = (): void => {
    if (!displayEvent) return;
    onClose();
    router.push({
      pathname: '/(authenticated)/event-edit/[id]',
      params: {
        id: displayEvent.id,
        ...(displayEvent.communityId
          ? { returnCommunityId: displayEvent.communityId as string }
          : {}),
      },
    });
  };

  /**
   * Part D2B/D3 — opens the SAME community-event creation route as the
   * global "+", pre-filled in duplication mode via `duplicateFromEventId`.
   * Never serializes the source event into route params — event/new.tsx's
   * CommunityEventForm fetches it through the existing data layer.
   */
  const handleDuplicate = (): void => {
    if (!displayEvent?.communityId) return;
    onClose();
    router.push({
      pathname: '/(authenticated)/event/new',
      params: {
        communityId: displayEvent.communityId as string,
        duplicateFromEventId: displayEvent.id,
      },
    });
  };

  const handleShare = (): void => {
    if (!displayEvent) return;
    const doShare = async (): Promise<void> => {
      const message = buildCommunityEventShareMessage({
        title: displayEvent.title,
        eventId: displayEvent.id,
        startTime: displayEvent.startTime,
        dateTimeParts:
          'dateTimeParts' in displayEvent
            ? displayEvent.dateTimeParts
            : undefined,
        allDay: displayEvent.allDay,
        timeLabel: displayEvent.timeLabel,
        location: displayEvent.location,
        importantItems:
          eventImportantItems ?? displayEvent.importantItems ?? [],
        communityName: communityRecord?.name ?? displayEvent.groupName,
      });

      await Share.share({ message });
    };

    doShare().catch(() => {
      Alert.alert(
        'שיתוף לא זמין',
        'לא ניתן לשתף את האירוע כרגע. נסו שוב עוד רגע.'
      );
    });
  };

  const handleCancel = (): void => {
    if (!convexEventId || !currentUserId) return;
    const isCommunity = Boolean(displayEvent?.communityId);
    const cancelSharedUserIds =
      (eventDoc as { sharedWithUserIds?: string[] } | null | undefined)
        ?.sharedWithUserIds ?? [];
    const cancelSharedMemberIds =
      (eventDoc as { sharedWithFamilyMemberIds?: string[] } | null | undefined)
        ?.sharedWithFamilyMemberIds ?? [];
    const personalEventHasInvitees =
      !isCommunity &&
      (cancelSharedUserIds.length > 0 || cancelSharedMemberIds.length > 0);
    const title = isCommunity ? 'ביטול אירוע' : 'לבטל את האירוע?';
    const message = isCommunity
      ? 'האירוע יוצג בקהילה כמבוטל למשך 24 שעות, כדי שחברי הקהילה יראו את העדכון.'
      : personalEventHasInvitees
        ? 'האירוע יבוטל עבור כל המוזמנים.'
        : 'האם לבטל את האירוע?';
    Alert.alert(title, message, [
      { text: 'חזרה', style: 'cancel' },
      {
        text: 'בטל אירוע',
        style: 'destructive',
        onPress: () => {
          cancelEventMutation({
            eventId: convexEventId,
            cancelledBy: currentUserId,
          })
            .then(() => onClose())
            .catch(() => Alert.alert('שגיאה', 'לא ניתן לבטל את האירוע'));
        },
      },
    ]);
  };

  const handleDelete = (): void => {
    if (!convexEventId) return;
    const isCommunity = Boolean(displayEvent?.communityId);
    if (isCommunity) {
      // FIX C — soft Community-display removal only; never a hard delete.
      Alert.alert(
        'להסיר את האירוע מהקהילה?',
        'האירוע ייעלם מיד מהתצוגה לחברי הקהילה ולא יוצג יותר כאירוע שבוטל.',
        [
          { text: 'ביטול', style: 'cancel' },
          {
            text: 'הסר מהקהילה',
            style: 'destructive',
            onPress: () => {
              removeCancelledCommunityEventMutation({ eventId: convexEventId })
                .then(() => onClose())
                .catch(() =>
                  Alert.alert('שגיאה', 'לא ניתן להסיר את האירוע מהקהילה')
                );
            },
          },
        ]
      );
    } else {
      Alert.alert(
        'למחוק את האירוע?',
        'האירוע יועבר לנמחקו לאחרונה ויישמר שם למשך 30 יום.',
        [
          { text: 'ביטול', style: 'cancel' },
          {
            text: 'מחק אירוע',
            style: 'destructive',
            onPress: () => {
              softDeletePersonalEventMutation({ eventId: convexEventId })
                .then(() => onClose())
                .catch(() => Alert.alert('שגיאה', 'לא ניתן למחוק את האירוע'));
            },
          },
        ]
      );
    }
  };

  const handleDeletePersonalEvent = (): void => {
    if (!convexEventId) return;
    Alert.alert(
      'למחוק את האירוע?',
      'האירוע יועבר לנמחקו לאחרונה ויישמר שם למשך 30 יום.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'מחק אירוע',
          style: 'destructive',
          onPress: () => {
            softDeletePersonalEventMutation({ eventId: convexEventId })
              .then(() => onClose())
              .catch(() => Alert.alert('שגיאה', 'לא ניתן למחוק את האירוע'));
          },
        },
      ]
    );
  };

  const handleNavigate = (): void => {
    const location = displayEvent?.location?.trim();
    if (!location || !hasPhysicalLocation(location, displayEvent?.onlineUrl))
      return;
    setNavPickerOpen(true);
  };

  const handleCopyImportantItems = (): void => {
    if (!convexEventId || isCopyingImportantItems) return;
    setIsCopyingImportantItems(true);
    addImportantItemsToMyTasks({ eventId: convexEventId })
      .then(() => {
        setImportantItemsCopiedLocally(true);
      })
      .catch(() => Alert.alert('שגיאה', 'לא ניתן להוסיף למשימות כרגע'))
      .finally(() => setIsCopyingImportantItems(false));
  };

  /**
   * PART B/J — Event Details is the canonical management surface for event
   * important-items: an authorized manager (creator OR active community
   * owner/admin — same rule enforced server-side in events.update) may
   * remove one item at a time, for BOTH future and PAST events. This is a
   * DELETE of shared event content, never a "complete" action — it must
   * never be confused with checking off the user's own personal task copy.
   */
  const handleDeleteImportantItem = (itemId: string): void => {
    if (!convexEventId) return;
    const nextItems = importantItems.filter((item) => item.id !== itemId);
    updateEventMutation({
      id: convexEventId,
      importantItems: nextItems,
    }).catch(() => {
      Alert.alert('שגיאה', 'לא ניתן למחוק את הפריט כרגע');
    });
  };

  const handleClaimEventTask = (taskId: Id<'eventTasks'>): void => {
    Alert.alert('להשתבץ למשימה הזו?', '', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'כן, אני אקח את זה',
        onPress: () =>
          claimEventTask({ id: taskId }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן להשתבץ למשימה כרגע')
          ),
      },
    ]);
  };

  const handleUnclaimEventTask = (taskId: Id<'eventTasks'>): void => {
    Alert.alert('להסיר אותך מהמשימה?', '', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'כן, להסיר אותי',
        onPress: () =>
          unclaimEventTask({ id: taskId }).catch(() =>
            Alert.alert('שגיאה', 'לא ניתן להסיר הקצאה כרגע')
          ),
      },
    ]);
  };

  const handleToggleEventTaskCompleted = (taskId: Id<'eventTasks'>): void => {
    toggleEventTaskCompleted({ id: taskId }).catch(() =>
      Alert.alert('שגיאה', 'לא ניתן לעדכן מצב המשימה')
    );
  };

  if (!visible || (!displayEvent && !convexEventId)) return null;

  const isLoading = convexEventId && eventDoc === undefined;
  const isNotFound = convexEventId && eventDoc === null;
  const hasLocation = Boolean(displayEvent?.location?.trim());
  const hasNavigableLocation = hasPhysicalLocation(
    displayEvent?.location,
    displayEvent?.onlineUrl
  );
  const recurrenceLabel =
    displayEvent?.isRecurring === true
      ? formatRecurrenceLabel(displayEvent.recurringPattern)
      : 'ללא';
  const reminderLabels = (displayEvent?.reminders ?? [])
    .filter((r): r is number => typeof r === 'number')
    .map(formatReminderLabel);
  const tasks = uniqueById(eventTasks ?? [], (task) => task._id as string);
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 2);
  const rsvpRows = rsvps ?? [];
  const yesCount = rsvpRows.filter((r) => r.status === 'yes').length;
  const maybeCount = rsvpRows.filter((r) => r.status === 'maybe').length;
  const noCount = rsvpRows.filter((r) => r.status === 'no').length;
  const isOpenCommunityEvent =
    Boolean(displayEvent?.communityId) && displayEvent?.requiresRsvp === false;
  const importantItems =
    eventImportantItems ?? displayEvent?.importantItems ?? [];
  const hasImportantItems = importantItems.length > 0;
  const importantItemsCopyLoading = importantItemsCopyState === undefined;
  const allImportantItemsCopied =
    importantItemsCopiedLocally ||
    (importantItemsCopyState?.allCopied === true && hasImportantItems);
  const importantItemsCopyDisabled =
    importantItemsCopyLoading ||
    isCopyingImportantItems ||
    allImportantItemsCopied;
  const importantItemsCopyLabel = allImportantItemsCopied
    ? 'נוסף למשימות שלך ✓'
    : 'הוסף למשימות שלי';
  const importantItemsCopyButtonStyle = allImportantItemsCopied
    ? styles.importantItemsCopiedBtn
    : importantItemsCopyDisabled
      ? styles.importantItemsCopyBtnDisabled
      : styles.importantItemsCopyBtn;
  const importantItemsCopyTextStyle = allImportantItemsCopied
    ? styles.importantItemsCopiedBtnText
    : importantItemsCopyDisabled
      ? styles.importantItemsCopyBtnTextDisabled
      : styles.importantItemsCopyBtnText;

  const hasCommunityResponseSummary = Boolean(
    !isOpenCommunityEvent && (displayEvent?.requiresRsvp || rsvpRows.length > 0)
  );
  const hasManualParticipantNames =
    (displayEvent?.participants?.length ?? 0) > 0;

  const myMembership = communityMembersResult?.members?.find(
    (m) => m.userId === currentUserId
  );
  const isEventCreator =
    Boolean(displayEvent?.createdBy && currentUserId) &&
    displayEvent?.createdBy === currentUserId;

  // For personal (non-community) events: resolve creator's display name so we
  // can show "נוצר ע״י [firstName]" when the viewer is NOT the creator.
  const creatorDisplayName = (() => {
    if (!displayEvent?.createdBy || isEventCreator || displayEvent?.communityId)
      return undefined;
    const creatorUserId = displayEvent.createdBy as string;
    const member = familyContactsForDetails?.members?.find(
      (m) => (m as { matchedUserId?: string }).matchedUserId === creatorUserId
    );
    const fullName = (member?.displayName ?? '').trim();
    if (!fullName) return undefined;
    // Return only the first word (first name)
    return fullName.split(' ')[0] ?? fullName;
  })();
  const isCommunityOwnerOrAdmin =
    myMembership?.role === 'owner' || myMembership?.role === 'admin';
  const canManageCommunityEvent =
    Boolean(displayEvent?.communityId) &&
    (isEventCreator || isCommunityOwnerOrAdmin);
  /**
   * FIX D — "טרם ענו" (unanswered) is manager-only coordination
   * information: the event creator, or an active community owner/admin
   * (regardless of who created the event) — never a regular member, even
   * though regular members DO see yes/maybe/no. Gated on
   * `communityMembersResult !== undefined` so we never render a misleading
   * "טרם ענו 0" while active-member data is still loading; while loading,
   * the manager-only section simply doesn't render (yes/maybe/no are
   * unaffected).
   */
  const communityMemberDataReady = communityMembersResult !== undefined;
  const viewerCanViewUnansweredRsvp = canViewUnansweredRsvp({
    isEventCreator,
    isActiveCommunityOwnerOrAdmin: isCommunityOwnerOrAdmin,
  });
  const showUnansweredRsvpSection = Boolean(
    displayEvent?.communityId &&
      displayEvent?.requiresRsvp === true &&
      viewerCanViewUnansweredRsvp &&
      communityMemberDataReady
  );
  const unansweredCommunityMembers = showUnansweredRsvpSection
    ? computeUnansweredCommunityMembers({
        activeMembers: communityMembersResult?.members ?? [],
        rsvpRows,
        eventCreatedBy: displayEvent?.createdBy,
      })
    : [];
  const unansweredRsvpCount = unansweredCommunityMembers.length;
  // PART B/J — same authorization rule enforced server-side in
  // events.update; works identically for future AND past events (no
  // time-based gate). Reused from the community "תזכורות" tab's per-item
  // delete authorization so there is a single source of truth.
  const canManageImportantItems = canManageEventReminderItem({
    currentUserId,
    eventCreatedBy: displayEvent?.createdBy ?? '',
    myRole: myMembership?.role,
  });
  const canManageTasks = displayEvent?.communityId
    ? canManageCommunityEvent
    : isEventCreator;
  const participantsCanSeeTasks =
    displayEvent?.tasksVisibleToParticipants === true;
  // Use the server-filtered task result: managers always see the section;
  // regular members see it only when the backend returned authorized tasks.
  const hasAuthorizedEventTasks =
    eventTasks !== undefined && eventTasks.length > 0;
  const canSeeEventTasksSection = displayEvent?.communityId
    ? canManageTasks || hasAuthorizedEventTasks
    : isEventCreator || hasAuthorizedEventTasks;

  /**
   * Part D1 — "שכפל אירוע" is gated by the EXACT community-event-CREATION
   * permission (owner/admin — same rule as canCreateCommunityContent in
   * resolveActiveCommunityContext.ts), NOT the broader canManageCommunityEvent
   * (which also includes a non-owner/admin creator). A creator who is a
   * plain member does not see duplicate.
   */
  const canDuplicateEvent =
    Boolean(displayEvent?.communityId) && isCommunityOwnerOrAdmin;

  const canEdit = displayEvent?.communityId
    ? canManageCommunityEvent
    : Boolean(
        convexEventId &&
          displayEvent?.createdBy &&
          currentUserId &&
          displayEvent.createdBy === currentUserId
      );

  const canCancel = displayEvent?.communityId
    ? Boolean(
        convexEventId &&
          canManageCommunityEvent &&
          displayEvent.status !== 'cancelled'
      )
    : Boolean(
        convexEventId && isEventCreator && displayEvent?.status !== 'cancelled'
      );

  // FIX C — for a Community Event this now gates the SOFT Community-display
  // removal action ("הסר אירוע מהקהילה" → removeCancelledCommunityEvent),
  // never the hard delete (api.events.deleteEvent, which is now hardened
  // server-side to reject Community Events entirely — see convex/events.ts).
  // Uses the SAME shared 24-hour-window helper the Community screen's
  // "אירועים שבוטלו" section already uses, so the two can never drift out
  // of sync. Also requires `removedFromCommunityAt === undefined` so the
  // action disappears once the event has already been removed.
  const canRemoveFromCommunity = Boolean(
    convexEventId &&
      displayEvent?.communityId &&
      displayEvent.status === 'cancelled' &&
      displayEvent.cancelledAt !== undefined &&
      isCancelledEventWithinCommunityVisibilityWindow(
        displayEvent.cancelledAt as number,
        Date.now()
      ) &&
      canManageCommunityEvent &&
      displayEvent.removedFromCommunityAt === undefined
  );

  // Personal Event branch — UNCHANGED behavior (hard delete of a cancelled
  // personal event within the same 24h window, by its creator only). Kept
  // as its own boolean (rather than folded into canRemoveFromCommunity) so
  // this FIX cannot alter Personal Event delete semantics.
  const canDeletePersonalCancelled = Boolean(
    convexEventId &&
      !displayEvent?.communityId &&
      displayEvent?.status === 'cancelled' &&
      displayEvent.cancelledAt !== undefined &&
      Date.now() - (displayEvent.cancelledAt as number) < 24 * 60 * 60 * 1000 &&
      isEventCreator
  );

  const canDelete = canRemoveFromCommunity || canDeletePersonalCancelled;

  /**
   * QA FIX (Issue 3) — CANONICAL CREATOR RSVP RULE: only the event's actual
   * creator is exempt from RSVP on their own community event. A non-creator
   * owner/admin must go through the exact same RSVP flow as any other
   * member — management role alone must never skip RSVP. This used to also
   * skip the prompt for any owner/admin (even when someone else created the
   * event), which was the Issue 3 bug: the creator correctly had no RSVP UI,
   * but a non-creator owner/admin also silently had none, while still being
   * shown as "מחכים לתגובה" elsewhere — see convex/communityCalendarState.ts's
   * computeRsvpAttentionState for the matching server-side fix.
   */
  const skipCommunityRsvpPrompt = isEventCreator;

  const sharedWithUserIds =
    (eventDoc as { sharedWithUserIds?: string[] } | null | undefined)
      ?.sharedWithUserIds ?? [];

  // Fallback for events created before sharedWithUserIds was introduced:
  // use the viewer's family-space entity ID vs sharedWithFamilyMemberIds.
  const viewerSelfEntityId = familyContactsForDetails?.selfEntityId as
    | string
    | undefined;
  const eventSharedWithFamilyMemberIds =
    (eventDoc as { sharedWithFamilyMemberIds?: string[] } | null | undefined)
      ?.sharedWithFamilyMemberIds ?? [];

  const isPersonalInvitee = Boolean(
    !displayEvent?.communityId &&
      !isEventCreator &&
      currentUserId &&
      (sharedWithUserIds.includes(currentUserId) ||
        (viewerSelfEntityId != null &&
          eventSharedWithFamilyMemberIds.includes(viewerSelfEntityId)))
  );

  const isPersonalEvent = !displayEvent?.communityId;

  const hasPersonalInvitees = Boolean(
    isPersonalEvent &&
      (sharedWithUserIds.length > 0 ||
        eventSharedWithFamilyMemberIds.length > 0)
  );

  const canDeletePersonalDirect = Boolean(
    convexEventId &&
      isPersonalEvent &&
      isEventCreator &&
      !hasPersonalInvitees &&
      displayEvent?.status !== 'cancelled'
  );

  const myRsvpRow = rsvpRows.find((r) => r.userId === currentUserId);
  const rawRsvp = myRsvpRow?.status;
  const currentRsvpStatus: 'yes' | 'no' | 'maybe' | 'none' =
    rawRsvp === 'yes' || rawRsvp === 'maybe' || rawRsvp === 'no'
      ? rawRsvp
      : 'none';

  const rsvpHelperText = getBottomSheetRsvpHelperText(currentRsvpStatus);

  const showMemberRsvp = Boolean(
    !skipCommunityRsvpPrompt && displayEvent?.communityId
  );

  const showMemberRsvpButtons = Boolean(
    showMemberRsvp && !isOpenCommunityEvent
  );

  const openCommunityCalendarInfoReady =
    !displayEvent?.communityId ||
    (communityRecord !== undefined && communityMembersResult !== undefined);

  const viewerIsActiveCommunityMemberForCalendar =
    communityMembersResult !== undefined && communityMembersResult !== null;

  /** Personal calendar toggle — same rules as community flyer; not gated on RSVP/banner/skip. */
  const showOpenCalendarButton = Boolean(
    openCommunityCalendarInfoReady &&
      isOpenCommunityCalendarActionVisible({
        event: {
          communityId: displayEvent?.communityId ?? null,
          requiresRsvp: displayEvent?.requiresRsvp,
          status: displayEvent?.status,
        },
        hasValidConvexEventId: Boolean(convexEventId),
        communityArchived: communityRecord?.archived === true,
        viewerIsActiveMember: viewerIsActiveCommunityMemberForCalendar,
      })
  );

  /**
   * Stage 2B: independent calendar action for RSVP-required community
   * events — same handler as the open-event footer button, since RSVP and
   * personal-calendar inclusion are independent axes. Never disables/edits
   * the RSVP buttons above it.
   */
  const showRsvpCalendarToggle = Boolean(
    openCommunityCalendarInfoReady &&
      isRsvpCalendarActionVisible({
        event: {
          communityId: displayEvent?.communityId ?? null,
          requiresRsvp: displayEvent?.requiresRsvp,
          status: displayEvent?.status,
        },
        hasValidConvexEventId: Boolean(convexEventId),
        communityArchived: communityRecord?.archived === true,
        viewerIsActiveMember: viewerIsActiveCommunityMemberForCalendar,
      })
  );

  /** Event mode label — all active members including creator/admin (not gated on RSVP skip). */
  const showOpenCommunityLabel = Boolean(
    openCommunityCalendarInfoReady &&
      displayEvent &&
      isOpenCommunityInformationalLabelVisible({
        event: {
          communityId: displayEvent.communityId ?? null,
          requiresRsvp: displayEvent.requiresRsvp,
          status: displayEvent.status,
        },
        communityArchived: communityRecord?.archived === true,
        viewerIsActiveMember: viewerIsActiveCommunityMemberForCalendar,
      })
  );

  const showRsvpUnifiedCard = Boolean(
    convexEventId &&
      (showMemberRsvpButtons ||
        hasCommunityResponseSummary ||
        hasManualParticipantNames ||
        isPersonalInvitee)
  );

  /**
   * Footer state must track Convex `eventDoc` when loaded — avoids mismatched
   * Pressable vs Text styles during query refresh (white-on-white) and keeps
   * label + colors in sync after add/remove mutations.
   */
  const openCalendarFooterSaved =
    convexEventId && eventDoc !== undefined && eventDoc !== null
      ? eventDoc.isSavedToMyCalendar === true
      : displayEvent?.isSavedToMyCalendar === true;

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleRequestClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={handleRequestClose} style={styles.backdrop} />

      <Animated.View
        pointerEvents={isClosingState ? 'none' : 'box-none'}
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

        <View
          pointerEvents="box-none"
          style={[
            styles.sheetCloseBar,
            { paddingLeft: insets.left + 14, paddingRight: 14 },
          ]}
        >
          <Pressable
            accessibilityLabel="סגירת פרטי האירוע"
            accessibilityRole="button"
            accessible={true}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={handleRequestClose}
            style={({ pressed }) => [
              styles.sheetCloseHit,
              pressed && styles.sheetCloseHitPressed,
            ]}
          >
            <MaterialIcons color="#64748b" name="close" size={24} />
          </Pressable>
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
          <View style={styles.sheetMainColumn}>
            <ScrollView
              contentContainerStyle={[
                styles.scrollContent,
                Platform.OS === 'android' && {
                  paddingBottom: 14 + insets.bottom,
                },
              ]}
              keyboardShouldPersistTaps="always"
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
                  <View style={styles.dateTimeBlock}>
                    <Text style={styles.dateLine}>
                      {displayEvent.dateTimeParts
                        ? displayEvent.dateTimeParts.dateLine
                        : displayEvent.timeLabel}
                    </Text>
                    {displayEvent.dateTimeParts ? (
                      <Text style={styles.timeText}>
                        {displayEvent.dateTimeParts.timeLine}
                      </Text>
                    ) : null}
                    {displayEvent.startTime &&
                    getHebrewDateInfo(displayEvent.startTime).fullHebrewDate ? (
                      <Text style={styles.hebrewDateLine}>
                        {
                          getHebrewDateInfo(displayEvent.startTime)
                            .fullHebrewDate
                        }
                      </Text>
                    ) : null}
                  </View>
                </View>

                {hasLocation ? (
                  <View style={styles.locationRowLtrShell}>
                    <View style={styles.locationRow}>
                      {hasNavigableLocation ? (
                        <Pressable
                          accessibilityLabel={`נווט אל ${displayEvent.location}`}
                          accessibilityRole="button"
                          accessible={true}
                          onPress={handleNavigate}
                          style={styles.navigateBtn}
                        >
                          <MaterialIcons
                            color="#8d6e63"
                            name="near-me"
                            size={14}
                          />
                          <Text style={styles.navigateBtnText}>נווט</Text>
                        </Pressable>
                      ) : null}
                      <View style={styles.locationTextBlock}>
                        <MaterialIcons
                          color="#94a3b8"
                          name="location-on"
                          size={17}
                        />
                        <Text numberOfLines={1} style={styles.locationText}>
                          {displayEvent.location}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : null}

                {showOpenCommunityLabel ? (
                  <View style={styles.openCommunityHeroInfo}>
                    <MaterialIcons color="#64748b" name="groups" size={18} />
                    <Text style={styles.openCommunityHeroInfoText}>
                      פתוח לחברי הקהילה
                    </Text>
                  </View>
                ) : null}

                <View style={styles.quickActionsLtrRow}>
                  {canDeletePersonalDirect ? (
                    <QuickAction
                      color="#dc2626"
                      disabled={false}
                      icon="delete-outline"
                      label="מחק"
                      onPress={handleDeletePersonalEvent}
                    />
                  ) : (
                    <QuickAction
                      color="#dc2626"
                      disabled={!canCancel}
                      icon="event-busy"
                      label="ביטול"
                      onPress={handleCancel}
                    />
                  )}
                  <QuickAction
                    color="#2563eb"
                    disabled={false}
                    icon="share"
                    label="שיתוף"
                    onPress={handleShare}
                  />
                  <QuickAction
                    color="#36a9e2"
                    disabled={!canEdit}
                    icon="edit"
                    label="עריכה"
                    onPress={() => handleGatedAction(handleEdit)}
                  />
                  {canDuplicateEvent ? (
                    <QuickAction
                      color="#64748b"
                      disabled={false}
                      icon="content-copy"
                      label="שכפול"
                      onPress={() => handleGatedAction(handleDuplicate)}
                    />
                  ) : null}
                </View>

                {canDelete ? (
                  <Pressable
                    accessible={true}
                    accessibilityLabel={
                      displayEvent.communityId
                        ? 'הסר אירוע מהקהילה'
                        : 'מחק אירוע לגמרי'
                    }
                    accessibilityRole="button"
                    onPress={() => handleGatedAction(handleDelete)}
                    style={styles.deleteEventBtn}
                  >
                    <MaterialIcons
                      color="#dc2626"
                      name="delete-forever"
                      size={18}
                    />
                    <Text style={styles.deleteEventBtnText}>
                      {displayEvent.communityId
                        ? 'הסר אירוע מהקהילה'
                        : 'מחק לגמרי'}
                    </Text>
                  </Pressable>
                ) : null}

                {displayEvent.description ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesLabel}>הערות</Text>
                    <Text style={styles.notesText}>
                      {displayEvent.description}
                    </Text>
                  </View>
                ) : null}
              </View>

              {showRsvpUnifiedCard ? (
                <View style={[styles.sectionCard, styles.rsvpMemberCard]}>
                  {showMemberRsvpButtons ? (
                    <>
                      <Text style={styles.rsvpMemberTitle}>האם תשתתף/י?</Text>
                      <View style={styles.rsvpMemberButtonRow}>
                        {MEMBER_RSVP_OPTIONS.map((opt) => {
                          const isActive = currentRsvpStatus === opt.status;
                          const rsvpDisabled =
                            displayEvent.status === 'cancelled' ||
                            pendingRsvpStatus !== null;
                          return (
                            <TouchableOpacity
                              key={opt.status}
                              activeOpacity={0.82}
                              accessibilityHint={
                                rsvpDisabled
                                  ? undefined
                                  : 'מגדיר את תגובת ההגעה שלך לאירוע'
                              }
                              accessibilityLabel={opt.label}
                              accessibilityRole="button"
                              accessibilityState={{
                                disabled: rsvpDisabled,
                                selected: isActive,
                              }}
                              accessible={true}
                              disabled={rsvpDisabled}
                              hitSlop={{
                                top: 8,
                                bottom: 8,
                                left: 6,
                                right: 6,
                              }}
                              onPress={() => handleRsvp(opt.status)}
                              style={[
                                styles.rsvpSegment,
                                {
                                  backgroundColor: isActive
                                    ? opt.selectedBg
                                    : '#f8fafc',
                                  borderColor: isActive
                                    ? opt.selectedBorder
                                    : '#64748b',
                                  opacity: rsvpDisabled ? 0.5 : 1,
                                },
                                isActive && styles.rsvpSegmentSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.rsvpSegmentText,
                                  isActive && {
                                    color: opt.selectedText,
                                    fontWeight: '800',
                                  },
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {rsvpHelperText ? (
                        <Text style={styles.rsvpMemberHelper}>
                          {rsvpHelperText}
                        </Text>
                      ) : currentRsvpStatus === 'none' &&
                        displayEvent.status !== 'cancelled' ? (
                        <Text style={styles.rsvpMemberHint}>
                          בחר/י את תגובתך
                        </Text>
                      ) : null}
                      {showRsvpCalendarToggle ? (
                        <Pressable
                          accessibilityHint="מוסיף או מסיר את האירוע מהיומן האישי שלך, בלי לשנות את תגובת ההגעה"
                          accessibilityLabel={getRsvpCalendarActionLabel(
                            openCalendarFooterSaved
                          )}
                          accessibilityRole="button"
                          accessible={true}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={handleOpenCalendarToggle}
                          style={({ pressed }) => [
                            styles.rsvpCalendarToggleBtn,
                            pressed && styles.rsvpCalendarToggleBtnPressed,
                          ]}
                        >
                          <Text style={styles.rsvpCalendarToggleText}>
                            {getRsvpCalendarActionLabel(
                              openCalendarFooterSaved
                            )}
                          </Text>
                        </Pressable>
                      ) : null}
                    </>
                  ) : null}

                  {isPersonalInvitee ? (
                    <>
                      <Text style={styles.rsvpMemberTitle}>
                        {currentRsvpStatus === 'none'
                          ? 'האם תשתתף/י?'
                          : currentRsvpStatus === 'no'
                            ? 'סימנת שלא תגיע/י'
                            : 'שינוי תשובה'}
                      </Text>
                      <View style={styles.rsvpMemberButtonRow}>
                        {MEMBER_RSVP_OPTIONS.map((opt) => {
                          const isActive = currentRsvpStatus === opt.status;
                          const rsvpDisabled =
                            displayEvent.status === 'cancelled' ||
                            pendingRsvpStatus !== null;
                          return (
                            <TouchableOpacity
                              key={opt.status}
                              activeOpacity={0.82}
                              accessibilityHint={
                                rsvpDisabled
                                  ? undefined
                                  : 'מגדיר את תגובת ההגעה שלך לאירוע'
                              }
                              accessibilityLabel={opt.label}
                              accessibilityRole="button"
                              accessibilityState={{
                                disabled: rsvpDisabled,
                                selected: isActive,
                              }}
                              accessible={true}
                              disabled={rsvpDisabled}
                              hitSlop={{
                                top: 8,
                                bottom: 8,
                                left: 6,
                                right: 6,
                              }}
                              onPress={() => {
                                if (opt.status === 'no') {
                                  setPersonalNoConfirmOpen(true);
                                } else {
                                  handleRsvp(opt.status);
                                }
                              }}
                              style={[
                                styles.rsvpSegment,
                                {
                                  backgroundColor: isActive
                                    ? opt.selectedBg
                                    : '#f8fafc',
                                  borderColor: isActive
                                    ? opt.selectedBorder
                                    : '#64748b',
                                  opacity: rsvpDisabled ? 0.5 : 1,
                                },
                                isActive && styles.rsvpSegmentSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.rsvpSegmentText,
                                  isActive && {
                                    color: opt.selectedText,
                                    fontWeight: '800',
                                  },
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {currentRsvpStatus === 'no' ? (
                        <Text style={styles.rsvpMemberHint}>
                          אפשר לשנות תשובה אם משהו השתנה.
                        </Text>
                      ) : rsvpHelperText ? (
                        <Text style={styles.rsvpMemberHelper}>
                          {rsvpHelperText}
                        </Text>
                      ) : currentRsvpStatus === 'none' &&
                        displayEvent.status !== 'cancelled' ? (
                        <Text style={styles.rsvpMemberHint}>
                          בחר/י את תגובתך
                        </Text>
                      ) : null}
                    </>
                  ) : null}

                  {showMemberRsvpButtons &&
                  (hasCommunityResponseSummary || hasManualParticipantNames) ? (
                    <View style={styles.rsvpUnifiedDivider} />
                  ) : null}

                  {isPersonalInvitee &&
                  (creatorDisplayName !== undefined ||
                    hasManualParticipantNames) ? (
                    <View style={styles.rsvpUnifiedDivider} />
                  ) : null}

                  {hasCommunityResponseSummary && !isPersonalInvitee ? (
                    <Pressable
                      accessibilityHint="פותח רשימת משתתפים לפי סוג תגובה"
                      accessibilityLabel={
                        showUnansweredRsvpSection
                          ? `תגובות משתתפים, כן ${yesCount}, אולי ${maybeCount}, לא ${noCount}, טרם ענו ${unansweredRsvpCount}. צפייה`
                          : `תגובות משתתפים, כן ${yesCount}, אולי ${maybeCount}, לא ${noCount}. צפייה`
                      }
                      accessibilityRole="button"
                      accessible={true}
                      onPress={() => setParticipantRsvpDetailsOpen(true)}
                      style={({ pressed }) => [
                        styles.rsvpCommunitySummaryBtn,
                        pressed && styles.rsvpCommunitySummaryBtnPressed,
                      ]}
                    >
                      <Text style={styles.rsvpCommunitySummarySectionTitle}>
                        תגובות משתתפים
                      </Text>
                      <View style={styles.rsvpCommunitySummaryRow}>
                        <Text style={styles.rsvpCommunitySummaryCounts}>
                          {showUnansweredRsvpSection
                            ? `כן ${yesCount} · אולי ${maybeCount} · לא ${noCount} · טרם ענו ${unansweredRsvpCount}`
                            : `כן ${yesCount} · אולי ${maybeCount} · לא ${noCount}`}
                        </Text>
                        <MaterialIcons
                          color="#94a3b8"
                          name="chevron-left"
                          size={22}
                        />
                      </View>
                      <Text style={styles.rsvpCommunitySummaryViewHint}>
                        צפייה
                      </Text>
                    </Pressable>
                  ) : null}

                  {hasCommunityResponseSummary &&
                  !isPersonalInvitee &&
                  hasManualParticipantNames ? (
                    <View style={styles.rsvpUnifiedDivider} />
                  ) : null}

                  {!hasCommunityResponseSummary &&
                  showMemberRsvpButtons &&
                  hasManualParticipantNames ? (
                    <View style={styles.rsvpUnifiedDivider} />
                  ) : null}

                  {creatorDisplayName ? (
                    <View style={styles.rsvpManualParticipantsBlock}>
                      <Text style={styles.rsvpManualParticipantsTitle}>
                        {`נוצר ע״י ${creatorDisplayName}`}
                      </Text>
                    </View>
                  ) : null}

                  {hasManualParticipantNames ? (
                    <View style={styles.rsvpManualParticipantsBlock}>
                      <Text style={styles.rsvpManualParticipantsTitle}>
                        מוזמנים (מהאירוע)
                      </Text>
                      <View style={styles.participantsWrap}>
                        {displayEvent.participants.map((name) => (
                          <View key={name} style={styles.participantPill}>
                            <Text style={styles.participantPillText}>
                              {name}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* "הסר מהיומן שלי" — invitees only, after RSVP 'no' or when event is cancelled */}
              {isPersonalInvitee &&
              convexEventId &&
              (displayEvent.status === 'cancelled' ||
                currentRsvpStatus === 'no') ? (
                <Pressable
                  accessible={true}
                  accessibilityLabel="הסר מהיומן שלי"
                  accessibilityHint="מסיר את האירוע מהיומן שלך בלבד"
                  accessibilityRole="button"
                  onPress={() => setRemoveFromCalendarConfirmOpen(true)}
                  style={styles.deleteEventBtn}
                >
                  <MaterialIcons color="#dc2626" name="event-busy" size={18} />
                  <Text style={styles.deleteEventBtnText}>הסר מהיומן שלי</Text>
                </Pressable>
              ) : null}

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

              {hasImportantItems ? (
                <View style={styles.sectionCard}>
                  <View style={styles.importantItemsHeaderChip}>
                    <Text style={styles.importantItemsHeaderChipText}>
                      {`📌 חשוב לזכור · ${importantItems.length}`}
                    </Text>
                  </View>
                  <View style={styles.importantItemsList}>
                    {importantItems.map((item) => (
                      <View key={item.id} style={styles.importantItemRow}>
                        <Text style={styles.importantItemBullet}>•</Text>
                        <Text style={styles.importantItemText}>
                          {item.title}
                        </Text>
                        {canManageImportantItems ? (
                          <Pressable
                            accessibilityLabel={`מחק פריט: ${item.title}`}
                            accessibilityRole="button"
                            accessible={true}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => handleDeleteImportantItem(item.id)}
                            style={styles.importantItemDeleteBtn}
                          >
                            <MaterialIcons
                              color="#94a3b8"
                              name="close"
                              size={16}
                            />
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </View>
                  <Pressable
                    accessibilityLabel={importantItemsCopyLabel}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: importantItemsCopyDisabled,
                    }}
                    accessible={true}
                    disabled={importantItemsCopyDisabled}
                    onPress={handleCopyImportantItems}
                    style={({ pressed }) => [
                      importantItemsCopyButtonStyle,
                      pressed &&
                        !importantItemsCopyDisabled &&
                        styles.importantItemsCopyBtnPressed,
                    ]}
                  >
                    <Text style={importantItemsCopyTextStyle}>
                      {importantItemsCopyLabel}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {convexEventId && canSeeEventTasksSection ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>משימות לאירוע</Text>
                  {canManageTasks ? (
                    <View style={styles.managerVisibilityInfo}>
                      <MaterialIcons
                        name={participantsCanSeeTasks ? 'visibility' : 'lock'}
                        size={15}
                        color="#6b7280"
                      />
                      <View style={styles.managerVisibilityInfoText}>
                        <Text style={styles.managerVisibilityInfoTitle}>
                          {participantsCanSeeTasks
                            ? 'גלוי למשתתפים'
                            : 'גלוי לפי הקצאה'}
                        </Text>
                        <Text style={styles.managerVisibilityInfoDesc}>
                          {!displayEvent.communityId
                            ? PERSONAL_TASK_VISIBILITY_DESCRIPTION
                            : participantsCanSeeTasks
                              ? 'כל חברי הקהילה יראו את המשימות וההקצאות ויוכלו להשתבץ'
                              : 'כל משתתף יראה רק משימות שהוקצו אליו. מנהלי האירוע ימשיכו לראות את כולן'}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {eventTasks === undefined ? (
                    <Text style={styles.mutedText}>טוען משימות...</Text>
                  ) : tasks.length > 0 ? (
                    <View style={styles.compactList}>
                      {visibleTasks.map((task) => {
                        const assigneeDisplay = (
                          task as { assigneeDisplay?: string }
                        ).assigneeDisplay?.trim();
                        const isAssignedToCurrentUser =
                          task.assignedToUserId === currentUserId;
                        const hasAssignee = Boolean(
                          assigneeDisplay ||
                            task.assignedToUserId ||
                            task.assignedToManual?.trim()
                        );
                        const assignmentLabel =
                          !displayEvent.communityId && assigneeDisplay
                            ? `הוקצה ל־${assigneeDisplay}`
                            : !hasAssignee
                              ? 'לא הוקצה'
                              : isAssignedToCurrentUser
                                ? '✓ הוקצה אליי'
                                : assigneeDisplay
                                  ? `הוקצה ל-${assigneeDisplay}`
                                  : 'הוקצה';
                        const showSelfClaimAction =
                          displayEvent.communityId &&
                          Boolean(myMembership) &&
                          participantsCanSeeTasks;
                        const eventHasStarted =
                          typeof displayEvent.startTime === 'number' &&
                          displayEvent.startTime <= Date.now();
                        const isClaimable =
                          showSelfClaimAction &&
                          !hasAssignee &&
                          !eventHasStarted;
                        const isCompleted = task.completed === true;
                        const canUnclaimHere =
                          showSelfClaimAction &&
                          isAssignedToCurrentUser &&
                          !eventHasStarted &&
                          !isCompleted;
                        // Manager OR task assigned to current user may complete.
                        // Visibility alone does NOT grant completion permission.
                        const canCompleteTask =
                          canManageTasks ||
                          (task.assignedToUserId !== undefined &&
                            task.assignedToUserId === currentUserId);
                        return (
                          <View key={task._id} style={styles.detailListRow}>
                            {/* Completion checkbox — enabled for manager or own-assigned tasks */}
                            {canCompleteTask ? (
                              <Pressable
                                accessible={true}
                                accessibilityLabel={`${isCompleted ? 'בטל סימון' : 'סמן כבוצע'}: ${task.title}`}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: isCompleted }}
                                hitSlop={11}
                                onPress={() =>
                                  handleToggleEventTaskCompleted(task._id)
                                }
                                style={styles.eventTaskCheckboxTouch}
                              >
                                <View
                                  style={[
                                    styles.eventTaskCheckbox,
                                    isCompleted && styles.eventTaskCheckboxDone,
                                  ]}
                                >
                                  {isCompleted ? (
                                    <MaterialIcons
                                      color="#FFFFFF"
                                      name="check"
                                      size={16}
                                    />
                                  ) : null}
                                </View>
                              </Pressable>
                            ) : (
                              <View
                                accessible={true}
                                accessibilityLabel={task.title}
                                accessibilityRole="checkbox"
                                accessibilityState={{
                                  checked: isCompleted,
                                  disabled: true,
                                }}
                                style={styles.eventTaskCheckboxTouch}
                              >
                                <View
                                  style={[
                                    styles.eventTaskCheckbox,
                                    styles.eventTaskCheckboxDisabled,
                                    isCompleted &&
                                      styles.eventTaskCheckboxDoneDisabled,
                                  ]}
                                >
                                  {isCompleted ? (
                                    <MaterialIcons
                                      color="#FFFFFF"
                                      name="check"
                                      size={16}
                                    />
                                  ) : null}
                                </View>
                              </View>
                            )}
                            <View style={styles.detailListContent}>
                              <Text
                                style={[
                                  styles.detailListTitle,
                                  isCompleted &&
                                    styles.detailListTitleCompleted,
                                ]}
                              >
                                {task.title}
                              </Text>
                              {isClaimable ? (
                                <Pressable
                                  accessibilityLabel="אני אקח"
                                  accessibilityRole="button"
                                  accessible={true}
                                  onPress={() => handleClaimEventTask(task._id)}
                                  style={({ pressed }) => [
                                    styles.taskAssignmentActionPressable,
                                    pressed &&
                                      styles.taskAssignmentActionPressed,
                                  ]}
                                >
                                  <View style={styles.taskAssignmentAction}>
                                    <Text
                                      style={styles.taskAssignmentActionText}
                                    >
                                      + אני אקח
                                    </Text>
                                  </View>
                                </Pressable>
                              ) : canUnclaimHere ? (
                                <View style={styles.taskAssignmentStatusRow}>
                                  <Text
                                    style={[
                                      styles.taskAssignmentStatusText,
                                      styles.taskAssignmentMineText,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    ✓ הוקצה אליי
                                  </Text>
                                  <Pressable
                                    accessibilityLabel="בטל הקצאה"
                                    accessibilityRole="button"
                                    accessible={true}
                                    hitSlop={{
                                      top: 6,
                                      bottom: 6,
                                      left: 8,
                                      right: 8,
                                    }}
                                    onPress={() =>
                                      handleUnclaimEventTask(task._id)
                                    }
                                    style={({ pressed }) => [
                                      styles.taskUnassignPressable,
                                      pressed &&
                                        styles.taskAssignmentActionPressed,
                                    ]}
                                  >
                                    <View style={styles.taskUnassignAction}>
                                      <Text
                                        style={styles.taskUnassignActionText}
                                      >
                                        בטל הקצאה
                                      </Text>
                                    </View>
                                  </Pressable>
                                </View>
                              ) : (
                                <View
                                  style={[
                                    styles.taskAssignmentStatusChip,
                                    !hasAssignee &&
                                      styles.taskAssignmentStatusChipMuted,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.taskAssignmentStatusText,
                                      !hasAssignee &&
                                        styles.taskAssignmentStatusTextMuted,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {assignmentLabel}
                                  </Text>
                                </View>
                              )}
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
                          <View style={styles.showMoreBtnInner}>
                            <Text style={styles.showMoreText}>
                              {showAllTasks
                                ? 'הצג פחות משימות'
                                : 'הצג עוד משימות'}
                            </Text>
                            <MaterialIcons
                              color="#00668E"
                              name={
                                showAllTasks ? 'expand-less' : 'expand-more'
                              }
                              size={18}
                            />
                          </View>
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

              {displayEvent.attachments.length > 0 ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>קבצים מצורפים</Text>
                  <View style={styles.compactList}>
                    {displayEvent.attachments.map((attachment) => (
                      <AttachmentRow
                        attachment={attachment}
                        eventId={convexEventId}
                        key={String(attachment.storageId)}
                        onPreviewImage={setPreviewImageUrl}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <SafeAreaView edges={['bottom']} style={styles.sheetFooterSafe}>
              {showOpenCalendarButton ? (
                <View style={styles.openCalendarFooter}>
                  <Pressable
                    accessibilityHint="מוסיף או מסיר את האירוע מהיומן האישי שלך"
                    accessibilityLabel={getOpenCommunityCalendarActionLabel(
                      openCalendarFooterSaved
                    )}
                    accessibilityRole="button"
                    accessible={true}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={handleOpenCalendarToggle}
                    style={({ pressed }) => ({
                      alignSelf: 'stretch' as const,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <View
                      style={{
                        alignSelf: 'stretch',
                        minHeight: 48,
                        paddingVertical: 14,
                        paddingHorizontal: 16,
                        borderRadius: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: openCalendarFooterSaved
                          ? '#ffffff'
                          : '#36a9e2',
                        borderWidth: openCalendarFooterSaved ? 2 : 0,
                        borderColor: '#7dd3fc',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: '700',
                          textAlign: 'center',
                          color: openCalendarFooterSaved
                            ? '#0369a1'
                            : '#ffffff',
                        }}
                      >
                        {getOpenCommunityCalendarActionLabel(
                          openCalendarFooterSaved
                        )}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              ) : null}
            </SafeAreaView>
          </View>
        )}
      </Animated.View>

      <NavigationPickerModal
        location={displayEvent?.location ?? null}
        googlePlaceId={displayEvent?.googlePlaceId}
        latitude={parseGeoUri(displayEvent?.locationUrl)?.lat}
        longitude={parseGeoUri(displayEvent?.locationUrl)?.lng}
        onClose={() => setNavPickerOpen(false)}
        visible={navPickerOpen}
      />

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

      <Modal
        animationType="slide"
        onRequestClose={() => setParticipantRsvpDetailsOpen(false)}
        transparent
        visible={participantRsvpDetailsOpen}
      >
        <Pressable
          accessibilityLabel="סגור"
          accessibilityRole="button"
          accessible={true}
          onPress={() => setParticipantRsvpDetailsOpen(false)}
          style={styles.rsvpDetailModalBackdrop}
        />
        <View
          style={[
            styles.rsvpDetailModalSheet,
            { maxHeight: RSVP_DETAIL_MODAL_MAX_HEIGHT },
          ]}
        >
          <Text style={styles.rsvpDetailModalTitle}>תגובות משתתפים</Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={[
              styles.rsvpDetailScroll,
              { maxHeight: RSVP_DETAIL_SCROLL_MAX_HEIGHT },
            ]}
            contentContainerStyle={styles.rsvpDetailScrollContent}
          >
            <View style={styles.rsvpDetailGroup}>
              <Text
                style={styles.rsvpDetailGroupTitle}
              >{`כן (${yesCount})`}</Text>
              {rsvpRows.filter((r) => r.status === 'yes').length === 0 ? (
                <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
              ) : (
                rsvpRows
                  .filter((r) => r.status === 'yes')
                  .map((r) => (
                    <Text key={r._id} style={styles.rsvpDetailName}>
                      {rsvpRowDisplayName(r)}
                    </Text>
                  ))
              )}
            </View>
            <View style={styles.rsvpDetailGroup}>
              <Text
                style={styles.rsvpDetailGroupTitle}
              >{`אולי (${maybeCount})`}</Text>
              {rsvpRows.filter((r) => r.status === 'maybe').length === 0 ? (
                <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
              ) : (
                rsvpRows
                  .filter((r) => r.status === 'maybe')
                  .map((r) => (
                    <Text key={r._id} style={styles.rsvpDetailName}>
                      {rsvpRowDisplayName(r)}
                    </Text>
                  ))
              )}
            </View>
            <View style={styles.rsvpDetailGroup}>
              <Text
                style={styles.rsvpDetailGroupTitle}
              >{`לא (${noCount})`}</Text>
              {rsvpRows.filter((r) => r.status === 'no').length === 0 ? (
                <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
              ) : (
                rsvpRows
                  .filter((r) => r.status === 'no')
                  .map((r) => (
                    <Text key={r._id} style={styles.rsvpDetailName}>
                      {rsvpRowDisplayName(r)}
                    </Text>
                  ))
              )}
            </View>
            {showUnansweredRsvpSection ? (
              <View style={styles.rsvpDetailGroup}>
                <Text
                  style={styles.rsvpDetailGroupTitle}
                >{`טרם ענו (${unansweredRsvpCount})`}</Text>
                {unansweredCommunityMembers.length === 0 ? (
                  <Text style={styles.rsvpDetailEmpty}>אין עדיין</Text>
                ) : (
                  unansweredCommunityMembers.map((m) => (
                    <Text key={m.userId} style={styles.rsvpDetailName}>
                      {unansweredMemberDisplayName(m)}
                    </Text>
                  ))
                )}
              </View>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityLabel="סגירת רשימת משתתפים"
            accessibilityRole="button"
            accessible={true}
            onPress={() => setParticipantRsvpDetailsOpen(false)}
            style={styles.rsvpDetailCloseBtn}
          >
            <Text style={styles.rsvpDetailCloseBtnText}>סגירה</Text>
          </Pressable>
        </View>
      </Modal>
      <RsvpBlockedByTaskDialog
        assignedTaskCount={blockedRsvpTaskCount ?? 1}
        onClose={() => setBlockedRsvpTaskCount(null)}
        onConfirm={() => {
          if (!convexEventId) return;
          setBlockedRsvpTaskCount(null);
          setRsvpNoAndUnclaimMyEventTasks({ eventId: convexEventId }).catch(
            () => Alert.alert('שגיאה', 'לא ניתן לעדכן אישור הגעה')
          );
        }}
        visible={blockedRsvpTaskCount !== null}
      />
      <AppConfirmationDialog
        cancelLabel="ביטול"
        confirmDestructive
        confirmLabel="להסיר בכל זאת"
        message={CALENDAR_REMOVE_CONFIRM_MESSAGE}
        onCancel={handleCancelCalendarRemoval}
        onConfirm={handleConfirmCalendarRemoval}
        title={CALENDAR_REMOVE_CONFIRM_TITLE}
        visible={calendarRemoveConfirmationEventId !== null}
      />
      <AppConfirmationDialog
        cancelLabel="לא עכשיו"
        confirmLabel="כן, לא אגיע"
        message="האירוע יישאר זמין ואפשר לשנות תשובה מאוחר יותר."
        onCancel={() => setPersonalNoConfirmOpen(false)}
        onConfirm={() => {
          setPersonalNoConfirmOpen(false);
          handleRsvp('no');
        }}
        title="לסמן שלא תגיע/י לאירוע?"
        visible={personalNoConfirmOpen}
      />
      <AppConfirmationDialog
        cancelLabel="ביטול"
        confirmDestructive
        confirmLabel="הסר מהיומן שלי"
        message="האירוע יוסר מהיומן שלך בלבד. הוא לא יימחק אצל היוצר או אצל מוזמנים אחרים."
        onCancel={() => setRemoveFromCalendarConfirmOpen(false)}
        onConfirm={() => {
          setRemoveFromCalendarConfirmOpen(false);
          if (!convexEventId) return;
          removePersonalEventFromMyCalendar({ eventId: convexEventId })
            .then(() => {
              onClose();
            })
            .catch(() => {
              Alert.alert('שגיאה', 'לא ניתן להסיר את האירוע מהיומן');
            });
        }}
        title="להסיר מהיומן שלך?"
        visible={removeFromCalendarConfirmOpen}
      />
      <UpgradeModal
        visible={upgradeModalVisible}
        reason="general"
        onClose={() => setUpgradeModalVisible(false)}
      />
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
  eventId,
  onPreviewImage,
}: {
  attachment: Attachment;
  eventId: Id<'events'> | null;
  onPreviewImage: (url: string) => void;
}): React.JSX.Element {
  const fileUrl = useQuery(
    api.events.getEventAttachmentUrl,
    eventId ? { eventId, storageId: attachment.storageId } : 'skip'
  );
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
    marginBottom: 2,
  },
  /** LTR קבוע כדי שכפתור הסגירה יישאר בקצה שמאלי פיזי. */
  sheetCloseBar: {
    width: '100%',
    minHeight: 48,
    direction: 'ltr',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  sheetCloseHit: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
  },
  sheetCloseHitPressed: {
    opacity: 0.88,
    backgroundColor: 'rgba(148, 163, 184, 0.22)',
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
  sheetMainColumn: {
    flex: 1,
    width: '100%',
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 18,
    width: '100%',
  },
  scrollContent: {
    paddingBottom: 14,
    gap: 8,
    alignItems: 'stretch',
    width: '100%',
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
    textAlign: HEB_TEXT_ALIGN,
  },
  cancelReason: {
    fontSize: 13,
    color: '#7f1d1d',
    textAlign: HEB_TEXT_ALIGN,
  },
  heroCard: {
    alignSelf: 'stretch',
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    padding: 14,
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    width: '100%',
  },
  sheetTitle: {
    alignSelf: 'stretch',
    fontSize: 23,
    fontWeight: '800',
    color: '#111517',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  groupLabel: {
    alignSelf: 'stretch',
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
    textAlign: HEB_TEXT_ALIGN,
    marginTop: -3,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  infoRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 7,
    width: '100%',
  },
  dateTimeBlock: {
    flex: 1,
    gap: 1,
    alignItems: HEB_FLEX_END,
  },
  dateLine: {
    fontSize: 14,
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '600',
    writingDirection: HEB_WRITING_DIRECTION,
    alignSelf: 'stretch',
  },
  timeText: {
    fontSize: 15,
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '800',
    writingDirection: HEB_WRITING_DIRECTION,
    alignSelf: 'stretch',
  },
  hebrewDateLine: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '400',
    writingDirection: HEB_WRITING_DIRECTION,
    alignSelf: 'stretch',
    marginTop: 2,
  },
  infoText: {
    fontSize: 15,
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    flex: 1,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  /** מנע כפל RTL בתוך Modal — שומר נווט משמאל וטקסט מימין */
  locationRowLtrShell: {
    alignSelf: 'stretch',
    width: '100%',
    direction: 'ltr',
  },
  /** נווט משמאל, טקסט + אייקון מיקום מימין (אייקון בקצה ימין) */
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    width: '100%',
  },
  /** בתוך LTR: row-reverse + אייקון ואז טקסט → אייקון בקצה ימין, טקסט נצמד אליו */
  locationTextBlock: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
    minWidth: 0,
  },
  locationText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: '#334155',
    textAlign: 'right',
    fontWeight: '600',
  },
  navigateBtn: {
    backgroundColor: 'rgba(141,110,99,0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 34,
  },
  navigateBtnText: {
    color: '#8d6e63',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'right',
  },
  /** LTR קבוע: ביטול משמאל · שיתוף במרכז · עריכה מימין (לא תלוי בהיפוך iOS) */
  quickActionsLtrRow: {
    direction: 'ltr',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 2,
  },
  deleteEventBtn: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fff5f5',
  },
  deleteEventBtnText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '600',
    textAlign: HEB_TEXT_ALIGN,
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
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  disabledText: {
    color: '#cbd5e1',
  },
  notesBox: {
    alignSelf: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
    gap: 2,
    width: '100%',
  },
  notesLabel: {
    alignSelf: 'stretch',
    fontSize: 12,
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '800',
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  notesText: {
    alignSelf: 'stretch',
    fontSize: 14,
    color: '#334155',
    textAlign: HEB_TEXT_ALIGN,
    lineHeight: 20,
    fontWeight: '600',
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  openCommunityHeroInfo: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    width: '100%',
  },
  openCommunityHeroInfoText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  sheetFooterSafe: {
    backgroundColor: '#fff',
  },
  openCalendarFooter: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  openCalendarFooterBtnPrimary: {
    alignSelf: 'stretch',
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openCalendarFooterBtnTextPrimary: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  openCalendarFooterBtnSecondary: {
    alignSelf: 'stretch',
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#7dd3fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openCalendarFooterBtnTextSecondary: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpMemberCard: {
    alignSelf: 'stretch',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    gap: 10,
    width: '100%',
  },
  rsvpMemberTitle: {
    alignSelf: 'stretch',
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpMemberButtonRow: {
    flexDirection: 'row-reverse',
    gap: 6,
    alignItems: 'stretch',
    alignSelf: 'stretch',
    width: '100%',
  },
  rsvpSegment: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  rsvpSegmentSelected: {
    elevation: 3,
    shadowOpacity: 0.12,
  },
  rsvpSegmentText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
    includeFontPadding: false,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  /**
   * View draws border/bg/shadow (reliable on Android). Pressable is a transparent flex fill;
   * no android_ripple here — ripple was hiding the visible fill on some devices.
   */
  rsvpMemberBtnShell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 48,
    borderRadius: 12,
    borderStyle: 'solid',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
  },
  rsvpMemberBtnShellSelected: {
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  rsvpMemberBtnPressable: {
    flex: 1,
    alignSelf: 'stretch',
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  rsvpMemberBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
    includeFontPadding: false,
    letterSpacing: 0.12,
  },
  rsvpMemberBtnTextSelected: {
    fontWeight: '800',
  },
  rsvpMemberHelper: {
    alignSelf: 'stretch',
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpMemberBtnContent: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  rsvpMemberHint: {
    alignSelf: 'stretch',
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpCalendarToggleBtn: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  rsvpCalendarToggleBtnPressed: {
    opacity: 0.6,
  },
  rsvpCalendarToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369a1',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
    textDecorationLine: 'underline',
  },
  rsvpUnifiedDivider: {
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: '#e2e8f0',
    marginVertical: 4,
  },
  rsvpCommunitySummaryBtn: {
    alignSelf: 'stretch',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    width: '100%',
  },
  rsvpCommunitySummaryBtnPressed: {
    backgroundColor: '#e8f0f6',
  },
  rsvpCommunitySummarySectionTitle: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    marginBottom: 4,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpCommunitySummaryRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  rsvpCommunitySummaryCounts: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpCommunitySummaryViewHint: {
    alignSelf: 'stretch',
    fontSize: 12,
    fontWeight: '600',
    color: '#36a9e2',
    textAlign: HEB_TEXT_ALIGN,
    marginTop: 6,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpManualParticipantsBlock: {
    gap: 8,
    width: '100%',
  },
  rsvpManualParticipantsTitle: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.32)',
  },
  rsvpDetailModalSheet: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 26,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    width: 'auto',
  },
  rsvpDetailModalTitle: {
    alignSelf: 'stretch',
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailScroll: {
    flexGrow: 0,
  },
  rsvpDetailScrollContent: {
    gap: 18,
    paddingBottom: 8,
    width: '100%',
  },
  rsvpDetailGroup: {
    gap: 6,
    width: '100%',
  },
  rsvpDetailGroupTitle: {
    alignSelf: 'stretch',
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailName: {
    alignSelf: 'stretch',
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    textAlign: HEB_TEXT_ALIGN,
    paddingVertical: 2,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailEmpty: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  rsvpDetailCloseBtn: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpDetailCloseBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#475569',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  sectionTitle: {
    alignSelf: 'stretch',
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  sectionCard: {
    alignSelf: 'stretch',
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 8,
    width: '100%',
  },
  scheduleRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  scheduleText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '600',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  reminderRows: {
    gap: 6,
    width: '100%',
  },
  reminderDisplayRow: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
    width: '100%',
  },
  reminderDisplayText: {
    flex: 1,
    fontSize: 14,
    color: '#334155',
    textAlign: HEB_TEXT_ALIGN,
    fontWeight: '800',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  compactList: {
    gap: 6,
    width: '100%',
  },
  detailListRow: {
    flexDirection: HEB_ROW,
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
    width: '100%',
  },
  detailListContent: {
    flex: 1,
    alignItems: HEB_FLEX_END,
    gap: 6,
    minWidth: 0,
  },
  detailListTitle: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
    alignSelf: 'stretch',
  },
  detailListTitleCompleted: {
    color: '#92999C',
    textDecorationLine: 'line-through',
  },
  eventTaskCheckboxTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
  },
  eventTaskCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(0,102,142,0.45)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eventTaskCheckboxDone: {
    backgroundColor: '#00668E',
    borderColor: '#00668E',
  },
  eventTaskCheckboxDisabled: {
    borderColor: '#D4D8DA',
    backgroundColor: 'transparent',
  },
  eventTaskCheckboxDoneDisabled: {
    backgroundColor: '#C4C9CB',
    borderColor: '#C4C9CB',
  },
  mutedText: {
    alignSelf: 'stretch',
    fontSize: 13,
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    width: '100%',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskAssignmentActionPressable: {
    alignSelf: HEB_FLEX_END,
  },
  taskAssignmentAction: {
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 80,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#00668E',
  },
  taskAssignmentActionPressed: {
    opacity: 0.84,
  },
  taskAssignmentMine: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
  },
  taskAssignmentActionText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
    lineHeight: 18,
    textAlign: HEB_TEXT_ALIGN,
    includeFontPadding: false,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskAssignmentMineText: {
    color: '#166534',
  },
  taskAssignmentStatusRow: {
    alignSelf: HEB_FLEX_END,
    flexDirection: HEB_ROW,
    alignItems: 'center',
    justifyContent: HEB_FLEX_END,
    gap: 10,
  },
  taskUnassignPressable: {
    alignSelf: 'auto',
  },
  taskUnassignAction: {
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    backgroundColor: '#f1f5f9',
  },
  taskUnassignActionText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '700',
    lineHeight: 18,
    textAlign: HEB_TEXT_ALIGN,
    includeFontPadding: false,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskAssignmentStatusChip: {
    alignSelf: HEB_FLEX_END,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  taskAssignmentStatusChipMuted: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    paddingHorizontal: 0,
  },
  taskAssignmentStatusText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  taskAssignmentStatusTextMuted: {
    color: '#64748b',
    fontWeight: '600',
  },
  showMoreBtn: {
    alignSelf: HEB_FLEX_END,
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#b3d9ea',
    backgroundColor: '#f0f9ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  showMoreBtnInner: {
    flexDirection: HEB_ROW,
    alignItems: 'center',
    gap: 4,
  },
  showMoreText: {
    color: '#00668E',
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 18,
    includeFontPadding: false,
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  importantItemsList: {
    gap: 8,
    width: '100%',
  },
  importantItemsHeaderChip: {
    alignSelf: HEB_FLEX_END,
    backgroundColor: '#E6F4FB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BAE6FD',
  },
  importantItemsHeaderChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0369a1',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
  },
  importantItemRow: {
    flexDirection: HEB_ROW,
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
  },
  importantItemBullet: {
    fontSize: 16,
    color: '#36a9e2',
    lineHeight: 22,
  },
  importantItemText: {
    flex: 1,
    fontSize: 14,
    color: '#334155',
    textAlign: HEB_TEXT_ALIGN,
    lineHeight: 22,
    fontWeight: '600',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  importantItemDeleteBtn: {
    padding: 4,
  },
  importantItemsCopyBtn: {
    alignSelf: 'stretch',
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importantItemsCopiedBtn: {
    alignSelf: 'stretch',
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#7dd3fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importantItemsCopyBtnPressed: {
    opacity: 0.9,
  },
  importantItemsCopyBtnDisabled: {
    alignSelf: 'stretch',
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#36a9e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importantItemsCopyBtnText: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  importantItemsCopiedBtnText: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
  },
  importantItemsCopyBtnTextDisabled: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
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
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
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
    textAlign: 'center',
    writingDirection: HEB_WRITING_DIRECTION,
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
  managerVisibilityInfo: {
    flexDirection: HEB_ROW,
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    width: '100%',
  },
  managerVisibilityInfoText: {
    flex: 1,
    gap: 1,
    alignItems: HEB_FLEX_END,
  },
  managerVisibilityInfoTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
    alignSelf: 'stretch',
  },
  managerVisibilityInfoDesc: {
    fontSize: 11,
    color: '#64748b',
    textAlign: HEB_TEXT_ALIGN,
    writingDirection: HEB_WRITING_DIRECTION,
    alignSelf: 'stretch',
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
  const { dateLine, timeLine } = formatDateTimeParts(
    startTime,
    endTime,
    allDay
  );
  return `${dateLine}\n${timeLine}`;
}

function formatDateTimeParts(
  startTime: number,
  endTime: number,
  allDay?: boolean
): { dateLine: string; timeLine: string } {
  const dateLine = new Date(startTime).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeLine = allDay
    ? 'כל היום'
    : `${formatTime(startTime)}-${formatTime(endTime)}`;
  return { dateLine, timeLine };
}

interface CommunityEventShareMessageInput {
  title: string;
  eventId: string;
  startTime?: number;
  dateTimeParts?: { dateLine: string; timeLine: string };
  allDay?: boolean;
  timeLabel?: string;
  location?: string;
  importantItems: Array<{ id: string; title: string }>;
  communityName?: string;
}

function buildCommunityEventShareMessage({
  title,
  eventId,
  startTime,
  dateTimeParts,
  allDay,
  timeLabel,
  location,
  importantItems,
  communityName,
}: CommunityEventShareMessageInput): string {
  const trimmedCommunityName = communityName?.trim();
  const trimmedLocation = location?.trim();
  const trimmedImportantItems = importantItems
    .map((item) => item.title.trim())
    .filter((itemTitle) => itemTitle.length > 0);
  const dateParts =
    dateTimeParts ??
    (startTime
      ? {
          dateLine: new Date(startTime).toLocaleDateString('he-IL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
          timeLine: allDay ? 'כל היום' : formatTime(startTime),
        }
      : null);

  const lines = ['אירוע קהילה ב־InYomi 👥'];
  if (trimmedCommunityName) {
    lines.push(`קהילה: ${trimmedCommunityName}`);
  }
  lines.push('', title.trim());

  if (dateParts) {
    lines.push(`מתי: ${dateParts.dateLine}, ${dateParts.timeLine}`);
  } else if (timeLabel?.trim()) {
    lines.push(`מתי: ${timeLabel.trim()}`);
  }

  if (trimmedLocation) {
    lines.push(`איפה: ${trimmedLocation}`);
  }

  if (trimmedImportantItems.length > 0) {
    lines.push('', 'חשוב לזכור:');
    lines.push(...trimmedImportantItems.map((itemTitle) => `• ${itemTitle}`));
  }

  lines.push(
    '',
    'נשלח דרך InYomi - פחות לזכור, יותר להיות.',
    'לפתיחת האירוע / הצטרפות:',
    `${INYOMI_EVENT_LINK_BASE}/${eventId}`
  );

  return lines.join('\n');
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
