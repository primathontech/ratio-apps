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

/** A populated product metafield (value is guaranteed non-null). */
export interface RatioMetafield {
  namespace: string;
  key: string;
  name: string;
  /** Raw non-null value (string | number | boolean | array | object), coerced in the transform. */
  value: unknown;
}

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
  /**
   * Collections the product belongs to (from the by-id endpoint).
   * Used to build rich category facets. Absent (default []) when fetched
   * via the shallow list endpoint.
   */
  collections?: { id: string; title: string }[];
  /**
   * Product recency timestamp as an ISO 8601 string, used to drive a "Newest"
   * sort in Wizzy. Sourced from `published_at`, falling back to `created_at`
   * then `updated_at`. Absent/null when none are present.
   */
  createdAt?: string | null;
  /** Last-modified timestamp (ISO 8601) from `updated_at`. Wizzy sorts on `updatedAt`. */
  updatedAt?: string | null;
  /**
   * Populated product metafields (from the by-id endpoint). Absent via the list endpoint.
   * Only entries with a non-null value are included (see parseMetafields).
   */
  metafields?: RatioMetafield[];
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
  /** Groups all variants under the same product (= product id). */
  groupId?: string;
  /** Product title / name. */
  name: string;
  /** Primary image URL (required — products without images are skipped). */
  mainImage: string;
  /** Secondary image shown on hover in result cards (the product's 2nd image). */
  hoverImage?: string;
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
  /** Average customer rating (0–5), from the reviews/rating metafield. */
  avgRatings?: number;
  /** Total number of ratings, from the reviews/rating_count metafield. */
  totalReviews?: number;
  /** Recency timestamp `yyyy-mm-dd hh:mm:ss` (published/created) — enables a "Newest" sort. */
  createdAt?: string;
  /** Last-modified timestamp `yyyy-mm-dd hh:mm:ss` — Wizzy sortable field `updatedAt`. */
  updatedAt?: string;
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

/**
 * Normalize a raw date value into Wizzy's required `yyyy-mm-dd hh:mm:ss` (UTC)
 * format, or null when missing/unparseable. Accepts an ISO string or epoch
 * number. Wizzy REJECTS ISO 8601 (`...T...Z`) for createdAt/updatedAt, so we
 * derive the space-separated form from the UTC ISO string (drop millis + 'Z').
 */
function toWizzyDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  // "2026-06-10T07:36:54.170Z" → "2026-06-10 07:36:54"
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Returns true for collection titles that should NOT become Wizzy categories:
 * - Titles starting with "test" (case-insensitive) — internal test collections.
 * - "All Products" — a catch-all with no facet value.
 * - Searchtap bestsellers list (a different search vendor).
 */
const SKIP_COLLECTION = (t: string): boolean =>
  /^test\b/i.test(t.trim()) ||
  ['all products', 'bestsellers searchtap'].includes(t.trim().toLowerCase());

/**
 * Build the Wizzy categories array from a product's `product_type` and
 * `collections[]` (from the by-id endpoint).
 *
 * Structure:
 *   - Root category = product_type (or "Uncategorized"), parentId = '', pathIds = [rootId].
 *   - Each non-skipped collection becomes a child: parentId = rootId, pathIds = [rootId, childId].
 *
 * Collections matching SKIP_COLLECTION are omitted.
 */
