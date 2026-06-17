---
name: build-app
description: Orchestrator and entry point for building a new vendor app from a PRD in this repo. Reads/creates the per-build STATE.json (resuming from its phase if present), walks the phases in order — prd-architect → trd-architect → tdd-author → vendor-scaffolder → backend-builder → frontend-builder → code-reviewer → pr-author → deployer — and enforces the five human gates (PRD, TRD, TDD test plan, before PR, PR-merged-before-deploy). Autonomous within phases; gate approvals recorded in STATE.json survive restarts.
when_to_use: Use when building a new vendor app from a PRD (or rough idea) in this monorepo — the single entry point that drives the full lifecycle from PRD through technical design and a test plan to deploy, pausing only at the five gates. Also use to resume an in-progress build in a fresh session.
---

# build-app (orchestrator)

The entry point for turning one PRD into one new vendor app. You do not write code
yourself — you **delegate to worker skills in order**, enforce the gates, and keep
`docs/agent/apps/<slug>/STATE.json` current via `context-keeper`.

The system is **autonomous within phases** and pauses only at the **five human
gates**. All progress lives in STATE.json (not the transcript), so a build resumes
from a fresh session purely from that file — and a gate already `approved` is
**not re-prompted**.

Three documents are produced and human-approved **before any code is written** —
the PRD (what), the TRD (how, technically), and the TDD (the test plan). All three
are committed under `docs/agent/apps/<slug>/` so anyone can pick the build up later.

## On entry — read or create state

1. Determine the `slug` (from the idea/PRD or an existing build).
2. Read `docs/agent/apps/<slug>/STATE.json` (via `context-keeper`).
   - **Present** → **resume from its `phase`**, honoring recorded gate approvals.
   - **Absent** → this is a fresh build; the first phase (`prd-architect`) creates
     it.

## The flow

```
prd-architect  ──► [GATE 1: PRD sign-off]
trd-architect  ──► [GATE 2: TRD sign-off]
tdd-author     ──► [GATE 3: TDD test-plan sign-off]
  ──► vendor-scaffolder ──► backend-builder ──► frontend-builder ──► code-reviewer
  ──► [GATE 4: before PR] ──► pr-author ──► (human reviews & MERGES the PR)
  ──► [GATE 5: PR merged, before deploy] ──► deployer ──► done
```

The first three phases are **documentation + design only** — no code is scaffolded
until the PRD, TRD, and TDD are all human-approved. Run each worker, let it update
STATE.json on exit, then proceed to the next — pausing at the gates below.

## The five gates

A gate is a hard stop for **explicit human approval**. Record the approval in
STATE.json (`gates.*: "approved"`) so a restart honors it and does not re-ask.

| Gate | When | What to confirm | STATE flag |
|---|---|---|---|
| **GATE 1 — PRD** | after `prd-architect`, before `trd-architect` | Human approves the structured PRD (slug, data model, scopes, webhooks, screens, acceptance criteria) | `gates.prd` |
| **GATE 2 — TRD** | after `trd-architect`, before `tdd-author` | Human approves the technical requirements/design (module shape, API routes, DB schema, integrations, NFRs) | `gates.trd` |
| **GATE 3 — TDD** | after `tdd-author`, before `vendor-scaffolder` | Human approves the test plan (cases, fixtures, acceptance mapping) that implementation must satisfy | `gates.tdd` |
| **GATE 4 — before PR** | after `code-reviewer`, before `pr-author` | Human approves opening the PR (lint/typecheck/build green, conventions met, tests match the TDD) | `gates.pr` |
| **GATE 5 — PR merged, before deploy** | after `pr-author`, before `deployer` | Human confirms the PR is **merged** into the default branch, then approves deploying the single artifact (built from the merged code, not the feature branch) | `gates.deploy` |

At each gate: if the relevant `gates.*` is already `approved` in STATE.json,
proceed without prompting. Otherwise present the artifact/results, ask for
explicit approval, flip the flag to `approved`, and continue. If declined, stop
and leave the flag `pending`.

## Phase → skill mapping

| `phase` value | Skill invoked | Produces / advances to |
|---|---|---|
| `prd-architect` | `prd-architect` | `PRD.md` + initial STATE.json → **GATE 1** |
| `trd-architect` | `trd-architect` | `TRD.md` (technical requirements/design) → **GATE 2** |
| `tdd-author` | `tdd-author` | `TDD.md` (test plan / test-driven design) → **GATE 3** |
| `vendor-scaffolder` | `vendor-scaffolder` | scaffolded module + admin, wired |
| `backend-builder` | `backend-builder` | module implemented per PRD/TRD; tests per TDD |
| `frontend-builder` | `frontend-builder` | admin screens implemented; tests per TDD |
| `code-reviewer` | `code-reviewer` | lint + typecheck + build pass; tests cover the TDD → **GATE 4** |
| `pr-author` | `pr-author` | branch + commits + PR (prUrl); human reviews & **merges** the PR → **GATE 5** |
| `deployer` | `deployer` | deploy the **merged** default branch (Docker \| PM2) → `phase: done` |
| `done` | — | build complete |

Reference skills (`house-conventions`, `stack-patterns`, `context-keeper`) are
**consulted** by the workers, not invoked as phases.

## Resuming a build

Read `phase` and `gates` from STATE.json and jump to the matching skill above:
- `phase: tdd-author` with `gates.prd/trd: approved` → run `tdd-author` (don't
  re-do PRD/TRD).
- `phase: backend-builder` with `gates.prd/trd/tdd: approved` → run
  `backend-builder` (no re-design, no re-scaffold).
- `phase: pr-author` with `gates.pr: approved` → run `pr-author` (don't re-prompt
  GATE 4).
- `phase: done` → nothing to do; report the build is complete (`prUrl`,
  `deployTarget`).
If `phase` and the files on disk disagree, trust the disk, reconcile `phase`, then
continue.

## When stuck

- Never skip a gate or self-approve one — gates exist for the irreversible steps
  (committing to a product spec, a technical design, a test plan, opening a PR,
  deploying).
- Do not scaffold or write implementation code until PRD, TRD, and TDD are all
  `approved`.
- Within a phase, act autonomously; only stop for a gate or a genuine blocker.
- If a worker fails its verification (typecheck/build), do not advance `phase` —
  bounce back to that worker with the error.
