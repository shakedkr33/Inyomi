# Security Wave 2A Remediation — Launch Blockers (Pass 2)

**Date**: September 22, 2026
**Scope**: P2-H01, P2-H02, P2-H03, P2-L10 (Security Audit Pass 2 launch blockers)
**Status**: P2-H03 and P2-L10 fixed in code. P2-H01 and P2-H02 have real
architectural/infrastructure gaps that cannot be safely closed from the
repository alone — see sections below.

This document is the audit trail for Wave 2A. It does not re-litigate or
change any finding outside this exact scope. See
`docs/audits/family-space-subscription-deletion-lifecycle-audit.md` (Sept
17, 2026) for the earlier, independent investigation that first identified
the P2-H01 gap (its section F.3 / "SHOULD FIX #9") — this document confirms
and extends that finding into a full inventory and a concrete decision.

---

## P2-H03 — Apple Review authentication bypass (FIXED)

**Root cause**: `app/(auth)/verify.tsx` decided which Convex Auth provider
to call (`'apple-review'` vs `'phone'`) by hardcoding BOTH the Apple Review
demo phone number AND its fixed OTP directly in client code
(`phone === <demo phone> && digits === <fixed OTP>`). `convex/auth.ts`
validates that exact same fixed phone+OTP pair against its
`APP_REVIEW_PHONE` / `APP_REVIEW_OTP` Convex environment variables. Anyone
inspecting the shipped JS bundle could read the OTP and authenticate as the
Apple Review account.

**Fix**: extracted `shouldUseAppleReviewProvider(phone)` into
`lib/services/appleReviewAuth.ts` — a pure function that decides routing
from the phone number ONLY. The OTP is never referenced in client code.
`verify.tsx` now calls this helper instead of the inline `&& digits ===
'<otp>'` check. If a user enters the wrong code for the review phone number,
`signIn('apple-review', ...)` is still invoked, but `convex/auth.ts`'s
`authorize()` still independently compares the code against
`process.env.APP_REVIEW_OTP` and returns `null` — sign-in fails exactly like
a wrong OTP does for normal phone auth.

**Why this is safe**: the phone number itself is not a secret — by design,
knowing it only selects a provider, it never authenticates. This is called
out explicitly in the new helper's doc comment. Fail-closed behavior
(`getAppleReviewEnv()` returning `null` when either env var is absent) and
the review account's non-admin role were already correct and were verified,
not changed.

**Manual action still required (informational only — not performed by this
task)**: none for code correctness. Operationally, whoever manages the
Convex Dashboard should confirm `APP_REVIEW_PHONE` / `APP_REVIEW_OTP` are
only set on deployments that actually need Apple Review sign-in (see
P2-H02 below for why this matters once environments are properly
separated).

---

## P2-L10 — `updateUserType` removed (FIXED)

**Root cause**: `convex/users.ts` exported a public mutation
`updateUserType({ userType: 'free' | 'paid' })` that patched the field
directly onto the caller's own row, resolved via an email-based lookup in a
phone-auth system. Verified **zero callers** across `app/`, `convex/`,
`tests/` and scripts before removal.

**Fix**: the mutation was deleted entirely (not "secured" to self-only —
per the task's explicit instruction, paid/free status must never be
client-writable, self or otherwise). A source-inspection regression test
(`tests/convex/updateUserTypeRemoval.test.ts`) proves: the export is gone,
no other convex file re-implements or calls it, and no other public
mutation across `convex/*.ts` declares a client-facing `userType`,
`'paid'` literal, or `subscriptionTier`/`isPremium`/`entitlement` argument.

---

## P2-H01 — Server-side entitlement enforcement (ARCHITECTURAL GAP — NOT FIXED)

### Current server-side source of truth: NONE

Verified by direct inspection:

- `convex/http.ts` registers only Convex Auth's own HTTP routes — **there is
  no RevenueCat webhook receiver.**
- `convex/schema.ts`'s `subscriptions` table (`plan: 'free'|'plus'|'family'`,
  `status`, `source`, `productId`) has **zero writer mutations** anywhere in
  `convex/`. It is read only by `convex/accountDeletion.ts` and
  `convex/devTools.ts`, both for QA/deletion cleanup of legacy rows — never
  for an access decision.
- `users.userType` (the field `P2-L10` removed the only public writer for)
  is set once, to a hardcoded `'free'` default, by `createOrUpdateUser` and
  otherwise never written or read for gating.
- The only genuinely server-verifiable signal is `users.createdAt` (used for
  the 30-day trial window) — this is real, but insufficient alone.

**Conclusion**: entitlement state (`subscriptionTier: 'personal' | 'family'
| null`) exists **only** on-device, inside `contexts/RevenueCatContext.tsx`,
derived from the RevenueCat SDK's local `CustomerInfo`. Convex has no way to
independently verify whether a given authenticated user is currently
entitled to `personal` or `family` access.

