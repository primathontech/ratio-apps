# AGENTS.md

The contract every AI assistant (Claude, Cursor, Copilot, and any future tool)
reads first when working in this repo. `CLAUDE.md` is a one-line pointer here;
do not maintain a separate copy.

This monorepo is an **agent-native boilerplate**: a PRD drives the full
lifecycle of one new vendor app — PRD → TRD → TDD → scaffold → build → review →
PR → deploy — through a committed skills library, retaining context in a
per-build state file. Skills live in **`.agents/skills/`** (symlinked as
`.claude/skills/` so Claude Code discovers them); the entry point is the
**`build-app`** skill. See [`docs/agent/README.md`](./docs/agent/README.md) for
the flow.

## The locked stack

Do not introduce alternative frameworks for these concerns.

- **Backend:** NestJS 11 + Fastify, Kysely query builder, MySQL. One process,
  many modules.
- **Admin:** React 19 + Vite + TanStack Router (one SPA per vendor).
- **Shared:** Zod schemas + event constants in `packages/shared`.
- **Tooling:** pnpm workspaces, Node 22, Biome (lint + format), Vitest.
- **Deploy:** single artifact — the backend serves the built admin static
  assets — via Docker or PM2.

## The `_template` golden-path rule

`apps/backend/src/modules/_template/` + `apps/_template-admin/` are the **golden
template** — kept on disk as the scaffolder's **copy-source** (NOT wired or
running; excluded from `APPS`/workspace per ADR 0002). A new vendor is always
**scaffolded FROM the template** (copied + renamed) — **never hand-rolled**, and
never built by editing `_template` itself. (Full rule + the `// TEMPLATE:` marker
convention: the **`house-conventions`** skill.)

## The `core/` boundary

`apps/backend/src/core/` is **shared infrastructure** (crypto, ratio-client, the
per-module Kysely factory, generic `MerchantsService<DB>`/`OAuthService<DB>`/
`WebhooksService<DB>`, the `createAppProviders` factory). **Extend `core/`, never
fork it per vendor**; providers are module-scoped (no `@Global()`) and each module
owns its own DB. (Full detail: **`house-conventions`**.)

## Add a new app

Adding a vendor `<slug>` is a deterministic copy-rename-wire from `_template`,
performed by the **`vendor-scaffolder`** skill (or `build-app` end-to-end) — never
by hand. The exact ordered file list (`apps.ts` → `app.module.ts` → `.env.example`
→ shared schema → admin) is the **`vendor-scaffolder`** skill's step-by-step
recipe; slug / env-key / `core/` / commit conventions live in **`house-conventions`**.
Verify wiring with `pnpm verify` (or `pnpm install && pnpm -r typecheck`).

## Context & decisions (read before non-trivial work)

Durable context lives in `docs/agent/context/` — skim
[`context/INDEX.md`](./docs/agent/context/INDEX.md) and the relevant
`docs/agent/apps/<slug>/CONTEXT.md` before changing an app. To persist a
decision, learning, rule, or notable change, invoke the **`remember`** skill
(it classifies + writes + indexes). Obey the Standing rules below.

**Making a change:** a *new vendor app* → the `build-app` skill. *Any other
feature / bug / PR* → start with the **`brainstorm`** skill (it chains
`brainstorm → write-plan → execute`, scales to size, and ends at the Definition
of Done). Do not write code for a non-trivial change before its spec + plan are
approved.

## Standing rules

- Never edit `_template` to build a vendor — scaffold a copy (see golden-path rule).
- Extend `core/`, never fork it per vendor.
- Never commit `.env` or secrets (and never write secrets into context files).
- Run `pnpm verify` and satisfy the Definition of Done before claiming work complete.
- Record notable features/fixes in the app's `CONTEXT.md` change journal via `remember`.

## State

- [`docs/agent/FEATURES.md`](./docs/agent/FEATURES.md) — registry of capabilities + lifecycle status.
- [`docs/agent/PROGRESS.md`](./docs/agent/PROGRESS.md) — in-flight multi-session work only.
- `docs/agent/apps/<slug>/CONTEXT.md` — per-app standing context + change journal.
- `docs/agent/apps/<slug>/STATE.json` — one build's lifecycle state (see `STATE.schema.md`).

## Verification / feedback loop

`pnpm verify` = `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`
(blocks on first failure) — the single command that proves work is green.

**Definition of Done** — work is not done until:
1. `pnpm verify` is green;
2. the change is recorded in the relevant change journal (feature context / definition-of-fix), notable changes only;
3. `FEATURES.md` status is updated if a capability's lifecycle changed;
4. any durable learning/decision is saved via `remember`;
5. `PROGRESS.md` is cleared if the work was tracked there as in-flight.

This is the single source for the Definition of Done — the `execute` skill and others reference it rather than restating it.

## Conventional commits

`type(scope): description`. `type` is the standard set (`feat`, `fix`, `docs`,
`chore`, `refactor`, `test`, ...). `scope` is the **vendor slug** (`loyalty`) or
a top-level area (`backend`, `shared`, `deploy`, `skills`, `agent`). Commit or
push only when asked; if on the default branch, branch first. Never commit
`.env` or secrets.

## Entry point

To build a new vendor app, invoke the **`build-app`** skill (in `.agents/skills/`,
symlinked under `.claude/skills/`) with a PRD. It walks the phases and enforces
five human gates — PRD, TRD (technical design), TDD (test plan), before PR, and
before deploy — keeping `docs/agent/apps/<slug>/{PRD,TRD,TDD}.md` and `STATE.json`
current throughout. No code is scaffolded until PRD, TRD, and TDD are approved.
See [`docs/agent/README.md`](./docs/agent/README.md).
