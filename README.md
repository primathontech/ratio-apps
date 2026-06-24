# ratio-apps — agent-native boilerplate

A monorepo that *is* an agentic system. Drop in a PRD, invoke one skill, and
Claude drives the full lifecycle of a new vendor app — **PRD → scaffold → build
backend → build frontend → review → PR → deploy** — retaining all context across
turns in a per-build state file.

Each vendor is a NestJS *module* mounted under its own URL prefix (`/<slug>/*`),
talking to its own MySQL database; everything ships as one artifact (the backend
serves the built admin SPA). The repo ships with a single golden template
(`_template`) that every new vendor is scaffolded from.

```
ratio-apps/
├── apps/
│   ├── backend/                       # NestJS 11 + Fastify + Kysely + MySQL
│   │   └── src/
│   │       ├── core/                  # shared infra (crypto, ratio-client,
│   │       │                          #   kysely factory, merchants, oauth,
│   │       │                          #   webhooks, health, common) — NOT forked
│   │       ├── modules/_template/     # copy-source for scaffolder (NOT wired/running)
│   │       └── config/{apps,env.schema,configure-app}.ts
│   └── _template-admin/               # golden React 19 + Vite admin SPA
├── packages/shared/                   # Zod schemas + OpenStore event constants
├── .claude/skills/                    # the agentic skills library (committed)
├── docs/agent/                        # PRD template + STATE.json convention
├── docker-compose.yml                 # mysql + backend
└── AGENTS.md / CLAUDE.md              # the contract agents read first
```

## Quick start

```bash
# 1. Install (Node 22+, pnpm 9+)
pnpm install

# 2. Copy + fill the root env (generate the per-app encryption key)
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#   → paste into RATIO_GOOGLE_DATA_ENCRYPTION_KEY

# 3. Bring up MySQL + backend, then migrate
pnpm infra:up                 # docker compose up -d → mysql:3306 + backend:3000
pnpm migrate                  # apply each module's Kysely migrations

# 4. Run the admin SPA (host-side HMR)
pnpm --filter @ratio-app/admin-google dev   # http://localhost:5173
```

The backend serves the `google` vendor under `/google/*`:

| Path | Handled by |
|---|---|
| `GET  /google/api/v1/oauth/callback`    | OAuth install |
| `POST /google/api/v1/oauth/webhook`     | Ratio webhooks (signed) |
| `GET  /google/sdk/:id.js`               | per-merchant storefront pixel |
| `GET  /google/api/merchants/me`         | merchant session |
| `GET  /healthz` / `GET /ready`          | shared (no prefix) |

## Quality gates

```bash
pnpm -r lint          # biome check
pnpm -r typecheck     # tsc --noEmit across every package
pnpm -r test          # vitest
pnpm -r build
```

## The agentic flow

To build a new vendor app, don't hand-roll it — invoke the **`build-app`** skill
with a PRD:

```
PRD  →  build-app  →  [GATE 1: PRD sign-off]
                   →  TRD  → [GATE 2: TRD sign-off]
                   →  TDD  → [GATE 3: TDD test-plan sign-off]   (no code until here)
                   →  scaffold → backend → frontend → review
                   →  [GATE 4: before PR]   → PR
                   →  [GATE 5: before deploy] → Docker | PM2
```

The first three phases are design docs only — PRD (what), TRD (technical design),
TDD (test plan) — each human-approved before any code is written. The flow is
autonomous within each phase and pauses only at the five gates. All state and the
three docs live in `docs/agent/apps/<slug>/` (`STATE.json` + `PRD/TRD/TDD.md`), so
a build can be abandoned and resumed in a fresh session. See
[`docs/agent/README.md`](./docs/agent/README.md) for the full walkthrough and
[`docs/agent/PRD.template.md`](./docs/agent/PRD.template.md) for the PRD shape.

To add a vendor manually, follow the recipe in [`AGENTS.md`](./AGENTS.md).

## Documentation

- **[`AGENTS.md`](./AGENTS.md)** — the contract: stack, golden-path rule,
  `core/` boundary, add-an-app recipe, commit format.
- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — module/factory pattern,
  per-module DB isolation, single-artifact deploy.
- **[`docs/agent/`](./docs/agent/)** — agentic flow, PRD template, `STATE.json`
  schema.



## Deployment topology

One image, behaviour chosen by env (no `ROLE` var — the entrypoint is the role):

- **Dev:** `docker compose up` → one `backend` (`ENABLED_MODULES=all`), workers in-process.
- **Prod:** `docker compose -f docker-compose.prod.yml up` → nginx + one API service per module
  (`svc-google` …, each `ENABLED_MODULES=<slug>`) + `svc-worker`
  (`main.worker.js`, `*_WORKER_ENABLED=true`).

`ENABLED_MODULES` (default `all`) selects mounted modules and scopes env validation.
API entry: `main.js`. Worker entry: `main.worker.js`. Lift the prod compose onto
ECS/EKS unchanged by pointing the datastore env at managed RDS/SQS/ElastiCache.

### Meta CAPI Pipeline

The Meta Conversions API (CAPI) pipeline scales from SQS to Kinesis with a phased cutover strategy. See [`docs/agent/apps/meta/CAPI-PIPELINE.md`](./docs/agent/apps/meta/CAPI-PIPELINE.md) for the operational runbook (phased `META_CAPI_BUS` flip: `sqs` → `both` → `kinesis`; DLQ reading; whale-bucket tuning; local dev with LocalStack; deferred items).

**Key env knobs:**
- `META_CAPI_BUS` (default `sqs`): `sqs`, `kinesis`, or `both` (dual-write for parity testing).
- `META_CAPI_CONSUMER_ENABLED` (default `false`): enable Kinesis shard consumer (lease-based polling, batching, dispatch, DLQ).
- `KINESIS_STREAM_NAME` (default `meta-capi`): stream name.
- `META_CAPI_DLQ_BUCKET` (default `meta-capi-dlq`): S3 bucket for non-retryable events.
- `META_CAPI_AGG_MAX` (default `100`): max events per Kinesis record.
- `META_CAPI_WHALE_BUCKETS` (default empty): whale merchant shard routing (`merchantId:B,...`).
