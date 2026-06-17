import { UnauthorizedException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { GoogleAuthService } from '../../../../src/modules/google/google-oauth/google-auth.service';
import type {
  GoogleOAuthCreds,
  GoogleOAuthHttp,
} from '../../../../src/modules/google/google-oauth/google-oauth.http';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';

/**
 * AC2 — Google OAuth refresh + reconnect-on-failure for {@link GoogleAuthService}.
 *
 * The service constructor takes (handle, crypto, http, creds). We fake the
 * Kysely handle for exactly the chains `getAccessToken` walks:
 *   - selectFrom('google_configs').select([...]).where().executeTakeFirst()
 *   - selectFrom('google_credentials').selectAll().where().executeTakeFirst()
 *   - updateTable('google_credentials').set(s).where().execute()  ← .set() arg captured
 *
 * Every `.set()` argument is pushed onto `credentialUpdates` so a test can
 * assert what was written (the refreshed token, needsReconnect:false, or the
 * markReconnect needsReconnect:true).
 */

interface FakeHandle {
  client: KyselyClient<GoogleDatabase>;
  /** Captured `.set()` args from updateTable('google_credentials'). */
  credentialUpdates: Array<Record<string, unknown>>;
  /** Captured `.set()` args from updateTable('google_configs'). */
  configUpdates: Array<Record<string, unknown>>;
}

function makeFakeHandle(opts: {
  config?: Record<string, unknown> | null;
  cred?: Record<string, unknown> | null;
}): FakeHandle {
  const credentialUpdates: Array<Record<string, unknown>> = [];
  const configUpdates: Array<Record<string, unknown>> = [];

  const configSelectChain = {
    select: () => configSelectChain,
    selectAll: () => configSelectChain,
    where: () => configSelectChain,
    executeTakeFirst: async () => opts.config ?? undefined,
  };

  const credSelectChain = {
    select: () => credSelectChain,
    selectAll: () => credSelectChain,
    where: () => credSelectChain,
    executeTakeFirst: async () => opts.cred ?? undefined,
  };

  const makeUpdateChain = (sink: Array<Record<string, unknown>>) => {
    const chain = {
      set: (arg: Record<string, unknown>) => {
        sink.push(arg);
        return chain;
      },
      where: () => chain,
      execute: async () => [],
    };
    return chain;
  };

  const db = {
    selectFrom: (table: string) => {
      if (table === 'google_configs') return configSelectChain;
      if (table === 'google_credentials') return credSelectChain;
      throw new Error(`unexpected selectFrom("${table}")`);
    },
    updateTable: (table: string) => {
      if (table === 'google_credentials') return makeUpdateChain(credentialUpdates);
      if (table === 'google_configs') return makeUpdateChain(configUpdates);
      throw new Error(`unexpected updateTable("${table}")`);
    },
  } as unknown as Kysely<GoogleDatabase>;

  const client = {
    db,
    close: async () => {},
  } as unknown as KyselyClient<GoogleDatabase>;

  return { client, credentialUpdates, configUpdates };
}

/** Round-trip-free fake crypto: encrypt prefixes `enc:`, decrypt strips it. */
const fakeCrypto = {
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
} as unknown as CryptoService;

function makeHttp(): {
  refresh: ReturnType<typeof vi.fn>;
  exchangeCode: ReturnType<typeof vi.fn>;
  userEmail: ReturnType<typeof vi.fn>;
  serviceAccountToken: ReturnType<typeof vi.fn>;
} {
  return {
    refresh: vi.fn(),
    exchangeCode: vi.fn(),
    userEmail: vi.fn(),
    serviceAccountToken: vi.fn(),
  };
}

const creds: GoogleOAuthCreds = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.test/callback',
};

const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content';
const MERCHANT = 'mer_1';

function build(opts: {
  config?: Record<string, unknown> | null;
  cred?: Record<string, unknown> | null;
}) {
  const handle = makeFakeHandle(opts);
  const http = makeHttp();
  const svc = new GoogleAuthService(
    handle.client,
    fakeCrypto,
    http as unknown as GoogleOAuthHttp,
    creds,
  );
  return { svc, http, handle };
}