### Why no enforcement was added

Implementing any backend check that trusts `trial_expired_free` from
`createdAt` alone (without a real paid-status signal) would **incorrectly
lock out paying customers** whose 30-day trial window has passed but who
hold a real, active RevenueCat subscription — the backend has no way to
distinguish that case from an actual free user, and would fail *closed for
the wrong reason* against real revenue-generating users. Per this task's
explicit instructions, no such false-trust enforcement was implemented.
Building genuine server trust requires an external integration
(RevenueCat → Convex webhook, or a server-side RevenueCat REST call using a
RevenueCat **secret** API key) that does not exist in this repository today
and was out of scope to invent in this wave (new secret configuration,
RevenueCat Dashboard webhook wiring, and a new Convex HTTP endpoint).

### Entitlement inventory (from current product logic in `hooks/useEffectiveAccess.ts`)

Current, unambiguous client-side rule (`getAccessPermissions()`):

| Access level | canCreate/EditPersonalContent | canCreate/EditFamilyContent | Communities |
|---|---|---|---|
| `trial_active` (first 30 days, or `family`/`personal` RC entitlement is absent but within trial) | ✅ | ✅ | ✅ (always) |
| `trial_expired_free` | ❌ | ❌ | ✅ (always) |
| `personal` (paid) | ✅ | ❌ | ✅ (always) |
| `family` (paid) | ✅ | ✅ | ✅ (always) |

Convex mutation inventory (67 public write mutations surveyed across
`events.ts`, `tasks.ts`, `eventTasks.ts`, `members.ts`, `birthdays.ts`,
`communities.ts`, `communityActivities.ts`, `dailyMoods.ts`,
`googleImport.ts`, `linkedEvents.ts`, `shareLinks.ts`):

- **Free / never gated (by explicit product rule)**: all `communities.ts`
  mutations and the community-scoped branches of `events`/`tasks`/
  `eventTasks` (create/update/RSVP/claim/etc. inside a community). This
  matches `useEffectiveAccess`'s `canUseCommunities: true` (always).
- **Personal-tier gated (needs `trial_active`\|`personal`\|`family`)**:
  personal-space `events.create/update/delete`, `tasks.create/update`,
  `googleImport.importGoogleCalendar`, `linkedEvents.*`, `shareLinks.*`.
- **Family-tier gated (needs `trial_active`\|`family`)**:
  `members.completeExistingUserFamilyJoin`, `members.renameSpace`,
  `members.removeEntityMember`, `birthdays.create/remove`, and
  family-profile mutations in `convex/users.ts` (`updateMyProfile`'s
  family-entity path).
- **PRODUCT DECISION REQUIRED**: `dailyMoods.upsertMood` — user-scoped, but
  the product has not classified daily mood tracking as personal-tier,
  family-tier, or free in any document or code comment found. **Not
  enforced or guessed.**
- **None of the above are currently enforced server-side.** Existing server
  checks on these mutations are auth + membership/role/creator only (e.g.
  `requireSpaceAdmin`, `requireSpaceAccess`, `getCommunityMembership`) — see
  the mutation-by-mutation breakdown gathered for this wave for exact checks
  per mutation (available on request; omitted here to keep this document
  focused).

### Recommended implementation path (NOT implemented — requires infra + a follow-up task)

1. Add a RevenueCat **webhook** endpoint to `convex/http.ts` (RevenueCat →
   Convex), verified using RevenueCat's webhook Authorization header
   secret (new Convex env var, configured in the Convex Dashboard — not
   performed by this task).
2. Populate a real entitlement table (either resurrect `subscriptions` with
   an actual writer, or add a small dedicated table) from verified webhook
   events, keyed by Convex `userId` (RevenueCat App User ID is already
   `Purchases.logIn(convexUserId)` — see `contexts/RevenueCatContext.tsx`).
3. Add a small server helper (e.g. `getServerEntitlement(ctx, userId)`)
   that mirrors `getAccessPermissions()`'s precedence rules using ONLY this
   server-verified table + `createdAt` trial fallback — never a
   client-supplied value.
4. Enforce that helper inside the personal-tier and family-tier mutations
   listed above. Communities remain unconditionally free, matching current
   product behavior exactly.
