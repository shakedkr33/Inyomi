import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';

type LocMode = 'none' | 'address' | 'link';

interface LocationCardProps {
  location?: string;
  onChange: (loc: string) => void;
}

function isLink(s?: string): boolean {
  return s != null && (s.startsWith('http') || s.startsWith('www.'));
}

export function LocationCard({
  location,
  onChange,
}: LocationCardProps): React.JSX.Element {
  const hasLocation = location != null && location.trim() !== '';

  const [locMode, setLocMode] = useState<LocMode>(() => {
    if (!hasLocation) return 'none';
    return isLink(location) ? 'link' : 'address';
  });
  const [cardOpen, setCardOpen] = useState(hasLocation);

  /* ── Closed: tap to open ── */
  if (!cardOpen) {
    return (
      <Pressable
        style={s.emptyRow}
        onPress={() => setCardOpen(true)}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="הוסף מיקום"
      >
        <MaterialIcons name="add-location-alt" size={18} color="#94a3b8" />
        <Text style={s.emptyText}>הוסף מיקום</Text>
      </Pressable>
    );
  }

  /* ── Open: type selector + optional input ── */
  return (
    <View style={s.card}>
      {/* Close / header row */}
      <View style={s.headerRow}>
        <Pressable
          onPress={() => {
            setCardOpen(false);
            setLocMode('none');
            onChange('');
          }}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="הסר מיקום"
          style={s.closeBtn}
        >
          <MaterialIcons name="close" size={16} color="#94a3b8" />
        </Pressable>
        <Text style={s.headerLabel}>מיקום</Text>
      </View>

      {/* Type chips: כתובת | קישור */}
      <View style={s.typeRow}>
        <TypeChip
          label="קישור"
          icon="link"
          active={locMode === 'link'}
          onPress={() => {
            setLocMode('link');
            onChange('');
          }}
        />
        <TypeChip
          label="כתובת"
          icon="place"
          active={locMode === 'address'}
          onPress={() => {
            setLocMode('address');
            onChange('');
          }}
        />
      </View>

      {/* Input — only after type chosen */}
      {locMode !== 'none' && (
        <View style={s.inputRow}>
          <TextInput
            style={s.locationInput}
            value={location}
            onChangeText={onChange}
            placeholder={locMode === 'address' ? 'הכנס כתובת' : 'הדבק קישור'}
            placeholderTextColor="#94a3b8"
            textAlign="right"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={locMode === 'link' ? 'url' : 'default'}
            autoFocus
          />
          {locMode === 'address' && hasLocation && (
            <Pressable
              style={s.navBtn}
              onPress={() =>
                Linking.openURL(
                  `https://maps.google.com/?q=${encodeURIComponent(location ?? '')}`
                )
              }
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="נווט למיקום"
            >
              <MaterialIcons name="navigation" size={14} color="#fff" />
              <Text style={s.navBtnText}>נווט</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function TypeChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={[s.typeChip, active && s.typeChipActive]}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <MaterialIcons
        name={icon as never}
        size={14}
        color={active ? PRIMARY : '#64748b'}
      />
      <Text style={[s.typeChipText, active && s.typeChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  emptyText: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'right',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'right',
  },
  closeBtn: {
    padding: 4,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  typeChipActive: {
    backgroundColor: TINT,
    borderColor: PRIMARY,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  typeChipTextActive: {
    color: PRIMARY,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  locationInput: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    textAlign: 'right',
    paddingVertical: 4,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#795548',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  navBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
