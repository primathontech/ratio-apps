# Agentic Flow Tiering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a size-tiered front door (trivial / small / feature / new-vendor) and lazy on-demand context to the repo's agentic system, so small tasks stop walking the full `brainstorm → write-plan → execute` chain and context isn't eagerly slurped.

**Architecture:** Docs/skills-only change. The classifier and lazy-context rule live in `AGENTS.md` (the single source for routing + DoD). `brainstorm`/`write-plan`/`execute` become the explicit **feature lane**; `brainstorm` reads context conditionally. `docs/agent/README.md` documents the four lanes. No skill is added, deleted, or merged; `build-app` and the vendor recipe are untouched.

**Tech Stack:** Markdown only (`AGENTS.md`, `.agents/skills/*/SKILL.md`, `docs/agent/README.md`). Verification is structural (grep / line-count) plus confirming `pnpm verify` stays green (proving no code was touched).

## Global Constraints

- Scope is **surgical**: keep all 17 skills — **no skill added, deleted, merged, or renamed**.
- Do **not** modify `build-app` or its worker/reference skills' internals, the vendor-scaffolding recipe, or any build/test config.
- `AGENTS.md` remains the **single source** for routing + Definition of Done; skills reference it, never restate it.
- `AGENTS.md` must stay ≲ ~140 lines (a directory page, not an encyclopedia).
- The four tiers and their lanes are exactly: **Trivial** → do it + `pnpm verify`; **Small** → inline 1–3 line plan + implement + `pnpm verify`; **Feature** → `brainstorm → write-plan → execute`; **New vendor** → `build-app`.
- Blast-radius escalation (always **feature**, regardless of size): changes touching `apps/backend/src/core/`, `apps/backend/src/config/apps.ts`, `apps/backend/src/config/env.schema.ts`, the `APPS` tuple, OAuth/crypto/auth, DB migrations, or deploy.
- Lazy context: consult `context/INDEX.md` / an ADR / an app's `CONTEXT.md` **only when the change touches that area**; never pre-read `CHANGELOG.md` / `learnings.md` / every `CONTEXT.md`.
- Commit per task. End commit messages with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Conventional commits, scope `agent` or `skills`.
- Each task ends green: its structural grep checks pass AND `pnpm verify` is green (docs changes must not break the build).

---

## File Structure

- `AGENTS.md` — MODIFY. Owns the size classifier (in "Making a change"), the lazy-context standing rule, the tier-scaled Definition of Done, and the trimmed "Add a new app" pointer. The keystone — every lane references it.
- `.agents/skills/brainstorm/SKILL.md` — MODIFY. Scoped to feature-tier entry; step 1 made conditional/lazy; the upstream "assess size" step removed.
- `.agents/skills/write-plan/SKILL.md` — MODIFY. Marked the feature lane; stale `.git`-doesn't-exist note corrected; trivial framing removed.
- `.agents/skills/execute/SKILL.md` — MODIFY. Marked the feature lane.
- `docs/agent/README.md` — MODIFY. "Making a change" section rewritten to show the four lanes.

---

## Task 1: AGENTS.md — classifier, lazy-context rule, tier-scaled DoD, trim

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: the canonical 4-tier classifier + tie-breakers, the `Pull context on demand` standing rule, and the tier-scaled DoD that every other file in this plan references by pointer.

- [ ] **Step 1: Replace the "Making a change" paragraph with the classifier**

Find this block in `AGENTS.md` (inside the "## Context & decisions" section):

```
**Making a change:** a *new vendor app* → the `build-app` skill. *Any other
feature / bug / PR* → start with the **`brainstorm`** skill (it chains
`brainstorm → write-plan → execute`, scales to size, and ends at the Definition
of Done). Do not write code for a non-trivial change before its spec + plan are
approved.
```

Replace it with:

