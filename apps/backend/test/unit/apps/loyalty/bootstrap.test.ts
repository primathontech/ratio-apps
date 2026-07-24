import { describe, expect, it } from 'vitest';
import {
  generateClaimSecret,
  LoyaltyBootstrap,
} from '../../../../src/modules/loyalty/loyalty.bootstrap';

describe('generateClaimSecret', () => {
  it('returns a 32-byte base64 string (44 chars)', () => {
    const s = generateClaimSecret();
    expect(Buffer.from(s, 'base64')).toHaveLength(32);
  });
});

describe('LoyaltyBootstrap', () => {
  it('inserts a config row with a claim_signing_secret on install', async () => {
    const captured: Record<string, unknown>[] = [];
    const trx = {
      insertInto: () => ({
        values: (v: Record<string, unknown>) => {
          captured.push(v);
          return { onDuplicateKeyUpdate: () => ({ execute: async () => {} }) };
        },
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal trx stub
    await new LoyaltyBootstrap().run(trx as any, 'm1');
    expect(captured[0]?.merchantId).toBe('m1');
    expect(typeof captured[0]?.claimSigningSecret).toBe('string');
    expect(Buffer.from(String(captured[0]?.claimSigningSecret), 'base64')).toHaveLength(32);
  });
});
