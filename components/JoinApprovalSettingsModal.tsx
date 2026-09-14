import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { rtl } from '@/lib/rtl';

export type JoinApprovalMode = 'manual' | 'automatic';

interface JoinApprovalSettingsModalProps {
  visible: boolean;
  value: JoinApprovalMode;
  saving: boolean;
  onChange: (value: JoinApprovalMode) => void;
  onClose: () => void;
  onSave: () => Promise<void> | void;
}

const PRIMARY = '#00668E';
const MUTED_TEXT = '#8A94A6';
const TITLE_COLOR = '#111827';

export function JoinApprovalSettingsModal({
  visible,
  value,
  saving,
  onChange,
  onClose,
  onSave,
}: JoinApprovalSettingsModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false} />
      <View style={styles.card}>
        <Text style={styles.title}>הגדרות הצטרפות</Text>
        <Text style={styles.subtitle}>
          בחרי איך אנשים שמקבלים קישור לקהילה יצטרפו אליה
        </Text>

        <Pressable
          onPress={() => onChange('manual')}
          style={[
            styles.option,
            { flexDirection: rtl.flexDirection },
            value === 'manual' && styles.optionSelected,
          ]}
          accessible
          accessibilityRole="radio"
          accessibilityState={{ selected: value === 'manual' }}
          accessibilityLabel="אישור ידני"
        >
          <View
            style={[
              styles.radioOuter,
              value === 'manual' && styles.radioOuterSelected,
            ]}
          >
            {value === 'manual' ? <View style={styles.radioInner} /> : null}
          </View>
          <View style={styles.optionTextCol}>
            <Text style={styles.optionTitle}>אישור ידני</Text>
            <Text style={styles.optionDesc}>
              כל מי שמצטרף דרך הקישור ימתין לאישור שלך לפני שיוכל להיכנס לקהילה.
              מתאים לגנים, כיתות וקבוצות פרטיות.
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => onChange('automatic')}
          style={[
            styles.option,
            { flexDirection: rtl.flexDirection },
            value === 'automatic' && styles.optionSelected,
          ]}
          accessible
          accessibilityRole="radio"
          accessibilityState={{ selected: value === 'automatic' }}
          accessibilityLabel="אישור אוטומטי"
        >
          <View
            style={[
              styles.radioOuter,
              value === 'automatic' && styles.radioOuterSelected,
            ]}
          >
            {value === 'automatic' ? <View style={styles.radioInner} /> : null}
          </View>
          <View style={styles.optionTextCol}>
            <Text style={styles.optionTitle}>אישור אוטומטי</Text>
            <Text style={styles.optionDesc}>
              כל מי שמקבל את הקישור ייכנס מיד לקהילה, בלי אישור מנהל. מתאים
              לקהילות פתוחות כמו עירייה או שכונה.
            </Text>
          </View>
        </Pressable>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            disabled={saving}
            accessible
            accessibilityRole="button"
            accessibilityLabel="ביטול"
          >
            <Text style={styles.cancelText}>ביטול</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
            onPress={() => {
              void onSave();
            }}
            disabled={saving}
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              value === 'manual'
                ? 'שמירה, נבחר אישור ידני'
                : 'שמירה, נבחר אישור אוטומטי'
            }
          >
            <Text style={styles.submitText}>
              {saving ? 'שומר...' : 'שמירה'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  card: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '15%',
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: TITLE_COLOR,
    textAlign: 'right',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: MUTED_TEXT,
    textAlign: 'right',
    marginBottom: 14,
    lineHeight: 20,
    writingDirection: 'rtl',
  },
  option: {
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    marginBottom: 10,
    gap: 10,
  },
  optionSelected: {
    borderColor: PRIMARY,
    backgroundColor: '#f5fbfe',
  },
  optionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: TITLE_COLOR,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  optionDesc: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 6,
    lineHeight: 18,
    writingDirection: 'rtl',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioOuterSelected: {
    borderColor: PRIMARY,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PRIMARY,
  },
  buttons: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-start',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    minHeight: 44,
    minWidth: 90,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  cancelText: {
    fontSize: 15,
    color: '#4b5563',
    fontWeight: '600',
  },
  submitBtn: {
    minHeight: 44,
    minWidth: 90,
    borderRadius: 10,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitText: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '700',
  },
});
