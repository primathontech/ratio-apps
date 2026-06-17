---
name: stack-patterns
description: Canonical NestJS 11 + Fastify + Kysely + MySQL backend patterns and the React 19 + Vite + TanStack Router admin patterns used in this repo, with real file references in core/ and modules/_template/. A REFERENCE skill the backend-builder and frontend-builder consult; not a step in the flow.
when_to_use: Consult when implementing or reviewing a vendor module or admin — the NestJS module recipe (module + bootstrap + tokens + createAppProviders + per-module Kysely), config/sdk/merchants/webhooks/db-migration structure, the OAuth-callback + webhook-signature guard pattern, and the admin config-form + dashboard pattern. Workers read this before writing code.
---

# Stack patterns

Patterns are described against the **golden template** so you can read the real
source. After scaffolding, the same files exist under `modules/<slug>/` and
`apps/admin-<slug>/` with identifiers renamed (`Template`→`<Slug>`,
`TEMPLATE_`→`<SLUG>_`, `_template`→`<slug>`). Match these patterns exactly.

Stack: NestJS 11 + Fastify + Kysely + MySQL (backend); React 19 + Vite +
TanStack Router + React Query + react-hook-form + Zod + `@primathonos/orion`
(admin). pnpm workspaces, Node 22.

## Backend: the NestJS module recipe

A vendor module is a Nest feature module with **per-module DB isolation** — it
owns its own MySQL pool and never touches another module's data. Reference:
`apps/backend/src/modules/_template/`.

### 1. Tokens (`tokens.ts`)

Five DI symbols, namespaced per vendor, defined in their own file to break the
module↔services circular import:

```ts
export const TEMPLATE_CRYPTO   = Symbol.for('ratio-app:_template:crypto');
export const TEMPLATE_RATIO    = Symbol.for('ratio-app:_template:ratio');
export const TEMPLATE_MERCHANTS= Symbol.for('ratio-app:_template:merchants');
export const TEMPLATE_OAUTH    = Symbol.for('ratio-app:_template:oauth');
export const TEMPLATE_WEBHOOKS = Symbol.for('ratio-app:_template:webhooks');
```

### 2. Per-module Kysely (`kysely.module.ts`)

A small module providing a DB-client token (`TEMPLATE_DB_TOKEN =
Symbol.for('ratio-app:_template:db')`) built from `RATIO_<SLUG>_DATABASE_URL` via
`core/db/kysely-factory#createKyselyClient`. It is **not** `@Global()` (keeps DB
access module-scoped), registers a per-module health probe with `HealthRegistry`,
and closes the pool in `onApplicationShutdown`.

### 3. The shared provider factory (`createAppProviders`)

`core/factories/app-module.factory.ts` builds the five shared providers (Crypto,
Ratio client, Merchants, OAuth, Webhooks) for the module. The vendor module calls
it in its `providers[]` and passes its slug + tokens + bootstrap/handler classes:

```ts
...createAppProviders<TemplateDatabase>(
  { slug: '_template', dbToken: TEMPLATE_DB_TOKEN,
    bootstrapClass: TemplateBootstrap, handlerClass: TemplateAppUninstalledHandler },
  { CRYPTO: TEMPLATE_CRYPTO, RATIO: TEMPLATE_RATIO, MERCHANTS: TEMPLATE_MERCHANTS,
    OAUTH: TEMPLATE_OAUTH, WEBHOOKS: TEMPLATE_WEBHOOKS },
)
```

`slug` is what drives the `RATIO_<SLUG_UPPER>_*` env lookups **inside** the
factory (`CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL`, `DATA_ENCRYPTION_KEY`).
The factory handles only shared wiring; controllers and app-specific services are
registered directly by the module.

### 4. The module file (`_template.module.ts`)

`@Module` with `imports: [TemplateKyselyModule]`, all controllers, the
app-specific services (config, sdk), the bootstrap class, the uninstall handler,
the two guard classes, and the spread `createAppProviders(...)`. `exports: []` —
nothing crosses modules. It also re-exports tokens + guards from the barrel for
external (e2e) consumers.

### 5. The install bootstrap (`_template.bootstrap.ts`)

Implements `AppBootstrap<DB>` (`core/oauth/app-bootstrap.token`). Runs **inside
the OAuth install transaction**; seeds the vendor's config row so the admin's
`GET` config never 404s right after install. Uses INSERT … ON DUPLICATE KEY
UPDATE so reinstalls preserve prior settings.

## Backend: config / sdk / merchants / webhooks / db

