import { describe, expect, it } from 'vitest';
import { validateEmail } from '../../../../src/modules/forms/submissions/fields/email/validate';
import type { FieldOfType } from '../../../../src/modules/forms/submissions/fields/types';

const field = (validation?: Record<string, unknown>): FieldOfType<'email'> =>
  ({
    key: 'email',
    type: 'email',
    label: 'Email',
    required: false,
    ...(validation ? { validation } : {}),
  }) as FieldOfType<'email'>;

describe('validateEmail (server-authoritative)', () => {
  it('normalizes to the canonical trimmed + lowercased value', () => {
    expect(validateEmail(field(), '  Asha@Example.COM ')).toEqual({ value: 'asha@example.com' });
  });

  it('rejects a non-string', () => {
    expect(validateEmail(field(), 42).error).toBeDefined();
  });

  it('rejects malformed addresses and short/numeric TLDs (tightened regex)', () => {
    for (const bad of ['nope', 'a@b', 'a@b.c', 'a@b.1', 'a b@c.com', 'a@@b.com']) {
      const out = validateEmail(field(), bad);
      expect(out.error, bad).toBeDefined();
      expect(out.value, bad).toBeUndefined();
    }
  });

  it('accepts a well-formed address', () => {
    expect(validateEmail(field(), 'a@b.co')).toEqual({ value: 'a@b.co' });
    expect(validateEmail(field(), 'first.last@sub.example.co.in')).toEqual({
      value: 'first.last@sub.example.co.in',
    });
  });

  it('enforces maxLength server-side regardless of the client (default 254)', () => {
    const long = `${'x'.repeat(250)}@example.com`;
    expect(validateEmail(field(), long).error).toBeDefined();
    // A tighter configured cap is enforced too.
    expect(validateEmail(field({ maxLength: 20 }), 'someone@example.com')).toEqual({
      value: 'someone@example.com',
    });
    expect(validateEmail(field({ maxLength: 10 }), 'someone@example.com').error).toBeDefined();
  });

  it('blocks free/consumer providers when configured (server-enforced)', () => {
    expect(validateEmail(field({ blockFreeProviders: true }), 'me@gmail.com').error).toBeDefined();
    // Case/whitespace bypass attempt still blocked (normalized first).
    expect(
      validateEmail(field({ blockFreeProviders: true }), ' Me@GMAIL.com ').error,
    ).toBeDefined();
    expect(validateEmail(field({ blockFreeProviders: true }), 'me@acme.com')).toEqual({
      value: 'me@acme.com',
    });
  });

  it('enforces an allowed-domains list (including sub-domains)', () => {
    const f = field({ allowedDomains: ['acme.com'] });
    expect(validateEmail(f, 'a@acme.com')).toEqual({ value: 'a@acme.com' });
    expect(validateEmail(f, 'a@eu.acme.com')).toEqual({ value: 'a@eu.acme.com' });
    expect(validateEmail(f, 'a@other.com').error).toBeDefined();
  });

  it('enforces a blocked-domains list', () => {
    const f = field({ blockedDomains: ['spam.com'] });
    expect(validateEmail(f, 'a@spam.com').error).toBeDefined();
    expect(validateEmail(f, 'a@bot.spam.com').error).toBeDefined();
    expect(validateEmail(f, 'a@good.com')).toEqual({ value: 'a@good.com' });
  });
});
