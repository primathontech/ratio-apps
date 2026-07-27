import { describe, expect, it } from 'vitest';
import { formFieldsSchema } from '../../form-schema';
import { radioFieldSchema } from './schema';

const base = {
  key: 'plan',
  type: 'radio' as const,
  label: 'Plan',
  options: [
    { value: 'basic', label: 'Basic' },
    { value: 'pro', label: 'Pro' },
  ],
};

describe('radioFieldSchema (P0 select depth)', () => {
  it('accepts a legacy field without the new keys (backward compatible)', () => {
    expect(radioFieldSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the new optional layout/variant/other keys', () => {
    const parsed = radioFieldSchema.safeParse({
      ...base,
      allowOther: true,
      otherLabel: 'Other',
      defaultValue: 'basic',
      layout: 'grid',
      gridColumns: 3,
      variant: 'card',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown layout', () => {
    expect(radioFieldSchema.safeParse({ ...base, layout: 'masonry' }).success).toBe(false);
  });

  it('rejects an unknown variant', () => {
    expect(radioFieldSchema.safeParse({ ...base, variant: 'pill' }).success).toBe(false);
  });

  it('rejects out-of-range gridColumns', () => {
    expect(radioFieldSchema.safeParse({ ...base, gridColumns: 1 }).success).toBe(false);
    expect(radioFieldSchema.safeParse({ ...base, gridColumns: 5 }).success).toBe(false);
  });
});

describe('radio defaultValue membership (formFieldsSchema refine)', () => {
  it('accepts a default that is one of the options', () => {
    expect(formFieldsSchema.safeParse([{ ...base, defaultValue: 'basic' }]).success).toBe(true);
  });

  it('rejects a default that is not one of the options', () => {
    expect(formFieldsSchema.safeParse([{ ...base, defaultValue: 'nope' }]).success).toBe(false);
  });
});
