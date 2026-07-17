# Repo-level change journal

Notable cross-cutting changes (harness, shared, tooling) — NOT scoped to one app.
Per-app changes go in `docs/agent/apps/<slug>/CONTEXT.md`. Newest first. Add via
the `remember` skill. Notable changes only (skip typos/formatting/dep bumps).

Entry shape (the single source is the `remember` skill — `.agents/skills/remember/SKILL.md`):
`### YYYY-MM-DD — <feature|fix|change> — <title>` followed by **What / Why /
Definition of done / fix / Files / Links** lines. (See existing entries below.)

---

### 2026-07-16 — change — Align deployment contract with the five-app EKS runtime
- **What:** Replaced stale production Compose/PM2 and four-app guidance with the implemented five-app AWS contract: one immutable backend image across a shared non-Meta API with Google/Wizzy consumers, a dedicated Meta API, and a dedicated Meta worker; separately deployed admin SPAs; per-app MySQL databases; Redis; and SQS/DLQs. Added the missing Wizzy environment contract, introduced explicit future-app deployment placement state, and repaired clean-checkout verification failures discovered while validating the change.
- **Why:** Active documentation, environment examples, deployment helpers, and agent skills contradicted the source implementation and could not be handed to DevOps as a reliable deployment contract.
- **Definition of done / fix:** Deleted `docker-compose.prod.yml`; removed generic production Compose/PM2 scripts; documented the three-workload EKS split and Google/Meta/Wizzy SQS responsibilities without claiming unimplemented Kinesis or repository-owned infrastructure; kept local Compose local-only; made every future app ask and persist API/worker placement before GATE 1; aligned module registration guidance with `module-registry.ts`; made backend tests build pixel bundles on a clean checkout; fixed formatter/lint drift and the stale Meta paging test; full `pnpm verify` passes.
- **Files:** `README.md`, `ARCHITECTURE.md`, `docs/DEPLOY.md`, `.env.example`, `AGENTS.md`, `package.json`, `docker-compose.prod.yml`, `.agents/skills/*`, `docs/agent/{PRD.template.md,TRD.template.md,STATE.schema.md}`, `docs/agent/apps/*/STATE.json`, `apps/backend/package.json`, `apps/backend/test/unit/meta/catalog-source-paging.test.ts`, `packages/wizzy-sdk/src/*`.
- **Links:** `docs/agent/changes/align-eks-deployment-docs/SPEC.md`, `docs/agent/changes/align-eks-deployment-docs/PLAN.md`, `docs/agent/context/decisions/0005-three-workload-eks-placement.md`.

### 2026-06-17 — change — Phase 2 consolidation complete + scaffolder dry-run validated
- **What:** Ported meta, posthog, and moengage vendors into the repo alongside google (Phase 1 tasks 3–4), updated all harness skills to be multi-vendor-aware (Task 9), then dry-ran the `vendor-scaffolder` recipe against a throwaway `zzdryrun` slug to prove a 5th vendor wires cleanly (Task 10).
- **Why:** Establish ratio-apps as the four-vendor unified monorepo with a validated, repeatable recipe for adding future vendors.
- **Definition of done / fix:**
  - `APPS = ['google', 'meta', 'posthog', 'moengage']` — four live vendors, all typechecking.
  - Core reconciliation: `apps/backend/src/core/` is vendor-agnostic; each vendor owns an isolated module + DB.
  - `buildDefaultEventMap(vendor?)` in `event-map.ts` has per-vendor branches for `meta` (Title-Case) and `moengage` (Title-Case); posthog/google use the snake_case default.
  - `vendor-scaffolder` skill recipe validated end-to-end: scaffolded `zzdryrun`, wired all three `app.module.ts` points + APPS + DB SQL + shared events/config files + barrel exports, ran `pnpm --filter @ratio-app/backend typecheck` → **PASS** (no errors). Reverted completely (git status clean, zero `zzdryrun` matches in source).
  - Recipe gap noted: Step 6 (shared events/config) IS required even for a trivial dry-run slug because `zzdryrun.bootstrap.ts` imports `DEFAULT_ZZDRYRUN_HOST` from `@ratio-app/shared/constants/zzdryrun-events`. The recipe correctly documents this step; no gap.
  - `pnpm verify` green post-revert.
- **Files:** `docs/agent/context/decisions/0003-four-vendor-monorepo-consolidation.md`, `docs/agent/context/CHANGELOG.md`, `docs/agent/context/INDEX.md`, `docs/agent/context/learnings.md`.

### 2026-06-11 — fix — Fresh-eyes review #2 fixes (non-deployment; deploy work deferred by owner)
- **What:** Acted on a second, fresh-eyes full-depth review. Fixed the non-deployment findings; the broader deployment work was deferred to the owner (who will handle deploy), though a few already-applied, internally-consistent deploy edits were kept.
- **Why:** Review #1 left gaps + introduced two small regressions; fresh eyes caught them.
- **Definition of done / fix:**
  - Reverted a wrong review-#1 change: `google/STATE.json` `gates.pr` → **`approved`** (GATE 4 *was* human-approved; PR only skipped for lack of git — prUrl null + history note already record that).
  - Fixed AGENTS.md "Add a new app" pointer (was pointing at `docs/agent/README.md`; the recipe lives in the **`vendor-scaffolder`** skill).
  - `app-module.factory.ts` JSDoc typo ("TemplateModule and TemplateModule") → names `<App>Module`s.
  - `_template` uninstall handler: added a `// TEMPLATE:` marker flagging the webhook-topic dot-vs-slash uncertainty (so scaffolds inherit the warning).
  - DRY: `TDD.template.md` DoD → single `pnpm verify` line; `CHANGELOG.md` entry-shape → pointer to the `remember` skill; harness-upgrade spec DoD marked as a historical snapshot (AGENTS.md canonical, 5 items).
  - Kept (consistent + correct, from before the "skip deployment" note): `Dockerfile` `_template-admin`→`admin-google` (also implements "`_template` not in build"), `configure-app.ts` comment cleanup, ARCHITECTURE PM2 path, DEPLOY.md.
  - **Deferred (deployment — owner will do):** `.env.example` `SERVE_*` docs, `deploy:pm2` double-build, ecosystem nuances.
  - `_template` confirmed reference-only (excluded from workspace + tsconfig; no node_modules). `pnpm verify` green (182).
