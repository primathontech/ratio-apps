import { describe, expect, it } from 'vitest';
import { UcOrderItemMapService } from '../../../../src/modules/unicommerce/services/order-item-map.service';

/**
 * Fake DB backing both `resolve()` (selectAll().where(id)) and the new
 * lookup `generate()` does before inserting (select('orderItemId')
 * .where(merchantId).where(ratioOrderId).where(ratioLineItemId)) — modeled
 * as an in-memory table so a matching row inserted by an earlier `generate()`
 * call is actually found by a later one, same as a real unique lookup would.
 *
 * The INSERT path (`execute()`) checks for an existing row on the unique
 * (merchantId, ratioOrderId, ratioLineItemId) tuple and throws a
 * mysql2-shaped duplicate-key error (`code: 'ER_DUP_ENTRY'`, `errno: 1062`)
 * if one is found — modeling `idx_uc_order_item_map_lookup` (migration
 * 0007) — so `generate()`'s catch-and-reselect path can actually be
 * exercised under concurrency, not just assumed.
 */
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  const matches = (row: Record<string, unknown>, filters: Record<string, unknown>) =>
    Object.entries(filters).every(([k, v]) => row[k] === v);
  const uniqueKey = (row: Record<string, unknown>) => ({
    merchantId: row.merchantId,
    ratioOrderId: row.ratioOrderId,
    ratioLineItemId: row.ratioLineItemId,
  });

  return {
    db: {
      insertInto: () => ({
        values: (v: Record<string, unknown>) => ({
          execute: async () => {
            if (rows.some((r) => matches(r, uniqueKey(v)))) {
              const err = new Error(
                "Duplicate entry for key 'idx_uc_order_item_map_lookup'",
              ) as Error & { code?: string; errno?: number };
              err.code = 'ER_DUP_ENTRY';
              err.errno = 1062;
              throw err;
            }
            rows.push(v);
          },
        }),
      }),
      selectFrom: () => {
        const filters: Record<string, unknown> = {};
        const builder = {
          selectAll: () => builder,
          select: (_col: string) => builder,
          where: (col: string, _op: string, val: unknown) => {
            filters[col] = val;
            return builder;
          },
          executeTakeFirst: async () => rows.find((r) => matches(r, filters)),
        };
        return builder;
      },
    },
    rows,
  };
}