```
**Making a change — classify first, then take the matching lane.** Classify the
change by size before doing anything; take the lane that matches and do not
over-process small work:

| Tier | What it is | Lane |
|---|---|---|
| **Trivial** | one file, obvious, reversible (typo, copy/text, version bump, comment, tiny config) | **Just do it → `pnpm verify` → done.** No spec, plan, or gate. |
| **Small** | a few files, clear approach, **no design choice** | **State a 1–3 line plan in chat → implement → `pnpm verify`.** No SPEC/PLAN docs; the inline plan is the checkpoint. |
| **Feature** | multi-file, a real design choice, or risk | **`brainstorm` → `write-plan` → `execute`** (writes SPEC + PLAN, gates at each). |
| **New vendor app** | a whole new vendor | **`build-app`** (five gates). |

Tie-breakers (apply in order):
- Unsure trivial vs small → treat as **small**.
- Unsure small vs feature → ask "is there a design choice or real risk?" — if yes → **feature**.
- A change touching `apps/backend/src/core/`, `apps/backend/src/config/apps.ts`,
  `apps/backend/src/config/env.schema.ts`, the `APPS` tuple, OAuth/crypto/auth, DB
  migrations, or deploy is **always feature** (high blast radius), regardless of
  line count.
- A bug whose root cause is not yet confirmed is **feature** until you reproduce
  it and confirm the cause (never fix without a confirmed root cause).
```

- [ ] **Step 2: Make the context-reading instruction lazy**

In the same "## Context & decisions" section, find:

```
Durable context lives in `docs/agent/context/` — skim
[`context/INDEX.md`](./docs/agent/context/INDEX.md) and the relevant
`docs/agent/apps/<slug>/CONTEXT.md` before changing an app. To persist a
decision, learning, rule, or notable change, invoke the **`remember`** skill
(it classifies + writes + indexes). Obey the Standing rules below.
```

Replace with:

```
Durable context lives in `docs/agent/context/`. **Pull it on demand** — consult
[`context/INDEX.md`](./docs/agent/context/INDEX.md), a linked ADR, or an app's
`docs/agent/apps/<slug>/CONTEXT.md` only when your change touches that area and
you need a prior decision. Do **not** pre-read `CHANGELOG.md` / `learnings.md` /
every `CONTEXT.md`; prefer the smallest set of files that answers the question.
To persist a decision, learning, rule, or notable change, invoke the
**`remember`** skill (it classifies + writes + indexes). Obey the Standing rules
below.
```

- [ ] **Step 3: Trim the "Add a new app" duplication to a pointer**

Find the numbered 5-step list in the "## Add a new app" section:

```
1. Append `<slug>` to `APPS` in `apps/backend/src/config/apps.ts` (after `moengage`).
2. Add the import statement + `REGISTERED_MODULES` entry + `imports[]` entry
   (three additions) in `apps/backend/src/app.module.ts` (leaving the existing
   four entries intact).
3. Add `<slug>_app` / `<slug>_app_test` CREATE + GRANT to
   `docker/mysql/init/01-database.sql`.
4. Add shared barrel exports to `packages/shared/src/index.ts`
   (`<slug>-events`, `<slug>-config`), exporting `DEFAULT_<VENDOR>_EVENT_MAP`
   (not a generic alias).
5. Add a `RATIO_<SLUG>_*` block to `.env.example` (env.schema.ts derives keys
   from `APPS` automatically — never edit `env.schema.ts`).
```

Replace those five numbered items with this single pointer (leave the surrounding
"four live vendors … append, not replace" sentence and the closing
`vendor-scaffolder`/`house-conventions` paragraph intact):

```
The exact ordered recipe — append to `APPS`; the three `app.module.ts` additions;
the `docker/mysql/init/01-database.sql` CREATE+GRANT; the `packages/shared/src/index.ts`
barrel exports (`DEFAULT_<VENDOR>_EVENT_MAP`, not a generic alias); the
`.env.example` block (`env.schema.ts` derives keys from `APPS` — never edit it) —
and the collision check live in the **`vendor-scaffolder`** skill. Never scaffold
by hand.
```

- [ ] **Step 4: Make the Definition of Done tier-scaled**

Find the "## Verification / feedback loop" section's DoD intro:

```
**Definition of Done** — work is not done until:
1. `pnpm verify` is green;
```

Replace just the intro line (keep points 1–5 exactly as they are) with:

```
**Definition of Done** scales by tier. **Trivial / small** changes are done when
`pnpm verify` is green — record a change-journal / `remember` entry ONLY if the
change is genuinely notable (a behavior change worth future recall, never a
typo). **Feature / new-vendor** work is not done until all five hold:
1. `pnpm verify` is green;
```

- [ ] **Step 5: Verify the edits structurally + line budget**

