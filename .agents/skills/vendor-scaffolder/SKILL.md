---
name: vendor-scaffolder
description: Deterministically scaffold a new vendor app by copying the _template golden module + admin and renaming every identifier/path to <slug>, then wiring it into apps.ts, module-registry.ts, and .env.example, and proving it compiles with pnpm install + typecheck. No business logic — pure copy-rename-wire.
when_to_use: The phase after GATE 3 (TDD approved). Use to produce an always-buildable starting point for the new vendor: the backend module, the admin app, and all wiring. Stops once the scaffold typechecks; backend-builder/frontend-builder implement the PRD next.
---

# vendor-scaffolder

You produce a **deterministic, always-buildable** scaffold for a new vendor by
copying the golden template and renaming. **No business logic** — the
`// TEMPLATE:` markers stay in place for the builders to replace next.

Preconditions: `gates.prd` is `approved` in STATE.json. Read STATE.json on entry
for the `slug`, `displayName`, and required `deployment` object. Stop if
`deployment.apiPlacement` or `deployment.workerPlacement` is missing; route back
to `build-app` because scaffolding must not invent production placement.
Consult `house-conventions` (slug, env keys, file naming) and `context-keeper`.

Define the identifier transform once and apply it everywhere:
- `Template` → `<Slug>` (PascalCase, e.g. `Loyalty`) — class/type prefixes.
- `TEMPLATE_` → `<SLUG>_` (uppercased slug) — DI token consts.
- `_template` → `<slug>` — slug literals, `Symbol.for('ratio-app:<slug>:*')`,
  import paths, URL prefixes, cookie names, table names, and filenames.

Below, replace `<slug>`/`<Slug>`/`<SLUG>` with the real values.

## Step 1 — Copy the backend module and rename entry files

```bash
cp -R apps/backend/src/modules/_template apps/backend/src/modules/<slug>
mv apps/backend/src/modules/<slug>/_template.module.ts \
   apps/backend/src/modules/<slug>/<slug>.module.ts
mv apps/backend/src/modules/<slug>/_template.bootstrap.ts \
   apps/backend/src/modules/<slug>/<slug>.bootstrap.ts
mv apps/backend/src/modules/<slug>/config/_template-config.dto.ts \
   apps/backend/src/modules/<slug>/config/<slug>-config.dto.ts
```

Leave subfolder generic filenames (`config.controller.ts`, `sdk.service.ts`,
`webhooks.controller.ts`, migrations, etc.) unchanged.

## Step 2 — Rename identifiers across the module

In **every `.ts` file** under `apps/backend/src/modules/<slug>/`, apply the
transform above. Concretely this covers:
- Class/type names: `TemplateModule`→`<Slug>Module`, `TemplateConfigService`,
  `TemplateBootstrap`, `TemplateDatabase`, `TemplateAppUninstalledHandler`,
  `TemplateWebhookSignatureGuard`, `TemplateMerchantTokenGuard`, etc.
- Token consts in `tokens.ts` and `kysely.module.ts`:
  `TEMPLATE_CRYPTO`→`<SLUG>_CRYPTO`, …, `TEMPLATE_DB_TOKEN`→`<SLUG>_DB_TOKEN`.
- `Symbol.for('ratio-app:_template:*')` → `Symbol.for('ratio-app:<slug>:*')`.
- The factory call `slug: '_template'` → `slug: '<slug>'`.
- Env-key string literals that hardcode the slug:
  `RATIO_TEMPLATE_CLIENT_SECRET`→`RATIO_<SLUG>_CLIENT_SECRET`,
  `RATIO_TEMPLATE_DATABASE_URL`→`RATIO_<SLUG>_DATABASE_URL`,
  `RATIO_TEMPLATE_ADMIN_BASE_URL`→`RATIO_<SLUG>_ADMIN_BASE_URL`.
- URL prefixes `@Controller('_template/...')` → `@Controller('<slug>/...')`.
- Cookie name `ratio_install_merchant__template` → `ratio_install_merchant_<slug>`.
- Table name `_template_configs` → `<slug>_configs` (in `db/types.ts`,
  `db/migrations/*.ts`, `config.service.ts`, `<slug>.bootstrap.ts`).
- Shared import paths `@ratio-app/shared/schemas/_template-config` →
  `.../<slug>-config` and `@ratio-app/shared/constants/_template-events` →
  `.../<slug>-events` (see Step 6 — only if you create those).

Tip: a careful case-sensitive sweep — `Template`→`<Slug>`, then `TEMPLATE`→`<SLUG>`,
then `_template`→`<slug>` — covers most of it; then read each file to fix the
remaining literals (env keys, cookie, table, URL prefix).

## Step 3 — Copy and rename the admin app

```bash
rsync -a --exclude node_modules --exclude dist --exclude coverage --exclude .tanstack \
  apps/_template-admin/ apps/admin-<slug>/
```

- In `apps/admin-<slug>/package.json` set `"name": "@ratio-app/admin-<slug>"`.
- In `apps/admin-<slug>/src/lib/api.ts` change the `/_template` namespace prepend
  to `/<slug>`.
