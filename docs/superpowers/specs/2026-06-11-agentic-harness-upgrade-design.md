# Agentic Harness Upgrade — Design Spec

**Date:** 2026-06-11
**Status:** Implemented 2026-06-11
**Author:** Claude (brainstormed with repo owner)

## 1. Problem

This monorepo is an agent-native boilerplate, but its "harness" (everything
outside the model that determines how much capability is realized) has gaps when
measured against the five-subsystem model (Instructions, Tools, Environment,
**State**, **Feedback**) from harness-engineering practice:

- **Durable cross-session context is missing.** There is no place for "things
  every future session must know." `docs/agent/apps/<slug>/STATE.json` exists but
  is scoped to a single vendor *build's lifecycle* — it does not carry decisions,
  learnings, working rules, or the context of changes/fixes made after a build.
  Claude Code's local per-user memory dir is **not in the repo and not shared**,
  so it cannot serve teammates or future sessions working from the repo.
- **No repo-level state.** Beyond one build's `STATE.json`, there is no registry
  of what capabilities exist, and no durable record of the *context of each
  change* — when a feature is added or a bug fixed, the "what/why" and the
  "definition of the fix" are lost once the session ends.
- **Feedback loop is implicit.** Verification commands (lint/typecheck/test/build)
  exist and are run by the `code-reviewer` skill, but they are not enumerated as a
  first-class, single-command feedback loop in `AGENTS.md`, and there is no
  explicit Definition of Done.

**Goal:** make the repo itself the durable system of record — so any Claude (or
other agent) session inherits decisions, learnings, rules, and per-feature
history, can see and update feature/change state, and has an explicit feedback
loop to verify work before declaring it done.

## 2. Scope

In scope (one cohesive harness upgrade):
1. A durable **context store** + a `remember` skill to write to it.
2. Repo-level **state**: a feature registry, an in-flight progress log, and a
   per-app/repo **change journal** capturing the context of features/fixes.
3. An explicit **feedback loop**: a single `pnpm verify` command + a Definition
   of Done, documented in `AGENTS.md`.
4. Targeted **`AGENTS.md` edits** to wire all of the above in (kept lean).

Out of scope (YAGNI):
- No auto-state-updating loop (verify does not auto-write state).
- No separate `recall` skill (recall is a documented convention).
- No index-generation tooling (the `remember` skill maintains `INDEX.md` by hand).
- No unrelated refactoring of existing modules.

## 3. The five-subsystem audit (current → action)

| Subsystem | Today | Action |
|---|---|---|
| Instructions | `AGENTS.md` (102 lines) + `ARCHITECTURE.md` + `docs/agent/README.md` ✅ | Add 3 lean pointer sections (Context, State, Verification) + inline Standing Rules + Definition of Done |
| Tools | pnpm scripts + MCP servers ✅ | none |
| Environment | pnpm workspaces, lockfile, Docker, `.nvmrc`=22, `engines` ✅ | none |
| **State** | per-build `STATE.json` only ⚠️ | add `FEATURES.md`, `PROGRESS.md`, per-app `CONTEXT.md` change journal, repo `CHANGELOG.md` |
| **Feedback** | commands run ad-hoc / inside `code-reviewer` ⚠️ | add `pnpm verify` + Definition of Done; point `code-reviewer` at it |
| **Durable context** | missing ❌ | add `docs/agent/context/` + `remember` skill |

## 4. File layout (all committed)

```
docs/agent/
  context/
    INDEX.md             # the "map": one-line hooks → links; read on demand
    decisions/
      NNNN-<kebab>.md     # one ADR per decision (append-only): context, decision, rationale, consequences
    learnings.md          # cross-cutting gotchas as dated bullets
    CHANGELOG.md          # repo-level change journal (harness / shared / cross-cutting changes)
  FEATURES.md             # registry: capability | status | link to CONTEXT.md | notes
  PROGRESS.md             # in-flight multi-session work ONLY (ephemeral; archived when done)
  apps/<slug>/
    CONTEXT.md            # NEW — per-app living context (standing context + dated change journal)
    PRD.md TRD.md TDD.md STATE.json   # (existing per-build files)
.agents/skills/remember/
  SKILL.md                # the remember skill (symlinked into .claude/skills/ like the others)
```

Notes:
- **Working rules / preferences** (a requested context type) are NOT a file —
  they live **inline in `AGENTS.md`** under "Standing rules", because rules must
  always be in-context, not read on demand.
- `docs/agent/apps/<slug>/` is already committed (per `STATE.schema.md`), so
  `CONTEXT.md` sits naturally beside the build's other docs.