Run:
```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps"
grep -q "classify first, then take the matching lane" AGENTS.md && echo "classifier: OK"
grep -q "Pull it on demand" AGENTS.md && echo "lazy-context: OK"
grep -q "Definition of Done\*\* scales by tier" AGENTS.md && echo "tiered DoD: OK"
grep -q "high blast radius" AGENTS.md && echo "escalation list: OK"
# the 5-step numbered list must be gone (no "Append .* to .APPS." numbered item):
grep -Eq "^1\. Append .* to .APPS." AGENTS.md && echo "TRIM FAILED (5-step still present)" || echo "trim: OK"
echo "AGENTS.md lines: $(wc -l < AGENTS.md)  (must be <= ~140)"
```
Expected: `classifier: OK`, `lazy-context: OK`, `tiered DoD: OK`, `escalation list: OK`, `trim: OK`, line count ≲ 140.

- [ ] **Step 6: Confirm the build is untouched**

Run: `pnpm verify`
Expected: GREEN (AGENTS.md is docs; this proves no code file was edited by mistake). If verify is slow, `pnpm -r typecheck` is an acceptable faster guard — but run full `pnpm verify` once before the final task.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md
git commit -m "feat(agent): tiered change classifier + lazy context + tier-scaled DoD in AGENTS.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: brainstorm — feature-tier entry + lazy context

**Files:**
- Modify: `.agents/skills/brainstorm/SKILL.md`

**Interfaces:**
- Consumes: the AGENTS.md classifier (Task 1) — `brainstorm` is now the destination of the **feature** lane only.
- Produces: a `brainstorm` skill that no longer self-assesses size and reads context conditionally.

- [ ] **Step 1: Re-scope the frontmatter `when_to_use`**

Find (in the YAML frontmatter):
```
when_to_use: Use at the start of ANY feature, bug fix, refactor, or PR that is not a brand-new vendor app. Begin here before writing code. For a new vendor app, use build-app instead.
```
Replace with:
```
when_to_use: Use for FEATURE-tier changes (multi-file, a real design choice, or risk) — the entry the AGENTS.md "Making a change" classifier routes to. Trivial and small changes do NOT come here (they use the fast lanes in AGENTS.md). A brand-new vendor app uses build-app.
```

- [ ] **Step 2: Make step 1 (context) lazy**

Find:
```
## 1. Inherit context first
Read, in order: `AGENTS.md` (Standing rules), `docs/agent/context/INDEX.md` (+ any
linked decision/learning that touches this area), and — if the change touches an
app — `docs/agent/apps/<slug>/CONTEXT.md`. Read the code in question. Note any
prior decision/learning that constrains the change.
```
Replace with:
```
## 1. Inherit context (on demand)
Read the code in question first. Pull context only as needed: consult
`docs/agent/context/INDEX.md` (and a linked ADR/learning), or the app's
`docs/agent/apps/<slug>/CONTEXT.md`, ONLY when your change touches that area and
you need a prior decision — not as a blanket pre-read. Note any decision/learning
that constrains the change. (`AGENTS.md` Standing rules always apply.)
```

- [ ] **Step 3: Remove the now-upstream "Assess size" step and renumber**

Delete this entire step (the classifier in AGENTS.md now does this upstream):
```
## 3. Assess size
State it up front: **trivial** | **small** | **feature**. The spec scales to this
— a trivial change is a few lines; a feature gets full sections. Do not pad a
trivial change with ceremony.
```
Then renumber the remaining headings so they are contiguous: `## 4. Clarify` → `## 3. Clarify`, `## 5. Propose approach` → `## 4. Propose approach`, `## 6. Write the spec` → `## 5. Write the spec`, `## 7. GATE 1 — spec sign-off` → `## 6. GATE 1 — spec sign-off`.

- [ ] **Step 4: Simplify the "Propose approach" step (feature-tier only)**

After renumbering, find (now `## 4. Propose approach`):
```
Trivial → one approach. Feature → 2–3 with a recommendation and why.
```
Replace with:
```
Propose 2–3 approaches with a recommendation and why (this is feature-tier work).
```
Also, in the "Write the spec" step, the line `Create ... SPEC.md from this shape (omit empty sections for trivial changes):` — change `(omit empty sections for trivial changes)` to `(omit sections that genuinely don't apply)`. Leave the SPEC template body unchanged (the `Size:` field stays — a feature spec can still note small/feature).

- [ ] **Step 5: Verify structurally**

