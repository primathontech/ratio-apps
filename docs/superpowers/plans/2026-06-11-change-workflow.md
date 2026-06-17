# Repo-Native Change Workflow — Implementation Plan

> **For agentic workers:** implement this plan with the repo's `execute` skill (it asks subagent-driven vs inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three standalone, chained repo skills — `brainstorm → write-plan → execute` — so any feature/bug/PR follows brainstorm → spec → plan → code natively, integrated with the harness, without invoking superpowers.

**Architecture:** Pure markdown. Three `SKILL.md` files under `.agents/skills/` (auto-exposed via the `.claude/skills → ../.agents/skills` symlink), each with house-style frontmatter (`name`/`description`/`when_to_use`) + a body documenting its steps and gate. Per-change artifacts live in `docs/agent/changes/<slug>/{SPEC.md,PLAN.md}`. A one-line router in `AGENTS.md` + a `docs/agent/README.md` section make the flow the default.

**Tech Stack:** Markdown skills, the repo's existing skill convention, the just-built harness (`pnpm verify`, `remember`, `FEATURES.md`/`PROGRESS.md`).

**Environment note:** No `.git` in this repo. Tasks end with a **verification** step, not a commit.

**Spec:** `docs/superpowers/specs/2026-06-11-change-workflow-design.md`

---

### Task 1: `brainstorm` skill

**Files:**
- Create: `.agents/skills/brainstorm/SKILL.md`

- [ ] **Step 1: Create the file with exactly this content**

```markdown
---
name: brainstorm
description: Turn a feature/bug/PR idea into an approved, written spec for this repo. Inherits repo context, asks clarifying questions one at a time, proposes an approach scaled to the change size, and writes docs/agent/changes/<slug>/SPEC.md — then STOPS at GATE 1 (spec sign-off). The first step of the repo's change workflow (brainstorm → write-plan → execute). Not for creating a whole new vendor app (use build-app for that).
when_to_use: Use at the start of ANY feature, bug fix, refactor, or PR that is not a brand-new vendor app. Begin here before writing code. For a new vendor app, use build-app instead.
---

# brainstorm

Turn an idea or bug into an approved `SPEC.md`. No plan, no code until GATE 1.

## 1. Inherit context first
Read, in order: `AGENTS.md` (Standing rules), `docs/agent/context/INDEX.md` (+ any
linked decision/learning that touches this area), and — if the change touches an
app — `docs/agent/apps/<slug>/CONTEXT.md`. Read the code in question. Note any
prior decision/learning that constrains the change.

## 2. Derive the slug
Kebab-case from the change title (e.g. `fix-gmc-paise-rounding`,
`add-orders-webhook`). Must match `^[a-z0-9-]+$`. This names
`docs/agent/changes/<slug>/`.

## 3. Assess size
State it up front: **trivial** | **small** | **feature**. The spec scales to this
— a trivial change is a few lines; a feature gets full sections. Do not pad a
trivial change with ceremony.

## 4. Clarify (one question at a time)
Ask only what is genuinely unclear — purpose, constraints, success criteria.
Prefer multiple-choice. For a **bug**: reproduce it and identify the root cause
BEFORE proposing a fix (a fix without a confirmed root cause is a guess).

## 5. Propose approach
Trivial → one approach. Feature → 2–3 with a recommendation and why.

## 6. Write the spec
Create `docs/agent/changes/<slug>/SPEC.md` from this shape (omit empty sections
for trivial changes):

\```
# <Change title> — spec
- **Slug:** <slug>   **Type:** feature | fix | refactor   **Size:** trivial | small | feature
- **Area:** <app slug / backend / shared / admin / docs>

## Problem / goal
<what + why; for a bug: observed behavior + confirmed root cause>

## Approach
<the chosen approach; alternatives rejected for a feature>

## Acceptance criteria
- [ ] <concrete, checkable>
- [ ] `pnpm verify` is green

## Out of scope
<bounds>

## Context consulted
<relevant ADRs / learnings / app CONTEXT.md entries>
\```

Self-review the spec: no placeholders, no ambiguity, scope is one plan's worth.

## 7. GATE 1 — spec sign-off
Present the spec; ask for explicit approval. Do NOT write a plan or code here.
On approval, hand off: "Spec approved — invoke the `write-plan` skill." If
changes are requested, revise and re-present.
```

> **NOTE for the implementer:** the `\``` sequences inside the skill body above
> represent real triple-backtick fences (the SPEC template) — write them as plain
> ``` ``` ``` in the actual `SKILL.md`, not as `\``` `.

- [ ] **Step 2: Verify it is discoverable + frontmatter parses**

Run: `head -5 .claude/skills/brainstorm/SKILL.md`
Expected: prints the frontmatter starting `---` / `name: brainstorm` (proves the symlink resolves the new skill).

---

### Task 2: `write-plan` skill

**Files:**
- Create: `.agents/skills/write-plan/SKILL.md`

- [ ] **Step 1: Create the file with exactly this content**

