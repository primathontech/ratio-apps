# Loyalty QR Claim v2 (Storefront-Owned Identity) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move QR-claim identity out of our backend — the storefront BFF resolves the verified phone (via its own KwikPass/GoKwik) and HMAC-signs it per-merchant; our backend just verifies the signature and credits. Browser talks only to the storefront.

**Architecture:** Three units. (1) Our backend (`apps/backend/src/modules/loyalty`) verifies a per-merchant HMAC over `{merchantId, qr, phone, ts}` and credits — no KwikPass/GoKwik. (2) The SDK widget (`packages/loyalty-sdk`) calls same-origin storefront routes only. (3) The storefront wrapper (`wellversed-2.0`) owns identity: a client widget + two BFF routes.

**Tech Stack:** NestJS 11 + Fastify + Kysely + MySQL (backend); Lit 3 + Vite (SDK); Vitest; Node `crypto` for HMAC; Next.js App Router (storefront BFF, separate repo).

**Spec:** `docs/superpowers/specs/2026-07-21-loyalty-qr-claim-storefront-identity-design.md` (gitignored path; content mirrored by this plan).

## Global Constraints

- Conventional commits, scope `loyalty` (or `shared`/`backend` where apt); end backend/shared commit messages with the repo's `Co-Authored-By` trailer.
- Signature payload string is EXACTLY `` `${merchantId}.${qr}.${phone}.${ts}` `` (dot-joined, in this order); HMAC-SHA256; hex digest; compared with `crypto.timingSafeEqual`.
- Timestamp freshness window: `Math.abs(Date.now() - ts) <= 5 * 60 * 1000`.
- Phone is E.164 (`+91XXXXXXXXXX`) — the storefront resolves + normalizes it; the backend treats it as an opaque key (it is already normalized by the resolver).
- `loyalty_qr_scans` uniqueness stays `(qr_code_id, phone)` — DO NOT change it.
- No secret, raw phone (mask to last-4), token, or signature in logs.
- Zod 3/4 boundary: DTO re-exports the shared schema; controllers cast via `as unknown as ZodType<T>` (repo precedent in `config.controller.ts`).
- `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` must pass at the end.

---

### Task 1: Rewrite the shared claim request schema

**Files:**
- Modify: `packages/shared/src/schemas/loyalty-claim.ts`
- Test: `packages/shared/src/schemas/loyalty-claim.test.ts` (create)

**Interfaces:**
- Produces: `loyaltyClaimRequestSchema` (Zod), `type LoyaltyClaimRequest = { merchantId: string; phone: string; ts: number; sig: string }`. `LoyaltyClaimResponse` unchanged. `LoyaltyQrStatus` unchanged.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/schemas/loyalty-claim.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { loyaltyClaimRequestSchema } from './loyalty-claim';

