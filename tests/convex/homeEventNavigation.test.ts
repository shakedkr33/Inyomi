/**
 * BUG FIX (manual QA) — Home community-event card missing the
 * navigation/directions action for an all-day event with a valid selected
 * address. Root cause: HomeDailyCommandCenter's compact card only showed
 * its "ניווט" pill for `temporalState === 'upcoming'`, but all-day events
 * are classified 'active' for their ENTIRE local calendar day and are
 * ALWAYS rendered via the compact card (never promoted to the "featured"
 * card the way an active TIMED event is) — so the pill never appeared for
 * a today all-day event, regardless of how valid its selected location
 * was. See lib/homeEventNavigation.ts for the extracted pure fix.
 */

import { describe, expect, it } from 'bun:test';
import {
  hasNavigableEventLocation,
  isHomeCompactNavButtonVisible,
} from '../../lib/homeEventNavigation';

describe('hasNavigableEventLocation — canonical predicate', () => {
  it('a valid canonical selected location (geo: URI + non-empty address) is navigable', () => {
    expect(hasNavigableEventLocation('רחוב הרצל 5', 'geo:32.08,34.78')).toBe(
      true
    );
  });

  it('plain free-text addresses are navigable without coordinates', () => {
    expect(hasNavigableEventLocation('רחוב הרצל 5', undefined)).toBe(true);
  });

  it('empty address text is NOT navigable even with a geo URI present', () => {
    expect(hasNavigableEventLocation('   ', 'geo:32.08,34.78')).toBe(false);
  });

  it('a legacy non-geo hint does not prevent address-based navigation', () => {
    expect(
      hasNavigableEventLocation('רחוב הרצל 5', 'https://maps.google.com/x')
    ).toBe(true);
  });
});

describe('isHomeCompactNavButtonVisible — BUG FIX (manual QA)', () => {
  const validLocation = {
    location: 'רחוב הרצל 5, תל אביב',
    locationUrl: 'geo:32.08,34.78',
  };

  it('valid canonical selected location + upcoming event → navigation available', () => {
    expect(
      isHomeCompactNavButtonVisible({
        itemType: 'event',
        temporalState: 'upcoming',
        ...validLocation,
      })
    ).toBe(true);
  });

  it('same location + temporalState "active" (all-day today) → navigation still available', () => {
    expect(
      isHomeCompactNavButtonVisible({
        itemType: 'event',
        temporalState: 'active',
        ...validLocation,
      })
    ).toBe(true);
  });

  it('missing location → navigation unavailable', () => {
    expect(
      isHomeCompactNavButtonVisible({
        itemType: 'event',
        temporalState: 'upcoming',
        location: '',
        locationUrl: undefined,
      })
    ).toBe(false);
  });

  it('timed event with valid location and temporalState "upcoming" → existing behavior unchanged', () => {
    expect(
      isHomeCompactNavButtonVisible({
        itemType: 'event',
        temporalState: 'upcoming',
        ...validLocation,
      })
    ).toBe(true);
  });

  it('ended event → navigation unavailable regardless of location', () => {
    expect(
      isHomeCompactNavButtonVisible({
        itemType: 'event',
        temporalState: 'ended',
        ...validLocation,
      })
    ).toBe(false);
  });

  it('tasks never show the navigation action, even with a location-shaped value', () => {
    expect(
      isHomeCompactNavButtonVisible({
        itemType: 'task',
        temporalState: 'upcoming',
        ...validLocation,
      })
    ).toBe(false);
  });
});
