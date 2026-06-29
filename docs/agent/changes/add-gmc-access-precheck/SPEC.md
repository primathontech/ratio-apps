# GMC feed-sync account-access pre-check — spec

- **Slug:** add-gmc-access-precheck   **Type:** fix   **Size:** feature
- **Area:** backend (`modules/google`) + admin (`apps/admin-google`)

## Problem / goal

When a merchant's connected Google identity can't access the configured Merchant
Center account, every Content API write returns **403 "User cannot access account
\<id\>"**. Observed in production for merchant `4n24pimhvzplug` / GMC account
`5815163095`:

```
ERROR: custombatch failed {"context":"FeedSyncService","merchantId":"4n24pimhvzplug"}
  err: "ContentApiError: User cannot access account 5815163095"
```

**Confirmed root cause (from code trace):** the OAuth token refresh *succeeds*
(`GoogleAuthService.getGmcAccessToken` returns a valid token), so the existing
reconnect machinery never trips. The failure is purely an *authorization* one at
the Content API. Today `runFullSync` (`feed-sync.service.ts:269-272`) catches the
403, logs `custombatch failed`, marks the whole batch errored, and **keeps
iterating every remaining 1000-product batch** — flooding the logs with identical
403s and never signalling the merchant. Concurrent `POST /feed/sync` calls then
pile up behind the in-flight lock and return `429 SYNC_IN_PROGRESS` (working as
designed; symptom, not bug).

The "needs reconnect" infrastructure **already exists end to end** and is unused
for this case:
- `google_credentials.needs_reconnect` column (`db/migrations/0001_initial.ts:139`)
- `GoogleAuthService.markReconnect()` sets it; OAuth refresh success clears it
  (`google-auth.service.ts:216,233-239`)
- folded into the config read as `needsReconnect` (`config.service.ts:43-50`)
- admin already renders a banner + "Reconnect Google" button when true
  (`apps/admin-google/src/routes/index.tsx:44-58`)

**Goal:** detect an account-access (401/403) failure, flip the existing
`needsReconnect` flag (lighting the existing banner), stop sending doomed
batches, and record an actionable reason in sync history — for both the OAuth and
manual service-account connection methods.

## Approach

**Detection — pre-flight + backstop (both):**

1. **Classifier.** Add `isAccountAccessError(err)` in `feed-sync.service.ts`
   (alongside `isTransientGmcError`): true when `err instanceof ContentApiError &&
   (err.status === 401 || err.status === 403)`. Content API rate/quota limits use
   `429` (already handled as transient), so 401/403 reliably means
   auth/authorization, not throttling.

