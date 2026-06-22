import type { RatioProduct, RatioVariant } from './product-mapper';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/**
 * Prices on the Ratio/OpenStore platform arrive in PAISE (integer minor units),
 * e.g. `155900` = ₹1,559.00. GMC needs major units, so divide by 100. Verified
 * against a live webhook (an OSMO combo priced 155900/209800 = ₹1,559/₹2,098).
 * This restores the original 2026-06-08 paise finding that a later change
 * mistakenly "corrected" to rupees off synthetic test fixtures.
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
    images,
    variants,
  };
}

/**
 * Parse a REST `GET /products` item into the mapper's {@link RatioProduct}.
 *
 * The REST shape uses camel-case keys (`name`, `productType`, `compareAtPrice`),
 * an `inventory.quantity` object, an `options` object kept as-is, and images in
 * `images[].src`. `handle` falls back to a slug of `name`, then the id. Returns
 * null when there is no id or name.
 */
export function parseRestProduct(item: Record<string, unknown>): RatioProduct | null {
  const id = str(item.id);
  const name = str(item.name);
  if (!id || !name) return null;

  const rawVariants = Array.isArray(item.variants)
    ? (item.variants as Record<string, unknown>[])
    : [];

  const variants: RatioVariant[] =
    rawVariants.length > 0
      ? rawVariants.map((v) => {
          const inventory =
            typeof v.inventory === 'object' && v.inventory
              ? (v.inventory as Record<string, unknown>)
              : null;
          return {
            id: str(v.id) ?? id,
            price: paiseToMajor(v.price),
            compareAtPrice: paiseToMajor(v.compareAtPrice),
            sku: str(v.sku),
            barcode: str(v.barcode),
            inventoryQuantity: inventory ? num(inventory.quantity) : null,
            ...(typeof v.options === 'object' && v.options
              ? { options: v.options as Record<string, string> }
              : {}),
          };
        })
      : [
          {
            id,
            price: paiseToMajor(item.price),
            compareAtPrice: paiseToMajor(item.compareAtPrice),
            sku: str(item.sku),
            barcode: str(item.barcode),
            inventoryQuantity: null,
          },
        ];

  const images = Array.isArray(item.images)
    ? (item.images as Record<string, unknown>[])
        .map((img) => ({ src: str(img.src) ?? '' }))
        .filter((img) => img.src.length > 0)
    : [];

  return {
    id,
    title: name,
    description: str(item.description),
    handle: str(item.handle) ?? slugify(name) ?? id,
    vendor: str(item.vendor),
    productType: str(item.productType),
    images,
    variants,
  };
}
