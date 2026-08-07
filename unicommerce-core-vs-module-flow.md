# Unicommerce connector — full architecture (core vs module)

`core` = shared plumbing every connector app (google, meta, posthog, moengage,
wizzy, rp, forms, loyalty, unicommerce) is built on top of.
`modules/unicommerce` = everything specific to the Unicommerce integration.

There are three separate outsiders talking to this system, and one background
loop that isn't triggered by anyone:

1. **Unicommerce's platform** — calls us to pull products, push inventory
   updates, receive dispatch/cancel/status calls (7 endpoints) → Diagram 1
2. **Ratio's own platform** — sends us webhooks when an order is placed/
   cancelled, or a product changes (4 webhook topics), and handles the
   connect/login flow → Diagram 2
3. **Our own admin screen** — the merchant's browser, checking connection
   status, generating credentials, running manual reconciliation, viewing
   alerts (5 endpoints) → Diagram 4
4. **Scheduled jobs** — run on a timer, nobody "calls" them → Diagram 3

Each is walked through below, one at a time, top to bottom.

---

## Diagram 1 — Unicommerce calls us (e.g. push an inventory update)

```
        Unicommerce's platform
              │  sends its own login key (not a Ratio login)
              ▼
┌───────────────────────────────────────────┐   MODULE
│ Check: is this a real, active merchant?    │
│ Unicommerce's own login/auth check —       │
│ completely separate from Ratio's own login │
└──────────────────┬──────────────────────────┘
        │ valid                    │ invalid / paused
        ▼                          ▼
                            rejected, clear error back to Unicommerce
┌───────────────────────────────────────────┐   MODULE
│ Run the matching business logic:           │
│  - pull product catalog / product count    │
│  - update inventory                        │
│  - dispatch an order                       │
│  - cancel an order                         │
│  - order-status check                      │
│  - post a status update                    │
└──────────────────┬──────────────────────────┘
                    │ hands back a plain result
                    ▼
┌───────────────────────────────────────────┐   CORE
│ Shared response step                       │
│ - normally wraps every reply in Ratio's    │
│   own standard envelope                    │
│ - BUT: these 7 endpoints are flagged        │
│   "send it exactly as-is" — so the         │
│   wrapping is skipped just for them         │
└──────────────────┬──────────────────────────┘
                    │
                    ▼
        Unicommerce gets back exactly the
        plain response format it expects
```

**Trust chain:** Unicommerce's own login key → module's own auth check →
module's own business logic → shared response step, told to skip wrapping.

---

## Diagram 2 — An order comes in on Ratio, and gets pushed OUT to Unicommerce

```
        Ratio's platform
              │  sends a webhook: an order was placed/cancelled,
              │  or a product changed
              ▼
┌───────────────────────────────────────────┐   MODULE (using a shared checker)
│ Check: did this webhook really come from   │
│ Ratio? (signature check — same style       │
│ every connector app uses)                  │
└──────────────────┬──────────────────────────┘
        │ valid                    │ invalid
        ▼                          ▼
                            rejected
┌───────────────────────────────────────────┐   CORE
│ Shared webhook router                      │
│ sends the webhook to the right handler      │
│ based on what kind of event it is           │
└──────────────────┬──────────────────────────┘
                    │
     ┌──────────────┼───────────────────┬──────────────────┐
     │ order placed │ order cancelled   │ product changed   │
     ▼              ▼                   ▼
┌─────────┐   ┌─────────────┐    ┌──────────────────┐   MODULE
│ Order   │   │ Order       │    │ Keep our copy of  │
│ placed  │   │ cancelled   │    │ the product/SKU   │
│ handler │   │ handler     │    │ list up to date    │
└────┬────┘   └──────┬──────┘    └──────────────────┘
     │               │
     └───────┬───────┘
             ▼
┌───────────────────────────────────────────┐   MODULE
│ Queue it up to be sent to Unicommerce      │
│ (with automatic retries if it fails)       │
└──────────────────┬──────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐   MODULE
│ Background worker picks up the queued job  │
│ and actually calls Unicommerce's platform   │
│ to push the order / cancellation           │
└──────────────────┬──────────────────────────┘
                    │
                    ▼
              Unicommerce's platform
        (receives the pushed order/cancel)
```

**Trust chain:** Ratio → signature check (module, shared style) → shared
webhook router (core) → the right handler (module) → queued (module) →
background worker (module) → out to Unicommerce.

---

## Diagram 3 — The background loop nobody "calls" (runs on a timer)

```
┌───────────────────────────────────────────┐   MODULE
│ Every few minutes, on a timer:             │
│  - Re-check recent orders — did any of      │
│    them fail to reach Unicommerce and       │
│    never get retried? Push them again.      │
│  - Has a merchant gone quiet (no calls       │
│    from Unicommerce in a while)? Or does      │
│    an order look stuck? Raise an alert       │
│    for our admin screen to show.             │
└───────────────────────────────────────────┘
```

