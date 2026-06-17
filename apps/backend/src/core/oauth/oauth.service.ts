// TODO(P1): Token refresh subsystem. We currently store encrypted access/refresh
// tokens and expires_at, but no code reads them back. The first outbound feature
// that needs a Ratio API call (e.g. fetching merchant order data) MUST implement:
//   1. getValidAccessToken(merchantId): decrypts, checks expiry, refreshes if needed
//   2. Per-merchant in-process lock + SELECT FOR UPDATE to prevent refresh races
//   3. Key-id envelope encryption so RATIO_<APP>_DATA_ENCRYPTION_KEY can rotate
// See review notes: "OAuth flow hardening pack" and "Token-refresh subsystem".

import { HttpException } from '@nestjs/common';
import {
  type RatioOauthTokenResponse,
  ratioOauthTokenResponseSchema,
} from '@ratio-app/shared/schemas/merchant';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { ZodType } from 'zod';
import type { CryptoService } from '../crypto/crypto.service';
import type { DatabaseWithMerchants } from '../merchants/merchant.types';
import type { RatioClient } from '../ratio-client/ratio.client';
import type { AppBootstrap } from './app-bootstrap.token';
import type { DatabaseWithOauthTokens } from './oauth-tokens.types';

export interface OAuthServiceDeps<DB> {
  db: Kysely<DB>;
  crypto: CryptoService;
  ratio: RatioClient;
  creds: { clientId: string; clientSecret: string; callbackUrl: string };
  bootstrap: AppBootstrap<DB>;
}

export class OAuthService<DB extends DatabaseWithMerchants & DatabaseWithOauthTokens> {
  constructor(private readonly deps: OAuthServiceDeps<DB>) {}

  async handleCallback(code: string): Promise<{ merchantId: string }> {
    if (!this.deps.creds.clientId || !this.deps.creds.clientSecret) {
      throw new HttpException(
        { message: 'app credentials missing', error_code: 'RATIO_CREDENTIALS_MISSING' },
        500,
      );
    }

    const tokenSchema =
      ratioOauthTokenResponseSchema as unknown as ZodType<RatioOauthTokenResponse>;
    const tokenResponse = await this.deps.ratio.request('/api/v1/oauth/token', tokenSchema, {
      method: 'POST',
      body: {
        grant_type: 'authorization_code',
        code,
        clientId: this.deps.creds.clientId,
        clientSecret: this.deps.creds.clientSecret,
        redirectUri: this.deps.creds.callbackUrl,
      },
    });

    const merchantId = tokenResponse.merchant_id;
    // Subtract a 60-second safety margin so we never store an expiresAt that
    // already accounts for network latency between the upstream token-endpoint
    // response and the row write. Floors at 0 in the unlikely case the
    // upstream returns a sub-60s `expires_in`.
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);
    const accessTokenEnc = this.deps.crypto.encrypt(tokenResponse.access_token);
    const refreshTokenEnc = this.deps.crypto.encrypt(tokenResponse.refresh_token);

    await this.deps.db.transaction().execute(async (trx) => {
      // Short lock-wait timeout: contended install callbacks should fail fast,
      // not pin a pool slot for 50s (mysql default). The trx-scoped SET
      // applies only to this connection so it doesn't leak to other queries.
      await sql`SET innodb_lock_wait_timeout = 5`.execute(trx);
      // S6: Serialize callback vs uninstall webhook against the same merchant
      // row. SELECT … FOR UPDATE acquires an exclusive row lock if the row
      // exists; under MySQL's default REPEATABLE READ isolation it ALSO
      // takes a next-key / gap lock on the index range covering merchantId
      // when the row doesn't yet exist (first install). Either way,
      // concurrent first-install callbacks for the same merchantId are
      // serialized — the second waits for the first transaction to commit
      // before its own INSERT … ON DUPLICATE KEY UPDATE proceeds, which
      // prevents duplicate-row races and keeps the uninstall webhook's
      // symmetric lock on the same row deterministic.
      await sql`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`.execute(trx);

      await trx
        .insertInto('merchants' as never)
        .values({ id: merchantId, isActive: true, uninstalledAt: null } as never)
        .onDuplicateKeyUpdate({
          isActive: true,
          uninstalledAt: null,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        } as never)
        .execute();

      await trx
        .insertInto('oauth_tokens' as never)
        .values({
          merchantId,
          accessTokenEnc,
          refreshTokenEnc,
          expiresAt,
          scopes: tokenResponse.scope,
        } as never)
        .onDuplicateKeyUpdate({
          accessTokenEnc,
          refreshTokenEnc,
          expiresAt,
          scopes: tokenResponse.scope,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        } as never)
        .execute();

      await this.deps.bootstrap.run(trx as Transaction<DB>, merchantId);
    });

    return { merchantId };
  }
}
