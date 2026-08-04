import { Injectable } from '@nestjs/common';
import { UcRatioApiService } from './uc-ratio-api.service';

export interface UcVariant {
  variantId: string;
  title: string;
  sku: string;
  size: { length: number; breadth: number; height: number } | null; // ⚠️ always null today — no source field on Ratio's side, confirmed absent against a live payload. Populate once a source is decided (platform field, or merchant input captured at connect-time).
  live: boolean;
  imageUrl: string | null;
  productUrl: string;
  inventory: number;
  itemPrice: {
    currency: 'INR';
    listingPrice: number;
    mrp: number;
    msp: number;
    netSellerPayable: number;
  };
}

export interface UcProduct {
  id: string;
  parentTitle: string;
  brand: string;
  variants: UcVariant[];
}

interface RatioVariant {
  id: string;
  title: string;
  sku: string;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  cost_per_item: number | null;
  inventory?: { quantity: number };
}

interface RatioProduct {
  id: string;
  title: string;
  vendor: string;
  handle: string;
  status: string;
  published_at: string | null;
  variants: RatioVariant[];
}

@Injectable()
export class UcCatalogService {
  // Unicommerce's own fixed page size for OUR inbound `pageNumber` contract
  // (catalog.controller.ts) — NOT Ratio's real API page size, which is capped
  // far smaller (see UcRatioApiService.listProducts). We translate Unicommerce's
  // 1-indexed `pageNumber` into a Ratio-facing offset/limit pair below.
  private readonly pageSize = 50;

  constructor(
    private readonly ratio: UcRatioApiService,
    private readonly storefrontDomain: string,
  ) {}

  private mapVariant(v: RatioVariant): UcVariant {
    const mrp = v.compareAtPrice ?? v.price;
    const msp = v.cost_per_item ?? v.price;
    return {
      variantId: v.id,
      title: v.title,
      sku: v.sku,
      size: null,
      live: true, // overwritten by mapProduct using the parent's status/published_at
      imageUrl: v.imageUrl,
      productUrl: '',
      inventory: v.inventory?.quantity ?? 0,
      itemPrice: {
        currency: 'INR',
        listingPrice: v.price,
        mrp,
        msp,
        netSellerPayable: v.price - msp,
      },
    };
  }

  private mapProduct(p: RatioProduct): UcProduct {
    const live = p.status === 'active' && p.published_at != null;
    const productUrl = `${this.storefrontDomain}/products/${p.handle}`;
    return {
      id: p.id,
      parentTitle: p.title,
      brand: p.vendor,
      variants: p.variants.map((v) => ({ ...this.mapVariant(v), live, productUrl })),
    };
  }

  async list(merchantId: string, pageNumber: number): Promise<UcProduct[]> {
    const offset = (pageNumber - 1) * this.pageSize;
    const products = (await this.ratio.listProducts(merchantId, {
      offset,
      limit: this.pageSize,
    })) as unknown as RatioProduct[];
    return products.map((p) => this.mapProduct(p));
  }

  async count(merchantId: string): Promise<number> {
    // offset loop until a short page — Ratio's list endpoint has no
    // dedicated count endpoint, so this walks Unicommerce-sized pages (50)
    // by offset until the last one comes back short.
    let total = 0;
    let offset = 0;
    for (;;) {
      const products = (await this.ratio.listProducts(merchantId, {
        offset,
        limit: this.pageSize,
      })) as unknown as RatioProduct[];
      total += products.reduce((sum, p) => sum + Math.max(p.variants.length, 1), 0);
      if (products.length < this.pageSize) break;
      offset += this.pageSize;
    }
    return total;
  }
}
