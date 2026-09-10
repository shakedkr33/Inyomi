// FIXED: added generateUploadUrl, getEventAttachmentUrl, and attachment support to create + update
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { CANCELLED_COMMUNITY_EVENT_VISIBILITY_WINDOW_MS } from '../lib/eventsTabDateHelpers';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { insertCommunityActivity } from './communityActivities';
import {
  accumulateMainOverviewCandidate,
  type CommunityEventEarlyRemovalVerdict,
  classifyCommunityEventForEventsTab,
  computeCommunityEventPersonalCalendarState,
  computeIsSavedToMyCalendar,
  createMainOverviewAccumulator,
  enrichEventsWithCalendarFlags,
  filterEventsEligibleForReminderGroups,
  finalizeMainOverviewHasMore,
  isCancelledEventRemovedFromCommunityDisplay,
  isEligibleForAdditionalCommunityEvent,
  isMainOverviewAccumulatorSatisfied,
  loadActiveSavedEventIds,
  loadOptOutEventIds,
  type MainOverviewLimits,
  resolveCommunityDateRange,
  resolveCommunityEventEarlyRemovalVerdict,
  resolveDuplicationSourceVerdict,
  selectRecentCancelledCommunityEvents,
} from './communityCalendarState';
import { isActiveCommunityMember } from './communityMemberUtils';
import { resolveMySpaceId } from './members';
import {
  isStorageReferencedByOtherDocument,
  safeDeleteStorageIfUnreferenced,
} from './taskUtils';
import { createUserNotifications } from './userNotifications';

// ─── Attachment arg validator ──────────────────────────────────────────────────
// uploadedBy and uploadedAt are NOT accepted from the client — the handler
// stamps them using the authenticated userId and server time.
const attachmentObject = v.object({
  storageId: v.id('_storage'),
  originalName: v.string(),
  displayName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
});

const importantItemObject = v.object({
  id: v.string(),
  title: v.string(),
});

function sanitizeImportantItems(
  items: Array<{ id: string; title: string }> | undefined
): Array<{ id: string; title: string }> | undefined {
  if (!items) return undefined;
  const sanitized = items
    .map((item) => ({ id: item.id, title: item.title.trim() }))
    .filter((item) => item.title.length > 0);
  return sanitized.length > 0 ? sanitized : undefined;
}

function getImportantItemDueDate(eventStart: number): number | undefined {
  if (eventStart < Date.now()) {
    return undefined;
  }
  return eventStart;
}

function didFieldChange(previousValue: unknown, nextValue: unknown): boolean {
  return JSON.stringify(previousValue) !== JSON.stringify(nextValue);
}

function formatHebrewDate(ts: number): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(ts);
}

function formatHebrewTime(ts: number): string {
  return new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
    hour12: false,
  }).format(ts);
}

async function syncCommunityEventImportantItemTasks(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    communityId: Id<'communities'>;
    spaceId?: Id<'spaces'>;
    startTime: number;
    createdBy: Id<'users'>;
    importantItems: Array<{ id: string; title: string }> | undefined;
  }
): Promise<Array<{ id: string; title: string }> | undefined> {
  const existingTasks = (
    await ctx.db
      .query('tasks')
      .withIndex('by_community', (q) => q.eq('communityId', args.communityId))
      .collect()
  ).filter(
    (task) =>
      task.sourceType === 'community_event_important_item' &&
      task.sourceEventId === args.eventId
  );

  const canonicalTasks = existingTasks.filter(
    (task) => task.assignedTo === undefined
  );
  const existingByStableId = new Map(
    canonicalTasks.map((task) => [task._id as string, task])
  );
  const existingBySourceItemId = new Map(
    canonicalTasks
      .filter((task) => typeof task.sourceImportantItemId === 'string')
      .map((task) => [task.sourceImportantItemId as string, task])
  );
  const dueDate = getImportantItemDueDate(args.startTime);
  const keptTaskIds = new Set<string>();
  const normalizedItems: Array<{ id: string; title: string }> = [];

  for (const item of args.importantItems ?? []) {
    const title = item.title.trim();
    if (!title) continue;

    const existingTask =
      existingByStableId.get(item.id) ?? existingBySourceItemId.get(item.id);
    if (existingTask) {
      await ctx.db.patch(existingTask._id, {
        title,
        dueDate,
        spaceId: undefined,
        communityId: args.communityId,
        sourceImportantItemId: existingTask._id,
      });
      keptTaskIds.add(existingTask._id as string);
      for (const task of existingTasks) {
        const isSameImportantItem =
          task._id === existingTask._id ||
          task.sourceImportantItemId === item.id ||
          task.sourceImportantItemId === existingTask._id;
        if (isSameImportantItem) {
          await ctx.db.patch(task._id, {
            title,
            dueDate,
            sourceImportantItemId: existingTask._id,
          });
          keptTaskIds.add(task._id as string);
        }
      }
      normalizedItems.push({ id: existingTask._id as string, title });
      continue;
    }

    const taskId = await ctx.db.insert('tasks', {
      title,
      completed: false,
      communityId: args.communityId,
      dueDate,
      isAiGenerated: false,
      createdBy: args.createdBy,
      createdAt: Date.now(),
      sourceType: 'community_event_important_item',
      sourceEventId: args.eventId,
    });
    await ctx.db.patch(taskId, { sourceImportantItemId: taskId });
    keptTaskIds.add(taskId as string);
    for (const task of existingTasks) {
      if (task.sourceImportantItemId === item.id) {
        await ctx.db.patch(task._id, {
          title,
          dueDate,
          sourceImportantItemId: taskId,
        });
        keptTaskIds.add(task._id as string);
      }
    }
    normalizedItems.push({ id: taskId as string, title });
  }

  for (const task of existingTasks) {
    if (!keptTaskIds.has(task._id as string)) {
      await ctx.db.delete(task._id);
    }
  }

  return normalizedItems.length > 0 ? normalizedItems : undefined;
}

async function getUserSpaceId(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<Id<'spaces'> | undefined> {
  const membership = await ctx.db
    .query('members')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();
  if (membership?.spaceId) return membership.spaceId;

  const user = await ctx.db.get(userId);
  return user?.defaultSpaceId;
}

async function getCommunityMembership(
  ctx: MutationCtx | QueryCtx,
  communityId: Id<'communities'>,
  userId: Id<'users'>
) {
  return await ctx.db
    .query('communityMembers')
    .withIndex('by_community_user', (q) =>
      q.eq('communityId', communityId).eq('userId', userId)
    )
    .unique();
}

/**
 * STAGE 1D: community MANAGEMENT authorization (owner/admin) is intentionally
 * kept separate from PERSONAL calendar inclusion. This file still checks
 * `membership.role === 'owner' || membership.role === 'admin'` directly,
 * inline, wherever management permission is actually required (edit/delete/
 * cancel event, task assignment management, etc. — see `create`, `update`,
 * `cancelEvent`, `deleteEvent` below) — those checks are UNCHANGED by Stage
 * 1D. What Stage 1D removes is the separate, now-deleted
 * `isCommunityEventPrivilegedForCalendar` helper, which used to ALSO treat
 * raw owner/admin role as a reason to include an event in a manager's
 * personal Home/Calendar even when they didn't create the event, didn't
 * RSVP yes/maybe, and didn't explicitly save it. That was a personal-
 * calendar-inclusion bug, not a permissions feature — management
 * authorization elsewhere in this file is untouched.
 *
 * Personal-calendar inclusion now goes exclusively through
 * `computeIsSavedToMyCalendar` (communityCalendarState.ts), whose valid
 * reasons are: creator, per-community auto-add, explicit save, or RSVP
 * yes/maybe — never raw management role.
 */

// ─────────────────────────────────────────────────────────────
// יצירת URL להעלאת קובץ ל-Convex Storage
// ─────────────────────────────────────────────────────────────
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    return await ctx.storage.generateUploadUrl();
  },
});

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// שליפת URL לצפייה בקובץ מצורף לאירוע — ממוקד ומאובטח
//
// The caller must supply both the eventId and the storageId. The handler:
//   1. Authenticates the user.
//   2. Loads the event.
//   3. Applies the event's actual read-access rules (same as getById).
//   4. Verifies the storageId is referenced by that exact event.
//   5. Returns null when access is denied, the reference is absent, or the
//      storage object is missing — without revealing whether the event exists.
//   6. Only then calls ctx.storage.getUrl(storageId).
// ─────────────────────────────────────────────────────────────
export const getEventAttachmentUrl = query({
  args: {
    eventId: v.id('events'),
    storageId: v.id('_storage'),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { eventId, storageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const event = await ctx.db.get(eventId);
    if (!event) return null;

    // ── Apply the same read-access rules as getById ───────────────────────────
    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) return null;
    } else if (event.createdBy !== userId) {
      // Check creator, space membership, and explicit sharing.
      let canAccess = false;

      if (event.spaceId) {
        const memberRow = await ctx.db
          .query('members')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .filter((q) => q.eq(q.field('spaceId'), event.spaceId))
          .first();
        if (memberRow) canAccess = true;
      }

      if (!canAccess) {
        const viewerMemberRows = await ctx.db
          .query('members')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .collect();
        const viewerMemberIds = new Set(
          viewerMemberRows.map((r) => r._id as string)
        );
        const sharedUserIds = (event.sharedWithUserIds ?? []) as string[];
        const sharedMemberIds = event.sharedWithFamilyMemberIds ?? [];
        if (
          sharedUserIds.includes(userId as string) ||
          sharedMemberIds.some((mid) => viewerMemberIds.has(mid))
        ) {
          canAccess = true;
        }
      }

      if (!canAccess) return null;
    }

    // ── Verify the storageId is referenced by this exact event ────────────────
    const isReferenced = (event.attachments ?? []).some(
      (a) => (a.storageId as string) === (storageId as string)
    );
    if (!isReferenced) return null;

    return await ctx.storage.getUrl(storageId);
  },
});
export const getById = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const event = await ctx.db.get(eventId);
    if (!event) return null;

    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) return null;

      const rsvpRow = await ctx.db
        .query('eventRsvps')
        .withIndex('by_event_user', (q) =>
          q.eq('eventId', eventId).eq('userId', userId)
        )
        .unique();
      const saveRow = await ctx.db
        .query('savedCommunityEvents')
        .withIndex('by_user_event', (q) =>
          q.eq('userId', userId).eq('eventId', eventId)
        )
        .unique();
      const optOutRow = await ctx.db
        .query('communityEventPersonalCalendarOptOuts')
        .withIndex('by_user_event', (q) =>
          q.eq('userId', userId).eq('eventId', eventId)
        )
        .unique();
      const hasActiveSave = saveRow !== null && saveRow.removedAt === undefined;
      const hasOptOut = optOutRow !== null;
      const rsvpStatus = rsvpRow?.status;

      return {
        ...event,
        isSavedToMyCalendar: computeIsSavedToMyCalendar({
          isCreator: event.createdBy === userId,
          autoAddEnabled: membership.autoAddEventsToCalendar === true,
          requiresRsvp: event.requiresRsvp,
          rsvpStatus,
          hasActiveSave,
          hasOptOut,
        }),
      };
    }

    // Creator always has access to their own event.
    if (event.createdBy === userId) {
      return { ...event, isSavedToMyCalendar: false };
    }

    // Space member — can view personal events in their shared family space.
    if (event.spaceId) {
      const memberRow = await ctx.db
        .query('members')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .filter((q) => q.eq(q.field('spaceId'), event.spaceId))
        .first();
      if (memberRow) return { ...event, isSavedToMyCalendar: false };
    }

    // Cross-space: event lives in a different space than the viewer's resolved
    // space (e.g. Yaniv's event stored under spaceY, but viewed by User A whose
    // resolved space is spaceA). Allow access when explicitly shared.
    const viewerMemberRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const viewerMemberIds = new Set(
      viewerMemberRows.map((r) => r._id as string)
    );
    const sharedUserIds = (event.sharedWithUserIds ?? []) as string[];
    const sharedMemberIds = event.sharedWithFamilyMemberIds ?? [];
    const isExplicitlyShared =
      sharedUserIds.includes(userId as string) ||
      sharedMemberIds.some((mid) => viewerMemberIds.has(mid));
    if (isExplicitlyShared) {
      return { ...event, isSavedToMyCalendar: false };
    }

    return null;
  },
});

