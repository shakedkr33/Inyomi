/**
 * holidayCategoryDefinitions — shared display metadata for InYomi holiday
 * product categories (HolidayCategoryId).
 *
 * Single source of truth for the label/subtitle copy shown wherever a user
 * chooses which holiday categories to enable — currently the standalone
 * holiday-overlay settings screen and the holiday-selection step of the
 * Google Calendar import flow. Keeping this list in one place prevents the
 * two surfaces from drifting apart.
 *
 * Display order here is the fixed, intentional order for both surfaces.
 */

import type { HolidayCategoryId } from '../types/holidayOverlay';

export type HolidayCategoryDefinition = {
  id: HolidayCategoryId;
  label: string;
  subtitle?: string;
};

export const HOLIDAY_CATEGORY_DEFINITIONS: readonly HolidayCategoryDefinition[] =
  [
    {
      id: 'jewish_holidays',
      label: 'חגים ומועדים יהודיים',
      subtitle: 'פסח, סוכות, ראש השנה וחנוכה',
    },
    {
      id: 'israeli_national_days',
      label: 'ימים לאומיים בישראל',
      subtitle: 'יום השואה, יום הזיכרון, יום העצמאות ויום ירושלים',
    },
    {
      id: 'fast_days',
      label: 'צומות',
      subtitle: 'תשעה באב, י״ז בתמוז וצום גדליה',
    },
    {
      id: 'rosh_chodesh',
      label: 'ראשי חודשים',
    },
  ];
