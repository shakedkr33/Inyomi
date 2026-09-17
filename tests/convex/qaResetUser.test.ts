/**
 * Tests for lib/qaReset.ts + source-regression checks on convex/devTools.ts
 * (resetQaUser) — DEV/QA TOOL ONLY.
 *
 * This repo has no Convex mutation test harness (see
 * tests/convex/getPendingPhoneMatches.test.ts's documented precedent).
 * Given that constraint:
 *
 *   - The safety-critical planning/decision logic (lib/qaReset.ts) is pure
 *     and fully covered here via direct behavioral tests.
 *   - Invariants that require inspecting the actual shipped mutation body
 *     (internalMutation vs mutation, guard ordering, deletion-order
 *     comments, no public export) are verified via source inspection of the
 *     real convex/devTools.ts file — the same pattern used in
 *     tests/convex/getPendingPhoneMatches.test.ts.
 *
 * Run with: bun test tests/convex/qaResetUser.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  checkAuthAccountOwnership,
  checkUsersLookup,
  computeSafeToExecute,
  evaluateOwnedSpacesSafety,
  externalEntityResetPlanIsNoop,
  findRowsOutsideOwnedSpaces,
  isPhoneAllowlisted,
  normalizeQaPhone,
  parseQaResetAllowlist,
  planExternalEntityReset,
  planFamilyContactsReset,
  resolveExecutionMode,
} from '../../lib/qaReset';

const QA_PHONE = '+972501234567';
const QA_USER_ID = 'user_qa';
const OTHER_USER_ID = 'user_other';

// ── phone normalization ─────────────────────────────────────────────────────
describe('normalizeQaPhone', () => {
  it('accepts +972 E.164 as-is', () => {
    expect(normalizeQaPhone('+972501234567')).toBe('+972501234567');
  });
  it('normalizes 972-prefixed (no plus)', () => {
    expect(normalizeQaPhone('972501234567')).toBe('+972501234567');
  });
  it('normalizes local 0-prefixed', () => {
    expect(normalizeQaPhone('0501234567')).toBe('+972501234567');
  });
  it('normalizes bare subscriber number (leading 5, no 0)', () => {
    expect(normalizeQaPhone('501234567')).toBe('+972501234567');
  });
  it('strips spaces/dashes/parens before normalizing', () => {
    expect(normalizeQaPhone('050-123 (4567)')).toBe('+972501234567');
  });
  it('returns null for unrecognized formats', () => {
    expect(normalizeQaPhone('not-a-phone')).toBeNull();
    expect(normalizeQaPhone('123')).toBeNull();
  });
});

// ── allowlist parsing ────────────────────────────────────────────────────────
describe('parseQaResetAllowlist', () => {
  it('parses a comma-separated list into normalized E.164 phones', () => {
    expect(
      parseQaResetAllowlist('+972501234567,0521234567, 972529999999')
    ).toEqual(['+972501234567', '+972521234567', '+972529999999']);
  });
  it('drops empty entries from trailing/leading/double commas', () => {
    expect(parseQaResetAllowlist('+972501234567,,  ,')).toEqual([
      '+972501234567',
    ]);
  });
  it('drops unparseable entries silently rather than throwing', () => {
    expect(parseQaResetAllowlist('+972501234567,garbage')).toEqual([
      '+972501234567',
    ]);
  });
  it('returns [] for undefined/empty env value', () => {
    expect(parseQaResetAllowlist(undefined)).toEqual([]);
    expect(parseQaResetAllowlist('')).toEqual([]);
  });
});

describe('isPhoneAllowlisted', () => {
  it('true for an exact normalized match', () => {
    expect(isPhoneAllowlisted('+972501234567', ['+972501234567'])).toBe(true);
  });
  it('false when phone is not present', () => {
    expect(isPhoneAllowlisted('+972501234567', ['+972529999999'])).toBe(false);
  });
  it('false for an empty allowlist', () => {
    expect(isPhoneAllowlisted('+972501234567', [])).toBe(false);
  });
});

// ── dry-run / execute defaults ───────────────────────────────────────────────
describe('resolveExecutionMode', () => {
  it('defaults to dry-run when nothing is passed', () => {
    expect(resolveExecutionMode({})).toEqual({
      isDryRun: true,
      canExecuteLive: false,
    });
  });
  it('dryRun stays true unless explicitly false (dryRun: true is still dry-run)', () => {
    expect(resolveExecutionMode({ dryRun: true, execute: true })).toEqual({
      isDryRun: true,
      canExecuteLive: false,
    });
  });
  it('execute alone (without dryRun: false) never allows live execution', () => {
    expect(resolveExecutionMode({ execute: true })).toEqual({
      isDryRun: true,
      canExecuteLive: false,
    });
  });
  it('dryRun: false alone (without execute) never allows live execution', () => {
    expect(resolveExecutionMode({ dryRun: false })).toEqual({
      isDryRun: false,
      canExecuteLive: false,
    });
  });
  it('requires BOTH dryRun: false AND execute: true for live execution', () => {
    expect(resolveExecutionMode({ dryRun: false, execute: true })).toEqual({
      isDryRun: false,
      canExecuteLive: true,
    });
  });
});

// ── user lookup ambiguity ────────────────────────────────────────────────────
describe('checkUsersLookup', () => {
  it('zero matches → blocker, no qaUserId', () => {
    const result = checkUsersLookup([]);
    expect(result.qaUserId).toBeNull();
    expect(result.blocker).toContain('No user record found');
  });
  it('exactly one match → resolves qaUserId, no blocker', () => {
    const result = checkUsersLookup([QA_USER_ID]);
    expect(result.qaUserId).toBe(QA_USER_ID);
    expect(result.blocker).toBeNull();
  });
  it('multiple matches → blocker, refuses to guess', () => {
    const result = checkUsersLookup([QA_USER_ID, OTHER_USER_ID]);
    expect(result.qaUserId).toBeNull();
    expect(result.blocker).toContain('Multiple');
  });
});

// ── auth account cross-check ─────────────────────────────────────────────────
describe('checkAuthAccountOwnership', () => {
  it('null (no auth account found) → no blocker', () => {
    expect(checkAuthAccountOwnership(null, QA_USER_ID)).toBeNull();
  });
  it('matching userId → no blocker', () => {
    expect(checkAuthAccountOwnership(QA_USER_ID, QA_USER_ID)).toBeNull();
  });
  it('mismatched userId → blocker', () => {
    const blocker = checkAuthAccountOwnership(OTHER_USER_ID, QA_USER_ID);
    expect(blocker).not.toBeNull();
    expect(blocker).toContain(OTHER_USER_ID);
    expect(blocker).toContain(QA_USER_ID);
  });
});

// ── shared QA-owned space blocks the ENTIRE reset ───────────────────────────
describe('evaluateOwnedSpacesSafety', () => {
  it('sole-owned space with zero other access rows → deletable', () => {
    const result = evaluateOwnedSpacesSafety([
      { spaceId: 'space1', spaceName: 'QA Space', otherAccessUserIds: [] },
    ]);
    expect(result.deletableSpaceIds).toEqual(['space1']);
    expect(result.blockers).toEqual([]);
  });

  it('a space with ANY other user access → blocks (not deletable)', () => {
    const result = evaluateOwnedSpacesSafety([
      {
        spaceId: 'space1',
        spaceName: 'Shared Family Space',
        otherAccessUserIds: [OTHER_USER_ID],
      },
    ]);
    expect(result.deletableSpaceIds).toEqual([]);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toContain('Shared Family Space');
  });

  it('multiple owned spaces: one shared blocks overall, but only reports the shared one as non-deletable', () => {
    const result = evaluateOwnedSpacesSafety([
      { spaceId: 'space_solo', spaceName: 'Solo', otherAccessUserIds: [] },
      {
        spaceId: 'space_shared',
        spaceName: 'Shared',
        otherAccessUserIds: [OTHER_USER_ID],
      },
    ]);
    expect(result.deletableSpaceIds).toEqual(['space_solo']);
    expect(result.blockers).toHaveLength(1);
  });

  it('no owned spaces at all → deletable [], no blockers', () => {
    const result = evaluateOwnedSpacesSafety([]);
    expect(result.deletableSpaceIds).toEqual([]);
    expect(result.blockers).toEqual([]);
  });
});

// ── content created outside the QA-owned space ──────────────────────────────
describe('findRowsOutsideOwnedSpaces', () => {
  it('rows inside an owned space are excluded', () => {
    const result = findRowsOutsideOwnedSpaces(
      [{ id: 'e1', spaceId: 'space_owned' }],
      new Set(['space_owned'])
    );
    expect(result).toEqual([]);
  });
  it('rows outside every owned space are included (potential blocker)', () => {
    const result = findRowsOutsideOwnedSpaces(
      [{ id: 'e1', spaceId: 'space_shared' }],
      new Set(['space_owned'])
    );
    expect(result).toEqual([{ id: 'e1', spaceId: 'space_shared' }]);
  });
  it('rows with no spaceId at all are treated as outside (ambiguous, never assumed safe)', () => {
    const result = findRowsOutsideOwnedSpaces(
      [{ id: 'e1', spaceId: undefined }],
      new Set(['space_owned'])
    );
    expect(result).toEqual([{ id: 'e1', spaceId: undefined }]);
  });
});

// ── computeSafeToExecute ─────────────────────────────────────────────────────
describe('computeSafeToExecute', () => {
  it('true for zero blockers', () => {
    expect(computeSafeToExecute([])).toBe(true);
  });
  it('false for any blocker', () => {
    expect(computeSafeToExecute(['something is wrong'])).toBe(false);
  });
});

// ── external entity reset — the four phone-match QA scenarios ──────────────
describe('planExternalEntityReset — scenario A: NO MATCH', () => {
  it('a row unrelated to the QA user (matchedUserId/userId both absent or different) produces a full no-op plan', () => {
    const plan = planExternalEntityReset(
      { matchedUserId: OTHER_USER_ID },
      QA_USER_ID,
      false
    );
    expect(externalEntityResetPlanIsNoop(plan)).toBe(true);
  });
});

describe('planExternalEntityReset — scenario B: SINGLE MATCH ACCEPTED', () => {
  it('accepted row (userId===qaUserId, matchedUserId===qaUserId, inviteStatus joined) with an access row present: clears both links, resets inviteStatus, removes the access row', () => {
    const plan = planExternalEntityReset(
      {
        matchedUserId: QA_USER_ID,
        userId: QA_USER_ID,
        inviteStatus: 'joined',
      },
      QA_USER_ID,
      true
    );
    expect(plan).toEqual({
      clearMatchedUserId: true,
      clearUserId: true,
      resetInviteStatusToNone: true,
      removeAccessRow: true,
    });
  });

  it('never touches selectedPhoneNumber/displayName/color/memberType — the plan only carries the four link fields', () => {
    const plan = planExternalEntityReset(
      {
        matchedUserId: QA_USER_ID,
        userId: QA_USER_ID,
        inviteStatus: 'joined',
      },
      QA_USER_ID,
      true
    );
    expect(Object.keys(plan).sort()).toEqual(
      [
        'clearMatchedUserId',
        'clearUserId',
        'resetInviteStatusToNone',
        'removeAccessRow',
      ].sort()
    );
  });
});

describe('planExternalEntityReset — scenario C: SINGLE MATCH DECLINED', () => {
  it('declined row (matchedUserId===qaUserId, userId never set) with no access row: clears matchedUserId only, never touches inviteStatus or access row', () => {
    const plan = planExternalEntityReset(
      { matchedUserId: QA_USER_ID, inviteStatus: 'none' },
      QA_USER_ID,
      false
    );
    expect(plan).toEqual({
      clearMatchedUserId: true,
      clearUserId: false,
      resetInviteStatusToNone: false,
      removeAccessRow: false,
    });
  });

  it('a manually-set "invited" status unrelated to this match is never rewritten to "none"', () => {
    const plan = planExternalEntityReset(
      { matchedUserId: QA_USER_ID, inviteStatus: 'invited' },
      QA_USER_ID,
      false
    );
    expect(plan.resetInviteStatusToNone).toBe(false);
  });
});

describe('planExternalEntityReset — scenario D: MULTIPLE MATCHES resolved independently', () => {
  it('one accepted + one declined candidate produce independent, correct plans', () => {
    const accepted = planExternalEntityReset(
      { matchedUserId: QA_USER_ID, userId: QA_USER_ID, inviteStatus: 'joined' },
      QA_USER_ID,
      true
    );
    const declined = planExternalEntityReset(
      { matchedUserId: QA_USER_ID },
      QA_USER_ID,
      false
    );
    expect(accepted.removeAccessRow).toBe(true);
    expect(accepted.clearUserId).toBe(true);
    expect(declined.removeAccessRow).toBe(false);
    expect(declined.clearUserId).toBe(false);
    // Both independently clear the discovery link.
    expect(accepted.clearMatchedUserId).toBe(true);
    expect(declined.clearMatchedUserId).toBe(true);
  });

  it('accepted-but-no-access-row-found (data anomaly) never removes a nonexistent access row', () => {
    const plan = planExternalEntityReset(
      { matchedUserId: QA_USER_ID, userId: QA_USER_ID, inviteStatus: 'joined' },
      QA_USER_ID,
      false // hasAccessRowInSameSpace
    );
    expect(plan.removeAccessRow).toBe(false);
  });
});

describe('planExternalEntityReset — deletion/reset plan is deterministic', () => {
  it('identical inputs always produce an identical plan (no hidden state/randomness)', () => {
    const input = {
      matchedUserId: QA_USER_ID,
      userId: QA_USER_ID,
      inviteStatus: 'joined' as const,
    };
    const plan1 = planExternalEntityReset(input, QA_USER_ID, true);
    const plan2 = planExternalEntityReset(input, QA_USER_ID, true);
    expect(plan1).toEqual(plan2);
  });
});

describe('externalEntityResetPlanIsNoop', () => {
  it('true when every flag is false', () => {
    expect(
      externalEntityResetPlanIsNoop({
        clearMatchedUserId: false,
        clearUserId: false,
        resetInviteStatusToNone: false,
        removeAccessRow: false,
      })
    ).toBe(true);
  });
  it('false when any flag is true', () => {
    expect(
      externalEntityResetPlanIsNoop({
        clearMatchedUserId: true,
        clearUserId: false,
        resetInviteStatusToNone: false,
        removeAccessRow: false,
      })
    ).toBe(false);
  });
});

// ── familyContacts mirror reset — unrelated entries preserved ──────────────
describe('planFamilyContactsReset', () => {
  const normalize = (p: string) => normalizeQaPhone(p);

  it('resets only the entry matched to the QA user by phone + matchedUserId', () => {
    const contacts = [
      {
        selectedPhoneNumber: QA_PHONE,
        matchedUserId: QA_USER_ID,
        inviteStatus: 'joined' as const,
        displayName: 'QA Contact',
      },
      {
        selectedPhoneNumber: '+972529999999',
        matchedUserId: OTHER_USER_ID,
        inviteStatus: 'joined' as const,
        displayName: 'Unrelated Contact',
      },
    ];

    const { updated, changed } = planFamilyContactsReset(
      contacts,
      QA_PHONE,
      QA_USER_ID,
      normalize
    );

    expect(changed).toBe(true);
    expect(updated[0].matchedUserId).toBeUndefined();
    expect(updated[0].inviteStatus).toBe('none');
    // Unrelated entry is returned as the EXACT same object reference — proof
    // it was never rewritten.
    expect(updated[1]).toBe(contacts[1]);
  });

  it('leaves an entry with a different matchedUserId completely untouched even if the phone matches', () => {
    const contacts = [
      {
        selectedPhoneNumber: QA_PHONE,
        matchedUserId: OTHER_USER_ID,
        inviteStatus: 'joined' as const,
      },
    ];
    const { updated, changed } = planFamilyContactsReset(
      contacts,
      QA_PHONE,
      QA_USER_ID,
      normalize
    );
    expect(changed).toBe(false);
    expect(updated[0]).toBe(contacts[0]);
  });

  it('leaves an entry with no selectedPhoneNumber untouched', () => {
    const contacts = [{ matchedUserId: QA_USER_ID }];
    const { updated, changed } = planFamilyContactsReset(
      contacts,
      QA_PHONE,
      QA_USER_ID,
      normalize
    );
    expect(changed).toBe(false);
    expect(updated[0]).toBe(contacts[0]);
  });

  it('a stale/different phone on the matched entry is never treated as a match (defense-in-depth)', () => {
    const contacts = [
      {
        selectedPhoneNumber: '+972529999999',
        matchedUserId: QA_USER_ID,
        inviteStatus: 'joined' as const,
      },
    ];
    const { updated, changed } = planFamilyContactsReset(
      contacts,
      QA_PHONE,
      QA_USER_ID,
      normalize
    );
    expect(changed).toBe(false);
    expect(updated[0]).toBe(contacts[0]);
  });

  it('does not rewrite inviteStatus when it is not "joined" (e.g. declined-scenario entries stay "none")', () => {
    const contacts = [
      {
        selectedPhoneNumber: QA_PHONE,
        matchedUserId: QA_USER_ID,
        inviteStatus: 'none' as const,
      },
    ];
    const { updated, changed } = planFamilyContactsReset(
      contacts,
      QA_PHONE,
      QA_USER_ID,
      normalize
    );
    expect(changed).toBe(true);
    expect(updated[0].matchedUserId).toBeUndefined();
    expect(updated[0].inviteStatus).toBe('none');
  });

  it('empty contacts array → changed: false, updated: []', () => {
    const { updated, changed } = planFamilyContactsReset(
      [],
      QA_PHONE,
      QA_USER_ID,
      normalize
    );
    expect(updated).toEqual([]);
    expect(changed).toBe(false);
  });
});

// ── phone-match QA scenario end-to-end sanity (pure composition) ───────────
describe('phone-match QA scenarios — end-to-end pure composition', () => {
  it('A. NO MATCH: no candidate rows at all → nothing to reset', () => {
    const candidateRows: Array<{
      matchedUserId?: string;
      userId?: string;
      inviteStatus?: 'none' | 'invited' | 'joined';
    }> = [];
    const plans = candidateRows.map((row) =>
      planExternalEntityReset(row, QA_USER_ID, false)
    );
    expect(plans.every(externalEntityResetPlanIsNoop)).toBe(true);
  });

  it('B. SINGLE MATCH ACCEPTED: exactly one external access row is removed, one entity row reset', () => {
    const row = {
      matchedUserId: QA_USER_ID,
      userId: QA_USER_ID,
      inviteStatus: 'joined' as const,
    };
    const plan = planExternalEntityReset(row, QA_USER_ID, true);
    expect(plan.removeAccessRow).toBe(true);
    expect(externalEntityResetPlanIsNoop(plan)).toBe(false);
  });

  it('C. SINGLE MATCH DECLINED: zero access rows removed, one entity row matchedUserId cleared', () => {
    const row = { matchedUserId: QA_USER_ID };
    const plan = planExternalEntityReset(row, QA_USER_ID, false);
    expect(plan.removeAccessRow).toBe(false);
    expect(plan.clearMatchedUserId).toBe(true);
  });

  it('D. MULTIPLE MATCHES: only the accepted one triggers an access-row removal; all get their discovery link cleared', () => {
    const rows = [
      {
        matchedUserId: QA_USER_ID,
        userId: QA_USER_ID,
        inviteStatus: 'joined' as const,
      },
      { matchedUserId: QA_USER_ID },
      { matchedUserId: QA_USER_ID },
    ];
    const accessSpaceForFirstOnly = [true, false, false];
    const plans = rows.map((row, i) =>
      planExternalEntityReset(row, QA_USER_ID, accessSpaceForFirstOnly[i])
    );
    expect(plans.filter((p) => p.removeAccessRow)).toHaveLength(1);
    expect(plans.every((p) => p.clearMatchedUserId)).toBe(true);
  });
});

// ── Source-inspection coverage for invariants that require the real handler ──
const DEV_TOOLS_SOURCE = readFileSync(
  new URL('../../convex/devTools.ts', import.meta.url),
  'utf8'
);

describe('convex/devTools.ts — resetQaUser shape invariants (source inspection)', () => {
  it('is exported as internalMutation, never a public mutation', () => {
    expect(DEV_TOOLS_SOURCE).toContain(
      'export const resetQaUser = internalMutation({'
    );
    expect(DEV_TOOLS_SOURCE).not.toContain(
      'export const resetQaUser = mutation('
    );
  });

  it('never imports the public `mutation` or `query` helpers — internalMutation only', () => {
    const serverImportLine = DEV_TOOLS_SOURCE.split('\n').find((line) =>
      line.includes("from './_generated/server'")
    );
    expect(serverImportLine).toBeDefined();
    expect(serverImportLine).toContain('internalMutation');
    expect(serverImportLine).not.toMatch(/[,{]\s*mutation\s*[,}]/);
    expect(serverImportLine).not.toMatch(/[,{]\s*query\s*[,}]/);
  });

  it('the two hard guards (environment + allowlist) throw rather than return a soft blocker', () => {
    expect(DEV_TOOLS_SOURCE).toContain('QA_RESET_ENABLED');
    expect(DEV_TOOLS_SOURCE).toContain('QA_RESET_ALLOWED_PHONES');
    const guardSection = DEV_TOOLS_SOURCE.slice(
      DEV_TOOLS_SOURCE.indexOf('Hard guards'),
      DEV_TOOLS_SOURCE.indexOf('resolveExecutionMode(args)')
    );
    expect(
      guardSection.match(/throw new Error/g)?.length
    ).toBeGreaterThanOrEqual(3);
  });

  it('does not rely on CONVEX_CLOUD_URL for the environment guard (mentions in prose only, never read from process.env)', () => {
    expect(DEV_TOOLS_SOURCE).not.toContain('process.env.CONVEX_CLOUD_URL');
    expect(DEV_TOOLS_SOURCE).toContain('process.env.QA_RESET_ENABLED');
  });

  it('dryRun defaults to true via resolveExecutionMode (no local dryRun ?? false)', () => {
    expect(DEV_TOOLS_SOURCE).toContain('resolveExecutionMode(args)');
  });

  it('live writes only occur after the canExecuteLive / safeToExecute early-return guard', () => {
    const guardIdx = DEV_TOOLS_SOURCE.indexOf(
      'if (!canExecuteLive || !safeToExecute)'
    );
    const firstWriteIdx = DEV_TOOLS_SOURCE.indexOf('ctx.db.patch');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstWriteIdx).toBeGreaterThan(guardIdx);
  });

  it('deletes the users row via a single ctx.db.delete(qaUserId) call, after all other deletions', () => {
    const lastDeleteSectionIdx = DEV_TOOLS_SOURCE.lastIndexOf(
      'Delete the users row LAST'
    );
    const userDeleteIdx = DEV_TOOLS_SOURCE.indexOf(
      'await ctx.db.delete(qaUserId);'
    );
    expect(lastDeleteSectionIdx).toBeGreaterThan(-1);
    expect(userDeleteIdx).toBeGreaterThan(lastDeleteSectionIdx);
    // Nothing after the user-row delete should perform another db.delete —
    // it must be the final destructive step.
    const afterUserDelete = DEV_TOOLS_SOURCE.slice(
      userDeleteIdx + 'await ctx.db.delete(qaUserId);'.length
    );
    expect(afterUserDelete).not.toContain('ctx.db.delete(');
  });

  it('external entity rows are only ever patched, never deleted', () => {
    const externalResetSection = DEV_TOOLS_SOURCE.slice(
      DEV_TOOLS_SOURCE.indexOf('Reset external matched entity rows'),
      DEV_TOOLS_SOURCE.indexOf('Patch familyContacts mirrors')
    );
    expect(externalResetSection).toContain('ctx.db.patch(row._id, patch)');
    expect(externalResetSection).not.toContain('ctx.db.delete');
  });

  it('familyContacts patch never rewrites the whole owner record — only the familyContacts field', () => {
    expect(DEV_TOOLS_SOURCE).toContain(
      'await ctx.db.patch(owner._id, { familyContacts: updated });'
    );
  });

  it('scheduled reminders are cancelled via ctx.scheduler.cancel before being deleted, only when pending', () => {
    const section = DEV_TOOLS_SOURCE.slice(
      DEV_TOOLS_SOURCE.indexOf('Cancel scheduled functions'),
      DEV_TOOLS_SOURCE.indexOf('Delete the QA-owned space')
    );
    expect(section).toContain("reminder.status === 'pending'");
    expect(section).toContain(
      'ctx.scheduler.cancel(reminder.scheduledFunctionId)'
    );
  });
});
