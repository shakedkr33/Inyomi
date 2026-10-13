import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import type { Id } from '@/convex/_generated/dataModel';
import { personalAssignmentPresentation } from '@/lib/personalEventTaskPresentation';

// ─── Types ────────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

export type LocalAssignee =
  | { type: 'user'; userId: string; display: string }
  | { type: 'manual'; name: string };

interface Member {
  userId: Id<'users'>;
  fullName: string;
  color?: string;
}

interface TaskAssigneeSheetProps {
  visible: boolean;
  personalAssignment?: boolean;
  busy?: boolean;
  currentAssignee?: LocalAssignee | null;
  members: Member[];
  currentUserId?: string;
  isCreator: boolean;
  manualName: string;
  onManualNameChange: (v: string) => void;
  onSelectUser: (userId: Id<'users'>, display: string) => void;
  onSelectManual: () => void;
  onUnassign?: () => void;
  onClose: () => void;
  /** Legacy free-text mode; current personal/community callers disable it. */
  allowManualAssignee?: boolean;
  /**
   * Optional contextual task title, shown directly below "הקצאת משימה"
   * so it's clear which task is being managed when an event has several.
   * Purely informational — not tappable, adds no icon, and does not
   * affect assignment behavior. Omit (leave undefined) to preserve the
   * sheet's exact prior appearance, e.g. for Personal Events.
   */
  taskTitle?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

const AssignmentModalRoot =
  Platform.OS === 'android' ? SafeAreaProvider : Fragment;
const SheetContent = Platform.OS === 'android' ? ScrollView : Fragment;

export function TaskAssigneeSheet(props: TaskAssigneeSheetProps) {
  if (!props.visible || (props.personalAssignment && !props.isCreator))
    return null;
  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
    >
      <AssignmentModalRoot>
        <TaskAssigneeSheetContent {...props} />
      </AssignmentModalRoot>
    </Modal>
  );
}

