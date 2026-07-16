# Align deployment documentation with the EKS runtime — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Do not
> dispatch subagents; the user did not request delegation. Do not commit; the
> user did not request a commit.

**Goal:** Make every active deployment surface describe the implemented
five-app, one-image/many-process EKS contract and remove the obsolete production
Compose path.

**Spec:** `docs/agent/changes/align-eks-deployment-docs/SPEC.md`

**Architecture:** Preserve the application runtime. Treat the root Dockerfile as
the reusable API/worker image, `ENABLED_MODULES` as the process-level module
selector, and `main.worker.js` plus one module flag as the worker contract.
Docker Compose remains local-only; managed AWS infrastructure is provisioned
outside this repository.

**Tech stack:** Markdown, JSON, Docker Compose, NestJS/Fastify, AWS EKS, RDS
MySQL, ElastiCache Redis, SQS/DLQs, and S3/CloudFront.

## Global constraints

- The live app order is `google`, `meta`, `posthog`, `moengage`, `wizzy`.
- Do not change runtime TypeScript, queues, schemas, migrations, credentials, or `.env`.
- Do not claim Helm, Terraform, Kubernetes manifests, Kinesis, or 50k-RPS certification exists.
- Preserve historical ADR 0003 and untracked `docs/agent/apps/loyalty/` unchanged.
- Use `apply_patch` for all edits/deletions. Do not commit or push.

---

### Task 1: Align the current-state contract and operator entry point

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `.env.example`

**Produces:** Five-app current-state guidance, a local-versus-EKS runtime model,
and an environment example containing only implemented worker settings.

- [ ] **Step 1: Capture the stale-current-state failures**

Run:

```bash
rg -n 'Four live|four live|single artifact|single-artifact|Docker \| PM2|docker-compose\.prod|Kinesis|META_CAPI_BUS|META_CAPI_CONSUMER_ENABLED|KINESIS_' AGENTS.md README.md .env.example
```

Expected: stale matches appear in all three files.

- [ ] **Step 2: Update `AGENTS.md`**

Use `apply_patch` to replace the backend/deploy bullets with this content:

```markdown
- **Backend:** NestJS 11 + Fastify, Kysely query builder, MySQL. One codebase,
  many independently selectable modules. Five live vendors: `google`, `meta`,
  `posthog`, `moengage`, `wizzy` (declared in
  `apps/backend/src/config/apps.ts`).
- **Deploy:** one API-only backend image, deployed as module-selected API
  processes (`main.js` + `ENABLED_MODULES`) and dedicated queue-worker processes
  (`main.worker.js` + the module worker flag) on EKS. Admin SPAs are separate.
```

Change "four live vendors" to five and "A fifth" to "A sixth" in the add-app
section. State that Wizzy is the first SDK-enabled app; Google, Meta, PostHog,
and MoEngage remain SDK-free. Keep workflow/template rules unchanged.

- [ ] **Step 3: Rewrite `README.md` around these exact current-state sections**

Use `apply_patch` to include this live-app matrix:

```markdown
| Slug | Capability | Background worker |
|---|---|---|
| `google` | GA4, Google Ads, Merchant Center | SQS product sync (`GOOGLE_SYNC_WORKER_ENABLED`) |
| `meta` | Pixel, Conversions API, catalog | SQS CAPI delivery (`META_WORKER_ENABLED`) |
| `posthog` | Browser product analytics | None |
| `moengage` | Browser customer engagement | None |
| `wizzy` | Catalog sync and storefront search SDK | SQS product sync (`WIZZY_SYNC_WORKER_ENABLED`) |
```

The runtime section must say:

```markdown
- Local: `docker compose up` starts MySQL, Redis, ElasticMQ, and one backend
  with all modules mounted.
- Production API: publish the root Dockerfile once and run one EKS Deployment
  per module with `ENABLED_MODULES=<slug>` and entrypoint `main.js`.
- Production workers: use the same image, `main.worker.js`, one selected module,
  and exactly one matching worker flag.
- Admins: build each SPA separately and publish `dist/` to S3/CloudFront or an
  equivalent static host; admin bundles are not in the backend image.
```

