// apps/backend/test/unit/apps/meta/capi-consumer.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MetaCapiConsumer } from '../../../../src/modules/meta/capi/capi-consumer';

function deps(over: Partial<Record<string, unknown>> = {}) {
  return {
    stream: {},
    leases: {},
    dispatch: { dispatch: vi.fn().mockResolvedValue({ received: 1, dispatched: 1, failed: 0, errors: [] }) },
    rate: { take: vi.fn().mockResolvedValue(true), tripped: vi.fn().mockResolvedValue(false), trip: vi.fn() },
    dlq: { put: vi.fn().mockResolvedValue(undefined) },
    ...over,
  };
}

describe('MetaCapiConsumer.processRecord', () => {
  it('dispatches events and returns the result', async () => {
    const d = deps();
    const c = new MetaCapiConsumer(d.stream as never, d.leases as never, d.dispatch as never, d.rate as never, d.dlq as never);
    const r = await c.processRecord({ merchantId: 'm1', events: [{ event_name: 'Purchase', event_id: 'e1' }], ctx: {} });
    expect(d.dispatch.dispatch).toHaveBeenCalledWith('m1', expect.any(Array), {});
    expect(r).toEqual({ dispatched: 1, failed: 0 });
  });
  it('DLQs when all events fail (non-retryable)', async () => {
    const d = deps({ dispatch: { dispatch: vi.fn().mockResolvedValue({ received: 1, dispatched: 0, failed: 1, errors: ['Meta CAPI 400 (non-retryable): bad'] }) } });
    const c = new MetaCapiConsumer(d.stream as never, d.leases as never, d.dispatch as never, d.rate as never, d.dlq as never);
    await c.processRecord({ merchantId: 'm1', events: [{ event_name: 'X', event_id: 'e2' }], ctx: {} });
    expect(d.dlq.put).toHaveBeenCalledTimes(1);
  });
  it('trips the breaker when dispatch returns a 429 error', async () => {
    const d = deps({ dispatch: { dispatch: vi.fn().mockResolvedValue({ received: 1, dispatched: 0, failed: 1, errors: ['Meta CAPI 429: too many calls'] }) } });
    const c = new MetaCapiConsumer(d.stream as never, d.leases as never, d.dispatch as never, d.rate as never, d.dlq as never);
    await c.processRecord({ merchantId: 'm1', events: [{ event_name: 'Purchase', event_id: 'e3' }], ctx: {} });
    expect(d.rate.trip).toHaveBeenCalledWith('m1', 30_000);
  });
  it('onModuleDestroy stops the loop', () => {
    const d = deps();
    const c = new MetaCapiConsumer(d.stream as never, d.leases as never, d.dispatch as never, d.rate as never, d.dlq as never);
    (c as unknown as { running: boolean }).running = true;
    c.onModuleDestroy();
    expect((c as unknown as { running: boolean }).running).toBe(false);
  });
});
