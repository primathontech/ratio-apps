# TDD — Form Builder (`forms`)

> Test Plan / Test-Driven Design. Produced by `tdd-author` from the approved
> TRD, human-approved at **GATE 3** before any scaffolding. Builders write these
> tests first (failing), then implement to green. Runner: **Vitest**.

**Source PRD/TRD:** `docs/agent/apps/forms/PRD.md`, `TRD.md`
**Status:** draft

## 1. Test strategy

- **Unit (majority).** Services with mocked edges under
  `apps/backend/test/unit/apps/forms/*.test.ts`. DB mocked via the fake-Kysely
  helper (as in `webhooks.service.test.ts`); reCAPTCHA `siteverify`, S3, SES,
  SQS (`QueueService`), and Redis via injected fakes — **no network, no real
  AWS/Google**. Clock via `vi.useFakeTimers` (idempotency bucket, retry
  schedule, sweeper).
- **Integration (light, in-process).** Nest `Test.createTestingModule` per
  controller with services mocked — asserts routes, guards, guard ORDER, and
  validation wiring. No real MySQL.
- **Shared schema.** `packages/shared/src/schemas/forms-config.test.ts` and
  `form-schema.test.ts` — pure Zod accept/reject.
- **Frontend.** Vitest + Testing Library under `apps/admin-forms/src/**`,
  fetch mocked. dnd-kit interactions tested at the reducer/handler level
  (schema-state transitions), not via simulated pointer drags.
- **SDK.** `packages/forms-sdk` — Lit component logic tests (render from
  schema, client validation, submit flow) with fetch + grecaptcha mocked,
  mirroring `packages/wizzy-sdk` test layout.
- **Determinism:** idempotency keys asserted against precomputed golden
  sha256 digests; no real `Date.now()` outside fake timers.

## 2. Acceptance criteria → test mapping

| # | PRD acceptance criterion | Test case(s) |
|---|---|---|
| AC1 | Install seeds `forms_configs`; uninstall flips inactive, data preserved | `forms.bootstrap: seeds config row with defaults (threshold 0.30, enabled) idempotently (ODKU)`; `app-uninstalled.handler: is_active=false, forms/submissions untouched`; core dispatch regression stays green |
| AC2 | Create form (8 field types), reorder, validation config, publish; schema persists JSON | `form-schema (shared): accepts all 8 field types / rejects unknown type`; `forms.service: create persists schema_json stringified`; `forms.service: update replaces schema + bumps updated_at`; FE `builder-state: add/reorder/remove/configure field transitions`; FE `builder: publish PUTs formInputSchema-valid payload` |
| AC3 | Duplicate; active/inactive toggle; inactive → 403 `form_inactive` | `forms.service: duplicate copies schema/metadata, new id, status inactive`; `forms.service: activate/deactivate transitions`; `public-submissions: inactive form → 403 form_inactive` |
| AC4 | Soft delete: `deleted_at` set, hidden from list, storefront "no longer available", submissions retained | `forms.service: delete sets deleted_at only (no row removal)`; `forms.service: list excludes deleted`; `storefront schema GET: deleted → 404 form_not_available`; `submissions remain queryable for deleted form (export path)` |
| AC5 | SDK renders schema, client-validates, submits end-to-end | SDK `renders all 8 field types from schema`; `required blocks submit + inline error`; `email format / +91 10-digit phone / file type+size validated client-side`; `submit disabled after first click`; `success message shown on 200`; `closed message when schema GET 403/404` |
| AC6 | Public guard chain in order: rate limit → active → reCAPTCHA/honeypot → schema validation → idempotency | integration `public-submissions.controller: guard order` (each layer short-circuits before the next is consulted — spies); `submit-rate-limit: 6th submission in 10 min per (form,IP) → 429`; `recaptcha.service: score < threshold → silent reject (200 + fake id, nothing stored, rejected counter++)`; `recaptcha.service: siteverify unreachable → honeypot-only + warning log (F8)`; `honeypot mode: filled _hp → silent reject`; `schema-validator: required/regex/minmax/email/+91/file-key/textarea-5000 rejects → 422 with per-field errors`; `idempotency: same (form,session,5s bucket) second insert rejected (F10), golden digest` |
| AC7 | Submission stored (data JSON + S3 keys); admin list paginates/sorts/expands; signed URLs | `submissions.service: insert stores data_json + files_json`; `list: paginated (default 20, max 100), sorted created_at DESC`; `detail: generates signed GET URLs (7-day) for file fields`; `uploads: presigned PUT constrained to allowlisted content-type + ≤5MB, key = merchant/form/draft/field`; `uploads: oversize → 413, bad type → 422 (F2/F3)` |
| AC8 | CSV export full history | `csv-export: streams all rows (no full buffering — row-callback fake asserts chunked writes)`; `csv: header row = field keys union + submitted_at`; `csv: values escaped (commas/quotes/newlines)` |
| AC9 | Email notification enqueued; 1 retry after 10 min; status incl. bounce visible | `submissions.service: enqueues email job with recipient = form.notification_email ?? config default`; `email.worker: success → form_email_log sent`; `email.worker: provider failure → status pending, next retry +10min, second failure → failed`; `email.worker: bounce event → status bounced`; `config.get exposes bounce warning flag` |
| AC10 | `form.submitted` payload contract; retries 5m/20m/1h; failed w/ last status code; re-trigger; test payload | `webhook-delivery: payload matches contract (golden JSON incl. schema_version '1.0', file fields as signed URLs)`; `delivery-sweeper: enqueues only pending rows with next_retry_at <= now, batch ≤ merchant cap (100/min)`; `delivery.worker: 2xx → delivered`; `non-2xx attempt 1→ next_retry +5m, 2→ +20m, 3→ failed + last_status_code stored (F12/edge 10.8.6)`; `retrigger: failed → pending, next_retry now`; `webhook-test endpoint: sends dummy payload, returns response code` |
| AC11 | Kill switch: forms render unavailable; queue paused; drains on re-enable | `storefront schema GET: forms_enabled=false → 403 form_unavailable`; `public submit: kill switch → 403 (in-flight rejected, user-visible)`; `delivery-sweeper: skips merchants with forms_enabled=false`; `sweeper: re-enable → previously-pending rows enqueued (drain)` |
| AC12 | reCAPTCHA secret write-only + encrypted | `config.service: upsert encrypts recaptcha_secret (spy CryptoService, stored ≠ plaintext, round-trips)`; `config.get: returns hasRecaptchaSecret, never the secret`; `config.upsert: blank secret in payload → existing secret untouched`; FE `config form: secret field never pre-filled from GET` |
| AC13 | `pnpm -r lint && typecheck && build` (and `test`) pass | CI gate, §7 |

