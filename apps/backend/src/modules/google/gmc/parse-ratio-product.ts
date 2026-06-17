import type { RatioProduct, RatioVariant } from './product-mapper';

/** Ratio money fields are integer paise; GMC wants major units (₹). */
const paiseToMajor = (paise: unknown): number | null =>
  typeof paise === 'number' ? paise / 100 : null;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Parse a `products/*` webhook payload (or a `GET /products` item) into the
 * mapper's `RatioProduct`. Accepts either the bare product or a `{ product }`
 * envelope. Returns null when the payload has no usable id/title.
 *
 * Shared by the product webhook handlers and {@link RatioProductsService} so the
 * paise→major + variant normalization lives in one place.
 */
export function parseRatioProduct(data: Record<string, unknown>): RatioProduct | null {
  const raw = (
    typeof data.product === 'object' && data.product ? data.product : data
  ) as Record<string, unknown>;
  const id = str(raw.id);
  const title = str(raw.title);
  const handle = str(raw.handle);
  if (!id || !title) return null;

  const rawVariants = Array.isArray(raw.variants) ? (raw.variants as Record<string, unknown>[]) : [];
  const variants: RatioVariant[] =
    rawVariants.length > 0
      ? rawVariants.map((v) => ({
          id: str(v.id) ?? id,
          price: paiseToMajor(v.price),
          compareAtPrice: paiseToMajor(v.compare_at_price),
          sku: str(v.sku),
          barcode: str(v.barcode),
          inventoryQuantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : null,
          ...(typeof v.options === 'object' && v.options
            ? { options: v.options as Record<string, string> }
            : {}),
        }))
      : [
          {
            id,
            price: paiseToMajor(raw.price),
            compareAtPrice: paiseToMajor(raw.compare_at_price),
            sku: str(raw.sku),
            barcode: str(raw.barcode),
            inventoryQuantity: null,
          },
        ];

  const images = Array.isArray(raw.images)
    ? (raw.images as Record<string, unknown>[])
        .map((img) => ({ src: str(img.src) ?? '' }))
        .filter((img) => img.src.length > 0)
    : [];

  return {
    id,
    title,
    description: str(raw.body_html),
    handle: handle ?? id,
    vendor: str(raw.vendor),
    productType: str(raw.product_type),
    images,
    variants,
  };
}
