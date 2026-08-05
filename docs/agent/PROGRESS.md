# In-flight progress

Current multi-session work ONLY. Ephemeral: when a task completes, move its durable
summary into the relevant change journal (`apps/<slug>/CONTEXT.md` or
`context/CHANGELOG.md`) and clear it here. This is distinct from per-build
`STATE.json` (one vendor app's lifecycle state machine).

## Active task
FBT migration into `ratio-apps` (vendor slug `fbt`) — 6 plans total, greenfield
`fbt_app` schema (ADR 0006). **Plans 1 and 2 of 6 are complete** on branch
`feat/fbt-clean-schema` (22 commits, `9bd5e70..64cba7b`; local only, nothing pushed).

- **Plan 1 — foundation:** scaffold + wiring, the real `FbtDatabase` + shared config
  schema, the greenfield `0001_initial.ts` migration, install/bootstrap seeding, and
  the four inbound webhook handlers.
- **Scaffold cleanup:** stripped the PostHog-shaped `_template` admin content (an
  event-map editor, a `<script>`-tag panel, and a form asking for a `phc_` API key)
  and replaced the route skeleton with the standalone app's five screens.
- **Plan 2 — admin API:** shared bundle schemas; merchant config `GET`/`PUT`
  including the toggle-on scheduling contract; bundle CRUD with per-merchant tenancy
  on every query; bundle lookup precedence + preview; the nine-route bundles
  controller; a Ratio access-token provider with single-use refresh rotation; catalog
  pickers (Ratio products, OpenStore collections — ADR 0007); dashboard metrics.

See `docs/agent/apps/fbt/CONTEXT.md` for standing context and
`docs/agent/apps/fbt/PARITY.md` for the parity checklist against the standalone app.

Plans 3–6 are outstanding:
- **Plan 3** — the recos engine: embeddings, similarity, the sweep + its
  DB-row lease, and the coverage gate / outcome semantics.
- **Plan 4** — the `apps/admin-fbt` screens. The route skeleton and navigation exist
  but every screen except the dashboard's install status is an inert placeholder, so
  the app is not usable end-to-end yet. Must also resolve the inherited `_template`
  admin-session seam noted in `CONTEXT.md`.
- **Plan 5** — `packages/fbt-sdk`, the storefront widget (contract-preserving
  rewrite of the existing deployed wrapper's counterpart). Reuses
  `FbtBundleLookupService.resolve()` on a public unauthenticated route.
- **Plan 6** — the per-merchant cutover (install, reconfigure, verify, flip the
  storefront SDK URL).

Repo-wide follow-up surfaced by Plan 2, not FBT-specific: the Ratio token providers
in `wizzy`, `loyalty`, `meta`, and `fbt` have no locking around refresh, so two
concurrent refreshes for one merchant can each rotate the single-use refresh token
and leave the loser's dead — permanently breaking that merchant until reinstall.
`google` and `rp` guard this with `SELECT … FOR UPDATE` plus a re-check in a
transaction. See `docs/agent/apps/fbt/CONTEXT.md`.

Separately, still pending from before: two changes implemented + green,
**uncommitted** in the working tree: `add-feed-event-log` and
`webhook-verify-published` — awaiting branch/commit/PR decision.

## Blockers
_None._ (Prod merchant token shared in chat must be rotated — operator action.)

## Next step
FBT: start Plan 3 (the recos engine — embeddings, similarity, the sweep and its
DB-row lease) on top of `feat/fbt-clean-schema`.
Also: decide branch/PR strategy (combined vs separate) for the two pending
google changes, and run the `google_feed_events` migration (`pnpm migrate:google`)
on deploy.
