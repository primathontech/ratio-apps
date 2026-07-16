# forms — build journal

Newest first. See PRD/TRD/TDD in this directory; STATE.json for phase/gates.

- **2026-07-15 — Published to sandbox via ngrok static domain.** One public
  origin serves everything: `https://untimed-zoie-flatly.ngrok-free.dev` →
  API + `/admin-forms/` (admin SPA via `SERVE_FORMS_ADMIN_DIST`) + `/forms/sdk/*`.
  OAuth callback registered: `<origin>/forms/api/v1/oauth/callback`. Ecosystem
  base per platform team: `https://api-gw-v4.dev.gokwik.in/sandbox/aes`.
  Client creds live in `.env` (never committed). Scopes: **none**; webhook:
  `app/uninstalled` only. ngrok free-tier interstitial handled (see learnings).
- **2026-07-14/15 — Local end-to-end run found 3 real bugs** (fixed, committed):
  relative SDK `apiBase` (breaks on merchant origins → absolute from request
  origin), bundle path assumed repo-root cwd (dev runs from apps/backend →
  probe both), no CORS on `/public/v1` for foreign origins (preflight 404 →
  wildcard hooks in main.ts).
- **2026-07-14 — Build complete on `feat/forms-app`** (branch deliberately
  separate from the delhivery working tree; entangled shared files committed
  as forms-only crafted versions). Gates 1–3 approved; clean-worktree verify:
  frozen-lockfile install, 0 typecheck/build failures; tests: shared 90,
  backend 148 forms (694 total), admin 38, sdk 35. Pre-existing base failures
  NOT from forms: admin-meta/admin-wizzy/wizzy-sdk lint, meta
  catalog-source-paging tests.
- **Key design decisions:** first-party app (no vendor API) — forms domain
  replaces the `sdk.service` vendor slot; DB-as-scheduler for webhook retries
  (SQS delay caps at 15m < 5m/20m/1h ladder; sweeper cron enqueues due rows,
  failed rows are the DLQ with admin re-trigger); one shared Zod
  `form-schema` consumed by admin builder + backend validator + SDK renderer;
  public intake guard order: edge rate bucket → Redis 5/10min per (form,IP) →
  kill-switch/active → reCAPTCHA (silent reject, honeypot fallback) → schema
  re-validation → sha256 idempotency (5s bucket).
- **Pre-GA TODOs:** rebuild admin with `VITE_REQUIRE_IFRAME=true` + confirm
  dashboard host suffix (`.gokwik.io` not in the allowlist); real hosting
  (admin → static host, backend → stable domain) removes all ngrok workarounds;
  S3 bucket + SES sender + SQS queues to activate uploads/email/webhook
  workers (env-gated no-ops today); retention policy (PRD open Q2).
