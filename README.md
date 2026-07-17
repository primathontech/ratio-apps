# ratio-apps

The unified Ratio marketplace monorepo for five live apps: Google, Meta,
PostHog, MoEngage, and Wizzy. Each app owns a NestJS module, admin SPA, and
MySQL database while sharing the backend core and one backend-only container image.

## Live apps

| Slug | Capability | Background worker |
|---|---|---|
| `google` | GA4, Google Ads, Merchant Center | SQS product sync (`GOOGLE_SYNC_WORKER_ENABLED`) |
| `meta` | Meta Pixel, Conversions API, catalog | SQS CAPI delivery (`META_WORKER_ENABLED`) |
| `posthog` | Browser product analytics | None |
| `moengage` | Browser customer engagement | None |
| `wizzy` | Catalog sync and storefront search SDK | SQS product sync (`WIZZY_SYNC_WORKER_ENABLED`) |

Every module is mounted under `/<slug>/*`, connects to its own
`<slug>_app` database, and uses module-scoped providers. Shared behavior belongs
in `apps/backend/src/core/`; vendor modules never access each other's database.

## Repository layout

```text
ratio-apps/
├── apps/
│   ├── backend/
│   │   ├── src/core/                 # shared OAuth, DB, queue, health, webhooks
│   │   ├── src/modules/              # google/meta/posthog/moengage/wizzy
│   │   ├── src/main.ts               # HTTP API entrypoint
│   │   └── src/main.worker.ts        # non-HTTP worker entrypoint
│   ├── admin-google/
│   ├── admin-meta/
│   ├── admin-posthog/
│   ├── admin-moengage/
│   └── admin-wizzy/
├── packages/shared/                  # schemas and OpenStore event constants
├── packages/wizzy-sdk/               # optional storefront search SDK
├── docker-compose.yml                # local MySQL, Redis, ElasticMQ, backend
├── Dockerfile                        # production API/worker image
└── docs/
```

`apps/backend/src/modules/_template/`, `apps/_template-admin/`, and
`packages/_template-sdk/` are scaffolder copy-sources, not live applications.

## Quick start

Requires Node 22+ and pnpm 9+.

```bash
pnpm install
cp .env.example .env

# Generate a distinct encryption key for each live app and fill its
# RATIO_<APP>_* credentials in .env.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Local-only infrastructure: MySQL, Redis, ElasticMQ, and the backend.
pnpm infra:up

# Apply every live module's Kysely migrations.
pnpm migrate
```

Run one admin SPA with host-side HMR:

```bash
pnpm dev:admin:google
pnpm dev:admin:meta
pnpm dev:admin:posthog
pnpm dev:admin:moengage
pnpm dev:admin:wizzy
```

All admin development servers use port `5173`, so run one at a time unless you
override its Vite port. The backend listens on `http://localhost:3000`.

Queue workers default to disabled. For a local integration test, enable the
matching worker flag in `.env` and restart the backend. Production co-locates
the Google and Wizzy consumers with the shared API workload and runs only the
Meta consumer as a dedicated non-HTTP workload.

## Runtime model

- **Local:** `docker compose up` starts MySQL, Redis, ElasticMQ, and one backend
  with every module mounted. `docker-compose.yml` is not a production topology.
- **Shared production backend:** run the default `main.js` command with
  `ENABLED_MODULES=google,posthog,moengage,wizzy`,
  `GOOGLE_SYNC_WORKER_ENABLED=true`, and
  `WIZZY_SYNC_WORKER_ENABLED=true`. These pods serve the four non-Meta APIs and
  consume the Google/Wizzy queues.
- **Dedicated Meta API:** run `main.js` with `ENABLED_MODULES=meta` and every
  worker flag false.
- **Dedicated Meta worker:** reuse the same image with
  `main.worker.js`, `ENABLED_MODULES=meta`, and `META_WORKER_ENABLED=true`.
- **Admins:** build every SPA independently and publish its `dist/` directory to
  S3/CloudFront or an equivalent static host. Admin bundles are not present in
  the backend image.

`ENABLED_MODULES` defaults to `all` for local development. Unknown slugs fail
fast. The production split deliberately isolates Meta while keeping the four
lighter modules together. Scaling the shared backend also scales its Google and
Wizzy queue consumers, so SQS backlog and vendor quota metrics must be considered
alongside HTTP signals.

## Implemented queue workers

| Module | Source queue | DLQ | Processing behavior |
|---|---|---|---|
| Google | `google-product-sync` | `google-product-sync-dlq` | One product operation per message; acknowledge after GMC succeeds |
| Meta | `meta-capi` | `meta-capi-dlq` | Buffer per merchant; flush at 800 events or five minutes; acknowledge after Meta accepts the batch |
| Wizzy | `wizzy-product-sync` | `wizzy-product-sync-dlq` | One product operation per message; acknowledge after Wizzy succeeds |

SQS queues and redrive policies are infrastructure responsibilities. In AWS,
leave `SQS_ENDPOINT` unset so the SDK uses real SQS through the pod's IAM role.
PostHog and MoEngage send browser events directly to their vendor SDKs and do
not need queue consumers.

## HTTP paths and health

Each app exposes OAuth, webhook, admin API, and SDK routes beneath its slug.
Shared health endpoints have no prefix:

| Path | Purpose |
|---|---|
| `GET /healthz` | Process liveness |
| `GET /ready` | Readiness across databases mounted in this process |
| `GET /<slug>/api/v1/oauth/callback` | Ratio OAuth install callback |
| `POST /<slug>/api/v1/oauth/webhook` | Signed Ratio lifecycle webhooks |

The dedicated Meta worker does not open an HTTP listener; use process liveness,
logs, and queue-age/depth metrics for its health. Google and Wizzy worker health
is observed on the shared backend pods plus their queue metrics.

## Quality gate

```bash
pnpm verify
```

The command runs workspace lint and typecheck, builds the shared package, runs
all tests, and builds every application/package. Backend tests build the pixel
bundles first so the gate works from a clean checkout.

## Agentic workflow

The committed skills library under `.agents/skills/` drives
PRD → TRD → TDD → scaffold → build → verify → PR → deploy. The `build-app`
skill is the entry point for a new vendor and pauses at its human approval
gates. During PRD design it must ask whether the new API belongs in the shared
backend or needs a dedicated Deployment, and whether its worker is co-located,
dedicated, or absent. See [AGENTS.md](./AGENTS.md) and
[docs/agent/README.md](./docs/agent/README.md).

## Deployment documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — module, database, API, worker, and
  admin boundaries.
- [docs/DEPLOY.md](./docs/DEPLOY.md) — application contract for an EKS/AWS
  deployment. Infrastructure manifests are not shipped in this repository.
- [AGENTS.md](./AGENTS.md) — stack and repository workflow rules.
