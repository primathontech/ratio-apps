# 0008 — FBT reads collections from the Ratio API (supersedes 0007)

- **Date:** 2026-08-06
- **Status:** accepted
- **Supersedes:** [0007](./0007-fbt-collections-from-unauthenticated-openstore-storefront.md)

## Context

ADR 0007 routed FBT's collection lookups to a **separate, unauthenticated** OpenStore
storefront service (`FBT_OS_STOREFRONT_URL`, `GET /api/v1/collections`, keyed by a
`gk-merchant-id` header) for one reason only: the Ratio API had no collections resource.
Its documented resources were `products` and `orders`; `products` accepted a
`collectionId` *filter* but nothing enumerated collections.

That ADR named its own exit condition explicitly:

> If the Ratio API ever gains a collections resource, this client should be deleted and
> the call moved to `RatioClient`. That is the preferred end state.

The Ratio API now has one. Two endpoints were confirmed live on the UAT gateway
(`https://uat-os-ecosystem.dev.gokwik.io`):

```
GET /api/v1/v1/collections?limit=10&page=1&published=true&includeProducts=false
GET /api/v1/v1/collections/{id}?includeProducts=true
```

The doubled `v1` matches the products path this repo already calls — see the standing
note in `apps/fbt/CONTEXT.md` about the published docs disagreeing with the live gateway.

Neither endpoint takes a `storeId` or merchant parameter, which means merchant scoping
can only come from the OAuth credential. That settles the client choice on its own.

## Decision

Collections move onto `RatioClient` with the merchant's OAuth access token, exactly as
products already do. `catalog/os-storefront.client.ts`, the
`FBT_OS_STOREFRONT_URL_TOKEN` provider, the `FBT_OS_STOREFRONT_URL` env key, and its
`.env.example` entry are all deleted.

**Failures now propagate instead of degrading to an empty list.** 0007's
degrade-to-`[]` contract existed *because* that service was an untrusted third party on
a different host. This is the same first-party API as products, so collections align
with `FbtRatioProductsService.search`, which lets errors surface. This deliberately
retires the consequence 0007 recorded against itself — that a collections outage was
*silent*, showing the merchant an empty picker rather than an error.

The merchant's OAuth token is now forwarded, reversing 0007's rule against it. That rule
was correct in its context: forwarding a Ratio credential to an unrelated third-party
host widens its blast radius for no gain. Sending it to `RATIO_API_BASE_URL` — the
issuer's own gateway, the same host products already authenticate against — is ordinary
and is the only mechanism that scopes the request to the merchant.

## Provisional: the response mapping

The collections **response schema has not been supplied yet.** The user provided working
request examples and will supply the response structure later, at which point the
mapping is finalised.

Until then, `catalog/ratio-collections.service.ts` parses with a tolerant envelope union
(`{ data: { collections } }` / `{ data: [] }` / `{ collections }` / bare array) and maps
only `id`, `title`, and `handle` — the three fields the admin picker needs and the same
set the deleted client produced. The mapping carries a `PROVISIONAL:` comment naming
what to revisit. No fields beyond those three were invented.

This is a known, deliberate gap, not an oversight: a confident-looking mapping over a
schema nobody has seen would be worse than an honest placeholder. Because the union is
tolerant rather than permissive-by-default, an unexpected envelope fails loudly rather
than silently yielding nothing.

## Consequences

- **FBT talks to one backend again.** The asymmetry 0007 introduced — the only vendor in
  this repo speaking to two backends with two auth models — is gone. A future reader no
  longer has to be warned against "tidying" it.
- **An env key was deleted, not added.** One less thing to configure per environment, and
  one less optional key whose absence silently disabled a feature.
- **Collection lookup failures are now visible** to the merchant as errors rather than an
  empty picker, which is the correct trade for a first-party dependency.
- **The `search` capability is gone.** The old storefront endpoint accepted a `search`
  parameter; the four confirmed Ratio parameters (`limit`, `page`, `published`,
  `includeProducts`) do not include one, so the controller no longer accepts it. If
  collection search matters to Plan 4's bundle editor, it needs either a platform
  parameter that exists or client-side filtering over a page of results.
- **One follow-up is open:** finalise the response mapping when the schema arrives.
  `getById`'s `null` branch is currently unreachable, because no not-found shape has been
  specified — that resolves at the same time.
