# Form Builder — Consolidated Functionality Punch-List

_Repo: `/home/eeshu/Desktop/ratio-apps-form-builder` · Consolidated from 5 review passes · De-duplicated_

No P0 defects were found. Ordering within each tier is most-severe first.

---

## P1

### P1-1 — ReDoS on public submit path via merchant-authored regex
- **Area:** Public intake / schema validation (platform-wide DoS, unauthenticated)
- **Failure scenario:** A merchant saves a text field with a catastrophic-backtracking `pattern` (e.g. `(a+)+$`, `(.*a){20}`) — accepted because `regexPatternSchema` only checks compilability + a 500-char cap. A shopper submits `{ <key>: "aaaa…!" }` (a few dozen chars); `new RegExp(pattern).test(value)` runs synchronously and pins the Node event loop. Because the backend is shared multi-tenant, one form takes down submissions/uploads/admin for every merchant. The 1 MB body limit gives no protection; regex is also recompiled per request.
- **Files:** `apps/backend/src/modules/forms/submissions/fields/text/validate.ts:12`; `packages/shared/src/schemas/fields/_shared/base.ts:84-98`
- **Fix direction:** Run submitter-input regex under a time/complexity budget (worker thread with timeout or a linear-time engine like `re2`), and/or lint patterns for backtracking at save time; cap tested-input length.
- **Note:** Flagged P3 in the schema-validation pass ("semi-trusted merchant"); the public-intake pass correctly escalates to P1 because it is reachable from the unauthenticated public endpoint and is platform-wide. **Take P1.**

---

## P2

### P2-1 — postMessage session listener trusts any origin when dashboard origin env is unset (security, insecure-by-default)
- **Area:** Admin auth / session bootstrap
- **Failure scenario:** `installPostMessageListener` sets `allowed = env ?? ''` and gates with `if (allowed && ev.origin !== allowed)`. With `VITE_RATIO_DASHBOARD_ORIGIN` empty/unset the origin check is skipped, so any window that can postMessage to the frame can send `{type:'ratio:session', merchantId}`; that merchantId is written to localStorage and used as the `Bearer` token, granting read/write to an attacker-chosen tenant's forms and submissions.
- **Files:** `apps/admin-forms/src/lib/session.ts:32-44`; installed in `apps/admin-forms/src/routes/__root.tsx:55-59`
- **Fix direction:** Bail out (reject the message) when `allowed` is empty rather than accepting all origins; fail closed on missing config.
- **Note:** Escalates to P1 if production is ever deployed without the env var set.

### P2-2 — Submit-time file validation accepts any object under the form prefix (per-field type/size allowlist bypass)
- **Area:** Uploads / submission validation
- **Failure scenario:** Per-field `allowedMimeTypes` and size caps are enforced only at presign time, keyed to the field the object was uploaded for. At submit, `validateFile` only checks the objectKey starts with `<merchantId>/<formId>/` — it does not verify the `<fieldKey>` suffix, re-check content-type/size against the submitting field, or confirm the object exists. A shopper uploads a 5 MB PDF via the `resume` field, then submits `files: { avatar: ".../draftX/resume" }`; the prefix matches so `avatar` (declared png/1 MB) stores a PDF. One object can also satisfy multiple required file fields, and a never-uploaded but syntactically-valid key yields a stored submission whose admin link 404s.
- **Files:** `apps/backend/src/modules/forms/submissions/fields/file/validate.ts:19`; `apps/backend/src/modules/forms/submissions/schema-validator.service.ts:63-71`; key format in `apps/backend/src/modules/forms/uploads/s3.service.ts` (`createUpload`)
- **Fix direction:** At submit, verify the objectKey's `<fieldKey>` matches the field, re-check the stored object's content-type/size against that field's allowlist/cap, and confirm the object exists.
- **Note:** Reported independently by the schema-validation and public-intake passes — same defect, merged. Impact is bounded: cross-merchant/cross-form isolation still holds (server-derived prefix, unguessable draftIds) and the platform allowlist (jpeg/png/webp/pdf) is always enforced at presign, so it is a config/data-integrity bypass, not RCE/XSS.

