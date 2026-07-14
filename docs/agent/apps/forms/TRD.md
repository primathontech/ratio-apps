# TRD — Form Builder (`forms`)

> Technical Requirements / Design Document. Produced by `trd-architect` from the
> approved PRD, then human-approved at **GATE 2** before the test plan is written.

**Source PRD:** `docs/agent/apps/forms/PRD.md`
**Status:** draft

## 1. Module shape

Standard `_template` copy at `apps/backend/src/modules/forms/`, wired via
`createAppProviders<FormsDatabase>({ slug: 'forms', ... })`. The usual triad
(oauth, webhooks-inbound, merchants, config) is unchanged from the template.
The forms domain replaces the template's `sdk/sdk.service.ts` vendor slot.

```
apps/backend/src/modules/forms/
├─ tokens.ts                    5 DI symbols: Symbol.for('ratio-app:forms:*')
├─ kysely.module.ts             FORMS_DB_TOKEN ← RATIO_FORMS_DATABASE_URL
├─ forms.module.ts              assembly (controllers, services, workers, guards, createAppProviders)
├─ forms.bootstrap.ts           seeds forms_configs row on install
├─ guards.ts                    FormsMerchantTokenGuard, FormsWebhookSignatureGuard (template)
│                               + PublicFormGuard (NEW — see §2)
├─ config/                      config.controller.ts + config.service.ts (merchant settings)
├─ forms/                       forms.controller.ts + forms.service.ts (form CRUD, duplicate,
│                               activate/deactivate, soft delete)
├─ submissions/                 public-submissions.controller.ts (public intake)
│                               submissions.controller.ts (admin list/export)
│                               submissions.service.ts, schema-validator.service.ts,
│                               idempotency.service.ts, csv-export.service.ts
├─ spam/                        recaptcha.service.ts (server-side siteverify + threshold,
│                               honeypot fallback), submit-rate-limit.service.ts (Redis,
│                               5 per 10 min per form+IP)
├─ uploads/                     uploads.controller.ts + s3.service.ts (presigned PUT,
│                               signed GET 7-day expiry, type/size constraints)
├─ delivery/                    webhook-delivery.queue.ts + webhook-delivery.worker.ts
│                               + delivery-sweeper.service.ts (cron)
│                               email-notification.queue.ts + email.worker.ts + email.client.ts
├─ storefront/                  storefront.controller.ts — serves /forms/sdk/:merchantId.js
│                               + public form-schema read (mirrors modules/wizzy/storefront/)
├─ oauth/ webhooks/ merchants/  template-standard (app/uninstalled handler)
└─ db/                          types.ts + migrations/0001_initial.ts
```

**Queue/worker pattern** mirrors `modules/google/gmc/google-product-sync.worker.ts`:
self-gating workers (`FORMS_WEBHOOK_WORKER_ENABLED`, `FORMS_EMAIL_WORKER_ENABLED`)
running in-process in dev and in `main.worker.ts` (svc-worker) in prod, consuming
SQS via `core/queue/queue.service.ts`.

**Retry scheduling (design decision):** SQS `DelaySeconds` caps at 15 min, but
retries are 5m/20m/1h. Therefore the **DB is the scheduler**: delivery rows carry
`next_retry_at`; a `@nestjs/schedule` cron (every minute, precedent: google's
`reconcile.service.ts`) enqueues due `pending` rows to SQS; the worker attempts
and updates the row. "Failed after 3 attempts" = `status:'failed'` row (the
"dead letter" the Admin shows); manual re-trigger flips it back to `pending`
with `next_retry_at = now`. The same sweeper drives the email retry (1× after
10 min). Kill switch pauses the sweeper per merchant (rows accumulate as
`pending`, drain on re-enable).

## 2. API routes

Prefixes: `api` = admin (FormsMerchantTokenGuard, Bearer merchantId), `public/v1`
= shopper-facing (PublicFormGuard chain), plus template-standard OAuth/webhook/SDK.

