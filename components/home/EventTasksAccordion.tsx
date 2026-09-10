/**
 * EventTasksAccordion
 *
 * Expandable accordion for community-event tasks on the Home screen.
 *
 * - Receives server-filtered, already-authorized task data
 * - Managers see all tasks + a quiet visibility-status row
 * - Members see their own tasks (visibility disabled) or all tasks (visibility enabled)
 * - Checkboxes call the parent-supplied onToggleCompleted handler
 * - Self-claim / self-unclaim actions appear for eligible tasks until the
 *   event ENDS (a currently in-progress event still allows claim/unclaim)
 * - RTL-correct Hebrew layout
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildEventTasksSummaryLabel } from '@/lib/eventTasksSummary';
import { getTextAlign, rtl } from '@/lib/rtl';
import { colors as tc } from '@/theme/colors';

// Re-exported so existing callers (e.g. HomeDailyCommandCenter) can keep
// importing it alongside the other accordion types/component from this
// module. The implementation itself lives in a plain .ts module (no RN
// imports) so it can be unit-tested without a React Native test harness —
// see tests/convex/eventTasksAccordionSummary.test.ts.
export { buildEventTasksSummaryLabel };

export type AuthorizedHomeEventTask = {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: number;
  assignedToUserId?: string;
  assignedToManual?: string;
  assigneeDisplay?: string;
  isAssignedToCurrentUser: boolean;
};

export type EventTaskAccordionData = {
  tasks: AuthorizedHomeEventTask[];
  canManageTasks: boolean;
  tasksVisibleToParticipants: boolean;
};

interface EventTasksAccordionProps {
  tasks: AuthorizedHomeEventTask[];
  canManageTasks: boolean;
  tasksVisibleToParticipants: boolean;
  expanded: boolean;
  onToggle: () => void;
  /**
   * Optional override for the header summary text. When omitted, falls
   * back to the original generic "משימות האירוע · X" label — this keeps
   * existing callers (e.g. the Community task Bottom Sheet) pixel- and
   * copy-identical. Home passes a smarter mine/unassigned breakdown built
   * with `buildEventTasksSummaryLabel` below.
   */
  summaryLabel?: string;
  /**
   * When true, renders a slightly more prominent header affordance
   * (stronger chevron, clearer divider/section separation) so users
   * understand the accordion is expandable. Defaults to `false` so
   * existing callers (Community Bottom Sheet) are visually unchanged.
   */
  emphasized?: boolean;
  /**
   * Optional so surfaces that disable completion entirely (via
   * `allowCompletion={false}`) don't need to pass a handler that will
   * never be called. Required in practice whenever `allowCompletion` is
   * `true` (the default) and at least one task is completable.
   */
  onToggleCompleted?: (taskId: string) => void;
  /**
   * Canonical Unix-ms event start time. No longer gates claim/unclaim
   * (see `eventEndTime`) — retained for any other future/legitimate use;
   * currently unused for the claim/unclaim gate itself.
   */
  eventStartTime?: number;
  /**
   * FIX 8B FOLLOW-UP — canonical Unix-ms event end time. Gates
   * claim/unclaim actions: available until the event ENDS (not until it
   * starts), so a still-in-progress event's unassigned tasks remain
   * claimable. Both Community and Home call sites source this from the
   * same `events.endTime` schema field (`v.number()`, always present for
   * community events), so `undefined` is not expected in practice.
   */
  eventEndTime?: number;
  /** Called when the user taps "אני אקח" on an eligible unassigned task. */
  onClaimTask?: (taskId: string) => void;
  /** Called when the user taps "ביטול הקצאה" on their own incomplete task. */
  onUnclaimTask?: (taskId: string) => void;
  /**
   * FIX 8B FOLLOW-UP §3 — when `false`, the completion checkbox always
   * renders as a disabled, read-only indicator (no `onToggleCompleted`
   * call), regardless of `canManageTasks` / assignment. Defaults to `true`
   * so existing Home behavior is preserved exactly. Community Main passes
   * `false`: that surface is claim/unclaim-only, never a completion UI.
   */
  allowCompletion?: boolean;
}

