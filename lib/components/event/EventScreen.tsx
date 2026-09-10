// FIXED: added EventAttachmentsSection between LocationCard and RecurrenceRow
// FIXED: post-save success/share sheet for personal events
import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
// Alert is still used for save errors
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { CommunityTaskAssignmentSaveError } from '@/lib/communityTaskAssignmentSave';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import {
  applyDuration,
  DateTimeCard,
  fmt2,
  roundToNextHour,
  shiftEndToPreserveDuration,
} from '@/lib/components/event/DateTimeCard';
import { EventAttachmentsSection } from '@/lib/components/event/EventAttachmentsSection';
// applyDuration is used in makeEmptyEvent to set a sensible default end time
import {
  LocationCard,
  type LocationOverlayAnchor,
  type LocationUpdate,
} from '@/lib/components/event/LocationCard';
import { NotesCard } from '@/lib/components/event/NotesCard';
import {
  type FamilyMemberChip,
  ParticipantsCard,
} from '@/lib/components/event/ParticipantsCard';
import { RelatedTasksSection } from '@/lib/components/event/RelatedTasksSection';
import { RemindersCard } from '@/lib/components/event/RemindersCard';
import { isDuplicateSaveBlockedByUnconfirmedDate } from '@/lib/eventDuplication';
import { APP_IS_RTL, needsExplicitRTL, rtl } from '@/lib/rtl';

const ANDROID_MATCH_IOS_LAYOUT = Platform.OS === 'android' && APP_IS_RTL;
import type {
  EventAttachmentDraft,
  EventData,
  ImportantItem,
  RecurrenceType,
} from '@/lib/types/event';
import { makeReminder } from '@/lib/types/event';

const PRIMARY = colors.primaryDark;

const IMPORTANT_ITEMS_SECTION_TITLE = 'חשוב לזכור';
const IMPORTANT_ITEMS_PLACEHOLDER = 'למשל: חולצה לבנה, פרי חתוך, בקבוק מים...';
const IMPORTANT_ITEMS_ADD_LABEL = 'הוסף';

