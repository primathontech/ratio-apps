import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { MetaDatabase } from '../db/types';
import { META_DB_TOKEN } from '../kysely.module';
import { META_CRYPTO, META_RATIO_OAUTH_CREDS, META_RATIO_OAUTH_HTTP } from '../tokens';
import type { RatioOAuthCreds, RatioOAuthHttp } from '../../../core/oauth/ratio-oauth.http';

const EXPIRY_SKEW_MS = 60_000;

@Injectable()
export class MetaRatioTokenProvider {
  constructor(
    @Inject(META_DB_TOKEN) private readonly handle: KyselyClient<MetaDatabase>,
    @Inject(META_CRYPTO) private readonly crypto: CryptoService,
    @Inject(META_RATIO_OAUTH_HTTP) private readonly http: RatioOAuthHttp,
    @Inject(META_RATIO_OAUTH_CREDS) private readonly creds: RatioOAuthCreds,
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
