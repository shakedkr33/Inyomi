import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';

const AVAILABLE_TAGS = [
  'גן',
  'בית ספר',
  'חוג',
  'משפחה',
  'שכונה',
  'עבודה',
  'אישי',
] as const;
type Tag = (typeof AVAILABLE_TAGS)[number];

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function EditCommunityScreen() {
  const { id, returnTo } = useLocalSearchParams<{
    id: string;
    returnTo?: string;
  }>();
  const router = useRouter();
  const communityId = id as Id<'communities'>;

  const community = useQuery(api.communities.getCommunity, { communityId });
  const updateCommunity = useMutation(api.communities.updateCommunity);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);

  const nameRef = useRef<TextInput>(null);

  // Reset form when communityId changes (screen reuse between navigations)
  useEffect(() => {
    setName('');
    setDescription('');
    setSelectedTags([]);
    setNameError('');
  }, [communityId]);

  // Populate form when community loads, only if it matches current communityId
  useEffect(() => {
    if (community && community._id === communityId) {
      setName(community.name ?? '');
      setDescription(community.description ?? '');
      setSelectedTags((community.tags ?? []) as Tag[]);
    }
  }, [community, communityId]);

  const toggleTag = (tag: Tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('שם הקהילה הוא שדה חובה');
      nameRef.current?.focus();
      return;
    }
    setNameError('');
    Keyboard.dismiss();
    setSaving(true);

    try {
      await updateCommunity({
        communityId,
        name: trimmed,
        description: description.trim() || undefined,
        tags: selectedTags.length > 0 ? [...selectedTags] : undefined,
      });
      if (returnTo === 'list') {
        router.replace(
          '/(authenticated)/communities' as Parameters<typeof router.replace>[0]
        );
      } else {
        router.replace({
          pathname: '/(authenticated)/community/[id]',
          params: { id: communityId },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בעדכון הקהילה';
      Alert.alert('שגיאה', msg);
    } finally {
      setSaving(false);
    }
  };

  const canSave = name.trim().length > 0 && !saving;

  // Loading or not found
  if (community === undefined) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  const handleCancel = () => {
    if (returnTo === 'list') {
      router.replace(
        '/(authenticated)/communities' as Parameters<typeof router.replace>[0]
      );
    } else {
      router.replace({
        pathname: '/(authenticated)/community/[id]',
        params: { id: communityId },
      });
    }
  };

  if (community === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.loadingCenter}>
          <Text style={styles.notFoundText}>קהילה לא נמצאה</Text>
          <Pressable
            onPress={handleCancel}
            style={styles.backBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.backBtnText}>חזור</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Unauthorized — myRole is not owner or admin
  const canEdit = community.myRole === 'owner' || community.myRole === 'admin';
  if (!canEdit) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.loadingCenter}>
          <Text style={styles.notFoundText}>אין לך הרשאה לערוך את הקהילה</Text>
          <Pressable
            onPress={handleCancel}
            style={styles.backBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="חזור"
          >
            <Text style={styles.backBtnText}>חזור</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleCancel}
          style={styles.closeBtn}
          accessible
          accessibilityRole="button"
          accessibilityLabel="סגור"
        >
          <MaterialIcons name="close" size={24} color="#374151" />
        </Pressable>
        <Text style={styles.headerTitle}>עריכת קהילה</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* שם הקהילה */}
        <View style={styles.field}>
          <Text style={styles.label}>שם הקהילה</Text>
          <TextInput
            ref={nameRef}
            style={[styles.input, !!nameError && styles.inputError]}
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (nameError) setNameError('');
            }}
            placeholder="שם הקהילה (למשל: גן שקד)"
            placeholderTextColor="#9ca3af"
            maxLength={40}
            textAlign="right"
            writingDirection="rtl"
            returnKeyType="next"
            onSubmitEditing={() => {}}
            accessible
            accessibilityLabel="שם הקהילה"
          />
          {!!nameError && <Text style={styles.errorText}>{nameError}</Text>}
          <Text style={styles.charCount}>{name.length}/40</Text>
        </View>

        {/* תיאור */}
        <View style={styles.field}>
          <Text style={styles.label}>תיאור (לא חובה)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="כמה מילים על הקהילה (לא חובה)"
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={3}
            textAlign="right"
            writingDirection="rtl"
            textAlignVertical="top"
            accessible
            accessibilityLabel="תיאור הקהילה"
          />
        </View>

        {/* תגיות */}
        <View style={styles.field}>
          <Text style={styles.label}>תגיות</Text>
          <View style={styles.chipsRow}>
            {AVAILABLE_TAGS.map((tag) => {
              const selected = selectedTags.includes(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleTag(tag)}
                  accessible
                  accessibilityRole="checkbox"
                  accessibilityLabel={tag}
                  accessibilityState={{ checked: selected }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected && styles.chipTextSelected,
                    ]}
                  >
                    {tag}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* כפתור שמירה */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
          accessible
          accessibilityRole="button"
          accessibilityLabel="שמור שינויים"
          accessibilityState={{ disabled: !canSave }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>שמור שינויים</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 20,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  inputError: {
    borderColor: '#ef4444',
  },
  textArea: {
    height: 90,
    paddingTop: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#ef4444',
    textAlign: 'right',
  },
  notFoundText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  charCount: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'left',
  },
  chipsRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  chipSelected: {
    backgroundColor: PRIMARY,
  },
  chipText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#fff',
  },
  footer: {
    padding: 16,
    paddingBottom: 24,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#93c5fd',
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  backBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
