type InitialsSource = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  name?: string | null;
};

// Accepts either a plain display-name string (new callers) or the legacy
// InitialsSource object shape (MainScreenHeader, profile, family-profile).
export function getAvatarInitials(input: string | InitialsSource): string {
  if (typeof input === 'string') {
    const name = input.trim();
    if (!name) return '';
    const firstWord = name.split(/\s+/)[0] ?? '';
    const chars = Array.from(firstWord); // Unicode-safe Hebrew slicing
    return (chars[0] ?? '') + (chars[1] ?? '');
  }

  // Legacy: object with firstName / lastName / fullName / name
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (firstName && lastName) {
    return (Array.from(firstName)[0] ?? '') + (Array.from(lastName)[0] ?? '');
  }
  const displayName = input.fullName?.trim() || input.name?.trim() || '';
  return getAvatarInitials(displayName);
}

// ============================================================================
// getSelfProfileAvatarInitials — Stage 2B+3 QA fix
// ============================================================================
//
// The authenticated user's OWN profile avatar must never show
// placeholder-derived initials (e.g. "הפ" from the "הפרופיל שלך" fallback
// label, or "המ" from a "המשתמש שלי" fallback label). It must show:
//   - NO initials at all before a non-empty, trimmed first name exists
//     (the color circle renders with no letters inside it)
//   - real initials derived ONLY from the entered first/last name once a
//     first name exists
//
// This intentionally does NOT accept a `fullName`/`name`/placeholder-label
// fallback like the legacy object shape above — that fallback is exactly
// what produced the placeholder-initials bug. Nickname is never used to
// derive initials.
// ============================================================================
export function getSelfProfileAvatarInitials(input: {
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const firstName = input.firstName?.trim() ?? '';
  if (!firstName) return '';

  const lastName = input.lastName?.trim() ?? '';
  if (lastName) {
    return (Array.from(firstName)[0] ?? '') + (Array.from(lastName)[0] ?? '');
  }

  const chars = Array.from(firstName); // Unicode-safe Hebrew slicing
  return (chars[0] ?? '') + (chars[1] ?? '');
}
