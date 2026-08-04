-- Production-shaped schema fixture for `verify-fbt-additive.mjs`.
--
-- NOT a mysqldump. The source repo's TypeORM migrations under
-- `osapp-freq-bought` ARE the production schema definition, so this file is a
-- hand-written transcription of their NET EFFECT — nine migrations applied in
-- timestamp order, collapsed into the six `CREATE TABLE` statements that
-- matter to `0001_initial.ts`. Passing a real `mysqldump --no-data` remains
-- supported via the `PROD_SCHEMA` env var override; this fixture is what lets
-- the verifier run with no arguments and live in CI.
--
-- Six tables, five of which `0001` alters plus `platform_merchants`, which the
-- backfill runbook (`0001_initial.backfill.sql`) LEFT JOINs:
--   frequently_bought_bundle, merchant_recommendation_config,
--   product_embeddings, product_similarity_cache, bundle_generation_jobs,
--   platform_merchants
--
-- Deliberately EXCLUDED: `webhooks`, `uploaded_files`. No migration creates
-- them — they are `synchronize: true` artifacts, so whether they exist in
-- production is unknown. `0001` never touches them and the new module never
-- reads them, so their absence changes nothing here.
--
-- Net effects that are easy to get wrong if you only read the FIRST migration
-- that touches a table — applied here, not just transcribed:
--   * merchant_recommendation_config.title       — ABSENT. Added by
--     1704067500000-AddTitleAndUiConfigToMerchantConfig, dropped again two
--     migrations later by 1704067600000-RemoveTitleFromMerchantConfig.
--   * frequently_bought_bundle column is `recommendation_count`, NOT
--     `num_recommendations` — renamed by
--     1758870902963-RenameNumRecommendationsToRecommendationCount.
--   * frequently_bought_bundle.per_card_config   — PRESENT. Added by
--     1774441538767-AddPerCardConfigToBundleTable.
--   * product_embeddings.embedding_vector        — exactly `json NOT NULL`.
--     Load-bearing: `0001` relaxes this to NULL, and proving that relaxation
--     is lossless (no collateral type/column damage) is the entire point of
--     the verifier.
--   * Both tables' `ui_config` restructuring (1777637180308) rewrites ROW
--     DATA (wraps existing values in `{base, overrides}`), not the column
--     DEFINITION — the column stays `json`, so it has no DDL consequence here.

-- ─── frequently_bought_bundle ────────────────────────────────────────────
-- Created by 1704067200000-CreateBundleTables (id..platform, ui_config,
-- num_recommendations, created_at/updated_at + 3 indexes).
-- + `mode`            added by 1704067400000-AddModeColumnToBundleTable.
-- + rename            num_recommendations -> recommendation_count by
--                     1758870902963-RenameNumRecommendationsToRecommendationCount.
-- + `per_card_config`  added by 1774441538767-AddPerCardConfigToBundleTable.
CREATE TABLE `frequently_bought_bundle` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `status` enum('paused','draft','published','archived') NOT NULL,
  `scope_type` enum('all_products','specific_product','specific_collections') NOT NULL,
  `scope_product_ids` json NULL,
  `scope_collection_ids` json NULL,
  `start_date` datetime NULL,
  `end_date` datetime NULL,
  `recommendation_count` int NULL,
  `recommendation_product_list` json NULL,
  `ui_config` json NOT NULL,
  `merchant_id` varchar(35) NOT NULL,
  `platform` enum('openstore','shopify') NOT NULL,
  `mode` enum('auto','manual') NOT NULL DEFAULT 'manual',
  `per_card_config` json NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_platform` (`merchant_id`, `platform`),
  KEY `idx_status` (`status`),
  KEY `idx_scope_type` (`scope_type`)
) ENGINE=InnoDB;

-- ─── merchant_recommendation_config ──────────────────────────────────────
-- Created by 1704067200000-CreateBundleTables (id..platform,
-- allow_automatic_recommendation, recommendation_count [already named that
-- in THIS table from the start — the rename above is on the other table],
-- product_excluded_list, products_widget_disabled_list, created_at/updated_at
-- + unique index). `allow_automatic_recommendation` and `recommendation_count`
-- have no `isNullable` in that migration's TableColumn options; TypeORM 0.3.25
-- (`node_modules/typeorm/schema-builder/table/TableColumn.js`:
-- `this.isNullable = options.isNullable || false`) defaults that to NOT NULL,
-- confirmed by inspecting the installed package rather than assumed.
-- + `title`      added by 1704067500000-AddTitleAndUiConfigToMerchantConfig,
--                then DROPPED by 1704067600000-RemoveTitleFromMerchantConfig
--                two migrations later — net effect: ABSENT.
-- + `ui_config`  added by 1704067500000 (json, nullable) and survives.
-- 0001_initial.ts's own scheduling columns (sync_frequency, sync_hour_utc,
-- sync_weekday, next_run_at, last_run_at, preview_base_url) are NOT part of
-- this fixture — they are what `0001` itself adds, which is exactly what the
-- verifier checks for in the AFTER snapshot.
CREATE TABLE `merchant_recommendation_config` (
  `id` varchar(36) NOT NULL,
  `merchant_id` varchar(35) NOT NULL,
  `platform` enum('openstore','shopify') NOT NULL,
  `allow_automatic_recommendation` tinyint(1) NOT NULL DEFAULT 0,
  `recommendation_count` int NOT NULL DEFAULT 3,
  `product_excluded_list` json NULL,
  `products_widget_disabled_list` json NULL,
  `ui_config` json NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_merchant_platform` (`merchant_id`, `platform`)
) ENGINE=InnoDB;