## 5. Component: durable context store + `remember` skill

### 5.1 Entry types and destinations

| Type | Destination | Shape |
|---|---|---|
| **decision** (ADR) | `docs/agent/context/decisions/NNNN-<kebab>.md` | Title, date, status, **Context**, **Decision**, **Rationale**, **Consequences** |
| **learning / gotcha** | `docs/agent/context/learnings.md` | Dated bullet: the non-obvious fact + why it matters (1–3 lines) |
| **rule / preference** | `AGENTS.md` → "Standing rules" list | One imperative line + (optional) the why |
| **per-app feature/fix/change** | `docs/agent/apps/<slug>/CONTEXT.md` → change journal | See §6.3 entry shape |
| **repo-level change** | `docs/agent/context/CHANGELOG.md` | Same entry shape as §6.3, for non-app-scoped changes |

After any write, the skill updates `docs/agent/context/INDEX.md` (adds/refreshes
a one-line hook + relative link) so the index stays the navigable map.

### 5.2 The `remember` skill (`.agents/skills/remember/SKILL.md`)

- **User-invocable**, idiomatic to this repo's skills library; symlinked into
  `.claude/skills/` exactly like the existing skills.
- **Triggers:** the user says "save this to context" / "remember this" / "record
  this decision/fix", OR the agent proactively recognizes a durable fact worth
  persisting (and confirms briefly).
- **Behavior:**
  1. Classify the entry into one of the types in §5.1 (ask only if genuinely
     ambiguous).
  2. Determine scope: global vs a specific `<slug>` (infer from the work; confirm
     if unclear).
  3. Write a correctly-formatted, **dated** entry to the destination.
  4. Update `INDEX.md`.
  5. Report what was written and where (one line).
- **Numbering:** ADRs use zero-padded sequential numbers (`0001`, `0002`, …);
  the skill scans `decisions/` for the next number.
- **No secrets** are ever written to context files (same rule as `.env`).

### 5.3 Inheritance (recall — a convention, not a skill)

`AGENTS.md` instructs every session: before non-trivial work, skim
`docs/agent/context/INDEX.md` and the relevant `docs/agent/apps/<slug>/CONTEXT.md`,
and obey the inline Standing rules. Detail files are read on demand (Map over
Manual). No auto-recall hook (kept simple).

## 6. Component: repo-level state

### 6.1 `FEATURES.md` (registry / catalog)

A single table — the high-level "what exists and where to read its context":

| Capability | Slug | Status | Context | Notes |
|---|---|---|---|---|
| Google (GA4 + Ads + GMC) | `google` | built · local-tested | `apps/google/CONTEXT.md` | not yet PR'd/deployed |
| Golden template | `_template` | golden source (not shipped) | — | scaffolder copy source; excluded from run/workspace |

`Status` is a short free-text lifecycle label (e.g. `building`, `built`,
`local-tested`, `pr-open`, `deployed`, `golden source`). Updated when a
capability's status changes.

### 6.2 `PROGRESS.md` (in-flight only)

The lecture's State subsystem for *current* multi-session work: **Active task**,
**Done**, **Blockers**, **Next step**. Ephemeral — when the work completes, its
durable summary is moved into the relevant change journal (§6.3) and `PROGRESS.md`
is cleared/archived. This is distinct from per-build `STATE.json` (which is the
build-lifecycle state machine for one vendor app).

### 6.3 Change journal (in per-app `CONTEXT.md` / repo `CHANGELOG.md`)

`docs/agent/apps/<slug>/CONTEXT.md` has two sections:

1. **Standing context** — durable decisions, gotchas, "things to know before
   touching this app."
2. **Change journal** — append-only, newest-first, dated entries. **Notable
   changes only** (features, real bug fixes with a definition-of-fix, behavior /
   contract changes). Skip trivia (typos, formatting, dep bumps).

Entry shape:
```
### YYYY-MM-DD — <type: feature|fix|change> — <short title>
- **What:** <what was added/changed/broken>
- **Why:** <motivation / root cause>
- **Definition of done / fix:** <what was actually done that makes it complete/fixed>
- **Files:** <key paths touched>
- **Links:** <ADR / PR / related learning, if any>
```

Repo-level changes (harness, shared, cross-cutting — not tied to one app) use the
same entry shape in `docs/agent/context/CHANGELOG.md`.

## 7. Component: feedback loop

- **`pnpm verify`** (root `package.json`):
  `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` — runs in
  order, blocks on first failure. The single command for "is my work green?".
- **`AGENTS.md` → "Verification / feedback loop"** section enumerates `pnpm
  verify` and what it covers.
