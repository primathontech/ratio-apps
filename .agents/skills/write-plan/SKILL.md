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

```
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
```

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
