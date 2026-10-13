import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { isCalendarImportPromptPending } from '../lib/calendarImportOnboarding';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { runAccountDeletion } from './accountDeletion';
// FIXED: updateMyProfile and listMyFamilyContacts now use identical spaceId resolution
import {
  assertProfileCanBeRemoved,
  requireSpaceOwner,
  resolveKind,
  resolveMySpaceId,
} from './members';

// ── Phone normalization ───────────────────────────────────────────────────────
// FIXED: retroactive phone-based family member matching when contacts are saved
// Mirrors lib/phoneUtils.ts normalizeIsraeliPhone — duplicated here because
// Convex backend cannot import from the client lib/ folder.
function normalizeToE164(phone: string): string | null {
  const stripped = phone.replace(/[\s\-()]/g, '');
  if (stripped.startsWith('+972')) return stripped;
  if (stripped.startsWith('972')) return `+${stripped}`;
  if (stripped.startsWith('0')) return `+972${stripped.slice(1)}`;
  if (stripped.startsWith('5')) return `+972${stripped}`;
  return null;
}

type FamilyContactEntry = {
  id: string;
  name?: string;
  color?: string;
  selectedPhoneNumber?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
  matchedUserId?: string;
  [key: string]: unknown;
};

// שליפת המשתמש הנוכחי המחובר
// מחזיר null אם המשתמש לא מחובר
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

// SECURITY (Wave 1 / H-01): getById was a public, unauthenticated query that
// returned the raw user document (PII incl. phone/email/familyContacts) for
// ANY caller-supplied userId — no auth check, no object-level authorization.
// Removed 2026-09: verified zero callers across app/, convex/, tests/ and
// scripts. If a caller ever needs another user's profile, use/extend a
// scoped, authorized query (e.g. creatorProfile/assignees projections in
// tasks.getTaskDetails) instead of reintroducing raw cross-user document
// access. See docs/audits/ security audit Wave 1, finding H-01.

// SECURITY (Wave 1 / C-01): listActive was a public, unauthenticated query
// that returned the ENTIRE active-users table (global user enumeration incl.
// PII). Removed 2026-09: verified zero callers across app/, convex/, tests/
// and scripts. See docs/audits/ security audit Wave 1, finding C-01.

// יצירה או עדכון של משתמש (נקרא בדרך כלל מתהליך האימות)
export const createOrUpdateUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

    const email = identity.email ?? '';
    const now = Date.now();

    // בדיקה אם המשתמש כבר קיים
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique();

    const userData = {
      email,
      emailVerified: identity.emailVerified ?? false,
      fullName: identity.name || identity.nickname || 'User',
      role: 'user' as const,
      userType: 'free' as const, // ברירת מחדל - משתמש חינמי
      isActive: true,
      updatedAt: now,
    };

    // עדכון משתמש קיים
    if (existing) {
      await ctx.db.patch(existing._id, userData);
      return existing._id;
    }

    // יצירת משתמש חדש
    return await ctx.db.insert('users', {
      ...userData,
      createdAt: now,
    });
  },
});

// SECURITY (Wave 1 / H-02): updateProfile was a public mutation that
// accepted a client-supplied userId and patched that user's profile after
// only checking that SOME identity was authenticated — never that the
// authenticated caller was the same user as the target userId. This allowed
// any signed-in user to overwrite any other user's fullName. Removed
// 2026-09: verified zero callers across app/, convex/, tests/ and scripts.
// The legitimate, authorized self-profile-update flow is updateMyProfile
// below (uses getAuthUserId(ctx) as the target — never a client-supplied
// id). Family profile writes additionally require ownership. Do not reintroduce a
// client-supplied-userId profile mutation. See docs/audits/ security audit
// Wave 1, finding H-02.

// SECURITY (Pass 2 / P2-L10, coupled to P2-H01): updateUserType was a
// public mutation that accepted a client-supplied `userType: 'free' |
// 'paid'` value and wrote it directly onto the caller's own user row. It
// was already effectively dead (identity lookup was email-based in a
// phone-auth system — verified zero callers across app/, convex/, tests/
// and scripts), but a public mutation letting a user set their own paid
// status is dangerous by construction: if any future server logic ever
// started trusting `userType` for entitlement decisions, this endpoint
// would let any authenticated user grant themselves paid access with zero
// server-side verification. Removed 2026-09 rather than "secured" (e.g.
// restricting it to self-only) — paid/free status must never be
// client-writable at all, self or otherwise. See
// docs/audits/ security audit Pass 2, finding P2-L10 / P2-H01.

