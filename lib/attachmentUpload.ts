import type { Id } from '@/convex/_generated/dataModel';
import type { EventAttachmentDraft } from '@/lib/types/event';

/** Row sent to Convex events/tasks mutations (uploadedBy/uploadedAt stamped server-side). */
export type ConvexAttachmentPayload = {
  storageId: Id<'_storage'>;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ManagedUploadIntent = {
  intentId: Id<'storageUploadIntents'>;
  uploadUrl: string;
};

export type RegisterManagedUpload = (args: {
  intentId: Id<'storageUploadIntents'>;
  storageId: Id<'_storage'>;
}) => Promise<unknown>;

/**
 * Uploads local attachment drafts to Convex Storage (same flow as event creation).
 */
export async function uploadAttachmentDraftsForConvex(
  drafts: EventAttachmentDraft[],
  createUploadIntent: () => Promise<ManagedUploadIntent>,
  registerUpload: RegisterManagedUpload
): Promise<ConvexAttachmentPayload[]> {
  const results: ConvexAttachmentPayload[] = [];

  for (const draft of drafts) {
    if (draft.storageId && !draft.localUri) {
      results.push({
        storageId: draft.storageId,
        originalName: draft.originalName,
        displayName: draft.displayName,
        mimeType: draft.mimeType,
        sizeBytes: draft.sizeBytes,
      });
      continue;
    }

    if (!draft.localUri) continue;

    const { intentId, uploadUrl } = await createUploadIntent();
    const response = await fetch(draft.localUri);
    const blob = await response.blob();

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': draft.mimeType },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error(`העלאת הקובץ נכשלה: ${draft.originalName}`);
    }

    const { storageId } = (await uploadResponse.json()) as {
      storageId: string;
    };
    const typedStorageId = storageId as Id<'_storage'>;
    await registerUpload({ intentId, storageId: typedStorageId });

    results.push({
      storageId: typedStorageId,
      originalName: draft.originalName,
      displayName: draft.displayName,
      mimeType: draft.mimeType,
      sizeBytes: draft.sizeBytes,
    });
  }

  return results;
}
