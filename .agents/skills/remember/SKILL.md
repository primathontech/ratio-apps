---
name: remember
description: Persist durable context into the repo so future agent sessions inherit it. Classifies an entry as a decision (ADR), a learning/gotcha, a working rule, a per-app feature/fix/change journal entry, or a repo-level change, writes it to the right file, and updates the context index. Use whenever the user says "save this to context"/"remember this" or you learn something future sessions must know.
when_to_use: Invoke when the user says "remember this" / "save to context" / "record this decision/fix", or proactively (with a one-line confirmation) when you learn a durable, non-obvious fact, make an architectural/product decision, fix a notable bug, or ship a feature. Do NOT use for trivia (typos, formatting, dep bumps) or for transient in-flight status (that goes in PROGRESS.md).
---

# remember

Single writer for the repo's durable context. Classify, write, index.

## 1. Classify the entry

| Type | When | Destination |
|---|---|---|
| **decision** | An architectural/product choice with alternatives + rationale | `docs/agent/context/decisions/NNNN-<kebab>.md` (new ADR) |
| **learning** | A non-obvious fact/gotcha future work needs | append to `docs/agent/context/learnings.md` |
| **rule** | A standing behavior the agent must always follow | add a line under "Standing rules" in `AGENTS.md` |
| **per-app change** | A notable feature/fix/change to one app | append to `docs/agent/apps/<slug>/CONTEXT.md` → Change journal |
| **repo-level change** | A notable cross-cutting change (harness/shared/tooling) | append to `docs/agent/context/CHANGELOG.md` |

If genuinely ambiguous, ask the user once. Infer the `<slug>` from the work in
progress; confirm if unclear. **Notable changes only** — skip trivia. **Never**
write secrets.

## 2. Write the entry

- **Dates:** use the real current date (`YYYY-MM-DD`).
- **ADR** (`decisions/NNNN-<kebab>.md`) — scan `decisions/` for the next
  zero-padded number. Body:
  ```
  # NNNN — <Title>
  - **Date:** YYYY-MM-DD
  - **Status:** accepted
  ## Context
  <forces at play>
  ## Decision
  <what we chose>
  ## Rationale
  <why; alternatives rejected>
  ## Consequences
  <follow-on effects, good and bad>
  ```
- **learning** — one dated bullet (1–3 lines): the fact + why it matters.
- **rule** — one imperative line under `AGENTS.md` "Standing rules" (+ optional why).
- **change** (per-app `CONTEXT.md` journal or repo `CHANGELOG.md`) — newest first:
  ```
  ### YYYY-MM-DD — <feature|fix|change> — <title>
  - **What:** …
  - **Why:** …
  - **Definition of done / fix:** …   # for a fix, the root cause + what was actually done
  - **Files:** …
  - **Links:** …
  ```
- If the per-app `CONTEXT.md` does not exist yet, create it from the template in
  `docs/agent/apps/<slug>/CONTEXT.md` shape (Standing context + Change journal —
  see `apps/google/CONTEXT.md` for an example).

## 3. Update the index

After any decision or learning write, add/refresh a one-line hook + relative link
in `docs/agent/context/INDEX.md` so the map stays current.

## 4. Report

One line: what was written and where (e.g. "Recorded ADR 0003 at
`docs/agent/context/decisions/0003-…md` and indexed it").
