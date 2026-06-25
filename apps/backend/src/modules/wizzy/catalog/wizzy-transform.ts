/**
 * Wizzy catalog product transformer.
 *
 * Pure functions that transform a Ratio product into a Wizzy catalog Product
 * object (one Product per Ratio product — Wizzy indexes at product level, with
 * all variation data embedded under colors/sizes/attributes/childData).
 *
 * REAL Wizzy API contract (from the OpenAPI spec at docs.api.wizzy.ai):
 *   POST /products/save  — body is a JSON array of Product objects
 *   Product required fields: id, name, mainImage, categories, sellingPrice
 *   Category required fields: id, name, parentId, pathIds
 *
 * Price semantics (Wizzy):
 *   sellingPrice = discounted price the shopper pays   (Ratio `price`)
 *   price        = MRP / list price before discount    (Ratio `compare_at_price`)
 *   discount / discountPercentage = derived from the two
 *   finalPrice   = final pre-tax price (= sellingPrice)
 *
 * Prices arrive as RUPEES (already converted in parse-ratio-product.ts).
 * DO NOT divide again here.
 */

/** A single Ratio product variant. */
export interface RatioVariant {
  id: string;
  price: string | number | null;
  compareAtPrice?: string | number | null;
  barcode?: string | null;
  sku?: string | null;
  inventoryQuantity?: number | null;
  /**
   * The platform's authoritative "can a shopper buy this?" flag. Many Ratio
   * products don't TRACK inventory (`inventory_management: null`), so their
   * `inventory_quantity` stays 0 while they remain purchasable — those carry
   * `availableForSale: true`. Prefer this over quantity when deciding stock.
   */
  availableForSale?: boolean | null;
  /** e.g. { Color: 'Red', Size: 'M' } */
  options?: Record<string, string>;
}

/** A Ratio product with one or more variants. */
export interface RatioProduct {
  id: string;
  title: string;
  description?: string | null;
  handle: string;
  vendor?: string | null;
  productType?: string | null;
  /** Product tags (e.g. ["Bestseller", "Combo"]) — surfaced as a filterable "Tags" attribute. */
  tags?: string[];
  images?: { src: string }[];
  variants: RatioVariant[];
}

/** Configuration controlling how products map into Wizzy payloads. */
export interface WizzyTransformConfig {
  stripHtmlDescription: boolean;
  includeOutOfStock: boolean;
  /**
   * The merchant's storefront domain or URL (e.g. `shop.example.com` or
   * `https://shop.example.com/`). Used to build the absolute product `url`
   * (`https://<host>/products/<handle>`). When absent, `url` is omitted.
   */
  storeDomain?: string | null;
}

/**
 * A Wizzy catalog Category object.
 * Required: id, name, parentId, pathIds. We also set the discovery flags
 * (`isSearchable`, `includeInMenu`) so categories surface in search + facets.
 */
export interface WizzyCategoryPayload {
  id: string;
  name: string;
  parentId: string;
  pathIds: string[];
  /** Make the category itself searchable. */
  isSearchable: boolean;
  /** Expose the category in facet/menu navigation. */
  includeInMenu: boolean;
}

/** A color/size swatch entry (one per distinct variation value). */
export interface WizzySwatchPayload {
  /** The color or size label, e.g. "Red" / "M". */
  value: string;
  /** The variation id this value maps to. */
  variationId: string;
  /** Whether (any variation with) this value is purchasable. */
  inStock: boolean;
}

/** A single value of a Wizzy product attribute. */
export interface WizzyAttributeValuePayload {
  /** Attribute value(s) for this variation (Wizzy models it as an array). */
  value: string[];
  variationId: string;
  inStock: boolean;
}

/** A Wizzy product attribute (a non-color/size variant option). */
export interface WizzyAttributePayload {
  id: string;
  name: string;
  type: 'string';
  values: WizzyAttributeValuePayload[];
  /** Searchable by this attribute's values. */
  isSearchable: boolean;
  /** Available as a facet/filter. */
  isFilterable: boolean;
  /** Whether to surface the attribute in autocomplete (off by default). */
  addInAutocomplete: boolean;
}

/** Per-variation price arrays — helps Wizzy match on child data. */
export interface WizzyChildDataPayload {
  sellingPrices: number[];
  prices: number[];
  discounts: number[];
  discountPercentages: number[];
  finalPrices: number[];
}

/**
 * A Wizzy catalog Product payload matching the real OpenAPI spec.
 *
 * Required: id, name, mainImage, categories, sellingPrice.
 */
