# In-flight progress

Current multi-session work ONLY. Ephemeral: when a task completes, move its durable
summary into the relevant change journal (`apps/<slug>/CONTEXT.md` or
`context/CHANGELOG.md`) and clear it here. This is distinct from per-build
`STATE.json` (one vendor app's lifecycle state machine).

## Active task
FBT migration into `ratio-apps` (vendor slug `fbt`) — 6 plans total, greenfield
`fbt_app` schema (ADR 0006). **Plan 1 of 6 (foundation) is complete** on branch
`feat/fbt-clean-schema` (6 commits, `9bd5e70..ee7b2c0`; local only, nothing pushed):
scaffold + wiring, the real `FbtDatabase` + shared config schema, the greenfield
`0001_initial.ts` migration, install/bootstrap seeding, and the four inbound
webhook handlers. See `docs/agent/apps/fbt/CONTEXT.md` for standing context.

Plans 2–6 are outstanding:
- **Plan 2** — bundles CRUD API + config/catalog/dashboard controllers.
- **Plan 3** — the recos engine: embeddings, similarity, the sweep + its
  DB-row lease, and the coverage gate / outcome semantics.
- **Plan 4** — the `apps/admin-fbt` screens (config, bundles, dashboard, preview);
  must also resolve the inherited `_template` install-mechanism and admin-session
  seams noted in `CONTEXT.md`.
- **Plan 5** — `packages/fbt-sdk`, the storefront widget (contract-preserving
  rewrite of the existing deployed wrapper's counterpart).
- **Plan 6** — the per-merchant cutover (install, reconfigure, verify, flip the
  storefront SDK URL).

Separately, still pending from before: two changes implemented + green,
**uncommitted** in the working tree: `add-feed-event-log` and
`webhook-verify-published` — awaiting branch/commit/PR decision.

## Blockers
_None._ (Prod merchant token shared in chat must be rotated — operator action.)

## Next step
FBT: start Plan 2 (bundles API + config/catalog/dashboard) on top of
`feat/fbt-clean-schema`.
Also: decide branch/PR strategy (combined vs separate) for the two pending
google changes, and run the `google_feed_events` migration (`pnpm migrate:google`)
on deploy.
