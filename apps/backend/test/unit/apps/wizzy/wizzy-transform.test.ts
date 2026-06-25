import { describe, expect, it } from 'vitest';
import {
  type RatioProduct,
  stripHtml,
  transformProduct,
  type WizzyTransformConfig,
} from '../../../../src/modules/wizzy/catalog/wizzy-transform';

const baseConfig: WizzyTransformConfig = {
  stripHtmlDescription: true,
  includeOutOfStock: true,
};

function baseProduct(overrides: Partial<RatioProduct> = {}): RatioProduct {
  return {
    id: 'prod-1',
    title: 'Cool Shirt',
    description: 'A very cool shirt',
    handle: 'cool-shirt',
    vendor: 'AcmeWear',
    productType: 'Apparel',
    images: [{ src: 'https://img.example.com/1.jpg' }, { src: 'https://img.example.com/2.jpg' }],
    variants: [
      {
        id: 'var-1',
        price: '999',
        compareAtPrice: '1299',
        sku: 'SKU-1',
        inventoryQuantity: 5,
      },
    ],
    ...overrides,
  };
}

describe('transformProduct — required fields', () => {
  it('produces id, name, mainImage, categories, sellingPrice', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;
    expect(p.id).toBe('prod-1');
    expect(p.name).toBe('Cool Shirt');
    expect(p.mainImage).toBe('https://img.example.com/1.jpg');
    expect(p.categories).toHaveLength(1);
    expect(p.categories[0].id).toBe('apparel');
    expect(p.categories[0].name).toBe('Apparel');
    expect(p.categories[0].parentId).toBe('');
    expect(p.categories[0].pathIds).toEqual(['apparel']);
    expect(p.sellingPrice).toBe(999);
  });

  it('sets MRP (price) when compareAtPrice differs from sellingPrice', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // price in Wizzy terms is the MRP / compare-at price
    expect(result.payload.price).toBe(1299);
  });

  it('does NOT set price when compareAtPrice equals sellingPrice', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '999', compareAtPrice: '999', inventoryQuantity: 5 }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.price).toBeUndefined();
  });

  it('maps brand from vendor', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.brand).toBe('AcmeWear');
  });

  it('collects SKUs from active variants', () => {
    const result = transformProduct(
      baseProduct({
        variants: [
          { id: 'v1', price: '500', sku: 'SKU-A', inventoryQuantity: 3 },
          { id: 'v2', price: '600', sku: 'SKU-B', inventoryQuantity: 0 },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.sku).toEqual(['SKU-A', 'SKU-B']);
  });

  it('sets inStock true when any variant has positive inventoryQuantity', () => {
    const result = transformProduct(
      baseProduct({
        variants: [
          { id: 'v1', price: '500', inventoryQuantity: 0 },
          { id: 'v2', price: '600', inventoryQuantity: 1 },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.inStock).toBe(true);
  });

  it('sets stockQty as sum across all variants', () => {
    const result = transformProduct(
      baseProduct({
        variants: [
          { id: 'v1', price: '500', inventoryQuantity: 3 },
          { id: 'v2', price: '600', inventoryQuantity: 7 },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.stockQty).toBe(10);
  });

  it('omits url (Wizzy rejects a relative path; absolute storefront URL not configured)', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.url).toBeUndefined();
  });

  it('puts additional images (after the first) in the images field', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // images contains all srcs EXCEPT the first (which is mainImage)
    expect(result.payload.images).toEqual(['https://img.example.com/2.jpg']);
  });

  it('omits images field when there is only one image', () => {
    const result = transformProduct(
      baseProduct({ images: [{ src: 'https://img.example.com/1.jpg' }] }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.images).toBeUndefined();
  });
});

describe('transformProduct — prices are already in rupees', () => {
  it('does NOT divide price by 100 (prices already in rupees)', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '299', inventoryQuantity: 5 }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // If we were wrongly dividing: 299/100 = 2.99. Correct value is 299.
    expect(result.payload.sellingPrice).toBe(299);
  });
});

describe('transformProduct — selling price required (Wizzy rejects 0)', () => {
  it('falls back to compareAtPrice as sellingPrice when price is 0 (real price in compare-at)', () => {
    // Mirrors the live "Habit Tracker": price 0, compare_at_price 199.
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '0', compareAtPrice: '199', inventoryQuantity: 0 }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.sellingPrice).toBe(199);
    // No separate MRP — it became the selling price.
    expect(result.payload.price).toBeUndefined();
  });

  it('skips a product with no usable price (price 0 and no compare-at)', () => {
    const result = transformProduct(
      baseProduct({ variants: [{ id: 'v1', price: '0', inventoryQuantity: 5 }] }),
      baseConfig,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('missing or zero selling price');
  });
});

describe('transformProduct — price fields (sellingPrice/price/discount/finalPrice)', () => {
  it('sets discount + discountPercentage + finalPrice when on sale', () => {
    // price 999 (selling), compare_at 1299 (MRP) → 300 off, ~23.1%.
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;
    expect(p.sellingPrice).toBe(999);
    expect(p.price).toBe(1299);
    expect(p.discount).toBe(300);
    expect(p.discountPercentage).toBe(23.09);
    expect(p.finalPrice).toBe(999);
  });

  it('omits discount fields when not on sale (no compare-at)', () => {
    const result = transformProduct(
      baseProduct({ variants: [{ id: 'v1', price: '500', inventoryQuantity: 5 }] }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.price).toBeUndefined();
    expect(result.payload.discount).toBeUndefined();
    expect(result.payload.discountPercentage).toBeUndefined();
    expect(result.payload.finalPrice).toBe(500);
  });

  it('ignores a compare-at price that is not above the selling price', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '999', compareAtPrice: '500', inventoryQuantity: 5 }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.price).toBeUndefined();
    expect(result.payload.discount).toBeUndefined();
  });
});