```markdown
---
name: write-plan
description: Turn an approved SPEC.md into a PLAN.md of bite-sized, test-driven, checkbox tasks with exact file paths — scaled to the change size — then STOP at GATE 2 (plan sign-off). The second step of the repo's change workflow (brainstorm → write-plan → execute).
when_to_use: Use after a change's SPEC.md (docs/agent/changes/<slug>/SPEC.md) has been approved at GATE 1, to produce the implementation plan before any code is written.
---

# write-plan

Turn the approved `SPEC.md` into a `PLAN.md` of TDD tasks. No code until GATE 2.

## 1. Read the spec
Read `docs/agent/changes/<slug>/SPEC.md`. If it is not approved, stop and route
back to `brainstorm`.

## 2. Map the files
List the exact files to create/modify, each with one responsibility. Follow
existing patterns and the `core/` boundary (extend core, never fork it). For a
trivial change this is one or two files.

## 3. Write the plan
Create `docs/agent/changes/<slug>/PLAN.md`:

\```
# <Change title> — implementation plan
**Goal:** <one sentence>
**Spec:** docs/agent/changes/<slug>/SPEC.md
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).

### Task N: <name>
**Files:** Create/Modify/Test: <exact paths>
- [ ] Write the failing test (show the test code)
- [ ] Run it — expect FAIL (<exact command>)
- [ ] Minimal implementation (show the code)
- [ ] Run it — expect PASS (<exact command>)
- [ ] Run `pnpm verify` (or the targeted test while iterating)
\```

Rules: bite-sized steps (one action each); **complete code/commands in every
step** (no "TBD", no "handle edge cases", no "similar to Task N"); exact paths;
scale to size (a trivial change is ONE task). Commits only if a `.git` exists
(today it does not — end tasks at `pnpm verify`).

## 4. Self-review
Every SPEC acceptance criterion maps to a task; no placeholders; names/types are
consistent across tasks.

## 5. GATE 2 — plan sign-off
Present the plan; ask for explicit approval. On approval, hand off: "Plan
approved — invoke the `execute` skill." If changes are requested, revise and
re-present.
```

> **NOTE for the implementer:** the `\``` sequences inside the skill body above
> represent real triple-backtick fences (the PLAN template) — write them as plain
> ``` ``` ``` in the actual `SKILL.md`, not as `\``` `.

- [ ] **Step 2: Verify discoverable**

Run: `head -5 .claude/skills/write-plan/SKILL.md`
Expected: frontmatter prints (`name: write-plan`).

---

### Task 3: `execute` skill

**Files:**
- Create: `.agents/skills/execute/SKILL.md`

- [ ] **Step 1: Create the file with exactly this content**

```markdown
---
name: execute
description: Implement an approved PLAN.md and finish at the repo's Definition of Done. Asks subagent-driven vs inline execution, runs each task test-first ending green via `pnpm verify`, then records the change via the `remember` skill and updates state. The third step of the repo's change workflow (brainstorm → write-plan → execute).
when_to_use: Use after a change's PLAN.md (docs/agent/changes/<slug>/PLAN.md) has been approved at GATE 2, to implement it and complete the Definition of Done.
---

# execute

Implement the approved `PLAN.md`. Test-first. End at the Definition of Done.

## 1. Mark in-flight
Set the change as the Active task in `docs/agent/PROGRESS.md` (active task + next
step), so the work is resumable across sessions.

## 2. Ask execution mode
Ask the user: **subagent-driven** or **inline**?
- **Subagent-driven (recommended for multi-task plans):** dispatch a fresh
  subagent per task with the full task text (do not make it read the plan file);
  review between tasks (spec compliance, then quality), right-sized to the change;
  run continuously (no "should I continue?" between tasks). Never run two
  implementation subagents in parallel.
- **Inline:** execute the tasks in this session in batches, pausing at sensible
  checkpoints for review.

## 3. Implement test-first
Each task: write the failing test → see it fail → minimal implementation → see it
pass. Iterate with the targeted test; run the full `pnpm verify` before declaring
the task done.

## 4. Definition of Done (from AGENTS.md) — not done until ALL hold
1. `pnpm verify` is green (lint → typecheck → test → build).
2. The change is recorded via the **`remember`** skill — a per-app
   `docs/agent/apps/<slug>/CONTEXT.md` change-journal entry (feature context, or
   the definition-of-fix for a bug) or a repo `docs/agent/context/CHANGELOG.md`
   entry. Notable changes only.
3. `docs/agent/FEATURES.md` status is updated if a capability's lifecycle changed.
4. Any durable learning/decision discovered is saved via `remember`.
5. `docs/agent/PROGRESS.md` is cleared (work no longer in flight).

## 5. Report
One short summary: what shipped, `pnpm verify` result, and where the journal
entry landed.
```

- [ ] **Step 2: Verify discoverable**

Run: `head -5 .claude/skills/execute/SKILL.md`
Expected: frontmatter prints (`name: execute`).

---

### Task 4: AGENTS.md router line

**Files:**
- Modify: `AGENTS.md` (inside the "## Context & decisions (read before non-trivial work)" section added by the harness upgrade)

- [ ] **Step 1: Append the router paragraph**

