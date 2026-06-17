# ratio-apps Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the three `ratio-app-boilerplate` repos (`anayltics-ratio-app`, `meta-g4_ratio_app`, `posthog`) into one unified monorepo, `ratio-apps`, running all four vendor modules (`google`, `meta`, `posthog`, `moengage`) on a single shared core, then make the agentic skills library multi-vendor-aware.

**Architecture:** The boilerplate is "one process, many modules" — each vendor is a self-contained NestJS module wired through `src/config/apps.ts` (`APPS` tuple) + `src/app.module.ts` (`REGISTERED_MODULES` + `imports[]`), owning its own MySQL database and `RATIO_<SLUG>_*` env keys. `env.schema.ts` and `migrate-runner.ts` derive their slug lists from `APPS` automatically. We take `anayltics-ratio-app` as the base (fullest skills/tooling), upgrade shared `core/`+`packages/shared` to the newest version of each diverged file, drop the other vendors' modules/admins in verbatim, and union the wiring.

**Tech Stack:** pnpm workspaces, Node 22, NestJS 11 + Fastify, Kysely + MySQL 9, React 19 + Vite + TanStack Router, Zod, Biome, Vitest, Docker/PM2.

## Global Constraints

- Target repo: `/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps` (fresh git, already `git init`-ed; the design spec is already committed there).
- Source repos are READ-ONLY — never modify `anayltics-ratio-app`, `meta-g4_ratio_app`, or `posthog`.
- Never copy `node_modules/`, `.git/`, `dist/`, `.env`, `.env.production`, or `.DS_Store` from any source.
- Final vendor set: `APPS = ['google', 'meta', 'posthog', 'moengage'] as const`. `_template` stays on disk (copy-source) but is NEVER in `APPS`.
- Real slugs match `/^[a-z0-9-]+$/`; `_template` is the only `_`-prefixed dir and is never wired.
- Per-module isolation rule: each module owns its own DB (`<slug>_app` + `<slug>_app_test`), its own `RATIO_<SLUG>_*` env keys, its own `core/`-extension. Extend `core/`, never fork it per vendor.
- Core reconciliation rule: **newest-per-file**. Where `meta`'s and `posthog`'s edits to the same hunk genuinely conflict, **STOP and surface the conflict for a human decision** — never auto-pick.
- Verification gate (Definition of Done): `pnpm install && pnpm verify` (= `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`) green across all four modules + four admin SPAs.
- Conventional commits: `type(scope): description`, scope = vendor slug or top-level area (`backend`, `shared`, `deploy`, `skills`, `agent`). End commit messages with the `Co-Authored-By` trailer.
- Do not commit `.env` or secrets.

---

## File Structure (what gets created/modified)

```
ratio-apps/
  apps/
    backend/src/
      config/apps.ts               MODIFY  -> 4-slug APPS
      config/env.schema.ts         MODIFY  -> union vendor-specific blocks (google keeps RATIO_GOOGLE_GOOGLE_*)
      app.module.ts                MODIFY  -> import + register 4 modules
      core/**                      MODIFY  -> reconcile 9 diverged files (newest-per-file)
      modules/_template/           BASE    (from analytics, unwired)
      modules/google/              BASE    (from analytics)
      modules/meta/                CREATE  (from meta repo)
      modules/posthog/             CREATE  (from posthog repo)
      modules/moengage/            CREATE  (from posthog repo)
    _template-admin/               BASE
    admin-google/                  BASE
    admin-meta/                    CREATE  (from meta repo)
    admin-posthog/                 CREATE  (from posthog repo)
    admin-moengage/                CREATE  (from posthog repo)
  packages/shared/src/
    index.ts                       MODIFY  -> union vendor exports
    schemas/event-map.ts           MODIFY  -> reconcile (newest)
    schemas/{meta,posthog,moengage}-config.ts   CREATE
    schemas/capi-ingest.ts         CREATE  (meta)
    constants/openstore-events.ts  MODIFY  -> reconcile (newest)
    constants/{meta,posthog,moengage}-events.ts  CREATE
  docker/mysql/init/01-database.sql  MODIFY -> create 5 DBs (+_test) + grants
  docker-compose.yml               MODIFY  -> merged
  ecosystem.config.cjs             MODIFY  -> merged PM2 entries
  package.json                     MODIFY  -> merged scripts
  .env.example                     MODIFY  -> union RATIO_<SLUG>_* blocks
  AGENTS.md / CLAUDE.md            MODIFY  (Phase 2)
  .agents/skills/**                BASE + Phase 2 edits
  docs/agent/**                    MODIFY  -> merge per-app context + FEATURES
```

