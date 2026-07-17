# EKS deployment contract

This repository provides the application image, static admin builds, migration
entrypoint, and runtime configuration contract. DevOps owns the AWS
infrastructure: VPC, EKS, ALB, ECR, RDS, ElastiCache, SQS/DLQs, IAM, secrets,
DNS, S3/CloudFront, CI/CD, monitoring, backups, and disaster recovery.

No production Docker Compose, Helm, Terraform, Argo CD, or Kubernetes manifests
are shipped here. `docker-compose.yml` is local development infrastructure only.

## Release artifacts

Produce these immutable artifacts for every release:

1. One backend image from the root `Dockerfile`, tagged with the commit SHA or
   another immutable release identifier and pushed to ECR.
2. Five independent admin builds:
   `apps/admin-{google,meta,posthog,moengage,wizzy}/dist`.
3. An image digest and admin asset manifest recorded by CI/CD.

The backend image contains:

- compiled NestJS API and worker entrypoints;
- compiled migration scripts and migrations;
- shared package output;
- built Google/Meta/PostHog/MoEngage pixel bundles;
- built Wizzy storefront SDK bundles;
- production Node dependencies.

It does not contain any admin SPA bundle and defaults to `SERVE_STATIC=false`.

## Workload matrix

| Workload | Command | `ENABLED_MODULES` | Worker flag | HTTP probe |
|---|---|---|---|---|
| Shared backend | `node apps/backend/dist/apps/backend/src/main.js` | `google,posthog,moengage,wizzy` | Google and Wizzy `true`; Meta `false` | `/healthz`, `/ready` |
| Meta API | `node apps/backend/dist/apps/backend/src/main.js` | `meta` | all `false` | `/healthz`, `/ready` |
| Meta worker | `node apps/backend/dist/apps/backend/src/main.worker.js` | `meta` | only `META_WORKER_ENABLED=true` | none |
| Migration Job | `node apps/backend/dist/apps/backend/scripts/migrate.js <slug>` | not used | not used | none |

The current production contract defines exactly three long-running backend
workloads:

```text
ratio-apps-shared-api
ratio-apps-meta-api
ratio-apps-meta-worker
```

Google and Wizzy queue consumers run inside every shared-backend replica.
PostHog and MoEngage have no queue consumer. Meta is isolated into separate API
and worker Deployments because it is the most backend-heavy module.

All workloads use the same immutable image digest. Do not create separate images
for Meta or individual apps.

## ALB and routing

- Terminate TLS at an AWS Load Balancer Controller-managed ALB or an equivalent
  ingress layer.
- Route `/meta/*` to the Meta API Service.
- Route `/google/*`, `/posthog/*`, `/moengage/*`, and `/wizzy/*` to the shared
  backend Service.
- Configure `/healthz` and `/ready` as target-group health checks on both API
  Services. The shared readiness response covers its four mounted databases;
  Meta readiness covers only `meta_app`.
- Preserve `X-Forwarded-For`, `X-Forwarded-Proto`, host, and request ID headers.
- Set `TRUSTED_PROXY_CIDRS` to the actual ingress/proxy source ranges.
- Configure request-body and idle timeouts from measured route behavior, not a
  global 50k-RPS assumption.

The dedicated Meta worker needs no Kubernetes Service or Ingress.

## Environment and secrets

