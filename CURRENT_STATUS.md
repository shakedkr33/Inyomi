# מצב נוכחי

תאריך עדכון: **2026-09-11**. ענף: `develop`. 3 commits מקומיים שטרם נדחפו (כולל FIX 9).

## סיכום — מצב Community Event Tasks

עבודת ייצוב זרימות משימות אירוע קהילה הושלמה בשני commits:

1. **`bf49eb3`** — `fix(community): stabilize event task flows`
   כולל: שיוך/הסרת שיוך, לקיחה מרצון, lifecycle, Home/Calendar task views,
   important items bundle duplicate fix, assignment diff helpers, save error
   handling, community task CTA, Android bottom sheet overlap fix.

2. **`3d82864`** — `feat(community): support event task reordering`
   כולל: FIX 8C — drag & drop reorder, `eventTasks:reorder` mutation,
   order reconciliation, pure manager-check extraction.

**בדיקות אוטומטיות:** 708/708 עברו (`bun test`, 31 קבצים).
**בדיקה ידנית:** 8 תרחישים אושרו — פירוט ב־[QA_CHECKLIST.md](QA_CHECKLIST.md).

## מה הושלם

| תחום | פריט | סטטוס | QA |
|---|---|---|---|
| משימות | Task CTA ב־Community Main — פתיחת Bottom Sheet | מומש | ✅ אושר ידנית |
| משימות | לקיחה ("אני אקח") וביטול ("ביטול הקצאה") | מומש | ✅ אושר ידנית |
| משימות | lifecycle — חסימת claim/unclaim אחרי שעת סיום | מומש | ✅ אושר ידנית |
| משימות | FIX 8C — סידור מחדש (drag & drop) | מומש | ✅ אושר ידנית |
| UI | Android Bottom Sheet — תיקון חפיפה עם navigation | מומש | ✅ אושר ידנית ב־Android |
| Home | EventTasksAccordion — הצגת unassigned + assigned to me | מומש | ✅ אושר ידנית |
| Calendar | Timeline + Monthly — משימות משויכות למשתמש הנוכחי | מומש | ✅ אושר ידנית |
| Home | Important Items bundle duplicate fix | מומש | ✅ אושר ידנית |
| משימות | הסרת שיוך — מסלול הצלחה רגיל (QA-02A) | מומש | ✅ אושר ידנית (מהודעת המשך קודמת) |
| משימות | כשל שמירת שיוך קהילתי (QA-02B) | מומש — Alert + retry | בדיקות אוטומטיות עברו; ❌ מכשיר לא נבדק |
| ניווט | מסך פרטים מלא — כניסות מ־Home/Calendar/Community/deep link | מומש | בדיקות אוטומטיות חלקיות; מכשיר לא נבדק מלא |
| תוכן | שיתוף, קבצים, תאריך עברי | מומש | מכשיר לא נבדק |
| Push | תשתית + הודעת ביטול אירוע | מימוש חלקי | מכשיר לא נבדק; מפרט מחזור חיים חסר |
| יומן | הוספה/הסרה אישית, אוטומציה לכל קהילה | מומש | מכשיר לא נבדק |
| RSVP | פירוט ו"טרם ענו", תופעות לוואי בשיוך | מומש | מכשיר לא נבדק; החלטות מוצר RSVP side-effects ממתינות |
| אירועים | ביטול, הסרה קהילתית, חלון 24 שעות | מומש | מכשיר לא נבדק |
| הצמדה | Community pinning (`togglePinned`, sorting) | מומש | ❌ מכשיר לא נבדק |
| Important Items | compact chip באירוע, "מה חשוב עכשיו" כקטע נפרד | מומש — כרטיס אירוע מציג `📌 חשוב לזכור · {count}` בלבד | לא נבדק ידנית באופן ייעודי |

## FIX 9 — שיוך Community ↔ Family/Profile + סינון Calendar

**סטטוס: מומש והושלם.** כולל את FIX 9 FOLLOW-UP (canonical Self profile)
ואת FIX 9 FINAL UX FOLLOW-UP (הצגה ויזואלית של Self ללא כתיבה).

