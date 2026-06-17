---
name: tdd-author
description: Turn an approved TRD into a Test Plan / Test-Driven Design document (TDD) for a new vendor app — the unit/integration test cases, fixtures, and a mapping from each PRD acceptance criterion to the test(s) that prove it — written to docs/agent/apps/<slug>/TDD.md. Reads the PRD + TRD + STATE.json, writes the test plan, then STOPS at GATE 3 (TDD sign-off) until a human approves. The builders write tests to satisfy this plan.
when_to_use: The third worker phase of build-app, after GATE 2 (TRD approved) and before vendor-scaffolder. Use to define WHAT will be tested and HOW before any code exists, so implementation is test-driven. Produces the test plan and pauses for human approval — does NOT scaffold or write implementation code.
---

# tdd-author

You turn the **approved TRD** into a **Test Plan / Test-Driven Design document
(TDD)**. This defines the tests that implementation must satisfy — written before
any code so the build is genuinely test-driven. No scaffolding, no implementation.
Consult `stack-patterns` for how tests are structured in this repo (Vitest unit
tests under `apps/backend/test/unit/**` and admin tests under
`apps/admin-<slug>/src/**`).

## Preconditions

- `docs/agent/apps/<slug>/STATE.json` exists with `gates.prd: approved` and
  `gates.trd: approved`. If either is not approved, STOP and bounce back to
  `build-app`.

## What to produce

Create `docs/agent/apps/<slug>/TDD.md` from `docs/agent/TDD.template.md`:

1. **Test strategy** — what is unit-tested vs integration-tested, what is mocked
   (Ratio API, DB), and the runners used (`vitest`). Note that the heavy e2e/QA
   suite is intentionally out of scope for this boilerplate.
2. **Acceptance-criteria → test mapping** — a table: every PRD acceptance
   criterion maps to one or more named test cases that prove it. No orphan
   criteria, no orphan tests.
3. **Backend test cases** — per controller/service/migration from the TRD: the
   case name, arrange/act/assert sketch, fixtures, and edge cases (invalid input,
   missing config, inactive merchant, bad webhook signature, etc.).
4. **Frontend test cases** — per admin screen: config-form validation, render
   states, and API-binding behavior.
5. **Shared-schema test cases** — Zod schema accept/reject cases for the
   `<slug>-config` schema.
6. **Fixtures & helpers** — the seed data / factories the tests need.
7. **Definition of done** — the green-gate: `pnpm -r lint`, `pnpm -r typecheck`,
   `pnpm -r build`, `pnpm -r test` all pass, and every acceptance criterion has a
   passing test.

Keep each case concrete enough that `backend-builder` / `frontend-builder` can
write the failing test first, then implement to green.

## On exit (via context-keeper)

- Set `docs.tdd = "docs/agent/apps/<slug>/TDD.md"`.
- Append `{ "phase": "tdd-author", "ts": <ISO-8601> }` to `history`.
- Leave `gates.tdd: pending`.

## STOP at GATE 3

Present the test plan and ask for **explicit human approval**. Do not proceed to
`vendor-scaffolder`. When approved, `build-app` flips `gates.tdd: approved`. If
changes are requested, revise `TDD.md` and re-present. Never self-approve.

## Hand-off to the builders

`backend-builder` and `frontend-builder` MUST implement the cases in this TDD —
writing the failing test first, then the code — and `code-reviewer` verifies the
acceptance-criteria → test mapping is fully covered before GATE 4.
