import { describe, expect, it } from 'vitest';
import { numberFieldSchema } from './schema';

const baseField = {
  key: 'qty',
  type: 'number' as const,
  label: 'Quantity',
  required: false,
};

describe('numberFieldSchema — Batch-4 display formatting', () => {
  it('stays valid with no format object (existing forms unchanged)', () => {
    const parsed = numberFieldSchema.parse(baseField);
    expect(parsed.format).toBeUndefined();
    // Union member must remain a plain ZodObject (not a refinement wrapper) so
    // the discriminated union keeps working (Zod v4: check the runtime class).
    expect(numberFieldSchema.constructor.name).toBe('ZodObject');
  });

  it('fills format defaults when an empty format object is given', () => {
    const parsed = numberFieldSchema.parse({ ...baseField, format: {} });
    expect(parsed.format).toEqual({
      style: 'decimal',
      currency: 'INR',
      locale: 'en-IN',
      grouping: true,
    });
  });

  it('accepts a fully-specified currency format', () => {
    const parsed = numberFieldSchema.parse({
      ...baseField,
      format: {
        style: 'currency',
        currency: 'USD',
        locale: 'en-US',
        grouping: false,
        decimalPlaces: 2,
      },
    });
    expect(parsed.format?.style).toBe('currency');
    expect(parsed.format?.decimalPlaces).toBe(2);
  });

  it('rejects an unknown style / currency / locale (bounded enums)', () => {
    expect(
      numberFieldSchema.safeParse({ ...baseField, format: { style: 'scientific' } }).success,
    ).toBe(false);
    expect(numberFieldSchema.safeParse({ ...baseField, format: { currency: 'XXX' } }).success).toBe(
      false,
    );
    expect(numberFieldSchema.safeParse({ ...baseField, format: { locale: 'xx-YY' } }).success).toBe(
      false,
    );
  });

  it('bounds decimalPlaces to 0..10', () => {
    expect(
      numberFieldSchema.safeParse({ ...baseField, format: { decimalPlaces: -1 } }).success,
    ).toBe(false);
    expect(
      numberFieldSchema.safeParse({ ...baseField, format: { decimalPlaces: 11 } }).success,
    ).toBe(false);
    expect(
      numberFieldSchema.safeParse({ ...baseField, format: { decimalPlaces: 4 } }).success,
    ).toBe(true);
  });
});