**מומש:**
- שיוך Community ↔ Profile **per user / per community**, נשמר ב־
  `communityMembers.associatedProfileIds` (`convex/schema.ts`,
  `convex/communities.ts`: `setCommunityProfileAssociation`,
  `getMyProfileAssociations`).
- "שיוך לפרופיל משפחה" — פריט תפריט זהה בתוך הקהילה
  (`community/[id].tsx`) ובכרטיס Community הראשי (`communities.tsx`),
  שניהם פותחים את אותו `components/ProfileAssociationSheet.tsx` ומול אותו
  מקור אמת בשרת.
- ברירת מחדל ל-Self כשאין שיוך מפורש — לצורך סינון בלבד, ללא כתיבה,
  ללא migration (`lib/calendarProfileFilter.ts`:
  `isCommunityEventRelevantToProfile`).
- ייצוג Self קנוני אחד למנהל/ת ולחבר/ת משפחה שהצטרף/ה
  (`lib/canonicalFamilyMembers.ts` + `convex/members.ts`:
  `listMyFamilyContacts`).
- הצגה ויזואלית של Self כ"נבחר" ב-Bottom Sheet כשאין שיוך מפורש, בלי כתיבה
  בפועל (`isProfileVisuallySelectedInAssociationSheet`,
  `computeAssociationToggleResult` ב־`lib/calendarProfileFilter.ts`) —
  המשפט ההסברי הישן הוסר.
- Calendar: carousel פרופילים ב־Timeline (שורה משותפת עם אייקון הסינון
  הקיים), וב־Month — רק בתוך ה־Calendar Filter Bottom Sheet (אין carousel
  נוסף בשורת ניווט החודש). בחירה בודדת (single-select), מתמידה בין
  Timeline↔Month באותו session (`app/(authenticated)/calendar.tsx`).
- מדרג נעילה למשתמשי free/community-only: "סינון לפי בני משפחה" /
  "זמין במנוי" (ללא אזכור trial), ללא מחיקת שיוכים קיימים כשה-entitlement
  יורד.
- כפתור "הצג הכל" — מנקה `selectedProfileId` ומאפס את שכבות הסינון
  (`SHOW_ALL_CALENDAR_LAYER_FILTERS` ב־
  `lib/storage/calendarLayerFilterPreferences.ts`), ללא שינוי context
  ניווט של communityId.
- אינדיקטור עדין על אייקון הסינון כשתוכן היומן מוגבל בפועל (לא רק כשיש
  בחירת פרופיל).
- סדר קנוני לכל carousel של פרופילים: contact/linked → manual → pet,
  RTL, ללא מיון אלפביתי (`getSelectableProfiles`).
- `ProfileAvatarCircle` — שימוש חוזר בזהות הוויזואלית הקיימת (צבע + עיגול
  + initials/pet icon), בלי העלאת תמונה.

**בדיקות אוטומטיות:** 781/781 עברו (`bun test`, 33 קבצים, 1212 expect calls),
כולל `tests/convex/canonicalFamilyMembers.test.ts` ו־
`tests/convex/calendarProfileFilter.test.ts`.