export interface WizzyProductPayload {
  /** Ratio product id used as the stable Wizzy product id. */
  id: string;
  /** Product title / name. */
  name: string;
  /** Primary image URL (required — products without images are skipped). */
  mainImage: string;
  /** Product categories (required, non-empty). */
  categories: WizzyCategoryPayload[];
  /** Selling / sale price in rupees (required). */
  sellingPrice: number;
  /** MRP / list price in rupees (optional — sent when it exceeds sellingPrice). */
  price?: number;
  /** Discount amount in rupees (price − sellingPrice), when on sale. */
  discount?: number;
  /** Discount percentage, when on sale. */
  discountPercentage?: number;
  /** Final pre-tax price (= sellingPrice). */
  finalPrice?: number;
  /** Brand / vendor name (optional). */
  brand?: string;
  /** All variant SKUs, null-filtered (optional). */
  sku?: string[];
  /** Product description, optionally HTML-stripped (optional). */
  description?: string;
  /** Absolute storefront product URL (optional — needs a configured domain). */
  url?: string;
  /** Whether the product is in stock (any variant available). */
  inStock?: boolean;
  /** Total tracked inventory quantity across all variants (optional). */
  stockQty?: number;
  /** All image URLs after the first (optional). */
  images?: string[];
  /** Colors the product is available in (from a Color/Colour variant option). */
  colors?: WizzySwatchPayload[];
  /** Sizes the product is available in (from a Size variant option). */
  sizes?: WizzySwatchPayload[];
  /** Other variant options (Material, Flavour, …) as searchable attributes. */
  attributes?: WizzyAttributePayload[];
  /** Per-variation price arrays (only for multi-variant products). */
  childData?: WizzyChildDataPayload;
  /** Surface the product in search results. Omitted → Wizzy treats it as hidden. */
  isSearchable: boolean;
  /** Show the product in the catalog (dashboard "Products" count). Omitted → hidden. */
  isVisibleInCatalog: boolean;
}

/** The outcome of attempting to transform a single product. */
export type TransformResult =
  | { ok: true; payload: WizzyProductPayload }
  | { ok: false; issue: string };

/**
 * Strip HTML tags from a string, collapse whitespace, and trim.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Round to 2 decimal places (prices / percentages). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a Ratio price (already in rupees post-parse) into a finite number, or 0. */
function parsePrice(price: string | number | null | undefined): number {
  if (price === null || price === undefined) return 0;
  if (typeof price === 'number') return Number.isFinite(price) ? price : 0;
  const n = Number(price.trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Is a variant purchasable? The platform's `availableForSale` flag is
 * authoritative — products with untracked inventory (`inventory_management:
 * null`) report `inventory_quantity: 0` yet remain for sale, so deciding stock
 * from quantity alone wrongly marks the whole catalog out-of-stock (which makes
 * Wizzy hide every product from search + the dashboard count). Fall back to
 * `inventoryQuantity > 0` only when `availableForSale` is absent.
 */
function isVariantAvailable(v: RatioVariant): boolean {
  if (typeof v.availableForSale === 'boolean') return v.availableForSale;
  return (v.inventoryQuantity ?? 0) > 0;
}

/**
 * Compute Wizzy price fields for a single variant.
 *   selling = Ratio price (with the compare-at fallback for 0-priced items)
 *   mrp     = Ratio compare_at_price, only when it exceeds selling
 *   discount / discountPercentage derived; finalPrice = selling
 */
function computeVariantPrices(v: RatioVariant): {
  selling: number;
  mrp: number;
  discount: number;
  discountPercentage: number;
  finalPrice: number;
} {
  let selling = parsePrice(v.price);
  let mrp = parsePrice(v.compareAtPrice);
  // Some products carry the real price ONLY in compare_at_price (selling 0).
  if (selling <= 0 && mrp > 0) {
    selling = mrp;
    mrp = 0;
  }
  const hasMrp = selling > 0 && mrp > selling;
  const discount = hasMrp ? round2(mrp - selling) : 0;
  const discountPercentage = hasMrp ? round2(((mrp - selling) / mrp) * 100) : 0;
  return {
    selling,
    mrp: hasMrp ? mrp : 0,
    discount,
    discountPercentage,
    finalPrice: selling,
  };
}

/**
 * Slugify a string for use as a category / attribute id.
 * Lowercase, replace spaces/special chars with hyphens, collapse duplicates.
 */
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'uncategorized'
  );
}