2. **Pre-flight probe** at the top of `runFullSync`, before the batch loop: one
   bounded, account-scoped `ctx.client.listProducts()` call — the same proof
   `GmcValidationService` already uses (`gmc-validation.service.ts:31`). If it
   throws an account-access error → flip `needsReconnect`, write a sync-log row
   with a clear detail, and return early (**zero batches sent**). If it throws a
   transient/other error, fall through to the normal sync (don't block on a blip).
   On a *successful* probe, clear `needsReconnect` (heals the flag when access is
   restored but the token was still valid, so no refresh fired to clear it).

3. **Backstop** in the `runFullSync` batch-loop catch: if a `custombatch` throws
   an account-access error mid-run, flip `needsReconnect`, record the reason, and
   **`break`** out of the loop (stop hammering). Remaining offers stay in their
   prior state.

4. **Per-product path.** In `syncProduct` (and `deleteProduct`), treat an
   account-access error as **non-transient** so the SQS message is *not* redriven
   forever (it currently falls into `isTransientGmcError`'s `false`/permanent
   branch for 403 — confirm and make explicit), and flip `needsReconnect`.

**Merchant message — reuse the existing `needsReconnect` banner for both methods:**

- Add a public method on `GoogleAuthService` (e.g. `setNeedsReconnect(merchantId,
  value)` or expose `markReconnect`/`clearReconnect`) so `FeedSyncService` can
  flip the flag. `FeedSyncService` already injects `GoogleAuthService` as
  `this.auth`.
- Generalize the admin banner copy in `apps/admin-google/src/routes/index.tsx` so
  it covers the account-access case as well as token expiry, e.g.:
  *"Google can't access your Merchant Center account. Reconnect Google or confirm
  your account has access, then re-sync."* (Keep the Reconnect button.)
- Write a precise, actionable `google_sync_log` detail (e.g. *"Google account
  cannot access Merchant Center \<gmcMerchantId\> — reconnect or grant access"*)
  so the cause shows in admin sync history regardless of connection method.

**Alternatives rejected:**
- *Reactive only* (no pre-flight): the first batch still hits Google before we
  bail; pre-flight makes a doomed sync cost exactly one cheap call.
- *Pre-flight only*: wouldn't catch access revoked mid-sync.
- *Differentiate OAuth vs manual messaging*: more accurate for the manual key
  path, but more UI/code; the shared banner + the sync-log detail already give a
  clear, actionable message. Deferred (see Out of scope).
- *`accounts/authinfo` as the probe*: cheaper, but returns aggregator IDs for MCA
  sub-accounts, producing false negatives for valid multi-client setups.
  `listProducts()` hits the account directly and is authoritative.

## Acceptance criteria

- [ ] A full sync whose pre-flight probe returns an account-access 401/403 sends
      **zero** product batches, flips `needsReconnect = true`, and writes a
      sync-log row whose detail names the cause and the GMC account id.
- [ ] An account-access 403 that surfaces mid-sync (backstop) stops the batch loop
      on the first occurrence (no further `custombatch failed` log spam) and flips
      `needsReconnect`.
- [ ] `syncProduct`/`deleteProduct` do **not** redrive an account-access error via
      SQS (treated as permanent) and flip `needsReconnect`.
- [ ] A successful full sync clears `needsReconnect` (access restored).
- [ ] `GET .../config` returns `needsReconnect: true` after such a failure, and
      the admin banner renders with the generalized copy + a working Reconnect
      button.
- [ ] Both connection methods (OAuth and manual service-account key) flip the flag
      and produce the sync-history detail.
- [ ] Unit tests cover: `isAccountAccessError` classification (401/403 vs 429 vs
      4xx-validation vs network); pre-flight abort path; mid-sync backstop `break`;
      `syncProduct` non-transient handling; flag cleared on success.
- [ ] `pnpm verify` is green.

## Out of scope

- Changing the OAuth reconnect flow / re-auth endpoint itself.
- Auto-resolving MCA/aggregator account IDs or correcting a wrong `gmcMerchantId`.
- A separate manual-vs-OAuth remediation message (shared banner copy is used).
- Promoting the in-memory `running` sync lock to a DB advisory lock (separate
  concern noted in `feed-sync.service.ts:15`).
- Enriching `ContentApiError` with Google's full `reason`/`status` taxonomy
  (status-based classification is sufficient here).

## Context consulted

- `apps/backend/src/modules/google/gmc/feed-sync.service.ts` — sync paths, lock,
  `isTransientGmcError`, batch-loop catch.
- `apps/backend/src/modules/google/gmc/content-api.client.ts` — `ContentApiError`
  (`.status`), `listProducts`, `custombatch`.
- `apps/backend/src/modules/google/google-oauth/google-auth.service.ts` —
  `getGmcAccessToken`, `getAccessToken`, `markReconnect` (existing flag setter).
- `apps/backend/src/modules/google/config/config.service.ts` — folds
  `needsReconnect` into the config read.
- `apps/backend/src/modules/google/gmc/gmc-validation.service.ts` — existing
  `listProducts()` access-proof pattern.
- `apps/admin-google/src/routes/index.tsx` — existing reconnect banner.
- `packages/shared/src/schemas/google-config.ts` — `needsReconnect` field.
