import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_DATA_SHARING_LEVEL,
  DEFAULT_PRODUCT_ID_TYPE,
  type ProductIdType,
} from '@ratio-app/shared/constants/meta-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type { MetaConfig, MetaConfigInput } from '@ratio-app/shared/schemas/meta-config';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { MetaDatabase } from '../db/types';
import { META_DB_TOKEN } from '../kysely.module';
import { META_CRYPTO } from '../tokens';

/**
 * Per-merchant Meta config CRUD. Backed by `meta_configs`, keyed by
 * `merchant_id` (single-tenant per-module DB — no `app` column).
 *
 * MySQL has no `RETURNING`, so writes use the INSERT…ON DUPLICATE KEY UPDATE
 * + in-memory response pattern.
 *
 * `capiAccessToken` is the SECRET CAPI token. These methods return it (the
 * admin guard protects the config endpoints) but it MUST be stripped before
 * any value reaches the browser SDK prelude — see SdkService.buildPrelude.
 */
@Injectable()
export class MetaConfigService {
  constructor(
    @Inject(META_DB_TOKEN) private readonly handle: KyselyClient<MetaDatabase>,
    @Inject(META_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  /**
   * Phase 2 catalog config. Returns the merchant's catalog id + DECRYPTED
   * catalog-management token (a SECRET, separate from the CAPI token), the
   * productIdType (must match what events send), feed token, and sync flag.
   * Returns null if catalog isn't configured (no catalogId / token) so callers
   * skip cleanly.
   */
  async getCatalogConfig(merchantId: string): Promise<{
    catalogId: string;
    catalogAccessToken: string;
    productIdType: ProductIdType;
    feedToken: string | null;
    syncEnabled: boolean;
  } | null> {
    const row = await this.handle.db
      .selectFrom('meta_configs')
      .select(['catalogId', 'catalogAccessToken', 'productIdType', 'feedToken', 'syncEnabled'])
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row?.catalogId || !row.catalogAccessToken) return null;
    return {
      catalogId: row.catalogId,
      catalogAccessToken: this.crypto.decrypt(row.catalogAccessToken),
      productIdType: row.productIdType,
      feedToken: row.feedToken,
      syncEnabled: Boolean(row.syncEnabled),
    };
  }

  /** Non-secret catalog config for the admin Catalog tab (never returns the token). */
  async getCatalogAdminView(merchantId: string): Promise<{
    catalogId: string | null;
    syncEnabled: boolean;
    feedToken: string | null;
    hasCatalogToken: boolean;
    productIdType: ProductIdType;
  }> {
    const row = await this.handle.db
      .selectFrom('meta_configs')
      .select(['catalogId', 'catalogAccessToken', 'feedToken', 'syncEnabled', 'productIdType'])
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    return {
      catalogId: row?.catalogId ?? null,
      syncEnabled: Boolean(row?.syncEnabled),
      feedToken: row?.feedToken ?? null,
      hasCatalogToken: Boolean(row?.catalogAccessToken),
      productIdType: row?.productIdType ?? DEFAULT_PRODUCT_ID_TYPE,
    };
  }

  /**
   * Save catalog settings from the admin Catalog tab. Encrypts the token,
   * auto-generates a feed token on first save, and reports whether sync was
   * just turned ON (so the caller can fire the initial full sync).
   */
  async upsertCatalogConfig(
    merchantId: string,
    input: { catalogId?: string; catalogAccessToken?: string; syncEnabled?: boolean },
  ): Promise<{ catalogId: string | null; syncEnabled: boolean; feedToken: string; flippedOn: boolean }> {
    const cur = await this.handle.db
      .selectFrom('meta_configs')
      .select(['catalogId', 'feedToken', 'syncEnabled'])
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

    const feedToken = cur?.feedToken || randomBytes(24).toString('hex');
    const syncEnabled = input.syncEnabled ?? Boolean(cur?.syncEnabled);

    await this.handle.db
      .updateTable('meta_configs')
      .set({
        feedToken,
        syncEnabled,
        catalogUpdatedAt: sql`CURRENT_TIMESTAMP(3)`,
        // Only overwrite the id / token when the caller actually provided them
        // (toggling sync alone must not wipe a saved token).
        ...(input.catalogId !== undefined ? { catalogId: input.catalogId } : {}),
        ...(input.catalogAccessToken
          ? { catalogAccessToken: this.crypto.encrypt(input.catalogAccessToken) }
          : {}),
      })
      .where('merchantId', '=', merchantId)
      .execute();

    return {
      catalogId: input.catalogId ?? cur?.catalogId ?? null,
      syncEnabled,
      feedToken,
      flippedOn: syncEnabled && !cur?.syncEnabled,
    };
  }

  /** Just the feed token (for authenticating the public feed URL). */
  async getFeedToken(merchantId: string): Promise<string | null> {
    const row = await this.handle.db
      .selectFrom('meta_configs')
      .select(['feedToken'])
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    return row?.feedToken ?? null;
  }

  async getByMerchantId(merchantId: string): Promise<MetaConfig> {
    const row = await this.handle.db
      .selectFrom('meta_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no meta config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return {
      pixelId: row.pixelId,
      // Token is encrypted at rest (AES-256-GCM). Empty string = not yet
      // configured (the install bootstrap seeds ''), so skip decrypt for it.
      capiAccessToken: row.capiAccessToken ? this.crypto.decrypt(row.capiAccessToken) : '',
      dataSharingLevel: row.dataSharingLevel,
      productIdType: row.productIdType,
      // MySQL stores `debug` as TINYINT(1) → mysql2 returns 0/1, coerce.
      debug: Boolean(row.debug),
      events: row.events,
    };
  }

  /**
   * UPSERT this merchant's Meta config and return the saved shape, composed in
   * memory from the validated input (no follow-up SELECT).
   */
  async upsert(merchantId: string, input: MetaConfigInput): Promise<MetaConfig> {
    const events = input.events ?? buildDefaultEventMap();
    const debug = input.debug ?? false;
    const dataSharingLevel = input.dataSharingLevel ?? DEFAULT_DATA_SHARING_LEVEL;
    const productIdType = input.productIdType ?? DEFAULT_PRODUCT_ID_TYPE;
    // mysql2 does NOT auto-serialize objects into JSON columns. Encode here.
    const eventsJson = JSON.stringify(events);
    // Encrypt the CAPI token at rest (AES-256-GCM). Empty stays empty so the
    // "not configured" state is distinguishable and never decrypt-fails.
    const encToken = input.capiAccessToken ? this.crypto.encrypt(input.capiAccessToken) : '';

    await this.handle.db
      .insertInto('meta_configs')
      .values({
        merchantId,
        pixelId: input.pixelId,
        capiAccessToken: encToken,
        dataSharingLevel,
        productIdType,
        debug,
        events: eventsJson as unknown as typeof events,
      })
      .onDuplicateKeyUpdate({
        pixelId: input.pixelId,
        capiAccessToken: encToken,
        dataSharingLevel,
        productIdType,
        debug,
        events: eventsJson as unknown as typeof events,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();

    return {
      pixelId: input.pixelId,
      capiAccessToken: input.capiAccessToken,
      dataSharingLevel,
      productIdType,
      debug,
      events,
    };
  }
}