---

# Phase 1 — Consolidation

## Task 1: Establish the analytics base in ratio-apps

**Files:**
- Create: everything under `ratio-apps/` (copied from `anayltics-ratio-app`, minus excludes)
- Keep: existing `ratio-apps/docs/superpowers/`, `ratio-apps/.git/`, `ratio-apps/.gitignore`

**Interfaces:**
- Produces: a green single-vendor (`google`) baseline that `pnpm verify` passes — the foundation every later task builds on.

- [ ] **Step 1: Copy the analytics repo into ratio-apps (excluding generated/secret files)**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
rsync -a \
  --exclude='.git/' --exclude='node_modules/' --exclude='dist/' \
  --exclude='.DS_Store' --exclude='.env' --exclude='.env.production' \
  anayltics-ratio-app/ ratio-apps/
```

- [ ] **Step 2: Confirm the tree landed and the spec/plan survived**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && ls apps packages docs/superpowers/specs`
Expected: `apps/` shows `_template-admin admin-google backend`; `packages/` shows `shared`; the spec file is still present.

- [ ] **Step 3: Verify the `.claude/skills` symlink resolves**

Run: `ls -la .claude/ && readlink .claude/skills 2>/dev/null; ls .agents/skills | head`
Expected: `.claude/skills` points at `../.agents/skills` (or the skills are otherwise discoverable). If the symlink broke during copy, recreate it: `ln -sfn ../.agents/skills .claude/skills`.

- [ ] **Step 4: Install and verify the baseline is green**

Run: `pnpm install && pnpm verify`
Expected: PASS — lint, typecheck, test, build all succeed for `@ratio-app/backend` and `@ratio-app/admin-google`. If install warns about the lockfile, run `pnpm install --no-frozen-lockfile` to regenerate.

- [ ] **Step 5: Commit the baseline**

```bash
git add -A
git commit -m "chore(repo): seed ratio-apps from anayltics-ratio-app baseline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Reconcile the shared `core/` (newest-per-file)

**Files:**
- Modify (compare against meta + posthog, take newest): `apps/backend/src/core/oauth/oauth.service.ts`, `core/webhooks/webhooks.service.ts`, `core/factories/app-module.factory.ts`, `core/common/pipes/zod-validation.pipe.ts`, `core/common/resolve-pixel-path.ts`, `core/common/decorators/merchant.decorator.ts`, `core/common/safe-inline-json.ts`, `core/db/kysely-factory.ts`, `core/db/shared-migrations.ts`

**Interfaces:**
- Consumes: the analytics `core/` from Task 1.
- Produces: a single `core/` that is the superset of all three vendors' infrastructure, so every vendor module ported later type-checks against it.

- [ ] **Step 1: Produce a three-way diff report for every diverged core file**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
A=anayltics-ratio-app/apps/backend/src; M=meta-g4_ratio_app/apps/backend/src; P=posthog/apps/backend/src
for f in core/oauth/oauth.service.ts core/webhooks/webhooks.service.ts \
         core/factories/app-module.factory.ts core/common/pipes/zod-validation.pipe.ts \
         core/common/resolve-pixel-path.ts core/common/decorators/merchant.decorator.ts \
         core/common/safe-inline-json.ts core/db/kysely-factory.ts core/db/shared-migrations.ts; do
  echo "######## $f"; echo "==== analytics vs meta ===="; diff "$A/$f" "$M/$f" 2>/dev/null
  echo "==== analytics vs posthog ===="; diff "$A/$f" "$P/$f" 2>/dev/null
done
```
Expected: a readable per-file diff. Note for each file whether only meta changed it, only posthog changed it, or both.