// SECURITY (Wave 1 / C-02): remove was a public mutation that accepted a
// client-supplied userId and deleted that user record after only checking
// that SOME identity was authenticated — never that the authenticated
// caller was the same user as the target userId. This allowed any signed-in
// user to delete an arbitrary other user's record. Removed 2026-09: verified
// zero callers across app/, convex/, tests/ and scripts. This fix is
// intentionally NOT wired into the account-deletion flow — deleteMyAccount
// (below) is a separate, already-authorized self-service flow and is out of
// scope for this remediation. See docs/audits/ security audit Wave 1,
// finding C-02.

// שליפת ה-Space הראשי של המשתמש הנוכחי
// מחזיר Id<'spaces'> | null — null פירושו "אין מרחב פעיל"
export const getMySpace = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // 1. נסה members table — מוצא membership ומחזיר spaceId
    const membership = await ctx.db
      .query('members')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();
    if (membership?.spaceId) return membership.spaceId;

    // 2. fallback: user.defaultSpaceId (נאכלס ב-onboarding)
    const user = await ctx.db.get(userId);
    if ((user as unknown as { defaultSpaceId?: string })?.defaultSpaceId) {
      return (user as unknown as { defaultSpaceId: string }).defaultSpaceId;
    }

    // 3. אין מרחב — הקליינט מציג מצב שגיאה
    return null;
  },
});

// מחיקת חשבון המשתמש הנוכחי וכל הנתונים המשויכים אליו
// ⚠️ אזהרה: פעולה זו בלתי הפיכה ותמחק את כל הנתונים לצמיתות!
//
// Delegates the entire deletion (planning, blockers, transaction-size
// preflight, destructive writes, verification, Auth cleanup) to the
// production account-deletion engine in convex/accountDeletion.ts. See that
// file's top-of-file doc comment for the full behavior contract.
//
// ROOT-CAUSE FIX: the previous implementation used the raw, composite
// Convex Auth Phone OTP `identity.subject` (`userId|sessionId`) as if it
// were a `users` table Id directly, which could silently fail to find the
// real user and report a false success. `getAuthUserId(ctx)` is the
// canonical resolver and is used here instead. If it cannot resolve a
// userId, this throws — it NEVER returns `{ success: true, deletedCount: 0 }`.
export const deleteMyAccount = mutation({
  args: {},
  returns: v.object({
    success: v.literal(true),
    deletedSpaceCount: v.number(),
    deletedCommunityCount: v.number(),
    transferredCommunityCount: v.number(),
    deletedEventCount: v.number(),
    deletedTaskCount: v.number(),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error('לא מחובר למערכת');
    }

    const summary = await runAccountDeletion(ctx, userId);

    return {
      success: true as const,
      deletedSpaceCount: summary.deletedSpaceIds.length,
      deletedCommunityCount: summary.deletedCommunityIds.length,
      transferredCommunityCount: summary.transferredCommunityIds.length,
      deletedEventCount: summary.deletedEventCount,
      deletedTaskCount: summary.deletedTaskCount,
    };
  },
});

export const getMyId = query({
  args: {},
  handler: async (ctx) => {
    return await getAuthUserId(ctx);
  },
});

// FIXED: added getMyProfile query for authenticated rehydration
// Returns the minimal profile data needed to restore OnboardingContext after app restart.
// familyContacts (children/pets from onboarding step 4) ARE stored in Convex (familyContacts field)
// and ARE rehydrated into OnboardingContext.familyData by hydrateFromServer on app restart.
export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    let spaceType: string | undefined;
    if (user.defaultSpaceId) {
      const space = await ctx.db.get(user.defaultSpaceId);
      spaceType = space?.type;
    }

    return {
      fullName: user.fullName,
      // Phase 1: canonical split-name identity — optional/undefined for
      // legacy users who only ever saved fullName (no migration performed).
      firstName: user.firstName,
      lastName: user.lastName,
      profileColor: user.profileColor,
      spaceType,
      familyContacts: user.familyContacts,
    };
  },
});

