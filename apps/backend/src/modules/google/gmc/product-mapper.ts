/**
 * GMC (Google Merchant Center) product mapper.
 *
 * Pure functions that transform a Ratio product (with variants) into Google
 * Content API for Shopping v2.1 product objects, computing a per-item feed
 * status. See PRD §4.5 ("Product Data Mapping") + §7 (edge cases).
 *
 * Each variant becomes a SEPARATE GMC product (offer); all variants of a Ratio
 * product share a common `itemGroupId`.
 */

/** A single Ratio product variant. */
export interface RatioVariant {
  id: string;
  price: string | number | null;
  compareAtPrice?: string | number | null;
  barcode?: string | null;
  sku?: string | null;
  inventoryQuantity?: number | null;
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
  images?: { src: string }[];
  variants: RatioVariant[];
}

/** Configuration controlling how products map into GMC offers. */
export interface MapperConfig {
  storeDomain: string;
  storePrefix: string;
  targetCountry: string;
  contentLanguage: string;
  /** ISO currency code, e.g. 'INR'. */
  currency: string;
  defaultCondition: 'new' | 'refurbished' | 'used';
  brandOverride?: string | null;
  googleProductCategory?: string | null;
}

/**
 * GMC Content API v2.1 `Price` — a structured `{ value, currency }` object, NOT
 * a "12.00 INR" string. The API rejects the string form with
 * `Invalid value at 'body.price' (…v2p1.Price)`.
 */
export interface GmcPrice {
  value: string;
  currency: string;
}

/** A Google Content API for Shopping v2.1 product object. */
export interface GmcProduct {
  id: string;
  offerId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks?: string[];
  price: GmcPrice;
  salePrice?: GmcPrice;
  maximumRetailPrice?: GmcPrice;
  availability: 'in_stock' | 'out_of_stock';
  condition: 'new' | 'refurbished' | 'used';
  brand?: string;
  channel: 'online';
  contentLanguage: string;
  targetCountry: string;
  identifierExists: boolean;
  itemGroupId: string;
  gtin?: string;
  mpn?: string;
  color?: string;
  // GMC Content API v2.1 uses `sizes` (ARRAY), not a singular `size` — the API
  // rejects the latter with "Unknown name size", which 400s the whole batch.
  sizes?: string[];
  googleProductCategory?: string;
  // GMC Content API v2.1 uses `productTypes` (ARRAY), not a singular
  // `productType` — the API rejects the latter with "Unknown name productType".
  productTypes?: string[];
}

/** The status of a single mapped offer. */
export type OfferStatus = 'SYNCED' | 'PENDING' | 'ERROR' | 'WARNING';

/** The result of mapping a single variant into a GMC offer. */
export interface MappedOffer {
  offerId: string;
  status: OfferStatus;
  hasGtin: boolean;
  issue: string | null;
  productId: string;
  variantId: string | null;
  title: string;
  /** The GMC product, or `null` when status is ERROR. */
  gmc: GmcProduct | null;
}

/**
 * Strip HTML tags from a string, collapse whitespace, and trim.
 * @param s Raw (possibly HTML) string.
 * @returns Plain-text string with tags removed and whitespace collapsed.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Truncate a string to at most `max` characters, appending '…' when truncated.
 * The ellipsis counts toward the limit, so the result never exceeds `max`.
 * @param s Input string.
 * @param max Maximum length of the returned string (including the ellipsis).
 * @returns The original string, or a truncated version ending in '…'.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return '…';
  return `${s.slice(0, max - 1)}…`;
}

const GTIN_RE = /^\d+$/;
const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/** Whether a barcode is a syntactically valid GTIN (8/12/13/14 digits). */
function isValidGtin(barcode: string | null | undefined): barcode is string {
  if (!barcode) return false;
  return GTIN_RE.test(barcode) && VALID_GTIN_LENGTHS.has(barcode.length);
}

