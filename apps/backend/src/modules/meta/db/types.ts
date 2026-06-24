import type { DataSharingLevel, ProductIdType } from '@ratio-app/shared/constants/meta-events';
import type { EventMap } from '@ratio-app/shared/schemas/event-map';
import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

interface MetaConfigsTable {
  merchantId: string;
  /** One or more Meta Pixel IDs, comma-separated. Public (sent to browser). */
  pixelId: string;
  /** Meta CAPI access token. Secret — never sent to the browser. */
  capiAccessToken: string;
  dataSharingLevel: ColumnType<DataSharingLevel, DataSharingLevel, DataSharingLevel>;
  productIdType: ColumnType<ProductIdType, ProductIdType, ProductIdType>;
  debug: Generated<boolean>;
  events: ColumnType<EventMap, EventMap, EventMap>;
  // ── Phase 2: catalog/feed (migrations 0003 + 0004) ──────────────────────
  /** Meta product catalog id (merchant-provided in admin). */
  catalogId: string | null;
  /** Catalog Batch API token (`catalog_management` scope). Secret — encrypted at rest. */
  catalogAccessToken: Generated<string>;
  commerceAccountId: string | null;
  facebookPageId: string | null;
  instagramProfileId: string | null;
  /** Unguessable token authenticating the public feed URL. */
  feedToken: string | null;
  /**
   * Merchant storefront base URL for catalog/feed product links (full URL).
   * NULL → fall back to the `RATIO_META_STOREFRONT_BASE_URL` env default. See
   * migration 0006.
   */
  storefrontUrl: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  lastSyncAt: ColumnType<Date | null, Date | null, Date | null>;
  syncEnabled: Generated<boolean>;
  catalogUpdatedAt: ColumnType<Date | null, Date | null, Date | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** One sync run (full / webhook / scheduled). Append-only audit trail. */
interface CatalogSyncLogTable {
  id: Generated<number>;
  merchantId: string;
  trigger: string; // webhook | scheduled | manual | full | reconcile
  status: string; // running | success | partial | failed
  totalProducts: number | null;
  successCount: number | null;
  errorCount: number | null;
  errors: ColumnType<unknown, string, string> | null;
  startedAt: ColumnType<Date, Date | string, Date | string>;
  completedAt: ColumnType<Date | null, Date | string | null, Date | string | null>;
  createdAt: Generated<Date>;
}

/** Map of os-item product → the `retailer_id` sent to Meta. Drives no-op skip + orphan delete. */
interface CatalogItemsTable {
  merchantId: string;
  retailerId: string;
  sourceProductId: string;
  contentHash: string;
  lastStatus: string; // synced | deleted | error
  updatedAt: Generated<Date>;
}

/**
 * Per-merchant, per-day CAPI delivery counters (rollup — NOT per-event rows).
 * The worker UPSERTs one row per merchant per UTC day. `failed` counts errored
 * flush attempts (retried → health signal, not data loss). See migration 0005.
 * MySQL BIGINT comes back as a string via mysql2, hence the ColumnType read type.
 */
interface MetaCapiStatsTable {
  merchantId: string;
  day: ColumnType<string, string, string>; // YYYY-MM-DD (UTC)
  batches: ColumnType<string, number | bigint, number | bigint>;
  dispatched: ColumnType<string, number | bigint, number | bigint>;
  failed: ColumnType<string, number | bigint, number | bigint>;
  updatedAt: Generated<Date>;
}

/** Per-merchant, per-day, per-reason failure breakdown (bounded reason codes). See migration 0005. */
interface MetaCapiFailuresTable {
  merchantId: string;
  day: ColumnType<string, string, string>; // YYYY-MM-DD (UTC)
  reason: string; // rate_limited | invalid_request | auth | timeout | server_error | unknown
  events: ColumnType<string, number | bigint, number | bigint>;
  lastMessage: ColumnType<string, string, string>;
  lastAt: Generated<Date>;
}

export interface MetaDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  meta_configs: MetaConfigsTable;
  catalog_sync_log: CatalogSyncLogTable;
  catalog_items: CatalogItemsTable;
  meta_capi_stats: MetaCapiStatsTable;
  meta_capi_failures: MetaCapiFailuresTable;
}

export type MetaMerchantRow = Selectable<BaseMerchantsTable>;
export type MetaConfigRow = Selectable<MetaConfigsTable>;
export type CatalogItemRow = Selectable<CatalogItemsTable>;
export type CatalogSyncLogRow = Selectable<CatalogSyncLogTable>;
export type MetaCapiStatsRow = Selectable<MetaCapiStatsTable>;
export type MetaCapiFailureRow = Selectable<MetaCapiFailuresTable>;
