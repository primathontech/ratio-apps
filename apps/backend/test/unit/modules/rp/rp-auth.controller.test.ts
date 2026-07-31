import { describe, expect, it, vi } from 'vitest';
import { RpAuthController } from '../../../../src/modules/rp/auth/rp-auth.controller';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;
}

function makeController(overrides: {
  tokenRes?: Record<string, unknown>;
  upsert?: ReturnType<typeof vi.fn>;
} = {}) {
  const tokenRes = {
    access_token: overrides.tokenRes?.access_token ?? fakeJwt({ merchant_id: 'm1' }),
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'refresh-token',
    scope: 'read_orders',
    merchant_id: 'm1',
    ...overrides.tokenRes,
  };
  const ratio = { request: vi.fn().mockResolvedValue(tokenRes) };
  const merchants = { upsert: overrides.upsert ?? vi.fn().mockResolvedValue(undefined) };
  const crypto = { encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s };
  const config = {
    get: (key: string) =>
      ({
        RATIO_RP_CLIENT_ID: 'client-id',
        RATIO_RP_CLIENT_SECRET: 'client-secret',
        RATIO_RP_CALLBACK_URL: 'https://adapter.example/rp/auth/callback',
        RATIO_RP_ADMIN_BASE_URL: 'https://adapter.example/admin',
      })[key],
  };
  const controller = new RpAuthController(
    merchants as never,
    crypto as never,
    ratio as never,
    config as never,
  );
  return { controller, merchants, ratio };
}

function makeReply() {
  return { redirect: vi.fn().mockResolvedValue(undefined) } as never;
}

describe('RpAuthController.callback — domain capture from the OAuth token response', () => {
  // THE regression: the token response schema only ever declared `merchantStoreId`
  // (per its own doc comment) as the field Ratio's OAuth response might carry the
  // real store domain under — but the callback code read `.domain` instead, a field
  // that was never part of the schema. Since RatioClient.request parses the response
  // through a Zod schema (which strips unknown keys by default), any real `domain` OR
  // `merchantStoreId` field Ratio actually sent was silently discarded before this
  // code ever saw it — meaning it always fell through to the merchant-ID placeholder
  // for any real install where the JWT itself didn't carry a domain-shaped claim.
  it('uses merchantStoreId from the token response as the domain when present', async () => {
    const { controller, merchants } = makeController({
      tokenRes: {
        access_token: fakeJwt({ merchant_id: 'm1' }), // no domain-shaped claim in the JWT
        merchant_id: 'm1',
        merchantStoreId: 'real-store.gokwik.co',
      },
    });

    await controller.callback('auth-code', makeReply());

    expect(merchants.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'm1', domain: 'real-store.gokwik.co' }),
    );
  });

  it('falls back to decoding the JWT for a domain/store_url/store claim when merchantStoreId is absent', async () => {
    const { controller, merchants } = makeController({
      tokenRes: {
        access_token: fakeJwt({ merchant_id: 'm1', store_url: 'from-jwt.gokwik.co' }),
        merchant_id: 'm1',
      },
    });

    await controller.callback('auth-code', makeReply());

    expect(merchants.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'm1', domain: 'from-jwt.gokwik.co' }),
    );
  });

  it('falls back to the merchant ID as a placeholder domain when neither merchantStoreId nor a JWT domain claim is available', async () => {
    const { controller, merchants } = makeController({
      tokenRes: {
        access_token: fakeJwt({ merchant_id: 'm1' }), // no domain-shaped claim
        merchant_id: 'm1',
      },
    });

    await controller.callback('auth-code', makeReply());

    expect(merchants.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'm1', domain: 'm1' }),
    );
  });

  it('prefers merchantStoreId over a domain-shaped JWT claim when both are present', async () => {
    const { controller, merchants } = makeController({
      tokenRes: {
        access_token: fakeJwt({ merchant_id: 'm1', store_url: 'from-jwt.gokwik.co' }),
        merchant_id: 'm1',
        merchantStoreId: 'from-token-response.gokwik.co',
      },
    });

    await controller.callback('auth-code', makeReply());

    expect(merchants.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'from-token-response.gokwik.co' }),
    );
  });
});
