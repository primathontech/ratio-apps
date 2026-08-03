import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateRadio } from './validate';

const options = [
  { value: 'basic', label: 'Basic' },
  { value: 'pro', label: 'Pro' },
];

const field = (over: Partial<ControlFieldOf<'radio'>> = {}): ControlFieldOf<'radio'> =>
  ({
    key: 'plan',
    type: 'radio',
    label: 'Plan',
    required: false,
    options,
    ...over,
  }) as ControlFieldOf<'radio'>;

const ctx = (value: unknown): FieldValidateCtx => ({ values: { plan: value }, files: {} });

describe('validateRadio', () => {
  it('accepts a configured option', () => {
    expect(validateRadio(field(), ctx('basic'))).toBeNull();
  });

  it('honors required vs optional on empty', () => {
    expect(validateRadio(field({ required: true }), ctx(''))).toBe('This field is required.');
    expect(validateRadio(field({ required: false }), ctx(''))).toBeNull();
  });

  it('rejects a non-option value when allowOther is off (client↔server parity)', () => {
    expect(validateRadio(field(), ctx('enterprise'))).toBe(
      'Please choose one of the available options.',
    );
  });

  it('accepts a free-text "Other" value when allowOther is on', () => {
    expect(validateRadio(field({ allowOther: true }), ctx('enterprise'))).toBeNull();
  });

  it('rejects an over-long "Other" value even when allowOther is on', () => {
    expect(validateRadio(field({ allowOther: true }), ctx('x'.repeat(256)))).toBe(
      'Please choose one of the available options.',
    );
  });
});
