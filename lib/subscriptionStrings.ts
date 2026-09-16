// ============================================================================
// InYomi Together paywall — translation-ready string keys
// ============================================================================
//
// No app-wide i18n library exists yet in this project. This module is the
// minimal seam that lets the paywall be translated later WITHOUT rewriting
// app/(authenticated)/subscription.tsx: every user-facing string used by
// that screen is a key in this object, never inlined in the component.
//
// Future i18n: replace this static object with a function that resolves
// each key from a translation catalog (e.g. `t('subscription.title')`),
// keeping the same key names so the paywall component requires no changes.
//
// "InYomi Together" is a brand name and intentionally stays untranslated.

export const SUBSCRIPTION_STRINGS = {
  // Header / hero
  backButtonLabel: 'חזרה',
  title: 'InYomi Together',

  // Benefits — exact approved copy, do not alter wording
  benefit1: 'עד 6 בני משפחה במנוי אחד',
  benefit2: 'יומן אישי ומשפחתי, קהילות ומשימות במקום אחד',
  benefit3: 'תזכורות לכל הדברים החשובים',
  benefit4: 'זימון משתתפים לאירוע ללא צורך בכתובות אימייל',
  benefit5: 'יצירת קהילות ללא הגבלה',

  // Billing toggle pill
  monthlyPillLabel: 'חודשי',
  annualPillLabel: 'שנתי',

  // Annual — eligible (launch pricing) state
  launchPricePrefix: 'מחיר השקה',
  discountSuffix: 'הנחה',
  firstYear: 'בשנה הראשונה',
  approxPrefix: 'כ־',
  perMonthFamilyAnnual: 'לחודש',
  perYear: 'לשנה',
  renewalDisclosure: 'המנוי מתחדש אוטומטית לאחר שנה במחיר הרגיל',

  // Monthly state
  flexibleMonthly: 'מנוי חודשי גמיש — ביטול בכל עת',

  // CTA
  cta: 'המשך עם InYomi Together',

  // Secondary actions
  couponQuestion: 'יש קוד קופון?',
  continueFree: 'להמשיך בחינם – קהילות בלבד',

  // Footer
  restore: 'שחזור',
  terms: 'תנאים',
  privacy: 'פרטיות',

  // Loading / unavailable states
  loading: 'טוען...',
  unavailableTitle: 'לא ניתן לטעון את המחירים כרגע',
  unavailableRetry: 'ניסיון חוזר',

  // Alerts
  restoreSuccessTitle: 'הצלחה',
  restoreSuccessBody: 'הרכישות שוחזרו בהצלחה! 🎉',
  restoreNoneTitle: 'שחזור',
  restoreNoneBody: 'לא נמצאו רכישות קודמות.',
  restoreErrorTitle: 'שגיאה',
  restoreErrorBody: 'שחזור הרכישות נכשל. אנא נסה שוב.',
  purchaseErrorTitle: 'שגיאה',
  purchaseErrorBody: 'הרכישה נכשלה. אנא נסה שוב.',
  purchaseSuccessTitle: 'הצלחה',
  purchaseSuccessBody: 'הרכישה הושלמה בהצלחה! 🎉',
  confirmLabel: 'אישור',
} as const;

export type SubscriptionStringKey = keyof typeof SUBSCRIPTION_STRINGS;
