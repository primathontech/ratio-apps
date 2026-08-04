import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

/**
 * FBT's schema is GREENFIELD — its own empty `fbt_app` database, not the old FBT
 * production schema. Every table this module owns therefore takes the `fbt_` prefix,
 * there is no `platform` column, foreign keys are real, and there is no legacy
 * `embedding_vector` JSON column. The old database is never read, written, or migrated.
 *
 * CamelCasePlugin is active: interface KEYS stay snake_case (table names pass through
 * unchanged), column names are camelCase and are converted at the SQL boundary.
 * Migrations are the exception — they run through a plain `Kysely<any>` with no plugin,
 * so they use raw snake_case.
 */

export type FbtBundleStatus = 'draft' | 'published' | 'paused' | 'archived';
export type FbtScopeType = 'all_products' | 'specific_product' | 'specific_collections';
export type FbtBundleMode = 'auto' | 'manual';
export type FbtJobType = 'full_sync' | 'incremental' | 'single_product' | 'embedding_generation';
export type FbtJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type FbtSyncFrequencyColumn = 'daily' | 'weekly';

interface FbtBundlesTable {
  id: string;
  merchantId: string;
  name: string;
  status: FbtBundleStatus;
  scopeType: FbtScopeType;
  scopeProductIds: ColumnType<string[] | null, string | null, string | null>;
  scopeCollectionIds: ColumnType<string[] | null, string | null, string | null>;
  startDate: Date | null;
  endDate: Date | null;
  recommendationCount: number | null;
  recommendationProductList: ColumnType<string[] | null, string | null, string | null>;
  uiConfig: ColumnType<Record<string, unknown>, string, string>;
  perCardConfig: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  mode: Generated<FbtBundleMode>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** One row per merchant — `merchantId` IS the primary key (wizzy_configs shape). */
interface FbtMerchantConfigTable {
  merchantId: string;
  allowAutomaticRecommendation: Generated<boolean>;
  recommendationCount: Generated<number>;
  productExcludedList: ColumnType<string[] | null, string | null, string | null>;
  productsWidgetDisabledList: ColumnType<string[] | null, string | null, string | null>;
  uiConfig: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  syncFrequency: Generated<FbtSyncFrequencyColumn>;
  syncHourUtc: Generated<number>;
  syncWeekday: number | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  previewBaseUrl: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface FbtProductEmbeddingsTable {
  id: string;
  merchantId: string;
  productId: string;
  productTitle: string;
  productDescription: string | null;
  /** Float32Array buffer. The only vector representation — there is no JSON column. */
  embeddingBlob: Buffer;
  embeddingModel: Generated<string>;
  embeddingDimensions: Generated<number>;
  createdAt: Generated<Date>;
  lastUpdated: Generated<Date>;
}

interface FbtSimilarityCacheTable {
  id: string;
  merchantId: string;
  sourceProductId: string;
  similarProducts: ColumnType<Array<{ productId: string; score: number }>, string, string>;
  cacheExpiresAt: Date;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface FbtGenerationJobsTable {
  id: string;
  merchantId: string;
  jobType: FbtJobType;
  status: Generated<FbtJobStatus>;
  totalProducts: Generated<number>;
  processedProducts: Generated<number>;
  createdBundles: Generated<number>;
  createdEmbeddings: Generated<number>;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Single-runner lease for the sweep. Plan 3 consumes it; this plan only creates it. */
interface FbtSweepLeaseTable {
  leaseKey: string;
  lockedUntil: Date;
  lockedBy: string | null;
  updatedAt: Generated<Date>;
}

export interface FbtDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  fbt_bundles: FbtBundlesTable;
  fbt_merchant_config: FbtMerchantConfigTable;
  fbt_product_embeddings: FbtProductEmbeddingsTable;
  fbt_similarity_cache: FbtSimilarityCacheTable;
  fbt_generation_jobs: FbtGenerationJobsTable;
  fbt_sweep_lease: FbtSweepLeaseTable;
}

export type FbtMerchantRow = Selectable<BaseMerchantsTable>;
export type FbtBundleRow = Selectable<FbtBundlesTable>;
export type FbtMerchantConfigRow = Selectable<FbtMerchantConfigTable>;
export type FbtProductEmbeddingRow = Selectable<FbtProductEmbeddingsTable>;
export type FbtSimilarityCacheRow = Selectable<FbtSimilarityCacheTable>;
export type FbtGenerationJobRow = Selectable<FbtGenerationJobsTable>;