- [ ] **Step 2: Apply the newest version of each file, per the decision rule**

For each file:
- If only ONE source (meta or posthog) differs from analytics → copy that source's version into `ratio-apps`.
- If BOTH differ but the hunks are disjoint (touch different lines/functions) → hand-merge the union into `ratio-apps`.
- If BOTH edit the SAME hunk in conflicting ways → **STOP. Present the conflicting diff to the human and wait for a decision.** Do not auto-pick.

Copy command pattern (single-source case):
```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
# example — only run for files where meta is the sole/newest changer:
cp meta-g4_ratio_app/apps/backend/src/core/webhooks/webhooks.service.ts \
   ratio-apps/apps/backend/src/core/webhooks/webhooks.service.ts
```

- [ ] **Step 3: Typecheck the backend against the reconciled core**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && pnpm --filter @ratio-app/backend typecheck`
Expected: PASS. (At this point only `google` + `_template` consume `core/`; a failure means the newest core file references a symbol not yet present — re-inspect the diff.)

- [ ] **Step 4: Run the backend tests**

Run: `pnpm --filter @ratio-app/backend test`
Expected: PASS — existing core tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/core
git commit -m "refactor(backend): reconcile shared core to newest-per-file across vendors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Port the `meta` module + admin-meta + shared meta files

**Files:**
- Create: `apps/backend/src/modules/meta/` (from meta repo)
- Create: `apps/admin-meta/` (from meta repo)
- Create: `packages/shared/src/constants/meta-events.ts`, `packages/shared/src/schemas/meta-config.ts`, `packages/shared/src/schemas/capi-ingest.ts` (from meta repo)
- Modify: `apps/backend/src/config/apps.ts`, `apps/backend/src/app.module.ts`, `packages/shared/src/index.ts`, `docker/mysql/init/01-database.sql`, `.env.example`, `apps/backend/src/config/env.schema.ts`

**Interfaces:**
- Consumes: reconciled `core/` (Task 2), the `createAppProviders` factory, the `APPS`/`REGISTERED_MODULES` wiring contract.
- Produces: a backend that loads `MetaModule` and an `admin-meta` SPA that builds. `APPS` now includes `'meta'`.

- [ ] **Step 1: Copy the meta module, admin SPA, and shared files**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
cp -R meta-g4_ratio_app/apps/backend/src/modules/meta \
      ratio-apps/apps/backend/src/modules/meta
rsync -a --exclude='node_modules/' --exclude='dist/' --exclude='.DS_Store' \
      meta-g4_ratio_app/apps/admin-meta/ ratio-apps/apps/admin-meta/
cp meta-g4_ratio_app/packages/shared/src/constants/meta-events.ts \
   ratio-apps/packages/shared/src/constants/meta-events.ts
cp meta-g4_ratio_app/packages/shared/src/schemas/meta-config.ts \
   ratio-apps/packages/shared/src/schemas/meta-config.ts
cp meta-g4_ratio_app/packages/shared/src/schemas/capi-ingest.ts \
   ratio-apps/packages/shared/src/schemas/capi-ingest.ts
```

- [ ] **Step 2: Add `'meta'` to the APPS tuple**

Edit `ratio-apps/apps/backend/src/config/apps.ts` — change the export to:
```ts
export const APPS = ['google', 'meta'] as const;
```
(Keep the rest of the file — the slug-validation loop and comments — unchanged.)

- [ ] **Step 3: Register `MetaModule` in app.module.ts**

Edit `ratio-apps/apps/backend/src/app.module.ts`:
- Add import near the other module import: `import { MetaModule } from './modules/meta/meta.module';`
- Extend the map: `const REGISTERED_MODULES = new Map<string, unknown>([['google', GoogleModule], ['meta', MetaModule]]);`
- Add `MetaModule` to the `@Module({ imports: [...] })` array, after `GoogleModule`.