// עדכון פרופיל המשתמש הנוכחי (לשימוש חוזר לאחר אונבורדינג)
// FIXED: family profile persistence — use this instead of finishOnboarding for returning users
// FIXED: retroactive phone-based family member matching when contacts are saved
export const updateMyProfile = mutation({
  args: {
    fullName: v.optional(v.string()),
    // Phase 1: canonical split-name identity. Optional — unrelated profile
    // saves (e.g. just adding a family member) must never be forced to
    // supply these. When either is explicitly provided, both are used to
    // regenerate fullName, and any of the caller's OWN claimed family
    // entities (in another admin's space) have their displayName synced
    // to the new canonical name — see instruction #11 / claimed-name
    // self-edit synchronization.
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profileColor: v.optional(v.string()),
    familyContacts: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    // Self identity edits remain available to every authenticated member.
    // Any family-structure payload requires ownership before the first write.
    if (args.familyContacts !== undefined) {
      const spaceId = await resolveMySpaceId(ctx, userId);
      if (!spaceId) throw new Error('יש להשלים את הגדרת המרחב לפני ניהול המשפחה');
      await requireSpaceOwner(ctx, spaceId);
      if (!Array.isArray(args.familyContacts)) throw new Error('רשימת פרופילים לא תקינה');
    }

    const previousContacts = Array.isArray(user.familyContacts)
      ? (user.familyContacts as FamilyContactEntry[])
      : [];
    const now = Date.now();
    const patch: Record<string, unknown> = {
      updatedAt: now,
      profileSetupCompletedAt: user.profileSetupCompletedAt ?? now,
    };
    if (args.fullName !== undefined) patch.fullName = args.fullName;
    if (args.profileColor !== undefined) patch.profileColor = args.profileColor;

    // Phase 1: explicit self name edit — regenerate canonical fullName
    // from the merged first/last name and overwrite the legacy fullName
    // patch above with the canonical derivation (never forced on callers
    // who don't touch these fields).
    let canonicalFullNameForSync: string | undefined;
    if (args.firstName !== undefined || args.lastName !== undefined) {
      const nextFirstName =
        args.firstName !== undefined
          ? args.firstName.trim()
          : (user.firstName ?? '');
      const nextLastName =
        args.lastName !== undefined
          ? args.lastName.trim()
          : (user.lastName ?? '');
      patch.firstName = nextFirstName || undefined;
      patch.lastName = nextLastName || undefined;
      const derivedFullName = [nextFirstName, nextLastName]
        .filter(Boolean)
        .join(' ');
      if (derivedFullName) {
        patch.fullName = derivedFullName;
        canonicalFullNameForSync = derivedFullName;
      }
    }

    // FIXED: retroactive phone-based family member matching when contacts are saved
    // Handles the case where the invited user already had a Convex account when added.
    // Uses by_phone index — O(1) per family member, no table scan needed here.
    if (args.familyContacts !== undefined) {
      if (Array.isArray(args.familyContacts)) {
        const resolved = await Promise.all(
          (args.familyContacts as FamilyContactEntry[]).map(async (entry) => {
            // Account links are resolved by the server, never by supplied IDs.
            const { matchedUserId: _ignored, ...contact } = entry;
            if (!entry.selectedPhoneNumber) return contact;
            const normalizedPhone = normalizeToE164(entry.selectedPhoneNumber);
            if (!normalizedPhone) return contact;
            const matchedUser = await ctx.db
              .query('users')
              .withIndex('by_phone', (q) => q.eq('phone', normalizedPhone))
              .unique();
            if (matchedUser)
              return { ...contact, matchedUserId: matchedUser._id };
            return contact;
          })
        );
        patch.familyContacts = resolved;
      } else {
        patch.familyContacts = args.familyContacts;
      }
    }

    await ctx.db.patch(userId, patch);

    // Phase 1: claimed-user self name edit synchronization — if the
    // caller just changed their own canonical name, propagate it to any
    // of THEIR OWN claimed entity rows (e.g. in a family admin's space).
    // This is the same displayName they own; no other user's data is
    // touched here.
    if (canonicalFullNameForSync) {
      const myRows = await ctx.db
        .query('members')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect();
      const myClaimedEntities = myRows.filter(
        (r) => resolveKind(r) === 'entity' && r.inviteStatus === 'joined'
      );
      for (const entity of myClaimedEntities) {
        await ctx.db.patch(entity._id, {
          displayName: canonicalFullNameForSync,
        });
      }
    }

    // FIXED: selectedPhoneNumber and inviteStatus now persisted to members table
    // Sync resolved family contacts into the members table so the by_phone index
    // supports O(1) matching when an invited person registers via OTP.
    const resolvedContacts = Array.isArray(patch.familyContacts)
      ? (patch.familyContacts as FamilyContactEntry[])
      : Array.isArray(args.familyContacts)
        ? (args.familyContacts as FamilyContactEntry[])
        : null;

    if (resolvedContacts) {
      // FIXED: use shared resolveMySpaceId — identical logic to listMyFamilyContacts.
      // Previously used defaultSpaceId which resolved a different space than the one
      // listMyFamilyContacts reads from, causing entity rows to land in the wrong space.
      const spaceId = await resolveMySpaceId(ctx, userId);
      console.log(
        '[PROFILE SYNC] ownerUserId:',
        userId,
        '| resolvedSpaceId:',
        spaceId,
        '| contacts count:',
        resolvedContacts.length,
        '| contacts:',
        JSON.stringify(
          resolvedContacts.map((c) => ({
            name: (c as Record<string, unknown>).name,
            type: (c as Record<string, unknown>).type,
            hasPhone: !!(c as Record<string, unknown>).selectedPhoneNumber,
          }))
        )
      );
      if (spaceId) {
        // Fetch all current members rows for this space to detect existing phone entries
        const existingMembers = await ctx.db
          .query('members')
          .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
          .collect();

        console.log(
          '[PROFILE SYNC] existingMembers in space before sync:',
          existingMembers
            .filter((m) => m.kind === 'entity' || m.displayName)
            .map((m) => ({
              id: m._id,
              displayName: m.displayName,
              kind: m.kind,
              memberType: m.memberType,
            }))
        );

        // FIXED: kind: 'entity' stamped on all family member inserts and updates
        // (rows without kind field are handled by resolveKind() for backward-compat)
        const now = Date.now();
        // Track which entity row _ids were touched so orphaned rows can be deleted below.
        const touchedEntityIds = new Set<string>();

        for (const contact of resolvedContacts) {
          const isManual = !contact.selectedPhoneNumber;
          console.log(
            '[PROFILE SYNC] processing contact:',
            contact.name,
            '| type:',
            (contact as Record<string, unknown>).type,
            '| isManual:',
            isManual
          );

          const memberType =
            (contact.type as 'person' | 'pet' | undefined) === 'pet'
              ? ('pet' as const)
              : ('person' as const);

          // Prefer the stable entity ID. Legacy UI IDs are resolved through
          // the previous persisted contact, so renaming preserves references.
          const byId = existingMembers.find((m) =>
            resolveKind(m) === 'entity' && m._id === contact.id
          );
          const previous = previousContacts.find((entry) => entry.id === contact.id) ?? contact;
          const previousPhone = previous.selectedPhoneNumber
            ? normalizeToE164(previous.selectedPhoneNumber) : null;
          const candidates = existingMembers.filter((m) =>
            resolveKind(m) === 'entity' && (previousPhone
              ? m.selectedPhoneNumber === previousPhone
              : !m.selectedPhoneNumber && m.displayName === previous.name)
          );
          if (!byId && candidates.length > 1) throw new Error('לא ניתן לזהות את הפרופיל באופן חד־משמעי');
          const existing = byId ?? candidates[0];

          if (isManual) {
            console.log(
              '[PROFILE SYNC] manual member existing row:',
              existing?._id ?? 'none',
              '| displayName match target:',
              contact.name
            );
            if (existing) {
              // Owners edit the family profile, not the linked personal account.
              const displayName = contact.name ?? existing.displayName;
              await ctx.db.patch(existing._id, {
                kind: 'entity', // stamp kind on pre-existing rows opportunistically
                displayName,
                color: contact.color ?? existing.color,
                memberType,
              });
              touchedEntityIds.add(existing._id);
              console.log(
                '[PROFILE SYNC] PATCHED entity row:',
                existing._id,
                '| name:',
                contact.name,
                '| memberType:',
                memberType,
                '| spaceId:',
                spaceId
              );
            } else {
              const newId = await ctx.db.insert('members', {
                spaceId,
                role: 'member',
                kind: 'entity',
                joinedAt: now,
                displayName: contact.name,
                color: contact.color,
                inviteStatus: 'none',
                memberType,
              });
              touchedEntityIds.add(newId);
              console.log(
                '[PROFILE SYNC] INSERTED new entity row:',
                newId,
                '| table: members',
                '| name:',
                contact.name,
                '| memberType:',
                memberType,
                '| role: member | kind: entity | isManual: true',
                '| ownerUserId:',
                userId,
                '| spaceId:',
                spaceId,
                '| inviteStatus: none'
              );
            }
            continue;
          }

          // Contact-sourced member — dedup by normalized phone.
          // FIXED: הפוך לאיש קשר now patches existing member row, no duplicate created.
          // A manual member (no phone) converted to contact-sourced has the same displayName
          // but no selectedPhoneNumber. Without the displayName fallback, the phone search
          // misses it and ctx.db.insert creates a second row.
          const normalizedPhone = normalizeToE164(
            contact.selectedPhoneNumber as string
          );
          if (!normalizedPhone) continue;
          const matchedId = contact.matchedUserId as Id<'users'> | undefined;

          if (existing) {
            const displayName = contact.name ?? existing.displayName;
            await ctx.db.patch(existing._id, {
              kind: 'entity', // stamp kind on pre-existing rows opportunistically
              selectedPhoneNumber: normalizedPhone,
              inviteStatus: existing.inviteStatus === 'joined'
                ? 'joined' : contact.inviteStatus === 'invited' ? 'invited' : existing.inviteStatus,
              matchedUserId: existing.userId ? existing.matchedUserId : matchedId,
              userId: existing.userId,
              displayName,
              color: contact.color ?? existing.color,
              memberType,
            });
            touchedEntityIds.add(existing._id);
            console.log(
              '[PROFILE SYNC] PATCHED phone-contact row:',
              existing._id,
              '| name:',
              contact.name,
              '| memberType:',
              memberType,
              '| phone:',
              normalizedPhone,
              '| spaceId:',
              spaceId
            );
          } else {
            const newId = await ctx.db.insert('members', {
              spaceId,
              role: 'member',
              kind: 'entity',
              joinedAt: now,
              displayName: contact.name,
              color: contact.color,
              selectedPhoneNumber: normalizedPhone,
              inviteStatus: contact.inviteStatus === 'invited' ? 'invited' : 'none',
              matchedUserId: matchedId,
              memberType,
            });
            touchedEntityIds.add(newId);
            console.log(
              '[PROFILE SYNC] INSERTED phone-contact row:',
              newId,
              '| table: members',
              '| name:',
              contact.name,
              '| memberType:',
              memberType,
              '| phone:',
              normalizedPhone,
              '| ownerUserId:',
              userId,
              '| spaceId:',
              spaceId,
              '| matchedUserId:',
              matchedId ?? 'none'
            );
          }
        }

        // Delete entity rows no longer in familyContacts — propagates deletes to all
        // family members in real-time. Only removes kind='entity' rows (never access rows).
        for (const m of existingMembers) {
          const isEntityRow =
            m.kind === 'entity' ||
            (m.kind === undefined &&
              m.role === 'member' &&
              Boolean(m.displayName));
          if (isEntityRow && !touchedEntityIds.has(m._id)) {
            console.log(
              '[PROFILE SYNC] ORPHAN DELETE:',
              m._id,
              '| displayName:',
              m.displayName,
              '| memberType:',
              m.memberType,
              '| kind:',
              m.kind
            );
            await assertProfileCanBeRemoved(ctx, m);
            await ctx.db.delete(m._id);
          }
        }

        console.log(
          '[PROFILE SYNC] sync complete | spaceId:',
          spaceId,
          '| touchedIds:',
          [...touchedEntityIds]
        );
      }
    }
  },
});

