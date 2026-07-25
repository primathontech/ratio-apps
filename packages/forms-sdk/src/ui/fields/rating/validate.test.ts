import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateRating } from './validate';

const field = (config: Record<string, unknown> = {}): ControlFieldOf<'rating'> =>
  ({
    key: 'r',
    type: 'rating',
    label: 'R',
    required: false,
    max: 5,
    icon: 'star',
    ...config,
  }) as ControlFieldOf<'rating'>;
const ctx = (value: unknown): FieldValidateCtx => ({ values: { r: value }, files: {} });

// Client parity for the enriched rating config (v2): a 0-based scale (min: 0)
// enables NPS (0–10); absent min ⇒ 1 (1-based, today's behavior). Server is
// authoritative and enforces the identical bounds.
describe('validateRating (min..max bounds, v2 config parity)', () => {
  it('defaults to a 1-based scale when min is absent', () => {
    expect(validateRating(field(), ctx(1))).toBeNull();
    expect(validateRating(field(), ctx(0))).toBe('Please choose a rating between 1 and 5.');
  });

  it('accepts 0 on a 0-based scale (NPS)', () => {
    expect(validateRating(field({ min: 0, max: 10 }), ctx(0))).toBeNull();
    expect(validateRating(field({ min: 0, max: 10 }), ctx(10))).toBeNull();
  });

  it('rejects a value below min with the min..max message', () => {
    expect(validateRating(field({ min: 0, max: 10 }), ctx(-1))).toBe(
      'Please choose a rating between 0 and 10.',
    );
  });

  it('rejects a value above max', () => {
    expect(validateRating(field({ min: 0, max: 10 }), ctx(11))).toBe(
      'Please choose a rating between 0 and 10.',
    );
  });

  it('rejects a non-integer', () => {
    expect(validateRating(field(), ctx(3.5))).toBe('Please choose a rating between 1 and 5.');
  });

  it('honors required vs optional on an empty value', () => {
    expect(validateRating(field({ required: true }), ctx(''))).toBe('This field is required.');
    expect(validateRating(field({ required: false }), ctx(''))).toBeNull();
  });
});
