import { BadRequestException } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DatabaseWithMerchants,
  MerchantRow,
} from '../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../src/core/webhooks/webhook-log.types';
import { WebhooksService } from '../../../src/core/webhooks/webhooks.service';
import {
  WEBHOOK_MAX_PAYLOAD_BYTES,
  type WebhookEnvelope,
  type WebhookHandler,
  webhookEnvelopeSchema,
} from '../../../src/core/webhooks/webhooks.types';

type DB = DatabaseWithMerchants & DatabaseWithWebhookLog;

/**
 * A fake Kysely client that captures the structural calls
 * (`insertInto`, `selectFrom`, `updateTable`, `transaction`) WebhooksService
 * makes. Only the methods touched by the service are implemented; everything
 * else returns chainable no-ops that throw if invoked unexpectedly.
 *
 * Since dispatch() now wraps the whole flow in `this.qb.transaction()`, the
 * fake exposes a `transaction()` builder whose `.execute(cb)` invokes the
 * callback with a TRX-shaped fake. The trx fake supports:
 *   - selectFrom('merchants') — for the in-trx merchant lookup
 *   - insertInto('webhook_log').values().ignore().execute() — returns the
 *     configured `inserted` outcome
 *   - updateTable('webhook_log').set().where().execute() — counted in
 *     `state.updates`
 */
function makeFakeKysely(opts: {
  inserted: boolean;
  merchant?: MerchantRow | null;
  /** Optional: throw inside the trx after the insert to verify rollback semantics. */
  throwAfterInsert?: Error;
  /** Optional: override what selectFrom('merchants') returns. */
  merchantOverride?: MerchantRow | null;
}): {
  db: Kysely<DB>;
  inserts: number;
  updates: number;
  trxStarted: number;
  trxCommitted: number;
} {
  const state = { inserts: 0, updates: 0, trxStarted: 0, trxCommitted: 0 };

  const buildTrx = (): Transaction<DB> => {
    const merchantRowOut =
      opts.merchantOverride !== undefined ? opts.merchantOverride : opts.merchant;
    const merchantSelectChain = {
      selectAll: () => merchantSelectChain,
      where: () => merchantSelectChain,
      limit: () => merchantSelectChain,
      // `.forUpdate()` is used on the match path so the merchant row lock is
      // taken at the initial SELECT (avoiding a later S→X lock upgrade when
      // the handler issues its own FOR UPDATE on the same row).
      forUpdate: () => merchantSelectChain,
      executeTakeFirst: async () => merchantRowOut ?? undefined,
    };

    const insertChain = {
      values: () => insertChain,
      ignore: () => insertChain,
      execute: async () => {
        state.inserts += 1;
        if (opts.throwAfterInsert) throw opts.throwAfterInsert;
        return [
          {
            numInsertedOrUpdatedRows: opts.inserted ? 1n : 0n,
          },
        ];
      },
    };

    const updateChain = {
      set: () => updateChain,
      where: () => updateChain,
      execute: async () => {
        state.updates += 1;
        return [];
      },
    };

    const trx = {
      selectFrom: (table: string) => {
        if (table === 'merchants') return merchantSelectChain;
        throw new Error(
          `unexpected trx.selectFrom("${table}") — dispatch() must not SELECT from webhook_log on the loser path`,
        );
      },
      insertInto: () => insertChain,
      updateTable: () => updateChain,
    } as unknown as Transaction<DB>;

    return trx;
  };

  const db = {
    transaction: () => ({
      execute: async <T>(cb: (trx: Transaction<DB>) => Promise<T>): Promise<T> => {
        state.trxStarted += 1;
        const trx = buildTrx();
        const out = await cb(trx);
        // Only count as committed if the callback resolved without throwing.
        state.trxCommitted += 1;
        return out;
      },
    }),
  } as unknown as Kysely<DB>;

  return {
    db,
    get inserts() {
      return state.inserts;
    },
    get updates() {
      return state.updates;
    },
    get trxStarted() {
      return state.trxStarted;
    },
    get trxCommitted() {
      return state.trxCommitted;
    },
  };
}

