import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { rtl } from '@/lib/rtl';

interface Props {
  event: { createdBy: string; communityId?: string; status?: string };
  currentUserId?: string;
  onEdit: () => void;
  onShare: () => void;
  onCancel: () => void;
}

/** Presentation only; existing handlers and server permissions remain authoritative. */
export function PersonalEventActions({
  event,
  currentUserId,
  onEdit,
  onShare,
  onCancel,
}: Props) {
  if (event.communityId || !currentUserId || event.createdBy !== currentUserId)
    return null;
  return (
    <View style={s.row}>
      <Pressable
        style={s.button}
        accessibilityRole="button"
        accessibilityLabel="עריכה"
        onPress={onEdit}
      >
        <Ionicons name="create-outline" size={18} color="#36a9e2" />
        <Text style={s.label}>עריכה</Text>
      </Pressable>
      <Pressable
        style={s.button}
        accessibilityRole="button"
        accessibilityLabel="שיתוף"
        onPress={onShare}
      >
        <Ionicons name="share-outline" size={18} color="#36a9e2" />
        <Text style={s.label}>שיתוף</Text>
      </Pressable>
      {event.status !== 'cancelled' ? (
        <Pressable
          style={[s.button, s.danger]}
          accessibilityRole="button"
          accessibilityLabel="ביטול אירוע"
          onPress={onCancel}
        >
          <Ionicons name="close-circle-outline" size={18} color="#dc2626" />
          <Text style={[s.label, s.dangerLabel]}>ביטול אירוע</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Match the existing community action colors/shape, with two wrapping columns.
const s = StyleSheet.create({
  row: {
    flexDirection: rtl.flexDirection,
    flexWrap: 'wrap',
    gap: 6,
    width: '100%',
  },
  button: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  label: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    textAlign: rtl.textAlign,
  },
  danger: { borderColor: '#fca5a5', backgroundColor: '#fff5f5' },
  dangerLabel: { color: '#dc2626' },
});
