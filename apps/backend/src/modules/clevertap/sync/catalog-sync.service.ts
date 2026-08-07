import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CLEVERTAP_REGIONS,
  DEFAULT_CLEVERTAP_REGION,
} from '@ratio-app/shared/constants/clevertap-events';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { ClevertapConfigRow, ClevertapDatabase } from '../db/types';
import {
  CLEVERTAP_CATALOG_CONTRACT_VERIFIED,
  ClevertapCatalogClient,
  type ClevertapCatalogClientFactory,
  type ClevertapCatalogResult,
} from '../events/clevertap-catalog.client';
import { buildCatalogCsv, mapProductForCatalog } from '../events/product-catalog.mapper';
import { CLEVERTAP_DB_TOKEN } from '../kysely.module';
import { CLEVERTAP_APP_ENABLED, CLEVERTAP_CRYPTO, CLEVERTAP_PRODUCT_SOURCE } from '../tokens';
import type { ClevertapProductSource } from './product-source.client';

export interface CatalogSyncResult {
  status: 'skipped' | 'sent' | 'failed';
  reason?: string;
  itemCount?: number;
}

@Injectable()
export class ClevertapCatalogSyncService {
  private readonly logger = new Logger(ClevertapCatalogSyncService.name);

  constructor(
    @Inject(CLEVERTAP_DB_TOKEN) private readonly handle: KyselyClient<ClevertapDatabase>,
    @Inject(CLEVERTAP_CRYPTO) private readonly crypto: Pick<CryptoService, 'decrypt'>,
    @Inject(CLEVERTAP_PRODUCT_SOURCE) private readonly productSource: ClevertapProductSource,
    @Optional()
    private readonly catalogFactory: ClevertapCatalogClientFactory = (apiHost) =>
      new ClevertapCatalogClient({ apiHost }),
    @Optional() @Inject(CLEVERTAP_APP_ENABLED) private readonly platformEnabled = true,
  ) {}

  async syncMerchant(merchantId: string): Promise<CatalogSyncResult> {
    if (!CLEVERTAP_CATALOG_CONTRACT_VERIFIED) {
      return { status: 'skipped', reason: 'contract unverified' };
    }

    const config = await this.handle.db
      .selectFrom('clevertap_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

    const skipReason = skipReasonFor(config, this.platformEnabled);
    if (skipReason !== null) {
      this.logger.log({ msg: 'catalog full-sync skipped', merchantId, reason: skipReason });
      return { status: 'skipped', reason: skipReason };
    }
    const row = config as ClevertapConfigRow & { passcodeEnc: string };

    let products: Record<string, unknown>[];
    try {
      products = await this.productSource.fetchAllProducts(merchantId);
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : 'fetch_error';
      this.logger.error({ msg: 'catalog full-sync product fetch failed', merchantId, reason });
      await this.recordOutcome(merchantId, 'failed', 0, reason);
      return { status: 'failed', reason };
    }

    const items = products
      .map((p) => mapProductForCatalog('products/update', p))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => m.item);
    const csv = buildCatalogCsv(items);

    let result: ClevertapCatalogResult;
    try {
      const client = this.catalogFactory(apiHostFor(row.region));
      result = await client.uploadCatalog({
        accountId: row.accountId,
        passcode: this.crypto.decrypt(row.passcodeEnc),
        name: row.catalogName,
        creator: 'ratio-clevertap',
        email: row.catalogEmail,
        csv,
        replace: true,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : 'upload_error';
      this.logger.error({ msg: 'catalog full-sync upload failed', merchantId, reason });
      await this.recordOutcome(merchantId, 'failed', items.length, reason);
      return { status: 'failed', reason, itemCount: items.length };
    }

    const status = result.skipped ? 'skipped' : result.ok ? 'sent' : 'failed';
    this.logger.log({ msg: 'catalog full-sync complete', merchantId, status, count: items.length });
    await this.recordOutcome(merchantId, status, items.length, result.error ?? null);
    return {
      status,
      ...(result.error ? { reason: result.error } : {}),
      itemCount: items.length,
    };
  }

  private async recordOutcome(
    merchantId: string,
    status: 'sent' | 'skipped' | 'failed',
    count: number,
    error: string | null,
  ): Promise<void> {
    try {
      await this.handle.db
        .updateTable('clevertap_configs')
        .set({
          lastCatalogSyncAt: new Date(),
          lastCatalogSyncStatus: status,
          lastCatalogSyncCount: count,
          lastCatalogSyncError: error ? error.slice(0, 512) : null,
        })
        .where('merchantId', '=', merchantId)
        .execute();
    } catch (err) {
      this.logger.error({
        msg: 'failed to record catalog sync outcome',
        merchantId,
        reason: err instanceof Error ? err.name : 'record_error',
      });
    }
  }
}

function skipReasonFor(
  config: ClevertapConfigRow | undefined,
  platformEnabled: boolean,
): string | null {
  if (!platformEnabled) return 'platform disabled';
  if (!config) return 'disabled';
  if (!config.clevertapEnabled) return 'app disabled';
  if (!config.catalogSyncEnabled) return 'disabled';
  if (!config.accountId || !config.catalogName || !config.catalogEmail || !config.passcodeEnc) {
    return 'config incomplete';
  }
  return null;
}

function apiHostFor(region: string): string {
  const known = (CLEVERTAP_REGIONS as Record<string, { apiHost: string } | undefined>)[region];
  return (known ?? CLEVERTAP_REGIONS[DEFAULT_CLEVERTAP_REGION]).apiHost;
}