- Rename `_template`→`<slug>` in shared imports and any `_template`-prefixed
  identifiers across `src/` (config schema/events imports, copy strings). Leave
  full screen implementation to `frontend-builder`.

## Step 4 — Add the slug to APPS

**Before you edit:** assert your new slug collides with none of the five live
vendors (`google`, `meta`, `posthog`, `moengage`, `wizzy`) and is not `_template`.

In `apps/backend/src/config/apps.ts` **APPEND** `<slug>` to the existing
five-entry `APPS` tuple — do NOT replace any existing entry:

```ts
// Before (five live vendors):
export const APPS = ['google', 'meta', 'posthog', 'moengage', 'wizzy'] as const;

// After (append only — existing five entries stay intact):
export const APPS = ['google', 'meta', 'posthog', 'moengage', 'wizzy', '<slug>'] as const;
```

`_template` is intentionally absent from `APPS` — it is the golden boilerplate
kept on disk only as a copy-source; it is NOT a running vendor.

The load-time guard in `apps.ts` accepts `/^[a-z0-9_-]+$/` (underscore reserved
for `_template`); production vendor slugs must stay within `[a-z0-9-]`.

## Step 5 — Register the module in module-registry.ts

In `apps/backend/src/module-registry.ts` make **two** additions, leaving the
existing five entries intact:

1. **Import line** (alongside the existing five):
   ```ts
   import { <Slug>Module } from './modules/<slug>/<slug>.module';
   ```

2. **`MODULE_REGISTRY` map** — append a new entry:
   ```ts
   export const MODULE_REGISTRY = new Map<AppSlug, unknown>([
     ['google',    GoogleModule],
     ['meta',      MetaModule],
     ['posthog',   PosthogModule],
     ['moengage',  MoengageModule],
     ['wizzy',     WizzyModule],
     ['<slug>',    <Slug>Module],   // ← append here
   ]);
   ```

`app.module.ts` resolves the enabled slugs through this registry and builds its
imports dynamically. The load-time assertion in `module-registry.ts` throws
`MODULE_REGISTRY: APPS contains '<slug>' but no <App>Module is registered` if
the slug is added to `APPS` without a registry entry.

Do not hard-code deployment groups in application source. `ENABLED_MODULES`
already accepts a comma-separated subset. The external EKS pipeline assembles
the shared/dedicated workload from the approved STATE placement.

## Step 6 — Shared schema/events (only if the PRD needs them)

Add vendor-specific shared files and export them from the barrel
(`packages/shared/src/index.ts`). The analytics/event apps (`google`, `meta`,
`posthog`, `moengage`) follow this pattern; Wizzy instead owns search/config
schemas without an event map.

**a) Events file** `packages/shared/src/constants/<slug>-events.ts`:
- Export `DEFAULT_<VENDOR>_EVENT_MAP` (e.g. `DEFAULT_LOYALTY_EVENT_MAP`).
- Do **NOT** re-export a generic `DEFAULT_EVENT_MAP` alias — only
  `_template-events.ts` does that for back-compat; all real vendor files export
  their own named constant (see `meta-events.ts`, `google-events.ts`).
- If your vendor needs a default event map that differs from the template's
  snake_case names, add `| '<slug>'` to the existing `vendor` union in
  `buildDefaultEventMap`'s signature in
  `packages/shared/src/schemas/event-map.ts` — the real signature is
  `buildDefaultEventMap(vendor?: 'meta' | 'posthog' | 'moengage'): EventMap` —
  and add a `vendor === '<slug>' ? DEFAULT_<VENDOR>_EVENT_MAP : …` branch,
  importing `DEFAULT_<VENDOR>_EVENT_MAP` from your new events file. If your
  vendor's defaults match the template's snake_case names, no branch is needed —
  the default branch returns `DEFAULT_TEMPLATE_EVENT_MAP` (this is what
  posthog/google do).

**b) Config file** `packages/shared/src/schemas/<slug>-config.ts`:
- From `_template-config.ts`; rename `Template`→`<Slug>` everywhere, including
  `<slug>ConfigInputSchema`.

**c) Barrel exports** in `packages/shared/src/index.ts` — append after the
existing vendor blocks:
```ts
// <slug> vendor (scaffolded).
export * from './constants/<slug>-events';
export * from './schemas/<slug>-config';
```

If the template's config shape already fits, you may keep importing
`_template-config` for now and let `backend-builder` introduce the
vendor-specific schema. Be consistent with the import paths renamed in Step 2.

## Step 7 — Add the DB databases to docker/mysql/init/01-database.sql

Append a `<slug>_app` + `<slug>_app_test` CREATE and GRANT block to
`docker/mysql/init/01-database.sql`, after the last existing vendor block
(`wizzy_app`). The file currently has six blocks (five live apps plus
`_template_app`); your new block is the seventh:

```sql
CREATE DATABASE IF NOT EXISTS <slug>_app;
CREATE DATABASE IF NOT EXISTS <slug>_app_test;
```

and (near the bottom, after the existing GRANTs):

