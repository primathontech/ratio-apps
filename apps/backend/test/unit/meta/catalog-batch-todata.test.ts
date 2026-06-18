import { describe, expect, it } from 'vitest';
import { CatalogBatchService } from '../../../src/modules/meta/catalog/catalog-batch.service';
import type { MetaProductDto } from '../../../src/modules/meta/catalog/catalog.types';

const base: MetaProductDto = {
  retailerId: 'r1',
  name: 'Product',
  description: 'Desc',
  url: 'https://x.com/p',
  imageUrl: 'https://x.com/i.png',
  additionalImageUrls: [],
  availability: 'in stock',
  price: 103900, // integer paise
  currency: 'INR',
  condition: 'new',
  brand: 'Brand',
  inventory: 5,
};

describe('CatalogBatchService.toData (real-Meta items_batch shape)', () => {
  const svc = new CatalogBatchService();

  it('formats price as "<amount> <currency>" string (paise/100)', () => {
    expect(svc.toData(base).price).toBe('1039.00 INR');
  });

  it('does NOT emit a separate currency field (Meta rejects it)', () => {
    expect(svc.toData(base).currency).toBeUndefined();
  });

  it('formats sale_price the same way when present', () => {
    const data = svc.toData({ ...base, salePrice: 89900 });
    expect(data.sale_price).toBe('899.00 INR');
  });
});
