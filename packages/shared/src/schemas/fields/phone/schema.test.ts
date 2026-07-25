import { describe, expect, it } from 'vitest';
import { phoneFieldSchema } from './schema';

const base = { key: 'phone', type: 'phone' as const, label: 'Phone' };

describe('phoneFieldSchema', () => {
  it('accepts a v1 field with no country config (backward compatible)', () => {
    const r = phoneFieldSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('accepts a valid multi-country config', () => {
    const r = phoneFieldSchema.safeParse({
      ...base,
      countries: { allowed: ['US', 'GB', 'IN'], default: 'GB' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects a default that is not in the allow-list', () => {
    const r = phoneFieldSchema.safeParse({
      ...base,
      countries: { allowed: ['US', 'GB'], default: 'IN' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown country code', () => {
    const r = phoneFieldSchema.safeParse({
      ...base,
      countries: { allowed: ['ZZ'], default: 'ZZ' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty allow-list', () => {
    const r = phoneFieldSchema.safeParse({ ...base, countries: { allowed: [] } });
    expect(r.success).toBe(false);
  });
});
