import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validatePhone } from './validate';

const field = (extra: Partial<ControlFieldOf<'phone'>> = {}): ControlFieldOf<'phone'> =>
  ({
    key: 'p',
    type: 'phone',
    label: 'Phone',
    required: false,
    ...extra,
  }) as ControlFieldOf<'phone'>;
const ctx = (value: unknown): FieldValidateCtx => ({ values: { p: value }, files: {} });

describe('validatePhone (client mirror of the server rules)', () => {
  it('accepts a valid Indian number by default', () => {
    expect(validatePhone(field(), ctx('9876543210'))).toBeNull();
  });

  it('rejects a short number with the 10-digit message (v1 parity)', () => {
    expect(validatePhone(field(), ctx('12345'))).toContain('10-digit');
  });

  it('honors required vs optional on empty', () => {
    expect(validatePhone(field({ required: true }), ctx(''))).toBe('This field is required.');
    expect(validatePhone(field(), ctx(''))).toBeNull();
  });

  it('accepts a composed E.164 for an allowed country', () => {
    const f = field({ countries: { allowed: ['US', 'GB'], default: 'US' } });
    expect(validatePhone(f, ctx('+447400123456'))).toBeNull();
  });

  it('rejects a dial code outside the allow-list', () => {
    const f = field({ countries: { allowed: ['US', 'GB'], default: 'US' } });
    expect(validatePhone(f, ctx('+919876543210'))).toBe('Please enter a valid phone number.');
  });

  it('treats a bare dial code as empty (optional passes, required fails)', () => {
    const optional = field({ countries: { allowed: ['US', 'GB'], default: 'US' } });
    expect(validatePhone(optional, ctx('+1'))).toBeNull();
    const req = field({ required: true, countries: { allowed: ['US', 'GB'], default: 'US' } });
    expect(validatePhone(req, ctx('+1'))).toBe('This field is required.');
  });
});