describe('transformProduct — variant facets (colors / sizes / attributes)', () => {
  const multiVariant = (): RatioProduct =>
    baseProduct({
      variants: [
        {
          id: 'v-red-s',
          price: '999',
          inventoryQuantity: 2,
          options: { Color: 'Red', Size: 'S', Material: 'Cotton' },
        },
        {
          id: 'v-red-m',
          price: '999',
          inventoryQuantity: 0,
          availableForSale: false,
          options: { Color: 'Red', Size: 'M', Material: 'Cotton' },
        },
        {
          id: 'v-blue-s',
          price: '999',
          inventoryQuantity: 5,
          options: { Color: 'Blue', Size: 'S', Material: 'Linen' },
        },
      ],
    });

  it('maps Color options into deduped colors[]', () => {
    const result = transformProduct(multiVariant(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const colors = result.payload.colors ?? [];
    expect(colors.map((c) => c.value).sort()).toEqual(['Blue', 'Red']);
    // Red appears on an available (S) and unavailable (M) variant → in stock.
    expect(colors.find((c) => c.value === 'Red')?.inStock).toBe(true);
  });

  it('maps Size options into deduped sizes[]', () => {
    const result = transformProduct(multiVariant(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.payload.sizes ?? []).map((s) => s.value).sort()).toEqual(['M', 'S']);
  });

  it('maps non-color/size options into attributes[] with searchable+filterable flags', () => {
    const result = transformProduct(multiVariant(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attrs = result.payload.attributes ?? [];
    const material = attrs.find((a) => a.name === 'Material');
    expect(material).toBeDefined();
    expect(material?.id).toBe('material');
    expect(material?.type).toBe('string');
    expect(material?.isSearchable).toBe(true);
    expect(material?.isFilterable).toBe(true);
    expect(material?.addInAutocomplete).toBe(false);
    expect(material?.values.map((v) => v.value[0]).sort()).toEqual(['Cotton', 'Linen']);
  });

  it('omits colors/sizes/attributes for a single "Default Title" variant', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '999', inventoryQuantity: 5 }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.colors).toBeUndefined();
    expect(result.payload.sizes).toBeUndefined();
    expect(result.payload.attributes).toBeUndefined();
  });
});

describe('transformProduct — tags attribute', () => {
  it('maps product tags into a filterable "Tags" attribute', () => {
    const result = transformProduct(
      baseProduct({ tags: ['Bestseller', 'Combo', 'New Arrival'] }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = (result.payload.attributes ?? []).find((a) => a.id === 'tags');
    expect(tags).toBeDefined();
    expect(tags?.name).toBe('Tags');
    expect(tags?.type).toBe('string');
    expect(tags?.isSearchable).toBe(true);
    expect(tags?.isFilterable).toBe(true);
    expect(tags?.addInAutocomplete).toBe(false);
    expect(tags?.values.map((v) => v.value[0])).toEqual(['Bestseller', 'Combo', 'New Arrival']);
  });

  it('dedupes tags case/space-insensitively, keeping the first-seen label', () => {
    const result = transformProduct(
      baseProduct({ tags: ['Bestseller', 'electrolyte', 'Best Seller', 'BESTSELLER'] }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = (result.payload.attributes ?? []).find((a) => a.id === 'tags');
    expect(tags?.values.map((v) => v.value[0])).toEqual(['Bestseller', 'electrolyte']);
  });

  it('coexists with variant attributes (both present)', () => {
    const result = transformProduct(
      baseProduct({
        tags: ['Combo'],
        variants: [
          { id: 'v1', price: '999', inventoryQuantity: 1, options: { Material: 'Cotton' } },
          { id: 'v2', price: '999', inventoryQuantity: 1, options: { Material: 'Linen' } },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = (result.payload.attributes ?? []).map((a) => a.id).sort();
    expect(ids).toEqual(['material', 'tags']);
  });

  it('omits the Tags attribute when there are no tags', () => {
    const result = transformProduct(baseProduct({ tags: [] }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.payload.attributes ?? []).find((a) => a.id === 'tags')).toBeUndefined();
  });
});

describe('transformProduct — childData (per-variation price arrays)', () => {
  it('populates childData arrays for multi-variant products', () => {
    const result = transformProduct(
      baseProduct({
        variants: [
          { id: 'v1', price: '999', compareAtPrice: '1299', inventoryQuantity: 1 },
          { id: 'v2', price: '500', inventoryQuantity: 1 },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cd = result.payload.childData;
    expect(cd).toBeDefined();
    expect(cd?.sellingPrices).toEqual([999, 500]);
    expect(cd?.prices).toEqual([1299, 500]);
    expect(cd?.discounts).toEqual([300, 0]);
    expect(cd?.finalPrices).toEqual([999, 500]);
  });

  it('omits childData for single-variant products', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.childData).toBeUndefined();
  });
});

describe('transformProduct — product url from configured store domain', () => {
  it('builds an absolute url from storeDomain + handle', () => {
    const result = transformProduct(baseProduct({ handle: 'cool-shirt' }), {
      ...baseConfig,
      storeDomain: 'https://shop.example.com/',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.url).toBe('https://shop.example.com/products/cool-shirt');
  });

  it('accepts a bare host and strips trailing slash/path', () => {
    const result = transformProduct(baseProduct({ handle: 'cool-shirt' }), {
      ...baseConfig,
      storeDomain: 'shop.example.com',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.url).toBe('https://shop.example.com/products/cool-shirt');
  });

  it('omits url when no store domain is configured', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.url).toBeUndefined();
  });
});

describe('transformProduct — category discovery flags', () => {
  it('marks the category searchable + included in menu', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cat = result.payload.categories[0];
    expect(cat.isSearchable).toBe(true);
    expect(cat.includeInMenu).toBe(true);
  });
});

describe('transformProduct — categories synthesized', () => {
  it('synthesizes category from productType', () => {
    const result = transformProduct(baseProduct({ productType: 'T-Shirts & Tops' }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cat = result.payload.categories[0];
    expect(cat.id).toBe('t-shirts-tops');
    expect(cat.name).toBe('T-Shirts & Tops');
    expect(cat.pathIds).toEqual(['t-shirts-tops']);
    expect(cat.parentId).toBe('');
  });

  it('falls back to Uncategorized when productType is empty', () => {
    const result = transformProduct(baseProduct({ productType: '' }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cat = result.payload.categories[0];
    expect(cat.id).toBe('uncategorized');
    expect(cat.name).toBe('Uncategorized');
  });

  it('falls back to Uncategorized when productType is null', () => {
    const result = transformProduct(baseProduct({ productType: null }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cat = result.payload.categories[0];
    expect(cat.name).toBe('Uncategorized');
  });
});

describe('transformProduct — missing image → ERROR', () => {
  it('returns ok:false with issue "missing image" when product has no images', () => {
    const result = transformProduct(baseProduct({ images: [] }), baseConfig);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('missing image');
  });

  it('returns ok:false when images is undefined', () => {
    const result = transformProduct(baseProduct({ images: undefined }), baseConfig);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('missing image');
  });
});

describe('transformProduct — availability (availableForSale wins over quantity)', () => {
  it('marks inStock TRUE when availableForSale is true even if inventoryQuantity is 0 (untracked inventory)', () => {
    // Mirrors the live OSMO combo: inventory_management null, inventory_quantity 0,
    // availableForSale true. Quantity alone would wrongly mark it out of stock and
    // Wizzy would hide it from search + the dashboard count.
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '1559', inventoryQuantity: 0, availableForSale: true }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.inStock).toBe(true);
  });

  it('marks inStock FALSE when availableForSale is false even if inventoryQuantity is positive', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '1559', inventoryQuantity: 5, availableForSale: false }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.inStock).toBe(false);
  });

  it('falls back to inventoryQuantity > 0 for inStock when availableForSale is absent', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '1559', inventoryQuantity: 3 }],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.inStock).toBe(true);
  });

  it('marks inStock true if ANY variant is availableForSale', () => {
    const result = transformProduct(
      baseProduct({
        variants: [
          { id: 'v1', price: '1559', inventoryQuantity: 0, availableForSale: false },
          { id: 'v2', price: '1559', inventoryQuantity: 0, availableForSale: true },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.inStock).toBe(true);
  });
});

describe('transformProduct — out of stock handling', () => {
  it('skips product when all variants out of stock and includeOutOfStock=false', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '299', inventoryQuantity: 0 }],
      }),
      { ...baseConfig, includeOutOfStock: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('out of stock');
  });

  it('includes product when out of stock and includeOutOfStock=true', () => {
    const result = transformProduct(
      baseProduct({
        variants: [{ id: 'v1', price: '299', inventoryQuantity: 0 }],
      }),
      { ...baseConfig, includeOutOfStock: true },
    );
    expect(result.ok).toBe(true);
  });
});

describe('transformProduct — description handling', () => {
  it('strips HTML when stripHtmlDescription=true', () => {
    const result = transformProduct(
      baseProduct({ description: '<p>A <strong>cool</strong> shirt</p>' }),
      { ...baseConfig, stripHtmlDescription: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.description).toBe('A cool shirt');
  });

  it('preserves HTML when stripHtmlDescription=false', () => {
    const result = transformProduct(baseProduct({ description: '<p>Cool</p>' }), {
      ...baseConfig,
      stripHtmlDescription: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.description).toBe('<p>Cool</p>');
  });

  it('omits description when product has no description', () => {
    const result = transformProduct(baseProduct({ description: null }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.description).toBeUndefined();
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>  Hello  </p>  <p>  World  </p>')).toBe('Hello World');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});
