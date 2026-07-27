import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateDropdown } from './validate';

const options = [
  { value: 'basic', label: 'Basic' },
  { value: 'pro', label: 'Pro' },
];

const field = (over: Partial<ControlFieldOf<'dropdown'>> = {}): ControlFieldOf<'dropdown'> =>
  ({
    key: 'plan',
    type: 'dropdown',
    label: 'Plan',
    required: false,
    options,
    ...over,
  }) as ControlFieldOf<'dropdown'>;

const ctx = (value: unknown): FieldValidateCtx => ({ values: { plan: value }, files: {} });

describe('validateDropdown', () => {
  it('accepts a configured option', () => {
    expect(validateDropdown(field(), ctx('pro'))).toBeNull();
  });

  it('honors required vs optional on empty', () => {
    expect(validateDropdown(field({ required: true }), ctx(''))).toBe('This field is required.');
    expect(validateDropdown(field({ required: false }), ctx(''))).toBeNull();
  });

  it('rejects a non-option value when allowOther is off (client↔server parity)', () => {
    expect(validateDropdown(field(), ctx('enterprise'))).toBe(
      'Please choose one of the available options.',
    );
  });

  it('accepts a free-text "Other" value when allowOther is on', () => {
    expect(validateDropdown(field({ allowOther: true }), ctx('enterprise'))).toBeNull();
  });

  it('rejects an over-long "Other" value even when allowOther is on', () => {
    expect(validateDropdown(field({ allowOther: true }), ctx('x'.repeat(256)))).toBe(
      'Please choose one of the available options.',
    );
  });
});
