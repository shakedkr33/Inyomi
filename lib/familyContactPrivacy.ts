/**
 * Removes the legacy device-contact email field from family profile payloads.
 *
 * Family profile records still use an open JSON shape for backward
 * compatibility, so this helper deliberately preserves every unrelated field.
 * It is non-mutating: historical records remain unchanged until an authorized
 * create/update flow writes a sanitized familyContacts array.
 */
export function removeContactEmail<T>(entry: T): T {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return entry;
  }

  const { email: _discardedContactEmail, ...rest } = entry as Record<
    string,
    unknown
  >;
  return rest as T;
}

export function removeContactEmails<T>(entries: readonly T[]): T[] {
  return entries.map(removeContactEmail);
}
