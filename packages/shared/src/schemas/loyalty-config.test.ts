import { describe, expect, it } from 'vitest';
import { loyaltyConfigInputSchema } from './loyalty-config';

describe('loyalty-config input schema', () => {
  it('applies defaults when only the minimum is provided', () => {
    const parsed = loyaltyConfigInputSchema.parse({});
    expect(parsed.programName).toBe('Coins');
    expect(parsed.baseEarnRate).toBe(1);
    expect(parsed.coinValueInr).toBe(0.1);
    expect(parsed.storefrontBaseUrl).toBeUndefined();
    expect(parsed.exportEmail).toBeUndefined();
  });

  it('accepts a full valid config and coerces numeric strings', () => {
    const parsed = loyaltyConfigInputSchema.parse({
      programName: 'Wellversed Coins',
      baseEarnRate: '2',
      coinValueInr: '0.25',
      storefrontBaseUrl: 'https://wellversed.in',
      exportEmail: 'ops@wellversed.in',
    });
    expect(parsed.baseEarnRate).toBe(2);
    expect(parsed.coinValueInr).toBe(0.25);
    expect(parsed.storefrontBaseUrl).toBe('https://wellversed.in');
  });

  it('rejects an empty programName', () => {
    expect(loyaltyConfigInputSchema.safeParse({ programName: '' }).success).toBe(false);
  });

  it('rejects non-positive and oversized rates', () => {
    expect(loyaltyConfigInputSchema.safeParse({ baseEarnRate: 0 }).success).toBe(false);
    expect(loyaltyConfigInputSchema.safeParse({ baseEarnRate: -1 }).success).toBe(false);
    expect(loyaltyConfigInputSchema.safeParse({ baseEarnRate: 1001 }).success).toBe(false);
    expect(loyaltyConfigInputSchema.safeParse({ coinValueInr: 0 }).success).toBe(false);
  });

  it('rejects a non-URL storefrontBaseUrl and invalid exportEmail', () => {
    expect(loyaltyConfigInputSchema.safeParse({ storefrontBaseUrl: 'wellversed' }).success).toBe(
      false,
    );
    expect(loyaltyConfigInputSchema.safeParse({ exportEmail: 'not-an-email' }).success).toBe(false);
  });
});