- **Definition of Done** (canonical list lives in `AGENTS.md` — this spec is a
  historical snapshot; AGENTS.md is authoritative): work is not done until —
  1. `pnpm verify` is green;
  2. the change is recorded in the relevant change journal (feature context or
     definition-of-fix), notable changes only;
  3. `FEATURES.md` status is updated if a capability's lifecycle changed;
  4. any durable learning/decision discovered is saved via `remember`;
  5. `PROGRESS.md` is cleared if the work was tracked there as in-flight.
- **`code-reviewer` skill** is updated to invoke `pnpm verify` (it already runs
  the same four commands) and to check the Definition of Done items.

## 8. `AGENTS.md` edits (kept lean — pointers, not prose)

Add (~25 lines total):
- **## Context & decisions** — 3–4 lines: where durable context lives
  (`docs/agent/context/INDEX.md`), the recall convention (skim INDEX + app
  `CONTEXT.md` before non-trivial work), and how to save (`remember` skill).
- **## Standing rules** — the inline rules list (seeded with existing implicit
  rules: never edit `_template` to build a vendor, never commit secrets, extend
  `core/` don't fork, run `pnpm verify` before claiming done). Grows via
  `remember`.
- **## State** — 3 lines: `FEATURES.md` (registry), `PROGRESS.md` (in-flight),
  per-app `CONTEXT.md` change journal; pointer to `STATE.schema.md` for the
  per-build file.
- **## Verification / feedback loop** — the `pnpm verify` command + the
  Definition of Done checklist.

**Lean-keeping option (flagged, optional):** `AGENTS.md` is at 102 lines; the
verbose "Add a new app (the recipe)" block largely duplicates `docs/agent/README.md`.
If the additions push it uncomfortably past ~100, relocate that block's detail to
`docs/agent/README.md` and leave a one-line pointer. Decide during implementation.

## 9. Seed data (created with the change)

- `FEATURES.md` — seeded with `google` and `_template` rows (§6.1).
- `apps/google/CONTEXT.md` — back-filled standing context + change-journal entries
  from this session's work: webhook event-string format is slash-form (TRD R1,
  unverified against live); Ratio prices are integer **paise**; Web Pixels API is
  Draft → registration degrades to `pending_api`; `_template` excluded from
  run/workspace (source kept for scaffolder); backend `.env` symlink → root
  `.env`; `emptyAsUndefined` for optional Google-OAuth env keys; dummy
  `dev-merchant` seed for local testing.
- `docs/agent/context/decisions/` — initial ADRs:
  - `0001-multi-handler-webhook-dispatch.md` (generic, backward-compatible core
    change enabling N webhook topics per module).
  - `0002-template-excluded-from-run-and-workspace.md` (source kept on disk for
    the scaffolder; removed from APPS/app.module/workspace).
- `docs/agent/context/learnings.md`, `CHANGELOG.md`, `INDEX.md`, `PROGRESS.md` —
  created with initial content / headers.

## 10. Acceptance criteria

- [ ] `docs/agent/context/{INDEX.md, learnings.md, CHANGELOG.md, decisions/}`,
      `docs/agent/FEATURES.md`, `docs/agent/PROGRESS.md` exist and are committed.
- [ ] `.agents/skills/remember/SKILL.md` exists and is symlinked into
      `.claude/skills/remember`; it classifies + writes all five entry types and
      updates `INDEX.md`.
- [ ] `apps/google/CONTEXT.md` exists with standing context + ≥3 back-filled
      change-journal entries; `FEATURES.md` lists `google` + `_template`.
- [ ] `pnpm verify` exists and runs `lint → typecheck → test → build`, blocking
      on first failure.
- [ ] `AGENTS.md` has the four new sections (Context, Standing rules, State,
      Verification) as lean pointers + a Definition of Done; `code-reviewer`
      references `pnpm verify`.
- [ ] `docs/agent/README.md` documents the context/state/feedback additions.
- [ ] `pnpm verify` is green after the change (the upgrade does not break the
      existing 182-test suite).
- [ ] No secrets in any new file.

## 11. Risks / notes

- **AGENTS.md bloat** — mitigated by pointer-style additions + the optional
  recipe relocation (§8).
- **Journal noise** — mitigated by "notable changes only" granularity (§6.3).
- **Index drift** — the `remember` skill is the single writer that keeps
  `INDEX.md` in sync; manual edits should go through it.
- **Overlap with per-build `STATE.json`** — kept distinct: `STATE.json` = one
  build's lifecycle state machine; `FEATURES.md`/`PROGRESS.md`/`CONTEXT.md` =
  repo-level catalog, in-flight work, and durable per-app history.