**בדיקה ידנית (אושר ע"י בעלות המוצר):** שיוך קהילה משני נקודות הכניסה,
עקביות מצב מנוהל אחד, פתרון תקלת dynamic-import בשמירה, יציבות ה-Bottom
Sheet (אין double-open/jump, אין replay של אנימציית הכניסה), multi-select,
auto-save, הסרת spinner, styling נבחר ברור, סדר contact→manual→pet ב-RTL,
שם הקהילה מוצג ב-Sheet, התנהגות Self המשתמעת נכונה; פרופיל מנהל/ת קנוני
ופרופיל חבר/ת משפחה שהצטרף/ה נבדקו עם משתמש מאומת שני והתנהגות Community
ו-Calendar נמצאה תקינה (לאחר עדכון build Android שהיה לא מסונכרן).

**נותר ממתין (לא הוסק, לא סומן כעבור):** תרחישי iPhone/Android פרטניים
נוספים שלא צוינו במפורש כאושרו — ראו [QA_CHECKLIST.md](QA_CHECKLIST.md).

**מודל משפחה (רקע):**
טבלת `members` אחת עם:
- `kind: 'access'|'entity'` — מבדיל בין משתמש מחובר לישות משפחתית
- `memberType: 'person'|'pet'` — מבדיל בין אנשים לחיות מחמד
- חיות מחמד ובני משפחה **חולקים מודל אחד** (אותה טבלה)
- שדות: `displayName`, `color`, `spaceId`
- אין שדה photo/avatar כרגע

## עבודה שנותרה — Communities

### FIX 6 — כינוי בקהילה (Community Nickname)

**סטטוס: לא מומש.**
לא נמצא `communityNickname` בקוד.
רצוי: שדה per-user/per-community עם fallback ל־`users.fullName`.
משפיע על: רשימת חברים, RSVP, משימות, שיוך, ניהול.

### FIX 7 — תמונת נושא לאירוע קהילה (Cover/Flyer)

**סטטוס: לא מומש.**
לא נמצא `coverImage`/`flyerImage` בקוד.
רצוי: שדה ייעודי אחד, לא שימוש אוטומטי בקבצים מצורפים.
צריך: הוספה, החלפה, הסרה, תצוגה בולטת בפרטי אירוע מלאים.

### צבעי קהילות — יישור חסר

**סטטוס: נדרש יישור ממוקד.**

שתי מערכות צבע קיימות:
- `theme/colors.ts` — `primary: '#00668E'` (צבע מותג קנוני), `legacyBlue: '#36a9e2'` מסומן deprecated
- `constants/theme.ts` — `primary: '#55C0FB'` (legacy bright blue)

מסך הקהילה (`community/[id].tsx`) עדיין משתמש ב־`#36a9e2` ישירות.
יישור נדרש לאלמנטים ראשיים: tabs פעילים, task CTA, כוכב "מה חשוב עכשיו", פעולות ראשיות.
**אין** לבצע search/replace גלובלי — חלק מהרקעים הכחולים הבהירים מכוונים.

### הצמדה (Pinning)

**סטטוס: מומש בקוד.** `communityMembers.pinned`, `togglePinned` mutation, מיון pinned-first.
לא נמצא באג קונקרטי. דורש QA ידני בלבד.

### Important Items Presentation

**סטטוס: כרטיס אירוע כבר מציג compact chip** (`📌 חשוב לזכור · {count}`) ולא רשימה מלאה.
"מה חשוב עכשיו" כקטע נפרד עם קבוצות. ניראה תואם לכוונה המוצרית.
Event Details שומר ניהול/רשימה מלאה.

### תאריך בכרטיס אירוע מבוטל ב־Home

**סטטוס: שיפור לאחר השקה.** לא חסם.

## סיכונים ובדיקות ממתינות

1. **RSVP side-effects** — שני מסלולים (שיוך מנהל vs. לקיחה מרצון) כותבים RSVP `yes` בתנאים שונים. אישור מוצרי לא סופק — ראו [DECISIONS.md](DECISIONS.md).
2. **Push notification lifecycle** — מפרט מחייב לא אותר; תשתית חלקית קיימת.
3. **Google Calendar import meeting links** — קישורי Meet/Zoom/Teams לא עוברים בנתיב הנוכחי.
4. **מנויים (RevenueCat)** — קוד קיים; מוכנות מסחרית לא אומתה.
5. **בדיקות מכשיר ממתינות** — ראו סטטוס QA בכל שורה בטבלה למעלה.

## הצעד הבא

FIX 9 הושלם (מומש, בדיקות אוטומטיות עברו, QA ידני אושר — ראו מעלה).
הצעדים הבאים בתור: **FIX 6** (כינוי בקהילה) ו־**FIX 7** (תמונת נושא) —
שניהם לא מומשו עדיין, ראו "עבודה שנותרה — Communities" מעלה.
