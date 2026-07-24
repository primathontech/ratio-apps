import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import { CustomerMirrorService } from '../../../../src/modules/loyalty/mirror/customer-mirror.service';
import { LoyaltyOrderCancelledHandler } from '../../../../src/modules/loyalty/webhooks/order-cancelled.handler';
import { MERCHANT_ID, mkOrderPayload } from './helpers/fakes';

type WebhookTrx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

/** Extract the raw SQL text of a `sql\`…\`` template captured by the mock. */
function sqlText(v: unknown): string {
  const node = (
    v as { toOperationNode?: () => { sqlFragments?: readonly string[] } } | undefined
  )?.toOperationNode?.();
  return node?.sqlFragments?.join('?') ?? String(v);
}

interface Captured {
  update?: { table: string; set: Record<string, unknown>; wheres: unknown[][] };
}

function makeTrx(): { trx: WebhookTrx; captured: Captured } {
  const captured: Captured = {};
  const trx = {
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
          captured.update = { table, set: rec.set ?? {}, wheres: rec.wheres };
          // unknown phone → UPDATE simply matches 0 rows; still resolves
          return Promise.resolve([]);
        },
      };
      return chain;
    },
  };
  return { trx: trx as unknown as WebhookTrx, captured };
}

describe('LoyaltyOrderCancelledHandler', () => {
  const handler = new LoyaltyOrderCancelledHandler(new CustomerMirrorService());

  it("topic string === 'orders/cancelled'", () => {
    expect(handler.topic).toBe('orders/cancelled');
  });

  it('decrements spend/orders with GREATEST floors at 0', async () => {
    const { trx, captured } = makeTrx();
    await handler.handle(mkOrderPayload(), MERCHANT_ID, trx);

    expect(captured.update?.table).toBe('loyalty_customers');
    const set = captured.update?.set ?? {};
    expect(sqlText(set.lifetimeSpend)).toContain('GREATEST(0, lifetime_spend - ');
    expect(sqlText(set.lifetimeOrders)).toContain('GREATEST(0, lifetime_orders - 1)');
    expect(captured.update?.wheres).toContainEqual(['merchantId', '=', MERCHANT_ID]);
    expect(captured.update?.wheres).toContainEqual(['phone', '=', '+919876543210']);
  });

  it('unknown phone is a no-op (0 matched rows) — resolves without throwing', async () => {
    const { trx } = makeTrx();
    await expect(handler.handle(mkOrderPayload(), MERCHANT_ID, trx)).resolves.toBeUndefined();
  });

  it('order without a phone → no update, no crash', async () => {
    const { trx, captured } = makeTrx();
    await handler.handle(mkOrderPayload({ customer: {} }), MERCHANT_ID, trx);
    expect(captured.update).toBeUndefined();
  });

  it('null merchantId → no update', async () => {
    const { trx, captured } = makeTrx();
    await handler.handle(mkOrderPayload(), null, trx);
    expect(captured.update).toBeUndefined();
  });
});
