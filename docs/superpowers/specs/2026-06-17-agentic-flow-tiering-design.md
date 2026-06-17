# Agentic Flow — Tiered Front Door + Lazy Context

**Date:** 2026-06-17
**Status:** Approved design → implementation plan pending
**Author:** Prince Balhara (with Claude)

## Problem

The repo's agentic system routes **every** non-vendor change through a fixed
heavy chain — `brainstorm → write-plan → execute` — producing two written
artifacts (`SPEC.md` + `PLAN.md`) and two approval gates even for a one-line
fix. `brainstorm` claims to "scale to size," but the **chain itself is fixed**,
so a typo still walks the whole pipeline. Separately, `brainstorm` step 1
*mandates* reading `AGENTS.md` + `context/INDEX.md` + linked decisions + the
app's `CONTEXT.md` before **any** change; as `docs/agent/` grows, this eager
upfront reading inflates context regardless of relevance.

Grounded in harness-engineering principles (a harness is lean instructions +
on-demand docs + executable rules + a strong feedback loop; `AGENTS.md` is a
"directory page, not an encyclopedia"; pull context, don't push it), the fix is
**not** to delete skills — it is to add a fast lane for small work and make
context lazy, keeping the heavy machinery only where work is genuinely heavy.

## Decisions (confirmed)

1. **Scope = surgical** (chosen over skill-library consolidation or docs-only).
   Add a size-tiered front door + lazy context + light AGENTS.md trim. **Keep all
   17 skills. No new skills, no deletions.**
2. `build-app` (new-vendor, 9 phases, 5 gates) stays **unchanged** — big
   irreversible work earns its ceremony.
3. The trivial/small lanes are deliberately **no-process** (no skill needed); the
   classifier lives in `AGENTS.md` as an executable decision rule.

## The design

### 1. Size classifier (the new front door)

The agent classifies the change FIRST, then takes the matching lane. Defined as a
short executable decision rule in `AGENTS.md`'s "Making a change" section.

| Tier | What it is | Lane | Artifacts / gates |
|---|---|---|---|
| **Trivial** | 1 file, obvious, reversible (typo, copy, version bump, tiny config, comment) | **Do it → `pnpm verify`** → record only if notable | none |
| **Small** | localized, a few files, clear approach, **no design choice** | **State a 1–3 line plan in chat → implement → `pnpm verify`** | no SPEC/PLAN docs; the inline plan IS the checkpoint |
| **Feature** | multi-file, a real design choice, or risk | `brainstorm → write-plan → execute` (unchanged) | `SPEC.md` + `PLAN.md` + gates |
| **New vendor** | a whole vendor app | `build-app` (unchanged) | 5 gates |

**Tie-breakers (executable):**
- Trivial vs small → if unsure, treat as **small**.
- Small vs feature → ask "**is there a design choice or real risk?**" If yes →
  **feature**. (A bug whose root cause is unknown is a feature-tier change until
  the root cause is confirmed — keep `brainstorm`'s existing root-cause rule.)
- A change that is "small" but touches `core/`, `env.schema.ts`, the `APPS`
  tuple, security/auth, migrations, or deploy is **escalated to feature** (these
  are the high-blast-radius areas; a design choice is implicit).

### 2. Lazy / on-demand context

- **New standing rule (AGENTS.md):** *"Pull context on demand. Consult
  `context/INDEX.md`, an ADR, or an app's `CONTEXT.md` only when your change
  touches that area and you need a prior decision. Do not pre-read
  `CHANGELOG.md` / `learnings.md` / every `CONTEXT.md`. Prefer the smallest set
  of files that answers the question."*
- **Rewrite `brainstorm` step 1** from "read these 4 docs every time" to the
  conditional form above. `brainstorm` is entered for **feature**-tier changes;
  its size-assessment step is removed (the classifier upstream already did it),
  but its other steps (clarify → approach → SPEC → GATE 1) stay.

### 3. Definition of Done scales by tier

The 5-point DoD (verify + change-journal + `FEATURES.md` update + `remember` +
`PROGRESS.md` clear) applies to **feature / new-vendor** work. For **trivial /
small**: DoD = `pnpm verify` green, plus a change-journal/`remember` entry **only
if the change is genuinely notable** (a behavior change worth future recall — not
a typo). `AGENTS.md` states the scaling explicitly so it is the single source.

### 4. AGENTS.md trim (keep it a directory page)

- Collapse the "Add a new app" 5-step checklist (already fully in
  `vendor-scaffolder`) to a one-line pointer.
- Keep everything else as pointers; do not expand any section.

## Files touched (surgical)

- `AGENTS.md` — add the size-classifier rule + tie-breakers; add the lazy-context
  standing rule; make DoD tier-scaled; trim the "Add a new app" duplication.
- `.agents/skills/brainstorm/SKILL.md` — enter at feature tier; conditional
  (lazy) context reading; drop the now-upstream size step.
- `.agents/skills/write-plan/SKILL.md` and `execute/SKILL.md` — one-line note that
  they are the **feature lane** (entered after `brainstorm`), not for small work.
- `docs/agent/README.md` — update the flow description to show the four lanes.

## Non-goals / out of scope

- No consolidation, merging, renaming, or deletion of skills.
- No change to `build-app` or its worker/reference skills' internals.
- No change to the vendor-scaffolding recipe.
- No change to `pnpm verify` or any build/test config.

## Acceptance criteria

- [ ] `AGENTS.md` contains the 4-tier classifier with executable tie-breakers,
      the lazy-context standing rule, and tier-scaled DoD; the "Add a new app"
      duplication is a pointer. AGENTS.md stays ≲ ~140 lines.
- [ ] `brainstorm/SKILL.md` reads context conditionally (not 4 mandatory docs)
      and is scoped to feature-tier entry.
- [ ] A trivial change's documented path is `do it → pnpm verify → done` with no
      SPEC/PLAN/gate; a small change's path is `inline plan → implement →
      verify`.
- [ ] No skill is added, deleted, or merged; `pnpm verify` stays green
      (docs/skills-only changes must not affect the build).
- [ ] The high-blast-radius escalation list (`core/`, `env.schema.ts`, `APPS`,
      auth, migrations, deploy → feature tier) is stated.

## Risks & mitigations

- **Under-classifying (treating a risky change as small):** mitigated by the
  explicit blast-radius escalation list and the "design choice or risk → feature"
  tie-breaker.
- **Context rule too aggressive (agent misses a constraining ADR):** the rule is
  "consult when your change touches that area" — area-relevance, not blanket
  skip; the classifier sends genuinely risky work to `brainstorm`, which still
  consults relevant context.
- **Drift between AGENTS.md and the skills:** AGENTS.md remains the single source
  for routing + DoD; skills reference it rather than restating.
