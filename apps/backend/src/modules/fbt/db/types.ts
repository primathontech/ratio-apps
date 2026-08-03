import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

/**
 * FBT owns the EXISTING production database — table names are the ones already
 * in production and are deliberately NOT `fbt_`-prefixed. New tables this module
 * introduces DO take the prefix (`fbt_sweep_lease`). Precedent: `rp` ships
 * `return_prime_merchants` alongside `rp_id_mappings`.
 *
 * `platform` survives on the legacy tables until `0002` (post-cutover) drops it.
 * Always write the literal 'openstore'; never branch on it. All live merchants
 * are OpenStore/Ratio and no Shopify code is ported.
 *
 * CamelCasePlugin is active: interface KEYS stay snake_case (table names pass
 * through unchanged), column names are camelCase and are converted at the SQL
 * boundary.
 */

/** Only ever 'openstore' in this module. Retained for schema compatibility. */
export type FbtPlatform = 'openstore' | 'shopify';

export type FbtBundleStatus = 'draft' | 'published' | 'paused' | 'archived';
export type FbtScopeType = 'all_products' | 'specific_product' | 'specific_collections';
export type FbtBundleMode = 'auto' | 'manual';
export type FbtJobType = 'full_sync' | 'incremental' | 'single_product' | 'embedding_generation';
export type FbtJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type FbtSyncFrequencyColumn = 'daily' | 'weekly';

interface FrequentlyBoughtBundleTable {
  id: string;
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
  merchantId: string;
  platform: FbtPlatform;
  mode: Generated<FbtBundleMode>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface MerchantRecommendationConfigTable {
  id: string;
  merchantId: string;
  platform: FbtPlatform;
  allowAutomaticRecommendation: Generated<boolean>;
  recommendationCount: Generated<number>;
  productExcludedList: ColumnType<string[] | null, string | null, string | null>;
  productsWidgetDisabledList: ColumnType<string[] | null, string | null, string | null>;
  uiConfig: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  // ── added by 0001 ──
  syncFrequency: Generated<FbtSyncFrequencyColumn>;
  syncHourUtc: Generated<number>;
  syncWeekday: number | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  previewBaseUrl: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface ProductEmbeddingsTable {
  id: string;
  merchantId: string;
  platform: FbtPlatform;
  productId: string;
  productTitle: string;
  productDescription: string | null;
  /**
   * Legacy ada-002 JSON vectors. Relaxed to NULL by 0001; this module NEVER
   * writes or reads it — see `embeddingBlob`. Dropped in 0002.
   */
  embeddingVector: ColumnType<number[] | null, string | null, string | null>;
  /** Float32Array buffer. The only vector representation this module uses. */
  embeddingBlob: Buffer | null;
  embeddingModel: Generated<string>;
  embeddingDimensions: Generated<number>;
  createdAt: Generated<Date>;
  lastUpdated: Generated<Date>;
}

interface ProductSimilarityCacheTable {
  id: string;
  merchantId: string;
  platform: FbtPlatform;
  sourceProductId: string;
  similarProducts: ColumnType<Array<{ productId: string; score: number }>, string, string>;
  cacheExpiresAt: Date;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface BundleGenerationJobsTable {
  id: string;
  merchantId: string;
  platform: FbtPlatform;
  jobType: FbtJobType;
  status: Generated<FbtJobStatus>;
  totalProducts: Generated<number | null>;
  processedProducts: Generated<number | null>;
  createdBundles: Generated<number | null>;
  createdEmbeddings: Generated<number | null>;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Created by 0001. Single-runner lease for the sweep (Plan 3 consumes it). */
interface FbtSweepLeaseTable {
  leaseKey: string;
  lockedUntil: Date;
  lockedBy: string | null;
  updatedAt: Generated<Date>;
}

export interface FbtDatabase {
  // shared, created by 0001 via createSharedTables()
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  // pre-existing production tables
  frequently_bought_bundle: FrequentlyBoughtBundleTable;
  merchant_recommendation_config: MerchantRecommendationConfigTable;
  product_embeddings: ProductEmbeddingsTable;
  product_similarity_cache: ProductSimilarityCacheTable;
  bundle_generation_jobs: BundleGenerationJobsTable;
  // new, created by 0001
  fbt_sweep_lease: FbtSweepLeaseTable;
}

export type FbtMerchantRow = Selectable<BaseMerchantsTable>;
export type FbtBundleRow = Selectable<FrequentlyBoughtBundleTable>;
export type FbtMerchantConfigRow = Selectable<MerchantRecommendationConfigTable>;
export type FbtProductEmbeddingRow = Selectable<ProductEmbeddingsTable>;
export type FbtSimilarityCacheRow = Selectable<ProductSimilarityCacheTable>;
export type FbtGenerationJobRow = Selectable<BundleGenerationJobsTable>;