-- ─── platform_merchants ───────────────────────────────────────────────────
-- Created whole by 1704067300000-CreatePlatformMerchantsTable; no later
-- migration touches it. Needed here only because the backfill runbook
-- LEFT JOINs it to source `is_active` for the synthesized `merchants` rows.
CREATE TABLE `platform_merchants` (
  `id` varchar(36) NOT NULL,
  `merchant_id` varchar(35) NULL DEFAULT '',
  `preview_base_url` varchar(255) NULL DEFAULT '',
  `platform` enum('openstore','shopify') NOT NULL DEFAULT 'shopify',
  `shop_domain` varchar(255) NOT NULL,
  `access_token` text NOT NULL,
  `public_access_token` text NULL,
  `scopes` varchar(500) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_shop_domain` (`shop_domain`),
  KEY `idx_merchant_id` (`merchant_id`),
  KEY `idx_platform` (`platform`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB;

-- ─── product_embeddings ───────────────────────────────────────────────────
-- Created whole by automated-bundle-service's
-- 1704067700000-CreateEmbeddingTables, via raw SQL that is transcribed here
-- verbatim (no TypeORM TableColumn defaults to reconstruct). No later
-- migration in the nine touches this table.
--
-- `embedding_vector json NOT NULL` is exactly as created — THE column
-- `0001_initial.ts` relaxes to nullable. Get this wrong and the verifier's
-- one sanctioned exception (json NOT NULL -> json NULL) can't be exercised.
CREATE TABLE `product_embeddings` (
  `id` varchar(36) NOT NULL,
  `merchant_id` varchar(35) NOT NULL,
  `platform` enum('openstore','shopify') NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_title` varchar(500) NOT NULL,
  `product_description` text NULL,
  `embedding_vector` json NOT NULL,
  `embedding_model` varchar(100) NOT NULL DEFAULT 'text-embedding-ada-002',
  `embedding_dimensions` int NOT NULL DEFAULT 1536,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_updated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_merchant_platform_product` (`merchant_id`, `platform`, `product_id`),
  KEY `idx_merchant_platform` (`merchant_id`, `platform`),
  KEY `idx_embedding_model` (`embedding_model`)
) ENGINE=InnoDB;

-- ─── product_similarity_cache ─────────────────────────────────────────────
-- Created whole by 1704067700000-CreateEmbeddingTables (raw SQL,
-- transcribed verbatim). No later migration touches it.
CREATE TABLE `product_similarity_cache` (
  `id` varchar(36) NOT NULL,
  `merchant_id` varchar(35) NOT NULL,
  `platform` enum('openstore','shopify') NOT NULL,
  `source_product_id` varchar(50) NOT NULL,
  `similar_products` json NOT NULL,
  `cache_expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_merchant_platform_source_product` (`merchant_id`, `platform`, `source_product_id`),
  KEY `idx_cache_expires_at` (`cache_expires_at`)
) ENGINE=InnoDB;

-- ─── bundle_generation_jobs ────────────────────────────────────────────────
-- Created whole by 1704067700000-CreateEmbeddingTables (raw SQL,
-- transcribed verbatim). No later migration touches it.
-- `error_message` is the column Step 4's Mutation 1 drops to prove the
-- verifier catches a disappearing column.
CREATE TABLE `bundle_generation_jobs` (
  `id` varchar(36) NOT NULL,
  `merchant_id` varchar(35) NOT NULL,
  `platform` enum('openstore','shopify') NOT NULL,
  `job_type` enum('full_sync','incremental','single_product','embedding_generation') NOT NULL,
  `status` enum('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `total_products` int NULL DEFAULT 0,
  `processed_products` int NULL DEFAULT 0,
  `created_bundles` int NULL DEFAULT 0,
  `created_embeddings` int NULL DEFAULT 0,
  `error_message` text NULL,
  `started_at` datetime NULL,
  `completed_at` datetime NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_platform_job` (`merchant_id`, `platform`),
  KEY `idx_status` (`status`),
  KEY `idx_job_type` (`job_type`)
) ENGINE=InnoDB;
