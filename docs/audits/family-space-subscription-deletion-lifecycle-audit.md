# Family Space + Subscription + Account Deletion Lifecycle Audit

**Date**: September 17, 2026
**Status**: READ-ONLY investigation — no code changes made
**Scope**: Family space ownership, Together subscription lifecycle, account deletion impact, downgrade behavior, re-registration

---

## A. Family Space Ownership Findings

### A.1 Schema: `spaces` table

```
spaces: defineTable({
  name: v.string(),
  ownerId: v.id('users'),           // NON-OPTIONAL — required
  type: v.optional(v.union('personal', 'family')),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index('by_owner', ['ownerId'])
```

Source: `convex/schema.ts` lines 469-482

### A.2 What `spaces.ownerId` actually controls

**CONFIRMED: `spaces.ownerId` is NOT used for any permission check.**

The entire codebase was searched. `spaces.ownerId` is referenced in exactly these contexts:

| Location | Usage | Purpose |
|----------|-------|---------|
| `convex/users.ts:687` | `space.ownerId !== userId` | Determines `joinedExistingSpace` boolean for `getFamilyBootstrapStatus` — informational only, not a gate |
| `convex/members.ts:281,552,683` | `space.ownerId` to resolve owner's `familyContacts` mirror | Lookup to sync contact inviteStatus — not a permission check |
| `convex/devTools.ts:365` | Collects affected familyContacts owners | QA cleanup only |

**NO query or mutation** uses `spaces.ownerId` for:
- Authorization / permission checks
- Content visibility filtering
- Admin verification
- Edit/delete permission

### A.3 How permissions actually work

All family space permissions use the `members` table:

- **Space admin**: `members` row with `role: 'admin'` and `kind: 'access'` (the space creator)
- **Space member**: `members` row with `role: 'member'` and `kind: 'access'` (invited real users)
- **Entity profile**: `members` row with `kind: 'entity'` (children, manual profiles)

Permission guard: `requireSpaceAdmin()` at `convex/members.ts:1029-1047` checks `members` table only.

### A.4 Can User B use the space if User A (owner) disappears?

**YES** — with limitations:

1. **Space resolution**: `resolveMySpaceId()` (`convex/members.ts:59-100`) resolves via `members.by_user` index. User B has their own `members` row. This continues working.
2. **Viewing events**: Events are scoped by `spaceId`, not `ownerId`. User B sees all family events.
3. **Creating events**: User B (as `role: 'member'`) can create personal events in the space.
4. **Editing events**: User B can only edit events where `createdBy === userId`. Events created by deleted User A become **uneditable and uncancellable** by User B. Evidence: `convex/events.ts:1854` and `convex/events.ts:2133`.
5. **Admin operations** (rename space, remove profiles): User B has `role: 'member'`, NOT `role: 'admin'`. They **CANNOT** perform admin operations. Evidence: `requireSpaceAdmin()` at `convex/members.ts:1029-1047`.

### A.5 What breaks if `ownerId` points to a deleted user

| Component | Impact |
|-----------|--------|
| `getFamilyBootstrapStatus` | Minor: `joinedExistingSpace` check still works (space exists, ownerId differs) |
| `familyContacts` mirror sync in `matchOnPhone` / `acceptMatchInvite` | `ctx.db.get(space.ownerId)` returns `null` — mirror update silently skipped via null-check. No crash. |
| UI display of space owner | No UI component displays `spaces.ownerId` directly |
| Permission checks | None use `spaces.ownerId` — unaffected |

**CONFIRMED: No queries or mutations crash if `spaces.ownerId` points to a deleted user.**

### A.6 Could `spaces.ownerId` safely be reassigned?

**YES.** No code behavior depends on the specific value of `ownerId`. A simple `ctx.db.patch(spaceId, { ownerId: userBId })` would work. However, `by_owner` index would need to point correctly.

The real issue is **admin role transfer**: User B has `role: 'member'` in the `members` table. Reassigning `spaces.ownerId` alone does NOT give User B admin permissions. The `members` row must also be patched to `role: 'admin'`.

### A.7 Entity members (children/manual profiles)

Entity profiles are `members` rows with `kind: 'entity'`. They belong to the **space** (via `spaceId`), not to the creator.

