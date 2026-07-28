import { describe, expect, it } from 'vitest';
import { dateFieldSchema } from './schema';

const baseField = {
  key: 'dob',
  type: 'date' as const,
  label: 'Date of birth',
  required: false,
};

describe('dateFieldSchema — calendar validation of min/max bounds', () => {
  it('stays valid with no validation object', () => {
    const parsed = dateFieldSchema.parse(baseField);
    expect(parsed.validation).toBeUndefined();
  });

  it('accepts real ISO calendar dates as bounds', () => {
    const parsed = dateFieldSchema.parse({
      ...baseField,
      validation: { min: '2026-01-01', max: '2026-12-31' },
    });
    expect(parsed.validation?.min).toBe('2026-01-01');
    expect(parsed.validation?.max).toBe('2026-12-31');
  });

  it('accepts a leap-day that really exists', () => {
    expect(
      dateFieldSchema.safeParse({ ...baseField, validation: { min: '2024-02-29' } }).success,
    ).toBe(true);
  });

  it('rejects impossible calendar dates the regex alone would accept', () => {
    // Feb 30 never exists; Date.parse would silently roll it into March.
    expect(
      dateFieldSchema.safeParse({ ...baseField, validation: { min: '2026-02-30' } }).success,
    ).toBe(false);
    // Non-leap-year Feb 29.
    expect(
      dateFieldSchema.safeParse({ ...baseField, validation: { max: '2026-02-29' } }).success,
    ).toBe(false);
    // Month 13 / day 00.
    expect(
      dateFieldSchema.safeParse({ ...baseField, validation: { min: '2026-13-01' } }).success,
    ).toBe(false);
    expect(
      dateFieldSchema.safeParse({ ...baseField, validation: { min: '2026-01-00' } }).success,
    ).toBe(false);
  });

  it('rejects non-ISO shapes (July 2026, 12/31/2026)', () => {
    expect(
      dateFieldSchema.safeParse({ ...baseField, validation: { min: 'July 2026' } }).success,
    ).toBe(false);
    expect(
      dateFieldSchema.safeParse({ ...baseField, validation: { min: '12/31/2026' } }).success,
    ).toBe(false);
  });
});
