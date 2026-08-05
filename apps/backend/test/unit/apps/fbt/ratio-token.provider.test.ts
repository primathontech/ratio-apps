import { describe, expect, it } from 'vitest';
import { FbtRatioTokenProvider } from '../../../../src/modules/fbt/oauth/ratio-token.provider';

const CREDS = { clientId: 'cid', clientSecret: 'secret' };

/** Reversible fake crypto so tests can assert on what was stored. */
const crypto = {
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(/, '').replace(/\)$/, ''),
} as never;

function fakeHandle(row: Record<string, unknown> | undefined) {
  const updates: Array<Record<string, unknown>> = [];
  const chain = {
    selectAll: () => chain,
    where: () => chain,
    set: (values: Record<string, unknown>) => {
      updates.push(values);
      return chain;
    },
    executeTakeFirst: async () => row,
    execute: async () => [],
  };
  const db = { selectFrom: () => chain, updateTable: () => chain };
  return { handle: { db } as never, updates };
}

function fakeHttp(response = { accessToken: 'new-at', refreshToken: 'new-rt', expiresIn: 3600 }) {
  const calls: string[] = [];
  const http = {
    async refresh(refreshToken: string) {
      calls.push(refreshToken);
      return response;
    },
  } as never;
  return { http, calls };
}

const FRESH_ROW = {
  merchantId: 'm-1',
  accessTokenEnc: 'enc(live-at)',
  refreshTokenEnc: 'enc(live-rt)',
  expiresAt: new Date(Date.now() + 3600_000),
};

const EXPIRED_ROW = {
  merchantId: 'm-1',
  accessTokenEnc: 'enc(old-at)',
  refreshTokenEnc: 'enc(old-rt)',
  expiresAt: new Date(Date.now() - 1000),
};

describe('FbtRatioTokenProvider.getAccessToken', () => {
  it('returns the decrypted stored token when it is still valid', async () => {
    const { handle, updates } = fakeHandle(FRESH_ROW);
    const { http, calls } = fakeHttp();
    const token = await new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken(
      'm-1',
    );

    expect(token).toBe('live-at');
    expect(calls).toEqual([]); // no refresh needed
    expect(updates).toEqual([]); // no write
  });

  it('refreshes when the token is expired', async () => {
    const { handle } = fakeHandle(EXPIRED_ROW);
    const { http, calls } = fakeHttp();
    const token = await new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken(
      'm-1',
    );

    expect(token).toBe('new-at');
    expect(calls).toEqual(['old-rt']);
  });

  it('refreshes when the token expires inside the skew window', async () => {
    // 30s of life left, skew is 60s — must refresh rather than hand back a token
    // that dies mid-request.
    const { handle } = fakeHandle({
      ...FRESH_ROW,
      expiresAt: new Date(Date.now() + 30_000),
    });
    const { http, calls } = fakeHttp();
    await new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken('m-1');

    expect(calls).toEqual(['live-rt']);
  });

  it('persists the ROTATED refresh token — Ratio refresh tokens are single-use', async () => {
    const { handle, updates } = fakeHandle(EXPIRED_ROW);
    const { http } = fakeHttp();
    await new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken('m-1');

    // Failing to store the new refresh token breaks the merchant permanently
    // once the access token lapses: the old refresh token is already dead.
    expect(updates[0]?.refreshTokenEnc).toBe('enc(new-rt)');
    expect(updates[0]?.accessTokenEnc).toBe('enc(new-at)');
  });

  it('stores both tokens encrypted, never in plaintext', async () => {
    const { handle, updates } = fakeHandle(EXPIRED_ROW);
    const { http } = fakeHttp();
    await new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken('m-1');

    const written = JSON.stringify(updates[0]);
    expect(written).not.toContain('"new-at"');
    expect(written).not.toContain('"new-rt"');
  });

  it('writes a future expiry derived from expiresIn', async () => {
    const { handle, updates } = fakeHandle(EXPIRED_ROW);
    const { http } = fakeHttp({ accessToken: 'a', refreshToken: 'r', expiresIn: 7200 });
    const before = Date.now();
    await new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken('m-1');

    const expiresAt = updates[0]?.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(before + 7000_000);
  });

  it('throws when the merchant has no oauth_tokens row', async () => {
    const { handle } = fakeHandle(undefined);
    const { http } = fakeHttp();
    await expect(
      new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken('nope'),
    ).rejects.toThrow(/no Ratio oauth_tokens row/);
  });

  it('refreshes when expiresAt is null rather than assuming validity', async () => {
    const { handle } = fakeHandle({ ...FRESH_ROW, expiresAt: null });
    const { http, calls } = fakeHttp();
    await new FbtRatioTokenProvider(handle, crypto, http, CREDS).getAccessToken('m-1');

    // An unknown expiry must not be treated as "still good" — that would send a
    // possibly-dead token upstream and surface as an opaque 401.
    expect(calls).toEqual(['live-rt']);
  });
});
