import { describe, expect, it, vi } from 'vitest';
import { UcReconciliationSweepService } from '../../../../src/modules/unicommerce/services/reconciliation-sweep.service';

type Row = Record<string, unknown>;

/** Minimal SQL-ish comparison for the fake Kysely handle (NULL never compares true). */
function cmp(row: Row, col: string, op: string, val: unknown): boolean {
  if (op === '=') return row[col] === val;
  if (op === '<') {
    const cell = row[col];
    return cell != null && (cell as Date).getTime() < (val as Date).getTime();
  }
  if (op === '>=') {
    const cell = row[col];
    return cell != null && (cell as Date).getTime() >= (val as Date).getTime();
  }
  if (op === '<=') {
    const cell = row[col];
    return cell != null && (cell as Date).getTime() <= (val as Date).getTime();
  }
  if (op === 'is') return val === null ? row[col] === null || row[col] === undefined : row[col] === val;
  if (op === 'not in') return !(val as unknown[]).includes(row[col]);
  throw new Error(`unsupported op: ${op}`);
}

/** Minimal generic multi-table fake Kysely handle for the sweep's DB access. */
function fakeHandle(
  seed: {
    ucCredentials?: Row[];
    ucSyncJobs?: Row[];
    ucReconciliationJobs?: Row[];
    ucOrderItemMap?: Row[];
    ucAlerts?: Row[];
  } = {},
) {
  const tables: Record<string, Row[]> = {
    ucCredentials: seed.ucCredentials ?? [],
    ucSyncJobs: seed.ucSyncJobs ?? [],
    ucReconciliationJobs: seed.ucReconciliationJobs ?? [],
    ucOrderItemMap: seed.ucOrderItemMap ?? [],
    ucAlerts: seed.ucAlerts ?? [],
  };

  const db = {
    selectFrom: (table: string) => {
      const filters: Array<(row: Row) => boolean> = [];
      let projection: 'all' | 'count' = 'all';
      let orderByCol: string | null = null;
      let orderByDir: 'asc' | 'desc' | null = null;

      const sorted = (rows: Row[]): Row[] => {
        if (!orderByCol || !orderByDir) return rows;
        return [...rows].sort((a, b) => {
          const at = (r: Row) => {
            const v = r[orderByCol!];
            return v instanceof Date ? v.getTime() : new Date(v as string).getTime();
          };
          return orderByDir === 'desc' ? at(b) - at(a) : at(a) - at(b);
        });
      };

      const builder = {
        select: (proj?: unknown) => {
          // `(eb) => eb.fn.countAll().as('count')` — resolved at execute time.
          if (typeof proj === 'function') projection = 'count';
          return builder;
        },
        selectAll: () => builder,
        orderBy: (col: string, dir: 'asc' | 'desc') => {
          orderByCol = col;
          orderByDir = dir;
          return builder;
        },
        where: (col: string, op: string, val: unknown) => {
          filters.push((row) => cmp(row, col, op, val));
          return builder;
        },
        execute: async () => {
          const rows = sorted(tables[table].filter((r) => filters.every((f) => f(r))));
          return projection === 'count' ? [{ count: rows.length }] : rows;
        },
        executeTakeFirst: async () => {
          const rows = sorted(tables[table].filter((r) => filters.every((f) => f(r))));
          if (projection === 'count') return { count: rows.length };
          return rows[0] ?? undefined;
        },
      };
      return builder;
    },
    insertInto: (table: string) => ({
      values: (v: Row) => ({
        execute: async () => {
          tables[table].push({ id: v.id ?? `row-${tables[table].length}`, ...v });
        },
      }),
    }),
    updateTable: (table: string) => {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row = {};
      const builder = {
        set: (p: Row) => {
          patch = p;
          return builder;
        },
        where: (col: string, op: string, val: unknown) => {
          filters.push((row) => cmp(row, col, op, val));
          return builder;
        },
        execute: async () => {
          for (const row of tables[table]) {
            if (filters.every((f) => f(row))) Object.assign(row, patch);
          }
        },
      };
      return builder;
    },
  };

  return { handle: { db }, tables };
}

