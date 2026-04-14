import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation } from './_generated/server';

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
 * היא מעדכנת את פרטי המשתמש ויוצרת עבורו את ה-Space (מרחב העבודה) הראשון.
 */
export const finishOnboarding = mutation({
  args: {
    fullName: v.string(),
    profileColor: v.string(),
    spaceType: v.string(),
    challenges: v.array(v.string()),
    sources: v.array(v.string()),
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

    // 3. עדכון פרטי המשתמש
    // FIXED: retroactive phone-based family member matching on initial onboarding save
    // Resolve matchedUserId for any family member whose selectedPhoneNumber already
    // exists as a registered Convex user (invited person signed up before being added).
    let resolvedFamilyContacts = args.familyContacts;
    if (args.familyContacts && Array.isArray(args.familyContacts)) {
      resolvedFamilyContacts = await Promise.all(
        (args.familyContacts as FamilyContactEntry[]).map(async (entry) => {
          if (entry.matchedUserId) return entry;
          if (!entry.selectedPhoneNumber) return entry;
          const normalizedPhone = normalizeToE164(entry.selectedPhoneNumber);
          if (!normalizedPhone) return entry;
          const matchedUser = await ctx.db
            .query('users')
            .withIndex('by_phone', (q) => q.eq('phone', normalizedPhone))
            .unique();
          if (matchedUser) return { ...entry, matchedUserId: matchedUser._id };
          return entry;
        })
      );
    }

    await ctx.db.patch(userId, {
      fullName: args.fullName,
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
      primarySources: args.sources,
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
        if (!contact.selectedPhoneNumber) {
          await ctx.db.insert('members', {
            spaceId,
            role: 'member',
            kind: 'entity',
            joinedAt: now,
            displayName: contact.name,
            color: contact.color,
            inviteStatus: 'none',
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
          inviteStatus: contact.inviteStatus ?? 'none',
          matchedUserId: matchedId,
          userId: matchedId,
        });
      }
    }

    // 6. סימון האונבורדינג כהושלם ושמירת ה-Space הראשי
    await ctx.db.patch(userId, {
      onboardingCompleted: true,
      defaultSpaceId: spaceId,
      updatedAt: Date.now(),
    });

    return { spaceId };
  },
});
