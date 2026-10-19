import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { isStorageReferencedByOtherDocument } from './taskUtils';

export const STORAGE_UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000;

export type StorageParentType = 'event' | 'task';

type StorageBearingEvent = Pick<Doc<'events'>, 'attachments'>;
type StorageBearingTask = Pick<Doc<'tasks'>, 'attachments' | 'subtasks'>;

export function extractEventStorageIds(
  event: StorageBearingEvent | null | undefined
): Set<Id<'_storage'>> {
  return new Set((event?.attachments ?? []).map((item) => item.storageId));
}

export function extractTaskStorageIds(
  task: StorageBearingTask | null | undefined
): Set<Id<'_storage'>> {
  const result = new Set<Id<'_storage'>>();
  for (const item of task?.attachments ?? []) result.add(item.storageId);
  for (const subtask of task?.subtasks ?? []) {
    if (subtask.image?.storageId) result.add(subtask.image.storageId);
    if (subtask.attachment?.storageId) {
      result.add(subtask.attachment.storageId);
    }
  }
  return result;
}

async function storageFileById(ctx: MutationCtx, storageId: Id<'_storage'>) {
  return await ctx.db
    .query('storageFiles')
    .withIndex('by_storage_id', (q) => q.eq('storageId', storageId))
    .unique();
}

async function ensureFileCanBeAcquired(
  ctx: MutationCtx,
  args: {
    storageId: Id<'_storage'>;
    parentType: StorageParentType;
    parentId: string;
    actorUserId: Id<'users'>;
    now: number;
  }
) {
  const existingFile = await storageFileById(ctx, args.storageId);
  const existingReferences = await ctx.db
    .query('storageReferences')
    .withIndex('by_storage_id', (q) => q.eq('storageId', args.storageId))
    .collect();

  if (
    existingReferences.some(
      (row) =>
        row.parentType !== args.parentType || row.parentId !== args.parentId
    )
  ) {
    throw new Error('לא ניתן לצרף קובץ זה');
  }

  // Until the legacy backfill is complete, the indexed registry is not the
  // sole source of truth. This compatibility scan prevents acquisition of a
  // file referenced by an older parent that has no registry row yet.
  const alreadyReferenced = await isStorageReferencedByOtherDocument(
    ctx,
    args.storageId,
    args.parentType === 'event'
      ? { eventId: args.parentId as Id<'events'> }
      : { taskId: args.parentId as Id<'tasks'> }
  );
  if (alreadyReferenced) throw new Error('לא ניתן לצרף קובץ זה');

  if (!existingFile) {
    // Compatibility mode must not mistake an old client-provided ID for an
    // owned upload. The existing authoritative document scan also protects
    // legacy parents that have not yet received registry rows.
    return null;
  }

  if (existingFile.origin === 'legacy' && !existingFile.uploadIntentId) {
    // A legacy row deliberately carries no ownership proof. Keep using the
    // document scan instead of assigning it to the current actor.
    return existingFile;
  }

  if (
    existingFile.uploadedBy !== undefined &&
    existingFile.uploadedBy !== args.actorUserId
  ) {
    throw new Error('לא ניתן לצרף קובץ שהועלה מחשבון אחר');
  }
  if (!existingFile.uploadIntentId) {
    throw new Error('רישום הקובץ אינו תקין');
  }

  const intent = await ctx.db.get(existingFile.uploadIntentId);
  if (!intent || intent.storageId !== args.storageId) {
    throw new Error('רישום הקובץ אינו תקין');
  }
  if (intent.userId !== args.actorUserId) {
    throw new Error('לא ניתן לצרף קובץ שהועלה מחשבון אחר');
  }
  if (intent.state === 'pending') {
    throw new Error('העלאת הקובץ טרם הושלמה');
  }
  if (intent.state === 'uploaded' && intent.expiresAt <= args.now) {
    throw new Error('תוקף העלאת הקובץ פג');
  }
  if (
    intent.state === 'bound' &&
    (intent.boundParentType !== args.parentType ||
      intent.boundParentId !== args.parentId)
  ) {
    throw new Error('הקובץ כבר משויך לפריט אחר');
  }
  return existingFile;
}

/**
 * Reconciles one parent's unique Storage IDs with the indexed registry.
 * Parent persistence and this helper must run in the same Convex mutation.
 */
