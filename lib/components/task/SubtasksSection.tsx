import { MaterialIcons } from '@expo/vector-icons';
import { useConvex } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import DraggableFlatList, {
  OpacityDecorator,
} from 'react-native-draggable-flatlist';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { AttachmentSourceSheet } from '@/lib/components/attachments/AttachmentSourceSheet';
import { SubtaskImagePreviewModal } from '@/lib/components/task/SubtaskImagePreviewModal';
import { rtl } from '@/lib/rtl';
import {
  displayedSubtaskAttachment,
  replaceSubtaskAttachment,
} from '@/lib/subtaskAttachment';
import type { EventAttachmentDraft } from '@/lib/types/event';
import type { SubTask, SubTaskAttachment } from '@/lib/types/task';

const PRIMARY = '#36a9e2';

interface SubtasksSectionProps {
  subtasks: SubTask[];
  allowEditing: boolean;
  onSubtasksChange: (st: SubTask[]) => void;
  onAllowEditingChange: (v: boolean) => void;
  /** Called every time the pending (not-yet-committed) draft title changes */
  onPendingDraftChange?: (title: string) => void;
  /**
   * When false, subtasks are rendered read-only (participant mode with toggle OFF).
   * Defaults to true for backward compatibility.
   */
  canEditSubtasks?: boolean;
  /**
   * When false, the "משתתפים יכולים לערוך" toggle is hidden.
   * Only the task creator should see/change this.
   * Defaults to true for backward compatibility.
   */
  showToggle?: boolean;
  /**
   * When provided (editing an existing task), subtask attachment URLs are
   * fetched via the task-scoped getTaskAttachmentUrl query so the server
   * verifies both task access and the exact storageId reference.
   * Unsaved attachments preview their local URI, never an unscoped Storage URL.
   */
  taskId?: string;
}

function createSubtaskId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function attachmentTypeFromMime(mimeType: string): 'image' | 'file' {
  return mimeType.startsWith('image/') ? 'image' : 'file';
}

function draftToSubtaskAttachment(
  draft: EventAttachmentDraft
): SubTaskAttachment {
  return {
    id: createAttachmentId(),
    type: attachmentTypeFromMime(draft.mimeType),
    storageId: draft.storageId,
    originalName: draft.originalName,
    displayName: draft.displayName,
    mimeType: draft.mimeType,
    sizeBytes: draft.sizeBytes,
    localUri: draft.localUri,
  };
}

export function SubtaskAttachmentPreview({
  taskId,
  attachment,
  onImageThumbnailPress,
}: {
  taskId?: Id<'tasks'>;
  attachment: SubTaskAttachment | undefined;
  onImageThumbnailPress?: (uri: string) => void;
}): React.JSX.Element | null {
  const storageId = attachment?.storageId as Id<'_storage'> | undefined;
  const convex = useConvex();
  const [attempt, setAttempt] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const isImage =
    attachment?.type === 'image' ||
    (attachment?.mimeType ?? '').startsWith('image/');
  const localUri = attachment?.localUri;

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt deliberately starts a fresh authorized lookup on retry.
  useEffect(() => {
    let active = true;
    setUri(null);
    setImageLoaded(false);
    setStatus('loading');
    const timeout = setTimeout(() => {
      if (active) setStatus('error');
    }, 15000);
    const resolve = async () => {
      try {
        const url =
          localUri ||
          (taskId && storageId
            ? await convex.query(api.tasks.getTaskAttachmentUrl, {
                taskId,
                storageId,
              })
            : null);
        if (!active) return;
        setUri(url);
        setStatus(url ? 'ready' : 'error');
      } catch {
        if (active) setStatus('error');
      } finally {
        clearTimeout(timeout);
      }
    };
    void resolve();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [convex, taskId, storageId, localUri, attempt]);

  useEffect(() => {
    if (!uri || !isImage || imageLoaded) return;
    const timeout = setTimeout(() => setStatus('error'), 15000);
    return () => clearTimeout(timeout);
  }, [uri, isImage, imageLoaded]);

  if (!attachment?.storageId && !attachment?.localUri) {
    return null;
  }

  if (status === 'error') {
    return (
      <Pressable
        style={s.fileChip}
        accessibilityRole="button"
        accessibilityLabel="טעינת הקובץ נכשלה. ניסיון חוזר"
        onPress={() => setAttempt((value) => value + 1)}
      >
        <MaterialIcons name="refresh" size={18} color={PRIMARY} />
        <Text style={s.fileChipText}>ניסיון חוזר</Text>
      </Pressable>
    );
  }

  if (status === 'loading') {
    return (
      <View style={s.thumbWrap} accessibilityLabel="טעינת קובץ">
        <ActivityIndicator color={PRIMARY} size="small" />
      </View>
    );
  }

  if (isImage) {
    if (!uri) return null;
    return (
      <Pressable
        onPress={() => onImageThumbnailPress?.(uri)}
        style={s.thumbPressable}
        hitSlop={8}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="תצוגה מקדימה של תמונה"
        accessibilityHint="פתיחה בתצוגה גדולה"
      >
        <Image
          key={`${uri}-${attempt}`}
          source={{ uri }}
          style={s.thumb}
          resizeMode="cover"
          onError={() => setStatus('error')}
          onLoad={() => setImageLoaded(true)}
        />
      </Pressable>
    );
  }

  return (
    <Pressable
      style={s.fileChip}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`קובץ: ${attachment.displayName}`}
      onPress={() => {
        if (uri) void Linking.openURL(uri).catch(() => setStatus('error'));
      }}
    >
      <MaterialIcons name="insert-drive-file" size={18} color={PRIMARY} />
      <Text style={s.fileChipText} numberOfLines={1}>
        {attachment.displayName || attachment.originalName}
      </Text>
    </Pressable>
  );
}

