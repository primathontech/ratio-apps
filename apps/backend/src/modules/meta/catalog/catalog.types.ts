/**
 * Phase 2 catalog types.
 *
 * `OsItem*` model the product shape returned by the GoKwik os-item admin API
 * (the source of truth). The real API is snake_case; a few camelCase fallbacks
 * are tolerated so variant payloads from either shape parse.
 *
 * `MetaProductDto` is the normalized output (per TRD §4), consumed by both the
 * feed (RSS) and the Catalog Batch API (JSON). Prices stay in INTEGER PAISE —
 * the feed divides by 100 for its decimal string; the Batch API sends minor
 * units directly.
 */

export interface OsItemImage {
  src?: string;
  url?: string;
  alt?: string;
  position?: number;
}

export interface OsItemOptionValue {
  name?: string; // option name, e.g. "Color"
  value?: string; // e.g. "Red"
}

export interface OsItemVariant {
  id?: string;
  title?: string;
  sku?: string;
  price?: number; // paise
  compare_at_price?: number; // paise
  compareAtPrice?: number;
  inventory_quantity?: number;
  inventoryQuantity?: number;
  weight?: number;
  weight_unit?: string;
  image?: OsItemImage | string | null;
  option_values?: OsItemOptionValue[];
  optionValues?: OsItemOptionValue[];
}

export interface OsItemProduct {
  id: string;
  title?: string;
  body_html?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  status?: string; // active | draft | archived
  price?: number; // paise (parent / single-variant)
  compare_at_price?: number; // paise
  compareAtPrice?: number;
  sku?: string;
  barcode?: string;
  track_inventory?: boolean;
  continue_selling_out_of_stock?: boolean;
  images?: OsItemImage[];
  image?: OsItemImage | null;
  variants?: OsItemVariant[];
  google_product_category?: string;
  googleProductCategory?: string;
}

export type MetaAvailability =
  | 'in stock'
  | 'out of stock'
  | 'available for order'
  | 'discontinued';

/** Normalized Meta catalog item (TRD §4). One per product (product_id) or per variant (sku/variant_id). */
export interface MetaProductDto {
  retailerId: string; // = event content_ids
  itemGroupId?: string; // parent product id when this row is a variant
  name: string; // ≤200 chars
  description: string; // HTML-stripped
  url: string; // storefront product URL
  imageUrl: string; // absolute
  additionalImageUrls: string[];
  availability: MetaAvailability;
  price: number; // integer paise
  salePrice?: number; // integer paise
  currency: string; // "INR"
  condition: string; // "new"
  brand: string;
  category?: string; // google_product_category
  productType?: string;
  color?: string;
  size?: string;
  shippingWeight?: { unit: string; value: number };
  inventory: number;
}
