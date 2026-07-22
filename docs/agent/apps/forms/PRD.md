# PRD — Form Builder

> Structured from the product team's PRD at
> `update/Form Builder - PRD.md` (Ratio PRD template v2, owner: Aakash Singh,
> target JAS-2026). This is the repo-shaped build spec; the source PRD remains
> the product source of truth for rationale, metrics, and rollout.

## Vendor name & slug

- **Display name:** Form Builder
- **Slug:** `forms`
- **Storefront SDK?** `yes` — the form renderer runs on the merchant's
  storefront (Lit web component that fetches the form schema, renders fields,
  validates client-side, runs reCAPTCHA v3, and POSTs submissions). Scaffolds
  `packages/forms-sdk` and the backend `/forms/sdk/*` routes. Reference impl:
  `packages/wizzy-sdk`.

**First-party app, no external vendor API.** Unlike every existing app in this
repo, there is no third-party service to integrate — the forms domain logic
(schema CRUD, submission intake, fan-out) IS the product. The `sdk/sdk.service.ts`
"vendor integration" slot becomes the forms domain services.

## Problem

Merchants on Ratio cannot create custom forms (contact, inquiry, waitlist,
feedback) without Ratio engineers hardcoding them into the theme. There is no
self-service builder, no submission storage, and no way to forward submissions
to CRM/engagement tools. Merchants pay Typeform/JotForm separately for
something the platform should provide.

**Users:** merchants and their marketing teams (create/publish forms, work
leads), Ratio onboarding managers (create a merchant's first form without a dev
team), end shoppers (fill forms on the storefront).

**v1 success:** a merchant creates a working contact form and deploys it to
their storefront in < 15 minutes; submissions appear in Admin and trigger a
KwikEngage flow via webhook.

## Data model (tables / fields)

Beyond the standard `merchants`, `oauth_tokens`, `webhook_log`:

| Table | Column | Type | Notes |
|---|---|---|---|
| `forms_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id`; seeded on install by bootstrap |
| | `recaptcha_site_key` | varchar(255) NULL | reCAPTCHA v3 site key (shared Ratio key default; per-merchant override) |
| | `recaptcha_secret_enc` | text NULL | **secret, AES-256-GCM encrypted** |
| | `recaptcha_threshold` | decimal(3,2) | default 0.30 |
| | `default_notification_email` | varchar(320) NULL | fallback recipient |
| | `forms_enabled` | boolean | per-merchant kill switch (default true once installed) |
| | `created_at` / `updated_at` | timestamp | |
| `forms` | `id` | varchar(64) PK | e.g. `form_<nanoid>` |
| | `merchant_id` | varchar(128) | indexed, FK → `merchants.id` |
| | `name` | varchar(255) | internal label |
| | `schema_json` | json | ordered field array: `{key,type,label,placeholder,required,validation,options}` per field; types: text, textarea, email, phone, dropdown, multi-select, date, file |
| | `submit_label` | varchar(100) | button text |
| | `success_message` | text | shown after submit |
| | `spam_protection` | enum('recaptcha','honeypot') | default `recaptcha` |
| | `notification_email` | varchar(320) NULL | per-form recipient; falls back to config default |
| | `webhook_url` | varchar(2048) NULL | merchant's `form.submitted` consumer (e.g. KwikEngage inbound URL) |
| | `status` | enum('active','inactive') | inactive → storefront shows "form closed", POST rejected 403 |
| | `deleted_at` | timestamp NULL | **soft delete only** |
| | `created_at` / `updated_at` | timestamp | |
| `form_submissions` | `id` | varchar(64) PK | `sub_<nanoid>` |
| | `form_id` | varchar(64) | indexed |
| | `merchant_id` | varchar(128) | indexed |
| | `data_json` | json | field key → value map |
| | `files_json` | json NULL | field key → S3 object key |
| | `recaptcha_score` | decimal(3,2) NULL | null when honeypot mode |
| | `idempotency_key` | varchar(128) UNIQUE | hash(form_id + session + 5s bucket) — dedup |
| | `created_at` | timestamp | indexed (list sort + export) |
| `form_webhook_deliveries` | `id` | bigint PK AI | one row per submission with webhook configured |
| | `submission_id` / `form_id` / `merchant_id` | varchar | indexed |
| | `url` | varchar(2048) | endpoint at enqueue time |
| | `status` | enum('pending','delivered','failed') | failed after 3 attempts → manual re-trigger |
| | `attempts` | tinyint | retry schedule 5m / 20m / 1h |
| | `last_status_code` | smallint NULL | shown in Admin ("Failed: 404") |
| | `next_retry_at` | timestamp NULL | |
| | `created_at` / `updated_at` | timestamp | |
| `form_email_log` | `id` | bigint PK AI | notification email delivery status |
| | `submission_id` / `merchant_id` | varchar | indexed |
| | `recipient` | varchar(320) | |
| | `status` | enum('pending','sent','failed','bounced') | 1 retry after 10 min; bounce → warning banner in Admin |
| | `created_at` / `updated_at` | timestamp | |

**Secrets encrypted at rest:** `recaptcha_secret_enc` only. Submission data is
PII but not a credential — stored plain JSON in the module-private DB.

## Scopes / permissions

None beyond the app install identity. Form Builder reads/writes only its own
module database; it does not touch orders, products, or customers. (Storefront
placement is via SDK script/iframe embed, which needs no scope.)

## Webhook events (inbound, from Ratio)

- `app/uninstalled` — flip merchant inactive (default handler); forms and
  submissions preserved for reinstall.

No other inbound topics. (The app's own **outbound** `form.submitted` webhook to
merchant endpoints is app infrastructure, not a Ratio webhook — see admin
screens + acceptance criteria.)

