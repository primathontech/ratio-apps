# Reframe the agentic flows as one pipeline + single-source — spec

- **Slug:** reframe-one-pipeline   **Type:** refactor (docs/wording)   **Size:** small
- **Area:** docs (`AGENTS.md`, `docs/agent/README.md`) + skill wording (`brainstorm`, `write-plan`, `build-app` cross-refs)

## Problem / goal
The repo presents two *separate* agentic flows — `build-app` (new vendor apps) and
`brainstorm → write-plan → execute` (everything else). In reality they're **one
pipeline at two depths**, so "two flows" framing creates a needless second mental
model, invites drift (already seen: DoD 4-vs-5, `pnpm verify` duplication), and the
two gate vocabularies clash (`build-app` GATE 1 = PRD vs the general flow GATE 1 =
spec). Goal: reframe both as the single pipeline **Design → Plan → Build → Verify →
Ship**, with `build-app` as the *new-vendor specialization*, and finish
single-sourcing — **without any behavior/schema change**.

## Approach (Option A — chosen)
1. **One-pipeline framing.** Add a short "The one pipeline (Design → Plan → Build →
   Verify → Ship)" statement to `AGENTS.md`, positioning `build-app` as the
   new-vendor-app specialization and `brainstorm → write-plan → execute` as the
   general path. Keep the existing router line; tie it to the pipeline.
2. **Mapping table (single owner).** `docs/agent/README.md` owns a table mapping
   each pipeline stage → the general-flow skill → the `build-app` phase(s)/gate, so
   the two are visibly the same shape. `AGENTS.md` keeps the one-line framing +
   points to the table.
3. **Disambiguate gate names — no renames.** Do **NOT** rename `STATE.json` gate
   keys (`prd/trd/tdd/pr/deploy`) or change any gate behavior. Instead, refer to
   the general flow's gates as **"Spec gate"** and **"Plan gate"** (in `brainstorm`/
   `write-plan`/README) rather than "GATE 1 / GATE 2", so they no longer collide
   with `build-app`'s numbered GATE 1–5. Cross-reference both onto the pipeline.
4. **Single-source sweep.** The pipeline framing + mapping live in exactly one place
   (README owns the table; AGENTS has the lean framing + pointer). Confirm no new
   duplication is introduced and existing shared concepts (DoD, `pnpm verify`) stay
   single-sourced.

## Acceptance criteria
- [ ] `AGENTS.md` states the one pipeline (Design → Plan → Build → Verify → Ship) and names `build-app` as the new-vendor specialization, in a lean form that points to the README table (no bloat — AGENTS stays ~≤115 lines).
- [ ] `docs/agent/README.md` has a single "One pipeline, two depths" mapping table: stage → general-flow skill → `build-app` phase(s)/gate.
- [ ] The general flow's gates are named **"Spec gate" / "Plan gate"** in `brainstorm`, `write-plan`, and the README (no more "GATE 1/GATE 2" that clashes with `build-app`).
- [ ] No `STATE.json` gate keys or gate behavior changed; `build-app`'s GATE 1–5 unchanged.
- [ ] No new content duplication; the pipeline mapping has one owner (README).
- [ ] `pnpm verify` is green.

## Out of scope
- Renaming `STATE.json` gate keys or any gate/phase behavior change.
- Merging the two flows into one skill, or `build-app` consuming `execute` (Options B/C — not chosen).
- Any code/runtime change; the deferred deployment items.

## Context consulted
- The design discussion (Option A chosen over B "front-door skill" and C "build-app consumes execute").
- `build-app/SKILL.md` gate list (GATE 1–5) and `docs/agent/STATE.schema.md` gate keys (`prd/trd/tdd/pr/deploy`) — must not change.
- Prior review DRY findings (DoD/verify single-sourcing already done) — don't regress.
- ADR 0002 (`_template` reference-only) — framing must keep `build-app` as the new-vendor path.
