# RP Adapter — Full End-to-End Flow

> **Format:** vertical box-and-arrow (top-to-bottom).  
> Actor labels sit above each box. Arrows carry the call / payload.  
> Real function names, env vars, and header names used throughout.

---

## Legend

| Actor | Symbol |
|-------|--------|
| Merchant browser | `[ MERCHANT ]` |
| Customer browser | `[ CUSTOMER ]` |
| RP Adapter :3100 | `[ ADAPTER ]` |
| RP Backend :4000 | `[ RP BE ]` |
| OS Order Service | `[ OS-ORDER ]` |
| OS Item Service | `[ OS-ITEM ]` |
| MySQL (rp_app) | `[ MYSQL ]` |
| MongoDB (return_prime_local) | `[ MONGO ]` |

---

## Phase 1 — Merchant installs app from Ratio App Store

```
[ MERCHANT ]
┌──────────────────────────────────────────────────────────────────────┐
│  Opens Ratio App Store → finds "Return Prime" → clicks Install       │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  Ratio constructs OAuth URL, redirects
                             ▼
[ ADAPTER ]  GET /rp/auth/callback?code=<oauth_code>
┌──────────────────────────────────────────────────────────────────────┐
│  RpAuthController.callback()                                         │
│                                                                      │
│  POST RATIO_API_BASE_URL/api/v1/oauth/token                          │
│    { grant_type: "authorization_code", code,                         │
│      clientId: RATIO_RP_CLIENT_ID,                                   │
│      clientSecret: RATIO_RP_CLIENT_SECRET }                          │
│  ← { access_token, refresh_token, expires_in, merchant_id }          │
│                                                                      │
│  merchants.upsert({ merchantId, domain, accessTokenEnc, … })         │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ MYSQL ]  INSERT INTO rp_merchants (merchant_id, domain, …)

                             │  302 → RATIO_RP_ADMIN_BASE_URL
                             ▼
[ MERCHANT ]  Admin SPA opens
┌──────────────────────────────────────────────────────────────────────┐
│  GET /rp/api/admin/merchants/me                                      │
│    Authorization: Bearer <merchantId>                                │
│  ← { id, domain, registered: false }                                 │
│                                                                      │
│  SPA shows Registration Form:                                        │
│    store_domain · admin_email · admin_password · admin_name          │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  Merchant fills form → Submit
                             ▼
[ ADAPTER ]  POST /rp/api/admin/register
┌──────────────────────────────────────────────────────────────────────┐
│  RpAdminController.register()                                        │
│  body: { store_domain, admin_email, admin_password, admin_name }     │
│                                                                      │
│  merchants.updateDomain(merchantId, storeDomain) → MySQL UPDATE      │
│                                                                      │
│  POST RP_BASE_URL/shopify-webhook/v1/os-install            ← (1)     │
│    X-OS-Internal-Token: RP_INTERNAL_API_TOKEN                        │
│    X-OS-Store: sandbox-bblunt-v2.dev.gokwik.io                       │
│    { merchant_id, gokwik_merchant_id, access_token,                  │
│      admin_email, admin_password, platform: "os" }                   │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ RP BE ]  POST /shopify-webhook/v1/os-install
┌──────────────────────────────────────────────────────────────────────┐
│  Creates store record in RP's own MongoDB stores collection          │
│  ← 200 { status: true, messageCode: "OS_INSTALL_S1",                │
│           message: "Store registered" }                              │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ MERCHANT ]  Admin SPA shows success
┌──────────────────────────────────────────────────────────────────────┐
│  Script snippet to paste into BBLunt storefront theme:               │
│  <script src="https://…/rp/sdk/rp-portal.js"></script>              │
│  (served by adapter: GET /rp/sdk/rp-portal.js)                       │
│                                                                      │
│  Button → "Open RP Dashboard"  →  http://localhost:3000              │
│    OS platform mode: no billing screen, free tier by default         │
│    Merchant configures: return policy · reasons · locations          │
└──────────────────────────────────────────────────────────────────────┘
```

> **(1)** `os-install` is a standard RP webhook handler — same shape as the  
> Shopify `app/installed` webhook. It's the hook Shopify itself would call;  
> for the OS platform we post it explicitly from the adapter on registration.

---

## Phase 2 — Order placed on BBLunt storefront → synced to RP

