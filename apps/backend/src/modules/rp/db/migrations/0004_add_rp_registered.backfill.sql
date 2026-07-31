-- Ops runbook script, NOT a Kysely migration — run manually, once, on the RP
-- adapter DB after 0004_add_rp_registered.ts has been deployed.
--
-- Why: 0004 adds `rp_registered` as NOT NULL DEFAULT false. Every merchant
-- already registered in production before this deploy will get false, even
-- though they're genuinely registered — RpAdminController.me() now reads
-- ONLY rp_registered (no longer `domain != merchant_id`), so without this,
-- every existing merchant gets bounced back to the registration form on
-- their next dashboard load.
--
-- This backfill applies the exact same heuristic `registered` used to be
-- computed from pre-0004 (domain !== merchant_id), so it reproduces prior
-- behavior for existing rows exactly. Safe to re-run (idempotent — only
-- flips rows that are currently false and qualify).

-- 1. Dry run first — check how many rows this will affect:
SELECT COUNT(*) AS rows_to_backfill
FROM return_prime_merchants
WHERE rp_registered = false
  AND domain != merchant_id;

-- 2. Apply:
UPDATE return_prime_merchants
SET rp_registered = true
WHERE rp_registered = false
  AND domain != merchant_id;
