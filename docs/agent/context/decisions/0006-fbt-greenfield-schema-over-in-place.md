# 0006 — FBT migrates to a greenfield schema, not an in-place one

- **Date:** 2026-08-05
- **Status:** accepted

## Context

FBT ("Frequently Bought Together" — AI bundle recommendations via OpenAI
embeddings + cosine similarity) is migrating from its own four-project repo
(`osapp-freq-bought`: NestJS 10 + TypeORM backend, a second "ABS" sweep
service, a Next.js admin, a Bun SDK) into `ratio-apps` as vendor slug `fbt`.

The original design (branch `feat/fbt-foundation`, 20 commits, fully reviewed)
reused FBT's **existing production database in place**, with additive-only
migrations, because the old backend had to keep serving live merchants from
that same schema throughout a parallel-run cutover. That single constraint
drove a large amount of machinery: a static additive-DDL guard, an empirical
schema verifier run against a production-shaped fixture derived from the old
repo's nine TypeORM migrations, a `merchants` backfill runbook with a
`CRC32`-jittered `next_run_at` stagger, `information_schema` guards
throughout `0001` to make every ALTER idempotent, and a destructive `0002`
deferred to after decommission.

## Decision

Rebuild on a fresh branch (`feat/fbt-clean-schema`) with `fbt_app` as a
**greenfield** database — a fresh, empty schema in every environment,
following the same `fbt_`-prefixed, real-FK, no-`platform`-column pattern as
every other vendor. The old FBT production database is never read, written,
or migrated by anything in this app; it is kept read-only as a reference
until every live merchant confirms their new setup, then decommissioned.
Merchants reinstall the new Ratio app and reconfigure by hand rather than
having their data migrated.

## Rationale

Two facts, confirmed during design, retired the in-place constraint entirely:

1. **Only 1–5 merchants are live.** Per-merchant cutover (install, reconfigure,
   verify, flip one SDK URL) is a few hours of total work at this count, not
   a risky operation at scale.
2. **The move to `text-embedding-3-small` already invalidates every cached
   embedding vector**, regardless of migration strategy — there was no
   "old data" worth preserving in place even if the schema had stayed shared.

Given both, the user's ruling was explicit: nothing old transfers; everything
is new; merchants install and reconfigure. Auto bundles regenerate on the
first post-install sweep from zero; only manual bundles, widget styling, and
exclusion lists need re-entry by hand.

Alternatives considered and rejected:
- **Keep the in-place/additive design** (the superseded branch) — rejected
  once the two facts above were established; the safety machinery it required
  exists solely to make one database safe for two backends running
  simultaneously, and nothing is shared once cutover is per-merchant.
- **Migrate live data via a backfill** — rejected as unnecessary risk and
  effort: the embedding vectors are being discarded anyway (fact 2), and at
  1–5 merchants a backfill script costs more engineering time than manual
  re-entry.

## Consequences

- `0001_initial.ts` is an ordinary greenfield migration: `createSharedTables`
  plus six `fbt_`-prefixed `CREATE TABLE`s, real foreign keys to `merchants`,
  no `information_schema` guards, no `ALTER`s, no additive-only constraint, no
  backfill runbook, no `0002`.
- The static additive-DDL guard, the empirical schema verifier + production
  fixture, the `merchants` backfill runbook, and the `next_run_at` stagger are
  all **deleted outright**, not merely unused — they protect a two-backend
  scenario that no longer exists. Do not reintroduce them for FBT without
  re-establishing that constraint first.
- Cutover (Plan 6) becomes per-merchant and independently reversible: each
  merchant's rollback is flipping one storefront SDK URL back, because the old
  backend and its database keep running untouched until every merchant has
  confirmed the new app.
- The due-selection query for the sweep excludes `next_run_at IS NULL` rather
  than treating it as due, because every merchant now arrives via
  `FbtBootstrap` with automation off and `next_run_at = NULL` — the opposite
  of the in-place design, which had to catch up pre-existing enabled merchants.
- See `docs/agent/apps/fbt/CONTEXT.md` for the full standing context, and the
  gitignored `docs/superpowers/specs/2026-08-03-fbt-monorepo-migration-design.md`
  (Revision 1) for the complete original analysis.
