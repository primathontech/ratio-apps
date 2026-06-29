import type { RatioProduct, RatioVariant } from './wizzy-transform';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/**
 * Parse the platform `tags` field into a trimmed, non-empty string array.
 * The live REST/webhook shape is a comma-separated string
 * (`"Bestseller, Combo, New Arrival"`); an array form is also accepted
 * defensively. Returns undefined when there are no usable tags.
 */
const parseTags = (v: unknown): string[] | undefined => {
  const parts =
    typeof v === 'string'
      ? v.split(',')
      : Array.isArray(v)
        ? v.map((x) => (typeof x === 'string' ? x : ''))
        : [];
  const out = parts.map((t) => t.trim()).filter((t) => t.length > 0);
  return out.length > 0 ? out : undefined;
};

/** Spreadable `{ tags }` (or `{}`) so the key is omitted entirely when absent
 * — required under `exactOptionalPropertyTypes`. */
const tagsField = (v: unknown): { tags?: string[] } => {
  const tags = parseTags(v);
  return tags ? { tags } : {};
};

/**
 * Prices on the Ratio/OpenStore platform arrive in PAISE (integer minor units),
 * e.g. `155900` = ₹1,559.00. Wizzy needs major units, so divide by 100. Verified
 * against a live webhook (an OSMO combo priced 155900/209800 = ₹1,559/₹2,098).
 */
const paiseToMajor = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n / 100;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Parse a WEBHOOK `product` object into the mapper's {@link RatioProduct}.
 *
 * The webhook shape uses snake-case keys (`body_html`, `product_type`,
 * `variant_id`, `sku_id`, `compare_at_price`), positional `option1/2/3` values
 * resolved against product-level `options[].name`, and per-warehouse stock in
 * `warehouseQt[].quantity` (summed). Images come from `images[].url`, falling
 * back to the top-level `imageUrl`. Returns null when there is no id or title.
 */
export function parseWebhookProduct(product: Record<string, unknown>): RatioProduct | null {
  const id = str(product.id);
  const title = str(product.title);
  if (!id || !title) return null;

  // Product-level option names, indexed by position (option1 → optionNames[0]).
  const optionNames: (string | null)[] = Array.isArray(product.options)
    ? (product.options as Record<string, unknown>[]).map((o) => str(o.name))
    : [];

  const rawVariants = Array.isArray(product.variants)
    ? (product.variants as Record<string, unknown>[])
    : [];

  const variants: RatioVariant[] =
    rawVariants.length > 0
      ? rawVariants.map((v) => {
          const options: Record<string, string> = {};
          for (const [i, key] of (['option1', 'option2', 'option3'] as const).entries()) {
            const value = str(v[key]);
            const name = optionNames[i];
            if (value !== null && name) options[name] = value;
          }
          const warehouses = Array.isArray(v.warehouseQt)
            ? (v.warehouseQt as Record<string, unknown>[])
            : [];
          const inventoryQuantity = warehouses.reduce(
            (sum, w) => sum + (typeof w.quantity === 'number' ? w.quantity : 0),
            0,
          );
          return {
            id: str(v.variant_id) ?? id,
            price: paiseToMajor(v.price),
            compareAtPrice: paiseToMajor(v.compare_at_price),
            sku: str(v.sku_id),
            barcode: str(v.barcode),
            inventoryQuantity,
            availableForSale: bool(v.availableForSale),
            ...(Object.keys(options).length > 0 ? { options } : {}),
          };
        })
      : [
          {
            id,
            price: paiseToMajor(product.price),
            compareAtPrice: paiseToMajor(product.compare_at_price),
            sku: str(product.sku),
            barcode: str(product.barcode),
            inventoryQuantity: null,
          },
        ];

  let images = Array.isArray(product.images)
    ? (product.images as Record<string, unknown>[])
        .map((img) => ({ src: str(img.url) ?? '' }))
        .filter((img) => img.src.length > 0)
    : [];
  if (images.length === 0) {
    const fallback = str(product.imageUrl);
    if (fallback) images = [{ src: fallback }];
  }

  return {
    id,
    title,
    description: str(product.body_html),
    handle: str(product.handle) ?? id,
    vendor: str(product.vendor),
    productType: str(product.product_type),
    ...tagsField(product.tags),
    images,
    variants,
  };
}

/**
 * Parse a REST `GET /products` item into the mapper's {@link RatioProduct}.
 *
 * The REST list returns the platform's Shopify-shaped product JSON (verified
 * live on QA, and the same on every environment): snake_case product keys
 * (`title`, `body_html`, `product_type`), variants with `id` / `sku` /
 * `price` / `compare_at_price` / `barcode` / `inventory_quantity` + positional
 * `option1/2/3` resolved against product-level `options[].name`, and images in
 * `images[].src` (with a per-variant `imageUrl` fallback). Prices are PAISE.
 * `handle` falls back to a slug of `title`, then the id. Returns null without
 * an id or title.
 */
export function parseRestProduct(item: Record<string, unknown>): RatioProduct | null {
  const id = str(item.id);
  const title = str(item.title);
  if (!id || !title) return null;

  // Product-level option names, indexed by position (option1 → optionNames[0]).
  const optionNames: (string | null)[] = Array.isArray(item.options)
    ? (item.options as Record<string, unknown>[]).map((o) => str(o.name))
    : [];

  const rawVariants = Array.isArray(item.variants)
    ? (item.variants as Record<string, unknown>[])
    : [];

  const variants: RatioVariant[] =
    rawVariants.length > 0
      ? rawVariants.map((v) => {
          const options: Record<string, string> = {};
          for (const [i, key] of (['option1', 'option2', 'option3'] as const).entries()) {
            const value = str(v[key]);
            const name = optionNames[i];
            // Skip Shopify's synthetic single-variant placeholder.
            if (value !== null && value !== 'Default Title' && name && name !== 'Title') {
              options[name] = value;
            }
          }
          return {
            id: str(v.id) ?? id,
            price: paiseToMajor(v.price),
            compareAtPrice: paiseToMajor(v.compare_at_price),
            sku: str(v.sku),
            barcode: str(v.barcode),
            inventoryQuantity: num(v.inventory_quantity),
            availableForSale: bool(v.availableForSale),
            ...(Object.keys(options).length > 0 ? { options } : {}),
          };
        })
      : [
          {
            id,
            price: paiseToMajor(item.price),
            compareAtPrice: paiseToMajor(item.compare_at_price),
            sku: str(item.sku),
            barcode: str(item.barcode),
            inventoryQuantity: num(item.inventory_quantity),
            availableForSale: bool(item.availableForSale),
          },
        ];

  let images = Array.isArray(item.images)
    ? (item.images as Record<string, unknown>[])
        .map((img) => ({ src: str(img.src) ?? '' }))
        .filter((img) => img.src.length > 0)
    : [];
  if (images.length === 0) {
    // Per-variant image, then product-level imageUrl.
    const v0 = rawVariants[0];
    const fallback = (v0 ? str(v0.imageUrl) : null) ?? str(item.imageUrl);
    if (fallback) images = [{ src: fallback }];
  }

  return {
    id,
    title,
    description: str(item.body_html),
    handle: str(item.handle) ?? slugify(title) ?? id,
    vendor: str(item.vendor),
    productType: str(item.product_type),
    ...tagsField(item.tags),
    images,
    variants,
  };
}