- [ ] **Step 4: Union the shared barrel exports**

Edit `ratio-apps/packages/shared/src/index.ts` — add after the google exports:
```ts
// meta vendor (scaffolded) — vendor-specific config/events + CAPI ingest schema.
export * from './constants/meta-events';
export * from './schemas/meta-config';
export * from './schemas/capi-ingest';
```

- [ ] **Step 5: Add the meta database to the MySQL init script**

Edit `ratio-apps/docker/mysql/init/01-database.sql` — add the CREATE + GRANT lines for `meta_app` / `meta_app_test` alongside the existing google block (mirror the existing two-line CREATE + two-line GRANT pattern).

- [ ] **Step 6: Union meta's env keys**

Diff env files and append meta's `RATIO_META_*` block to `ratio-apps/.env.example`:
```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
diff anayltics-ratio-app/.env.example meta-g4_ratio_app/.env.example
diff anayltics-ratio-app/apps/backend/src/config/env.schema.ts meta-g4_ratio_app/apps/backend/src/config/env.schema.ts
```
Append any meta-only lines from `.env.example` into `ratio-apps/.env.example`. The base `RATIO_META_*` keys (DATABASE_URL, DATA_ENCRYPTION_KEY, CLIENT_ID/SECRET, CALLBACK_URL, ADMIN_BASE_URL) are auto-derived by `env.schema.ts` from `APPS` — only hand-add to `env.schema.ts` if the diff shows a meta-SPECIFIC extra key (analytics adds `RATIO_GOOGLE_GOOGLE_*`; check whether meta adds an analogous block and, if so, replicate that pattern).

- [ ] **Step 7: Install, typecheck, and confirm the module loads**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && pnpm install && pnpm --filter @ratio-app/backend typecheck && pnpm --filter @ratio-app/backend test`
Expected: PASS. The load-time assertion in `app.module.ts` (every `APPS` slug has a registered module) passes; meta types resolve against shared + core.

- [ ] **Step 8: Build the admin-meta SPA**

Run: `pnpm --filter @ratio-app/admin-meta build`
Expected: PASS — Vite build produces `apps/admin-meta/dist/`. (If the workspace filter name differs, check `apps/admin-meta/package.json` `name` and use it.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(meta): port meta module + admin-meta into unified repo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Port the `posthog` + `moengage` modules + admins + shared files

**Files:**
- Create: `apps/backend/src/modules/posthog/`, `apps/backend/src/modules/moengage/` (from posthog repo)
- Create: `apps/admin-posthog/`, `apps/admin-moengage/` (from posthog repo)
- Create: `packages/shared/src/constants/posthog-events.ts`, `constants/moengage-events.ts`, `schemas/posthog-config.ts`, `schemas/moengage-config.ts` (from posthog repo)
- Modify: `apps/backend/src/config/apps.ts`, `apps/backend/src/app.module.ts`, `packages/shared/src/index.ts`, `docker/mysql/init/01-database.sql`, `.env.example`, `apps/backend/src/config/env.schema.ts`

**Interfaces:**
- Consumes: reconciled `core/` (Task 2), the wiring contract, the now-2-slug `APPS`.
- Produces: `APPS = ['google','meta','posthog','moengage']`; backend loads all four modules; `admin-posthog` + `admin-moengage` build.

- [ ] **Step 1: Copy both modules, both admin SPAs, and shared files**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
cp -R posthog/apps/backend/src/modules/posthog  ratio-apps/apps/backend/src/modules/posthog
cp -R posthog/apps/backend/src/modules/moengage ratio-apps/apps/backend/src/modules/moengage
rsync -a --exclude='node_modules/' --exclude='dist/' --exclude='.DS_Store' \
      posthog/apps/admin-posthog/  ratio-apps/apps/admin-posthog/
rsync -a --exclude='node_modules/' --exclude='dist/' --exclude='.DS_Store' \
      posthog/apps/admin-moengage/ ratio-apps/apps/admin-moengage/
for f in constants/posthog-events.ts constants/moengage-events.ts \
         schemas/posthog-config.ts schemas/moengage-config.ts; do
  cp "posthog/packages/shared/src/$f" "ratio-apps/packages/shared/src/$f"
done
```