function makeHandler(topic = 'app.uninstalled'): WebhookHandler & {
  handle: ReturnType<typeof vi.fn>;
} {
  return {
    topic,
    handle: vi.fn().mockResolvedValue(undefined),
  };
}

function envelope(overrides: Partial<WebhookEnvelope> = {}): WebhookEnvelope {
  return {
    id: 'whk_test_1',
    event: 'app.uninstalled',
    timestamp: new Date(),
    merchantId: 'mer_1',
    data: { foo: 'bar' },
    ...overrides,
  };
}

const merchantRow: MerchantRow = {
  id: 'mer_1',
  isActive: true,
  installedAt: new Date(),
  uninstalledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WebhooksService.dispatch', () => {
  let handler: ReturnType<typeof makeHandler>;

  beforeEach(() => {
    handler = makeHandler();
  });

  it('runs handler exactly once for a fresh envelope (insert wins)', async () => {
    const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    await svc.dispatch(envelope());
    expect(handler.handle).toHaveBeenCalledTimes(1);
    // Handler now receives (data, merchantId, trx) — the third arg is the trx;
    // we only assert the first two are shaped right.
    const call = handler.handle.mock.calls[0];
    expect(call?.[0]).toEqual({ foo: 'bar' });
    expect(call?.[1]).toBe('mer_1');
    expect(call?.[2]).toBeDefined(); // trx handle passed through
    // Inserted once, updated processedAt once, all inside one trx.
    expect(fake.inserts).toBe(1);
    expect(fake.updates).toBe(1);
    expect(fake.trxStarted).toBe(1);
    expect(fake.trxCommitted).toBe(1);
  });

  it('skips handler when the INSERT loses (already-seen ratio_webhook_id)', async () => {
    const fake = makeFakeKysely({ inserted: false, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    await svc.dispatch(envelope());
    expect(handler.handle).not.toHaveBeenCalled();
    // No processed_at update on the loser path.
    expect(fake.updates).toBe(0);
    // Trx still opened (and committed cleanly — the early return is a no-op,
    // not a rollback).
    expect(fake.trxStarted).toBe(1);
    expect(fake.trxCommitted).toBe(1);
  });

  it('loser path does NOT re-read processedAt (locks finding #2 — no double-execution race)', async () => {
    // The fake's trx.selectFrom only allows 'merchants'; any selectFrom on
    // webhook_log (e.g. to peek at processed_at) throws. If dispatch() ever
    // peeks at processed_at after losing the INSERT, this test crashes.
    const fake = makeFakeKysely({ inserted: false, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    await expect(svc.dispatch(envelope())).resolves.toBeUndefined();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('throws WEBHOOK_STALE BadRequestException when timestamp skews beyond the window', async () => {
    const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    const stale = envelope({ timestamp: new Date(Date.now() - 6 * 60 * 1000) });
    try {
      await svc.dispatch(stale);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('WEBHOOK_STALE');
    }
    // Stale envelopes are rejected BEFORE opening a trx or inserting anything.
    expect(fake.inserts).toBe(0);
    expect(fake.trxStarted).toBe(0);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('does NOT call handler when envelope.event !== handler.topic but DOES mark processed_at (so the row is not mistaken for crashed mid-handler)', async () => {
    const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    await svc.dispatch(envelope({ event: 'app.installed' }));
    expect(handler.handle).not.toHaveBeenCalled();
    // Row was recorded AND we marked processedAt so future dead-letter
    // scanners that look for `processed_at IS NULL` don't flag it as
    // crashed. Observers distinguish "no handler ran" from "handler ran"
    // by comparing the stored `topic` to the registered handler.topic.
    expect(fake.inserts).toBe(1);
    // Topic-mismatch fast-path: processed_at is folded into the INSERT,
    // so there is NO trailing UPDATE round-trip on the common case.
    expect(fake.updates).toBe(0);
    // Trx still committed cleanly — the topic-mismatch path is a single
    // INSERT (with processed_at = NOW() baked in) and an early return.
    expect(fake.trxStarted).toBe(1);
    expect(fake.trxCommitted).toBe(1);
  });

  // ---- C3: transactional dispatch ----

  it('rolls back the webhook_log INSERT if the handler throws (C3 self-healing)', async () => {
    const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
    handler.handle.mockRejectedValueOnce(new Error('handler boom'));
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    await expect(svc.dispatch(envelope())).rejects.toThrow('handler boom');
    // The insert ran (incrementing the counter), but the trx never reached
    // the commit point — that's what gives MySQL the chance to roll the row
    // back so Ratio's next retry sees a fresh INSERT.
    expect(fake.inserts).toBe(1);
    expect(fake.updates).toBe(0);
    expect(fake.trxStarted).toBe(1);
    expect(fake.trxCommitted).toBe(0);
  });

  it('passes the open trx as the third argument to handler.handle (so handlers can write atomically)', async () => {
    const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    await svc.dispatch(envelope());
    const trxArg = handler.handle.mock.calls[0]?.[2];
    expect(trxArg).toBeDefined();
    // Trx fake exposes the same builder shape as the top-level fake — i.e.
    // it has `insertInto`/`updateTable`/`selectFrom` callable methods.
    expect(typeof (trxArg as { insertInto?: unknown }).insertInto).toBe('function');
  });

  // ---- D7: payload-size guard ----

  it('throws WEBHOOK_PAYLOAD_TOO_LARGE when payload exceeds WEBHOOK_MAX_PAYLOAD_BYTES (D7)', async () => {
    const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    // Build a payload whose JSON-encoded byteLength comfortably exceeds the cap.
    const big = 'x'.repeat(WEBHOOK_MAX_PAYLOAD_BYTES + 16);
    try {
      await svc.dispatch(envelope({ data: { blob: big } }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as {
        error_code?: string;
        details?: { bytes: number; max: number };
      };
      expect(resp.error_code).toBe('WEBHOOK_PAYLOAD_TOO_LARGE');
      expect(resp.details?.max).toBe(WEBHOOK_MAX_PAYLOAD_BYTES);
      expect((resp.details?.bytes ?? 0) > WEBHOOK_MAX_PAYLOAD_BYTES).toBe(true);
    }
    // Rejected before opening a trx or touching the DB.
    expect(fake.trxStarted).toBe(0);
    expect(fake.inserts).toBe(0);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('accepts a payload at the boundary (just under WEBHOOK_MAX_PAYLOAD_BYTES) (D7)', async () => {
    const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
    const svc = new WebhooksService<DB>({ db: fake.db, handler });
    // Need to land just under 64KB after JSON encoding. The envelope wraps
    // `{"blob":"..."}` so the JSON overhead is 11 bytes. Subtract a safety
    // margin to keep this stable against future schema additions.
    const inner = 'x'.repeat(WEBHOOK_MAX_PAYLOAD_BYTES - 128);
    await expect(svc.dispatch(envelope({ data: { blob: inner } }))).resolves.toBeUndefined();
    expect(fake.inserts).toBe(1);
  });

  // ---- D8: regression net for Kysely InsertResult shape drift ----

  it('treats numInsertedOrUpdatedRows=1n as "inserted" and 0n as "duplicate" (D8 regression net)', async () => {
    // This is the regression net for finding D8: if a future Kysely/mysql2
    // upgrade renames `numInsertedOrUpdatedRows` (or stops returning it from
    // INSERT IGNORE), the dedupe contract silently breaks. Both branches
    // below are driven by the SAME field — if it changes name, this test
    // and the dedupe test both flip together, and CI catches it.
    const win = makeFakeKysely({ inserted: true, merchant: merchantRow });
    const lose = makeFakeKysely({ inserted: false, merchant: merchantRow });

    const svcWin = new WebhooksService<DB>({ db: win.db, handler });
    const svcLose = new WebhooksService<DB>({
      db: lose.db,
      handler: makeHandler(),
    });

    await svcWin.dispatch(envelope({ id: 'wh_win' }));
    await svcLose.dispatch(envelope({ id: 'wh_lose' }));

    // Winning insert ran the handler; losing insert did not.
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(win.updates).toBe(1);
    expect(lose.updates).toBe(0);
  });

  it.todo(
    'explicit ROW_COUNT() fallback — if Kysely ever stops surfacing numInsertedOrUpdatedRows for INSERT IGNORE, swap to a raw SELECT ROW_COUNT() inside the trx',
  );

  it.todo(
    'concurrent in-flight duplicate cannot run handler twice (DB-level race — covered by e2e)',
  );

  // ---- I4: envelope-schema length caps ----

  describe('webhookEnvelopeSchema length caps (I4)', () => {
    // `webhook_log.ratio_webhook_id` is VARCHAR(255). The schema parse
    // happens at the controller/validation pipe boundary, not inside the
    // service — we exercise the schema directly so a regression that
    // removes the cap surfaces before it can produce a MySQL truncation
    // 500 deep inside dispatch().
    const baseEnvelope = {
      id: 'whk_test_1',
      event: 'app.uninstalled',
      timestamp: new Date().toISOString(),
      merchantId: 'mer_1',
      data: { foo: 'bar' },
    };

    it('rejects id longer than 255 characters (matches webhook_log.ratio_webhook_id VARCHAR(255))', () => {
      const result = webhookEnvelopeSchema.safeParse({
        ...baseEnvelope,
        id: 'a'.repeat(256),
      });
      expect(result.success).toBe(false);
    });

    it('accepts id at exactly the 255-character boundary', () => {
      const result = webhookEnvelopeSchema.safeParse({
        ...baseEnvelope,
        id: 'a'.repeat(255),
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty id (min(1) guards against zero-length keys hitting the UNIQUE index)', () => {
      const result = webhookEnvelopeSchema.safeParse({
        ...baseEnvelope,
        id: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects event longer than 128 characters (matches webhook_log.topic VARCHAR(128))', () => {
      const result = webhookEnvelopeSchema.safeParse({
        ...baseEnvelope,
        event: 'a'.repeat(129),
      });
      expect(result.success).toBe(false);
    });

    it('accepts event at exactly the 128-character boundary', () => {
      const result = webhookEnvelopeSchema.safeParse({
        ...baseEnvelope,
        event: 'a'.repeat(128),
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty event', () => {
      const result = webhookEnvelopeSchema.safeParse({
        ...baseEnvelope,
        event: '',
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- Multi-handler routing (google app: 4 topics) ----
  // The single-handler `handler` form (exercised by every test above) must keep
  // behaving identically; these cases lock the generalized `handlers[]` routing.
  describe('multi-handler routing', () => {
    it('routes envelope.event to the matching handler among several (only it runs)', async () => {
      const uninstall = makeHandler('app.uninstalled');
      const create = makeHandler('products.create');
      const update = makeHandler('products.update');
      const remove = makeHandler('products.delete');
      const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
      const svc = new WebhooksService<DB>({
        db: fake.db,
        handlers: [uninstall, create, update, remove],
      });

      await svc.dispatch(envelope({ event: 'products.update' }));

      expect(update.handle).toHaveBeenCalledTimes(1);
      expect(create.handle).not.toHaveBeenCalled();
      expect(remove.handle).not.toHaveBeenCalled();
      expect(uninstall.handle).not.toHaveBeenCalled();
    });

    it('an event matching no registered topic runs no handler but still stamps processed_at (mismatch fast-path)', async () => {
      const create = makeHandler('products.create');
      const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
      const svc = new WebhooksService<DB>({ db: fake.db, handlers: [create] });

      await svc.dispatch(envelope({ event: 'orders.create' }));

      expect(create.handle).not.toHaveBeenCalled();
      // mismatch fast-path folds processed_at into the INSERT — no trailing UPDATE
      expect(fake.updates).toBe(0);
      expect(fake.trxCommitted).toBe(1);
    });

    it('throws at construction when two handlers register the same topic (wiring error)', () => {
      const a = makeHandler('products.create');
      const b = makeHandler('products.create');
      const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
      expect(() => new WebhooksService<DB>({ db: fake.db, handlers: [a, b] })).toThrow(
        /duplicate handler/i,
      );
    });

    it('legacy single `handler` form still dispatches (backward compatibility)', async () => {
      const only = makeHandler('app.uninstalled');
      const fake = makeFakeKysely({ inserted: true, merchant: merchantRow });
      const svc = new WebhooksService<DB>({ db: fake.db, handler: only });

      await svc.dispatch(envelope({ event: 'app.uninstalled' }));

      expect(only.handle).toHaveBeenCalledTimes(1);
    });
  });
});
