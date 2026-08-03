import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { RpRatioTokenProvider } from './ratio-token.provider';

// Minimal fake Kysely handle: supports the exact chain calls ratio-token.provider.ts uses
// (selectFrom/selectAll/where/executeTakeFirst on the plain db, and the same chain plus
// forUpdate inside a transaction, plus updateTable/set/where/execute inside the transaction).
function makeFakeHandle(row: { accessTokenEnc: string; refreshTokenEnc: string; expiresAt: Date }) {
  let current = { ...row };
  const updateCalls: unknown[] = [];

  const plainSelect = {
    selectFrom: () => plainSelect,
    selectAll: () => plainSelect,
    where: () => plainSelect,
    executeTakeFirst: async () => ({ ...current }),
  };

  const txSelect = {
    selectFrom: () => txSelect,
    selectAll: () => txSelect,
    where: () => txSelect,
    forUpdate: () => txSelect,
    executeTakeFirst: async () => ({ ...current }),
  };

  const txUpdate = {
    set: (vals: Record<string, unknown>) => {
      updateCalls.push(vals);
      current = { ...current, ...vals } as typeof current;
      return txUpdate;
    },
    where: () => txUpdate,
    execute: async () => undefined,
  };

  const trx = {
    selectFrom: () => txSelect,
    updateTable: () => txUpdate,
  };

  const db = {
    selectFrom: () => plainSelect,
    transaction: () => ({
      execute: async (cb: (trx: unknown) => Promise<unknown>) => cb(trx),
    }),
  };

  return { handle: { db } as never, updateCalls, getCurrent: () => current };
}

function makeCrypto() {
  return {
    decrypt: (v: string) => `plain:${v}`,
    encrypt: (v: string) => `enc:${v}`,
  } as never;
}

function makeCreds() {
  return { clientId: 'client-1', clientSecret: 'secret-1' } as never;
}

// A 401 the way RatioClient (core/ratio-client/ratio.client.ts) actually throws it: every
// non-2xx upstream response is wrapped as a 502 HttpException, with the REAL status nested
// in the response body's `details.status` — so callers must inspect that, not err.getStatus().
function upstream401(): HttpException {
  return new HttpException(
    { message: 'ratio upstream error', error_code: 'RATIO_UPSTREAM_ERROR', details: { status: 401 } },
    502,
  );
}

function upstream500(): HttpException {
  return new HttpException(
    { message: 'ratio upstream error', error_code: 'RATIO_UPSTREAM_ERROR', details: { status: 500 } },
    502,
  );
}

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 1000);

describe('RpRatioTokenProvider.getAccessToken — unchanged existing behavior', () => {
  it('returns the decrypted cached token when still valid (no refresh call)', async () => {
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-1', refreshTokenEnc: 'rt-1', expiresAt: FUTURE });
    const http = { refresh: vi.fn() } as never;
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http, makeCreds());

    const token = await provider.getAccessToken('merchant-1');

    expect(token).toBe('plain:at-1');
    expect((http as { refresh: ReturnType<typeof vi.fn> }).refresh).not.toHaveBeenCalled();
  });

  it('refreshes when the cached token is expired', async () => {
    const { handle, getCurrent } = makeFakeHandle({ accessTokenEnc: 'at-old', refreshTokenEnc: 'rt-old', expiresAt: PAST });
    const http = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'at-new', refreshToken: 'rt-new', expiresIn: 3600 }),
    };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());

    const token = await provider.getAccessToken('merchant-1');

    expect(token).toBe('at-new');
    expect(http.refresh).toHaveBeenCalledTimes(1);
    expect(http.refresh).toHaveBeenCalledWith('plain:rt-old', { clientId: 'client-1', clientSecret: 'secret-1' });
    expect(getCurrent().accessTokenEnc).toBe('enc:at-new');
  });
});

