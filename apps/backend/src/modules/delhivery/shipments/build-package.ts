type Rec = Record<string, unknown>;

export interface BoxDims {
  l: number;
  b: number;
  h: number;
}

/** The physical package derived from the order's line items + products. */
export interface ShipmentPackage {
  weightGrams: number;
  /** Kilograms — Delhivery's manifestation contract (grams ÷ 1000). */
  weightKg: number;
  dims: BoxDims;
  hsnCode: string | null;
  productsDesc: string;
  quantity: number;
}

/** Weight to assume when neither line items nor products carry grams. */
const FALLBACK_WEIGHT_GRAMS = 500;

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Read a numeric metafield off a product. Supports both shapes seen on the
 * platform: an array of `{ key, value }` records and a flat object map.
 */
export function metafieldNumber(product: Rec, key: string): number | null {
  const metafields = product.metafields;
  if (Array.isArray(metafields)) {
    for (const raw of metafields) {
      const mf = raw as Rec;
      if (mf.key === key) return asNumber(mf.value);
    }
    return null;
  }
  if (metafields && typeof metafields === 'object') {
    return asNumber((metafields as Rec)[key]);
  }
  return null;
}

/** L/B/H from the product's dimension metafields, or null when incomplete. */
function productDims(product: Rec): BoxDims | null {
  const l = metafieldNumber(product, 'length_cm');
  const b = metafieldNumber(product, 'breadth_cm');
  const h = metafieldNumber(product, 'height_cm');
  if (l === null || b === null || h === null) return null;
  if (l <= 0 || b <= 0 || h <= 0) return null;
  return { l, b, h };
}

function lineItems(order: Rec): Rec[] {
  const items = order.line_items ?? order.items;
  return Array.isArray(items) ? (items as Rec[]) : [];
}

/**
 * Build the single-box package for an order (v1 heuristic — TRD §7.8):
 *   - weight  = Σ line-item grams × qty (product `grams` fallback per item;
 *     500 g floor when nothing carries a weight) — sent to Delhivery in KG.
 *   - dims    = per-axis MAX across products that carry the complete
 *     `length_cm`/`breadth_cm`/`height_cm` metafield set; when NO product has
 *     complete dims, the merchant's configured default box wins.
 *   - hsnCode = the first product `hs_code` found.
 */
export function buildPackage(order: Rec, products: Rec[], defaultBox: BoxDims): ShipmentPackage {
  const items = lineItems(order);
  const productById = new Map<string, Rec>();
  for (const p of products) {
    const id = p.id;
    if (typeof id === 'string' || typeof id === 'number') productById.set(String(id), p);
  }

  let weightGrams = 0;
  let quantity = 0;
  const titles: string[] = [];
  for (const item of items) {
    const qty = asNumber(item.quantity) ?? 1;
    quantity += qty;
    const product = productById.get(String(item.product_id ?? item.productId ?? ''));
    const grams = asNumber(item.grams) ?? (product ? asNumber(product.grams) : null) ?? 0;
    weightGrams += grams * qty;
    const title = item.title ?? item.name ?? product?.title;
    if (typeof title === 'string' && title) titles.push(title);
  }
  if (weightGrams <= 0) weightGrams = FALLBACK_WEIGHT_GRAMS;
  if (quantity <= 0) quantity = 1;

  let dims: BoxDims | null = null;
  for (const product of products) {
    const d = productDims(product);
    if (!d) continue;
    dims = dims
      ? { l: Math.max(dims.l, d.l), b: Math.max(dims.b, d.b), h: Math.max(dims.h, d.h) }
      : d;
  }

  let hsnCode: string | null = null;
  for (const product of products) {
    const hs = product.hs_code ?? product.hsCode;
    if (typeof hs === 'string' && hs) {
      hsnCode = hs;
      break;
    }
  }

  return {
    weightGrams,
    weightKg: weightGrams / 1000,
    dims: dims ?? defaultBox,
    hsnCode,
    productsDesc: titles.join(', ').slice(0, 250) || 'order items',
    quantity,
  };
}