## Admin screens

- **Forms list** (index) — table of the merchant's forms: name, status
  (active/inactive toggle), submission count, created date; actions: edit,
  duplicate, soft-delete (warn when submissions exist / form is placed),
  New Form.
- **Form builder** (`/forms/:id/edit`) — the core screen: field palette (left)
  + canvas (right); drag to add and reorder (dnd-kit); per-field settings
  (label, placeholder, required, validation: regex / min-max length; phone =
  +91 prefix + 10-digit; file = jpeg/png/webp/pdf ≤ 5MB); form metadata (name,
  submit label, success message); spam protection choice; notification email;
  webhook URL with **Send test payload** button; side-by-side mobile/desktop
  preview; Publish.
- **Submissions** (`/forms/:id/submissions`) — paginated table sorted by date,
  row expands to full submission (file answers via 7-day signed S3 URLs),
  **Export CSV** (full history), webhook delivery status per submission with
  **re-trigger** for failed deliveries.
- **Config** — merchant-level settings: reCAPTCHA (shared key default,
  per-merchant override, write-only secret, threshold), default notification
  email (with bounce warning banner), kill switch.
- **Install/embed** — script-tag + iframe embed instructions per form
  (ScriptTagPanel pattern).

## Storefront SDK (`packages/forms-sdk`)

Lit web component served per-merchant at `/forms/sdk/:merchantId.js`. Fetches
the form schema (no caching), renders responsive fields, client-side
validation, invisible reCAPTCHA v3, honeypot field, disables submit after
first click, POSTs to the public submission endpoint, shows success message or
inline errors. Inactive/deleted form → "This form is closed / no longer
available."

## Public API surface (the novel piece — flag for TRD)

`POST /forms/api/v1/forms/:formId/submissions` is **public and
unauthenticated** — the first such endpoint in this repo (existing guards are
merchant-token or webhook-HMAC only). Guard chain: per-IP rate limit
(5/10 min via the `main.ts` rate-limit buckets) → form active check →
reCAPTCHA v3 server-side verify against threshold (silent reject below;
reCAPTCHA API down → honeypot-only fallback + warning log) → schema
re-validation server-side → idempotency dedup → insert → enqueue email +
webhook jobs (SQS, worker pattern per `GoogleProductSyncWorker`). File uploads
go direct to S3 via presigned URL before submit; 413 on >5MB, reject
unsupported types.

## Acceptance criteria

- [ ] Install flow works: OAuth callback upserts merchant, seeds
  `forms_configs`; `app/uninstalled` flips inactive, data preserved.
- [ ] Merchant can create a form in the builder (all 8 field types), reorder
  fields, configure validation, and publish; schema persists as JSON.
- [ ] Merchant can duplicate a form and toggle active/inactive; inactive forms
  reject submissions with 403 `form_inactive`.
- [ ] Delete is soft: `deleted_at` set, form hidden from list, storefront
  renders "no longer available", submissions retained.
- [ ] Storefront SDK renders a published form from its schema, validates
  client-side (required, email format, +91 10-digit phone, file ≤ 5MB +
  type), and submits successfully end-to-end.
- [ ] Public submission endpoint enforces, in order: IP rate limit, active
  check, reCAPTCHA verify (threshold from config; honeypot fallback when
  reCAPTCHA unavailable), server-side schema validation, idempotency (dup
  within 5s rejected).
- [ ] Submission stored with data JSON + S3 file keys; Admin submissions list
  paginates, sorts by date, expands rows, serves files via signed URLs.
- [ ] CSV export downloads the full submission history for a form.
- [ ] Email notification enqueued per submission; failure retried once after
  10 min; status (incl. bounce) visible in Admin.
- [ ] `form.submitted` webhook delivered with the documented payload
  (event, merchant_id, form_id, form_name, submitted_at, submission_id,
  fields, schema_version "1.0"); non-2xx retried at 5m/20m/1h; after 3
  failures marked failed with last status code; manual re-trigger works;
  "Send test payload" works from the builder.
- [ ] Kill switch (`forms_enabled=false`) makes all forms render "temporarily
  unavailable" and pauses the webhook queue; re-enable drains it.
- [ ] reCAPTCHA secret is write-only in Admin (GET returns `hasSecret`), stored
  encrypted.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.

## Out of scope

- **Visual Editor "Form" section type** — platform-side change owned by the
  core team; v1 ships with SDK script/iframe embed only. Raise as a platform
  ask in parallel (pattern: `update/Core Team — Native Fields Request.md`).
- Payment/checkout fields (GoKwik's domain).
- Conditional logic, multi-step forms, partial submissions (v2).
- Direct CRM integrations (Clevertap/Moengage/HubSpot) — webhook covers v1.
- International phone country picker (+91 only in v1).
- Custom redirect URL after submit (v1.1), custom sender domain (Phase 2).
- Survey/NPS features; forms embedded in email.
- Submission retention auto-deletion (policy TBD with Legal — manual for now).

## Infrastructure prerequisites (before pilot; flag for TRD)

1. **Transactional email provider** (Resend/Postmark or Ratio-managed) + sender
   domain (`noreply@ratio.store`) — net-new, nothing in the repo sends email.
2. **S3 bucket** with per-merchant prefixes; presigned upload, signed 7-day
   download URLs.
3. **reCAPTCHA v3 keys** — shared Ratio key to start, per-merchant override
   supported in config.
4. **Two SQS queues** (email, webhook delivery) + DLQ, drained by self-gating
   workers (`FORMS_EMAIL_WORKER_ENABLED`, `FORMS_WEBHOOK_WORKER_ENABLED`).
