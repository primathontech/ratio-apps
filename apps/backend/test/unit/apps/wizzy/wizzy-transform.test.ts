import { describe, expect, it } from 'vitest';
import {
  parseMetafields,
  parseRestProduct,
} from '../../../../src/modules/wizzy/catalog/parse-ratio-product';
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
    expect(tags?.values).toHaveLength(1);
    expect(tags?.values[0]?.value).toEqual(['Bestseller', 'Combo', 'New Arrival']);
  });

  it('dedupes tags case/space-insensitively, keeping the first-seen label', () => {
    const result = transformProduct(
      baseProduct({ tags: ['Bestseller', 'electrolyte', 'Best Seller', 'BESTSELLER'] }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = (result.payload.attributes ?? []).find((a) => a.id === 'tags');
    expect(tags?.values[0]?.value).toEqual(['Bestseller', 'electrolyte']);
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

describe('transformProduct — createdAt (Newest sort)', () => {
  it('formats createdAt as Wizzy yyyy-mm-dd hh:mm:ss (not ISO 8601)', () => {
    const result = transformProduct(
      baseProduct({ createdAt: '2026-06-10T07:36:54.170Z' }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.createdAt).toBe('2026-06-10 07:36:54');
  });

  it('omits createdAt when absent or null', () => {
    const result = transformProduct(baseProduct({ createdAt: null }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.createdAt).toBeUndefined();
  });

  it('omits createdAt when the value is unparseable', () => {
    const result = transformProduct(baseProduct({ createdAt: 'not-a-date' }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.createdAt).toBeUndefined();
  });

  it('formats updatedAt as Wizzy yyyy-mm-dd hh:mm:ss when present', () => {
    const result = transformProduct(
      baseProduct({ updatedAt: '2026-06-29T19:29:15.000Z' }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.updatedAt).toBe('2026-06-29 19:29:15');
  });
});

describe('transformProduct — hoverImage (2nd image)', () => {
  it('sets hoverImage to the second image when present', () => {
    const result = transformProduct(baseProduct(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.hoverImage).toBe('https://img.example.com/2.jpg');
  });

  it('omits hoverImage for a single-image product', () => {
    const result = transformProduct(
      baseProduct({ images: [{ src: 'https://img.example.com/only.jpg' }] }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.hoverImage).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Rich by-id product fixture — mirrors the real GET /products/:id response.
// ---------------------------------------------------------------------------

/** Fixture mirroring a real OSMO Electrolytes by-id response. */
function osmoFixture(): RatioProduct {
  return {
    id: 'P1',
    title: 'OSMO',
    handle: 'osmo',
    product_type: 'Electrolytes',
    productType: 'Electrolytes',
    vendor: 'Osmo',
    tags: ['electrolyte', 'New Arrival'],
    collections: [
      { id: 'c1', title: 'Best Sellers' },
      { id: 'c2', title: 'Supplements' },
      { id: 'c3', title: 'Essentials' },
      { id: 'c4', title: 'All Products' },
      { id: 'c5', title: 'TEST MF-X COLLECTION' },
    ],
    images: [{ src: 'https://x/i.jpg' }],
    variants: [{ id: 'v1', price: 58800, compareAtPrice: 69900, availableForSale: true }],
  } as unknown as RatioProduct;
}

describe('transformProduct — rich by-id collections → categories', () => {
  it('builds categories from product_type + non-skipped collections', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.payload.categories.map((c) => c.name);
    expect(names).toEqual(['Electrolytes', 'Best Sellers', 'Supplements', 'Essentials']);
  });

  it('drops "All Products" collection', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.categories.map((c) => c.name)).not.toContain('All Products');
  });

  it('drops collections whose title matches /^test /i', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.payload.categories.map((c) => c.name);
    expect(names.some((n) => /^test/i.test(n))).toBe(false);
  });

  it('root category has parentId="" and pathIds=[rootId]', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.payload.categories[0]!;
    expect(root.id).toBe('electrolytes');
    expect(root.name).toBe('Electrolytes');
    expect(root.parentId).toBe('');
    expect(root.pathIds).toEqual(['electrolytes']);
  });

  it('collection children have parentId=rootId and pathIds=[rootId, childId]', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bestSellers = result.payload.categories.find((c) => c.name === 'Best Sellers');
    expect(bestSellers).toBeDefined();
    expect(bestSellers?.parentId).toBe('electrolytes');
    expect(bestSellers?.pathIds).toEqual(['electrolytes', 'best-sellers']);
  });

  it('all categories have isSearchable=true and includeInMenu=true', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const cat of result.payload.categories) {
      expect(cat.isSearchable).toBe(true);
      expect(cat.includeInMenu).toBe(true);
    }
  });

  it('sets groupId equal to product id', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.groupId).toBe('P1');
  });

  it('existing fields unchanged: sellingPrice=58800, price=69900, brand=Osmo, inStock=true', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;
    expect(p.sellingPrice).toBe(58800);
    expect(p.price).toBe(69900);
    expect(p.brand).toBe('Osmo');
    expect(p.inStock).toBe(true);
  });

  it('tags facet attribute is present', () => {
    const result = transformProduct(osmoFixture(), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tagsAttr = (result.payload.attributes ?? []).find((a) => a.id === 'tags');
    expect(tagsAttr).toBeDefined();
  });
});

describe('transformProduct — groupId is always set to product id', () => {
  it('sets groupId on a plain product (no collections)', () => {
    const result = transformProduct(baseProduct({ id: 'prod-42' }), baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.groupId).toBe('prod-42');
  });
});

// ---------------------------------------------------------------------------
// Metafield enrichment tests
// ---------------------------------------------------------------------------

/** Real metafield shape (null value — current store reality). */
function nullMetafield(key: string) {
  return { namespace: 'custom', key, name: key, data_type: 'single_line_text_field', value: null };
}

describe('parseMetafields', () => {
  it('returns [] for a non-array (list endpoint omits metafields entirely)', () => {
    expect(parseMetafields(undefined)).toEqual([]);
    expect(parseMetafields(null)).toEqual([]);
    expect(parseMetafields('string')).toEqual([]);
  });

  it('skips entries where value is null, keeps entries with a value', () => {
    const input = [
      { namespace: 'custom', key: 'form_factor', name: 'Form Factor', value: null },
      { namespace: 'custom', key: 'flavour_name', name: 'Flavour', value: 'Mango' },
    ];
    const result = parseMetafields(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ namespace: 'custom', key: 'flavour_name', value: 'Mango' });
  });

  it('skips entries with no key', () => {
    const input = [{ namespace: 'custom', key: '', name: 'No Key', value: 'something' }];
    expect(parseMetafields(input)).toEqual([]);
  });
});

describe('parseRestProduct — createdAt date source', () => {
  it('prefers published_at, then created_at, then updated_at', () => {
    const withPublished = parseRestProduct({
      id: '1',
      title: 'P',
      published_at: '2026-01-01T00:00:00.000Z',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    expect(withPublished?.createdAt).toBe('2026-01-01T00:00:00.000Z');

    const noPublished = parseRestProduct({
      id: '2',
      title: 'P',
      published_at: null,
      created_at: '2025-06-29T12:31:17.733Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    expect(noPublished?.createdAt).toBe('2025-06-29T12:31:17.733Z');

    const onlyUpdated = parseRestProduct({
      id: '3',
      title: 'P',
      updated_at: '2024-03-03T00:00:00.000Z',
    });
    expect(onlyUpdated?.createdAt).toBe('2024-03-03T00:00:00.000Z');
  });

  it('is null when no date field is present', () => {
    const p = parseRestProduct({ id: '4', title: 'P' });
    expect(p?.createdAt).toBeNull();
  });
});

describe('transformProduct — metafield enrichment: all-null metafields', () => {
  it('produces no metafield attributes and no avgRatings/totalReviews when all values are null', () => {
    // Current store reality: metafields are all null.
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;
    expect(p.avgRatings).toBeUndefined();
    expect(p.totalReviews).toBeUndefined();
    // No metafield-derived attributes (no tags on this product, so attributes should be absent).
    expect(p.attributes).toBeUndefined();
  });
});

describe('transformProduct — metafield enrichment: populated custom/form_factor', () => {
  it('emits a "Form Factor" attribute with isSearchable+isFilterable true', () => {
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [
        { namespace: 'custom', key: 'form_factor', name: 'Form Factor', value: 'Sachets' },
      ],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attrs = result.payload.attributes ?? [];
    const ff = attrs.find((a) => a.name === 'Form Factor');
    expect(ff).toBeDefined();
    expect(ff?.id).toBe('form-factor');
    expect(ff?.type).toBe('string');
    expect(ff?.isSearchable).toBe(true);
    expect(ff?.isFilterable).toBe(true);
    expect(ff?.addInAutocomplete).toBe(false);
    expect(ff?.values.map((v) => v.value[0])).toContain('Sachets');
  });
});

describe('transformProduct — metafield enrichment: reviews/rating and reviews/rating_count', () => {
  it('sets avgRatings and totalReviews from plain number values', () => {
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [
        { namespace: 'reviews', key: 'rating', name: 'Rating', value: 4.6 },
        { namespace: 'reviews', key: 'rating_count', name: 'Rating Count', value: 120 },
      ],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.avgRatings).toBe(92); // 4.6 (0–5) → 92 (0–100)
    expect(result.payload.totalReviews).toBe(120);
  });

  it('sets avgRatings and totalReviews from object { value } shapes', () => {
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [
        { namespace: 'reviews', key: 'rating', name: 'Rating', value: { value: 4.6, scale_min: 0, scale_max: 5 } },
        { namespace: 'reviews', key: 'rating_count', name: 'Rating Count', value: { value: 120 } },
      ],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.avgRatings).toBe(92); // 4.6 (0–5) → 92 (0–100)
    expect(result.payload.totalReviews).toBe(120);
  });

  it('does not emit rating keys as facet attributes', () => {
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [
        { namespace: 'reviews', key: 'rating', name: 'Rating', value: 4.6 },
      ],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attrs = result.payload.attributes ?? [];
    expect(attrs.find((a) => a.name === 'Rating')).toBeUndefined();
  });
});

describe('transformProduct — metafield enrichment: reference ID is dropped', () => {
  it('does NOT emit "Dietary Preferences" when value is a gid reference', () => {
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [
        {
          namespace: 'shopify',
          key: 'dietary-preferences',
          name: 'Dietary Preferences',
          value: 'gid://shopify/Metaobject/123',
        },
      ],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attrs = result.payload.attributes ?? [];
    expect(attrs.find((a) => a.name === 'Dietary Preferences')).toBeUndefined();
  });
});

describe('transformProduct — metafield enrichment: flavour merge deduplication', () => {
  it('merges custom/flavour_name and shopify/flavor into a single "Flavour" attribute with deduplicated values', () => {
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [
        { namespace: 'custom', key: 'flavour_name', name: 'Flavour Name', value: 'Mango' },
        { namespace: 'shopify', key: 'flavor', name: 'Flavor', value: 'Mango' },
      ],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attrs = result.payload.attributes ?? [];
    const flavour = attrs.filter((a) => a.name === 'Flavour');
    // Only one "Flavour" attribute.
    expect(flavour).toHaveLength(1);
    // Only one "Mango" value (deduped).
    const mangoValues = flavour[0]?.values.filter((v) => v.value[0] === 'Mango') ?? [];
    expect(mangoValues).toHaveLength(1);
  });
});

describe('transformProduct — metafield enrichment: non-allowlisted key ignored', () => {
  it('does NOT emit an attribute for custom/faqs', () => {
    const product: RatioProduct = {
      ...baseProduct(),
      metafields: [
        { namespace: 'custom', key: 'faqs', name: 'FAQs', value: 'What is this?' },
      ],
    };
    const result = transformProduct(product, baseConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attrs = result.payload.attributes ?? [];
    expect(attrs.find((a) => a.name === 'FAQs')).toBeUndefined();
  });
});

describe('transformProduct — SKIP_COLLECTION edge cases', () => {
  it('skips a "Bestsellers SearchTap" collection (exact match, case variant)', () => {
    const result = transformProduct(
      baseProduct({
        collections: [
          { id: 'b1', title: 'Bestsellers SearchTap' },
          { id: 'b2', title: 'Bestsellers Searchtap' },
          { id: 'b3', title: 'Real Collection' },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.payload.categories.map((c) => c.name);
    expect(names).not.toContain('Bestsellers SearchTap');
    expect(names).not.toContain('Bestsellers Searchtap');
    expect(names).toContain('Real Collection');
  });

  it('skips any collection starting with "test" (case-insensitive)', () => {
    const result = transformProduct(
      baseProduct({
        collections: [
          { id: 't1', title: 'TEST internal' },
          { id: 't2', title: 'Test Beta' },
          { id: 't3', title: 'Visible' },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.payload.categories.map((c) => c.name);
    expect(names).not.toContain('TEST internal');
    expect(names).not.toContain('Test Beta');
    expect(names).toContain('Visible');
  });

  it('dedupes collections whose titles slugify to the same id as the root category', () => {
    const result = transformProduct(
      baseProduct({
        productType: 'Apparel',
        collections: [
          // "Apparel" slugifies to the same id as the root → should be skipped
          { id: 'dup', title: 'Apparel' },
          { id: 'ok', title: 'Unique Collection' },
        ],
      }),
      baseConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.payload.categories.map((c) => c.id);
    // Only one 'apparel' entry (the root) + the unique child.
    expect(ids.filter((id) => id === 'apparel')).toHaveLength(1);
    expect(ids).toContain('unique-collection');
  });
});
