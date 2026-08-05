# 0007 — FBT reads collections from an unauthenticated OpenStore storefront service

- **Date:** 2026-08-05
- **Status:** accepted

## Context

FBT bundles carry a `scope_type` of `all_products`, `specific_product`, or
`specific_collections`. The admin's bundle editor therefore needs to list a
merchant's collections so they can be picked, and the storefront lookup needs to
resolve a collection id to a bundle.

Products are straightforward: the Ratio API exposes them, and `RatioClient`
reaches them Bearer-authenticated with the merchant's OAuth access token, exactly
as `wizzy`, `google`, `meta`, and `loyalty` already do.

**Collections have no Ratio API endpoint at all.** Checked against the platform's
own API reference during Plan 2 design: the documented resources are only
`products` and `orders`. `products` accepts a `collectionId` *filter*, but nothing
enumerates collections. No vendor in this monorepo calls a collections endpoint.

The standalone app being migrated (`osapp-freq-bought`) got them from a
**different service entirely** — an OpenStore storefront REST API at
`OS_BACKEND_STOREFRONT_URL`, `GET /api/v1/collections`, authenticated only by a
`gk-merchant-id` header with no `Authorization` at all. That is outside the Ratio
OAuth model the monorepo is built around, and `ratio-apps` had no client for it.

Three options were put to the user, who was shown the trade-offs of each:

1. **Defer collection scope.** Ship `all_products` + `specific_product`; leave the
   column and enum value in place, unused. No new dependency.
2. **Port the OpenStore storefront client.** Full parity, at the cost of an
   unauthenticated cross-service call no other vendor makes.
3. **Collection ids by hand.** No browsing; resolve membership through the
   documented `collectionId` filter on `products`.

## Decision

The user chose **option 2** — port the client, preserving full parity with the
standalone app's bundle scoping.

Because that service is unauthenticated, cross-service, and not ours, it is
treated as untrusted:

- It lives in its own client, `catalog/os-storefront.client.ts`, deliberately
  **not** abstracted together with the Ratio products service. The two have
  different auth models and different trust levels; a shared "catalog client"
  abstraction would hide exactly the distinction that matters.
- **The merchant's Ratio OAuth token is never forwarded to it.** It buys nothing
  and would widen that token's blast radius. A test asserts no `Authorization`
  header is sent.
- It carries its own short timeout (5 s default), injectable so tests can drive
  the abort path without a real wait.
- **Every failure path degrades to an empty list** — unset URL, non-2xx, malformed
  body, schema mismatch, network throw, timeout. One third-party service being
  down costs the merchant one picker, not the whole bundle editor.
- The base URL comes from a new optional env key, `FBT_OS_STOREFRONT_URL`, added
  to the hand-listed `baseEnv` block in `env.schema.ts` alongside
  `WIZZY_API_BASE_URL` and `FORMS_S3_BUCKET`. Optional by design: unset means the
  collections picker returns nothing and the rest of FBT works, so a missing key
  degrades one admin control instead of blocking boot.

## Consequences

- FBT is the only vendor in this repo that talks to two backends with two
  different auth models. That asymmetry is intentional and documented here so a
  future reader does not "tidy" it into one client.
- If the Ratio API ever gains a collections resource, this client should be
  deleted and the call moved to `RatioClient`. That is the preferred end state.
- The degradation contract means a collections outage is **silent** from the
  merchant's perspective — they see an empty picker, not an error. The client logs
  a warning on each failure path; anyone debugging "my collections vanished"
  should look there first.
- Deferring (option 1) remains available as a retreat if the storefront service
  proves unreliable: nothing else depends on the client, and
  `scope_collection_ids` is nullable.