function TaskAssigneeSheetContent({
  visible,
  personalAssignment = false,
  busy = false,
  currentAssignee,
  members,
  currentUserId,
  isCreator,
  manualName,
  onManualNameChange,
  onSelectUser,
  onSelectManual,
  onUnassign,
  onClose,
  allowManualAssignee = true,
  taskTitle,
}: TaskAssigneeSheetProps) {
  const insets = useSafeAreaInsets();
  if (!visible || (personalAssignment && !isCreator)) return null;

  const hasAssignee = !!currentAssignee;
  const canUnassign =
    hasAssignee &&
    !!onUnassign &&
    (isCreator ||
      (!personalAssignment &&
        currentAssignee?.type === 'user' &&
        currentAssignee.userId === currentUserId));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.container}>
        <Pressable
          style={s.backdrop}
          onPress={onClose}
          accessible
          accessibilityRole="button"
          accessibilityLabel="סגור"
        />
        <View
          style={[
            s.sheet,
            Platform.OS === 'android' && {
              paddingBottom: 36 + insets.bottom,
            },
          ]}
        >
          <SheetContent
            {...(Platform.OS === 'android'
              ? {
                  style: { flexShrink: 1 },
                  keyboardShouldPersistTaps: 'handled' as const,
                }
              : {})}
          >
            <View style={s.handle} />
            <Text style={s.title}>
              {personalAssignment
                ? personalAssignmentPresentation(hasAssignee).title
                : 'הקצאת משימה'}
            </Text>

            {/* Contextual task title — informational only, not tappable.
                Omitted (undefined) for Personal Events, preserving their
                exact prior appearance. */}
            {taskTitle ? (
              <Text style={s.taskTitleContext} numberOfLines={2}>
                {taskTitle}
              </Text>
            ) : null}

            {canUnassign ? (
              <TouchableOpacity
                onPress={onUnassign}
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                style={[s.unassignBtn, personalAssignment && { minHeight: 44 }]}
                accessible
                accessibilityRole="button"
                accessibilityLabel="בטל הקצאה"
              >
                <Ionicons
                  name="person-remove-outline"
                  size={18}
                  color="#ef4444"
                />
                <Text style={s.unassignText}>בטל הקצאה</Text>
              </TouchableOpacity>
            ) : null}

            {/* Legacy manual Community assignment — display-only info line.
                Community Events only (allowManualAssignee === false is used
                as the mode signal). Shown only when the current assignee is
                a legacy manual (free-text) name, which can still exist on
                Community tasks even though allowManualAssignee blocks *new*
                manual assignments. Never mutated/migrated automatically
                here. Personal Events (allowManualAssignee === true) never
                render this line — unchanged from before this polish. */}
            {!allowManualAssignee && currentAssignee?.type === 'manual' ? (
              <Text style={s.legacyManualInfo} numberOfLines={1}>
                {`מוקצה כרגע ל־${currentAssignee.name}`}
              </Text>
            ) : null}

            {personalAssignment &&
            currentAssignee?.type === 'user' &&
            !members.some((m) => m.userId === currentAssignee.userId) ? (
              <Text style={s.legacyManualInfo} numberOfLines={2}>
                {
                  personalAssignmentPresentation(true, currentAssignee.display)
                    .label
                }
              </Text>
            ) : null}
            <Text style={s.sectionLabel}>
              {personalAssignment ? 'משתתפים' : 'חברי קהילה'}
            </Text>
            <ScrollView
              style={[
                s.membersScroll,
                Platform.OS === 'android' && { flexShrink: 1 },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={Platform.OS === 'android'}
            >
              {members.map((m) => {
                // Match authenticated identity, including when names are identical.
                const isCurrentAssignee =
                  (personalAssignment || !allowManualAssignee) &&
                  currentAssignee?.type === 'user' &&
                  currentAssignee.userId === m.userId;
                return (
                  <TouchableOpacity
                    key={m.userId}
                    onPress={() => onSelectUser(m.userId, m.fullName)}
                    disabled={busy}
                    style={[
                      s.memberRow,
                      isCurrentAssignee && s.memberRowSelected,
                    ]}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={m.fullName}
                    accessibilityState={{
                      selected: isCurrentAssignee,
                      disabled: busy,
                    }}
                  >
                    {personalAssignment ? (
                      <View
                        style={[
                          s.personalAvatar,
                          { backgroundColor: m.color ?? '#94a3b8' },
                        ]}
                      >
                        <Text style={{ color: '#fff' }}>
                          {m.fullName.trim().slice(0, 2) || '?'}
                        </Text>
                      </View>
                    ) : (
                      <Ionicons name="person" size={20} color={PRIMARY} />
                    )}
                    <Text style={s.memberName} numberOfLines={1}>
                      {m.fullName}
                      {currentUserId === m.userId ? ' (אני)' : ''}
                    </Text>
                    {isCurrentAssignee ? (
                      <View style={s.memberSelectedBadge}>
                        <Text style={s.memberSelectedText}>מוקצה כרגע</Text>
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={PRIMARY}
                        />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {isCreator && allowManualAssignee ? (
              <>
                <Text style={[s.sectionLabel, { marginTop: 16 }]}>הקלד שם</Text>
                <View style={s.manualRow}>
                  <TouchableOpacity
                    onPress={onSelectManual}
                    style={[
                      s.manualBtn,
                      !manualName.trim() && s.manualBtnDisabled,
                    ]}
                    disabled={!manualName.trim()}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="הקצה לפי שם"
                  >
                    <Text style={s.manualBtnText}>הקצה</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={s.manualInput}
                    value={manualName}
                    onChangeText={onManualNameChange}
                    placeholder="שם..."
                    placeholderTextColor="#9ca3af"
                    textAlign="right"
                    accessible
                    accessibilityLabel="הקלד שם ממונה"
                    returnKeyType="done"
                  />
                </View>
              </>
            ) : null}
          </SheetContent>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  personalAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 12,
  },
  // Contextual task title shown below the sheet title — visually
  // secondary to `title`, informational only.
  taskTitleContext: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
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
  unassignText: { fontSize: 15, color: '#ef4444', fontWeight: '600' },
  sectionLabel: {
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
  // Selected-state row for the currently assigned community member —
  // calm, lightweight highlight so it's clear who owns the task now.
  memberRowSelected: {
    backgroundColor: '#E6F4FB',
    borderColor: '#BAE6FD',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  memberName: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
    textAlign: 'right',
  },
  memberSelectedBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  memberSelectedText: {
    fontSize: 12,
    fontWeight: '700',
    color: PRIMARY,
  },
  // Legacy manual Community assignment — display-only informational line.
  legacyManualInfo: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
    marginBottom: 8,
  },
  manualRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  manualBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  manualBtnDisabled: { backgroundColor: '#9ca3af', opacity: 0.7 },
  manualBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