function buildCategories(product: RatioProduct): WizzyCategoryPayload[] {
  const productType = product.productType?.trim() || '';
  const rootName = productType || 'Uncategorized';
  const rootId = slug(rootName);

  const categories: WizzyCategoryPayload[] = [
    {
      id: rootId,
      name: rootName,
      parentId: '',
      pathIds: [rootId],
      isSearchable: true,
      includeInMenu: true,
    },
  ];

  // Dedupe by slug so two collections with the same normalised name collapse.
  const seen = new Set<string>([rootId]);
  for (const col of product.collections ?? []) {
    const title = col.title?.trim() ?? '';
    if (!title || SKIP_COLLECTION(title)) continue;
    const childId = slug(title);
    if (seen.has(childId)) continue;
    seen.add(childId);
    categories.push({
      id: childId,
      name: title,
      parentId: rootId,
      pathIds: [rootId, childId],
      isSearchable: true,
      includeInMenu: true,
    });
  }

  return categories;
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

/**
 * Collapse an attribute's values so all labels sharing the same `variationId`
 * become ONE entry with a multi-value `value` array (Wizzy models `value` as
 * `string[]`). Upstream builders emit one single-label entry per value; this
 * merges the ones that belong to the same variation. Preserves first-seen order
 * of variations and of labels within a variation, dedupes labels, and ORs
 * `inStock`.
 */
function mergeValuesByVariation(
  values: WizzyAttributeValuePayload[],
): WizzyAttributeValuePayload[] {
  const byVariation = new Map<string, WizzyAttributeValuePayload>();
  for (const entry of values) {
    const existing = byVariation.get(entry.variationId);
    if (existing) {
      for (const label of entry.value) {
        if (!existing.value.includes(label)) existing.value.push(label);
      }
      existing.inStock = existing.inStock || entry.inStock;
    } else {
      byVariation.set(entry.variationId, {
        value: [...entry.value],
        variationId: entry.variationId,
        inStock: entry.inStock,
      });
    }
  }
  return [...byVariation.values()];
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
    values: mergeValuesByVariation([...valueMap.values()]),
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
    values: mergeValuesByVariation(values),
    isSearchable: true,
    isFilterable: true,
    addInAutocomplete: false,
  };
}

/**
 * Curated allowlist of metafield keys (namespace/key) → facet display name.
 * Only these keys surface as Wizzy search facets; everything else is ignored.
 */
const METAFIELD_FACETS: Record<string, string> = {
  'custom/form_factor': 'Form Factor',
  'custom/flavour_name': 'Flavour',
  'shopify/flavor': 'Flavour',
  'custom/product_weight': 'Serving Size',
  'custom/net_weight': 'Net Weight',
  'custom/prodcut_type_veg_nonveg': 'Dietary Type',
  'shopify/dietary-preferences': 'Dietary Preferences',
  'shopify/dietary-use': 'Dietary Use',
  'shopify/creatine-type': 'Creatine Type',
  'shopify/supplement-health-focus': 'Health Focus',
  'shopify/ingredient-category': 'Ingredient Category',
  'shopify/food-supplement-form': 'Supplement Form',
  'shopify/target-gender': 'Gender',
  'shopify/age-group': 'Age Group',
};

/**
 * Metafield keys that carry the average customer rating / review count. Covers
 * the standard Shopify reviews metafield and common Loox conventions (production
 * feeds Loox). If a real catalog uses a different key, add it here.
 */
const RATING_VALUE_KEYS = new Set(['reviews/rating', 'loox/avg_rating', 'loox/rating']);
const RATING_COUNT_KEYS = new Set([
  'reviews/rating_count',
  'loox/num_reviews',
  'loox/reviews_count',
]);

/**
 * Returns true for strings that look like unresolved reference IDs (Shopify
 * global IDs, metaobject refs, or long bare numeric IDs). These should never
 * be surfaced as human-facing facet values.
 */
function looksLikeReferenceId(s: string): boolean {
  const t = s.trim();
  return /^gid:\/\//i.test(t) || /^(mod|mfd|gid)_/i.test(t) || /^\d{10,}$/.test(t);
}

/**
 * Coerce a raw metafield value into a deduplicated array of human-readable
 * strings. Reference IDs and empty strings are dropped automatically.
 */
