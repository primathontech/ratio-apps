import { describe, expect, it } from 'vitest';
import { formFieldsSchema } from '../../form-schema';
import { dropdownFieldSchema } from './schema';

const base = {
  key: 'plan',
  type: 'dropdown' as const,
  label: 'Plan',
  options: [
    { value: 'basic', label: 'Basic' },
    { value: 'pro', label: 'Pro' },
  ],
};

describe('dropdownFieldSchema (P0 select depth)', () => {
  it('accepts a legacy field without the new keys (backward compatible)', () => {
    expect(dropdownFieldSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the new optional keys', () => {
    const parsed = dropdownFieldSchema.safeParse({
      ...base,
      allowOther: true,
      otherLabel: 'Something else',
      defaultValue: 'pro',
      prompt: 'Pick a plan',
      searchable: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an over-long prompt', () => {
    expect(dropdownFieldSchema.safeParse({ ...base, prompt: 'x'.repeat(121) }).success).toBe(false);
  });

  it('rejects an empty otherLabel', () => {
    expect(dropdownFieldSchema.safeParse({ ...base, otherLabel: '' }).success).toBe(false);
  });
});

describe('dropdown defaultValue membership (formFieldsSchema refine)', () => {
  it('accepts a default that is one of the options', () => {
    expect(formFieldsSchema.safeParse([{ ...base, defaultValue: 'pro' }]).success).toBe(true);
  });

  it('rejects a default that is not one of the options', () => {
    const parsed = formFieldsSchema.safeParse([{ ...base, defaultValue: 'enterprise' }]);
    expect(parsed.success).toBe(false);
  });
});