- **config/** — `config.service.ts` does per-merchant config CRUD against
  `<slug>_configs` (MySQL has no `RETURNING`, so writes are INSERT…ODKU + compose
  response in memory). `config.controller.ts` mounts `GET/PUT /<slug>/api/<slug>-config`
  guarded by the merchant-token guard, plus a public `GET /<slug>/api/defaults`.
  The PUT body schema re-exports the shared `<slug>ConfigInput` Zod schema
  (`config/<slug>-config.dto.ts`).
- **sdk/** — `sdk.service.ts` is where the **vendor's actual integration** lives.
  In the template it renders a per-merchant pixel; for a real vendor this is the
  `// TEMPLATE:` spot to replace with your vendor SDK/API calls. `sdk.controller.ts`
  exposes the SDK endpoints.
- **merchants/** — `merchants.controller.ts` exposes merchant-scoped reads using
  the shared `MerchantsService<DB>` (injected via `<SLUG>_MERCHANTS`).
- **webhooks/** — `webhooks.controller.ts` is a **single** `POST
  /<slug>/api/v1/oauth/webhook` guarded by the webhook-signature guard; dispatch
  by `envelope.event` happens inside the shared `WebhooksService`. Each topic gets
  a handler implementing `WebhookHandler` (`{ topic, handle(data, merchantId, trx) }`).
  `app-uninstalled.handler.ts` (topic `app.uninstalled` — NOTE: that dot-form is the `_template` example; the platform webhook registry uses slash-form (`app/uninstalled`). Verify the exact `event` string against a live delivery before trusting it (a wrong topic silently no-ops). See docs/agent/context/learnings.md.) soft-deletes the merchant
  inside the dispatch transaction — wired by default; add more handlers per PRD.
  Handlers must finish fast (Ratio requires a 200 within ~5s) and write through the
  provided `trx`.
- **db/** — `types.ts` declares the Kysely `Database` interface (the standard
  `merchants`, `oauth_tokens`, `webhook_log` tables from `core/` base types, plus
  the vendor's own `<slug>_configs` and any PRD tables). `migrations/NNNN_*.ts`
  export `up(db)` / `down(db)` using `db.schema...`. `0001_initial.ts` creates the
  three standard tables + `<slug>_configs`. Run migrations with the generic runner:
  `pnpm --filter @ratio-app/backend exec tsx scripts/migrate.ts <slug>` (the runner
  resolves `src/modules/<slug>/db/migrations`; the slug must be in `APPS`).

## Backend: OAuth-callback + webhook-signature guard pattern

- **OAuth callback** (`oauth/oauth.controller.ts`, mounted
  `<slug>/api/v1/oauth`): `GET callback` takes Ratio's `?code`, calls
  `OAuthService.handleCallback(code)` (token exchange + bootstrap in one
  transaction), sets a short-lived HttpOnly install cookie
  (`ratio_install_merchant_<slug>`), and 302s to `RATIO_<SLUG>_ADMIN_BASE_URL/`.
  `GET/DELETE install/session` bridge the cookie to the SPA.
- **Guards** (`guards.ts`): NestJS `@UseGuards()` only accepts a class, but the
  underlying guards come from `core/` factories. So each guard is an `@Injectable()`
  class that builds the inner guard once in its constructor from DI:
  - `<Slug>WebhookSignatureGuard` — `createWebhookSignatureGuard(RATIO_<SLUG>_CLIENT_SECRET)`.
  - `<Slug>MerchantTokenGuard` — `createMerchantTokenGuard(<SLUG>_MERCHANTS service)`.
  Apply with `@UseGuards(<Slug>MerchantTokenGuard)` on config/merchant routes and
  `@UseGuards(<Slug>WebhookSignatureGuard)` on the webhook controller.
- **Validation**: request bodies/queries validate through `ZodValidationPipe`
  (`core/common/pipes`). The current merchant is injected via the
  `@CurrentMerchant()` decorator (`core/common/decorators`).

## Frontend: React/Vite/TanStack-Router admin pattern

Reference: `apps/_template-admin/`. File-based routes in `src/routes/` (`tsr
generate` produces `routeTree.gen.ts`). React Query for server state, a Zustand
`useMerchantStore` for the session token, `react-hook-form` + `zodResolver` for
forms, `@primathonos/orion` for UI components.

- **API layer** (`src/lib/api.ts`): a typed `api(method, path, body)` wrapper that
  prepends the vendor namespace. `VITE_API_BASE_URL` points at the backend root,
  and the lib prepends `/<slug>` so calls land on the vendor's mount. It attaches
  the Bearer token from `useMerchantStore` and unwraps the `{ data }` envelope.
- **Config form** (`src/routes/config.tsx`): a `react-hook-form` form resolved
  against the shared `<slug>ConfigInputSchema`, fed by `useConfig()` (GET) and
  saved via `useUpdateConfig()` (PUT) — both in `src/hooks/useConfig.ts`, both
  hitting `/api/<slug>-config`. Pre-fills defaults from the public `defaults`
  endpoint via `useDefaults()`.
- **Dashboard / landing** (`src/routes/index.tsx`) and other screens — add per
  PRD. `__root.tsx` runs the iframe-auth handshake (`useIframeAuth`) and the
  install-session bootstrap.
- **Build**: `pnpm --filter @ratio-app/admin-<slug> build` runs `tsr generate &&
  tsc --noEmit && vite build`, emitting static assets to `dist/` that the backend
  serves as the single deploy artifact.

## When stuck

- Compare your file side-by-side with the same file in `modules/_template/` /
  `apps/_template-admin/`. The template is always-buildable; if yours doesn't
  compile, you diverged from a pattern above.
- For the env keys a provider expects, re-read `core/factories/app-module.factory.ts`
  and `apps/backend/src/config/env.schema.ts`.
