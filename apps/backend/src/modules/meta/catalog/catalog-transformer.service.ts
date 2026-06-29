import { Injectable } from '@nestjs/common';
import type { ProductIdType } from '@ratio-app/shared/constants/meta-events';
import type {
  MetaAvailability,
  MetaProductDto,
  OsItemImage,
  OsItemProduct,
  OsItemVariant,
} from './catalog.types';

/**
 * CatalogTransformerService — maps an os-item product → Meta catalog item(s).
 *
 * PURE: no DB, no network. Used by both the feed (RSS) and the Batch API path.
 * Emits one item per product (`product_id`) or one per variant (`sku` /
 * `variant_id`), with `item_group_id` linking variants to the parent — so the
 * `retailerId` always matches the `content_ids` Phase-1 events send.
 *
 * Non-active products return `[]` (the sync layer turns that into a DELETE if
 * the product was previously synced — see TRD §0.4).
 */
@Injectable()
export class CatalogTransformerService {
  transform(
    product: OsItemProduct,
    productIdType: ProductIdType,
    storefrontBaseUrl: string,
  ): MetaProductDto[] {
    // Only published/active products belong in the catalog.
    if (!this.isActive(product.status)) return [];

    const base = storefrontBaseUrl.replace(/\/+$/, '');
    const url = `${base}/products/${product.handle ?? product.id}`;
    const description = this.stripHtml(product.body_html ?? '') || (product.title ?? '');
    const images = this.images(product);
    const featured = images[0] ?? '';
    const additional = images.slice(1);
    const brand = product.vendor ?? '';
    const name = (product.title ?? '').slice(0, 200);
    const variants = product.variants ?? [];

    // product_id → single parent item.
    if (productIdType === 'product_id') {
      const inventory = variants.reduce((s, v) => s + this.qty(v), 0);
      return [
        this.clean({
          retailerId: product.id,
          name,
          description,
          url,
          imageUrl: featured,
          additionalImageUrls: additional,
          availability: this.availability(product, inventory, variants),
          price: this.metaPrice(product.compare_at_price ?? product.compareAtPrice, product.price),
          salePrice: this.salePrice(product.compare_at_price ?? product.compareAtPrice, product.price),
          currency: 'INR',
          condition: 'new',
          brand,
          category: product.google_product_category ?? product.googleProductCategory,
          productType: product.product_type,
          inventory,
        }),
      ];
    }

    // sku / variant_id → one item per variant (item_group_id = parent).
    // Products with no variants still emit one item, keyed off the product.
    if (variants.length === 0) {
      return [
        this.clean({
          retailerId: productIdType === 'sku' ? (product.sku ?? product.id) : product.id,
          name,
          description,
          url,
          imageUrl: featured,
          additionalImageUrls: additional,
          availability: this.availability(product, this.qty(product as OsItemVariant), []),
          price: this.metaPrice(product.compare_at_price ?? product.compareAtPrice, product.price),
          salePrice: this.salePrice(product.compare_at_price ?? product.compareAtPrice, product.price),
          currency: 'INR',
          condition: 'new',
          brand,
          productType: product.product_type,
          inventory: this.qty(product as OsItemVariant),
        }),
      ];
    }

    return variants
      .map((v) => {
        const retailerId = productIdType === 'sku' ? v.sku : v.id;
        if (!retailerId) return null; // can't address this variant — skip
        const vQty = this.qty(v);
        const vCompare = v.compare_at_price ?? v.compareAtPrice;
        const weight = this.weight(v);
        return this.clean({
          retailerId,
          itemGroupId: product.id,
          name: `${name}${v.title ? ` - ${v.title}` : ''}`.slice(0, 200),
          description,
          url,
          imageUrl: this.imageUrl(v.image) || featured,
          additionalImageUrls: additional,
          availability: this.variantAvailability(product, vQty),
          price: this.metaPrice(vCompare, v.price ?? product.price),
          salePrice: this.salePrice(vCompare, v.price ?? product.price),
          currency: 'INR',
          condition: 'new',
          brand,
          productType: product.product_type,
          color: this.optionValue(v, 'color'),
          size: this.optionValue(v, 'size'),
          inventory: vQty,
          ...(weight ? { shippingWeight: weight } : {}),
        });
      })
      .filter((x): x is MetaProductDto => x !== null);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private isActive(status?: string): boolean {
    const s = (status ?? '').toLowerCase();
    return s === 'active' || s === 'published';
  }

  /** Availability for a parent/single item from stock policy (TRD §5.5). */
  private availability(
    product: OsItemProduct,
    inventory: number,
    variants: OsItemVariant[],
  ): MetaAvailability {
    if (!product.track_inventory) return 'in stock';
    const anyStock = variants.length
      ? variants.some((v) => this.qty(v) > 0)
      : inventory > 0;
    if (anyStock) return 'in stock';
    if (product.continue_selling_out_of_stock) return 'in stock';
    return 'out of stock';
  }

  private variantAvailability(product: OsItemProduct, qty: number): MetaAvailability {
    if (!product.track_inventory) return 'in stock';
    if (qty > 0) return 'in stock';
    if (product.continue_selling_out_of_stock) return 'in stock';
    return 'out of stock';
  }

  private qty(v: OsItemVariant): number {
    return v.inventory_quantity ?? v.inventoryQuantity ?? 0;
  }

  /**
   * Meta `price` = the original/list price (shown crossed-out when on sale).
   * When compare_at > price → use compare_at as the list price.
   * When no compare_at → use price as-is.
   */
  private metaPrice(compareAt: number | undefined, price: number | undefined): number {
    const p = price ?? 0;
    return compareAt !== undefined && compareAt > p ? compareAt : p;
  }

  /**
   * Meta `sale_price` = the actual selling price, only set when there's a real
   * discount (compare_at strictly greater than price).
   * No compare_at → no sale_price (Meta just shows price as-is).
   */
  private salePrice(compareAt: number | undefined, price: number | undefined): number | undefined {
    if (compareAt === undefined || price === undefined) return undefined;
    return compareAt > price ? price : undefined;
  }

  private images(product: OsItemProduct): string[] {
    const list = (product.images ?? [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((i) => this.imageUrl(i))
      .filter((s): s is string => Boolean(s));
    const featured = this.imageUrl(product.image);
    if (featured && !list.includes(featured)) list.unshift(featured);
    return list;
  }

  private imageUrl(img: OsItemImage | string | null | undefined): string {
    if (!img) return '';
    if (typeof img === 'string') return img;
    return img.src ?? img.url ?? '';
  }

  private weight(v: OsItemVariant): { unit: string; value: number } | undefined {
    if (typeof v.weight !== 'number' || !v.weight) return undefined;
    return { unit: v.weight_unit ?? 'kg', value: v.weight };
  }

  private optionValue(v: OsItemVariant, name: string): string | undefined {
    const opts = v.option_values ?? v.optionValues ?? [];
    const hit = opts.find((o) => (o.name ?? '').toLowerCase() === name);
    return hit?.value;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 9999);
  }

  /**
   * Drop undefined optionals so the output is clean for hashing + serialization.
   * Takes a loose record (callers build literals with `salePrice: number |
   * undefined`, which `exactOptionalPropertyTypes` forbids on the strict DTO);
   * the JSON round-trip strips undefined keys → a valid MetaProductDto.
   */
  private clean(dto: Record<string, unknown>): MetaProductDto {
    return JSON.parse(JSON.stringify(dto)) as MetaProductDto;
  }
}
