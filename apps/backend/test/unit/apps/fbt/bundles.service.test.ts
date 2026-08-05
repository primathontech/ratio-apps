import { describe, expect, it } from 'vitest';
import { FbtBundlesService } from '../../../../src/modules/fbt/bundles/bundles.service';

const ROW = {
  id: 'b-1',
  merchantId: 'm-1',
  name: 'Bundle One',
  status: 'draft' as const,
  scopeType: 'all_products' as const,
  scopeProductIds: null,
  scopeCollectionIds: null,
  startDate: null,
  endDate: null,
  recommendationCount: 3,
  recommendationProductList: null,
  uiConfig: { title: 'FBT' },
  perCardConfig: null,
  mode: 'manual' as const,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const INPUT = {
  name: 'Bundle One',
  status: 'draft' as const,
  scopeType: 'all_products' as const,
  scopeProductIds: null,
  scopeCollectionIds: null,
  startDate: null,
  endDate: null,
  recommendationCount: 3,
  uiConfig: { title: 'FBT' },
  perCardConfig: null,
};

type Op = 'select' | 'insert' | 'update' | 'delete';

interface RecordedQuery {
  op: Op;
  wheres: unknown[][];
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
}

/**
 * Chainable Kysely double. Each `selectFrom`/`insertInto`/`updateTable`/
 * `deleteFrom` call gets its OWN `RecordedQuery`, so tests can prove which
 * specific SQL statement carried the merchant filter — not just that a
 * `merchantId` where-clause appeared *somewhere* across the whole call.
 *
 * That distinction matters here: `update`, `setStatus`, and `duplicate` all
 * call `getById` first (a `select`) before issuing their own `update`/`insert`.
 * A single shared `wheres` array (the original shape of this double) cannot
 * tell "the UPDATE's own filter" apart from "the pre-check's filter", so a
 * regression that dropped the UPDATE's `WHERE merchantId = ?` would go
 * undetected. Scoping by query fixes that.
 */
// Rest tuple, not a default parameter: `fakeHandle(undefined)` must mean
// "no row", which a default parameter (`row = ROW`) would silently convert
// back to ROW, since JS default params also fire on an explicit `undefined`
// argument, not just an omitted one.
function fakeHandle(...args: [] | [Record<string, unknown> | undefined]) {
  const row = args.length === 0 ? ROW : args[0];
  const queries: RecordedQuery[] = [];

  function makeChain(op: Op) {
    const q: RecordedQuery = { op, wheres: [] };
    queries.push(q);
    const chain = {
      selectAll: () => chain,
      select: () => chain,
      where: (...w: unknown[]) => {
        q.wheres.push(w);
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      set: (v: Record<string, unknown>) => {
        q.set = v;
        return chain;
      },
      values: (v: Record<string, unknown>) => {
        q.values = v;
        return chain;
      },
      executeTakeFirst: async () => row,
      executeTakeFirstOrThrow: async () => ({ total: 1 }),
      execute: async () => (row ? [row] : []),
    };
    return chain;
  }

  const db = {
    selectFrom: () => makeChain('select'),
    insertInto: () => makeChain('insert'),
    updateTable: () => makeChain('update'),
    deleteFrom: () => makeChain('delete'),
    fn: { count: () => ({ as: () => 'total' }) },
  };
  return { handle: { db } as never, queries };
}

/** Does this ONE statement carry the merchant filter? */
function hasMerchantFilter(q: RecordedQuery, merchantId: string): boolean {
  return q.wheres.some((w) => w[0] === 'merchantId' && w[1] === '=' && w[2] === merchantId);
}

const opsOf = (queries: RecordedQuery[], op: Op) => queries.filter((q) => q.op === op);

describe('FbtBundlesService — tenancy', () => {
  it('filters getById by merchantId, not just the bundle id', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).getById('m-1', 'b-1');

    // Without this clause any merchant could read another merchant's bundle by
    // guessing/leaking its UUID. The source app was vulnerable exactly here.
    const selects = opsOf(queries, 'select');
    expect(selects).toHaveLength(1);
    expect(selects[0]?.wheres).toEqual(
      expect.arrayContaining([
        ['merchantId', '=', 'm-1'],
        ['id', '=', 'b-1'],
      ]),
    );
  });

  it('throws BUNDLE_NOT_FOUND when no row matches', async () => {
    const { handle } = fakeHandle(undefined);
    await expect(new FbtBundlesService(handle).getById('m-1', 'b-1')).rejects.toMatchObject({
      response: { message: 'bundle not found', error_code: 'BUNDLE_NOT_FOUND' },
    });
  });

  it('filters the UPDATE itself by merchantId, not just the ownership pre-check', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).update('m-1', 'b-1', INPUT);

    // `update()` calls `getById` first (its own `select`, correctly merchant-scoped
    // per the test above) before issuing the UPDATE. Asserting against the UPDATE
    // record specifically — not any `select` that ran alongside it — is what proves
    // the write query is tenant-scoped on its own, independent of the pre-check.
    const updates = opsOf(queries, 'update');
    expect(updates).toHaveLength(1);
    expect(hasMerchantFilter(updates[0]!, 'm-1')).toBe(true);
  });

  it('filters delete by merchantId', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).remove('m-1', 'b-1');

    const deletes = opsOf(queries, 'delete');
    expect(deletes).toHaveLength(1);
    expect(hasMerchantFilter(deletes[0]!, 'm-1')).toBe(true);
  });

  it('filters the setStatus UPDATE itself by merchantId, not just the ownership pre-check', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).setStatus('m-1', 'b-1', 'published');

    const updates = opsOf(queries, 'update');
    expect(updates).toHaveLength(1);
    expect(hasMerchantFilter(updates[0]!, 'm-1')).toBe(true);
  });

  it('reads the source bundle scoped to the merchant before duplicating', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).duplicate('m-1', 'b-1');

    const selects = opsOf(queries, 'select');
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((s) => hasMerchantFilter(s, 'm-1'))).toBe(true);
  });

  it('scopes the list query to the merchant', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).list('m-1', { page: 1, limit: 20 });

    // `list()` derives both the page of rows and the COUNT from ONE filtered
    // query builder, so exactly one `selectFrom` call is expected here.
    const selects = opsOf(queries, 'select');
    expect(selects).toHaveLength(1);
    expect(hasMerchantFilter(selects[0]!, 'm-1')).toBe(true);
  });
});

