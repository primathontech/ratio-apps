// apps/backend/test/unit/apps/meta/capi.controller.bus.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MetaCapiController } from '../../../../src/modules/meta/capi/capi.controller';

function makeReq() {
  return { ip: '1.2.3.4', headers: { 'user-agent': 'UA' } } as never;
}
const body = { events: [{ event_name: 'Purchase', event_id: 'e1', user_data: { em: 'a@b.com' } }] } as never;

describe('MetaCapiController bus routing', () => {
  it('kinesis bus: produces hashed, partition-keyed records and does NOT touch SQS', async () => {
    process.env.META_CAPI_BUS = 'kinesis';
    const stream = { produce: vi.fn().mockResolvedValue(undefined) };
    const queue = { sendBatch: vi.fn() };
    const capi = { dispatch: vi.fn() };
    const c = new MetaCapiController(capi as never, queue as never, stream as never);
    const out = await c.ingest('m1', body, makeReq());
    expect(out).toEqual({ received: 1, queued: true });
    expect(queue.sendBatch).not.toHaveBeenCalled();
    expect(stream.produce).toHaveBeenCalledTimes(1);
    const [, records] = stream.produce.mock.calls[0];
    expect(records[0].partitionKey).toBe('m1');
    expect(records[0].data.events[0].user_data.em).toMatch(/^[a-f0-9]{64}$/);
    delete process.env.META_CAPI_BUS;
  });

  it('sqs bus (default): sends to SQS, not the stream', async () => {
    const stream = { produce: vi.fn() };
    const queue = { sendBatch: vi.fn().mockResolvedValue(undefined) };
    const capi = { dispatch: vi.fn() };
    const c = new MetaCapiController(capi as never, queue as never, stream as never);
    await c.ingest('m1', body, makeReq());
    expect(queue.sendBatch).toHaveBeenCalledTimes(1);
    expect(stream.produce).not.toHaveBeenCalled();
  });

  it('both bus: writes kinesis AND sqs; surfaces SQS error without inline fallback', async () => {
    process.env.META_CAPI_BUS = 'both';

    // happy path: both succeed
    {
      const stream = { produce: vi.fn().mockResolvedValue(undefined) };
      const queue = { sendBatch: vi.fn().mockResolvedValue(undefined) };
      const capi = { dispatch: vi.fn() };
      const c = new MetaCapiController(capi as never, queue as never, stream as never);
      const out = await c.ingest('m1', body, makeReq());
      expect(out).toEqual({ received: 1, queued: true });
      expect(stream.produce).toHaveBeenCalledTimes(1);
      expect(queue.sendBatch).toHaveBeenCalledTimes(1);
      expect(capi.dispatch).not.toHaveBeenCalled();
    }

    // error path: SQS rejects → ingest throws, no inline fallback
    {
      const stream = { produce: vi.fn().mockResolvedValue(undefined) };
      const queue = { sendBatch: vi.fn().mockRejectedValue(new Error('SQS down')) };
      const capi = { dispatch: vi.fn() };
      const c = new MetaCapiController(capi as never, queue as never, stream as never);
      await expect(c.ingest('m1', body, makeReq())).rejects.toThrow('SQS down');
      expect(capi.dispatch).not.toHaveBeenCalled();
    }

    delete process.env.META_CAPI_BUS;
  });
});
