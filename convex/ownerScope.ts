// ============================================================================
// ownerScope.ts — Family Membership Lifecycle Phase 0
// ============================================================================
//
// Canonical, pure classification logic for the `ownerScope` field on
// events / tasks / captures. See convex/schema.ts for the field's doc
// comment.
//
// CRITICAL INVARIANT (do not violate when calling these from mutations):
// ownerScope answers "who OWNS this record", not "how is it currently
// shared". It is stamped ONCE, at creation/import time, using the
// `stampXOwnerScope` functions below, and must NEVER be recomputed by an
// update/edit mutation just because sharing/assignment fields changed
// (e.g. removing all participants from a family event does not make it
// personal; unassigning a family task does not make it personal).
//
// These functions are pure (no ctx/db access) so they can be unit tested
// directly — see tests/convex/ownerScopeStamping.test.ts and
// tests/convex/ownerScopeBackfill.test.ts.

export type OwnerScope = 'personal' | 'family' | 'community';

// ── Creation-time stamping (Phases 0/live paths) ────────────────────────────

/**
 * Determines the ownerScope for a NEW event at creation/import time.
 * Called exactly once, from convex/events.ts `create` and the Google/
 * device copy-import path — never from an update mutation.
 */
export function stampEventOwnerScope(input: {
  communityId?: unknown;
  source?: 'manual' | 'google_copy' | 'device_copy';
  allFamily?: boolean;
  sharedWithFamilyMemberIds?: unknown[];
  sharedWithUserIds?: string[];
  createdBy: string;
}): OwnerScope {
  if (input.communityId) return 'community';

  // Imported personal calendar copies are always personal to the importing
  // user, regardless of any (not-yet-supported) sharing fields at import
  // time — the import path never sets family sharing fields today.
  if (input.source === 'google_copy' || input.source === 'device_copy') {
    return 'personal';
  }

  const hasFamilySharing =
    input.allFamily === true ||
    (input.sharedWithFamilyMemberIds?.length ?? 0) > 0 ||
    (input.sharedWithUserIds ?? []).some((id) => id !== input.createdBy);

  return hasFamilySharing ? 'family' : 'personal';
}

/**
 * Determines the ownerScope for a NEW task at creation time. Called
 * exactly once, from convex/tasks.ts `create` — never from an update
 * mutation.
 */
export function stampTaskOwnerScope(input: {
  communityId?: unknown;
  sourceType?: string;
  createdBy: string;
  assignedTo?: string;
  assignedToUserIds?: string[];
  assignedToMemberIds?: unknown[];
}): OwnerScope {
  if (input.communityId) return 'community';
  if (input.sourceType?.startsWith('community_')) return 'community';

  const hasOtherAssignee =
    (input.assignedTo !== undefined && input.assignedTo !== input.createdBy) ||
    (input.assignedToUserIds ?? []).some((id) => id !== input.createdBy) ||
    (input.assignedToMemberIds?.length ?? 0) > 0;

  return hasOtherAssignee ? 'family' : 'personal';
}

/**
 * Captures have no production creation mutation yet (see schema.ts doc
 * comment). When one ships it should call this — always 'personal' today,
 * since a capture is always user-owned raw input with no family-sharing
 * concept in the current model.
 */
export function stampCaptureOwnerScope(): OwnerScope {
  return 'personal';
}

// ── Deterministic pre-launch backfill classification ────────────────────────
//
// Used by convex/backfills.ts to classify EXISTING rows that predate the
// ownerScope field. Returns a definite OwnerScope only when the signal is
// unambiguous; returns 'ambiguous' otherwise so the backfill mutation
// leaves the row untouched and the report query can surface it for manual
// product-owner review. NEVER guesses.

export type BackfillClassification = OwnerScope | 'ambiguous';

export function classifyEventForBackfill(input: {
  communityId?: unknown;
  source?: 'manual' | 'google_copy' | 'device_copy';
  allFamily?: boolean;
  sharedWithFamilyMemberIds?: unknown[];
  sharedWithUserIds?: string[];
  createdBy: string;
}): BackfillClassification {
  if (input.communityId) return 'community';
  if (input.source === 'google_copy' || input.source === 'device_copy') {
    return 'personal';
  }
  const hasFamilySharing =
    input.allFamily === true ||
    (input.sharedWithFamilyMemberIds?.length ?? 0) > 0 ||
    (input.sharedWithUserIds ?? []).some((id) => id !== input.createdBy);
  if (hasFamilySharing) return 'family';

  // No community, not an imported copy, and no family-sharing signal at
  // all. This is genuinely ambiguous: it could be a personal event created
  // in a family space, or a family event nobody happened to explicitly
  // share yet. Do not guess.
  return 'ambiguous';
}

export function classifyTaskForBackfill(input: {
  communityId?: unknown;
  sourceType?: string;
  createdBy: string;
  assignedTo?: string;
  assignedToUserIds?: string[];
  assignedToMemberIds?: unknown[];
}): BackfillClassification {
  if (input.communityId) return 'community';
  if (input.sourceType?.startsWith('community_')) return 'community';

  const hasOtherAssignee =
    (input.assignedTo !== undefined && input.assignedTo !== input.createdBy) ||
    (input.assignedToUserIds ?? []).some((id) => id !== input.createdBy) ||
    (input.assignedToMemberIds?.length ?? 0) > 0;
  if (hasOtherAssignee) return 'family';

  // Deterministic legacy shape: assignedTo is explicitly set to the task's
  // own creator (not undefined — undefined never equals a defined
  // createdBy string), every entry of assignedToUserIds (if any) also
  // points only at the creator, and there are zero member assignees. This
  // is exactly what the live creation-time stamper (stampTaskOwnerScope)
  // computes as 'personal' for this shape today, so it is safe to backfill
  // deterministically. An UNASSIGNED legacy task (assignedTo undefined,
  // no assignedToUserIds/assignedToMemberIds) does NOT match this rule and
  // falls through to 'ambiguous' below — current task-visibility rules can
  // still expose an unassigned task to other space members, so the absence
  // of an assignee must never be guessed as personal.
  const onlyAssigneeIsCreator =
    input.assignedTo === input.createdBy &&
    (input.assignedToUserIds ?? []).every((id) => id === input.createdBy) &&
    (input.assignedToMemberIds?.length ?? 0) === 0;
  if (onlyAssigneeIsCreator) return 'personal';

  // No community, no assignment signal pointing away from the creator, and
  // not explicitly self-assigned either (assignedTo undefined). Ambiguous:
  // could be a personal task, or a family task nobody has assigned yet.
  // Do not guess.
  return 'ambiguous';
}

/** Captures are always deterministically personal — see stampCaptureOwnerScope. */
export function classifyCaptureForBackfill(): 'personal' {
  return 'personal';
}