This is the safety net — it catches anything the request-driven flows above
missed, without anyone having to notice or ask.

---

## Diagram 4 — Our own admin screen calls us (for comparison)

```
        Our admin screen (merchant's browser)
              │  sends the merchant's own login session
              ▼
┌───────────────────────────────────────────┐   MODULE (using a shared checker)
│ Check: is this a real merchant session?    │
│ Same style of check every connector app     │
│ uses for its own admin screen               │
└──────────────────┬──────────────────────────┘
        │ valid                    │ invalid
        ▼                          ▼
                            rejected, login required
┌───────────────────────────────────────────┐   MODULE
│ Run the admin logic:                       │
│  - connection status / generate credentials │
│  - manual reconciliation                    │
│  - view / acknowledge alerts                │
│  - view / edit merchant's feature settings  │
└──────────────────┬──────────────────────────┘
                    │ hands back a plain result
                    ▼
┌───────────────────────────────────────────┐   CORE
│ Shared response step                       │
│ - these endpoints are NOT flagged as        │
│   special — normal wrapping applies,        │
│   same as every admin screen in every       │
│   other connector app                       │
└──────────────────┬──────────────────────────┘
                    │
                    ▼
        Admin screen gets the normal,
        standard wrapped response
```

---

## What's genuinely shared (core) vs Unicommerce-only (module)

**Shared — every connector app uses this as-is:**
- Error handling and response formatting rules
- Request validation rules
- The "skip the standard wrapping for this endpoint" option (added during
  this fix — any future connector can use it too)
- Credential encryption
- Talking to the Ratio platform API
- Looking up merchants
- The connect/login (OAuth) flow for our own admin screen
- The webhook signature check + webhook router

**Unicommerce-only — nothing here is shared with any other connector:**
- Unicommerce's own login/authentication scheme (username+password → apiKey)
- All 12 endpoints (7 Unicommerce calls, 5 our admin screen calls)
- Catalog, inventory, dispatch, cancel, and order-status business logic
- The queue + background worker that pushes orders/cancels out to Unicommerce
- The reconciliation sweep and alerting timer jobs
- Its own database tables (credentials, event log, order↔item mapping, SKU
  cache, alerts, reconciliation jobs, feature settings)

One loose end worth knowing about: there's a leftover "pause/kill switch"
check sitting unused in the module — the actual pause/uninstall check
happens somewhere else instead, so this one currently does nothing. Not
urgent, just flagging it so it doesn't get mistaken for active protection.

---

## Diagram 5 — The FULL flow: every API, every module, every failure path

This is the whole system in one connected picture — the happy path from
Diagrams 1/2/4 above, plus every place something can go wrong and what
happens next. Read it top to bottom; branches fork with `pass` / `fail`.

### 5a. Any call Unicommerce makes in (7 endpoints)

```
        Unicommerce's platform
              │  POST/GET, apiKey header (all except /authToken)
              ▼
┌───────────────────────────────────────────┐   CORE
│ Is the request body/query shaped right?    │
└──────────────────┬──────────────────────────┘
     │ pass                          │ fail
     ▼                               ▼
                            400 Bad Request — clear
                            validation error back to Unicommerce
┌───────────────────────────────────────────┐   MODULE
│ apiKey check (UcApiKeyGuard):              │
│  - apiKey header missing?                  │
│  - apiKey doesn't match any merchant?       │
│  - merchant is paused or uninstalled?       │
└──────────────────┬──────────────────────────┘
     │ pass                          │ fail
     ▼                               ▼
                       missing/bad key → 401
                       paused/uninstalled  → 403
                       (Unicommerce gets a clear rejection,
                        nothing is processed)
┌───────────────────────────────────────────┐   MODULE
│ Is this feature turned ON for this         │
│ merchant? (product_sync / inventory_sync /  │
│ order_push / dispatch_status_sync /         │
│ cancel_sync / notifications — each is       │
│ per-merchant, OFF by default)               │
└──────────────────┬──────────────────────────┘
     │ ON                            │ OFF
     ▼                               ▼
                       still replies 200/success-shaped,
                       but does nothing — logged as a
                       "disabled" entry in the audit log
                       so it's visible, not silently dropped
┌───────────────────────────────────────────┐   MODULE
│ Run the real logic:                        │
│  catalog pull · inventory update ·          │
│  dispatch · cancel · status check ·         │
│  status notification                        │
└──────────────────┬──────────────────────────┘
     │ succeeds                      │ unexpected error
     ▼                               ▼
                       500 — logged, but Unicommerce still
                       gets a response (never left hanging)
┌───────────────────────────────────────────┐   MODULE
│ Write an audit-log entry either way         │
│ (success or failure) — every inbound call   │
│ leaves a record                             │
└──────────────────┬──────────────────────────┘
                    ▼
┌───────────────────────────────────────────┐   CORE
│ Response step: this endpoint is flagged     │
│ "send as-is" → Unicommerce gets its own      │
│ plain expected shape, not Ratio's envelope  │
└───────────────────────────────────────────┘
```

