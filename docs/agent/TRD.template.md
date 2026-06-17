# TRD — <Display Name> (`<slug>`)

> Technical Requirements / Design Document. Produced by `trd-architect` from the
> approved PRD, then human-approved at **GATE 2** before the test plan is written.
> Saved at `docs/agent/apps/<slug>/TRD.md`.

**Source PRD:** `docs/agent/apps/<slug>/PRD.md`
**Status:** draft | approved

## 1. Module shape
<!-- NestJS module/bootstrap/tokens/createAppProviders wiring, controllers,
     services — mirroring apps/backend/src/modules/_template/. -->

## 2. API routes
| Method | Path (`/<slug>/...`) | Auth guard | Request | Response | Purpose |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## 3. Data model / DB schema
<!-- Kysely tables, columns, indexes; the db/migrations/0001_initial.ts plan.
     One database per module: <slug>_app. -->

## 4. Ratio integration
- **Scopes:** <!-- confirmed scopes -->
- **Webhook topics + handlers:** <!-- e.g. app/uninstalled -->
- **OAuth / install:** merchant-initiated; callback + bootstrap behavior.

## 5. Config model
<!-- Per-merchant config fields → packages/shared <slug>-config Zod schema. -->

## 6. Non-functional requirements
- **Env keys:** `RATIO_<SLUG_UPPER>_*` (DATABASE_URL, DATA_ENCRYPTION_KEY,
  CLIENT_ID, CLIENT_SECRET, CALLBACK_URL, ADMIN_BASE_URL).
- **Security:** HMAC webhook verification; encryption-at-rest for tokens.
- **Limits / pagination / logging-redaction / performance budgets:**

## 7. Open questions / risks
<!-- Anything the human must decide before the test plan. -->
