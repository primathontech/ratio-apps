import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { RP_DB_TOKEN } from '../kysely.module';
import type { RpDatabase, RpMerchantRow } from '../db/types';

@Injectable()
export class RpMerchantsService {
  constructor(@Inject(RP_DB_TOKEN) private readonly handle: KyselyClient<RpDatabase>) {}

  async findByDomain(domain: string): Promise<RpMerchantRow | undefined> {
    return this.handle.db
      .selectFrom('return_prime_merchants')
      .selectAll()
      .where('domain', '=', domain)
      .where('active', '=', true)
      .executeTakeFirst();
  }

  async findByMerchantId(merchantId: string): Promise<RpMerchantRow | undefined> {
    return this.handle.db
      .selectFrom('return_prime_merchants')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
  }

  async upsert(data: {
    merchantId: string;
    domain: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.handle.db
      .insertInto('return_prime_merchants')
      .values({
        merchantId: data.merchantId,
        domain: data.domain,
        accessTokenEnc: data.accessTokenEnc,
        refreshTokenEnc: data.refreshTokenEnc,
        expiresAt: data.expiresAt,
        active: true,
      })
      .onDuplicateKeyUpdate({
        domain: data.domain,
        accessTokenEnc: data.accessTokenEnc,
        refreshTokenEnc: data.refreshTokenEnc,
        expiresAt: data.expiresAt,
        active: true,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();
  }

  async updateTokens(
    merchantId: string,
    data: { accessTokenEnc: string; refreshTokenEnc: string; expiresAt: Date },
  ): Promise<void> {
    await this.handle.db
      .updateTable('return_prime_merchants')
      .set({
        accessTokenEnc: data.accessTokenEnc,
        refreshTokenEnc: data.refreshTokenEnc,
        expiresAt: data.expiresAt,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .execute();
  }
}