Use ConfigMaps for non-sensitive settings and AWS Secrets Manager plus External
Secrets (or the platform's equivalent) for credentials. Do not build secrets
into the image, commit `.env`, or mount a repository environment file.

### Shared API settings

| Variable | Production requirement |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Container port, default `3000` |
| `RATIO_API_BASE_URL` | Production Ratio API base URL |
| `ALLOWED_ORIGINS` | Exact admin/storefront origins |
| `TRUSTED_PROXY_CIDRS` | Actual trusted proxy ranges |
| `DB_POOL_SIZE` | Sized against the RDS connection budget |
| `REDIS_URL` | TLS-enabled ElastiCache endpoint |
| `WEBHOOK_SIGNATURE_OPTIONAL` | `false` |
| `SERVE_STATIC` | `false` |
| `LOG_LEVEL` | Normally `info` |

### Per-app settings

The shared backend receives the credentials for Google, PostHog, MoEngage, and
Wizzy. Meta API and Meta worker receive only Meta credentials:

```text
RATIO_<APP>_DATABASE_URL
RATIO_<APP>_DATA_ENCRYPTION_KEY
RATIO_<APP>_CLIENT_ID
RATIO_<APP>_CLIENT_SECRET
RATIO_<APP>_CALLBACK_URL
RATIO_<APP>_ADMIN_BASE_URL
```

Google additionally requires its Google OAuth settings when that flow is used.
Wizzy may receive its catalog API base and deployment-wide credential
fallbacks. Consult `.env.example` and
`apps/backend/src/config/env.schema.ts` for the current names.

### Worker settings

Use these exact production flag profiles:

```text
# Shared backend
GOOGLE_SYNC_WORKER_ENABLED=true
WIZZY_SYNC_WORKER_ENABLED=true
META_WORKER_ENABLED=false

# Meta API
GOOGLE_SYNC_WORKER_ENABLED=false
WIZZY_SYNC_WORKER_ENABLED=false
META_WORKER_ENABLED=false

# Meta worker
GOOGLE_SYNC_WORKER_ENABLED=false
WIZZY_SYNC_WORKER_ENABLED=false
META_WORKER_ENABLED=true
```

Meta tuning defaults:

```text
META_CAPI_BATCH_SIZE=800
META_CAPI_BATCH_WINDOW_MS=300000
META_CAPI_VISIBILITY=360
META_CAPI_POLL_WAIT_SECONDS=20
```

Google and Wizzy default to 120-second message visibility. Visibility timeouts
must exceed the expected vendor API processing time with margin.

## AWS identity

Use EKS Pod Identity or IRSA for AWS API access. Grant least-privilege policies
per service account:

- Shared backend: send/receive/delete/change visibility for only the Google and
  Wizzy source queues plus the AWS services required by those four modules.
- Meta API: send to `meta-capi` and access only Meta-required AWS services.
- Meta worker: receive/delete/change visibility and read attributes on
  `meta-capi`; include the DLQ only when operational tooling requires it.
- CI/CD: push to ECR and publish only the intended S3 prefixes/distributions.

Do not provide long-lived AWS access keys through Kubernetes Secrets.

## Databases

Use one RDS/Aurora MySQL-compatible database per app:

```text
google_app
meta_app
posthog_app
moengage_app
wizzy_app
```

Use Multi-AZ, encrypted storage, automated backups, deletion protection, and
private subnets. Evaluate RDS Proxy only after testing transaction/session
behavior with `mysql2` and Kysely.

Budget connections before setting replica counts:

```text
google/posthog/moengage/wizzy:
  shared API replicas × DB_POOL_SIZE per app database

meta:
  (Meta API replicas + Meta worker replicas) × DB_POOL_SIZE

Keep every database/cluster at or below approximately 60% of max_connections.
```

The remaining capacity covers migrations, failover overlap, operators, and
connection spikes. Every shared-backend replica creates four independent pools,
one for each selected app.

## Migrations

Run migrations as a one-shot pre-deployment Job using the same immutable image:

```text
node apps/backend/dist/apps/backend/scripts/migrate.js google
node apps/backend/dist/apps/backend/scripts/migrate.js meta
node apps/backend/dist/apps/backend/scripts/migrate.js posthog
node apps/backend/dist/apps/backend/scripts/migrate.js moengage
node apps/backend/dist/apps/backend/scripts/migrate.js wizzy
```

Each Job needs only the target `RATIO_<APP>_DATABASE_URL`. Serialize migrations
per database and fail the rollout if a migration fails. Do not automatically
run `migrate-down` in production; use reviewed forward fixes or curated rollback
SQL with a verified backup.

## Redis

Use a private, encrypted ElastiCache Redis endpoint. Configure connection,
latency, eviction, memory, and failover alarms. Redis failure must be visible in
application logs and dashboards; do not hide repeated reconnect loops.

## SQS queues and DLQs

Provision these source queues and redrive targets:

| Source queue | DLQ | Consumer |
|---|---|---|
| `google-product-sync` | `google-product-sync-dlq` | Shared backend (Google consumer) |
| `meta-capi` | `meta-capi-dlq` | Meta worker |
| `wizzy-product-sync` | `wizzy-product-sync-dlq` | Shared backend (Wizzy consumer) |

Requirements:

- server-side encryption enabled;
- long polling enabled;
- visibility timeout longer than processing/batch windows;
- bounded `maxReceiveCount` with a DLQ alarm;
- retention sized for incident recovery;
- queue depth and oldest-message age exported to autoscaling/monitoring;
- production `SQS_ENDPOINT` left unset so the AWS SDK uses the regional SQS service.

Workers acknowledge only successful operations. During termination, allow the
in-flight operation to finish; otherwise the unacknowledged message safely
redelivers after visibility expiry.

## Admin SPAs

Build each admin separately with its production Vite variables:

```bash
pnpm build:admin:google
pnpm build:admin:meta
pnpm build:admin:posthog
pnpm build:admin:moengage
pnpm build:admin:wizzy
```

Publish every `dist/` directory to its own S3 prefix/bucket and CloudFront
distribution or routing behavior. Use long immutable caching for hashed assets
and short caching for `index.html`. Set each app's
`RATIO_<APP>_ADMIN_BASE_URL` to the corresponding public URL.

## Rollout sequence

1. Run `pnpm verify` in CI.
2. Build the backend image once and push it to ECR.
3. Build and publish the five admin SPAs.
4. Run one migration Job per app and stop on failure.
5. Roll out the shared backend with Google/Wizzy workers enabled and Meta
   disabled.
6. Roll out the dedicated Meta API with all worker flags disabled.
7. Roll out the dedicated Meta worker with only `META_WORKER_ENABLED=true`.
8. Confirm `/healthz`, `/ready`, OAuth callbacks, webhook signature validation,
   and representative read/write routes on both API target groups.
9. Confirm Google, Wizzy, and Meta queue consumption, vendor delivery, retry
   behavior, and zero DLQ growth.
10. Shift traffic gradually and watch service-level indicators.

Use rolling API updates with readiness gates and disruption budgets. Use
conservative `terminationGracePeriodSeconds` for the shared backend and Meta
worker; SQS redelivery provides the safety net for interrupted work.

## Autoscaling

The shared backend HPA should combine CPU/memory with request rate or latency
from the ingress/observability stack. Because Google and Wizzy workers are
embedded, every additional API replica is also an additional consumer; cap
scaling against their vendor quotas and database connection budgets.

Scale the Meta API from HTTP signals. Scale the Meta worker independently from
`meta-capi` backlog and oldest-message age, constrained by Meta rate limits and
RDS connections.

Do not add Meta back to the shared backend. Its isolation is the primary
capacity boundary for the current architecture.

## Adding a future app

Before implementation, `build-app` records:

```json
{
  "deployment": {
    "apiPlacement": "shared",
    "workerPlacement": "none"
  }
}
```

Allowed values:

- `apiPlacement`: `shared` or `dedicated`;
- `workerPlacement`: `shared-api`, `dedicated-worker`, or `none`.

The approved choice must appear in the PRD and TRD. During release, update the
configured external GitOps/pipeline workload inputs:

- `shared`: append the slug to the shared backend's `ENABLED_MODULES`;
- `dedicated`: add/update an API Deployment using the same image with
  `ENABLED_MODULES=<slug>`;
- `shared-api`: enable the app's worker flag in the shared backend;
- `dedicated-worker`: add/update a `main.worker.js` Deployment using the same
  image and only that app's worker flag;
- `none`: do not create a worker workload or enable a worker flag.

This repository does not contain that infrastructure configuration. If the
approved external pipeline/IaC repository is unavailable, produce an exact
handoff containing the slug, placements, image digest, command, environment
flags, secrets, IAM, queues, probes, and routing changes; do not improvise
resources locally.

## Observability

At minimum, alert on:

- API request rate, p50/p95/p99 latency, and 4xx/5xx rate by app/route;
- pod restarts, OOM kills, readiness failures, and rollout stalls;
- RDS CPU, connections, slow queries, storage, replica/failover health;
- Redis memory, evictions, connection failures, and latency;
- SQS visible/in-flight message count, oldest-message age, receive errors, and DLQ depth;
- worker success/failure/retry rate and vendor throttling;
- ALB target health, rejected connections, and TLS/DNS failures.

Structured logs already carry request IDs and redact sensitive fields. Centralize
them with retention and access controls appropriate for merchant data.

## Local development

Use only:

```bash
pnpm infra:up
pnpm infra:logs
pnpm infra:down
```

The local Compose stack uses MySQL, Redis, and ElasticMQ and mounts all modules
in one backend. It is intentionally different from the production EKS topology.
