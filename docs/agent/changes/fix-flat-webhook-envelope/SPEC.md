# Resolve flat webhook payloads in `core` — spec

- **Slug:** `fix-flat-webhook-envelope`   **Type:** fix   **Size:** feature
- **Area:** backend `core/` (affects every vendor module)

## Problem / goal

**Observed behaviour.** Every `orders/*`, `customers/*` and `loyalty/*` webhook
handler in this repo receives an **empty object**. No error, no log, nothing —
the handler simply finds no fields and does nothing useful. In the CleverTap
module the order mapper cannot find an order id, returns `null`, and the forward
is skipped: **the entire server-side revenue path silently no-ops.** `loyalty`'s
two order handlers have the same defect.

**Confirmed root cause.** `apps/backend/src/core/webhooks/webhooks.types.ts`:

```ts
export function envelopeResource(e: WebhookEnvelope): Record<string, unknown> {
  return (e.product ?? e.order ?? {}) as Record<string, unknown>;
}
```

It assumes every event wraps its resource under a key. The platform's official
webhook docs (`sandbox-developers.dev.gokwik.in/docs/webhooks/topics`) show the
shape is **per-resource and mixed**:

| Resource | Topics | Shape | `envelopeResource` today |
|---|---:|---|---|
| `orders/*` | 8 | **flat** — order fields at top level | ❌ `{}` |
| `customers/*` | 3 | **flat** | ❌ `{}` |
| `loyalty/*` | 2 | **flat** | ❌ `{}` |
| `products/*` | 3 | wrapped under `product` | ✅ works |
| `collections/*` | 3 | wrapped under `collection` | ❌ `{}` |
| `reviews/*` | 2 | wrapped under `review` | ❌ `{}` |

So **18 of the 21 deliverable topics resolve to `{}`**. Only `products/*` works,
which is why the defect went unnoticed — `google`, `meta` and `wizzy` consume
products, and they are the vendors that have been exercised live.

The overview page states it directly: *"the platform delivers the exact object it
publishes for the event, **with no wrapper envelope**… The remaining fields are
the event's resource."* Corroborated independently by
`update/Bluedart - TRD.md` §4.0 (marked os-devecosystem-verified, from the
Delhivery build): *"order events are FLAT — the order fields plus top-level
`event_type` + `merchant_id`, no wrapper object."*

Note `e.order` is **dead code** — there is no `order` key in any real payload; it
was written speculatively and has never matched.

**Goal.** `envelopeResource` returns the real resource for all 21 topics, without
breaking the `products/*` path that currently works.

## Approach

**Chosen: resolve per-resource, wrapper-first with a flat fallback.**

1. Try the known wrapper keys in order: `product`, `collection`, `review`.
2. Otherwise treat the **envelope itself** as the resource, minus the platform's
   identity/meta fields: `event_type`, `merchant_id`, and the top-level
   `timestamp` that `customers/*` and `loyalty/*` add.
3. Keep `.passthrough()` on `webhookEnvelopeSchema` — it is what lets flat fields
   survive parsing today; they just land at top level.

Wrapper-first (rather than topic-prefix matching) because it degrades safely: a
future wrapped resource keeps working via its key, and an unknown flat resource
still yields its fields instead of `{}`.

**Rejected — switch on the `event_type` prefix.** Would need a hard-coded map of
21 topics kept in sync with the platform by hand; a new topic silently returns
`{}` again. The wrapper-first approach needs no such list.

**Rejected — strip nothing and pass the whole envelope.** Simplest, but it leaks
`event_type`/`merchant_id` into the resource, which then flows into
`resourceVersion()` (content-fingerprint dedupe) and into vendor mappers. For
CleverTap it would put `event_type` inside a `Charged` event's properties.

**Also fix in the same change:** `deriveWebhookId()` reads `resource.id`, which is
correct only once resolution is fixed. Confirm dedupe still behaves for both
shapes — the docs' own recommended key is `${event_type}:${id}` with `id` at the
top level, matching ours.

## Acceptance criteria

- [ ] `envelopeResource` returns the real resource for a **flat** payload
      (`orders/*`, `customers/*`, `loyalty/*`) and for a **wrapped** one
      (`products/*`, `collections/*`, `reviews/*`).
