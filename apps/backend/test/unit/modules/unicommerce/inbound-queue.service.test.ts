import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UcInboundQueueService } from '../../../../src/modules/unicommerce/services/inbound-queue.service';

// Reproduces the exact original hardcoded ladder (2s/4s/8s) so the retry
// tests (attempt counts, fake-timer advances) behave identically to the
// outbound sync-queue tests — the two services share UC_RETRY_LADDER_*.
function fakeConfig() {
  return {
    get: (key: string) => (key === 'UC_RETRY_LADDER_BASE_SECONDS' ? 2 : 3),
  } as never;
}

interface FakeInboundJobRow {
  id: string;
  merchantId: string;
  type: 'status_notify' | 'inventory_update';
  payload: unknown;
  attemptCount: number;
  status: string;
}

function statusJob(overrides: Partial<FakeInboundJobRow> = {}): FakeInboundJobRow {
  return {
    id: 'inbound-job-1',
    merchantId: 'm1',
    type: 'status_notify',
    payload: {
      orderId: 'order-1',
      orderItemId: 'item-1',
      status: 'DISPATCHED',
      IsReverse: false,
      updated: '2026-08-06T14:05:00+05:30',
    },
    attemptCount: 0,
    status: 'PENDING',
    ...overrides,
  };
}

function inventoryJob(overrides: Partial<FakeInboundJobRow> = {}): FakeInboundJobRow {
  return {
    id: 'inbound-job-inv-1',
    merchantId: 'm1',
    type: 'inventory_update',
    payload: {
      productId: 'gid://shopify/Product/8123456789012',
      variantId: 'gid://shopify/Variant/4345678901234',
      inventory: '24',
      facilityCode: 'DEL-BLR-01',
    },
    attemptCount: 0,
    status: 'PENDING',
    ...overrides,
  };
}

/**
 * Fake Kysely handle covering the selectFrom/updateTable/insertInto calls
 * inbound-queue.service.ts issues, backed by an in-memory `jobs` array —
 * the same hand-rolled-fake-handle convention as sync-queue.service.test.ts.
 */
function fakeHandle(jobs: FakeInboundJobRow[]) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];

  function matchesOp(rowVal: unknown, op: string, val: unknown): boolean {
    if (op === 'in') return (val as unknown[]).includes(rowVal);
    return rowVal === val;
  }

  function selectFrom(_table: string) {
    const filters: Array<(row: FakeInboundJobRow) => boolean> = [];
    const builder = {
      selectAll: () => builder,
      where: (col: string, op: string, val: unknown) => {
        filters.push((row) => matchesOp((row as unknown as Record<string, unknown>)[col], op, val));
        return builder;
      },
      executeTakeFirstOrThrow: async () => {
        const found = jobs.find((j) => filters.every((f) => f(j)));
        if (!found) throw new Error('row not found');
        return found;
      },
    };
    return builder;
  }

  const db = {
    selectFrom,
    updateTable: (_table: string) => ({
      set: (patch: Record<string, unknown>) => {
        const filters: Array<(row: FakeInboundJobRow) => boolean> = [];
        const builder = {
          where: (col: string, op: string, val: unknown) => {
            filters.push((row) => matchesOp((row as unknown as Record<string, unknown>)[col], op, val));
            return builder;
          },
          execute: async () => {
            const job = jobs.find((j) => filters.every((f) => f(j)));
            if (job) Object.assign(job, patch);
            updates.push(patch);
          },
          executeTakeFirst: async () => {
            const job = jobs.find((j) => filters.every((f) => f(j)));
            if (job) {
              Object.assign(job, patch);
              updates.push(patch);
              return { numUpdatedRows: 1n };
            }
            return { numUpdatedRows: 0n };
          },
        };
        return builder;
      },
    }),
    insertInto: (_table: string) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return { execute: async () => undefined };
      },
    }),
  };
  return { handle: { db }, updates, inserts, jobs };
}

