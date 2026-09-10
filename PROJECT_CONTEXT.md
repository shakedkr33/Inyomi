# InYomi — הקשר הפרויקט

InYomi היא אפליקציה לניהול חיים אישיים ומשפחתיים, בעברית וב־RTL. קהל היעד: הורים עסוקים המתאמים ילדים, הודעות ממסגרות, תורים, משימות בית ויומנים. המטרה: להפחית עומס מנטלי.

## Tech Stack

אומת ב־`package.json`:
- React Native `0.81.5`, React `19.1.0`
- Expo `~54.0.36`, Expo Router `~6.0.24`
- TypeScript `~5.9.3`
- Convex `^1.31.0` + Convex Auth
- NativeWind (Tailwind for RN)
- Expo Notifications
- RevenueCat (`react-native-purchases` + `react-native-purchases-ui`)

Package manager: **Bun** (עדיפות). `bun.lock` + `package-lock.json` קיימים.

## מפת קוד

| אחריות | מקורות |
|---|---|
| אתחול, ספקים, אימות | `app/_layout.tsx`, `app/(auth)/`, `app/(authenticated)/_layout.tsx`, `convex/auth.ts` |
| Home | `app/(authenticated)/index.tsx` |
| Calendar | `app/(authenticated)/calendar.tsx` |
| Community Main | `app/(authenticated)/community/[id].tsx` |
| Event Details (קנוני) | `app/(authenticated)/event/[id].tsx` |
| Deep link entry | `app/e/[eventId].tsx` |
| טופס יצירה/עריכה | `lib/components/event/EventScreen.tsx`, `event/new.tsx`, `event-edit/[id].tsx` |
| Backend core | `convex/schema.ts`, `events.ts`, `eventTasks.ts`, `eventRsvps.ts` |
| Calendar state | `convex/communityCalendarState.ts`, `communityEventCalendar.ts` |
| חברות/הרשאות | `convex/communityMemberUtils.ts`, `communities.ts`, `events.ts`, `eventTasks.ts` |
| Push | `convex/pushTokens.ts`, `pushNotifications.ts`, `userNotifications.ts`, `reminderScheduler.ts` |
| מנויים | `contexts/RevenueCatContext.tsx`, `hooks/useEffectiveAccess.ts`, `app/(authenticated)/subscription.tsx` |
| Google Import | `app/(authenticated)/import-calendar.tsx` → `lib/services/googleCalendarEvents.ts` → `convex/googleImport.ts` |
| Theme (canonical) | `theme/colors.ts` — primary: `#00668E` |
| Theme (legacy) | `constants/theme.ts` — primary: `#55C0FB` (ישן, לא מיושר) |
| Helpers | `lib/eventTaskAssignmentDiff.ts`, `lib/eventTasksSummary.ts`, `lib/communityTaskAssignmentSave.ts`, `lib/eventTaskOrderReconcile.ts`, `lib/calendarProfileFilter.ts`, `lib/canonicalFamilyMembers.ts` |
| Community ↔ Profile association | `convex/communities.ts` (`setCommunityProfileAssociation`, `getMyProfileAssociations`), `components/ProfileAssociationSheet.tsx`, `components/ProfileAvatarCircle.tsx` |
| Tests | `tests/convex/*.test.ts` — 33 קבצים, 781 tests |

## מודל משפחה/פרופילים

טבלת `members` אחת משרתת גם access וגם entities:

| שדה | תפקיד |
|---|---|
| `kind` | `'access'` = משתמש מחובר; `'entity'` = ישות משפחתית (ילד, חיית מחמד, איש קשר) |
| `memberType` | `'person'` \| `'pet'` — מבדיל בין אנשים לחיות |
| `displayName` | שם תצוגה |
| `color` | צבע פרופיל |
| `spaceId` | שייכות ל־space משפחתי |

אין שדה photo/avatar כרגע. חיות מחמד ובני משפחה חולקים מודל אחד.

## צבעים — שתי מערכות

| קובץ | Primary | הערה |
|---|---|---|
| `theme/colors.ts` | `#00668E` | **קנוני** — `legacyBlue: '#36a9e2'` מסומן deprecated |
| `constants/theme.ts` | `#55C0FB` | Legacy — לא מיושר |

מסך הקהילה עדיין משתמש ב־`#36a9e2` ישירות.
יישור ממוקד נדרש — ראו [CURRENT_STATUS.md](CURRENT_STATUS.md).

## כללי ניווט

מסמך זה מספק **הקשר יציב ומפה**. למצב עדכני:

1. [CURRENT_STATUS.md](CURRENT_STATUS.md) — מצב מימוש, עבודה שנותרה, סיכונים
2. [DECISIONS.md](DECISIONS.md) — החלטות מוצר מאושרות
3. [QA_CHECKLIST.md](QA_CHECKLIST.md) — תוצאות בדיקה ותרחישים ממתינים
4. [AGENTS.md](AGENTS.md) — כללי הנדסה וסוכנים (read-only)

`docs/CURSOR_CONTEXT.md` כולל הקשר היסטורי מפברואר 2026 שסותר בחלקו את ההיקף הנוכחי.
`docs/README.md` מתאר תבנית, לא את המוצר הפעיל.
