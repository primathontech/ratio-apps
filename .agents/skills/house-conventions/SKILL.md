---
name: house-conventions
description: Repo conventions for the agent-native ratio-apps boilerplate — commit format, file naming, the _template golden-path rule, the core/ boundary, env-key derivation, the slug rule, and the never-commit-secrets rule. A REFERENCE skill consulted by the worker skills; not a step in the flow.
when_to_use: Consult when you need to know how this repo names files, formats commits, derives env keys, what counts as the shared core/ boundary, what a valid vendor slug is, or what must never be committed. The vendor-scaffolder, builders, code-reviewer, and pr-author all defer to this.
---

# House conventions

These are the non-negotiable conventions for this monorepo. Every worker skill
defers to this file rather than inventing its own. When in doubt, match what the
`_template` golden module already does.

## The `_template` golden-path rule

`apps/backend/src/modules/_template/` and `apps/_template-admin/` are the **golden
template**. A new vendor app is **always** produced by copying and renaming the
template (see `vendor-scaffolder`) — never hand-rolled from scratch. The template
compiles, wires, and demonstrates every pattern; deviating from its structure
breaks the shared factory and the load-time assertions.

Inside the template, `// TEMPLATE:` marker comments flag exactly the spots a
vendor customizes (the SDK call in `sdk/sdk.service.ts`, the config fields, etc.).
After building a real vendor, **zero `// TEMPLATE:` markers** may remain.

## The `core/` boundary — shared infra, never forked

`apps/backend/src/core/` is shared infrastructure used by every vendor module:
crypto, OAuth base, Kysely DB factory, merchants, webhooks, health, ratio-client,
and common filters/guards/interceptors/pipes. The shared per-module provider
factory lives at `core/factories/app-module.factory.ts` (`createAppProviders`).

- **Extend `core/`, do not fork it per vendor.** A vendor module imports from
  `core/`; it never copies `core/` files into its own folder.
- If a vendor needs behavior `core/` doesn't offer, the correct move is to
  generalize the `core/` primitive (so all modules benefit), not to special-case
  it inside one vendor.

## Slug rule

A scaffolded vendor slug is **lowercase `[a-z0-9-]`** (letters, digits, dashes;
e.g. `loyalty`, `klaviyo`, `gift-cards`). The leading-underscore form
(`_template`) is **reserved for the boilerplate vendor only**.

The load-time guard in `apps/backend/src/config/apps.ts` accepts
`/^[a-z0-9_-]+$/` (so `_template` passes), but production vendors must stay
within plain `[a-z0-9-]` — the slug flows into runtime URL regexes (rate-limit
matchers in `main.ts`), so no regex metacharacters.

## Env-key derivation: `RATIO_<SLUG_UPPER>_*`

`apps/backend/src/config/env.schema.ts` derives env keys **per slug in `APPS`** by
uppercasing the slug. You do **not** edit `env.schema.ts` to add a vendor — adding
the slug to `APPS` makes the schema require these keys automatically:

For a slug `<slug>` (uppercased to `<SLUG>`):

```
RATIO_<SLUG>_DATABASE_URL          # per-module MySQL DSN
RATIO_<SLUG>_DATA_ENCRYPTION_KEY   # 44-char base64 (32 bytes) — required, validated
RATIO_<SLUG>_CLIENT_ID
RATIO_<SLUG>_CLIENT_SECRET
RATIO_<SLUG>_CALLBACK_URL          # must be a URL
RATIO_<SLUG>_ADMIN_BASE_URL        # must be a URL
```

Note the underscore arithmetic: slug `_template` uppercases to `_TEMPLATE`, so its
keys are `RATIO__TEMPLATE_*` (double underscore). A plain slug `loyalty` →
`RATIO_LOYALTY_*` (single). Generate an encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Commit format — conventional commits

`<type>(<scope>): <summary>`

- **type**: `feat` | `fix` | `chore` | `docs` | `refactor` | `test` | `build`.
- **scope**: the **vendor slug** when the change is vendor-specific
  (`feat(loyalty): ...`), or a top-level area otherwise (`feat(shared): ...`,
  `feat(backend): ...`, `docs(agent): ...`, `feat(skills): ...`).
- Summary is imperative, lowercase, no trailing period.

`docs/` is committed (the skills library, contracts, agent docs, and each build's context ARE the product); normal doc commits need no `-f`.

## File naming

- Backend module entry files are slug-prefixed:
  `<slug>.module.ts`, `<slug>.bootstrap.ts`. Subfolder files keep generic names
  (`config.controller.ts`, `config.service.ts`, `sdk.service.ts`, etc.).
- The per-vendor config DTO file mirrors the template: `config/<slug>-config.dto.ts`
  (template ships `config/_template-config.dto.ts`).
- Shared schemas: `packages/shared/src/schemas/<slug>-config.ts`; shared event
  constants: `packages/shared/src/constants/<slug>-events.ts`.
- Admin app dir: `apps/admin-<slug>/`; its package name is `@ratio-app/admin-<slug>`.
- Migrations: `apps/backend/src/modules/<slug>/db/migrations/NNNN_name.ts`
  (zero-padded, monotonically increasing — `0001_initial.ts`, `0002_...`).
- DI token consts are SCREAMING_SNAKE prefixed by the uppercased slug
  (`TEMPLATE_CRYPTO`, `LOYALTY_OAUTH`, …) and live in `tokens.ts`.

## Never commit secrets

- Never commit `.env`, `.env.production`, or any file containing a real
  `CLIENT_SECRET`, `DATA_ENCRYPTION_KEY`, access token, or DB password.
- `.env.example` holds **placeholders only** (empty secret values) — that is the
  file you edit when adding a vendor's env block.
- Encryption keys, OAuth tokens, and client secrets are encrypted at rest in the
  DB via `core/crypto`; they must never appear in source, logs, or commits.