| Method | Path (`/forms/...`) | Auth guard | Request | Response | Purpose |
|---|---|---|---|---|---|
| GET | `/api/merchants/me` | merchant | — | merchant | template standard (admin gate) |
| GET | `/api/forms-config` | merchant | — | config (secret → `hasRecaptchaSecret`) | merchant settings |
| PUT | `/api/forms-config` | merchant | `formsConfigInputSchema` | config | save settings (secret write-only) |
| POST | `/api/forms` | merchant | `formInputSchema` | form | create form |
| GET | `/api/forms` | merchant | `?page&limit` | form list + submission counts | forms list screen |
| GET | `/api/forms/:id` | merchant | — | form (full schema) | builder load |
| PUT | `/api/forms/:id` | merchant | `formInputSchema` | form | builder save/publish |
| DELETE | `/api/forms/:id` | merchant | — | 204 | soft delete (`deleted_at`) |
| POST | `/api/forms/:id/activate` · `/deactivate` | merchant | — | form | status toggle |
| POST | `/api/forms/:id/duplicate` | merchant | — | new form (inactive) | duplicate |
| POST | `/api/forms/:id/webhook-test` | merchant | — | delivery result | "Send test payload" |
| GET | `/api/forms/:id/submissions` | merchant | `?page&limit&sort` | paginated submissions | submissions screen |
| GET | `/api/forms/:id/submissions/export` | merchant | — | `text/csv` stream | CSV export |
| GET | `/api/submissions/:id` | merchant | — | submission + signed file URLs | row expand |
| GET | `/api/forms/:id/deliveries` | merchant | `?page` | delivery log | webhook status view |
| POST | `/api/deliveries/:id/retrigger` | merchant | — | delivery | manual re-trigger of failed |
| GET | `/public/v1/forms/:formId` | public-read | — | render schema (active only; no secrets/emails/webhook URL) | SDK schema fetch |
| POST | `/public/v1/forms/:formId/uploads` | PublicFormGuard | `{fieldKey, contentType, size}` | presigned PUT URL + object key | file upload before submit |
| POST | `/public/v1/forms/:formId/submissions` | PublicFormGuard | `{fields, files?, recaptchaToken?, _hp?}` | `{submissionId}` / 403 / 429 / 422 | THE public intake |
| GET | `/sdk/:merchantId.js` | none (600/min bucket) | — | JS bundle + config prelude | storefront SDK (wizzy pattern) |
| GET | `/api/v1/oauth/callback` | none (10/min) | `?code` | redirect | install (core) |
| POST | `/api/v1/oauth/webhook` | HMAC signature | envelope | 200 | inbound Ratio webhooks |

**PublicFormGuard chain (NEW pattern — first unauthenticated write endpoint in
the repo), in order:**

1. **Edge rate limit** — new bucket in `main.ts` `classify()`:
   `^/(slug)/public/v1/` POST → **10/min per IP** (coarse DoS floor). Update the
   regex list + comment block together per house rules.
2. **App-level business limit** — `submit-rate-limit.service.ts` via ioredis:
   **5 submissions per 10 min per (form, IP)** (PRD F14), sliding window.
3. **Form state** — exists, not deleted, `status:'active'`, merchant
   `forms_enabled` (kill switch) → else 403 `form_inactive` / `form_unavailable`.
4. **Spam check** — mode `recaptcha`: server-side `siteverify` with the
   merchant's secret (fallback: shared Ratio secret), reject score < threshold
   **silently** (return 200 + fake submissionId, increment rejected counter; PRD
   F7); reCAPTCHA API unreachable → honeypot-only + warning log (F8). Mode
   `honeypot`: hidden field `_hp` must be empty.
5. **Schema validation** — re-validate every field server-side against
   `schema_json` (required, regex, min/max, email format, +91 10-digit phone,
   file field: object key exists + belongs to this form).
6. **Idempotency** — `idempotency_key = sha256(formId + sessionId + 5s bucket)`;
   `INSERT IGNORE`-style dedup via the UNIQUE column (F10).

Steps 5–6 live in the service (need the form row); 1–4 in guard + services.
Textarea max length: 5,000 default, merchant-raisable to 10,000 (F13).

## 3. Data model / DB schema

One database: `forms_app` (+ `forms_app_test`), added to
`docker/mysql/init/01-database.sql`. Migration
`db/migrations/0001_initial.ts` creates the template-standard `merchants`,
`oauth_tokens`, `webhook_log`, plus (exactly as specified in the PRD data-model
table): `forms_configs`, `forms`, `form_submissions`, `form_webhook_deliveries`,
`form_email_log`.