- **Files:** `docs/agent/apps/google/STATE.json`, `AGENTS.md`, `apps/backend/src/core/factories/app-module.factory.ts`, `apps/backend/src/modules/_template/webhooks/app-uninstalled.handler.ts`, `docs/agent/TDD.template.md`, `docs/agent/context/CHANGELOG.md`, `docs/superpowers/specs/2026-06-11-agentic-harness-upgrade-design.md`, (deploy, kept) `Dockerfile`/`configure-app.ts`/`ARCHITECTURE.md`/`docs/DEPLOY.md`.

### 2026-06-11 — fix — Full-depth review fixes (propagate `_template` exclusion + DRY/staleness cleanup)
- **What:** Acted on a full-depth review of every skill + doc. Fixed one real bug and a cluster of stale refs/duplication.
- **Why:** ADR 0002 (`_template` excluded from run/workspace) was never propagated beyond `apps.ts`/`app.module.ts`, leaving a broken deploy + stale docs; the review also found DRY drift.
- **Definition of done / fix:**
  - **Bug:** `configure-app.ts` static-serve was hard-coded to `_template` (broken single-artifact deploy). Made it **slug-driven** — serves the first non-`_` app in `APPS` (`google`) at `/<slug>/` from `apps/admin-<slug>/dist`, overridable via `SERVE_ADMIN_SLUG`. (Single-admin assumption; fine for the single-artifact deploy.)
  - **Stale `_template`:** corrected README quick-start + routes table, ARCHITECTURE + DEPLOY "mounted/served" wording, `.env.example` note; `vendor-scaffolder` APPS example (`['google','<slug>']`) + slug-guard claim.
  - **Contradictions:** `context-keeper`/`house-conventions` "gitignored" → **committed**; admin-dir naming `apps/<slug>-admin` → `apps/admin-<slug>` (`tdd-author`, google TDD); webhook dot-vs-slash caveat added (`backend-builder`, `stack-patterns`).
  - **DRY:** AGENTS.md trimmed 136→111 (recipe + `_template`/`core` sections → `house-conventions` pointers); DoD single-sourced in AGENTS (5 items incl. clear-PROGRESS); `execute` references it.
  - **Status:** superpowers specs → "Implemented"; plans → use the repo `execute` skill; `google/STATE.json` `gates.pr` → `pending` (PR never opened).
  - `pnpm verify` green (182 tests); all flagged findings re-probed + resolved.
- **Files:** `apps/backend/src/config/configure-app.ts`, `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `docs/DEPLOY.md`, `.env.example`, `.agents/skills/{context-keeper,house-conventions,tdd-author,vendor-scaffolder,backend-builder,stack-patterns,execute}/SKILL.md`, `docs/agent/README.md`, `docs/agent/apps/google/{TDD.md,STATE.json}`, `docs/superpowers/{specs,plans}/*`.

### 2026-06-11 — feature — Repo-native change workflow (brainstorm → write-plan → execute)
- **What:** Three chained standalone skills under `.agents/skills/` (`brainstorm` → `write-plan` → `execute`) + per-change artifacts under `docs/agent/changes/<slug>/{SPEC,PLAN}.md` + an `AGENTS.md` router line (new vendor app → `build-app`; any other feature/bug/PR → `brainstorm`) + a `docs/agent/README.md` "Making a change" section.
- **Why:** Make the repo follow brainstorm → spec → plan → code natively — two gates (spec, plan), `execute` asks subagent-vs-inline — without invoking the external superpowers plugin.
- **Definition of done / fix:** 3 skills discoverable via the `.claude/skills` symlink; `AGENTS.md` + README updated; self-contained (no superpowers refs); `pnpm verify` green (182 tests).
- **Files:** `.agents/skills/{brainstorm,write-plan,execute}/SKILL.md`, `AGENTS.md`, `docs/agent/README.md`.
- **Links:** `docs/superpowers/specs/2026-06-11-change-workflow-design.md`, `docs/superpowers/plans/2026-06-11-change-workflow.md`.

### 2026-06-11 — feature — Agentic harness upgrade (context + state + feedback)
- **What:** Added the durable context store (`docs/agent/context/`), the `remember` skill, repo-level state (`FEATURES.md`, `PROGRESS.md`, per-app `CONTEXT.md`), and the `pnpm verify` feedback loop + Definition of Done.
- **Why:** No durable cross-session context or repo-level feature/change state; feedback loop was implicit.
- **Definition of done / fix:** Stores created + seeded; `remember` skill live; `AGENTS.md` has Context/Standing-rules/State/Verification sections; `pnpm verify` green.
- **Files:** `docs/agent/context/*`, `docs/agent/{FEATURES,PROGRESS}.md`, `.agents/skills/remember/SKILL.md`, `AGENTS.md`, `package.json`, `docs/agent/README.md`.
- **Links:** `docs/superpowers/specs/2026-06-11-agentic-harness-upgrade-design.md`.