Retain the quick start and agentic-flow links, but remove Docker/PM2 gate copy,
Google-only wording, the production Compose command, and the Kinesis runbook.
Replace the Kinesis section with an implemented SQS/DLQ worker summary and link
`docs/DEPLOY.md` for the production contract.

- [ ] **Step 4: Replace the obsolete `.env.example` Kinesis block**

Move the real shared flag next to the backend variables:

```dotenv
# Sandbox/local only. Production must keep webhook signature verification enabled.
WEBHOOK_SIGNATURE_OPTIONAL=false
```

Delete `KINESIS_ENDPOINT`, `S3_ENDPOINT`, `KINESIS_STREAM_NAME`,
`META_CAPI_DLQ_BUCKET`, `META_CAPI_BUS`, `META_CAPI_CONSUMER_ENABLED`,
`META_CAPI_AGG_MAX`, and `META_CAPI_WHALE_BUCKETS`. Add after
`FACEBOOK_CAPI_BASE_URL`:

```dotenv
# Meta CAPI worker: configure `meta-capi` -> `meta-capi-dlq` redrive in AWS.
META_WORKER_ENABLED=false
META_CAPI_BATCH_SIZE=800
META_CAPI_BATCH_WINDOW_MS=300000
META_CAPI_VISIBILITY=360
META_CAPI_POLL_WAIT_SECONDS=20
```

- [ ] **Step 5: Verify Task 1**

Run:

```bash
rg -n 'google.*meta.*posthog.*moengage.*wizzy|ENABLED_MODULES|main\.worker\.js|META_WORKER_ENABLED|GOOGLE_SYNC_WORKER_ENABLED|WIZZY_SYNC_WORKER_ENABLED' AGENTS.md README.md .env.example
! rg -n 'Four live|four live|single artifact|single-artifact|Docker \| PM2|docker-compose\.prod|Kinesis|META_CAPI_BUS|META_CAPI_CONSUMER_ENABLED|KINESIS_' AGENTS.md README.md .env.example
pnpm verify
```

Expected: current contract matches appear; the negative search is empty; verify exits 0.

---

