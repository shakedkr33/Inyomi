import { hasPhysicalLocation } from './eventLocation';
import { normalizeMeetingLink } from './meetingLink';

/** Coordinates are legacy optional metadata, not navigation eligibility. */
export function hasNavigableEventLocation(
  location: string,
  _locationUrl?: string,
  remoteUrl?: string
): boolean {
  return hasPhysicalLocation(location, remoteUrl);
}

export type HomeCompactNavItemType = 'event' | 'task';
export type HomeCompactNavTemporalState =
  | 'active'
  | 'upcoming'
  | 'ended'
  | 'overdue'
  | 'completed';

/** Preserve active/upcoming event eligibility for the compact location action. */
export function isHomeCompactNavButtonVisible(args: {
  itemType: HomeCompactNavItemType;
  temporalState: HomeCompactNavTemporalState;
  location: string;
  locationUrl: string | undefined;
  remoteUrl?: string;
}): boolean {
  if (args.itemType !== 'event') return false;
  if (args.temporalState !== 'upcoming' && args.temporalState !== 'active') {
    return false;
  }
  return args.remoteUrl?.trim()
    ? normalizeMeetingLink(args.remoteUrl) !== null
    : hasNavigableEventLocation(args.location, args.locationUrl);
}
