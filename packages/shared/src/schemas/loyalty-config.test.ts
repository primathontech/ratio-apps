import { describe, expect, it } from 'vitest';
import { LOYALTY_PROGRAM_NAME, loyaltyConfigInputSchema } from './loyalty-config';

describe('loyalty-config input schema', () => {
  it('accepts an empty config — both fields are optional', () => {
    const parsed = loyaltyConfigInputSchema.parse({});
    expect(parsed.storefrontBaseUrl).toBeUndefined();
    expect(parsed.exportEmail).toBeUndefined();
  });

  it('accepts a full valid config', () => {
    const parsed = loyaltyConfigInputSchema.parse({
      storefrontBaseUrl: 'https://wellversed.in',
      exportEmail: 'ops@wellversed.in',
    });
    expect(parsed.storefrontBaseUrl).toBe('https://wellversed.in');
    expect(parsed.exportEmail).toBe('ops@wellversed.in');
  });

  it('rejects a non-URL storefrontBaseUrl and invalid exportEmail', () => {
    expect(loyaltyConfigInputSchema.safeParse({ storefrontBaseUrl: 'wellversed' }).success).toBe(
      false,
    );
    expect(loyaltyConfigInputSchema.safeParse({ exportEmail: 'not-an-email' }).success).toBe(false);
  });

  // Core Loyalty owns naming, the earn rate and coin valuation — the app must
  // not accept them back as merchant-editable config (removed 2026-07-31).
  it('strips Core-owned fields instead of storing them', () => {
    const parsed = loyaltyConfigInputSchema.parse({
      programName: 'Wellversed Coins',
      baseEarnRate: 2,
      coinValueInr: 0.25,
      storefrontBaseUrl: 'https://wellversed.in',
    });
    expect(parsed).toEqual({ storefrontBaseUrl: 'https://wellversed.in' });
    expect('programName' in parsed).toBe(false);
    expect('baseEarnRate' in parsed).toBe(false);
    expect('coinValueInr' in parsed).toBe(false);
  });
});

describe('LOYALTY_PROGRAM_NAME', () => {
  it('is the constant served on the wire in place of the removed config field', () => {
    // The deployed loyalty-sdk claim widget renders `Earn {points} {name}`, so
    // the field must keep arriving — just no longer per-merchant.
    expect(LOYALTY_PROGRAM_NAME).toBe('Coins');
  });
});
