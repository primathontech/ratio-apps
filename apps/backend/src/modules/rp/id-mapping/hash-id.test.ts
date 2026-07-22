import { describe, it, expect } from 'vitest';
import { hashId } from './hash-id';

describe('hashId', () => {
  it('returns "0" for an empty value', () => {
    expect(hashId('')).toBe('0');
  });

  it('passes a small positive integer through unchanged', () => {
    expect(hashId('12345')).toBe('12345');
  });

  it('is deterministic — the same UUID always hashes to the same number', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(hashId(uuid)).toBe(hashId(uuid));
  });

  it('reduces a large numeric string (bigger than MAX_SAFE_INTEGER) via modulo', () => {
    const big = '99999999999999999999999999';
    const result = hashId(big);
    expect(Number(result)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(Number(result)).toBeGreaterThan(0);
  });

  it('reduces a UUID to a positive number within the safe integer range', () => {
    const result = hashId('17720223476919127');
    expect(Number.isInteger(Number(result))).toBe(true);
    expect(Number(result)).toBeGreaterThan(0);
    expect(Number(result)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it('different real ids generally hash to different numbers', () => {
    expect(hashId('17720223476919127')).not.toBe(hashId('17720225894304237'));
  });
});
