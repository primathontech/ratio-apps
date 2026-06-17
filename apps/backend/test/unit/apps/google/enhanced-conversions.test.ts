import { describe, it, expect } from 'vitest';
import {
  buildUserData,
  sha256,
} from '../../../../src/modules/google/sdk/enhanced-conversions';

describe('sha256', () => {
  it('produces lowercase hex matching the known digest of test@example.com', () => {
    const digest = sha256('test@example.com');
    expect(digest).toBe(
      '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b',
    );
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildUserData', () => {
  it('trims + lowercases email before hashing', () => {
    const result = buildUserData({ email: '  TEST@Example.COM ' });
    expect(result.email).toBe(sha256('test@example.com'));
  });

  it('trims + lowercases names before hashing', () => {
    const result = buildUserData({ firstName: '  Ada ', lastName: 'LOVELACE' });
    expect(result.first_name).toBe(sha256('ada'));
    expect(result.last_name).toBe(sha256('lovelace'));
  });

  it('normalizes phone to E.164-ish digits then hashes under phone_number', () => {
    const result = buildUserData({ phone: '+1 (415) 555-0000' });
    expect(result.phone_number).toBe(sha256('+14155550000'));
  });

  it('keeps country plaintext, uppercased ISO alpha-2', () => {
    const result = buildUserData({ country: 'in' });
    expect(result.country).toBe('IN');
  });

  it('hashes address fields under their gtag keys', () => {
    const result = buildUserData({
      street: ' 123 Main St ',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
    });
    expect(result.street).toBe(sha256('123 main st'));
    expect(result.city).toBe(sha256('austin'));
    expect(result.region).toBe(sha256('tx'));
    expect(result.postal_code).toBe(sha256('78701'));
  });

  it('omits absent fields entirely', () => {
    const result = buildUserData({ email: 'a@b.com' });
    expect(result).not.toHaveProperty('phone_number');
    expect(result).not.toHaveProperty('first_name');
    expect(result).not.toHaveProperty('country');
    expect(Object.keys(result)).toEqual(['email']);
  });

  it('omits empty-string and whitespace-only fields', () => {
    const result = buildUserData({ email: '', phone: '   ', firstName: '' });
    expect(result).toEqual({});
  });

  it('never produces the digest of the empty string for an omitted field', () => {
    const emptyDigest = sha256('');
    const result = buildUserData({ email: 'a@b.com', phone: undefined });
    expect(Object.values(result)).not.toContain(emptyDigest);
    expect(result.phone_number).toBeUndefined();
  });

  it('returns an empty object for empty input', () => {
    expect(buildUserData({})).toEqual({});
  });
});
