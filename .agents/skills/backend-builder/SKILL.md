---
name: backend-builder
description: Implement the scaffolded vendor backend module per the PRD — config DTO/service fields, the sdk.service.ts vendor integration, merchants/webhooks handlers, and a Kysely migration for the PRD data model — replacing every // TEMPLATE: marker. Verifies with backend typecheck and updates STATE.json.
when_to_use: The phase after vendor-scaffolder. Use to turn the deterministic scaffold into the real vendor backend described in the PRD. Consults stack-patterns; leaves the admin to frontend-builder.
---

# backend-builder

You implement the scaffolded vendor module (`apps/backend/src/modules/<slug>/`)
to satisfy the PRD. The scaffold already compiles and wires; your job is to fill
in the vendor's real behavior and **replace every `// TEMPLATE:` marker**.

Read STATE.json on entry for `slug`, `scopes`, `webhooks`, `paths.module`, and
`deployment`.
Read the three approved docs: `docs/agent/apps/<slug>/PRD.md` (what), `TRD.md`
(the technical design you implement), and `TDD.md` (the test plan you satisfy).
Consult `stack-patterns` for the canonical module/config/sdk/webhooks/migration
patterns, and `house-conventions`.

**Test-driven:** for each backend case in `TDD.md`, write the **failing test
first** (Vitest, under `apps/backend/test/unit/**`), then implement the code below
until it passes. Do not advance with red tests.

## What to implement (per the PRD)

### 1. Config schema + DTO + service

- Shared schema (`packages/shared/src/schemas/<slug>-config.ts`): set the config
  fields the PRD's merchant edits (replace the template's example `apiKey`/`host`).
  Export the input schema; rebuild shared (`pnpm --filter @ratio-app/shared build`)
  so the backend picks up the types.
- `config/<slug>-config.dto.ts`: re-export the shared input schema as the PUT body.
- `config/config.service.ts`: align the upsert/select columns with the new fields.
- `config/config.controller.ts`: keep the guarded `GET/PUT /<slug>/api/<slug>-config`
  shape; adjust `GET defaults` to the new fields.

### 2. SDK / vendor integration (`sdk/sdk.service.ts`)

This is the core `// TEMPLATE:` spot. Replace the template's placeholder
(pixel render / `buildPrelude`) with the vendor's real integration — e.g.
forwarding events to the vendor API, calling the vendor SDK, or whatever the PRD
specifies. Use the injected per-module Crypto/Ratio/Merchants services as needed.
Update `sdk/sdk.controller.ts` to expose the endpoints the PRD requires.

### 3. Merchants (`merchants/merchants.controller.ts`)

Expose the merchant-scoped reads the PRD needs via the shared
`MerchantsService<<Slug>Database>` (injected through `<SLUG>_MERCHANTS`), guarded
by `<Slug>MerchantTokenGuard`.

### 4. Webhooks (`webhooks/`)

`app-uninstalled.handler.ts` (topic `app.uninstalled` — NOTE: that dot-form is the `_template` example; the platform webhook registry uses slash-form (`app/uninstalled`). Verify the exact `event` string against a live delivery before trusting it (a wrong topic silently no-ops). See docs/agent/context/learnings.md.) is wired by default —
keep it. For each additional webhook topic in the PRD, add a handler implementing
`WebhookHandler` (`{ topic, handle(data, merchantId, trx) }`), register it in the
module's `providers[]`, and ensure the shared `WebhooksService` dispatches it.
Handlers must be fast (200 within ~5s) and write through the provided `trx`.

### 5. Database migration (`db/`)

For the PRD data model, add a new migration `db/migrations/NNNN_<name>.ts`
(next zero-padded number after `0001_initial.ts`) with `up`/`down` using
`db.schema...`. Update `db/types.ts` to declare the new tables/columns on the
`<Slug>Database` Kysely interface. Follow `0001_initial.ts` conventions: `varchar`
PK FKs to `merchants.id`, `datetime(3)` timestamps, `boolean`/`json` columns,
named FK constraints. Do NOT edit `0001_initial.ts` if it has already run — add a
new numbered migration. Apply locally with:

```bash
pnpm --filter @ratio-app/backend exec tsx scripts/migrate.ts <slug>
```

(The runner resolves `src/modules/<slug>/db/migrations`; `<slug>` must be in `APPS`.)

### 6. Queue worker, when selected

- `deployment.workerPlacement: none` — do not introduce a queue, worker flag, or
  consumer.
- `shared-api` or `dedicated-worker` — implement the same module-owned consumer
  code, self-gated by the exact `*_WORKER_ENABLED` flag specified in the TRD.
  Test disabled startup, enabled consumption, acknowledgement/retry behavior,
  and shutdown. Placement changes the external process configuration, not the
  worker implementation.

Do not branch module code on `apiPlacement`; `ENABLED_MODULES` and the external
EKS pipeline decide whether the module runs in the shared or dedicated API.

## Remove every `// TEMPLATE:` marker

Grep the module and confirm none remain — they mark places that MUST be
customized for a real vendor:

```bash
grep -rn "// TEMPLATE:" apps/backend/src/modules/<slug>
```

## Verify

```bash
cd apps/backend && pnpm typecheck && pnpm test
```

Both must PASS — typecheck (`tsc --noEmit` + the pixel tsconfig) and the Vitest
suite (every backend case from `TDD.md` now green). If you changed shared schemas,
rebuild shared first so the backend sees the new types. Fix all errors before
advancing.

## Update STATE.json

Via `context-keeper`: append implemented/migration files to `filesCreated`;
append a `backend-builder` history entry; advance `phase` to `frontend-builder`.
Hand back to `build-app`.

## When stuck

- Compare each file against the same file in `modules/_template/` — the patterns
  are identical, only the vendor logic differs.
- A typecheck error in the config layer is usually a Zod input/output mismatch —
  see how `config/<slug>-config.dto.ts` re-exports the shared type rather than
  using a local `z.infer`.
- For DB column ⇄ Kysely type mismatches, keep `db/types.ts` and the migration in
  lockstep.
