import { describe, expect, it } from 'vitest';
import { FbtBundleLookupService } from '../../../../src/modules/fbt/bundles/bundle-lookup.service';

const BASE = {
  id: 'b-1',
  merchantId: 'm-1',
  name: 'B',
  status: 'published' as const,
  scopeType: 'specific_product' as const,
  scopeProductIds: ['p-1'],
  scopeCollectionIds: null,
  startDate: null,
  endDate: null,
  recommendationCount: 3,
  recommendationProductList: ['r-1', 'r-2'],
  uiConfig: {},
  perCardConfig: null,
  mode: 'manual' as const,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

/**
 * Returns a queued row per successive query so tests can model
 * "product match missed, all_products fallback hit".
 */
function fakeHandle(queue: Array<Record<string, unknown> | undefined>) {
  const scopeTypesQueried: unknown[] = [];
  const sqlFragments: string[] = [];
  let i = 0;

  const chain = {
    selectAll: () => chain,
    where: (...args: unknown[]) => {
      if (args[0] === 'scopeType') scopeTypesQueried.push(args[2]);
      // Raw sql`` fragments arrive as a single Kysely `RawBuilder` argument.
      // `JSON.stringify`/`Object.keys` see nothing — the builder keeps its SQL
      // text behind private fields — so we go through its public
      // `toOperationNode()` API instead, which returns a plain
      // `{ kind: 'RawNode', sqlFragments: [...], parameters: [...] }` object
      // carrying the actual SQL text the fragment was built from.
      const candidate = args[0] as { toOperationNode?: () => unknown } | undefined;
      if (args.length === 1 && candidate && typeof candidate.toOperationNode === 'function') {
        sqlFragments.push(JSON.stringify(candidate.toOperationNode()));
      }
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    executeTakeFirst: async () => queue[i++],
  };
  const db = { selectFrom: () => chain };
  return { handle: { db } as never, scopeTypesQueried, sqlFragments };
}

describe('FbtBundleLookupService.resolve — precedence', () => {
  it('returns the product-scoped bundle when one matches', async () => {
    const { handle } = fakeHandle([BASE]);
    const out = await new FbtBundleLookupService(handle).resolve('m-1', { productId: 'p-1' });
    expect(out.id).toBe('b-1');
  });

  it('falls back to the all_products bundle when no product-scoped bundle matches', async () => {
    const { handle, scopeTypesQueried } = fakeHandle([
      undefined,
      { ...BASE, id: 'b-all', scopeType: 'all_products', scopeProductIds: null },
    ]);
    const out = await new FbtBundleLookupService(handle).resolve('m-1', { productId: 'p-9' });

    expect(out.id).toBe('b-all');
    expect(scopeTypesQueried).toContain('all_products');
  });

  it('prefers the product match over the collection match when both are supplied', async () => {
    const { handle, scopeTypesQueried } = fakeHandle([BASE]);
    const out = await new FbtBundleLookupService(handle).resolve('m-1', {
      productId: 'p-1',
      collectionId: 'c-1',
    });

    expect(out.id).toBe('b-1');
    // `out.id` alone can't tell "the product branch ran" from "the collection
    // branch ran and happened to return the same fixture row" — the fake
    // serves queued rows by call order, not by matching query content. Only
    // ONE query should have been needed (the product branch short-circuits),
    // and it must be the `specific_product` one, not `specific_collections` —
    // this is what would actually catch a swapped precedence check.
    expect(scopeTypesQueried).toEqual(['specific_product']);
  });

  it('uses the collection branch when only a collectionId is given', async () => {
    const { handle, scopeTypesQueried } = fakeHandle([
      { ...BASE, id: 'b-coll', scopeType: 'specific_collections' },
    ]);
    const out = await new FbtBundleLookupService(handle).resolve('m-1', { collectionId: 'c-1' });

    expect(out.id).toBe('b-coll');
    expect(scopeTypesQueried).toContain('specific_collections');
  });

  it('throws BUNDLE_NOT_FOUND when neither a scoped nor an all_products bundle matches', async () => {
    const { handle } = fakeHandle([undefined, undefined]);
    await expect(
      new FbtBundleLookupService(handle).resolve('m-1', { productId: 'p-9' }),
    ).rejects.toThrow();
  });

  it('matches JSON arrays with JSON_CONTAINS on the snake_case column, never a LIKE scan', async () => {
    const { handle, sqlFragments } = fakeHandle([BASE]);
    await new FbtBundleLookupService(handle).resolve('m-1', { productId: 'p-1' });

    const all = sqlFragments.join(' ');
    expect(all).toContain('JSON_CONTAINS');
    expect(all).not.toContain('LIKE');
    // Pin the literal snake_case column. CamelCasePlugin does NOT rewrite
    // identifiers inside raw fragments, so a `sql.ref('scopeProductIds')`
    // regression would emit camelCase and fail at runtime with "unknown
    // column" — while still satisfying the two assertions above.
    expect(all).toContain('scope_product_ids');
    expect(all).not.toContain('scopeProductIds');
  });

  it('matches the collection scope on the snake_case column', async () => {
    const { handle, sqlFragments } = fakeHandle([
      { ...BASE, id: 'b-coll', scopeType: 'specific_collections' },
    ]);
    await new FbtBundleLookupService(handle).resolve('m-1', { collectionId: 'c-1' });

    const all = sqlFragments.join(' ');
    expect(all).toContain('JSON_CONTAINS');
    expect(all).toContain('scope_collection_ids');
    expect(all).not.toContain('scopeCollectionIds');
  });

  it('goes straight to the all_products bundle when neither id is supplied', async () => {
    const { handle, scopeTypesQueried } = fakeHandle([
      { ...BASE, id: 'b-all', scopeType: 'all_products', scopeProductIds: null },
    ]);
    const out = await new FbtBundleLookupService(handle).resolve('m-1', {});

    expect(out.id).toBe('b-all');
    // No scoped query should have been attempted at all.
    expect(scopeTypesQueried).toEqual(['all_products']);
  });
});

describe('FbtBundleLookupService.preview', () => {
  it('returns the bundle plus its resolved recommendation product ids', async () => {
    const { handle } = fakeHandle([BASE]);
    const out = await new FbtBundleLookupService(handle).preview('m-1', 'b-1');

    expect(out.bundle.id).toBe('b-1');
    expect(out.productIds).toEqual(['r-1', 'r-2']);
  });

  it('previews a draft bundle — preview must not require published status', async () => {
    const { handle } = fakeHandle([{ ...BASE, status: 'draft' }]);
    const out = await new FbtBundleLookupService(handle).preview('m-1', 'b-1');

    // The whole point of preview is to see a bundle BEFORE publishing it.
    expect(out.bundle.status).toBe('draft');
  });

  it('returns an empty product list when the bundle has no recommendations yet', async () => {
    const { handle } = fakeHandle([{ ...BASE, recommendationProductList: null }]);
    const out = await new FbtBundleLookupService(handle).preview('m-1', 'b-1');
    expect(out.productIds).toEqual([]);
  });
});