describe('FbtBundlesService.create', () => {
  it('stringifies JSON columns and stamps a uuid and manual mode', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).create('m-1', {
      ...INPUT,
      scopeType: 'specific_product',
      scopeProductIds: ['p-1'],
    });

    const v = opsOf(queries, 'insert')[0]?.values ?? {};
    expect(typeof v.id).toBe('string');
    expect(v.merchantId).toBe('m-1');
    // The admin may only create manual bundles; the sweep owns 'auto'.
    expect(v.mode).toBe('manual');
    expect(v.scopeProductIds).toBe('["p-1"]');
    expect(v.uiConfig).toBe('{"title":"FBT"}');
    // Absent lists must be SQL NULL, not the string "null".
    expect(v.scopeCollectionIds).toBeNull();
    expect(v.perCardConfig).toBeNull();
  });

  it('never accepts a client-supplied mode or recommendationProductList', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).create('m-1', {
      ...INPUT,
      mode: 'auto',
      recommendationProductList: ['smuggled'],
    } as never);

    const v = opsOf(queries, 'insert')[0]?.values;
    expect(v?.mode).toBe('manual');
    expect(v).not.toHaveProperty('recommendationProductList');
  });
});

describe('FbtBundlesService.duplicate', () => {
  it('copies the source bundle as a draft with a new id and suffixed name', async () => {
    const { handle, queries } = fakeHandle({ ...ROW, status: 'published' });
    await new FbtBundlesService(handle).duplicate('m-1', 'b-1');

    const v = opsOf(queries, 'insert')[0]?.values ?? {};
    expect(v.id).not.toBe('b-1');
    // A duplicate must never land published — that would silently put an
    // unreviewed copy in front of shoppers.
    expect(v.status).toBe('draft');
    expect(v.name).toBe('Bundle One (copy)');
  });

  it('honours an explicit name', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).duplicate('m-1', 'b-1', 'My Copy');
    expect(opsOf(queries, 'insert')[0]?.values?.name).toBe('My Copy');
  });

  it('does not copy auto-generated recommendations into the duplicate', async () => {
    const { handle, queries } = fakeHandle({
      ...ROW,
      mode: 'auto',
      recommendationProductList: ['p-9'],
    });
    await new FbtBundlesService(handle).duplicate('m-1', 'b-1');

    // The copy is a manual bundle the merchant now owns; carrying the sweep's
    // product list over would make it look auto-managed when nothing manages it.
    const v = opsOf(queries, 'insert')[0]?.values;
    expect(v?.mode).toBe('manual');
    expect(v?.recommendationProductList).toBeNull();
  });
});

describe('FbtBundlesService.setStatus', () => {
  it('writes only the status column', async () => {
    const { handle, queries } = fakeHandle();
    await new FbtBundlesService(handle).setStatus('m-1', 'b-1', 'published');
    expect(Object.keys(opsOf(queries, 'update')[0]?.set ?? {})).toEqual(['status']);
  });
});

describe('FbtBundlesService.list', () => {
  it('clamps limit to 100 and page to at least 1', async () => {
    const { handle } = fakeHandle();
    const svc = new FbtBundlesService(handle);
    const out = await svc.list('m-1', { page: 0, limit: 5000 });
    expect(out.limit).toBe(100);
    expect(out.page).toBe(1);
  });
});
