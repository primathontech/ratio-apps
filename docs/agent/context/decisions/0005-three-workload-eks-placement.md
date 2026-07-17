# 0005 — Three-workload EKS placement

- **Date:** 2026-07-16
- **Status:** accepted

## Context

Ratio Apps uses one backend image for five app modules. Meta catalog and CAPI
processing are substantially heavier than the other modules, but operating a
separate API and worker Deployment for every lightweight app would add
unnecessary EKS, delivery-pipeline, and observability overhead.

Google and Wizzy have SQS consumers. Their current volume can be handled inside
the shared API pods, while Meta needs its queue consumption to scale
independently from HTTP traffic.

## Decision

Use the same immutable backend image for exactly three current workloads:

1. Shared backend: `main.js` with
   `ENABLED_MODULES=google,posthog,moengage,wizzy`; Google and Wizzy worker
   flags enabled.
2. Meta API: `main.js` with `ENABLED_MODULES=meta`; all worker flags disabled.
3. Meta worker: `main.worker.js` with `ENABLED_MODULES=meta`; only
   `META_WORKER_ENABLED=true`.

Every future app must receive an explicit, human-approved placement during PRD
design:

- API: `shared` or `dedicated`;
- worker: `shared-api`, `dedicated-worker`, or `none`.

The placement is stored in `docs/agent/apps/<slug>/STATE.json` and drives the
approved external EKS delivery/GitOps configuration. This repository does not
invent local Kubernetes manifests when that external configuration is absent.

## Rationale

This split isolates the dominant Meta workload and its scaling/failure domain
without paying the operational cost of one Deployment per lightweight app.
Reusing one image prevents build drift. Recording future placement at design
time prevents DevOps topology from becoming an undocumented afterthought.

Rejected alternatives:

- One Deployment containing all five modules: Meta traffic and failures would
  scale or disrupt every app.
- One API and one worker Deployment per app: strongest isolation, but excessive
  workload and pipeline overhead for the current lighter modules.
- A separate combined non-Meta worker Deployment: cleaner HTTP/worker scaling,
  but adds another workload before current Google/Wizzy volume requires it.

## Consequences

- Scaling the shared API also increases Google and Wizzy consumer concurrency;
  HPA limits must account for SQS backlog, vendor quotas, and DB pools.
- Every shared replica opens one pool for each of four app databases.
- Shared readiness couples the four lighter modules: one mounted database
  failure can make the shared target group unready.
- Meta API and worker replicas can scale independently and have separate IAM,
  secrets, and operational alerts.
- Adding an app requires updating `STATE.json.deployment`, PRD/TRD, ALB routing,
  secrets/IAM, and the external delivery configuration.
- If Google or Wizzy queue load outgrows the coupled model, its recorded worker
  placement can be changed to `dedicated-worker` through a reviewed architecture
  change.