describe('loyaltyClaimRequestSchema', () => {
  const valid = { merchantId: 'm1', phone: '+919876543210', ts: 1_700_000_000_000, sig: 'abc123' };

  it('accepts a well-formed signed claim', () => {
    expect(loyaltyClaimRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a raw gkAccessToken-style body (old shape)', () => {
    expect(loyaltyClaimRequestSchema.safeParse({ gkAccessToken: 'x' }).success).toBe(false);
  });

  it('rejects extra keys (strict) and missing fields', () => {
    expect(loyaltyClaimRequestSchema.safeParse({ ...valid, phoneNumber: 'y' }).success).toBe(false);
    expect(loyaltyClaimRequestSchema.safeParse({ merchantId: 'm1' }).success).toBe(false);
  });

  it('requires ts to be a positive integer', () => {
    expect(loyaltyClaimRequestSchema.safeParse({ ...valid, ts: -1 }).success).toBe(false);
    expect(loyaltyClaimRequestSchema.safeParse({ ...valid, ts: 1.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (old schema still `{gkAccessToken}`)

Run: `pnpm --filter @ratio-app/shared exec vitest run src/schemas/loyalty-claim.test.ts`
Expected: FAIL (accepts gkAccessToken / rejects the signed shape).

- [ ] **Step 3: Rewrite the schema** — in `packages/shared/src/schemas/loyalty-claim.ts` replace the `loyaltyClaimRequestSchema` block:

```ts
/** `POST /loyalty/qr/:code/claim` request — a per-merchant SIGNED claim.
 * The storefront BFF resolves the verified phone and signs
 * `${merchantId}.${qr}.${phone}.${ts}` with the merchant's claim secret.
 * Our backend never sees a KwikPass token or a client-supplied unsigned phone. */
export const loyaltyClaimRequestSchema = z
  .object({
    merchantId: z.string().min(1).max(128),
    phone: z.string().min(1).max(20),
    ts: z.number().int().positive(),
    sig: z.string().min(1).max(256),
  })
  .strict();

export type LoyaltyClaimRequest = z.infer<typeof loyaltyClaimRequestSchema>;
```

- [ ] **Step 4: Run test — expect PASS**, then rebuild shared

Run: `pnpm --filter @ratio-app/shared exec vitest run src/schemas/loyalty-claim.test.ts && pnpm --filter @ratio-app/shared build`
Expected: PASS; build emits updated types.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/loyalty-claim.ts packages/shared/src/schemas/loyalty-claim.test.ts
git commit -m "feat(shared): loyalty claim schema is a per-merchant signed request

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ClaimSignatureService (HMAC verify)

**Files:**
- Create: `apps/backend/src/modules/loyalty/qr/claim-signature.service.ts`
- Test: `apps/backend/test/unit/apps/loyalty/claim-signature.service.test.ts`

**Interfaces:**
- Produces: `ClaimSignatureService` with
  `verify(input: { merchantId: string; qr: string; phone: string; ts: number; sig: string; secret: string }): 'ok' | 'bad_signature' | 'stale'`
  and static `sign(payload: { merchantId: string; qr: string; phone: string; ts: number }, secret: string): string` (used by tests and, if ever needed, tooling).
- Consumes: nothing (pure, Node `crypto`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ClaimSignatureService } from '../../../../src/modules/loyalty/qr/claim-signature.service';

const SECRET = 'test-secret-value';
const base = { merchantId: 'm1', qr: 'CODE1', phone: '+919876543210' };
const svc = new ClaimSignatureService();

function signed(ts: number) {
  return ClaimSignatureService.sign({ ...base, ts }, SECRET);
}

describe('ClaimSignatureService', () => {
  it('accepts a valid, fresh signature', () => {
    const ts = Date.now();
    expect(svc.verify({ ...base, ts, sig: signed(ts), secret: SECRET })).toBe('ok');
  });

  it('rejects a tampered field (phone)', () => {
    const ts = Date.now();
    expect(
      svc.verify({ ...base, phone: '+910000000000', ts, sig: signed(ts), secret: SECRET }),
    ).toBe('bad_signature');
  });

  it('rejects a signature made with a different secret', () => {
    const ts = Date.now();
    const otherSig = ClaimSignatureService.sign({ ...base, ts }, 'other-secret');
    expect(svc.verify({ ...base, ts, sig: otherSig, secret: SECRET })).toBe('bad_signature');
  });

  it('rejects a stale timestamp (> 5 min)', () => {
    const ts = Date.now() - 6 * 60 * 1000;
    expect(svc.verify({ ...base, ts, sig: signed(ts), secret: SECRET })).toBe('stale');
  });

  it('rejects a future-skewed timestamp (> 5 min ahead)', () => {
    const ts = Date.now() + 6 * 60 * 1000;
    expect(svc.verify({ ...base, ts, sig: signed(ts), secret: SECRET })).toBe('stale');
  });

  it('rejects a malformed-length sig without throwing', () => {
    const ts = Date.now();
    expect(svc.verify({ ...base, ts, sig: 'short', secret: SECRET })).toBe('bad_signature');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** ("Cannot find module … claim-signature.service")

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/claim-signature.service.test.ts`

- [ ] **Step 3: Implement** — `apps/backend/src/modules/loyalty/qr/claim-signature.service.ts`

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const TS_WINDOW_MS = 5 * 60 * 1000;

export interface ClaimSignaturePayload {
  merchantId: string;
  qr: string;
  phone: string;
  ts: number;
}

/**
 * Verifies the per-merchant HMAC that attests a QR-claim phone. The storefront
 * BFF signs `${merchantId}.${qr}.${phone}.${ts}` with the merchant's claim
 * secret; we recompute and constant-time compare. No KwikPass/GoKwik here.
 */
@Injectable()
export class ClaimSignatureService {
  static sign(payload: ClaimSignaturePayload, secret: string): string {
    const msg = `${payload.merchantId}.${payload.qr}.${payload.phone}.${payload.ts}`;
    return createHmac('sha256', secret).update(msg).digest('hex');
  }

  verify(input: ClaimSignaturePayload & { sig: string; secret: string }): 'ok' | 'bad_signature' | 'stale' {
    const expected = ClaimSignatureService.sign(input, input.secret);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(input.sig, 'utf8');
    // Length-guard BEFORE timingSafeEqual (it throws on length mismatch).
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'bad_signature';
    if (Math.abs(Date.now() - input.ts) > TS_WINDOW_MS) return 'stale';
    return 'ok';
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/claim-signature.service.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/loyalty/qr/claim-signature.service.ts apps/backend/test/unit/apps/loyalty/claim-signature.service.test.ts
git commit -m "feat(loyalty): per-merchant HMAC claim-signature verifier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: DB migration + types + bootstrap for `claim_signing_secret`

**Files:**
- Create: `apps/backend/src/modules/loyalty/db/migrations/0002_claim_signing_secret.ts`
- Modify: `apps/backend/src/modules/loyalty/db/types.ts` (add column to `LoyaltyConfigsTable`)
- Modify: `apps/backend/src/modules/loyalty/loyalty.bootstrap.ts` (generate on install)
- Test: `apps/backend/test/unit/apps/loyalty/bootstrap.test.ts` (create)

**Interfaces:**
- Produces: `LoyaltyConfigsTable.claimSigningSecret: string | null`; a bootstrap that sets it when absent. `generateClaimSecret(): string` exported from the bootstrap file for reuse.

- [ ] **Step 1: Write the migration** — `0002_claim_signing_secret.ts`

```ts
import { randomBytes } from 'node:crypto';
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE loyalty_configs ADD COLUMN claim_signing_secret VARCHAR(64) NULL`.execute(db);
  // Backfill existing merchants with a generated secret.
  const rows = await sql<{ merchant_id: string }>`SELECT merchant_id FROM loyalty_configs WHERE claim_signing_secret IS NULL`.execute(db);
  for (const r of rows.rows) {
    const secret = randomBytes(32).toString('base64');
    await sql`UPDATE loyalty_configs SET claim_signing_secret = ${secret} WHERE merchant_id = ${r.merchant_id}`.execute(db);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE loyalty_configs DROP COLUMN claim_signing_secret`.execute(db);
}
```

- [ ] **Step 2: Add the column to `db/types.ts`** — in `LoyaltyConfigsTable`, after `exportEmail`:

```ts
  claimSigningSecret: string | null;
```

- [ ] **Step 3: Write the failing bootstrap test** — `bootstrap.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { generateClaimSecret, LoyaltyBootstrap } from '../../../../src/modules/loyalty/loyalty.bootstrap';

describe('generateClaimSecret', () => {
  it('returns a 32-byte base64 string (44 chars)', () => {
    const s = generateClaimSecret();
    expect(Buffer.from(s, 'base64')).toHaveLength(32);
  });
});

describe('LoyaltyBootstrap', () => {
  it('inserts a config row with a claim_signing_secret on install', async () => {
    const captured: Record<string, unknown>[] = [];
    const trx = {
      insertInto: () => ({
        values: (v: Record<string, unknown>) => {
          captured.push(v);
          return { onDuplicateKeyUpdate: () => ({ execute: async () => {} }) };
        },
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal trx stub
    await new LoyaltyBootstrap().run(trx as any, 'm1');
    expect(captured[0]?.merchantId).toBe('m1');
    expect(typeof captured[0]?.claimSigningSecret).toBe('string');
    expect(Buffer.from(String(captured[0]?.claimSigningSecret), 'base64')).toHaveLength(32);
  });
});
```

- [ ] **Step 4: Run test — expect FAIL** (`generateClaimSecret` not exported; secret not set)

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/bootstrap.test.ts`

- [ ] **Step 5: Update the bootstrap** — `loyalty.bootstrap.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { LoyaltyDatabase } from './db/types';

/** 32-byte base64 claim-signing secret (per merchant). */
export function generateClaimSecret(): string {
  return randomBytes(32).toString('base64');
}

@Injectable()
export class LoyaltyBootstrap implements AppBootstrap<LoyaltyDatabase> {
  private readonly logger = new Logger(LoyaltyBootstrap.name);

  async run(trx: Transaction<LoyaltyDatabase>, merchantId: string): Promise<void> {
    await trx
      .insertInto('loyalty_configs')
      .values({ merchantId, claimSigningSecret: generateClaimSecret() })
      // Reinstall preserves existing settings incl. the secret (no-op self-update).
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'loyalty config seeded', merchantId });
  }
}
```

- [ ] **Step 6: Run test — expect PASS**; apply the migration locally

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/bootstrap.test.ts`
Then: `RATIO_LOYALTY_DATABASE_URL="mysql://app:app@localhost:3306/loyalty_app" pnpm --filter @ratio-app/backend exec tsx scripts/migrate.ts loyalty`
Expected: PASS; migrate prints `OK 0002_claim_signing_secret`.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/loyalty/db/migrations/0002_claim_signing_secret.ts apps/backend/src/modules/loyalty/db/types.ts apps/backend/src/modules/loyalty/loyalty.bootstrap.ts apps/backend/test/unit/apps/loyalty/bootstrap.test.ts
git commit -m "feat(loyalty): per-merchant claim_signing_secret (migration + bootstrap)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rewrite the claim controller to verify the signature (drop GoKwik)

**Files:**
- Modify: `apps/backend/src/modules/loyalty/qr/qr-claim.controller.ts`
- Modify: `apps/backend/src/modules/loyalty/loyalty.module.ts` (provide `ClaimSignatureService`; drop GK provider)
- Delete: `apps/backend/src/modules/loyalty/core-client/gokwik-identity.client.ts` and its test `gokwik-identity-client.test.ts`
- Modify: `apps/backend/src/modules/loyalty/tokens.ts` (remove `LOYALTY_GK_IDENTITY`)
- Modify: `apps/backend/src/config/env.schema.ts` (remove `LOYALTY_GK_CUSTOMER_API_URL`)
- Modify: `.env`, `.env.example` (remove `LOYALTY_GK_CUSTOMER_API_URL`)
- Test: `apps/backend/test/unit/apps/loyalty/qr-claim.controller.test.ts` (rewrite claim cases)

**Interfaces:**
- Consumes: `ClaimSignatureService.verify` (Task 2); `loyaltyClaimRequestSchema` (Task 1); `loyalty_configs.claimSigningSecret` (Task 3).
- Produces: `POST /loyalty/qr/:code/claim` accepting `{ merchantId, phone, ts, sig }`.

- [ ] **Step 1: Rewrite the claim tests** — replace the GoKwik-based cases in `qr-claim.controller.test.ts` with signed-request cases. Key cases (use the existing fake-qr-db + FakeCoreLoyalty helpers; add a config row carrying `claimSigningSecret: 'sek'`):

```ts
// helper
import { ClaimSignatureService } from '../../../../src/modules/loyalty/qr/claim-signature.service';
const SECRET = 'sek';
function signedBody(merchantId: string, qr: string, phone: string) {
  const ts = Date.now();
  return { merchantId, phone, ts, sig: ClaimSignatureService.sign({ merchantId, qr, phone, ts }, SECRET) };
}

it('credits once for a valid signature (key qr:{id}:{phone})', async () => { /* claim → status 'credited'; FakeCoreLoyalty.calls has key qr:<qrId>:+919876543210 */ });
it('second valid claim for same phone+QR → already_claimed', async () => { /* unique index → already_claimed + balance */ });
it('rejects a bad signature → invalid_signature (no credit)', async () => { /* tamper sig → { status:'invalid_signature' }; no Core call */ });
it('rejects a signature signed with another merchant’s secret', async () => { /* config secret differs → invalid_signature */ });
it('rejects a stale timestamp → invalid_signature', async () => { /* ts-6min */ });
it('terminal QR state (paused/expired/fully_claimed) → unavailable, no verify', async () => { /* qrStateFor !== active */ });
it('new phone creates a mirror row flagged qr', async () => { /* isNewPhone true */ });
```

- [ ] **Step 2: Run tests — expect FAIL** (controller still calls `gk.verify`)

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/qr-claim.controller.test.ts`

- [ ] **Step 3: Rewrite the controller.** In `qr-claim.controller.ts`: remove the `GokwikIdentityClient` import + `@Inject(LOYALTY_GK_IDENTITY)`; inject `ClaimSignatureService` and keep `LOYALTY_CONFIG` access to read the secret. Replace the identity block inside `claim(...)`:

```ts
// (constructor) add: private readonly sig: ClaimSignatureService,
// remove: @Inject(LOYALTY_GK_IDENTITY) private readonly gk

@Post(':code/claim')
async claim(
  @Param('code') code: string,
  @Body(new ZodValidationPipe(loyaltyClaimRequestSchema as unknown as ZodType<LoyaltyClaimRequest>))
  body: LoyaltyClaimRequest,
  @Req() req: FastifyRequest,
): Promise<LoyaltyClaimResponse> {
  await this.rateLimit(`loyalty:qrc:${req.ip}`, CLAIM_LIMIT);
  const qr = await this.qrByCode(code);
  const state = qrStateFor(qr);
  if (state !== 'active') return { status: 'unavailable', state };

  // The QR's true owner is authoritative — never the body's merchantId alone.
  if (body.merchantId !== qr.merchantId) return { status: 'invalid_signature' };

  const secretRow = await this.handle.db
    .selectFrom('loyalty_configs')
    .select('claimSigningSecret')
    .where('merchantId', '=', qr.merchantId)
    .limit(1)
    .executeTakeFirst();
  const secret = secretRow?.claimSigningSecret;
  if (!secret) return { status: 'invalid_signature' };

  const verdict = this.sig.verify({
    merchantId: qr.merchantId, qr: code, phone: body.phone, ts: body.ts, sig: body.sig, secret,
  });
  if (verdict !== 'ok') return { status: 'invalid_signature' };

  const phone = body.phone;
  // ...UNCHANGED from here: mirror INSERT IGNORE, scan INSERT IGNORE,
  //    already_claimed path, atomic counters, max-scans compensation,
  //    Core credit (idempotency `qr:${qr.id}:${phone}`), mirror balance update...
}
```
Add `'invalid_signature'` to the `LoyaltyClaimResponse` union in `packages/shared/src/schemas/loyalty-claim.ts` (replace the `invalid_session` literal, or keep both — the widget maps either to a login/retry state). Update `loyaltyClaimResponseSchema` accordingly and rebuild shared.

- [ ] **Step 4: Update the module + remove GK wiring.** In `loyalty.module.ts`: import `ClaimSignatureService`, add it to `providers`; delete the `LOYALTY_GK_IDENTITY` provider block and the `GokwikIdentityClient` import; drop `LOYALTY_GK_IDENTITY` from the token re-exports. In `tokens.ts` delete `LOYALTY_GK_IDENTITY`. Delete `gokwik-identity.client.ts` + its test. In `env.schema.ts` delete the `LOYALTY_GK_CUSTOMER_API_URL` line; remove it from `.env` and `.env.example`.

- [ ] **Step 5: Run tests + typecheck — expect PASS / 0 errors**

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/qr-claim.controller.test.ts && pnpm exec tsc --noEmit`
Expected: PASS; no references to `LOYALTY_GK_IDENTITY` / `GokwikIdentityClient` / `LOYALTY_GK_CUSTOMER_API_URL` remain: `grep -rn "GK_CUSTOMER_API_URL\|GokwikIdentity\|LOYALTY_GK_IDENTITY" apps/backend/src .env .env.example` → empty.

- [ ] **Step 6: Commit**

```bash
git add apps/backend packages/shared/src/schemas/loyalty-claim.ts .env.example
git commit -m "feat(loyalty): verify signed claim; remove GoKwik identity from backend

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Admin claim-secret reveal/rotate + Settings panel

**Files:**
- Modify: `apps/backend/src/modules/loyalty/config/config.service.ts` (reveal + rotate)
- Modify: `apps/backend/src/modules/loyalty/config/config.controller.ts` (2 guarded routes; add `claimSecretSet` to GET)
- Modify: `packages/shared/src/schemas/loyalty-config.ts` (GET response adds `claimSecretSet: boolean`; NOT the secret)
- Modify: `apps/admin-loyalty/src/routes/config.tsx` (+ `src/hooks/useLoyalty.ts` reveal/rotate hooks)
- Test: `apps/backend/test/unit/apps/loyalty/config.service.test.ts` (reveal/rotate), `apps/admin-loyalty/src/routes/config.test.tsx` (panel)

**Interfaces:**
- Produces: `GET /loyalty/api/loyalty-config/claim-secret` → `{ secret: string }` (MT-guarded); `POST /loyalty/api/loyalty-config/claim-secret/rotate` → `{ secret: string }` (MT-guarded, regenerates + persists). GET `/loyalty-config` gains `claimSecretSet: boolean`.

- [ ] **Step 1: Write failing service tests** — reveal returns stored secret; rotate writes a new 32-byte base64 secret and returns it; GET config never includes the raw secret (only `claimSecretSet`). (Use the chainable Kysely mock style from `wizzy-config.service.test.ts`.)

- [ ] **Step 2: Run — expect FAIL.** `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/config.service.test.ts`

- [ ] **Step 3: Implement** — `config.service.ts`: `getClaimSecret(merchantId)` (select `claimSigningSecret`, 404 if absent); `rotateClaimSecret(merchantId)` (`generateClaimSecret()` from bootstrap, UPDATE, return it). In `getByMerchantId`, do NOT return the secret; add `claimSecretSet: Boolean(row.claimSigningSecret)` to the response shape (extend the shared config output type with `claimSecretSet`). `config.controller.ts`: add the two `@UseGuards(LoyaltyMerchantTokenGuard)` routes delegating to the service.

- [ ] **Step 4: Admin panel** — in `config.tsx` add a "Storefront claim secret" card: `useClaimSecret()` (lazy GET, masked reveal) + `useRotateClaimSecret()` (POST), and a copy block rendering `LOYALTY_CLAIM_SECRET=<secret>`. Add the two hooks to `useLoyalty.ts`. Write `config.test.tsx` asserting the panel reveals on click and calls rotate.

- [ ] **Step 5: Run — expect PASS.**

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/loyalty/config.service.test.ts` and `pnpm --filter @ratio-app/admin-loyalty test`

- [ ] **Step 6: Commit** `feat(loyalty): reveal/rotate per-merchant claim secret in admin Settings`.

---

### Task 6: SDK widget → same-origin storefront routes

**Files:**
- Modify: `packages/loyalty-sdk/src/client.ts` (base = `window.location.origin`; `/api/loyalty/*`; drop ngrok header + envelope unwrap)
- Modify: `packages/loyalty-sdk/src/claim-widget.ts` (post `{qr, gkAccessToken}` to the BFF claim route; keep KwikPass token read)
- Modify: `packages/loyalty-sdk/src/loader.ts` (widget base is the page origin, not script-src apiBase)
- Test: `packages/loyalty-sdk/src/client.test.ts`, `claim-widget.test.ts`, `script-include.integration.test.ts` (same-origin BFF stub, no envelope)

**Interfaces:**
- Consumes: storefront BFF routes `GET /api/loyalty/status?qr=CODE` → `LoyaltyQrStatus`; `POST /api/loyalty/claim {qr, gkAccessToken}` → `LoyaltyClaimResponse`.
- Produces: `LoyaltyClient({ baseUrl })` where `baseUrl = window.location.origin`.

- [ ] **Step 1: Update client tests** — the client hits `${origin}/api/loyalty/status?qr=CODE` and `${origin}/api/loyalty/claim`; NO `ngrok-skip-browser-warning` header; returns the body as-is (BFF is not enveloped). Remove the envelope-unwrap test; add a "no ngrok header sent" assertion.

- [ ] **Step 2: Run — expect FAIL.** `cd packages/loyalty-sdk && pnpm exec vitest run src/client.test.ts`

- [ ] **Step 3: Implement** — `client.ts`:

```ts
export interface LoyaltyClientConfig { baseUrl: string; }
// request(): plain fetch, no ngrok header, no envelope unwrap:
//   const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { ...init, signal });
//   if (!res.ok) throw new LoyaltyClientError(res.status, await res.text());
//   return (await res.json()) as T;
qrStatus(qr: string) { return this.request<LoyaltyQrStatus>(`/api/loyalty/status?qr=${encodeURIComponent(qr)}`); }
claim(qr: string, gkAccessToken: string) {
  return this.request<LoyaltyClaimResponse>('/api/loyalty/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qr, gkAccessToken }),
  });
}
```
`claim-widget.ts`: build the client with `{ baseUrl: window.location.origin }`; on claim read the KwikPass token (existing `getKwikPassToken()`) and call `client.claim(this.code, token)`. `loader.ts`: pass `baseUrl: location.origin` when constructing/mounting; keep `?loyalty_qr` self-init + classic IIFE injection + `?v=SDK_VERSION` cache-bust.

- [ ] **Step 4: Update the integration test** — `script-include.integration.test.ts`: stub same-origin `/api/loyalty/status` + `/api/loyalty/claim` returning PLAIN (non-enveloped) JSON; assert the widget renders the reward and a claim credits. Remove ngrok/envelope bits.

- [ ] **Step 5: Run — expect PASS + budgets**

Run: `cd packages/loyalty-sdk && pnpm test && pnpm typecheck && pnpm build && pnpm size`

- [ ] **Step 6: Commit** `feat(loyalty-sdk): call same-origin storefront BFF; drop backend/ngrok coupling`.

---

### Task 7: Storefront wrapper (wellversed-2.0) — client widget + 2 BFF routes

> **Separate repo** (`…/wizzy/wellversed-2.0`). In scope as a deliverable; runs in that repo's CI, not this monorepo's. Follow the `storefront-widget` skill.

**Files (in wellversed-2.0):**
- Create: `src/widgets/common/LoyaltyClaim/{index.tsx,types.ts,variants.ts,V1/index.tsx}` (FBT-style wrapper; loads the SDK loader from `NEXT_PUBLIC_LOYALTY_SDK_URL`)
- Create: `src/app/api/loyalty/status/route.ts` (proxy)
- Create: `src/app/api/loyalty/claim/route.ts` (resolve verified phone via the storefront's GoKwik customer-profile client; HMAC-sign; POST to our backend)
- Modify: `src/editor-integration/widget-registry.ts` (register `WIDGET_TYPES.LoyaltyClaim`); root/layout template placement
- Env: `LOYALTY_API_BASE_URL`, `LOYALTY_CLAIM_SECRET`, `LOYALTY_MERCHANT_ID` (server-side only)

**Interfaces:**
- Consumes: SDK contract (Task 6); our backend `GET /loyalty/qr/:code/status`, `POST /loyalty/qr/:code/claim {merchantId, phone, ts, sig}`; the same HMAC recipe as `ClaimSignatureService.sign`.

- [ ] **Step 1: `status` BFF route** — `route.ts`:

```ts
export async function GET(req: Request) {
  const qr = new URL(req.url).searchParams.get('qr');
  if (!qr) return Response.json({ error: 'missing qr' }, { status: 400 });
  const r = await fetch(`${process.env.LOYALTY_API_BASE_URL}/loyalty/qr/${encodeURIComponent(qr)}/status`);
  const env = await r.json();               // backend { status_code, message, data }
  return Response.json(env.data ?? env, { status: r.ok ? 200 : r.status });
}
```

- [ ] **Step 2: `claim` BFF route** — resolve the verified phone, sign, forward:

```ts
import { createHmac } from 'node:crypto';
export async function POST(req: Request) {
  const { qr, gkAccessToken } = await req.json();
  const merchantId = process.env.LOYALTY_MERCHANT_ID!;
  // 1. verified phone from the shopper's KwikPass token (storefront's own GoKwik call)
  const profile = await fetch(`${process.env.NEXT_PUBLIC_CUSTOM_API_CUSTOMER_URL}/customers/profile`, {
    headers: { 'gk-access-token': gkAccessToken, 'gk-merchant-id': merchantId },
  });
  if (!profile.ok) return Response.json({ status: 'invalid_session' }, { status: 200 });
  const p = await profile.json();
  const phone = normalizeE164(p.data?.phone ?? p.phone);   // reuse the storefront's normalizer
  if (!phone) return Response.json({ status: 'invalid_session' }, { status: 200 });
  // 2. sign  3. forward
  const ts = Date.now();
  const sig = createHmac('sha256', process.env.LOYALTY_CLAIM_SECRET!)
    .update(`${merchantId}.${qr}.${phone}.${ts}`).digest('hex');
  const r = await fetch(`${process.env.LOYALTY_API_BASE_URL}/loyalty/qr/${encodeURIComponent(qr)}/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ merchantId, phone, ts, sig }),
  });
  const env = await r.json();
  return Response.json(env.data ?? env, { status: 200 });
}
```

- [ ] **Step 3: Wrapper widget** — copy `src/widgets/common/FBT/` anatomy: `"use client"`, return `null` unless `?loyalty_qr=` present, `loadSdkOnce()` from `NEXT_PUBLIC_LOYALTY_SDK_URL`, mount the overlay. Register in `widget-registry.ts` and place at the root/layout template.

- [ ] **Step 4: Manual verification** — `pnpm --filter storefront build`; on a page with `?loyalty_qr=CODE`, log in via KwikPass, click Claim → coins credited; verify the scan appears in the loyalty admin.

- [ ] **Step 5: Commit (in wellversed-2.0)** `feat(loyalty): storefront claim widget + signed BFF routes`.

---

### Task 8: Cleanup, docs, and full verification

**Files:**
- Modify: `docs/agent/apps/loyalty/TRD.md` (§2b/§4 — replace GoKwik-verify with signed-BFF flow), `docs/agent/apps/loyalty/STATE.json` (note the v2 claim change)
- Modify: `.claude/skills/storefront-widget/SKILL.md` (note the BFF-signing pattern for identity-bearing widgets)

- [ ] **Step 1:** Update the TRD claim sections + STATE.json notes to the v2 flow; document `LOYALTY_CLAIM_SECRET` + the BFF routes in the storefront-widget skill.

- [ ] **Step 2: Full workspace verify**

Run: `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`
Expected: all pass. Also `grep -rn "GokwikIdentity\|GK_CUSTOMER_API_URL\|gkAccessToken" apps/backend/src` → empty (backend has no KwikPass/GoKwik).

- [ ] **Step 3: Rebuild + restart the local backend image** and smoke-test the signed path:

```bash
docker compose build backend && docker compose up -d backend
# sign a claim with the merchant's secret and confirm 'credited' end-to-end
```

- [ ] **Step 4: Commit** `docs(loyalty): v2 signed-claim flow; skill + TRD + STATE updates`.

## Self-Review

- **Spec coverage:** backend-no-GoKwik (T4,T8), browser same-origin (T6), FBT split (T6,T7), trustworthy phone via signature (T2,T4,T7), per-merchant secret + Settings (T3,T5), uniqueness unchanged (Global Constraints + T4), security/replay (T2), testing (every task), acceptance criteria (mapped across T1–T8). Covered.
- **Placeholder scan:** the claim controller's unchanged tail is referenced, not re-pasted, because it is explicitly "UNCHANGED" existing code the implementer preserves — the changed region is shown in full. All new code shown.
- **Type consistency:** `ClaimSignatureService.sign/verify` payload `{merchantId, qr, phone, ts}` + `sig`/`secret` is identical across T2, T4, T7; claim body `{merchantId, phone, ts, sig}` matches the shared schema (T1) and the BFF (T7); signature string `${merchantId}.${qr}.${phone}.${ts}` is byte-identical in T2 and T7.
