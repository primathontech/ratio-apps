---
name: brainstorm
description: Turn a feature/bug/PR idea into an approved, written spec for this repo. Inherits repo context, asks clarifying questions one at a time, proposes an approach scaled to the change size, and writes docs/agent/changes/<slug>/SPEC.md — then STOPS at GATE 1 (spec sign-off). The first step of the repo's change workflow (brainstorm → write-plan → execute). Not for creating a whole new vendor app (use build-app for that).
when_to_use: Use for FEATURE-tier changes (multi-file, a real design choice, or risk) — the entry the AGENTS.md "Making a change" classifier routes to. Trivial and small changes do NOT come here (they use the fast lanes in AGENTS.md). A brand-new vendor app uses build-app.
---

# brainstorm

Turn an idea or bug into an approved `SPEC.md`. No plan, no code until GATE 1.

## 1. Inherit context (on demand)
Read the code in question first. Pull context only as needed: consult
`docs/agent/context/INDEX.md` (and a linked ADR/learning), or the app's
`docs/agent/apps/<slug>/CONTEXT.md`, ONLY when your change touches that area and
you need a prior decision — not as a blanket pre-read. Note any decision/learning
that constrains the change. (`AGENTS.md` Standing rules always apply.)

## 2. Derive the slug
Kebab-case from the change title (e.g. `fix-gmc-paise-rounding`,
`add-orders-webhook`). Must match `^[a-z0-9-]+$`. This names
`docs/agent/changes/<slug>/`.

## 3. Clarify (one question at a time)
Ask only what is genuinely unclear — purpose, constraints, success criteria.
Prefer multiple-choice. For a **bug**: reproduce it and identify the root cause
BEFORE proposing a fix (a fix without a confirmed root cause is a guess).

## 4. Propose approach
Propose 2–3 approaches with a recommendation and why (this is feature-tier work).

## 5. Write the spec
Create `docs/agent/changes/<slug>/SPEC.md` from this shape (omit sections that
genuinely don't apply):

```
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
```

Self-review the spec: no placeholders, no ambiguity, scope is one plan's worth.

## 6. GATE 1 — spec sign-off
Present the spec; ask for explicit approval. Do NOT write a plan or code here.
On approval, hand off: "Spec approved — invoke the `write-plan` skill." If
changes are requested, revise and re-present.
