# PRD — <Vendor Name>

> Fill this in (or hand a rough draft to the `prd-architect` skill, which will
> structure it into this shape). Once complete and signed off (GATE 1), the
> `build-app` flow scaffolds and builds the vendor app from it.

## Vendor name & slug

- **Display name:** <e.g. Loyalty Points>
- **Slug:** <lowercase `[a-z0-9-]`, e.g. `loyalty`>
- **Storefront SDK?** <`yes` | `no` — does this app need a storefront
  search/discovery widget that runs in the merchant's storefront? Sets
  `hasStorefrontSdk` in STATE.json. Opt-in (default `no`); when `yes`, the build
  also scaffolds `packages/<slug>-sdk` and the backend `/<slug>/sdk/*` routes.>
- **API placement:** <`shared` | `dedicated` — use `shared` for an ordinary
  lightweight app; use `dedicated` when backend load, latency, secrets, or
  failure isolation require independent API scaling.>
- **Worker placement:** <`shared-api` | `dedicated-worker` | `none` — select
  `shared-api` only when the app has a lightweight queue consumer that may scale
  with the shared API pods.>
- **Placement rationale:** <expected request/queue load and why this isolation
  level is appropriate.>

The slug drives every derived name: the backend module
(`apps/backend/src/modules/<slug>/`), the admin app (`apps/admin-<slug>/`), the
URL prefix (`/<slug>/*`), the `RATIO_<SLUG_UPPER>_*` env keys, and — when a
storefront SDK is needed — the SDK package (`packages/<slug>-sdk/`).
The placement answers are stored in `STATE.json.deployment` and drive the
external EKS delivery configuration.

## Problem

<What merchant problem does this app solve? One or two paragraphs. Who uses it
and why.>

## Data model (tables / fields)

<The vendor-specific tables this module owns, beyond the standard `merchants`,
`oauth_tokens`, and `webhook_log` tables every module already has. For each:
table name, columns + types, primary key, and which columns hold secrets (those
get encrypted at rest).>

| Table | Column | Type | Notes |
|---|---|---|---|
| `<slug>_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| | `<field>` | `<type>` | <e.g. encrypted API key> |

## Scopes / permissions

<Ratio scopes the app needs to request, and why each is required.>

- `<scope>` — <why>

## Webhook events

<Ratio webhook topics the app subscribes to and what each handler does.
`app/uninstalled` is wired by default in the template.>

- `app/uninstalled` — flip merchant inactive (default).
- `<topic>` — <handler behavior>

## Admin screens

<The screens in the admin SPA. The template ships a config form and a
dashboard/landing route; list what to add or change.>

- **Config** — <fields the merchant edits>
- **Dashboard** — <what it shows>
- `<screen>` — <purpose>

## Acceptance criteria

<Concrete, checkable statements that define "done".>

- [ ] <e.g. Merchant can save config and it persists encrypted.>
- [ ] <e.g. `app/uninstalled` flips the merchant inactive.>
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.

## Out of scope

<Explicitly list what this build will NOT do, to bound the work.>

- <e.g. No multi-currency support in v1.>
