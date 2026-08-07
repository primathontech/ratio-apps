export type ClevertapProductTopic = 'products/create' | 'products/update' | 'products/delete';

export type CatalogOperation = 'upsert' | 'remove';

export interface ClevertapCatalogItem extends Record<string, unknown> {
  id: string;
  name?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  handle?: string;
  sku?: string;
  available?: boolean;
  category?: string;
}

export interface MappedCatalogItem {
  operation: CatalogOperation;
  subjectId: string;
  item: ClevertapCatalogItem;
}

export function mapProductForCatalog(
  topic: string,
  product: Record<string, unknown>,
): MappedCatalogItem | null {
  const id = firstString(product.id);
  if (!id) return null;

  if (isDeleteTopic(topic)) {
    return { operation: 'remove', subjectId: id, item: { id } };
  }

  const item: ClevertapCatalogItem = { id };

  const name = firstString(product.title, product.name, product.product_title);
  if (name) item.name = name;

  const price = parseProductPaiseToRupees(product.price ?? firstVariantField(product, 'price'));
  if (price !== null) item.price = price;

  item.currency = firstString(product.currency) ?? 'INR';

  const imageUrl = deriveImageUrl(product);
  if (imageUrl) item.imageUrl = imageUrl;

  const handle = firstString(product.handle, product.slug);
  if (handle) item.handle = handle;

  const sku = firstString(product.sku, firstVariantField(product, 'sku'));
  if (sku) item.sku = sku;

  const category = firstString(product.product_type, product.category, product.productType);
  if (category) item.category = category;

  const status = firstString(product.status);
  if (status) item.available = status.toLowerCase() === 'active';

  return { operation: 'upsert', subjectId: id, item };
}

export function buildCatalogCsv(items: readonly ClevertapCatalogItem[]): string {
  const columns: Array<[string, (i: ClevertapCatalogItem) => unknown]> = [
    ['Name', (i) => i.name],
    ['ImageURL', (i) => i.imageUrl],
    ['Category', (i) => i.category],
    ['id', (i) => i.id],
    ['Price', (i) => i.price],
    ['Currency', (i) => i.currency],
    ['SKU', (i) => i.sku],
    ['Handle', (i) => i.handle],
    ['Available', (i) => i.available],
  ];

  const lines: string[] = [columns.map(([header]) => header).join(',')];
  for (const item of items) {
    if (!item.name) continue;
    lines.push(columns.map(([, get]) => csvCell(get(item))).join(','));
  }
  return lines.join('\n');
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCatalogIdempotencyKey(topic: string, subjectId: string): string {
  return `${topic}:${subjectId}`;
}

function isDeleteTopic(topic: string): boolean {
  return topic === 'products/delete' || topic.endsWith('/delete');
}

export function parseProductPaiseToRupees(value: unknown): number | null {
  const paise = toFiniteNumber(value);
  if (paise === null) return null;
  return Math.round(paise) / 100;
}

function deriveImageUrl(product: Record<string, unknown>): string | null {
  const image = asRecord(product.image);
  const direct = firstString(image.src, product.image_url, product.imageUrl);
  if (direct) return direct;
  const images = Array.isArray(product.images) ? product.images : [];
  for (const raw of images) {
    const src = firstString(asRecord(raw).src, asRecord(raw).url);
    if (src) return src;
  }
  return null;
}

function firstVariantField(product: Record<string, unknown>, field: string): unknown {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return variants.length > 0 ? asRecord(variants[0])[field] : undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
