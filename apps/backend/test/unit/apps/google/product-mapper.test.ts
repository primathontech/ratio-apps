import { describe, expect, it } from 'vitest';
import {
  mapProduct,
  stripHtml,
  truncate,
  type MapperConfig,
  type RatioProduct,
} from '../../../../src/modules/google/gmc/product-mapper';

const config: MapperConfig = {
  storeDomain: 'shop.example.com',
  storePrefix: 'acme',
  targetCountry: 'IN',
  contentLanguage: 'en',
  currency: 'INR',
  defaultCondition: 'new',
};

function baseProduct(overrides: Partial<RatioProduct> = {}): RatioProduct {
  return {
    id: 'p1',
    title: 'Cool Shirt',
    description: 'A very cool shirt',
    handle: 'cool-shirt',
    vendor: 'AcmeWear',
    productType: 'Apparel',
    images: [{ src: 'https://img/1.jpg' }, { src: 'https://img/2.jpg' }],
    variants: [
      {
        id: 'v1',
        price: '999',
        barcode: '00012345678905',
        sku: 'SKU-1',
        inventoryQuantity: 5,
        options: { Color: 'Red', Size: 'M' },
      },
    ],
    ...overrides,
  };
}

describe('mapProduct — required attributes', () => {
  it('maps all required attributes for a normal variant', () => {
    const [offer] = mapProduct(baseProduct(), config);
    expect(offer.status).toBe('SYNCED');
    expect(offer.issue).toBeNull();
    expect(offer.gmc).not.toBeNull();
    const gmc = offer.gmc!;
    expect(offer.offerId).toBe('acme:v1');
    expect(gmc.id).toBe('acme:v1');
    expect(gmc.title).toBe('Cool Shirt');
    expect(gmc.link).toBe('https://shop.example.com/products/cool-shirt');
    expect(gmc.imageLink).toBe('https://img/1.jpg');
    expect(gmc.price).toBe('999.00 INR');
    expect(gmc.availability).toBe('in_stock');
    expect(gmc.condition).toBe('new');
    expect(gmc.brand).toBe('AcmeWear');
    expect(gmc.channel).toBe('online');
    expect(gmc.contentLanguage).toBe('en');
    expect(gmc.targetCountry).toBe('IN');
    expect(gmc.identifierExists).toBe(true);
    expect(gmc.itemGroupId).toBe('acme:p1');
    expect(gmc.productType).toBe('Apparel');
    expect(gmc.additionalImageLinks).toEqual(['https://img/2.jpg']);
  });

  it('uses brandOverride when provided', () => {
    const [offer] = mapProduct(baseProduct(), {
      ...config,
      brandOverride: 'OverrideBrand',
    });
    expect(offer.gmc!.brand).toBe('OverrideBrand');
  });
});

describe('mapProduct — pricing', () => {
  it('sets maximumRetailPrice when compareAtPrice present', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          compareAtPrice: '1299',
          barcode: '00012345678905',
          inventoryQuantity: 3,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.gmc!.maximumRetailPrice).toBe('1299.00 INR');
  });

  it('sets salePrice when on sale (compareAtPrice > price)', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          compareAtPrice: '1299',
          barcode: '00012345678905',
          inventoryQuantity: 3,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.gmc!.price).toBe('999.00 INR');
    expect(offer.gmc!.salePrice).toBe('999.00 INR');
    expect(offer.gmc!.maximumRetailPrice).toBe('1299.00 INR');
  });

  it('does not set salePrice when compareAtPrice <= price', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          compareAtPrice: '999',
          barcode: '00012345678905',
          inventoryQuantity: 3,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.gmc!.salePrice).toBeUndefined();
    expect(offer.gmc!.maximumRetailPrice).toBe('999.00 INR');
  });
});

describe('mapProduct — multi-variant', () => {
  it('produces 3 offers sharing the same itemGroupId with mapped options', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          barcode: '00012345678905',
          inventoryQuantity: 1,
          options: { Color: 'Red', Size: 'M' },
        },
        {
          id: 'v2',
          price: '1099',
          barcode: '00012345678905',
          inventoryQuantity: 1,
          options: { Color: 'Blue', Size: 'M' },
        },
        {
          id: 'v3',
          price: '1199',
          barcode: '00012345678905',
          inventoryQuantity: 1,
          options: { Color: 'Red', Size: 'L' },
        },
      ],
    });
    const offers = mapProduct(product, config);
    expect(offers).toHaveLength(3);

    const groupIds = offers.map((o) => o.gmc!.itemGroupId);
    expect(new Set(groupIds)).toEqual(new Set(['acme:p1']));

    expect(offers.map((o) => o.offerId)).toEqual([
      'acme:v1',
      'acme:v2',
      'acme:v3',
    ]);
    expect(offers.map((o) => o.gmc!.price)).toEqual([
      '999.00 INR',
      '1099.00 INR',
      '1199.00 INR',
    ]);
    expect(offers.map((o) => [o.gmc!.color, o.gmc!.size])).toEqual([
      ['Red', 'M'],
      ['Blue', 'M'],
      ['Red', 'L'],
    ]);
  });
});

