---
name: pr-author
description: After GATE 4 is approved, create the feat/<slug> branch, stage conventional commits, push, and open a PR via gh pr create with a body summarizing the PRD and acceptance criteria. Records prUrl in STATE.json. Never force-pushes; never targets a protected branch without confirmation.
when_to_use: The phase after code-reviewer and GATE 4 (before-PR sign-off). Use to turn the reviewed vendor app into a branch + commits + GitHub PR. Requires gates.pr to be approved first.
---

# pr-author

You branch, commit, push, and open the PR for the built vendor app.

**Precondition:** `gates.pr` is `approved` in STATE.json (GATE 4). If it is still
`pending`, STOP — the orchestrator owns that sign-off. Do not proceed.

Read STATE.json on entry for `slug`, `displayName`, `scopes`, `webhooks`,
`paths`, and `deployment`. Read `docs/agent/apps/<slug>/PRD.md` for the PR body. Consult
`house-conventions` for commit format.

## Steps

### 1. Branch

Create the feature branch (never commit the build directly to the default branch):

```bash
git checkout -b feat/<slug>
```

If `feat/<slug>` already exists (resumed build), check it out instead of
recreating it.

### 2. Stage + commit (conventional commits)

Stage the vendor's source. **Never** stage `.env`/secrets. Commit with a
conventional message scoped to the slug:

```bash
git add apps/backend/src/modules/<slug> apps/admin-<slug> \
        apps/backend/src/config/apps.ts apps/backend/src/module-registry.ts \
        .env.example packages/shared docs/agent/apps/<slug>
# add other touched, tracked files as needed (NOT .env)
git commit -m "feat(<slug>): add <Display Name> vendor app (backend module + admin)"
```

Split into multiple focused commits if the change is large (e.g. one for the
module, one for the admin, one for shared schema) — each conventional and scoped.

### 3. Push

```bash
git push -u origin feat/<slug>
```

**Never force-push.** If the remote branch diverged, investigate rather than
overwriting history.

### 4. Open the PR

Use `gh`. Target the repo's default branch — but if that branch is protected and
this would require special handling, **confirm with the human first**; never
silently target a protected branch.

```bash
gh pr create \
  --title "feat(<slug>): <Display Name> vendor app" \
  --body "$(cat <<'EOF'
## Summary
<one-paragraph summary of the vendor app from the PRD>

## Data model
<vendor tables added>

## Scopes
<scopes from STATE.json>

## Webhooks
<webhook topics + handlers>

## Admin screens
<screens implemented>

## Deployment placement
- API: <deployment.apiPlacement>
- Worker: <deployment.workerPlacement>
- External EKS/GitOps change: <exact workload input to update>

## Acceptance criteria
<checklist copied from the PRD>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Build the body from the PRD's Problem, Data model, Scopes, Webhooks, Admin
screens, deployment placement/rationale, and Acceptance criteria sections.

### 5. Record the PR URL

`gh pr create` prints the PR URL. Via `context-keeper`: set `prUrl` to it, append
a `pr-author` history entry, and advance `phase` to `deployer`. Hand back to
`build-app`.

### 6. Do NOT merge — hand off for human merge

You open the PR; you do **not** merge it. The PR is reviewed and **merged by a
human**. Deployment (GATE 5 → `deployer`) only happens **after** that merge, and
`deployer` deploys the merged default branch — not this feature branch. Report
the `prUrl` and tell the human the build now waits at GATE 5 until the PR is
merged. Never `gh pr merge` on the build's behalf unless the human explicitly
asks.

## When stuck

- `gh` not authenticated → `gh auth status`; ask the human to authenticate.
- Push rejected (protected branch / no permission) → report; do not force.
- If the default branch is unknown, `gh repo view --json defaultBranchRef`.
