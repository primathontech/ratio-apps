import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateUrl } from './validate';

const field = (validation?: Record<string, unknown>): ControlFieldOf<'url'> =>
  ({
    key: 'u',
    type: 'url',
    label: 'U',
    required: false,
    validation,
  }) as ControlFieldOf<'url'>;
const ctx = (value: unknown): FieldValidateCtx => ({ values: { u: value }, files: {} });

// Client parity for the v2 url config (requireHttps / maxLength) and the
// bare-domain normalization the server performs. Server is authoritative.
describe('validateUrl (v2 config: requireHttps / maxLength / bare-domain parity)', () => {
  it('accepts a bare domain by normalizing to https (scheme may be omitted)', () => {
    expect(validateUrl(field(), ctx('example.com'))).toBeNull();
  });

  it('accepts a full https URL', () => {
    expect(validateUrl(field(), ctx('https://example.com/path'))).toBeNull();
  });

  it('rejects a non-url string', () => {
    expect(validateUrl(field(), ctx('not a url'))).toBe('Please enter a valid URL.');
  });

  it('rejects a non-http(s) scheme (same message as the server)', () => {
    expect(validateUrl(field(), ctx('javascript:alert(1)'))).toBe(
      'Please enter a valid http or https URL.',
    );
  });

  it('trims surrounding whitespace before validating (client↔server parity)', () => {
    expect(validateUrl(field(), ctx('  https://example.com  '))).toBeNull();
  });

  it('requireHttps rejects an http URL', () => {
    expect(validateUrl(field({ requireHttps: true }), ctx('http://example.com'))).toBe(
      'Please enter a valid https URL.',
    );
  });

  it('requireHttps accepts an https URL', () => {
    expect(validateUrl(field({ requireHttps: true }), ctx('https://example.com'))).toBeNull();
  });

  it('requireHttps accepts a bare domain (normalized to https)', () => {
    expect(validateUrl(field({ requireHttps: true }), ctx('example.com'))).toBeNull();
  });

  it('maxLength rejects an over-long value', () => {
    expect(validateUrl(field({ maxLength: 15 }), ctx('https://example.com/very/long/path'))).toBe(
      'Please enter no more than 15 characters.',
    );
  });

  it('maxLength accepts a value within the cap', () => {
    expect(validateUrl(field({ maxLength: 100 }), ctx('https://example.com'))).toBeNull();
  });
});
