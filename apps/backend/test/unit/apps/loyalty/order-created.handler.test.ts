import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import type { CoreLoyaltyClient } from '../../../../src/modules/loyalty/core-client/core-loyalty.client';
import type { LoyaltyCustomerRow } from '../../../../src/modules/loyalty/db/types';
import { CustomerMirrorService } from '../../../../src/modules/loyalty/mirror/customer-mirror.service';
import type {
  CachedRule,
  CachedRuleSet,
  RuleCacheService,
} from '../../../../src/modules/loyalty/rules/rule-cache.service';
import { RuleEvaluatorService } from '../../../../src/modules/loyalty/rules/rule-evaluator.service';
import { LoyaltyOrderCreatedHandler } from '../../../../src/modules/loyalty/webhooks/order-created.handler';
import { FakeCoreLoyalty, MERCHANT_ID, mkCustomer, mkOrderPayload } from './helpers/fakes';

type WebhookTrx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

const PHONE = '+919876543210';

function mkCachedRule(over: Partial<CachedRule> = {}): CachedRule {
  return {
    id: 'rule-1',
    name: 'Triple points',
    ruleType: 'MULTIPLIER',
    value: 3,
    targetType: 'CUSTOMER_LIST',
    conditions: null,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: null,
    active: true,
    priority: 0,
    ...over,
  };
}

/** Extract the raw SQL text of a `sql\`…\`` template captured by the mock. */
function sqlText(v: unknown): string {
  const node = (
    v as { toOperationNode?: () => { sqlFragments?: readonly string[] } } | undefined
  )?.toOperationNode?.();
  return node?.sqlFragments?.join('?') ?? String(v);
}

interface Captured {
  mirrorInsert?: { values: Record<string, unknown>; odku?: Record<string, unknown> };
  appInserts: Record<string, unknown>[];
  qrUpdate?: { set: Record<string, unknown>; wheres: unknown[][] };
}

function makeTrx(opts: {
  configRow?: Record<string, unknown>;
  mirrorRow?: LoyaltyCustomerRow;
  appInsertResult?: bigint;
}): { trx: WebhookTrx; captured: Captured } {
  const captured: Captured = { appInserts: [] };
  const trx = {
    selectFrom(table: string) {
      const chain = {
        selectAll: () => chain,
        select: () => chain,
        where: () => chain,
        limit: () => chain,
        executeTakeFirst: () =>
          Promise.resolve(
            table === 'loyalty_configs'
              ? opts.configRow
              : table === 'loyalty_customers'
                ? opts.mirrorRow
                : undefined,
          ),
      };
      return chain;
    },
    insertInto(table: string) {
      const rec: {
        values?: Record<string, unknown>;
        odku?: Record<string, unknown>;
      } = {};
      const finalize = () => {
        if (table === 'loyalty_customers') {
          captured.mirrorInsert = { values: rec.values ?? {}, odku: rec.odku };
        }
        if (table === 'loyalty_rule_applications' && rec.values) {
          captured.appInserts.push(rec.values);
        }
      };
      const chain = {
        ignore: () => chain,
        values: (v: Record<string, unknown>) => {
          rec.values = v;
          return chain;
        },
        onDuplicateKeyUpdate: (u: Record<string, unknown>) => {
          rec.odku = u;
          return chain;
        },
        execute: () => {
          finalize();
          return Promise.resolve([]);
        },
        executeTakeFirst: () => {
          finalize();
          return Promise.resolve({
            numInsertedOrUpdatedRows:
              table === 'loyalty_rule_applications' ? (opts.appInsertResult ?? 1n) : 1n,
          });
        },
      };
      return chain;
    },
    updateTable(table: string) {
      const rec: { set?: Record<string, unknown>; wheres: unknown[][] } = { wheres: [] };
      const chain = {
        set: (v: Record<string, unknown>) => {
          rec.set = v;
          return chain;
        },
        where: (...args: unknown[]) => {
          rec.wheres.push(args);
          return chain;
        },
        execute: () => {
          if (table === 'loyalty_qr_scans') {
            captured.qrUpdate = { set: rec.set ?? {}, wheres: rec.wheres };
          }
          return Promise.resolve([]);
        },
      };
      return chain;
    },
  };
  return { trx: trx as unknown as WebhookTrx, captured };
}

function setup(
  opts: {
    cached?: CachedRuleSet;
    configRow?: Record<string, unknown>;
    mirrorRow?: LoyaltyCustomerRow;
    appInsertResult?: bigint;
  } = {},
) {
  const core = new FakeCoreLoyalty();
  const cachedSet: CachedRuleSet = opts.cached ?? { rules: [], listMembership: {} };
  const cache = {
    getActive: () => Promise.resolve(cachedSet),
    isInList: () => Promise.resolve(false),
    invalidate: () => Promise.resolve(),
  } as unknown as RuleCacheService;
  const handler = new LoyaltyOrderCreatedHandler(
    new CustomerMirrorService(),
    cache,
    new RuleEvaluatorService(),
    core as unknown as Pick<CoreLoyaltyClient, 'credit'>,
  );
  const { trx, captured } = makeTrx(opts);
  return { handler, core, trx, captured };
}

