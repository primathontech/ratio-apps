import type { Kysely, Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import {
  extractDomainFromJwt,
  OAuthService,
  type OAuthServiceDeps,
} from '../../../../src/core/oauth/oauth.service';
import type { DatabaseWithOauthTokens } from '../../../../src/core/oauth/oauth-tokens.types';

type TestDB = DatabaseWithMerchants & DatabaseWithOauthTokens;

/**
 * Fake Kysely client for the REAL OAuthService class. handleCallback wraps its
 * writes in `db.transaction().execute(cb)` and the transaction callback opens
 * with `sql\`SET innodb_lock_wait_timeout = 5\`.execute(trx)` — Kysely's
 * RawBuilder delegates that through `trx.getExecutor()`, so the trx fake
 * exposes a minimal executor that compiles to an empty query and resolves an
 * empty result, plus chainable `insertInto().values().onDuplicateKeyUpdate()`
 * builders for the merchants/oauth_tokens upserts. Only the methods the
 * service actually touches are implemented.
 */
function fakeDb() {
  const executor = {
    transformQuery: (node: unknown) => node,
    compileQuery: () => ({ query: { sql: '', parameters: [] }, queryId: undefined }),
    executeQuery: async () => ({ rows: [] }),
  };

  const insertChain = {
    values: () => insertChain,
    onDuplicateKeyUpdate: () => insertChain,
    execute: async () => [{ numInsertedOrUpdatedRows: 1n }],
  };

  const trx = {
    getExecutor: () => executor,
    insertInto: () => insertChain,
  } as unknown as Transaction<TestDB>;

  return {
    db: {
      transaction: () => ({
        execute: async (cb: (trx: Transaction<TestDB>) => Promise<unknown>) => cb(trx),
      }),
    } as unknown as Kysely<TestDB>,
  };
}

/** Builds a real OAuthService whose ratio/db/crypto/bootstrap deps are fakes. */
function makeService(tokenResponse: Record<string, unknown>) {
  const db = fakeDb();
  const ratio = { request: vi.fn().mockResolvedValue(tokenResponse) };
  const crypto = { encrypt: vi.fn((s: string) => `enc:${s}`) };
  const bootstrap = { run: vi.fn().mockResolvedValue(undefined) };

  const deps = {
    db: db.db,
    crypto,
    ratio,
    creds: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      callbackUrl: 'http://localhost:3000/unicommerce/api/v1/oauth/callback',
    },
    bootstrap,
  } as unknown as OAuthServiceDeps<TestDB>;

  return { svc: new OAuthService<TestDB>(deps), ratio };
}

/** Builds a real-shaped JWT (header.payload.signature) around an arbitrary payload. */
function jwtWith(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return `${header}.${body}.sig`;
}

const baseToken = {
  access_token: 'header.payload.sig',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh-token',
  scope: 'read_products',
  merchant_id: 'm1',
};

describe('OAuthService.handleCallback storeDomain', () => {
  it('returns merchantStoreId as storeDomain when the token response includes it', async () => {
    const { svc } = makeService({ ...baseToken, merchantStoreId: 'https://bblunt.com' });

    await expect(svc.handleCallback('code-1')).resolves.toEqual({
      merchantId: 'm1',
      storeDomain: 'https://bblunt.com',
    });
  });

  it('falls back to a domain decoded from the access-token JWT when merchantStoreId is absent', async () => {
    const { svc } = makeService({
      ...baseToken,
      access_token: jwtWith({ merchant_id: 'm1', domain: 'https://wellversed.com' }),
    });

    const result = await svc.handleCallback('code-1');

    expect(result.storeDomain).toBe('https://wellversed.com');
  });

  it('returns storeDomain undefined when neither merchantStoreId nor a JWT domain claim is present', async () => {
    const { svc } = makeService({
      ...baseToken,
      access_token: jwtWith({ merchant_id: 'm1' }),
    });

    const result = await svc.handleCallback('code-1');

    expect(result).toEqual({ merchantId: 'm1', storeDomain: undefined });
  });
});

describe('extractDomainFromJwt', () => {
  it('prefers domain over store_url over store', () => {
    expect(
      extractDomainFromJwt(
        jwtWith({ domain: 'https://a.com', store_url: 'https://b.com', store: 'https://c.com' }),
      ),
    ).toBe('https://a.com');
    expect(extractDomainFromJwt(jwtWith({ store_url: 'https://b.com' }))).toBe('https://b.com');
    expect(extractDomainFromJwt(jwtWith({ store: 'https://c.com' }))).toBe('https://c.com');
  });

  it('returns undefined for a malformed token', () => {
    expect(extractDomainFromJwt('not-a-jwt')).toBeUndefined();
    expect(extractDomainFromJwt('a.b')).toBeUndefined();
    // Three segments but the payload is not valid JSON.
    expect(extractDomainFromJwt('a.b.c')).toBeUndefined();
  });

  it('returns undefined when the claim exists but is not a string', () => {
    expect(extractDomainFromJwt(jwtWith({ domain: 42 }))).toBeUndefined();
  });
});
