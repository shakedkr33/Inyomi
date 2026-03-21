import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';

function fmt2(n: number): string {
  return String(n).padStart(2, '0');
}

function toNumericDate(ts: number): string {
  const d = new Date(ts);
  return `${fmt2(d.getDate())}.${fmt2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function timeStrToDate(timeStr: string | undefined, baseTs: number): Date {
  const d = new Date(baseTs);
  if (timeStr) {
    const parts = timeStr.split(':');
    d.setHours(Number(parts[0] ?? 9), Number(parts[1] ?? 0), 0, 0);
  } else {
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

function dateToTimeStr(d: Date): string {
  return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
}

interface DateTimeCardProps {
  date: number;
  startTime?: string;
  endTime?: string;
  isAllDay: boolean;
  onChange: (updates: {
    date?: number;
    startTime?: string;
    endTime?: string;
    isAllDay?: boolean;
  }) => void;
}

type OpenPicker = 'date' | 'start' | 'end' | null;

export function DateTimeCard({
  date,
  startTime,
  endTime,
  isAllDay,
  onChange,
}: DateTimeCardProps): React.JSX.Element {
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);

  const openOnly = (picker: OpenPicker): void => setOpenPicker(picker);
  const closePicker = (): void => setOpenPicker(null);

  return (
    <View style={s.card}>
      {/* ── Main row: times on left, date on right (RTL) ── */}
      <View style={s.mainRow}>
        {/* Left side: start – end time chips */}
        {!isAllDay && (
          <View style={s.timesGroup}>
            <Pressable
              style={s.timeChip}
              onPress={() => openOnly(openPicker === 'start' ? null : 'start')}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`שעת התחלה: ${startTime ?? 'לא נבחרה'}`}
            >
              <Text style={s.timeChipText}>{startTime ?? '--:--'}</Text>
            </Pressable>
            <Text style={s.dash}>—</Text>
            <Pressable
              style={s.timeChip}
              onPress={() => openOnly(openPicker === 'end' ? null : 'end')}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`שעת סיום: ${endTime ?? 'לא נבחרה'}`}
            >
              <Text style={s.timeChipText}>{endTime ?? '--:--'}</Text>
            </Pressable>
          </View>
        )}

        {/* Right side: date chip */}
        <Pressable
          style={s.dateChip}
          onPress={() => openOnly(openPicker === 'date' ? null : 'date')}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`תאריך: ${toNumericDate(date)}`}
        >
          <MaterialIcons name="calendar-today" size={13} color={PRIMARY} />
          <Text style={s.dateChipText}>{toNumericDate(date)}</Text>
        </Pressable>
      </View>

      {/* ── כל היום toggle ── */}
      <View style={s.divider} />
      <View style={s.toggleRow}>
        <Switch
          value={isAllDay}
          onValueChange={(v) => {
            closePicker();
            onChange({ isAllDay: v });
          }}
          trackColor={{ true: PRIMARY, false: '#e2e8f0' }}
          thumbColor="#fff"
          accessible={true}
          accessibilityLabel="כל היום"
        />
        <Text style={s.toggleLabel}>כל היום</Text>
      </View>

      {/* ── Pickers (inline) ── */}
      {openPicker === 'date' && (
        <>
          <DateTimePicker
            value={new Date(date)}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, selected) => {
              if (Platform.OS === 'android') closePicker();
              if (selected) onChange({ date: selected.getTime() });
            }}
          />
          {Platform.OS === 'ios' && (
            <Pressable style={s.doneRow} onPress={closePicker}>
              <Text style={s.doneText}>סגור</Text>
            </Pressable>
          )}
        </>
      )}

      {openPicker === 'start' && (
        <>
          <DateTimePicker
            value={timeStrToDate(startTime, date)}
            mode="time"
            is24Hour={true}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, selected) => {
              if (Platform.OS === 'android') closePicker();
              if (selected) onChange({ startTime: dateToTimeStr(selected) });
            }}
          />
          {Platform.OS === 'ios' && (
            <Pressable style={s.doneRow} onPress={closePicker}>
              <Text style={s.doneText}>סגור</Text>
            </Pressable>
          )}
        </>
      )}

      {openPicker === 'end' && (
        <>
          <DateTimePicker
            value={timeStrToDate(endTime, date)}
            mode="time"
            is24Hour={true}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, selected) => {
              if (Platform.OS === 'android') closePicker();
              if (selected) onChange({ endTime: dateToTimeStr(selected) });
            }}
          />
          {Platform.OS === 'ios' && (
            <Pressable style={s.doneRow} onPress={closePicker}>
              <Text style={s.doneText}>סגור</Text>
            </Pressable>
          )}
        </>
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
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timesGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  timeChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  dash: {
    fontSize: 13,
    color: '#94a3b8',
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: TINT,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  dateChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY,
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#334155',
    textAlign: 'right',
  },
  doneRow: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 4,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
  },
  doneText: {
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY,
  },
});
