---
name: code-reviewer
description: The LIGHT review gate (explicitly NOT the heavy Built-for-Ratio QA) — runs lint, then typecheck, then build across the workspace and blocks on the first failure, plus a checklist (no leftover // TEMPLATE: markers, no secrets committed, conventional-commit readiness, core/ not forked per-vendor). On pass, advances STATE.json toward GATE 4.
when_to_use: The phase after frontend-builder and before GATE 4. Use to verify the built vendor app passes the workspace quality gates and house conventions before opening a PR. Blocks progress on any failure.
---

# code-reviewer

A **light** gate: lint + typecheck + build + a short conventions checklist. This
is **explicitly NOT** the heavy Built-for-Ratio / Lighthouse / e2e QA suite —
that was dropped from scope. Block progress on any failure; on pass, advance
toward GATE 4.

Read STATE.json on entry for `slug`. Consult `house-conventions`.

## Run in order, block on first failure

```bash
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

> These four are equivalent to the single `pnpm verify` command — run that, then confirm the Definition of Done in `AGENTS.md` holds (journal updated, FEATURES status current, learnings saved via `remember`).

- Run them in this order; if one fails, **stop**, report the failure, and do
  **not** advance the phase. Fix-or-bounce: either fix trivial issues directly or
  hand back to the relevant builder with the error.
- `pnpm -r test` must be green — the builders wrote these against `TDD.md`.
- `pnpm -r build` building the admin to static is what proves the single deploy
  artifact is producible.

## Checklist (all must hold)

- [ ] **TDD coverage.** Every acceptance criterion in `docs/agent/apps/<slug>/`
      (`PRD.md` ↔ `TDD.md` section 2 mapping) has a corresponding passing test.
      No acceptance criterion is left unproven.
- [ ] **No leftover `// TEMPLATE:` markers** in the vendor's code:
      ```bash
      grep -rn "// TEMPLATE:" apps/backend/src/modules/<slug> apps/admin-<slug>/src
      ```
      Must return nothing.
- [ ] **No secrets committed.** No real `CLIENT_SECRET`, `DATA_ENCRYPTION_KEY`,
      tokens, or DB passwords in source. `.env`/`.env.production` are not staged.
      `.env.example` holds placeholders only.
- [ ] **Conventional-commit readiness.** The change is scoped and describable as
      `feat(<slug>): ...` — coherent, single-purpose, ready for `pr-author` to
      commit.
- [ ] **`core/` not forked per vendor.** The vendor module imports from
      `apps/backend/src/core/` — it has not copied core files into
      `modules/<slug>/`. Verify nothing under `modules/<slug>/` duplicates a
      `core/` primitive.
- [ ] **Wiring intact.** `<slug>` is in `APPS`, registered in `app.module.ts`
      (`REGISTERED_MODULES` + `imports[]`), and `RATIO_<SLUG>_*` keys exist in
      `.env.example`. (A wiring miss would have failed the build above via the
      load-time assertion / env validation — this is a belt-and-suspenders read.)

## On pass

Via `context-keeper`: append a `code-reviewer` history entry and advance `phase`
to `pr-author`. Do **not** flip `gates.pr` — that is GATE 4, approved by a human
in the orchestrator. Report the green results to `build-app`.

## When stuck

- Lint failures are usually Biome formatting — many are auto-fixable; apply the
  fix and re-run.
- A typecheck failure here that the builders' per-app typecheck missed is usually
  a cross-package type drift (shared schema not rebuilt) — rebuild shared and
  re-run.