/** A variant option named exactly "color"/"colour" (case-insensitive). */
function isColorOption(name: string): boolean {
  return /^colou?r$/i.test(name.trim());
}

/** A variant option named exactly "size" (case-insensitive). */
function isSizeOption(name: string): boolean {
  return /^size$/i.test(name.trim());
}

/**
 * Normalize a configured storefront value into the bare host used to build
 * `https://<host>/products/<handle>`. Accepts a full URL or a bare host,
 * strips scheme / path / trailing dots-or-slashes. Returns null when empty.
 * (Mirrors the google app's `normalizeStoreDomain`.)
 */
function normalizeStoreDomain(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const noScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
  const host = noScheme.split('/')[0] ?? noScheme;
  const cleaned = host.replace(/[/.]+$/, '').trim();
  return cleaned === '' ? null : cleaned;
}

/** Accumulates distinct swatch (color/size) values across variants. */
function collectSwatch(
  map: Map<string, WizzySwatchPayload>,
  value: string,
  variationId: string,
  available: boolean,
): void {
  const existing = map.get(value);
  if (existing) {
    existing.inStock = existing.inStock || available;
  } else {
    map.set(value, { value, variationId, inStock: available });
  }
}

/** Build the colors / sizes / attributes facets from all variant options. */
function buildVariantFacets(variants: RatioVariant[]): {
  colors: WizzySwatchPayload[];
  sizes: WizzySwatchPayload[];
  attributes: WizzyAttributePayload[];
} {
  const colors = new Map<string, WizzySwatchPayload>();
  const sizes = new Map<string, WizzySwatchPayload>();
  // attribute name → (value → swatch-ish entry)
  const attrs = new Map<string, Map<string, WizzyAttributeValuePayload>>();

  for (const v of variants) {
    if (!v.options) continue;
    const available = isVariantAvailable(v);
    for (const [name, value] of Object.entries(v.options)) {
      if (!value) continue;
      if (isColorOption(name)) {
        collectSwatch(colors, value, v.id, available);
      } else if (isSizeOption(name)) {
        collectSwatch(sizes, value, v.id, available);
      } else {
        let valueMap = attrs.get(name);
        if (!valueMap) {
          valueMap = new Map();
          attrs.set(name, valueMap);
        }
        const existing = valueMap.get(value);
        if (existing) {
          existing.inStock = existing.inStock || available;
        } else {
          valueMap.set(value, { value: [value], variationId: v.id, inStock: available });
        }
      }
    }
  }

  const attributes: WizzyAttributePayload[] = [...attrs.entries()].map(([name, valueMap]) => ({
    id: slug(name),
    name,
    type: 'string' as const,
    values: [...valueMap.values()],
    isSearchable: true,
    isFilterable: true,
    addInAutocomplete: false,
  }));

  return { colors: [...colors.values()], sizes: [...sizes.values()], attributes };
}

/**
 * Build a single "Tags" attribute from the product's tags — searchable +
 * filterable so shoppers can facet on them. Dedupes case/space-insensitively,
 * keeping the first-seen label (so "Bestseller" wins over a later "Best Seller").
 * Returns null when there are no usable tags. Most products in this store are
 * single-variant (no color/size options), so tags are the only attribute facet.
 */
function buildTagsAttribute(
  tags: string[] | undefined,
  variationId: string,
  inStock: boolean,
): WizzyAttributePayload | null {
  if (!tags || tags.length === 0) return null;
  const seen = new Set<string>();
  const values: WizzyAttributeValuePayload[] = [];
  for (const raw of tags) {
    const label = raw.trim();
    if (!label) continue;
    // Dedupe key ignores case and non-alphanumerics so "Best Seller" === "Bestseller".
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    values.push({ value: [label], variationId, inStock });
  }
  if (values.length === 0) return null;
  return {
    id: 'tags',
    name: 'Tags',
    type: 'string',
    values,
    isSearchable: true,
    isFilterable: true,
    addInAutocomplete: false,
  };
}

/**
 * Transform a Ratio product into one Wizzy catalog payload.
 *
 * Returns ok:true + payload on success, ok:false + issue string when the
 * product cannot be synced (e.g. missing image, all variants filtered out, no
 * usable price).
 *
 * Prices arrive in RUPEES (already divided by parse-ratio-product.ts).
 * DO NOT divide again.
 */
