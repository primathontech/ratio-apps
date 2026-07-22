# `@ratio-app/forms-sdk` — storefront form renderer

The Lit web component that renders a merchant's published Form Builder forms
on their storefront (PRD "Storefront SDK", TRD §2 public routes).

## How it reaches the page

The backend serves `GET /forms/sdk/:merchantId.js` (see
`apps/backend/src/modules/forms/sdk/sdk.service.ts`) as:

1. a config prelude — `window.__FORMS_SDK_CONFIG__ = { merchantId, apiBase }`
2. the built `dist/forms-widget.js` bundle appended verbatim

The merchant pastes one script tag plus a mount per form:

```html
<script src="https://<backend>/forms/sdk/<merchantId>.js" defer></script>
<div data-ratio-form="FORM_ID"></div>
```

The widget registers `<ratio-form>` and upgrades every `[data-ratio-form]`
mount (`src/loader.ts#upgradeMounts`, idempotent).

## Public API contract (`src/client.ts`)

All endpoints live under `{apiBase}/public/v1` — deliberately unauthenticated;
responses use the backend's `{ data }` envelope, errors the
`{ message, error_code, details }` envelope:

| Call | Route | Errors handled |
|---|---|---|
| `getFormSchema(formId)` | `GET /forms/:formId` | 403 `form_inactive` (closed), 403 `form_unavailable` / 404 (unavailable) |
| `requestUpload(formId, {fieldKey, contentType, size})` | `POST /forms/:formId/uploads` | 413 / 422 / 429 |
| `uploadFile(target, blob)` | `PUT` to the presigned URL | non-2xx |
| `submit(formId, {fields, files?, sessionId, recaptchaToken?, _hp})` | `POST /forms/:formId/submissions` | 409 duplicate → success, 422 field errors, 429 |

## Renderer behaviour (`src/ui/form-renderer.ts`)

- All 8 field types (text / textarea / email / phone `+91` / dropdown /
  multi_select / date / file) with client-side validation mirroring the
  backend `SchemaValidatorService` rules.
- Hidden honeypot input named `_hp`; reCAPTCHA v3 script lazy-loaded only when
  `spamProtection === 'recaptcha'` and a site key is present, `grecaptcha.execute`
  on submit.
- File flow: client-side size/type check → presign → PUT → object key attached.
- Submit disabled after first click; success message on 200 (and on 409
  duplicate); "form closed" / "no longer available" states from 403/404.

## Bundles & budgets (`.size-limit.json`)

- `forms-loader.js` (IIFE) ≤ 3 KB — standalone mount scanner.
- `forms-widget.js` (ESM) ≤ 16 KB — raised from the template's 10 KB because
  the widget bundles the Lit runtime **plus** the entire form renderer
  (validation matrix, 8 field controls, upload + reCAPTCHA flows) in a single
  bundle by design: the backend inlines exactly one file after the prelude.
  Currently ~10.2 KB brotlied.
