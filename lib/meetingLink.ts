export const INVALID_MEETING_LINK = 'יש להזין קישור תקין';

/** Validate without serializing the URL: invitation paths/tokens stay verbatim. */
export function normalizeMeetingLink(value: string): string | null {
  const text = value.trim();
  if (
    !text ||
    /[\s\\]/.test(text) ||
    [...text].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  )
    return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text);
  if (hasScheme && !/^https?:\/\/[^/?#]/i.test(text)) return null;
  if (/%(?![a-f\d]{2})/i.test(text)) return null;
  const candidate = hasScheme ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const host = url.hostname.replace(/\.$/, '');
    if (
      !host.includes('.') ||
      host
        .split('.')
        .some((label) => !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))
    )
      return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Injectable native opener; a pending operation ignores repeated taps. */
export function createMeetingLinkOpener(
  openURL: (url: string) => Promise<unknown>,
  showError: (message: string) => void
) {
  let pending = false;
  return async (value: string): Promise<void> => {
    if (pending) return;
    const url = normalizeMeetingLink(value);
    if (!url) {
      showError(INVALID_MEETING_LINK);
      return;
    }
    pending = true;
    try {
      await openURL(url);
    } catch {
      showError('לא ניתן לפתוח את הקישור לפגישה. אפשר לנסות שוב.');
    } finally {
      pending = false;
    }
  };
}