```sql
GRANT ALL ON `<slug>_app`.*      TO 'app'@'%';
GRANT ALL ON `<slug>_app_test`.* TO 'app'@'%';
```

This init script runs only on a fresh Docker volume; existing containers need
a manual `CREATE DATABASE` if already running.

## Step 8 — Add env keys to .env.example

Add a `RATIO_<SLUG>_*` block to `.env.example` (placeholders only; secrets
empty). `env.schema.ts` derives these keys from `APPS` automatically via a
`.reduce` — you only edit `.env.example`, **never `env.schema.ts`**:

```
RATIO_<SLUG>_DATABASE_URL=mysql://app:app@localhost:3306/<slug>_app
RATIO_<SLUG>_DATA_ENCRYPTION_KEY=
RATIO_<SLUG>_CLIENT_ID=
RATIO_<SLUG>_CLIENT_SECRET=
RATIO_<SLUG>_CALLBACK_URL=http://localhost:3000/<slug>/api/v1/oauth/callback
RATIO_<SLUG>_ADMIN_BASE_URL=http://localhost:5173
```

Remind the operator to add a real block to their local `.env` (with a generated
encryption key) — never commit `.env`.

## Step 8b — Storefront SDK (only when `hasStorefrontSdk: true`)

**Skip this step entirely unless STATE.json / the PRD sets
`hasStorefrontSdk: true`** (Google, Meta, PostHog, and MoEngage do not; absence
means false).
When set, the app ships a third pillar: a Lit 3 + Vite library-mode SDK package
served by the vendor backend at `/<slug>/sdk/*`. Reference impl:
`packages/wizzy-sdk`.

1. **Copy + rename the package** from the golden SDK template:
   ```bash
   cp -R packages/_template-sdk packages/<slug>-sdk
   ```
   Replace the `__slug__` / `__Slug__` / `__SLUG__` placeholders with the vendor
   slug (lower / Pascal / upper) in **file contents AND filenames** — including
   `package.json` `"name": "@ratio-app/<slug>-sdk"`, the `vite.*.config.ts`
   bundle names, and `.size-limit.json` paths (`dist/<slug>-loader.js`,
   `dist/<slug>-widget.js`, `dist/<slug>-results.js`).

2. **Fill the `// TEMPLATE:` markers** — especially the vendor **search-API base
   URL + endpoints** in `src/client.ts` (the typed `Client`). Leave the rest of
   the deeper implementation (UI components, result shapes) to `frontend-builder`;
   the scaffold only needs to typecheck.

3. **Add it to the workspace.** `_template-sdk` is excluded in
   `pnpm-workspace.yaml` (its `__slug__` placeholders aren't valid TS), but
   `packages/<slug>-sdk` IS a real buildable package — the `packages/*` glob picks
   it up automatically, so just ensure no explicit `!packages/<slug>-sdk`
   exclusion exists.

4. **Register backend serving routes.** Copy the `storefront/` folder pattern
   from the reference (`apps/backend/src/modules/wizzy/storefront/`): a
   `StorefrontController` mounted `@Controller('<slug>/sdk')` that serves the
   three built bundles from `packages/<slug>-sdk/dist` (loader/widget/results) and
   a **public** `GET config/:merchantId` (no merchant guard, permissive CORS),
   plus a `StorefrontConfigService`. Register both in `<slug>.module.ts`.

5. **Add a `0003`-style migration** for the storefront config columns
   (`search_enabled`, `input_selector`, `results_mount_selector`,
   `results_page_path`, `theme_primary`) — additive `ALTER TABLE <slug>_configs`,
   mirroring `wizzy/db/migrations/0003_add_storefront_config.ts`.

**Size budget** (enforced via `size-limit`): loader ≤ 3 KB, widget ≤ 10 KB,
results ≤ 16 KB. **Public-endpoint auth rule:** the storefront SDK runs in the
shopper's browser, so it calls the vendor API with **public creds only** (e.g.
store id + public api key) — the secret (`storeSecret`/`CLIENT_SECRET`) must NEVER
reach the browser or the public config endpoint.

## Step 9 — Prove it wires

```bash
pnpm install
pnpm -r typecheck
```

Expected: PASS across backend, shared, and `apps/admin-<slug>`. If typecheck
fails, you missed a rename in Step 2/3 — fix and re-run. Do not advance until the
scaffold compiles.

## Step 10 — Update STATE.json and hand back

Via `context-keeper`: set `paths.module = "apps/backend/src/modules/<slug>"` and
`paths.admin = "apps/admin-<slug>"`; append the scaffold files to `filesCreated`;
preserve the approved `deployment` object unchanged;
append a `vendor-scaffolder` history entry; advance `phase` to `backend-builder`.
Hand back to `build-app`.

## When stuck

- A typecheck error mentioning `_template` or `Template` = a missed rename; grep
  the module for the leftover token.
- The load-time assertion firing = you added to `APPS` but forgot the import or
  map entry in `module-registry.ts`.
- Keep `// TEMPLATE:` markers intact — replacing them is the builders' job.