No orphan criteria; no orphan test groups.

## 3. Backend test cases (`apps/backend/test/unit/apps/forms/`)

### 3.1 `forms.service.test.ts`
create/update/list/detail/duplicate/toggle/soft-delete as mapped above, plus:
- `update of deleted form → 404`; `cross-merchant access → 404` (merchant scoping
  on every query — the multi-tenancy guard).
- `schema_json round-trip: JSON.stringify on write, parse on read`.

### 3.2 `schema-validator.service.test.ts`
Table-driven over the shared `form-schema`: for each field type, one accept +
the reject rows from PRD edge cases F4–F6, F11, F13 (required empty, bad email,
9-digit phone, missing required file, textarea > configured max, regex
mismatch, dropdown/multi-select value not in options, bad date). Unknown field
key in payload → rejected (no mass-assignment).

### 3.3 `recaptcha.service.test.ts` + `submit-rate-limit.service.test.ts`
As mapped in AC6, plus: `uses merchant secret when set, falls back to shared
env secret`; `threshold read from config (0.30 default)`; `secret never appears
in log lines (redaction spy)`; Redis limiter: `sliding window resets after 10
min (fake timers)`; `keys scoped (form,IP) — different form same IP not
counted together`.

### 3.4 `idempotency.service.test.ts`
Golden digest; 5s bucket boundary (4.9s dup rejected, 5.1s accepted — fake
timers); UNIQUE-violation from DB mapped to duplicate result, not 500.

### 3.5 `submissions.service.test.ts` + `csv-export.service.test.ts`
As mapped (AC7, AC8), plus `submission for form with no fields (misconfigured)
→ storefront schema GET omits render (10.10.6)`.

### 3.6 `uploads/s3.service.test.ts`
Presigned PUT params (bucket, key shape, content-type, content-length-range ≤
5MB); signed GET expiry = 7 days; `object key from another merchant's prefix
rejected at submit-time validation`.

