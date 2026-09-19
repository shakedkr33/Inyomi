/**
 * resolveAuthorizeOptions.test.ts
 *
 * Real (non-source-inspection) unit coverage for the pure option-defaulting
 * logic used by expo-google-calendar-auth's authorizeGoogleCalendar().
 * Covers:
 *   8. forceAccountSelection defaults to false when omitted / undefined.
 *   9. forceAccountSelection: true is passed through correctly.
 *
 * Run with: bun test modules/expo-google-calendar-auth/src/__tests__/resolveAuthorizeOptions.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { resolveAuthorizeOptions } from '../resolveAuthorizeOptions';

describe('resolveAuthorizeOptions — forceAccountSelection defaulting', () => {
  it('defaults forceAccountSelection to false when no options are passed', () => {
    const resolved = resolveAuthorizeOptions(undefined);
    expect(resolved).toEqual({ forceAccountSelection: false });
  });

  it('defaults forceAccountSelection to false when options omit the field', () => {
    const resolved = resolveAuthorizeOptions({});
    expect(resolved).toEqual({ forceAccountSelection: false });
  });

  it('defaults forceAccountSelection to false when explicitly undefined', () => {
    const resolved = resolveAuthorizeOptions({
      forceAccountSelection: undefined,
    });
    expect(resolved).toEqual({ forceAccountSelection: false });
  });

  it('passes through forceAccountSelection: true correctly (never silently drops it)', () => {
    const resolved = resolveAuthorizeOptions({ forceAccountSelection: true });
    expect(resolved).toEqual({ forceAccountSelection: true });
  });

  it('passes through forceAccountSelection: false explicitly (no unintended override)', () => {
    const resolved = resolveAuthorizeOptions({ forceAccountSelection: false });
    expect(resolved).toEqual({ forceAccountSelection: false });
  });

  it('always returns a fully-resolved (non-optional) shape', () => {
    const resolved = resolveAuthorizeOptions(undefined);
    expect(Object.keys(resolved)).toEqual(['forceAccountSelection']);
    expect(typeof resolved.forceAccountSelection).toBe('boolean');
  });
});
