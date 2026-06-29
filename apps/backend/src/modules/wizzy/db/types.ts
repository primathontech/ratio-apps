import type { Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

type CatalogStatus = 'SYNCED' | 'PENDING' | 'ERROR' | 'DELETED';
type SyncType = 'initial' | 'webhook' | 'auto' | 'manual' | 'reconcile';

/** One row per merchant — Wizzy connection + sync settings. */
interface WizzyConfigsTable {
  merchantId: string;
  wizzyEnabled: Generated<boolean>;
  storeId: string | null;
  /** Encrypted (CryptoService) Wizzy Store Secret. Never returned raw. */
  storeSecretEnc: string | null;
  /** Encrypted (CryptoService) Wizzy API Key. Never returned raw. */
  apiKeyEnc: string | null;
  /** Storefront URL/domain for building absolute product links. */
  storeUrl: string | null;
  autoSyncEnabled: Generated<boolean>;
  includeOutOfStock: Generated<boolean>;
  stripHtmlDescription: Generated<boolean>;
  /** Storefront search SDK settings (plain, not secret). */
  searchEnabled: Generated<boolean>;
  inputSelector: Generated<string>;
  resultsMountSelector: Generated<string>;
  resultsPagePath: Generated<string>;
  themePrimary: Generated<string>;
  lastBulkSyncAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Per-product sync health for the catalog-details screen. */
interface WizzyCatalogItemsTable {
  id: Generated<number>;
  merchantId: string;
  productId: string;
  wizzyId: string;
  title: string | null;
  status: Generated<CatalogStatus>;
  issue: string | null;
  lastSyncedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Sync-history rows for the admin. */
interface WizzySyncLogTable {
  id: Generated<number>;
  merchantId: string;
  syncType: SyncType;
  productsChecked: Generated<number>;
  productsSynced: Generated<number>;
  productsErrored: Generated<number>;
  detail: string | null;
  createdAt: Generated<Date>;
}

export interface WizzyDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  wizzy_configs: WizzyConfigsTable;
  wizzy_catalog_items: WizzyCatalogItemsTable;
  wizzy_sync_log: WizzySyncLogTable;
}

export type WizzyConfigRow = Selectable<WizzyConfigsTable>;
export type WizzyCatalogItemRow = Selectable<WizzyCatalogItemsTable>;
export type WizzySyncLogRow = Selectable<WizzySyncLogTable>;
