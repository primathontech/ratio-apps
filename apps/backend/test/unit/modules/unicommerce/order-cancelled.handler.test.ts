import type { Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import { UC_ORDER_WEBHOOK_TOPICS } from '../../../../src/modules/unicommerce/webhooks/order-confirmed.handler';
import { UcOrderCancelledHandler } from '../../../../src/modules/unicommerce/webhooks/order-cancelled.handler';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

interface Call {
  table: string;
  values: Record<string, unknown>;
}

/**
 * Fake trx recording EVERY `.insertInto(...)` call — the handler now writes
 * `ucEventLogs` (webhook-delivery visibility, Task 14+ follow-up) on EVERY
 * path including the "never pushed, nothing to cancel" no-op, in addition to
 * `ucSyncJobs` on the enqueue path — a single-capture fake would drop one.
 */
function enabledFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(true) };
}

function fakeTrx() {
  const calls: Call[] = [];
  const trx = {
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => {
        calls.push({ table, values });
        return { execute: async () => undefined };
      },
    }),
  } as unknown as Trx;
  return { trx, calls, findCall: (table: string) => calls.find((c) => c.table === table) };
}

describe('UcOrderCancelledHandler', () => {
  it('subscribes to orders/cancelled', () => {
    const handler = new UcOrderCancelledHandler(
      { findSaleOrderCode: vi.fn(), findByRatioOrder: vi.fn().mockResolvedValue([]) } as never,
      { publish: vi.fn() } as never,
      enabledFlags() as never,
    );
    expect(handler.topic).toBe(UC_ORDER_WEBHOOK_TOPICS.orderCancelled);
    expect(handler.topic).toBe('orders/cancelled');
  });

  it('is a no-op when merchantId is null', async () => {
    const findSaleOrderCode = vi.fn();
    const publish = vi.fn();
    const handler = new UcOrderCancelledHandler(
      { findSaleOrderCode, findByRatioOrder: vi.fn().mockResolvedValue([]) } as never,
      { publish } as never,
      enabledFlags() as never,
    );
    const { trx, calls } = fakeTrx();

    await handler.handle({ id: 'order-1' }, null, trx);

    expect(findSaleOrderCode).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('logs a webhook-delivery event (but enqueues no cancel_push job) when the order was never pushed to Unicommerce', async () => {
    const findSaleOrderCode = vi.fn().mockResolvedValue(null);
    const findByRatioOrder = vi.fn().mockResolvedValue([]);
    const publish = vi.fn();
    const handler = new UcOrderCancelledHandler(
      { findSaleOrderCode, findByRatioOrder } as never,
      { publish } as never,
      enabledFlags() as never,
    );
    const { trx, findCall } = fakeTrx();

    await handler.handle({ id: 'order-1' }, 'merchant-1', trx);

    expect(findSaleOrderCode).toHaveBeenCalledWith('merchant-1', 'order-1');
    expect(findCall('ucSyncJobs')).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    // Still visible on the dashboard as a legitimate no-op, not silently dropped.
    expect(findCall('ucEventLogs')?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      reference: 'orders/cancelled: order-1',
      result: 'success',
    });
  });

  it('enqueues a cancel_push uc_sync_jobs row via trx and fires the fast path — WITHOUT awaiting the outbound push', async () => {
    const findSaleOrderCode = vi.fn().mockResolvedValue('UC-999');
    const findByRatioOrder = vi.fn().mockResolvedValue([]);
    // Never resolves — models a slow/hanging outbound HTTP call. If handle()
    // awaited this (the design risk this task called out), the test itself
    // would hang. It doesn't, because handle() only fires this and returns.
    let resolveAttempt: (() => void) | undefined;
    const publish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAttempt = resolve;
        }),
    );
    const handler = new UcOrderCancelledHandler(
      { findSaleOrderCode, findByRatioOrder } as never,
      { publish } as never,
      enabledFlags() as never,
    );
    const { trx, findCall } = fakeTrx();

    await handler.handle({ id: 'order-1' }, 'merchant-1', trx);

    const syncJobsCall = findCall('ucSyncJobs');
    expect(syncJobsCall?.values).toMatchObject({
      merchantId: 'merchant-1',
      type: 'cancel_push',
      ratioOrderId: 'order-1',
      status: 'PENDING',
    });
    expect(typeof syncJobsCall?.values.id).toBe('string');
    expect((syncJobsCall?.values.id as string).length).toBeGreaterThan(0);

    // `payload` is stringified before insert (mysql2 doesn't auto-serialize
    // JS objects into JSON columns) — parse it back to assert on its shape.
    expect(typeof syncJobsCall?.values.payload).toBe('string');
    const payload = JSON.parse(syncJobsCall?.values.payload as string) as {
      merchantId: string;
      ratioOrderId: string;
      saleOrderCode: string;
      reason: string;
    };
    expect(payload).toEqual({
      merchantId: 'merchant-1',
      ratioOrderId: 'order-1',
      saleOrderCode: 'UC-999',
      reason: 'Cancelled on Ratio storefront',
    });

    // Webhook-delivery visibility (Task 14+ follow-up): distinct from the
    // outbound cancel event UcSyncQueueService logs once the push resolves.
    expect(findCall('ucEventLogs')?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      reference: 'orders/cancelled: order-1',
      result: 'success',
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(syncJobsCall?.values.id, {
      merchantId: 'merchant-1',
      type: 'cancel_push',
      ratioOrderId: 'order-1',
    });

    // Clean up the dangling promise so the test process doesn't warn.
    resolveAttempt?.();
  });

  it('does not let a rejected fast-path call propagate or go unhandled', async () => {
    const findSaleOrderCode = vi.fn().mockResolvedValue('UC-999');
    const findByRatioOrder = vi.fn().mockResolvedValue([]);
    const publish = vi.fn().mockRejectedValue(new Error('boom'));
    const handler = new UcOrderCancelledHandler(
      { findSaleOrderCode, findByRatioOrder } as never,
      { publish } as never,
      enabledFlags() as never,
    );
    const { trx } = fakeTrx();

    await expect(handler.handle({ id: 'order-1' }, 'merchant-1', trx)).resolves.toBeUndefined();

    // Let the fire-and-forget rejection's .catch() microtask run.
    await new Promise((r) => setTimeout(r, 0));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  // TRD §6: cancel_sync flag off → the loop-prevention checks still run (an
  // order that was never pushed, or is UC-originated, still short-circuits
  // as before), but a genuinely-eligible cancel skips the outbound push job.
  it('logs a webhook-delivery event but skips the outbound cancel_push job entirely when cancel_sync is disabled', async () => {
    const findSaleOrderCode = vi.fn().mockResolvedValue('UC-999');
    const findByRatioOrder = vi.fn().mockResolvedValue([]);
    const publish = vi.fn();
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const handler = new UcOrderCancelledHandler(
      { findSaleOrderCode, findByRatioOrder } as never,
      { publish } as never,
      flags as never,
    );
    const { trx, findCall } = fakeTrx();

    await handler.handle({ id: 'order-1' }, 'merchant-1', trx);

    expect(flags.isEnabled).toHaveBeenCalledWith('cancel_sync', 'merchant-1');
    expect(findCall('ucSyncJobs')).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    expect(findCall('ucEventLogs')?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      reference: 'orders/cancelled: order-1',
      result: 'success',
    });
  });
});
