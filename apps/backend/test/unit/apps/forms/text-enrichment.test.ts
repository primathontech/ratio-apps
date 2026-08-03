import { describe, expect, it } from 'vitest';
import { validateText } from '../../../../src/modules/forms/submissions/fields/text/validate';
import type { FieldOfType } from '../../../../src/modules/forms/submissions/fields/types';

const field = (validation?: Record<string, unknown>): FieldOfType<'text'> =>
  ({
    key: 'name',
    type: 'text',
    label: 'Name',
    required: false,
    ...(validation ? { validation } : {}),
  }) as FieldOfType<'text'>;

// Server-authoritative behavior for the Batch-4 text enrichments: transforms
// normalize and RETURN the canonical value; length/format checks are enforced
// server-side regardless of what the client sent.
describe('validateText — server-authoritative (Batch-4 field depth)', () => {
  describe('transform / normalize', () => {
    it('trims by default and returns the canonical value', () => {
      expect(validateText(field(), '  Asha  ')).toEqual({ value: 'Asha' });
    });

    it('uppercases with trim_upper (client-bypassed lowercase is normalized server-side)', () => {
      // A crafted POST sends the raw un-normalized value; the server rewrites it.
      expect(validateText(field({ transform: 'trim_upper' }), '  abcde1234f  ')).toEqual({
        value: 'ABCDE1234F',
      });
    });

    it('lowercases with trim_lower', () => {
      expect(validateText(field({ transform: 'trim_lower' }), ' HELLO ')).toEqual({
        value: 'hello',
      });
    });

    it('title-cases with trim_title', () => {
      expect(validateText(field({ transform: 'trim_title' }), '  asha RAO  ')).toEqual({
        value: 'Asha Rao',
      });
    });

    it('leaves the value untouched with transform none', () => {
      expect(validateText(field({ transform: 'none' }), '  keep me  ')).toEqual({
        value: '  keep me  ',
      });
    });

    it('applies the transform BEFORE the length check', () => {
      // '   ok   ' is 8 chars raw but 'OK' (2) after trim_upper — passes maxLength 2.
      expect(validateText(field({ transform: 'trim_upper', maxLength: 2 }), '   ok   ')).toEqual({
        value: 'OK',
      });
    });
  });

  describe('length ceiling', () => {
    it('caps a merchant maxLength at the hard ceiling (min(maxLength, 1000))', () => {
      const f = field({ transform: 'none', maxLength: 5000 });
      // 1001 chars exceeds the 1000 hard ceiling even though maxLength says 5000.
      const res = validateText(f, 'a'.repeat(1001));
      expect(res.value).toBeUndefined();
      expect(res.error).toBe('Please enter no more than 1000 characters.');
    });

    it('enforces the always-on ceiling even when nothing is configured', () => {
      const res = validateText(field({ transform: 'none' }), 'a'.repeat(1001));
      expect(res.error).toBe('Please enter no more than 1000 characters.');
    });

    it('accepts a value at the ceiling', () => {
      expect(validateText(field({ transform: 'none' }), 'a'.repeat(1000))).toEqual({
        value: 'a'.repeat(1000),
      });
    });
  });

  describe('format presets', () => {
    it('accepts a valid PAN and rejects a malformed one', () => {
      const f = field({ format: 'pan', transform: 'none' });
      expect(validateText(f, 'ABCDE1234F')).toEqual({ value: 'ABCDE1234F' });
      expect(validateText(f, 'abcde1234f').error).toBeDefined();
    });

    it('normalizes then matches the preset (trim_upper + PAN)', () => {
      const f = field({ format: 'pan', transform: 'trim_upper' });
      expect(validateText(f, ' abcde1234f ')).toEqual({ value: 'ABCDE1234F' });
    });

    it('validates an Indian PIN code', () => {
      const f = field({ format: 'pin', transform: 'none' });
      expect(validateText(f, '560001')).toEqual({ value: '560001' });
      expect(validateText(f, '060001').error).toBeDefined(); // leading zero
    });

    it('emits the custom patternMessage on a format failure', () => {
      const f = field({ format: 'ifsc', transform: 'none', patternMessage: 'Enter a valid IFSC.' });
      expect(validateText(f, 'nope').error).toBe('Enter a valid IFSC.');
    });

    it('slug preset rejects spaces and uppercase', () => {
      const f = field({ format: 'slug', transform: 'none' });
      expect(validateText(f, 'my-slug-1')).toEqual({ value: 'my-slug-1' });
      expect(validateText(f, 'My Slug').error).toBeDefined();
    });
  });

  describe('custom pattern (RE2) still honored', () => {
    it('accepts a matching value and rejects a non-match', () => {
      const f = field({ pattern: '^[a-z]+$', transform: 'none' });
      expect(validateText(f, 'abc')).toEqual({ value: 'abc' });
      expect(validateText(f, 'abc1').error).toBeDefined();
    });

    it('rejects an over-cap input on the pattern path without running the regex', () => {
      const f = field({ pattern: '^[a-z]+$', transform: 'none' });
      expect(validateText(f, 'a'.repeat(1001)).error).toBe('Please enter a valid value.');
    });
  });

  it('rejects a non-string value', () => {
    expect(validateText(field(), 42 as unknown).error).toBeDefined();
  });
});
