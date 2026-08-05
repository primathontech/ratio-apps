import { describe, expect, it } from 'vitest';
import { FbtDashboardService } from '../../../../src/modules/fbt/dashboard/dashboard.service';

/** Returns one grouped-count result set, and records the where clauses. */
function fakeHandle(rows: Array<Record<string, unknown>>) {
  const wheres: Array<unknown[]> = [];
  const chain = {
    select: () => chain,
    where: (...args: unknown[]) => {
      wheres.push(args);
      return chain;
    },
    groupBy: () => chain,
    execute: async () => rows,
  };
  const db = {
    selectFrom: () => chain,
    fn: { count: () => ({ as: (alias: string) => alias }) },
  };
  return { handle: { db } as never, wheres };
}

describe('FbtDashboardService.summary', () => {
  it('scopes the counts to the merchant', async () => {
    const { handle, wheres } = fakeHandle([]);
    await new FbtDashboardService(handle).summary('m-1');
    expect(wheres).toEqual(expect.arrayContaining([['merchantId', '=', 'm-1']]));
  });

  it('reports zero for every metric when the merchant has no bundles', async () => {
    const { handle } = fakeHandle([]);
    const out = await new FbtDashboardService(handle).summary('m-1');

    // Absent groups must read as 0, not undefined — the admin renders these
    // straight into stat tiles.
    expect(out).toEqual({
      activeBundles: 0,
      draftBundles: 0,
      pausedBundles: 0,
      manualBundles: 0,
      autoBundles: 0,
    });
  });

  it('maps status and mode groups onto the five metric names', async () => {
    const { handle } = fakeHandle([
      { status: 'published', mode: 'manual', total: 2 },
      { status: 'draft', mode: 'manual', total: 1 },
      { status: 'paused', mode: 'auto', total: 3 },
      { status: 'published', mode: 'auto', total: 4 },
    ]);
    const out = await new FbtDashboardService(handle).summary('m-1');

    // 'activeBundles' is the published count — the source app's name for it.
    expect(out.activeBundles).toBe(6);
    expect(out.draftBundles).toBe(1);
    expect(out.pausedBundles).toBe(3);
    expect(out.manualBundles).toBe(3);
    expect(out.autoBundles).toBe(7);
  });

  it('ignores archived bundles in the status metrics but still counts them by mode', async () => {
    const { handle } = fakeHandle([{ status: 'archived', mode: 'manual', total: 5 }]);
    const out = await new FbtDashboardService(handle).summary('m-1');

    expect(out.activeBundles).toBe(0);
    expect(out.draftBundles).toBe(0);
    expect(out.pausedBundles).toBe(0);
    expect(out.manualBundles).toBe(5);
  });

  it('coerces string counts from mysql2 into numbers', async () => {
    const { handle } = fakeHandle([{ status: 'published', mode: 'manual', total: '7' }]);
    const out = await new FbtDashboardService(handle).summary('m-1');

    // mysql2 can hand back COUNT() as a string; JSON-serialising that would
    // give the admin "7" and break arithmetic in the UI.
    expect(out.activeBundles).toBe(7);
    expect(typeof out.activeBundles).toBe('number');
  });
});
