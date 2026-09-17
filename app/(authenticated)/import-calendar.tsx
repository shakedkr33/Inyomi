import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../convex/_generated/api';
import { useGoogleCalendarAuth } from '../../lib/hooks/useGoogleCalendarAuth';
import { useGoogleCalendarList } from '../../lib/hooks/useGoogleCalendarList';
import { useGoogleCalendarPreview } from '../../lib/hooks/useGoogleCalendarPreview';
import type { NormalizedEvent, PastRange } from '../../lib/services/googleCalendarEvents';
import {
  formatAbsoluteHebrewDate,
  getDisplayDateRange,
  getMonthCheckState,
  getRangeSummaryText,
  groupEventsByMonth,
} from '../../lib/services/importFlowUtils';
import type { EventSection } from '../../lib/services/importFlowUtils';

// ─── Stage & step types ───────────────────────────────────────────────────────

type ImportStage = 'connect_google' | 'step1' | 'step2' | 'step3' | 'success';
type StepStatus = 'completed' | 'active' | 'future';

function resolveStepStatus(stepNum: 1 | 2 | 3, stage: ImportStage): StepStatus {
  if (stage === 'success') return 'completed';
  if (stage === 'connect_google') return 'future';
  const order: Record<Exclude<ImportStage, 'connect_google'>, number> = {
    step1: 1,
    step2: 2,
    step3: 3,
    success: 4,
  };
  const current = order[stage];
  if (stepNum < current) return 'completed';
  if (stepNum === current) return 'active';
  return 'future';
}

// ─── Chips constant (RTL order: 'none' first → appears on right) ─────────────

const RANGE_CHIPS: ReadonlyArray<{ value: PastRange; label: string }> = [
  { value: 'none', label: 'מהיום' },
  { value: 'one_month', label: 'חודש אחורה' },
  { value: 'two_months', label: 'חודשיים אחורה' },
] as const;

const PRIMARY = '#36a9e2';

// ─── Progress bar ─────────────────────────────────────────────────────────────

const STEP_LABELS: Record<1 | 2 | 3, string> = {
  1: 'בחירת יומנים וטווח',
  2: 'בחירת אירועים',
  3: 'אישור והעתקה',
};

