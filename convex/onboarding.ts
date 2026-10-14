import { v } from 'convex/values';
import { buildOnboardingAnswersPatch } from '../lib/onboardingAnswers';
import type { Id } from './_generated/dataModel';
import { mutation } from './_generated/server';
import { executeFamilyJoin, resolveKind } from './members';
import { getAuthUserId } from './sessionAuth';

// ── Phone normalization ───────────────────────────────────────────────────────
// FIXED: retroactive phone-based family member matching on initial onboarding save
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

/**
 * פונקציה זו נקראת בסוף תהליך האונבורדינג.
 * היא מעדכנת את פרטי המשתמש ויוצרת עבורו את ה-Space (מרחב העבודה) הראשון —
 * או, אם המשתמש כבר קיבל גישה למשפחה קיימת (claimed path, ראו למטה), משתמשת
 * מחדש במרחב/גישה/ישות הקיימים במקום ליצור כפילות.
 *
 * Phase 1 — canonical identity: firstName + lastName are BOTH required
 * (see lib/mandatoryProfileSetup.ts for the client-side save-disable rule
 * that mirrors this server-side validation). fullName is always derived
 * from them for backward compatibility with existing readers.
 */
export const finishOnboarding = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    profileColor: v.string(),
    spaceType: v.string(),
    challenges: v.array(v.string()),
    childCount: v.optional(v.number()),
    // FIXED: family profile persistence — stores family contacts as JSON blob
    familyContacts: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // 1. בדיקה שהמשתמש מחובר
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error('חייבים להיות מחוברים כדי לסיים את האונבורדינג');
    }

    // 2. מציאת המשתמש בבסיס הנתונים
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    // Phase 1: both first name and last name are mandatory during
    // onboarding identity completion. Trim and reject blank/whitespace.
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName) throw new Error('שם פרטי הוא שדה חובה');
    if (!lastName) throw new Error('שם משפחה הוא שדה חובה');
    const fullName = `${firstName} ${lastName}`;

    // ── Family Membership Lifecycle Phase 1: claimed-user path ──────────
    // If the authenticated user previously SELECTED a pending phone match
    // via acceptPendingPhoneMatch (recorded as `pendingMatchMemberId` —
    // selection only, no access granted yet), this is where the actual
    // join happens: executeFamilyJoin re-verifies the match and the
    // one-active-family guard, then grants real access. This guarantees
    // no duplicate space is ever created for a claimed user, and that
    // access is never granted before the user's identity (name) is known.
    const pendingMemberId = user.pendingMatchMemberId;
    const pendingEntity = pendingMemberId
      ? await ctx.db.get(pendingMemberId)
      : null;
    const hasValidPendingMatch =
      pendingEntity !== null &&
      pendingEntity !== undefined &&
      resolveKind(pendingEntity) === 'entity' &&
      pendingEntity.matchedUserId === userId &&
      (pendingEntity.userId === undefined || pendingEntity.userId === userId);

    if (pendingMemberId && hasValidPendingMatch) {
      const spaceId = await executeFamilyJoin(ctx, userId, pendingMemberId);

      // Claimed user owns their canonical identity: the entity's
      // displayName is updated to the canonical full name, even if the
      // family manager originally created it under a different name.
      await ctx.db.patch(pendingMemberId, { displayName: fullName });

      await ctx.db.patch(userId, {
        firstName,
        lastName,
        fullName,
        profileColor: args.profileColor,
        isActive: true,
        onboardingCompleted: true,
        profileSetupCompletedAt: user.profileSetupCompletedAt ?? Date.now(),
        // Calendar Import onboarding step is required for this new-flow user.
        calendarImportPromptRequiredAt:
          user.calendarImportPromptRequiredAt ?? Date.now(),
        updatedAt: Date.now(),
      });

      return { spaceId };
    }

    // ── Normal new-user path (no valid claimed relationship) ────────────
    // 3. עדכון פרטי המשתמש
    // FIXED: retroactive phone-based family member matching on initial onboarding save
    // Resolve matchedUserId for any family member whose selectedPhoneNumber already
    // exists as a registered Convex user (invited person signed up before being added).
    let resolvedFamilyContacts = args.familyContacts;
    if (args.familyContacts && Array.isArray(args.familyContacts)) {
      resolvedFamilyContacts = await Promise.all(
        (args.familyContacts as FamilyContactEntry[]).map(async (entry) => {
          const { matchedUserId: _ignored, ...contact } = entry;
          if (!entry.selectedPhoneNumber) return contact;
          const normalizedPhone = normalizeToE164(entry.selectedPhoneNumber);
          if (!normalizedPhone) return contact;
          const matchedUser = await ctx.db
            .query('users')
            .withIndex('by_phone', (q) => q.eq('phone', normalizedPhone))
            .unique();
          if (matchedUser) return { ...contact, matchedUserId: matchedUser._id };
          return contact;
        })
      );
    }

    await ctx.db.patch(userId, {
      firstName,
      lastName,
      fullName,
      profileColor: args.profileColor,
      familyContacts: resolvedFamilyContacts,
      isActive: true,
      updatedAt: Date.now(),
    });

    // 4. יצירת המרחב (Space) הראשון
    const spaceId = await ctx.db.insert('spaces', {
      name: args.spaceType === 'family' ? 'הבית שלנו' : 'המרחב שלי',
      type: args.spaceType as 'personal' | 'couple' | 'family' | 'business',
      ownerId: userId,
      onboardingChallenges: args.challenges,
      createdAt: Date.now(),
    });

    // 5. הוספת המשתמש כ-Admin במרחב החדש
    // FIXED: kind: 'access' stamped on all owner/access rows from creation
    await ctx.db.insert('members', {
      userId,
      spaceId,
      role: 'admin',
      kind: 'access',
      joinedAt: Date.now(),
    });

    // FIXED: kind: 'entity' stamped on all family member inserts from creation
    // All family members are written — manual members (no phone) are no longer skipped.
    if (resolvedFamilyContacts && Array.isArray(resolvedFamilyContacts)) {
      const now = Date.now();
      for (const contact of resolvedFamilyContacts as FamilyContactEntry[]) {
        const memberType =
          (contact.type as 'person' | 'pet' | undefined) === 'pet'
            ? ('pet' as const)
            : ('person' as const);

        if (!contact.selectedPhoneNumber) {
          await ctx.db.insert('members', {
            spaceId,
            role: 'member',
            kind: 'entity',
            joinedAt: now,
            displayName: contact.name,
            color: contact.color,
            inviteStatus: 'none',
            memberType,
          });
          continue;
        }
        const normalizedPhone = normalizeToE164(contact.selectedPhoneNumber);
        if (!normalizedPhone) continue;
        const matchedId = contact.matchedUserId as Id<'users'> | undefined;
        await ctx.db.insert('members', {
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
      }
    }

    // 6. סימון האונבורדינג כהושלם ושמירת ה-Space הראשי
    // Stage 2B+3: finishOnboarding is now the sole completion path for the
    // mandatory Profile Setup screen, so it also stamps profileSetupCompletedAt
    // (previously only set by the separate optional updateMyProfile path).
    // Without this, getFamilyBootstrapStatus's hasConfiguredFamily check would
    // stay false for a Self-only setup (no entity rows, no familyContacts),
    // incorrectly bouncing a just-completed user back into the optional
    // family-bootstrap → family-profile-setup detour right after Home.
    await ctx.db.patch(userId, {
      onboardingCompleted: true,
      defaultSpaceId: spaceId,
      profileSetupCompletedAt: user.profileSetupCompletedAt ?? Date.now(),
      // Calendar Import onboarding step is required for this new-flow user.
      calendarImportPromptRequiredAt:
        user.calendarImportPromptRequiredAt ?? Date.now(),
      updatedAt: Date.now(),
    });

    return { spaceId };
  },
});

