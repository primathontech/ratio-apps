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
  many modules. Four live vendors: `google`, `meta`, `posthog`, `moengage`
  (declared in `apps/backend/src/config/apps.ts` as
  `APPS = ['google', 'meta', 'posthog', 'moengage'] as const`).
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

The repo currently has **four live vendors**: `google`, `meta`, `posthog`, and
`moengage`. A fifth (or later) vendor `<slug>` is scaffolded by appending to the
existing multi-entry `APPS` tuple — not replacing it.

The exact ordered recipe — append to `APPS`; the three `app.module.ts` additions;
the `docker/mysql/init/01-database.sql` CREATE+GRANT; the `packages/shared/src/index.ts`
barrel exports (`DEFAULT_<VENDOR>_EVENT_MAP`, not a generic alias); the
`.env.example` block (`env.schema.ts` derives keys from `APPS` — never edit it) —
and the collision check live in the **`vendor-scaffolder`** skill. Never scaffold
by hand.
Verify wiring with `pnpm verify` (or `pnpm install && pnpm -r typecheck`).

## Context & decisions (read before non-trivial work)

Durable context lives in `docs/agent/context/`. **Pull it on demand** — consult
[`context/INDEX.md`](./docs/agent/context/INDEX.md), a linked ADR, or an app's
`docs/agent/apps/<slug>/CONTEXT.md` only when your change touches that area and
you need a prior decision. Do **not** pre-read `CHANGELOG.md` / `learnings.md` /
every `CONTEXT.md`; prefer the smallest set of files that answers the question.
To persist a decision, learning, rule, or notable change, invoke the
**`remember`** skill (it classifies + writes + indexes). Obey the Standing rules
below.

**Making a change — classify first, then take the matching lane.** Classify the
change by size before doing anything; take the lane that matches and do not
over-process small work:

| Tier | What it is | Lane |
|---|---|---|
| **Trivial** | one file, obvious, reversible (typo, copy/text, version bump, comment, tiny config) | **Just do it → `pnpm verify` → done.** No spec, plan, or gate. |
| **Small** | a few files, clear approach, **no design choice** | **State a 1–3 line plan in chat → implement → `pnpm verify`.** No SPEC/PLAN docs; the inline plan is the checkpoint. |
| **Feature** | multi-file, a real design choice, or risk | **`brainstorm` → `write-plan` → `execute`** (writes SPEC + PLAN, gates at each). |
| **New vendor app** | a whole new vendor | **`build-app`** (five gates). |

Tie-breakers (apply in order):
- Unsure trivial vs small → treat as **small**.
- Unsure small vs feature → ask "is there a design choice or real risk?" — if yes → **feature**.
- A change touching `apps/backend/src/core/`, `apps/backend/src/config/apps.ts`,
  `apps/backend/src/config/env.schema.ts`, the `APPS` tuple, OAuth/crypto/auth, DB
  migrations, or deploy is **always feature** (high blast radius), regardless of
  line count.
- A bug whose root cause is not yet confirmed is **feature** until you reproduce
  it and confirm the cause (never fix without a confirmed root cause).

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

**Definition of Done** scales by tier. **Trivial / small** changes are done when
`pnpm verify` is green — record a change-journal / `remember` entry ONLY if the
change is genuinely notable (a behavior change worth future recall, never a
typo). **Feature / new-vendor** work is not done until all five hold:
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
