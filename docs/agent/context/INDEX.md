# Context index

The navigable map of durable context for this repo. Skim this (and the relevant
`docs/agent/apps/<slug>/CONTEXT.md`) before non-trivial work. Detail lives in the
linked files — read on demand. The `remember` skill keeps this index in sync;
prefer editing through it over hand-editing.

## Decisions (ADRs)
- [0001 — Multi-handler webhook dispatch](./decisions/0001-multi-handler-webhook-dispatch.md) — one module can handle N webhook topics (generic, backward-compatible core change).
- [0002 — `_template` excluded from run/workspace](./decisions/0002-template-excluded-from-run-and-workspace.md) — kept on disk as scaffolder source; not built/run.
- [0003 — Four-vendor monorepo consolidation](./decisions/0003-four-vendor-monorepo-consolidation.md) — historical consolidation phase for google/meta/posthog/moengage; Wizzy was later added as the fifth live app.
- [0004 — Storefront SDK as an opt-in third pillar](./decisions/0004-storefront-sdk-pillar.md) — pasted-`<script>` Lit SDK calling the vendor's public search API directly; `_template-sdk` + `hasStorefrontSdk` flag; wizzy is the first opt-in.
- [0005 — Three-workload EKS placement](./decisions/0005-three-workload-eks-placement.md) — shared Google/PostHog/MoEngage/Wizzy API with Google/Wizzy consumers, dedicated Meta API, dedicated Meta worker; future app placement is an explicit PRD/STATE decision.
- [0006 — FBT greenfield schema over in-place](./decisions/0006-fbt-greenfield-schema-over-in-place.md) — `fbt_app` is a fresh empty database, not the old FBT production schema reused additively; retired by only 1–5 live merchants plus the embedding-model switch discarding all cached vectors.
- [0007 — FBT collections from an unauthenticated OpenStore storefront](./decisions/0007-fbt-collections-from-unauthenticated-openstore-storefront.md) — the Ratio API exposes no collections resource, so collection scoping reads a second backend via `FBT_OS_STOREFRONT_URL` with a `gk-merchant-id` header, never the merchant's OAuth token, degrading to an empty list on every failure.

## Learnings
See [learnings.md](./learnings.md).

## Per-app context
- [google — CONTEXT.md](../apps/google/CONTEXT.md) — GA4 + Google Ads + Merchant Center
- [meta — CONTEXT.md](../apps/meta/CONTEXT.md) — Facebook Pixel + Conversions API + Catalog Sync
- [posthog — CONTEXT.md](../apps/posthog/CONTEXT.md) — PostHog product analytics
- [moengage — CONTEXT.md](../apps/moengage/CONTEXT.md) — MoEngage customer engagement
- [forms — CONTEXT.md](../apps/forms/CONTEXT.md) — Form Builder (first-party app: drag-and-drop builder admin + public submission intake + storefront form SDK)
- [wizzy — CONTEXT.md](../apps/wizzy/CONTEXT.md) — Wizzy AI Search (catalog sync + storefront search SDK)
- [loyalty — CONTEXT.md](../apps/loyalty/CONTEXT.md) — Coins program (earning rules, bulk credit/debit, QR scan-to-earn, exports; Core Loyalty is the ledger, `loyalty_customers` is a mirror)
- [fbt — CONTEXT.md](../apps/fbt/CONTEXT.md) — Frequently Bought Together (AI bundle recommendations via OpenAI embeddings + cosine similarity); greenfield `fbt_app` schema, Plan 1 of 6 complete

## Change journals
- Repo-level: [CHANGELOG.md](./CHANGELOG.md)
- Per app: `docs/agent/apps/<slug>/CONTEXT.md`