Indexes: `forms(merchant_id, deleted_at)`, `form_submissions(form_id,
created_at DESC)`, `form_submissions(idempotency_key UNIQUE)`,
`form_webhook_deliveries(status, next_retry_at)` (the sweeper's scan),
`form_email_log(status, updated_at)`. JSON columns written with explicit
`JSON.stringify`; `INSERT … ON DUPLICATE KEY UPDATE` for config upserts (house
convention). `db/types.ts` kept in lockstep.

## 4. Ratio integration

- **Scopes:** none (module-private data only; storefront via SDK embed).
- **Webhook topics + handlers:** `app/uninstalled` → default handler flips
  `merchants.is_active=false`; forms/submissions/config preserved for
  reinstall. ⚠ Verify the live topic string (slash-form) against a real
  delivery (learnings.md gotcha).
- **OAuth / install:** merchant-initiated; core `OAuthService` handles the
  callback transaction; `FormsBootstrap.run(trx, merchantId)` seeds
  `forms_configs` (recaptcha_threshold 0.30, forms_enabled true, shared-key
  mode). Token refresh remains the platform-wide TODO — no impact (the app
  never calls Ratio APIs post-install).

## 5. Config model

`packages/shared/src/schemas/forms-config.ts`:

- `formsConfigInputSchema` (PUT): `recaptchaSiteKey?`, `recaptchaSecret?`
  (write-only, omitted when blank), `recaptchaThreshold` (0–1, default 0.3),
  `defaultNotificationEmail?` (email), `formsEnabled` (boolean).
- `formsConfigSchema` (GET): same minus secret, plus `hasRecaptchaSecret`.

**Also shared (the keystone):** `packages/shared/src/schemas/form-schema.ts` —
the Zod schema of the form definition itself (`formFieldSchema` discriminated
union over the 8 field types + per-type validation config, `formInputSchema`
for form CRUD). **One schema validates in three places:** the admin builder
(react-hook-form), the backend (`schema-validator.service.ts` + form CRUD DTO),
and the SDK (submission pre-validation). Plus
`packages/shared/src/constants/forms-events.ts`: the `form.submitted` payload
type + `FORM_SUBMITTED_SCHEMA_VERSION = '1.0'`. Barrel exports in
`packages/shared/src/index.ts`.

**`form.submitted` payload** (documented contract): `{ event, merchant_id,
form_id, form_name, submitted_at, submission_id, schema_version, fields }` —
file fields as signed URLs (7-day).

## 6. Non-functional requirements

- **Env keys (standard six, auto-derived from APPS):** `RATIO_FORMS_DATABASE_URL`,
  `RATIO_FORMS_DATA_ENCRYPTION_KEY` (44-char base64), `RATIO_FORMS_CLIENT_ID`,
  `RATIO_FORMS_CLIENT_SECRET`, `RATIO_FORMS_CALLBACK_URL`,
  `RATIO_FORMS_ADMIN_BASE_URL`. Documented in `.env.example` only — never edit
  `env.schema.ts`.
- **Module-specific env (Google-worker precedent, module-validated):**
  `FORMS_WEBHOOK_WORKER_ENABLED`, `FORMS_EMAIL_WORKER_ENABLED`,
  `FORMS_WEBHOOK_QUEUE_URL`, `FORMS_EMAIL_QUEUE_URL`, `FORMS_S3_BUCKET`,
  `FORMS_S3_REGION`, `FORMS_RECAPTCHA_SHARED_SECRET`,
  `FORMS_RECAPTCHA_SHARED_SITE_KEY`, `FORMS_EMAIL_FROM`
  (`noreply@ratio.store`), `FORMS_EMAIL_PROVIDER_API_KEY`.
- **Security:** inbound webhook HMAC (core); OAuth tokens + reCAPTCHA secret
  AES-256-GCM at rest; public endpoints never receive/return other merchants'
  data (form → merchant resolved server-side); presigned uploads constrained
  by content-type allowlist (`image/jpeg|png|webp`, `application/pdf`) +
  5 MB `content-length-range`; S3 objects keyed
  `<merchantId>/<formId>/<submissionOrDraftId>/<fieldKey>` — never public-read.
- **PII / logging redaction:** submission bodies are PII — never logged
  (RatioClient never-log-bodies rule extends to submissions, email addresses,
  webhook payloads). Delivery log stores status codes, not response bodies.
- **Pagination / limits:** submissions default 20/page (max 100); CSV export
  streams (no full-table buffering); webhook fan-out ≤ 100/min per merchant
  (PRD watch-out) enforced by sweeper batch size.
- **Performance budgets:** SDK bundle lazy-loads the reCAPTCHA script (< 100ms
  LCP impact budget, PRD §13); schema GET uncached by design (PRD 10.10.5) but
  cheap (single indexed PK read).
- **Rate-limit source of truth:** the new `/public/v1/` bucket lives in
  `main.ts` alongside the existing regexes (no decorators), comment block
  updated in the same edit.

## 7. Open questions / risks

1. **Email provider:** recommend **AWS SES** (stack already carries AWS SDK +
   creds for SQS/S3; Resend/Postmark would add a vendor). Decide at GATE 2.
2. **Redis dependency:** the 5/10min business limiter assumes ioredis (already
   in the stack for cache). Confirm Redis is provisioned in the target envs.
3. **Silent-reject UX (F7):** returning a fake success to suspected bots is the
   PRD's spec; confirm merchants accept that these submissions are counted but
   not stored (Admin shows a rejected counter from a lightweight metric, not
   full rows).
4. **Shared reCAPTCHA key at launch** (PRD open Q1): design supports both;
   launch shared, per-merchant override already in config.
5. **Retention** (PRD open Q2): no auto-deletion in v1; S3 lifecycle rule
   (1 year) can be set on the bucket without code.
6. **Biggest schedule risk:** the drag-and-drop builder UI — new `dnd-kit`
   dependency in `apps/admin-forms`, largest screen this repo has built. Figma
   mocks still TBD; wireframes exist (`update/../html/wireframes/form-builder.html`).
