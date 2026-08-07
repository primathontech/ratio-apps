import { describe, expect, it } from 'vitest';
import type { ClevertapCatalogItem } from '../../../../src/modules/clevertap/events/product-catalog.mapper';
import { buildCatalogCsv } from '../../../../src/modules/clevertap/events/product-catalog.mapper';

const HEADER = 'Name,ImageURL,Category,id,Price,Currency,SKU,Handle,Available';

describe('buildCatalogCsv', () => {
  it('emits the mandatory-first header row exactly', () => {
    const [header] = buildCatalogCsv([]).split('\n');
    expect(header).toBe(HEADER);
  });

  it('quotes and escapes a name containing a comma and a double-quote', () => {
    const item: ClevertapCatalogItem = { id: 'p1', name: 'Widget, "Pro"' };
    const [, row] = buildCatalogCsv([item]).split('\n');
    expect(row.startsWith('"Widget, ""Pro"""')).toBe(true);
  });

  it('skips an item with a missing name', () => {
    const items: ClevertapCatalogItem[] = [{ id: 'no-name' }, { id: 'p2', name: 'Keeps' }];
    const lines = buildCatalogCsv(items).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith('Keeps,')).toBe(true);
  });

  it('maps a normal item to the right ordered cells with rupee price intact', () => {
    const item: ClevertapCatalogItem = {
      id: 'p3',
      name: 'Shoe',
      imageUrl: 'https://cdn/x.png',
      category: 'Footwear',
      price: 1299.5,
      currency: 'INR',
      sku: 'SKU-1',
      handle: 'shoe',
      available: true,
    };
    const [, row] = buildCatalogCsv([item]).split('\n');
    expect(row).toBe('Shoe,https://cdn/x.png,Footwear,p3,1299.5,INR,SKU-1,shoe,true');
  });
});