export function EventTasksAccordion({
  tasks,
  canManageTasks,
  tasksVisibleToParticipants,
  expanded,
  onToggle,
  summaryLabel,
  emphasized = false,
  onToggleCompleted,
  eventStartTime: _eventStartTime,
  eventEndTime,
  onClaimTask,
  onUnclaimTask,
  allowCompletion = true,
}: EventTasksAccordionProps): React.JSX.Element | null {
  if (tasks.length === 0) return null;

  const resolvedSummaryLabel =
    summaryLabel ?? `משימות האירוע · ${tasks.length}`;

  // FIX 8B FOLLOW-UP — claim/unclaim gate is EVENT END, not event start:
  // a still-in-progress event's unassigned tasks remain claimable. If
  // endTime is unavailable, block actions conservatively (see prop doc —
  // not expected to happen for the current Community/Home call sites,
  // which both source this from the required `events.endTime` field).
  const eventHasEnded =
    eventEndTime !== undefined && eventEndTime <= Date.now();

  return (
    <>
      {/* Divider between card body and accordion */}
      <View style={[styles.divider, emphasized && styles.dividerEmphasized]} />

      {/* Accordion header */}
      <Pressable
        accessible={true}
        accessibilityLabel={`${resolvedSummaryLabel}, ${expanded ? 'סגירת רשימת משימות' : 'פתיחת רשימת משימות'}`}
        accessibilityRole="button"
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        onPress={onToggle}
        style={[styles.headerRow, emphasized && styles.headerRowEmphasized]}
      >
        <Text
          style={[styles.headerText, emphasized && styles.headerTextEmphasized]}
        >
          {resolvedSummaryLabel}
        </Text>
        <MaterialIcons
          color={emphasized ? tc.primary : tc.textSecondary}
          name={expanded ? 'expand-less' : 'expand-more'}
          size={emphasized ? 24 : 20}
        />
      </Pressable>

      {/* Expanded content */}
      {expanded ? (
        <View style={styles.expandedContent}>
          {/* Manager-only visibility status row */}
          {canManageTasks ? (
            <View style={styles.visibilityRow}>
              <MaterialIcons
                color={tc.textSecondary}
                name={
                  tasksVisibleToParticipants ? 'visibility' : 'lock-outline'
                }
                size={14}
              />
              <View style={styles.visibilityTextBlock}>
                <Text style={styles.visibilityTitle}>
                  {tasksVisibleToParticipants
                    ? 'גלוי למשתתפים'
                    : 'גלוי לפי הקצאה'}
                </Text>
                <Text style={styles.visibilityDesc}>
                  {tasksVisibleToParticipants
                    ? 'כל חברי הקהילה יכולים לראות את המשימות וההקצאות.'
                    : 'כל משתתף רואה רק משימות שהוקצו אליו.'}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Task rows */}
          {tasks.map((task, index) => {
            const isAssigned =
              Boolean(task.assignedToUserId) ||
              Boolean(task.assignedToManual?.trim());

            // Self-claim: visible only when task is unassigned and the event
            // hasn't ended yet (event currently in progress still counts).
            const isClaimable =
              !isAssigned &&
              !eventHasEnded &&
              eventEndTime !== undefined &&
              onClaimTask !== undefined;

            // Self-unclaim: only own task, incomplete, event not ended.
            const canUnclaimHere =
              task.isAssignedToCurrentUser &&
              !task.completed &&
              !eventHasEnded &&
              eventEndTime !== undefined &&
              onUnclaimTask !== undefined;

            // Informational label used when no action is shown.
            const assignmentLabel = task.isAssignedToCurrentUser
              ? '✓ הוקצה אליי'
              : task.assigneeDisplay
                ? task.assigneeDisplay
                : isAssigned
                  ? 'הוקצה'
                  : 'לא הוקצה';

            // Managers may complete any task; regular members only their own
            // assigned task — but never when this surface disables
            // completion entirely (`allowCompletion={false}`, e.g.
            // Community Main — FIX 8B FOLLOW-UP §3).
            const canComplete =
              allowCompletion &&
              (canManageTasks || task.isAssignedToCurrentUser);

            return (
              <View
                key={task.id}
                style={[styles.taskRow, index > 0 && styles.taskRowDivider]}
              >
                {/*
                 * FIX 8B FINAL POLISH — when `allowCompletion` is `false`
                 * (e.g. Community Main), no checkbox is rendered at all —
                 * not even a disabled/read-only placeholder. That surface
                 * is claim/unclaim only and must never visually suggest
                 * completion is managed from there. Home
                 * (`allowCompletion` defaults to `true`) is unaffected.
                 */}
                {allowCompletion ? (
                  canComplete ? (
                    <Pressable
                      accessible={true}
                      accessibilityLabel={task.title}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: task.completed }}
                      hitSlop={11}
                      onPress={() => onToggleCompleted?.(task.id)}
                      style={styles.checkboxTouch}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          task.completed && styles.checkboxDone,
                        ]}
                      >
                        {task.completed ? (
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
                        checked: task.completed,
                        disabled: true,
                      }}
                      style={styles.checkboxTouch}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          styles.checkboxDisabled,
                          task.completed && styles.checkboxDoneDisabled,
                        ]}
                      >
                        {task.completed ? (
                          <MaterialIcons
                            color="#FFFFFF"
                            name="check"
                            size={16}
                          />
                        ) : null}
                      </View>
                    </View>
                  )
                ) : null}

                {/* Title + assignment label / action */}
                <View style={styles.taskBody}>
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.taskTitle,
                      task.completed && styles.taskTitleDone,
                    ]}
                  >
                    {task.title}
                  </Text>

                  {isClaimable ? (
                    /* אני אקח — primary claim action */
                    <Pressable
                      accessible={true}
                      accessibilityLabel="אני אקח"
                      accessibilityRole="button"
                      onPress={() => onClaimTask?.(task.id)}
                      style={({ pressed }) => [
                        styles.claimPressable,
                        pressed && styles.actionPressed,
                      ]}
                    >
                      <View style={styles.claimAction}>
                        <Text style={styles.claimActionText}>אני אקח</Text>
                      </View>
                    </Pressable>
                  ) : canUnclaimHere ? (
                    /* ✓ הוקצה אליי + ביטול הקצאה — own incomplete task, event not yet ended */
                    <View style={styles.ownAssignmentRow}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.assignmentLabel,
                          styles.assignmentLabelMe,
                        ]}
                      >
                        ✓ הוקצה אליי
                      </Text>
                      <Pressable
                        accessible={true}
                        accessibilityLabel="ביטול הקצאה"
                        accessibilityRole="button"
                        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                        onPress={() => onUnclaimTask?.(task.id)}
                        style={({ pressed }) => [
                          styles.unclaimPressable,
                          pressed && styles.actionPressed,
                        ]}
                      >
                        <View style={styles.unclaimAction}>
                          <Text style={styles.unclaimActionText}>
                            ביטול הקצאה
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  ) : (
                    /* Informational assignment label — no action */
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.assignmentLabel,
                        task.isAssignedToCurrentUser &&
                          styles.assignmentLabelMe,
                        !isAssigned && styles.assignmentLabelUnassigned,
                      ]}
                    >
                      {assignmentLabel}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E9EB',
  },
  // FIX — Home accordion affordance: a slightly heavier divider makes the
  // section break between "חשוב לזכור" (above) and this accordion clearer.
  dividerEmphasized: {
    height: 1.5,
    backgroundColor: '#D6DEE3',
  },
  headerRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    minHeight: 44,
  },
  // FIX — Home-only: quiet background tint so the expandable header reads
  // as its own actionable section rather than blending into the card body.
  headerRowEmphasized: {
    backgroundColor: '#F3F8FB',
  },
  headerText: {
    flex: 1,
    fontSize: 13,
    color: '#334E6F',
    fontWeight: '700',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  headerTextEmphasized: {
    fontSize: 14,
    color: tc.primary,
  },
  expandedContent: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E9EB',
  },
  visibilityRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F8FAFB',
  },
  visibilityTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  visibilityTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: tc.textSecondary,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  visibilityDesc: {
    fontSize: 11,
    color: tc.textSecondary,
    marginTop: 1,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  taskRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    minHeight: 48,
  },
  taskRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E9EB',
  },
  checkboxTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
  },
  checkbox: {
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
  checkboxDone: {
    backgroundColor: tc.primary,
    borderColor: tc.primary,
  },
  checkboxDisabled: {
    borderColor: '#D4D8DA',
    backgroundColor: 'transparent',
  },
  checkboxDoneDisabled: {
    backgroundColor: '#C4C9CB',
    borderColor: '#C4C9CB',
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2D3335',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  taskTitleDone: {
    color: '#92999C',
    textDecorationLine: 'line-through',
  },
  assignmentLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: tc.textSecondary,
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
  },
  assignmentLabelMe: {
    color: tc.primary,
    fontWeight: '700',
  },
  assignmentLabelUnassigned: {
    color: '#ADB3B5',
  },
  // ── Claim action (אני אקח) ────────────────────────────────────────────────
  claimPressable: {
    alignSelf: 'flex-start',
  },
  claimAction: {
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#00668E',
  },
  claimActionText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
    includeFontPadding: false,
  },
  actionPressed: {
    opacity: 0.84,
  },
  // ── Own-assignment row (✓ הוקצה אליי + ביטול הקצאה) ──────────────────────
  ownAssignmentRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  unclaimPressable: {
    alignSelf: 'auto',
  },
  unclaimAction: {
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 6,
    backgroundColor: '#F1F4F5',
    borderWidth: 1.5,
    borderColor: '#CBD5D9',
  },
  unclaimActionText: {
    fontSize: 12,
    color: '#334E6F',
    fontWeight: '700',
    textAlign: getTextAlign(),
    writingDirection: 'rtl',
    includeFontPadding: false,
  },
});
