import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { z } from 'zod';

/** Picker shape for a collection. */
export interface FbtCatalogCollection {
  id: string;
  title: string;
  handle: string | null;
}

export const FBT_OS_STOREFRONT_URL_TOKEN = Symbol.for('ratio-app:fbt:os-storefront-url');

const collectionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().default(''),
  handle: z.string().nullish(),
});

const envelopeSchema = z.union([
  z.object({ data: z.object({ collections: z.array(collectionSchema) }) }),
  z.object({ collections: z.array(collectionSchema) }),
  z.array(collectionSchema),
]);

/** How long we are willing to wait on a third-party service we do not own. */
const TIMEOUT_MS = 5_000;

/**
 * Collections come from the OpenStore storefront REST API, NOT from Ratio — the
 * Ratio API has no collections resource at all (documented resources are only
 * `products` and `orders`). This is the one place FBT talks to a second backend.
 *
 * Two properties of that service shape this client:
 *   1. It authenticates with a `gk-merchant-id` header and no OAuth. We
 *      deliberately do not forward the merchant's Ratio access token — it buys
 *      nothing and widens the token's blast radius.
 *   2. We do not own it. Every failure path (unset URL, network error, non-2xx,
 *      malformed body, timeout) degrades to an empty list, so the bundle editor
 *      loses one picker instead of erroring out entirely.
 */
@Injectable()
export class FbtOsStorefrontClient {
  private readonly logger = new Logger(FbtOsStorefrontClient.name);

  constructor(
    @Optional()
    @Inject(FBT_OS_STOREFRONT_URL_TOKEN)
    private readonly baseUrl: string | undefined,
  ) {}

  async listCollections(
    merchantId: string,
    opts: { search?: string; page: number; limit: number },
  ): Promise<FbtCatalogCollection[]> {
    if (!this.baseUrl) {
      this.logger.warn('FBT_OS_STOREFRONT_URL is not set — returning no collections');
      return [];
    }

    const params = new URLSearchParams({
      storeId: merchantId,
      page: String(opts.page),
      limit: String(opts.limit),
    });
    if (opts.search) params.set('search', opts.search);

    const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/collections?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'gk-merchant-id': merchantId,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`collections request failed with status ${res.status}`);
        return [];
      }
      const parsed = envelopeSchema.safeParse(await res.json());
      if (!parsed.success) {
        this.logger.warn('collections response did not match any known shape');
        return [];
      }
      const data = parsed.data;
      const rows = Array.isArray(data)
        ? data
        : 'collections' in data
          ? data.collections
          : data.data.collections;
      return rows.map((c) => ({ id: c.id, title: c.title, handle: c.handle ?? null }));
    } catch (err) {
      this.logger.warn(
        `collections request errored: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
