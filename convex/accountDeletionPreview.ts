// ============================================================================
// accountDeletionPreview.ts — READ-ONLY, DEV/QA-ONLY preview of the
// production account-deletion engine.
// ============================================================================
//
// `previewAccountDeletion` exists ONLY to let us inspect exactly what
// `runAccountDeletion` (convex/accountDeletion.ts) WOULD do to a given QA
// account before wiring the client Delete Account UI to the real mutation.
//
// It is declared as an `internalQuery` — not merely "by convention read
// only" but structurally incapable of writing: a Convex query's `ctx.db`
// is a `DatabaseReader`, so `ctx.db.patch/insert/delete` and
// `ctx.scheduler.cancel`/auth mutations do not exist on this ctx at all.
// This file must NEVER export a public `query`/`mutation`, and must NEVER
// import/call anything that performs a write.
//
// PLANNER REUSE (no drift): this function calls the EXACT SAME
// `buildAccountDeletionPlan` that `runAccountDeletion` calls — the only
// implementation of the ownership/ownerScope/assignment/transaction-size
// rules — and then shapes it into a read-only summary via
// `buildAccountDeletionPreview`. There is no second implementation of any
// deletion rule anywhere in this file.
//
// SAFETY MODEL (mirrors convex/devTools.ts `resetQaUser` exactly, since
// this reads the same kind of real user data for QA/dev purposes):
//   - QA_RESET_ENABLED must be 'true' and the requested phone must appear
//     in QA_RESET_ALLOWED_PHONES — both hard guards THROW, no bypass.
//   - The target user is resolved by phone (never a client-supplied
//     Convex Id) via the `users.by_phone` index; ambiguous (0 or >1
//     matches) resolution THROWS rather than guessing which user to show.
// ============================================================================

import { v } from 'convex/values';
import {
  checkUsersLookup,
  isPhoneAllowlisted,
  normalizeQaPhone,
  parseQaResetAllowlist,
} from '../lib/qaReset';
import type { Id } from './_generated/dataModel';
import { internalQuery } from './_generated/server';
import {
  buildAccountDeletionPlan,
  buildAccountDeletionPreview,
} from './accountDeletion';

const accountDeletionPreviewSpaceValidator = v.object({
  spaceId: v.string(),
  spaceName: v.string(),
  action: v.union(
    v.literal('transfer'),
    v.literal('hardDelete'),
    v.literal('blocked')
  ),
  deletable: v.boolean(),
  otherJoinedUserCount: v.number(),
});

const accountDeletionPreviewCommunityValidator = v.object({
  communityId: v.string(),
  communityName: v.string(),
  archived: v.boolean(),
  action: v.union(
    v.literal('transfer'),
    v.literal('hardDelete'),
    v.literal('blocked')
  ),
  eligibleSuccessorCount: v.number(),
  selectedSuccessorRole: v.union(
    v.literal('admin'),
    v.literal('member'),
    v.null()
  ),
  selectedSuccessorJoinedAt: v.union(v.number(), v.null()),
  selectedSuccessorName: v.union(v.string(), v.null()),
  reason: v.union(v.string(), v.null()),
});