describe('GoogleAuthService.getAccessToken (AC2: OAuth refresh + reconnect-on-failure)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('manual connection mints a service-account token', async () => {
    const { svc, http } = build({
      config: { connectionMethod: 'manual', gmcServiceAccountKeyEnc: 'enc:{json}' },
    });
    http.serviceAccountToken.mockResolvedValue('sa-token');

    const token = await svc.getAccessToken(MERCHANT);

    expect(token).toBe('sa-token');
    // Called with the DECRYPTED key + a content scope.
    expect(http.serviceAccountToken).toHaveBeenCalledTimes(1);
    expect(http.serviceAccountToken).toHaveBeenCalledWith('{json}', [CONTENT_SCOPE]);
    expect(http.refresh).not.toHaveBeenCalled();
  });

  it('oauth with a still-valid token returns the stored access token (no refresh)', async () => {
    const { svc, http } = build({
      config: { connectionMethod: 'oauth', gmcServiceAccountKeyEnc: null },
      cred: {
        merchantId: MERCHANT,
        accessTokenEnc: 'enc:live',
        refreshTokenEnc: 'enc:rt',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        needsReconnect: false,
      },
    });

    const token = await svc.getAccessToken(MERCHANT);

    expect(token).toBe('live');
    expect(http.refresh).not.toHaveBeenCalled();
  });

  it('oauth with an expired token refreshes and stores the new token', async () => {
    const { svc, http, handle } = build({
      config: { connectionMethod: 'oauth', gmcServiceAccountKeyEnc: null },
      cred: {
        merchantId: MERCHANT,
        accessTokenEnc: 'enc:stale',
        refreshTokenEnc: 'enc:rt',
        expiresAt: new Date(Date.now() - 1000),
        needsReconnect: false,
      },
    });
    http.refresh.mockResolvedValue({
      accessToken: 'fresh',
      refreshToken: 'rt',
      expiresIn: 3600,
      scope: null,
    });

    const token = await svc.getAccessToken(MERCHANT);

    expect(token).toBe('fresh');
    // Refresh called with the DECRYPTED refresh token + creds.
    expect(http.refresh).toHaveBeenCalledTimes(1);
    expect(http.refresh).toHaveBeenCalledWith('rt', creds);
    // The captured update wrote the encrypted fresh token and cleared reconnect.
    expect(handle.credentialUpdates).toHaveLength(1);
    const set = handle.credentialUpdates[0]!;
    expect(set.accessTokenEnc).toBe('enc:fresh');
    expect(set.needsReconnect).toBe(false);
  });

  it('refresh failure marks needs_reconnect and throws GOOGLE_RECONNECT_REQUIRED', async () => {
    const { svc, http, handle } = build({
      config: { connectionMethod: 'oauth', gmcServiceAccountKeyEnc: null },
      cred: {
        merchantId: MERCHANT,
        accessTokenEnc: 'enc:stale',
        refreshTokenEnc: 'enc:rt',
        expiresAt: new Date(Date.now() - 1000),
        needsReconnect: false,
      },
    });
    http.refresh.mockRejectedValue(new Error('google said no'));

    await expect(svc.getAccessToken(MERCHANT)).rejects.toMatchObject({
      response: { error_code: 'GOOGLE_RECONNECT_REQUIRED' },
    });
    await expect(
      build({
        config: { connectionMethod: 'oauth', gmcServiceAccountKeyEnc: null },
        cred: {
          merchantId: MERCHANT,
          accessTokenEnc: 'enc:stale',
          refreshTokenEnc: 'enc:rt',
          expiresAt: new Date(Date.now() - 1000),
          needsReconnect: false,
        },
      }).svc.getAccessToken(MERCHANT),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // markReconnect captured a `set` flipping needsReconnect to true.
    expect(handle.credentialUpdates.some((s) => s.needsReconnect === true)).toBe(true);
  });

  it('oauth with no credentials row throws GOOGLE_NOT_CONNECTED', async () => {
    const { svc, http } = build({
      config: { connectionMethod: 'oauth', gmcServiceAccountKeyEnc: null },
      cred: null,
    });

    await expect(svc.getAccessToken(MERCHANT)).rejects.toMatchObject({
      response: { error_code: 'GOOGLE_NOT_CONNECTED' },
    });
    await expect(
      build({
        config: { connectionMethod: 'oauth', gmcServiceAccountKeyEnc: null },
        cred: null,
      }).svc.getAccessToken(MERCHANT),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(http.refresh).not.toHaveBeenCalled();
  });

  it('expired token with no refresh token marks reconnect and throws', async () => {
    const { svc, http, handle } = build({
      config: { connectionMethod: 'oauth', gmcServiceAccountKeyEnc: null },
      cred: {
        merchantId: MERCHANT,
        accessTokenEnc: 'enc:stale',
        refreshTokenEnc: null,
        expiresAt: new Date(Date.now() - 1000),
        needsReconnect: false,
      },
    });

    await expect(svc.getAccessToken(MERCHANT)).rejects.toMatchObject({
      response: { error_code: 'GOOGLE_RECONNECT_REQUIRED' },
    });
    // Never attempted a refresh — there was no refresh token.
    expect(http.refresh).not.toHaveBeenCalled();
    // markReconnect flipped needsReconnect to true.
    expect(handle.credentialUpdates.some((s) => s.needsReconnect === true)).toBe(true);
  });
});
