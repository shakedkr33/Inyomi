import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { ReminderType } from '@/lib/types/event';

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';

const REMINDER_OPTIONS: { type: ReminderType; label: string }[] = [
  { type: 'hour_before', label: 'שעה לפני האירוע' },
  { type: 'morning_same_day', label: 'בבוקר של אותו יום' },
  { type: 'day_before_evening', label: 'יום לפני בערב' },
];

interface RemindersCardProps {
  enabled: boolean;
  types: ReminderType[];
  onChange: (enabled: boolean, types: ReminderType[]) => void;
}

export function RemindersCard({
  enabled,
  types,
  onChange,
}: RemindersCardProps): React.JSX.Element {
  const toggleType = (t: ReminderType): void => {
    const next = types.includes(t)
      ? types.filter((r) => r !== t)
      : [...types, t];
    onChange(enabled, next);
  };

  return (
    <View style={s.card}>
      {/* Header row */}
      <View style={s.headerRow}>
        <Switch
          value={enabled}
          onValueChange={(v) => onChange(v, types)}
          trackColor={{ true: PRIMARY, false: '#e2e8f0' }}
          thumbColor="#fff"
          accessible={true}
          accessibilityLabel="הפעל תזכורות"
        />
        <View style={s.headerContent}>
          <Text style={s.label}>תזכורות</Text>
          <Text style={s.statusText}>
            {enabled ? 'תזכורות חכמות מופעלות' : 'תזכורות כבויות'}
          </Text>
        </View>
        <View style={[s.iconCircle, { backgroundColor: TINT }]}>
          <MaterialIcons
            name="notifications-active"
            size={20}
            color={PRIMARY}
          />
        </View>
      </View>

      {enabled && (
        <View style={s.optionsList}>
          {REMINDER_OPTIONS.map((opt) => {
            const active = types.includes(opt.type);
            return (
              <Pressable
                key={opt.type}
                style={s.optionRow}
                onPress={() => toggleType(opt.type)}
                accessible={true}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                accessibilityLabel={opt.label}
              >
                <View style={[s.checkbox, active && s.checkboxActive]}>
                  {active && (
                    <MaterialIcons name="check" size={13} color="#fff" />
                  )}
                </View>
                <Text style={[s.optionText, active && s.optionTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'right',
  },
  statusText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'right',
  },
  optionsList: {
    marginTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  optionText: {
    fontSize: 14,
    color: '#64748b',
    flex: 1,
    textAlign: 'right',
  },
  optionTextActive: {
    color: '#0f172a',
    fontWeight: '600',
  },
});