const accountDeletionPreviewReturns = v.object({
  normalizedPhone: v.string(),
  allowlisted: v.boolean(),
  environmentEnabled: v.boolean(),
  userId: v.union(v.id('users'), v.null()),
  blocker: v.union(v.string(), v.null()),
  preview: v.union(
    v.object({
      safeToExecute: v.boolean(),
      blockers: v.array(v.string()),
      plannedWriteCount: v.number(),
      writeSafetyLimit: v.number(),
      spaces: v.object({
        ownedCount: v.number(),
        transferCount: v.number(),
        deletableCount: v.number(),
        blockedCount: v.number(),
        details: v.array(accountDeletionPreviewSpaceValidator),
      }),
      communities: v.object({
        ownedCount: v.number(),
        transferCount: v.number(),
        hardDeletableCount: v.number(),
        blockedCount: v.number(),
        nonOwnedMembershipRemovalCount: v.number(),
        details: v.array(accountDeletionPreviewCommunityValidator),
      }),
      content: v.object({
        personalEventsToDelete: v.number(),
        personalTasksToDelete: v.number(),
        familyEventsPreserved: v.number(),
        familyTasksPreserved: v.number(),
        communityEventsPreserved: v.number(),
        communityTasksPreserved: v.number(),
        legacyOwnerScopeEvents: v.number(),
        legacyOwnerScopeTasks: v.number(),
        ambiguousRecords: v.number(),
      }),
      assignments: v.object({
        tasksAssignedToCleared: v.number(),
        tasksAssignedToUserIdsCleared: v.number(),
        eventTasksAssignedToUserIdCleared: v.number(),
        eventTasksAssignedByUserIdCleared: v.number(),
        survivingMemberAssignmentsPreserved: v.number(),
      }),
      family: v.object({
        externalEntitiesToDetach: v.number(),
        externalAccessRowsToRemove: v.number(),
        affectedSpaceCount: v.number(),
        samePhoneReMatchEligibleAfterDeletion: v.boolean(),
      }),
      userScopedCleanup: v.record(v.string(), v.number()),
      auth: v.object({
        refreshTokens: v.number(),
        sessions: v.number(),
        accounts: v.number(),
        verificationCodes: v.number(),
        verifiers: v.number(),
        rateLimitRows: v.number(),
      }),
      residualReferenceCleanup: v.object({
        eventSharedUserRefsRemoved: v.number(),
        eventSharedFamilyMemberRefsRemapped: v.number(),
        taskMemberRefsRemapped: v.number(),
        communityMemberProfileRefsRemapped: v.number(),
        softDeletedTasksResolved: v.number(),
        unsafeMemberReferenceRemaps: v.number(),
      }),
    }),
    v.null()
  ),
});

/**
 * DEV/QA-ONLY, read-only preview of what `deleteMyAccount` /
 * `runAccountDeletion` WOULD do for the given (allowlisted) QA phone
 * number. Performs ZERO writes — see the file header for why this is
 * structurally guaranteed, not just a convention.
 *
 * Invoke from the Convex dashboard's "Run function" panel using this
 * function's full internal name (`accountDeletionPreview:previewAccountDeletion`),
 * or from another backend function/script — never reachable from the
 * client.
 */
export const previewAccountDeletion = internalQuery({
  args: {
    phone: v.string(),
  },
  returns: accountDeletionPreviewReturns,
  handler: async (ctx, args) => {
    // ── 1. Hard guards — throw, never a soft blocker ───────────────────────
    const environmentEnabled = process.env.QA_RESET_ENABLED === 'true';
    if (!environmentEnabled) {
      throw new Error(
        '[previewAccountDeletion] QA_RESET_ENABLED is not set to "true" in this Convex deployment. Refusing to run.'
      );
    }

    const normalizedPhone = normalizeQaPhone(args.phone);
    if (!normalizedPhone) {
      throw new Error(
        '[previewAccountDeletion] Could not normalize the provided phone number to E.164.'
      );
    }

    const allowlist = parseQaResetAllowlist(
      process.env.QA_RESET_ALLOWED_PHONES
    );
    const allowlisted = isPhoneAllowlisted(normalizedPhone, allowlist);
    if (!allowlisted) {
      throw new Error(
        `[previewAccountDeletion] Phone ${normalizedPhone} is not present in QA_RESET_ALLOWED_PHONES. Refusing to run.`
      );
    }

    // ── 2. Resolve the exact target user (fail closed on ambiguity) ────────
    const matchingUsers = await ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', normalizedPhone))
      .collect();
    const userLookup = checkUsersLookup(matchingUsers.map((u) => u._id));
    if (!userLookup.qaUserId) {
      return {
        normalizedPhone,
        allowlisted,
        environmentEnabled,
        userId: null,
        blocker: userLookup.blocker,
        preview: null,
      };
    }
    const userId = userLookup.qaUserId as Id<'users'>;

    // ── 3. Build the SAME plan runAccountDeletion would build, then shape
    //      it into the read-only preview. Zero writes anywhere below. ──────
    const plan = await buildAccountDeletionPlan(ctx, userId);
    const preview = buildAccountDeletionPreview(plan);

    return {
      normalizedPhone,
      allowlisted,
      environmentEnabled,
      userId,
      blocker: null,
      preview,
    };
  },
});