function metafieldToStrings(value: unknown): string[] {
  const collect = (v: unknown): string[] => {
    if (typeof v === 'string') return [v.trim()];
    if (typeof v === 'number' && Number.isFinite(v)) return [String(v)];
    if (typeof v === 'boolean') return [String(v)];
    if (Array.isArray(v)) return v.flatMap(collect);
    if (v !== null && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if ('value' in obj) return collect(obj.value);
    }
    return [];
  };

  const raw = collect(value);
  // Trim, drop empties, drop reference IDs, dedupe case-insensitively (keep first-seen).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    const t = s.trim();
    if (!t || looksLikeReferenceId(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Coerce a raw metafield value into a finite number, or null when the value
 * cannot be meaningfully interpreted as a number.
 */
function metafieldToNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('value' in obj) return metafieldToNumber(obj.value);
  }
  return null;
}

/**
 * Build Wizzy attribute facets from product metafields, plus rating scalar
 * fields. Only allowlisted keys become attributes; reference IDs are dropped.
 * Multiple keys that map to the same facet name (e.g. custom/flavour_name and
 * shopify/flavor both → "Flavour") are merged into a single attribute with
 * deduplicated values.
 */
function buildMetafieldFacets(
  metafields: RatioMetafield[] | undefined,
  variationId: string,
  inStock: boolean,
): { attributes: WizzyAttributePayload[]; avgRatings?: number; totalReviews?: number } {
  let avgRatings: number | undefined;
  let totalReviews: number | undefined;
  // facet name → (value label → payload entry); preserves insertion order.
  const facetMap = new Map<string, Map<string, WizzyAttributeValuePayload>>();

  for (const mf of metafields ?? []) {
    const nsKey = `${mf.namespace}/${mf.key}`;

    // Special-case: rating scalars — never become facet attributes. Ratings can
    // arrive under the standard Shopify reviews metafield OR a Loox-specific one
    // (production feeds Loox → `product_avg_rating_loox`), so cover both.
    if (RATING_VALUE_KEYS.has(nsKey)) {
      const n = metafieldToNumber(mf.value);
      if (n !== null && n >= 0) {
        // Source ratings are 0–5; Wizzy's product-level avgRatings is 0–100
        // (production shows 98 for a 4.9 rating). Scale ×20; pass through if a
        // value already looks like 0–100.
        const scaled = n <= 5 ? n * 20 : n;
        avgRatings = Math.min(100, Math.max(0, Math.round(scaled)));
      }
      continue;
    }
    if (RATING_COUNT_KEYS.has(nsKey)) {
      const n = metafieldToNumber(mf.value);
      if (n !== null && n >= 0) totalReviews = Math.floor(n);
      continue;
    }

    const facetName = METAFIELD_FACETS[nsKey];
    if (!facetName) continue; // not in allowlist — ignore

    const strings = metafieldToStrings(mf.value);
    if (strings.length === 0) continue;

    let valueMap = facetMap.get(facetName);
    if (!valueMap) {
      valueMap = new Map();
      facetMap.set(facetName, valueMap);
    }
    for (const s of strings) {
      // Dedupe across merged sources (case-insensitive, keep first-seen label).
      const key = s.toLowerCase();
      if (!valueMap.has(key)) {
        valueMap.set(key, { value: [s], variationId, inStock });
      }
    }
  }

  const attributes: WizzyAttributePayload[] = [...facetMap.entries()].map(([name, valueMap]) => ({
    id: slug(name),
    name,
    type: 'string' as const,
    values: mergeValuesByVariation([...valueMap.values()]),
    isSearchable: true,
    isFilterable: true,
    addInAutocomplete: false,
  }));

  return {
    attributes,
    ...(avgRatings !== undefined ? { avgRatings } : {}),
    ...(totalReviews !== undefined ? { totalReviews } : {}),
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

  // Build rich categories from product_type (root) + collections[] (children).
  const categories = buildCategories(product);

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
  // Opportunistic metafield enrichment — only populated from the by-id endpoint.
  const mf = buildMetafieldFacets(product.metafields, rep.id, inStock);
  const allAttributes = [...attributes, ...(tagsAttr ? [tagsAttr] : []), ...mf.attributes];

  const payload: WizzyProductPayload = {
    id: product.id,
    groupId: product.id,
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
  if (imageSrcs.length > 1) {
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    payload.hoverImage = imageSrcs[1]!;
    payload.images = imageSrcs.slice(1);
  }

  if (product.vendor) payload.brand = product.vendor;
  if (skus.length > 0) payload.sku = skus;
  if (description) payload.description = description;
  if (colors.length > 0) payload.colors = colors;
  if (sizes.length > 0) payload.sizes = sizes;
  if (allAttributes.length > 0) payload.attributes = allAttributes;
  if (mf.avgRatings !== undefined) payload.avgRatings = mf.avgRatings;
  if (mf.totalReviews !== undefined) payload.totalReviews = mf.totalReviews;

  // Recency timestamps (Wizzy `yyyy-mm-dd hh:mm:ss`) for "Newest"/recently-updated sorts.
  const createdAt = toWizzyDate(product.createdAt);
  if (createdAt) payload.createdAt = createdAt;
  const updatedAt = toWizzyDate(product.updatedAt);
  if (updatedAt) payload.updatedAt = updatedAt;

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
