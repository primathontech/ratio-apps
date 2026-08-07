import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { RatioOAuthCreds, RatioOAuthHttp } from '../../../../src/core/oauth/ratio-oauth.http';
import type { UnicommerceDatabase } from '../../../../src/modules/unicommerce/db/types';
import { UcRatioTokenProvider } from '../../../../src/modules/unicommerce/oauth/ratio-token.provider';

/**
 * Fake Kysely handle supporting both the non-locking fast-path read and the
 * `transaction(...).execute()` + `SELECT … FOR UPDATE` refresh path.
 *
 * - `row`        → returned by the non-locking fast-path select.
 * - `lockedRow`  → returned by the `forUpdate()` select inside the transaction
 *   (defaults to `row`). Set it to a DIFFERENT (valid) row to simulate another
 *   process having rotated the token while we waited for the lock.
 * - `updates`    → records every `.set(values)` so the test can assert rotation.
 */
function fakeHandle(opts: {
  row?: Record<string, unknown>;
  lockedRow?: Record<string, unknown>;
  updates: Record<string, unknown>[];
}): KyselyClient<UnicommerceDatabase> {
  const makeSelectChain = (locked: boolean): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      selectAll: () => chain,
      select: () => chain,
      where: () => chain,
      forUpdate: () => makeSelectChain(true),
      executeTakeFirst: async () => (locked ? (opts.lockedRow ?? opts.row) : opts.row),
    };
    return chain;
  };
  const updateChain = {
    set: (values: Record<string, unknown>) => {
      opts.updates.push(values);
      return updateChain;
    },
    where: () => updateChain,
    execute: async () => undefined,
  };
  const dbLike = {
    selectFrom: () => makeSelectChain(false),
    updateTable: () => updateChain,
    transaction: () => ({
      execute: async (cb: (trx: typeof dbLike) => Promise<unknown>) => cb(dbLike),
    }),
  };
  return { db: dbLike } as unknown as KyselyClient<UnicommerceDatabase>;
}

// Identity-ish crypto: prefix on encrypt, strip on decrypt — lets the test assert
// the provider re-encrypted the NEW values (not the stale ones).
const crypto = {
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\(/, '').replace(/\)$/, ''),
} as unknown as CryptoService;

const creds: RatioOAuthCreds = { clientId: 'cid', clientSecret: 'csecret' };

// A 401 the way RatioClient (core/ratio-client/ratio.client.ts) actually throws it: every
// non-2xx upstream response is wrapped as a 502 HttpException, with the REAL status nested
// in the response body's `details.status` — so callers must inspect that, not err.getStatus().
function upstream401(): HttpException {
  return new HttpException(
    {
      message: 'ratio upstream error',
      error_code: 'RATIO_UPSTREAM_ERROR',
      details: { status: 401 },
    },
    502,
  );
}

function upstream500(): HttpException {
  return new HttpException(
    {
      message: 'ratio upstream error',
      error_code: 'RATIO_UPSTREAM_ERROR',
      details: { status: 500 },
    },
    502,
  );
}

/** A row whose access token is comfortably inside its validity window. */
function validRow(accessTokenEnc: string, refreshTokenEnc: string): Record<string, unknown> {
  return {
    merchantId: 'm1',
    accessTokenEnc,
    refreshTokenEnc,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  };
}