describe('LoyaltyOrderCreatedHandler', () => {
  it("topic string === 'orders/create'", () => {
    const { handler } = setup();
    expect(handler.topic).toBe('orders/create');
  });

  it('#upserts-mirror — new phone inserts a fresh mirror row seeded from the order', async () => {
    const { handler, trx, captured } = setup();
    await handler.handle(mkOrderPayload(), MERCHANT_ID, trx);

    const values = captured.mirrorInsert?.values ?? {};
    expect(values.merchantId).toBe(MERCHANT_ID);
    expect(values.phone).toBe(PHONE);
    expect(values.firstSeenSource).toBe('order');
    expect(Number(values.lifetimeSpend)).toBe(1000);
    expect(values.lifetimeOrders).toBe(1);
    expect(values.name).toBe('Priya');
    expect(values.email).toBe('priya@example.com');
    expect(values.lastOrderAt).toBeInstanceOf(Date);
  });

  it('#upserts-mirror — existing phone accumulates spend/orders and keeps greatest lastOrderAt', async () => {
    const { handler, trx, captured } = setup({
      mirrorRow: mkCustomer({ lifetimeOrders: 3, lifetimeSpend: '500.00' }),
    });
    await handler.handle(mkOrderPayload(), MERCHANT_ID, trx);

    const odku = captured.mirrorInsert?.odku ?? {};
    expect(sqlText(odku.lifetimeSpend)).toContain('lifetime_spend + VALUES(lifetime_spend)');
    expect(sqlText(odku.lifetimeOrders)).toContain('lifetime_orders + 1');
    expect(sqlText(odku.lastOrderAt)).toContain('GREATEST');
    // never overwrite non-null name/email with null
    expect(sqlText(odku.name)).toContain('COALESCE(VALUES(name), name)');
    expect(sqlText(odku.email)).toContain('COALESCE(VALUES(email), email)');
  });

  it('#credits-multiplier-delta-once — 3x rule on ₹1000 at base rate 1 credits 2000 extra with rule:{id}:{orderId}', async () => {
    const { handler, core, trx, captured } = setup({
      cached: { rules: [mkCachedRule()], listMembership: { 'rule-1': [PHONE] } },
      configRow: { baseEarnRate: '1.00' },
    });
    await handler.handle(mkOrderPayload(), MERCHANT_ID, trx);

    expect(core.calls).toHaveLength(1);
    expect(core.calls[0]).toMatchObject({
      op: 'credit',
      merchantId: MERCHANT_ID,
      phone: PHONE,
      points: 2000,
      idempotencyKey: 'rule:rule-1:order-1001',
      description: 'Triple points',
      metadata: { rule_id: 'rule-1', order_id: 'order-1001' },
    });
    // application row written through the trx before the Core call
    expect(captured.appInserts).toHaveLength(1);
    expect(captured.appInserts[0]).toMatchObject({
      merchantId: MERCHANT_ID,
      ruleId: 'rule-1',
      orderId: 'order-1001',
      phone: PHONE,
      extraPoints: 2000,
    });
  });

  it('#redelivery-is-noop-via-unique-rule-order — duplicate application insert skips the Core call', async () => {
    const { handler, core, trx } = setup({
      cached: { rules: [mkCachedRule()], listMembership: { 'rule-1': [PHONE] } },
      configRow: { baseEarnRate: '1.00' },
      appInsertResult: 0n,
    });
    await handler.handle(mkOrderPayload(), MERCHANT_ID, trx);
    expect(core.calls).toHaveLength(0);
  });

  it('#stamps-qr-conversion-within-30d — updates unconverted scans newer than 30 days', async () => {
    const { handler, trx, captured } = setup();
    const before = Date.now();
    await handler.handle(mkOrderPayload(), MERCHANT_ID, trx);

    expect(captured.qrUpdate).toBeDefined();
    expect(captured.qrUpdate?.set.convertedOrderId).toBe('order-1001');
    expect(captured.qrUpdate?.set.convertedAt).toBeInstanceOf(Date);

    const wheres = captured.qrUpdate?.wheres ?? [];
    expect(wheres).toContainEqual(['merchantId', '=', MERCHANT_ID]);
    expect(wheres).toContainEqual(['phone', '=', PHONE]);
    const scanned = wheres.find((w) => w[0] === 'scannedAt');
    expect(scanned?.[1]).toBe('>=');
    const cutoff = scanned?.[2] as Date;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // cutoff is ~now-30d — scans older than 30d stay untouched
    expect(Math.abs(before - thirtyDaysMs - cutoff.getTime())).toBeLessThan(60_000);
    const nullGuard = wheres.find((w) => w[0] === 'convertedOrderId');
    expect(nullGuard?.[1]).toBe('is');
    expect(nullGuard?.[2]).toBeNull();
  });

  it('#throws-on-core-failure — Core error propagates so the webhook retries', async () => {
    const { handler, core, trx } = setup({
      cached: { rules: [mkCachedRule()], listMembership: { 'rule-1': [PHONE] } },
      configRow: { baseEarnRate: '1.00' },
    });
    core.failOn.set(PHONE, new Error('core down'));
    await expect(handler.handle(mkOrderPayload(), MERCHANT_ID, trx)).rejects.toThrow('core down');
  });

  it('#skips-orders-without-phone — no mirror write, no Core call, no crash', async () => {
    const { handler, core, trx, captured } = setup({
      cached: { rules: [mkCachedRule()], listMembership: { 'rule-1': [PHONE] } },
    });
    await handler.handle(mkOrderPayload({ customer: { first_name: 'Anon' } }), MERCHANT_ID, trx);
    expect(captured.mirrorInsert).toBeUndefined();
    expect(captured.qrUpdate).toBeUndefined();
    expect(core.calls).toHaveLength(0);
  });

  it('returns without writes when merchantId is null', async () => {
    const { handler, core, trx, captured } = setup();
    await handler.handle(mkOrderPayload(), null, trx);
    expect(captured.mirrorInsert).toBeUndefined();
    expect(core.calls).toHaveLength(0);
  });
});
