import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateEmail } from './validate';

const field = (validation?: Record<string, unknown>, required = false): ControlFieldOf<'email'> =>
  ({
    key: 'email',
    type: 'email',
    label: 'Email',
    required,
    ...(validation ? { validation } : {}),
  }) as ControlFieldOf<'email'>;
const ctx = (value: unknown): FieldValidateCtx => ({ values: { email: value }, files: {} });

// Client parity for the server-authoritative email validator: the widget must
// reject exactly what the server rejects, using the same shared constants.
describe('validateEmail (client parity)', () => {
  it('honors required vs optional on an empty value', () => {
    expect(validateEmail(field(undefined, true), ctx(''))).toBe('This field is required.');
    expect(validateEmail(field(undefined, false), ctx(''))).toBeNull();
  });

  it('accepts a valid address and rejects the tightened-regex failures', () => {
    expect(validateEmail(field(), ctx('a@b.co'))).toBeNull();
    for (const bad of ['nope', 'a@b.c', 'a@b']) {
      expect(validateEmail(field(), ctx(bad)), bad).not.toBeNull();
    }
  });

  it('mirrors the maxLength cap', () => {
    expect(validateEmail(field({ maxLength: 10 }), ctx('someone@example.com'))).not.toBeNull();
  });

  it('mirrors the free-provider block and domain lists', () => {
    expect(validateEmail(field({ blockFreeProviders: true }), ctx('me@gmail.com'))).not.toBeNull();
    expect(
      validateEmail(field({ allowedDomains: ['acme.com'] }), ctx('a@other.com')),
    ).not.toBeNull();
    expect(validateEmail(field({ allowedDomains: ['acme.com'] }), ctx('a@acme.com'))).toBeNull();
    expect(
      validateEmail(field({ blockedDomains: ['spam.com'] }), ctx('a@spam.com')),
    ).not.toBeNull();
  });
});
