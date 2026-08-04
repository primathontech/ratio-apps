import { describe, expect, it } from 'vitest';
import { fbtMerchantConfigSchema, fbtSyncFrequencySchema } from './fbt-config';

describe('fbtSyncFrequencySchema', () => {
  it('accepts daily and weekly', () => {
    expect(fbtSyncFrequencySchema.parse('daily')).toBe('daily');
    expect(fbtSyncFrequencySchema.parse('weekly')).toBe('weekly');
  });

  it('rejects anything else', () => {
    expect(fbtSyncFrequencySchema.safeParse('hourly').success).toBe(false);
  });
});

describe('fbtMerchantConfigSchema', () => {
  it('applies defaults for an empty object', () => {
    const parsed = fbtMerchantConfigSchema.parse({});
    expect(parsed.allowAutomaticRecommendation).toBe(false);
    expect(parsed.recommendationCount).toBe(3);
    expect(parsed.syncFrequency).toBe('daily');
    expect(parsed.syncHourUtc).toBe(4);
    expect(parsed.syncWeekday).toBeNull();
    expect(parsed.productExcludedList).toEqual([]);
    expect(parsed.productsWidgetDisabledList).toEqual([]);
  });

  it('bounds syncHourUtc to 0..23', () => {
    expect(fbtMerchantConfigSchema.safeParse({ syncHourUtc: 0 }).success).toBe(true);
    expect(fbtMerchantConfigSchema.safeParse({ syncHourUtc: 23 }).success).toBe(true);
    expect(fbtMerchantConfigSchema.safeParse({ syncHourUtc: 24 }).success).toBe(false);
    expect(fbtMerchantConfigSchema.safeParse({ syncHourUtc: -1 }).success).toBe(false);
  });

  it('bounds syncWeekday to 0..6 and allows null', () => {
    expect(fbtMerchantConfigSchema.safeParse({ syncWeekday: 0 }).success).toBe(true);
    expect(fbtMerchantConfigSchema.safeParse({ syncWeekday: 6 }).success).toBe(true);
    expect(fbtMerchantConfigSchema.safeParse({ syncWeekday: 7 }).success).toBe(false);
    expect(fbtMerchantConfigSchema.safeParse({ syncWeekday: null }).success).toBe(true);
  });

  it('requires syncWeekday when syncFrequency is weekly', () => {
    expect(
      fbtMerchantConfigSchema.safeParse({ syncFrequency: 'weekly', syncWeekday: null }).success,
    ).toBe(false);
    expect(
      fbtMerchantConfigSchema.safeParse({ syncFrequency: 'weekly', syncWeekday: 3 }).success,
    ).toBe(true);
  });

  it('bounds recommendationCount to 1..10', () => {
    expect(fbtMerchantConfigSchema.safeParse({ recommendationCount: 1 }).success).toBe(true);
    expect(fbtMerchantConfigSchema.safeParse({ recommendationCount: 10 }).success).toBe(true);
    expect(fbtMerchantConfigSchema.safeParse({ recommendationCount: 0 }).success).toBe(false);
    expect(fbtMerchantConfigSchema.safeParse({ recommendationCount: 11 }).success).toBe(false);
  });
});
