import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  ...authTables,

  // ═══════════════════════════════════════════════════════
  // טבלת משתמשים
  // ═══════════════════════════════════════════════════════
  users: defineTable({
    email: v.string(),
    emailVerified: v.optional(v.boolean()),
    fullName: v.optional(v.string()),
    profileColor: v.optional(v.string()),
    role: v.union(v.literal('admin'), v.literal('user')),
    userType: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    tokenIdentifier: v.optional(v.string()),
    // MVP additions
    onboardingCompleted: v.optional(v.boolean()),
    defaultSpaceId: v.optional(v.id('spaces')),
  })
    .index('by_email', ['email'])
    .index('by_role', ['role']),

  // ═══════════════════════════════════════════════════════
  // טבלת משפחות/יומנים (Spaces = Families/Calendars)
  // ═══════════════════════════════════════════════════════
  spaces: defineTable({
    name: v.string(),
    type: v.union(
      v.literal('personal'),
      v.literal('couple'),
      v.literal('family'),
      v.literal('business')
    ),
    ownerId: v.id('users'),
    onboardingChallenges: v.optional(v.array(v.string())),
    primarySources: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index('by_owner', ['ownerId']),

  // ═══════════════════════════════════════════════════════
  // טבלת חברי משפחה (Members = Family Members)
  // ═══════════════════════════════════════════════════════
  members: defineTable({
    userId: v.id('users'),
    spaceId: v.id('spaces'),
    role: v.union(v.literal('admin'), v.literal('member')),
    displayName: v.optional(v.string()),
    color: v.optional(v.string()),
    joinedAt: v.number(),
  })
    .index('by_space', ['spaceId'])
    .index('by_user', ['userId']),

  // ═══════════════════════════════════════════════════════
  // טבלת אירועים
  // ═══════════════════════════════════════════════════════
  events: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),         // Unix timestamp (ms)
    endTime: v.number(),           // Unix timestamp (ms)
    spaceId: v.id('spaces'),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    participants: v.optional(v.array(v.string())),
    isRecurring: v.optional(v.boolean()),
    recurringPattern: v.optional(v.string()),
    isAiGenerated: v.boolean(),
    captureId: v.optional(v.id('captures')),
    createdBy: v.id('users'),
    createdAt: v.number(),
    // MVP additions
    allDay: v.optional(v.boolean()),
    locationUrl: v.optional(v.string()),   // Google Maps / Waze link
    onlineUrl: v.optional(v.string()),     // Zoom / Meet link
    groupId: v.optional(v.id('spaces')),  // קהילה ששיתפה את האירוע
    sharedWithUserIds: v.optional(v.array(v.id('users'))), // משתמשים מוזמנים
    // אופציונלי: אם האירוע שייך לקהילה
    // TODO: לסנן/לקבץ לפי קהילה במסכים מאוחר יותר
    communityId: v.optional(v.id('communities')),
  })
    .index('by_space_and_time', ['spaceId', 'startTime'])
    .index('by_creator', ['createdBy'])
    .index('by_space', ['spaceId']),

  // ═══════════════════════════════════════════════════════
  // טבלת משימות
  // ═══════════════════════════════════════════════════════
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.optional(v.number()), // null = ללא תאריך (undated task)
    completed: v.boolean(),          // החליף את status
    spaceId: v.id('spaces'),
    assignedTo: v.optional(v.id('users')),
    category: v.optional(v.string()),
    isAiGenerated: v.boolean(),
    createdBy: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_space_completed', ['spaceId', 'completed'])
    .index('by_assigned', ['assignedTo'])
    .index('by_space', ['spaceId']),

  // ═══════════════════════════════════════════════════════
  // טבלת ימי הולדת
  // ═══════════════════════════════════════════════════════
  birthdays: defineTable({
    name: v.string(),
    date: v.string(), // YYYY-MM-DD
    spaceId: v.id('spaces'),
    userId: v.optional(v.id('users')),
    imageUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_space', ['spaceId'])
    .index('by_date', ['date'])
    .index('by_user', ['userId']),

  // ═══════════════════════════════════════════════════════
  // טבלת לכידות AI (Captures)
  // ═══════════════════════════════════════════════════════
  captures: defineTable({
    userId: v.id('users'),
    spaceId: v.id('spaces'),
    type: v.union(
      v.literal('text'),
      v.literal('image'),
      v.literal('voice'),
      v.literal('screenshot')
    ),
    rawContent: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('processing'),
      v.literal('completed'),
      v.literal('failed')
    ),
    processedData: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_space_pending', ['spaceId', 'status'])
    .index('by_user', ['userId'])
    .index('by_space', ['spaceId']),

  // ═══════════════════════════════════════════════════════
  // טבלת RSVP לאירועים
  // ═══════════════════════════════════════════════════════
  eventRsvps: defineTable({
    eventId: v.id('events'),
    userId: v.id('users'),
    status: v.union(
      v.literal('yes'),
      v.literal('no'),
      v.literal('maybe'),
      v.literal('none')
    ),
    updatedAt: v.number(),
  }).index('by_event_user', ['eventId', 'userId']),

  // ═══════════════════════════════════════════════════════
  // טבלת מצב רוח יומי
  // ═══════════════════════════════════════════════════════
  dailyMoods: defineTable({
    userId: v.id('users'),
    date: v.string(),              // YYYY-MM-DD
    moodValue: v.number(),         // 0–4
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_user_date', ['userId', 'date']),

  // ═══════════════════════════════════════════════════════
  // טבלת מנויים
  // ═══════════════════════════════════════════════════════
  subscriptions: defineTable({
    userId: v.id('users'),
    plan: v.union(
      v.literal('free'),
      v.literal('plus'),
      v.literal('family')
    ),
    status: v.union(
      v.literal('active'),
      v.literal('trial'),
      v.literal('expired'),
      v.literal('cancelled')
    ),
    source: v.union(
      v.literal('apple'),
      v.literal('google'),
      v.literal('stripe'),
      v.literal('demo')
    ),
    productId: v.optional(v.string()),  // מזהה מוצר ב-RevenueCat
    expiresAt: v.optional(v.number()),  // null = חינמי / ללא תפוגה
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  // ═══════════════════════════════════════════════════════
  // מייצגת קהילה חיצונית – גן / כיתה / שכונה
  // ═══════════════════════════════════════════════════════
  communities: defineTable({
    ownerId: v.id('users'),
    spaceId: v.id('spaces'),
    name: v.string(),
    description: v.string(),
    avatarColor: v.string(),
    inviteCode: v.string(),
    createdAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_inviteCode', ['inviteCode']),

  // ═══════════════════════════════════════════════════════
  // חברות של משתמשים בקהילות
  // ═══════════════════════════════════════════════════════
  communityMembers: defineTable({
    communityId: v.id('communities'),
    userId: v.id('users'),
    spaceId: v.id('spaces'),
    role: v.string(),
    createdAt: v.number(),
  })
    .index('by_community', ['communityId'])
    .index('by_user', ['userId']),
});
