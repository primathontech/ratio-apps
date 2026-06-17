# Repo-Native Change Workflow — Design Spec

**Date:** 2026-06-11
**Status:** Implemented 2026-06-11
**Author:** Claude (brainstormed with repo owner)

## 1. Problem

The repo has a strong *specialized* orchestrator — `build-app` — for creating a
**new vendor app** (PRD → TRD → TDD → scaffold → build → review → PR → deploy).
But there is **no repo-native flow for ordinary changes**: a feature inside an
existing app, a bug fix, a cross-cutting refactor, a PR. Today that rigor only
exists by invoking the external `superpowers` plugin (brainstorming →
writing-plans → subagent-driven/executing-plans) every time.

**Goal:** make the repo "already work like that" — bake a brainstorm → spec →
plan → execute flow into the repo's own skills so any feature/bug/PR follows it
without invoking superpowers, and so it integrates with the harness we just built
(`remember`, context store, `FEATURES.md`/`PROGRESS.md`, `pnpm verify` + Definition
of Done).

## 2. Scope

In scope:
1. Three standalone, chained skills under `.agents/skills/`: **`brainstorm`**,
   **`write-plan`**, **`execute`**.
2. A per-change artifact convention: `docs/agent/changes/<slug>/SPEC.md` + `PLAN.md`.
3. Two approval gates (spec, plan); `execute` asks subagent-driven vs inline.
4. Harness integration: `pnpm verify` + Definition of Done, `remember`,
   `PROGRESS.md`, `FEATURES.md`.
5. An `AGENTS.md` routing line + a `docs/agent/README.md` note so the flow is
   discoverable and is the default for any non-vendor-app change.

Out of scope (YAGNI):
- No orchestrator skill (the owner chose standalone, chained skills).
- No per-change `STATE.json` (SPEC + PLAN checkboxes + `PROGRESS.md` suffice).
- No separate "bug track" (scalable depth in one flow covers trivial → large).
- No dependency on the external `superpowers` plugin — the skills are self-contained.
- `build-app` is unchanged; it remains the specialized new-vendor flow.

## 3. The flow at a glance

```
(any feature / bug / PR that is NOT a whole new vendor app)
   │
   ├─ brainstorm ──► docs/agent/changes/<slug>/SPEC.md
   │     ▼  [GATE 1: spec sign-off]
   ├─ write-plan ──► docs/agent/changes/<slug>/PLAN.md  (checkbox TDD tasks)
   │     ▼  [GATE 2: plan sign-off]
   └─ execute ────► asks subagent-driven | inline → code → Definition of Done
```

A **new vendor app** still routes to `build-app`. The two are disambiguated in
`AGENTS.md` (§7).

## 4. Skill: `brainstorm`

**File:** `.agents/skills/brainstorm/SKILL.md`
**Frontmatter:** `name: brainstorm`; user-invocable; `description` + `when_to_use`
matching the house convention (see existing skills).

**Purpose:** turn a feature/bug/PR idea into an approved `SPEC.md`, scaled to size.

**Steps (the skill body documents these):**
1. **Inherit context first.** Read `AGENTS.md` (Standing rules), `docs/agent/context/INDEX.md`,
   the relevant app's `docs/agent/apps/<slug>/CONTEXT.md`, and the code in
   question. Surface any prior decisions/learnings that constrain the change.
2. **Derive a `<slug>`** — kebab-case from the change title
   (`fix-gmc-paise-rounding`, `add-orders-webhook`). Validate `^[a-z0-9-]+$`.
3. **Assess size.** If trivial, the spec will be a few lines; if a feature, full
   sections. State the assessed size up front.
4. **Clarify** — ask questions **one at a time**, only where genuinely unclear
   (purpose, constraints, success criteria). For a **bug**: reproduce it and
   identify the root cause before proposing a fix.
5. **Propose approach(es)** scaled to size (1 for trivial; 2–3 with a
   recommendation for a feature).
6. **Write** `docs/agent/changes/<slug>/SPEC.md` (template in §8). Self-review for
   placeholders/ambiguity.
7. **GATE 1 — spec sign-off.** Present the spec; ask for explicit approval. On
   approval, hand off: "invoke the `write-plan` skill." Do NOT write a plan or
   code here.

**HARD rule:** no code, no plan until the spec is approved (mirrors the
brainstorming hard-gate).

## 5. Skill: `write-plan`

**File:** `.agents/skills/write-plan/SKILL.md`

**Purpose:** turn the approved `SPEC.md` into a `PLAN.md` of bite-sized, TDD,
checkbox tasks — scaled to size.

**Steps:**
1. Read `docs/agent/changes/<slug>/SPEC.md`.
2. Map the exact files to create/modify (one responsibility each; follow existing
   patterns and the `core/` boundary).
3. Write `docs/agent/changes/<slug>/PLAN.md` (template in §8): each task has exact
   file paths and **bite-sized steps** — write failing test → run it (expect
   fail) → minimal implementation → run test (expect pass) → **`pnpm verify`**.
   A trivial change is one task. No placeholders (complete code/commands in every
   step). Commits only if a `.git` exists (note: today it does not).
4. Self-review: every SPEC requirement maps to a task; no placeholders;
   type/name consistency across tasks.
5. **GATE 2 — plan sign-off.** Present the plan; ask for explicit approval. On
   approval, hand off: "invoke the `execute` skill."

## 6. Skill: `execute`

