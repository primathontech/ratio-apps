# Align deployment documentation with the EKS runtime — implementation plan

**Goal:** Align every active deployment surface with the five-app EKS runtime
and remove the obsolete production Compose path.

**Spec:** `docs/agent/changes/align-eks-deployment-docs/SPEC.md`

**Execution:** Inline in the isolated `docs/align-eks-deployment-docs` worktree.
Do not commit or push unless asked.

### Task 0: Repair the clean-checkout baseline

**Files:** admin Meta/Google/Wizzy formatting, Wizzy SDK tests,
`apps/backend/package.json`, and the Meta catalog pagination test.

- [x] Reproduce the baseline `pnpm verify` failures.
- [x] Apply only root-cause formatter, test-helper, pixel-generation, and stale-test fixes.
- [x] Run targeted lint/typecheck/tests.
- [x] Run `pnpm verify` successfully.

### Task 1: Align the repository entry points

**Files:** `AGENTS.md`, `README.md`, `.env.example`

- [x] Describe five live apps and the one-image/many-process EKS contract.
- [x] Separate local Compose from production deployment.
- [x] Replace Kinesis settings with implemented SQS worker settings.
- [x] Add the required Wizzy environment block.
- [x] Run consistency searches and `pnpm verify`.

### Task 2: Replace architecture and deployment guidance

**Files:** `ARCHITECTURE.md`, `docs/DEPLOY.md`

- [x] Document all five module/database/admin boundaries.
- [x] Document API and worker entrypoints, EKS workload matrix, managed AWS
      dependencies, migrations, secrets, probes, rollout, and observability.
- [x] State that infrastructure manifests are external and 50k RPS requires load tests.
- [x] Run consistency searches and `pnpm verify`.

### Task 3: Remove the obsolete production path

**Files:** `package.json`, `docker-compose.prod.yml`

- [x] Remove generic production Compose/PM2 scripts without changing local
      Compose or per-admin AWS publishing helpers.
- [x] Delete `docker-compose.prod.yml`.
- [x] Run repository-wide consistency searches, JSON validation, and `git diff --check`.
- [x] Run final `pnpm verify` and inspect scope.

### Task 4: Finish the repository Definition of Done

- [x] Record the notable repository-level change.
- [x] Clear `docs/agent/PROGRESS.md` while preserving its prior deferred-work note.
- [x] Perform final verification and report the isolated worktree/branch.

### Task 5: Apply the approved three-workload amendment

**Files:** `README.md`, `ARCHITECTURE.md`, `docs/DEPLOY.md`, `AGENTS.md`,
`docs/agent/{PRD.template.md,TRD.template.md,TDD.template.md,STATE.schema.md,README.md}`,
`.agents/skills/{build-app,prd-architect,trd-architect,tdd-author,vendor-scaffolder,backend-builder,frontend-builder,code-reviewer,pr-author,deployer,context-keeper,house-conventions,stack-patterns}/SKILL.md`,
and the five tracked app `STATE.json` files.

- [x] Replace per-app API/worker guidance with one shared non-Meta backend,
      one dedicated Meta API, and one dedicated Meta worker.
- [x] Document that Google and Wizzy consumers run inside the shared API pods
      and therefore scale with shared API replicas.
- [x] Add `deployment.apiPlacement` and `deployment.workerPlacement` to the
      state contract and backfill all five live apps.
- [x] Require an explicit placement decision during PRD/TRD approval for every
      future app.
- [x] Make scaffolding/review/PR/deploy skills propagate the decision and update
      the approved external EKS pipeline or produce an exact handoff.
- [x] Run contradiction searches, JSON validation, `git diff --check`, and
      the full `pnpm verify`.
- [x] Record the architecture decision and update the repo change journal.
