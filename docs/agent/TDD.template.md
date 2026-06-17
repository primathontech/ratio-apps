# TDD — <Display Name> (`<slug>`)

> Test Plan / Test-Driven Design. Produced by `tdd-author` from the approved TRD,
> then human-approved at **GATE 3** before any scaffolding. The builders write
> these tests first (failing), then implement to green. Saved at
> `docs/agent/apps/<slug>/TDD.md`.

**Source PRD/TRD:** `docs/agent/apps/<slug>/PRD.md`, `TRD.md`
**Status:** draft | approved

## 1. Test strategy
<!-- Unit vs integration; what's mocked (Ratio API, DB); runner = vitest.
     The heavy e2e/QA suite is intentionally out of scope for this boilerplate. -->

## 2. Acceptance criteria → test mapping
| PRD acceptance criterion | Test case(s) that prove it |
|---|---|
|  |  |

<!-- Every acceptance criterion must map to at least one test. No orphans. -->

## 3. Backend test cases
<!-- Per controller/service/migration: name, arrange/act/assert sketch, fixtures,
     edge cases (invalid input, missing config, inactive merchant, bad webhook
     signature, ...). -->

## 4. Frontend test cases
<!-- Per admin screen: config-form validation, render states, API binding. -->

## 5. Shared-schema test cases
<!-- Zod accept/reject cases for the <slug>-config schema. -->

## 6. Fixtures & helpers
<!-- Seed data / factories the tests need. -->

## 7. Definition of done
- [ ] `pnpm verify` is green (lint → typecheck → test → build; see the Definition of Done in `AGENTS.md`)
- [ ] Every PRD acceptance criterion has a passing test (section 2)
