# 0002 — `_template` excluded from run and workspace

- **Date:** 2026-06-11
- **Status:** accepted

## Context
`_template` (golden module + admin) was wired into `APPS`, `app.module.ts`, the
pnpm workspace, docker, and migrate scripts — so it ran (`/ready` showed
`_template: fail`) and built as a shipped package, cluttering a google-only
deliverable.

## Decision
Remove `_template` from the running backend (`APPS`, `app.module.ts`, docker,
migrate) and from the pnpm workspace (`!apps/_template-admin`), and exclude
`src/modules/_template/**` from backend tsconfig. **Keep the `_template` source
on disk** — the `vendor-scaffolder` skill copies it to scaffold future apps.

## Rationale
Satisfies "don't run/build the template" without breaking future scaffolding
(the skills depend on the template as the copy source), and there is no git to
recover a deletion. `/ready` is now google-only (`200 { google: ok }`).

## Consequences
`env.schema.test` was repointed from `_template` to `google` keys. New vendors
are still scaffolded from `_template`; if it is ever fully removed, the
scaffolder must gain a new source.