describe('mapProduct — ERROR conditions', () => {
  it('marks ERROR with null gmc when no image', () => {
    const product = baseProduct({ images: [] });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('ERROR');
    expect(offer.gmc).toBeNull();
    expect(offer.issue).toBe('missing image');
  });

  it('marks ERROR when images undefined', () => {
    const product = baseProduct({ images: undefined });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('ERROR');
    expect(offer.issue).toBe('missing image');
  });

  it('marks ERROR when price missing (null)', () => {
    const product = baseProduct({
      variants: [{ id: 'v1', price: null, inventoryQuantity: 1 }],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('ERROR');
    expect(offer.gmc).toBeNull();
    expect(offer.issue).toBe('missing price');
  });

  it('marks ERROR when price is NaN-ish string', () => {
    const product = baseProduct({
      variants: [{ id: 'v1', price: 'abc', inventoryQuantity: 1 }],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('ERROR');
    expect(offer.issue).toBe('missing price');
  });

  it('ERROR (missing image) takes precedence over WARNING (missing description)', () => {
    const product = baseProduct({ images: [], description: '' });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('ERROR');
    expect(offer.issue).toBe('missing image');
  });
});

describe('mapProduct — WARNING conditions', () => {
  it('falls back to title when description missing and marks WARNING', () => {
    const product = baseProduct({ description: '' });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('WARNING');
    expect(offer.issue).toBe('missing description, used title');
    expect(offer.gmc!.description).toBe('Cool Shirt');
  });

  it('marks WARNING with mpn=sku when barcode missing; gtin unset; identifierExists true', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          barcode: null,
          sku: 'SKU-1',
          inventoryQuantity: 1,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('WARNING');
    expect(offer.issue).toBe('missing GTIN, using SKU as MPN');
    expect(offer.hasGtin).toBe(false);
    expect(offer.gmc!.gtin).toBeUndefined();
    expect(offer.gmc!.mpn).toBe('SKU-1');
    expect(offer.gmc!.identifierExists).toBe(true);
  });

  it('identifierExists false when neither GTIN nor SKU present', () => {
    const product = baseProduct({
      variants: [
        { id: 'v1', price: '999', barcode: null, inventoryQuantity: 1 },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.gmc!.identifierExists).toBe(false);
    expect(offer.gmc!.mpn).toBeUndefined();
  });
});

describe('mapProduct — GTIN handling', () => {
  it('sets gtin and hasGtin for a valid 14-digit barcode', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          barcode: '00012345678905',
          inventoryQuantity: 1,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.status).toBe('SYNCED');
    expect(offer.hasGtin).toBe(true);
    expect(offer.gmc!.gtin).toBe('00012345678905');
    expect(offer.gmc!.identifierExists).toBe(true);
  });

  it('accepts a valid 12-digit barcode', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          barcode: '012345678905',
          inventoryQuantity: 1,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.hasGtin).toBe(true);
    expect(offer.gmc!.gtin).toBe('012345678905');
  });

  it('rejects an invalid-length barcode (treats as missing GTIN)', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          barcode: '12345',
          sku: 'SKU-X',
          inventoryQuantity: 1,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.hasGtin).toBe(false);
    expect(offer.gmc!.gtin).toBeUndefined();
    expect(offer.gmc!.mpn).toBe('SKU-X');
    expect(offer.status).toBe('WARNING');
  });
});

describe('mapProduct — availability', () => {
  it('out_of_stock when inventoryQuantity is 0 or missing', () => {
    const product = baseProduct({
      variants: [
        {
          id: 'v1',
          price: '999',
          barcode: '00012345678905',
          inventoryQuantity: 0,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.gmc!.availability).toBe('out_of_stock');
  });
});

describe('mapProduct — description and title formatting', () => {
  it('strips HTML from description', () => {
    const product = baseProduct({
      description: '<p>Hello <b>world</b></p>\n  extra',
    });
    const [offer] = mapProduct(product, config);
    expect(offer.gmc!.description).toBe('Hello world extra');
  });

  it('truncates title longer than 150 chars with an ellipsis', () => {
    const longTitle = 'X'.repeat(200);
    const product = baseProduct({ title: longTitle });
    const [offer] = mapProduct(product, config);
    expect(offer.title.length).toBe(150);
    expect(offer.title.endsWith('…')).toBe(true);
    expect(offer.gmc!.title.length).toBe(150);
  });
});

describe('mapProduct — deterministic offerId', () => {
  it('offerId equals storePrefix:variantId', () => {
    const product = baseProduct({
      id: 'prod-42',
      variants: [
        {
          id: 'var-99',
          price: '50',
          barcode: '00012345678905',
          inventoryQuantity: 1,
        },
      ],
    });
    const [offer] = mapProduct(product, config);
    expect(offer.offerId).toBe('acme:var-99');
    expect(offer.gmc!.itemGroupId).toBe('acme:prod-42');
  });
});

describe('stripHtml', () => {
  it('removes tags, collapses whitespace, trims', () => {
    expect(stripHtml('  <div>a   b</div>  ')).toBe('a b');
  });
});

describe('truncate', () => {
  it('returns input unchanged when within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis when over limit', () => {
    expect(truncate('hello', 3)).toBe('he…');
    expect(truncate('hello', 3).length).toBe(3);
  });
});