describe('UcRatioTokenProvider.getAccessToken', () => {
  it('returns the stored token without refreshing when it is still valid', async () => {
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle({
      row: {
        merchantId: 'm1',
        accessTokenEnc: 'enc(at-valid)',
        refreshTokenEnc: 'enc(rt-valid)',
        // Comfortably > 60s in the future.
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
      updates,
    });
    const http = {
      refresh: vi.fn(async () => {
        throw new Error('refresh must NOT be called for a valid token');
      }),
    } as unknown as RatioOAuthHttp;

    const provider = new UcRatioTokenProvider(handle, crypto, http, creds);
    const token = await provider.getAccessToken('m1');

    expect(token).toBe('at-valid');
    expect(http.refresh).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('refreshes, persists the rotated access+refresh+expiry, and returns the new token', async () => {
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle({
      row: {
        merchantId: 'm1',
        accessTokenEnc: 'enc(at-old)',
        refreshTokenEnc: 'enc(rt-old)',
        // Within the 60s skew window → treated as expired.
        expiresAt: new Date(Date.now() + 30_000),
      },
      updates,
    });
    const refresh = vi.fn(async () => ({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresIn: 3600,
    }));
    const http = { refresh } as unknown as RatioOAuthHttp;

    const before = Date.now();
    const provider = new UcRatioTokenProvider(handle, crypto, http, creds);
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
    const provider = new UcRatioTokenProvider(
      fakeHandle({ row: undefined, updates: [] }),
      crypto,
      { refresh: vi.fn() } as unknown as RatioOAuthHttp,
      creds,
    );
    await expect(provider.getAccessToken('m1')).rejects.toThrow();
  });

  it('single-flights concurrent refreshes — refresh() runs exactly once for the same merchant', async () => {
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle({
      row: {
        merchantId: 'm1',
        accessTokenEnc: 'enc(at-old)',
        refreshTokenEnc: 'enc(rt-old)',
        expiresAt: new Date(Date.now() + 30_000), // expired (within skew)
      },
      updates,
    });
    // Slow refresh so both concurrent calls are in-flight before it resolves —
    // exercises the in-process single-flight (and stands in for the DB lock
    // serializing across processes).
    const refresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { accessToken: 'at-new', refreshToken: 'rt-new', expiresIn: 3600 };
    });
    const http = { refresh } as unknown as RatioOAuthHttp;

    const provider = new UcRatioTokenProvider(handle, crypto, http, creds);
    const [a, b] = await Promise.all([
      provider.getAccessToken('m1'),
      provider.getAccessToken('m1'),
    ]);

    expect(a).toBe('at-new');
    expect(b).toBe('at-new');
    // The single-use refresh token was presented to Ratio exactly ONCE.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
  });

  it('re-checks under the lock and does NOT refresh when another caller already rotated the token', async () => {
    const updates: Record<string, unknown>[] = [];
    // Fast-path read sees an expired token, but the locked (FOR UPDATE) read
    // returns a freshly-rotated valid token — simulating another process that
    // refreshed while we were blocked on the row lock.
    const handle = fakeHandle({
      row: {
        merchantId: 'm1',
        accessTokenEnc: 'enc(at-stale)',
        refreshTokenEnc: 'enc(rt-stale)',
        expiresAt: new Date(Date.now() + 30_000), // expired
      },
      lockedRow: {
        merchantId: 'm1',
        accessTokenEnc: 'enc(at-fresh)',
        refreshTokenEnc: 'enc(rt-fresh)',
        expiresAt: new Date(Date.now() + 10 * 60_000), // valid
      },
      updates,
    });
    const refresh = vi.fn(async () => {
      throw new Error('refresh must NOT be called — token already rotated under lock');
    });
    const http = { refresh } as unknown as RatioOAuthHttp;

    const provider = new UcRatioTokenProvider(handle, crypto, http, creds);
    const token = await provider.getAccessToken('m1');

    expect(token).toBe('at-fresh');
    expect(refresh).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

describe('UcRatioTokenProvider.forceRefresh', () => {
  it('refreshes unconditionally even when the stored token is NOT yet expired', async () => {
    // The core self-healing case: our row says "still valid" (10 min out), but the real
    // credential is already dead server-side because another environment refreshed it.
    // getAccessToken alone would just return the (dead) cached token forever; forceRefresh
    // must bypass the isValid double-check and always hit the refresh endpoint.
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle({ row: validRow('enc(at-stale)', 'enc(rt-stale)'), updates });
    const refresh = vi.fn(async () => ({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresIn: 3600,
    }));
    const provider = new UcRatioTokenProvider(
      handle,
      crypto,
      { refresh } as unknown as RatioOAuthHttp,
      creds,
    );

    const token = await provider.forceRefresh('m1');

    expect(token).toBe('at-new');
    expect(refresh).toHaveBeenCalledTimes(1);
    // The rotated pair was persisted.
    expect(updates).toHaveLength(1);
    expect(updates[0].accessTokenEnc).toBe('enc(at-new)');
    expect(updates[0].refreshTokenEnc).toBe('enc(rt-new)');
  });
});

describe('UcRatioTokenProvider.withAuthRetry', () => {
  it('returns the result on the first try when fn succeeds (no refresh at all)', async () => {
    const handle = fakeHandle({ row: validRow('enc(at-valid)', 'enc(rt-valid)'), updates: [] });
    const refresh = vi.fn(async () => {
      throw new Error('refresh must NOT be called when fn succeeds');
    });
    const provider = new UcRatioTokenProvider(
      handle,
      crypto,
      { refresh } as unknown as RatioOAuthHttp,
      creds,
    );
    const fn = vi.fn(async () => 'ok-result');

    const result = await provider.withAuthRetry('m1', fn);

    expect(result).toBe('ok-result');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('at-valid');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('on a 401 from fn, forces a refresh and retries fn once with the new token', async () => {
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle({ row: validRow('enc(at-stale)', 'enc(rt-stale)'), updates });
    const refresh = vi.fn(async () => ({
      accessToken: 'at-fresh',
      refreshToken: 'rt-fresh',
      expiresIn: 3600,
    }));
    const provider = new UcRatioTokenProvider(
      handle,
      crypto,
      { refresh } as unknown as RatioOAuthHttp,
      creds,
    );
    const fn = vi.fn().mockRejectedValueOnce(upstream401()).mockResolvedValueOnce('ok-after-retry');

    const result = await provider.withAuthRetry('m1', fn);

    expect(result).toBe('ok-after-retry');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'at-stale');
    expect(fn).toHaveBeenNthCalledWith(2, 'at-fresh');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
  });

  it('rethrows immediately on a non-401 HttpException, without attempting any refresh', async () => {
    const handle = fakeHandle({ row: validRow('enc(at-valid)', 'enc(rt-valid)'), updates: [] });
    const refresh = vi.fn();
    const provider = new UcRatioTokenProvider(
      handle,
      crypto,
      { refresh } as unknown as RatioOAuthHttp,
      creds,
    );
    const err = upstream500();
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(provider.withAuthRetry('m1', fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('rethrows a plain (non-HttpException) error immediately, without attempting any refresh', async () => {
    const handle = fakeHandle({ row: validRow('enc(at-valid)', 'enc(rt-valid)'), updates: [] });
    const refresh = vi.fn();
    const provider = new UcRatioTokenProvider(
      handle,
      crypto,
      { refresh } as unknown as RatioOAuthHttp,
      creds,
    );
    const err = new Error('some unrelated network error');
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(provider.withAuthRetry('m1', fn)).rejects.toBe(err);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('throws one clear RATIO_AUTH_DEAD_NEEDS_REINSTALL error when the retry ALSO 401s', async () => {
    const updates: Record<string, unknown>[] = [];
    const handle = fakeHandle({ row: validRow('enc(at-stale)', 'enc(rt-stale)'), updates });
    const refresh = vi.fn(async () => ({
      accessToken: 'at-fresh',
      refreshToken: 'rt-fresh',
      expiresIn: 3600,
    }));
    const provider = new UcRatioTokenProvider(
      handle,
      crypto,
      { refresh } as unknown as RatioOAuthHttp,
      creds,
    );
    const fn = vi.fn(async () => {
      throw upstream401();
    });

    await expect(provider.withAuthRetry('m1', fn)).rejects.toThrow(
      'RATIO_AUTH_DEAD_NEEDS_REINSTALL',
    );
    expect(fn).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('throws one clear RATIO_AUTH_DEAD_NEEDS_REINSTALL error when the forced refresh itself fails (dead refresh token)', async () => {
    const handle = fakeHandle({ row: validRow('enc(at-stale)', 'enc(rt-stale)'), updates: [] });
    const refresh = vi.fn(async () => {
      throw new Error('Ratio token endpoint error: Invalid refresh token');
    });
    const provider = new UcRatioTokenProvider(
      handle,
      crypto,
      { refresh } as unknown as RatioOAuthHttp,
      creds,
    );
    const fn = vi.fn(async () => {
      throw upstream401();
    });

    await expect(provider.withAuthRetry('m1', fn)).rejects.toThrow(
      'RATIO_AUTH_DEAD_NEEDS_REINSTALL',
    );
    expect(fn).toHaveBeenCalledTimes(1); // never gets to retry — refresh itself failed
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