// ─────────────────────────────────────────────────────────────
// Stage 3 correction — Part 3: server-side defense-in-depth for community
// event duplication ("שכפל אירוע"). The client already fetches the
// duplication source through `getById` and only shows the duplicate action
// to owners/admins, but neither of those independently guarantees that the
// event being duplicated actually belongs to the `communityId` the manager
// is duplicating INTO. This query re-derives both checks from scratch on
// the server so a manager of community A can never have community B's
// event content silently prefilled into A's create form, even if the
// client UI/route params were tampered with — the SAME
// owner/admin-or-community-owner rule `create` already enforces, applied
// here BEFORE any duplicate content is trusted.
// ─────────────────────────────────────────────────────────────
export const verifyDuplicationSource = query({
  args: {
    eventId: v.id('events'),
    communityId: v.id('communities'),
  },
  returns: v.union(
    v.literal('ok'),
    v.literal('not_found'),
    v.literal('community_mismatch'),
    v.literal('forbidden')
  ),
  handler: async (ctx, { eventId, communityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 'forbidden';

    const community = await ctx.db.get(communityId);
    const communityExists = Boolean(community) && !community?.archived;

    // Same permission rule as events.create — only owners/admins of the
    // TARGET community may use the duplication flow.
    const membership = communityExists
      ? await getCommunityMembership(ctx, communityId, userId)
      : null;
    const isOwnerByCommunityRecord =
      communityExists && community?.ownerId === userId;
    const isOwnerOrAdminMembership =
      membership &&
      isActiveCommunityMember(membership) &&
      (membership.role === 'owner' || membership.role === 'admin');
    const canCreateCommunityEvent =
      isOwnerByCommunityRecord || Boolean(isOwnerOrAdminMembership);

    const event = await ctx.db.get(eventId);

    // The source event must belong to the SAME community the manager is
    // duplicating into — never trust the route params independently. All
    // decision logic lives in the pure, unit-tested
    // resolveDuplicationSourceVerdict (see communityCalendarState.ts).
    return resolveDuplicationSourceVerdict({
      communityExists,
      canCreateCommunityEvent,
      event,
      targetCommunityId: communityId,
    });
  },
});

export const resolveCommunityEventLink = query({
  args: { eventId: v.id('events') },
  returns: v.union(
    v.object({ status: v.literal('authRequired') }),
    v.object({ status: v.literal('notFound') }),
    v.object({
      status: v.literal('notMember'),
      communityId: v.id('communities'),
      inviteCode: v.string(),
    }),
    v.object({
      status: v.literal('ok'),
      eventId: v.id('events'),
      communityId: v.id('communities'),
    })
  ),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { status: 'authRequired' as const };

    const event = await ctx.db.get(eventId);
    if (!event || !event.communityId || event.status === 'cancelled') {
      return { status: 'notFound' as const };
    }

    const community = await ctx.db.get(event.communityId);
    if (!community || community.archived === true) {
      return { status: 'notFound' as const };
    }

    const membership = await getCommunityMembership(
      ctx,
      event.communityId,
      userId
    );
    if (!isActiveCommunityMember(membership)) {
      return {
        status: 'notMember' as const,
        communityId: event.communityId,
        inviteCode: community.inviteCode,
      };
    }

    return {
      status: 'ok' as const,
      eventId,
      communityId: event.communityId,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת אירועי קהילה עם cursor pagination (לביצועים)
// ─────────────────────────────────────────────────────────────
export const listByCommunityPaged = query({
  args: {
    communityId: v.id('communities'),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
    fromTime: v.optional(v.number()),
    toTime: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, cursor, numItems, fromTime, toTime }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const autoAddEnabled = membership.autoAddEventsToCalendar === true;

    const { from, to } = resolveCommunityDateRange(fromTime, toTime);
    const pageResult = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q
          .eq('communityId', communityId)
          .gte('startTime', from)
          .lte('startTime', to)
      )
      .paginate({ cursor, numItems: numItems ?? 20 });

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );

    const enrichedPage = await enrichEventsWithCalendarFlags(
      ctx,
      userId,
      pageResult.page,
      rsvpByEventId,
      { autoAddEnabled }
    );

    return {
      ...pageResult,
      page: enrichedPage,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// STAGE 3 — full "אירועים" (Events) tab data source.
//
// This is the paginated, date-scoped query behind the full community
// "אירועים" tab (browse/filter/understand — NOT the bounded Main dashboard
// overview). It intentionally follows Option A from the Stage 3
// investigation rather than three separate unbounded queries: ONE indexed,
// paginated scan of `by_community_date` (identical bounding strategy to
// listByCommunityPaged — never a full-community collect()) returning every
// event in the requested date scope, each enriched with the viewer's
// classification via the SAME canonical two-dimension helpers every other
// community-calendar query already uses
// (classifyCommunityEventForEventsTab -> computeCommunityEventPersonalCalendarState
// + isEligibleForAdditionalCommunityEvent). The caller (TabEvents) buckets
// the accumulated pages into "האירועים שלי" / "מחכים לתגובה" / "אירועים
// נוספים" client-side from these flags — no separate business logic is
// duplicated, and pagination continues correctly no matter how a given
// page's events happen to split across the three (non-exclusive) buckets,
// because bucketing never filters or reorders the underlying page.
//
// Date scope: `fromTime` is resolved via the same resolveCommunityDateRange
// default as listByCommunityPaged (inclusive lower bound), but `toTime` is
// treated as an EXCLUSIVE upper bound here (`.lt`, not `.lte` — see below).
// The caller passes:
//   - "קרובים" (default): fromTime = client "now", toTime omitted (open
//     upper bound) — chronological, nearest-first, genuinely paginated
//     through every future community event, never capped.
//   - a selected month: fromTime = start of month, toTime = the EXCLUSIVE
//     start of the NEXT month (see getEventsTabMonthRange's
//     `nextMonthStart` in lib/eventsTabDateHelpers.ts), so
//     `monthStart <= event.startTime < nextMonthStart` — an event starting
//     at exactly 00:00:00.000 on the 1st of the following month can never
//     appear in this month's page.
// ─────────────────────────────────────────────────────────────
const EVENTS_TAB_DEFAULT_PAGE_SIZE = 20;

export const listCommunityEventsTabPaged = query({
  args: {
    communityId: v.id('communities'),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
    fromTime: v.optional(v.number()),
    toTime: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, cursor, numItems, fromTime, toTime }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const autoAddEnabled = membership.autoAddEventsToCalendar === true;

    // NOTE: unlike listByCommunityPaged (which treats `to` as inclusive —
    // see resolveCommunityDateRange), this query's `toTime` is an EXCLUSIVE
    // upper bound: the caller (TabEvents) always passes the selected
    // month's `nextMonthStart` (see lib/eventsTabDateHelpers.ts), or leaves
    // it undefined for the open-ended "קרובים" scope. `.lt` here — instead
    // of `.lte` — guarantees an event starting at exactly the first
    // instant of the following month can never leak into this page, with
    // no reliance on "last millisecond of month" boundary math.
    const { from, to } = resolveCommunityDateRange(fromTime, toTime);
    const pageResult = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q
          .eq('communityId', communityId)
          .gte('startTime', from)
          .lt('startTime', to)
      )
      .paginate({ cursor, numItems: numItems ?? EVENTS_TAB_DEFAULT_PAGE_SIZE });

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );
    const savedIds = await loadActiveSavedEventIds(ctx, userId);
    const optOutIds = await loadOptOutEventIds(ctx, userId);

    // FIX C — a cancelled event a manager has early-removed from Community
    // display (`removedFromCommunityAt` set, via
    // events.removeCancelledCommunityEvent) must never resurface in the
    // "אירועים שבוטלו" grace-period footer. Filtered out HERE (the
    // authoritative Community cancelled-events data source), not merely on
    // the client, so no other Community rendering path can accidentally
    // reintroduce it. This never deletes the event/row — only excludes it
    // from this query's result page.
    const visiblePage = pageResult.page.filter(
      (ev) => !isCancelledEventRemovedFromCommunityDisplay(ev)
    );

    const enrichedPage = visiblePage.map((ev) => {
      // Cancelled events never belong to any of the three Events tab
      // sections — they surface separately (grace-period "בוטלו" footer),
      // exactly like the pre-Stage-3 TabEvents behavior. Classifying them
      // through the normal rules would be meaningless (e.g. a cancelled
      // event a viewer never answered would otherwise show as "pending").
      if (ev.status === 'cancelled') {
        return {
          ...ev,
          isSavedToMyCalendar: false,
          isPendingRsvp: false,
          isAdditionalEligible: false,
        };
      }

      const idStr = ev._id as string;
      const classification = classifyCommunityEventForEventsTab({
        isCreator: ev.createdBy === userId,
        autoAddEnabled,
        requiresRsvp: ev.requiresRsvp,
        rsvpStatus: rsvpByEventId.get(idStr),
        hasActiveSave: savedIds.has(idStr),
        hasOptOut: optOutIds.has(idStr),
      });

      return {
        ...ev,
        isSavedToMyCalendar: classification.isMyEvent,
        isPendingRsvp: classification.isPendingRsvp,
        isAdditionalEligible: classification.isAdditionalEligible,
      };
    });

    return {
      ...pageResult,
      page: enrichedPage,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת אירועי קהילה לפי communityId (עם טווח תאריכים אופציונלי)
//
// STAGE 1C: `from`/`to` (unix ms, inclusive) bound the `by_community_date`
// index scan so a long-lived community (dozens/hundreds of events across
// multiple years — e.g. a full school year uploaded in advance) doesn't
// force a full-community collect() on every call. Both are optional and
// default to the full range — matching this query's pre-Stage-1C behavior
// — because it currently has exactly one caller
// (app/(authenticated)/calendar.tsx's community-filtered calendar), which
// always passes its visible timeline range as of this stage. A future
// caller that genuinely needs the full lifetime of a community should
// think carefully before omitting the bounds; prefer passing a range.
// ─────────────────────────────────────────────────────────────
export const listByCommunity = query({
  args: {
    communityId: v.id('communities'),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) return [];
    const autoAddEnabled = membership.autoAddEventsToCalendar === true;

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );

    // Loaded once here (rather than inside enrichEventsWithCalendarFlags) so
    // both the personal-inclusion filter below and the enrich step can reuse
    // the same sets without a duplicate DB read in this request.
    const savedIds = await loadActiveSavedEventIds(ctx, userId);
    const optOutIds = await loadOptOutEventIds(ctx, userId);

    const { from: rangeFrom, to: rangeTo } = resolveCommunityDateRange(
      from,
      to
    );
    const events = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q
          .eq('communityId', communityId)
          .gte('startTime', rangeFrom)
          .lte('startTime', rangeTo)
      )
      .filter((q) => q.neq(q.field('status'), 'cancelled'))
      .order('asc')
      .collect();

    const filtered = events.filter((ev) => {
      /** Open to all members — everyone in the community sees it (calendar filtered by community). */
      if (ev.requiresRsvp === false) {
        return true;
      }
      const idStr = ev._id as string;
      return computeIsSavedToMyCalendar({
        isCreator: ev.createdBy === userId,
        autoAddEnabled,
        requiresRsvp: ev.requiresRsvp,
        rsvpStatus: rsvpByEventId.get(ev._id),
        hasActiveSave: savedIds.has(idStr),
        hasOptOut: optOutIds.has(idStr),
      });
    });

    return enrichEventsWithCalendarFlags(ctx, userId, filtered, rsvpByEventId, {
      autoAddEnabled,
      savedIds,
      optOutIds,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// Stage 2A — "ראשי" (Main) community-overview screen data source.
//
// This is the "INDEPENDENTLY BOUNDED source for 'האירועים שלי'" the Stage 1C
// report deferred to the Main-screen redesign (see the STAGE 1C NOTE that
// used to live on the community screen's TabAll). It resolves TWO
// independent, non-exclusive categories in a single bounded scan of the
// community's UPCOMING events only (`startTime >= now`, via the existing
// `by_community_date` index — no new index needed):
//
//   - myEvents: events currently in the viewer's personal calendar
//     (computeCommunityEventPersonalCalendarState().isInPersonalCalendar)
//   - pendingRsvpEvents: events still awaiting an RSVP answer from the
//     viewer (…rsvpAttentionState === 'pending')
//
// An event can land in BOTH arrays (e.g. auto-add ON + RSVP unanswered) —
// this is intentional, see the Stage 2A prompt's "IMPORTANT AUTO-ADD CASE".
//
// Bounding strategy (mirrors the Stage 1C bounding philosophy — never
// collect() the whole community):
//   - Scan the community's upcoming events oldest-first, in small chunks
//     (MAIN_OVERVIEW_CHUNK_SIZE), via .paginate() over the same index range
//     scan listByCommunity/listByCommunityPaged already use, starting the
//     indexed lower bound at the caller-supplied `localDayStart` (the
//     viewer's device-local midnight — see lib/eventsTabDateHelpers.ts's
//     getLocalDayStart) rather than `now` itself, so TODAY's event (timed
//     or all-day) remains reachable for the viewer's entire local day —
//     see the BUG FIX (manual QA, follow-up) doc comment above
//     isMainOverviewAccumulatorSatisfied in communityCalendarState.ts —
//     WITHOUT pulling yesterday's already-ended events into the scan (a
//     previous flat `now - 48h` lookback did).
//   - Feed each scanned event through the pure accumulator helpers in
//     communityCalendarState.ts one at a time, so the scan can stop as soon
//     as BOTH categories are filled (isMainOverviewAccumulatorSatisfied) —
//     one category filling up can never silently consume the whole scan
//     budget and starve the other, because they're tracked independently.
//   - A hard cap (MAIN_OVERVIEW_MAX_SCANNED) bounds worst case for a
//     community where few/no events match either category (e.g. auto-add
//     off and the viewer hasn't RSVP'd/saved anything) — Section D/C
//     ("class with 40 future events" / "school-year 100+ events") still
//     only ever scans a small, fixed number of events per Main load.
//   - `myEventsHasMore` / `pendingRsvpHasMore` are bounded signals (never an
//     expensive exact remaining-count) — see finalizeMainOverviewHasMore.
// ─────────────────────────────────────────────────────────────
const MAIN_OVERVIEW_CHUNK_SIZE = 40;
const MAIN_OVERVIEW_MAX_SCANNED = 160;
const MAIN_OVERVIEW_DEFAULT_MY_EVENTS_LIMIT = 6;
const MAIN_OVERVIEW_DEFAULT_PENDING_RSVP_LIMIT = 3;

type MainOverviewEnrichedEvent = Doc<'events'> & {
  isSavedToMyCalendar: boolean;
};

const EMPTY_MAIN_OVERVIEW: {
  myEvents: MainOverviewEnrichedEvent[];
  myEventsHasMore: boolean;
  pendingRsvpEvents: MainOverviewEnrichedEvent[];
  pendingRsvpHasMore: boolean;
} = {
  myEvents: [],
  myEventsHasMore: false,
  pendingRsvpEvents: [],
  pendingRsvpHasMore: false,
};

export const listCommunityMainOverview = query({
  args: {
    communityId: v.id('communities'),
    /**
     * Client clock (Date.now()) — accepted for API-shape compatibility
     * with existing callers, but intentionally UNUSED by this handler: see
     * the BUG FIX (manual QA, follow-up) doc comment above
     * isMainOverviewAccumulatorSatisfied in communityCalendarState.ts —
     * Community Main eligibility is decided entirely by `localDayStart`
     * now, never by comparing an event's own start/end time to the
     * server's or the viewer's current instant.
     */
    now: v.number(),
    /**
     * 00:00:00.000 of the viewer's LOCAL calendar day, computed client-side
     * (see lib/eventsTabDateHelpers.ts's getLocalDayStart) — the scan's
     * indexed lower bound AND, since the follow-up bug fix above, the
     * ONLY eligibility boundary this query applies: any event reached by
     * the `startTime >= localDayStart` scan belongs to today (or later)
     * and stays eligible all local day, regardless of its own start/end
     * time. The server must not derive this from its own timezone.
     */
    localDayStart: v.number(),
    myEventsLimit: v.optional(v.number()),
    pendingRsvpLimit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { communityId, localDayStart, myEventsLimit, pendingRsvpLimit }
  ) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return EMPTY_MAIN_OVERVIEW;

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) return EMPTY_MAIN_OVERVIEW;
    const autoAddEnabled = membership.autoAddEventsToCalendar === true;

    const limits: MainOverviewLimits = {
      myEventsLimit: myEventsLimit ?? MAIN_OVERVIEW_DEFAULT_MY_EVENTS_LIMIT,
      pendingRsvpLimit:
        pendingRsvpLimit ?? MAIN_OVERVIEW_DEFAULT_PENDING_RSVP_LIMIT,
    };

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );
    const savedIds = await loadActiveSavedEventIds(ctx, userId);
    const optOutIds = await loadOptOutEventIds(ctx, userId);

    let acc = createMainOverviewAccumulator<Doc<'events'>>();
    let cursor: string | null = null;
    let scanned = 0;
    let isDone = false;

    while (
      !isDone &&
      scanned < MAIN_OVERVIEW_MAX_SCANNED &&
      !isMainOverviewAccumulatorSatisfied(acc, limits)
    ) {
      const page = await ctx.db
        .query('events')
        .withIndex('by_community_date', (q) =>
          q.eq('communityId', communityId).gte('startTime', localDayStart)
        )
        .paginate({ cursor, numItems: MAIN_OVERVIEW_CHUNK_SIZE });

      for (const ev of page.page) {
        scanned++;
        // BUG FIX (manual QA, follow-up) — no further "has this event's
        // start/end time passed?" check here: `startTime >= localDayStart`
        // (the query above) is the ONLY Community Main eligibility
        // boundary now. See the doc comment above
        // isMainOverviewAccumulatorSatisfied in communityCalendarState.ts.
        if (ev.status === 'cancelled') continue;
        const idStr = ev._id as string;
        const state = computeCommunityEventPersonalCalendarState({
          isCreator: ev.createdBy === userId,
          autoAddEnabled,
          requiresRsvp: ev.requiresRsvp,
          rsvpStatus: rsvpByEventId.get(idStr),
          hasActiveSave: savedIds.has(idStr),
          hasOptOut: optOutIds.has(idStr),
        });
        acc = accumulateMainOverviewCandidate(
          acc,
          {
            item: ev,
            isInPersonalCalendar: state.isInPersonalCalendar,
            isPendingRsvp: state.rsvpAttentionState === 'pending',
          },
          limits
        );
      }

      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    // Hitting the hard safety cap while the underlying query is NOT done is
    // proof of nothing except "we stopped looking" — it must never be read
    // as "this category is exhausted", even when a category's array is
    // still empty/under its limit. See the Stage 2A scale-edge-case
    // investigation (scan cap at 160, matching event at ~position 170).
    const scanTruncated = scanned >= MAIN_OVERVIEW_MAX_SCANNED && !isDone;
    acc = finalizeMainOverviewHasMore(acc, limits, {
      scanExhausted: isDone,
      scanTruncated,
    });

    const [enrichedMyEvents, enrichedPendingRsvpEvents] = await Promise.all([
      enrichEventsWithCalendarFlags(ctx, userId, acc.myEvents, rsvpByEventId, {
        autoAddEnabled,
        savedIds,
        optOutIds,
      }),
      enrichEventsWithCalendarFlags(
        ctx,
        userId,
        acc.pendingRsvpEvents,
        rsvpByEventId,
        { autoAddEnabled, savedIds, optOutIds }
      ),
    ]);

    return {
      myEvents: enrichedMyEvents,
      myEventsHasMore: acc.myEventsHasMore,
      pendingRsvpEvents: enrichedPendingRsvpEvents,
      pendingRsvpHasMore: acc.pendingRsvpHasMore,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// QA FIX (Issue 2) — "אירועים נוספים" community-overview section.
//
// listCommunityMainOverview intentionally stays bounded to a small,
// independently-limited "האירועים שלי" / "מחכים לתגובה" scan (Stage 2A) —
// this is a SEPARATE, genuinely paginated query rather than widening that
// bounded scan, so a community with 5/10/30+ open events remains fully
// discoverable from Main without ever risking an unbounded
// `.collect()`/scan over every future community event.
//
// Bounding strategy: a single indexed page (`by_community_date`,
// `startTime >= now`, oldest-first) per call via `.paginate()` — exactly
// the same page-at-a-time approach listByCommunityPaged already uses for
// the Events tab. The CALLER (a horizontal carousel/list) is expected to
// request the next page as the user approaches the end, exactly like
// TabEvents' infinite list — never all pages up front.
//
// Eligibility is decided by the pure, testable
// `isEligibleForAdditionalCommunityEvent` helper (communityCalendarState.ts),
// reusing the SAME `computeCommunityEventPersonalCalendarState` two-
// dimension model every other community-calendar query already uses — so
// this can never drift out of sync with "האירועים שלי" / "מחכים לתגובה" on
// what counts as personally-included or RSVP-pending. Because eligibility
// filtering happens AFTER the page is fetched, a returned page can be
// smaller than `numItems` (or empty) while `isDone` is still false — the
// caller must keep requesting `continueCursor` until `isDone` to reliably
// reach every eligible event, matching the existing listByCommunityPaged
// contract.
// ─────────────────────────────────────────────────────────────
const ADDITIONAL_EVENTS_DEFAULT_PAGE_SIZE = 12;

export const listCommunityAdditionalEventsPaged = query({
  args: {
    communityId: v.id('communities'),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
    /**
     * Client clock (Date.now()) — accepted for API-shape compatibility
     * with existing callers, but intentionally UNUSED by this handler; see
     * listCommunityMainOverview's identical arg doc comment above.
     */
    now: v.number(),
    /**
     * 00:00:00.000 of the viewer's LOCAL calendar day — see
     * listCommunityMainOverview's identical arg doc comment above. This is
     * now the ONLY eligibility boundary this query applies: keeps
     * yesterday's already-ended events out of the paginated source set
     * entirely, while today's events (timed or all-day) remain eligible
     * all local day regardless of their own start/end time.
     */
    localDayStart: v.number(),
  },
  handler: async (ctx, { communityId, cursor, numItems, localDayStart }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const autoAddEnabled = membership.autoAddEventsToCalendar === true;

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );
    const savedIds = await loadActiveSavedEventIds(ctx, userId);
    const optOutIds = await loadOptOutEventIds(ctx, userId);

    const pageResult = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q.eq('communityId', communityId).gte('startTime', localDayStart)
      )
      .paginate({
        cursor,
        numItems: numItems ?? ADDITIONAL_EVENTS_DEFAULT_PAGE_SIZE,
      });

    const eligible = pageResult.page.filter((ev) => {
      // BUG FIX (manual QA, follow-up) — no further "has this event's
      // start/end time passed?" check here; see listCommunityMainOverview's
      // identical comment above its scan loop.
      if (ev.status === 'cancelled') return false;
      const idStr = ev._id as string;
      const rsvpStatus = rsvpByEventId.get(idStr);
      const state = computeCommunityEventPersonalCalendarState({
        isCreator: ev.createdBy === userId,
        autoAddEnabled,
        requiresRsvp: ev.requiresRsvp,
        rsvpStatus,
        hasActiveSave: savedIds.has(idStr),
        hasOptOut: optOutIds.has(idStr),
      });
      return isEligibleForAdditionalCommunityEvent({
        rsvpStatus,
        isInPersonalCalendar: state.isInPersonalCalendar,
        rsvpAttentionState: state.rsvpAttentionState,
      });
    });

    const enrichedPage = await enrichEventsWithCalendarFlags(
      ctx,
      userId,
      eligible,
      rsvpByEventId,
      { autoAddEnabled, savedIds, optOutIds }
    );

    return {
      ...pageResult,
      page: enrichedPage,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// Stage 4 — Community "תזכורות" tab: EVENT-BASED "חשוב לזכור" groups.
//
// Returns, per community, the bounded/paginated set of events whose
// important-items group should appear as an active reminder card for the
// viewer right now: personally relevant (Stage 1D `isInPersonalCalendar` —
// the SAME canonical helper every other community-calendar surface uses,
// never a parallel notion), not cancelled, and containing at least one
// "חשוב לזכור" item. See `filterEventsEligibleForReminderGroups` /
// `isEventImportantItemsGroupEligible` in communityCalendarState.ts for the
// exact, unit-tested rule.
//
// BOUNDING: paginates the existing `by_community_date` index, starting
// `EVENT_REMINDER_GROUPS_LOOKBACK_MS` before the caller's clock instead of
// exactly `now` — a plain `.gte('startTime', now)` (like
// listCommunityAdditionalEventsPaged) would drop an event that started
// earlier today but is still ongoing (e.g. a 09:00–18:00 event viewed at
// noon), whose important items ("bring a hat") are still exactly the
// mental load this tab exists for. The lookback is a bounded, generous
// (48h) MVP boundary for single-day events — this schema has no
// multi-day-event concept today (see the Stage 4 report), so it is not a
// silent product regression, just a documented limit.
//
// "Has this event ended" is deliberately NOT decided here (see
// `isEventImportantItemsGroupEligible`'s doc comment) — the CALLER must
// filter the accumulated pages with `hasEventEndedByNow` (the same
// client-side, device-local-time helper the "אירועים" tab already uses)
// before rendering. This query only guarantees the event started within
// the lookback window and is personally-relevant/not-cancelled/has-items.
//
// Eligibility filtering happens AFTER the page is fetched, so a returned
// page can be smaller than `numItems` (or empty) while `isDone` is still
// false — the caller must keep requesting `continueCursor` until `isDone`,
// matching every other bounded community-calendar query's contract (see
// listCommunityAdditionalEventsPaged above).
// ─────────────────────────────────────────────────────────────
const EVENT_REMINDER_GROUPS_DEFAULT_PAGE_SIZE = 20;
const EVENT_REMINDER_GROUPS_LOOKBACK_MS = 48 * 60 * 60 * 1000;

const eventReminderGroupShape = v.object({
  _id: v.id('events'),
  title: v.string(),
  startTime: v.number(),
  endTime: v.number(),
  allDay: v.optional(v.boolean()),
  location: v.optional(v.string()),
  status: v.optional(v.union(v.literal('active'), v.literal('cancelled'))),
  importantItems: v.array(importantItemObject),
  // Needed by the client to gate the per-item delete control to the exact
  // same authorization rule enforced server-side by events.update
  // (creator OR active community owner/admin) — see PART B3.
  createdBy: v.id('users'),
});

export const listCommunityEventReminderGroupsPaged = query({
  args: {
    communityId: v.id('communities'),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
    /** Client clock (Date.now()) — never Date.now() inside the handler. */
    now: v.number(),
  },
  returns: v.object({
    page: v.array(eventReminderGroupShape),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { communityId, cursor, numItems, now }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const autoAddEnabled = membership.autoAddEventsToCalendar === true;

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );
    const savedIds = await loadActiveSavedEventIds(ctx, userId);
    const optOutIds = await loadOptOutEventIds(ctx, userId);

    const pageResult = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q
          .eq('communityId', communityId)
          .gte('startTime', now - EVENT_REMINDER_GROUPS_LOOKBACK_MS)
      )
      .paginate({
        cursor,
        numItems: numItems ?? EVENT_REMINDER_GROUPS_DEFAULT_PAGE_SIZE,
      });

    const eligible = filterEventsEligibleForReminderGroups(
      pageResult.page,
      userId,
      rsvpByEventId,
      { autoAddEnabled, savedIds, optOutIds }
    );

    return {
      page: eligible.map((ev) => ({
        _id: ev._id,
        title: ev.title,
        startTime: ev.startTime,
        endTime: ev.endTime,
        allDay: ev.allDay,
        location: ev.location,
        status: ev.status,
        importantItems: ev.importantItems ?? [],
        createdBy: ev.createdBy,
      })),
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// שליפת אירועים לפי טווח תאריכים
// spaceId is resolved server-side via resolveMySpaceId so the server
// is always authoritative about which family space the caller belongs to.
//
// ─────────────────────────────────────────────────────────────
// אירועים קשורים ליום הולדת
// ─────────────────────────────────────────────────────────────
export const listByRelatedBirthday = query({
  args: { birthdayId: v.string() },
  handler: async (ctx, { birthdayId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query('events')
      .withIndex('by_related_birthday', (q) =>
        q.eq('relatedBirthdayId', birthdayId)
      )
      .filter((q) => q.eq(q.field('createdBy'), userId))
      .collect();
  },
});

// Two categories are merged:
//   Category 1 — events in the viewer's resolved space (creator + saved community)
//   Category 2 — personal events explicitly shared with the viewer from ANY space
//                (handles cross-space sharing where creator's event lives in a
//                 different spaceId than the viewer's resolved space)
// ─────────────────────────────────────────────────────────────

/** Minimal shape of a Category 2 candidate event needed by the inclusion predicate below. */
export type Category2CandidateEvent = {
  _id: string;
  communityId?: unknown;
  createdBy: string;
  deletedAt?: number;
  status?: 'active' | 'cancelled';
  sharedWithUserIds?: string[];
  sharedWithFamilyMemberIds?: string[];
};

/**
 * Pure membership/visibility predicate for Category 2 (cross-space personal
 * event sharing) in `listByDateRange`.
 *
 * IMPORTANT: this function performs NO date-range check — by the time a
 * candidate reaches this predicate it has already been bounded by the
 * `by_community_date` index range scan (`communityId === undefined` AND
 * `startTime` within [from, to]) in the caller. This function only decides
 * whether the *viewer* is allowed to see a given already-date-bounded
 * candidate, preserving the exact pre-optimization semantics.
 */
export function shouldIncludeCategory2Event(
  ev: Category2CandidateEvent,
  params: {
    userId: string;
    myMemberIdsAllSpaces: Set<string>;
    personalOptOutIds: Set<string>;
  }
): boolean {
  const { userId, myMemberIdsAllSpaces, personalOptOutIds } = params;
  const idStr = ev._id;

  if (ev.communityId) return false; // community events use separate RSVP/save logic
  if (ev.createdBy === userId) return false; // creator always sees via Cat 1
  if (ev.deletedAt !== undefined) return false; // soft-deleted for all viewers

  const sharedUserIds = ev.sharedWithUserIds ?? [];
  const sharedMemberIds = ev.sharedWithFamilyMemberIds ?? [];

  const isSharedWithViewer =
    sharedUserIds.includes(userId) ||
    sharedMemberIds.some((mid) => myMemberIdsAllSpaces.has(mid));

  if (!isSharedWithViewer) return false;

  // Opt-out: the viewer is always a non-creator here. Hide regardless of status.
  if (personalOptOutIds.has(idStr)) return false;

  // Cancelled: only include if it has invitees (opt-out already handled above).
  if (ev.status === 'cancelled') {
    const hasInvitees = sharedUserIds.length > 0 || sharedMemberIds.length > 0;
    if (!hasInvitees) return false;
  }

  return true;
}

export const listByDateRange = query({
  args: {
    from: v.number(), // Unix timestamp (ms) – תחילת טווח
    to: v.number(), // Unix timestamp (ms) – סוף טווח
  },
  handler: async (ctx, { from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const spaceId = await resolveMySpaceId(ctx, userId);

    // Collect ALL member row _ids this viewer has across ALL spaces — both entity
    // and access kinds. sharedWithFamilyMemberIds stores members._id values, so
    // we compare against every row linked to this user regardless of space.
    const myMemberRows = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    // For Category 1 visibility (same-space events), restrict to the viewer's resolved space.
    const myMemberIdsInSpace = new Set(
      spaceId
        ? myMemberRows
            .filter((r) => (r.spaceId as string) === (spaceId as string))
            .map((r) => r._id as string)
        : []
    );
    // For Category 2 visibility (cross-space events), use ALL member row IDs regardless of space.
    const myMemberIdsAllSpaces = new Set(
      myMemberRows.map((r) => r._id as string)
    );

    // Load personal event opt-outs for the current viewer.
    // These are rows in personalEventCalendarOptOuts where userId === current user.
    // Updated listing behavior (Phase B): cancelled personal events with invitees
    // are included until each invitee opts out — see loop below.
    const personalOptOutRows = await ctx.db
      .query('personalEventCalendarOptOuts')
      .withIndex('by_user_event', (q) => q.eq('userId', userId))
      .collect();
    const personalOptOutIds = new Set(
      personalOptOutRows.map((r) => r.eventId as string)
    );

    // ── Category 1: events in the viewer's resolved space ──────────────────────
    // NOTE: the cancelled filter is intentionally removed from the DB query so that
    // cancelled personal events with invitees can remain visible until each invitee
    // opts out. Community cancelled events are skipped in the processing loop below.
    const cat1Rows = spaceId
      ? await ctx.db
          .query('events')
          .withIndex('by_space_and_time', (q) =>
            q.eq('spaceId', spaceId).gte('startTime', from).lte('startTime', to)
          )
          .order('asc')
          .collect()
      : [];

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );
    const savedIds = await loadActiveSavedEventIds(ctx, userId);
    const optOutIds = await loadOptOutEventIds(ctx, userId);

    const communityIdSet = new Set<string>();
    for (const e of cat1Rows) {
      if (e.communityId) communityIdSet.add(e.communityId as string);
    }
    const communityNameById = new Map<string, string>();
    // Stage 1D: per-distinct-community auto-add signal for this viewer, bounded
    // by the number of distinct communities appearing in range (same cardinality
    // as communityNameById above) — not a per-event fan-out.
    const autoAddByCommunityId = new Map<string, boolean>();
    for (const cidStr of communityIdSet) {
      const c = await ctx.db.get(cidStr as Id<'communities'>);
      if (c) communityNameById.set(cidStr, c.name);
      const membership = await getCommunityMembership(
        ctx,
        cidStr as Id<'communities'>,
        userId
      );
      autoAddByCommunityId.set(
        cidStr,
        membership?.autoAddEventsToCalendar === true
      );
    }

    type SharedMemberProfile = {
      id: string;
      displayName: string;
      color: string;
      /** True when this member row belongs to the current viewer — used to skip self-circle on recipient side. */
      isViewer: boolean;
    };

    type ResultEvent = (typeof cat1Rows)[0] & {
      communityName?: string;
      isSavedToMyCalendar: boolean;
      sharedMemberProfiles?: SharedMemberProfile[];
    };

    const result: ResultEvent[] = [];
    const seenIds = new Set<string>();

    for (const ev of cat1Rows) {
      // Skip soft-deleted events for all viewers
      if (ev.deletedAt !== undefined) continue;

      const idStr = ev._id as string;
      const rsvpStatus = rsvpByEventId.get(idStr);
      let communityName: string | undefined;
      let isSavedToMyCalendar = false;

      if (ev.communityId) {
        // Community events: keep existing behavior — cancelled events are never shown.
        if (ev.status === 'cancelled') continue;
        const communityIdStr = ev.communityId as string;
        communityName = communityNameById.get(communityIdStr);
        isSavedToMyCalendar = computeIsSavedToMyCalendar({
          isCreator: (ev.createdBy as string) === (userId as string),
          autoAddEnabled: autoAddByCommunityId.get(communityIdStr) === true,
          requiresRsvp: ev.requiresRsvp,
          rsvpStatus,
          hasActiveSave: savedIds.has(idStr),
          hasOptOut: optOutIds.has(idStr),
        });
        // Community events that appear via the space index (have spaceId set)
        // must still respect personal-calendar saved state — only include if
        // actively saved. This mirrors listCommunityEventsForDate filtering.
        if (!isSavedToMyCalendar) continue;
      } else {
        // Personal events are private by default.
        // Only return this event if the caller is the creator, was explicitly
        // shared with (via sharedWithFamilyMemberIds or sharedWithUserIds), or
        // the event was explicitly shared with the whole family (allFamily).
        const isCreator = (ev.createdBy as string) === (userId as string);
        const isAllFamily = ev.allFamily === true;
        const isInUserIds = (ev.sharedWithUserIds ?? []).some(
          (id) => (id as string) === (userId as string)
        );
        // Use myMemberIdsAllSpaces (not myMemberIdsInSpace) so that when User A
        // saves the viewer's entity row ID from spaceA into sharedWithFamilyMemberIds,
        // the viewer's lookup succeeds even if their resolved primary space is spaceB.
        const isInMemberIds = (ev.sharedWithFamilyMemberIds ?? []).some((mid) =>
          myMemberIdsAllSpaces.has(mid)
        );
        if (!isCreator && !isAllFamily && !isInUserIds && !isInMemberIds) {
          continue;
        }

        // Opt-out: hide this personal event for the current user regardless of
        // event status (active or cancelled). Creators cannot insert opt-out rows
        // so this check only matters for non-creators.
        if (!isCreator && personalOptOutIds.has(idStr)) continue;

        // Cancelled personal events: only include when the event has invitees.
        // Without invitees, a cancelled personal event is invisible (existing behavior).
        // With invitees, it stays visible until each viewer personally opts out
        // (opt-out already handled above).
        if (ev.status === 'cancelled') {
          const hasInvitees =
            (ev.sharedWithUserIds?.length ?? 0) > 0 ||
            (ev.sharedWithFamilyMemberIds?.length ?? 0) > 0;
          if (!hasInvitees) continue;
        }
      }

      seenIds.add(idStr);
      result.push({ ...ev, communityName, isSavedToMyCalendar });
    }

    // ── Category 2: personal events explicitly shared with viewer from ANY space ─
    // This handles the cross-space case: the event creator's spaceId differs from
    // the viewer's resolved spaceId, so the by_space_and_time index never returns it.
    //
    // Bounded via the existing `by_community_date` index ([communityId, startTime]):
    // personal (non-community) events always have `communityId === undefined`, so
    // `q.eq('communityId', undefined)` narrows to exactly the Category 2 candidate
    // set (community events are excluded at the index level, matching the
    // `if (ev.communityId) continue` check below) and `startTime` is bounded by the
    // requested range BEFORE any documents are loaded — no table-wide scan.
    // Cat2 includes cancelled personal events with invitees so cross-space
    // recipients still see them as "בוטל" until they opt out.
    const cat2Candidates = await ctx.db
      .query('events')
      .withIndex('by_community_date', (q) =>
        q
          .eq('communityId', undefined)
          .gte('startTime', from)
          .lte('startTime', to)
      )
      .collect();

    for (const ev of cat2Candidates) {
      const idStr = ev._id as string;
      if (seenIds.has(idStr)) continue; // already included from Cat 1

      if (
        !shouldIncludeCategory2Event(ev as Category2CandidateEvent, {
          userId: userId as string,
          myMemberIdsAllSpaces,
          personalOptOutIds,
        })
      ) {
        continue;
      }

      seenIds.add(idStr);
      result.push({
        ...ev,
        communityName: undefined,
        isSavedToMyCalendar: false,
      });
    }

    // Re-sort ascending by startTime since Cat 2 events were appended unordered.
    result.sort((a, b) => a.startTime - b.startTime);

    // Resolve sharedMemberProfiles for personal events.
    // Fetching member rows server-side makes circle display cross-space-safe:
    // a recipient's local member map is keyed by their own space's IDs and cannot
    // resolve IDs from the creator's space; the server has no such limitation.
    for (let i = 0; i < result.length; i++) {
      const ev = result[i];
      if (ev.communityId) continue;
      const mids = (ev.sharedWithFamilyMemberIds ?? []) as string[];
      if (mids.length === 0) continue;
      const profiles: SharedMemberProfile[] = [];
      for (const mid of mids) {
        const row = await ctx.db.get(mid as Id<'members'>);
        if (!row) continue;
        const dn = row.displayName?.trim();
        if (!dn) continue;
        profiles.push({
          id: mid,
          displayName: dn,
          color: row.color ?? '#36a9e2',
          isViewer: row.matchedUserId === userId || row.userId === userId,
        });
      }
      result[i] = { ...ev, sharedMemberProfiles: profiles };
    }

    return result;
  },
});

// ─────────────────────────────────────────────────────────────
// יצירת אירוע חדש
// ─────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    allDay: v.optional(v.boolean()),
    isRecurring: v.optional(v.boolean()),
    recurringPattern: v.optional(v.string()),
    spaceId: v.optional(v.id('spaces')),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    locationUrl: v.optional(v.string()),
    onlineUrl: v.optional(v.string()),
    groupId: v.optional(v.id('spaces')),
    // FIXED: persist personal event participants collected in EventScreen
    participants: v.optional(v.array(v.string())),
    sharedWithUserIds: v.optional(v.array(v.id('users'))),
    communityId: v.optional(v.id('communities')),
    tasksVisibleToParticipants: v.optional(v.boolean()),
    requiresRsvp: v.optional(v.boolean()),
    // FIXED: added family sharing fields to create mutation
    allFamily: v.optional(v.boolean()),
    sharedWithFamilyMemberIds: v.optional(v.array(v.string())),
    // FIXED: file attachments (max 2 enforced here)
    attachments: v.optional(v.array(attachmentObject)),
    // Reminder offsets in minutes before event start
    reminders: v.optional(v.array(v.number())),
    importantItems: v.optional(v.array(importantItemObject)),
    // ── Birthday relation (optional) ─────────────────────────────────────────
    relatedType: v.optional(v.literal('birthday')),
    relatedBirthdayId: v.optional(v.string()),
    relatedBirthdayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');
    const importantItems = sanitizeImportantItems(args.importantItems);
    const resolvedSpaceId =
      args.spaceId ??
      (args.communityId ? await getUserSpaceId(ctx, userId) : undefined);

    let communityName = '';
    if (args.communityId) {
      const community = await ctx.db.get(args.communityId);
      if (!community || community.archived) {
        throw new Error('קהילה לא נמצאה');
      }
      communityName = community.name;
      const membership = await getCommunityMembership(
        ctx,
        args.communityId,
        userId
      );
      const isOwnerByCommunityRecord = community.ownerId === userId;
      const isOwnerOrAdminMembership =
        membership &&
        isActiveCommunityMember(membership) &&
        (membership.role === 'owner' || membership.role === 'admin');
      const canCreateCommunityEvent =
        isOwnerByCommunityRecord || Boolean(isOwnerOrAdminMembership);
      if (!canCreateCommunityEvent) {
        throw new Error('רק בעלים או מנהלי קהילה יכולים ליצור אירוע קהילתי');
      }
    }

    if (args.attachments && args.attachments.length > 2) {
      throw new Error('לא ניתן לצרף יותר מ-2 קבצים לאירוע');
    }

    // Reject any submitted storageId that is already referenced by another
    // task or event document — prevents cross-document attachment hijack.
    for (const att of args.attachments ?? []) {
      if (await isStorageReferencedByOtherDocument(ctx, att.storageId)) {
        throw new Error('לא ניתן לצרף קובץ זה');
      }
    }

    const now = Date.now();
    // Stamp uploadedBy and uploadedAt server-side — not trusted from client
    const stamped = args.attachments?.map((a) => ({
      ...a,
      uploadedBy: userId,
      uploadedAt: now,
    }));

    const eventId = await ctx.db.insert('events', {
      ...args,
      spaceId: resolvedSpaceId,
      attachments: stamped,
      importantItems,
      tasksVisibleToParticipants: args.tasksVisibleToParticipants ?? false,
      isAiGenerated: false,
      createdBy: userId,
      createdAt: now,
    });

    if (args.communityId) {
      const existingSave = await ctx.db
        .query('savedCommunityEvents')
        .withIndex('by_user_event', (q) =>
          q.eq('userId', userId).eq('eventId', eventId)
        )
        .unique();
      if (existingSave) {
        if (existingSave.removedAt !== undefined) {
          await ctx.db.patch(existingSave._id, { removedAt: undefined });
        }
      } else {
        await ctx.db.insert('savedCommunityEvents', {
          userId,
          eventId,
          communityId: args.communityId,
          createdAt: now,
        });
      }
    }

    if (args.communityId) {
      const syncedImportantItems = await syncCommunityEventImportantItemTasks(
        ctx,
        {
          eventId,
          communityId: args.communityId,
          spaceId: resolvedSpaceId,
          startTime: args.startTime,
          createdBy: userId,
          importantItems,
        }
      );
      await ctx.db.patch(eventId, { importantItems: syncedImportantItems });
      await insertCommunityActivity(ctx, {
        communityId: args.communityId,
        actorUserId: userId,
        type: 'event_created',
        entityType: 'event',
        entityId: eventId,
        title: `נוצר אירוע חדש: ${args.title}`,
      });

      const communityId = args.communityId;
      const allMembers = await ctx.db
        .query('communityMembers')
        .withIndex('by_community', (q) => q.eq('communityId', communityId))
        .collect();

      const recipientUserIds = allMembers
        .filter(
          (m) =>
            isActiveCommunityMember(m) &&
            m.userId !== userId &&
            m.notificationsEnabled !== false
        )
        .map((m) => m.userId);

      if (recipientUserIds.length > 0) {
        const eventCreatedTitle = `אירוע חדש ב${communityName}`;
        const eventCreatedBody = `${args.title}`;
        const eventCreatedScreen = `/(authenticated)/event/${eventId}`;

        await createUserNotifications(ctx, {
          recipientUserIds,
          pushType: 'community_event_created',
          title: eventCreatedTitle,
          body: eventCreatedBody,
          screen: eventCreatedScreen,
        });

        await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
          recipientUserIds,
          pushType: 'community_event_created',
          title: eventCreatedTitle,
          body: eventCreatedBody,
          data: { screen: eventCreatedScreen },
          channelId: 'communities',
        });
      }
    }

    return eventId;
  },
});

// ─────────────────────────────────────────────────────────────
// עדכון אירוע קיים
// ─────────────────────────────────────────────────────────────
export const update = mutation({
  args: {
    id: v.id('events'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    isRecurring: v.optional(v.boolean()),
    recurringPattern: v.optional(v.string()),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    locationUrl: v.optional(v.string()),
    onlineUrl: v.optional(v.string()),
    groupId: v.optional(v.id('spaces')),
    // FIXED: allow edit flows to preserve/update existing event sharing fields
    participants: v.optional(v.array(v.string())),
    sharedWithUserIds: v.optional(v.array(v.id('users'))),
    allFamily: v.optional(v.boolean()),
    sharedWithFamilyMemberIds: v.optional(v.array(v.string())),
    tasksVisibleToParticipants: v.optional(v.boolean()),
    requiresRsvp: v.optional(v.boolean()),
    // FIXED: file attachments (max 2; backend diffs and deletes removed files from storage)
    attachments: v.optional(v.array(attachmentObject)),
    // Reminder offsets in minutes before event start
    reminders: v.optional(v.array(v.number())),
    importantItems: v.optional(v.array(importantItemObject)),
  },
  handler: async (ctx, { id, attachments, importantItems, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('אירוע לא נמצא');
    if (existing.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        existing.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('אין הרשאה לערוך את האירוע');
      }
      const isCreator = existing.createdBy === userId;
      const isOwnerOrAdmin =
        membership.role === 'owner' || membership.role === 'admin';
      if (!isCreator && !isOwnerOrAdmin) {
        throw new Error('אין הרשאה לערוך את האירוע');
      }
    } else if (existing.createdBy !== userId) {
      throw new Error('אין הרשאה לערוך את האירוע');
    }

    let stampedAttachments: typeof existing.attachments | undefined;
    if (attachments !== undefined) {
      if (attachments.length > 2) {
        throw new Error('לא ניתן לצרף יותר מ-2 קבצים לאירוע');
      }

      // Replace removed attachments with a cross-document reference check before
      // physically deleting — prevents destroying a file still referenced by a task.
      const newIds = new Set(attachments.map((a) => a.storageId));
      for (const old of existing.attachments ?? []) {
        if (!newIds.has(old.storageId)) {
          await safeDeleteStorageIfUnreferenced(ctx, old.storageId, {
            eventId: id,
          });
        }
      }

      // Reject any *newly introduced* storageId already referenced by another
      // document — retained references from this exact event are excluded.
      const existingIds = new Set(
        (existing.attachments ?? []).map((a) => a.storageId as string)
      );
      for (const att of attachments) {
        if (!existingIds.has(att.storageId as string)) {
          if (
            await isStorageReferencedByOtherDocument(ctx, att.storageId, {
              eventId: id,
            })
          ) {
            throw new Error('לא ניתן לצרף קובץ זה');
          }
        }
      }

      const now = Date.now();
      // Build a lookup of existing metadata so we can preserve uploadedBy/uploadedAt
      const existingByStorageId = new Map(
        (existing.attachments ?? []).map((a) => [a.storageId, a])
      );

      stampedAttachments = attachments.map((a) => {
        const prev = existingByStorageId.get(a.storageId);
        return {
          ...a,
          uploadedBy: prev?.uploadedBy ?? userId,
          uploadedAt: prev?.uploadedAt ?? now,
        };
      });
    }

    const sanitizedImportantItems = sanitizeImportantItems(importantItems);
    const resolvedSpaceId =
      existing.spaceId ??
      (existing.communityId ? await getUserSpaceId(ctx, userId) : undefined);
    const syncedImportantItems =
      importantItems !== undefined && existing.communityId
        ? await syncCommunityEventImportantItemTasks(ctx, {
            eventId: id,
            communityId: existing.communityId,
            spaceId: resolvedSpaceId,
            startTime: fields.startTime ?? existing.startTime,
            createdBy: existing.createdBy,
            importantItems: sanitizedImportantItems,
          })
        : sanitizedImportantItems;
    const patch = {
      ...fields,
      ...(stampedAttachments !== undefined
        ? { attachments: stampedAttachments }
        : {}),
      ...(importantItems !== undefined
        ? { importantItems: syncedImportantItems }
        : {}),
    };
    const hasActualChange = Object.entries(patch).some(([key, value]) =>
      didFieldChange(
        (existing as Record<string, unknown>)[key],
        value as unknown
      )
    );

    await ctx.db.patch(id, patch);

    if (existing.communityId && hasActualChange) {
      const communityId = existing.communityId;
      const activityTitle =
        typeof fields.title === 'string' && fields.title.trim()
          ? fields.title.trim()
          : existing.title;
      await insertCommunityActivity(ctx, {
        communityId,
        actorUserId: userId,
        type: 'event_updated',
        entityType: 'event',
        entityId: id,
        title: `עודכן האירוע: ${activityTitle}`,
      });

      const dateChanged =
        fields.startTime !== undefined &&
        didFieldChange(existing.startTime, fields.startTime) &&
        formatHebrewDate(existing.startTime) !==
          formatHebrewDate(fields.startTime);

      const timeOnlyChanged =
        fields.startTime !== undefined &&
        didFieldChange(existing.startTime, fields.startTime) &&
        !dateChanged;

      const endTimeChanged =
        fields.endTime !== undefined &&
        didFieldChange(existing.endTime, fields.endTime);

      const locationChanged =
        (fields.location !== undefined &&
          didFieldChange(existing.location, fields.location)) ||
        (fields.locationUrl !== undefined &&
          didFieldChange(existing.locationUrl, fields.locationUrl)) ||
        (fields.onlineUrl !== undefined &&
          didFieldChange(existing.onlineUrl, fields.onlineUrl));

      const meaningfulChange =
        dateChanged || timeOnlyChanged || endTimeChanged || locationChanged;

      if (meaningfulChange) {
        const changeParts: string[] = [];
        if (dateChanged) {
          changeParts.push(
            `תאריך האירוע השתנה ל-${formatHebrewDate(fields.startTime as number)}`
          );
        }
        if (timeOnlyChanged) {
          changeParts.push(
            `שעת האירוע השתנתה ל-${formatHebrewTime(fields.startTime as number)}`
          );
        }
        if (endTimeChanged) {
          changeParts.push(
            `שעת הסיום השתנתה ל-${formatHebrewTime(fields.endTime as number)}`
          );
        }
        if (locationChanged) {
          changeParts.push('מיקום האירוע עודכן');
        }

        const updatedBody =
          changeParts.length > 0
            ? changeParts.join(', ')
            : 'פרטי האירוע עודכנו';

        const allMembers = await ctx.db
          .query('communityMembers')
          .withIndex('by_community', (q) => q.eq('communityId', communityId))
          .collect();

        const recipientUserIds = allMembers
          .filter(
            (m) =>
              isActiveCommunityMember(m) &&
              m.userId !== userId &&
              m.notificationsEnabled !== false
          )
          .map((m) => m.userId);

        if (recipientUserIds.length > 0) {
          const updatedTitle = 'פרטי האירוע עודכנו';
          const updatedScreen = `/(authenticated)/event/${id}`;

          await createUserNotifications(ctx, {
            recipientUserIds,
            pushType: 'community_event_updated',
            title: updatedTitle,
            body: updatedBody,
            screen: updatedScreen,
          });

          await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
            recipientUserIds,
            pushType: 'community_event_updated',
            title: updatedTitle,
            body: updatedBody,
            data: { screen: updatedScreen },
            channelId: 'communities',
          });
        }
      }
    }

    if (importantItems !== undefined) {
      const existingItemIds = new Set(
        (existing.importantItems ?? []).map((item) => item.id)
      );
      const newItems = (syncedImportantItems ?? []).filter(
        (item) => !existingItemIds.has(item.id)
      );
      const communityId = existing.communityId;

      if (communityId && newItems.length > 0) {
        const allMembers = await ctx.db
          .query('communityMembers')
          .withIndex('by_community', (q) => q.eq('communityId', communityId))
          .collect();

        const recipientUserIds = allMembers
          .filter(
            (m) =>
              isActiveCommunityMember(m) &&
              m.userId !== userId &&
              m.notificationsEnabled !== false
          )
          .map((m) => m.userId);

        if (recipientUserIds.length > 0) {
          const importantItemTitle = 'נוסף פריט חשוב לאירוע';
          const eventTitleForBody =
            typeof fields.title === 'string' && fields.title.trim()
              ? fields.title.trim()
              : existing.title;
          const importantItemBody = `${eventTitleForBody}: ${
            newItems.length === 1
              ? newItems[0].title
              : `${newItems.length} פריטים חדשים`
          }`;
          const importantItemScreen = `/(authenticated)/event/${id}`;

          await createUserNotifications(ctx, {
            recipientUserIds,
            pushType: 'community_event_important_item_created',
            title: importantItemTitle,
            body: importantItemBody,
            screen: importantItemScreen,
          });

          await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
            recipientUserIds,
            pushType: 'community_event_important_item_created',
            title: importantItemTitle,
            body: importantItemBody,
            data: { screen: importantItemScreen },
            channelId: 'communities',
          });
        }
      }
    }
  },
});

// ─────────────────────────────────────────────────────────────
// ביטול אירוע (מאומת — רק יוצר האירוע, לא מוחק)
// FIXED: also patches all linkedEvents sourceStatus → 'cancelled'
// ─────────────────────────────────────────────────────────────
export const cancelEvent = mutation({
  args: {
    eventId: v.id('events'),
    cancelReason: v.optional(v.string()),
    cancelledBy: v.optional(v.id('users')),
  },
  handler: async (ctx, { eventId, cancelReason, cancelledBy }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      if (!isActiveCommunityMember(membership)) {
        throw new Error('אין הרשאה');
      }
      const isCreator = event.createdBy === userId;
      const isOwnerOrAdmin =
        membership.role === 'owner' || membership.role === 'admin';
      if (!isCreator && !isOwnerOrAdmin) throw new Error('אין הרשאה');
    } else if (event.createdBy !== userId) {
      throw new Error('אין הרשאה');
    }

    const cancelledAt = Date.now();

    await ctx.db.patch(eventId, {
      status: 'cancelled',
      cancelledAt,
      cancelledBy: cancelledBy ?? userId,
      cancelReason,
    });

    if (event.communityId) {
      const savedRows = await ctx.db.query('savedCommunityEvents').collect();
      const activeRowsForEvent = savedRows.filter(
        (row) => row.eventId === eventId && row.removedAt === undefined
      );
      for (const row of activeRowsForEvent) {
        await ctx.db.patch(row._id, { removedAt: cancelledAt });
      }
    }

    // Propagate cancellation to all linked events saved by recipients
    const linked = await ctx.db
      .query('linkedEvents')
      .withIndex('by_source', (q) => q.eq('sourceEventId', eventId))
      .collect();
    for (const row of linked) {
      if (row.sourceStatus !== 'cancelled') {
        await ctx.db.patch(row._id, { sourceStatus: 'cancelled' });
      }
    }

    if (event.communityId) {
      await insertCommunityActivity(ctx, {
        communityId: event.communityId,
        actorUserId: userId,
        type: 'event_cancelled',
        entityType: 'event',
        entityId: eventId,
        title: `האירוע בוטל: ${event.title}`,
      });
    }

    const communityId = event.communityId;

    if (communityId) {
      const community = await ctx.db.get(communityId);
      if (community) {
        const allMembers = await ctx.db
          .query('communityMembers')
          .withIndex('by_community', (q) => q.eq('communityId', communityId))
          .collect();

        const recipientUserIds = allMembers
          .filter(
            (m) =>
              isActiveCommunityMember(m) &&
              m.userId !== userId &&
              m.notificationsEnabled !== false
          )
          .map((m) => m.userId);

        if (recipientUserIds.length > 0) {
          const canceledTitle = 'האירוע בוטל';
          const canceledBody = `${event.title} ב${community.name} בוטל`;
          const canceledScreen = `/(authenticated)/event/${eventId}`;

          await createUserNotifications(ctx, {
            recipientUserIds,
            pushType: 'community_event_canceled',
            title: canceledTitle,
            body: canceledBody,
            screen: canceledScreen,
          });

          await ctx.scheduler.runAfter(0, internal.pushNotifications.sendPush, {
            recipientUserIds,
            pushType: 'community_event_canceled',
            title: canceledTitle,
            body: canceledBody,
            data: { screen: canceledScreen },
            channelId: 'communities',
          });
        }
      }
    }

    // TODO(server-push): notify assigned users that their tasks were cancelled because the event was cancelled.
  },
});

// ─────────────────────────────────────────────────────────────
// FIX C — הסרה מוקדמת של אירוע קהילה שבוטל מתצוגת הקהילה (Soft Community-
// display removal — NEVER a hard delete).
//
// Product contract (see the FIX C investigation report):
//   • Applies ONLY to Community Events (event.communityId set) that are
//     currently `status === 'cancelled'` with `cancelledAt` set, and only
//     while still inside the SAME 24-hour Community visibility window the
//     "אירועים שבוטלו" section already uses
//     (isCancelledEventWithinCommunityVisibilityWindow —
//     lib/eventsTabDateHelpers.ts) — never a separate/looser rule.
//   • Authorization is the SAME existing rule used everywhere else in this
//     file for Community Event management: event creator OR an active
//     community owner/admin. No new permission model.
//   • Sets `removedFromCommunityAt` and returns — it NEVER calls
//     ctx.db.delete on the event, never deletes eventRsvps/eventTasks/
//     savedCommunityEvents/linkedEvents/attachments, and performs no
//     relational cleanup whatsoever. The event, and everything referencing
//     it, is fully intact in the database afterward — only its Community
//     "אירועים שבוטלו" visibility changes (see
//     events.listCommunityEventsTabPaged's `removedFromCommunityAt` filter).
//   • Idempotent: calling this again for an already-removed event is a
//     deliberate no-op success (`{ removed: true }`), never an error — see
//     `resolveCommunityEventEarlyRemovalVerdict`'s 'already_removed' case.
//   • Personal Events are always rejected ('not_community_event') —
//     Personal Event delete/soft-delete behavior is completely untouched.
//
// All eligibility/boundary logic lives in the pure, unit-tested
// `resolveCommunityEventEarlyRemovalVerdict` (communityCalendarState.ts) —
// this handler does nothing but resolve `event` and `canManage` from the
// database and hand them to that function unchanged.
// ─────────────────────────────────────────────────────────────
const EARLY_REMOVAL_ERROR_MESSAGES: Record<
  Exclude<CommunityEventEarlyRemovalVerdict, 'ok' | 'already_removed'>,
  string
> = {
  not_found: 'אירוע לא נמצא',
  not_community_event: 'ניתן להסיר מהקהילה רק אירוע קהילתי',
  forbidden: 'אין הרשאה',
  not_cancelled: 'ניתן להסיר מהקהילה רק אירוע שבוטל',
  missing_cancelled_at: 'לא ניתן להסיר את האירוע — חסר תאריך ביטול',
  window_expired: 'חלון 24 השעות להסרה מוקדמת מהקהילה הסתיים',
};

export const removeCancelledCommunityEvent = mutation({
  args: { eventId: v.id('events') },
  returns: v.object({ removed: v.literal(true) }),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    const event = await ctx.db.get(eventId);

    let canManage = false;
    if (event?.communityId) {
      const membership = await getCommunityMembership(
        ctx,
        event.communityId,
        userId
      );
      const isActiveMember = isActiveCommunityMember(membership);
      const isCreator = event.createdBy === userId;
      const isOwnerOrAdmin =
        isActiveMember &&
        (membership?.role === 'owner' || membership?.role === 'admin');
      canManage = isActiveMember && (isCreator || isOwnerOrAdmin);
    }

    const verdict = resolveCommunityEventEarlyRemovalVerdict({
      event: event
        ? {
            communityId: event.communityId,
            status: event.status,
            cancelledAt: event.cancelledAt,
            removedFromCommunityAt: event.removedFromCommunityAt,
          }
        : null,
      canManage,
      now: Date.now(),
    });

    if (verdict === 'already_removed') {
      return { removed: true as const };
    }
    if (verdict !== 'ok') {
      throw new Error(EARLY_REMOVAL_ERROR_MESSAGES[verdict]);
    }

    await ctx.db.patch(eventId, { removedFromCommunityAt: Date.now() });
    return { removed: true as const };
  },
});

// ─────────────────────────────────────────────────────────────
// FIX C.2 — recent Community Event CANCELLATIONS for "מה חשוב עכשיו"
//
// Deliberately a SEPARATE, dedicated query, never a widening of
// `listCommunityMainOverview` — that query is intentionally bounded/
// indexed by `communityId + startTime` and scans UPCOMING events only
// (see its own doc comment above), which cannot answer "was something
// recently cancelled" — a cancelled event's relevant recency signal is
// `cancelledAt`, not its (possibly already-past) `startTime`.
//
// Bounding strategy: the new `by_community_cancelled_at` index
// (`communityId + cancelledAt`) is scanned with a lower bound of
// `cancelledAt > now - CANCELLED_COMMUNITY_EVENT_VISIBILITY_WINDOW_MS` —
// mathematically identical to `isCancelledEventWithinCommunityVisibilityWindow`'s
// strict `<` boundary (`now - cancelledAt < WINDOW` ⇔ `cancelledAt > now -
// WINDOW`), so the index itself already excludes every cancellation
// outside the 24h window before any JS filtering runs. `.order('desc')` +
// a small `.take()` cap (never `.collect()`) keeps this a single small,
// bounded read — same precedent as `communityActivities.listRecent`'s
// `by_community_createdAt` + `.order('desc').take(limit)`.
//
// The exact status/cancelledAt-present/removedFromCommunityAt-absent/
// window filtering + newest-first sort + limit is delegated unchanged to
// the pure, unit-tested `selectRecentCancelledCommunityEvents`
// (communityCalendarState.ts) — reusing the SAME
// `isCancelledEventWithinCommunityVisibilityWindow` boundary FIX C already
// introduced, never a second definition of the window. FIX C early
// removal (`removedFromCommunityAt`) therefore disappears a cancellation
// from this query in lockstep with `listCommunityEventsTabPaged`'s
// identical exclusion.
// ─────────────────────────────────────────────────────────────
const RECENT_CANCELLED_COMMUNITY_EVENTS_DEFAULT_LIMIT = 3;
// Small safety cap on the index scan itself — comfortably larger than any
// realistic limit, while never approaching a full-community collect().
const RECENT_CANCELLED_COMMUNITY_EVENTS_SCAN_CAP = 20;

export const listRecentCancelledCommunityEvents = query({
  args: {
    communityId: v.id('communities'),
    /** Client clock (Date.now()) — never Date.now() inside the handler. */
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, now, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await getCommunityMembership(ctx, communityId, userId);
    if (!isActiveCommunityMember(membership)) return [];

    const resolvedLimit =
      limit ?? RECENT_CANCELLED_COMMUNITY_EVENTS_DEFAULT_LIMIT;

    const candidates = await ctx.db
      .query('events')
      .withIndex('by_community_cancelled_at', (q) =>
        q
          .eq('communityId', communityId)
          .gt(
            'cancelledAt',
            now - CANCELLED_COMMUNITY_EVENT_VISIBILITY_WINDOW_MS
          )
      )
      .order('desc')
      .take(RECENT_CANCELLED_COMMUNITY_EVENTS_SCAN_CAP);

    return selectRecentCancelledCommunityEvents(
      candidates,
      communityId,
      now,
      resolvedLimit
    );
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקת אירועים שבוטלו לאחר 14 ימים
// FIX C: converted to internalMutation — this mutation performs an
// unauthenticated, destructive hard-delete scan with no caller today (no
// convex/crons.ts exists in this project — see the FIX C investigation
// report), so it must not remain reachable as a public client-callable
// mutation. Left UNSCHEDULED on purpose per this fix's scope — this only
// removes public/client access, it does not add a cron or change the
// 14-day cutoff logic.
// ─────────────────────────────────────────────────────────────
export const deleteCancelledEventsPastGracePeriod = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query('events')
      .filter((q) =>
        q.and(
          q.eq(q.field('status'), 'cancelled'),
          q.lt(q.field('cancelledAt'), cutoff)
        )
      )
      .collect();
    for (const ev of old) {
      await ctx.db.delete(ev._id);
    }
    return { deleted: old.length };
  },
});
// TODO cleanup job: call deleteCancelledEventsPastGracePeriod on a schedule.
// Do NOT call this mutation from the UI in this step.

// ─────────────────────────────────────────────────────────────
// מחיקת אירוע (מאומת — רק יוצר האירוע)
// FIXED: patches all linkedEvents sourceStatus → 'deleted' before deleting
//        so recipients see a tombstone with last-known snapshot data
// ─────────────────────────────────────────────────────────────
export const deleteEvent = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    // FIX C — hardening: a Community Event can never be hard-deleted through
    // this legacy/public path, for ANY caller (including the creator/owner/
    // admin who could previously do so). Early Community removal of a
    // cancelled event must go exclusively through the new soft-removal
    // mutation `removeCancelledCommunityEvent` (sets `removedFromCommunityAt`
    // — never deletes the row). Personal Event hard-delete below is
    // completely unchanged.
    if (event.communityId) {
      throw new Error(
        'לא ניתן למחוק אירוע קהילתי בדרך זו. ניתן לבטל את האירוע ולהסיר אותו מהקהילה תוך 24 שעות.'
      );
    }
    if (event.createdBy !== userId) {
      throw new Error('אין הרשאה');
    }

    // Patch linked events before deleting — recipients will fall back to snapshot
    const linked = await ctx.db
      .query('linkedEvents')
      .withIndex('by_source', (q) => q.eq('sourceEventId', eventId))
      .collect();
    for (const row of linked) {
      await ctx.db.patch(row._id, { sourceStatus: 'deleted' });
    }

    await ctx.db.delete(eventId);
  },
});

// ─────────────────────────────────────────────────────────────
// מחיקה רכה של אירוע אישי
// ─────────────────────────────────────────────────────────────
export const softDeletePersonalEvent = mutation({
  args: { eventId: v.id('events') },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.communityId)
      throw new Error('לא ניתן למחוק אירוע קהילתי בדרך זו');
    if ((event.createdBy as string) !== (userId as string))
      throw new Error('אין הרשאה למחוק אירוע זה');

    // Idempotent — already soft-deleted
    if (event.deletedAt !== undefined) return { success: true as const };

    // Safety: do not allow soft-delete while event is active AND has invitees.
    // Creator should cancel first.
    const hasInvitees =
      (event.sharedWithUserIds?.length ?? 0) > 0 ||
      (event.sharedWithFamilyMemberIds?.length ?? 0) > 0;
    if (hasInvitees && event.status !== 'cancelled') {
      throw new Error('לא ניתן למחוק אירוע עם מוזמנים בלי לבטל אותו קודם');
    }

    const now = Date.now();
    await ctx.db.patch(eventId, {
      deletedAt: now,
      deleteExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
      deletedBy: userId,
    });

    return { success: true as const };
  },
});

// ─────────────────────────────────────────────────────────────
// שחזור אירוע אישי שנמחק רכה
// ─────────────────────────────────────────────────────────────
export const restorePersonalEvent = mutation({
  args: { eventId: v.id('events') },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('אירוע לא נמצא');
    if (event.communityId)
      throw new Error('לא ניתן לשחזר אירוע קהילתי בדרך זו');
    if (event.deletedAt === undefined) throw new Error('האירוע לא נמחק');
    if ((event.deletedBy as string | undefined) !== (userId as string))
      throw new Error('אין הרשאה לשחזר אירוע זה');

    await ctx.db.patch(eventId, {
      deletedAt: undefined,
      deleteExpiresAt: undefined,
      deletedBy: undefined,
    });

    return { success: true as const };
  },
});

