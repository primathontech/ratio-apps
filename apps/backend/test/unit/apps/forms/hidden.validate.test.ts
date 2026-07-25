import { describe, expect, it } from 'vitest';
import { validateHidden } from '../../../../src/modules/forms/submissions/fields/hidden/validate';
import type { FieldOfType } from '../../../../src/modules/forms/submissions/fields/types';

const field = (extra: Record<string, unknown> = {}): FieldOfType<'hidden'> =>
  ({
    key: 'utm',
    type: 'hidden',
    label: 'UTM source',
    required: false,
    paramName: 'utm_source',
    ...extra,
  }) as FieldOfType<'hidden'>;

describe('validateHidden (server-authoritative resolution)', () => {
  it('accepts a client-captured url_param string (default source)', () => {
    expect(validateHidden(field(), 'newsletter')).toEqual({ value: 'newsletter' });
  });

  it('derives the constant value on the server, ignoring the client-sent value', () => {
    // A crafted POST sends a spoofed value for a constant-source field; the
    // server substitutes the configured constant regardless.
    expect(
      validateHidden(field({ source: 'constant', constantValue: 'promo-x' }), 'spoofed'),
    ).toEqual({ value: 'promo-x' });
  });

  it('falls back to the fallback for a constant source with no constantValue', () => {
    expect(validateHidden(field({ source: 'constant', fallback: 'unknown' }), 'spoofed')).toEqual({
      value: 'unknown',
    });
  });

  it('stamps the server ISO time for the timestamp source, ignoring the client', () => {
    const out = validateHidden(field({ source: 'timestamp' }), 'client-time');
    expect(out.error).toBeUndefined();
    expect(typeof out.value).toBe('string');
    expect(() => new Date(out.value as string).toISOString()).not.toThrow();
    expect(out.value).not.toBe('client-time');
  });

  it('applies the fallback when a captured value is empty', () => {
    expect(validateHidden(field({ fallback: 'organic' }), '')).toEqual({ value: 'organic' });
  });

  it('applies the fallback when the client sent a non-string', () => {
    expect(validateHidden(field({ fallback: 'organic' }), { nested: true })).toEqual({
      value: 'organic',
    });
  });

  it('rejects a non-string with no fallback (preserves prior behavior)', () => {
    expect(validateHidden(field(), { nested: true })).toEqual({
      error: 'Please provide a valid value.',
    });
  });

  it('rejects an over-long client-captured value regardless of client validation', () => {
    const out = validateHidden(field(), 'x'.repeat(2049));
    expect(out.error).toBeDefined();
    expect(out.value).toBeUndefined();
  });
});