/** Post-auth routing: family entities, invite join, or skip flag */
export const getFamilyBootstrapStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    const onboardingComplete = user.onboardingCompleted === true;
    const familySetupSkippedAt = user.familySetupSkippedAt ?? null;
    const profileSetupCompletedAt = user.profileSetupCompletedAt ?? null;

    const contactsBlob = user.familyContacts;
    const hasContactsBlob =
      Array.isArray(contactsBlob) && contactsBlob.length > 0;

    const spaceId = await resolveMySpaceId(ctx, userId);
    if (!spaceId) {
      return {
        onboardingComplete,
        familySetupSkippedAt,
        profileSetupCompletedAt,
        hasConfiguredFamily:
          profileSetupCompletedAt !== null || hasContactsBlob,
        joinedExistingSpace: false,
      };
    }

    const space = await ctx.db.get(spaceId);
    const joinedExistingSpace = space !== null && space.ownerId !== userId;

    const rows = await ctx.db
      .query('members')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect();
    const entityCount = rows.filter((r) => resolveKind(r) === 'entity').length;

    const hasConfiguredFamily =
      profileSetupCompletedAt !== null || entityCount > 0 || hasContactsBlob;

    return {
      onboardingComplete,
      familySetupSkippedAt,
      profileSetupCompletedAt,
      hasConfiguredFamily,
      joinedExistingSpace,
    };
  },
});

