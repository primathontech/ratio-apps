import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../../../../src/modules/loyalty/common/normalize-phone';

describe('normalizePhone', () => {
  it('normalizes bare 10-digit numbers to E.164', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('passes through already-E.164 numbers', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
  });

  it('handles 91-prefixed and 0-prefixed forms', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('strips spaces, dashes, dots and parentheses', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(0)98765.43210')).toBe('+919876543210');
  });

  it('rejects too-short, too-long, alpha, and non-mobile prefixes', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('987654321012345')).toBeNull();
    expect(normalizePhone('98765abcde')).toBeNull();
    expect(normalizePhone('1234567890')).toBeNull(); // starts with 1 — not an Indian mobile
    expect(normalizePhone('')).toBeNull();
  });
});
