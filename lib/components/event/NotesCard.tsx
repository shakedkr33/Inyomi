import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';

interface NotesCardProps {
  notes?: string;
  onChange: (notes: string) => void;
}

export function NotesCard({
  notes,
  onChange,
}: NotesCardProps): React.JSX.Element {
  const [visible, setVisible] = useState(notes != null && notes !== '');

  if (!visible) {
    return (
      <Pressable
        style={s.emptyCard}
        onPress={() => setVisible(true)}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="הוסף הערה"
      >
        <MaterialIcons name="add" size={20} color="#94a3b8" />
        <Text style={s.emptyText}>הוסף הערה</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Text style={s.label}>הערות</Text>
        {/* Icon badge — last child = right side in flexDirection:'row', matching תזכורות/מיקום */}
        <View style={s.iconCircle}>
          <MaterialIcons name="description" size={20} color={PRIMARY} />
        </View>
      </View>
      <TextInput
        style={s.notesInput}
        value={notes}
        onChangeText={onChange}
        placeholder="הוסף הערה, תיאור האירוע, קישור או מידע חשוב"
        placeholderTextColor="#94a3b8"
        multiline
        numberOfLines={3}
        textAlign="right"
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    gap: 10,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  emptyText: { fontSize: 15, color: '#94a3b8' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  notesInput: {
    fontSize: 15,
    color: '#0f172a',
    textAlign: 'right',
    minHeight: 60,
    lineHeight: 22,
  },
});