/** Fake UcOrderItemMapService — enough for buildOrderPushJobPayload's `.generate()` calls. */
function fakeOrderItemMap() {
  return { generate: vi.fn().mockImplementation(async (_m, _o, lineItemId) => `item-${lineItemId}`) };
}

function fakeSyncQueue() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

/** A minimal but realistic Ratio order — enough for buildOrderPushJobPayload to succeed. */
function orderFixture(id: string, overrides: Row = {}) {
  return {
    id,
    name: `#${id}`,
    created_at: '2026-01-05T10:30:00.000Z',
    line_items: [
      { id: 'li-1', product_id: 'p-1', variant_id: 'v-1', sku: 'SKU-1', title: 'Item', quantity: 1, price: '1000.00' },
    ],
    ...overrides,
  };
}

describe('UcReconciliationSweepService.run', () => {
  it('enqueues an order_push job (via the shared payload builder, generating order-item-map rows) for a missing order, and publishes it', async () => {
    const { handle, tables } = fakeHandle();
    const ratio = { listOrders: vi.fn().mockResolvedValueOnce([orderFixture('order-missing')]) };
    const orderItemMap = fakeOrderItemMap();
    const syncQueue = fakeSyncQueue();
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      orderItemMap as never,
      syncQueue as never,
    );

    const result = await svc.run('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(result).toEqual({
      ordersCheckedCount: 1,
      ordersPushedCount: 1,
      ordersAlreadySyncedCount: 0,
      ordersFailedCount: 0,
    });
    expect(orderItemMap.generate).toHaveBeenCalledWith('m1', 'order-missing', 'li-1', 1, 'ratio_originated');
    const job = tables.ucSyncJobs.find((j) => j.ratioOrderId === 'order-missing');
    expect(job).toMatchObject({ merchantId: 'm1', type: 'order_push', status: 'PENDING' });
    const payload = JSON.parse(job!.payload as string) as { order: { id: string; orderItems: unknown[] } };
    expect(payload.order.id).toBe('order-missing');
    expect(payload.order.orderItems).toHaveLength(1);
    expect(syncQueue.publish).toHaveBeenCalledWith(job!.id, {
      merchantId: 'm1',
      type: 'order_push',
      ratioOrderId: 'order-missing',
    });
  });

  it('counts an existing DONE job as already-synced and does not republish it', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'job-done', merchantId: 'm1', ratioOrderId: 'order-done', type: 'order_push', status: 'DONE' },
      ],
    });
    const ratio = { listOrders: vi.fn().mockResolvedValueOnce([orderFixture('order-done')]) };
    const orderItemMap = fakeOrderItemMap();
    const syncQueue = fakeSyncQueue();
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      orderItemMap as never,
      syncQueue as never,
    );

    const result = await svc.run('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(result).toEqual({
      ordersCheckedCount: 1,
      ordersPushedCount: 0,
      ordersAlreadySyncedCount: 1,
      ordersFailedCount: 0,
    });
    expect(syncQueue.publish).not.toHaveBeenCalled();
    expect(tables.ucSyncJobs).toHaveLength(1);
  });

  // Bug: the sweep's old "already synced" check treated ANY existing row as
  // synced, even one stuck PENDING forever because the Kafka publish that
  // should have triggered it failed after enqueue (a real, separate
  // confirmed gap) — permanently hiding it from ever being retried. The
  // sweep now re-publishes a non-terminal existing job instead of silently
  // trusting that it will somehow get picked up.
  it('re-publishes an existing non-terminal (PENDING) job instead of inserting a duplicate', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'job-stuck', merchantId: 'm1', ratioOrderId: 'order-stuck', type: 'order_push', status: 'PENDING' },
      ],
    });
    const ratio = { listOrders: vi.fn().mockResolvedValueOnce([orderFixture('order-stuck')]) };
    const orderItemMap = fakeOrderItemMap();
    const syncQueue = fakeSyncQueue();
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      orderItemMap as never,
      syncQueue as never,
    );

    const result = await svc.run('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(result).toEqual({
      ordersCheckedCount: 1,
      ordersPushedCount: 1,
      ordersAlreadySyncedCount: 0,
      ordersFailedCount: 0,
    });
    expect(tables.ucSyncJobs).toHaveLength(1); // no duplicate row inserted
    expect(syncQueue.publish).toHaveBeenCalledWith('job-stuck', {
      merchantId: 'm1',
      type: 'order_push',
      ratioOrderId: 'order-stuck',
    });
  });

  // IN_PROGRESS means a worker may be mid-push RIGHT NOW — touching or
  // re-publishing it risks a genuine double-push. Stuck-IN_PROGRESS
  // reclaim is a separate, already-documented gap (TRD §8); this sweep
  // must not touch it.
  it('does not touch or republish an existing IN_PROGRESS job', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'job-live', merchantId: 'm1', ratioOrderId: 'order-live', type: 'order_push', status: 'IN_PROGRESS' },
      ],
    });
    const ratio = { listOrders: vi.fn().mockResolvedValueOnce([orderFixture('order-live')]) };
    const orderItemMap = fakeOrderItemMap();
    const syncQueue = fakeSyncQueue();
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      orderItemMap as never,
      syncQueue as never,
    );

    const result = await svc.run('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(result).toEqual({
      ordersCheckedCount: 1,
      ordersPushedCount: 0,
      ordersAlreadySyncedCount: 0,
      ordersFailedCount: 0,
    });
    expect(syncQueue.publish).not.toHaveBeenCalled();
    expect(tables.ucSyncJobs).toHaveLength(1);
  });

  // Bug: the sweep enqueued a fresh order_push for ANY order missing a
  // uc_sync_jobs row, with no check on the order's current Ratio status —
  // so an order that was cancelled before ever reaching UC (app installed
  // late, an outage, etc.) got pushed to UC's warehouse as if it were still
  // live and fulfillable. `orders-read.controller.ts` already uses
  // `order.status === 'cancelled'` as the real, confirmed field/value for
  // this — the sweep must check it too before enqueueing.
  it('does not enqueue an order_push job for an order already cancelled on Ratio', async () => {
    const { handle, tables } = fakeHandle({});
    const ratio = {
      listOrders: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'order-cancelled-1', status: 'cancelled' }]),
    };
    const orderItemMap = fakeOrderItemMap();
    const syncQueue = fakeSyncQueue();
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      orderItemMap as never,
      syncQueue as never,
    );

    const result = await svc.run('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(result).toEqual({
      ordersCheckedCount: 1,
      ordersPushedCount: 0,
      ordersAlreadySyncedCount: 0,
      ordersFailedCount: 0,
    });
    expect(tables.ucSyncJobs.some((j) => j.ratioOrderId === 'order-cancelled-1')).toBe(false);
    expect(orderItemMap.generate).not.toHaveBeenCalled();
  });

  // A cancelled order that somehow already HAS a completed sync job (e.g. it
  // was pushed, then cancelled) must still count as already-synced, not get
  // re-evaluated — the cancelled-status check only applies to the
  // "no existing job" branch.
  it('still counts a cancelled order as already-synced if a DONE sync job already exists for it', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'job-2', merchantId: 'm1', ratioOrderId: 'order-cancelled-2', type: 'order_push', status: 'DONE' },
      ],
    });
    const ratio = {
      listOrders: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'order-cancelled-2', status: 'cancelled' }]),
    };
    const orderItemMap = fakeOrderItemMap();
    const syncQueue = fakeSyncQueue();
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      orderItemMap as never,
      syncQueue as never,
    );

    const result = await svc.run('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(result).toEqual({
      ordersCheckedCount: 1,
      ordersPushedCount: 0,
      ordersAlreadySyncedCount: 1,
      ordersFailedCount: 0,
    });
  });
});

