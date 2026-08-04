-- Ops runbook script, NOT a Kysely migration — run manually, once, on the FBT
-- production database AFTER 0001_initial.ts has been applied.
--
-- Two jobs:
--   1. Give every pre-existing merchant a `merchants` row, so MerchantTokenGuard
--      resolves them instead of rejecting with MERCHANT_NOT_FOUND. Without this,
--      every live merchant would have to reinstall.
--   2. Stagger `next_run_at` for merchants who ALREADY have automation enabled.
--      This is NOT optional. 0001 leaves next_run_at NULL, and the sweep's
--      due-selection treats NULL as due AND sorts it first — so the first tick
--      after migration would start sweeping every already-enabled merchant at
--      once, an unplanned OpenAI spend nobody asked for.
--
-- Both statements are idempotent and safe to re-run.

-- ─── 1. merchants backfill ───────────────────────────────────────────────

-- 1a. Dry run — how many merchants will be created?
SELECT COUNT(*) AS merchants_to_create
FROM (
  SELECT merchant_id FROM frequently_bought_bundle
  UNION
  SELECT merchant_id FROM merchant_recommendation_config
) AS src
WHERE src.merchant_id IS NOT NULL
  AND src.merchant_id <> ''
  AND src.merchant_id NOT IN (SELECT id FROM merchants);

-- 1b. Apply. installed_at comes from the merchant's earliest known row so the
--     admin shows a truthful install date rather than the migration timestamp.
--     is_active comes from platform_merchants when a row exists, else TRUE.
INSERT INTO merchants (id, is_active, installed_at, created_at, updated_at)
SELECT
  src.merchant_id,
  COALESCE(pm.is_active, TRUE),
  COALESCE(src.first_seen, CURRENT_TIMESTAMP(3)),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM (
  SELECT merchant_id, MIN(created_at) AS first_seen
    FROM frequently_bought_bundle
   WHERE merchant_id IS NOT NULL AND merchant_id <> ''
   GROUP BY merchant_id
  UNION
  SELECT merchant_id, MIN(created_at) AS first_seen
    FROM merchant_recommendation_config
   WHERE merchant_id IS NOT NULL AND merchant_id <> ''
   GROUP BY merchant_id
) AS src
LEFT JOIN platform_merchants pm ON pm.merchant_id = src.merchant_id
ON DUPLICATE KEY UPDATE merchants.id = merchants.id;

-- 1c. Verify: every merchant referenced by FBT data now exists.
SELECT COUNT(*) AS orphaned_bundles
FROM frequently_bought_bundle b
LEFT JOIN merchants m ON m.id = b.merchant_id
WHERE m.id IS NULL;
-- Expected: 0

-- ─── 2. next_run_at stagger ──────────────────────────────────────────────

-- 2a. Dry run — how many enabled merchants need scheduling?
SELECT COUNT(*) AS merchants_to_schedule
FROM merchant_recommendation_config
WHERE allow_automatic_recommendation = 1
  AND next_run_at IS NULL;

-- 2b. Apply. First run lands at the merchant's configured hour TOMORROW,
--     jittered across a 60-minute window. CRC32(merchant_id) is deterministic,
--     so re-running produces the same schedule (idempotent).
UPDATE merchant_recommendation_config
   SET next_run_at = TIMESTAMP(
         CURRENT_DATE + INTERVAL 1 DAY,
         MAKETIME(sync_hour_utc, 0, 0)
       ) + INTERVAL (CRC32(merchant_id) % 60) MINUTE
 WHERE allow_automatic_recommendation = 1
   AND next_run_at IS NULL;

-- 2c. Verify: nothing enabled is left unscheduled, and nothing is due already.
SELECT
  SUM(allow_automatic_recommendation = 1 AND next_run_at IS NULL)      AS unscheduled,
  SUM(allow_automatic_recommendation = 1 AND next_run_at <= NOW(3))    AS due_immediately
FROM merchant_recommendation_config;
-- Expected: unscheduled = 0, due_immediately = 0
