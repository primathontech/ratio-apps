import { describe, expect, it } from 'vitest';
import { validatePhone } from '../../../../src/modules/forms/submissions/fields/phone/validate';
import type { FieldOfType } from '../../../../src/modules/forms/submissions/fields/types';

const field = (extra: Partial<FieldOfType<'phone'>> = {}): FieldOfType<'phone'> =>
  ({
    key: 'phone',
    type: 'phone',
    label: 'Phone',
    required: false,
    ...extra,
  }) as FieldOfType<'phone'>;

describe('validatePhone (server-authoritative)', () => {
  it('normalizes a bare Indian number to canonical E.164 (v1 parity)', () => {
    expect(validatePhone(field(), '9876543210')).toEqual({ value: '+919876543210' });
    expect(validatePhone(field(), '+91 98765-43210')).toEqual({ value: '+919876543210' });
  });

  it('rejects a wrong-length number regardless of the client', () => {
    expect(validatePhone(field(), '12').error).toContain('10-digit');
    expect(validatePhone(field(), '98765432').error).toBeDefined();
  });

  it('rejects non-string / crafted payloads', () => {
    expect(validatePhone(field(), 9876543210 as unknown).error).toBeDefined();
    expect(validatePhone(field(), { toString: () => '9876543210' } as unknown).error).toBeDefined();
  });

  it('validates + composes against the configured country set', () => {
    const f = field({ countries: { allowed: ['US', 'GB'], default: 'US' } });
    // A client that submits a bare national number is normalized under the default.
    expect(validatePhone(f, '5551234567')).toEqual({ value: '+15551234567' });
    // A composed E.164 for an allowed country is accepted and canonicalized.
    expect(validatePhone(f, '+44 7400 123456')).toEqual({ value: '+447400123456' });
  });

  it('rejects a bypassed country outside the allow-list', () => {
    const f = field({ countries: { allowed: ['US'], default: 'US' } });
    expect(validatePhone(f, '+919876543210').error).toBeDefined();
  });

  it('treats a bare dial code as empty: optional accepts, required errors', () => {
    const optional = field({ countries: { allowed: ['US', 'GB'], default: 'US' } });
    expect(validatePhone(optional, '+1')).toEqual({ value: '' });
    const req = field({ required: true, countries: { allowed: ['US', 'GB'], default: 'US' } });
    expect(validatePhone(req, '+1').error).toBe('This field is required.');
  });
});
