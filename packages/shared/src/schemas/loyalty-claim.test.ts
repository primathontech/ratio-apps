import { describe, expect, it } from 'vitest';
import { loyaltyClaimRequestSchema } from './loyalty-claim';

describe('loyaltyClaimRequestSchema', () => {
  const valid = { merchantId: 'm1', phone: '+919876543210', ts: 1_700_000_000_000, sig: 'abc123' };

  it('accepts a well-formed signed claim', () => {
    expect(loyaltyClaimRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a raw gkAccessToken-style body (old shape)', () => {
    expect(loyaltyClaimRequestSchema.safeParse({ gkAccessToken: 'x' }).success).toBe(false);
  });

  it('rejects extra keys (strict) and missing fields', () => {
    expect(loyaltyClaimRequestSchema.safeParse({ ...valid, phoneNumber: 'y' }).success).toBe(false);
    expect(loyaltyClaimRequestSchema.safeParse({ merchantId: 'm1' }).success).toBe(false);
  });

  it('requires ts to be a positive integer', () => {
    expect(loyaltyClaimRequestSchema.safeParse({ ...valid, ts: -1 }).success).toBe(false);
    expect(loyaltyClaimRequestSchema.safeParse({ ...valid, ts: 1.5 }).success).toBe(false);
  });
});