export const markFamilySetupSkipped = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    await ctx.db.patch(userId, {
      familySetupSkippedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// ── QA / Developer Full-Access Override ──────────────────────────────────────
//
// Returns true ONLY when the current user's phone (E.164) is listed in the
// QA_FULL_ACCESS_PHONES Convex environment variable (comma-separated phones).
//
// Example value:  +972501234567,+972509876543
//
// HOW TO CONFIGURE:
//   Convex Dashboard → Settings → Environment Variables → QA_FULL_ACCESS_PHONES
//
// HOW TO REMOVE (before production release):
//   Delete the QA_FULL_ACCESS_PHONES env var from the Convex dashboard.
//   No code changes are required — the query returns false when the var is absent.
//
// SAFETY GUARANTEES:
//   • Returns false when QA_FULL_ACCESS_PHONES is unset or empty.
//   • Returns false for every user whose phone is NOT explicitly listed.
//   • Never mutates user data or trial timestamps.
//   • Has no effect on RevenueCat, OTP, Apple Review demo, or normal trial logic.
//
// ⚠️  REMOVE QA_FULL_ACCESS_PHONES FROM CONVEX ENV BEFORE PRODUCTION RELEASE.
// ─────────────────────────────────────────────────────────────────────────────
export const getIsQaUser = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx): Promise<boolean> => {
    const qaPhones = process.env.QA_FULL_ACCESS_PHONES;

    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const user = await ctx.db.get(userId);

    if (!qaPhones) return false;
    if (!user?.phone) return false;

    const allowlist = qaPhones
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);
    const isMatch = allowlist.includes(user.phone);

    return isMatch;
  },
});

