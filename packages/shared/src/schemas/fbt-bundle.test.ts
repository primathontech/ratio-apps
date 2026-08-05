import { describe, expect, it } from 'vitest';
import {
  fbtBundleInputSchema,
  fbtBundleStatusSchema,
  fbtScopeTypeSchema,
} from './fbt-bundle';
import { fbtMerchantConfigSchema } from './fbt-config';

describe('fbt bundle enums', () => {
  // Literals, not `.options` compared to itself — these strings are a wire
  // contract with the source app's DB enum and the admin's select options.
  it('pins the bundle status values', () => {
    expect(fbtBundleStatusSchema.options).toEqual(['draft', 'published', 'paused', 'archived']);
  });

  it('pins the scope type values', () => {
    expect(fbtScopeTypeSchema.options).toEqual([
      'all_products',
      'specific_product',
      'specific_collections',
    ]);
  });
});

describe('fbtBundleInputSchema', () => {
  const valid = {
    name: 'Summer bundle',
    status: 'draft' as const,
    scopeType: 'all_products' as const,
    uiConfig: { title: 'Frequently Bought Together' },
  };

  it('accepts a minimal all-products bundle and defaults the lists to null', () => {
    const parsed = fbtBundleInputSchema.parse(valid);
    expect(parsed.scopeProductIds).toBeNull();
    expect(parsed.scopeCollectionIds).toBeNull();
    expect(parsed.recommendationCount).toBeNull();
  });

  it('requires scopeProductIds when scopeType is specific_product', () => {
    const r = fbtBundleInputSchema.safeParse({ ...valid, scopeType: 'specific_product' });
    expect(r.success).toBe(false);
  });

  it('requires scopeCollectionIds when scopeType is specific_collections', () => {
    const r = fbtBundleInputSchema.safeParse({ ...valid, scopeType: 'specific_collections' });
    expect(r.success).toBe(false);
  });

  it('accepts specific_product when the id list is non-empty', () => {
    const r = fbtBundleInputSchema.safeParse({
      ...valid,
      scopeType: 'specific_product',
      scopeProductIds: ['prod-1'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an end date earlier than the start date', () => {
    const r = fbtBundleInputSchema.safeParse({
      ...valid,
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-05-01T00:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });

  it('caps recommendationCount at 10 to bound the OpenAI spend per bundle', () => {
    expect(fbtBundleInputSchema.safeParse({ ...valid, recommendationCount: 11 }).success).toBe(
      false,
    );
    expect(fbtBundleInputSchema.safeParse({ ...valid, recommendationCount: 10 }).success).toBe(
      true,
    );
  });
});

describe('fbtMerchantConfigSchema', () => {
  // The Appearance admin screen writes the global widget theme here. The column
  // has existed since 0001_initial; the schema was missing the field, so the
  // screen would have had nowhere to save.
  it('accepts uiConfig and defaults it to null', () => {
    const parsed = fbtMerchantConfigSchema.parse({});
    expect(parsed.uiConfig).toBeNull();

    const withUi = fbtMerchantConfigSchema.parse({ uiConfig: { accentColor: '#34a853' } });
    expect(withUi.uiConfig).toEqual({ accentColor: '#34a853' });
  });
});
