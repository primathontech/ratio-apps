# Agentic Harness Upgrade — Implementation Plan

> **For agentic workers:** implement this plan with the repo's `execute` skill (it asks subagent-driven vs inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repo the durable system of record — a context store + `remember` skill, repo-level feature/change state, and an explicit `pnpm verify` feedback loop — so any future agent session inherits decisions, learnings, rules, and per-feature history.

**Architecture:** Pure docs + one root npm script + one markdown skill. New context/state files live under `docs/agent/` (committed, beside the existing per-build state). A `remember` skill (in `.agents/skills/`, auto-exposed via the existing `.claude/skills → ../.agents/skills` symlink) is the single writer that classifies entries and keeps `INDEX.md` in sync. `AGENTS.md` gains lean pointer sections so every session inherits the context.

**Tech Stack:** Markdown, pnpm workspace scripts, the repo's existing skills convention (frontmatter + body). No application code changes.

**Environment note:** This repo currently has **no `.git`**. Tasks therefore end with a **verification** step, not a commit. If git is initialized later, the changes can be committed as one `feat(agent): add context/state/feedback harness` commit.

**Spec:** `docs/superpowers/specs/2026-06-11-agentic-harness-upgrade-design.md`

---

### Task 1: `pnpm verify` feedback-loop command

**Files:**
- Modify: `package.json` (root) — `scripts` block

- [ ] **Step 1: Add the `verify` script**

In root `package.json`, under `"scripts"`, add a `verify` entry next to the quality gates (after the `"lint"` line). The script runs the four checks in order, blocking on first failure:

```json
    "verify": "pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build",
```

- [ ] **Step 2: Run it to confirm it works end-to-end**

Run: `pnpm verify`
Expected: lint → typecheck → test → build all run; ends with the admin `vite build` "✓ built in …" and exit code 0. (Current suite: 182 tests across shared/backend/admin.)

- [ ] **Step 3: Confirm it blocks on first failure (quick sanity, no permanent change)**

Run: `pnpm -r lint && echo OK` and confirm `OK` prints (proves the `&&` chain semantics). No code change needed; this is a reasoning check only.

---

### Task 2: Context-store + repo-state scaffolding

**Files:**
- Create: `docs/agent/context/INDEX.md`
- Create: `docs/agent/context/learnings.md`
- Create: `docs/agent/context/CHANGELOG.md`
- Create: `docs/agent/context/decisions/.gitkeep`
- Create: `docs/agent/FEATURES.md`
- Create: `docs/agent/PROGRESS.md`

- [ ] **Step 1: Create `docs/agent/context/INDEX.md`**

```markdown
# Context index

The navigable map of durable context for this repo. Skim this (and the relevant
`docs/agent/apps/<slug>/CONTEXT.md`) before non-trivial work. Detail lives in the
linked files — read on demand. The `remember` skill keeps this index in sync;
prefer editing through it over hand-editing.

## Decisions (ADRs)
- [0001 — Multi-handler webhook dispatch](./decisions/0001-multi-handler-webhook-dispatch.md) — one module can handle N webhook topics (generic, backward-compatible core change).
- [0002 — `_template` excluded from run/workspace](./decisions/0002-template-excluded-from-run-and-workspace.md) — kept on disk as scaffolder source; not built/run.

## Learnings
See [learnings.md](./learnings.md).

## Change journals
- Repo-level: [CHANGELOG.md](./CHANGELOG.md)
- Per app: `docs/agent/apps/<slug>/CONTEXT.md`
```

- [ ] **Step 2: Create `docs/agent/context/learnings.md`**

