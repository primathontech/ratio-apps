---
name: vendor-scaffolder
description: Deterministically scaffold a new vendor app by copying the _template golden module + admin and renaming every identifier/path to <slug>, then wiring it into apps.ts, app.module.ts, and .env.example, and proving it compiles with pnpm install + typecheck. No business logic — pure copy-rename-wire.
when_to_use: The phase after GATE 3 (TDD approved). Use to produce an always-buildable starting point for the new vendor: the backend module, the admin app, and all wiring. Stops once the scaffold typechecks; backend-builder/frontend-builder implement the PRD next.
---

# vendor-scaffolder

You produce a **deterministic, always-buildable** scaffold for a new vendor by
copying the golden template and renaming. **No business logic** — the
`// TEMPLATE:` markers stay in place for the builders to replace next.

Preconditions: `gates.prd` is `approved` in STATE.json. Read STATE.json on entry
for the `slug` and `displayName`. Consult `house-conventions` (slug, env keys,
file naming) and `context-keeper`.

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

In `apps/backend/src/config/apps.ts` add `<slug>` to the `APPS` tuple:

```ts
export const APPS = ['google', '<slug>'] as const;
```

(the array shown is the then-current APPS plus your new slug — do NOT re-add `_template`, which is excluded from the running backend.)

The load-time guard accepts `/^[a-z0-9_-]+$/` (underscore reserved for `_template`); production vendor slugs must stay within `[a-z0-9-]`.

## Step 5 — Register the module in app.module.ts

In `apps/backend/src/app.module.ts`:
- `import { <Slug>Module } from './modules/<slug>/<slug>.module';`
- Add to `REGISTERED_MODULES`: `['<slug>', <Slug>Module]`.
- Add `<Slug>Module` to the `@Module({ imports: [...] })` array.

**Both** the map and `imports[]` are required: a load-time assertion in
`app.module.ts` throws `APPS contains '<slug>' but no <App>Module is registered`
if the slug is in `APPS` without a registered module. (The `imports[]` array
can't be generated from `APPS` because decorator args are static — hence the
assertion.)

## Step 6 — Shared schema/events (only if the PRD needs them)

If the PRD's config differs from the template's example, add neutral shared files
and export them from the barrel:
- `packages/shared/src/schemas/<slug>-config.ts` (from `_template-config.ts`,
  symbols renamed `Template`→`<Slug>`, including `<slug>ConfigInputSchema`).
- `packages/shared/src/constants/<slug>-events.ts` if needed.
- Export both from `packages/shared/src/index.ts`.

If the template's config shape already fits, you may keep importing the
`_template` shared schema for now and let `backend-builder` introduce a
vendor-specific schema. Be consistent with the import paths you renamed in Step 2.

## Step 7 — Add env keys to .env.example

Add a `RATIO_<SLUG>_*` block to `.env.example` (placeholders only; secrets
empty). `env.schema.ts` derives these from `APPS` automatically — you only edit
`.env.example`, never `env.schema.ts`:

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

## Step 8 — Prove it wires

```bash
pnpm install
pnpm -r typecheck
```

Expected: PASS across backend, shared, and `apps/admin-<slug>`. If typecheck
fails, you missed a rename in Step 2/3 — fix and re-run. Do not advance until the
scaffold compiles.

## Step 9 — Update STATE.json and hand back

Via `context-keeper`: set `paths.module = "apps/backend/src/modules/<slug>"` and
`paths.admin = "apps/admin-<slug>"`; append the scaffold files to `filesCreated`;
append a `vendor-scaffolder` history entry; advance `phase` to `backend-builder`.
Hand back to `build-app`.

## When stuck

- A typecheck error mentioning `_template` or `Template` = a missed rename; grep
  the module for the leftover token.
- The load-time assertion firing = you added to `APPS` but forgot
  `REGISTERED_MODULES` or `imports[]` in `app.module.ts`.
- Keep `// TEMPLATE:` markers intact — replacing them is the builders' job.