Run:
```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps"
grep -q "FEATURE-tier changes" .agents/skills/brainstorm/SKILL.md && echo "scope: OK"
grep -q "Inherit context (on demand)" .agents/skills/brainstorm/SKILL.md && echo "lazy: OK"
grep -q "## 3. Assess size" .agents/skills/brainstorm/SKILL.md && echo "SIZE STEP STILL PRESENT (fail)" || echo "size-step removed: OK"
# headings contiguous 1..6:
grep -oE "^## [0-9]+\." .agents/skills/brainstorm/SKILL.md
```
Expected: `scope: OK`, `lazy: OK`, `size-step removed: OK`, and the heading list prints `## 1.` `## 2.` `## 3.` `## 4.` `## 5.` `## 6.` in order (no gaps/dupes).

- [ ] **Step 6: Commit**

```bash
git add .agents/skills/brainstorm/SKILL.md
git commit -m "feat(skills): scope brainstorm to feature tier + lazy context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: write-plan + execute — mark the feature lane (and fix stale note)

**Files:**
- Modify: `.agents/skills/write-plan/SKILL.md`
- Modify: `.agents/skills/execute/SKILL.md`

**Interfaces:**
- Consumes: the AGENTS.md classifier (Task 1) and the feature-scoped `brainstorm` (Task 2).
- Produces: `write-plan` and `execute` explicitly labelled as the feature lane (entered only after `brainstorm`), with `write-plan`'s stale `.git` note corrected.

- [ ] **Step 1: Mark write-plan as the feature lane + fix trivial framing**

In `.agents/skills/write-plan/SKILL.md`, find the H1 intro line:
```
Turn the approved `SPEC.md` into a `PLAN.md` of TDD tasks. No code until GATE 2.
```
Replace with:
```
Turn the approved `SPEC.md` into a `PLAN.md` of TDD tasks. No code until GATE 2.
This is the **feature lane** — reached only after `brainstorm`'s GATE 1. Trivial
and small changes never come here (see AGENTS.md "Making a change").
```
Then find (in "## 2. Map the files"):
```
existing patterns and the `core/` boundary (extend core, never fork it). For a
trivial change this is one or two files.
```
Replace with:
```
existing patterns and the `core/` boundary (extend core, never fork it).
```

- [ ] **Step 2: Correct the stale `.git` note in write-plan**

Find (in "## 3. Write the plan", the Rules paragraph):
```
scale to size (a trivial change is ONE task). Commits only if a `.git` exists
(today it does not — end tasks at `pnpm verify`).
```
Replace with:
```
scale to size (a small feature is a few tasks). The repo is a git repo — commit
per task, ending each task at `pnpm verify`.
```
Also in the PLAN.md template block, change the line:
```
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).
```
— leave it as-is (still accurate). No other change in this step.

- [ ] **Step 3: Mark execute as the feature lane**

In `.agents/skills/execute/SKILL.md`, find the H1 intro line:
```
Implement the approved `PLAN.md`. Test-first. End at the Definition of Done.
```
Replace with:
```
Implement the approved `PLAN.md`. Test-first. End at the Definition of Done.
This is the **feature lane** — reached only after `write-plan`'s GATE 2. (The
tier-scaled Definition of Done in AGENTS.md governs how much bookkeeping a change
needs.)
```

- [ ] **Step 4: Verify structurally**

Run:
```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps"
grep -q "feature lane" .agents/skills/write-plan/SKILL.md && echo "write-plan labelled: OK"
grep -q "feature lane" .agents/skills/execute/SKILL.md && echo "execute labelled: OK"
grep -q "today it does not" .agents/skills/write-plan/SKILL.md && echo "STALE NOTE STILL PRESENT (fail)" || echo "stale .git note fixed: OK"
```
Expected: `write-plan labelled: OK`, `execute labelled: OK`, `stale .git note fixed: OK`.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/write-plan/SKILL.md .agents/skills/execute/SKILL.md
git commit -m "docs(skills): label write-plan/execute as the feature lane; fix stale git note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: docs/agent/README.md — document the four lanes + final guard

**Files:**
- Modify: `docs/agent/README.md`

**Interfaces:**
- Consumes: the classifier from Task 1 (this section mirrors it for the README reader).
- Produces: a README whose "Making a change" section shows the four lanes, consistent with AGENTS.md.

- [ ] **Step 1: Rewrite the "Making a change" section**

In `docs/agent/README.md`, find the whole section starting at:
```
## Making a change (any feature / bug / PR)
```
through the end of its paragraph:
```
A trivial bug gets a 3-line spec and a 1-task plan; a feature gets the full
treatment. No external plugins required — the skills are self-contained.
```
Replace that entire section with:
```
## Making a change — pick the lane by size

