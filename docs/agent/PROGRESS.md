# In-flight progress

Current multi-session work ONLY. Ephemeral: when a task completes, move its durable
summary into the relevant change journal (`apps/<slug>/CONTEXT.md` or
`context/CHANGELOG.md`) and clear it here. This is distinct from per-build
`STATE.json` (one vendor app's lifecycle state machine).

## Active task
_None._ (Two changes implemented + green, **uncommitted** in the working tree:
`add-feed-event-log` and `webhook-verify-published` — awaiting branch/commit/PR decision.)

## Blockers
_None._ (Prod merchant token shared in chat must be rotated — operator action.)

## Next step
Decide branch/PR strategy (combined vs separate) and run the `google_feed_events` migration
(`pnpm migrate:google`) on deploy.
