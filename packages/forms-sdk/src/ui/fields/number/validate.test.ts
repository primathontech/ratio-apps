import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateNumber } from './validate';

const field = (
  validation: Record<string, unknown>,
  format?: Record<string, unknown>,
): ControlFieldOf<'number'> =>
  ({
    key: 'n',
    type: 'number',
    label: 'N',
    required: false,
    validation,
    ...(format ? { format } : {}),
  }) as ControlFieldOf<'number'>;
const ctx = (value: unknown): FieldValidateCtx => ({ values: { n: value }, files: {} });

// Client parity for the tightened server number validator (P2-4): value must be
// a multiple of step measured from the base (min, or 0). Server is authoritative.
describe('validateNumber (step multiple-of, P2-4 client parity)', () => {
  it('rejects a value off the step grid', () => {
    expect(validateNumber(field({ min: 0, step: 5 }), ctx(3))).toBe(
      'Please enter a multiple of 5.',
    );
  });

  it('accepts a value on the step grid', () => {
    expect(validateNumber(field({ min: 0, step: 5 }), ctx(15))).toBeNull();
  });

  it('offsets the grid by the base (min)', () => {
    expect(validateNumber(field({ min: 2, step: 5 }), ctx(7))).toBeNull();
    expect(validateNumber(field({ min: 2, step: 5 }), ctx(5))).toBe(
      'Please enter a multiple of 5.',
    );
  });
});

// A grouped value submitted before blur canonicalization must not NaN out.
describe('validateNumber (grouping tolerance)', () => {
  it('accepts a still-grouped value by stripping the locale separator', () => {
    expect(validateNumber(field({ min: 0 }, { locale: 'en-US' }), ctx('1,234'))).toBeNull();
  });
  it('still rejects genuinely non-numeric input', () => {
    expect(validateNumber(field({}), ctx('abc'))).toBe('Please enter a number.');
  });
});
