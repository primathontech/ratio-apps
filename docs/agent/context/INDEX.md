# Context index

The navigable map of durable context for this repo. Skim this (and the relevant
`docs/agent/apps/<slug>/CONTEXT.md`) before non-trivial work. Detail lives in the
linked files — read on demand. The `remember` skill keeps this index in sync;
prefer editing through it over hand-editing.

## Decisions (ADRs)
- [0001 — Multi-handler webhook dispatch](./decisions/0001-multi-handler-webhook-dispatch.md) — one module can handle N webhook topics (generic, backward-compatible core change).
- [0002 — `_template` excluded from run/workspace](./decisions/0002-template-excluded-from-run-and-workspace.md) — kept on disk as scaffolder source; not built/run.
- [0003 — Four-vendor monorepo consolidation](./decisions/0003-four-vendor-monorepo-consolidation.md) — ratio-apps unifies google/meta/posthog/moengage on one core; scaffolder recipe validated for 5th vendor.
- [0004 — Storefront SDK as an opt-in third pillar](./decisions/0004-storefront-sdk-pillar.md) — pasted-`<script>` Lit SDK calling the vendor's public search API directly; `_template-sdk` + `hasStorefrontSdk` flag; wizzy is the first opt-in.

## Learnings
See [learnings.md](./learnings.md).

## Per-app context
- [google — CONTEXT.md](../apps/google/CONTEXT.md) — GA4 + Google Ads + Merchant Center
- [meta — CONTEXT.md](../apps/meta/CONTEXT.md) — Facebook Pixel + Conversions API + Catalog Sync
- [posthog — CONTEXT.md](../apps/posthog/CONTEXT.md) — PostHog product analytics
- [moengage — CONTEXT.md](../apps/moengage/CONTEXT.md) — MoEngage customer engagement
- [wizzy — CONTEXT.md](../apps/wizzy/CONTEXT.md) — Wizzy AI Search (catalog sync + storefront search SDK)

## Change journals
- Repo-level: [CHANGELOG.md](./CHANGELOG.md)
- Per app: `docs/agent/apps/<slug>/CONTEXT.md`
