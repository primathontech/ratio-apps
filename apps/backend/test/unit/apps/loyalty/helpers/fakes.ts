import type {
  CoreBalanceResponse,
  CorePointsResponse,
} from '../../../../../src/modules/loyalty/core-client/core-loyalty.client';
import type { VerifiedGkCustomer } from '../../../../../src/modules/loyalty/core-client/gokwik-identity.client';
import type { LoyaltyCustomerRow } from '../../../../../src/modules/loyalty/db/types';

/**
 * Shared fakes for the loyalty test suite. Everything external is in-memory:
 * the Core Loyalty ledger honors idempotency keys (so double-credit tests are
 * real), Redis is a Map, SQS is an array, S3/Email record calls.
 */

// ── Core Loyalty ledger fake ────────────────────────────────────────────────

export interface FakeCoreCall {
  op: 'credit' | 'debit';
  merchantId: string;
  phone: string;
  points: number;
  idempotencyKey: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export class FakeCoreLoyalty {
  readonly calls: FakeCoreCall[] = [];
  readonly balances = new Map<string, number>();
  private readonly seenKeys = new Map<string, CorePointsResponse>();
  private txnSeq = 0;
  /** Scriptable failure: phone → error to throw on next call. */
  readonly failOn = new Map<string, Error>();

  setBalance(phone: string, balance: number): void {
    this.balances.set(phone, balance);
  }

  private apply(
    input: {
      merchantId: string;
      phone: string;
      points: number;
      idempotencyKey: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
    op: 'credit' | 'debit',
  ): Promise<CorePointsResponse> {
    const scripted = this.failOn.get(input.phone);
    if (scripted) {
      this.failOn.delete(input.phone);
      return Promise.reject(scripted);
    }
    this.calls.push({ op, ...input });
    const existing = this.seenKeys.get(input.idempotencyKey);
    if (existing) return Promise.resolve(existing); // idempotent replay — no balance change
    const prev = this.balances.get(input.phone) ?? 0;
    const next = op === 'credit' ? prev + input.points : prev - input.points;
    this.balances.set(input.phone, next);
    const res: CorePointsResponse = {
      phone: input.phone,
      new_balance: next,
      transaction_id: `txn-${++this.txnSeq}`,
    };
    this.seenKeys.set(input.idempotencyKey, res);
    return Promise.resolve(res);
  }

  credit(input: Omit<FakeCoreCall, 'op'>) {
    return this.apply(input, 'credit');
  }

  debit(input: Omit<FakeCoreCall, 'op'>) {
    return this.apply(input, 'debit');
  }

  balance(_merchantId: string, phone: string): Promise<CoreBalanceResponse> {
    return Promise.resolve({
      phone,
      points_balance: this.balances.get(phone) ?? 0,
      points_earned_lifetime: this.balances.get(phone) ?? 0,
      points_redeemed_lifetime: 0,
      points_expired_lifetime: 0,
      points_adjusted_lifetime: 0,
    });
  }

  history(): Promise<{ items: Record<string, unknown>[]; pagination: Record<string, unknown> }> {
    return Promise.resolve({ items: [], pagination: { page: 1, limit: 20 } });
  }

  /** Sum of points credited (net of idempotent replays). */
  get creditedTotal(): number {
    let total = 0;
    for (const b of this.balances.values()) total += b;
    return total;
  }
}

// ── GoKwik identity fake ────────────────────────────────────────────────────

export class FakeGokwikIdentity {
  readonly tokens = new Map<string, VerifiedGkCustomer>();

  verify(token: string, _merchantId: string): Promise<VerifiedGkCustomer | null> {
    return Promise.resolve(this.tokens.get(token) ?? null);
  }
}

// ── Redis fake (matches core RedisService surface) ──────────────────────────

export class FakeRedis {
  readonly store = new Map<string, unknown>();
  readonly counters = new Map<string, number>();
  enabled = true;

  getJson<T>(key: string): Promise<T | null> {
    if (!this.enabled) return Promise.resolve(null);
    return Promise.resolve((this.store.get(key) as T) ?? null);
  }

  setJson(key: string, value: unknown, _ttlSeconds: number): Promise<void> {
    if (this.enabled) this.store.set(key, JSON.parse(JSON.stringify(value)));
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  allow(key: string, limit: number, _windowSeconds: number): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(true);
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return Promise.resolve(n <= limit);
  }

  firstSeen(key: string, _ttlSeconds: number): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(true);
    if (this.store.has(`seen:${key}`)) return Promise.resolve(false);
    this.store.set(`seen:${key}`, 1);
    return Promise.resolve(true);
  }
}

// ── Queue fake (matches core QueueService surface) ──────────────────────────

export class FakeQueue {
  readonly queues = new Map<string, { body: unknown; receiptHandle: string }[]>();
  readonly acked = new Map<string, string[]>();
  private seq = 0;

  sendBatch(name: string, payloads: unknown[]): Promise<void> {
    const q = this.queues.get(name) ?? [];
    for (const p of payloads) q.push({ body: p, receiptHandle: `rh-${++this.seq}` });
    this.queues.set(name, q);
    return Promise.resolve();
  }

  receive<T>(name: string, max = 10): Promise<{ body: T; receiptHandle: string }[]> {
    const q = this.queues.get(name) ?? [];
    return Promise.resolve(q.splice(0, max) as { body: T; receiptHandle: string }[]);
  }

  ack(name: string, receiptHandles: string[]): Promise<void> {
    const acked = this.acked.get(name) ?? [];
    acked.push(...receiptHandles);
    this.acked.set(name, acked);
    return Promise.resolve();
  }
}

// ── S3 / Email recording fakes ──────────────────────────────────────────────

export class FakeS3 {
  readonly puts: { bucket: string; key: string; body: Buffer; contentType: string }[] = [];
  failNext: Error | null = null;

  putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      return Promise.reject(err);
    }
    this.puts.push({ bucket, key, body: Buffer.from(body as Buffer), contentType });
    return Promise.resolve();
  }

  presignGetUrl(bucket: string, key: string, expiresSeconds: number): Promise<string> {
    return Promise.resolve(`https://s3.fake/${bucket}/${key}?expires=${expiresSeconds}`);
  }
}

export class FakeEmail {
  readonly sends: { to: string; subject: string; html: string }[] = [];
  enabled = true;

  send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(false);
    this.sends.push({ to, subject, html });
    return Promise.resolve(true);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export const MERCHANT_ID = 'merchant-1';

export function mkCustomer(overrides: Partial<LoyaltyCustomerRow> = {}): LoyaltyCustomerRow {
  return {
    merchantId: MERCHANT_ID,
    phone: '+919876543210',
    name: 'Priya Mehta',
    email: 'priya@example.com',
    pointsBalance: 0,
    lifetimeEarned: 0,
    lifetimeRedeemed: 0,
    lifetimeExpired: 0,
    lifetimeAdjusted: 0,
    lifetimeSpend: '0.00',
    lifetimeOrders: 0,
    lastOrderAt: null,
    firstSeenSource: 'order',
    balanceSyncedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as LoyaltyCustomerRow;
}

/** An `orders/create` resource payload the platform delivers. */
export function mkOrderPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1001',
    total_price: '1000.00',
    customer: { phone: '9876543210', first_name: 'Priya', email: 'priya@example.com' },
    line_items: [{ id: 'li-1', quantity: 2 }],
    ...overrides,
  };
}