### P2-3 — Upload content-type allowlist is advisory; declared type never verified against bytes
- **Area:** Uploads
- **Failure scenario:** The allowlist gate trusts the client-declared `contentType`, and the presigned PUT signs that same value, so S3 only enforces that the PUT header matches the declared string — never that the bytes match. A shopper declares `image/png`, passes the allowlist, and uploads arbitrary bytes (HTML/script/executable). Stored and later served to admin via signed GET.
- **Files:** `apps/backend/src/modules/forms/uploads/uploads.controller.ts:89-101`; `apps/backend/src/modules/forms/uploads/s3.service.ts:86-108`
- **Fix direction:** Treat the allowlist as non-authoritative — sniff magic bytes / validate content server-side after upload (or on serve) rather than trusting the declared type. XSS-on-download is currently mitigated only incidentally by the falsified stored `Content-Type`.

### P2-4 — `number.step` enforced on client but not server (constraint bypass)
- **Area:** Schema validation
- **Failure scenario:** Field configured `min:0, step:5`. Client rejects `3`; a direct POST of `{ <key>: 3 }` passes server `validateNumber` (which checks only integer/min/max) and is persisted. Any merchant step constraint is bypassable.
- **Files:** `apps/backend/src/modules/forms/submissions/fields/number/validate.ts` (vs client `packages/forms-sdk/src/ui/fields/number/validate.ts`)
- **Fix direction:** Port the client "value must be a multiple of step from base" check into the server validator.

### P2-5 — `date` validation accepts non-dates and stores them un-normalized
- **Area:** Schema validation / data integrity
- **Failure scenario:** Both sides gate only on `!Number.isNaN(Date.parse(value))` and store the raw string. `"2026"`, `"July 2026"`, `"2026-02-30"`, `"12/31/2026"` all pass and round-trip verbatim into `data_json` → CSV/webhook. No normalization, no min/max.
- **Files:** `apps/backend/src/modules/forms/submissions/fields/date/validate.ts` (and client `date/validate.ts`)
- **Fix direction:** Require a strict ISO `YYYY-MM-DD` format, normalize to canonical ISO before storing, and support optional min/max.

### P2-6 — `multi_select` has no selection-count cap and no dedup
- **Area:** Schema validation / storage
- **Failure scenario:** Validation only checks each element is a string in `options`. A 2-option field accepts an array of thousands of duplicate valid options (bounded only by the 1 MB body limit), bloating `data_json` and CSV/webhook payloads.
- **Files:** `apps/backend/src/modules/forms/submissions/fields/multi_select/validate.ts` (+ shared `optionsSchema`)
- **Fix direction:** Reject duplicates and cap array length at the number of defined options (or an explicit max).

### P2-7 — Group fields (radio / multi_select / rating) have no accessible name
- **Area:** Storefront SDK render (accessibility)
- **Failure scenario:** `renderField` always emits `<label class="rf-label" for="rf-${field.key}">`, but for these three types the element carrying that id is a `<div>` (role=radiogroup / container), not a labelable control, so the binding is inert. A screen reader reads individual options but never the group's question ("Preferred contact method"); clicking the question text focuses nothing.
- **Files:** `packages/forms-sdk/src/ui/form-renderer.ts` (renderField, ~line 1034); `packages/forms-sdk/src/ui/fields/radio/render.ts`, `multi_select/render.ts`, `rating/render.ts`
- **Fix direction:** Point `aria-labelledby` at the label's id (or wrap in `<fieldset><legend>`) instead of using `<label for>` on a div.

### P2-8 — Checkbox and file controls never receive `aria-invalid` / `aria-describedby`
- **Area:** Storefront SDK render (accessibility)
- **Failure scenario:** `renderControl` computes `ctx.invalid`/`ctx.describedBy` and every other control wires them, but `renderCheckbox` and `renderFile` ignore both. A required unticked consent checkbox or a file failing the client size/MIME check shows the visible `.rf-error` text, but the input gets no `aria-invalid="true"` and no `aria-describedby` — screen-reader users are not told it is invalid and never hear the error.
- **Files:** `packages/forms-sdk/src/ui/fields/checkbox/render.ts`; `packages/forms-sdk/src/ui/fields/file/render.ts`
- **Fix direction:** Wire `ctx.invalid` → `aria-invalid` and `ctx.describedBy` → `aria-describedby` onto both inputs, as the other field types do.