export async function syncStorageReferencesForParent(
  ctx: MutationCtx,
  args: {
    parentType: StorageParentType;
    parentId: string;
    before: ReadonlySet<Id<'_storage'>>;
    after: ReadonlySet<Id<'_storage'>>;
    actorUserId: Id<'users'>;
  }
): Promise<void> {
  const now = Date.now();
  const beforeStrings = new Set([...args.before].map(String));
  const afterStrings = new Set([...args.after].map(String));

  for (const storageId of args.after) {
    const isNewAcquisition = !beforeStrings.has(String(storageId));
    let file = await storageFileById(ctx, storageId);

    if (isNewAcquisition) {
      file = await ensureFileCanBeAcquired(ctx, {
        storageId,
        parentType: args.parentType,
        parentId: args.parentId,
        actorUserId: args.actorUserId,
        now,
      });
    }

    if (!file) {
      await ctx.db.insert('storageFiles', {
        storageId,
        origin: 'legacy',
        registeredAt: now,
        updatedAt: now,
      });
    }

    const references = await ctx.db
      .query('storageReferences')
      .withIndex('by_parent_storage', (q) =>
        q
          .eq('parentType', args.parentType)
          .eq('parentId', args.parentId)
          .eq('storageId', storageId)
      )
      .collect();
    if (references.length === 0) {
      await ctx.db.insert('storageReferences', {
        storageId,
        parentType: args.parentType,
        parentId: args.parentId,
        createdAt: now,
        updatedAt: now,
      });
    } else if (references.length > 1) {
      throw new Error('נמצאו הפניות כפולות לקובץ');
    }

    const currentFile = file ?? (await storageFileById(ctx, storageId));
    if (isNewAcquisition && currentFile?.uploadIntentId) {
      const intent = await ctx.db.get(currentFile.uploadIntentId);
      if (intent?.state === 'uploaded') {
        await ctx.db.patch(intent._id, {
          state: 'bound',
          boundParentType: args.parentType,
          boundParentId: args.parentId,
          boundAt: now,
          updatedAt: now,
        });
      }
    }
  }

  for (const storageId of args.before) {
    if (afterStrings.has(String(storageId))) continue;
    const references = await ctx.db
      .query('storageReferences')
      .withIndex('by_parent_storage', (q) =>
        q
          .eq('parentType', args.parentType)
          .eq('parentId', args.parentId)
          .eq('storageId', storageId)
      )
      .collect();
    for (const reference of references) await ctx.db.delete(reference._id);
  }
}

export async function releaseStorageReferencesForParent(
  ctx: MutationCtx,
  parentType: StorageParentType,
  parentId: string
): Promise<void> {
  const references = await ctx.db
    .query('storageReferences')
    .withIndex('by_parent', (q) =>
      q.eq('parentType', parentType).eq('parentId', parentId)
    )
    .collect();
  for (const reference of references) await ctx.db.delete(reference._id);
}

export async function registerUploadedFileForIntent(
  ctx: MutationCtx,
  args: {
    intentId: Id<'storageUploadIntents'>;
    storageId: Id<'_storage'>;
    userId: Id<'users'>;
  }
): Promise<void> {
  const intent = await ctx.db.get(args.intentId);
  if (!intent || intent.userId !== args.userId) {
    throw new Error('העלאה זו אינה שייכת לחשבון הנוכחי');
  }
  if (intent.storageId === args.storageId && intent.state !== 'pending') {
    const file = await storageFileById(ctx, args.storageId);
    if (!file || file.uploadIntentId !== intent._id) {
      throw new Error('רישום הקובץ אינו תקין');
    }
    if (intent.state === 'uploaded' && intent.expiresAt <= Date.now()) {
      throw new Error('תוקף ההעלאה פג');
    }
    // Receipt replay only; this does not assert object existence or ownership.
    return;
  }
  if (intent.state !== 'pending') throw new Error('העלאה זו כבר נוצלה');

  const now = Date.now();
  if (intent.expiresAt <= now) throw new Error('תוקף ההעלאה פג');
  if (!(await ctx.db.system.get(args.storageId))) {
    throw new Error('הקובץ שהועלה לא נמצא');
  }
  if (await storageFileById(ctx, args.storageId)) {
    throw new Error('הקובץ כבר רשום');
  }
  if (
    await ctx.db
      .query('storageReferences')
      .withIndex('by_storage_id', (q) => q.eq('storageId', args.storageId))
      .first()
  ) {
    throw new Error('הקובץ כבר נמצא בשימוש');
  }
  if (await isStorageReferencedByOtherDocument(ctx, args.storageId)) {
    throw new Error('הקובץ כבר נמצא בשימוש');
  }

  await ctx.db.insert('storageFiles', {
    storageId: args.storageId,
    // Direct-upload receipts contain no server-verifiable uploader binding.
    // Keep the intent for flow authorization, never as provenance/deletion proof.
    origin: 'legacy',
    uploadIntentId: args.intentId,
    registeredAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(args.intentId, {
    state: 'uploaded',
    storageId: args.storageId,
    updatedAt: now,
  });
}
