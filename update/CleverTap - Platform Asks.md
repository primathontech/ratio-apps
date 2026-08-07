# CleverTap App — What We Must Ask the Platform (Ratio / os-ecosystem)

_The asks to the **Ratio platform / os-ecosystem** team to unblock the CleverTap integration. Verified against the platform's live webhook registries (`admin/webhook-setup/event-definitions` — the 21-event master catalog — and `admin/webhook-setup/event-types` — the synced registry) + the [CleverTap PRD](../docs/agent/apps/clevertap/PRD.md)._

_These are **webhook topics that do not exist anywhere in the platform's 21-event catalog** and therefore need real platform development — not an ops `webhook-setup/sync`, which only closes the catalog-vs-synced drift for topics that already exist. Verified: zero occurrences of `checkouts`, `fulfillments`, or `draft_order` in either registry._

_Legend: ✅ available · ❌ missing (this ask) · ⚠️ partial_

---

## Already available — NOT asking for these (verified in the live catalog)

- `orders/paid` ✅ — CleverTap's primary `Charged` trigger.
- `orders/create`, `orders/updated`, `orders/cancelled` ✅ — order-lifecycle Journeys.
- `orders/fulfilled`, `orders/partially_fulfilled` ✅ — **order-level** fulfilment is covered (see P1 for why per-shipment is not).
- `customers/create`, `customers/update` ✅ (defined in the master catalog; a `webhook-setup/sync` closes the UAT drift — an ops action, not a platform build).
- `loyalty/points_credited`, `loyalty/points_debited`, `reviews/create` ✅ — available for v1.1.
- App self-registration via `POST /api/v1/app-webhooks` ✅.

---

## What we MUST ask the platform to build

### P0 — `checkouts/create`, `checkouts/update`, `checkouts/delete` 🔴 HIGHEST VALUE

- **Priority (source PRD):** P0 — `checkouts/create` / `checkouts/update` are P0; `checkouts/delete` is P1.
- **What CleverTap loses:** the **abandoned-cart trigger** — the source PRD's **single headline use case** (KwikPass-identity-powered cart recovery), and its highest-value ask by a wide margin. Without a server-side checkout signal there is no reliable clock to start CleverTap's abandoned-cart Journey.
  - `checkouts/create` — starts the abandonment clock.
  - `checkouts/update` — latest cart + address state to personalise the recovery message ("you left *this* item").
  - `checkouts/delete` — cleanup signal so CleverTap can cancel a queued Journey when the checkout session is gone.
- **Current workaround:** the storefront pixel fires client-side `InitiateCheckout` / `AddToCart`. It works, but it is **browser-dependent** (lost to ad-blockers and closed tabs), the cart state can be **stale** at send time, and there is **no server-authoritative cart state**. For `checkouts/delete` there is **no workaround** — a Journey may fire for a checkout that no longer exists.
- **Why this first:** identifying an abandoner via KwikPass identity only pays off if we also *know* they abandoned. These three are what make the source PRD's identity advantage actually monetisable.
- **Owner:** Ratio platform / os-ecosystem. **Status:** ❌ absent from both registries.

### P1 — `fulfillments/create`, `fulfillments/update`

- **Priority (source PRD):** P1.
- **What CleverTap loses:** **per-shipment** tracking numbers and shipment-status changes → "your order shipped / out for delivery" Journeys, and per-fulfilment records for multi-shipment orders.
- **Current workaround:** ⚠️ partial. `orders/fulfilled` and `orders/partially_fulfilled` **do exist** and are in v1 scope, so **order-level** fulfilment is covered. **Per-shipment granularity is not** — there is no way to key notifications to an individual shipment's tracking number.
- **Owner:** Ratio platform / os-ecosystem. **Status:** ❌ absent from both registries.

### P1 — `draft_orders/create`, `draft_orders/update`

- **Priority (source PRD):** P1.
- **What CleverTap loses:** draft-order recovery flows.
- **Current workaround:** **none.** Out of scope for v1.
- **Owner:** Ratio platform / os-ecosystem. **Status:** ❌ absent from both registries.

---

## Not a regression — refund topics

Any refund topic is also absent from the catalog, but the source PRD **already defers this behind the Refund Module**. It is **not** a regression and is **not** part of this ask.

---

## Copy-paste — message to the platform team

> For the CleverTap app, three sets of webhook topics are **missing from the 21-event catalog entirely** (verified against both `event-definitions` and `event-types` — this needs a build, not a `webhook-setup/sync`):
>
> 1. 🔴 **P0 — `checkouts/create` / `checkouts/update` / `checkouts/delete`.** The abandoned-cart trigger — our single headline use case. Today it degrades to the storefront pixel's client-side `InitiateCheckout`, which is browser-dependent (lost to ad-blockers / closed tabs) and carries no server-authoritative cart state. `checkouts/delete` has no workaround at all. **Highest value by a wide margin — please prioritise these three.**
> 2. **P1 — `fulfillments/create` / `fulfillments/update`.** Per-shipment tracking numbers / shipment status ("your order shipped / out for delivery"). Order-level fulfilment (`orders/fulfilled`, `orders/partially_fulfilled`) already works; per-shipment granularity does not.
> 3. **P1 — `draft_orders/create` / `draft_orders/update`.** Draft-order recovery. No workaround.
>
> **Not asking for:** refund topics — the PRD already defers those behind the Refund Module (not a regression).

---

_Cross-ref: [CleverTap PRD](../docs/agent/apps/clevertap/PRD.md) · [TRD](../docs/agent/apps/clevertap/TRD.md) · [TODO §1](../docs/agent/apps/clevertap/TODO.md)._
