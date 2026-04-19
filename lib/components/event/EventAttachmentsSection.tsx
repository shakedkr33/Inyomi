// FIXED: EventAttachmentsSection — file attachment UI for personal events (max 2 per event)
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { EventAttachmentDraft } from '@/lib/types/event';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';
const MAX_ATTACHMENTS = 2;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}

function isAllowedMime(mime: string): boolean {
  if (mime.startsWith('image/')) return true;
  const allowed = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/octet-stream',
  ]);
  return allowed.has(mime);
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.substring(0, idx) : filename;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── SavedFileRow ─────────────────────────────────────────────────────────────
// Separate component so useQuery is always called unconditionally at top-level.

interface SavedFileRowProps {
  attachment: EventAttachmentDraft & { storageId: Id<'_storage'> };
  onReplace: () => void;
  onRemove: () => void;
  onOpenImage: (url: string) => void;
}

function SavedFileRow({
  attachment,
  onReplace,
  onRemove,
  onOpenImage,
}: SavedFileRowProps): React.JSX.Element {
  const url = useQuery(api.events.getAttachmentUrl, {
    storageId: attachment.storageId,
  });
  const isImage = attachment.mimeType.startsWith('image/');

  const handleTap = (): void => {
    if (!url) return;
    if (isImage) {
      onOpenImage(url);
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <View style={s.fileBlock}>
      <Pressable
        onPress={handleTap}
        accessible
        accessibilityRole="link"
        accessibilityLabel={`פתח קובץ: ${attachment.displayName}`}
        disabled={!url}
      >
        <Text style={[s.savedLink, !url && s.savedLinkLoading]}>
          {attachment.displayName}
        </Text>
      </Pressable>
      <View style={s.fileActions}>
        <Pressable
          onPress={onReplace}
          accessible
          accessibilityRole="button"
          accessibilityLabel="החלף קובץ"
        >
          <Text style={s.actionBtn}>החלף קובץ</Text>
        </Pressable>
        <Text style={s.actionSep}>|</Text>
        <Pressable
          onPress={onRemove}
          accessible
          accessibilityRole="button"
          accessibilityLabel="הסר קובץ"
        >
          <Text style={s.actionBtn}>הסר קובץ</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── DraftFileRow ─────────────────────────────────────────────────────────────

interface DraftFileRowProps {
  attachment: EventAttachmentDraft;
  onDisplayNameChange: (name: string) => void;
  onReplace: () => void;
  onRemove: () => void;
}

function DraftFileRow({
  attachment,
  onDisplayNameChange,
  onReplace,
  onRemove,
}: DraftFileRowProps): React.JSX.Element {
  const isImage = attachment.mimeType.startsWith('image/');

  return (
    <View style={s.fileBlock}>
      {isImage && attachment.localUri ? (
        <Image
          source={{ uri: attachment.localUri }}
          style={s.thumbImage}
          resizeMode="cover"
          accessible
          accessibilityLabel={attachment.displayName}
        />
      ) : (
        <View style={s.docCard}>
          <MaterialIcons name="insert-drive-file" size={28} color={PRIMARY} />
          <View style={s.docMeta}>
            <Text style={s.docName} numberOfLines={1}>
              {attachment.originalName}
            </Text>
            {attachment.sizeBytes > 0 && (
              <Text style={s.docSize}>{formatBytes(attachment.sizeBytes)}</Text>
            )}
          </View>
        </View>
      )}
      <TextInput
        style={s.nameInput}
        value={attachment.displayName}
        onChangeText={onDisplayNameChange}
        placeholder="שם הקובץ"
        placeholderTextColor="#9ca3af"
        textAlign="right"
        accessible
        accessibilityLabel="שם הקובץ"
      />
      <View style={s.fileActions}>
        <Pressable
          onPress={onReplace}
          accessible
          accessibilityRole="button"
          accessibilityLabel="החלף קובץ"
        >
          <Text style={s.actionBtn}>החלף קובץ</Text>
        </Pressable>
        <Text style={s.actionSep}>|</Text>
        <Pressable
          onPress={onRemove}
          accessible
          accessibilityRole="button"
          accessibilityLabel="הסר קובץ"
        >
          <Text style={s.actionBtn}>הסר קובץ</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface EventAttachmentsSectionProps {
  attachments: EventAttachmentDraft[];
  onChange: (attachments: EventAttachmentDraft[]) => void;
}

export function EventAttachmentsSection({
  attachments,
  onChange,
}: EventAttachmentsSectionProps): React.JSX.Element {
  const [imageModalUrl, setImageModalUrl] = useState<string | null>(null);

  const canAddMore = attachments.length < MAX_ATTACHMENTS;

  // ── Validation helpers ──

  const validateAndAdd = (
    draft: EventAttachmentDraft,
    replaceIndex?: number
  ): void => {
    let { mimeType, sizeBytes } = draft;

    if (!mimeType) mimeType = inferMimeType(draft.originalName);
    if (!isAllowedMime(mimeType)) {
      Alert.alert('סוג קובץ לא נתמך', 'סוג קובץ זה אינו נתמך');
      return;
    }
    if (sizeBytes > 0 && sizeBytes > MAX_SIZE_BYTES) {
      Alert.alert('קובץ גדול מדי', 'הקובץ גדול מדי. הגודל המקסימלי הוא 10MB');
      return;
    }

    const finalDraft: EventAttachmentDraft = { ...draft, mimeType };

    if (replaceIndex !== undefined) {
      onChange(attachments.map((a, i) => (i === replaceIndex ? finalDraft : a)));
    } else {
      onChange([...attachments, finalDraft]);
    }
  };

  // ── Pickers ──

  const pickFromGallery = async (replaceIndex?: number): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    const filename = asset.fileName ?? asset.uri.split('/').pop() ?? 'image';
    const mimeType = asset.mimeType ?? inferMimeType(filename);
    const sizeBytes = asset.fileSize ?? 0;

    validateAndAdd(
      {
        originalName: filename,
        displayName: stripExtension(filename),
        mimeType,
        sizeBytes,
        localUri: asset.uri,
      },
      replaceIndex
    );
  };

  const pickFromDocuments = async (replaceIndex?: number): Promise<void> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;

    const filename = asset.name ?? asset.uri.split('/').pop() ?? 'document';
    const mimeType = asset.mimeType ?? inferMimeType(filename);
    const sizeBytes = asset.size ?? 0;

    validateAndAdd(
      {
        originalName: filename,
        displayName: stripExtension(filename),
        mimeType,
        sizeBytes,
        localUri: asset.uri,
      },
      replaceIndex
    );
  };

  const openPicker = (replaceIndex?: number): void => {
    Alert.alert('בחירת קובץ', undefined, [
      {
        text: 'בחירה מהגלריה / תמונות',
        onPress: () => void pickFromGallery(replaceIndex),
      },
      {
        text: 'בחירה מקבצים',
        onPress: () => void pickFromDocuments(replaceIndex),
      },
      { text: 'ביטול', style: 'cancel' },
    ]);
  };

  // ── Handlers ──

  const updateDisplayName = (index: number, name: string): void => {
    onChange(attachments.map((a, i) => (i === index ? { ...a, displayName: name } : a)));
  };

  const removeAt = (index: number): void => {
    onChange(attachments.filter((_, i) => i !== index));
  };

  // ── Render ──

  return (
    // FIXED: header now matches ParticipantsCard pattern — icon-circle right, label center, plus-circle left
    <View style={s.card}>
      {/* Header — matches ParticipantsCard exactly */}
      <View style={s.headerRow}>
        {/* Left: plus-circle (hidden at cap) */}
        {canAddMore ? (
          <Pressable
            style={s.addCircleBtn}
            onPress={() => openPicker()}
            accessible
            accessibilityRole="button"
            accessibilityLabel={attachments.length === 0 ? 'הוסף קובץ' : 'הוסף קובץ נוסף'}
            accessibilityHint="פותח בחירת מקור הקובץ"
          >
            <MaterialIcons name="add" size={18} color={PRIMARY} />
          </Pressable>
        ) : (
          <View style={s.addCircleBtnDisabled} />
        )}

        {/* Center: label */}
        <Text style={s.headerLabel}>קבצים מצורפים</Text>

        {/* Right: icon circle */}
        <View style={s.iconCircle}>
          <MaterialIcons name="attach-file" size={20} color={PRIMARY} />
        </View>
      </View>

      {/* File list */}
      {attachments.map((att, idx) => {
        if (att.storageId && !att.localUri) {
          return (
            <SavedFileRow
              key={`saved-${att.storageId}`}
              attachment={att as EventAttachmentDraft & { storageId: Id<'_storage'> }}
              onReplace={() => openPicker(idx)}
              onRemove={() => removeAt(idx)}
              onOpenImage={(url) => setImageModalUrl(url)}
            />
          );
        }
        return (
          <DraftFileRow
            key={`draft-${idx}-${att.originalName}`}
            attachment={att}
            onDisplayNameChange={(name) => updateDisplayName(idx, name)}
            onReplace={() => openPicker(idx)}
            onRemove={() => removeAt(idx)}
          />
        );
      })}

      {/* Fullscreen image modal */}
      <Modal
        visible={imageModalUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setImageModalUrl(null)}
      >
        <View style={s.imgOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setImageModalUrl(null)}
            accessible={false}
          />
          {imageModalUrl ? (
            <View style={s.imgBox}>
              <Image
                source={{ uri: imageModalUrl }}
                style={s.imgFull}
                resizeMode="contain"
                accessible
                accessibilityLabel="תצוגת קובץ"
              />
              <View style={s.imgActions}>
                <Pressable
                  onPress={() => setImageModalUrl(null)}
                  style={s.imgActionBtn}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="סגור תמונה"
                >
                  <Ionicons name="close" size={20} color="#fff" />
                  <Text style={s.imgActionText}>סגור</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    imageModalUrl
                      ? Linking.openURL(imageModalUrl).catch(() => {})
                      : undefined
                  }
                  style={s.imgActionBtn}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="פתח בדפדפן"
                >
                  <Ionicons name="open-outline" size={20} color="#fff" />
                  <Text style={s.imgActionText}>פתח</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    gap: 10,
  },
  // ── Header — matches ParticipantsCard pattern ──────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Plus-circle on the left (same dimensions as ParticipantsCard addBtn)
  addCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCircleBtnDisabled: {
    width: 32,
    height: 32,
  },
  // Label in the center (flex: 1, right-aligned — same as ParticipantsCard label)
  headerLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
    paddingHorizontal: 8,
  },
  // Icon-circle on the right (same as ParticipantsCard iconCircle)
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── File block (both draft and saved) ──
  fileBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
    gap: 8,
  },

  // ── Draft: image thumbnail ──
  thumbImage: {
    width: '100%',
    height: 120,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
  },

  // ── Draft: document card ──
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    justifyContent: 'flex-end',
  },
  docMeta: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  docName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  docSize: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'right',
  },

  // ── Display name input ──
  nameInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#fafafa',
    textAlign: 'right',
  },

  // ── Actions row (replace | remove) ──
  fileActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  actionBtn: {
    fontSize: 13,
    color: PRIMARY,
    fontWeight: '500',
  },
  actionSep: {
    fontSize: 13,
    color: '#d1d5db',
  },

  // ── Saved: blue tappable link ──
  savedLink: {
    fontSize: 15,
    fontWeight: '600',
    color: PRIMARY,
    textDecorationLine: 'underline',
    textAlign: 'right',
  },
  savedLinkLoading: {
    color: '#9ca3af',
    textDecorationLine: 'none',
  },

  // ── Image modal ──
  imgOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imgBox: {
    width: '92%',
    maxHeight: '80%',
    gap: 12,
  },
  imgFull: {
    width: '100%',
    height: 360,
    borderRadius: 12,
  },
  imgActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  imgActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  imgActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