### P2-9 — Async CSV export button stuck on "Preparing export…" when the poll errors or the job never settles
- **Area:** Admin flows
- **Failure scenario:** `exporting` clears only on job `ready`/`failed` or the `createExport` catch. `useExportJob`'s `refetchInterval` is keyed off `data?.status`; on a query error (network/500) `data` is `undefined`, so it returns `2000` and polls forever, and the settle-effect (`if (!jobId || !exportJob.data) return`) never fires. If the status GET 500s or the worker crashes leaving the job in `processing`, the button spins indefinitely with no error and no recovery except reload. `exportJob.isError` is never handled.
- **Files:** `apps/admin-forms/src/routes/submissions.$formId.tsx:59-92`; `apps/admin-forms/src/hooks/useSubmissions.ts:116-127`
- **Fix direction:** Handle `exportJob.isError` (surface the error and clear `exporting`), and add a max-poll/timeout for jobs that never leave `processing`.

### P2-10 — CSV export headers include non-collectable content-block fields (phantom columns)
- **Area:** Data integrity / export
- **Failure scenario:** The header is built from every field in `schema_json` without filtering via `isCollectableFieldType`. Content blocks (`heading`, `divider`, `paragraph`, `image`) carry a `key` but never produce a `data_json` entry, so they become permanent empty columns. The webhook (`buildTestPayload`) and validator both filter these, so only the CSV shape diverges from the actual data/webhook contract.
- **Files:** `apps/backend/src/modules/forms/submissions/csv-export.service.ts:53-55`
- **Fix direction:** Filter the header keys with `isCollectableFieldType` before writing, matching the webhook/validator behavior.

### P2-11 — CSV column collision when a field key equals `submitted_at`
- **Area:** Data integrity / export (adversarial edge case)
- **Failure scenario:** `submitted_at` is hard-appended as the timestamp column, but `formFieldKeySchema` permits `submitted_at` as a field key. A form with such a field emits two identical `submitted_at` columns; header-keyed CSV parsers collapse or mis-map them. (Webhook is immune — `fields` is a nested object.)
- **Files:** `apps/backend/src/modules/forms/submissions/csv-export.service.ts:55,88`
- **Fix direction:** Reserve `submitted_at` (and any other appended column names) in field-key validation, or namespace/de-collide the appended timestamp column.

---

## P3

### P3-1 — Delivery enqueue is not atomic with the submission insert
- **Area:** Public intake / delivery
- **Failure scenario:** The submission INSERT and `enqueueDeliveries` run outside a transaction. If one delivery-row insert succeeds and the other throws, the submission row exists but `submitPublic` returns 500; the client's retry lands in the 5 s idempotency bucket and gets 409, so delivery rows are never created — the submission is stored but silently never delivered.
- **Files:** `apps/backend/src/modules/forms/submissions/submissions.service.ts:179-210,445-473`
- **Fix direction:** Wrap the submission insert and delivery enqueue in one transaction (or make enqueue idempotently recoverable on retry).

### P3-2 — Duplicate (409) path discards the original submissionId
- **Area:** Public intake / idempotency UX
- **Failure scenario:** A client that submits, loses the response, and retries within the 5 s bucket gets `409 duplicate_submission` with no submissionId, so it cannot recover the id of the (successful, delivered) first submission. Additionally the time-bucket boundary (t=4.9 s vs 5.1 s) can produce two real submissions.
- **Files:** `apps/backend/src/modules/forms/submissions/submissions.service.ts:192-207`
- **Fix direction:** Return the original submissionId on the 409 (store/look it up by idempotency key) rather than a bare conflict.

---

## Explicitly verified sound (not re-flagged)
Server-side re-validation wiring, discriminated-union integrity (all 18 members), unknown value/file-key rejection (no mass-assignment), option-membership / format / bounds / length enforcement; number/rating and phone value-shape round-trips; client-vs-server URL strictness; submit body shape and public route paths; content-block exclusion from validation and submit loop; hidden-field capture; form save/clear round-trip, config write-only secret handling, activate/duplicate/delete, webhook retry/test, submissions list/detail pagination, field-key edit guarding, builder hydration; JSON persistence round-trip, migrations 0001–0004 reversibility, webhook payload shape, CSV file-cell object keys, nullish-coalescing of falsy values; spam-check ordering, recaptcha ordering/fallback, honeypot, `getPublicSchema` output whitelisting, prefix isolation, IP rate-limit keying, presigned size enforcement.

Two accepted design notes (not bugs): submit rate limiter fails open / per-process without Redis; `.strict()` doc-comment drift in `form-schema.ts:278` (field members silently strip unknown keys — safe, just not the claimed posture).