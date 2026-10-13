import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { borderRadius, shadows } from '@/constants/theme';
import { rtl } from '@/lib/rtl';
import { colors as tc } from '@/theme/colors';
import { api } from '../../convex/_generated/api';
import { useGoogleCalendarAuth } from '../../lib/hooks/useGoogleCalendarAuth';
import { useGoogleCalendarList } from '../../lib/hooks/useGoogleCalendarList';
import { useGoogleCalendarPreview } from '../../lib/hooks/useGoogleCalendarPreview';
import { useStartupDestinationReady } from '../../lib/hooks/useStartupDestinationReady';
import {
  importTrace,
  nextImportTraceInstanceId,
} from '../../lib/importFlowTrace';
import type {
  NormalizedEvent,
  PastRange,
} from '../../lib/services/googleCalendarEvents';
import { persistImportHolidaySelection } from '../../lib/services/googleImportHolidayPersistence';
import { HOLIDAY_CATEGORY_DEFINITIONS } from '../../lib/services/holidayCategoryDefinitions';
import type { EventSection } from '../../lib/services/importFlowUtils';
import {
  formatEventStartLabel,
  getDisplayDateRange,
  getMonthCheckState,
  getRangeSummaryText,
  groupEventsByMonth,
} from '../../lib/services/importFlowUtils';
import { loadHolidayOverlayPreferences } from '../../lib/storage/holidayOverlayPreferences';
import type { HolidayCategoryId } from '../../lib/types/holidayOverlay';

// ─── Stage & step types ───────────────────────────────────────────────────────

type ImportStage =
  | 'connect_google'
  | 'step1'
  | 'holidays'
  | 'step2'
  | 'step3'
  | 'success';
type StepStatus = 'completed' | 'active' | 'future';

function resolveStepStatus(
  stepNum: 1 | 2 | 3 | 4,
  stage: ImportStage
): StepStatus {
  if (stage === 'success') return 'completed';
  if (stage === 'connect_google') return 'future';
  const order: Record<Exclude<ImportStage, 'connect_google'>, number> = {
    step1: 1,
    holidays: 2,
    step2: 3,
    step3: 4,
    success: 5,
  };
  const current = order[stage];
  if (stepNum < current) return 'completed';
  if (stepNum === current) return 'active';
  return 'future';
}

// ─── Chips constant (RTL order: 'none' first → appears on right) ─────────────

const RANGE_CHIPS: ReadonlyArray<{ value: PastRange; label: string }> = [
  { value: 'none', label: 'מהיום' },
  { value: 'two_months', label: 'חודשיים אחורה' },
  { value: 'one_year', label: 'שנה אחורה' },
] as const;

// Derived tints of the shared theme tokens (no extra hex values): warning
// surface for non-blocking notices and a muted unchecked-checkbox border.
const WARNING_TINT = `${tc.warning}1F`;
const CHECK_BORDER = `${tc.textSecondary}80`;
// Official Google brand blue — only used for the "G" mark, never recolored.
const GOOGLE_BLUE = '#4285F4';

// ─── Progress bar ─────────────────────────────────────────────────────────────

const STEP_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'יומנים וטווח',
  2: 'חגים',
  3: 'בחירת אירועים',
  4: 'סיכום ואישור',
};