### Task 2: Replace the architecture and deployment runbook

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/DEPLOY.md`

**Consumes:** Task 1 terminology.

**Produces:** An EKS application contract DevOps can translate into IaC without
mistaking the repository for an infrastructure implementation.

- [ ] **Step 1: Capture stale architecture/runbook failures**

Run:

```bash
rg -n 'live module is `google`|Single-artifact deploy|single artifact|SERVE_STATIC=true|Option A — Docker|Option B — PM2|deploy:docker|deploy:pm2' ARCHITECTURE.md docs/DEPLOY.md
```

Expected: stale matches appear in both files.

- [ ] **Step 2: Update `ARCHITECTURE.md`**

Retain the module/factory, DB-isolation, install/uninstall, rate-limit, and
rationale sections. Use `apply_patch` to replace the overview/deploy sections
with this workload matrix:

```markdown
| Module | Prefix | Database | Admin | Worker |
|---|---|---|---|---|
| Google | `/google/*` | `google_app` | `apps/admin-google` | `google-product-sync` SQS |
| Meta | `/meta/*` | `meta_app` | `apps/admin-meta` | `meta-capi` SQS |
| PostHog | `/posthog/*` | `posthog_app` | `apps/admin-posthog` | None |
| MoEngage | `/moengage/*` | `moengage_app` | `apps/admin-moengage` | None |
| Wizzy | `/wizzy/*` | `wizzy_app` | `apps/admin-wizzy` | `wizzy-product-sync` SQS |
```

The diagram and production section must show ALB routing to five logical API
Deployments, three worker Deployments consuming SQS/DLQs, per-app RDS databases,
ElastiCache Redis, and five separately hosted admin SPAs. State that the same
image runs `main.js` for APIs or `main.worker.js` for workers and that this repo
does not ship EKS manifests.

- [ ] **Step 3: Replace `docs/DEPLOY.md` with the EKS application contract**

Include this exact workload matrix:

```markdown
| Workload | Entrypoint | `ENABLED_MODULES` | Worker flag | HTTP probe |
|---|---|---|---|---|
| API | `node apps/backend/dist/apps/backend/src/main.js` | one slug | all `false` | `/healthz`, `/ready` |
| Google worker | `node apps/backend/dist/apps/backend/src/main.worker.js` | `google` | `GOOGLE_SYNC_WORKER_ENABLED=true` | none |
| Meta worker | `node apps/backend/dist/apps/backend/src/main.worker.js` | `meta` | `META_WORKER_ENABLED=true` | none |
| Wizzy worker | `node apps/backend/dist/apps/backend/src/main.worker.js` | `wizzy` | `WIZZY_SYNC_WORKER_ENABLED=true` | none |
```

Document these exact responsibilities: build/push one immutable image; ALB
routes `/<slug>/*`; workers have no Service/Ingress; one RDS database per app;
`replicas × DB_POOL_SIZE <= 60% of max_connections`; run `pnpm migrate:<slug>`
once before rollout; use IRSA instead of AWS keys; configure SQS redrive/DLQs;
leave production `SQS_ENDPOINT` unset; source secrets externally; deploy each
admin `dist/` independently; use rolling APIs and graceful worker termination;
monitor 5xx/latency/restarts/queue age/DLQ/DB/Redis. State that infrastructure
resources/manifests are not in this repo and 50k RPS needs staged load testing.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
rg -n 'google|meta|posthog|moengage|wizzy|main\.worker\.js|RDS|SQS|DLQ|S3/CloudFront|50k' ARCHITECTURE.md docs/DEPLOY.md
! rg -n 'live module is `google`|Single-artifact deploy|single artifact|SERVE_STATIC=true|Option A — Docker|Option B — PM2|deploy:docker|deploy:pm2|Kinesis' ARCHITECTURE.md docs/DEPLOY.md
pnpm verify
```

Expected: platform/runtime matches appear; the negative search is empty; verify exits 0.

---

### Task 3: Remove the obsolete production path and run final verification

**Files:**
- Modify: `package.json`
- Delete: `docker-compose.prod.yml`

**Produces:** No generic Compose/PM2 production path; local Compose and existing
per-admin AWS publishing helpers remain.

- [ ] **Step 1: Prove the obsolete artifacts exist**

Run:

```bash
test -f docker-compose.prod.yml
rg -n 'production deploy \(single artifact|"deploy:docker"|"deploy:pm2"' package.json
```

Expected: both commands find the obsolete path.

- [ ] **Step 2: Remove stale scripts from `package.json`**

Use `apply_patch` to delete exactly:

```json
"//--- production deploy (single artifact: backend serves built admin) ---//": "",
"deploy:docker": "docker compose up -d --build",
"deploy:pm2": "pnpm build:all && pm2 start ecosystem.config.cjs",
```

Keep every `infra:*` script and both `deploy:admin:*` scripts unchanged.

- [ ] **Step 3: Delete `docker-compose.prod.yml`**

Use an `apply_patch` `Delete File` patch. Do not change `docker-compose.yml`.

- [ ] **Step 4: Run consistency checks**

Run:

```bash
test ! -e docker-compose.prod.yml
! rg -n 'docker-compose\.prod|META_CAPI_BUS|META_CAPI_CONSUMER_ENABLED|KINESIS_STREAM_NAME|KINESIS_ENDPOINT|S3_ENDPOINT' AGENTS.md README.md ARCHITECTURE.md docs/DEPLOY.md .env.example package.json
! rg -n 'Four live vendors|four live vendors|single-artifact deploy|single artifact.*admin|deploy:docker|deploy:pm2' AGENTS.md README.md ARCHITECTURE.md docs/DEPLOY.md package.json
node -e "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')); console.log('package.json valid')"
git diff --check
```

Expected: negative searches are empty, JSON prints `package.json valid`, and diff check exits 0.

- [ ] **Step 5: Run the final gate and inspect scope**

Run:

```bash
pnpm verify
git status --short
git diff --stat
```

Expected: verify exits 0. Status contains only intended tracked edits, the new
spec/plan, deleted production Compose, and untouched untracked
`docs/agent/apps/loyalty/`; no runtime TypeScript or secret file is changed.