describe('RpRatioTokenProvider.forceRefresh', () => {
  it('refreshes unconditionally even when the stored token is NOT yet expired', async () => {
    // This is the core self-healing case: our row says "still valid" (FUTURE), but the
    // real credential is already dead server-side because another environment refreshed it.
    // getAccessToken alone would just return the (dead) cached token forever; forceRefresh
    // must bypass that and always hit the refresh endpoint.
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-stale', refreshTokenEnc: 'rt-stale', expiresAt: FUTURE });
    const http = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'at-new', refreshToken: 'rt-new', expiresIn: 3600 }),
    };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());

    const token = await provider.forceRefresh('merchant-1');

    expect(token).toBe('at-new');
    expect(http.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('RpRatioTokenProvider.withAuthRetry', () => {
  it('returns the result on the first try when fn succeeds (no refresh at all)', async () => {
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-1', refreshTokenEnc: 'rt-1', expiresAt: FUTURE });
    const http = { refresh: vi.fn() };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());
    const fn = vi.fn().mockResolvedValue('ok-result');

    const result = await provider.withAuthRetry('merchant-1', fn);

    expect(result).toBe('ok-result');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('plain:at-1');
    expect(http.refresh).not.toHaveBeenCalled();
  });

  it('on a 401 from fn, forces a refresh and retries fn once with the new token', async () => {
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-stale', refreshTokenEnc: 'rt-stale', expiresAt: FUTURE });
    const http = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'at-fresh', refreshToken: 'rt-fresh', expiresIn: 3600 }),
    };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());
    const fn = vi.fn()
      .mockRejectedValueOnce(upstream401())
      .mockResolvedValueOnce('ok-after-retry');

    const result = await provider.withAuthRetry('merchant-1', fn);

    expect(result).toBe('ok-after-retry');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'plain:at-stale');
    expect(fn).toHaveBeenNthCalledWith(2, 'at-fresh');
    expect(http.refresh).toHaveBeenCalledTimes(1);
  });

  it('rethrows immediately on a non-401 error, without attempting any refresh', async () => {
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-1', refreshTokenEnc: 'rt-1', expiresAt: FUTURE });
    const http = { refresh: vi.fn() };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());
    const err = upstream500();
    const fn = vi.fn().mockRejectedValue(err);

    await expect(provider.withAuthRetry('merchant-1', fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(http.refresh).not.toHaveBeenCalled();
  });

  it('rethrows a plain (non-HttpException) error immediately, without attempting any refresh', async () => {
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-1', refreshTokenEnc: 'rt-1', expiresAt: FUTURE });
    const http = { refresh: vi.fn() };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());
    const err = new Error('some unrelated network error');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(provider.withAuthRetry('merchant-1', fn)).rejects.toBe(err);
    expect(http.refresh).not.toHaveBeenCalled();
  });

  it('throws one clear RATIO_AUTH_DEAD_NEEDS_REINSTALL error when the retry ALSO 401s', async () => {
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-stale', refreshTokenEnc: 'rt-stale', expiresAt: FUTURE });
    const http = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'at-fresh', refreshToken: 'rt-fresh', expiresIn: 3600 }),
    };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());
    const fn = vi.fn().mockRejectedValue(upstream401());

    await expect(provider.withAuthRetry('merchant-1', fn)).rejects.toThrow('RATIO_AUTH_DEAD_NEEDS_REINSTALL');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(http.refresh).toHaveBeenCalledTimes(1);
  });

  it('throws one clear RATIO_AUTH_DEAD_NEEDS_REINSTALL error when the forced refresh itself fails (dead refresh token)', async () => {
    const { handle } = makeFakeHandle({ accessTokenEnc: 'at-stale', refreshTokenEnc: 'rt-stale', expiresAt: FUTURE });
    const http = { refresh: vi.fn().mockRejectedValue(new Error('Ratio token endpoint error: Invalid refresh token')) };
    const provider = new RpRatioTokenProvider(handle, makeCrypto(), http as never, makeCreds());
    const fn = vi.fn().mockRejectedValue(upstream401());

    await expect(provider.withAuthRetry('merchant-1', fn)).rejects.toThrow('RATIO_AUTH_DEAD_NEEDS_REINSTALL');
    expect(fn).toHaveBeenCalledTimes(1); // never gets to retry — refresh itself failed
    expect(http.refresh).toHaveBeenCalledTimes(1);
  });
});
