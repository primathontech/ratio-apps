# STATE.json — per-build context schema

Every build of a new vendor app keeps its state in
`docs/agent/apps/<slug>/STATE.json`. This file — not the conversation
transcript — is the source of truth for a build. Every skill reads it on entry
to restore context and writes it on exit, which is what makes a build resumable
in a fresh session.

`docs/agent/apps/<slug>/` is **committed** (not gitignored): the PRD, TRD, TDD,
and STATE.json are the build's shared context, so anyone can pick up, review, or
resume a build from the repo.

## Shape

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Vendor slug. Lowercase `[a-z0-9-]` (scaffolded vendors never use a leading underscore — that is reserved for `_template`). Drives module/admin paths and `RATIO_<SLUG_UPPER>_*` env keys. |
| `displayName` | string | Human-readable vendor name (e.g. `"Loyalty Points"`). |
| `phase` | enum | Current phase. One of: `prd-architect` \| `trd-architect` \| `tdd-author` \| `vendor-scaffolder` \| `backend-builder` \| `frontend-builder` \| `code-reviewer` \| `pr-author` \| `deployer` \| `done`. |
| `gates` | object | The five human-approval gates. Each value is `pending` \| `approved`. Keys: `prd` (PRD sign-off), `trd` (TRD sign-off), `tdd` (TDD test-plan sign-off), `pr` (before PR), `deploy` (before deploy). |
| `docs` | object | Paths of the approved design docs produced before implementation: `prd`, `trd`, `tdd` (all under `docs/agent/apps/<slug>/`). Each is `null` until its phase produces it. |
| `scopes` | string[] | Ratio scopes the app requests (e.g. `"read_orders"`). |
| `webhooks` | string[] | Webhook topics the app subscribes to (e.g. `"orders/create"`, `"app/uninstalled"`). |
| `paths` | object | `module` = backend module dir, `admin` = admin app dir. |
| `filesCreated` | string[] | Repo-relative paths the build created/modified. Appended as phases run. |
| `deployTarget` | `"docker"` \| `"pm2"` \| null | Set by the `deployer` phase; `null` until then. |
| `prUrl` | string \| null | Set by the `pr-author` phase; `null` until then. |
| `history` | object[] | Append-only audit trail. Each entry: `{ "phase": <phase>, "ts": <ISO-8601> }`. |

### Allowed `phase` values

```
prd-architect | trd-architect | tdd-author | vendor-scaffolder | backend-builder
| frontend-builder | code-reviewer | pr-author | deployer | done
```

The phase advances in that order. The orchestrator (`build-app`) resumes a
build by reading `phase` and continuing from there.

### Allowed `gates.*` values

```
pending | approved
```

A gate flips to `approved` only after explicit human sign-off. Because the
approval lives in this file, a session restart honors a prior approval — the
orchestrator does not re-prompt for a gate already `approved`.

## Complete example

```json
{
  "slug": "loyalty",
  "displayName": "Loyalty Points",
  "phase": "backend-builder",
  "gates": {
    "prd": "approved",
    "trd": "approved",
    "tdd": "approved",
    "pr": "pending",
    "deploy": "pending"
  },
  "docs": {
    "prd": "docs/agent/apps/loyalty/PRD.md",
    "trd": "docs/agent/apps/loyalty/TRD.md",
    "tdd": "docs/agent/apps/loyalty/TDD.md"
  },
  "scopes": ["read_orders", "write_customers"],
  "webhooks": ["orders/create", "app/uninstalled"],
  "paths": {
    "module": "apps/backend/src/modules/loyalty",
    "admin": "apps/admin-loyalty"
  },
  "filesCreated": [
    "apps/backend/src/modules/loyalty/loyalty.module.ts",
    "apps/backend/src/modules/loyalty/db/migrations/0001_initial.ts",
    "packages/shared/src/schemas/loyalty-config.ts"
  ],
  "deployTarget": null,
  "prUrl": null,
  "history": [
    { "phase": "prd-architect", "ts": "2026-06-02T10:14:03.000Z" },
    { "phase": "trd-architect", "ts": "2026-06-02T10:24:11.000Z" },
    { "phase": "tdd-author", "ts": "2026-06-02T10:40:09.000Z" },
    { "phase": "vendor-scaffolder", "ts": "2026-06-02T10:55:55.000Z" },
    { "phase": "backend-builder", "ts": "2026-06-02T11:22:10.000Z" }
  ]
}
```

## Initial state (created by `prd-architect`)

```json
{
  "slug": "<slug>",
  "displayName": "<Display Name>",
  "phase": "prd-architect",
  "gates": {
    "prd": "pending",
    "trd": "pending",
    "tdd": "pending",
    "pr": "pending",
    "deploy": "pending"
  },
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

See `.agents/skills/context-keeper` (symlinked as `.claude/skills/context-keeper`)
for the read/write contract every skill follows.