```
[ CUSTOMER ]
┌──────────────────────────────────────────────────────────────────────┐
│  Completes checkout on sandbox-bblunt-v2.dev.gokwik.io              │
│  OS creates order: id = "ordr_17834274629567154"                     │
│  line_items: [{ sku: "8904417307375", price: 48900 }]  ← paise      │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  OS Order Service fires webhook
                             ▼
[ OS-ORDER ]  POST https://…devtunnels.ms/rp/webhooks/orders
              x-merchant-id:   <merchantId>
              x-webhook-topic: orders/create
              body: { event_type: "orders/create",
                      merchant_id: <id>,
                      order: { id: "ordr_…", line_items: […] } }
                             │
                             ▼
[ ADAPTER ]  POST /rp/webhooks/orders
┌──────────────────────────────────────────────────────────────────────┐
│  RpWebhooksController.orderEvent()                                   │
│  Guard: RpWebhookSignatureGuard                                      │
│    no x-ratio-hmac-sha256 header present                             │
│    NODE_ENV=development → guard passes (logs warning, continues)     │
│                                                                      │
│  merchantId ← x-merchant-id header                                   │
│             ← body.merchant_id  (fallback)                           │
│  orderPayload ← body.order ?? body.data ?? body                      │
│                                                                      │
│  RpWebhooksService.handleOrderEvent(merchantId, payload, topic)      │
│    merchants.findByMerchantId(merchantId)                            │
└────────────────┬───────────────────────────────────────┬─────────────┘
                 │ merchant found                         │ not found
                 ▼                                        ▼
┌────────────────────────────────┐          ┌────────────────────────┐
│ orderSync.upsertOrder(         │          │ logger.warn → drop     │
│   payload, merchant.domain )   │          │ return 200 { ok:true } │
└───────────────┬────────────────┘          └────────────────────────┘
                │
                ▼
[ ADAPTER ]  RpOrderSyncService.upsertOrder(rawOrder, domain)
┌──────────────────────────────────────────────────────────────────────┐
│  normalizeOrder({ ...rawOrder, store: domain })                      │
│    numericIdFromString("ordr_17834274629567154")                     │
│      strip prefix → BigInt hex → 1114642164347947                    │
│    paiseToRupee(48900) → 489.00   ← all price fields ÷ 100          │
│    build price_set, discount_allocations, tax_lines (Shopify shape)  │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ MONGO ]  shopifyorders.updateOne(
             { id: 1114642164347947, store: "sandbox-bblunt-v2…" },
             { $set: { id, name, store, financial_status,
                       line_items: [{ price: "489.00", … }],
                       updated_at: now() } },
             { upsert: true }
           )
                             │
                             ▼  200 { ok: true }  back to OS-ORDER

──────────────────────────────────────────────────────────────────────
  Verify received:
  mongosh …/return_prime_local --eval 'db.shopifyorders.findOne(
    {}, {id:1,name:1,store:1,updated_at:1,_id:0})'
──────────────────────────────────────────────────────────────────────
```

---

## Phase 3 — Customer opens /apps/return_prime and submits return

```
[ CUSTOMER ]
┌──────────────────────────────────────────────────────────────────────┐
│  Visits /apps/return_prime on BBLunt storefront                      │
│  <script> from /rp/sdk/rp-portal.js renders portal iframe           │
│  Enters: order name "#1001"  +  email                                │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ RP BE ]  GET /customer/v1/orders?order_name=#1001&email=…
┌──────────────────────────────────────────────────────────────────────┐
│  Queries shopifyorders MongoDB collection by name + domain           │
└──────────────┬──────────────────────────────────────────┬────────────┘
               │ order found in Mongo                      │ not found
               ▼                                           ▼
┌──────────────────────────┐            ┌─────────────────────────────┐
│ returns order to portal  │            │ calls adapter on-demand:    │
│ (webhook already synced) │            │ GET /rp/shopify/orders      │
└──────────────┬───────────┘            │   ?name=#1001               │
               │                        │ (see Phase 4 below)         │
               │ ◄──────────────────────┘
               │  either path: portal receives order
               ▼
[ CUSTOMER ]  Sees order items, selects return item + quantity

                             │
                             ▼
[ RP BE ]  GET /customer/v1/reasons
┌──────────────────────────────────────────────────────────────────────┐
│  Returns configured return reasons from RP MongoDB                   │
│  Customer selects reason → clicks "Submit Return"                    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ RP BE ]  POST /customer/v1/return-exchange/submit
┌──────────────────────────────────────────────────────────────────────┐
│  Eligibility check:                                                  │
│    qty already claimed by non-cancelled request?                     │
└────────────┬──────────────────────────────────────────┬──────────────┘
             │ eligible                                  │ not eligible
             ▼                                           ▼
┌────────────────────────────────────┐      ┌───────────────────────────┐
│ returnexchangerequests.insertOne({ │      │ 412 REQUEST_EXCHANGE_E97  │
│   order: 1114642164347947,         │      └───────────────────────────┘
│   status: "pending", … })          │
│ ← 200 { request_id: "RP1" }        │
└────────────────────────────────────┘

[ CUSTOMER ]  "Return Submitted! RP1"
```

---

## Phase 4 — On-demand order fetch (if webhook hasn't arrived yet)

