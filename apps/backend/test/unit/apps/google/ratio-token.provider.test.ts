import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { RatioOAuthCreds, RatioOAuthHttp } from '../../../../src/modules/google/google-oauth/ratio-oauth.http';
import { RatioTokenProvider } from '../../../../src/modules/google/google-oauth/ratio-token.provider';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';

/**
 * Fake Kysely handle: `selectFrom(...).selectAll().where(...).executeTakeFirst()`
 * returns the seeded row, and `updateTable(...).set(values).where(...).execute()`
 * records the values it was handed so the test can assert the persisted rotation.
 */
function fakeHandle(
  row: Record<string, unknown> | undefined,
  updates: Record<string, unknown>[],
): KyselyClient<GoogleDatabase> {
  const selectChain = {
    selectAll: () => selectChain,
    select: () => selectChain,
    where: () => selectChain,
    executeTakeFirst: async () => row,
  };
  const updateChain = {
    set: (values: Record<string, unknown>) => {
      updates.push(values);
      return updateChain;
    },
    where: () => updateChain,
    execute: async () => undefined,
  };
  return {
    db: {
      selectFrom: () => selectChain,
      updateTable: () => updateChain,
    },
  } as unknown as KyselyClient<GoogleDatabase>;
}

// Identity-ish crypto: prefix on encrypt, strip on decrypt — lets the test assert
// the provider re-encrypted the NEW values (not the stale ones).
const crypto = {
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\(/, '').replace(/\)$/, ''),
} as unknown as CryptoService;

const creds: RatioOAuthCreds = { clientId: 'cid', clientSecret: 'csecret' };

describe('RatioTokenProvider.getAccessToken', () => {
  it('returns the stored token without refreshing when it is still valid', async () => {
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle(
      {
        merchantId: 'm1',
        accessTokenEnc: 'enc(at-valid)',
        refreshTokenEnc: 'enc(rt-valid)',
        // Comfortably > 60s in the future.
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
      updates,
    );
    const http = {
      refresh: vi.fn(async () => {
        throw new Error('refresh must NOT be called for a valid token');
      }),
    } as unknown as RatioOAuthHttp;

    const provider = new RatioTokenProvider(handle, crypto, http, creds);
    const token = await provider.getAccessToken('m1');

    expect(token).toBe('at-valid');
    expect(http.refresh).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('refreshes, persists the rotated access+refresh+expiry, and returns the new token', async () => {
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle(
      {
        merchantId: 'm1',
        accessTokenEnc: 'enc(at-old)',
        refreshTokenEnc: 'enc(rt-old)',
        // Within the 60s skew window → treated as expired.
        expiresAt: new Date(Date.now() + 30_000),
      },
      updates,
    );
    const refresh = vi.fn(async () => ({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresIn: 3600,
    }));
    const http = { refresh } as unknown as RatioOAuthHttp;

    const before = Date.now();
    const provider = new RatioTokenProvider(handle, crypto, http, creds);
    const token = await provider.getAccessToken('m1');
    const after = Date.now();

    expect(token).toBe('at-new');
    // Refresh called with the DECRYPTED old refresh token + env creds.
    expect(refresh).toHaveBeenCalledWith('rt-old', { clientId: 'cid', clientSecret: 'csecret' });

    // Exactly one persisted update with the re-encrypted rotated values + new expiry.
    expect(updates).toHaveLength(1);
    const set = updates[0];
    expect(set.accessTokenEnc).toBe('enc(at-new)');
    expect(set.refreshTokenEnc).toBe('enc(rt-new)');
    const persistedExpiry = (set.expiresAt as Date).getTime();
    expect(persistedExpiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(persistedExpiry).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it('throws when the merchant has no token row', async () => {
    const provider = new RatioTokenProvider(
      fakeHandle(undefined, []),
      crypto,
      { refresh: vi.fn() } as unknown as RatioOAuthHttp,
      creds,
    );
    await expect(provider.getAccessToken('m1')).rejects.toThrow();
  });
});
