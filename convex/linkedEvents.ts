// FIXED: linked event management for personal event sharing
//        snapshot used only for sourceStatus='deleted'; live data from source otherwise
import { v } from 'convex/values';
import { hasAccessRowForSpace } from '../lib/spaceAccess';
import { mutation, query } from './_generated/server';
import { stampEventOwnerScope } from './ownerScope';
import { getAuthUserId } from './sessionAuth';
import { requireSpaceWriteAccess } from './spaceWriteAccess';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve display data for a linked event.
 * - sourceStatus='deleted' → use the saved snapshot (4 public fields only)
 * - sourceStatus='active'|'cancelled' → read live from source event
 * - source event missing but status not yet patched → fall back to snapshot
 */
async function resolveLinkedEventData(
  ctx: { db: { get: (id: string) => Promise<unknown> } },
  linked: {
    sourceEventId: string;
    sourceStatus: string;
    snapshotTitle: string;
    snapshotStartTime: number;
    snapshotEndTime: number;
    snapshotLocation?: string;
  }
) {
  if (linked.sourceStatus === 'deleted') {
    return {
      title: linked.snapshotTitle,
      startTime: linked.snapshotStartTime,
      endTime: linked.snapshotEndTime,
      location: linked.snapshotLocation as string | undefined,
      allDay: false,
      resolvedStatus: 'deleted' as const,
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: Convex db.get returns any
  const source = await (ctx.db as any).get(linked.sourceEventId);
  if (!source || source.deletedAt !== undefined) {
    // Source deleted but sourceStatus not yet patched — use snapshot
    return {
      title: linked.snapshotTitle,
      startTime: linked.snapshotStartTime,
      endTime: linked.snapshotEndTime,
      location: linked.snapshotLocation as string | undefined,
      allDay: false,
      resolvedStatus: 'deleted' as const,
    };
  }

  return {
    title: source.title as string,
    startTime: source.startTime as number,
    endTime: source.endTime as number,
    location: source.location as string | undefined,
    locationUrl: source.locationUrl as string | undefined,
    googlePlaceId: source.googlePlaceId as string | undefined,
    allDay: (source.allDay as boolean | undefined) ?? false,
    resolvedStatus: (source.status === 'cancelled' ? 'cancelled' : 'active') as
      | 'active'
      | 'cancelled',
  };
}

// ─────────────────────────────────────────────────────────────
// שמירת אירוע משותף ביומן הנמען
// ─────────────────────────────────────────────────────────────
export const saveLinkedEvent = mutation({
  args: {
    shareToken: v.string(),
    spaceId: v.id('spaces'),
  },
  handler: async (ctx, { shareToken, spaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('יש להתחבר כדי לשמור אירוע');

    // A share token authorizes the source event, not the destination space.
    const memberRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    if (!hasAccessRowForSpace(memberRows, spaceId)) {
      throw new Error('אין הרשאה לשמור אירוע במרחב זה');
    }
    // Do not create an orphan link if a stale membership outlives its space.
    if (!(await ctx.db.get(spaceId))) throw new Error('המרחב לא נמצא');

    // Validate the share link
    const link = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('token', shareToken))
      .first();
    if (!link || link.revoked) throw new Error('קישור זה אינו פעיל עוד');

    // Load the source event
    const sourceEvent = await ctx.db.get(link.eventId);
    if (!sourceEvent || sourceEvent.deletedAt !== undefined)
      throw new Error('האירוע המקורי לא נמצא');

    // Owner cannot save their own event as a linked event
    if (sourceEvent.createdBy === userId) {
      throw new Error('לא ניתן לשמור אירוע שבבעלותך');
    }

    // Duplicate check — one linked record per (recipient, sourceEvent)
    const existing = await ctx.db
      .query('linkedEvents')
      .withIndex('by_recipient_and_source', (q) =>
        q.eq('savedByUserId', userId).eq('sourceEventId', link.eventId)
      )
      .first();
    if (existing) throw new Error('כבר שמרת אירוע זה ביומן שלך');

    await ctx.db.insert('linkedEvents', {
      sourceEventId: link.eventId,
      shareToken,
      savedByUserId: userId,
      ownerUserId: sourceEvent.createdBy,
      spaceId,
      // Inherit cancelled status if source is already cancelled
      sourceStatus: sourceEvent.status === 'cancelled' ? 'cancelled' : 'active',
      // Snapshot — 4 public fields only; notes/participants/attachments excluded (privacy)
      snapshotTitle: sourceEvent.title,
      snapshotStartTime: sourceEvent.startTime,
      snapshotEndTime: sourceEvent.endTime,
      snapshotLocation: sourceEvent.location,
      savedAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת אירוע מקושר מהיומן (על ידי הנמען — פרטי ושקט, ללא השפעה על המקור)
// ─────────────────────────────────────────────────────────────
export const deleteLinkedEvent = mutation({
  args: { linkedEventId: v.id('linkedEvents') },
  handler: async (ctx, { linkedEventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const linked = await ctx.db.get(linkedEventId);
    if (!linked) throw new Error('אירוע לא נמצא');
    if (linked.savedByUserId !== userId) throw new Error('אין הרשאה');

    await ctx.db.delete(linkedEventId);
  },
});

// ─────────────────────────────────────────────────────────────
// יצירת עותק עצמאי מאירוע מקושר
// יוצר אירוע אישי חדש (4 שדות ציבוריים בלבד) + מסיר את הרשומה המקושרת
// ─────────────────────────────────────────────────────────────
export const copyLinkedEvent = mutation({
  args: { linkedEventId: v.id('linkedEvents') },
  handler: async (ctx, { linkedEventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const linked = await ctx.db.get(linkedEventId);
    if (!linked) throw new Error('אירוע לא נמצא');
    if (linked.savedByUserId !== userId) throw new Error('אין הרשאה');

    await requireSpaceWriteAccess(ctx, userId, linked.spaceId);

    // Resolve display data (live or snapshot)
    const resolved = await resolveLinkedEventData(ctx as never, linked);

    const now = Date.now();
    // Create a standalone personal event — only the 4 public synced fields are copied
    // notes, description, participants, attachments are intentionally NOT copied (privacy)
    const newEventId = await ctx.db.insert('events', {
      title: resolved.title,
      startTime: resolved.startTime,
      endTime: resolved.endTime,
      location: resolved.location,
      allDay: resolved.allDay,
      isAiGenerated: false,
      createdBy: userId,
      spaceId: linked.spaceId,
      createdAt: now,
      // Stamped once at creation — see convex/ownerScope.ts. A standalone
      // copy made from a linked (shared) event is always personal to the
      // user who copied it; no community/family-sharing fields exist on
      // this insert.
      ownerScope: stampEventOwnerScope({ createdBy: userId }),
    });

    // Remove the linked record — linked + copy coexisting would cause calendar clutter
    await ctx.db.delete(linkedEventId);

    return { newEventId };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת אירועים מקושרים לתצוגה (לוח שנה / מסך הבית)
// ─────────────────────────────────────────────────────────────
export const getLinkedEventsForSpace = query({
  args: {
    spaceId: v.id('spaces'),
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, { spaceId, from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Listing a space requires membership; a saved link or family entity alone
    // only grants its own limited access, not access to the space's event list.
    const memberRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    if (!hasAccessRowForSpace(memberRows, spaceId)) return [];

    const linkedRows = await ctx.db
      .query('linkedEvents')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();

    const results = [];

    for (const linked of linkedRows) {
      const resolved = await resolveLinkedEventData(ctx as never, linked);

      // Filter by requested date range
      if (resolved.startTime > to || resolved.endTime < from) continue;

      results.push({
        _id: linked._id,
        sourceEventId: linked.sourceEventId,
        ownerUserId: linked.ownerUserId,
        sourceStatus: resolved.resolvedStatus,
        title: resolved.title,
        startTime: resolved.startTime,
        endTime: resolved.endTime,
        allDay: resolved.allDay,
        location: resolved.location,
        locationUrl: resolved.locationUrl,
        googlePlaceId: resolved.googlePlaceId,
        isLinked: true as const,
        savedAt: linked.savedAt,
      });
    }

    return results;
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת פרטים מלאים של אירוע מקושר בודד (לדף פרטי האירוע)
// ─────────────────────────────────────────────────────────────
export const getLinkedEventDetail = query({
  args: { linkedEventId: v.id('linkedEvents') },
  handler: async (ctx, { linkedEventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const linked = await ctx.db.get(linkedEventId);
    if (!linked) return null;
    if (linked.savedByUserId !== userId) return null;

    const resolved = await resolveLinkedEventData(ctx as never, linked);

    // Owner name for labeling in the detail screen
    const owner = await ctx.db.get(linked.ownerUserId);
    const ownerName =
      (
        owner as { fullName?: string; phone?: string } | null
      )?.fullName?.trim() ||
      ((owner as { phone?: string } | null)?.phone
        ? `...${(owner as { phone: string }).phone.slice(-4)}`
        : null);

    return {
      _id: linked._id,
      sourceEventId: linked.sourceEventId,
      ownerUserId: linked.ownerUserId,
      ownerName,
      sourceStatus: resolved.resolvedStatus,
      title: resolved.title,
      startTime: resolved.startTime,
      endTime: resolved.endTime,
      allDay: resolved.allDay,
      location: resolved.location,
      isLinked: true as const,
      savedAt: linked.savedAt,
    };
  },
});