### 3.7 `delivery/*.test.ts` (the state machine — highest risk)
`webhook-delivery.worker`, `email.worker`, `delivery-sweeper` cases as mapped
(AC9–AC11), plus: `worker never logs payload bodies (PII redaction spy)`;
`sweeper idempotent under double-fire (row locked/claimed once)`; `delivery row
created only when form has webhook_url`.

### 3.8 Controllers (integration, services mocked)
- `public-submissions.controller`: guard ORDER spy test (AC6); envelope shape
  on 403/422/429 matches the global error contract.
- `forms.controller` / `submissions.controller` / `config.controller`: merchant
  guard present on every admin route; Zod pipe rejects malformed bodies; CSV
  route sets `text/csv` + streams.
- `storefront.controller`: serves `/forms/sdk/:merchantId.js` with prelude +
  bundle, `Cache-Control` only on success (wizzy precedent); schema GET strips
  `notification_email`, `webhook_url`, secrets.

### 3.9 `forms.bootstrap.test.ts` + migration lockstep
Bootstrap seeds defaults idempotently inside the passed trx; `db/types.ts`
matches `0001_initial.ts` (typecheck enforces; one smoke test asserts table
names list).

## 4. Frontend test cases (`apps/admin-forms/src/**`)

- `builder-state.test.ts` — pure schema-state reducer: add field (all 8),
  reorder, remove, configure (label/placeholder/required/validation),
  duplicate-key prevention, undo-safe transitions. (This is where dnd-kit's
  callbacks land — test the transitions, not the drag gestures.)
- `builder.test.tsx` — loads form via `useForm(id)` hook, publish PUTs a
  payload that parses with `formInputSchema`; "Send test payload" calls the
  webhook-test endpoint and surfaces the response code; preview toggles
  mobile/desktop render of the same schema.
- `forms-list.test.tsx` — renders rows (name, status, count), toggle calls
  activate/deactivate, duplicate calls endpoint, delete shows the
  has-submissions warning before calling DELETE.
- `submissions.test.tsx` — paginated table, row expand shows all values +
  file links, Export CSV hits the export URL, delivery status badge +
  re-trigger button calls the endpoint.
- `config.test.tsx` — RHF + zodResolver(formsConfigInputSchema): threshold
  bounds, email format, secret write-only (never pre-filled, omitted when
  blank), bounce warning banner renders from `emailBounced` flag.
- `__root` gate chain untouched (template regression — render blocked without
  iframe/session/merchant).

## 5. Shared-schema test cases (`packages/shared/src/schemas/`)

- `forms-config.test.ts` — accept: full valid input, blank optional secret;
  reject: threshold > 1 or < 0, invalid email, non-boolean formsEnabled.
- `form-schema.test.ts` — accept: each of the 8 field types with full
  validation config; reject: unknown type, duplicate field keys, empty label,
  dropdown without options, file field with disallowed mime in config, min >
  max length; `formInputSchema` rejects empty name / missing schema.
- `forms-events.test.ts` — `form.submitted` golden payload parses; wrong
  `schema_version` rejected.

## 6. SDK test cases (`packages/forms-sdk/`)

Render-from-schema (8 types), client validation matrix (mirror of §3.2 —
same shared schema drives both), reCAPTCHA lazy-load (grecaptcha stub),
honeypot field rendered hidden + submitted, submit-once disable, presigned
upload flow (file → PUT → key attached to payload), success/closed/unavailable
states, responsive stacking snapshot.

## 7. Fixtures & helpers

- `fixtures/forms.ts` — factory: minimal contact form (name/email/message),
  kitchen-sink form (all 8 types + validations), misconfigured empty-schema
  form.
- `fixtures/submissions.ts` — valid payload per fixture form; invalid payload
  matrix (F4–F6, F10–F14 rows); golden idempotency digests.
- `fixtures/webhook-payload.json` — the golden `form.submitted` contract.
- Fakes: fake-Kysely (existing helper), `FakeQueueService` (records enqueues),
  `FakeRecaptcha` (scripted scores/outage), `FakeS3` (records presign params),
  `FakeSes`/`FakeEmailClient` (scripted success/failure/bounce), `FakeRedis`
  (in-memory sliding window).

## 8. Definition of done

- [ ] `pnpm verify` green (lint → typecheck → shared build → test → build).
- [ ] Every acceptance criterion in §2 has its mapped tests passing.
- [ ] No leftover `// TEMPLATE:` markers (code-reviewer gate).
