import { describe, expect, it } from 'vitest';
import {
  canonicalizePhone,
  composePhoneValue,
  DEFAULT_PHONE_COUNTRY,
  phoneErrorMessage,
  resolvePhoneCountries,
  splitPhoneValue,
} from './constants';

describe('resolvePhoneCountries', () => {
  it('defaults to India-only when unconfigured', () => {
    expect(resolvePhoneCountries(undefined, undefined)).toEqual({
      codes: ['IN'],
      defaultCode: 'IN',
    });
    expect(DEFAULT_PHONE_COUNTRY).toBe('IN');
  });

  it('drops unknown codes and guarantees a non-empty list', () => {
    expect(resolvePhoneCountries(['ZZ' as string], undefined)).toEqual({
      codes: ['IN'],
      defaultCode: 'IN',
    });
  });

  it('keeps the allow-list and pins the default into it', () => {
    expect(resolvePhoneCountries(['US', 'GB'], 'GB')).toEqual({
      codes: ['US', 'GB'],
      defaultCode: 'GB',
    });
    // Default outside the list falls back to the first allowed country.
    expect(resolvePhoneCountries(['US', 'GB'], 'IN')).toEqual({
      codes: ['US', 'GB'],
      defaultCode: 'US',
    });
  });
});

describe('canonicalizePhone (shared client+server source of truth)', () => {
  const IN = resolvePhoneCountries(undefined, undefined);

  it('normalizes a bare Indian number to +91 E.164', () => {
    expect(canonicalizePhone('9876543210', IN.codes, IN.defaultCode)).toEqual({
      value: '+919876543210',
    });
  });

  it('strips separators and a +91 prefix', () => {
    expect(canonicalizePhone('+91 98765-43210', IN.codes, IN.defaultCode)).toEqual({
      value: '+919876543210',
    });
    // A leading 00 international prefix normalizes to +.
    expect(canonicalizePhone('0091 98765 43210', IN.codes, IN.defaultCode)).toEqual({
      value: '+919876543210',
    });
  });

  it('rejects a wrong-length national number', () => {
    expect(canonicalizePhone('12', IN.codes, IN.defaultCode)).toEqual({ error: true });
    expect(canonicalizePhone('987654321', IN.codes, IN.defaultCode)).toEqual({ error: true });
  });

  it('flags a bare dial code (no national digits) as empty, not error', () => {
    const m = resolvePhoneCountries(['US', 'IN'], 'US');
    expect(canonicalizePhone('+1', m.codes, m.defaultCode)).toEqual({ empty: true });
  });

  it('rejects a dial code outside the allow-list', () => {
    const m = resolvePhoneCountries(['IN'], 'IN');
    expect(canonicalizePhone('+15551234567', m.codes, m.defaultCode)).toEqual({ error: true });
  });

  it('disambiguates shared dials (+1 US/CA) by fitting length', () => {
    const m = resolvePhoneCountries(['US', 'CA'], 'US');
    expect(canonicalizePhone('+15551234567', m.codes, m.defaultCode)).toEqual({
      value: '+15551234567',
    });
  });

  it('rejects non-string input', () => {
    expect(canonicalizePhone(1234567890 as unknown as string, IN.codes, IN.defaultCode)).toEqual({
      error: true,
    });
  });
});

describe('splitPhoneValue (render round-trip)', () => {
  it('splits a composed value back into country + national digits', () => {
    const m = resolvePhoneCountries(['US', 'GB'], 'US');
    expect(splitPhoneValue('+447400123456', m.codes, m.defaultCode)).toEqual({
      code: 'GB',
      national: '7400123456',
    });
  });

  it('falls back to the default country for a bare national number', () => {
    const m = resolvePhoneCountries(['US', 'GB'], 'US');
    expect(splitPhoneValue('5551234567', m.codes, m.defaultCode)).toEqual({
      code: 'US',
      national: '5551234567',
    });
  });

  it('round-trips through composePhoneValue', () => {
    expect(composePhoneValue('IN', '9876543210')).toBe('+919876543210');
    const s = splitPhoneValue(composePhoneValue('GB', '7400123456'), ['GB'], 'GB');
    expect(s).toEqual({ code: 'GB', national: '7400123456' });
  });
});

describe('phoneErrorMessage', () => {
  it('surfaces the exact digit count for a single fixed-length country', () => {
    expect(phoneErrorMessage(['IN'], 'IN')).toBe('Please enter a valid 10-digit phone number.');
  });

  it('is generic for multi-country or variable-length', () => {
    expect(phoneErrorMessage(['US', 'GB'], 'US')).toBe('Please enter a valid phone number.');
    expect(phoneErrorMessage(['GB'], 'GB')).toBe('Please enter a valid phone number.');
  });
});
