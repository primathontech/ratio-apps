import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateDate } from './validate';

const field = (required = false): ControlFieldOf<'date'> =>
  ({ key: 'd', type: 'date', label: 'Date', required }) as ControlFieldOf<'date'>;
const ctx = (value: unknown): FieldValidateCtx => ({ values: { d: value }, files: {} });

// Client parity for the tightened server date validator (P2-5): the widget must
// reject exactly the values the server now rejects. The DOM <input type="date">
// coerces bad values to "" on its own, so this exercises the validator directly.
describe('validateDate (strict ISO, P2-5 client parity)', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(validateDate(field(), ctx('2026-07-15'))).toBeNull();
  });

  it('rejects the non-ISO / impossible values the server now rejects', () => {
    for (const bad of ['2026', 'July 2026', '12/31/2026', '2026-2-3', '2026-13-01']) {
      expect(validateDate(field(), ctx(bad))).not.toBeNull();
    }
  });

  it('rejects an impossible calendar date instead of silently rolling it over', () => {
    // Date.parse('2026-02-30') yields a valid number (rolls to Mar 2); reject it.
    expect(validateDate(field(), ctx('2026-02-30'))).toBe('Please enter a valid date.');
  });

  it('honors required vs optional on an empty value', () => {
    expect(validateDate(field(true), ctx(''))).toBe('This field is required.');
    expect(validateDate(field(false), ctx(''))).toBeNull();
  });
});
