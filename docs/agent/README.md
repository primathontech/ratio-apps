# The agentic flow

This repo *is* an agent-native boilerplate: a PRD drives Claude through technical
design, a test plan, scaffolding, building, reviewing, opening a PR for, and
deploying one new vendor app — while retaining all context in a per-build state
file. There is no separate program to run; Claude is the engine, the skills are
the steps.

Skills live canonically in **`.agents/skills/`** and are symlinked to
`.claude/skills/` so Claude Code auto-discovers them.

## How to use it

1. **Drop a PRD.** Copy [`PRD.template.md`](./PRD.template.md), fill it in
   (vendor name + slug, data model, scopes, webhooks, admin screens, acceptance
   criteria), or hand a rough idea to the flow and let `prd-architect`
   structure it.
2. **Invoke the `build-app` skill.** It is the single entry point. It
   reads/creates `docs/agent/apps/<slug>/STATE.json`, walks the phases in order,
   and enforces the gates.
3. **Approve at the five gates.** The flow is autonomous *within* a phase and
   pauses at five irreversible points: the PRD, the TRD (technical design), the
   TDD (test plan) — all **before any code is written** — then before the PR and
   before deploy.
4. **Output:** three signed-off design docs (PRD/TRD/TDD), a new backend module +
   admin app + shared schemas with tests, lint / typecheck / build / test green, a
   PR, and a single-artifact deploy (Docker or PM2).

## Phases & gates

```
build-app (orchestrator)
  │
  ├─ prd-architect ────────────► PRD.md (what)            + STATE.json
  │      ▼  [GATE 1: PRD sign-off]
  ├─ trd-architect ────────────► TRD.md (technical design)
  │      ▼  [GATE 2: TRD sign-off]
  ├─ tdd-author ───────────────► TDD.md (test plan)
  │      ▼  [GATE 3: TDD sign-off]   ── no code until here ──
  ├─ vendor-scaffolder ────────► new module + admin scaffolded from _template
  ├─ backend-builder ──────────► module implemented; tests written first per TDD
  ├─ frontend-builder ─────────► admin screens implemented; tests per TDD
  ├─ code-reviewer ────────────► lint + typecheck + test + build pass (light gate)
  │      ▼  [GATE 4: before PR]
  ├─ pr-author ────────────────► branch + conventional commits + PR
  │      ▼  [GATE 5: before deploy]
  └─ deployer ─────────────────► Docker | PM2 single-artifact deploy
```

The first three phases are **documentation + design only** — nothing is scaffolded
until the PRD, TRD, and TDD are all human-approved. Gate approvals are recorded in
`STATE.json`, so an approval survives a session restart — the flow can be abandoned
mid-build and resumed in a fresh session purely from that file.

## Context retention

`docs/agent/apps/<slug>/` holds the build's context so anyone can pick it up:
- `PRD.md`, `TRD.md`, `TDD.md` — the three signed-off design docs.
- `STATE.json` — the single source of truth for progress (`phase`, `gates`,
  `docs`, `scopes`, `webhooks`, `paths`, …). Its shape and the allowed `phase` /
  `gate` values are in [`STATE.schema.md`](./STATE.schema.md). Every skill reads it
  on entry and writes it on exit.

## Durable context, state & feedback (cross-session)

Beyond a single build's `STATE.json`, the repo carries durable, shared context so
any future session inherits it:

- **`docs/agent/context/`** — `INDEX.md` (the map), `decisions/` (ADRs),
  `learnings.md` (gotchas), `CHANGELOG.md` (repo-level change journal).
- **`docs/agent/FEATURES.md`** — registry of capabilities + lifecycle status.
- **`docs/agent/PROGRESS.md`** — in-flight multi-session work (ephemeral).
- **`docs/agent/apps/<slug>/CONTEXT.md`** — per-app standing context + change journal.
- **`remember` skill** — the single writer; classifies an entry and updates the index.
- **`pnpm verify`** — the feedback loop (`lint → typecheck → test → build`); see the
  Definition of Done in `AGENTS.md`.

Save context any time with the `remember` skill ("save this to context"). Pull
context on demand — read `context/INDEX.md` or a relevant `CONTEXT.md` only when
your change touches that area (see AGENTS.md Standing rules), not as a routine
pre-read.

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

## The skills

All live under `.agents/skills/` (symlinked as `.claude/skills/`):

| Skill | Role |
|---|---|
| `build-app` | Orchestrator — entry point; walks phases, enforces the five gates. |
| `prd-architect` | Turn an idea / rough PRD into a structured `PRD.md`; init `STATE.json`. |
| `trd-architect` | Turn the PRD into a Technical Requirements/Design doc (`TRD.md`). |
| `tdd-author` | Turn the TRD into a Test Plan / test-driven design (`TDD.md`). |
| `vendor-scaffolder` | Copy `_template` → `<slug>`; wire `apps.ts`, `app.module.ts`, env. |
| `backend-builder` | Implement the module (config, sdk, webhooks, db migrations); tests first. |
| `frontend-builder` | Implement the admin screens; tests first. |
| `code-reviewer` | Light gate — lint, typecheck, test, build, house conventions, TDD coverage. |
| `pr-author` | Branch, conventional commits, open PR via `gh`. |
| `deployer` | Build the single artifact; deploy via Docker or PM2. |
| `context-keeper` | Reference — the `STATE.json` read/write contract. |
| `house-conventions` | Reference — commit format, naming, `core/` boundary. |
| `stack-patterns` | Reference — NestJS/Kysely + React/Vite patterns. |
| `remember` | Persist durable context (decisions/learnings/rules/change-journal); single writer that updates the context index. |
| `brainstorm` | Feature-tier changes: clarify + write docs/agent/changes/<slug>/SPEC.md (GATE 1). Step 1 of the feature lane. |
| `write-plan` | Turn an approved SPEC.md into a bite-sized TDD PLAN.md (GATE 2). Step 2 of the change workflow. |
| `execute` | Implement an approved PLAN.md (subagent or inline) to the Definition of Done. Step 3 of the change workflow. |

The repo-wide contract these skills follow is [`AGENTS.md`](../../AGENTS.md).