function ImportProgressBar({
  stage,
}: {
  stage: ImportStage;
}): React.JSX.Element {
  const steps: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
  return (
    <View style={s.progressBar}>
      {/* horizontal connector track spans the full bar; rendered first so it
          sits behind the dots */}
      <View style={s.progressTrack} />
      {steps.map((stepNum, idx) => {
        const status = resolveStepStatus(stepNum, stage);
        return (
          <View key={stepNum} style={s.progressStep}>
            {/* connector line — rendered before the dot so it appears behind */}
            {idx > 0 && (
              <View
                style={[
                  s.progressConnector,
                  resolveStepStatus((stepNum - 1) as 1 | 2 | 3 | 4, stage) ===
                    'completed' && s.progressConnectorDone,
                ]}
              />
            )}
            <View
              style={[
                s.progressDot,
                status === 'completed' && s.progressDotDone,
                status === 'active' && s.progressDotActive,
              ]}
            />
            <Text
              style={[
                s.progressLabel,
                status === 'active' && s.progressLabelActive,
                status === 'completed' && s.progressLabelDone,
              ]}
              numberOfLines={2}
            >
              {STEP_LABELS[stepNum]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Calendar row ─────────────────────────────────────────────────────────────

type CalendarRowProps = {
  title: string;
  isPrimary: boolean;
  isSelected: boolean;
  onToggle: () => void;
};

function CalendarRow({
  title,
  isPrimary,
  isSelected,
  onToggle,
}: CalendarRowProps): React.JSX.Element {
  const a11yLabel = isPrimary ? `${title} – יומן ראשי` : title;
  return (
    <Pressable
      style={[s.calendarItem, isSelected && s.calendarItemSelected]}
      onPress={onToggle}
      accessible={true}
      accessibilityRole="checkbox"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ checked: isSelected }}
    >
      {/* RTL: checkbox leads (right), title fills, badge trails (left) */}
      <View style={s.calendarItemInner}>
        <View style={[s.calendarCheck, isSelected && s.calendarCheckActive]}>
          {isSelected ? (
            <MaterialIcons name="check" size={14} color={tc.textOnPrimary} />
          ) : null}
        </View>
        <Text style={s.calendarTitle} numberOfLines={2}>
          {title}
        </Text>
        {isPrimary ? (
          <View style={s.primaryBadge}>
            <Text style={s.primaryBadgeText}>יומן ראשי</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Month section header ─────────────────────────────────────────────────────

type MonthSectionHeaderProps = {
  section: EventSection;
  selectedIds: Set<string>;
  onToggleMonth: (section: EventSection) => void;
};

function MonthSectionHeader({
  section,
  selectedIds,
  onToggleMonth,
}: MonthSectionHeaderProps): React.JSX.Element {
  const checkState = getMonthCheckState(section.data, selectedIds);
  const selected = section.data.filter((e) =>
    selectedIds.has(e.localId)
  ).length;
  const total = section.data.length;

  let selectionLabel: string;
  if (checkState === 'all') selectionLabel = `${total} נבחרו`;
  else if (checkState === 'none') selectionLabel = 'לא נבחרו אירועים';
  else selectionLabel = `${selected} מתוך ${total} נבחרו`;

  return (
    <Pressable
      style={s.monthHeader}
      onPress={() => onToggleMonth(section)}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${section.title} — ${selectionLabel}`}
    >
      {/* RTL: checkbox leads (right), text trails — same column as event rows */}
      <View
        style={[
          s.monthCheckbox,
          checkState === 'all' && s.monthCheckboxChecked,
          checkState === 'some' && s.monthCheckboxMixed,
        ]}
      >
        {checkState === 'all' ? (
          <MaterialIcons name="check" size={13} color={tc.textOnPrimary} />
        ) : checkState === 'some' ? (
          <View style={s.monthMixedBar} />
        ) : null}
      </View>
      <View style={s.monthHeaderText}>
        <Text style={s.monthTitle}>{section.title}</Text>
        <Text style={s.monthMeta}>
          {total} אירועים · {selectionLabel}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

type EventRowProps = {
  event: NormalizedEvent;
  isSelected: boolean;
  onToggle: () => void;
};

function EventRow({
  event,
  isSelected,
  onToggle,
}: EventRowProps): React.JSX.Element {
  const startLabel = formatEventStartLabel(event.startIso, event.isAllDay);
  return (
    <Pressable
      style={[s.eventRow, isSelected && s.eventRowSelected]}
      onPress={onToggle}
      accessible={true}
      accessibilityRole="checkbox"
      accessibilityLabel={
        startLabel !== '' ? `${event.title}, ${startLabel}` : event.title
      }
      accessibilityState={{ checked: isSelected }}
    >
      <View style={s.eventRowInner}>
        <View style={[s.eventCheck, isSelected && s.eventCheckActive]}>
          {isSelected ? (
            <MaterialIcons name="check" size={12} color={tc.textOnPrimary} />
          ) : null}
        </View>
        <View style={s.eventRowText}>
          <Text style={s.eventTitle} numberOfLines={2}>
            {event.title}
          </Text>
          {startLabel !== '' ? (
            <Text style={s.eventMeta} numberOfLines={1}>
              {startLabel}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

// ─── Final summary row ────────────────────────────────────────────────────────

type SummaryRowProps = {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  detail: string;
  /** When omitted, the row is a plain (non-editable) info row. */
  onEdit?: () => void;
};

function SummaryRow({
  icon,
  title,
  detail,
  onEdit,
}: SummaryRowProps): React.JSX.Element {
  return (
    <View style={s.summaryRow}>
      <View style={s.summaryRowIcon}>
        <MaterialIcons name={icon} size={20} color={tc.primary} />
      </View>
      <View style={s.summaryRowText}>
        <Text style={s.summaryRowTitle}>{title}</Text>
        <Text style={s.summaryRowDetail} numberOfLines={5}>
          {detail}
        </Text>
      </View>
      {onEdit ? (
        <Pressable
          style={s.summaryEditBtn}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          onPress={onEdit}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`שינוי — ${title}`}
        >
          <Text style={s.summaryEditText}>שינוי</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Onboarding: "continue without import" link ───────────────────────────────
// Only rendered while the Calendar Import onboarding step is pending. It is the
// explicit escape hatch for every failure/empty state so a user is never
// trapped outside the app.

function OnboardingContinueLink({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      style={s.backLink}
      onPress={onPress}
      disabled={disabled}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel="להמשיך ל־InYomi בלי להעתיק אירועים"
      accessibilityState={{ disabled }}
    >
      <Text style={s.backLinkText}>להמשיך בלי להעתקה</Text>
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ImportCalendarScreen(): React.JSX.Element {
  const router = useRouter();

  // ── Calendar Import onboarding mode ──────────────────────────────────────────
  // This screen doubles as the final onboarding step (before first Home) while
  // userStatus.calendarImportPromptPending is true. That flag is false for
  // Settings/Home entries (and for every pre-existing user), so those entry
  // points keep their current behavior. The mode is kept "sticky" for the
  // focus session so the UI does not flip back to normal mode in the moment
  // between the step resolving and the authenticated layout leaving this
  // screen (the layout owns that navigation — never router.back()).
  const userStatus = useQuery(api.users.getCurrentUserStatus);
  const resolveCalendarPrompt = useMutation(
    api.onboarding.resolveCalendarImportPrompt
  );
  const isStepPending = userStatus?.calendarImportPromptPending === true;
  const [stickyOnboarding, setStickyOnboarding] = useState(false);
  useEffect(() => {
    if (isStepPending) setStickyOnboarding(true);
  }, [isStepPending]);
  const isOnboardingMode = isStepPending || stickyOnboarding;
  // On a cold start a pending user is redirected here by the authenticated
  // layout, so this screen is then the finite startup destination and must
  // report readiness (otherwise the native splash would wait for the
  // emergency timer). Disabled for Settings/Home entries.
  const { onLayout: onDestinationLayout } = useStartupDestinationReady(
    'calendar-import-onboarding',
    { enabled: isOnboardingMode }
  );
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolveInFlightRef = useRef(false);
  // True once an import was attempted in this focus session — distinguishes a
  // fresh import (show a short confirmation) from a recovery launch where the
  // import had already been committed earlier (resolve and continue silently).
  const importAttemptedRef = useRef(false);

  // ── Convex queries/mutations ─────────────────────────────────────────────────
  const alreadyImported = useQuery(api.googleImport.hasCompletedGoogleImport);
  const importMutation = useMutation(api.googleImport.importGoogleCalendar);

  // ── Stage machine ────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<ImportStage>('connect_google');

  // ── OAuth hook ───────────────────────────────────────────────────────────────
  const {
    status,
    accessToken,
    errorMessage,
    startAuthorization,
    clearAuthorization,
  } = useGoogleCalendarAuth();

  // ── TEMPORARY diagnostics (lib/importFlowTrace.ts) ───────────────────────────
  // Remove once the onboarding "returns to intro after Google" bug is fixed.
  const screenTraceIdRef = useRef<number>(0);
  if (screenTraceIdRef.current === 0) {
    screenTraceIdRef.current = nextImportTraceInstanceId();
  }
  const screenTraceId = screenTraceIdRef.current;
  useEffect(() => {
    importTrace('screen_mount', { screenId: screenTraceId });
    const appStateSub = AppState.addEventListener('change', (next) => {
      importTrace('app_state', { screenId: screenTraceId, state: next });
    });
    return () => {
      appStateSub.remove();
      importTrace('screen_unmount', { screenId: screenTraceId });
    };
  }, [screenTraceId]);
  useEffect(() => {
    importTrace('screen_state', {
      screenId: screenTraceId,
      stage,
      authStatus: status,
      hasAccessToken: accessToken !== null,
      isOnboardingMode,
      calendarImportPromptPending: userStatus?.calendarImportPromptPending,
      stickyOnboarding,
    });
  }, [
    screenTraceId,
    stage,
    status,
    accessToken,
    isOnboardingMode,
    userStatus?.calendarImportPromptPending,
    stickyOnboarding,
  ]);

  // ── Calendar list hook ───────────────────────────────────────────────────────
  // Google's own holiday calendars are already excluded from `calendars` by
  // the hook — InYomi is the holiday source of truth (see
  // lib/services/googleHolidayCalendarFilter.ts).
  const {
    status: listStatus,
    calendars,
    filteredHolidayCount,
    reload: reloadCalendars,
  } = useGoogleCalendarList(accessToken);

  // ── Calendar selection ───────────────────────────────────────────────────────
  const [selectedCalIds, setSelectedCalIds] = useState<Set<string>>(
    new Set<string>()
  );
  const initialPreselectionDoneRef = useRef(false);

  useEffect(() => {
    if (listStatus !== 'ready' || initialPreselectionDoneRef.current) return;
    initialPreselectionDoneRef.current = true;
    const primary = calendars.find((c) => c.isPrimary);
    if (primary) setSelectedCalIds(new Set<string>([primary.id]));
  }, [listStatus, calendars]);

  const toggleCalendar = useCallback((id: string): void => {
    setSelectedCalIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Date-range chip ──────────────────────────────────────────────────────────
  const [pastRange, setPastRange] = useState<PastRange>('two_months');

  // ── InYomi holiday-category selection (holidays stage) ───────────────────────
  // Hydrated from the existing overlay preferences the first time the user
  // reaches the holidays stage, so re-entering the import flow reflects
  // whatever the user already chose in the standalone holiday settings screen.
  const [selectedHolidayCategories, setSelectedHolidayCategories] = useState<
    Set<HolidayCategoryId>
  >(new Set<HolidayCategoryId>());
  const holidayPrefsHydratedRef = useRef(false);

  // ── Preview hook ─────────────────────────────────────────────────────────────
  const {
    status: previewStatus,
    result: previewResult,
    startPreview,
    retry: retryPreview,
    clear: clearPreview,
  } = useGoogleCalendarPreview();

  // ── Step-2 event selection ───────────────────────────────────────────────────
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(
    new Set<string>()
  );

  // ── Import state ─────────────────────────────────────────────────────────────
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Non-blocking: true only when the Google import succeeded but the
  // holiday-category preference failed to persist to local storage. The
  // import itself is never rolled back or marked as failed for this.
  const [holidayPreferenceWarning, setHolidayPreferenceWarning] =
    useState(false);

  // ── Auto-transition: connect_google → step1 ──────────────────────────────────
  // Fires once the OAuth token is live and the calendar list has resolved
  // (to any terminal state: ready, empty, or error).
  useEffect(() => {
    if (stage !== 'connect_google') return;
    if (status !== 'authorized') return;
    if (
      listStatus === 'ready' ||
      listStatus === 'empty' ||
      listStatus === 'error'
    ) {
      setStage('step1');
    }
  }, [stage, status, listStatus]);

  // ── Auto-transition: holidays (loading preview) → step2 ──────────────────────
  useEffect(() => {
    if (
      stage !== 'holidays' ||
      previewStatus !== 'done' ||
      previewResult === null
    )
      return;
    // Pre-select all events before moving to step2.
    if (previewResult.kind === 'success') {
      setSelectedEventIds(
        new Set<string>(previewResult.events.map((e) => e.localId))
      );
    }
    setStage('step2');
  }, [stage, previewStatus, previewResult]);

  // ── Hydrate holiday-category selection on first entry to the holidays stage ──
  useEffect(() => {
    if (stage !== 'holidays' || holidayPrefsHydratedRef.current) return;
    holidayPrefsHydratedRef.current = true;
    let cancelled = false;
    (async (): Promise<void> => {
      const prefs = await loadHolidayOverlayPreferences();
      if (!cancelled) {
        setSelectedHolidayCategories(new Set(prefs.enabledCategories));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // ── Cleanup on screen blur ────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      return () => {
        importTrace('screen_blur_cleanup', { screenId: screenTraceId });
        clearAuthorization();
        clearPreview();
        setStage('connect_google');
        setSelectedCalIds(new Set<string>());
        setSelectedEventIds(new Set<string>());
        setSelectedHolidayCategories(new Set<HolidayCategoryId>());
        setPastRange('two_months');
        setImportError(null);
        setHolidayPreferenceWarning(false);
        initialPreselectionDoneRef.current = false;
        holidayPrefsHydratedRef.current = false;
        setStickyOnboarding(false);
        setResolveError(null);
        importAttemptedRef.current = false;
      };
    }, [clearAuthorization, clearPreview, screenTraceId])
  );

  // ── Onboarding: resolve the step (import done OR skipped) ────────────────────
  // Persists calendarImportPromptResolvedAt server-side. Navigation to Home is
  // NOT done here: the authenticated layout leaves this screen once the
  // server flag flips (avoids the router.back()/redirect race).
  const handleResolveCalendarStep = useCallback(async (): Promise<void> => {
    if (resolveInFlightRef.current) return;
    resolveInFlightRef.current = true;
    setIsResolving(true);
    setResolveError(null);
    try {
      await resolveCalendarPrompt({});
    } catch {
      setResolveError('לא הצלחנו להמשיך כרגע. אפשר לנסות שוב.');
    } finally {
      resolveInFlightRef.current = false;
      setIsResolving(false);
    }
  }, [resolveCalendarPrompt]);

  // Recovery: the Google import was already committed (e.g. the app was
  // closed before navigation) but the step is still unresolved — resolve it
  // and continue to Home without importing again.
  const importAlreadyCompleted = alreadyImported?.completed === true;
  useEffect(() => {
    if (!isStepPending || !importAlreadyCompleted) return;
    if (importAttemptedRef.current) return;
    void handleResolveCalendarStep();
  }, [isStepPending, importAlreadyCompleted, handleResolveCalendarStep]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleChipSelect = useCallback(
    (value: PastRange): void => {
      setPastRange(value);
      // Clear stale preview/event selections when the range changes.
      clearPreview();
      setSelectedEventIds(new Set<string>());
    },
    [clearPreview]
  );

  const handleStartPreview = useCallback((): void => {
    if (!accessToken || selectedCalIds.size === 0) return;
    const targets = calendars
      .filter((c) => selectedCalIds.has(c.id))
      .map((c) => ({ id: c.id, title: c.title }));
    startPreview(targets, pastRange, accessToken);
  }, [accessToken, selectedCalIds, calendars, pastRange, startPreview]);

  const handleToggleMonth = useCallback(
    (section: EventSection): void => {
      const checkState = getMonthCheckState(section.data, selectedEventIds);
      setSelectedEventIds((prev) => {
        const next = new Set<string>(prev);
        if (checkState === 'all') {
          for (const e of section.data) next.delete(e.localId);
        } else {
          for (const e of section.data) next.add(e.localId);
        }
        return next;
      });
    },
    [selectedEventIds]
  );

  const handleToggleEvent = useCallback((localId: string): void => {
    setSelectedEventIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  }, []);

  const toggleHolidayCategory = useCallback((id: HolidayCategoryId): void => {
    setSelectedHolidayCategories((prev) => {
      const next = new Set<HolidayCategoryId>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Persists the holiday-category selection made in the import flow to the
   * same AsyncStorage preferences the standalone holiday-overlay settings
   * screen reads/writes (see lib/services/googleImportHolidayPersistence.ts
   * for the exact sequence). Never throws — a preference-storage failure
   * must not block or fail the (irreversible, one-time) Google Calendar
   * import itself. Returns whether persistence fully succeeded so the
   * caller can surface a non-blocking warning when it did not.
   */
  const persistHolidaySelection = useCallback((): Promise<boolean> => {
    return persistImportHolidaySelection(selectedHolidayCategories);
  }, [selectedHolidayCategories]);

  const handleImport = useCallback(async (): Promise<void> => {
    if (
      previewResult === null ||
      previewResult.kind !== 'success' ||
      selectedEventIds.size === 0
    )
      return;
    setIsImporting(true);
    setImportError(null);
    setHolidayPreferenceWarning(false);
    importAttemptedRef.current = true;
    try {
      const eventsToImport = previewResult.events
        .filter((e) => selectedEventIds.has(e.localId))
        .map((e) => ({
          title: e.title,
          startIso: e.startIso,
          endIso: e.endIso,
          isAllDay: e.isAllDay,
          location: e.location,
          onlineUrl: e.onlineUrl,
        }));
      // Google import completes first and is authoritative: its success is
      // never rolled back or converted into a failure by a subsequent
      // holiday-preference storage failure (see persistHolidaySelection).
      await importMutation({ events: eventsToImport });
      const holidayPrefsPersisted = await persistHolidaySelection();
      setHolidayPreferenceWarning(!holidayPrefsPersisted);
      setStage('success');
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'שגיאה בייבוא. אפשר לנסות שוב.'
      );
    } finally {
      setIsImporting(false);
    }
  }, [
    previewResult,
    selectedEventIds,
    importMutation,
    persistHolidaySelection,
  ]);

  // ── Derived values ────────────────────────────────────────────────────────────

  const showProgress =
    stage === 'step1' ||
    stage === 'holidays' ||
    stage === 'step2' ||
    stage === 'step3' ||
    stage === 'success';
  const isCalendarLoading = listStatus === 'idle' || listStatus === 'loading';
  const isOAuthLoading = status === 'authorizing' || status === 'exchanging';
  const oAuthLoadingLabel =
    status === 'authorizing' ? 'פותחים חלון אישור...' : 'מאמתים גישה...';
  const { startDateStr, endDateStr } = getDisplayDateRange(pastRange);
  const rangeSummary = getRangeSummaryText(pastRange);
  const activeRangeChipLabel =
    RANGE_CHIPS.find((c) => c.value === pastRange)?.label ?? '';

  const sections: EventSection[] =
    previewResult?.kind === 'success'
      ? groupEventsByMonth(previewResult.events)
      : [];

  const canProceedFromStep1 = selectedCalIds.size > 0 && listStatus === 'ready';
  const isPreviewLoading = previewStatus === 'loading';

  // ── Step3 (final summary) derived display values ────────────────────────────
  const selectedCalendarTitles = calendars
    .filter((c) => selectedCalIds.has(c.id))
    .map((c) => c.title);
  const selectedHolidayLabels = HOLIDAY_CATEGORY_DEFINITIONS.filter((c) =>
    selectedHolidayCategories.has(c.id)
  ).map((c) => c.label);

  // ─────────────────────────────────────────────────────────────────────────────
  // Already completed state
  // ─────────────────────────────────────────────────────────────────────────────
  if (alreadyImported?.completed === true && isOnboardingMode) {
    // Onboarding: never ask to import again. A fresh import shows a short
    // confirmation; a recovery launch resolves automatically (effect above).
    const importedThisSession = importAttemptedRef.current;
    return (
      <SafeAreaView style={s.screen} onLayout={onDestinationLayout}>
        <View style={s.centerStep}>
          {importedThisSession ? (
            <>
              <MaterialIcons name="check-circle" size={72} color={tc.success} />
              <Text style={s.mainTitle}>
                {`הועתקו ${alreadyImported.importedCount} אירועים ל\u2011InYomi!`}
              </Text>
              <Text style={s.subtitle}>האירועים מופיעים עכשיו ביומן.</Text>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={tc.primary} />
              <Text style={s.subtitle}>ממשיכים אל InYomi...</Text>
            </>
          )}
          {resolveError ? (
            <View style={s.inlineError}>
              <Text style={s.inlineErrorText}>{resolveError}</Text>
            </View>
          ) : null}
          {importedThisSession || resolveError ? (
            <Pressable
              style={[s.ctaBtn, s.ctaBtnWide, isResolving && s.ctaBtnDisabled]}
              onPress={() => void handleResolveCalendarStep()}
              disabled={isResolving}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="המשך אל InYomi"
              accessibilityState={{ disabled: isResolving }}
            >
              {isResolving ? (
                <ActivityIndicator size="small" color={tc.textOnPrimary} />
              ) : (
                <Text style={s.ctaBtnText}>המשך</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  if (alreadyImported?.completed === true) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.header}>
          <Pressable
            style={s.backBtn}
            onPress={() => router.back()}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזרה"
          >
            <MaterialIcons
              name="arrow-forward-ios"
              size={20}
              color={tc.textPrimary}
            />
          </Pressable>
          <Text style={s.headerTitle}>העתקת אירועים</Text>
          <View style={s.headerSpacer} />
        </View>
        <View style={s.centerStep}>
          <MaterialIcons name="check-circle" size={72} color={tc.success} />
          <Text style={s.mainTitle}>האירועים כבר הועתקו</Text>
          <Text style={s.subtitle}>
            {`הועתקו ${alreadyImported.importedCount} אירועים ל\u2011InYomi.`}
          </Text>
          <Pressable
            style={s.primaryBtn}
            onPress={() => router.back()}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזרה"
          >
            <Text style={s.primaryBtnText}>חזרה</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.screen} onLayout={onDestinationLayout}>
      {/* ── Custom header ─────────────────────────────────────────────────── */}
      <View style={s.header}>
        {isOnboardingMode ? (
          <View style={s.headerSide} />
        ) : (
          <Pressable
            style={s.backBtn}
            onPress={() => router.back()}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזרה"
          >
            <MaterialIcons
              name="arrow-forward-ios"
              size={20}
              color={tc.textPrimary}
            />
          </Pressable>
        )}
        <Text style={s.headerTitle}>העתקת אירועים</Text>
        {isOnboardingMode ? (
          <Pressable
            style={s.headerSide}
            onPress={() => void handleResolveCalendarStep()}
            disabled={isImporting || isResolving}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="דילוג על העתקת האירועים והמשך אל InYomi"
            accessibilityState={{ disabled: isImporting || isResolving }}
          >
            <Text style={s.headerSkipText}>דילוג</Text>
          </Pressable>
        ) : (
          <View style={s.headerSpacer} />
        )}
      </View>

      {isOnboardingMode && resolveError ? (
        <View style={s.resolveErrorWrap}>
          <View style={s.inlineError}>
            <Text style={s.inlineErrorText}>{resolveError}</Text>
          </View>
        </View>
      ) : null}

      {/* ── Progress bar (step1 → success only) ───────────────────────────── */}
      {showProgress && <ImportProgressBar stage={stage} />}

      {/* ══════════════════════════════════════════════════════════════════════
          connect_google stage
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'connect_google' && (
        <>
          {/* idle: initial CTA */}
          {status === 'idle' && (
            <View style={s.centerStep}>
              <View style={s.googleIconWrap}>
                <View style={s.googleCircle}>
                  <Text style={s.googleLetter}>G</Text>
                </View>
              </View>
              <Text style={s.mainTitle}>
                {isOnboardingMode
                  ? 'רוצים להתחיל עם היומן שכבר יש לכם?'
                  : 'העתקת אירועים מ-Google'}
              </Text>
              <Text style={s.subtitle}>
                {isOnboardingMode
                  ? 'אפשר להעתיק את האירועים מ־Google Calendar ולהתחיל כשכל מה שכבר תכננתם נמצא גם ב־InYomi. ההעתקה היא חד־פעמית, ואפשר לעשות אותה גם אחר כך דרך ההגדרות.'
                  : 'אפשר לבחור אילו אירועים להעתיק ל\u2011InYomi.\nהיומן המקורי ב\u2011Google לא ישתנה.'}
              </Text>
              <Pressable
                style={s.primaryBtn}
                onPress={startAuthorization}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={
                  isOnboardingMode
                    ? 'העתקת אירועים מ־Google Calendar'
                    : 'המשך ל-Google לאישור גישה ליומן'
                }
              >
                <View style={s.googleBtnIcon}>
                  <Text style={s.googleBtnLetter}>G</Text>
                </View>
                <Text style={s.primaryBtnText}>
                  {isOnboardingMode
                    ? 'העתקת אירועים מ־Google'
                    : 'המשך ל־Google'}
                </Text>
              </Pressable>
              {isOnboardingMode ? (
                <Pressable
                  style={s.backLink}
                  onPress={() => void handleResolveCalendarStep()}
                  disabled={isResolving}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="דילוג על העתקת האירועים והמשך אל InYomi"
                  accessibilityState={{ disabled: isResolving }}
                >
                  <Text style={s.backLinkText}>דילוג</Text>
                </Pressable>
              ) : null}
              <View style={s.scopeNote}>
                <MaterialIcons name="lock" size={14} color={tc.textSecondary} />
                <Text style={s.scopeNoteText}>
                  גישה לקריאה בלבד · לא נשמרת סיסמה
                </Text>
              </View>
            </View>
          )}

          {/* authorizing / exchanging */}
          {isOAuthLoading && (
            <View style={s.centerStep}>
              <View style={s.googleIconWrap}>
                <ActivityIndicator size="large" color={tc.primary} />
              </View>
              <Text style={s.mainTitle}>{oAuthLoadingLabel}</Text>
            </View>
          )}

          {/* authorized but calendars still loading */}
          {status === 'authorized' && isCalendarLoading && (
            <View style={s.centerStep}>
              <View style={s.googleIconWrap}>
                <ActivityIndicator size="large" color={tc.primary} />
              </View>
              <Text style={s.mainTitle}>טוענים את היומנים...</Text>
            </View>
          )}

          {/* denied / error */}
          {(status === 'denied' || status === 'error') && (
            <View style={s.centerStep}>
              <View style={s.errorIconWrap}>
                <MaterialIcons
                  name="error-outline"
                  size={56}
                  color={tc.warning}
                />
              </View>
              <Text style={s.errorText}>{errorMessage}</Text>
              <Pressable
                style={s.primaryBtn}
                onPress={clearAuthorization}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="ניסיון נוסף"
              >
                <Text style={s.primaryBtnText}>ניסיון נוסף</Text>
              </Pressable>
              {isOnboardingMode ? (
                <OnboardingContinueLink
                  onPress={() => void handleResolveCalendarStep()}
                  disabled={isResolving}
                />
              ) : null}
            </View>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          step1: calendar selection + range chips + CTA
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'step1' && (
        <ScrollView
          style={s.flex1}
          contentContainerStyle={s.step1Content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Calendar selection ──────────────────────────────────────── */}
          <Text style={s.sectionHeading}>בחירת יומנים</Text>
          <Text style={s.sectionSubtitle}>
            אפשר לבחור יומן אחד או יותר להעתקת אירועים.
          </Text>

          {listStatus === 'error' && (
            <View style={s.inlineError}>
              <Text style={s.inlineErrorText}>לא ניתן לטעון את היומנים.</Text>
              <Pressable
                style={s.inlineRetryBtn}
                onPress={reloadCalendars}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="ניסיון נוסף"
              >
                <Text style={s.inlineErrorRetry}>ניסיון נוסף</Text>
              </Pressable>
            </View>
          )}

          {listStatus === 'empty' && (
            <Text style={s.emptyText}>לא נמצאו יומנים זמינים.</Text>
          )}

          {isOnboardingMode &&
          (listStatus === 'empty' || listStatus === 'error') ? (
            <OnboardingContinueLink
              onPress={() => void handleResolveCalendarStep()}
              disabled={isResolving}
            />
          ) : null}

          {listStatus === 'ready' &&
            calendars.map((cal) => (
              <CalendarRow
                key={cal.id}
                title={cal.title}
                isPrimary={cal.isPrimary}
                isSelected={selectedCalIds.has(cal.id)}
                onToggle={() => toggleCalendar(cal.id)}
              />
            ))}

          {listStatus === 'ready' && (
            <View style={s.holidayNote}>
              <MaterialIcons
                name="info-outline"
                size={14}
                color={tc.textSecondary}
              />
              <Text style={s.holidayNoteText}>
                {filteredHolidayCount > 0
                  ? 'יומני חגים מ-Google לא מוצגים לבחירה — InYomi מציג חגים ישראליים באופן מובנה.'
                  : 'חגים ישראליים מוצגים ב-InYomi באופן מובנה ואינם חלק מבחירת היומנים.'}
              </Text>
            </View>
          )}

          {/* ── Range chips ─────────────────────────────────────────────── */}
          <Text style={[s.sectionHeading, s.mt24]}>כמה אחורה להעתיק?</Text>

          <View style={s.chipsRow}>
            {RANGE_CHIPS.map((chip) => {
              const isActive = pastRange === chip.value;
              return (
                <Pressable
                  key={chip.value}
                  style={[s.chip, isActive && s.chipActive]}
                  onPress={() => handleChipSelect(chip.value)}
                  accessible={true}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={chip.label}
                >
                  <Text style={[s.chipLabel, isActive && s.chipLabelActive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Dynamic summary ─────────────────────────────────────────── */}
          <Text style={s.rangeSummary}>{rangeSummary}</Text>
          <Text style={s.rangeDates}>
            תאריכי הייבוא: {startDateStr} – {endDateStr}
          </Text>

          {/* ── CTA ─────────────────────────────────────────────────────── */}
          <Pressable
            style={[s.ctaBtn, !canProceedFromStep1 && s.ctaBtnDisabled]}
            onPress={() => setStage('holidays')}
            disabled={!canProceedFromStep1}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="המשך"
            accessibilityState={{ disabled: !canProceedFromStep1 }}
          >
            <Text style={s.ctaBtnText}>המשך</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          holidays: InYomi holiday-category selection + preview trigger
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'holidays' && (
        <ScrollView
          style={s.flex1}
          contentContainerStyle={s.step1Content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.sectionHeading}>חגים ישראליים</Text>
          <Text style={s.sectionSubtitle}>
            {
              'InYomi מציג חגים ומועדים ישראליים כשכבה מובנית ביומן — הם אינם מיובאים מ\u2011Google. אפשר לבחור אילו מהם יוצגו, ולשנות זאת בכל עת מהפרופיל.'
            }
          </Text>

          <View style={s.holidayCard}>
            {HOLIDAY_CATEGORY_DEFINITIONS.map((cat, index) => {
              const isEnabled = selectedHolidayCategories.has(cat.id);
              return (
                <React.Fragment key={cat.id}>
                  <Pressable
                    style={s.holidayRow}
                    onPress={() => toggleHolidayCategory(cat.id)}
                    accessible={true}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isEnabled }}
                    accessibilityLabel={cat.label}
                  >
                    <View style={s.holidayRowText}>
                      <Text style={s.holidayRowLabel}>{cat.label}</Text>
                      {cat.subtitle !== undefined && (
                        <Text style={s.holidayRowSubtitle}>{cat.subtitle}</Text>
                      )}
                    </View>
                    <View
                      style={[
                        s.calendarCheck,
                        isEnabled && s.calendarCheckActive,
                      ]}
                    >
                      {isEnabled ? (
                        <MaterialIcons
                          name="check"
                          size={14}
                          color={tc.textOnPrimary}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                  {index < HOLIDAY_CATEGORY_DEFINITIONS.length - 1 && (
                    <View style={s.holidayDivider} />
                  )}
                </React.Fragment>
              );
            })}
          </View>

          {/* ── Preview error ────────────────────────────────────────────── */}
          {previewStatus === 'done' && previewResult?.kind !== 'success' && (
            <View style={s.inlineError}>
              <Text style={s.inlineErrorText}>
                {previewResult?.kind === 'auth_error'
                  ? 'פג תוקף ההרשאה. יש להתחבר מחדש.'
                  : previewResult?.kind === 'network_error'
                    ? 'שגיאת רשת. כדאי לבדוק את החיבור ולנסות שוב.'
                    : 'לא ניתן לטעון את האירועים.'}
              </Text>
              <Pressable
                style={s.inlineRetryBtn}
                onPress={retryPreview}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="ניסיון נוסף"
              >
                <Text style={s.inlineErrorRetry}>ניסיון נוסף</Text>
              </Pressable>
            </View>
          )}

          {/* ── CTA ─────────────────────────────────────────────────────── */}
          <Pressable
            style={[s.ctaBtn, isPreviewLoading && s.ctaBtnDisabled]}
            onPress={handleStartPreview}
            disabled={isPreviewLoading}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="בדיקת אירועים"
            accessibilityState={{ disabled: isPreviewLoading }}
          >
            {isPreviewLoading ? (
              <ActivityIndicator size="small" color={tc.textOnPrimary} />
            ) : (
              <Text style={s.ctaBtnText}>בדיקת אירועים</Text>
            )}
          </Pressable>

          <Pressable
            style={s.backLink}
            onPress={() => setStage('step1')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזרה לבחירת יומנים וטווח"
          >
            <Text style={s.backLinkText}>חזרה לבחירת יומנים וטווח</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          step2: event selection grouped by month
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'step2' && (
        <View style={s.flex1}>
          {sections.length === 0 ? (
            <View style={s.centerStep}>
              <MaterialIcons
                name="event-busy"
                size={56}
                color={tc.textSecondary}
              />
              <Text style={s.mainTitle}>לא נמצאו אירועים בטווח שנבחר.</Text>
              <Pressable
                style={s.primaryBtn}
                onPress={() => {
                  clearPreview();
                  setStage('step1');
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="חזרה לבחירת טווח"
              >
                <Text style={s.primaryBtnText}>שינוי טווח</Text>
              </Pressable>
              {isOnboardingMode ? (
                <OnboardingContinueLink
                  onPress={() => void handleResolveCalendarStep()}
                  disabled={isResolving}
                />
              ) : null}
            </View>
          ) : (
            <>
              <SectionList
                sections={sections}
                keyExtractor={(item) => item.localId}
                stickySectionHeadersEnabled={true}
                contentContainerStyle={s.sectionListContent}
                renderSectionHeader={({ section }) => (
                  <MonthSectionHeader
                    section={section}
                    selectedIds={selectedEventIds}
                    onToggleMonth={handleToggleMonth}
                  />
                )}
                renderItem={({ item }) => (
                  <EventRow
                    event={item}
                    isSelected={selectedEventIds.has(item.localId)}
                    onToggle={() => handleToggleEvent(item.localId)}
                  />
                )}
              />
              <View style={s.ctaFixed}>
                <Pressable
                  style={[
                    s.ctaBtn,
                    selectedEventIds.size === 0 && s.ctaBtnDisabled,
                  ]}
                  onPress={() => setStage('step3')}
                  disabled={selectedEventIds.size === 0}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`להמשך עם ${selectedEventIds.size} אירועים`}
                  accessibilityState={{ disabled: selectedEventIds.size === 0 }}
                >
                  <Text style={s.ctaBtnText}>
                    {selectedEventIds.size > 0
                      ? `להמשך עם ${selectedEventIds.size} אירועים`
                      : 'יש לבחור לפחות אירוע אחד'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          step3: mandatory final summary + import CTA
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'step3' && (
        <ScrollView style={s.flex1} contentContainerStyle={s.step3Content}>
          <Text style={s.sectionHeading}>סיכום לפני ההעתקה</Text>
          <Text style={s.sectionSubtitle}>
            אפשר לעבור על הבחירות ולשנות כל אחת מהן לפני ההעתקה.
          </Text>

          <SummaryRow
            icon="event"
            title={`${selectedEventIds.size} אירועים ייועתקו`}
            detail="אפשר לבדוק או לשנות את בחירת האירועים"
            onEdit={() => setStage('step2')}
          />
          <SummaryRow
            icon="calendar-today"
            title="יומני Google שנבחרו"
            // One calendar per line: titles are often Google account
            // addresses (LTR), so they must not be mixed into a
            // comma-joined RTL sentence.
            detail={
              selectedCalendarTitles.length > 0
                ? selectedCalendarTitles.join('\n')
                : 'לא נבחרו יומנים'
            }
            onEdit={() => setStage('step1')}
          />
          <SummaryRow
            icon="date-range"
            title={`טווח אחורה: ${activeRangeChipLabel}`}
            detail={`מ-${startDateStr}`}
            onEdit={() => setStage('step1')}
          />
          <SummaryRow
            icon="update"
            title="טווח קדימה: שנה קדימה"
            detail={`עד ${endDateStr} (קבוע, לא ניתן לשינוי)`}
          />
          <SummaryRow
            icon="celebration"
            title="חגים ישראליים ב-InYomi"
            detail={
              selectedHolidayLabels.length > 0
                ? selectedHolidayLabels.join(', ')
                : 'לא נבחרו חגים להצגה'
            }
            onEdit={() => setStage('holidays')}
          />

          <Text style={s.reviewNote}>
            {
              'האירועים יועתקו ל\u2011InYomi. היומן המקורי ב\u2011Google לא ישתנה. פעולת ההעתקה עצמה אינה ניתנת לביטול — ניתן למחוק אירועים שהועתקו לאחר מכן.'
            }
          </Text>

          {importError ? (
            <View style={s.inlineError}>
              <Text style={s.inlineErrorText}>{importError}</Text>
            </View>
          ) : null}

          <Pressable
            style={[s.ctaBtn, isImporting && s.ctaBtnDisabled]}
            onPress={() => void handleImport()}
            disabled={isImporting}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="העתקה ל־InYomi"
          >
            {isImporting ? (
              <ActivityIndicator size="small" color={tc.textOnPrimary} />
            ) : (
              <Text style={s.ctaBtnText}>העתקה ל־InYomi</Text>
            )}
          </Pressable>
          {isOnboardingMode && importError ? (
            <OnboardingContinueLink
              onPress={() => void handleResolveCalendarStep()}
              disabled={isImporting || isResolving}
            />
          ) : null}
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          success
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'success' && (
        <View style={s.centerStep}>
          <MaterialIcons name="check-circle" size={80} color={tc.success} />
          <Text style={s.mainTitle}>
            {`הועתקו ${selectedEventIds.size} אירועים ל\u2011InYomi!`}
          </Text>
          <Text style={s.subtitle}>האירועים מופיעים עכשיו ביומן.</Text>
          {holidayPreferenceWarning ? (
            <View style={s.successWarning}>
              <MaterialIcons name="info-outline" size={16} color={tc.warning} />
              <Text style={s.successWarningText}>
                {
                  'האירועים הועתקו בהצלחה, אבל לא הצלחנו לשמור את בחירת החגים. ניתן לעדכן אותם בהגדרות.'
                }
              </Text>
            </View>
          ) : null}
          <Pressable
            style={[s.ctaBtn, isResolving && s.ctaBtnDisabled]}
            onPress={
              isOnboardingMode
                ? () => void handleResolveCalendarStep()
                : () => router.back()
            }
            disabled={isOnboardingMode && isResolving}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isOnboardingMode ? 'המשך אל InYomi' : 'סיום'}
          >
            <Text style={s.ctaBtnText}>
              {isOnboardingMode ? 'המשך' : 'סיום'}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Colors come from the shared theme tokens (@/theme/colors). Row direction and
// text alignment use the repo's RTL helpers (lib/rtl.ts) — never a hardcoded
// 'row-reverse' / textAlign 'right', which render left-to-right under native
// RTL (I18nManager.isRTL) on both iOS and Android.

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tc.background },
  flex1: { flex: 1 },

  // ─── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: tc.surface,
    borderBottomWidth: 1,
    borderBottomColor: tc.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tc.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 44 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: tc.textPrimary,
    textAlign: 'center',
  },

  // ─── Progress bar ─────────────────────────────────────────────────────
  progressBar: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: tc.surface,
    borderBottomWidth: 1,
    borderBottomColor: tc.border,
  },
  progressStep: {
    flex: 1,
    alignItems: 'center',
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: tc.surface,
    borderWidth: 2,
    borderColor: CHECK_BORDER,
    marginBottom: 6,
  },
  progressDotActive: {
    backgroundColor: tc.primary,
    borderColor: tc.primary,
  },
  progressDotDone: {
    backgroundColor: tc.success,
    borderColor: tc.success,
  },
  progressLabel: {
    fontSize: 11,
    color: tc.textSecondary,
    textAlign: 'center',
    lineHeight: 15,
  },
  progressLabelActive: {
    color: tc.primary,
    fontWeight: '600',
  },
  progressLabelDone: {
    color: tc.textSecondary,
  },
  // Connector between step dots — hidden; visual connection is done via progressTrack
  progressConnector: {
    height: 0,
  },
  progressConnectorDone: {
    height: 0,
  },
  // Full-width track behind the dots (rendered first so the dots cover it).
  // Symmetric insets, so it is direction-independent.
  progressTrack: {
    position: 'absolute',
    top: 21,
    left: '16%',
    right: '16%',
    height: 2,
    backgroundColor: tc.border,
  },

  // ─── Shared centered layout ───────────────────────────────────────────
  centerStep: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  googleIconWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  googleCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: tc.surface,
    borderWidth: 1,
    borderColor: tc.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.subtle,
  },
  googleLetter: {
    fontSize: 36,
    fontWeight: '700',
    color: GOOGLE_BLUE,
  },
  googleBtnLetter: {
    fontSize: 16,
    fontWeight: '700',
    color: GOOGLE_BLUE,
  },
  mainTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: tc.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: tc.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ─── Primary button (centered flows) ──────────────────────────────────
  primaryBtn: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: tc.primary,
    borderRadius: borderRadius.md,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 52,
    marginTop: 8,
  },
  googleBtnIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tc.surface,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: tc.textOnPrimary,
  },

  // ─── Scope note ───────────────────────────────────────────────────────
  scopeNote: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  scopeNoteText: { fontSize: 12, color: tc.textSecondary },

  // ─── Error / denied ───────────────────────────────────────────────────
  errorIconWrap: { marginBottom: 8 },
  errorText: {
    fontSize: 15,
    color: tc.textPrimary,
    textAlign: 'center',
    lineHeight: 24,
  },

  // ─── Step1 scroll content ─────────────────────────────────────────────
  step1Content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: tc.textSecondary,
    textAlign: rtl.textAlign,
    lineHeight: 20,
    marginBottom: 16,
  },
  mt24: { marginTop: 24 },
  emptyText: {
    fontSize: 14,
    color: tc.textSecondary,
    textAlign: 'center',
    marginVertical: 16,
  },
  inlineError: {
    backgroundColor: WARNING_TINT,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 8,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 13,
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
    lineHeight: 20,
  },
  inlineRetryBtn: {
    minHeight: 44,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineErrorRetry: {
    fontSize: 13,
    fontWeight: '600',
    color: tc.primary,
  },

  // ─── Success — non-blocking holiday-preference warning ────────────────
  successWarning: {
    alignSelf: 'stretch',
    backgroundColor: WARNING_TINT,
    borderRadius: 12,
    padding: 12,
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    gap: 8,
  },
  successWarningText: {
    flex: 1,
    fontSize: 13,
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
    lineHeight: 20,
  },

  // ─── Calendar item row ────────────────────────────────────────────────
  calendarItem: {
    backgroundColor: tc.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: tc.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
    justifyContent: 'center',
    marginBottom: 8,
  },
  calendarItemSelected: {
    borderColor: tc.primary,
    backgroundColor: tc.primaryLight,
  },
  calendarItemInner: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
  },
  calendarTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '500',
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
  },
  calendarCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: CHECK_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tc.surface,
    flexShrink: 0,
  },
  calendarCheckActive: {
    backgroundColor: tc.primary,
    borderColor: tc.primary,
  },
  primaryBadge: {
    backgroundColor: tc.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  primaryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: tc.primary,
  },

  // ─── Holiday note (step1) ─────────────────────────────────────────────
  holidayNote: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  holidayNoteText: {
    flex: 1,
    fontSize: 12,
    color: tc.textSecondary,
    textAlign: rtl.textAlign,
    lineHeight: 18,
  },

  // ─── Holiday category card (holidays stage) ────────────────────────────
  holidayCard: {
    backgroundColor: tc.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    marginBottom: 20,
    ...shadows.soft,
  },
  holidayRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 64,
    backgroundColor: tc.surface,
  },
  holidayRowText: { flex: 1, minWidth: 0 },
  holidayRowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
  },
  holidayRowSubtitle: {
    fontSize: 12,
    color: tc.textSecondary,
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  // Inset from the text start edge (logical, so it follows the row direction):
  // row padding 16 + checkbox 22 + gap 12.
  holidayDivider: {
    height: 1,
    backgroundColor: tc.border,
    marginStart: 50,
  },

  // ─── Chips ────────────────────────────────────────────────────────────
  chipsRow: {
    flexDirection: rtl.flexDirection,
    gap: 8,
    marginBottom: 16,
    marginTop: 8,
  },
  chip: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: tc.border,
    backgroundColor: tc.surface,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: tc.primary,
    borderColor: tc.primary,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: tc.textPrimary,
    textAlign: 'center',
  },
  chipLabelActive: {
    color: tc.textOnPrimary,
    fontWeight: '700',
  },

  // ─── Range summary ────────────────────────────────────────────────────
  rangeSummary: {
    fontSize: 14,
    fontWeight: '600',
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
    lineHeight: 22,
    marginBottom: 4,
  },
  rangeDates: {
    fontSize: 12,
    color: tc.textSecondary,
    textAlign: rtl.textAlign,
    marginBottom: 20,
  },

  // ─── CTA button (full-width) ──────────────────────────────────────────
  ctaBtn: {
    backgroundColor: tc.primary,
    borderRadius: borderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 52,
  },
  ctaBtnDisabled: {
    opacity: 0.5,
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: tc.textOnPrimary,
  },

  // ─── Fixed CTA for step2 ──────────────────────────────────────────────
  ctaFixed: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: tc.surface,
    borderTopWidth: 1,
    borderTopColor: tc.border,
  },

  // ─── SectionList ─────────────────────────────────────────────────────
  sectionListContent: {
    paddingBottom: 80,
  },
  monthHeader: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 52,
    backgroundColor: tc.background,
    borderBottomWidth: 1,
    borderBottomColor: tc.border,
    gap: 12,
  },
  monthCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: CHECK_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tc.surface,
    flexShrink: 0,
  },
  monthCheckboxChecked: {
    backgroundColor: tc.primary,
    borderColor: tc.primary,
  },
  monthCheckboxMixed: {
    backgroundColor: tc.primaryLight,
    borderColor: tc.primary,
  },
  monthMixedBar: {
    width: 10,
    height: 2,
    backgroundColor: tc.primary,
    borderRadius: 1,
  },
  monthHeaderText: { flex: 1, minWidth: 0 },
  monthTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
  },
  monthMeta: {
    fontSize: 12,
    color: tc.textSecondary,
    textAlign: rtl.textAlign,
    marginTop: 2,
  },

  // ─── Event row ────────────────────────────────────────────────────────
  eventRow: {
    backgroundColor: tc.surface,
    borderBottomWidth: 1,
    borderBottomColor: tc.border,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 56,
    justifyContent: 'center',
  },
  eventRowSelected: {
    backgroundColor: tc.primaryLight,
  },
  eventRowInner: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
  },
  eventRowText: { flex: 1, minWidth: 0 },
  eventTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
  },
  eventMeta: {
    fontSize: 12,
    color: tc.textSecondary,
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  eventCheck: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: CHECK_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tc.surface,
    flexShrink: 0,
  },
  eventCheckActive: {
    backgroundColor: tc.primary,
    borderColor: tc.primary,
  },

  // ─── Step3 ────────────────────────────────────────────────────────────
  step3Content: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 40,
    gap: 16,
  },
  reviewNote: {
    fontSize: 12,
    color: tc.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 4,
  },

  // ─── Summary rows (step3 — final mandatory summary) ────────────────────
  summaryRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 12,
    backgroundColor: tc.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: tc.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  summaryRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tc.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  summaryRowText: { flex: 1, minWidth: 0 },
  summaryRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: tc.textPrimary,
    textAlign: rtl.textAlign,
  },
  summaryRowDetail: {
    fontSize: 12,
    color: tc.textSecondary,
    textAlign: rtl.textAlign,
    marginTop: 2,
    lineHeight: 18,
  },
  summaryEditBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: tc.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  summaryEditText: {
    fontSize: 13,
    fontWeight: '600',
    color: tc.primary,
  },

  backLink: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: 44,
  },
  backLinkText: {
    fontSize: 14,
    color: tc.textSecondary,
    textAlign: 'center',
  },

  // ─── Calendar Import onboarding mode ──────────────────────────────────
  headerSide: {
    minWidth: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSkipText: {
    fontSize: 15,
    fontWeight: '600',
    color: tc.primary,
  },
  resolveErrorWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  ctaBtnWide: {
    alignSelf: 'stretch',
  },
});
