// ============================================================================
// creatorOrphanAuthority.ts — narrow fallback authority for family
// event/task operations whose creator account no longer exists
// ============================================================================
//
// PROBLEM (see docs/audits/family-space-subscription-deletion-lifecycle-audit.md):
// several family event/task authorization checks are gated on
// `createdBy === callerId`. Once account deletion can actually delete a
// user (see convex/accountDeletion.ts), a family event/task whose creator
// has been deleted would become permanently unmanageable — no one could
// ever edit, cancel, delete, or manage its subtasks again, even though the
// content itself is correctly PRESERVED (see AGENTS.md §4 / the account
// deletion spec — shared family/community content survives deletion and
// `createdBy` is kept as a historical reference, never reassigned).
//
// FIX: a narrow, explicit fallback. When (and ONLY when) the creator no
// longer exists, the family space's admin authority (the same authority
// model already used everywhere else in this codebase — see
// convex/members.ts `requireSpaceAdmin`: a `kind:'access'` row with
// `role:'admin'` in that exact space) may act in the creator's place for
// that orphaned content. Ordinary family members (`role:'member'`) never
// gain any authority through this fallback.
//
// INVARIANTS (do not weaken):
//   1. If the creator still exists, this ALWAYS returns false — permissions
//      for a live creator are completely unchanged. This fallback can only
//      ever ADD authority for a deleted creator's orphaned content, never
//      take anything away or broaden anything for a live creator.
//   2. Community content is never affected — community owner/admin
//      authority is already handled by existing, separate logic
//      (see convex/communityMemberUtils.ts) and must not be touched here.
//   3. The content must belong to a real family/personal space (`spaceId`
//      set). Space-less content never gets fallback authority.
//   4. Only the exact current space-authority model may grant fallback
//      authority — this file does not invent a new role model.
//
// This module is pure (no ctx/db access) so it is fully unit-testable
// without a live Convex backend — this repo has no Convex mutation test
// harness (see tests/convex/qaResetUser.test.ts's documented precedent).
// The DB-backed wrapper that resolves `creatorExists` /
// `callerIsSpaceAdmin` from ctx.db lives in convex/members.ts
// (`hasCreatorOrphanAuthority`) and delegates the actual decision to
// `hasCreatorOrphanFallbackAuthority` below.
// ============================================================================

export interface CreatorOrphanAuthorityInput {
  /** True when the record's `createdBy` user still exists (ctx.db.get !== null). */
  creatorExists: boolean;
  /**
   * True when the record is community-owned (its `communityId` is set).
   * Community authorization is handled entirely by existing owner/admin
   * logic and must never be affected by this fallback.
   */
  isCommunityContent: boolean;
  /**
   * True when the record belongs to a real family/personal space
   * (`spaceId` set). The fallback never applies to space-less content.
   */
  hasSpace: boolean;
  /**
   * True when the caller holds that exact space's admin authority — a
   * `kind:'access'` row with `role:'admin'` in the SAME `spaceId` as the
   * record (the identical model `convex/members.ts` `requireSpaceAdmin`
   * already uses everywhere else).
   */
  callerIsSpaceAdmin: boolean;
}

/**
 * Returns true only when ALL of the following hold:
 *   - the record's creator account no longer exists
 *   - the record is NOT community content
 *   - the record belongs to a real space
 *   - the caller is that space's admin (the family's owner-equivalent
 *     authority)
 *
 * When the creator still exists, this ALWAYS returns false — live
 * creators' permissions are completely unchanged (do not broaden
 * permissions for live creators). Ordinary family members (`role:
 * 'member'`) never gain authority through this fallback — only the
 * space admin does, exactly mirroring the existing `requireSpaceAdmin`
 * authority model used elsewhere in this codebase.
 */
export function hasCreatorOrphanFallbackAuthority(
  input: CreatorOrphanAuthorityInput
): boolean {
  if (input.creatorExists) return false;
  if (input.isCommunityContent) return false;
  if (!input.hasSpace) return false;
  return input.callerIsSpaceAdmin;
}
