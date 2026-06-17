---
name: deployer
description: After GATE 5 is approved, build the single deploy artifact (admin built to static → served by the backend, then backend built) and deploy via Docker (docker compose up -d --build) or PM2 (pm2 start ecosystem.config.cjs) — asking the operator which. Records deployTarget and sets phase done in STATE.json.
when_to_use: The final phase, after pr-author and GATE 5 (PR-merged, before-deploy sign-off). Use to ship the built vendor app as one artifact where the backend serves the built admin. Requires gates.deploy approved AND the PR merged into the default branch — deploys the merged code, not the feature branch.
---

# deployer

You build the single deploy artifact and deploy it. The deploy is **single
artifact**: the admin SPA builds to static files which the NestJS backend serves
(behind `SERVE_STATIC=true`), so one process/image runs everything.

**Precondition:** `gates.deploy` is `approved` in STATE.json (GATE 5). GATE 5
means the human has confirmed the PR (`prUrl`) is **merged** into the default
branch. If `gates.deploy` is still `pending`, STOP — the orchestrator owns that
sign-off.

Read STATE.json on entry for `slug`, `paths`, and `prUrl`. Consult
`house-conventions`.

## Step 0 — Deploy the MERGED code, not the feature branch

The deploy artifact must be built from the merged default branch, not the local
`feat/<slug>` branch. Confirm the PR is merged, then sync the default branch:

```bash
gh pr view <prUrl> --json state,mergedAt   # expect state=MERGED
git checkout <default-branch> && git pull --ff-only
```

If the PR is **not** merged (`state` ≠ `MERGED`), STOP and report — do not deploy
un-merged code, even if `gates.deploy` was flipped early. If `gh` is unavailable,
ask the human to confirm the merge before continuing.

## Step 1 — Ask Docker vs PM2

Both are supported. Ask the operator which target. Also confirm the deploy `.env`
is present on the host (real secrets, generated `RATIO_<SLUG>_DATA_ENCRYPTION_KEY`)
and that the per-module DB migration has been applied:

```bash
pnpm --filter @ratio-app/backend exec tsx scripts/migrate.ts <slug>
```

## Step 2 — Build the single artifact

Frontend first (static), then backend:

```bash
pnpm --filter @ratio-app/admin-<slug> build   # → apps/admin-<slug>/dist
pnpm --filter @ratio-app/backend build         # → backend dist
```

The backend serves the admin `dist/` when `SERVE_STATIC=true`.

## Step 3a — Docker path

Builds the multi-stage image (deps → build → runtime) and brings up MySQL +
backend via compose:

```bash
docker compose up -d --build
```

Verify health: the backend exposes `/ready` on port 3000
(`wget -qO- http://127.0.0.1:3000/ready`). Ensure compose passes the
`RATIO_<SLUG>_*` env and `SERVE_STATIC=true` to the backend service.

## Step 3b — PM2 path

Runs the built backend as a managed process (with `SERVE_STATIC=true` in its env
block):

```bash
pm2 start ecosystem.config.cjs
```

Verify with `pm2 status` and the `/ready` probe above.

## Step 4 — Record and finish

Via `context-keeper`: set `deployTarget` to `"docker"` or `"pm2"`, append a
`deployer` history entry, and set `phase` to `done`. Report the deployed URL /
container or PM2 process to the operator.

## When stuck

- `SERVE_STATIC` not honored / 404 on the SPA → confirm the backend was built
  after the admin and that the static-serving wiring points at
  `apps/admin-<slug>/dist`.
- Docker unavailable in the environment → report the exact `docker compose`
  command for the operator to run on the host; do not fake a deploy.
- Backend won't boot → it almost always means a missing/invalid `RATIO_<SLUG>_*`
  env key (env.schema validation throws on startup with the offending key).
- Note: the `Dockerfile`, `docker-compose.yml` backend service, and
  `ecosystem.config.cjs` are provided by the boilerplate's deploy setup; if a
  target's config is absent, surface that rather than improvising a one-off.
