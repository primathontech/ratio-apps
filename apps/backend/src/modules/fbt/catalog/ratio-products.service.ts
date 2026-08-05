import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { FbtRatioTokenProvider } from '../oauth/ratio-token.provider';
import { FBT_RATIO } from '../tokens';

/** Picker shape the admin renders. Deliberately small — this is a search result. */
export interface FbtCatalogProduct {
  id: string;
  title: string;
  handle: string | null;
  imageUrl: string | null;
  price: number | null;
}

/**
 * Tolerant envelope. The list endpoint's wrapper varies by environment, so we
 * accept several shapes rather than 500-ing the admin's product picker on a
 * wrapper change. Same approach as `wizzy/catalog/ratio-products.service.ts`.
 */
const productSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().default(''),
  handle: z.string().nullish(),
  price: z.number().nullish(),
  images: z.array(z.object({ src: z.string().nullish() })).nullish(),
});

const envelopeSchema = z.union([
  z.object({ data: z.object({ products: z.array(productSchema) }) }),
  z.object({ data: z.array(productSchema) }),
  z.object({ products: z.array(productSchema) }),
  z.array(productSchema),
]);

function unwrap(parsed: z.infer<typeof envelopeSchema>): Array<z.infer<typeof productSchema>> {
  if (Array.isArray(parsed)) return parsed;
  if ('products' in parsed) return parsed.products;
  if (Array.isArray(parsed.data)) return parsed.data;
  return parsed.data.products;
}

function normalise(p: z.infer<typeof productSchema>): FbtCatalogProduct {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle ?? null,
    imageUrl: p.images?.find((i) => i.src)?.src ?? null,
    price: p.price ?? null,
  };
}

/**
 * Product search + hydration against the Ratio API, for the admin's product
 * picker and for turning stored bundle product ids back into display rows.
 *
 * The path is `/api/v1/v1/products` — the doubled `v1` is intentional. The
 * published docs say `/api/v1/products`, but every vendor in this monorepo
 * calls the doubled form against the live gateway. Follow the repo.
 */
@Injectable()
export class FbtRatioProductsService {
  private readonly logger = new Logger(FbtRatioProductsService.name);

  constructor(
    @Inject(FBT_RATIO) private readonly ratio: RatioClient,
    private readonly tokens: FbtRatioTokenProvider,
  ) {}

  async search(
    merchantId: string,
    opts: { search?: string; page: number; limit: number },
  ): Promise<{ items: FbtCatalogProduct[]; page: number; limit: number }> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    const params = new URLSearchParams({
      page: String(opts.page),
      limit: String(opts.limit),
      status: 'active',
    });
    if (opts.search) params.set('search', opts.search);

    const raw = await this.ratio.request(
      `/api/v1/v1/products?${params.toString()}`,
      envelopeSchema,
      { accessToken },
    );
    return { items: unwrap(raw).map(normalise), page: opts.page, limit: opts.limit };
  }

  /**
   * Hydrate specific ids. The Ratio API has no batch-by-ids endpoint, so this
   * fans out one by-id request per id and drops the ones that fail — a product
   * deleted since the bundle was saved must not break the whole editor.
   */
  async byIds(merchantId: string, ids: string[]): Promise<FbtCatalogProduct[]> {
    if (ids.length === 0) return [];
    const accessToken = await this.tokens.getAccessToken(merchantId);

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const raw = await this.ratio.request(
            `/api/v1/v1/products/${encodeURIComponent(id)}?show_variants=true`,
            z.union([z.object({ data: productSchema }), productSchema]),
            { accessToken },
          );
          const p = 'data' in raw ? raw.data : raw;
          return normalise(p);
        } catch (err) {
          this.logger.warn(
            `product ${id} could not be hydrated for merchant ${merchantId}: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          );
          return null;
        }
      }),
    );
    return results.filter((p): p is FbtCatalogProduct => p !== null);
  }
}