- [ ] **Step 2: Finalize the APPS tuple**

Edit `ratio-apps/apps/backend/src/config/apps.ts`:
```ts
export const APPS = ['google', 'meta', 'posthog', 'moengage'] as const;
```

- [ ] **Step 3: Register both modules in app.module.ts**

Edit `ratio-apps/apps/backend/src/app.module.ts`:
- Add imports: `import { PosthogModule } from './modules/posthog/posthog.module';` and `import { MoengageModule } from './modules/moengage/moengage.module';`
- Extend the map to all four:
```ts
const REGISTERED_MODULES = new Map<string, unknown>([
  ['google', GoogleModule],
  ['meta', MetaModule],
  ['posthog', PosthogModule],
  ['moengage', MoengageModule],
]);
```
- Add `PosthogModule, MoengageModule` to the `@Module({ imports: [...] })` array.

- [ ] **Step 4: Union the shared barrel exports**

Edit `ratio-apps/packages/shared/src/index.ts` — add:
```ts
// posthog + moengage vendors (scaffolded).
export * from './constants/posthog-events';
export * from './schemas/posthog-config';
export * from './constants/moengage-events';
export * from './schemas/moengage-config';
```

- [ ] **Step 5: Add posthog + moengage databases to the MySQL init script**

Edit `ratio-apps/docker/mysql/init/01-database.sql` — add CREATE + GRANT blocks for `posthog_app`/`posthog_app_test` and `moengage_app`/`moengage_app_test`. The final file must declare all five vendor DBs: `_template_app`, `google_app`, `meta_app`, `posthog_app`, `moengage_app` (each plus its `_test` sibling) with matching GRANTs.

- [ ] **Step 6: Union posthog/moengage env keys**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
diff anayltics-ratio-app/.env.example posthog/.env.example
diff anayltics-ratio-app/apps/backend/src/config/env.schema.ts posthog/apps/backend/src/config/env.schema.ts
```
Append any posthog/moengage-only lines to `ratio-apps/.env.example`. Base `RATIO_POSTHOG_*` / `RATIO_MOENGAGE_*` keys are auto-derived from `APPS`; only add vendor-specific extras to `env.schema.ts` if the diff shows them.

- [ ] **Step 7: Install, typecheck, test**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && pnpm install && pnpm --filter @ratio-app/backend typecheck && pnpm --filter @ratio-app/backend test`
Expected: PASS — all four slugs in `APPS` have registered modules (load-time assertion green); all module types resolve.

- [ ] **Step 8: Build both new admin SPAs**