export function transformProduct(
  product: RatioProduct,
  config: WizzyTransformConfig,
): TransformResult {
  // Wizzy requires mainImage — skip products with no images.
  const imageSrcs = (product.images ?? []).map((img) => img.src).filter(Boolean);
  if (imageSrcs.length === 0) {
    return { ok: false, issue: 'missing image' };
  }

  // Filter variants by availability if required.
  const activeVariants = product.variants.filter(
    (v) => isVariantAvailable(v) || config.includeOutOfStock,
  );

  // Skip the whole product if all variants are filtered out.
  if (activeVariants.length === 0) {
    return { ok: false, issue: 'out of stock' };
  }

  // Representative variant (first active) drives the product-level price.
  // activeVariants.length > 0 is guaranteed by the early return above.
  // biome-ignore lint/style/noNonNullAssertion: length checked above
  const rep = activeVariants[0]!;
  const repPrices = computeVariantPrices(rep);

  // No usable price at all → Wizzy would reject it; skip with a clear reason.
  if (repPrices.selling <= 0) {
    return { ok: false, issue: 'missing or zero selling price' };
  }

  // Synthesize a single category from productType (required, non-empty).
  const productType = product.productType?.trim() || '';
  const catName = productType || 'Uncategorized';
  const catId = slug(catName);
  const categories: WizzyCategoryPayload[] = [
    {
      id: catId,
      name: catName,
      parentId: '',
      pathIds: [catId],
      isSearchable: true,
      includeInMenu: true,
    },
  ];

  // Collect SKUs from all active variants (filter nulls).
  const skus = activeVariants
    .map((v) => v.sku)
    .filter((s): s is string => s !== null && s !== undefined && s !== '');

  // Total tracked stock quantity (0 for untracked products).
  const stockQty = product.variants.reduce((sum, v) => sum + (v.inventoryQuantity ?? 0), 0);
  // In stock if ANY variant is purchasable — driven by availableForSale, NOT
  // raw quantity (untracked products are for sale at quantity 0).
  const inStock = product.variants.some(isVariantAvailable);

  // Description (optional).
  const rawDesc = product.description ?? '';
  const description = rawDesc
    ? config.stripHtmlDescription
      ? stripHtml(rawDesc)
      : rawDesc
    : undefined;

  const { colors, sizes, attributes } = buildVariantFacets(product.variants);
  // Surface product tags as a filterable "Tags" attribute alongside variant attributes.
  const tagsAttr = buildTagsAttribute(product.tags, rep.id, inStock);
  const allAttributes = tagsAttr ? [...attributes, tagsAttr] : attributes;

  const payload: WizzyProductPayload = {
    id: product.id,
    name: product.title,
    // imageSrcs.length > 0 is guaranteed by the early return above.
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    mainImage: imageSrcs[0]!,
    categories,
    sellingPrice: repPrices.selling,
    finalPrice: repPrices.finalPrice,
    inStock,
    stockQty,
    // Always searchable / catalog-visible — even out-of-stock products should
    // be findable (whether OOS items SHOW is the storefront search's
    // includeOutOfStock choice, not a property of the product).
    isSearchable: true,
    isVisibleInCatalog: true,
  };

  // MRP + discount fields — only when the product is genuinely on sale.
  if (repPrices.mrp > 0) {
    payload.price = repPrices.mrp;
    payload.discount = repPrices.discount;
    payload.discountPercentage = repPrices.discountPercentage;
  }

  // Additional images (after the first, which is mainImage).
  if (imageSrcs.length > 1) payload.images = imageSrcs.slice(1);

  if (product.vendor) payload.brand = product.vendor;
  if (skus.length > 0) payload.sku = skus;
  if (description) payload.description = description;
  if (colors.length > 0) payload.colors = colors;
  if (sizes.length > 0) payload.sizes = sizes;
  if (allAttributes.length > 0) payload.attributes = allAttributes;

  // Absolute product URL — needs a configured storefront domain.
  const storeDomain = normalizeStoreDomain(config.storeDomain);
  if (storeDomain && product.handle) {
    payload.url = `https://${storeDomain}/products/${product.handle}`;
  }

  // childData: per-variation price arrays — only meaningful for true
  // multi-variant products (single-variant arrays just duplicate the top level).
  if (product.variants.length > 1) {
    const all = product.variants.map(computeVariantPrices);
    payload.childData = {
      sellingPrices: all.map((p) => p.selling),
      prices: all.map((p) => (p.mrp > 0 ? p.mrp : p.selling)),
      discounts: all.map((p) => p.discount),
      discountPercentages: all.map((p) => p.discountPercentage),
      finalPrices: all.map((p) => p.finalPrice),
    };
  }

  return { ok: true, payload };
}
