import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { UC_DB_TOKEN } from '../kysely.module';
import { UC_CRYPTO } from '../tokens';
import type { UnicommerceDatabase, UcCredentialsRow } from '../db/types';

export interface UcCredentialsInput {
  merchantId: string;
  tenantSlug: string;
  username: string;
  password: string;
  facilityCode: string;
}

export interface UcCredentialsData {
  merchantId: string;
  tenantSlug: string;
  facilityCode: string;
  active: boolean;
  killSwitch: boolean;
}

@Injectable()
export class UcCredentialsService {
  private readonly logger = new Logger(UcCredentialsService.name);

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    @Inject(UC_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  async save(input: UcCredentialsInput): Promise<void> {
    const usernameEnc = this.crypto.encrypt(input.username);
    const passwordEnc = this.crypto.encrypt(input.password);
    await this.handle.db
      .insertInto('uc_credentials')
      .values({
        merchantId: input.merchantId,
        tenantSlug: input.tenantSlug,
        usernameEnc,
        passwordEnc,
        facilityCode: input.facilityCode,
        active: true,
      })
      .onDuplicateKeyUpdate({
        tenantSlug: input.tenantSlug,
        usernameEnc,
        passwordEnc,
        facilityCode: input.facilityCode,
        active: true,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();
    this.logger.log({ msg: 'UC credentials saved', merchantId: input.merchantId });
  }

  async getDecrypted(merchantId: string): Promise<{
    tenantSlug: string;
    username: string;
    password: string;
    facilityCode: string;
    oauthAccessTokenEnc: string | null;
    oauthRefreshTokenEnc: string | null;
    oauthExpiresAt: Date | null;
    active: boolean;
    killSwitch: boolean;
  } | null> {
    const row = await this.handle.db
      .selectFrom('uc_credentials')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      tenantSlug: row.tenantSlug,
      username: this.crypto.decrypt(row.usernameEnc),
      password: this.crypto.decrypt(row.passwordEnc),
      facilityCode: row.facilityCode,
      oauthAccessTokenEnc: row.oauthAccessTokenEnc,
      oauthRefreshTokenEnc: row.oauthRefreshTokenEnc,
      oauthExpiresAt: row.oauthExpiresAt,
      active: row.active,
      killSwitch: row.killSwitch,
    };
  }

  async getPublic(merchantId: string): Promise<UcCredentialsData | null> {
    const row = await this.handle.db
      .selectFrom('uc_credentials')
      .select(['merchantId', 'tenantSlug', 'facilityCode', 'active', 'killSwitch'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!row) return null;
    return row;
  }

  async updateOauthTokens(
    merchantId: string,
    data: {
      accessTokenEnc: string;
      refreshTokenEnc: string;
      expiresAt: Date;
    },
  ): Promise<void> {
    await this.handle.db
      .updateTable('uc_credentials')
      .set({
        oauthAccessTokenEnc: data.accessTokenEnc,
        oauthRefreshTokenEnc: data.refreshTokenEnc,
        oauthExpiresAt: data.expiresAt,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async setActive(merchantId: string, active: boolean): Promise<void> {
    await this.handle.db
      .updateTable('uc_credentials')
      .set({ active, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async setKillSwitch(merchantId: string, killSwitch: boolean): Promise<void> {
    await this.handle.db
      .updateTable('uc_credentials')
      .set({ killSwitch, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async getAllActiveMerchants(): Promise<UcCredentialsRow[]> {
    return this.handle.db
      .selectFrom('uc_credentials')
      .selectAll()
      .where('active', '=', true)
      .where('killSwitch', '=', false)
      .execute();
  }

  async delete(merchantId: string): Promise<void> {
    await this.handle.db
      .deleteFrom('uc_credentials')
      .where('merchantId', '=', merchantId)
      .execute();
  }
}
