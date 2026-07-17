---
name: deployer
description: After GATE 5 is approved, release the merged code through the repository's EKS application contract: verify, build/push the shared backend image, build/publish the app admin, run the app migration Job, update the configured external EKS workloads from STATE.json deployment placement, and verify API/worker health. Records deployTarget=eks and sets phase done.
when_to_use: The final build-app phase after the PR is merged and GATE 5 approves the EKS release. Use the existing CI/CD and infrastructure owned by DevOps; never invent or apply ad-hoc Kubernetes resources when the repository has no configured delivery pipeline.
---

# deployer

Release the merged app through the production contract in `docs/DEPLOY.md`.
Production uses one backend image across the shared backend, dedicated APIs,
and dedicated workers. Admin SPAs are separate static artifacts.

**Precondition:** `gates.deploy` is `approved` in STATE.json and the PR in
`prUrl` is merged. If either condition is false, stop.

Read STATE.json for `slug`, `paths`, `prUrl`, and the required
`deployment.apiPlacement` / `deployment.workerPlacement`. Stop if either
placement field is missing or if `shared-api` is paired with a dedicated API;
route back to PRD/TRD approval rather than inventing placement. Consult
`house-conventions` and `docs/DEPLOY.md`.

## Step 0 — Use merged code

Confirm the PR is merged and synchronize the default branch:

```bash
gh pr view <prUrl> --json state,mergedAt
git checkout <default-branch>
git pull --ff-only
```

Expect `state=MERGED`. Do not deploy a feature branch or an unmerged commit.

## Step 1 — Confirm the delivery target exists

Collect the operator-provided release inputs:

- ECR repository and immutable image tag convention;
- configured CI/CD or GitOps pipeline for the EKS workloads;
- current shared-backend `ENABLED_MODULES` and worker-flag inputs;
- naming/location for dedicated API and worker workload inputs;
- target environment/cluster and public app/admin URLs;
- AWS Secrets Manager/External Secrets entries;
- RDS database and SQS/DLQ readiness for the slug;
- S3/CloudFront destination for `apps/admin-<slug>/dist`.

This repo does not ship Helm, Terraform, or Kubernetes manifests. If no approved
delivery pipeline/IaC repository exists, stop after producing a deployment
handoff; do not improvise `kubectl apply` resources.

## Step 2 — Verify and produce artifacts

```bash
pnpm install --frozen-lockfile
pnpm verify

docker build --pull -t <ecr-repository>:<immutable-tag> .
docker push <ecr-repository>:<immutable-tag>

pnpm build:admin:<slug>
```

Publish the admin `dist/` through the configured static-delivery pipeline. Do
not bake it into the backend image.

Record the image digest and admin artifact/version. The same backend image
digest must be used by the shared backend, dedicated APIs, and dedicated
workers.

## Step 3 — Run the app migration

Run a one-shot Job from the immutable backend image:

```text
node apps/backend/dist/apps/backend/scripts/migrate.js <slug>
```

The Job receives the target `RATIO_<SLUG_UPPER>_DATABASE_URL`. Stop the rollout
on migration failure. Never automate production `migrate-down`.

## Step 4 — Release through the configured EKS pipeline

Update the approved pipeline/GitOps input to the immutable image digest:

### If `deployment.apiPlacement` is `shared`

- Append `<slug>` to the shared backend's comma-separated `ENABLED_MODULES`
  without removing current entries.
- Add the app's secret references, database connectivity, ALB path, readiness
  dependency, IAM permissions, and connection budget to that workload.

### If `deployment.apiPlacement` is `dedicated`

- Add/update an API workload using `main.js`, `ENABLED_MODULES=<slug>`, the same
  image digest, and all worker flags false.
- Add its Service/ALB route, probes, secrets, IAM, HPA, disruption budget, and
  database connection budget.

### Worker placement

- `shared-api`: enable only the app's worker flag in the shared backend and add
  its queue IAM/autoscaling guardrails. Do not create a worker Deployment.
- `dedicated-worker`: add/update a workload using `main.worker.js`,
  `ENABLED_MODULES=<slug>`, the same image digest, and only the app's worker
  flag true. No Service or Ingress.
- `none`: keep the app's worker flag absent/false and create no worker workload.

The current baseline must remain intact unless its approved state changes:

- shared backend: Google, PostHog, MoEngage, Wizzy; Google/Wizzy worker flags true;
- Meta API: dedicated, all worker flags false;
- Meta worker: dedicated `main.worker.js`, only `META_WORKER_ENABLED=true`.

If the pipeline/IaC repository is unavailable, stop and provide an exact DevOps
handoff with the placement, command, image digest, `ENABLED_MODULES`, worker
flags, routing/probes, secrets, IAM, queues, scaling, and migration inputs.

## Step 5 — Verify the release

- The affected shared or dedicated API rollout completes with no unavailable replicas.
- `GET /healthz` and `GET /ready` succeed on the affected API target.
- OAuth callback and signed webhook smoke tests use the production URLs.
- The admin loads from its static origin and calls the correct API origin.
- If the app has a worker, a controlled test message is consumed by the recorded
  placement.
- Source queue age/depth returns to baseline and the DLQ does not grow.
- Logs and dashboards show the immutable image version/request IDs.

If any check fails, stop traffic progression and use the configured rollback
mechanism. Do not delete queues or roll databases back automatically.

## Step 6 — Record and finish

Via `context-keeper`, set `deployTarget` to `"eks"`, append a `deployer`
history entry, and set `phase` to `done`. Report:

- environment and public URLs;
- image digest;
- admin artifact/version;
- API and worker placement plus the external pipeline inputs changed;
- migration result;
- API and worker verification results.

## When stuck

- No infrastructure/pipeline exists: provide the artifacts plus
  `docs/DEPLOY.md` to DevOps and stop; application readiness is not
  infrastructure readiness.
- API fails startup: inspect the exact env-schema error and the selected
  `RATIO_<SLUG>_*` secret set.
- Shared API readiness fails: inspect all mounted app databases and the four-pool
  per-replica budget. Dedicated API readiness fails: inspect only its selected
  app database and pool budget.
- Worker backlog grows: inspect pod health, IAM permissions, vendor throttling,
  visibility timeout, and DLQ metrics.
- Admin fails: verify its build-time Vite variables, S3 object/cache policy, and
  CloudFront origin/invalidation.
