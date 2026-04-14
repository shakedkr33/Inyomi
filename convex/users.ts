import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
// FIXED: updateMyProfile and listMyFamilyContacts now use identical spaceId resolution
import { resolveMySpaceId } from './members';

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

// שליפת משתמש לפי מזהה (ID)
export const getById = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

// שליפת רשימת כל המשתמשים הפעילים
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect();
  },
});

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

// עדכון פרופיל המשתמש (למשל, שינוי שם)
export const updateProfile = mutation({
  args: {
    userId: v.id('users'),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, { userId, fullName }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

    await ctx.db.patch(userId, {
      fullName,
      updatedAt: Date.now(),
    });

    return userId;
  },
});

// עדכון סוג המשתמש (חינמי/בתשלום)
export const updateUserType = mutation({
  args: {
    userType: v.union(v.literal('free'), v.literal('paid')),
  },
  handler: async (ctx, { userType }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('לא מחובר למערכת');
    }

    // חיפוש המשתמש לפי אימייל
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', identity.email ?? ''))
      .unique();

    if (!user) {
      throw new Error('משתמש לא נמצא');
    }

    await ctx.db.patch(user._id, {
      userType,
      updatedAt: Date.now(),
    });

    return user._id;
  },
});

// מחיקת משתמש (פעולה למנהלים או למשתמש עצמו - כאן מיושם כמחיקה פיזית)
export const remove = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

    await ctx.db.delete(userId);
  },
});

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
export const deleteMyAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('לא מחובר למערכת');
    }

    // קבלת מזהה המשתמש מה-identity
    const userId = identity.subject;
    let deletedCount = 0;

    // כאן תוכל להוסיף מחיקה של טבלאות נוספות שקשורות למשתמש
    // לדוגמה:
    // const userPosts = await ctx.db
    //   .query('posts')
    //   .withIndex('by_user', (q) => q.eq('userId', userId))
    //   .collect();
    // for (const post of userPosts) {
    //   await ctx.db.delete(post._id);
    //   deletedCount += 1;
    // }

    // מחיקת המשתמש מטבלת המשתמשים
    // הערה: Convex Auth מנהל את טבלת המשתמשים, אך אנחנו יכולים למחוק את הרשומה
    const user = await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('_id'), userId))
      .first();

    if (user) {
      await ctx.db.delete(user._id);
      deletedCount += 1;
    }

    return {
      success: true,
      message: `נמחקו ${deletedCount} רשומות עבור משתמש ${userId}`,
      deletedCount,
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
    profileColor: v.optional(v.string()),
    familyContacts: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('לא מחובר');

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.fullName !== undefined) patch.fullName = args.fullName;
    if (args.profileColor !== undefined) patch.profileColor = args.profileColor;

    // FIXED: retroactive phone-based family member matching when contacts are saved
    // Handles the case where the invited user already had a Convex account when added.
    // Uses by_phone index — O(1) per family member, no table scan needed here.
    if (args.familyContacts !== undefined) {
      if (Array.isArray(args.familyContacts)) {
        const resolved = await Promise.all(
          (args.familyContacts as FamilyContactEntry[]).map(async (entry) => {
            if (entry.matchedUserId) return entry; // already matched — do not overwrite
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
        patch.familyContacts = resolved;
      } else {
        patch.familyContacts = args.familyContacts;
      }
    }

    await ctx.db.patch(userId, patch);

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
      console.log('[PROFILE SYNC] resolveMySpaceId result:', spaceId, 'contacts count:', resolvedContacts.length);
      if (spaceId) {
        // Fetch all current members rows for this space to detect existing phone entries
        const existingMembers = await ctx.db
          .query('members')
          .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
          .collect();

        // FIXED: kind: 'entity' stamped on all family member inserts and updates
        // (rows without kind field are handled by resolveKind() for backward-compat)
        const now = Date.now();
        // Track which entity row _ids were touched so orphaned rows can be deleted below.
        const touchedEntityIds = new Set<string>();

        for (const contact of resolvedContacts) {
          const isManual = !contact.selectedPhoneNumber;
          console.log('[PROFILE SYNC] processing contact:', contact.name, 'isManual:', isManual);

          if (isManual) {
            // Manual member — no phone, dedup by displayName within this space.
            const existing = existingMembers.find(
              (m) => !m.selectedPhoneNumber && m.displayName === contact.name
            );
            console.log('[PROFILE SYNC] manual member existing row:', existing?._id ?? 'none');
            if (existing) {
              await ctx.db.patch(existing._id, {
                kind: 'entity', // stamp kind on pre-existing rows opportunistically
                displayName: contact.name ?? existing.displayName,
                color: contact.color ?? existing.color,
              });
              touchedEntityIds.add(existing._id);
            } else {
              const newId = await ctx.db.insert('members', {
                spaceId,
                role: 'member',
                kind: 'entity',
                joinedAt: now,
                displayName: contact.name,
                color: contact.color,
                inviteStatus: 'none',
              });
              touchedEntityIds.add(newId);
            }
            continue;
          }

          // Contact-sourced member — dedup by normalized phone.
          // FIXED: הפוך לאיש קשר now patches existing member row, no duplicate created.
          // A manual member (no phone) converted to contact-sourced has the same displayName
          // but no selectedPhoneNumber. Without the displayName fallback, the phone search
          // misses it and ctx.db.insert creates a second row.
          const normalizedPhone = normalizeToE164(contact.selectedPhoneNumber as string);
          if (!normalizedPhone) continue;
          const matchedId = contact.matchedUserId as Id<'users'> | undefined;

          const existingByPhone = existingMembers.find(
            (m) => m.selectedPhoneNumber === normalizedPhone
          );
          // Fallback: find existing manual row with the same name (no phone yet)
          const existingByName = !existingByPhone
            ? existingMembers.find(
                (m) =>
                  (m.kind === 'entity' || (m.kind === undefined && m.displayName)) &&
                  !m.selectedPhoneNumber &&
                  m.displayName === contact.name
              )
            : undefined;
          const existing = existingByPhone ?? existingByName;

          if (existing) {
            await ctx.db.patch(existing._id, {
              kind: 'entity', // stamp kind on pre-existing rows opportunistically
              selectedPhoneNumber: normalizedPhone,
              inviteStatus: contact.inviteStatus ?? existing.inviteStatus,
              matchedUserId: matchedId ?? existing.matchedUserId,
              userId: matchedId ?? existing.userId,
              displayName: contact.name ?? existing.displayName,
              color: contact.color ?? existing.color,
            });
            touchedEntityIds.add(existing._id);
          } else {
            const newId = await ctx.db.insert('members', {
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
            touchedEntityIds.add(newId);
          }
        }

        // Delete entity rows no longer in familyContacts — propagates deletes to all
        // family members in real-time. Only removes kind='entity' rows (never access rows).
        for (const m of existingMembers) {
          const isEntityRow =
            m.kind === 'entity' ||
            (m.kind === undefined && m.role === 'member' && Boolean(m.displayName));
          if (isEntityRow && !touchedEntityIds.has(m._id)) {
            await ctx.db.delete(m._id);
          }
        }
      }
    }
  },
});

// סטטוס המשתמש הנוכחי: האם יש פרופיל, האם האונבורדינג הושלם
// משמש לניתוב פוסט-אימות — מחזיר null כשלא מחובר (caller משתמש ב-'skip')
export const getCurrentUserStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) {
      return { hasProfile: false, onboardingComplete: false };
    }

    return {
      hasProfile: true,
      onboardingComplete: user.onboardingCompleted === true,
    };
  },
});