- No `createdBy` field exists on entity `members` rows.
- Entity profiles have `userId: null` (or optional) — they are identified by `firstName`, `selectedPhoneNumber`, etc.
- They survive if the admin user is deleted.
- **BUT**: User B (role: 'member') cannot delete entity profiles because `removeEntityMember` calls `requireSpaceAdmin()`. They can still view them.

---

## B. Who Currently Receives Together Access

### B.1 Access determination architecture

**CONFIRMED: Subscription access is determined PER-USER, NOT per-space.**

The access determination flow:

```
RevenueCat SDK (per-device, per-user)
  → subscriptionTier: 'family' | 'personal' | null
    → useEffectiveAccess() hook (client-side only)
      → getAccessPermissions(effectiveAccess)
        → canCreateFamilyContent, canEditFamilyContent, etc.
```

Source: `hooks/useEffectiveAccess.ts` (entire file, 327 lines)

### B.2 No family sharing / space-level access

**CONFIRMED: There is NO code that shares a subscription across family members.**

Exhaustive search found:
- No code checks space membership when determining access level
- No code gives User B paid access because User A has Together
- No "family plan sharing" logic exists
- The `subscriptions` Convex table is **unused** — no mutation creates or reads subscription records for business logic (only QA reset deletes them)
- RevenueCat's `Purchases.logIn(convexUserId)` binds entitlements to the **individual Convex user ID**

### B.3 Each user needs their own subscription

If User A has Together and User B is in the same family space:
- **User A**: access determined by RevenueCat entitlement for User A's Convex ID
- **User B**: access determined by RevenueCat entitlement for User B's Convex ID (or 30-day trial)
- **User B does NOT automatically get paid access** from User A's subscription

### B.4 Trial logic

- 30-day full-access trial from account creation date
- Stored in `users.createdAt` (Convex, not RevenueCat)
- During trial: equivalent to 'family' access (can create/edit personal + family content)
- After trial: `trial_expired_free` — view-only for personal/family, communities always free
- Source: `hooks/useEffectiveAccess.ts:56-109`
- **Known inconsistency**: `app/onboarding-premium.tsx:196` says "14 ימי ניסיון" (14-day trial) but actual trial is 30 days. The onboarding screen text is stale/legacy — the real trial derives from `useEffectiveAccess.ts` which uses `TRIAL_DAYS = 30`.

### B.5 The `subscriptions` Convex table

- Defined in schema (`convex/schema.ts:538-557`) with fields: userId, plan, status, source, productId, expiresAt, createdAt, updatedAt
- **NEVER written to by any Convex mutation** — no insert, patch, or replace
- Only referenced in `convex/devTools.ts:513-516` (QA cleanup reads and deletes)
- **This table appears to be a legacy/planned feature that was never implemented**
- All real subscription state lives in RevenueCat (client-side SDK)

---

## C. What Happens if Purchaser Deletes Account While Subscription is Active

### C.1 Current deleteMyAccount implementation

**CONFIRMED: The current `deleteMyAccount` mutation is broken and effectively does nothing.**

```typescript
// convex/users.ts:199-239
export const deleteMyAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    // ...
    const userId = identity.subject;  // BUG: format is "userId|sessionId"
    const user = await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('_id'), userId))  // BUG: will never match
      .first();
    if (user) {
      await ctx.db.delete(user._id);  // Never reached
    }
```

- Uses `identity.subject` (format `userId|sessionId`) instead of `getAuthUserId(ctx)` which splits on `"|"`
- The filter `q.eq(q.field('_id'), userId)` will never find a matching user row
- **No data is actually deleted when the delete button is pressed**
- The stub returns `{ success: true, deletedCount: 0 }` (or 1 if by some edge case it matched)
- Client calls `signOut()` after, so the user appears signed out

### C.2 What happens in the scenario today

If User A presses "Delete Account":
1. `deleteMyAccount` mutation runs — **does nothing** (bug)
2. `signOut()` clears local auth state
3. User A appears signed out
4. **All data remains in the database** — User A's user row, spaces, events, tasks, members, auth tables
5. User B is completely unaffected
6. RevenueCat continues billing User A's store account
7. User A could theoretically sign back in with the same phone (auth tables still exist)

### C.3 Impact on User B's access

