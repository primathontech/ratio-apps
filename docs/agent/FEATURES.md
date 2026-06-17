# Features registry

The catalog of capabilities in this repo and their lifecycle status. Drill into a
capability's `CONTEXT.md` for its standing context + change journal. Update the
`Status` when a capability's lifecycle changes (`building` → `built` →
`local-tested` → `pr-open` → `deployed`). Add via the `remember` skill.

| Capability | Slug | Status | Context | Notes |
|---|---|---|---|---|
| Google (GA4 + Google Ads + Merchant Center) | `google` | built · local-tested | [apps/google/CONTEXT.md](./apps/google/CONTEXT.md) | not yet PR'd/deployed; needs Web Pixels API + live Ratio token for full flow. OAuth auto-discovery built for GA4 + GMC (auto-fills IDs on connect); Ads ID/label still manual (needs Google Ads API dev token) |
| Golden template | `_template` | golden source (not shipped) | — | scaffolder copy source; excluded from run/workspace |