### 5b-i. An order is placed or cancelled on Ratio, pushed OUT to Unicommerce

```
        Ratio's platform
              │  webhook: order placed / order cancelled
              ▼
┌───────────────────────────────────────────┐   MODULE
│ Signature check — is this really from      │
│ Ratio?                                     │
└──────────────────┬──────────────────────────┘
     │ pass                          │ fail
     ▼                               ▼
                            rejected, nothing runs
┌───────────────────────────────────────────┐   CORE
│ Route to the right handler by event type   │
└──────────────────┬──────────────────────────┘
                    ▼
┌───────────────────────────────────────────┐   MODULE
│ Is order_push / cancel_sync turned ON      │
│ for this merchant?                         │
└──────────────────┬──────────────────────────┘
     │ ON                            │ OFF
     ▼                               ▼
                          logged as skipped (disabled),
                          nothing queued
┌───────────────────────────────────────────┐   MODULE
│ Put a job on the outbound queue            │
│ (a message on a queue topic, plus a row     │
│  in the jobs table, status: PENDING)        │
└──────────────────┬──────────────────────────┘
                    ▼
┌───────────────────────────────────────────┐   MODULE
│ Background worker picks the job up          │
│ (marks it IN_PROGRESS so nothing else        │
│  double-processes it), then tries to call    │
│ Unicommerce's platform                      │
└──────────────────┬──────────────────────────┘
     │ succeeds                      │ fails
     ▼                               ▼
   job marked DONE,      ┌───────────────────────────────┐
   logged as success     │ Is this a "will never succeed  │
                          │ no matter how many times we      │
                          │ retry" kind of error? (e.g. SKU   │
                          │ not found, invalid facility, a    │
                          │ validation problem)                │
                          └──────────────────┬──────────────────┘
                               │ yes                     │ no — worth retrying
                               ▼                          ▼
                     give up immediately,      wait a bit (delay grows each
                     move it to a "needs       attempt), then try again — up
                     manual attention"         to a fixed number of attempts
                     list (visible on the                │
                     admin dashboard)                    │ still failing after
                               ▲                         │ all attempts
                               └─────────────────────────┘
```

### 5b-ii. A product changes on Ratio, keeps our catalog cache fresh

```
        Ratio's platform
              │  webhook: product created / product updated
              ▼
┌───────────────────────────────────────────┐   MODULE
│ Signature check — is this really from      │
│ Ratio? (same check as 5b-i)                │
└──────────────────┬──────────────────────────┘
     │ pass                          │ fail
     ▼                               ▼
                            rejected, nothing runs
┌───────────────────────────────────────────┐   MODULE
│ Update our own product/SKU cache            │
│ (used later to map Unicommerce SKUs to      │
│  our variant ids when it pushes inventory)  │
└───────────────────────────────────────────┘
```

### 5c. Two safety nets that catch anything the above missed

```
┌───────────────────────────────────────────┐   MODULE
│ Every ~10 minutes: re-scan recent orders    │
│ — anything that should have reached         │
│ Unicommerce but didn't (missed, or stuck     │
│ "needs manual attention")? Push it again.    │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐   MODULE
│ Every ~10 minutes: look for trouble signs    │
│  - an order stuck with no update for ~2      │
│    days                                      │
│  - a merchant that's gone completely quiet    │
│    (no calls from Unicommerce for a few       │
│    hours, when there normally would be)       │
│ → raise an alert, shown on the admin screen   │
└───────────────────────────────────────────┘
```

### 5d. Closing the loop — a human fixes what the system couldn't

```
        Admin screen shows: failed jobs, alerts
              │  merchant/support clicks "Retry" or
              │  "Run reconciliation"
              ▼
┌───────────────────────────────────────────┐   MODULE
│ Retry: picks the exact same job back up    │
│ and runs it through the SAME push logic    │
│ as section 5b                              │
│                                             │
│ Reconciliation: runs the same "did this     │
│ order actually reach Unicommerce?" check    │
│ as the automatic sweep (5c), but for a      │
│ time range the admin picks, and reports     │
│ progress back while it runs                 │
└───────────────────────────────────────────┘
```

**Net effect:** nothing is ever silently lost. Every inbound call from
Unicommerce gets a response either way (success, disabled, or a clear error)
and is logged. Every outbound push either succeeds, gets retried with
increasing delays, or lands somewhere a human can see and retry it. And even
if all of that is somehow skipped, the 10-minute sweep and alerting jobs
independently re-check everything on their own, with no dependency on the
request-driven path having worked.