```markdown
# Learnings (cross-cutting gotchas)

Non-obvious facts discovered while building. Newest first. Add via the `remember`
skill. Keep each entry 1–3 lines.

- **2026-06-08** — Ratio product/variant prices are **integer paise**; divide by 100 for major-unit (₹) money sent to external APIs.
- **2026-06-08** — Webhook `event` strings: the platform registry uses **slash-form** (`products/create`, `app/uninstalled`). The `_template` example used dot-form; confirm against a live delivery before trusting (a wrong topic silently no-ops via the dispatcher fast-path).
- **2026-06-08** — The Web Pixels API (`POST /pixels`) is **Draft** (`codegen_ready:false`); pixel registration must degrade to a `pending_api` status, with script-tag delivery as the working fallback.
- **2026-06-08** — `nest start` runs with cwd = `apps/backend`, and `main.ts` does `dotenv/config` against `DOTENV_CONFIG_PATH='.env'` (cwd-relative); a symlink `apps/backend/.env → ../../.env` makes it load the root `.env`.
```

- [ ] **Step 3: Create `docs/agent/context/CHANGELOG.md`**

```markdown
# Repo-level change journal

Notable cross-cutting changes (harness, shared, tooling) — NOT scoped to one app.
Per-app changes go in `docs/agent/apps/<slug>/CONTEXT.md`. Newest first. Add via
the `remember` skill. Notable changes only (skip typos/formatting/dep bumps).

Entry shape:

### YYYY-MM-DD — <feature|fix|change> — <title>
- **What:** …
- **Why:** …
- **Definition of done / fix:** …
- **Files:** …
- **Links:** …

---

### 2026-06-11 — feature — Agentic harness upgrade (context + state + feedback)
- **What:** Added the durable context store (`docs/agent/context/`), the `remember` skill, repo-level state (`FEATURES.md`, `PROGRESS.md`, per-app `CONTEXT.md`), and the `pnpm verify` feedback loop + Definition of Done.
- **Why:** No durable cross-session context or repo-level feature/change state; feedback loop was implicit.
- **Definition of done / fix:** Stores created + seeded; `remember` skill live; `AGENTS.md` has Context/Standing-rules/State/Verification sections; `pnpm verify` green.
- **Files:** `docs/agent/context/*`, `docs/agent/{FEATURES,PROGRESS}.md`, `.agents/skills/remember/SKILL.md`, `AGENTS.md`, `package.json`, `docs/agent/README.md`.
- **Links:** `docs/superpowers/specs/2026-06-11-agentic-harness-upgrade-design.md`.
```

- [ ] **Step 4: Create `docs/agent/context/decisions/.gitkeep`**

Empty file (keeps the `decisions/` directory present before ADRs are added in Task 4).

Content: (empty)

- [ ] **Step 5: Create `docs/agent/FEATURES.md`**

```markdown
# Features registry

The catalog of capabilities in this repo and their lifecycle status. Drill into a
capability's `CONTEXT.md` for its standing context + change journal. Update the
`Status` when a capability's lifecycle changes (`building` → `built` →
`local-tested` → `pr-open` → `deployed`). Add via the `remember` skill.

| Capability | Slug | Status | Context | Notes |
|---|---|---|---|---|
| Google (GA4 + Google Ads + Merchant Center) | `google` | built · local-tested | [apps/google/CONTEXT.md](./apps/google/CONTEXT.md) | not yet PR'd/deployed; needs Web Pixels API + live Ratio token for full flow |
| Golden template | `_template` | golden source (not shipped) | — | scaffolder copy source; excluded from run/workspace |
```

- [ ] **Step 6: Create `docs/agent/PROGRESS.md`**

```markdown
# In-flight progress

Current multi-session work ONLY. Ephemeral: when a task completes, move its durable
summary into the relevant change journal (`apps/<slug>/CONTEXT.md` or
`context/CHANGELOG.md`) and clear it here. This is distinct from per-build
`STATE.json` (one vendor app's lifecycle state machine).

## Active task
_None._

## Blockers
_None._

## Next step
_None._
```

- [ ] **Step 7: Verify the scaffolding exists**

Run: `ls docs/agent/context docs/agent/context/decisions docs/agent/FEATURES.md docs/agent/PROGRESS.md`
Expected: lists `INDEX.md learnings.md CHANGELOG.md`, the `decisions/` dir, and both top-level files.

---

### Task 3: The `remember` skill

**Files:**
- Create: `.agents/skills/remember/SKILL.md`

- [ ] **Step 1: Create the skill file**

`.agents/skills/remember/SKILL.md`:

```markdown
---
name: remember
description: Persist durable context into the repo so future agent sessions inherit it. Classifies an entry as a decision (ADR), a learning/gotcha, a working rule, a per-app feature/fix/change journal entry, or a repo-level change, writes it to the right file, and updates the context index. Use whenever the user says "save this to context"/"remember this" or you learn something future sessions must know.
when_to_use: Invoke when the user says "remember this" / "save to context" / "record this decision/fix", or proactively (with a one-line confirmation) when you learn a durable, non-obvious fact, make an architectural/product decision, fix a notable bug, or ship a feature. Do NOT use for trivia (typos, formatting, dep bumps) or for transient in-flight status (that goes in PROGRESS.md).
---

# remember

Single writer for the repo's durable context. Classify, write, index.

## 1. Classify the entry

| Type | When | Destination |
|---|---|---|
| **decision** | An architectural/product choice with alternatives + rationale | `docs/agent/context/decisions/NNNN-<kebab>.md` (new ADR) |
| **learning** | A non-obvious fact/gotcha future work needs | append to `docs/agent/context/learnings.md` |
| **rule** | A standing behavior the agent must always follow | add a line under "Standing rules" in `AGENTS.md` |
| **per-app change** | A notable feature/fix/change to one app | append to `docs/agent/apps/<slug>/CONTEXT.md` → Change journal |
| **repo-level change** | A notable cross-cutting change (harness/shared/tooling) | append to `docs/agent/context/CHANGELOG.md` |

If genuinely ambiguous, ask the user once. Infer the `<slug>` from the work in
progress; confirm if unclear. **Notable changes only** — skip trivia. **Never**
write secrets.

## 2. Write the entry

- **Dates:** use the real current date (`YYYY-MM-DD`).
- **ADR** (`decisions/NNNN-<kebab>.md`) — scan `decisions/` for the next
  zero-padded number. Body:
  ```
  # NNNN — <Title>
  - **Date:** YYYY-MM-DD
  - **Status:** accepted
  ## Context
  <forces at play>
  ## Decision
  <what we chose>
  ## Rationale
  <why; alternatives rejected>
  ## Consequences
  <follow-on effects, good and bad>
  ```
- **learning** — one dated bullet (1–3 lines): the fact + why it matters.
- **rule** — one imperative line under `AGENTS.md` "Standing rules" (+ optional why).
- **change** (per-app `CONTEXT.md` journal or repo `CHANGELOG.md`) — newest first:
  ```
  ### YYYY-MM-DD — <feature|fix|change> — <title>
  - **What:** …
  - **Why:** …
  - **Definition of done / fix:** …   # for a fix, the root cause + what was actually done
  - **Files:** …
  - **Links:** …
  ```
- If the per-app `CONTEXT.md` does not exist yet, create it from the template in
  `docs/agent/apps/<slug>/CONTEXT.md` shape (Standing context + Change journal —
  see `apps/google/CONTEXT.md` for an example).

## 3. Update the index

After any decision or learning write, add/refresh a one-line hook + relative link
in `docs/agent/context/INDEX.md` so the map stays current.

## 4. Report

One line: what was written and where (e.g. "Recorded ADR 0003 at
`docs/agent/context/decisions/0003-…md` and indexed it").
```

- [ ] **Step 2: Verify the skill is discoverable via the symlink**

Run: `cat .claude/skills/remember/SKILL.md | head -5`
Expected: prints the frontmatter (`name: remember`) — proving `.claude/skills → ../.agents/skills` resolves the new skill.

---

### Task 4: Seed per-app context + ADRs

**Files:**
- Create: `docs/agent/apps/google/CONTEXT.md`
- Create: `docs/agent/context/decisions/0001-multi-handler-webhook-dispatch.md`
- Create: `docs/agent/context/decisions/0002-template-excluded-from-run-and-workspace.md`

- [ ] **Step 1: Create `docs/agent/apps/google/CONTEXT.md`**

```markdown
# google — context

Living context for the Google app (GA4 + Google Ads + GMC). Read before touching
this module. Standing context first; dated change journal below (newest first).

## Standing context
- **Three integrations, two delivery paths.** GA4 + Google Ads are client-side
  pixels; GMC is server-side feed sync via Content API for Shopping v2.1.
- **Pixel config is DB-driven**, injected as a `window.__GOOGLE_RATIO_CONFIG__`
  prelude before the `static/google-pixel.js` bundle. GA4 registers
  `isolated:false` (fans out); Ads owns its conversions via `send_to`.
- **Web Pixels API is Draft** → registration is guarded and records
  `pending_api`; the script-tag endpoint (`/google/sdk/:merchantId.js`) is the
  working delivery path.
- **Webhook topics are slash-form** (`products/create|update|delete`,
  `app/uninstalled`) — TRD open item R1, verify against a live delivery.
- **Ratio prices are integer paise** — convert to major units for GMC.
- **Secrets:** GMC service-account key + Google OAuth tokens are encrypted at
  rest; config GET returns `hasGmcKey`, never the value.
- **Local dev:** dummy merchant id `dev-merchant` is seeded in `google_app`;
  open the admin at `/?merchant-id=dev-merchant`. Backend loads env via a symlink
  `apps/backend/.env → ../../.env`.

## Change journal

### 2026-06-08 — feature — Google app built (backend + admin + SDK)
- **What:** GA4 + Ads pixels, GMC feed sync (Content API client, product-mapper, feed-sync, reconcile), Google OAuth + manual service-account, 4 webhook handlers, enhanced conversions; admin SPA; shared `google-config`.
- **Why:** Ratio parity with Shopify's Google & YouTube app.
- **Definition of done / fix:** `pnpm verify` green (182 tests); local smoke test passes (`/ready` google:ok, `/google/api/*` with `dev-merchant`).
- **Files:** `apps/backend/src/modules/google/**`, `apps/admin-google/**`, `packages/shared/src/{schemas/google-config,constants/google-events}.ts`.
- **Links:** `docs/agent/apps/google/{PRD,TRD,TDD}.md`; ADR 0001.

### 2026-06-08 — fix — Backend env not loading under `nest start`
- **What:** Backend booted with all env vars undefined.
- **Why:** `main.ts` `dotenv/config` resolves `.env` against cwd (`apps/backend`), but the `.env` is at repo root.
- **Definition of done / fix:** Added symlink `apps/backend/.env → ../../.env`; also added `emptyAsUndefined()` in `env.schema.ts` so blank optional `RATIO_GOOGLE_GOOGLE_*` keys validate.
- **Files:** `apps/backend/.env` (symlink), `apps/backend/src/config/env.schema.ts`.
- **Links:** learnings.md (dotenv cwd note).
```

- [ ] **Step 2: Create ADR `0001-multi-handler-webhook-dispatch.md`**

```markdown
# 0001 — Multi-handler webhook dispatch

- **Date:** 2026-06-08
- **Status:** accepted

## Context
The core `WebhooksService` + `createAppProviders` accepted exactly one
`WebhookHandler` per module, matched by a single `topic`. The google app needs
four topics (`app/uninstalled` + `products/create|update|delete`).

## Decision
Generalize the core to accept `handlers: WebhookHandler[]` (and
`handlerClasses[]` in the factory), routing `envelope.event` via a
topic→handler map. Keep the single-`handler` form working.

## Rationale
A generic capability that benefits every module, not vendor-specific logic in
`core/`. Backward-compatible: existing single-handler callers (`_template`) pass
a one-element array; all prior core tests stay green. Alternative (registering
the module N times) was rejected as a hack.

## Consequences
Duplicate topics now throw at construction (wiring error caught early). Future
multi-topic apps are first-class. `core/` boundary preserved (extended, not
forked).
```

- [ ] **Step 3: Create ADR `0002-template-excluded-from-run-and-workspace.md`**

```markdown
# 0002 — `_template` excluded from run and workspace

- **Date:** 2026-06-11
- **Status:** accepted

## Context
`_template` (golden module + admin) was wired into `APPS`, `app.module.ts`, the
pnpm workspace, docker, and migrate scripts — so it ran (`/ready` showed
`_template: fail`) and built as a shipped package, cluttering a google-only
deliverable.

## Decision
Remove `_template` from the running backend (`APPS`, `app.module.ts`, docker,
migrate) and from the pnpm workspace (`!apps/_template-admin`), and exclude
`src/modules/_template/**` from backend tsconfig. **Keep the `_template` source
on disk** — the `vendor-scaffolder` skill copies it to scaffold future apps.

## Rationale
Satisfies "don't run/build the template" without breaking future scaffolding
(the skills depend on the template as the copy source), and there is no git to
recover a deletion. `/ready` is now google-only (`200 { google: ok }`).

## Consequences
`env.schema.test` was repointed from `_template` to `google` keys. New vendors
are still scaffolded from `_template`; if it is ever fully removed, the
scaffolder must gain a new source.
```

- [ ] **Step 4: Verify the seeds + index links resolve**

Run: `ls docs/agent/apps/google/CONTEXT.md docs/agent/context/decisions/000{1,2}-*.md`
Expected: all three files listed. Then confirm `INDEX.md` (Task 2) links match the ADR filenames exactly.

---

### Task 5: AGENTS.md lean pointer sections + Definition of Done

**Files:**
- Modify: `AGENTS.md` (add four sections; ~25 lines)
- Modify: `.agents/skills/code-reviewer/SKILL.md` (point at `pnpm verify`)

- [ ] **Step 1: Add the four sections to `AGENTS.md`**

Insert before the existing "## Conventional commits" section:

```markdown
## Context & decisions (read before non-trivial work)

Durable context lives in `docs/agent/context/` — skim
[`context/INDEX.md`](./docs/agent/context/INDEX.md) and the relevant
`docs/agent/apps/<slug>/CONTEXT.md` before changing an app. To persist a
decision, learning, rule, or notable change, invoke the **`remember`** skill
(it classifies + writes + indexes). Obey the Standing rules below.

## Standing rules

- Never edit `_template` to build a vendor — scaffold a copy (see golden-path rule).
- Extend `core/`, never fork it per vendor.
- Never commit `.env` or secrets (and never write secrets into context files).
- Run `pnpm verify` and satisfy the Definition of Done before claiming work complete.
- Record notable features/fixes in the app's `CONTEXT.md` change journal via `remember`.

## State

- [`docs/agent/FEATURES.md`](./docs/agent/FEATURES.md) — registry of capabilities + lifecycle status.
- [`docs/agent/PROGRESS.md`](./docs/agent/PROGRESS.md) — in-flight multi-session work only.
- `docs/agent/apps/<slug>/CONTEXT.md` — per-app standing context + change journal.
- `docs/agent/apps/<slug>/STATE.json` — one build's lifecycle state (see `STATE.schema.md`).

## Verification / feedback loop

`pnpm verify` = `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`
(blocks on first failure) — the single command that proves work is green.

**Definition of Done** — work is not done until:
1. `pnpm verify` is green;
2. the change is recorded in the relevant change journal (feature context / definition-of-fix), notable changes only;
3. `FEATURES.md` status is updated if a capability's lifecycle changed;
4. any durable learning/decision is saved via `remember`.
```

- [ ] **Step 2: Point `code-reviewer` at `pnpm verify`**

In `.agents/skills/code-reviewer/SKILL.md`, immediately after the block listing the run-in-order commands (`pnpm -r lint` / `typecheck` / `test` / `build`), add this exact line (do not remove the existing per-command list — the skill documents the ordering rationale):

```markdown
> These four are equivalent to the single `pnpm verify` command — run that, then confirm the Definition of Done in `AGENTS.md` holds (journal updated, FEATURES status current, learnings saved via `remember`).
```

- [ ] **Step 3: Verify AGENTS.md is still lean and renders**

Run: `wc -l AGENTS.md`
Expected: ~125–130 lines (was 102). If it feels heavy, apply the spec §8 option: move the verbose "Add a new app (the recipe)" detail into `docs/agent/README.md` and leave a one-line pointer (optional).

Run: `grep -n "pnpm verify\|Standing rules\|remember" AGENTS.md`
Expected: matches in the new sections.

---

### Task 6: Document the additions in the agent README

**Files:**
- Modify: `docs/agent/README.md` (add a short "Durable context, state & feedback" section)

- [ ] **Step 1: Append the section**

Add after the "Context retention" section:

```markdown
## Durable context, state & feedback (cross-session)

Beyond a single build's `STATE.json`, the repo carries durable, shared context so
any future session inherits it:

- **`docs/agent/context/`** — `INDEX.md` (the map), `decisions/` (ADRs),
  `learnings.md` (gotchas), `CHANGELOG.md` (repo-level change journal).
- **`docs/agent/FEATURES.md`** — registry of capabilities + lifecycle status.
- **`docs/agent/PROGRESS.md`** — in-flight multi-session work (ephemeral).
- **`docs/agent/apps/<slug>/CONTEXT.md`** — per-app standing context + change journal.
- **`remember` skill** — the single writer; classifies an entry and updates the index.
- **`pnpm verify`** — the feedback loop (`lint → typecheck → test → build`); see the
  Definition of Done in `AGENTS.md`.

Save context any time with the `remember` skill ("save this to context"). Read
`context/INDEX.md` + the relevant `CONTEXT.md` before non-trivial work.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Durable context" docs/agent/README.md`
Expected: one match.

---

### Task 7: Final verification (Definition of Done for this plan)

**Files:** none (verification only)

- [ ] **Step 1: Run the full feedback loop**

Run: `pnpm verify`
Expected: green (lint → typecheck → test → build all pass; 182 tests). The harness upgrade is docs/config only, so the application suite is unaffected.

- [ ] **Step 2: Confirm acceptance criteria from the spec**

Run:
```
ls docs/agent/context/{INDEX.md,learnings.md,CHANGELOG.md} docs/agent/context/decisions/*.md docs/agent/{FEATURES.md,PROGRESS.md} docs/agent/apps/google/CONTEXT.md .agents/skills/remember/SKILL.md
grep -q "pnpm verify" AGENTS.md && echo "AGENTS verify OK"
grep -q "Standing rules" AGENTS.md && echo "AGENTS rules OK"
test -L .claude/skills && echo "skills symlink OK"
```
Expected: every path lists; all three `echo` lines print.

- [ ] **Step 3: Scan for accidental secrets in new files**

Run: `grep -rnE "CLIENT_SECRET|ENCRYPTION_KEY|private_key|Bearer [A-Za-z0-9]" docs/agent .agents/skills/remember || echo "no secrets"`
Expected: `no secrets`.

- [ ] **Step 4: (If git is later initialized) commit**

`git add -A && git commit -m "feat(agent): add durable context store, repo state, and verify feedback loop"` — only when a git repo exists; otherwise skip (the harness has no `.git` today).

---

## Self-review notes (author)

- **Spec coverage:** §4 layout → Tasks 2–4; §5 remember skill → Task 3; §6 state (FEATURES/PROGRESS/CONTEXT journal) → Tasks 2 & 4; §7 feedback (`pnpm verify` + DoD) → Tasks 1 & 5; §8 AGENTS.md edits → Task 5; §9 seed data → Tasks 2 & 4; README → Task 6; §10 acceptance → Task 7. No gaps.
- **No commits assumed** (no `.git`); each task ends with a verification step. Task 7 Step 4 is the optional future commit.
- **Type/name consistency:** file paths and the `remember` entry shapes match the spec; ADR filenames in `INDEX.md` (Task 2) match the files created in Task 4.
