import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaCapiWorker } from '../../../src/modules/meta/queue/capi.worker';

/**
 * The worker's reliability contract: it ACKs (deletes) a batch from the queue
 * ONLY when the dispatch to Meta fully succeeded. If any pixel send failed, the
 * messages must stay un-acked so SQS redelivers them after the visibility
 * timeout — otherwise events are silently lost (no retry, no DLQ).
 */
describe('MetaCapiWorker flush ack semantics', () => {
  let queue: { ack: ReturnType<typeof vi.fn> };
  let capi: { dispatch: ReturnType<typeof vi.fn> };
  let stats: { record: ReturnType<typeof vi.fn>; recordFailure: ReturnType<typeof vi.fn> };
  let worker: MetaCapiWorker;

  beforeEach(() => {
    queue = { ack: vi.fn().mockResolvedValue(undefined) };
    capi = { dispatch: vi.fn() };
    stats = {
      record: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    };
    worker = new MetaCapiWorker(queue as never, capi as never, stats as never);
  });

  // Seed a ready-to-flush buffer (firstAt=0 → past the time window).
  function seedBuffer() {
    (worker as unknown as { buffers: Map<string, unknown> }).buffers.set('m1', {
      events: [{ event_name: 'Purchase' }, { event_name: 'AddToCart' }],
      handles: ['h1', 'h2'],
      firstAt: 0,
      ctx: {},
    });
  }

  function flush() {
    return (worker as unknown as { flushReady: () => Promise<void> }).flushReady();
  }

  it('ACKs the batch when dispatch fully succeeds', async () => {
    capi.dispatch.mockResolvedValue({ received: 2, dispatched: 2, failed: 0, errors: [] });
    seedBuffer();
    await flush();
    expect(queue.ack).toHaveBeenCalledWith(expect.any(String), ['h1', 'h2']);
  });

  it('does NOT ack when a pixel send failed (so messages redeliver)', async () => {
    // dispatch resolves normally but reports a failed pixel send.
    capi.dispatch.mockResolvedValue({
      received: 2,
      dispatched: 0,
      failed: 1,
      errors: ['Meta CAPI 400 (non-retryable): bad'],
    });
    seedBuffer();
    await flush();
    expect(queue.ack).not.toHaveBeenCalled();
  });

  it('records the failure reason for the analytics breakdown', async () => {
    capi.dispatch.mockResolvedValue({
      received: 2,
      dispatched: 0,
      failed: 1,
      errors: ['Meta CAPI 429 (non-retryable): rate limit'],
    });
    seedBuffer();
    await flush();
    expect(stats.recordFailure).toHaveBeenCalledWith('m1', 'rate_limited', expect.any(String), 2);
  });
});
