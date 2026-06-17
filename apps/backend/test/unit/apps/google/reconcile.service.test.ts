import { describe, expect, it, vi } from 'vitest';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';
import type { FeedSyncService } from '../../../../src/modules/google/gmc/feed-sync.service';
import { ReconcileService } from '../../../../src/modules/google/gmc/reconcile.service';

/** Fake handle whose google_configs⋈merchants query returns `rows`. */
function fakeHandle(rows: { merchantId: string }[]): KyselyClient<GoogleDatabase> {
  const chain = {
    innerJoin: () => chain,
    select: () => chain,
    where: () => chain,
    execute: async () => rows,
  };
  return { db: { selectFrom: () => chain } } as unknown as KyselyClient<GoogleDatabase>;
}

describe('ReconcileService.runReconcileCycle', () => {
  it('runs fullSync(reconcile) for each eligible merchant', async () => {
    const fullSync = vi.fn().mockResolvedValue({ updated: 0, errored: 0 });
    const svc = new ReconcileService(fakeHandle([{ merchantId: 'm1' }, { merchantId: 'm2' }]), {
      fullSync,
    } as unknown as FeedSyncService);

    const res = await svc.runReconcileCycle();

    expect(res).toEqual({ ran: true, merchants: 2 });
    expect(fullSync).toHaveBeenCalledTimes(2);
    expect(fullSync).toHaveBeenCalledWith('m1', 'reconcile');
    expect(fullSync).toHaveBeenCalledWith('m2', 'reconcile');
  });

  it('single-runner guard: an overlapping cycle is skipped while one is in flight', async () => {
    // Hold the first cycle open inside fullSync so the second call overlaps it.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fullSync = vi.fn().mockImplementation(async () => {
      await gate;
      return { updated: 0, errored: 0 };
    });
    const svc = new ReconcileService(fakeHandle([{ merchantId: 'm1' }]), {
      fullSync,
    } as unknown as FeedSyncService);

    const first = svc.runReconcileCycle(); // starts, awaits gate inside fullSync
    await Promise.resolve(); // let the first cycle enter the running state
    const second = await svc.runReconcileCycle(); // overlaps → skipped

    expect(second).toEqual({ ran: false, merchants: 0 });
    release();
    await expect(first).resolves.toEqual({ ran: true, merchants: 1 });
  });

  it('a merchant whose fullSync throws does not abort the cycle', async () => {
    const fullSync = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ updated: 0, errored: 0 });
    const svc = new ReconcileService(fakeHandle([{ merchantId: 'm1' }, { merchantId: 'm2' }]), {
      fullSync,
    } as unknown as FeedSyncService);

    const res = await svc.runReconcileCycle();
    expect(res.ran).toBe(true);
    expect(fullSync).toHaveBeenCalledTimes(2);
  });
});
