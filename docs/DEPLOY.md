# Deployment runbook

This boilerplate ships as a **single artifact**: the NestJS backend serves the
built admin SPA as static assets (`SERVE_STATIC=true`), so one image / one
process carries the API, every vendor module's routes (`/<slug>/*`), the
per-merchant pixel (`/<slug>/sdk/:id.js`), and the admin UI.

```
┌──────────────────────────────────────────────────────────────┐
│                          host / cluster                        │
│   ┌────────────────────────────┐     ┌────────────────────┐   │
│   │ ratio-app-backend (1 proc) │────▶│ MySQL 9.x           │   │
│   │  • /<slug>/api  /<slug>/sdk │     └────────────────────┘   │
│   │  • /<slug>/* admin SPA      │                              │
│   │    (SERVE_STATIC=true)      │                              │
│   │  TLS terminated by ALB/Nginx│                              │
│   └────────────────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
                  ▲  OAuth callback, admin API, pixel.js, webhooks
                  ▼
        ┌─────────────────────────┐
        │ Ratio marketplace       │
        └─────────────────────────┘
```

One deployable, two supported runtimes — both build the same single artifact
(`pnpm -r build`: shared → backend → admin) and run the backend with
`SERVE_STATIC=true`.

## Option A — Docker (recommended)

```bash
# builds the multi-stage Dockerfile (deps → build → runtime) and starts
# mysql + backend; the image already sets SERVE_STATIC=true.
pnpm deploy:docker          # docker compose up -d --build
```

- `Dockerfile` (repo root) produces a `node:22-slim` runtime image carrying the
  backend dist, the shared dist, the built admin SPA, and prod `node_modules`.
- `docker-compose.yml` brings up `mysql` (init scripts in `docker/mysql/init`
  create `<slug>_app` databases) + `backend` on `:3000`.
- Per-vendor DB URL is passed via compose env, e.g.
  `RATIO_GOOGLE_DATABASE_URL=mysql://app:app@mysql:3306/google_app`.
- Run migrations once the DB is up: `NODE_ENV=production pnpm migrate`.

## Option B — PM2

```bash
pnpm install --frozen-lockfile
pnpm -r build
NODE_ENV=production pnpm migrate
pnpm deploy:pm2             # pm2 start ecosystem.config.cjs
```

`ecosystem.config.cjs` runs `apps/backend/dist/apps/backend/src/main.js` with
`cwd` = repo root and `SERVE_STATIC=true`, so the backend resolves the admin
build at `apps/admin-google/dist`. Use `pm2 save` + `pm2 startup` to persist
across reboots.

## Environment

Every vendor slug `<slug>` needs `RATIO_<SLUG_UPPER>_*` keys (see
`.env.example` and `apps/backend/src/config/env.schema.ts`):
`DATABASE_URL`, `DATA_ENCRYPTION_KEY` (44-char base64), `CLIENT_ID`,
`CLIENT_SECRET`, `CALLBACK_URL`, `ADMIN_BASE_URL`. For example, the `google` vendor upper-cases to `GOOGLE`, hence `RATIO_GOOGLE_*` keys.

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Adding a vendor to the deploy

When you scaffold a new vendor (e.g. slug `loyalty`):
1. `docker/mysql/init/01-database.sql` — add `CREATE DATABASE ... loyalty_app;`
   + grant.
2. `docker-compose.yml` — add `RATIO_LOYALTY_DATABASE_URL` to the backend env.
3. `.env` / secrets — add the `RATIO_LOYALTY_*` block.
4. Re-deploy (`pnpm deploy:docker` or rebuild + `pnpm deploy:pm2`) and run the
   migration: `pnpm --filter @ratio-app/backend exec tsx scripts/migrate.ts loyalty`
   (add a `migrate:loyalty` shortcut to the root `package.json` if you want one —
   only `migrate:google` exists out of the box).
5. The image serves ONE admin (`apps/admin-<slug>/dist`, the first non-`_`
   app in `APPS`). To serve a different vendor's admin, set `SERVE_ADMIN_SLUG=<slug>`;
   for a non-standard build layout, set `SERVE_STATIC_ROOT=/abs/path/to/dist`.