Run: `pnpm --filter @ratio-app/admin-posthog build && pnpm --filter @ratio-app/admin-moengage build`
Expected: PASS for both (confirm filter names from each `package.json`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(posthog,moengage): port posthog + moengage modules + admins into unified repo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Reconcile shared `event-map.ts` and `openstore-events.ts`

**Files:**
- Modify: `packages/shared/src/schemas/event-map.ts`, `packages/shared/src/constants/openstore-events.ts`

**Interfaces:**
- Consumes: all four vendors' event/config files now present (Tasks 3–4).
- Produces: a unified event map / openstore-events that references every vendor's events without dropping any.

- [ ] **Step 1: Three-way diff both files**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
for f in schemas/event-map.ts constants/openstore-events.ts; do
  echo "######## $f"; echo "== vs meta =="; diff anayltics-ratio-app/packages/shared/src/$f meta-g4_ratio_app/packages/shared/src/$f
  echo "== vs posthog =="; diff anayltics-ratio-app/packages/shared/src/$f posthog/packages/shared/src/$f
done
```
Expected: small diffs (event-map ~7 lines vs meta, ~21 vs posthog). Identify whether each vendor adds map entries / event constants.

- [ ] **Step 2: Hand-merge the union**

Edit both files in `ratio-apps` so they contain the union of all vendors' additions (e.g. every vendor's event keys present in `event-map.ts`, every constant in `openstore-events.ts`). Disjoint additions → union directly. If a vendor redefines the SAME key with a different value → **STOP and surface the conflict** per the Global Constraints rule.

- [ ] **Step 3: Typecheck shared + backend**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && pnpm --filter @ratio-app/shared typecheck && pnpm --filter @ratio-app/backend typecheck`
Expected: PASS (confirm the shared package's workspace name from `packages/shared/package.json`).

- [ ] **Step 4: Run shared tests (event-map + openstore-events have tests)**

Run: `pnpm --filter @ratio-app/shared test`
Expected: PASS — `event-map.test.ts`, `openstore-events.test.ts` green with all vendors' events present.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): unify event-map + openstore-events across all four vendors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Merge root config + full-repo verify (Phase 1 DoD)

**Files:**
- Modify: `package.json`, `docker-compose.yml`, `ecosystem.config.cjs`, `.env.example`

**Interfaces:**
- Consumes: all four modules + four admins wired (Tasks 3–5).
- Produces: a repo where `pnpm verify` is green across every workspace, and every vendor has dev/build/migrate/deploy scripts.

- [ ] **Step 1: Merge package.json scripts**

Edit `ratio-apps/package.json` `scripts` to include the union of per-vendor scripts from all three repos (they're already namespaced — no collisions):
- `dev:admin:google`, `dev:admin-meta`, `dev:admin:posthog`, `dev:admin:moengage`
- `build:admin:google`, `build:admin-meta`, `build:admin:posthog`, `build:admin:moengage`
- `migrate:google`, `migrate:meta`, `migrate:posthog`, `migrate:moengage` (and `migrate:down:*` siblings); set `"migrate": "pnpm migrate:google && pnpm migrate:meta && pnpm migrate:posthog && pnpm migrate:moengage"`
- Keep posthog's `deploy:admin:posthog` / `deploy:admin:moengage` (S3/CloudFront) scripts verbatim.
- Keep the shared `infra:*`, `dev:all`, `build:all`, `test`, `typecheck`, `lint`, `verify`, `format`, `deploy:docker`, `deploy:pm2` entries (already present from the analytics base).
Reference the three source `package.json` scripts blocks when transcribing; copy exact command strings.

- [ ] **Step 2: Merge docker-compose.yml**

Edit `ratio-apps/docker-compose.yml`: the single `mysql` service already mounts `./docker/mysql/init` (which now creates all five DBs from Task 4). If any source's compose added vendor-specific backend env (`RATIO_<SLUG>_DATABASE_URL`) in the commented backend block, union those commented hints. Confirm there is exactly ONE `mysql` service and ONE `backend` service.

- [ ] **Step 3: Merge ecosystem.config.cjs**

Edit `ratio-apps/ecosystem.config.cjs` to include PM2 app entries for the backend plus any per-admin static-serve entries from the source repos (union; dedupe by app `name`).

- [ ] **Step 4: Full clean install**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`
Expected: single resolved dependency tree, no peer-dep errors that block build.

- [ ] **Step 5: Full verify (the Phase 1 Definition of Done)**

Run: `pnpm verify`
Expected: PASS — `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` green across `@ratio-app/backend`, `@ratio-app/shared`, and all four `admin-*` workspaces.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(repo): merge root config (scripts, compose, pm2, env) — full verify green

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Merge agent docs/context

**Files:**
- Create: `docs/agent/apps/{meta,posthog,moengage}/` (from source repos)
- Modify: `docs/agent/FEATURES.md`, `docs/agent/context/INDEX.md`

**Interfaces:**
- Consumes: the merged repo.
- Produces: per-vendor standing context present for all four vendors; `FEATURES.md` lists every vendor's capabilities.

- [ ] **Step 1: Copy per-app context dirs**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
cp -R meta-g4_ratio_app/docs/agent/apps/meta      ratio-apps/docs/agent/apps/meta 2>/dev/null || true
for s in posthog moengage; do
  cp -R posthog/docs/agent/apps/$s ratio-apps/docs/agent/apps/$s 2>/dev/null || true
done
ls ratio-apps/docs/agent/apps
```
Expected: `google meta moengage posthog` (and any `_template`).

- [ ] **Step 2: Merge FEATURES.md and INDEX.md**

Edit `ratio-apps/docs/agent/FEATURES.md` to union each source repo's capability rows (one section per vendor). Edit `docs/agent/context/INDEX.md` to reference the newly-added per-app context files. Resolve any duplicate generic rows by keeping one.

- [ ] **Step 3: Sanity-check links**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && grep -rl "docs/agent/apps" docs/agent | head` and confirm referenced paths exist.
Expected: no references to missing files.

- [ ] **Step 4: Commit**

```bash
git add docs/agent
git commit -m "docs(agent): merge per-vendor context + FEATURES across all four apps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Phase 2 — Agentic system (verified against the merged structure)

## Task 8: Confirm the skills baseline is complete

**Files:**
- Verify/Modify: `.agents/skills/**`, `.claude/skills` symlink

**Interfaces:**
- Consumes: analytics' full 18-skill set (carried in by Task 1).
- Produces: a confirmed-complete skills library — nothing meta/posthog had that analytics lacked.

- [ ] **Step 1: Diff the skill sets across the three source repos**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
comm -3 <(ls anayltics-ratio-app/.agents/skills | sort) <(ls meta-g4_ratio_app/.agents/skills | sort)
echo "--- posthog skills ---"; ls posthog/.agents/skills 2>/dev/null
```
Expected: analytics is a superset of meta (analytics adds `build-app`, `execute`, `remember`, `write-plan`); posthog has none. So the analytics set carried in by Task 1 is already the complete baseline.

- [ ] **Step 2: Diff the content of skills present in BOTH analytics and meta (catch meta-side improvements)**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS"
for s in $(ls meta-g4_ratio_app/.agents/skills); do
  echo "######## $s"; diff anayltics-ratio-app/.agents/skills/$s/SKILL.md meta-g4_ratio_app/.agents/skills/$s/SKILL.md 2>/dev/null
done
```
Expected: note any meta-side improvement to a shared skill. If a skill genuinely improved on the meta side, port that improvement into `ratio-apps/.agents/skills/<skill>/SKILL.md`. Otherwise no change.

- [ ] **Step 3: Verify skills are discoverable**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && ls .claude/skills/ | wc -l`
Expected: matches `ls .agents/skills | wc -l` (symlink resolves to the full set).

- [ ] **Step 4: Commit (only if a skill was updated)**

```bash
git add .agents/skills && git commit -m "chore(skills): adopt complete skills baseline in unified repo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Make the agentic system multi-vendor-aware

**Files:**
- Modify: `.agents/skills/vendor-scaffolder/SKILL.md`, `.agents/skills/house-conventions/SKILL.md`, `AGENTS.md`

**Interfaces:**
- Consumes: the merged repo as the worked example (four live vendors in `APPS`).
- Produces: skills + AGENTS.md that describe the real multi-vendor structure, so scaffolding a 5th vendor appends cleanly.

- [ ] **Step 1: Read the current scaffolder + conventions + AGENTS.md**

Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && cat .agents/skills/vendor-scaffolder/SKILL.md .agents/skills/house-conventions/SKILL.md AGENTS.md`
Expected: you can see the current "add a vendor" recipe (which assumes a near-empty `APPS`).

- [ ] **Step 2: Update `vendor-scaffolder/SKILL.md` for an N-vendor APPS**

Edit so the recipe explicitly: appends the new slug to an existing multi-entry `APPS` tuple (not replace); adds to the `REGISTERED_MODULES` map AND `imports[]` without disturbing the existing four entries; asserts the new slug collides with none of `google|meta|posthog|moengage`; adds a new `<slug>_app`(+`_test`) block to `docker/mysql/init/01-database.sql` and a GRANT; adds the shared barrel exports. Reference the now-real four-vendor `app.module.ts` as the example to copy the shape from.

- [ ] **Step 3: Update `house-conventions/SKILL.md`**

Edit to state the now-real invariants with the merged repo as the worked example: per-module DB naming (`<slug>_app`), `RATIO_<SLUG>_*` env namespacing (auto-derived from `APPS` in `env.schema.ts`), `core/` extend-not-fork, `_template` never wired. Replace any single-vendor phrasing.

- [ ] **Step 4: Update `AGENTS.md`**

Edit the "The locked stack" and "Add a new app" sections to reflect four live vendors (`google`, `meta`, `posthog`, `moengage`) rather than one. Keep `CLAUDE.md` as the one-line pointer (no separate copy).

- [ ] **Step 5: Verify the repo still builds (docs-only change, sanity)**

Run: `pnpm verify`
Expected: PASS (unchanged — skills/docs don't affect the build, but confirm nothing was edited by mistake).

- [ ] **Step 6: Commit**

```bash
git add .agents/skills AGENTS.md
git commit -m "feat(skills): make vendor-scaffolder + house-conventions + AGENTS multi-vendor-aware

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Dry-run the scaffolder recipe + record decisions

**Files:**
- Temporary: a throwaway slug (reverted) — no permanent files
- Modify (via `remember` skill): `docs/agent/apps/<...>/CONTEXT.md` / context index

**Interfaces:**
- Consumes: the updated `vendor-scaffolder` recipe (Task 9).
- Produces: proof the recipe wires a 5th vendor cleanly, and a durable record of the consolidation.

- [ ] **Step 1: Dry-run the scaffolder recipe against a throwaway slug**

Follow the updated `vendor-scaffolder` recipe to scaffold slug `zzdryrun` (copy `_template` → rename → wire `APPS`/`app.module.ts`/db-init/barrel).
Run: `cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps" && pnpm install && pnpm --filter @ratio-app/backend typecheck`
Expected: PASS — the 5-slug `APPS` load assertion green, proving the recipe appends cleanly to the four existing vendors.

- [ ] **Step 2: Revert the throwaway scaffold**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps"
git checkout -- . && git clean -fd apps/backend/src/modules/zzdryrun apps/admin-zzdryrun 2>/dev/null || true
git status --short
```
Expected: clean working tree (no `zzdryrun` artifacts remain).

- [ ] **Step 3: Record the consolidation via the `remember` skill**

Invoke the `remember` skill to persist: the consolidation decision (4 vendors, one core), the core-reconciliation outcome (which files came from where, any conflicts resolved), and the multi-vendor scaffolder change. This updates the relevant `CONTEXT.md` / context index per the skill.

- [ ] **Step 4: Final verify + commit**

```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps"
pnpm verify
git add -A
git commit -m "docs(agent): record consolidation + verify multi-vendor scaffolder dry-run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: `pnpm verify` PASS; clean commit. Phase 2 Definition of Done met.

---

## Self-Review notes (coverage map spec → tasks)

- Spec 1.1 base → Task 1. 1.2 vendor modules → Tasks 3, 4. 1.3 wiring → Tasks 3, 4 (apps.ts, app.module.ts, env.schema). 1.4 core reconcile → Task 2. 1.5 shared union → Tasks 3, 4, 5. 1.6 frontends → Tasks 3, 4. 1.7 root config → Task 6. 1.8 docs/agent → Task 7. 1.9 Phase 1 DoD → Task 6 Step 5.
- Spec 2.1 skills baseline → Task 8. 2.2 improvements (scaffolder/house-conventions/build-app/AGENTS) → Task 9. 2.3 Phase 2 DoD (scaffolder dry-run + remember) → Task 10.
- Risks: core conflict → Task 2 Step 2 STOP rule. Hidden coupling → typecheck after each port (Tasks 3, 4). DB collisions → Tasks 3, 4 init-SQL + Task 6 verify. Dep skew → Task 6 clean install.
```
