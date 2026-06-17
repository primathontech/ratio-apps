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

## 7. GATE 1 — spec sign-off
Present the spec; ask for explicit approval. Do NOT write a plan or code here.
On approval, hand off: "Spec approved — invoke the `write-plan` skill." If
changes are requested, revise and re-present.
