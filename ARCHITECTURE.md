# ARCHITECTURE.md

One backend, many modules, one MySQL database **per module**. Each vendor is a
NestJS *module* mounted on its own URL prefix inside a single `apps/backend/`
process. The repo ships with a golden template module, `_template`, kept on disk
as the scaffolder's copy-source (NOT wired or running); the live module is
`google`, mounted at `/google/*`. Adding a vendor means dropping in a new module +
admin SPA + its own database — `core/` is never forked.

## System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Ratio Marketplace                               │
│   Merchant clicks Install ──▶ ?code=…&state=…                              │
│        └──▶ https://<host>/<slug>/api/v1/oauth/callback                    │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              apps/backend  (NestJS 11 + Fastify, :3000)                    │
│                                                                            │
│   AppModule                                                                │
│   ├── core/                    SHARED LIBRARY — generic over a Kysely DB.  │
│   │   ├── crypto/              AES-256-GCM encrypt/decrypt                  │
│   │   ├── ratio-client/        OAuth token + introspection RPC             │
│   │   ├── db/kysely-factory.ts per-module Kysely client factory            │
│   │   ├── merchants/           MerchantsService<DB>   (generic)            │
│   │   ├── oauth/               OAuthService<DB> + AppBootstrap (generic)   │
│   │   ├── webhooks/            WebhooksService<DB> + dedupe (generic)      │
│   │   ├── health/             HealthRegistry + HealthController            │
│   │   ├── common/             ZodValidationPipe, filters, @Merchant deco   │
│   │   └── factories/          createAppProviders — the per-module wiring   │
│   │                                                                        │
│   └── modules/google/          mounted at /google/*  ── owns its own DB │
│       ├── kysely.module.ts     per-module Kysely pool, registers /ready    │
│       ├── google.module.ts     wires generic services via createAppProviders│
│       ├── google.bootstrap.ts  AppBootstrap — seeds config on install   │
│       ├── tokens.ts            module-private DI symbols                    │
│       ├── guards.ts            MerchantTokenGuard + WebhookSignatureGuard   │
│       ├── oauth/ config/ merchants/ sdk/ webhooks/   controllers/services  │
│       └── db/{types.ts, migrations/}   per-module schema                    │
│                                                                            │
│   Each module's Kysely client ──▶ its own MySQL database.                  │
│   No cross-module DB access; no @Global() providers (cross-module DI is    │
│   intentionally blocked).                                                   │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│   apps/admin-google (:5173)   React 19 + Vite + TanStack Router         │
│   Config form + dashboard. In a single-artifact deploy the backend serves  │
│   the built `dist/` as static assets (no separate host).                   │
└──────────────────────────────────────────────────────────────────────────┘
```

## The module / factory pattern

`core/` is a library: its services are plain classes generic over their `DB`
type. A module does not subclass them — it **wires** them through the
`createAppProviders` factory (`core/factories/app-module.factory.ts`), which:

- Reads the module's own Kysely client out of its `*_DB_TOKEN`.
- Instantiates `MerchantsService<DB>`, `OAuthService<DB>`, and
  `WebhooksService<DB>` against that client, plus a `CryptoService` keyed by the
  module's `RATIO_<SLUG_UPPER>_DATA_ENCRYPTION_KEY` and a `RatioClient`.
- Returns module-scoped providers keyed by the module's own DI symbols
  (`tokens.ts`). Because the symbols are module-owned, the providers stay
  module-private.

The factory handles only the SHARED wiring. App-specific pieces — `config` and
`sdk` services, the controllers, the `AppBootstrap` subclass, the webhook
handler, and the two guards — are registered directly by `<Slug>Module`. The
factory's `slug` argument drives all `RATIO_<SLUG_UPPER>_*` env lookups, so a
scaffolded module needs only its slug changed to bind to the right credentials.

### `core/` responsibilities (extend, don't fork)

`core/` owns everything cross-vendor: crypto, the Ratio OAuth/introspection
client, the Kysely client factory, the generic merchant/oauth/webhook services,
health probes, and the common Nest filters/pipes/decorators. New shared behavior
is generalized into `core/` so every module benefits — it is never copied into a
module.

## Per-module DB isolation (MySQL)

Each module gets its own database connected via
`RATIO_<SLUG_UPPER>_DATABASE_URL`. The discriminator is the database itself, not
a shared `app_key` column — the same merchant id can exist in multiple modules'
databases independently, by design. Every module's DB carries the same
per-merchant shape (from `db/migrations/0001_initial.ts`):

```
merchants         (id PK = Ratio merchant_id, is_active, installed_at, uninstalled_at, …)
oauth_tokens      (merchant_id PK, access_token_enc, refresh_token_enc, expires_at, scopes)
webhook_log       (id PK, ratio_webhook_id UNIQUE, topic, payload, signature_ok, …)
<slug>_configs    (merchant_id PK, …vendor-specific columns…)
```

The module's `kysely.module.ts` registers a probe with the shared
`HealthRegistry` at `onModuleInit`; `/ready` aggregates every module's probe
(each a `SELECT 1` under a 1-second timeout). Migrations are per-module and run
by the generic runner at `apps/backend/scripts/migrate.ts <slug>`.

## Install / uninstall (per module)

- **Install:** Ratio redirects to `/<slug>/api/v1/oauth/callback`. The module's
  `OAuthController` hands `(code, state)` to its bound `OAuthService<DB>`, which
  exchanges the code using the module's `RATIO_<SLUG>_CLIENT_*` creds and, in
  one transaction, upserts `merchants` + encrypted `oauth_tokens` and runs the
  module's `AppBootstrap` (seeds `<slug>_configs`). The merchant id is returned
  to the admin via an HttpOnly cookie.
- **Uninstall:** Ratio POSTs `/<slug>/api/v1/oauth/webhook` with an
  `X-OpenStore-Signature`. The module's `WebhookSignatureGuard` HMAC-verifies the
  raw body with `RATIO_<SLUG>_CLIENT_SECRET`; `WebhooksService` dedupes via
  `webhook_log` and dispatches the handler in the same transaction. The default
  `AppUninstalledHandler` flips `is_active=false` (config + tokens preserved for
  reinstall).

## Single-artifact deploy

One process serves both the API and the admin. Vite builds the admin SPA to
static files; the backend serves them (behind a `SERVE_STATIC` env flag so dev,
which runs Vite separately, is unaffected). Two supported targets:

- **Docker:** a multi-stage `Dockerfile` (install deps → `pnpm -r build` →
  `node:22` runtime with backend `dist` + admin `dist`) and `docker-compose.yml`
  bringing up MySQL + the backend image.
- **PM2:** `ecosystem.config.cjs` runs the built backend
  (`apps/backend/dist/apps/backend/src/main.js` — `dist` mirrors the repo tree
  per `tsconfig` `rootDir`) with `SERVE_STATIC=true`.

The `deployer` skill asks which target and produces the artifact accordingly.

## Rate limits

URL-regex matchers in `main.ts` are the single source of truth (no
`@RateLimit` decorator). Slugs flow into those regexes, which is why
`apps.ts` validates them against `/^[a-z0-9_-]+$/`. Update the regex list and
its comment block together when adding routes.

## Why this shape

Per-module DBs keep vendors isolated (a noisy or compromised vendor can't reach
another's data); a library-style `core/` keeps the shared logic in exactly one
place; the `createAppProviders` factory makes a new module a near-deterministic
copy-and-rename. That determinism is what lets the `vendor-scaffolder` skill
produce a buildable module without bespoke wiring.