5. Add tests proving: free user blocked, entitled user allowed, a
   client-forged "paid" argument has no effect (already partially covered
   by this wave's `tests/convex/updateUserTypeRemoval.test.ts`), and missing
   webhook data fails safely without locking out real paying users during
   any propagation delay (e.g. a short grace window, or falling back to
   RevenueCat's own webhook retry guarantees rather than an immediate hard
   lock).

**PRODUCT DECISION REQUIRED before implementing step 5's grace-window
behavior** — this task does not decide it.

---

## P2-H02 — Environment separation (dev/preview/production Convex deployments)

### Current mapping (verified via `eas.json`, `.env`, `.env.local`, and the Convex CLI/MCP deployment registry — not guessed)

| EAS build profile | `EXPO_PUBLIC_CONVEX_URL` | Deployment |
|---|---|---|
| `development` | `https://sincere-panther-608.convex.cloud` | Dev deployment (`sincere-panther-608`) — same one used by local `bunx convex dev` (`CONVEX_DEPLOYMENT=dev:sincere-panther-608` in `.env`/`.env.local`) |
| `preview` | `https://sincere-panther-608.convex.cloud` | **Same dev deployment** |
| `production` | `https://sincere-panther-608.convex.cloud` | **Same dev deployment** |

**Confirmed finding**: `preview` and `production` EAS profiles — i.e.
TestFlight/Play internal-testing and store-submission builds — currently
point at the exact same Convex deployment used for day-to-day local
development. Any developer running `bunx convex dev` is live-editing the
backend that real (or reviewer) users' builds talk to.

### New information from this investigation: a separate production deployment already exists

Using the Convex CLI/MCP deployment registry (authoritative — not a file
grep), this project has a **second, genuinely separate Convex deployment**:

- `peaceful-cricket-429.convex.cloud` — registered kind: **`prod`**.

This deployment **is not referenced anywhere in the repository** (`eas.json`,
`.env`, `.env.local`, `.env.example` all only mention `sincere-panther-608`).

**Critical caveat — this deployment is currently STALE, not ready to serve
traffic:**

- Its live schema (inspected read-only) is **missing fields present in the
  current `convex/schema.ts`** — e.g. `events.ownerScope` and
  `events.removedFromCommunityAt` are absent from the deployed schema.
  This means the code/schema on this deployment predates several recent
  changes and has **not** received a `npx convex deploy` in some time.
- Its environment variables were not inspected (production deployments are
  read-only through the available tooling in this environment) — Twilio
  credentials, `APP_REVIEW_PHONE`/`APP_REVIEW_OTP`, and
  `QA_FULL_ACCESS_PHONES` presence/absence on this deployment are
  **NEEDS MANUAL VERIFICATION**.

### Why no `eas.json` change was made

Outcome A ("point the existing production profile at an already-verified
production URL") is **not safe to perform silently** here: the production
deployment exists, but shipping a build against it today — before its
schema/functions are brought current and its env vars verified — would
immediately break functionality that depends on fields/functions the stale
deployment does not have. That is a worse outcome than the current
(insecure but at least functionally consistent) state. Per this task's
explicit boundaries, deploying code to production (`npx convex deploy`
against `peaceful-cricket-429`) and changing Convex Dashboard environment
variables were **not performed** — both require an authorized human action
outside this repository.

### Required manual action plan (release-blocking, in order)

1. **Deploy current schema + functions** to the `peaceful-cricket-429`
   (prod) deployment: `npx convex deploy` targeting that deployment (an
   authorized human must run this — not performed by this task).
2. **Configure required environment variables** on that deployment via the
   Convex Dashboard: Twilio credentials (`TWILIO_ACCOUNT_SID`,
   `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`,
   `TWILIO_VERIFY_SERVICE_SID`), and a product decision on
   `APP_REVIEW_PHONE`/`APP_REVIEW_OTP` (needed only if Apple Review is
   expected to sign in against this exact deployment).
3. **Do not set `QA_FULL_ACCESS_PHONES` on this deployment** for real
   production traffic — that env var is documented in
   `convex/users.ts`/`hooks/useEffectiveAccess.ts` as
   "remove before production release."
4. **Verify parity**: confirm the deployed schema on `peaceful-cricket-429`
   matches `convex/schema.ts` exactly (no missing tables/fields) and that a
   smoke test of core flows (auth, event/task CRUD, community join) passes
   against it directly.
5. **Only then**, update `eas.json`'s `production` profile's
   `EXPO_PUBLIC_CONVEX_URL` to `https://peaceful-cricket-429.convex.cloud`.
   Decide separately (product decision) whether `preview` should also move
   to this deployment, a third staging deployment, or continue sharing
   `development` — this task does not decide it.
6. **Verify with a real build**: produce a `preview` or `production` EAS
   build and confirm at runtime (e.g. a debug log of the resolved Convex
   URL, or the existing `_debug` RevenueCat panel pattern) that it is
   talking to the intended deployment, not `sincere-panther-608`.

### Status

**P2-H02 remains: CODE READY / MANUAL INFRA ACTION REQUIRED.** The
repository-side risk (guessing a URL, or migrating blindly) was avoided; the
existing prod deployment was located and its staleness was verified instead
of assumed. Environment separation is **not yet actually implemented** —
do not report this finding as closed until the six steps above are
completed and verified.
