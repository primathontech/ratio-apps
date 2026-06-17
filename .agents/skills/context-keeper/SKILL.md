---
name: context-keeper
description: The read/write contract for the per-build state file docs/agent/apps/<slug>/STATE.json — the single source of truth that lets a vendor-app build retain context and resume in a fresh session. A REFERENCE skill every worker follows; not a standalone step.
when_to_use: Consult at the start and end of every worker phase. On entry, read (or create) STATE.json to restore context; on exit, advance phase, append history, and persist new paths/filesCreated/scopes/webhooks/prUrl/deployTarget/gate states. Use whenever you need to know the exact STATE.json shape or how to advance it by one phase.
---

# context-keeper

`docs/agent/apps/<slug>/STATE.json` — **not the conversation transcript** — is
the source of truth for one vendor-app build. Because all progress lives in this
file, a build can be abandoned mid-flow and resumed in a brand-new session purely
from it. Every worker skill follows this contract.

The full schema is documented in `docs/agent/STATE.schema.md`. This skill is the
operational contract: how to read it, update it, and advance one phase.

`docs/agent/apps/<slug>/` is **committed** (not gitignored) — the PRD/TRD/TDD/STATE.json are the build's shared context and must be committed so any session can resume.

## The contract every worker follows

1. **On entry — read.** Read `docs/agent/apps/<slug>/STATE.json`.
   - If it is absent (only true at the very start, in `prd-architect`), create it
     from the initial skeleton below.
   - Use its `phase`, `gates`, `slug`, `paths`, `scopes`, `webhooks`, etc. to
     restore context. Trust the file over your memory of the chat.
2. **Do the work** for your phase.
3. **On exit — write.** Update the file:
   - Set `phase` to the phase you just **completed advancing into** (i.e. the next
     phase the orchestrator should run), or `done` after `deployer`.
   - **Append** an entry to `history`: `{ "phase": "<phase>", "ts": "<ISO-8601>" }`.
   - Persist anything you produced: append to `filesCreated`; set `paths.module` /
     `paths.admin`; set `scopes` / `webhooks` / `displayName` (prd-architect); set
     `docs.prd` / `docs.trd` / `docs.tdd` (prd-architect / trd-architect /
     tdd-author respectively); set `prUrl` (pr-author); set `deployTarget`
     (deployer).
   - Flip a gate to `approved` **only** after explicit human sign-off (gates start
     `pending` and stay `pending` until a human approves — workers never
     self-approve a gate).

Always write the **whole** JSON object back (read-modify-write), keeping every
field. Never drop fields you didn't touch.

## JSON skeleton (initial state)

Created by `prd-architect` when no STATE.json exists:

```json
{
  "slug": "<slug>",
  "displayName": "<Display Name>",
  "phase": "prd-architect",
  "gates": { "prd": "pending", "trd": "pending", "tdd": "pending", "pr": "pending", "deploy": "pending" },
  "docs": { "prd": null, "trd": null, "tdd": null },
  "scopes": [],
  "webhooks": [],
  "paths": { "module": "", "admin": "" },
  "filesCreated": [],
  "deployTarget": null,
  "prUrl": null,
  "history": [{ "phase": "prd-architect", "ts": "<ISO-8601>" }]
}
```

- `phase` ∈ `prd-architect | trd-architect | tdd-author | vendor-scaffolder | backend-builder | frontend-builder | code-reviewer | pr-author | deployer | done`
- `gates.*` ∈ `pending | approved`
- `deployTarget` ∈ `"docker" | "pm2" | null`

## Worked example — advancing one phase

Suppose `vendor-scaffolder` just finished scaffolding the `loyalty` app. It read
this on entry (PRD already signed off):

```json
{
  "slug": "loyalty",
  "displayName": "Loyalty Points",
  "phase": "vendor-scaffolder",
  "gates": { "prd": "approved", "trd": "approved", "tdd": "approved", "pr": "pending", "deploy": "pending" },
  "scopes": ["read_orders", "write_customers"],
  "webhooks": ["orders/create", "app/uninstalled"],
  "paths": { "module": "", "admin": "" },
  "filesCreated": [],
  "deployTarget": null,
  "prUrl": null,
  "history": [
    { "phase": "prd-architect", "ts": "2026-06-02T10:14:03.000Z" }
  ]
}
```

On exit it writes back (note: `phase` advanced to the next worker, `paths` set,
`filesCreated` appended, a new `history` entry, gates untouched):

```json
{
  "slug": "loyalty",
  "displayName": "Loyalty Points",
  "phase": "backend-builder",
  "gates": { "prd": "approved", "trd": "approved", "tdd": "approved", "pr": "pending", "deploy": "pending" },
  "scopes": ["read_orders", "write_customers"],
  "webhooks": ["orders/create", "app/uninstalled"],
  "paths": {
    "module": "apps/backend/src/modules/loyalty",
    "admin": "apps/admin-loyalty"
  },
  "filesCreated": [
    "apps/backend/src/modules/loyalty/loyalty.module.ts",
    "apps/backend/src/modules/loyalty/loyalty.bootstrap.ts",
    "apps/admin-loyalty/package.json"
  ],
  "deployTarget": null,
  "prUrl": null,
  "history": [
    { "phase": "prd-architect", "ts": "2026-06-02T10:14:03.000Z" },
    { "phase": "vendor-scaffolder", "ts": "2026-06-02T10:31:55.000Z" }
  ]
}
```

The orchestrator can now restart in a fresh session, read `phase:
"backend-builder"` and `gates.prd: "approved"`, and resume directly — no re-prompt
for GATE 1, no re-scaffolding.

## When stuck

- Two writers, one truth: only update STATE.json from the active worker, and
  always read-modify-write the whole object.
- If `phase` and reality disagree (e.g. a half-done scaffold), trust the **files
  on disk**, fix them, then reconcile `phase` to match what's actually complete.
- Use a real ISO-8601 timestamp for `ts` (e.g. `new Date().toISOString()`).
