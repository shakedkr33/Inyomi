import { MaterialIcons } from '@expo/vector-icons';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Participant } from '@/lib/types/event';

const PRIMARY = '#36a9e2';
const AVATAR_SIZE = 32;
const OVERLAP = -8;
const MAX_VISIBLE = 6;
const AVATAR_COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#6c5ce7', '#a8e6cf', '#f97316'];

interface ParticipantsCardProps {
  participants: Participant[];
  onChange: (participants: Participant[]) => void;
}

export function ParticipantsCard({
  participants,
  onChange,
}: ParticipantsCardProps): React.JSX.Element {
  const visible = participants.slice(0, MAX_VISIBLE);
  const extraCount = Math.max(0, participants.length - MAX_VISIBLE);

  const addByEmail = (): void => {
    Alert.prompt(
      'הוסף משתתף',
      'הכנס כתובת אימייל',
      (text) => {
        if (text == null || text.trim() === '') return;
        const newP: Participant = {
          id: Date.now().toString(),
          name: text.trim(),
          color: AVATAR_COLORS[participants.length % AVATAR_COLORS.length],
        };
        onChange([...participants, newP]);
      },
      'plain-text',
      '',
      'email-address'
    );
  };

  const handleAdd = (): void => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'הוסף משתתף',
          options: ['ביטול', 'בחירה מאנשי קשר', 'הזנת אימייל'],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 2) addByEmail();
          // idx === 1: contacts picker — wired via future integration
        }
      );
    } else {
      Alert.alert('הוסף משתתף', undefined, [
        { text: 'ביטול', style: 'cancel' },
        { text: 'הזנת אימייל', onPress: addByEmail },
      ]);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.row}>
        {/* Left: overlapping avatars + add button */}
        <View style={s.avatarsGroup}>
          <Pressable
            style={s.addBtn}
            onPress={handleAdd}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="הוסף משתתף"
          >
            <MaterialIcons name="add" size={16} color={PRIMARY} />
          </Pressable>

          {extraCount > 0 && (
            <View style={[s.avatar, s.extraBadge, { marginRight: OVERLAP }]}>
              <Text style={s.extraText}>+{extraCount}</Text>
            </View>
          )}

          {/* Render in reverse so first participant is visually on top (rightmost) */}
          {[...visible].reverse().map((p, i) => (
            <View
              key={p.id}
              style={[
                s.avatar,
                { backgroundColor: p.color, marginRight: i < visible.length - 1 ? OVERLAP : 0 },
              ]}
            >
              <Text style={s.avatarText}>{p.name.charAt(0)}</Text>
            </View>
          ))}
        </View>

        {/* Right: section label */}
        <Text style={s.sectionLabel}>
          {participants.length > 0 ? `משתתפים (${participants.length})` : 'משתתפים'}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'right',
  },
  avatarsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  extraBadge: {
    backgroundColor: '#e2e8f0',
  },
  extraText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  addBtn: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${PRIMARY}12`,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    borderStyle: 'dashed',
  },
});
