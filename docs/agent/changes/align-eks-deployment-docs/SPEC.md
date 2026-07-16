# Align deployment documentation with the EKS runtime — spec

> Status: design approved  
> Date: 2026-07-16 · Scope tier: **feature** (deployment-facing documentation)

## Problem / goal

The repository describes several incompatible production models. Current source
supports five apps and can run selected modules as separate API or worker
processes, while top-level documentation still describes four apps, a
single-artifact server, a production Docker Compose stack, and an unimplemented
Meta Kinesis pipeline. These contradictions make the DevOps handoff ambiguous.

Align the repository with the production contract already supported by the
application: one reusable backend image, module-isolated API and worker
deployments on EKS, separately deployed admin SPAs, per-app MySQL databases,
Redis, and SQS/DLQs. Keep Docker Compose for local development only and remove
the obsolete production Compose file.

## Approaches considered

### Option A — source-truth cleanup (chosen)

Update every active deployment-facing document and manifest description to the
five-app, EKS-oriented process model already present in source. Remove obsolete
production Compose artifacts and deployment scripts, and replace the false Meta
Kinesis section with the implemented SQS worker contract.

This is the smallest complete option: it resolves contradictions without adding
new infrastructure code or changing application behavior.

### Option B — minimal wording patch

Only change "four" to "five", remove the Kinesis paragraph, and delete
`docker-compose.prod.yml`. This leaves the single-artifact/PM2 production model
and deployment scripts contradicting the Dockerfile and EKS handoff, so it does
not make the repository deployment-ready.

### Option C — implement the obsolete documentation

Add Kinesis, retain a production Compose runtime, and restore single-artifact
static serving. This expands scope substantially and conflicts with the requested
EKS architecture and explicit instruction to remove production Compose.

## Proposed changes

1. **`AGENTS.md`**
   - List all five live apps: Google, Meta, PostHog, MoEngage, and Wizzy.
   - Replace the single-artifact statement with the actual production model:
     one image, module-selected API deployments, dedicated worker deployments,
     and separately built admin SPAs.
   - Keep the golden-template and vendor-isolation rules unchanged.

2. **`README.md`**
   - Present the repository as the complete five-app platform rather than a
     Google-only app.
   - Document local Docker Compose separately from production EKS.
   - Explain `ENABLED_MODULES` and `main.worker.js` as the API/worker process
     boundaries used by DevOps.
   - Replace the nonexistent Kinesis cutover/runbook and environment variables
     with the implemented SQS/DLQ worker model.

3. **`ARCHITECTURE.md`**
   - Show the shared core plus all five isolated app modules/admin SPAs.
   - Describe the one-image/many-process EKS topology and the current worker
     split: Meta CAPI, Google product sync, and Wizzy catalog sync.
   - State that PostHog and MoEngage forward browser events directly and do not
     require backend worker deployments.

4. **`docs/DEPLOY.md`**
   - Make EKS the production target and Docker Compose local-only.
   - Document the backend image command contract, API module selection, worker
     entrypoint, health probes, migrations, admin SPA delivery, backing services,
     secrets, rollout expectations, and the distinction between application
     readiness and infrastructure provisioning.
   - Do not claim that Helm/Terraform/EKS manifests exist in this repository.

5. **`.env.example`**
   - Remove the unimplemented Meta Kinesis configuration block.
   - Document the implemented Meta SQS worker flags and move the real shared
     webhook-development flag out of the obsolete Kinesis section.
   - Keep all placeholders secret-free.

6. **Deployment artifact cleanup**
   - Delete `docker-compose.prod.yml`.
   - Remove all active references to it.
   - Remove stale root `deploy:docker` and `deploy:pm2` scripts that advertise
     local Compose/PM2 as the production path; retain local `infra:*` scripts and
     existing per-admin AWS publishing scripts.
   - Do not delete `ecosystem.config.cjs` unless a separate cleanup explicitly
     requests removal; it is no longer documented as the EKS path.

## Acceptance criteria

- [ ] Active repository guidance consistently lists five live apps: `google`,
      `meta`, `posthog`, `moengage`, and `wizzy`.
- [ ] Production documentation consistently describes one backend image deployed
      as module-isolated API and worker processes on EKS.
- [ ] Admin SPAs are documented as separate builds/deployments, matching the
      current API-only Dockerfile.
- [ ] Meta CAPI is documented as the implemented SQS/DLQ pipeline; no active docs
      claim Kinesis support or reference the missing `CAPI-PIPELINE.md`.
- [ ] `.env.example` contains the implemented Meta worker settings and no
      unimplemented Kinesis settings.
- [ ] Google and Wizzy SQS workers, and the lack of PostHog/MoEngage backend
      workers, are explicit.
- [ ] `docker-compose.yml` is documented as local development infrastructure only.
- [ ] `docker-compose.prod.yml` is deleted and no active file references it.
- [ ] Stale generic production Compose/PM2 package scripts are removed, while
      local infrastructure and per-admin AWS scripts remain available.
- [ ] Historical ADR 0003 remains unchanged as a record of the four-vendor phase;
      current-state docs do not present it as the live app count.
- [ ] No runtime source, credentials, `.env` files, databases, or the user's
      untracked `docs/agent/apps/loyalty/` work are changed.
- [ ] Consistency searches are clean and `pnpm verify` passes.

## Out of scope

- Creating EKS, Helm, Terraform, Argo CD, CI/CD, AWS accounts, networking, or
  observability resources.
- Changing application runtime behavior, queues, schemas, or worker algorithms.
- Implementing Kinesis or changing SQS to another broker.
- Load-testing or certifying 50,000 requests per second; that requires the
  separately requested infrastructure implementation and performance tests.
- Rewriting historical ADRs to pretend their original decisions were different.
- Editing or adopting the untracked Loyalty module.

## Context consulted

- Current app registry: `apps/backend/src/config/apps.ts`.
- Process controls: `apps/backend/src/config/enabled-modules.ts` and
  `apps/backend/src/main.worker.ts`.
- Container contract: `Dockerfile` and local `docker-compose.yml`.
- Current module context: `docs/agent/apps/{google,meta,posthog,moengage,wizzy}/CONTEXT.md`.
- Current-state docs: `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, and
  `docs/DEPLOY.md`.
- Historical context: ADR 0003 and the context index.