For anything that is **not** a brand-new vendor app (that's `build-app`), classify
the change first and take the matching lane. The classifier and tie-breakers are
the single source in [`AGENTS.md`](../../AGENTS.md) ("Making a change"); in short:

| Tier | Lane |
|---|---|
| **Trivial** (one file, obvious, reversible) | Just do it → `pnpm verify` → done. No spec/plan/gate. |
| **Small** (a few files, no design choice) | State a 1–3 line plan in chat → implement → `pnpm verify`. No docs. |
| **Feature** (multi-file, a design choice, or risk) | `brainstorm` → `write-plan` → `execute` (SPEC + PLAN, gated). |
| **New vendor app** | `build-app` (five gates). |

Changes touching `core/`, `config/{apps.ts,env.schema.ts}`, the `APPS` tuple,
auth/crypto, migrations, or deploy are **always feature** (high blast radius).
Context is pulled **on demand** — read an ADR or an app's `CONTEXT.md` only when
your change touches that area, never as a blanket pre-read. The three feature-lane
skills are self-contained; no external plugins required.
```

- [ ] **Step 2: Fix the stale eager-read line in "Durable context" section**

Find (near the end of the "## Durable context, state & feedback" section):
```
Save context any time with the `remember` skill ("save this to context"). Read
`context/INDEX.md` + the relevant `CONTEXT.md` before non-trivial work.
```
Replace with:
```
Save context any time with the `remember` skill ("save this to context"). Pull
context on demand — read `context/INDEX.md` or a relevant `CONTEXT.md` only when
your change touches that area (see AGENTS.md Standing rules), not as a routine
pre-read.
```

- [ ] **Step 3: Verify structurally**

Run:
```bash
cd "/Users/prince/Documents/Primathon tech/Ratio APPS/ratio-apps"
grep -q "Making a change — pick the lane by size" docs/agent/README.md && echo "lanes section: OK"
grep -q "always feature" docs/agent/README.md && echo "escalation note: OK"
grep -q "Pull context on demand\|Pull\ncontext on demand\|pulled \*\*on demand\*\*" docs/agent/README.md && echo "lazy note: OK" || grep -q "on demand" docs/agent/README.md && echo "lazy note: OK"
grep -q "before non-trivial work" docs/agent/README.md && echo "STALE EAGER-READ LINE STILL PRESENT (fail)" || echo "stale eager-read fixed: OK"
```
Expected: `lanes section: OK`, `escalation note: OK`, `lazy note: OK`, `stale eager-read fixed: OK`.

- [ ] **Step 4: Final full verify (the build-untouched guard for the whole plan)**

Run: `pnpm verify`
Expected: GREEN across all 6 workspaces (205 tests) — proves the entire docs/skills change set touched no code.

- [ ] **Step 5: Commit**

```bash
git add docs/agent/README.md
git commit -m "docs(agent): document the four change lanes + on-demand context in README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (coverage map: spec → tasks)

- Spec §1 size classifier + tie-breakers + blast-radius list → Task 1 Steps 1, plus README mirror Task 4 Step 1.
- Spec §2 lazy context (standing rule + brainstorm step 1) → Task 1 Step 2 (AGENTS rule), Task 2 Step 2 (brainstorm), Task 4 Step 2 (README).
- Spec §3 tier-scaled DoD → Task 1 Step 4.
- Spec §4 AGENTS.md trim → Task 1 Step 3.
- Spec "files touched" → AGENTS.md (Task 1), brainstorm (Task 2), write-plan + execute (Task 3), README (Task 4).
- Spec acceptance: classifier present (T1S1/T1S5), brainstorm conditional + feature-scoped (T2), trivial/small documented paths (T1S1, T4S1), no skill added/deleted/merged (Global Constraints; no task creates/removes a skill), `pnpm verify` green (T1S6, T4S4), escalation list stated (T1S1/T1S5), AGENTS.md ≲140 lines (T1S5).
- Non-goals respected: no task touches `build-app`, worker/reference skills, the vendor recipe, or build config.
