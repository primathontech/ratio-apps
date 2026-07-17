---
name: trd-architect
description: Turn an approved PRD into a structured Technical Requirements / Design Document (TRD) for a new vendor app — the module shape, API routes, DB schema, Ratio integrations (scopes/webhooks/OAuth), config model, and non-functional requirements — written to docs/agent/apps/<slug>/TRD.md. Initializes nothing new; reads the PRD + STATE.json, writes the TRD, then STOPS at GATE 2 (TRD sign-off) until a human approves.
when_to_use: The second worker phase of build-app, after GATE 1 (PRD approved) and before tdd-author. Use to translate an approved product spec into the concrete technical design the scaffolder and builders will follow. Produces the TRD and pauses for human approval — does NOT write a test plan or any code.
---

# trd-architect

You turn the **approved PRD** into a **Technical Requirements / Design Document
(TRD)** for one vendor app. This is design-on-paper — no scaffolding, no code.
Consult `stack-patterns` so the design matches how this repo actually builds
modules, and `house-conventions` for naming/slug/env rules.

## Preconditions

- `docs/agent/apps/<slug>/STATE.json` exists with `phase: trd-architect` (or
  resuming) and `gates.prd: approved`. If `gates.prd` is not `approved`, STOP —
  the PRD must be signed off first (bounce back to `build-app`).

## What to produce

Create `docs/agent/apps/<slug>/TRD.md` from `docs/agent/TRD.template.md`, filling
every section against the PRD and the real repo patterns:

1. **Module shape** — the NestJS module/bootstrap/tokens/`createAppProviders`
   wiring, mirroring `apps/backend/src/modules/_template/`. Name the controllers
   and services.
2. **API routes** — each endpoint under `/<slug>/...` (method, path, request/
   response shape, auth guard). Map them to the PRD's admin screens + SDK needs.
3. **Data model / DB schema** — the Kysely tables + columns + indexes and the
   `db/migrations/0001_initial.ts` plan. One database per module (`<slug>_app`).
4. **Ratio integration** — confirmed scopes, webhook topics + handlers, and the
   OAuth callback/bootstrap behavior (merchant-initiated; never hand-rolled).
5. **Config model** — the per-merchant config fields → the `packages/shared`
   `<slug>-config` Zod schema.
6. **Non-functional requirements** — env keys (`RATIO_<SLUG_UPPER>_*`), security
   (HMAC webhook verification, encryption-at-rest of tokens), pagination/limits,
   logging/redaction, and any performance budgets.
7. **Deployment placement** — copy the approved
   `STATE.json.deployment.apiPlacement` / `workerPlacement` decision and specify
   its exact runtime profile: `main.js` or `main.worker.js`,
   `ENABLED_MODULES`, worker flags, ALB routing/probes, secrets, IAM, queues,
   scaling signals, and the external GitOps/pipeline input that must change.
   Do not create repository-local Kubernetes manifests.
8. **Open questions / risks** — anything the human must decide before the test
   plan.

Keep it concrete and tied to real file paths. If the TRD reveals a scope/webhook
the PRD missed, update the PRD too and note it.

## On exit (via context-keeper)

- Set `docs.trd = "docs/agent/apps/<slug>/TRD.md"`.
- Append `{ "phase": "trd-architect", "ts": <ISO-8601> }` to `history`.
- Advance `phase` to `tdd-author` ONLY conceptually — the orchestrator advances
  after the gate. Leave `gates.trd: pending`.

## STOP at GATE 2

Present the TRD and ask for **explicit human approval**. Do not proceed to
`tdd-author`. When approved, `build-app` flips `gates.trd: approved`. If changes
are requested, revise `TRD.md` and re-present. Never self-approve.
