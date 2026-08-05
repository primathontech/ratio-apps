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

/**
 * Chainable Kysely double that records every `where` clause so tests can prove
 * the merchant filter is present, plus the values passed to insert/update.
 */
// `row` defaults to ROW only when the argument is truly omitted. Using a plain
// default parameter (`row = ROW`) would also fire on an *explicit* `undefined`
// (that's how JS default params work), silently turning `fakeHandle(undefined)`
// — used below to simulate "no row" — back into `fakeHandle(ROW)` and defeating
// the not-found test. The rest-tuple + `args.length` check keeps the two cases
// distinct.
function fakeHandle(...args: [row?: Record<string, unknown> | undefined]) {
  const row = args.length > 0 ? args[0] : ROW;
  const wheres: Array<unknown[]> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const deleted: Array<true> = [];

  const chain = {
    selectAll: () => chain,
    select: () => chain,
    where: (...args: unknown[]) => {
      wheres.push(args);
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    set: (values: Record<string, unknown>) => {
      updated.push(values);
      return chain;
    },
    values: (values: Record<string, unknown>) => {
      inserted.push(values);
      return chain;
    },
    executeTakeFirst: async () => row,
    executeTakeFirstOrThrow: async () => ({ total: 1 }),
    execute: async () => (row ? [row] : []),
  };

  const db = {
    selectFrom: () => chain,
    insertInto: () => chain,
    updateTable: () => chain,
    deleteFrom: () => {
      deleted.push(true);
      return chain;
    },
    fn: { count: () => ({ as: () => 'total' }) },
  };
  return { handle: { db } as never, wheres, inserted, updated, deleted };
}

describe('FbtBundlesService — tenancy', () => {
  it('filters getById by merchantId, not just the bundle id', async () => {
    const { handle, wheres } = fakeHandle();
    await new FbtBundlesService(handle).getById('m-1', 'b-1');

    // Without this clause any merchant could read another merchant's bundle by
    // guessing/leaking its UUID. The source app was vulnerable exactly here.
    expect(wheres).toEqual(
      expect.arrayContaining([
        ['merchantId', '=', 'm-1'],
        ['id', '=', 'b-1'],
      ]),
    );
  });

  it('throws BUNDLE_NOT_FOUND when the row belongs to another merchant', async () => {
    const { handle } = fakeHandle(undefined);
    await expect(new FbtBundlesService(handle).getById('m-1', 'b-1')).rejects.toThrow();
  });

  it('filters update by merchantId', async () => {
    const { handle, wheres } = fakeHandle();
    await new FbtBundlesService(handle).update('m-1', 'b-1', INPUT);
    expect(wheres).toEqual(expect.arrayContaining([['merchantId', '=', 'm-1']]));
  });

  it('filters delete by merchantId', async () => {
    const { handle, wheres } = fakeHandle();
    await new FbtBundlesService(handle).remove('m-1', 'b-1');
    expect(wheres).toEqual(expect.arrayContaining([['merchantId', '=', 'm-1']]));
  });
});

describe('FbtBundlesService.create', () => {
  it('stringifies JSON columns and stamps a uuid and manual mode', async () => {
    const { handle, inserted } = fakeHandle();
    await new FbtBundlesService(handle).create('m-1', {
      ...INPUT,
      scopeType: 'specific_product',
      scopeProductIds: ['p-1'],
    });

    const v = inserted[0] ?? {};
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
    const { handle, inserted } = fakeHandle();
    await new FbtBundlesService(handle).create('m-1', {
      ...INPUT,
      mode: 'auto',
      recommendationProductList: ['smuggled'],
    } as never);

    expect(inserted[0]?.mode).toBe('manual');
    expect(inserted[0]).not.toHaveProperty('recommendationProductList');
  });
});

describe('FbtBundlesService.duplicate', () => {
  it('copies the source bundle as a draft with a new id and suffixed name', async () => {
    const { handle, inserted } = fakeHandle({ ...ROW, status: 'published' });
    await new FbtBundlesService(handle).duplicate('m-1', 'b-1');

    const v = inserted[0] ?? {};
    expect(v.id).not.toBe('b-1');
    // A duplicate must never land published — that would silently put an
    // unreviewed copy in front of shoppers.
    expect(v.status).toBe('draft');
    expect(v.name).toBe('Bundle One (copy)');
  });

  it('honours an explicit name', async () => {
    const { handle, inserted } = fakeHandle();
    await new FbtBundlesService(handle).duplicate('m-1', 'b-1', 'My Copy');
    expect(inserted[0]?.name).toBe('My Copy');
  });

  it('does not copy auto-generated recommendations into the duplicate', async () => {
    const { handle, inserted } = fakeHandle({
      ...ROW,
      mode: 'auto',
      recommendationProductList: ['p-9'],
    });
    await new FbtBundlesService(handle).duplicate('m-1', 'b-1');

    // The copy is a manual bundle the merchant now owns; carrying the sweep's
    // product list over would make it look auto-managed when nothing manages it.
    expect(inserted[0]?.mode).toBe('manual');
    expect(inserted[0]?.recommendationProductList).toBeNull();
  });
});

describe('FbtBundlesService.setStatus', () => {
  it('writes only the status column', async () => {
    const { handle, updated } = fakeHandle();
    await new FbtBundlesService(handle).setStatus('m-1', 'b-1', 'published');
    expect(Object.keys(updated[0] ?? {})).toEqual(['status']);
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
