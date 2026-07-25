import { describe, expect, it } from 'vitest';
import { multiSelectFieldSchema } from './schema';

const base = {
  key: 'm',
  type: 'multi_select' as const,
  label: 'Pick',
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
};

describe('multiSelectFieldSchema (P0 field-depth)', () => {
  it('accepts a legacy field without the new keys (backward compatible)', () => {
    expect(multiSelectFieldSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the new optional layout + selection keys', () => {
    const parsed = multiSelectFieldSchema.safeParse({
      ...base,
      selection: { min: 1, max: 2 },
      display: 'chips',
      columns: 3,
      showSelectAll: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects min greater than max', () => {
    expect(
      multiSelectFieldSchema.safeParse({ ...base, selection: { min: 3, max: 1 } }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range column count', () => {
    expect(multiSelectFieldSchema.safeParse({ ...base, columns: 4 }).success).toBe(false);
    expect(multiSelectFieldSchema.safeParse({ ...base, columns: 0 }).success).toBe(false);
  });

  it('rejects an unknown display mode', () => {
    expect(multiSelectFieldSchema.safeParse({ ...base, display: 'grid' }).success).toBe(false);
  });
});
