import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { DelhiveryDatabase } from '../db/types';
import { DELHIVERY_DB_TOKEN } from '../kysely.module';
import {
  DELHIVERY_CRYPTO,
  DELHIVERY_RATIO_OAUTH_CREDS,
  DELHIVERY_RATIO_OAUTH_HTTP,
} from '../tokens';
import type { RatioOAuthCreds, RatioOAuthHttp } from './ratio-oauth.http';

/** Refresh when the stored access token has < this many ms of life left. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Resolves a usable Ratio (OpenStore) merchant access token for orders/products
 * calls. Reads the merchant's `oauth_tokens` row; if the stored access token is
 * valid for more than {@link EXPIRY_SKEW_MS}, decrypts and returns it. Otherwise
 * it refreshes via {@link RatioOAuthHttp} and PERSISTS the rotated access AND
 * refresh tokens (re-encrypted) plus the new expiry — Ratio refresh tokens are
 * single-use, so the old one is now invalid and must be overwritten.
 * (Mirrors the wizzy module's provider.)
 */
@Injectable()
export class RatioTokenProvider {
  constructor(
    @Inject(DELHIVERY_DB_TOKEN) private readonly handle: KyselyClient<DelhiveryDatabase>,
    @Inject(DELHIVERY_CRYPTO) private readonly crypto: CryptoService,
    @Inject(DELHIVERY_RATIO_OAUTH_HTTP) private readonly http: RatioOAuthHttp,
    @Inject(DELHIVERY_RATIO_OAUTH_CREDS) private readonly creds: RatioOAuthCreds,
  ) {}

  async getAccessToken(merchantId: string): Promise<string> {
    const row = await this.handle.db
      .selectFrom('oauth_tokens')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!row) {
      throw new Error(`no Ratio oauth_tokens row for merchant ${merchantId}`);
    }

    const stillValid =
      row.expiresAt && new Date(row.expiresAt).getTime() - Date.now() > EXPIRY_SKEW_MS;
    if (stillValid) return this.crypto.decrypt(row.accessTokenEnc);

    // Expired / near-expiry → refresh + rotate. Both tokens come back NEW.
    const refreshed = await this.http.refresh(this.crypto.decrypt(row.refreshTokenEnc), {
      clientId: this.creds.clientId,
      clientSecret: this.creds.clientSecret,
    });
    const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

    await this.handle.db
      .updateTable('oauth_tokens')
      .set({
        accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
        refreshTokenEnc: this.crypto.encrypt(refreshed.refreshToken),
        expiresAt,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('merchantId', '=', merchantId)
      .execute();

    return refreshed.accessToken;
  }
}
