import { describe, expect, it, vi } from 'vitest';
import { UcReconciliationSweepService } from '../../../../src/modules/unicommerce/services/reconciliation-sweep.service';

type Row = Record<string, unknown>;

/** Minimal generic multi-table fake Kysely handle for the sweep's DB access. */
function fakeHandle(
  seed: { ucCredentials?: Row[]; ucSyncJobs?: Row[]; ucReconciliationJobs?: Row[] } = {},
) {
  const tables: Record<string, Row[]> = {
    ucCredentials: seed.ucCredentials ?? [],
    ucSyncJobs: seed.ucSyncJobs ?? [],
    ucReconciliationJobs: seed.ucReconciliationJobs ?? [],
  };

  const db = {
    selectFrom: (table: string) => {
      const filters: Array<(row: Row) => boolean> = [];
      const builder = {
        select: () => builder,
        selectAll: () => builder,
        where: (col: string, _op: string, val: unknown) => {
          filters.push((row) => row[col] === val);
          return builder;
        },
        execute: async () => tables[table].filter((r) => filters.every((f) => f(r))),
        executeTakeFirst: async () => tables[table].find((r) => filters.every((f) => f(r))),
      };
      return builder;
    },
    insertInto: (table: string) => ({
      values: (v: Row) => ({
        execute: async () => {
          tables[table].push({ ...v });
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
        where: (col: string, _op: string, val: unknown) => {
          filters.push((row) => row[col] === val);
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

describe('UcReconciliationSweepService.run', () => {
  it('enqueues an order_push job only for a Ratio order with no existing uc_sync_jobs row', async () => {
    const { handle, tables } = fakeHandle({
      ucSyncJobs: [{ merchantId: 'm1', ratioOrderId: 'order-existing', type: 'order_push' }],
    });
    const ratio = {
      listOrders: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'order-existing' }, { id: 'order-missing' }]),
    };
    const svc = new UcReconciliationSweepService(handle as never, ratio as never);

    const result = await svc.run('m1', new Date('2026-01-01'), new Date('2026-01-02'));

    expect(result).toEqual({
      ordersCheckedCount: 2,
      ordersPushedCount: 1,
      ordersAlreadySyncedCount: 1,
      ordersFailedCount: 0,
    });
    expect(
      tables.ucSyncJobs.some((j) => j.ratioOrderId === 'order-missing' && j.status === 'PENDING'),
    ).toBe(true);
  });
});

describe('UcReconciliationSweepService.runForMerchant', () => {
  it('writes a RUNNING job row then updates it to COMPLETED with the sweep counts', async () => {
    const { handle, tables } = fakeHandle();
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const svc = new UcReconciliationSweepService(handle as never, ratio as never);

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
    const svc = new UcReconciliationSweepService(handle as never, ratio as never);

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
    const svc = new UcReconciliationSweepService(handle as never, ratio as never);

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
    const svc = new UcReconciliationSweepService(handle as never, ratio as never);

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
    const svc = new UcReconciliationSweepService(handle as never, {} as never);

    const job = await svc.getJob('job-1');

    expect(job).toMatchObject({ id: 'job-1', merchantId: 'm1', status: 'COMPLETED' });
  });

  it('returns null when no job matches', async () => {
    const { handle } = fakeHandle();
    const svc = new UcReconciliationSweepService(handle as never, {} as never);

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
    const svc = new UcReconciliationSweepService(handle as never, ratio as never);

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
    const svc = new UcReconciliationSweepService(handle as never, ratio as never);

    const first = svc.runReconcileCycle();
    const second = await svc.runReconcileCycle();

    expect(second).toEqual({ ran: false, merchants: 0 });
    resolveCredentials([{ merchantId: 'm1', status: 'active' }]);
    await first;
  });
});
