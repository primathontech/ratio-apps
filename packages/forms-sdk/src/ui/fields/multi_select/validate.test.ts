import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateMultiSelect } from './validate';

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
];

const field = (
  overrides: Partial<ControlFieldOf<'multi_select'>> = {},
): ControlFieldOf<'multi_select'> =>
  ({
    key: 'm',
    type: 'multi_select',
    label: 'Pick',
    required: false,
    options,
    ...overrides,
  }) as ControlFieldOf<'multi_select'>;

const ctx = (value: unknown): FieldValidateCtx => ({ values: { m: value }, files: {} });

describe('validateMultiSelect', () => {
  it('accepts valid members', () => {
    expect(validateMultiSelect(field(), ctx(['a', 'b']))).toBeNull();
  });

  it('honors required vs optional on empty', () => {
    expect(validateMultiSelect(field({ required: true }), ctx([]))).toBe('This field is required.');
    expect(validateMultiSelect(field({ required: false }), ctx([]))).toBeNull();
  });

  it('rejects values outside the option set', () => {
    expect(validateMultiSelect(field(), ctx(['a', 'z']))).toBe(
      'Please choose only from the available options.',
    );
  });

  it('enforces the minimum selection count', () => {
    expect(validateMultiSelect(field({ selection: { min: 2 } }), ctx(['a']))).toBe(
      'Please select at least 2 options.',
    );
    expect(validateMultiSelect(field({ selection: { min: 2 } }), ctx(['a', 'b']))).toBeNull();
  });

  it('enforces the maximum selection count', () => {
    expect(validateMultiSelect(field({ selection: { max: 1 } }), ctx(['a', 'b']))).toBe(
      'Please select at most 1 option.',
    );
    expect(validateMultiSelect(field({ selection: { max: 2 } }), ctx(['a', 'b']))).toBeNull();
  });

  describe('"Other" free-text (client↔server parity)', () => {
    it('accepts one bounded non-member value when allowOther is on', () => {
      expect(
        validateMultiSelect(field({ allowOther: true }), ctx(['a', 'my own thing'])),
      ).toBeNull();
    });

    it('rejects a non-member value when allowOther is off', () => {
      expect(validateMultiSelect(field(), ctx(['a', 'my own thing']))).toBe(
        'Please choose only from the available options.',
      );
    });

    it('rejects more than one non-member value even when allowOther is on', () => {
      expect(validateMultiSelect(field({ allowOther: true }), ctx(['one', 'two']))).toBe(
        'Please choose only from the available options.',
      );
    });

    it('rejects an over-long non-member value when allowOther is on', () => {
      expect(validateMultiSelect(field({ allowOther: true }), ctx(['a', 'x'.repeat(256)]))).toBe(
        'Please choose only from the available options.',
      );
    });
  });
});
