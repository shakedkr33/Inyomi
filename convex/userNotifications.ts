import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

// ─── Shared write helper ──────────────────────────────────────────────────────
// Plain async TypeScript function — NOT a Convex mutation.
// Call directly from any business mutation that already holds a MutationCtx.
// Inserts one userNotifications row per recipient, unconditionally — push
// opt-out state is irrelevant here (sendPush handles that independently).

export async function createUserNotifications(
  ctx: MutationCtx,
  params: {
    recipientUserIds: Id<'users'>[];
    pushType: string;
    title: string;
    body: string;
    screen: string;
  }
): Promise<void> {
  for (const recipientUserId of params.recipientUserIds) {
    await ctx.db.insert('userNotifications', {
      recipientUserId,
      pushType: params.pushType,
      title: params.title,
      body: params.body,
      screen: params.screen,
      createdAt: Date.now(),
    });
  }
}

// ─── list ─────────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('userNotifications'),
      _creationTime: v.number(),
      recipientUserId: v.id('users'),
      pushType: v.string(),
      title: v.string(),
      body: v.string(),
      screen: v.string(),
      readAt: v.optional(v.number()),
      archivedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    // This root-mounted "my inbox" subscription can re-run after signOut
    // deletes the session, before the client SDK clears its auth state.
    // No live session means no inbox; never read notification rows here.
    // Mutations below still reject, and valid reads remain recipient-scoped.
    if (!userId) return [];

    const rows = await ctx.db
      .query('userNotifications')
      .withIndex('by_recipient_created', (q) => q.eq('recipientUserId', userId))
      .order('desc')
      .collect();

    return rows.filter((n) => n.archivedAt === undefined);
  },
});

// ─── markAllRead ──────────────────────────────────────────────────────────────

export const markAllRead = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const rows = await ctx.db
      .query('userNotifications')
      .withIndex('by_recipient_created', (q) => q.eq('recipientUserId', userId))
      .collect();

    const now = Date.now();
    for (const row of rows) {
      if (row.archivedAt === undefined && row.readAt === undefined) {
        await ctx.db.patch(row._id, { readAt: now });
      }
    }

    return null;
  },
});

// ─── archiveAll ───────────────────────────────────────────────────────────────

export const archiveAll = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const rows = await ctx.db
      .query('userNotifications')
      .withIndex('by_recipient_created', (q) => q.eq('recipientUserId', userId))
      .collect();

    const now = Date.now();
    for (const row of rows) {
      if (row.archivedAt === undefined) {
        await ctx.db.patch(row._id, { archivedAt: now });
      }
    }

    return null;
  },
});