// ── resolveCalendarImportPrompt ─────────────────────────────────────────────
/**
 * Marks the Calendar Import onboarding step as RESOLVED — called when the
 * user either finished the Google Calendar import or explicitly skipped it
 * (or when a previously completed import is detected on a later launch).
 *
 * This is deliberately independent of Google import state: it never reads or
 * writes googleImportStatus, so a skip does NOT mark the import as completed
 * (Settings/Home import entry points stay available), and a completed import
 * is still tracked solely by googleImportStatus.
 *
 * Idempotent: a second call keeps the original timestamp. Only valid once
 * onboardingCompleted === true — it never touches onboardingCompleted.
 */
export const resolveCalendarImportPrompt = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error('חייבים להיות מחוברים כדי להמשיך');
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    if (user.onboardingCompleted !== true) {
      throw new Error('יש להשלים את ההגדרה הראשונית לפני שממשיכים');
    }

    if (user.calendarImportPromptResolvedAt !== undefined) return null;

    await ctx.db.patch(userId, { calendarImportPromptResolvedAt: Date.now() });
    return null;
  },
});

// ── persistOnboardingAnswers (Stage 2A foundation) ──────────────────────────
/**
 * Stage 2A foundation ONLY. Persists the Q1 (onboardingIntent) and/or Q2
 * (onboardingChallenges) onboarding answers to the users record,
 * independently of finishOnboarding.
 *
 * This is a USERS-ONLY answer-persistence mutation. It intentionally does
 * NOT:
 *   - create or update a space
 *   - write spaces.onboardingChallenges (legacy field, untouched)
 *   - create members / access rows
 *   - set defaultSpaceId
 *   - set onboardingCompleted
 *   - call finishOnboarding
 *   - call matchOnPhone
 *   - change any routing
 *
 * There is deliberately no client integration yet (Stage 2B+3 will wire
 * this into the authenticated layout's routing). finishOnboarding is left
 * completely unmodified — this is not a dual-write path; it is the future
 * canonical answer-writing path that finishOnboarding will eventually stop
 * needing to duplicate.
 *
 * Field guards are INDEPENDENT (see buildOnboardingAnswersPatch in
 * lib/onboardingAnswers.ts): a field is written only if the server does
 * not already have a value for it AND a value was provided in this call.
 * A stale pre-auth draft replay can never overwrite an existing server
 * answer, but a field the server is missing can still be filled in even
 * when the other field already exists.
 */
export const persistOnboardingAnswers = mutation({
  args: {
    onboardingIntent: v.optional(
      v.union(v.literal('personal'), v.literal('couple'), v.literal('family'))
    ),
    onboardingChallenges: v.optional(
      v.array(
        v.union(
          v.literal('incoming_from_everywhere'),
          v.literal('remember_tasks_and_appointments'),
          v.literal('shared_schedule_coordination'),
          v.literal('everything_in_one_place')
        )
      )
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error('חייבים להיות מחוברים כדי לשמור תשובות אונבורדינג');
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('משתמש לא נמצא');

    const patch = buildOnboardingAnswersPatch(
      {
        onboardingIntent: user.onboardingIntent,
        onboardingChallenges: user.onboardingChallenges,
      },
      {
        onboardingIntent: args.onboardingIntent,
        onboardingChallenges: args.onboardingChallenges,
      }
    );

    if (Object.keys(patch).length === 0) return null;

    await ctx.db.patch(userId, patch);
    return null;
  },
});
