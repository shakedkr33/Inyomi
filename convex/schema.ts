import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  ...authTables,

  // ═══════════════════════════════════════════════════════
  // טבלת משתמשים
  // ═══════════════════════════════════════════════════════
  users: defineTable({
    // Phone auth — primary identifier
    phone: v.optional(v.string()), // E.164 format, e.g. +972501234567
    // Email retained as optional for backwards-compatibility and future use
    email: v.optional(v.string()),
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
    // FIXED: family profile persistence — stores onboarding family contacts as JSON blob
    familyContacts: v.optional(v.any()),
    /** Optional post-auth profile setup was completed */
    profileSetupCompletedAt: v.optional(v.number()),
    /** Post-auth optional family setup was skipped; prevents nag on every launch */
    familySetupSkippedAt: v.optional(v.number()),
    // undefined = true (push enabled by default)
    pushNotificationsEnabled: v.optional(v.boolean()),
  })
    .index('by_email', ['email'])
    .index('by_phone', ['phone'])
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
    userId: v.optional(v.id('users')), // optional: pending invited contacts have no userId yet
    spaceId: v.id('spaces'),
    role: v.union(v.literal('admin'), v.literal('member')),
    displayName: v.optional(v.string()),
    color: v.optional(v.string()),
    joinedAt: v.number(),
    // ── Row-type discriminator ────────────────────────────────────────────────
    // 'access' — authenticated user who owns or was granted access to the space
    // 'entity' — visible family entity (contact placeholder, child, pet)
    // Rows without this field: infer via resolveKind() in convex/members.ts
    // FIXED: kind discriminator added to separate access rows from entity rows
    kind: v.optional(v.union(v.literal('access'), v.literal('entity'))),
    // ── Family invite tracking (additive, all optional) ──────────────────────
    selectedPhoneNumber: v.optional(v.string()),
    matchedUserId: v.optional(v.id('users')),
    inviteStatus: v.optional(
      v.union(v.literal('none'), v.literal('invited'), v.literal('joined'))
    ),
    // ── Profile type: distinguishes pets from people in entity rows ───────────
    // Absent on rows created before this field was added; treat absent as 'person'.
    memberType: v.optional(v.union(v.literal('person'), v.literal('pet'))),
  })
    .index('by_space', ['spaceId'])
    .index('by_user', ['userId'])
    .index('by_kind', ['spaceId', 'kind'])
    .index('by_phone', ['selectedPhoneNumber']),

  // ═══════════════════════════════════════════════════════
  // טבלת אירועים
  // ═══════════════════════════════════════════════════════
  events: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(), // Unix timestamp (ms)
    endTime: v.number(), // Unix timestamp (ms)
    spaceId: v.optional(v.id('spaces')),
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
    locationUrl: v.optional(v.string()), // Google Maps / Waze link
    onlineUrl: v.optional(v.string()), // Zoom / Meet link
    // TODO: migrate groupId → communityId (groupId was v.optional(v.id('spaces')))
    sharedWithUserIds: v.optional(v.array(v.id('users'))), // משתמשים מוזמנים
    // FIXED: added allFamily and sharedWithFamilyMemberIds to events schema
    allFamily: v.optional(v.boolean()), // true → shared with all family members
    sharedWithFamilyMemberIds: v.optional(v.array(v.string())), // entity row IDs of selected family members
    communityId: v.optional(v.id('communities')),
    tasksVisibleToParticipants: v.optional(v.boolean()),
    requiresRsvp: v.optional(v.boolean()), // האם האירוע דורש אישור השתתפות
    status: v.optional(v.union(v.literal('active'), v.literal('cancelled'))),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id('users')),
    cancelReason: v.optional(v.string()),
    // ── FIX C: soft Community-display removal (early "אירועים שבוטלו" hide) ──
    // Set only via events.removeCancelledCommunityEvent (never a hard delete —
    // see that mutation's doc comment). Additive/optional so existing events
    // require no migration; absence is equivalent to "not removed". Named to
    // match the existing cancelledAt/cancelledBy/cancelReason convention.
    removedFromCommunityAt: v.optional(v.number()),
    // Persisted reminder offsets in minutes before event start (e.g. 0, 60, 1440)
    reminders: v.optional(v.array(v.number())),
    // FIXED: file attachments for personal events (hard cap of 2 enforced in mutations)
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          originalName: v.string(),
          displayName: v.string(),
          mimeType: v.string(),
          sizeBytes: v.number(),
          uploadedAt: v.number(),
          uploadedBy: v.id('users'),
        })
      )
    ),
    importantItems: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
        })
      )
    ),
    // ── Birthday relation (optional, set on creation only) ────────────────────
    relatedType: v.optional(v.literal('birthday')),
    relatedBirthdayId: v.optional(v.string()),
    relatedBirthdayName: v.optional(v.string()),
    // ── Soft delete ──────────────────────────────────────────────────────────
    deletedAt: v.optional(v.number()), // ms timestamp when soft-deleted
    deleteExpiresAt: v.optional(v.number()), // ms timestamp after which hard-delete is safe
    deletedBy: v.optional(v.id('users')), // user who performed the soft delete
    // ── External calendar copy metadata (all optional — no migration required) ─
    // Populated only when source = 'google_copy' or 'device_copy'.
    // Absent on all existing events; absence is equivalent to source = 'manual'.
    source: v.optional(
      v.union(
        v.literal('manual'),
        v.literal('google_copy'),
        v.literal('device_copy')
      )
    ),
    // Canonical duplicate-prevention key.
    // Google format: "google:{calendarId}:{eventId}"
    // Device format: "device:{calendarId}:{eventId}"
    externalId: v.optional(v.string()),
    // Source calendar identifier (e.g. Google calendar ID or email).
    externalCalendarId: v.optional(v.string()),
    // Source provider event or instance identifier (e.g. Google event id).
    externalEventId: v.optional(v.string()),
    // iCalendar UID from the source provider — for recurring-event diagnosis.
    externalICalUID: v.optional(v.string()),
    // Normalized start-time key for recurring-instance / exception identification.
    // Exact mapping from Google fields is deferred to the copy implementation.
    externalOriginalStartKey: v.optional(v.string()),
  })
    .index('by_space_and_time', ['spaceId', 'startTime'])
    .index('by_creator', ['createdBy'])
    .index('by_space', ['spaceId'])
    .index('by_community_date', ['communityId', 'startTime'])
    // FIX C.2 — bounded retrieval of RECENT cancellations for Community
    // Main's "מה חשוב עכשיו" (see events.listRecentCancelledCommunityEvents).
    // Deliberately separate from `by_community_date` (which is keyed on
    // `startTime` and scoped to UPCOMING events only, per
    // listCommunityMainOverview's existing bounding contract) — a
    // cancelled event's relevant recency signal is `cancelledAt`, not its
    // (possibly already-past) `startTime`, so widening/overloading the
    // existing index would not work here.
    .index('by_community_cancelled_at', ['communityId', 'cancelledAt'])
    .index('by_related_birthday', ['relatedBirthdayId'])
    .index('by_deleted_by', ['deletedBy', 'deletedAt'])
    .index('by_external_id', ['externalId']),

  // ═══════════════════════════════════════════════════════
  // טבלת משימות
  // ═══════════════════════════════════════════════════════
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.optional(v.number()), // null = ללא תאריך (undated task)
    completed: v.boolean(), // החליף את status
    spaceId: v.optional(v.id('spaces')),
    assignedTo: v.optional(v.id('users')),
    assignedToMemberId: v.optional(v.id('members')),
    assignedToUserIds: v.optional(v.array(v.id('users'))),
    assignedToMemberIds: v.optional(v.array(v.id('members'))),
    category: v.optional(v.string()),
    hasTime: v.optional(v.boolean()),
    dueAt: v.optional(v.number()),
    reminderType: v.optional(
      v.union(
        v.literal('none'),
        v.literal('morning'),
        v.literal('evening'),
        v.literal('at_time'),
        v.literal('hour_before'),
        v.literal('custom')
      )
    ),
    customReminderAt: v.optional(v.number()),
    reminders: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.union(
            v.literal('morning'),
            v.literal('evening'),
            v.literal('at_time'),
            v.literal('hour_before'),
            v.literal('custom')
          ),
          customAmount: v.optional(v.number()),
          customUnit: v.optional(
            v.union(v.literal('minutes'), v.literal('hours'), v.literal('days'))
          ),
          customReminderAt: v.optional(v.number()),
          label: v.optional(v.string()),
        })
      )
    ),
    recurrenceType: v.optional(
      v.union(
        v.literal('none'),
        v.literal('daily'),
        v.literal('weekly'),
        v.literal('specific_days')
      )
    ),
    selectedWeekdays: v.optional(v.array(v.number())),
    subtasks: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          completed: v.boolean(),
          image: v.optional(
            v.object({
              storageId: v.id('_storage'),
              mimeType: v.string(),
              sizeBytes: v.number(),
              createdAt: v.number(),
            })
          ),
          attachment: v.optional(
            v.object({
              id: v.string(),
              type: v.union(v.literal('image'), v.literal('file')),
              storageId: v.id('_storage'),
              mimeType: v.string(),
              sizeBytes: v.number(),
              createdAt: v.number(),
              originalName: v.optional(v.string()),
              displayName: v.optional(v.string()),
            })
          ),
        })
      )
    ),
    allowParticipantEditing: v.optional(v.boolean()),
    // Same shape as events.attachments (uploadedBy/uploadedAt stamped in mutations)
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          originalName: v.string(),
          displayName: v.string(),
          mimeType: v.string(),
          sizeBytes: v.number(),
          uploadedAt: v.number(),
          uploadedBy: v.id('users'),
        })
      )
    ),
    archivedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    isAiGenerated: v.boolean(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    communityId: v.optional(v.id('communities')), // קהילה שאליה שייכת המשימה
    completedAt: v.optional(v.number()), // חותמת זמן השלמה (לצורך היסטוריה)
    sourceType: v.optional(
      v.union(
        v.literal('community_event_important_item'),
        v.literal('community_event_important_items_bundle')
      )
    ),
    sourceEventId: v.optional(v.id('events')),
    sourceImportantItemId: v.optional(v.string()),
    // ── Birthday relation (optional, set on creation only) ────────────────────
    relatedType: v.optional(v.literal('birthday')),
    relatedBirthdayId: v.optional(v.string()),
    relatedBirthdayName: v.optional(v.string()),
    // ── Soft delete (MVP) ─────────────────────────────────────────────────────
    deletedAt: v.optional(v.number()), // ms timestamp when soft-deleted
    deleteExpiresAt: v.optional(v.number()), // ms timestamp after which hard-delete is safe
    deletedBy: v.optional(v.id('users')), // user who performed the soft delete
  })
    .index('by_space_completed', ['spaceId', 'completed'])
    .index('by_assigned', ['assignedTo'])
    .index('by_creator', ['createdBy'])
    .index('by_space', ['spaceId'])
    .index('by_community', ['communityId'])
    .index('by_assigned_source_event', ['assignedTo', 'sourceEventId'])
    .index('by_deleted_by', ['deletedBy', 'deletedAt'])
    .index('by_related_birthday', ['relatedBirthdayId'])
    // DATE-BOUNDED community-reminder retrieval (final architecture — replaces
    // the removed `by_community_assigned` index, which bounded rows by
    // "reminder shape" only, never by date, so it still grew with total
    // community-reminder history). `assignedTo` is undefined for every
    // general community reminder and set for essentially everything else
    // that shares a `communityId` (see convex/tasks.ts
    // `syncCommunityEventImportantItemTasks`, which always sets
    // `assignedTo: userId`) — so `.eq('communityId', id).eq('assignedTo',
    // undefined)` narrows straight to the reminder-shaped subset, and the
    // trailing range field (`dueAt` / `dueDate`) then bounds that subset to
    // the caller's requested date window, so DB reads grow with
    // (memberships × date-range activity), never with total historical
    // community-reminder volume. Two separate indexes exist because `dueAt`
    // (exact timed reminders) and `dueDate` (date-only reminders) are
    // different fields with different semantics — see convex/tasks.ts
    // `listVisibleCommunityRemindersForRange` /
    // `loadGeneralCommunityRemindersInRange` for the two range queries that
    // use these indexes and the merge/dedup step that follows.
    .index('by_community_assigned_dueAt', [
      'communityId',
      'assignedTo',
      'dueAt',
    ])
    .index('by_community_assigned_dueDate', [
      'communityId',
      'assignedTo',
      'dueDate',
    ]),

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
  // משימות אירוע (checklist קולבורטיבי באירוע)
  // ═══════════════════════════════════════════════════════
  eventTasks: defineTable({
    eventId: v.id('events'),
    title: v.string(),
    completed: v.boolean(),
    completedAt: v.optional(v.number()),
    order: v.optional(v.number()),
    assignedToUserId: v.optional(v.id('users')),
    assignedToManual: v.optional(v.string()),
    assignedByUserId: v.optional(v.id('users')),
    assignedAt: v.optional(v.number()),
    // ── Backwards-compatibility only ──────────────────────────────────────
    // These fields exist on documents created during the removed Sprint 4
    // pending-assignment experiment. The product logic no longer reads or
    // writes them; they are listed here solely so Convex schema validation
    // does not reject existing rows.
    assignmentStatus: v.optional(
      v.union(v.literal('pending'), v.literal('accepted'))
    ),
    respondedAt: v.optional(v.number()),
  })
    .index('by_event', ['eventId'])
    .index('by_event_order', ['eventId', 'order']),

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
  })
    .index('by_event_user', ['eventId', 'userId'])
    .index('by_user', ['userId']),

  // ═══════════════════════════════════════════════════════
  // אירועי קהילה פתוחים — שמירה אישית ליומן / בית (למשתמש בלבד)
  // ═══════════════════════════════════════════════════════
  savedCommunityEvents: defineTable({
    userId: v.id('users'),
    eventId: v.id('events'),
    communityId: v.id('communities'),
    createdAt: v.number(),
    removedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_event', ['userId', 'eventId'])
    .index('by_event', ['eventId']),

  /** הסרה ידנית מיומן אישי כשעדיין קיים RSVP yes (אירוע עבר ממצב RSVP לפתוח) */
  communityEventPersonalCalendarOptOuts: defineTable({
    userId: v.id('users'),
    eventId: v.id('events'),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_event', ['userId', 'eventId']),

  // ═══════════════════════════════════════════════════════
  // הסרת אירוע אישי מהיומן — למוזמנים בלבד (opt-out per invitee)
  // ═══════════════════════════════════════════════════════
  personalEventCalendarOptOuts: defineTable({
    eventId: v.id('events'),
    userId: v.id('users'),
    createdAt: v.number(),
    /** 'declined' — invitee RSVP'd no; 'cancelled' — creator cancelled the event */
    reason: v.union(v.literal('declined'), v.literal('cancelled')),
  })
    .index('by_user_event', ['userId', 'eventId'])
    .index('by_event_user', ['eventId', 'userId']),

  // ═══════════════════════════════════════════════════════
  // טבלת מצב רוח יומי
  // ═══════════════════════════════════════════════════════
  dailyMoods: defineTable({
    userId: v.id('users'),
    date: v.string(), // YYYY-MM-DD
    moodValue: v.number(), // 0–4
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_user_date', ['userId', 'date']),

  // ═══════════════════════════════════════════════════════
  // טבלת מנויים
  // ═══════════════════════════════════════════════════════
  subscriptions: defineTable({
    userId: v.id('users'),
    plan: v.union(v.literal('free'), v.literal('plus'), v.literal('family')),
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
    productId: v.optional(v.string()), // מזהה מוצר ב-RevenueCat
    expiresAt: v.optional(v.number()), // null = חינמי / ללא תפוגה
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  // ═══════════════════════════════════════════════════════
  // קהילות (גן, בית-ספר, חוג, משפחה, עבודה, אישי, אחר)
  // ═══════════════════════════════════════════════════════
  communities: defineTable({
    name: v.string(),
    description: v.optional(v.string()), // תיאור קצר (חדש)
    ownerId: v.id('users'),
    spaceId: v.optional(v.id('spaces')), // optional – לא תמיד משויך ל-space
    category: v.optional(
      v.union(
        v.literal('school'),
        v.literal('kindergarten'),
        v.literal('club'),
        v.literal('family'),
        v.literal('work'),
        v.literal('personal'),
        v.literal('other')
      )
    ),
    tags: v.optional(v.array(v.string())),
    color: v.optional(v.string()),
    inviteCode: v.string(),
    createdAt: v.number(),
    archived: v.optional(v.boolean()),
    pinnedByUserIds: v.optional(v.array(v.id('users'))), // deprecated – use communityMembers.pinned
    /** Join via invite link: manual = admin approval required; automatic = immediate (default if unset). */
    joinApprovalMode: v.optional(
      v.union(v.literal('manual'), v.literal('automatic'))
    ),
  })
    .index('by_owner', ['ownerId'])
    .index('by_space', ['spaceId'])
    .index('by_invite_code', ['inviteCode']),

  // ═══════════════════════════════════════════════════════
  // חברות של משתמשים בקהילות
  // ═══════════════════════════════════════════════════════
  communityMembers: defineTable({
    communityId: v.id('communities'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
    pinned: v.boolean(),
    notificationsEnabled: v.boolean(),
    joinedAt: v.number(),
    status: v.optional(
      v.union(v.literal('active'), v.literal('left'), v.literal('pending'))
    ),
    /** Last time the user opened this community detail (for "new events" hints on the list). */
    lastViewedAt: v.optional(v.number()),
    // undefined = false (no auto-add)
    autoAddEventsToCalendar: v.optional(v.boolean()),
    // FIX 9: Family profiles associated with this community for this user.
    // Entity row IDs from the members table. Used for Calendar profile filtering.
    // undefined or [] = no profile association (backward compatible).
    associatedProfileIds: v.optional(v.array(v.id('members'))),
  })
    .index('by_community', ['communityId'])
    .index('by_user', ['userId'])
    .index('by_community_user', ['communityId', 'userId']),

  // ═══════════════════════════════════════════════════════
  // פעילות אוטומטית בקהילה
  // ═══════════════════════════════════════════════════════
  communityActivities: defineTable({
    communityId: v.id('communities'),
    actorUserId: v.optional(v.id('users')),
    type: v.union(
      v.literal('event_created'),
      v.literal('event_updated'),
      v.literal('event_cancelled'),
      v.literal('reminder_created'),
      v.literal('task_assigned'),
      v.literal('task_completed'),
      v.literal('member_joined'),
      v.literal('community_updated')
    ),
    entityType: v.optional(
      v.union(
        v.literal('event'),
        v.literal('reminder'),
        v.literal('task'),
        v.literal('community'),
        v.literal('member')
      )
    ),
    entityId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_community_createdAt', ['communityId', 'createdAt'])
    .index('by_entity', ['entityType', 'entityId']),

  // ═══════════════════════════════════════════════════════
  // שיתוף אירועים אישיים — קישורי שיתוף
  // FIXED: one active link per event (enforced in createShareLink mutation)
  // ═══════════════════════════════════════════════════════
  shareLinks: defineTable({
    eventId: v.id('events'),
    token: v.string(), // random 24-char alphanumeric — same pattern as communities.inviteCode
    createdBy: v.id('users'), // event owner
    revoked: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_event', ['eventId'])
    .index('by_creator', ['createdBy']),

  // ═══════════════════════════════════════════════════════
  // שיתוף אירועים אישיים — אירועים מקושרים (ביומן הנמען)
  // FIXED: snapshot used only for sourceStatus='deleted'; live data read from source otherwise
  // ═══════════════════════════════════════════════════════
  linkedEvents: defineTable({
    sourceEventId: v.id('events'),
    shareToken: v.string(),
    savedByUserId: v.id('users'), // recipient — internal only, never exposed to owner
    ownerUserId: v.id('users'), // event owner — stamped at save time
    spaceId: v.id('spaces'), // recipient's own space

    // patched by deleteEvent / cancelEvent mutations
    sourceStatus: v.union(
      v.literal('active'),
      v.literal('deleted'),
      v.literal('cancelled')
    ),

    // snapshot — populated at save time
    // used ONLY when sourceStatus = 'deleted' (tombstone fallback)
    // when active or cancelled, display data is read live from the source event
    snapshotTitle: v.string(),
    snapshotStartTime: v.number(),
    snapshotEndTime: v.number(),
    snapshotLocation: v.optional(v.string()),

    savedAt: v.number(),
  })
    .index('by_recipient', ['savedByUserId'])
    .index('by_recipient_and_source', ['savedByUserId', 'sourceEventId'])
    .index('by_source', ['sourceEventId'])
    .index('by_space', ['spaceId']),

  // ═══════════════════════════════════════════════════════
  // הגדרות אישיות של משתתף במשימה משותפת
  // מאחסן תזכורות אישיות וסטטוס עזיבה לכל משתתף
  // ═══════════════════════════════════════════════════════
  taskParticipantSettings: defineTable({
    taskId: v.id('tasks'),
    userId: v.id('users'),
    reminderType: v.optional(
      v.union(
        v.literal('none'),
        v.literal('morning'),
        v.literal('evening'),
        v.literal('at_time'),
        v.literal('hour_before'),
        v.literal('custom')
      )
    ),
    customReminderAt: v.optional(v.number()),
    reminders: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.union(
            v.literal('morning'),
            v.literal('evening'),
            v.literal('at_time'),
            v.literal('hour_before'),
            v.literal('custom')
          ),
          customAmount: v.optional(v.number()),
          customUnit: v.optional(
            v.union(v.literal('minutes'), v.literal('hours'), v.literal('days'))
          ),
          customReminderAt: v.optional(v.number()),
          label: v.optional(v.string()),
        })
      )
    ),
    leftAt: v.optional(v.number()),
    // Personal completion timestamp for general community reminders.
    // Present → this user has personally completed this reminder.
    // Absent → this user considers it open.
    // Never set for non-general-reminder tasks (personal/assigned tasks use tasks.completed).
    completedAt: v.optional(v.number()),
    // Personal "hide from my personal space" timestamp for general community
    // reminders (Home/Calendar only — see convex/taskUtils.ts
    // `isCommunityReminderPersonallyHidden`). Present → this user has hidden
    // this reminder from their own Home/Calendar. Absent → not personally
    // hidden via this field (legacy `completedAt` is still checked
    // separately for backward compatibility — see taskUtils.ts).
    // NEVER hides the reminder from Community Main / Community Reminders —
    // the community remains the source of truth for shared content.
    // Never set for non-general-reminder tasks.
    dismissedAt: v.optional(v.number()),
  })
    // No new index added for dismissedAt: dismissal lookups reuse the
    // existing by_task_user (single-row read/write) and by_user (bulk
    // viewer-scoped scan in listVisibleCommunityRemindersForRange) indexes —
    // the same access pattern already used for completedAt. There is no
    // access pattern that queries dismissedAt independently of a specific
    // (taskId, userId) pair or the viewer's own by_user scan, so no
    // additional index is justified.
    .index('by_task_user', ['taskId', 'userId'])
    .index('by_task', ['taskId'])
    .index('by_user', ['userId']),

  // ═══════════════════════════════════════════════════════
  // מצב ייבוא Google Calendar חד-פעמי
  // ═══════════════════════════════════════════════════════
  googleImportStatus: defineTable({
    userId: v.id('users'),
    provider: v.string(), // 'google'
    completedAt: v.number(),
    importedCount: v.number(),
  }).index('by_user_provider', ['userId', 'provider']),

  // ═══════════════════════════════════════════════════════
  // לדג העתקות חיצוניות — מניעת כפילויות לצמיתות
  // רשומה נוצרת פעם אחת בעת העתקה ונשארת גם לאחר מחיקת האירוע המקושר.
  // שאילתת כפילות: by_owner_external_id(createdBy, externalId)
  // ═══════════════════════════════════════════════════════
  eventCopyRegistry: defineTable({
    // The authenticated InYomi user who performed the copy.
    // Deduplication is scoped per-user: the same Google event copied by
    // two different users produces two independent registry records.
    createdBy: v.id('users'),
    // The user's space at copy time — stored for query convenience but not
    // used as the dedup scope (createdBy is the canonical owner key).
    spaceId: v.optional(v.id('spaces')),

    // Copy provider — registry records are never created for manual events.
    source: v.union(v.literal('google_copy'), v.literal('device_copy')),

    // Canonical duplicate-prevention key (required).
    // Google format: "google:{calendarId}:{eventId}"
    // Device format: "device:{calendarId}:{eventId}"
    // Future copy mutation queries this field via by_owner_external_id before
    // inserting any event. If a record exists the source event is skipped,
    // even if lastLinkedEventId is absent (i.e. the InYomi event was deleted).
    externalId: v.string(),

    // Source calendar identifier (e.g. Google calendar ID / email).
    externalCalendarId: v.optional(v.string()),
    // Source provider event or instance identifier.
    externalEventId: v.optional(v.string()),
    // iCalendar UID from source — retained for recurring-event diagnosis.
    externalICalUID: v.optional(v.string()),
    // Normalized start-time key for recurring-instance identification.
    externalOriginalStartKey: v.optional(v.string()),

    // Unix ms timestamp of the first successful copy.
    firstCopiedAt: v.number(),
    // Convex ID of the InYomi event created during the copy.
    // Optional: the InYomi event may be soft-deleted or hard-deleted later
    // while this registry record persists, enforcing the no-re-copy policy.
    lastLinkedEventId: v.optional(v.id('events')),
  })
    // Primary dedup lookup: is this externalId already copied by this user?
    .index('by_owner_external_id', ['createdBy', 'externalId']),

  // ═══════════════════════════════════════════════════════
  // Push notification tokens per device
  // ═══════════════════════════════════════════════════════
  pushTokens: defineTable({
    userId: v.id('users'),
    token: v.string(), // Expo push token (ExponentPushToken[xxx])
    platform: v.union(v.literal('ios'), v.literal('android')),
    deviceId: v.optional(v.string()),
    isActive: v.boolean(), // false when DeviceNotRegistered
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_token', ['token']),

  // ═══════════════════════════════════════════════════════
  // Single source of truth — user's community calendar
  // ═══════════════════════════════════════════════════════
  userCalendarEntries: defineTable({
    userId: v.id('users'),
    eventId: v.id('events'),
    communityId: v.id('communities'),
    source: v.union(
      v.literal('auto_add'),
      v.literal('manual_add'),
      v.literal('rsvp_yes'),
      v.literal('rsvp_maybe')
    ),
    status: v.union(v.literal('active'), v.literal('removed')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user_event', ['userId', 'eventId'])
    .index('by_event', ['eventId'])
    .index('by_user', ['userId'])
    .index('by_user_community', ['userId', 'communityId']),

  // ═══════════════════════════════════════════════════════
  // Convex scheduled function IDs for cancellable reminders
  // ═══════════════════════════════════════════════════════
  scheduledReminders: defineTable({
    eventId: v.optional(v.id('events')),
    taskId: v.optional(v.id('tasks')),
    userId: v.id('users'),
    scheduledFunctionId: v.id('_scheduled_functions'),
    reminderKey: v.string(), // e.g. "30min_before", "24h_rsvp"
    scheduledFor: v.number(), // epoch ms
    status: v.union(
      v.literal('pending'),
      v.literal('sent'),
      v.literal('canceled')
    ),
    createdAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_task', ['taskId'])
    .index('by_task_user', ['taskId', 'userId'])
    .index('by_event_user', ['eventId', 'userId'])
    .index('by_status', ['status']),

  // ═══════════════════════════════════════════════════════
  // In-app notification inbox (user-facing bell drawer)
  // Written synchronously by business mutations for ALL
  // intended recipients, independent of push opt-out state.
  // ═══════════════════════════════════════════════════════
  userNotifications: defineTable({
    recipientUserId: v.id('users'),
    pushType: v.string(),
    title: v.string(),
    body: v.string(),
    screen: v.string(),
    readAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_recipient_created', ['recipientUserId', 'createdAt']),

  // ═══════════════════════════════════════════════════════
  // Audit trail for push notification debugging
  // ═══════════════════════════════════════════════════════
  notificationLog: defineTable({
    recipientUserId: v.id('users'),
    pushType: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
    status: v.union(
      v.literal('sent'),
      v.literal('skipped'),
      v.literal('failed')
    ),
    skipReason: v.optional(v.string()), // "no_token" | "notifications_disabled" | ...
    expoReceiptId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_recipient', ['recipientUserId'])
    .index('by_push_type', ['pushType'])
    .index('by_created', ['createdAt']),
});