- [ ] `event_type`, `merchant_id` and a top-level `timestamp` are **absent** from
      the returned resource in the flat case.
- [ ] `products/*` behaviour is **byte-identical** to today (regression guard —
      this is the one path currently working in production).
- [ ] A resource-less event (`app/uninstalled`) still returns `{}`.
- [ ] `deriveWebhookId` produces a stable, correct key for both shapes; existing
      dedupe tests still pass unchanged.
- [ ] Test fixtures use the **official sample payloads** from the platform docs
      for all six resources, not invented ones.
- [ ] `loyalty`'s `orders/create` + `orders/cancelled` handlers receive real
      fields (they are the other live consumer of this path).
- [ ] CleverTap's 6 order + 2 customer handlers receive real fields; the existing
      448 CleverTap tests still pass.
- [ ] `pnpm verify` is green.

## How this gets verified — and the honest limit

**Verify with ORDERS, not customers.** This is the important part of the plan.

| Layer | Verifiable? | How |
|---|---|---|
| Our code resolves flat payloads | ✅ **now** | Unit tests over the docs' official samples — deterministic, no platform needed |
| A real delivery flows end-to-end | ✅ **now, via orders** | `orders/*` subscriptions already have `hasSecretKey: true`. Edit or cancel an order in the store admin → delivery arrives → `Charged` appears in CleverTap |
| Customer events flow end-to-end | 🔴 **blocked, not by us** | `customers/*` has `hasSecretKey: false` — the platform never dispatches. No code change affects this |

**`customers/*` needs a second, non-code precondition:** the registry is 18 synced
of 21 defined, and `customers/*` is among the missing 3. That needs
`POST /admin/webhook-setup/run?force=true` from the os-ecosystem team (**not**
`sync`, which pulls processor→local and cannot create). Proven by a controlled
experiment on merchant `19v4an5c5p45`: one batch, 8 `orders/*` rows got
`hasSecretKey: true` (plus a second write ~2s later attaching the secret), all 3
`customers/*` rows got `false` and no second write.

So this change makes us **ready** for customer events; it does not make them
arrive. And because orders share the identical flat shape and the identical code
path, **proving it with orders proves it for customers** — which is why orders are
the verification vehicle and customers are not.

Signal to watch for when the registry is fixed: `hasSecretKey` flipping to `true`
on re-registration, then a customer edit in the store admin landing at the
endpoint.

## Out of scope

- **The signature guard** (`x-ratio-hmac-sha256` vs three other candidate schemes).
  Separate defect, separate change — tracked, and it needs a captured delivery.
- **Webhook self-registration** (nothing calls `POST /api/v1/app-webhooks`).
- **The 5-second response budget** vs CleverTap's inline 10s call.
- **Asking ops to re-run the registry setup** — not a code change.
- Any vendor-module change. This is `core/` only; vendor handlers already read
  the fields they need and start working once resolution is correct.
- `collections/*` and `reviews/*` **handlers** — no vendor subscribes to them.
  Resolution is fixed for them, but nothing consumes it yet.

## Context consulted

- `docs/agent/context/learnings.md` — 2026-07-29 (per-resource shapes; order money
  is rupees; official docs URL), 2026-06-18 (real `products/*` envelope
  `{event_type, merchant_id, product}`, `x-openstore-signature`), 2026-06-22
  (product prices are integer paise).
- `update/Bluedart - TRD.md` §4.0 — the os-devecosystem-verified platform contract.
- `update/GoKwik Platform — Issues & Questions (Delhivery Sandbox).md` — Issue 4
  (rupees on the webhook, paise on the REST API), Issue 5 (delivery stats never
  update, so `hasSecretKey` is the only trustworthy signal).
- `docs/agent/apps/clevertap/{TODO.md,TRD.md,CONTEXT.md}` — R9 and the customers
  double-precondition.
- `AGENTS.md` — a change touching `core/` is **always** feature-tier.

**Prior art note.** An earlier agent added a `customer` branch to
`envelopeResource` directly (`product ?? order ?? customer`). It was **reverted**:
it bypassed this gated lane, and it does not work — `customers/*` is flat, so
`e.customer` never exists either. It would have looked like a fix while changing
nothing.