function createImportantItemId(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * Build smart default start/end for a new event.
 * @param selectedDateMs  optional pre-selected calendar date (midnight Unix ms)
 */
function makeEmptyEvent(selectedDateMs?: number): EventData {
  const now = new Date();
  const startD = roundToNextHour(now); // e.g. 22:08 → 23:00, 23:30 → 00:00 next day

  // Use startD's calendar date so midnight rollovers advance to the correct day.
  // When selectedDate is provided (calendar day tap), honour it instead.
  const startDMidnight = new Date(
    startD.getFullYear(),
    startD.getMonth(),
    startD.getDate()
  ).getTime();
  const startDate = selectedDateMs ?? startDMidnight;

  const startTime = `${fmt2(startD.getHours())}:00`;

  // Default duration: 1 hour. applyDuration handles cross-midnight automatically.
  const { endDate, endTime } = applyDuration(startDate, startTime, 60);

  return {
    title: '',
    date: startDate,
    startTime,
    endDate,
    endTime,
    isAllDay: false,
    recurrence: 'none',
    location: undefined,
    onlineUrl: undefined,
    notes: undefined,
    remindersEnabled: true,
    reminders: [makeReminder('hour_before')],
    participants: [],
    tasks: [],
    importantItems: [],
    tasksVisibleToParticipants: false,
    showAllTasksToAll: false,
    createdAt: Date.now(),
  };
}

const MOCK_EVENT: EventData = {
  id: '1',
  title: 'ארוחת ערב משפחתית',
  date: new Date(2023, 9, 12).getTime(),
  startTime: '19:30',
  endTime: '22:00',
  isAllDay: false,
  recurrence: 'none',
  location: 'רחוב הירקון 45',
  locationCoords: { lat: 32.08, lng: 34.78 },
  notes: '',
  remindersEnabled: true,
  reminders: [makeReminder('at_event'), makeReminder('hour_before')],
  participants: [
    { id: '1', name: 'שרה', color: '#ff6b6b', avatarUrl: undefined },
    { id: '2', name: 'דן', color: '#4ecdc4', avatarUrl: undefined },
  ],
  tasks: [
    { id: '1', title: 'לקנות יין אדום', completed: true, colorDot: '#ef4444' },
    { id: '2', title: 'להכין קינוח', completed: false, assigneeId: '1' },
  ],
  tasksVisibleToParticipants: false,
  showAllTasksToAll: true,
  importantItems: [],
  createdAt: Date.now(),
};

/** Returns true when start < end (valid range), or when validation can be skipped. */
function isValidDateRange(event: EventData): boolean {
  if (event.isAllDay || !event.startTime || !event.endTime) return true;
  const [sh, sm] = event.startTime.split(':').map(Number);
  const [eh, em] = event.endTime.split(':').map(Number);
  const startMs = new Date(event.date).setHours(sh ?? 0, sm ?? 0, 0, 0);
  const endMs = new Date(event.endDate ?? event.date).setHours(
    eh ?? 0,
    em ?? 0,
    0,
    0
  );
  return startMs < endMs;
}

interface EventScreenProps {
  mode: 'create' | 'details';
  eventId?: string;
  /** Pre-selected date (midnight Unix ms) when opened from a calendar day tap. */
  selectedDate?: number;
  /** PHASE 1: community creation reuses the personal base form layout. */
  context?: 'personal' | 'community';
  showParticipants?: boolean;
  taskParticipants?: EventData['participants'];
  showRsvpSection?: boolean;
  rsvpRequired?: boolean;
  onRsvpRequiredChange?: (required: boolean) => void;
  showSuccessSheet?: boolean;
  /**
   * Pre-fill all form fields on mount (used by edit screens).
   * Applied once via useState initializer — not reactive to prop changes.
   */
  initialData?: Partial<EventData>;
  /**
   * Pre-fill only the event title on create without triggering edit mode.
   * Ignored when initialData is provided (initialData.title takes precedence).
   */
  prefillTitle?: string;
  /** Override the header title (e.g. "עריכת אירוע" for edit mode). */
  customHeaderTitle?: string;
  /**
   * Stage 3 correction — Part 1: community EVENT DUPLICATION only.
   * `initialData.date` may be pre-filled (e.g. with today's date) purely so
   * the form has something to render, but the manager must still explicitly
   * choose/confirm the date before Save can succeed. When true, `handleSave`
   * blocks (showing an inline Hebrew validation message) until the user
   * interacts with the date picker at least once. Must NOT be set for
   * ordinary create/edit flows — only for duplication.
   */
  requireDateConfirmation?: boolean;
  /**
   * Called when the user confirms save. Should call the Convex mutation.
   * Returns the new event ID so the success sheet can generate a share link.
   */
  onSave?: (data: EventData) => Promise<string>;
  /** When set, back / discard use this instead of router.back() (e.g. return to community). */
  onDismiss?: () => void;
}

export default function EventScreen({
  mode,
  eventId: _eventId,
  selectedDate,
  context = 'personal',
  showParticipants = true,
  taskParticipants,
  showRsvpSection = false,
  rsvpRequired = false,
  onRsvpRequiredChange,
  showSuccessSheet = true,
  initialData,
  prefillTitle,
  customHeaderTitle,
  requireDateConfirmation = false,
  onSave,
  onDismiss,
}: EventScreenProps): React.JSX.Element {
  const isCreate = mode === 'create';
  const defaultHeaderTitle =
    isCreate && context === 'community' ? 'יצירת אירוע קהילתי' : 'יצירת אירוע';
  const headerTitle = customHeaderTitle ?? defaultHeaderTitle;
  // TODO: replace MOCK_EVENT with Convex query using _eventId
  const [event, setEvent] = useState<EventData>(() => {
    const base = isCreate ? makeEmptyEvent(selectedDate) : MOCK_EVENT;
    if (initialData) return { ...base, ...initialData };
    if (prefillTitle) return { ...base, title: prefillTitle };
    return base;
  });

  // FIXED: load family members for the family sharing section in ParticipantsCard.
  // selfEntityId is the signed-in user's own entity row — excluded from the chips
  // so the creator is never shown (they are always implicitly included).
  const serverFamilyContacts = useQuery(api.members.listMyFamilyContacts);
  const familyMembers: FamilyMemberChip[] = (
    serverFamilyContacts?.members ?? []
  )
    .filter((m) => m._id !== serverFamilyContacts?.selfEntityId)
    .map((m) => ({
      _id: m._id,
      displayName: m.displayName,
      color: m.color,
      matchedUserId: m.matchedUserId as string | undefined,
    }));
  const isEditMode = Boolean(initialData);
  const [isDirty, setIsDirty] = useState(!isEditMode);
  const [titleError, setTitleError] = useState(false);
  // Stage 3 correction — Part 1: duplicate-mode-only date confirmation gate.
  // Starts unconfirmed whenever requireDateConfirmation is true, regardless
  // of any pre-filled initialData.date — the manager must interact with the
  // date picker at least once before Save can succeed.
  const [duplicateDateConfirmed, setDuplicateDateConfirmed] = useState(
    !requireDateConfirmation
  );
  const [duplicateDateError, setDuplicateDateError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [pendingAssignmentSave, setPendingAssignmentSave] =
    useState<CommunityTaskAssignmentSaveError | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [importantItemDraft, setImportantItemDraft] = useState('');
  // Keyboard height tracking for the suggestion overlay positioning
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Anchor data from LocationCard for the screen-level suggestion overlay
  const [locationOverlay, setLocationOverlay] =
    useState<LocationOverlayAnchor | null>(null);
  // Stable, deduplicating callback passed to LocationCard.
  // Uses functional setState so we can compare previous and next values and
  // bail out without a re-render when position and suggestion metadata are
  // unchanged — breaking the measurement → setState → re-render → effect loop.
  const handleOverlayUpdate = useCallback(
    (anchor: LocationOverlayAnchor | null) => {
      setLocationOverlay((prev) => {
        if (!anchor) return null;
        if (!prev) return anchor;
        // Allow a 1 px tolerance for native layout-measurement jitter.
        const EPS = 1;
        const samePosition =
          Math.abs(prev.inputX - anchor.inputX) < EPS &&
          Math.abs(prev.inputY - anchor.inputY) < EPS &&
          Math.abs(prev.inputWidth - anchor.inputWidth) < EPS &&
          Math.abs(prev.inputHeight - anchor.inputHeight) < EPS;
        // Use the first placeId as a lightweight proxy for suggestion content.
        const sameSuggestions =
          prev.suggestions.length === anchor.suggestions.length &&
          (anchor.suggestions.length === 0 ||
            prev.suggestions[0]?.placeId === anchor.suggestions[0]?.placeId);
        if (samePosition && sameSuggestions) return prev;
        return anchor;
      });
    },
    []
  );
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  // Ref keeps a live pointer to handleBack so the BackHandler subscription
  // (registered once on mount) always calls the latest version of the function.
  const handleBackRef = useRef<() => void>(() => undefined);

  // Stage 3 correction — small UX fix: when duplicate-date validation
  // blocks Save, scroll the form to the DateTimeCard/error so an off-screen
  // manager (e.g. scrolled to the bottom) sees why Save did nothing. Plain
  // refs (not state) — this is read-only bookkeeping for an imperative
  // scroll, not something that should ever trigger a re-render.
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const scrollViewportHeightRef = useRef(0);
  const dateSectionLayoutRef = useRef<{ y: number; height: number } | null>(
    null
  );

  // Track whether the user has manually changed end date / end time in this
  // session. When false the field is still "auto-generated" and we can safely
  // overwrite it whenever start changes. When true we must preserve the user's
  // choice. Initialised to true in edit-mode (existing event data is treated as
  // intentional) and false in create-mode (fields start as auto-generated).
  const endDateUserEdited = useRef<boolean>(
    initialData ? initialData.endDate !== undefined : false
  );
  const endTimeUserEdited = useRef<boolean>(
    initialData ? initialData.endTime !== undefined : false
  );

  // FIXED: success sheet shown after personal event save
  const [savedEvent, setSavedEvent] = useState<EventData | null>(null);
  const [savedEventId, setSavedEventId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const createShareLink = useMutation(api.shareLinks.createShareLink);

  const autosave = useCallback(
    (_data: EventData) => {
      if (isCreate) return;
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        // TODO: call Convex update mutation with _data
      }, 600);
    },
    [isCreate]
  );

  const updateEvent = useCallback(
    (updates: Partial<EventData>) => {
      setIsDirty(true);
      setEvent((prev) => {
        const updated = { ...prev, ...updates };
        autosave(updated);
        return updated;
      });
    },
    [autosave]
  );

  // Stage 3 correction — small UX fix: scrolls the DateTimeCard/duplicate-
  // date-error section into view WITHOUT jumping if it's already visible,
  // and never opens the date picker — the manager still chooses when to
  // interact with it. Uses the section's own measured layout (via
  // dateSectionLayoutRef, set from that View's onLayout below), not a
  // generic scrollToTop, so it targets the exact spot even on long forms.
  const scrollToDuplicateDateSection = () => {
    const section = dateSectionLayoutRef.current;
    if (!section) return;
    const viewportHeight = scrollViewportHeightRef.current;
    const currentOffset = scrollOffsetRef.current;
    const visibleTop = currentOffset;
    const visibleBottom = currentOffset + viewportHeight;
    const margin = 12;
    const sectionTop = section.y;
    const sectionBottom = section.y + section.height;
    const alreadyFullyVisible =
      viewportHeight > 0 &&
      sectionTop >= visibleTop - margin &&
      sectionBottom <= visibleBottom + margin;
    if (alreadyFullyVisible) return;
    scrollViewRef.current?.scrollTo({
      y: Math.max(sectionTop - margin, 0),
      animated: true,
    });
  };

  const handleSave = async (): Promise<void> => {
    if (!event.title.trim()) {
      setTitleError(true);
      return;
    }
    if (!isValidDateRange(event)) {
      Alert.alert(
        'שגיאה בתאריכים',
        'לא ניתן לשמור את האירוע. על תאריך ושעת ההתחלה לחול לפני תאריך ושעת הסיום.',
        [{ text: 'אישור', style: 'default' }]
      );
      return;
    }
    if (
      isDuplicateSaveBlockedByUnconfirmedDate(
        requireDateConfirmation,
        duplicateDateConfirmed
      )
    ) {
      setDuplicateDateError(true);
      scrollToDuplicateDateSection();
      return;
    }
    if (isSavingRef.current) return;

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      if (onSave) {
        const newEventId = await (pendingAssignmentSave
          ? pendingAssignmentSave.retry()
          : onSave(event));
        setPendingAssignmentSave(null);
        if (showSuccessSheet) {
          // FIXED: show success/share sheet instead of navigating away immediately
          setSavedEvent({ ...event });
          setSavedEventId(newEventId);
          setEvent(makeEmptyEvent(selectedDate));
          endDateUserEdited.current = false;
          endTimeUserEdited.current = false;
        }
      } else {
        // Details mode without onSave — just go back
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(authenticated)');
        }
      }
    } catch (err) {
      if (err instanceof CommunityTaskAssignmentSaveError) {
        setPendingAssignmentSave(err);
        Alert.alert('השמירה הושלמה חלקית', err.message);
      } else {
        console.error('[EventScreen] save error:', err);
        Alert.alert('שגיאה', 'לא ניתן לשמור. אפשר לנסות שוב.');
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleSuccessDone = () => {
    setSavedEvent(null);
    setSavedEventId(null);
    if (onDismiss) {
      onDismiss();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(authenticated)');
    }
  };

  const handleSuccessShare = async () => {
    if (!savedEventId || isSharing) return;
    setIsSharing(true);
    try {
      const { token } = await createShareLink({
        eventId: savedEventId as Id<'events'>,
      });

      const lines: string[] = [];
      if (savedEvent?.title) lines.push(savedEvent.title);

      if (savedEvent?.date) {
        const d = new Date(savedEvent.date);
        let dateLine = d.toLocaleDateString('he-IL', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        });
        if (savedEvent.startTime && !savedEvent.isAllDay) {
          dateLine += ` · ${savedEvent.startTime}`;
          if (savedEvent.endTime) dateLine += `–${savedEvent.endTime}`;
        }
        lines.push(dateLine);
      }
      if (savedEvent?.location) lines.push(`📍 ${savedEvent.location}`);

      const shareText = lines.join('\n');

      // FIXED: clickable HTTPS share link
      const shareUrl = `https://inyomi.com/shared/${token}`;
      const finalMessage = `${shareText}\n\n${shareUrl}`;
      await Share.share({ message: finalMessage });
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשתף כעת. נסה שוב.');
    } finally {
      setIsSharing(false);
    }
  };

  /** true if the user touched any meaningful field */
  // FIXED: attachments now counted as a dirty-state change (triggers back confirmation)
  const isFormDirty = (): boolean =>
    event.title.trim().length > 0 ||
    event.participants.length > 0 ||
    event.tasks.length > 0 ||
    (event.importantItems?.length ?? 0) > 0 ||
    !!event.location ||
    !!event.onlineUrl ||
    !!event.notes ||
    (event.attachments?.length ?? 0) > 0;

  const goBack = (): void => {
    if (onDismiss) {
      onDismiss();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(authenticated)');
    }
  };

  const handleBack = (): void => {
    if (isSavingRef.current) return;
    if (isCreate && isFormDirty()) {
      setDiscardOpen(true);
    } else {
      goBack();
    }
  };

  // Keep ref current every render so the BackHandler (registered once) always
  // invokes the latest handleBack closure with fresh state.
  handleBackRef.current = handleBack;

  // Intercept Android hardware back and route through the same handleBack logic
  // (shows unsaved-changes dialog if needed, then navigates to return target).
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Track keyboard height so the suggestion overlay can position itself above the keyboard.
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const confirmDiscard = (): void => {
    setDiscardOpen(false);
    setTitleError(false);
    if (isEditMode) {
      // Restore original saved data so the component is correct if cached.
      // Never write to Convex — just reset local React state.
      const base = makeEmptyEvent(selectedDate);
      setEvent(initialData ? { ...base, ...initialData } : base);
      setIsDirty(false);
      // Restore edit-tracking flags to the initial state for this session
      endDateUserEdited.current = initialData?.endDate !== undefined;
      endTimeUserEdited.current = initialData?.endTime !== undefined;
    } else {
      setEvent(makeEmptyEvent(selectedDate));
      endDateUserEdited.current = false;
      endTimeUserEdited.current = false;
    }
    goBack();
  };

  const completedTasks = event.tasks.filter((t) => t.completed).length;
  const hasMultipleAssignees =
    new Set(event.tasks.map((t) => t.assigneeId).filter(Boolean)).size > 1;
  const isCommunityEvent = context === 'community';
  const openFamilyProfileSetup = useCallback(() => {
    router.push('/(authenticated)/family-profile-setup');
  }, []);
  const shouldShowRecurrence = !isCommunityEvent;
  const shouldShowReminders = true;
  const taskVisibilityOffHelperText = isCommunityEvent
    ? 'כל משתתף יראה רק משימות שהוקצו אליו. מנהלי האירוע ימשיכו לראות את כולן'
    : 'רק את רואה את המשימות';

  const handleAddImportantItem = (): void => {
    const title = importantItemDraft.trim();
    if (!title) return;
    const nextItem: ImportantItem = {
      id: createImportantItemId(),
      title,
    };
    updateEvent({
      importantItems: [...(event.importantItems ?? []), nextItem],
    });
    setImportantItemDraft('');
  };

  const handleRemoveImportantItem = (itemId: string): void => {
    const nextItems = (event.importantItems ?? []).filter(
      (item) => item.id !== itemId
    );
    updateEvent({
      importantItems: nextItems.length > 0 ? nextItems : [],
    });
  };

  return (
    <SafeAreaView
      style={[s.safeArea, ANDROID_MATCH_IOS_LAYOUT ? s.safeAreaRtl : null]}
      edges={['top', 'bottom']}
    >
      {/* Header — title centered, back arrow on RIGHT, no save action here */}
      <View style={s.header}>
        <Pressable
          style={s.backButton}
          onPress={handleBack}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
        >
          <MaterialIcons name="arrow-forward" size={22} color="#111517" />
        </Pressable>
        <Text style={s.headerTitle}>
          {isCreate ? headerTitle : 'פרטי אירוע'}
        </Text>
        {/* Spacer matches back button width for visual centering */}
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          pointerEvents={pendingAssignmentSave || isSaving ? 'none' : 'auto'}
          accessibilityElementsHidden={Boolean(pendingAssignmentSave) || isSaving}
          importantForAccessibility={
            pendingAssignmentSave || isSaving ? 'no-hide-descendants' : 'auto'
          }
          ref={scrollViewRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onLayout={(e) => {
            scrollViewportHeightRef.current = e.nativeEvent.layout.height;
          }}
          onScroll={(e) => {
            scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          {/* Event Title — compact field */}
          <View style={s.titleSection}>
            <TextInput
              style={[s.titleInput, titleError && s.titleInputError]}
              value={event.title}
              onChangeText={(text) => {
                setTitleError(false);
                updateEvent({ title: text });
              }}
              placeholder="שם האירוע"
              placeholderTextColor="#94a3b8"
              textAlign={rtl.inputTextAlign}
              autoFocus={false}
              accessible={true}
              accessibilityLabel="שם האירוע"
            />
            {titleError && (
              <Text style={s.errorText}>שם האירוע הוא שדה חובה</Text>
            )}
          </View>

          {/* Date & Time */}
          <View
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              dateSectionLayoutRef.current = { y, height };
            }}
          >
            <DateTimeCard
              startDate={event.date}
              startTime={event.startTime}
              endDate={event.endDate ?? event.date}
              endTime={event.endTime}
              isAllDay={event.isAllDay}
              onChange={(updates) => {
                // ── Track user intent on end fields (write-only refs) ──
                // Only mark as "manually edited" when the user explicitly
                // changes the end date/time independently (not when a day-chip
                // sets both startDate + endDate simultaneously).
                if (
                  updates.endDate !== undefined &&
                  updates.startDate === undefined
                ) {
                  endDateUserEdited.current = true;
                }
                if (
                  updates.endTime !== undefined &&
                  updates.startTime === undefined
                ) {
                  endTimeUserEdited.current = true;
                }

                // Stage 3 correction — Part 1: any explicit start-date
                // interaction (quick-chip, calendar grid, or native picker)
                // satisfies the duplicate-mode date confirmation gate, even if
                // the chosen date happens to be the same pre-filled value.
                if (
                  requireDateConfirmation &&
                  updates.startDate !== undefined
                ) {
                  setDuplicateDateConfirmed(true);
                  setDuplicateDateError(false);
                }

                // ── All calculations use `prev` (the latest committed state)
                // so that rapid wheel callbacks compose sequentially instead
                // of all reading the same render-captured `event` snapshot.
                setIsDirty(true);
                setEvent((prev) => {
                  const patch: Partial<EventData> = {};

                  // Apply explicit end values from the update
                  if (updates.endDate !== undefined)
                    patch.endDate = updates.endDate;
                  if (updates.endTime !== undefined)
                    patch.endTime = updates.endTime;

                  // ── Preserve duration when start TIME changes ────────
                  // Always shift end by the same delta.
                  if (updates.startTime !== undefined) {
                    patch.startTime = updates.startTime;
                    if (updates.endTime === undefined) {
                      const { endDate: newEndDate, endTime: newEndTime } =
                        shiftEndToPreserveDuration({
                          prevStartDate: prev.date,
                          prevStartTime: prev.startTime ?? '09:00',
                          prevEndDate: prev.endDate ?? prev.date,
                          prevEndTime: prev.endTime ?? '10:00',
                          nextStartDate: updates.startDate ?? prev.date,
                          nextStartTime: updates.startTime,
                        });
                      patch.endTime = newEndTime;
                      patch.endDate = newEndDate;
                    }
                  }

                  // ── Preserve duration when start DATE changes ────────
                  // Slide end date by the same number of days as start moved,
                  // keeping time strings unchanged (overnight events stay overnight).
                  if (updates.startDate !== undefined) {
                    patch.date = updates.startDate;
                    if (
                      updates.endDate === undefined &&
                      patch.endDate === undefined
                    ) {
                      const prevEndDate = prev.endDate ?? prev.date;
                      const dateDelta = updates.startDate - prev.date;
                      patch.endDate = prevEndDate + dateDelta;
                    }
                  }

                  if (updates.isAllDay !== undefined) {
                    patch.isAllDay = updates.isAllDay;
                    if (updates.isAllDay) {
                      patch.remindersEnabled = false;
                      patch.reminders = [];
                    } else {
                      patch.remindersEnabled = true;
                      patch.reminders = [makeReminder('hour_before')];
                    }
                  }

                  const updated = { ...prev, ...patch };
                  autosave(updated);
                  return updated;
                });
              }}
            />
            {requireDateConfirmation && duplicateDateError && (
              <Text style={s.errorText}>יש לבחור תאריך לאירוע החדש</Text>
            )}
          </View>

          {/* Location */}
          <LocationCard
            location={event.location}
            onlineUrl={event.onlineUrl}
            onChange={(update: LocationUpdate) =>
              updateEvent({
                location: update.location || undefined,
                onlineUrl: update.onlineUrl || undefined,
                locationUrl: update.locationUrl,
              })
            }
            onOverlayUpdate={handleOverlayUpdate}
          />

          {/* Notes */}
          <NotesCard
            notes={event.notes}
            onChange={(notes) => updateEvent({ notes })}
          />

          {/* Attachments */}
          <EventAttachmentsSection
            attachments={event.attachments ?? []}
            onChange={(attachments: EventAttachmentDraft[]) =>
              updateEvent({ attachments })
            }
          />

          {shouldShowRecurrence ? (
            <RecurrenceRow
              value={event.recurrence}
              onChange={(val) => updateEvent({ recurrence: val })}
            />
          ) : null}

          {shouldShowReminders ? (
            <RemindersCard
              enabled={event.remindersEnabled}
              reminders={event.reminders}
              isAllDay={event.isAllDay}
              onChange={(enabled, reminders) =>
                updateEvent({ remindersEnabled: enabled, reminders })
              }
            />
          ) : null}

          {/* Participants — personal events only */}
          {showParticipants ? (
            <ParticipantsCard
              participants={event.participants}
              onChange={(p) => {
                const removedIds = new Set(
                  event.participants
                    .filter((prev) => !p.some((next) => next.id === prev.id))
                    .map((prev) => prev.id)
                );
                const tasks =
                  removedIds.size > 0
                    ? event.tasks.map((t) => ({
                        ...t,
                        assignedParticipantIds: (
                          t.assignedParticipantIds ?? []
                        ).filter((id) => !removedIds.has(id)),
                      }))
                    : event.tasks;

                // FIXED: removing a family member from participants also deselects them in family section
                const removedFamilyIds = [...removedIds].filter((id) =>
                  familyMembers.some((fm) => fm._id === id)
                );

                if (removedFamilyIds.length > 0) {
                  const newFamilyIds = (
                    event.sharedWithFamilyMemberIds ?? []
                  ).filter((id) => !removedFamilyIds.includes(id));
                  updateEvent({
                    participants: p,
                    tasks,
                    // If "כולם" was on and a member is removed, turn it off
                    allFamily: event.allFamily ? undefined : event.allFamily,
                    sharedWithFamilyMemberIds:
                      newFamilyIds.length > 0 ? newFamilyIds : undefined,
                  });
                } else {
                  updateEvent({ participants: p, tasks });
                }
              }}
              familyMembers={familyMembers}
              allFamily={event.allFamily}
              sharedWithFamilyMemberIds={event.sharedWithFamilyMemberIds}
              onFamilyChange={(af, ids) => {
                // FIXED: family member selection now syncs to event.participants for display
                const patch: Partial<EventData> = {
                  allFamily: af || undefined,
                  sharedWithFamilyMemberIds: ids.length > 0 ? ids : undefined,
                };

                // Derive sharedWithUserIds — only real Convex user IDs from matchedUserId
                if (af) {
                  const userIds = familyMembers
                    .map((fm) => fm.matchedUserId)
                    .filter((id): id is string => Boolean(id));
                  patch.sharedWithUserIds =
                    userIds.length > 0 ? userIds : undefined;
                } else if (ids.length > 0) {
                  const userIds = familyMembers
                    .filter((fm) => ids.includes(fm._id))
                    .map((fm) => fm.matchedUserId)
                    .filter((id): id is string => Boolean(id));
                  patch.sharedWithUserIds =
                    userIds.length > 0 ? userIds : undefined;
                } else {
                  patch.sharedWithUserIds = undefined;
                }

                // Keep participants that are NOT family members (external contacts/email)
                const existingNonFamily = event.participants.filter(
                  (p) => !familyMembers.some((fm) => fm._id === p.id)
                );

                if (af) {
                  // "כולם" — add every family member as a participant
                  patch.participants = [
                    ...existingNonFamily,
                    ...familyMembers.map((fm) => ({
                      id: fm._id,
                      name: fm.displayName ?? '',
                      color: fm.color ?? '#36a9e2',
                      avatarUrl: undefined,
                    })),
                  ];
                } else if (ids.length > 0) {
                  // Individual selection — only the selected family members
                  patch.participants = [
                    ...existingNonFamily,
                    ...familyMembers
                      .filter((fm) => ids.includes(fm._id))
                      .map((fm) => ({
                        id: fm._id,
                        name: fm.displayName ?? '',
                        color: fm.color ?? '#36a9e2',
                        avatarUrl: undefined,
                      })),
                  ];
                } else {
                  // Nothing selected — strip all family members from participants
                  patch.participants = existingNonFamily;
                }

                updateEvent(patch);
              }}
              onConfigureFamilyProfile={
                isCommunityEvent ? undefined : openFamilyProfileSetup
              }
            />
          ) : null}

          {/* Related Tasks */}
          <RelatedTasksSection
            tasks={event.tasks}
            participants={taskParticipants ?? event.participants}
            completedCount={completedTasks}
            tasksVisibleToParticipants={event.tasksVisibleToParticipants}
            showToggle={true}
            onChange={(tasks) => updateEvent({ tasks })}
            onToggleVisibility={(val) =>
              updateEvent({ tasksVisibleToParticipants: val })
            }
            visibilityOffHelperText={taskVisibilityOffHelperText}
            onAddParticipants={() => {}}
            assignmentTitle={
              isCommunityEvent ? 'הקצאת משימה לחבר קהילה' : 'הקצאת משימה'
            }
            assignmentEmptyText={
              isCommunityEvent
                ? 'אין עדיין חברים פעילים בקהילה'
                : 'לא צורפו משתתפים לצורך הקצאת המשימה'
            }
            assignmentSectionLabel={isCommunityEvent ? 'חברי קהילה' : 'משתתפים'}
            showAddParticipantsEmptyAction={!isCommunityEvent}
          />

          {isCommunityEvent ? (
            <View style={s.importantItemsSection}>
              <Text style={s.importantItemsTitle}>
                {IMPORTANT_ITEMS_SECTION_TITLE}
              </Text>
              <View style={s.importantItemsInputRow}>
                <TextInput
                  style={s.importantItemsInput}
                  value={importantItemDraft}
                  onChangeText={setImportantItemDraft}
                  placeholder={IMPORTANT_ITEMS_PLACEHOLDER}
                  placeholderTextColor="#94a3b8"
                  textAlign={rtl.inputTextAlign}
                  returnKeyType="done"
                  onSubmitEditing={handleAddImportantItem}
                  accessible={true}
                  accessibilityLabel={IMPORTANT_ITEMS_SECTION_TITLE}
                />
                <Pressable
                  style={s.importantItemsAddBtn}
                  onPress={handleAddImportantItem}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={IMPORTANT_ITEMS_ADD_LABEL}
                >
                  <Text style={s.importantItemsAddText}>
                    {IMPORTANT_ITEMS_ADD_LABEL}
                  </Text>
                </Pressable>
              </View>
              {(event.importantItems ?? []).length > 0 ? (
                <View style={s.importantItemsList}>
                  {(event.importantItems ?? []).map((item) => (
                    <View key={item.id} style={s.importantItemsRow}>
                      <Text style={s.importantItemsBulletText}>
                        {item.title}
                      </Text>
                      <Pressable
                        style={s.importantItemsRemoveBtn}
                        onPress={() => handleRemoveImportantItem(item.id)}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="הסר"
                      >
                        <Text style={s.importantItemsRemoveText}>×</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {showRsvpSection ? (
            <View style={s.rsvpSection}>
              <View style={s.rsvpHeaderRow}>
                <View style={s.rsvpTextBlock}>
                  <Text style={s.rsvpTitle}>נדרש אישור הגעה</Text>
                  <Text style={s.rsvpDescription}>
                    לבקש מחברי הקהילה לאשר הגעה לאירוע?
                  </Text>
                </View>
                <View style={s.rsvpIconCircle}>
                  <MaterialIcons name="how-to-reg" size={20} color={PRIMARY} />
                </View>
              </View>
              <View style={s.rsvpToggleRow}>
                <Text style={s.rsvpToggleText}>נדרש אישור הגעה</Text>
                <Switch
                  value={rsvpRequired}
                  onValueChange={(val) => {
                    setIsDirty(true);
                    onRsvpRequiredChange?.(val);
                  }}
                  trackColor={{ true: PRIMARY, false: '#e2e8f0' }}
                  thumbColor="#fff"
                  accessible={true}
                  accessibilityLabel="נדרש אישור הגעה"
                />
              </View>
            </View>
          ) : null}

          <View style={{ height: 20 }} />
        </ScrollView>

        {/* ── Sticky footer — inside KAV so it rides above the keyboard ── */}
        {isCreate && (
          <View style={s.footer}>
            {pendingAssignmentSave ? (
              <Text style={{ textAlign: 'right', marginBottom: 8 }}>
                {pendingAssignmentSave.message}
              </Text>
            ) : null}
            <Pressable
              style={[
                s.footerSaveBtn,
                isEditMode && !isDirty && s.footerSaveBtnNotDirty,
                (!event.title.trim() || isSaving) && s.footerSaveBtnDisabled,
              ]}
              onPress={handleSave}
              disabled={
                !event.title.trim() || isSaving || (isEditMode && !isDirty)
              }
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={isSaving ? 'שמירה...' : pendingAssignmentSave ? 'ניסיון נוסף להשלמת השיוך' : 'שמור אירוע'}
            >
              <Text
                style={[
                  s.footerSaveBtnText,
                  isEditMode && !isDirty && s.footerSaveBtnTextDisabled,
                  (!event.title.trim() || isSaving) &&
                    s.footerSaveBtnTextDisabled,
                ]}
              >
                {isSaving ? 'שמירה...' : pendingAssignmentSave ? 'ניסיון נוסף להשלמת השיוך' : 'שמור אירוע'}
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Share FAB */}
      {!isCreate && (
        <Pressable
          style={s.shareFab}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="שתף אירוע"
        >
          <MaterialIcons name="share" size={22} color="#64748b" />
        </Pressable>
      )}

      {/* ── Custom discard confirmation modal (RTL-safe, replaces Alert) ── */}
      <Modal
        visible={discardOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDiscardOpen(false)}
      >
        <Pressable
          style={s.discardOverlay}
          onPress={() => setDiscardOpen(false)}
          accessible={false}
        >
          <Pressable style={s.discardBox} onPress={() => undefined}>
            <Text style={s.discardTitle}>
              {pendingAssignmentSave ? 'יציאה אחרי שמירה חלקית' : initialData ? 'ביטול שינויים' : 'יציאה ללא שמירה'}
            </Text>
            <Text style={s.discardMessage}>
              {pendingAssignmentSave
                ? 'השינויים שכבר נשמרו יישארו. עדכוני השיוך שנותרו לא יישמרו ביציאה. לצאת?'
                : initialData
                ? 'האם ברצונך לבטל את השינויים שביצעת?'
                : 'האם ברצונך למחוק את הנתונים שהכנסת?'}
            </Text>
            <View style={s.discardDivider} />
            <View style={s.discardBtns}>
              <Pressable
                style={s.discardBtnDestructive}
                onPress={confirmDiscard}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={pendingAssignmentSave ? 'יציאה' : initialData ? 'בטל שינויים' : 'מחק וצא'}
              >
                <Text style={s.discardBtnDestructiveText}>
                  {pendingAssignmentSave ? 'יציאה' : initialData ? 'בטל שינויים' : 'מחק וצא'}
                </Text>
              </Pressable>
              <View style={s.discardBtnDivider} />
              <Pressable
                style={s.discardBtnCancel}
                onPress={() => setDiscardOpen(false)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="המשך עריכה"
              >
                <Text style={s.discardBtnCancelText}>המשך עריכה</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* FIXED: success/share sheet — shown after personal event is saved */}
      {locationOverlay ? (
        <LocationSuggestionOverlay
          anchor={locationOverlay}
          keyboardHeight={keyboardHeight}
        />
      ) : null}
      <Modal
        visible={savedEvent !== null}
        transparent
        animationType="slide"
        onRequestClose={handleSuccessDone}
      >
        <View style={s.successOverlay}>
          <View style={s.successSheet}>
            {/* Grabber */}
            <View style={s.successGrabber} />

            {/* Checkmark + headline */}
            <View style={s.successHeader}>
              <View style={s.successCheckCircle}>
                <MaterialIcons name="check" size={28} color="#fff" />
              </View>
              <Text style={s.successHeadline}>האירוע נשמר!</Text>
            </View>

            {/* Event summary */}
            {savedEvent && (
              <View style={s.successCard}>
                <Text style={s.successEventTitle} numberOfLines={2}>
                  {savedEvent.title}
                </Text>
                <View style={s.successDetailRow}>
                  <MaterialIcons
                    name="calendar-today"
                    size={15}
                    color={PRIMARY}
                  />
                  <Text style={s.successDetailText}>
                    {new Date(savedEvent.date).toLocaleDateString('he-IL', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </Text>
                </View>
                {!savedEvent.isAllDay && savedEvent.startTime && (
                  <View style={s.successDetailRow}>
                    <MaterialIcons name="schedule" size={15} color={PRIMARY} />
                    <Text style={s.successDetailText}>
                      {savedEvent.startTime}
                      {savedEvent.endTime ? ` — ${savedEvent.endTime}` : ''}
                    </Text>
                  </View>
                )}
                {savedEvent.location ? (
                  <View style={s.successDetailRow}>
                    <MaterialIcons name="place" size={15} color={PRIMARY} />
                    <Text style={s.successDetailText} numberOfLines={1}>
                      {savedEvent.location}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* CTA buttons */}
            <Pressable
              style={s.successShareBtn}
              onPress={handleSuccessShare}
              disabled={isSharing}
              accessible
              accessibilityRole="button"
              accessibilityLabel="שיתוף האירוע"
            >
              {isSharing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="share" size={20} color="#fff" />
                  <Text style={s.successShareBtnText}>שיתוף האירוע</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={s.successDoneBtn}
              onPress={handleSuccessDone}
              accessible
              accessibilityRole="button"
              accessibilityLabel="סיום"
            >
              <Text style={s.successDoneBtnText}>סיום</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ─── Recurrence Row (inline) ─── */

export function RecurrenceRow({
  value,
  onChange,
}: {
  value: RecurrenceType;
  onChange: (v: RecurrenceType) => void;
}): React.JSX.Element {
  const labels: Record<RecurrenceType, string> = {
    none: 'לא',
    daily: 'כל יום',
    weekly: 'כל שבוע',
    monthly: 'כל חודש',
    yearly: 'כל שנה',
  };
  const options: RecurrenceType[] = [
    'none',
    'daily',
    'weekly',
    'monthly',
    'yearly',
  ];

  const [open, setOpen] = useState(false);

  return (
    <View style={s.card}>
      <Pressable
        style={s.recurrenceRow}
        onPress={() => setOpen(!open)}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`אירוע חוזר: ${labels[value]}`}
      >
        <Text style={s.recurrenceText}>אירוע חוזר: {labels[value]}</Text>
        <MaterialIcons name="expand-more" size={24} color="#94a3b8" />
      </Pressable>
      {open && (
        <View style={s.recurrenceOptions}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              style={[
                s.recurrenceOption,
                value === opt && s.recurrenceOptionActive,
              ]}
              onPress={() => {
                onChange(opt);
                setOpen(false);
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={labels[opt]}
            >
              <Text
                style={[
                  s.recurrenceOptionText,
                  value === opt && s.recurrenceOptionTextActive,
                ]}
              >
                {labels[opt]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/* ─── Styles ─── */

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f8f8' },
  safeAreaRtl: {
    direction: 'rtl',
  },
  flex: { flex: 1 },
  header: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f6f8f8',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111517',
    textAlign: rtl.textAlign,
  },
  // ── Sticky bottom save CTA ────────────────────────────────────────────────
  footer: {
    backgroundColor: '#f6f8f8',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  footerSaveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  footerSaveBtnDisabled: {
    backgroundColor: '#e5e7eb',
  },
  footerSaveBtnNotDirty: {
    backgroundColor: '#d1d5db',
  },
  footerSaveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  footerSaveBtnTextDisabled: {
    color: '#6b7280',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 4 },
  titleSection: { marginBottom: 10 },
  titleInput: {
    fontSize: 17,
    fontWeight: '500',
    color: '#0f172a',
    textAlign: rtl.inputTextAlign,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  titleInputError: {
    borderWidth: 1.5,
    borderColor: '#ef4444',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: rtl.textAlign,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  rsvpSection: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    gap: 14,
  },
  rsvpHeaderRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
  },
  rsvpTextBlock: {
    flex: 1,
    alignItems: needsExplicitRTL() ? 'flex-end' : 'flex-start',
    gap: 4,
  },
  rsvpTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  rsvpDescription: {
    fontSize: 13,
    color: '#64748b',
    textAlign: rtl.textAlign,
    lineHeight: 18,
  },
  rsvpIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpToggleRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rsvpToggleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  importantItemsSection: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    gap: 12,
  },
  importantItemsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  importantItemsInputRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 8,
  },
  importantItemsInput: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    textAlign: rtl.inputTextAlign,
  },
  importantItemsAddBtn: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importantItemsAddText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  importantItemsList: {
    gap: 8,
  },
  importantItemsRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  importantItemsBulletText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    textAlign: rtl.textAlign,
    lineHeight: 20,
  },
  importantItemsRemoveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importantItemsRemoveText: {
    fontSize: 22,
    color: '#94a3b8',
    lineHeight: 24,
    fontWeight: '500',
  },
  recurrenceRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recurrenceText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  recurrenceOptions: {
    marginTop: 10,
    gap: 2,
  },
  recurrenceOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  recurrenceOptionActive: {
    backgroundColor: '#e8f5fd',
  },
  recurrenceOptionText: {
    fontSize: 15,
    color: '#475569',
    textAlign: rtl.textAlign,
  },
  recurrenceOptionTextActive: {
    color: PRIMARY,
    fontWeight: '700',
  },
  shareFab: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  // ── Discard modal ─────────────────────────────────────────────────────────
  discardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  discardBox: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  discardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  discardMessage: {
    fontSize: 14,
    color: '#374151',
    textAlign: rtl.textAlign,
    paddingHorizontal: 20,
    paddingBottom: 20,
    lineHeight: 20,
  },
  discardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e8f0',
  },
  discardBtns: {
    flexDirection: rtl.flexDirection,
  },
  discardBtnDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e8f0',
  },
  discardBtnDestructive: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  discardBtnDestructiveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ef4444',
    textAlign: 'center',
  },
  discardBtnCancel: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  discardBtnCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: PRIMARY,
    textAlign: 'center',
  },

  // ── Success / share sheet (FIXED) ──────────────────────────────────────────
  successOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.30)',
  },
  successSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 16,
    gap: 16,
  },
  successGrabber: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d7dee8',
    alignSelf: 'center',
    marginBottom: 4,
  },
  successHeader: {
    alignItems: 'center',
    gap: 10,
  },
  successCheckCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successHeadline: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },
  successCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  successEventTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  successDetailRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-start',
  },
  successDetailText: {
    fontSize: 13,
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  successShareBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    height: 52,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  successShareBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  successDoneBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successDoneBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
});

// ─── LocationSuggestionOverlay ─────────────────────────────────────────────────
//
// Renders the autocomplete suggestion list at the SafeAreaView root level so it
// is never clipped by the inner ScrollView or hidden behind the sticky save footer.
// Positioning: below the input when there is enough room, above it otherwise.

const SUGGESTION_ROW_H = 50;
const MIN_VISIBLE_ROWS = 3;

function LocationSuggestionOverlay({
  anchor,
  keyboardHeight,
}: {
  anchor: LocationOverlayAnchor;
  keyboardHeight: number;
}): React.JSX.Element {
  const { height: screenHeight } = useWindowDimensions();

  const inputBottom = anchor.inputY + anchor.inputHeight;
  // 8 px gap between input edge and suggestion list
  const GAP = 8;
  // Reserve a small bottom margin so the list doesn't touch the keyboard edge
  const BOTTOM_MARGIN = 8;

  const spaceBelow =
    screenHeight - keyboardHeight - inputBottom - GAP - BOTTOM_MARGIN;
  const spaceAbove = anchor.inputY - GAP - BOTTOM_MARGIN;

  const showBelow = spaceBelow >= SUGGESTION_ROW_H * MIN_VISIBLE_ROWS;

  const maxHeight = Math.max(
    SUGGESTION_ROW_H,
    Math.min(
      SUGGESTION_ROW_H * anchor.suggestions.length,
      showBelow ? spaceBelow : spaceAbove
    )
  );

  const overlayTop = showBelow ? inputBottom + GAP : undefined;
  const overlayBottom = showBelow
    ? undefined
    : screenHeight - anchor.inputY + GAP;

  return (
    // Transparent fill layer — `pointerEvents="box-none"` so taps on empty
    // areas fall through to the form underneath.
    <View style={overlay.fill} pointerEvents="box-none">
      <View
        style={[
          overlay.list,
          {
            left: anchor.inputX,
            width: anchor.inputWidth,
            maxHeight,
            ...(overlayTop !== undefined ? { top: overlayTop } : {}),
            ...(overlayBottom !== undefined ? { bottom: overlayBottom } : {}),
          },
        ]}
        pointerEvents="auto"
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={
            anchor.suggestions.length > MIN_VISIBLE_ROWS
          }
          bounces={false}
        >
          {anchor.suggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion.placeId}
              style={[
                overlay.row,
                index < anchor.suggestions.length - 1 && overlay.rowSep,
              ]}
              onPressIn={anchor.onPressIn}
              onPress={() => anchor.onSelect(suggestion)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`בחרי כתובת: ${suggestion.description}`}
            >
              <Text style={overlay.rowText} numberOfLines={2}>
                {suggestion.description}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const overlay = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // must sit above the sticky footer (zIndex 1) and card headers
    zIndex: 9999,
    elevation: 20,
  },
  list: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    overflow: 'hidden',
  },
  row: {
    minHeight: SUGGESTION_ROW_H,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  rowSep: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  rowText: {
    fontSize: 14,
    color: '#111827',
    textAlign: rtl.textAlign,
  },
});