In `AGENTS.md`, at the END of the "## Context & decisions (read before non-trivial work)" section (immediately before the "## Standing rules" heading), insert exactly:

```markdown
**Making a change:** a *new vendor app* → the `build-app` skill. *Any other
feature / bug / PR* → start with the **`brainstorm`** skill (it chains
`brainstorm → write-plan → execute`, scales to size, and ends at the Definition
of Done). Do not write code for a non-trivial change before its spec + plan are
approved.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Making a change" AGENTS.md`
Expected: exactly 1 match, located before the "## Standing rules" heading (confirm with `grep -n "Standing rules" AGENTS.md` showing a later line number).

---

### Task 5: docs/agent/README.md section

**Files:**
- Modify: `docs/agent/README.md` (add a section after the "Durable context, state & feedback (cross-session)" section)

- [ ] **Step 1: Insert the section**

In `docs/agent/README.md`, immediately AFTER the "## Durable context, state & feedback (cross-session)" section (before the next `##` heading), insert exactly:

```markdown
## Making a change (any feature / bug / PR)

For anything that is **not** a brand-new vendor app (that's `build-app`), the repo
has a native change workflow — three chained skills, scaled to change size:

1. **`brainstorm`** — inherits context, clarifies, writes `docs/agent/changes/<slug>/SPEC.md` → **GATE 1: spec sign-off**.
2. **`write-plan`** — turns the spec into `docs/agent/changes/<slug>/PLAN.md` (bite-sized TDD tasks) → **GATE 2: plan sign-off**.
3. **`execute`** — asks subagent-driven vs inline, implements test-first, and finishes at the **Definition of Done** (`pnpm verify` green · change recorded via `remember` · `FEATURES`/`PROGRESS` updated).

A trivial bug gets a 3-line spec and a 1-task plan; a feature gets the full
treatment. No external plugins required — the skills are self-contained.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Making a change (any feature" docs/agent/README.md`
Expected: exactly 1 match.

---

### Task 6: Final verification + record the change

**Files:** none (verification); then a `remember` entry

- [ ] **Step 1: Confirm all skills + docs exist and are discoverable**

Run:
```
ls .agents/skills/brainstorm/SKILL.md .agents/skills/write-plan/SKILL.md .agents/skills/execute/SKILL.md
for s in brainstorm write-plan execute; do head -1 ".claude/skills/$s/SKILL.md"; done
grep -q "Making a change" AGENTS.md && echo "AGENTS router OK"
grep -q "Making a change (any feature" docs/agent/README.md && echo "README OK"
```
Expected: all three SKILL.md paths list; each `head -1` prints `---` (frontmatter via the symlink); both `echo` lines print.

- [ ] **Step 2: Confirm no superpowers dependency in the new skills**

Run: `grep -rn "superpowers" .agents/skills/brainstorm .agents/skills/write-plan .agents/skills/execute || echo "self-contained"`
Expected: `self-contained` (the skills must not reference the external plugin).

- [ ] **Step 3: Run the feedback loop**

Run: `pnpm verify`
Expected: green (these are docs/skills; the 182-test suite is unaffected).

- [ ] **Step 4: Record the change via `remember`**

Invoke the `remember` skill to add a repo-level change-journal entry to
`docs/agent/context/CHANGELOG.md`:
- type: **feature**; title: "Repo-native change workflow (brainstorm → write-plan → execute)"
- What: three chained skills + per-change artifacts + AGENTS.md router + README section.
- Why: make the repo follow brainstorm→spec→plan→code natively without invoking superpowers.
- Definition of done: skills discoverable; `AGENTS.md`/README updated; `pnpm verify` green; self-contained (no superpowers refs).
- Files: `.agents/skills/{brainstorm,write-plan,execute}/SKILL.md`, `AGENTS.md`, `docs/agent/README.md`.
- Links: `docs/superpowers/specs/2026-06-11-change-workflow-design.md`, `docs/superpowers/plans/2026-06-11-change-workflow.md`.

- [ ] **Step 5: (If git is later initialized) commit** — `git add -A && git commit -m "feat(agent): add repo-native change workflow skills (brainstorm/write-plan/execute)"`. Skip while there is no `.git`.

---

## Self-review notes (author)

- **Spec coverage:** §4 brainstorm → Task 1; §5 write-plan → Task 2; §6 execute →
  Task 3; §7 router → Task 4; §7 README → Task 5; §10 acceptance (discoverable,
  self-contained, verify green, recorded) → Task 6. No gaps.
- **No placeholders:** every SKILL.md body is provided in full; verification
  commands are exact. (Inner ``` fences in the skill bodies are escaped as `\``` `
  so the outer code block stays intact — un-escape when writing the file.)
- **Consistency:** slug path `docs/agent/changes/<slug>/{SPEC,PLAN}.md`, the two
  gate names, and the Definition-of-Done items match the spec and the existing
  harness (`pnpm verify`, `remember`, `FEATURES.md`, `PROGRESS.md`).
- **No commits assumed** (no `.git`); Task 6 Step 5 is the optional future commit.
```