```
[ RP BE ]  → calls adapter because order not in MongoDB
┌──────────────────────────────────────────────────────────────────────┐
│  GET /rp/shopify/orders?name=#1001                                   │
│    X-Shopify-Access-Token: RP_INTERNAL_API_TOKEN                     │
│    X-Store: sandbox-bblunt-v2.dev.gokwik.io                          │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ ADAPTER ]  GET /rp/shopify/orders
┌──────────────────────────────────────────────────────────────────────┐
│  Guard: RpRequestGuard                                               │
│    X-Shopify-Access-Token == RP_INTERNAL_API_TOKEN  ✓                │
│    X-Store → merchants.findByDomain()  → MySQL                       │
│    attaches rpMerchant to request                                    │
│                                                                      │
│  RpOrdersService.getOrders(merchantId, { name: "#1001" })            │
│  ratioClient.getOrders(merchantId, { search: "#1001" })              │
│    maps Shopify "name" param → OS "search" param                     │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ OS-ORDER ]  GET OS_ORDER_BASE_URL/api/v1/admin/orders?search=#1001
              gk-merchant-id: <merchantId>
┌──────────────────────────────────────────────────────────────────────┐
│  ← { data: { orders: [{ id: "ordr_…", line_items: […] }] } }        │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ ADAPTER ]  normalizeOrder(order)
┌──────────────────────────────────────────────────────────────────────┐
│  paise ÷ 100 = rupees   |   "ordr_…" string → numeric id            │
│  ← { orders: [{ id: 1114642164347947,                                │
│                  name: "#1001", line_items: [{ price:"489.00" }] }] }│
└──────────────────────────────────────────────────────────────────────┘
```

---

## Phase 5 — Merchant reviews and approves return

```
[ MERCHANT ]  Opens RP Dashboard (http://localhost:3000)
┌──────────────────────────────────────────────────────────────────────┐
│  GET /return-exchange/v1/list  → RP BE                               │
│  Sees #RP1 in Pending list: customer info, item, reason              │
│  Clicks "Approve"                                                    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ RP BE ]  POST /return-exchange/v1/approve/:id
┌──────────────────────────────────────────────────────────────────────┐
│  returnexchangerequests.updateOne → status: "approved"               │
│                                                                      │
│  POST /rp/shopify/orders/:orderId/refunds  → adapter                 │
│    X-Shopify-Access-Token: RP_INTERNAL_API_TOKEN                     │
│    X-Store: sandbox-bblunt-v2.dev.gokwik.io                          │
│    body: { refund: { line_items: [{ id, quantity }] } }              │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ ADAPTER ]  POST /rp/shopify/orders/:id/refunds
┌──────────────────────────────────────────────────────────────────────┐
│  Guard: RpRequestGuard — validates token + store                     │
│  RpRefundsService.createRefund(merchantId, orderId, body)            │
│    transformer.mapRefundRequest(body)                                │
│    ratioClient.createRefund(merchantId, orderId, mapped)             │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ OS-ORDER ]  POST OS_ORDER_BASE_URL/api/v1/admin/orders/:id/refund
              gk-merchant-id: <merchantId>
              body: { line_items: [{ id, quantity }], notify: true }
┌──────────────────────────────────────────────────────────────────────┐
│  ← { refund: { id, amount, transactions: [{ kind:"refund" }] } }     │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ ADAPTER ]  transformer.shopifyRefund(raw, orderId)
┌──────────────────────────────────────────────────────────────────────┐
│  ← { refund: { id, order_id, amount, transactions: […] } }           │
└──────────────────────────────────────────────────────────────────────┘

[ MERCHANT ]  Dashboard shows → "Approved · Refund issued"
```

---

## Phase 6 — Product catalog webhook (RP → Adapter → RP, same Shopify shape)

```
[ OS-ITEM ]  product created or updated
┌──────────────────────────────────────────────────────────────────────┐
│  Fires webhook to adapter:                                           │
│  POST /rp/webhooks/product-create  (or product-update)              │
│    X-GK-Merchant-Id: <merchantId>                                    │
│    body: { product: { id, title, variants, … } }                    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
[ ADAPTER ]  RpWebhooksService.handleProductCreate()
┌──────────────────────────────────────────────────────────────────────┐
│  merchants.findByMerchantId() → MySQL                                │
│  transformer.shopifyProduct(body) → Shopify-shape product            │
│                                                                      │
│  POST RP_BASE_URL/shopify-webhook/v1/product-create                  │
│    X-OS-Internal-Token: RP_INTERNAL_API_TOKEN                        │
│    X-OS-Store: <domain>                                              │
│    body: Shopify-format product payload                              │
└──────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
[ RP BE ]  POST /shopify-webhook/v1/product-create
           (same endpoint Shopify itself calls — no custom path needed)
```

---

**Net effect:**  
Merchant installs via Ratio App Store → OAuth → adapter stores merchant in MySQL → `os-install`
registers store in RP → OS fires order webhook → adapter normalises (paise→rupee, string→numeric ID)
→ upserts into RP MongoDB → customer finds order, submits return → merchant approves →
adapter calls OS Order Service to issue refund.
