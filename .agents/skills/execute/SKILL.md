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

## 4. Definition of Done
Satisfy the **Definition of Done in `AGENTS.md`** (the single source) before
declaring the work complete — in short: `pnpm verify` green → record the change
via the **`remember`** skill (per-app `CONTEXT.md` journal or repo `CHANGELOG.md`)
→ update `FEATURES.md` if a capability's lifecycle changed → save any durable
learning/decision → clear `PROGRESS.md`.

## 5. Report
One short summary: what shipped, `pnpm verify` result, and where the journal
entry landed.
