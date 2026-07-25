import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  applyTextTransform,
  FORM_TEXT_FORMAT_PATTERNS,
  FORM_TEXT_HARD_MAX_LENGTH,
  textFormatPattern,
} from './constants';
import { textFieldSchema } from './schema';

const baseField = {
  key: 'name',
  type: 'text' as const,
  label: 'Name',
  required: false,
};

describe('textFieldSchema — Batch-4 field-depth enrichments', () => {
  it('stays valid with no validation object (existing forms unchanged)', () => {
    const parsed = textFieldSchema.parse(baseField);
    expect(parsed.validation).toBeUndefined();
    expect(parsed.autocomplete).toBeUndefined();
    // Union member must remain a plain ZodObject for the discriminated union.
    expect(textFieldSchema instanceof z.ZodObject).toBe(true);
  });

  it('accepts the full enrichment surface', () => {
    const parsed = textFieldSchema.parse({
      ...baseField,
      autocomplete: 'name',
      validation: {
        format: 'pan',
        patternMessage: 'Enter a valid PAN.',
        transform: 'trim_upper',
        minLength: 2,
        maxLength: 10,
      },
    });
    expect(parsed.validation?.format).toBe('pan');
    expect(parsed.validation?.transform).toBe('trim_upper');
    expect(parsed.autocomplete).toBe('name');
  });

  it('caps maxLength at the hard ceiling', () => {
    expect(
      textFieldSchema.safeParse({
        ...baseField,
        validation: { maxLength: FORM_TEXT_HARD_MAX_LENGTH + 1 },
      }).success,
    ).toBe(false);
  });

  it('bounds patternMessage and rejects unknown enum values', () => {
    expect(
      textFieldSchema.safeParse({
        ...baseField,
        validation: { patternMessage: 'x'.repeat(121) },
      }).success,
    ).toBe(false);
    expect(
      textFieldSchema.safeParse({ ...baseField, validation: { format: 'zipcode' } }).success,
    ).toBe(false);
    expect(
      textFieldSchema.safeParse({ ...baseField, validation: { transform: 'shout' } }).success,
    ).toBe(false);
    expect(textFieldSchema.safeParse({ ...baseField, autocomplete: 'ssn' }).success).toBe(false);
  });
});

describe('text constants (Zod-free, SDK-importable)', () => {
  it('resolves named presets and returns undefined for none/custom', () => {
    expect(textFormatPattern('pan')).toBe(FORM_TEXT_FORMAT_PATTERNS.pan);
    expect(textFormatPattern('none')).toBeUndefined();
    expect(textFormatPattern('custom')).toBeUndefined();
    expect(textFormatPattern(undefined)).toBeUndefined();
  });

  it('every preset compiles as a valid unicode RegExp', () => {
    for (const src of Object.values(FORM_TEXT_FORMAT_PATTERNS)) {
      expect(() => new RegExp(src as string, 'u')).not.toThrow();
    }
  });

  it('applyTextTransform is a pure isomorphic normalizer', () => {
    expect(applyTextTransform('  hi  ', undefined)).toBe('hi'); // default trim
    expect(applyTextTransform('  hi  ', 'none')).toBe('  hi  ');
    expect(applyTextTransform('  ab ', 'trim_upper')).toBe('AB');
    expect(applyTextTransform(' AB ', 'trim_lower')).toBe('ab');
    expect(applyTextTransform(' asha rao ', 'trim_title')).toBe('Asha Rao');
  });
});
