---
name: prd-architect
description: Turn a plain idea or rough PRD into a structured docs/agent/apps/<slug>/PRD.md (from docs/agent/PRD.template.md) for a new vendor app — deriving and validating the slug, the data model, scopes, webhooks, admin screens, and acceptance criteria — then initialize STATE.json and STOP at GATE 1 (PRD sign-off) until a human explicitly approves.
when_to_use: The first worker phase of build-app. Use when the user hands you an app idea or rough PRD and wants it structured before any code is written. Produces the PRD and the initial state file, then pauses for human approval — does NOT scaffold or build.
---

# prd-architect

You convert an idea (or rough draft) into a complete, signed-off PRD for one
vendor app, then **stop and wait** for human approval. You write **no code** and
scaffold **nothing** — that is the next phase, and only after GATE 1.

Consult `house-conventions` (slug rule) and `context-keeper` (state file).

## Steps

### 1. Read state, restore context

Read `docs/agent/apps/<slug>/STATE.json` if a slug is known. If this is a fresh
build there is no state yet — you will create it in step 5.

### 2. Derive and validate the slug

From the vendor/display name, derive a **lowercase `[a-z0-9-]`** slug (e.g.
"Loyalty Points" → `loyalty`, "Gift Cards" → `gift-cards`).

- Validate it matches `^[a-z0-9-]+$`. Reject anything with uppercase, spaces,
  underscores, or dots. The leading-underscore form is reserved for `_template`.
- Confirm it isn't already taken: it must NOT already be in the `APPS` tuple
  (`apps/backend/src/config/apps.ts`) and `apps/admin-<slug>/` must not exist.
- If the derived slug is ambiguous or already taken, ask the user to confirm/choose.

### 3. Fill the PRD from the template

Copy `docs/agent/PRD.template.md` to `docs/agent/apps/<slug>/PRD.md` and complete
every section. Derive content from the idea; ask the user to fill genuine gaps —
do not invent requirements.

- **Vendor name & slug** — display name + validated slug, and the **Storefront
  SDK?** answer. Set it to `yes` when the app has a storefront
  search/discovery/widget surface that runs in the merchant's storefront — that
  becomes `hasStorefrontSdk: true` in STATE.json (default `no`/false; most apps,
  including the analytics vendors, are false).
- **Deployment placement — ask explicitly; never infer silently.**
  - API: `shared` or `dedicated`.
  - Worker: `shared-api`, `dedicated-worker`, or `none`.
  - Recommend `shared` for ordinary lightweight apps. Recommend `dedicated`
    when expected HTTP/catalog/event volume, latency sensitivity, secrets,
    vendor throttling, or failure isolation needs independent scaling.
  - Use `shared-api` only for a lightweight SQS consumer that may scale with the
    shared API replica count. Use `dedicated-worker` for heavy/batched consumers
    or independent backlog scaling. Record the human-approved rationale.
- **Problem** — the merchant problem, who uses it, why.
- **Data model** — the vendor-specific tables beyond the standard `merchants`,
  `oauth_tokens`, `webhook_log` (every module already has those). For each new
  table: name (`<slug>_configs`, plus any others), columns + types, PK, and which
  columns hold secrets (encrypted at rest). At minimum a `<slug>_configs` table.
- **Scopes / permissions** — the Ratio scopes the app requests and why each is
  needed.
- **Webhook events** — topics subscribed to and what each handler does.
  `app/uninstalled` is wired by default; list any others.
- **Admin screens** — the config form (which fields) plus dashboards/screens.
- **Acceptance criteria** — concrete, checkable statements, always including
  `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.
- **Out of scope** — bound the work explicitly.

### 4. Sanity-check feasibility

The data model maps to a Kysely migration; scopes/webhooks map to handlers; admin
screens map to routes. If anything in the PRD can't be built on the
`_template` golden path (see `stack-patterns`), flag it now, before sign-off.

### 5. Initialize STATE.json

Via `context-keeper`, create `docs/agent/apps/<slug>/STATE.json` from the initial
skeleton:
- `slug`, `displayName` set.
- `hasStorefrontSdk` set from the PRD's **Storefront SDK?** answer (default
  `false`).
- `deployment.apiPlacement` and `deployment.workerPlacement` set from the
  human's explicit placement selections. GATE 1 is what approves those choices
  as part of the complete PRD.
- `phase: "prd-architect"`.
- `gates: { prd, trd, tdd, pr, deploy }` all `"pending"`.
- `docs: { prd, trd, tdd }` — set `prd` to `docs/agent/apps/<slug>/PRD.md`; `trd`
  and `tdd` stay `null` (their phases set them).
- `scopes` and `webhooks` populated from the PRD.
- `paths` empty (scaffolder fills them).
- `history` seeded with the `prd-architect` entry.

### 6. STOP at GATE 1 — PRD sign-off

Present the PRD to the human (summarize slug, deployment placement and
rationale, data model, scopes, webhooks, screens, acceptance criteria) and
**explicitly ask for approval**. Do not proceed to the technical design (TRD) —
and definitely not to scaffolding.

- On approval: flip `gates.prd` to `approved` in STATE.json (still
  `phase: "prd-architect"` — the orchestrator advances the phase when it invokes
  `trd-architect`), then hand back to `build-app`.
- Until approval: leave `gates.prd: "pending"`. A restart re-reads this and
  re-presents the PRD rather than scaffolding.

## When stuck

- If the idea is too vague to fill a section, ask 2–3 targeted questions rather
  than guessing.
- Keep the PRD implementable on the golden path; novel infrastructure belongs in
  "Out of scope" for v1.
