import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_CRYPTO, GOOGLE_RATIO } from '../tokens';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
import type { RatioProductsPort } from './feed-sync.service';
import type { RatioProduct, RatioVariant } from './product-mapper';

/** Ratio money fields are integer paise; GMC wants major units (₹). */
const paiseToMajor = (paise: number | null | undefined): number | null =>
  paise === null || paise === undefined ? null : paise / 100;

const variantSchema = z
  .object({
    id: z.string(),
    price: z.number().nullable().optional(),
    compare_at_price: z.number().nullable().optional(),
    sku: z.string().nullable().optional(),
    barcode: z.string().nullable().optional(),
    inventory_quantity: z.number().nullable().optional(),
    options: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const productSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    body_html: z.string().nullable().optional(),
    handle: z.string(),
    product_type: z.string().nullable().optional(),
    vendor: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
    compare_at_price: z.number().nullable().optional(),
    sku: z.string().nullable().optional(),
    barcode: z.string().nullable().optional(),
    images: z.array(z.object({ src: z.string() }).passthrough()).nullable().optional(),
    variants: z.array(variantSchema).nullable().optional(),
  })
  .passthrough();

// The list endpoint's envelope shape isn't pinned in the docs — accept the
// common shapes (`{ data }`, `{ products }`, bare array) defensively. Verify
// against the live `GET /api/v1/products` response when integrating (TRD R-products).
const listSchema = z
  .object({
    data: z.array(productSchema).optional(),
    products: z.array(productSchema).optional(),
  })
  .passthrough();

type RatioApiProduct = z.infer<typeof productSchema>;

/**
 * Concrete {@link RatioProductsPort}: reads the merchant's Ratio access token
 * from `oauth_tokens`, pages `GET /api/v1/products?show_variants=true`, and maps
 * each product (+ variants, money paise→major) into the mapper's `RatioProduct`.
 */
@Injectable()
export class RatioProductsService implements RatioProductsPort {
  private readonly pageSize = 100;

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    @Inject(GOOGLE_CRYPTO) private readonly crypto: CryptoService,
    @Inject(GOOGLE_RATIO) private readonly ratio: RatioClient,
  ) {}

  async listAll(merchantId: string): Promise<RatioProduct[]> {
    const tokenRow = await this.handle.db
      .selectFrom('oauth_tokens')
      .select(['accessTokenEnc'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!tokenRow) return [];
    const accessToken = this.crypto.decrypt(tokenRow.accessTokenEnc);

    const out: RatioProduct[] = [];
    for (let page = 1; ; page++) {
      const res = await this.ratio.request(
        `/api/v1/products?limit=${this.pageSize}&page=${page}&show_variants=true`,
        listSchema,
        { accessToken },
      );
      const batch = res.data ?? res.products ?? [];
      for (const p of batch) out.push(this.toRatioProduct(p));
      if (batch.length < this.pageSize) break;
    }
    return out;
  }

  private toRatioProduct(p: RatioApiProduct): RatioProduct {
    const variants: RatioVariant[] =
      p.variants && p.variants.length > 0
        ? p.variants.map((v) => ({
            id: v.id,
            price: paiseToMajor(v.price),
            compareAtPrice: paiseToMajor(v.compare_at_price),
            sku: v.sku ?? null,
            barcode: v.barcode ?? null,
            inventoryQuantity: v.inventory_quantity ?? null,
            ...(v.options ? { options: v.options } : {}),
          }))
        : [
            // Single-variant product — synthesize a variant from product-level fields.
            {
              id: p.id,
              price: paiseToMajor(p.price),
              compareAtPrice: paiseToMajor(p.compare_at_price),
              sku: p.sku ?? null,
              barcode: p.barcode ?? null,
              inventoryQuantity: null,
            },
          ];

    return {
      id: p.id,
      title: p.title,
      description: p.body_html ?? null,
      handle: p.handle,
      vendor: p.vendor ?? null,
      productType: p.product_type ?? null,
      images: (p.images ?? []).map((img) => ({ src: img.src })),
      variants,
    };
  }
}