describe('UcInboundQueueService.attemptImmediate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches a status_notify job to the status worker and marks it DONE with an inbound event-log row', async () => {
    const job = statusJob();
    const { handle, updates } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn().mockResolvedValue({ applied: true, mappedStatus: 'fulfilled' }) };
    const inventoryWorker = { apply: vi.fn() };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      inventoryWorker as never,
      eventLog as never,
      fakeConfig(),
    );

    await svc.attemptImmediate('inbound-job-1');

    expect(statusWorker.apply).toHaveBeenCalledWith('m1', job.payload);
    expect(inventoryWorker.apply).not.toHaveBeenCalled();
    expect(updates).toContainEqual({ status: 'DONE' });
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'm1',
        direction: 'inbound',
        flow: 'status',
        reference: 'item-1',
        result: 'success',
        jobId: 'inbound-job-1',
      }),
    );
  });

  it('dispatches an inventory_update job to the inventory worker (flow: inventory, reference: variantId)', async () => {
    const job = inventoryJob();
    const { handle, updates } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn() };
    const inventoryWorker = { apply: vi.fn().mockResolvedValue({ status: 'SUCCESS', failedProductList: [] }) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      inventoryWorker as never,
      eventLog as never,
      fakeConfig(),
    );

    await svc.attemptImmediate('inbound-job-inv-1');

    expect(inventoryWorker.apply).toHaveBeenCalledWith('m1', job.payload);
    expect(statusWorker.apply).not.toHaveBeenCalled();
    expect(updates).toContainEqual({ status: 'DONE' });
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'inbound',
        flow: 'inventory',
        reference: 'gid://shopify/Variant/4345678901234',
        result: 'success',
        jobId: 'inbound-job-inv-1',
      }),
    );
  });

  it("a 'no_change' status result (duplicate/out-of-order) is still a DONE success — nothing to apply is not an error", async () => {
    const job = statusJob();
    const { handle, updates } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn().mockResolvedValue({ applied: false, reason: 'no_change' }) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      { apply: vi.fn() } as never,
      eventLog as never,
      fakeConfig(),
    );

    await svc.attemptImmediate('inbound-job-1');

    expect(statusWorker.apply).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual({ status: 'DONE' });
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'success', response: { applied: false, reason: 'no_change' } }),
    );
  });

  it('moves straight to DLQ on a non-recoverable error (unknown orderItemId), without retrying', async () => {
    const job = statusJob();
    const { handle, updates, inserts } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn().mockRejectedValue(new Error('unknown orderItemId')) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      { apply: vi.fn() } as never,
      eventLog as never,
      fakeConfig(),
    );

    await svc.attemptImmediate('inbound-job-1');

    expect(statusWorker.apply).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ originalJobId: 'inbound-job-1', lastError: 'unknown orderItemId' });
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'inbound',
        flow: 'status',
        result: 'failed',
        response: 'unknown orderItemId',
      }),
    );
  });

  it('retries 3 times on a recoverable error, then moves to DLQ (NEEDS_MANUAL)', async () => {
    const job = statusJob();
    const { handle, updates, inserts } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn().mockRejectedValue(new Error('upstream timeout')) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      { apply: vi.fn() } as never,
      eventLog as never,
      fakeConfig(),
    );

    const promise = svc.attemptImmediate('inbound-job-1');
    await vi.runAllTimersAsync();
    await promise;

    expect(statusWorker.apply).toHaveBeenCalledTimes(3);
    expect(inserts).toHaveLength(1);
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
  });

  it('is a no-op when the job is already claimed (IN_PROGRESS) — atomic claim semantics', async () => {
    const job = statusJob({ status: 'IN_PROGRESS' });
    const { handle } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn() };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      { apply: vi.fn() } as never,
      { record: vi.fn() } as never,
      fakeConfig(),
    );

    await svc.attemptImmediate('inbound-job-1');

    expect(statusWorker.apply).not.toHaveBeenCalled();
  });

  it('two concurrent attemptImmediate() calls for the same job only apply once', async () => {
    const job = statusJob();
    const { handle } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn().mockResolvedValue({ applied: true, mappedStatus: 'fulfilled' }) };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      { apply: vi.fn() } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      fakeConfig(),
    );

    await Promise.all([svc.attemptImmediate('inbound-job-1'), svc.attemptImmediate('inbound-job-1')]);

    expect(statusWorker.apply).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('DONE');
  });

  it('a rejected eventLog.record() on success does not re-apply and does not revert DONE', async () => {
    const job = statusJob();
    const { handle, updates } = fakeHandle([job]);
    const statusWorker = { apply: vi.fn().mockResolvedValue({ applied: true, mappedStatus: 'fulfilled' }) };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const svc = new UcInboundQueueService(
      handle as never,
      statusWorker as never,
      { apply: vi.fn() } as never,
      eventLog as never,
      fakeConfig(),
    );

    await svc.attemptImmediate('inbound-job-1');

    expect(statusWorker.apply).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('DONE');
    expect(updates).not.toContainEqual({ status: 'NEEDS_MANUAL' });
  });
});
