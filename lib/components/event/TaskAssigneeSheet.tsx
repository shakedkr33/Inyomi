import { Ionicons } from '@expo/vector-icons';
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
import type { Id } from '@/convex/_generated/dataModel';

// ─── Types ────────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

export type LocalAssignee =
  | { type: 'user'; userId: string; display: string }
  | { type: 'manual'; name: string };

interface Member {
  userId: Id<'users'>;
  fullName: string;
}

interface TaskAssigneeSheetProps {
  visible: boolean;
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
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskAssigneeSheet({
  visible,
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
}: TaskAssigneeSheetProps) {
  if (!visible) return null;

  const hasAssignee = !!currentAssignee;
  const canUnassign =
    hasAssignee &&
    !!onUnassign &&
    (isCreator ||
      (currentAssignee?.type === 'user' &&
        currentAssignee.userId === currentUserId));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
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
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.title}>הקצאת משימה</Text>

            {canUnassign ? (
              <TouchableOpacity
                onPress={onUnassign}
                style={s.unassignBtn}
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

            <Text style={s.sectionLabel}>חברי קהילה</Text>
            <ScrollView
              style={s.membersScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {members.map((m) => (
                <TouchableOpacity
                  key={m.userId}
                  onPress={() => onSelectUser(m.userId, m.fullName)}
                  style={s.memberRow}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={m.fullName}
                >
                  <Ionicons name="person" size={20} color={PRIMARY} />
                  <Text style={s.memberName} numberOfLines={1}>
                    {m.fullName}
                    {currentUserId === m.userId ? ' (אני)' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {isCreator ? (
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
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
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
  memberName: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
    textAlign: 'right',
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
