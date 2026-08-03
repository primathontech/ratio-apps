import { describe, expect, it } from 'vitest';
import {
  boundedLevenshtein,
  EMAIL_DOMAIN_RE,
  EMAIL_RE,
  emailDomain,
  isFreeEmailProvider,
  matchesDomain,
  normalizeEmail,
  suggestEmailCorrection,
} from './constants';
import { emailFieldSchema } from './schema';

describe('email constants (zod-free helpers)', () => {
  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('EMAIL_RE requires a ≥2-letter TLD', () => {
    for (const ok of ['a@b.co', 'x.y@sub.example.co.in']) expect(EMAIL_RE.test(ok)).toBe(true);
    for (const bad of ['a@b.c', 'a@b.1', 'a@b', 'nope']) expect(EMAIL_RE.test(bad)).toBe(false);
  });

  it('EMAIL_DOMAIN_RE accepts bare domains only', () => {
    for (const ok of ['example.com', 'acme.co.in', 'a-b.example.com'])
      expect(EMAIL_DOMAIN_RE.test(ok)).toBe(true);
    for (const bad of ['https://example.com', 'example', 'a@b.com', '-bad.com', 'example.'])
      expect(EMAIL_DOMAIN_RE.test(bad)).toBe(false);
  });

  it('emailDomain / matchesDomain handle sub-domains', () => {
    expect(emailDomain('a@Sub.Example.com')).toBe('sub.example.com');
    expect(matchesDomain('sub.acme.com', ['acme.com'])).toBe(true);
    expect(matchesDomain('acme.com', ['acme.com'])).toBe(true);
    expect(matchesDomain('notacme.com', ['acme.com'])).toBe(false);
  });

  it('isFreeEmailProvider flags curated consumer domains', () => {
    expect(isFreeEmailProvider('me@gmail.com')).toBe(true);
    expect(isFreeEmailProvider('me@acme.com')).toBe(false);
  });

  it('boundedLevenshtein early-exits above the ceiling', () => {
    expect(boundedLevenshtein('gmail', 'gmial', 2)).toBe(2);
    expect(boundedLevenshtein('abc', 'xyz', 1)).toBe(2); // > max ⇒ max+1
    expect(boundedLevenshtein('same', 'same', 2)).toBe(0);
  });

  it('suggestEmailCorrection offers a near-miss and leaves good addresses alone', () => {
    expect(suggestEmailCorrection('user@gmial.com')).toBe('user@gmail.com');
    expect(suggestEmailCorrection('user@example.con')).toBe('user@example.com');
    expect(suggestEmailCorrection('user@gmail.com')).toBeNull();
    expect(suggestEmailCorrection('user@acme.com')).toBeNull();
    expect(suggestEmailCorrection('not-an-email')).toBeNull();
  });
});

describe('emailFieldSchema', () => {
  const base = { key: 'email', type: 'email' as const, label: 'Email' };

  it('accepts a field with no validation object (back-compat)', () => {
    expect(emailFieldSchema.safeParse(base).success).toBe(true);
  });

  it('applies defaults inside the validation object', () => {
    const parsed = emailFieldSchema.parse({ ...base, validation: {} });
    expect(parsed.validation).toMatchObject({
      maxLength: 254,
      suggestCorrections: true,
      blockFreeProviders: false,
    });
  });

  it('caps maxLength at the ceiling', () => {
    expect(emailFieldSchema.safeParse({ ...base, validation: { maxLength: 321 } }).success).toBe(
      false,
    );
    expect(emailFieldSchema.safeParse({ ...base, validation: { maxLength: 320 } }).success).toBe(
      true,
    );
  });

  it('validates + lowercases bare domain entries', () => {
    const parsed = emailFieldSchema.parse({
      ...base,
      validation: { allowedDomains: ['Acme.COM'] },
    });
    expect(parsed.validation?.allowedDomains).toEqual(['acme.com']);
    expect(
      emailFieldSchema.safeParse({ ...base, validation: { allowedDomains: ['https://x.com'] } })
        .success,
    ).toBe(false);
  });

  it('rejects both allow and block lists at once (mutually exclusive)', () => {
    const res = emailFieldSchema.safeParse({
      ...base,
      validation: { allowedDomains: ['a.com'], blockedDomains: ['b.com'] },
    });
    expect(res.success).toBe(false);
  });
});
