import { describe, expect, it } from 'vitest';
import {
  extractProductId,
  invalidateProduct,
} from '../../../../src/modules/fbt/webhooks/invalidate-product';
import { FbtProductCreatedHandler } from '../../../../src/modules/fbt/webhooks/product-created.handler';
import { FbtProductDeletedHandler } from '../../../../src/modules/fbt/webhooks/product-deleted.handler';
import { FbtProductUpdatedHandler } from '../../../../src/modules/fbt/webhooks/product-updated.handler';
import { FBT_TOPICS } from '../../../../src/modules/fbt/webhooks/topics';

function fakeTrx() {
  const deletes: Array<{ table: string; wheres: Array<[string, string, unknown]> }> = [];
  const trx = {
    deleteFrom(table: string) {
      const record = { table, wheres: [] as Array<[string, string, unknown]> };
      deletes.push(record);
      const builder = {
        where(col: string, op: string, val: unknown) {
          record.wheres.push([col, op, val]);
          return builder;
        },
        async execute() {
          return [];
        },
      };
      return builder;
    },
    // biome-ignore lint/suspicious/noExplicitAny: test double
  } as any;
  return { trx, deletes };
}

describe('extractProductId', () => {
  it('reads a top-level product_id', () => {
    expect(extractProductId({ product_id: 'p1' })).toBe('p1');
  });

  it('reads a top-level id', () => {
    expect(extractProductId({ id: 'p2' })).toBe('p2');
  });

  it('reads a nested product.id', () => {
    expect(extractProductId({ product: { id: 'p3' } })).toBe('p3');
  });

  it('coerces a numeric id to string', () => {
    expect(extractProductId({ id: 42 })).toBe('42');
  });

  it('returns null when no id is present', () => {
    expect(extractProductId({ unrelated: true })).toBeNull();
  });

  it('returns null for an empty-string id rather than an empty key', () => {
    expect(extractProductId({ id: '' })).toBeNull();
  });
});

describe('invalidateProduct', () => {
  it('deletes the embedding row for that merchant and product', async () => {
    const { trx, deletes } = fakeTrx();
    await invalidateProduct(trx, 'merch-1', 'p1');

    const embeddings = deletes.find((d) => d.table === 'product_embeddings');
    expect(embeddings).toBeDefined();
    expect(embeddings?.wheres).toEqual([
      ['merchantId', '=', 'merch-1'],
      ['productId', '=', 'p1'],
    ]);
  });

  it('deletes the similarity cache entry sourced from that product', async () => {
    const { trx, deletes } = fakeTrx();
    await invalidateProduct(trx, 'merch-1', 'p1');

    const cache = deletes.find((d) => d.table === 'product_similarity_cache');
    expect(cache).toBeDefined();
    expect(cache?.wheres).toEqual([
      ['merchantId', '=', 'merch-1'],
      ['sourceProductId', '=', 'p1'],
    ]);
  });

  it('scopes every delete by merchantId so one merchant cannot purge another', async () => {
    const { trx, deletes } = fakeTrx();
    await invalidateProduct(trx, 'merch-1', 'p1');

    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      expect(d.wheres.some(([col, , val]) => col === 'merchantId' && val === 'merch-1')).toBe(true);
    }
  });
});

describe('product invalidation handlers', () => {
  const cases = [
    ['created', new FbtProductCreatedHandler(), FBT_TOPICS.PRODUCT_CREATED],
    ['updated', new FbtProductUpdatedHandler(), FBT_TOPICS.PRODUCT_UPDATED],
    ['deleted', new FbtProductDeletedHandler(), FBT_TOPICS.PRODUCT_DELETED],
  ] as const;

  it.each(cases)('%s subscribes to its own distinct topic', (_label, handler, topic) => {
    expect(handler.topic).toBe(topic);
  });

  it('the three topics are all different', () => {
    const topics = cases.map(([, handler]) => handler.topic);
    expect(new Set(topics).size).toBe(3);
  });

  it.each(cases)('%s invalidates both caches', async (_label, handler) => {
    const { trx, deletes } = fakeTrx();
    await handler.handle({ id: 'p1' }, 'merch-1', trx);

    expect(deletes.map((d) => d.table).sort()).toEqual([
      'product_embeddings',
      'product_similarity_cache',
    ]);
  });

  it.each(cases)('%s is a no-op without a merchantId', async (_label, handler) => {
    const { trx, deletes } = fakeTrx();
    await handler.handle({ id: 'p1' }, null, trx);

    expect(deletes).toHaveLength(0);
  });

  it.each(cases)('%s is a no-op when the payload has no product id', async (_label, handler) => {
    const { trx, deletes } = fakeTrx();
    await handler.handle({ nope: true }, 'merch-1', trx);

    expect(deletes).toHaveLength(0);
  });
});