// סטטוס המשתמש הנוכחי: האם יש פרופיל, האם האונבורדינג הושלם
// משמש לניתוב פוסט-אימות — מחזיר null כשלא מחובר (caller משתמש ב-'skip')
// FIXED (Stage 2B+3): added phoneMatchResolvedAt — needed by the authenticated
// layout's routing to know whether the user already made their onboarding
// phone-match decision (accept one match / decline all). Existing callers
// that only read hasProfile/onboardingComplete are unaffected — this is an
// additive field on the same response shape.
//
// ROOT-CAUSE FIX (post-delete onboarding race): `getAuthUserId(ctx)` can
// resolve a valid userId whose `users` row no longer exists — this is
// EXACTLY the transient window right after `deleteMyAccount` succeeds
// (the row is already gone) but before the client's auth token/session
// has been cleared by the Delete Account flow's `signOut()` call. The
// `!userId` branch above already means "no valid identity at all" and
// every current caller (app/(authenticated)/_layout.tsx,
// app/(authenticated)/family-bootstrap.tsx) already treats a `null`
// result as "not a real authenticated app user — do not persist
// onboarding answers, do not route to onboarding, fall back to
// sign-in/neutral routing". A deleted-but-not-yet-signed-out identity is
// the SAME kind of state, so it reuses this exact same `null` sentinel
// rather than inventing a new one.
//
// This branch is NOT reachable for a legitimate new user: Convex Auth's
// `createOrUpdateUser` callback (convex/auth.ts) synchronously inserts
// the `users` row (and the Apple Review sign-in path does the same in
// convex/appleReviewAuth.ts) BEFORE the sign-in mutation returns a
// session/token to the client — so by the time `useConvexAuth()` ever
// reports `isAuthenticated === true` for ANY user, including a brand-new
// one, the corresponding `users` row already exists. There is no
// legitimate "authenticated identity, no app user row yet" bootstrap
// phase in this app's auth flow — the only way to reach `!user` below is
// a `users` row that existed and was deleted (account deletion).
export const getCurrentUserStatus = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      hasProfile: v.boolean(),
      onboardingComplete: v.boolean(),
      phoneMatchResolvedAt: v.union(v.number(), v.null()),
      // Calendar Import onboarding step (final step before first Home):
      // true only for new-flow users who have not yet imported or skipped.
      // Always false for users onboarded before this feature existed.
      calendarImportPromptPending: v.boolean(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) {
      // Deleted-account transient state — see the doc comment above.
      // NEVER represent this as an onboarding-incomplete profile.
      return null;
    }

    return {
      hasProfile: true,
      onboardingComplete: user.onboardingCompleted === true,
      phoneMatchResolvedAt: user.phoneMatchResolvedAt ?? null,
      calendarImportPromptPending: isCalendarImportPromptPending(user),
    };
  },
});