describe('UcOrderItemMapService', () => {
  it('generates a unique orderItemId and resolves it back to the same row', async () => {
    const fakeDbObj = fakeDb();
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    const orderItemId = await svc.generate('m1', 'order-1', 'line-1');

    expect(typeof orderItemId).toBe('string');
    expect(orderItemId.length).toBeGreaterThan(0);
    expect(fakeDbObj.rows[0]).toMatchObject({
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      ratioLineItemId: 'line-1',
    });

    const resolved = await svc.resolve(orderItemId);
    expect(resolved).toMatchObject({
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      ratioLineItemId: 'line-1',
    });
  });

  it('is idempotent: two generate() calls for the same tuple return the SAME orderItemId (Fix 3)', async () => {
    const fakeDbObj = fakeDb();
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    const first = await svc.generate('m1', 'order-1', 'line-1');
    const second = await svc.generate('m1', 'order-1', 'line-1');

    expect(second).toBe(first);
    // Only one row ever inserted — a naive retry would have minted a second,
    // orphaned row for the identical (merchantId, ratioOrderId,
    // ratioLineItemId) tuple.
    expect(fakeDbObj.rows).toHaveLength(1);
  });

  it('still mints distinct ids for genuinely different line items', async () => {
    const fakeDbObj = fakeDb();
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    const a = await svc.generate('m1', 'order-1', 'line-1');
    const b = await svc.generate('m1', 'order-1', 'line-2');

    expect(a).not.toBe(b);
    expect(fakeDbObj.rows).toHaveLength(2);
  });

  // Bug 2 (review): a naive SELECT-then-INSERT lets two truly concurrent
  // calls both pass the SELECT (neither has inserted yet) before either
  // INSERTs. Fired via `Promise.all` — NOT two sequentially-awaited calls —
  // so both invocations are genuinely in flight together. The fake DB's
  // INSERT enforces the unique (merchantId, ratioOrderId, ratioLineItemId)
  // tuple exactly like `idx_uc_order_item_map_lookup` would, so the loser
  // must actually hit the catch-and-reselect path to pass this test — it is
  // not possible to pass by coincidence of ordering.
  it('two concurrent generate() calls for the identical tuple resolve to the same orderItemId and only one row exists (Bug 2 fix)', async () => {
    const fakeDbObj = fakeDb();
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    const [first, second] = await Promise.all([
      svc.generate('m1', 'order-race', 'line-race'),
      svc.generate('m1', 'order-race', 'line-race'),
    ]);

    expect(first).toBe(second);
    expect(fakeDbObj.rows).toHaveLength(1);
    expect(fakeDbObj.rows[0]).toMatchObject({
      merchantId: 'm1',
      ratioOrderId: 'order-race',
      ratioLineItemId: 'line-race',
    });
  });

  it('findSaleOrderCode returns the saleOrderCode recorded on the matching order_push job', async () => {
    const fakeDbObj = fakeDb();
    // findSaleOrderCode reads from `ucSyncJobs`, not `ucOrderItemMap` — extend
    // the fake with a second in-memory table rather than reusing `rows`.
    const jobs: Record<string, unknown>[] = [
      {
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        type: 'order_push',
        status: 'DONE',
        saleOrderCode: 'UC-999',
      },
    ];
    const originalSelectFrom = fakeDbObj.db.selectFrom;
    fakeDbObj.db.selectFrom = (table: string) => {
      if (table !== 'ucSyncJobs') return originalSelectFrom(table);
      const filters: Record<string, unknown> = {};
      const builder = {
        selectAll: () => builder,
        select: (_col: string) => builder,
        where: (col: string, _op: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        orderBy: () => builder,
        executeTakeFirst: async () =>
          jobs.find((j) => Object.entries(filters).every(([k, v]) => j[k] === v)),
      };
      return builder;
    };
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    const code = await svc.findSaleOrderCode('m1', 'order-1');

    expect(code).toBe('UC-999');
  });

  // Fix 2 (review): a redelivered webhook can leave MULTIPLE order_push rows
  // for the same order — earlier non-DONE attempts with a null saleOrderCode,
  // plus (once successful) one DONE row with the real code. Without a
  // `status = 'DONE'` filter, `executeTakeFirst()` has no ordering guarantee
  // and could return the null-code row, wrongly making the cancel handler
  // think "never pushed." The PENDING row is inserted FIRST here specifically
  // so a naive unfiltered lookup would find it before the DONE row.
  it('findSaleOrderCode skips a non-DONE row and returns the DONE row\'s code when multiple order_push rows exist for the same order', async () => {
    const fakeDbObj = fakeDb();
    const jobs: Record<string, unknown>[] = [
      {
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        type: 'order_push',
        status: 'NEEDS_MANUAL',
        saleOrderCode: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        type: 'order_push',
        status: 'DONE',
        saleOrderCode: 'UC-REAL-CODE',
        createdAt: new Date('2026-01-01T00:05:00Z'),
      },
    ];
    const originalSelectFrom = fakeDbObj.db.selectFrom;
    fakeDbObj.db.selectFrom = (table: string) => {
      if (table !== 'ucSyncJobs') return originalSelectFrom(table);
      const filters: Record<string, unknown> = {};
      const builder = {
        selectAll: () => builder,
        select: (_col: string) => builder,
        where: (col: string, _op: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        orderBy: () => builder,
        executeTakeFirst: async () =>
          jobs.find((j) => Object.entries(filters).every(([k, v]) => j[k] === v)),
      };
      return builder;
    };
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    const code = await svc.findSaleOrderCode('m1', 'order-1');

    expect(code).toBe('UC-REAL-CODE');
  });

  it('findSaleOrderCode returns null when no matching order_push job exists', async () => {
    const fakeDbObj = fakeDb();
    const originalSelectFrom = fakeDbObj.db.selectFrom;
    fakeDbObj.db.selectFrom = (table: string) => {
      if (table !== 'ucSyncJobs') return originalSelectFrom(table);
      const builder = {
        selectAll: () => builder,
        select: (_col: string) => builder,
        where: () => builder,
        orderBy: () => builder,
        executeTakeFirst: async () => undefined,
      };
      return builder;
    };
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    const code = await svc.findSaleOrderCode('m1', 'order-never-pushed');

    expect(code).toBeNull();
  });

  it('markSource updates only the source column for the matching orderItemId', async () => {
    const fakeDbObj = fakeDb();
    fakeDbObj.db.updateTable = () => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> = {};
      const builder = {
        set: (p: Record<string, unknown>) => {
          patch = p;
          return builder;
        },
        where: (col: string, _op: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        execute: async () => {
          const row = fakeDbObj.rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          if (row) Object.assign(row, patch);
        },
      };
      return builder as never;
    };
    const svc = new UcOrderItemMapService(fakeDbObj as never);
    await svc.generate('m1', 'order-1', 'line-1');
    const orderItemId = fakeDbObj.rows[0]!.orderItemId as string;

    await svc.markSource(orderItemId, 'uc_originated');

    expect(fakeDbObj.rows[0]).toMatchObject({ orderItemId, source: 'uc_originated' });
  });

  it('propagates a non-duplicate-key error from the INSERT instead of masking it', async () => {
    const fakeDbObj = fakeDb();
    const boom = new Error('connection reset');
    fakeDbObj.db.insertInto = () => ({
      values: () => ({
        execute: async () => {
          throw boom;
        },
      }),
    });
    const svc = new UcOrderItemMapService(fakeDbObj as never);

    await expect(svc.generate('m1', 'order-1', 'line-1')).rejects.toThrow('connection reset');
  });
});