// ─────────────────────────────────────────────────────────────
// העתקת אירועי Google — יצירת אירועים אישיים ורישום קבוע להגנה מכפילויות
//
// Product contract:
//   • Never calls Google APIs or accepts tokens/payloads.
//   • source = 'google_copy' is always stamped server-side.
//   • One eventCopyRegistry record is created per successfully copied event
//     and persists even after the linked InYomi event is later deleted.
//   • An event whose externalId already has a registry record for this user
//     is always skipped — regardless of whether the linked event still exists.
//   • Batch limit: 100 candidates per call (each requires 1 read + 2 writes).
// ─────────────────────────────────────────────────────────────
export const copyGoogleEvents = mutation({
  args: {
    events: v.array(
      v.object({
        title: v.string(),
        startTime: v.number(),
        endTime: v.number(),
        allDay: v.optional(v.boolean()),
        externalId: v.string(),
        externalCalendarId: v.string(),
        externalEventId: v.string(),
        externalICalUID: v.optional(v.string()),
        externalOriginalStartKey: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({
    created: v.number(),
    skippedAlreadyCopied: v.number(),
    invalid: v.number(),
    createdEventIds: v.array(v.id('events')),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר למערכת');

    // Reject oversized batches up-front so Convex read/write limits are never
    // approached: 100 candidates × (1 registry read + 2 inserts) = 300 ops max.
    const MAX_BATCH = 100;
    if (args.events.length > MAX_BATCH) {
      throw new Error(
        `מספר האירועים בבקשה חורג מהמקסימום המותר (${MAX_BATCH})`
      );
    }

    // Resolve space server-side — never trusted from the client.
    const spaceId = await getUserSpaceId(ctx, userId);
    const now = Date.now();

    let created = 0;
    let skippedAlreadyCopied = 0;
    let invalid = 0;
    const createdEventIds: Id<'events'>[] = [];

    // Track externalIds already processed in this batch to suppress duplicates
    // submitted in the same request without hitting the DB a second time.
    const seenExternalIds = new Set<string>();

    for (const candidate of args.events) {
      // ── Within-batch duplicate detection ──────────────────────────────────
      if (seenExternalIds.has(candidate.externalId)) {
        skippedAlreadyCopied++;
        continue;
      }
      seenExternalIds.add(candidate.externalId);

      // ── Validate calendar / event IDs and canonical externalId ─────────────
      // Both component fields must be non-empty after trimming.
      // The canonical externalId is reconstructed server-side and must match
      // the supplied value exactly — a mismatch means the candidate is
      // internally inconsistent and must be rejected.
      const trimmedCalendarId = candidate.externalCalendarId.trim();
      const trimmedEventId = candidate.externalEventId.trim();
      if (trimmedCalendarId.length === 0 || trimmedEventId.length === 0) {
        invalid++;
        continue;
      }
      const expectedExternalId = `google:${trimmedCalendarId}:${trimmedEventId}`;
      if (candidate.externalId !== expectedExternalId) {
        invalid++;
        continue;
      }

      // ── Validate title ─────────────────────────────────────────────────────
      const trimmedTitle = candidate.title.trim();
      if (trimmedTitle.length === 0) {
        invalid++;
        continue;
      }

      // ── Validate timestamps ────────────────────────────────────────────────
      // Must be finite numbers; end must not precede start.
      if (
        !Number.isFinite(candidate.startTime) ||
        !Number.isFinite(candidate.endTime) ||
        candidate.endTime < candidate.startTime
      ) {
        invalid++;
        continue;
      }

      // ── Registry dedup — authoritative because it outlives the InYomi event ─
      const existingRegistry = await ctx.db
        .query('eventCopyRegistry')
        .withIndex('by_owner_external_id', (q) =>
          q.eq('createdBy', userId).eq('externalId', candidate.externalId)
        )
        .unique();

      if (existingRegistry !== null) {
        skippedAlreadyCopied++;
        continue;
      }

      // ── Create the personal InYomi event ──────────────────────────────────
      // Mirrors the existing personal-event creation convention in `create`:
      //   • isAiGenerated: false
      //   • createdBy / createdAt / spaceId stamped server-side
      //   • tasksVisibleToParticipants: false (personal default)
      //   • No community, sharing, attachments, or reminder fields
      const eventId = await ctx.db.insert('events', {
        title: trimmedTitle,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        allDay: candidate.allDay,
        isAiGenerated: false,
        createdBy: userId,
        createdAt: now,
        spaceId,
        tasksVisibleToParticipants: false,
        source: 'google_copy',
        externalId: candidate.externalId,
        externalCalendarId: candidate.externalCalendarId,
        externalEventId: candidate.externalEventId,
        externalICalUID: candidate.externalICalUID,
        externalOriginalStartKey: candidate.externalOriginalStartKey,
      });

      // ── Create the permanent registry record ──────────────────────────────
      // This record must never be deleted; it is the sole dedup authority
      // and enforces the no-re-copy policy even after the event is hard-deleted.
      await ctx.db.insert('eventCopyRegistry', {
        createdBy: userId,
        spaceId,
        source: 'google_copy',
        externalId: candidate.externalId,
        externalCalendarId: candidate.externalCalendarId,
        externalEventId: candidate.externalEventId,
        externalICalUID: candidate.externalICalUID,
        externalOriginalStartKey: candidate.externalOriginalStartKey,
        firstCopiedAt: now,
        lastLinkedEventId: eventId,
      });

      created++;
      createdEventIds.push(eventId);
    }

    return { created, skippedAlreadyCopied, invalid, createdEventIds };
  },
});

// ─────────────────────────────────────────────────────────────
// רשימת אירועים אישיים שנמחקו לאחרונה (עבור מסך "נמחקו לאחרונה")
// ─────────────────────────────────────────────────────────────
export const listRecentlyDeletedPersonalEvents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const events = await ctx.db
      .query('events')
      .withIndex('by_deleted_by', (q) => q.eq('deletedBy', userId))
      .filter((q) => q.neq(q.field('deletedAt'), undefined))
      .order('desc')
      .collect();

    return events
      .filter((ev) => !ev.communityId)
      .map((ev) => ({
        id: ev._id,
        title: ev.title,
        deletedAt: ev.deletedAt,
        deleteExpiresAt: ev.deleteExpiresAt,
        startTime: ev.startTime,
        endTime: ev.endTime,
        allDay: ev.allDay,
        status: ev.status,
      }));
  },
});

// ─────────────────────────────────────────────────────────────
// אירועי קהילות עבור תאריך נבחר — לדף הבית
// מחזיר את כל האירועים בקהילות של המשתמש הנוכחי בטווח הזמן
// ─────────────────────────────────────────────────────────────
export const listCommunityEventsForDate = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query('communityMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const activeMembers = memberships.filter((m) => isActiveCommunityMember(m));

    const userRsvps = await ctx.db
      .query('eventRsvps')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const rsvpByEventId = new Map(
      userRsvps.map((r) => [r.eventId as string, r.status])
    );

    const savedIds = await loadActiveSavedEventIds(ctx, userId);
    const optOutIds = await loadOptOutEventIds(ctx, userId);

    const results = await Promise.all(
      activeMembers.map(async ({ communityId, autoAddEventsToCalendar }) => {
        const community = await ctx.db.get(communityId);
        if (!community || community.archived) return [];
        const autoAddEnabled = autoAddEventsToCalendar === true;

        const events = await ctx.db
          .query('events')
          .withIndex('by_community_date', (q) =>
            q
              .eq('communityId', communityId)
              .gte('startTime', from)
              .lte('startTime', to)
          )
          .collect();

        return events
          .filter((ev) => ev.status !== 'cancelled')
          .map((ev) => {
            const idStr = ev._id as string;
            const isSavedToMyCalendar = computeIsSavedToMyCalendar({
              isCreator: ev.createdBy === userId,
              autoAddEnabled,
              requiresRsvp: ev.requiresRsvp,
              rsvpStatus: rsvpByEventId.get(ev._id),
              hasActiveSave: savedIds.has(idStr),
              hasOptOut: optOutIds.has(idStr),
            });
            return { ev, isSavedToMyCalendar };
          })
          .filter(({ isSavedToMyCalendar }) => isSavedToMyCalendar)
          .map(({ ev, isSavedToMyCalendar }) => ({
            _id: ev._id,
            title: ev.title,
            startTime: ev.startTime,
            endTime: ev.endTime,
            allDay: ev.allDay ?? false,
            communityId,
            communityName: community.name,
            location: ev.location,
            locationUrl: ev.locationUrl,
            importantItems: ev.importantItems ?? [],
            isSavedToMyCalendar,
          }));
      })
    );

    return results.flat();
  },
});