**File:** `.agents/skills/execute/SKILL.md`

**Purpose:** implement the approved `PLAN.md` and finish at the Definition of Done.

**Steps:**
1. Mark the change **active** in `docs/agent/PROGRESS.md` (active task / next step).
2. **Ask execution mode** — subagent-driven vs inline:
   - **Subagent-driven:** a fresh subagent per task with the full task text; a
     review between tasks (spec compliance, then quality); continuous (no
     check-in between tasks). Right-size review to change size.
   - **Inline:** execute tasks in this session in batches with checkpoints for
     review.
3. Each task follows **TDD** and ends green via **`pnpm verify`** (or the
   targeted test during iteration, full `pnpm verify` before done).
4. **Definition of Done** (from `AGENTS.md`) — not done until:
   a. `pnpm verify` is green;
   b. the change is recorded via the **`remember`** skill — a per-app
      `CONTEXT.md` change-journal entry (feature context / definition-of-fix) or a
      repo `CHANGELOG.md` entry; notable changes only;
   c. `FEATURES.md` status updated if a capability's lifecycle changed;
   d. any durable learning/decision saved via `remember`;
   e. `PROGRESS.md` cleared (work no longer in flight).
5. Report what shipped + where the journal entry landed.

## 7. Discoverability — making the repo default to this

**`AGENTS.md`** gains one routing line (in the "Context & decisions" / "Standing
rules" area — keep it lean):

> **Making a change:** a *new vendor app* → the `build-app` skill. *Any other
> feature / bug / PR* → start with the **`brainstorm`** skill (it chains
> `brainstorm → write-plan → execute`, scales to size, and ends at the Definition
> of Done). Do not write code for a non-trivial change before its spec + plan are
> approved.

**`docs/agent/README.md`** gains a short "Making a change (any feature/bug/PR)"
section documenting the trio + the two gates + the artifact location.

## 8. Templates (embedded in the skills)

**`SPEC.md`** (scaled — omit empty sections for trivial changes):
```
# <Change title> — spec
- **Slug:** <slug>   **Type:** feature | fix | refactor   **Size:** trivial | small | feature
- **Area:** <app slug / backend / shared / admin / docs>

## Problem / goal
<what + why; for a bug: the observed behavior + root cause>

## Approach
<the chosen approach; alternatives rejected for a feature>

## Acceptance criteria
- [ ] <concrete, checkable>
- [ ] `pnpm verify` is green

## Out of scope
<bounds>

## Context consulted
<relevant ADRs / learnings / app CONTEXT.md entries>
```

**`PLAN.md`** header + task shape:
```
# <Change title> — implementation plan
**Goal:** <one sentence>   **Spec:** docs/agent/changes/<slug>/SPEC.md
**Execution:** invoke the `execute` skill (asks subagent-driven vs inline).

### Task N: <name>
**Files:** Create/Modify/Test: <exact paths>
- [ ] Write the failing test (show the test code)
- [ ] Run it — expect FAIL (<command>)
- [ ] Minimal implementation (show the code)
- [ ] Run it — expect PASS (<command>)
- [ ] `pnpm verify`
```

## 9. Relationship to existing skills

- **`build-app`** — unchanged; specialized new-vendor orchestrator. The new flow
  explicitly excludes "new vendor app" and routes it to `build-app`.
- **`remember`, `house-conventions`, `stack-patterns`, `context-keeper`** —
  consulted by the new skills (context, conventions, patterns) — not duplicated.
- The new skills follow the same SKILL.md frontmatter convention and are
  auto-discovered via the existing `.claude/skills → ../.agents/skills` symlink.

## 10. Acceptance criteria

- [ ] `.agents/skills/{brainstorm,write-plan,execute}/SKILL.md` exist with valid
      house-style frontmatter and are discoverable under `.claude/skills/`.
- [ ] `brainstorm` writes `docs/agent/changes/<slug>/SPEC.md`, inherits context,
      asks one-at-a-time clarifying questions, and stops at GATE 1.
- [ ] `write-plan` writes `docs/agent/changes/<slug>/PLAN.md` with bite-sized TDD
      checkbox tasks and stops at GATE 2.
- [ ] `execute` asks subagent vs inline, runs TDD + `pnpm verify`, and enforces
      the Definition of Done (verify green · `remember` entry · `FEATURES`/`PROGRESS`
      updated).
- [ ] `AGENTS.md` has the routing line; `docs/agent/README.md` documents the flow.
- [ ] The flow is self-contained — no skill references the external superpowers
      plugin.
- [ ] `pnpm verify` is green after the change (skills are docs; the suite is
      unaffected).
- [ ] The addition is itself recorded via `remember` (repo `CHANGELOG.md`).

## 11. Risks / notes

- **Ceremony for tiny fixes** — mitigated by scalable depth (a trivial spec is a
  few lines, plan is one task); the skills explicitly say "scale to size."
- **Two flows could confuse** (`build-app` vs `brainstorm`) — mitigated by the
  one-line router in `AGENTS.md` (new vendor app vs everything else).
- **AGENTS.md length** — the router is one line; the README carries detail
  (Map-over-Manual).
- **No git today** — plans/execute must not assume commits; they end at `pnpm
  verify` + the journal entry. (When git exists, tasks may add commits.)
- **Drift with superpowers** — intentional: these are inspired by but independent
  of superpowers, so the repo is self-sufficient.
