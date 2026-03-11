import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, Text, View } from 'react-native';
import { colors, shadows } from '../../constants/theme';

interface AddPersonBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onFromContacts: () => void;
  onManual: () => void;
}

export function AddPersonBottomSheet({
  visible,
  onClose,
  onFromContacts,
  onManual,
}: AddPersonBottomSheetProps) {
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
        accessible={false}
      >
        <Animated.View
          style={[
            {
              transform: [{ translateY: slideAnim }],
              backgroundColor: 'white',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: 40,
              paddingTop: 12,
              paddingHorizontal: 20,
            },
            shadows.strong,
          ]}
        >
          {/* Drag indicator */}
          <View className="items-center mb-5">
            <View className="w-10 h-1 rounded-full bg-gray-300" />
          </View>

          <Text className="text-xl font-bold text-right text-gray-900 mb-5">
            איך תרצי להוסיף אדם?
          </Text>

          {/* From Contacts */}
          <Pressable
            onPress={() => {
              onClose();
              onFromContacts();
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="בחירה מאנשי קשר"
            accessibilityHint="בחירה מתוך אנשי הקשר שלך"
            className="bg-[#f6f7f8] rounded-2xl p-4 mb-3 flex-row-reverse items-center gap-4"
            style={shadows.subtle}
          >
            <View
              className="w-12 h-12 rounded-xl items-center justify-center"
              style={{ backgroundColor: `${colors.primary}18` }}
            >
              <MaterialIcons
                name="contact-page"
                size={26}
                color={colors.primary}
              />
            </View>
            <View className="flex-1">
              <Text className="font-bold text-[16px] text-gray-900 text-right">
                בחירה מאנשי קשר
              </Text>
              <Text className="text-sm text-gray-400 text-right mt-0.5">
                בחירה מתוך אנשי הקשר שלך.
              </Text>
            </View>
          </Pressable>

          {/* Manual Entry */}
          <Pressable
            onPress={() => {
              onClose();
              onManual();
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="הוספה ידנית"
            accessibilityHint="הוספה באמצעות הזנת שם ופרטים"
            className="bg-[#f6f7f8] rounded-2xl p-4 flex-row-reverse items-center gap-4"
            style={shadows.subtle}
          >
            <View
              className="w-12 h-12 rounded-xl items-center justify-center"
              style={{ backgroundColor: `${colors.primary}18` }}
            >
              <MaterialIcons
                name="person-add"
                size={26}
                color={colors.primary}
              />
            </View>
            <View className="flex-1">
              <Text className="font-bold text-[16px] text-gray-900 text-right">
                הוספה ידנית
              </Text>
              <Text className="text-sm text-gray-400 text-right mt-0.5">
                הוספה באמצעות הזנת שם ופרטים.
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
