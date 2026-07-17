# Align deployment documentation with the EKS runtime — spec

> Status: implemented  
> Date: 2026-07-16 · Scope tier: **feature**

## Problem / goal

Active repository guidance contradicts the implementation: it describes four
apps instead of five, a single-artifact admin/backend deployment, production
Docker Compose and PM2, and a Meta Kinesis pipeline that does not exist.
`.env.example` also omits the required Wizzy app block.

Align the repository with the implemented production contract: one reusable
API-only backend image, a shared non-Meta API/worker workload, a dedicated Meta
API workload, and a separately scaled Meta worker on EKS. Admin SPAs remain
separate; every app keeps its own MySQL database; Redis and SQS/DLQs are managed
AWS services. Keep Docker Compose for local development only and remove the
production Compose file.

## Chosen approach

Use source truth rather than designing a new runtime:

- Live apps are `google`, `meta`, `posthog`, `moengage`, and `wizzy`.
- The shared backend runs `main.js` with
  `ENABLED_MODULES=google,posthog,moengage,wizzy`; Google and Wizzy worker flags
  are enabled in those same pods.
- The dedicated Meta API runs `main.js` with `ENABLED_MODULES=meta` and
  `META_WORKER_ENABLED=false`.
- The independently scaled Meta worker runs `main.worker.js` with
  `ENABLED_MODULES=meta` and `META_WORKER_ENABLED=true`.
- All three workloads use the same immutable image.
- Admin SPAs are independent static artifacts and are absent from the backend image.
- Production AWS infrastructure is provisioned outside this repository.
- Every future app must record an API placement (`shared` or `dedicated`) and
  worker placement (`shared-api`, `dedicated-worker`, or `none`) during PRD
  approval so the EKS delivery configuration can be updated deliberately.

## Scope

- Update `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, and `docs/DEPLOY.md`.
- Update the new-app PRD/TRD/TDD templates, state schema, and lifecycle skills
  so deployment placement is an explicit approved design input.
- Replace unimplemented Kinesis variables in `.env.example` with actual SQS
  worker settings and add the missing Wizzy configuration block.
- Remove generic production Compose/PM2 scripts from the root package.
- Delete `docker-compose.prod.yml` and remove active references to it.
- Preserve historical ADR 0003 as a record of the earlier four-vendor phase.

The user additionally authorized fixing all failures discovered by the clean
baseline. Those repairs are limited to formatter/lint drift, clean-checkout
pixel-test generation, and a stale Meta catalog pagination test.

## Acceptance criteria

- [x] Current guidance consistently lists all five live apps.
- [x] Production guidance consistently describes module-isolated EKS API and
      worker processes from one backend image.
- [x] Admin SPAs are documented as separate static deployments.
- [x] Meta CAPI is documented as SQS/DLQ; active docs and environment examples
      contain no Kinesis deployment claims.
- [x] Google, Meta, and Wizzy worker flags and queue responsibilities are explicit.
- [x] `.env.example` includes the Wizzy `RATIO_WIZZY_*` block and local AWS
      service endpoints without containing secrets.
- [x] `docker-compose.yml` is local-only; `docker-compose.prod.yml` is deleted.
- [x] Generic `deploy:docker` and `deploy:pm2` scripts are removed; local
      `infra:*` and existing per-admin AWS scripts remain.
- [x] No Helm/Terraform/Kubernetes manifests or 50k-RPS certification are claimed.
- [x] The clean-checkout baseline repairs and the full `pnpm verify` pass.
- [x] Current production guidance defines exactly three backend workloads:
      shared non-Meta API with Google/Wizzy workers, dedicated Meta API, and
      dedicated Meta worker.
- [x] New-app workflow state, PRD, TRD, review, and deploy skills require and
      propagate API/worker placement decisions.
- [x] Existing app state records the approved placement for all five live apps.
- [x] The deployer updates the configured external delivery/GitOps inputs from
      placement state or stops with an exact DevOps handoff when no pipeline exists.

## Out of scope

- Provisioning EKS, VPC, ALB, RDS, ElastiCache, SQS, ECR, IAM, CI/CD, or observability.
- Implementing Kinesis or changing queue semantics.
- Certifying 50,000 requests per second without staged load tests.
- Editing the user's untracked Loyalty work or rewriting historical ADRs.

## Context consulted

- `apps/backend/src/config/apps.ts`
- `apps/backend/src/config/enabled-modules.ts`
- `apps/backend/src/main.worker.ts`
- `Dockerfile` and `docker-compose.yml`
- Current per-app context for Google, Meta, PostHog, MoEngage, and Wizzy
- ADR 0003 and `docs/agent/context/INDEX.md`