function ImportProgressBar({ stage }: { stage: ImportStage }): React.JSX.Element {
  const steps: Array<1 | 2 | 3> = [1, 2, 3];
  return (
    <View style={s.progressBar}>
      {steps.map((stepNum, idx) => {
        const status = resolveStepStatus(stepNum, stage);
        const isLast = idx === steps.length - 1;
        return (
          <View key={stepNum} style={s.progressStep}>
            {/* connector line — rendered before the dot so it appears behind */}
            {idx > 0 && (
              <View
                style={[
                  s.progressConnector,
                  resolveStepStatus((stepNum - 1) as 1 | 2 | 3, stage) === 'completed' &&
                    s.progressConnectorDone,
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
      {/* horizontal connector track spans the full bar behind the dots */}
      <View style={s.progressTrack} />
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

function CalendarRow({ title, isPrimary, isSelected, onToggle }: CalendarRowProps): React.JSX.Element {
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
      <View style={s.calendarItemInner}>
        <Text style={s.calendarTitle} numberOfLines={2}>
          {title}
        </Text>
        {isPrimary ? (
          <View style={s.primaryBadge}>
            <Text style={s.primaryBadgeText}>יומן ראשי</Text>
          </View>
        ) : null}
        <View style={[s.calendarCheck, isSelected && s.calendarCheckActive]}>
          {isSelected ? <MaterialIcons name="check" size={14} color="#fff" /> : null}
        </View>
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

function MonthSectionHeader({ section, selectedIds, onToggleMonth }: MonthSectionHeaderProps): React.JSX.Element {
  const checkState = getMonthCheckState(section.data, selectedIds);
  const selected = section.data.filter((e) => selectedIds.has(e.localId)).length;
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
      {/* RTL: checkbox on right (leading), text on left (trailing) */}
      <View style={[s.monthCheckbox, checkState === 'all' && s.monthCheckboxChecked, checkState === 'some' && s.monthCheckboxMixed]}>
        {checkState === 'all' ? (
          <MaterialIcons name="check" size={13} color="#fff" />
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

function EventRow({ event, isSelected, onToggle }: EventRowProps): React.JSX.Element {
  return (
    <Pressable
      style={[s.eventRow, isSelected && s.eventRowSelected]}
      onPress={onToggle}
      accessible={true}
      accessibilityRole="checkbox"
      accessibilityLabel={event.title}
      accessibilityState={{ checked: isSelected }}
    >
      <View style={s.eventRowInner}>
        <View style={s.eventRowText}>
          <Text style={s.eventTitle} numberOfLines={2}>{event.title}</Text>
          {!event.isAllDay ? (
            <Text style={s.eventMeta} numberOfLines={1}>{event.startIso}</Text>
          ) : null}
        </View>
        <View style={[s.eventCheck, isSelected && s.eventCheckActive]}>
          {isSelected ? <MaterialIcons name="check" size={12} color="#fff" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ImportCalendarScreen(): React.JSX.Element {
  const router = useRouter();

  // ── Convex queries/mutations ─────────────────────────────────────────────────
  const alreadyImported = useQuery(api.googleImport.hasCompletedGoogleImport);
  const importMutation = useMutation(api.googleImport.importGoogleCalendar);

  // ── Stage machine ────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<ImportStage>('connect_google');

  // ── OAuth hook ───────────────────────────────────────────────────────────────
  const { status, accessToken, errorMessage, startAuthorization, clearAuthorization } =
    useGoogleCalendarAuth();

  // ── Calendar list hook ───────────────────────────────────────────────────────
  const {
    status: listStatus,
    calendars,
    reload: reloadCalendars,
  } = useGoogleCalendarList(accessToken);

  // ── Calendar selection ───────────────────────────────────────────────────────
  const [selectedCalIds, setSelectedCalIds] = useState<Set<string>>(new Set<string>());
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
  const [pastRange, setPastRange] = useState<PastRange>('none');

  // ── Preview hook ─────────────────────────────────────────────────────────────
  const {
    status: previewStatus,
    result: previewResult,
    startPreview,
    retry: retryPreview,
    clear: clearPreview,
  } = useGoogleCalendarPreview();

  // ── Step-2 event selection ───────────────────────────────────────────────────
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set<string>());

  // ── Import state ─────────────────────────────────────────────────────────────
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // ── Auto-transition: connect_google → step1 ──────────────────────────────────
  // Fires once the OAuth token is live and the calendar list has resolved
  // (to any terminal state: ready, empty, or error).
  useEffect(() => {
    if (stage !== 'connect_google') return;
    if (status !== 'authorized') return;
    if (listStatus === 'ready' || listStatus === 'empty' || listStatus === 'error') {
      setStage('step1');
    }
  }, [stage, status, listStatus]);

  // ── Auto-transition: step1 (loading preview) → step2 ─────────────────────────
  useEffect(() => {
    if (stage !== 'step1' || previewStatus !== 'done' || previewResult === null) return;
    // Pre-select all events before moving to step2.
    if (previewResult.kind === 'success') {
      setSelectedEventIds(new Set<string>(previewResult.events.map((e) => e.localId)));
    }
    setStage('step2');
  }, [stage, previewStatus, previewResult]);

  // ── Cleanup on screen blur ────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      return () => {
        clearAuthorization();
        clearPreview();
        setStage('connect_google');
        setSelectedCalIds(new Set<string>());
        setSelectedEventIds(new Set<string>());
        setPastRange('none');
        setImportError(null);
        initialPreselectionDoneRef.current = false;
      };
    }, [clearAuthorization, clearPreview]),
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleChipSelect = useCallback(
    (value: PastRange): void => {
      setPastRange(value);
      // Clear stale preview/event selections when the range changes.
      clearPreview();
      setSelectedEventIds(new Set<string>());
    },
    [clearPreview],
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
    [selectedEventIds],
  );

  const handleToggleEvent = useCallback((localId: string): void => {
    setSelectedEventIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  }, []);

  const handleImport = useCallback(async (): Promise<void> => {
    if (
      previewResult === null ||
      previewResult.kind !== 'success' ||
      selectedEventIds.size === 0
    )
      return;
    setIsImporting(true);
    setImportError(null);
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
      await importMutation({ events: eventsToImport });
      setStage('success');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'שגיאה בייבוא. נסי שוב.');
    } finally {
      setIsImporting(false);
    }
  }, [previewResult, selectedEventIds, importMutation]);

  // ── Derived values ────────────────────────────────────────────────────────────

  const showProgress = stage === 'step1' || stage === 'step2' || stage === 'step3' || stage === 'success';
  const isCalendarLoading = listStatus === 'idle' || listStatus === 'loading';
  const isOAuthLoading = status === 'authorizing' || status === 'exchanging';
  const oAuthLoadingLabel = status === 'authorizing' ? 'פותח חלון אישור...' : 'מאמת גישה...';
  const { startDateStr, endDateStr } = getDisplayDateRange(pastRange);
  const rangeSummary = getRangeSummaryText(pastRange);

  const sections: EventSection[] =
    previewResult?.kind === 'success' ? groupEventsByMonth(previewResult.events) : [];

  const canStartPreview = selectedCalIds.size > 0 && listStatus === 'ready';
  const isPreviewLoading = previewStatus === 'loading';

  // ─────────────────────────────────────────────────────────────────────────────
  // Already completed state
  // ─────────────────────────────────────────────────────────────────────────────
  if (alreadyImported?.completed === true) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.header}>
          <Pressable
            style={s.backBtn}
            onPress={() => router.back()}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <MaterialIcons name="arrow-forward-ios" size={20} color="#1e293b" />
          </Pressable>
          <Text style={s.headerTitle}>העתקת אירועים</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.centerStep}>
          <MaterialIcons name="check-circle" size={72} color="#22c55e" />
          <Text style={s.mainTitle}>האירועים כבר הועתקו</Text>
          <Text style={s.subtitle}>
            {`הועתקו ${alreadyImported.importedCount} אירועים ל\u2011InYomi.`}
          </Text>
          <Pressable
            style={s.primaryBtn}
            onPress={() => router.back()}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזור"
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
    <SafeAreaView style={s.screen}>
      {/* ── Custom header ─────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Pressable
          style={s.backBtn}
          onPress={() => router.back()}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <MaterialIcons name="arrow-forward-ios" size={20} color="#1e293b" />
        </Pressable>
        <Text style={s.headerTitle}>העתקת אירועים</Text>
        <View style={{ width: 40 }} />
      </View>

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
              <Text style={s.mainTitle}>העתקת אירועים מ-Google</Text>
              <Text style={s.subtitle}>
                {'ניצור עותק של האירועים שתבחרי ב\u2011InYomi.\nהיומן המקורי לא ישתנה.'}
              </Text>
              <Pressable
                style={s.primaryBtn}
                onPress={startAuthorization}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="המשך ל-Google לאישור גישה ליומן"
              >
                <View style={s.googleBtnIcon}>
                  <Text style={s.googleLetter}>G</Text>
                </View>
                <Text style={s.primaryBtnText}>המשך ל־Google</Text>
              </Pressable>
              <View style={s.scopeNote}>
                <MaterialIcons name="lock" size={14} color="#94a3b8" />
                <Text style={s.scopeNoteText}>גישה לקריאה בלבד · לא נשמרת סיסמה</Text>
              </View>
            </View>
          )}

          {/* authorizing / exchanging */}
          {isOAuthLoading && (
            <View style={s.centerStep}>
              <View style={s.googleIconWrap}>
                <ActivityIndicator size="large" color={PRIMARY} />
              </View>
              <Text style={s.mainTitle}>{oAuthLoadingLabel}</Text>
            </View>
          )}

          {/* authorized but calendars still loading */}
          {status === 'authorized' && isCalendarLoading && (
            <View style={s.centerStep}>
              <View style={s.googleIconWrap}>
                <ActivityIndicator size="large" color={PRIMARY} />
              </View>
              <Text style={s.mainTitle}>טוען יומנים...</Text>
            </View>
          )}

          {/* denied / error */}
          {(status === 'denied' || status === 'error') && (
            <View style={s.centerStep}>
              <View style={s.errorIconWrap}>
                <MaterialIcons name="error-outline" size={56} color="#f59e0b" />
              </View>
              <Text style={s.errorText}>{errorMessage}</Text>
              <Pressable
                style={s.primaryBtn}
                onPress={clearAuthorization}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="נסי שוב"
              >
                <Text style={s.primaryBtnText}>נסי שוב</Text>
              </Pressable>
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
          <Text style={s.sectionSubtitle}>בחרי את היומנים שמהם תרצי להעתיק אירועים. אפשר לבחור יותר מאחד.</Text>

          {listStatus === 'error' && (
            <View style={s.inlineError}>
              <Text style={s.inlineErrorText}>לא ניתן לטעון את היומנים.</Text>
              <Pressable onPress={reloadCalendars} accessible={true} accessibilityRole="button" accessibilityLabel="נסי שוב">
                <Text style={s.inlineErrorRetry}>נסי שוב</Text>
              </Pressable>
            </View>
          )}

          {listStatus === 'empty' && (
            <Text style={s.emptyText}>לא נמצאו יומנים זמינים.</Text>
          )}

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
                  <Text style={[s.chipLabel, isActive && s.chipLabelActive]}>{chip.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Dynamic summary ─────────────────────────────────────────── */}
          <Text style={s.rangeSummary}>{rangeSummary}</Text>
          <Text style={s.rangeDates}>
            תאריכי הייבוא: {startDateStr} – {endDateStr}
          </Text>

          {/* ── Preview error ────────────────────────────────────────────── */}
          {previewStatus === 'done' && previewResult?.kind !== 'success' && (
            <View style={s.inlineError}>
              <Text style={s.inlineErrorText}>
                {previewResult?.kind === 'auth_error'
                  ? 'פג תוקף ההרשאה. חזרי והתחברי מחדש.'
                  : previewResult?.kind === 'network_error'
                  ? 'שגיאת רשת. בדקי חיבור ונסי שוב.'
                  : 'לא ניתן לטעון את האירועים.'}
              </Text>
              <Pressable onPress={retryPreview} accessible={true} accessibilityRole="button" accessibilityLabel="נסי שוב">
                <Text style={s.inlineErrorRetry}>נסי שוב</Text>
              </Pressable>
            </View>
          )}

          {/* ── CTA ─────────────────────────────────────────────────────── */}
          <Pressable
            style={[s.ctaBtn, (!canStartPreview || isPreviewLoading) && s.ctaBtnDisabled]}
            onPress={handleStartPreview}
            disabled={!canStartPreview || isPreviewLoading}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="בדיקת אירועים"
            accessibilityState={{ disabled: !canStartPreview || isPreviewLoading }}
          >
            {isPreviewLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.ctaBtnText}>בדיקת אירועים</Text>
            )}
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
              <MaterialIcons name="event-busy" size={56} color="#cbd5e1" />
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
                  style={[s.ctaBtn, selectedEventIds.size === 0 && s.ctaBtnDisabled]}
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
                      : 'בחרי לפחות אירוע אחד'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          step3: review + import CTA
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'step3' && (
        <ScrollView style={s.flex1} contentContainerStyle={s.step3Content}>
          <View style={s.reviewCard}>
            <MaterialIcons name="event" size={48} color={PRIMARY} />
            <Text style={s.mainTitle}>{`מוכנים להעתיק ${selectedEventIds.size} אירועים`}</Text>
            <Text style={s.subtitle}>
              {'האירועים יועתקו ל\u2011InYomi. היומן המקורי ב\u2011Google לא ישתנה.'}
            </Text>
            <Text style={s.reviewNote}>
              {'פעולה זו אינה ניתנת לביטול — ניתן למחוק אירועים שהועתקו לאחר מכן.'}
            </Text>
          </View>

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
            accessibilityLabel="העתק ל-InYomi"
          >
            {isImporting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.ctaBtnText}>העתק ל-InYomi</Text>
            )}
          </Pressable>

          <Pressable
            style={s.backLink}
            onPress={() => setStage('step2')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזרה לבחירת אירועים"
          >
            <Text style={s.backLinkText}>חזרה לבחירת אירועים</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          success
      ══════════════════════════════════════════════════════════════════════ */}
      {stage === 'success' && (
        <View style={s.centerStep}>
          <MaterialIcons name="check-circle" size={80} color="#22c55e" />
          <Text style={s.mainTitle}>
            {`הועתקו ${selectedEventIds.size} אירועים ל\u2011InYomi!`}
          </Text>
          <Text style={s.subtitle}>האירועים מופיעים עכשיו ביומן.</Text>
          <Pressable
            style={s.ctaBtn}
            onPress={() => router.back()}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="סיום"
          >
            <Text style={s.ctaBtnText}>סיום</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f8' },
  flex1: { flex: 1 },

  // ─── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },

  // ─── Progress bar ─────────────────────────────────────────────────────
  progressBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  progressStep: {
    flex: 1,
    alignItems: 'center',
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    marginBottom: 6,
  },
  progressDotActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  progressDotDone: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  progressLabel: {
    fontSize: 10,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 14,
  },
  progressLabelActive: {
    color: PRIMARY,
    fontWeight: '600',
  },
  progressLabelDone: {
    color: '#22c55e',
  },
  // Connector between step dots — hidden; visual connection is done via progressTrack
  progressConnector: {
    height: 0,
  },
  progressConnectorDone: {
    height: 0,
  },
  // Full-width track behind the dots (decorative only; iOS ignores zIndex on some layouts)
  progressTrack: {
    position: 'absolute',
    top: 21,
    left: '16%',
    right: '16%',
    height: 2,
    backgroundColor: '#e2e8f0',
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
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  googleLetter: {
    fontSize: 36,
    fontWeight: '700',
    color: '#4285F4',
  },
  mainTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
  },

  // ─── Primary button ───────────────────────────────────────────────────
  primaryBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  googleBtnIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },

  // ─── Scope note ───────────────────────────────────────────────────────
  scopeNote: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  scopeNoteText: { fontSize: 12, color: '#94a3b8' },

  // ─── Error / denied ───────────────────────────────────────────────────
  errorIconWrap: { marginBottom: 8 },
  errorText: {
    fontSize: 15,
    color: '#64748b',
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
    color: '#0f172a',
    textAlign: 'right',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 16,
  },
  mt24: { marginTop: 24 },
  emptyText: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginVertical: 16,
  },
  inlineError: {
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    textAlign: 'right',
  },
  inlineErrorRetry: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
  },

  // ─── Calendar item row ────────────────────────────────────────────────
  calendarItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  calendarItemSelected: {
    borderColor: PRIMARY,
    backgroundColor: '#f0f9ff',
  },
  calendarItemInner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  calendarTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#0f172a',
    textAlign: 'right',
  },
  calendarCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    flexShrink: 0,
  },
  calendarCheckActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  primaryBadge: {
    backgroundColor: '#e0f2fe',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  primaryBadgeText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#0284c7',
  },

  // ─── Chips ────────────────────────────────────────────────────────────
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    marginTop: 8,
  },
  chip: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#475569',
    textAlign: 'center',
  },
  chipLabelActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // ─── Range summary ────────────────────────────────────────────────────
  rangeSummary: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    textAlign: 'right',
    lineHeight: 22,
    marginBottom: 4,
  },
  rangeDates: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'right',
    marginBottom: 20,
  },

  // ─── CTA button (full-width) ──────────────────────────────────────────
  ctaBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 52,
  },
  ctaBtnDisabled: {
    backgroundColor: '#cbd5e1',
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  // ─── Fixed CTA for step2 ──────────────────────────────────────────────
  ctaFixed: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },

  // ─── SectionList ─────────────────────────────────────────────────────
  sectionListContent: {
    paddingBottom: 80,
  },
  monthHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 10,
  },
  monthCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    flexShrink: 0,
  },
  monthCheckboxChecked: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  monthCheckboxMixed: {
    backgroundColor: '#bae6fd',
    borderColor: PRIMARY,
  },
  monthMixedBar: {
    width: 10,
    height: 2,
    backgroundColor: PRIMARY,
    borderRadius: 1,
  },
  monthHeaderText: { flex: 1 },
  monthTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'right',
  },
  monthMeta: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 2,
  },

  // ─── Event row ────────────────────────────────────────────────────────
  eventRow: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  eventRowSelected: {
    backgroundColor: '#f0f9ff',
  },
  eventRowInner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  eventRowText: { flex: 1 },
  eventTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0f172a',
    textAlign: 'right',
  },
  eventMeta: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 2,
  },
  eventCheck: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    flexShrink: 0,
  },
  eventCheckActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },

  // ─── Step3 ────────────────────────────────────────────────────────────
  step3Content: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 40,
    gap: 16,
  },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  reviewNote: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  backLink: {
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 44,
  },
  backLinkText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
});
