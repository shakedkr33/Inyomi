import { INVALID_MEETING_LINK, normalizeMeetingLink } from './meetingLink';
import { hasValidCoords } from './utils/geoUri';

export type LocationSource = 'manual' | 'imported' | 'google' | 'unknown';

export interface EventLocationFields {
  location?: string;
  onlineUrl?: string;
  locationUrl?: string;
  locationSource?: LocationSource | null;
  googlePlaceId?: string | null;
}

export function hasPhysicalLocation(
  location?: string | null,
  onlineUrl?: string | null
): boolean {
  return (
    !!location?.trim() &&
    !onlineUrl?.trim() &&
    !/^(?:https?:\/\/|www\.)/i.test(location.trim())
  );
}

/** Omitted fields preserve state; null metadata explicitly clears it over JSON. */
export function normalizeEventLocation(
  input: EventLocationFields,
  existing?: EventLocationFields
) {
  const linkPatch: { onlineUrl?: string; location?: string } = {};
  if (
    input.onlineUrl !== undefined &&
    input.onlineUrl !== existing?.onlineUrl
  ) {
    const normalized = input.onlineUrl.trim()
      ? normalizeMeetingLink(input.onlineUrl)
      : '';
    if (normalized === null) throw new Error(INVALID_MEETING_LINK);
    linkPatch.onlineUrl = normalized;
    if (normalized) linkPatch.location = '';
  }
  if (
    input.location?.trim() &&
    input.location !== existing?.location &&
    !input.onlineUrl?.trim()
  ) {
    linkPatch.onlineUrl = '';
  }
  const location = linkPatch.location ?? input.location ?? existing?.location;
  const onlineUrl =
    linkPatch.onlineUrl ?? input.onlineUrl ?? existing?.onlineUrl;
  const changed =
    (input.location !== undefined &&
      input.location !== (existing?.location ?? '')) ||
    (input.onlineUrl !== undefined &&
      input.onlineUrl !== (existing?.onlineUrl ?? ''));
  const metadataChanged =
    (input.googlePlaceId !== undefined &&
      input.googlePlaceId !== existing?.googlePlaceId) ||
    (input.locationSource !== undefined &&
      input.locationSource !== existing?.locationSource);
  if (
    existing &&
    !changed &&
    !metadataChanged &&
    (input.locationUrl === undefined ||
      input.locationUrl === (existing.locationUrl ?? ''))
  ) {
    return {
      ...linkPatch,
      locationSource: existing.locationSource ?? undefined,
      googlePlaceId: existing.googlePlaceId ?? undefined,
      locationUrl: existing.locationUrl,
    };
  }
  if (!hasPhysicalLocation(location, onlineUrl)) {
    return {
      ...linkPatch,
      locationSource: undefined,
      googlePlaceId: undefined,
      locationUrl: '',
    };
  }
  const source =
    input.locationSource === null
      ? undefined
      : (input.locationSource ??
        (changed ? undefined : existing?.locationSource) ??
        undefined);
  const placeId =
    input.googlePlaceId === null
      ? undefined
      : (input.googlePlaceId ??
        (changed ? undefined : existing?.googlePlaceId) ??
        undefined);
  if (
    input.googlePlaceId &&
    (!/^[A-Za-z0-9_-]{1,512}$/.test(input.googlePlaceId) || source !== 'google')
  ) {
    throw new Error('Invalid event place ID');
  }
  return {
    ...linkPatch,
    locationSource: input.locationSource === null ? undefined : source,
    googlePlaceId: source === 'google' ? placeId : undefined,
    // Coordinates are compatibility-only: never introduce or copy them.
    locationUrl: '',
  };
}

export function eventNavigationUrl(
  app: 'google' | 'waze',
  location: string | null,
  googlePlaceId?: string,
  latitude?: number,
  longitude?: number
): string | null {
  if (!hasPhysicalLocation(location)) return null;
  const text = encodeURIComponent(location?.trim() ?? '');
  if (googlePlaceId) {
    return app === 'google'
      ? `https://www.google.com/maps/search/?api=1&query=${text}&query_place_id=${encodeURIComponent(googlePlaceId)}`
      : `https://waze.com/ul?q=${text}&navigate=yes`;
  }
  if (hasValidCoords(latitude, longitude)) {
    return app === 'google'
      ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
      : `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
  }
  return app === 'google'
    ? `https://www.google.com/maps/search/?api=1&query=${text}`
    : `https://waze.com/ul?q=${text}&navigate=yes`;
}