**Since the delete doesn't actually work today:**
- User B's access is unchanged
- User B never had access from User A's subscription (per-user model)
- User B's own trial/subscription is unaffected
- Family space continues functioning normally (User A's data is intact)

### C.4 What WOULD happen with a proper delete

If `deleteMyAccount` were properly implemented:
1. User A's `users` row deleted
2. RevenueCat still holds the entitlement under User A's old Convex ID
3. RevenueCat SDK on User A's device stops working (no valid identity)
4. **No effect on User B's RevenueCat entitlements** — they are per-user
5. User B keeps their own access level (trial or their own subscription)
6. Family space continues via User B's `members` row
7. `spaces.ownerId` becomes a dangling reference (no crash per A.5)
8. Store continues billing User A's Apple/Google account until manually cancelled

### C.5 Risk: Subscription billed but nobody can use it

**YES, this risk exists.** If User A deletes their account and does NOT cancel the store subscription:
- Apple/Google continues billing User A's payment method
- The RevenueCat entitlement is bound to User A's OLD Convex ID (which no longer exists)
- Nobody in InYomi benefits from the payment
- User B does NOT inherit the entitlement

---

## D. What Happens When Renewal is Cancelled

### D.1 Cancellation vs expiration detection

**CONFIRMED: InYomi does NOT distinguish cancellation from expiration at the code level.**

The access model is entirely derived from RevenueCat's **current** CustomerInfo entitlements:
- `customerInfo.entitlements.active[FAMILY_ENTITLEMENT_ID]` → 'family'
- `customerInfo.entitlements.active[PERSONAL_ENTITLEMENT_ID]` → 'personal'
- Neither active → fall back to 30-day trial from createdAt

There is no code that:
- Checks `will_renew` or `unsubscribe_detected_at`
- Detects "cancelled but still active" state
- Tracks a separate cancellation timestamp
- Implements a grace period

Source: `getSubscriptionTierFromCustomerInfo()` at `contexts/RevenueCatContext.tsx:283-294`

### D.2 During "cancelled but still active" period

- RevenueCat continues reporting the entitlement as active (store subscription still valid)
- `useEffectiveAccess()` returns 'family' or 'personal' (full access)
- User experience is identical to an active subscription
- No warning is shown about upcoming expiration

### D.3 At actual expiration

- RevenueCat removes the entitlement from `customerInfo.entitlements.active`
- The `CustomerInfoUpdateListener` fires, calling `updateCustomerData()`
- `subscriptionTier` becomes `null`
- `useEffectiveAccess()` falls back to trial logic (likely `trial_expired_free` for accounts older than 30 days)
- All `canCreate*` / `canEdit*` permissions change instantly

### D.4 Does User B downgrade automatically?

User B's access was never derived from User A's subscription. User B has their own independent access level:
- If User B is still in trial → continues with trial
- If User B's trial expired → `trial_expired_free` (view-only)
- If User B has their own subscription → unaffected

---

## E. What Happens When Entitlement Actually Expires

Same as D.3 above. The app transitions immediately from paid access to `trial_expired_free` (or `trial_active` if still within 30 days of account creation).

---

## F. Exact Free Downgrade Behavior

### F.1 Feature gate matrix

All gates are **client-side only**. No server-side enforcement exists (confirmed by comment in `useEffectiveAccess.ts:26-28`: "TODO: Add server-side enforcement in Convex mutations").

Source: `getAccessPermissions()` at `hooks/useEffectiveAccess.ts:147-178`

| Feature / Data | trial_active | personal | family | trial_expired_free | Existing data preserved? | Editable after downgrade? | New creation after downgrade? |
|---|---|---|---|---|---|---|---|
| Personal events (view) | YES | YES | YES | YES | YES | NO | NO |
| Personal events (create/edit) | YES | YES | YES | NO | - | - | - |
| Family events (view) | YES | NO | YES | YES | YES | NO | NO |
| Family events (create/edit) | YES | NO | YES | NO | - | - | - |
| Personal tasks (view) | YES | YES | YES | YES | YES | NO | NO |
| Personal tasks (create/edit) | YES | YES | YES | NO | - | - | - |
| Family tasks (view) | YES | NO | YES | YES | YES | NO | NO |
| Family tasks (create/edit) | YES | NO | YES | NO | - | - | - |
| Family profiles (view) | YES | NO | YES | YES | YES | - | - |
| Family profiles (edit) | YES | NO | YES | NO | - | - | - |
| Pets (edit) | YES | NO | YES | NO | - | - | - |
| Birthdays | Same as personal/family events depending on space | | | | YES | | |
| Google Calendar import | Always allowed — no subscription gating | | | | YES | | |
| Communities (join/create) | YES | YES | YES | YES | YES | YES | YES |
| Community events/tasks | YES | YES | YES | YES | YES | YES | YES |
| Daily moods | No explicit gate found | | | | YES | | |
| Share links | No explicit gate found | | | | YES | | |
| Push notifications | No explicit gate found | | | | YES | | |
| Family space collaboration | Viewing always works; mutation gates above apply | | | | YES | | |

### F.2 Important notes

1. **"View" is always allowed** — `canViewPersonalContent` and `canViewFamilyContent` are always `true` regardless of access level.
2. **Communities are always free** — `canUseCommunities` and `canMutateCommunityContent` are always `true`.
3. **No data deletion on downgrade** — data remains intact; only creation/edit permissions change.
4. **No "read-only mode" UI exists** — when `canCreate*` is false, the UI must handle it (show upgrade prompt, disable buttons). Not verified which screens actually implement this.
5. **Personal plan cannot create/edit family content** — `personal` access only unlocks personal content, not family.

### F.3 Server-side enforcement gap

**CRITICAL: There is NO server-side enforcement of subscription gates.**

The `TODO` at `hooks/useEffectiveAccess.ts:26-28` explicitly states:
> "TODO: Add server-side enforcement in Convex mutations. UI gating alone is NOT sufficient for production — a motivated user could bypass client checks."

All Convex mutations (create event, edit event, create task, etc.) do NOT check subscription status. A user could bypass client-side gates and create content via direct API calls.

---

## G. Family/Shared Data Survival

### G.1 Events in family space

- Events are scoped by `spaceId` — they belong to the space, not the creator.
- `createdBy` is used for **authorization** on non-community events (`convex/events.ts:1854`, `2133`).
- User B can VIEW events created by User A in the same space.
- User B **CANNOT edit or cancel** events created by User A (authorization check: `createdBy !== userId`).
- Events survive if User A is deleted — they remain in the space.

### G.2 Tasks in family space

- Tasks scoped by `spaceId`.
- `createdBy` used for personal-delete authorization (`convex/tasks.ts:531`).
- User B can view tasks in the space.
- User B **CANNOT delete** tasks created by User A.
- Subtask editing requires `createdBy === userId` OR `allowParticipantEditing === true` (`convex/tasks.ts:2479-2482`).
- `assignedTo` / `assignedToUserIds` pointing to deleted User A: no crash, but display may show "unknown user".

### G.3 Entity profiles (children)

- Belong to the space (via `spaceId`), not the creator.
- Survive if creator is deleted.
- User B (role: 'member') **CANNOT delete** entity profiles (`requireSpaceAdmin()` check).
- User B **CAN view** them normally.

### G.4 Birthdays

- Scoped by `spaceId`.
- `createdBy` field exists but is not used for authorization in birthday queries.
- Survive if creator is deleted.

### G.5 `createdBy` dangling reference impact — complete inventory

When User A is deleted, `createdBy` on their events/tasks becomes a dangling `Id<'users'>`. Every place `createdBy` gates a write permission:

| File | Line | Gate | Impact of deleted creator |
|---|---|---|---|
| `events.ts` | 1854 | `update` personal event — only creator edits | Event becomes uneditable |
| `events.ts` | 2133 | `cancelEvent` personal — only creator cancels | Event becomes uncancellable |
| `events.ts` | 2450 | `deleteEvent` — only creator deletes | Event becomes undeletable |
| `events.ts` | 2481 | `softDeletePersonalEvent` — only creator | Event cannot be soft-deleted |
| `tasks.ts` | 531 | `isPersonallyDeletableTask` — only creator | Task cannot be deleted |
| `tasks.ts` | 2479,2527,2557,2589,2615 | Subtask editing — only creator (unless `allowParticipantEditing`) | Subtasks frozen unless flag set |
| `birthdays.ts` | 119 | `remove` — only creator deletes | Birthday cannot be removed |
| `shareLinks.ts` | 33 | `createShareLink` — only event creator | Cannot create share link |
| `shareLinks.ts` | 83 | `revokeShareLink` — only event creator | Cannot revoke share link |
| `eventTasks.ts` | 389 | `listByEvent` personal — returns [] for non-creator | Event tasks invisible |
| `eventTasks.ts` | 818 | `updateEventTaskVisibility` — only creator | Cannot toggle visibility |
| `eventRsvps.ts` | 245 | `getAssignedEventTaskCount` personal — empty for non-creator | Count returns 0 |
| `eventRsvps.ts` | 381 | `listInvitees` — only creator | Cannot see invitees |

**Result**: When a user is deleted, ALL their personal content in the family space becomes permanently unmanageable by any surviving user. No crash occurs, but the content is effectively frozen.

---

## H. Child/Manual Profile Survival

### H.1 Ownership model

Child/entity profiles are `members` rows with:
- `kind: 'entity'` (or legacy `memberType: 'entity'`)
- `spaceId` pointing to the family space
- No `createdBy` field on the members row itself
- Optional `matchedUserId` for phone-matched children
- Optional `userId` for linked real users

### H.2 Survival after User A deletion

1. **Entity profiles survive** — they are space-scoped, not user-scoped.
2. **User B can view** all entity profiles in the space.
3. **User B CANNOT delete** entity profiles (requires `role: 'admin'`, User B has `role: 'member'`).
4. **User B CANNOT add** new entity profiles (admin-guarded mutations).

### H.3 Capability gap for User B

After User A (admin) leaves:
- User B becomes the sole real user but has `role: 'member'`
- Cannot rename space, add/remove family profiles, or perform admin operations
- This creates a "stranded member" situation

---

## I. Re-Registration with Same Phone

### I.1 Current behavior (with broken deleteMyAccount)

Since `deleteMyAccount` doesn't actually delete anything:
- User A can sign in again with the same phone
- Auth tables (`authAccounts`, etc.) still exist
- Same user row, same Convex ID
- All data reappears
- Not a "re-registration" — it's a sign-in to the same account

### I.2 Re-registration is BROKEN even with proper user row deletion

**CRITICAL**: Even if `deleteMyAccount` properly deleted the `users` row but left `authAccounts` intact:

1. `@convex-dev/auth` checks `authAccounts` for existing entry with `provider: 'phone'` and `providerAccountId: '+972...'`
2. The orphaned `authAccounts` row still exists (pointing to the old deleted user ID)
3. `createOrUpdateUser` receives `args.existingUserId` = the OLD deleted user ID
4. It calls `ctx.db.patch(existingUserId, { phone, updatedAt })` on the **deleted document**
5. **`ctx.db.patch()` on a deleted document throws** — the user is **permanently locked out** of re-registering with their phone number

Source: `convex/auth.ts:125-130` — the `if (args.existingUserId)` branch patches the old ID without checking if the document still exists.

**This means: proper deletion MUST clean up `authAccounts` to allow re-registration.**

### I.3 Expected behavior with FULL cleanup (including auth tables)

If deletion properly cleans up auth tables (especially `authAccounts`):

1. **New user ID**: `createOrUpdateUser` in `convex/auth.ts` creates a new `users` row with new `_id` (no `existingUserId` since `authAccounts` was cleaned).
2. **`matchOnPhone` runs**: Called from `createOrUpdateUser` callback on sign-up. It scans `members` table for entity rows matching the phone number.
3. **Potential reconnection**: If User A's old entity row in User B's family space still exists with `selectedPhoneNumber` matching, `matchOnPhone` would set `matchedUserId` to the NEW user ID — BUT only if `matchedUserId` was cleared during deletion.
4. **If `matchedUserId` was NOT cleared**: `matchOnPhone` skips rows where `matchedUserId` is already set (`convex/members.ts:260`: `if (member.matchedUserId) continue`). The old entity row retains the stale deleted user ID and no new match is created.
5. **Stale references**: Deletion MUST clear `matchedUserId` on old entity rows to allow clean re-matching.

### I.3 `matchOnPhone` behavior

Source: `convex/members.ts` (the `matchOnPhone` internal mutation)

- Runs on every user creation/update via `createOrUpdateUser` callback
- Scans `members` table for entity rows with matching phone
- Sets `matchedUserId` and `inviteStatus: 'pendingApproval'`
- Also updates owner's `familyContacts` mirror

### I.4 Auth cleanup requirements

For clean re-registration, the following must be deleted:
- `authAccounts` (provider: 'phone', providerAccountId: normalized phone)
- `authSessions`
- `authRefreshTokens`
- `authVerificationCodes`
- `authVerifiers`
- `authRateLimits` (identifier matching phone)
- `googleImportStatus` (prevents import lock for new account)

### I.5 RevenueCat on re-registration

- New Convex user ID → `Purchases.logIn(newConvexId)` creates new RevenueCat customer
- Old entitlements are on old Convex ID → not accessible
- `Purchases.restorePurchases()` may transfer if RevenueCat dashboard allows it (see J below)

---

## J. RevenueCat Restore Purchases Behavior

### J.1 Current restore implementation

Source: `contexts/RevenueCatContext.tsx:1229-1275`

```typescript
const restorePurchases = useCallback(async (): Promise<boolean> => {
  // ... guards ...
  const Purchases = (await import('react-native-purchases')).default;
  const customerInfo = await Purchases.restorePurchases();
  await updateCustomerData(customerInfo as never, expectedGeneration);
  const hasPremium = checkHasPremium(customerInfo);
  // Shows success/failure alert
  return hasPremium;
}, [...]);
```

### J.2 Where restore is available

- **Subscription screen**: `app/(authenticated)/subscription.tsx:275-284` — "שחזור רכישות" button
- **Paywall screen**: `app/(auth)/paywall/index.tsx` — restore option exists

### J.3 Transfer behavior (re-registration scenario)

When User A re-registers with a NEW Convex ID and taps "Restore Purchases":

1. `Purchases.logIn(newConvexId)` has already created a new RC customer
2. `Purchases.restorePurchases()` asks the store (Apple/Google) for purchases
3. The store returns the active subscription (still billed to User A's Apple/Google account)
4. **What happens depends on RevenueCat dashboard's "Transfer Behavior" setting:**

**CANNOT be determined from code.** The `Purchases.configure()` call at `contexts/RevenueCatContext.tsx:582-584` does NOT set a `transferBehavior` option. This means the **RevenueCat dashboard default** applies.

RevenueCat defaults:
- **"Transfer if there are no active subscriptions"** (most common default)
- This means: if the OLD RC customer still has an active subscription, the restore may be BLOCKED from transferring to the new customer

### J.4 External verification required

**MUST CHECK in RevenueCat dashboard:**
1. Project Settings → Transfer Behavior
2. Whether it's set to "Transfer always", "Transfer if no active subs", or "Keep with original"
3. This determines whether User A can reclaim their subscription on a new account

### J.5 Risk: Stranded subscription

If transfer behavior is "Keep with original":
- Subscription stays on old deleted Convex user ID
- New account cannot restore it
- User pays but cannot use
- **Must be resolved before launch**

---

## K. Store Subscription Cancellation Behavior

### K.1 Current delete account UI

Source: `app/(authenticated)/profile.tsx:357-399`

The current delete account dialog:
- **First dialog**: "⚠️ מחיקת חשבון" — warns about permanent data deletion
- **Second dialog**: "🚨 אישור סופי" — final confirmation
- **NO subscription warning** — does not mention Apple/Google subscription
- **NO management URL** — does not offer to open subscription management
- **NO attempt to cancel billing** — `deleteMyAccount` mutation has no RevenueCat/store interaction

### K.2 Customer Center (subscription management)

`presentCustomerCenter()` at `contexts/RevenueCatContext.tsx:1689-1760`:
- Available via RevenueCat UI SDK
- Can show management URL, allow cancellation
- Has fallback chain: native Customer Center → `customerData.managementURL` → `showManageSubscriptions()` → alert
- **NOT connected to delete account flow**

### K.3 What exists today

| Check | Status |
|-------|--------|
| Warn that deleting doesn't cancel store subscription | **NOT IMPLEMENTED** |
| Link to manage/cancel subscription before deleting | **NOT IMPLEMENTED** |
| Attempt to cancel billing programmatically | **NOT IMPLEMENTED** (correct — should NOT do this) |
| `Purchases.logOut()` on deletion | **NOT CALLED** (intentional — see RevenueCatContext.tsx:22-24) |

---

## L. Target-Behavior Gap Matrix

| Desired behavior | Current status | Evidence | Fix required |
|---|---|---|---|
| User A is removed when deleting account | **BROKEN** — delete mutation uses wrong identity format, nothing is deleted | `convex/users.ts:208` uses `identity.subject` instead of `getAuthUserId()` | MUST FIX: Rewrite `deleteMyAccount` with proper auth and full cleanup |
| User B remains in family space | **ALREADY WORKS** (since nothing is deleted) — would work with proper delete too | `resolveMySpaceId()` uses `members.by_user` index, independent of `spaces.ownerId` | Preserve: ensure deletion does NOT delete shared space or User B's members row |
| Family space remains | **ALREADY WORKS** — space is not deleted | Space scoped by `spaceId`, not creator | Preserve: do NOT delete space if other access users exist |
| Child/manual profiles remain | **ALREADY WORKS** — profiles belong to space | `members` rows with `kind: 'entity'` have `spaceId`, no `createdBy` | Preserve: do NOT delete entity members in shared spaces |
| Shared family events/tasks remain | **PARTIALLY SAFE** — data survives but becomes uneditable | Events/tasks survive via `spaceId`; `createdBy` check blocks User B from editing | SHOULD FIX: Consider allowing space admin to edit orphaned events |
| No shared data deleted accidentally | **ALREADY WORKS** (since nothing is deleted) | `deleteMyAccount` is a no-op | MUST FIX: New delete must carefully scope to user-only data |
| `spaces.ownerId` reassigned | **NOT IMPLEMENTED** | No space ownership transfer mechanism exists | MUST FIX: Reassign to User B (+ promote to admin role) on owner deletion |
| Active paid access consistent until expiration | **NOT APPLICABLE** — access is per-user, not shared | `useEffectiveAccess()` reads individual RevenueCat entitlement | Already correct: User B's access is independent |
| Cancelling renewal doesn't immediately erase access | **ALREADY WORKS** | RevenueCat reports entitlement as active until period ends | Already correct |
| When entitlement expires, data remains + access downgrades | **ALREADY WORKS** for data preservation; gates are client-side only | `getAccessPermissions()` changes flags; no data deletion | SHOULD FIX: Add server-side enforcement |
| User A can sign up again as new account | **BROKEN** — auth tables not cleaned up | `deleteMyAccount` doesn't delete auth tables | MUST FIX: Delete all auth tables for clean re-registration |
| No old personal data automatically returns | **BROKEN** — data was never deleted | `deleteMyAccount` is a no-op | MUST FIX: Proper deletion of personal data |
| User A can be re-added to family later | **PARTIALLY WORKS** — `matchOnPhone` would re-match | `matchOnPhone` runs on registration, scans entity rows | Verify: ensure old entity row is properly cleaned/reset |
| Restore Purchases behavior is deterministic | **UNKNOWN** — depends on RC dashboard setting | No `transferBehavior` set in code | MUST VERIFY: Check RevenueCat dashboard Transfer Behavior setting |

---

## M. Test Coverage

### M.1 Existing test coverage

| Scenario | Test file | Coverage |
|----------|-----------|----------|
| Family space access | None found | **MISSING** |
| Multiple real users in one space | None found | **MISSING** |
| Owner deletion | None found | **MISSING** |
| Subscription sharing | None found (not applicable — no sharing) | N/A |
| Together → Free downgrade | `tests/convex/googleImportAccess.test.ts` (verifies import not gated) | **MINIMAL** |
| Subscription expiration | None found | **MISSING** |
| Restore Purchases | None found | **MISSING** |
| Re-registration after deletion | None found | **MISSING** |
| Phone matching after deletion | None found | **MISSING** |
| Preservation of shared events/tasks | None found | **MISSING** |
| Entity/child profile survival | None found | **MISSING** |
| deleteMyAccount | None found | **MISSING** |
| Access permissions derivation | Indirectly via `tests/convex/rcIdentityReadyGuard.test.ts` | **PARTIAL** |
| RevenueCat identity | `tests/convex/rcIdentityReadyGuard.test.ts` | Covered |
| Subscription strings | `tests/convex/subscriptionStrings.test.ts` | Covered (copy only) |
| Billing period derivation | `tests/convex/getBillingPeriodFromProductIdentifier.test.ts` | Covered |
| QA reset cleanup | `tests/convex/qaResetUser.test.ts` | Covered |

### M.2 Missing critical tests

1. `deleteMyAccount` — no test exists (the mutation itself is broken)
2. Family space with multiple access users — no integration test
3. Space data survival after user deletion — no test
4. `createdBy` dangling reference handling — no test
5. Re-registration with same phone — no test
6. `matchOnPhone` after deletion — no test
7. Access permissions matrix (each feature × each tier) — no systematic test
8. Server-side enforcement of subscription gates — no test (enforcement doesn't exist)

---

## N. Exact Changes Required Before Implementing Delete Account

### MUST FIX before launch

1. **Rewrite `deleteMyAccount`** — use `getAuthUserId(ctx)` instead of `identity.subject`; implement full cleanup following QA reset patterns in `convex/devTools.ts`

2. **Block deletion if user owns communities** — check `communities.ownerId` before allowing deletion; require ownership transfer first

3. **Handle shared family space on deletion** — if space has other access users:
   - Reassign `spaces.ownerId` to the remaining access user
   - Promote remaining user's `members` row from `role: 'member'` to `role: 'admin'`
   - Do NOT delete space, entity profiles, or shared content
   - DO delete deleting user's own `members` access row

4. **Clean up auth tables** — delete `authAccounts`, `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits` for the user's phone

5. **Add subscription warning to delete UI** — "מחיקת החשבון לא מבטלת את המנוי ב-App Store / Google Play. יש לבטל ידנית." with link to subscription management

6. **Clear `matchedUserId` on entity rows** — when deleting, clear `matchedUserId` on any entity rows that referenced the deleted user, to prevent stale references if the phone re-registers

7. **Cancel `scheduledReminders`** — cancel all pending scheduled functions for the user, and for other users' reminders on tasks being deleted

8. **Verify RevenueCat Transfer Behavior** — check dashboard setting to ensure re-registered users can restore purchases

### SHOULD FIX

9. **Server-side subscription enforcement** — add entitlement checks to Convex mutations (currently TODO in codebase)

10. **Allow space admin to manage orphaned events** — consider allowing the new admin (promoted User B) to edit/cancel events whose `createdBy` is a deleted user

11. **Handle `createdBy` display** — UI should show "משתמש שנמחק" when `ctx.db.get(event.createdBy)` returns null

12. **Add `by_user` index to `scheduledReminders`** — currently no such index; deletion requires full table scan (same approach as QA reset)

### Already correct / preserve

13. **RevenueCat identity binding** — `Purchases.logIn(convexUserId)` correctly scopes entitlements per-user
14. **No `Purchases.logOut()` on deletion** — correct; signing out clears local state, next logIn switches identity
15. **Community access always free** — confirmed, never gated
16. **Google Calendar import not gated** — confirmed, always available
17. **Viewing always allowed** — confirmed in `getAccessPermissions()`
18. **Space resolution via members table** — confirmed, independent of `spaces.ownerId`

---

## O. Product Decisions Still Truly Open

These decisions **cannot** be answered from current code and require explicit product input:

1. **Should remaining family member be auto-promoted to admin?** When space owner deletes account and another access user remains, should that user automatically become admin (gaining ability to add/remove profiles, rename space)? Code supports it; product must decide.

2. **Should orphaned events/tasks be editable by the new admin?** Events created by a deleted user currently cannot be edited by anyone. Should the promoted admin inherit edit rights? Requires changing authorization logic in `convex/events.ts` and `convex/tasks.ts`.

3. **RevenueCat Transfer Behavior**: What should the dashboard setting be? Options:
   - "Transfer if there are no active subscriptions" (current default — may block restore for re-registered users)
   - "Transfer always" (allows restore but could be abused for subscription sharing)
   - "Keep with original" (subscription stays stranded on deleted account)

4. **Should `matchOnPhone` auto-reconnect re-registered users?** When User A re-registers with the same phone, should they be automatically matched back to their old entity row in User B's family? Or should it require a fresh invitation?

5. **Should there be a "grace period" warning before deletion?** Currently the flow is immediate. Should there be a waiting period (e.g., 7 days)?

6. **Should the `subscriptions` Convex table be used?** It exists in schema but is never written. Should deletion clean it up anyway (defensive), or should it be removed from the schema?

7. **What about the Personal plan and family content?** Users with `personal` plan cannot create/edit family content. Is this intentional for family members who don't have Together, or a gap?
