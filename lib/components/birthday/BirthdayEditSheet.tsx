import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Birthday } from '@/lib/types/birthday';
import { formatBirthdayDate, getCountdownLabel } from '@/lib/utils/birthday';
import { BirthdayWheelPicker } from './BirthdayWheelPicker';
import { BottomSheet } from './BottomSheet';

const PRIMARY = '#36a9e2';

interface BirthdayEditSheetProps {
  birthday?: Birthday;
  visible: boolean;
  onClose: () => void;
  onSave: (data: Partial<Birthday>) => void;
  onDelete?: () => void;
}

export function BirthdayEditSheet({
  birthday,
  visible,
  onClose,
  onSave,
  onDelete,
}: BirthdayEditSheetProps): React.JSX.Element {
  const isEdit = birthday != null && birthday.id !== '';

  const [name, setName] = useState(birthday?.name ?? '');
  const [day, setDay] = useState(birthday?.day ?? 1);
  const [month, setMonth] = useState(
    birthday?.month ?? new Date().getMonth() + 1
  );
  const [year, setYear] = useState<number | null>(birthday?.year ?? null);
  const [photoUri, setPhotoUri] = useState<string | null>(
    birthday?.photoUri ?? null
  );
  // In edit mode the picker starts collapsed; in create mode always open
  const [isDatePickerVisible, setDatePickerVisible] = useState(!isEdit);

  useEffect(() => {
    if (visible) {
      setName(birthday?.name ?? '');
      setDay(birthday?.day ?? 1);
      setMonth(birthday?.month ?? new Date().getMonth() + 1);
      setYear(birthday?.year ?? null);
      setPhotoUri(birthday?.photoUri ?? null);
      setDatePickerVisible(!isEdit);
    }
    // Deps are the birthday PROP fields (not local state) so the effect only
    // re-runs when a different birthday is loaded — not when the user scrolls
    // the picker (which mutates local state variables, not these prop values).
  }, [
    visible,
    isEdit,
    birthday?.name,
    birthday?.day,
    birthday?.month,
    birthday?.year,
    birthday?.photoUri,
  ]);

  const handleSave = (): void => {
    if (!name.trim()) {
      Alert.alert('שגיאה', 'נא להזין שם');
      return;
    }
    onSave({
      id: birthday?.id ?? '',
      name: name.trim(),
      day,
      month,
      year,
      photoUri,
      contactId: birthday?.contactId ?? null,
    });
  };

  const handleDelete = (): void => {
    Alert.alert('מחיקה', 'האם למחוק את יום ההולדת?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          onDelete?.();
          onClose();
        },
      },
    ]);
  };

  const pickImage = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const previewDate = formatBirthdayDate({ day, month, year } as Birthday);
  const previewCountdown = getCountdownLabel({ day, month } as Birthday);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ flex: 1 }}>
        {/* HEADER */}
        <View style={s.header}>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <MaterialIcons name="close" size={22} color="#64748b" />
          </Pressable>
          <Text style={s.headerTitle}>
            {isEdit ? 'עריכת יום הולדת 🎂' : 'הוספת יום הולדת 🎂'}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {/* BODY (Scrollable) */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 1. אזור תמונה */}
          <View style={s.avatarSection}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={s.avatar} />
            ) : (
              <View style={s.avatarPlaceholder}>
                <Text style={s.initials}>{name.substring(0, 2) || '?'}</Text>
              </View>
            )}
            <Pressable style={s.cameraBtn} onPress={pickImage}>
              <MaterialIcons name="photo-camera" size={20} color="#fff" />
            </Pressable>
            <Pressable onPress={pickImage}>
              <Text style={s.changePhotoText}>שנה תמונה</Text>
            </Pressable>
          </View>

          {/* 2. שדה שם */}
          <View style={s.field}>
            <Text style={s.label}>שם</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="הזן שם..."
              placeholderTextColor="#9ca3af"
              textAlign="right"
            />
          </View>

          {/* 3. שורת תאריך – תמיד מוצגת, מציגה את הבחירה הנוכחית */}
          <View style={s.field}>
            <Text style={s.label}>תאריך</Text>
            <View style={s.dateRow}>
              {/* צד שמאל: אייקון + תאריך */}
              <View style={s.dateRowLeft}>
                <View style={s.dateIconBox}>
                  <MaterialIcons
                    name="calendar-today"
                    size={20}
                    color={PRIMARY}
                  />
                </View>
                <Text style={s.dateRowText}>{previewDate}</Text>
              </View>

              {/* צד ימין: badge ספירה לאחור + כפתור שנה (רק בעריכה) */}
              <View style={s.dateRowRight}>
                <View style={s.dateBadge}>
                  <Text style={s.dateBadgeText}>{previewCountdown}</Text>
                </View>
                {isEdit && !isDatePickerVisible && (
                  <Pressable
                    style={s.changeDateBtn}
                    onPress={() => setDatePickerVisible(true)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="שנה תאריך"
                  >
                    <Text style={s.changeDateBtnText}>שנה</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </ScrollView>

        {/* WHEEL PICKER — shown in create mode always, in edit mode only when expanded */}
        {(!isEdit || isDatePickerVisible) && (
          <View style={s.pickerWrapper}>
            <BirthdayWheelPicker
              day={day}
              month={month}
              year={year}
              onDayChange={setDay}
              onMonthChange={setMonth}
              onYearChange={setYear}
            />
            {/* בעריכה: כפתור אישור מסכם את הבחירה ומקפל את ה-picker */}
            {isEdit && isDatePickerVisible && (
              <Pressable
                style={s.confirmDateBtn}
                onPress={() => setDatePickerVisible(false)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="אישור תאריך"
              >
                <MaterialIcons name="check-circle" size={18} color={PRIMARY} />
                <Text style={s.confirmDateBtnText}>אישור תאריך</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* FOOTER */}
        <View style={s.footer}>
          <Pressable
            style={[s.saveBtn, !name.trim() && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!name.trim()}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isEdit ? 'שמור יום הולדת' : 'הוסף יום הולדת'}
          >
            <Text style={s.saveBtnText}>{isEdit ? 'שמור' : 'הוסף'}</Text>
            <MaterialIcons name="check" size={22} color="#fff" />
          </Pressable>

          {isEdit && onDelete != null && (
            <Pressable
              style={s.deleteBtn}
              onPress={handleDelete}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="מחק יום הולדת"
            >
              <Text style={s.deleteBtnText}>מחק יום הולדת</Text>
              <MaterialIcons name="delete" size={20} color="#ef4444" />
            </Pressable>
          )}
        </View>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
    textAlign: 'center',
  },
  avatarSection: {
    alignItems: 'center',
    paddingTop: 8,
    marginBottom: 24,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: '#fff',
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  initials: {
    fontSize: 30,
    fontWeight: '700',
    color: '#64748b',
  },
  cameraBtn: {
    position: 'absolute',
    bottom: 24,
    right: '50%',
    marginRight: -56,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: PRIMARY,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  changePhotoText: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
    marginTop: 12,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
    marginBottom: 8,
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#fff',
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 17,
    fontWeight: '500',
    color: '#0f172a',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  // ─── Date row ────────────────────────────────────────────────────────────
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  dateRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dateIconBox: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: `${PRIMARY}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateRowText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  dateRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateBadge: {
    backgroundColor: `${PRIMARY}20`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  dateBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: PRIMARY,
  },
  changeDateBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  changeDateBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  // ─── Picker wrapper ───────────────────────────────────────────────────────
  pickerWrapper: {
    paddingHorizontal: 24,
    paddingBottom: 4,
    gap: 8,
  },
  confirmDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 9,
    backgroundColor: `${PRIMARY}10`,
  },
  confirmDateBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: PRIMARY,
  },
  // ─── Footer ───────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
    backgroundColor: '#f6f7f8',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: PRIMARY,
    height: 54,
    borderRadius: 12,
    shadowColor: PRIMARY,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
});