describe('UcReconciliationSweepService.runForMerchant', () => {
  it('writes a RUNNING job row then updates it to COMPLETED with the sweep counts', async () => {
    const { handle, tables } = fakeHandle();
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const jobId = await svc.runForMerchant('m1', new Date('2026-01-01'), new Date('2026-01-02'), 'manual');

    expect(tables.ucReconciliationJobs).toHaveLength(1);
    expect(tables.ucReconciliationJobs[0]).toMatchObject({
      id: jobId,
      merchantId: 'm1',
      requestedBy: 'manual',
      status: 'COMPLETED',
      ordersCheckedCount: 0,
    });
    expect(tables.ucReconciliationJobs[0]!.completedAt).toBeInstanceOf(Date);
  });

  it('marks the job FAILED and rethrows if the sweep itself throws', async () => {
    const { handle, tables } = fakeHandle();
    const ratio = { listOrders: vi.fn().mockRejectedValue(new Error('ratio api down')) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await expect(
      svc.runForMerchant('m1', new Date('2026-01-01'), new Date('2026-01-02'), 'system'),
    ).rejects.toThrow('ratio api down');

    expect(tables.ucReconciliationJobs[0]).toMatchObject({ status: 'FAILED' });
  });
});

describe('UcReconciliationSweepService.triggerManual', () => {
  it('returns the job id immediately without waiting for the sweep to finish', async () => {
    const { handle, tables } = fakeHandle();
    let resolveListOrders: (v: unknown[]) => void = () => {};
    const ratio = {
      listOrders: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveListOrders = resolve;
          }),
      ),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const jobId = await svc.triggerManual('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(typeof jobId).toBe('string');
    expect(tables.ucReconciliationJobs).toEqual([
      expect.objectContaining({ id: jobId, merchantId: 'm1', requestedBy: 'manual', status: 'RUNNING' }),
    ]);

    resolveListOrders([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(tables.ucReconciliationJobs[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it('marks the job FAILED in the background if the sweep itself throws', async () => {
    const { handle, tables } = fakeHandle();
    const ratio = { listOrders: vi.fn().mockRejectedValue(new Error('ratio api down')) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const jobId = await svc.triggerManual('m1', new Date('2026-01-01'), new Date('2026-01-02'));
    await new Promise((r) => setTimeout(r, 0));

    expect(tables.ucReconciliationJobs.find((j) => j.id === jobId)).toMatchObject({ status: 'FAILED' });
  });
});

describe('UcReconciliationSweepService.getJob', () => {
  it('returns the matching job row', async () => {
    const { handle } = fakeHandle({
      ucReconciliationJobs: [{ id: 'job-1', merchantId: 'm1', status: 'COMPLETED' }],
    });
    const svc = new UcReconciliationSweepService(
      handle as never,
      {} as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const job = await svc.getJob('job-1');

    expect(job).toMatchObject({ id: 'job-1', merchantId: 'm1', status: 'COMPLETED' });
  });

  it('returns null when no job matches', async () => {
    const { handle } = fakeHandle();
    const svc = new UcReconciliationSweepService(
      handle as never,
      {} as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const job = await svc.getJob('missing');

    expect(job).toBeNull();
  });
});

describe('UcReconciliationSweepService.runReconcileCycle', () => {
  it('sweeps only merchants with active credentials', async () => {
    const { handle } = fakeHandle({
      ucCredentials: [
        { merchantId: 'm1', status: 'active' },
        { merchantId: 'm2', status: 'paused' },
      ],
    });
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const outcome = await svc.runReconcileCycle();

    expect(outcome).toEqual({ ran: true, merchants: 1 });
    expect(ratio.listOrders).toHaveBeenCalledTimes(1);
    expect(ratio.listOrders).toHaveBeenCalledWith('m1', expect.objectContaining({ page: 1 }));
  });

  // The pause point is the credentials lookup itself (the very first `await`
  // inside `runReconcileCycle`) rather than `listOrders` — that guarantees
  // "first" is deterministically paused with `running=true` set before
  // "second" runs, instead of racing on how many microtask ticks it takes to
  // reach the per-merchant loop.
  it('skips an overlapping cycle while one is already running', async () => {
    const { handle } = fakeHandle({ ucCredentials: [{ merchantId: 'm1', status: 'active' }] });
    let resolveCredentials: (v: Row[]) => void = () => {};
    const pending = new Promise<Row[]>((resolve) => {
      resolveCredentials = resolve;
    });
    const originalSelectFrom = handle.db.selectFrom;
    handle.db.selectFrom = ((table: string) => {
      if (table !== 'ucCredentials') return originalSelectFrom(table);
      return { select: () => ({ where: () => ({ execute: () => pending }) }) };
    }) as typeof handle.db.selectFrom;
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const first = svc.runReconcileCycle();
    const second = await svc.runReconcileCycle();

    expect(second).toEqual({ ran: false, merchants: 0 });
    resolveCredentials([{ merchantId: 'm1', status: 'active' }]);
    await first;
  });
});

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

describe('UcReconciliationSweepService.canaryTick', () => {
  it('skips the tick entirely when a RUNNING reconciliation job exists for the merchant', async () => {
    const { handle } = fakeHandle({
      ucReconciliationJobs: [{ id: 'running-1', merchantId: 'm1', status: 'RUNNING' }],
    });
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    expect(ratio.listOrders).not.toHaveBeenCalled();
  });

  it("derives the dynamic window from the most recent COMPLETED row's time_range_end", async () => {
    const lastEnd = new Date('2026-07-01T00:00:00.000Z');
    const { handle, tables } = fakeHandle({
      ucReconciliationJobs: [
        {
          id: 'j-older',
          merchantId: 'm1',
          status: 'COMPLETED',
          timeRangeEnd: new Date('2026-06-01T00:00:00.000Z'),
          completedAt: new Date('2026-06-01T01:00:00.000Z'),
        },
        {
          id: 'j-last',
          merchantId: 'm1',
          status: 'COMPLETED',
          timeRangeEnd: lastEnd,
          completedAt: new Date('2026-07-01T01:00:00.000Z'),
        },
        {
          id: 'j-failed',
          merchantId: 'm1',
          status: 'FAILED',
          timeRangeEnd: new Date('2026-08-01T00:00:00.000Z'),
          completedAt: new Date('2026-08-01T01:00:00.000Z'),
        },
      ],
    });
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    // the cheap count pull (and the no-op window) both start at the last
    // COMPLETED row's time_range_end; the FAILED row is ignored
    expect(ratio.listOrders).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ orderDateFrom: lastEnd.toISOString() }),
    );
    const written = tables.ucReconciliationJobs.find((j) => j.requestedBy === 'system');
    expect(written).toMatchObject({
      status: 'COMPLETED',
      timeRangeStart: lastEnd,
      ordersCheckedCount: 0,
      ordersPushedCount: 0,
      ordersAlreadySyncedCount: 0,
      ordersFailedCount: 0,
    });
  });

  it('falls back to now - 15 days when no prior COMPLETED row exists', async () => {
    const { handle, tables } = fakeHandle();
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    const callArgs = ratio.listOrders.mock.calls[0]![1] as { orderDateFrom: string; orderDateTo: string };
    const now = Date.now();
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;
    expect(now - new Date(callArgs.orderDateFrom).getTime()).toBeGreaterThanOrEqual(fifteenDays - 10_000);
    expect(now - new Date(callArgs.orderDateFrom).getTime()).toBeLessThanOrEqual(fifteenDays + 10_000);
    expect(Math.abs(now - new Date(callArgs.orderDateTo).getTime())).toBeLessThanOrEqual(10_000);
    const written = tables.ucReconciliationJobs.find((j) => j.requestedBy === 'system');
    expect(written).toMatchObject({ status: 'COMPLETED', ordersCheckedCount: 0 });
  });

  it('writes a COMPLETED row on a count match so the dynamic window advances', async () => {
    const lastEnd = new Date('2026-07-01T00:00:00.000Z');
    const { handle, tables } = fakeHandle({
      ucReconciliationJobs: [
        {
          id: 'j-last',
          merchantId: 'm1',
          status: 'COMPLETED',
          timeRangeEnd: lastEnd,
          completedAt: new Date('2026-07-01T01:00:00.000Z'),
        },
      ],
      ucSyncJobs: [
        {
          id: 'job-1',
          merchantId: 'm1',
          ratioOrderId: 'o1',
          type: 'order_push',
          status: 'DONE',
          createdAt: new Date(lastEnd.getTime() + 60_000),
        },
      ],
    });
    const ratio = {
      listOrders: vi.fn().mockResolvedValue([orderFixture('o1', { created_at: daysAgo(0.05).toISOString() })]),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    expect(tables.ucSyncJobs).toHaveLength(1); // run() not invoked — no new job row
    const written = tables.ucReconciliationJobs.find((j) => j.requestedBy === 'system');
    expect(written).toMatchObject({
      status: 'COMPLETED',
      timeRangeStart: lastEnd,
      ordersCheckedCount: 1,
      ordersPushedCount: 0,
      ordersAlreadySyncedCount: 1,
      ordersFailedCount: 0,
    });
    expect(written!.completedAt).toBeInstanceOf(Date);
  });

  it('calls the full run() with the derived window on a count mismatch', async () => {
    const lastEnd = new Date('2026-07-01T00:00:00.000Z');
    const { handle, tables } = fakeHandle({
      ucReconciliationJobs: [
        {
          id: 'j-last',
          merchantId: 'm1',
          status: 'COMPLETED',
          timeRangeEnd: lastEnd,
          completedAt: new Date('2026-07-01T01:00:00.000Z'),
        },
      ],
    });
    const ratio = {
      listOrders: vi.fn().mockResolvedValue([orderFixture('o1', { created_at: daysAgo(0.05).toISOString() })]),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    // the full per-order diff ran: the missing order got an order_push job
    expect(tables.ucSyncJobs).toEqual([
      expect.objectContaining({ merchantId: 'm1', ratioOrderId: 'o1', type: 'order_push', status: 'PENDING' }),
    ]);
    // the audit row records the derived window
    const written = tables.ucReconciliationJobs.find((j) => j.requestedBy === 'system');
    expect(written).toMatchObject({
      status: 'COMPLETED',
      timeRangeStart: lastEnd,
      ordersCheckedCount: 1,
      ordersPushedCount: 1,
    });
    // the cheap count pulled with the derived window
    expect(ratio.listOrders).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ orderDateFrom: lastEnd.toISOString() }),
    );
  });
});

describe('UcReconciliationSweepService.canaryTick — stage-aware alert pass', () => {
  it('raises a STALE_ORDER alert for an idle CREATED order past 3 days and none for one at 2 days', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'j1', merchantId: 'm1', ratioOrderId: 'stale-order', type: 'order_push', status: 'DONE', createdAt: new Date() },
        { id: 'j2', merchantId: 'm1', ratioOrderId: 'fresh-order', type: 'order_push', status: 'DONE', createdAt: new Date() },
      ],
    });
    const ratio = {
      listOrders: vi.fn().mockResolvedValue([
        { id: 'stale-order', status: 'open', fulfillment_status: 'unfulfilled', created_at: daysAgo(10).toISOString() },
        { id: 'fresh-order', status: 'open', fulfillment_status: 'unfulfilled', created_at: daysAgo(2).toISOString() },
      ]),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    expect(tables.ucAlerts).toEqual([
      expect.objectContaining({ merchantId: 'm1', type: 'STALE_ORDER', reference: 'stale-order' }),
    ]);
  });

  it("clocks a non-CREATED stage from the order's own updated_at (DISPATCHED past 5 days)", async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'j1', merchantId: 'm1', ratioOrderId: 'dispatched-order', type: 'order_push', status: 'DONE', createdAt: new Date() },
      ],
    });
    const ratio = {
      listOrders: vi.fn().mockResolvedValue([
        // created 2 days ago (fresh if created_at were used) but updated 6 days
        // ago — the 5-day DISPATCHED threshold only trips when updated_at clocks it
        {
          id: 'dispatched-order',
          status: 'open',
          fulfillment_status: 'fulfilled',
          created_at: daysAgo(2).toISOString(),
          updated_at: daysAgo(6).toISOString(),
        },
      ]),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    expect(tables.ucAlerts).toEqual([
      expect.objectContaining({ merchantId: 'm1', type: 'STALE_ORDER', reference: 'dispatched-order' }),
    ]);
  });

  it('falls back to the uc_order_item_map proxy when the order object lacks updated_at', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'j1', merchantId: 'm1', ratioOrderId: 'map-proxy-order', type: 'order_push', status: 'DONE', createdAt: new Date() },
      ],
      ucOrderItemMap: [
        {
          orderItemId: 'item-1',
          merchantId: 'm1',
          ratioOrderId: 'map-proxy-order',
          lastStatusUpdatedAt: daysAgo(8),
          createdAt: daysAgo(9),
        },
      ],
    });
    const ratio = {
      listOrders: vi.fn().mockResolvedValue([
        { id: 'map-proxy-order', status: 'open', fulfillment_status: 'fulfilled', created_at: daysAgo(2).toISOString() },
      ]),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    expect(tables.ucAlerts).toEqual([
      expect.objectContaining({ merchantId: 'm1', type: 'STALE_ORDER', reference: 'map-proxy-order' }),
    ]);
  });

  it('dedupes against an existing unacknowledged STALE_ORDER alert for the same order', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'j1', merchantId: 'm1', ratioOrderId: 'stale-order', type: 'order_push', status: 'DONE', createdAt: new Date() },
      ],
      ucAlerts: [
        { id: 'a1', merchantId: 'm1', type: 'STALE_ORDER', reference: 'stale-order', acknowledgedAt: null },
      ],
    });
    const ratio = {
      listOrders: vi.fn().mockResolvedValue([
        { id: 'stale-order', status: 'open', fulfillment_status: 'unfulfilled', created_at: daysAgo(10).toISOString() },
      ]),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    expect(tables.ucAlerts).toHaveLength(1);
  });

  it('does not alert a terminal order no matter how long it has been in its stage', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [
        { id: 'j1', merchantId: 'm1', ratioOrderId: 'delivered-order', type: 'order_push', status: 'DONE', createdAt: new Date() },
      ],
    });
    const ratio = {
      listOrders: vi.fn().mockResolvedValue([
        {
          id: 'delivered-order',
          status: 'open',
          fulfillment_status: 'delivered',
          created_at: daysAgo(30).toISOString(),
          updated_at: daysAgo(30).toISOString(),
        },
      ]),
    };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    await svc.canaryTick('m1');

    expect(tables.ucAlerts).toHaveLength(0);
  });
});

describe('UcReconciliationSweepService.runCanaryCycle', () => {
  it('runs a canary tick only for merchants with active credentials', async () => {
    const { handle } = fakeHandle({
      ucCredentials: [
        { merchantId: 'm1', status: 'active' },
        { merchantId: 'm2', status: 'paused' },
      ],
    });
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(
      handle as never,
      ratio as never,
      fakeOrderItemMap() as never,
      fakeSyncQueue() as never,
    );

    const outcome = await svc.runCanaryCycle();

    expect(outcome).toEqual({ ran: true, merchants: 1 });
    expect(ratio.listOrders).toHaveBeenCalledWith('m1', expect.objectContaining({ page: 1 }));
  });
});
