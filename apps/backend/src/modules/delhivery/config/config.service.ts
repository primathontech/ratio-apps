import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_DELHIVERY_AWB_TRIGGER,
  DEFAULT_DELHIVERY_PICKUP_CUTOFF,
} from '@ratio-app/shared/constants/delhivery-events';
import type {
  DelhiveryConfig,
  DelhiveryConfigInput,
} from '@ratio-app/shared/schemas/delhivery-config';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { DelhiveryDatabase } from '../db/types';
import { DELHIVERY_DB_TOKEN } from '../kysely.module';
import { DELHIVERY_CRYPTO } from '../tokens';

/**
 * Per-merchant Delhivery config CRUD. Backed by `delhivery_configs`, keyed by
 * `merchant_id` (single-tenant per-module DB — no `app` column).
 *
 * The Delhivery API token is ENCRYPTED AT REST (AES-256-GCM via the module's
 * CryptoService, keyed by RATIO_DELHIVERY_DATA_ENCRYPTION_KEY). Plaintext only
 * exists in memory: `getByMerchantId` decrypts for internal callers (the SDK
 * adapter); the controller masks it before anything leaves the process.
 *
 * MySQL has no `RETURNING`, so writes use INSERT…ON DUPLICATE KEY UPDATE and
 * compose the response in memory.
 */
@Injectable()
export class DelhiveryConfigService {
  constructor(
    @Inject(DELHIVERY_DB_TOKEN) private readonly handle: KyselyClient<DelhiveryDatabase>,
    @Inject(DELHIVERY_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  async getByMerchantId(merchantId: string): Promise<DelhiveryConfig> {
    const row = await this.handle.db
      .selectFrom('delhivery_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no delhivery config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return {
      // Empty ciphertext = "not configured yet" (bootstrap seed row).
      apiToken: row.apiTokenEnc ? this.crypto.decrypt(row.apiTokenEnc) : '',
      pickupLocationName: row.pickupLocationName,
      pickupPincode: row.pickupPincode,
      pickupPhone: row.pickupPhone,
      pickupAddress: row.pickupAddress,
      pickupCity: row.pickupCity,
      gstin: row.gstin,
      pickupCutoff: row.pickupCutoff,
      awbTrigger: row.awbTrigger,
      defaultBox: { l: row.defaultBoxLCm, b: row.defaultBoxBCm, h: row.defaultBoxHCm },
      // MySQL stores booleans as TINYINT(1) → mysql2 returns 0/1, coerce.
      enabled: Boolean(row.enabled),
    };
  }

  /**
   * UPSERT this merchant's Delhivery config and return the saved shape.
   * The token is encrypted before it touches the wire to MySQL; the response
   * is composed in memory from the validated input (no follow-up SELECT).
   */
  async upsert(merchantId: string, input: DelhiveryConfigInput): Promise<DelhiveryConfig> {
    const pickupCutoff = input.pickupCutoff ?? DEFAULT_DELHIVERY_PICKUP_CUTOFF;
    const awbTrigger = input.awbTrigger ?? DEFAULT_DELHIVERY_AWB_TRIGGER;
    const enabled = input.enabled ?? true;
    const pickupCity = input.pickupCity ?? '';

    // Token is write-only: non-empty input replaces it, blank keeps the stored
    // ciphertext (so editing pickup details never forces re-entry). First-time
    // setup — nothing stored — must supply one.
    const providedToken = input.apiToken?.trim() ?? '';
    const existing = await this.handle.db
      .selectFrom('delhivery_configs')
      .select('apiTokenEnc')
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    let apiTokenEnc: string;
    let apiToken: string;
    if (providedToken) {
      apiToken = providedToken;
      apiTokenEnc = this.crypto.encrypt(providedToken);
    } else if (existing?.apiTokenEnc) {
      apiTokenEnc = existing.apiTokenEnc;
      apiToken = this.crypto.decrypt(existing.apiTokenEnc);
    } else {
      throw new BadRequestException({
        message: 'API token is required',
        error_code: 'API_TOKEN_REQUIRED',
      });
    }

    await this.handle.db
      .insertInto('delhivery_configs')
      .values({
        merchantId,
        apiTokenEnc,
        pickupLocationName: input.pickupLocationName,
        pickupPincode: input.pickupPincode,
        pickupPhone: input.pickupPhone,
        pickupAddress: input.pickupAddress,
        pickupCity,
        gstin: input.gstin,
        pickupCutoff,
        awbTrigger,
        defaultBoxLCm: input.defaultBox.l,
        defaultBoxBCm: input.defaultBox.b,
        defaultBoxHCm: input.defaultBox.h,
        enabled,
      })
      .onDuplicateKeyUpdate({
        apiTokenEnc,
        pickupLocationName: input.pickupLocationName,
        pickupPincode: input.pickupPincode,
        pickupPhone: input.pickupPhone,
        pickupAddress: input.pickupAddress,
        pickupCity,
        gstin: input.gstin,
        pickupCutoff,
        awbTrigger,
        defaultBoxLCm: input.defaultBox.l,
        defaultBoxBCm: input.defaultBox.b,
        defaultBoxHCm: input.defaultBox.h,
        enabled,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();

    return {
      apiToken,
      pickupLocationName: input.pickupLocationName,
      pickupPincode: input.pickupPincode,
      pickupPhone: input.pickupPhone,
      pickupAddress: input.pickupAddress,
      pickupCity,
      gstin: input.gstin,
      pickupCutoff,
      awbTrigger,
      defaultBox: input.defaultBox,
      enabled,
    };
  }
}
