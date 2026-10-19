/**
 * InlineSubtasksEditor
 *
 * Compact subtask manager shown inside expanded task cards on the Main Tasks
 * screen. Supports: toggle, add, delete, drag-to-reorder, and file/image
 * attachment — all persisted immediately through Convex mutations.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
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
import { uploadAttachmentDraftsForConvex } from '@/lib/attachmentUpload';
import { AttachmentSourceSheet } from '@/lib/components/attachments/AttachmentSourceSheet';
import { rtl } from '@/lib/rtl';
import type { EventAttachmentDraft } from '@/lib/types/event';

const PRIMARY = '#36a9e2';

type InlineSubtask = {
  id: string;
  title: string;
  completed: boolean;
  attachment?: {
    id?: string;
    type?: 'image' | 'file';
    storageId?: string;
    mimeType?: string;
    displayName?: string;
    originalName?: string;
    localUri?: string;
  };
  image?: {
    storageId?: string;
    mimeType?: string;
  };
};

interface InlineSubtasksEditorProps {
  taskId: string;
  subtasks: InlineSubtask[];
  onOpenImagePreview?: (uri: string) => void;
}

// ─── Attachment thumbnail ──────────────────────────────────────
function InlineAttachmentPreview({
  taskId,
  storageId,
  localUri,
  mimeType,
  displayName,
  originalName,
  onPress,
}: {
  taskId?: Id<'tasks'>;
  storageId?: string;
  localUri?: string;
  mimeType?: string;
  displayName?: string;
  originalName?: string;
  onPress?: (uri: string) => void;
}) {
  const storageIdTyped = storageId as Id<'_storage'> | undefined;
  // Use the task-scoped query when taskId is available (saved attachment on an
  // existing task) so the server verifies both task access and the reference.
  // Fall back to the auth-only query only when taskId is absent (pre-save
  // upload preview during task creation — no document reference exists yet).
  const storageUrl = useQuery(
    api.tasks.getTaskAttachmentUrl,
    taskId && storageIdTyped ? { taskId, storageId: storageIdTyped } : 'skip'
  );
  const uri = localUri ?? storageUrl ?? undefined;
  const isImage = (mimeType ?? '').startsWith('image/');

  // Pre-warm RN's image cache as soon as the URI is known so the preview
  // opens instantly instead of downloading the image again.
  useEffect(() => {
    if (isImage && uri) {
      void Image.prefetch(uri);
    }
  }, [isImage, uri]);

  if (!storageId && !localUri) return null;

  if (isImage && uri) {
    return (
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          onPress?.(uri);
        }}
        style={ils.thumbBtn}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="תמונה מצורפת"
      >
        <Image source={{ uri }} style={ils.thumb} resizeMode="cover" />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        if (uri) onPress?.(uri);
      }}
      style={ils.fileChip}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={displayName ?? originalName ?? 'קובץ מצורף'}
    >
      <MaterialIcons name="insert-drive-file" size={14} color={PRIMARY} />
    </Pressable>
  );
}

// ─── Main component ──────────────────────────────────────────
export function InlineSubtasksEditor({
  taskId,
  subtasks,
  onOpenImagePreview,
}: InlineSubtasksEditorProps): React.JSX.Element {
  const [addingTitle, setAddingTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const addInputRef = useRef<TextInput>(null);

  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [attachForSubtaskId, setAttachForSubtaskId] = useState<string | null>(
    null
  );

  // Mutations
  const toggleSubtaskMutation = useMutation(api.tasks.toggleSubtaskCompleted);
  const addSubtaskMutation = useMutation(api.tasks.addSubtask);
  const removeSubtaskMutation = useMutation(api.tasks.removeSubtask);
  const reorderSubtasksMutation = useMutation(api.tasks.reorderSubtasks);
  const setSubtaskAttachmentMutation = useMutation(
    api.tasks.setSubtaskAttachment
  );
  const createUploadIntent = useMutation(api.events.createStorageUploadIntent);
  const registerStorageUpload = useMutation(api.events.registerStorageUpload);

  const taskIdTyped = taskId as Id<'tasks'>;

  const handleToggle = async (subtaskId: string): Promise<void> => {
    try {
      await toggleSubtaskMutation({ id: taskIdTyped, subtaskId });
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לעדכן את הסטטוס');
    }
  };

  const handleDelete = (subtask: InlineSubtask): void => {
    const hasContent =
      subtask.title.trim().length > 0 ||
      subtask.attachment !== undefined ||
      subtask.completed;

    const doDelete = async (): Promise<void> => {
      try {
        await removeSubtaskMutation({
          id: taskIdTyped,
          subtaskId: subtask.id,
        });
      } catch {
        Alert.alert('שגיאה', 'לא ניתן למחוק את הפריט');
      }
    };

    if (!hasContent) {
      doDelete();
      return;
    }

    Alert.alert('למחוק פריט?', subtask.title || '', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחיקה', style: 'destructive', onPress: doDelete },
    ]);
  };

  const handleAddConfirm = async (): Promise<void> => {
    const title = addingTitle.trim();
    if (!title) {
      setIsAdding(false);
      return;
    }
    try {
      await addSubtaskMutation({ id: taskIdTyped, title });
      setAddingTitle('');
      setIsAdding(false);
    } catch {
      Alert.alert('שגיאה', 'לא ניתן להוסיף פריט');
    }
  };

  const handleAttachPress = (subtask: InlineSubtask): void => {
    const hasAttachment =
      subtask.attachment?.storageId ||
      subtask.attachment?.localUri ||
      subtask.image?.storageId;

    if (hasAttachment) {
      Alert.alert('קובץ מצורף', '', [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'החלף קובץ',
          onPress: () => {
            setAttachForSubtaskId(subtask.id);
            setAttachSheetOpen(true);
          },
        },
        {
          text: 'הסר קובץ',
          style: 'destructive',
          onPress: async () => {
            try {
              await setSubtaskAttachmentMutation({
                id: taskIdTyped,
                subtaskId: subtask.id,
                attachment: undefined,
              });
            } catch {
              Alert.alert('שגיאה', 'לא ניתן להסיר את הקובץ');
            }
          },
        },
      ]);
      return;
    }
    setAttachForSubtaskId(subtask.id);
    setAttachSheetOpen(true);
  };

  const handleAttachmentPicked = async (
    draft: EventAttachmentDraft
  ): Promise<void> => {
    const subtaskId = attachForSubtaskId;
    setAttachSheetOpen(false);
    setAttachForSubtaskId(null);
    if (!subtaskId) return;

    try {
      const [uploaded] = await uploadAttachmentDraftsForConvex(
        [draft],
        createUploadIntent,
        registerStorageUpload
      );
      if (!uploaded) return;

      const mimeType = draft.mimeType;
      const attType = mimeType.startsWith('image/') ? 'image' : 'file';

      await setSubtaskAttachmentMutation({
        id: taskIdTyped,
        subtaskId,
        attachment: {
          id: `att-${Date.now()}`,
          type: attType,
          storageId: uploaded.storageId,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          createdAt: Date.now(),
          originalName: uploaded.originalName,
          displayName: uploaded.displayName,
        },
      });
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לצרף את הקובץ');
    }
  };

  const handleDragEnd = async ({
    data,
  }: {
    data: InlineSubtask[];
  }): Promise<void> => {
    try {
      await reorderSubtasksMutation({
        id: taskIdTyped,
        orderedIds: data.map((st) => st.id),
      });
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשנות סדר');
    }
  };

  const renderItem = ({
    item: subtask,
    drag,
    isActive,
  }: RenderItemParams<InlineSubtask>) => {
    const att = subtask.attachment ?? subtask.image;
    const storageId = att?.storageId;
    const mimeType = att?.mimeType;
    const displayName = subtask.attachment?.displayName;
    const originalName = subtask.attachment?.originalName;

    return (
      <OpacityDecorator activeOpacity={0.75}>
        <View style={[ils.row, isActive && ils.rowActive]}>
          {/* Drag handle */}
          <TouchableOpacity
            onPressIn={drag}
            style={ils.dragHandle}
            accessible={true}
            accessibilityLabel="גרור לסידור מחדש"
            hitSlop={6}
          >
            <MaterialIcons name="drag-handle" size={20} color="#b0bec5" />
          </TouchableOpacity>

          {/* Checkbox */}
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              handleToggle(subtask.id);
            }}
            style={[ils.checkbox, subtask.completed && ils.checkboxDone]}
            accessible={true}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: subtask.completed }}
            accessibilityLabel={subtask.title}
          >
            {subtask.completed ? (
              <MaterialIcons name="check" size={12} color="#fff" />
            ) : null}
          </Pressable>

          {/* Title */}
          <Text
            style={[ils.title, subtask.completed && ils.titleDone]}
            numberOfLines={2}
          >
            {subtask.title}
          </Text>

          {/* Attachment indicator */}
          {(storageId ?? subtask.attachment?.localUri) ? (
            <InlineAttachmentPreview
              taskId={taskIdTyped}
              storageId={storageId}
              localUri={subtask.attachment?.localUri}
              mimeType={mimeType}
              displayName={displayName}
              originalName={originalName}
              onPress={(resolvedUri) => {
                if (
                  mimeType?.startsWith('image/') &&
                  onOpenImagePreview &&
                  resolvedUri
                ) {
                  onOpenImagePreview(resolvedUri);
                }
              }}
            />
          ) : null}

          {/* Attach button */}
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              handleAttachPress(subtask);
            }}
            style={ils.iconBtn}
            hitSlop={8}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="צרף קובץ"
          >
            <MaterialIcons
              name="attach-file"
              size={18}
              color={storageId ? PRIMARY : '#c7d2da'}
            />
          </Pressable>

          {/* Delete button */}
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              handleDelete(subtask);
            }}
            style={ils.iconBtn}
            hitSlop={8}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="מחק פריט"
          >
            <MaterialIcons name="close" size={16} color="#c7d2da" />
          </Pressable>
        </View>
      </OpacityDecorator>
    );
  };

  return (
    <View style={ils.container}>
      <AttachmentSourceSheet
        visible={attachSheetOpen}
        onClose={() => {
          setAttachSheetOpen(false);
          setAttachForSubtaskId(null);
        }}
        onPicked={handleAttachmentPicked}
      />

      {/* DraggableFlatList with scrollEnabled=false so the parent
          ScrollView/card handles scrolling; drag still works fine. */}
      <DraggableFlatList
        data={subtasks}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
        scrollEnabled={false}
        activationDistance={8}
        disableScrollViewPanResponder={true}
        containerStyle={{ overflow: 'visible' }}
      />

      {/* Add new subtask row */}
      {isAdding ? (
        <View style={ils.addRow}>
          <Pressable
            onPress={() => handleAddConfirm()}
            style={ils.addConfirmBtn}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="אשר הוספה"
          >
            <MaterialIcons name="add" size={16} color={PRIMARY} />
          </Pressable>
          <TextInput
            ref={addInputRef}
            style={ils.addInput}
            value={addingTitle}
            onChangeText={setAddingTitle}
            placeholder="הוסיפי פריט..."
            placeholderTextColor="#9ca3af"
            textAlign={rtl.inputTextAlign}
            returnKeyType="done"
            autoFocus
            blurOnSubmit={false}
            onSubmitEditing={handleAddConfirm}
            onBlur={handleAddConfirm}
            accessible={true}
            accessibilityLabel="הוסיפי פריט חדש"
          />
        </View>
      ) : (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            setIsAdding(true);
          }}
          style={ils.addTrigger}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="הוסף פריט חדש"
        >
          <MaterialIcons name="add" size={16} color={PRIMARY} />
          <Text style={ils.addTriggerText}>הוסף פריט</Text>
        </Pressable>
      )}
    </View>
  );
}

const ils = StyleSheet.create({
  container: {
    marginTop: 4,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingVertical: 6,
    minHeight: 44,
    gap: 6,
    borderRadius: 8,
  },
  rowActive: {
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
  },
  dragHandle: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    borderColor: PRIMARY,
    backgroundColor: PRIMARY,
  },
  title: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  titleDone: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  iconBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBtn: {
    borderRadius: 6,
    overflow: 'hidden',
  },
  thumb: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  fileChip: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5fd',
    borderRadius: 6,
  },
  addRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 6,
  },
  addConfirmBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5fd',
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  addInput: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    textAlign: rtl.inputTextAlign,
    minHeight: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  addTrigger: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  addTriggerText: {
    fontSize: 12,
    color: PRIMARY,
    fontWeight: '600',
    textAlign: rtl.textAlign,
  },
});