export function SubtasksSection({
  subtasks,
  allowEditing,
  onSubtasksChange,
  onAllowEditingChange,
  onPendingDraftChange,
  canEditSubtasks = true,
  showToggle = true,
  taskId,
}: SubtasksSectionProps): React.JSX.Element {
  const taskIdTyped = taskId as Id<'tasks'> | undefined;
  const [draftTitle, setDraftTitle] = useState('');
  const [focusDraftTick, setFocusDraftTick] = useState(0);
  const draftInputRef = useRef<TextInput>(null);
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const pickSubtaskIdRef = useRef<string | null>(null);
  const [imagePreviewUri, setImagePreviewUri] = useState<string | null>(null);

  useEffect(() => {
    if (focusDraftTick > 0) {
      const timeout = setTimeout(() => {
        draftInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [focusDraftTick]);

  // Notify parent of pending draft changes so save can flush it
  useEffect(() => {
    onPendingDraftChange?.(draftTitle);
  }, [draftTitle, onPendingDraftChange]);

  const commitDraft = (): void => {
    const title = draftTitle.trim();
    if (!title) {
      draftInputRef.current?.focus();
      return;
    }
    onSubtasksChange([
      ...subtasks,
      { id: createSubtaskId(), title, completed: false },
    ]);
    setDraftTitle('');
    setFocusDraftTick((tick) => tick + 1);
  };

  const updateSubtask = (id: string, title: string): void => {
    onSubtasksChange(
      subtasks.map((st) => (st.id === id ? { ...st, title } : st))
    );
  };

  const toggleSubtask = (id: string): void => {
    onSubtasksChange(
      subtasks.map((st) =>
        st.id === id ? { ...st, completed: !st.completed } : st
      )
    );
  };

  const removeSubtask = (id: string): void => {
    onSubtasksChange(subtasks.filter((st) => st.id !== id));
  };

  const requestRemoveSubtask = (subtask: SubTask): void => {
    const hasContent =
      subtask.title.trim().length > 0 ||
      displayedSubtaskAttachment(subtask) !== undefined ||
      subtask.completed;
    if (!hasContent) {
      removeSubtask(subtask.id);
      return;
    }

    Alert.alert('למחוק את תת-המשימה?', '', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחיקה',
        style: 'destructive',
        onPress: () => removeSubtask(subtask.id),
      },
    ]);
  };

  const setSubtaskAttachment = (
    id: string,
    attachment: SubTaskAttachment | undefined
  ): void => {
    onSubtasksChange(
      subtasks.map((st) =>
        st.id === id ? replaceSubtaskAttachment(st, attachment) : st
      )
    );
  };

  const openAttachmentPickerFor = (subtaskId: string): void => {
    pickSubtaskIdRef.current = subtaskId;
    setSourceSheetOpen(true);
  };

  const closePickSheet = (): void => {
    pickSubtaskIdRef.current = null;
    setSourceSheetOpen(false);
  };

  const onAttachmentPicked = (draft: EventAttachmentDraft): void => {
    const sid = pickSubtaskIdRef.current;
    if (!sid) return;
    setSubtaskAttachment(sid, draftToSubtaskAttachment(draft));
    pickSubtaskIdRef.current = null;
  };

  const onAttachButtonPress = (st: SubTask): void => {
    const attachment = displayedSubtaskAttachment(st);
    if (attachment?.localUri || attachment?.storageId) {
      Alert.alert('קובץ מצורף', '', [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'החלף קובץ',
          onPress: () => openAttachmentPickerFor(st.id),
        },
        {
          text: 'הסר קובץ',
          style: 'destructive',
          onPress: () => setSubtaskAttachment(st.id, undefined),
        },
      ]);
      return;
    }
    openAttachmentPickerFor(st.id);
  };

  const renderItem = ({
    item: st,
    drag,
    isActive,
  }: RenderItemParams<SubTask>) => {
    if (!canEditSubtasks) {
      // Read-only row for participants when toggle is OFF
      return (
        <View style={s.subtaskRow}>
          <View style={s.dragHandlePlaceholder} />
          <View
            style={[s.checkbox, st.completed && s.checkboxChecked]}
            accessible={true}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: st.completed }}
            accessibilityLabel={st.title || 'תת־משימה'}
          >
            {st.completed ? (
              <MaterialIcons name="check" size={14} color="#fff" />
            ) : null}
          </View>
          <TextInput
            style={[s.subtaskInput, st.completed && s.subtaskInputCompleted]}
            value={st.title}
            editable={false}
            textAlign={rtl.inputTextAlign}
            accessible={true}
            accessibilityLabel={st.title || 'תת־משימה'}
          />
          <SubtaskAttachmentPreview
            taskId={taskIdTyped}
            attachment={displayedSubtaskAttachment(st)}
            onImageThumbnailPress={(uri) => setImagePreviewUri(uri)}
          />
          <View style={s.imageBtnPlaceholder} />
          <View style={s.removeBtnPlaceholder} />
        </View>
      );
    }

    return (
      <OpacityDecorator activeOpacity={0.75}>
        <View style={[s.subtaskRow, isActive && s.subtaskRowActive]}>
          {/* Drag handle – RTL: appears visually on the left */}
          <TouchableOpacity
            onPressIn={drag}
            style={s.dragHandle}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="גרור לסידור מחדש"
            hitSlop={6}
          >
            <MaterialIcons name="drag-handle" size={22} color="#b0bec5" />
          </TouchableOpacity>

          <Pressable
            onPress={() => toggleSubtask(st.id)}
            style={[s.checkbox, st.completed && s.checkboxChecked]}
            accessible={true}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: st.completed }}
            accessibilityLabel={st.title || 'תת־משימה'}
          >
            {st.completed ? (
              <MaterialIcons name="check" size={14} color="#fff" />
            ) : null}
          </Pressable>

          <TextInput
            style={[s.subtaskInput, st.completed && s.subtaskInputCompleted]}
            value={st.title}
            onChangeText={(text) => updateSubtask(st.id, text)}
            placeholder="הוספת תת־משימה..."
            placeholderTextColor="#9ca3af"
            textAlign={rtl.inputTextAlign}
            returnKeyType="done"
            onSubmitEditing={() => setFocusDraftTick((tick) => tick + 1)}
            accessible={true}
            accessibilityLabel={st.title || 'תת־משימה'}
          />

          <SubtaskAttachmentPreview
            taskId={taskIdTyped}
            attachment={displayedSubtaskAttachment(st)}
            onImageThumbnailPress={(uri) => setImagePreviewUri(uri)}
          />

          <Pressable
            onPress={() => onAttachButtonPress(st)}
            style={s.imageBtn}
            hitSlop={10}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={
              displayedSubtaskAttachment(st)
                ? 'הסר או החלף קובץ'
                : 'הוסף קובץ או תמונה'
            }
          >
            <MaterialIcons name="attach-file" size={22} color={PRIMARY} />
          </Pressable>

          <Pressable
            onPress={() => requestRemoveSubtask(st)}
            style={s.removeBtn}
            hitSlop={10}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="מחיקת תת־משימה"
          >
            <MaterialIcons name="close" size={18} color="#94a3b8" />
          </Pressable>
        </View>
      </OpacityDecorator>
    );
  };

  return (
    <View>
      <AttachmentSourceSheet
        visible={sourceSheetOpen}
        onClose={closePickSheet}
        onPicked={(draft) => {
          onAttachmentPicked(draft);
        }}
      />

      <SubtaskImagePreviewModal
        uri={imagePreviewUri}
        onClose={() => setImagePreviewUri(null)}
      />

      <View style={s.header}>
        <Text style={s.title}>תתי־משימות</Text>
        {canEditSubtasks ? (
          <Pressable
            style={s.addBtn}
            onPress={() => {
              setFocusDraftTick((tick) => tick + 1);
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="הוסף תת־משימה"
          >
            <MaterialIcons name="add-circle" size={20} color={PRIMARY} />
            <Text style={s.addBtnText}>+ הוסף תת־משימה</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </View>

      {showToggle ? (
        <View style={s.toggleRow}>
          <View style={s.toggleTextBlock}>
            <Text style={s.toggleLabel}>משתתפים יכולים לערוך</Text>
            <Text style={s.helperText}>
              מתאים לרשימות קניות או משימות משותפות
            </Text>
          </View>
          <Switch
            value={allowEditing}
            onValueChange={onAllowEditingChange}
            trackColor={{ true: PRIMARY, false: '#e2e8f0' }}
            thumbColor="#fff"
            accessible={true}
            accessibilityLabel="משתתפים יכולים לערוך"
          />
        </View>
      ) : null}

      {!canEditSubtasks && subtasks.length > 0 ? (
        <Text style={s.readOnlyHint}>
          יוצר/ת המשימה לא אפשר/ה עריכת תתי־משימות
        </Text>
      ) : null}

      <View style={s.list}>
        {/* DraggableFlatList handles reorder; scrollEnabled=false lets the
            parent ScrollView handle page scrolling while drag still works. */}
        <DraggableFlatList
          data={subtasks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onDragEnd={
            canEditSubtasks
              ? ({ data }) => onSubtasksChange(data)
              : () => undefined
          }
          scrollEnabled={false}
          activationDistance={canEditSubtasks ? 8 : 9999}
          disableScrollViewPanResponder={true}
          containerStyle={{ overflow: 'visible' }}
          ItemSeparatorComponent={() => <View style={s.divider} />}
        />

        {/* New subtask draft row — hidden in read-only mode */}
        {canEditSubtasks ? (
          <View style={s.subtaskRow}>
            <View style={s.dragHandlePlaceholder} />
            <Pressable
              style={s.emptyCheckbox}
              onPress={commitDraft}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="הוסף תת־משימה"
            >
              <MaterialIcons name="add" size={16} color={PRIMARY} />
            </Pressable>
            <TextInput
              ref={draftInputRef}
              style={s.subtaskInput}
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="הוסיפי תת־משימה..."
              placeholderTextColor="#9ca3af"
              textAlign={rtl.inputTextAlign}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={commitDraft}
              accessible={true}
              accessibilityLabel="הוסיפי תת־משימה"
            />
            <View style={s.imageBtnPlaceholder} />
            <View style={s.removeBtnPlaceholder} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: rtl.flexDirection,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: { fontSize: 15, fontWeight: '800', color: '#111827' },
  addBtn: { flexDirection: rtl.flexDirection, alignItems: 'center', gap: 4 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: PRIMARY },
  toggleRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  toggleTextBlock: {
    flex: 1,
    marginEnd: 8,
  },
  toggleLabel: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '700',
    textAlign: rtl.textAlign,
  },
  helperText: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: rtl.textAlign,
    marginTop: 2,
  },
  list: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    padding: 14,
  },
  subtaskRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    minHeight: 48,
  },
  subtaskRowActive: {
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
  },
  dragHandle: {
    width: 30,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandlePlaceholder: { width: 30 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: PRIMARY,
    backgroundColor: PRIMARY,
  },
  emptyCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
  },
  thumbPressable: {
    borderRadius: 8,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  fileChip: {
    maxWidth: 72,
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: '#e8f5fd',
    borderRadius: 8,
  },
  fileChipText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  imageBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBtnPlaceholder: { width: 40 },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  removeBtnPlaceholder: { width: 32 },
  subtaskInput: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    textAlign: rtl.inputTextAlign,
    minHeight: 38,
  },
  subtaskInputCompleted: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  divider: { height: 1, backgroundColor: '#e5e7eb' },
  readOnlyHint: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: rtl.textAlign,
    marginBottom: 8,
  },
});