/** Parse a Ratio price into a finite number, or `null` when missing/invalid. */
function parsePrice(price: string | number | null | undefined): number | null {
  if (price === null || price === undefined) return null;
  if (typeof price === 'number') {
    return Number.isFinite(price) ? price : null;
  }
  const trimmed = price.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Format a numeric amount as a GMC `Price` object, e.g. { value: '999.00', currency: 'INR' }. */
function formatMoney(amount: number, currency: string): GmcPrice {
  return { value: amount.toFixed(2), currency };
}

/** Case-insensitive lookup of a variant option (e.g. 'color', 'size'). */
function findOption(options: Record<string, string> | undefined, key: string): string | undefined {
  if (!options) return undefined;
  const lowerKey = key.toLowerCase();
  for (const [k, v] of Object.entries(options)) {
    if (k.toLowerCase() === lowerKey) return v;
  }
  return undefined;
}

/**
 * Map a Ratio product into one GMC offer per variant.
 *
 * Each variant becomes a separate offer; all share `itemGroupId`. Status is
 * computed per offer with precedence ERROR > WARNING > SYNCED. When the status
 * is ERROR the `gmc` payload is `null`.
 *
 * @param product The Ratio product (with variants).
 * @param config Mapping configuration (store, locale, currency, defaults).
 * @returns One {@link MappedOffer} per variant.
 */
export function mapProduct(product: RatioProduct, config: MapperConfig): MappedOffer[] {
  const itemGroupId = `${config.storePrefix}:${product.id}`;
  const images = product.images ?? [];
  // Link = the merchant's configured/verified store domain + product handle.
  const link = `https://${config.storeDomain}/products/${product.handle}`;

  return product.variants.map((variant) =>
    mapVariant(product, variant, config, { itemGroupId, images, link }),
  );
}

function mapVariant(
  product: RatioProduct,
  variant: RatioVariant,
  config: MapperConfig,
  shared: { itemGroupId: string; images: { src: string }[]; link: string },
): MappedOffer {
  const offerId = `${config.storePrefix}:${variant.id}`;
  const title = truncate(product.title, 150);

  // --- ERROR conditions (take precedence over everything) ---
  const priceValue = parsePrice(variant.price);
  if (shared.images.length === 0) {
    return errorOffer(offerId, product, variant, title, 'missing image');
  }
  if (priceValue === null) {
    return errorOffer(offerId, product, variant, title, 'missing price');
  }

  // From here the offer will produce a GMC payload; collect a single WARNING.
  let status: OfferStatus = 'SYNCED';
  let issue: string | null = null;
  const warn = (msg: string): void => {
    if (status !== 'WARNING') {
      status = 'WARNING';
      issue = msg;
    }
  };

  // --- Description (HTML-stripped, fall back to title) ---
  const rawDescription = product.description ?? '';
  const stripped = stripHtml(rawDescription);
  let description: string;
  if (stripped === '') {
    description = title;
    warn('missing description, used title');
  } else {
    description = truncate(stripped, 5000);
  }

  // --- Identifiers (GTIN / MPN) ---
  const hasGtin = isValidGtin(variant.barcode);
  let gtin: string | undefined;
  let mpn: string | undefined;
  if (hasGtin) {
    gtin = variant.barcode as string;
  } else {
    if (variant.sku) {
      mpn = variant.sku;
    }
    // Distinguish a MALFORMED barcode (merchant entered something that isn't a
    // GTIN, e.g. a SKU-like string) from a legitimately ABSENT one, so the
    // feed-item issue is actionable. A GTIN must be 8/12/13/14 DIGITS; a value
    // like "qwertyuihsnx" is not a GTIN and must NOT be sent as one (GMC would
    // disapprove it) — we fall back to MPN+brand, which Google accepts.
    if (variant.barcode) {
      warn(
        `barcode "${variant.barcode}" is not a valid GTIN (must be 8, 12, 13, or 14 digits); using SKU as MPN`,
      );
    } else if (variant.sku) {
      warn('no GTIN (barcode) provided; using SKU as MPN');
    } else {
      warn('no GTIN or SKU — product has no unique identifier');
    }
  }
  const identifierExists = hasGtin || Boolean(variant.sku);

  // --- Pricing ---
  const compareAt = parsePrice(variant.compareAtPrice ?? null);
  const price = formatMoney(priceValue, config.currency);
  let salePrice: GmcPrice | undefined;
  let maximumRetailPrice: GmcPrice | undefined;
  if (compareAt !== null) {
    maximumRetailPrice = formatMoney(compareAt, config.currency);
    if (compareAt > priceValue) {
      salePrice = formatMoney(priceValue, config.currency);
    }
  }

  // --- Availability ---
  const qty = variant.inventoryQuantity ?? 0;
  const availability: 'in_stock' | 'out_of_stock' = qty > 0 ? 'in_stock' : 'out_of_stock';

  // --- Images --- (an empty image list already returned ERROR above)
  const imageLink = shared.images[0]?.src ?? '';
  const additionalImageLinks = shared.images.slice(1, 10).map((img) => img.src);

  // --- Options ---
  const color = findOption(variant.options, 'color');
  const size = findOption(variant.options, 'size');

  const brand = config.brandOverride || product.vendor || undefined;

  const gmc: GmcProduct = {
    id: offerId,
    offerId,
    title,
    description,
    link: shared.link,
    imageLink,
    price,
    availability,
    condition: config.defaultCondition,
    channel: 'online',
    contentLanguage: config.contentLanguage,
    targetCountry: config.targetCountry,
    identifierExists,
    itemGroupId: shared.itemGroupId,
  };

  if (additionalImageLinks.length > 0) {
    gmc.additionalImageLinks = additionalImageLinks;
  }
  if (salePrice !== undefined) gmc.salePrice = salePrice;
  if (maximumRetailPrice !== undefined) {
    gmc.maximumRetailPrice = maximumRetailPrice;
  }
  if (brand !== undefined) gmc.brand = brand;
  if (gtin !== undefined) gmc.gtin = gtin;
  if (mpn !== undefined) gmc.mpn = mpn;
  if (color !== undefined) gmc.color = color;
  if (size !== undefined) gmc.sizes = [size];
  if (config.googleProductCategory) {
    gmc.googleProductCategory = config.googleProductCategory;
  }
  if (product.productType) gmc.productTypes = [product.productType];

  return {
    offerId,
    status,
    hasGtin,
    issue,
    productId: product.id,
    variantId: variant.id,
    title,
    gmc,
  };
}

/** Build an ERROR offer (no GMC payload). */
function errorOffer(
  offerId: string,
  product: RatioProduct,
  variant: RatioVariant,
  title: string,
  issue: string,
): MappedOffer {
  return {
    offerId,
    status: 'ERROR',
    hasGtin: isValidGtin(variant.barcode),
    issue,
    productId: product.id,
    variantId: variant.id,
    title,
    gmc: null,
  };
}
