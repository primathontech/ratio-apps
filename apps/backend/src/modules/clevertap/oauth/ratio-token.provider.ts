import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { ClevertapDatabase } from '../db/types';
import { CLEVERTAP_DB_TOKEN } from '../kysely.module';
import {
  CLEVERTAP_CRYPTO,
  CLEVERTAP_RATIO_OAUTH_CREDS,
  CLEVERTAP_RATIO_OAUTH_HTTP,
} from '../tokens';
import type { RatioOAuthCreds, RatioOAuthHttp } from './ratio-oauth.http';

const EXPIRY_SKEW_MS = 60_000;

@Injectable()
export class RatioTokenProvider {
  constructor(
    @Inject(CLEVERTAP_DB_TOKEN) private readonly handle: KyselyClient<ClevertapDatabase>,
    @Inject(CLEVERTAP_CRYPTO) private readonly crypto: CryptoService,
    @Inject(CLEVERTAP_RATIO_OAUTH_HTTP) private readonly http: RatioOAuthHttp,
    @Inject(CLEVERTAP_RATIO_OAUTH_CREDS) private readonly creds: RatioOAuthCreds,
  ) {}

  async getAccessToken(merchantId: string, opts?: { forceRefresh?: boolean }): Promise<string> {
    const row = await this.handle.db
      .selectFrom('oauth_tokens')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!row) {
      throw new Error(`no Ratio oauth_tokens row for merchant ${merchantId}`);
    }

    const stillValid =
      !opts?.forceRefresh &&
      row.expiresAt &&
      new Date(row.expiresAt).getTime() - Date.now() > EXPIRY_SKEW_MS;
    if (stillValid) return this.crypto.decrypt(row.accessTokenEnc);

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
