# 0003 — Four-vendor monorepo consolidation (Phase 2)

- **Date:** 2026-06-17
- **Status:** accepted

## Context
The repo started as a single-vendor google app. Phases 1 and 2 ported three
additional vendors (meta, posthog, moengage) into the same monorepo so they
share one NestJS backend core, one `@ratio-app/shared` package, one Docker
compose stack, and one set of harness skills. The `_template` golden module
stays on disk as the scaffolder's copy source.

## Decision
`ratio-apps` is the **four-vendor unified monorepo**: `APPS = ['google', 'meta',
'posthog', 'moengage']`. Each vendor owns an isolated backend module
(`apps/backend/src/modules/<slug>/`), its own admin SPA (`apps/admin-<slug>/`),
and its own MySQL database (`<slug>_app`). All share:
- `apps/backend/src/core/` — factories, health, OAuth, merchants, DB utils.
- `packages/shared/` — Zod config/events schemas, OpenStore event types.
- Root tooling: pnpm workspace, Biome, TypeScript, Vitest, Docker.

The `vendor-scaffolder` skill in `.agents/skills/vendor-scaffolder/SKILL.md`
encodes the full copy-rename-wire recipe to append a 5th vendor in O(1) steps.

## Rationale
Per-module DB isolation (no shared tables) prevents cross-vendor coupling.
Shared core keeps auth/webhook/SDK boilerplate DRY. A single typecheck/verify
pass validates the entire fleet. The scaffolder recipe removes the cognitive
overhead of wiring a new vendor from scratch.

## Consequences
- Adding a vendor: follow `vendor-scaffolder` recipe → typecheck passes → ship.
- Removing a vendor: delete module + admin + APPS entry + shared files + DB block.
- The `_template` module must stay on disk as long as the scaffolder copies from it.
- `buildDefaultEventMap(vendor?)` in `packages/shared/src/schemas/event-map.ts`
  has per-vendor branches for `meta` and `moengage` (non-snake_case names);
  new vendors that use snake_case defaults need no branch (posthog/google pattern).
