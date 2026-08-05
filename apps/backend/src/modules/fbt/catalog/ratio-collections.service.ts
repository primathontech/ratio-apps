import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { FbtRatioTokenProvider } from '../oauth/ratio-token.provider';
import { FBT_RATIO } from '../tokens';

/** Picker shape the admin renders for collection scoping. Same intent as `FbtCatalogProduct`. */
export interface FbtCatalogCollection {
  id: string;
  title: string;
  handle: string | null;
}

// PROVISIONAL: the user has confirmed the two endpoint shapes below
// (`GET /api/v1/v1/collections` and `GET /api/v1/v1/collections/{id}`) but has
// NOT yet supplied the response body schema — they will provide it later
// (task-9 brief). Until then this parses tolerantly, the same way
// `ratio-products.service.ts` does for products:
//   - `id` may be a string OR a number; coerced to a string either way.
//   - `title` defaults to `''` when absent.
//   - `handle` is nullish-tolerant and normalised to `null`.
// Do NOT add fields beyond `id`/`title`/`handle` here without the real schema
// in hand — a confident-looking mapping over a schema nobody has seen would
// be worse than this honest placeholder. When the real schema arrives,
// replace `collectionSchema` (and the envelope unions below it) and delete
// this comment.
const collectionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().default(''),
  handle: z.string().nullish(),
});

/**
 * Tolerant list envelope — mirrors `ratio-products.service.ts`'s `envelopeSchema`
 * exactly. The wrapper shape for the list endpoint is unconfirmed, so accept
 * all four shapes products already tolerates rather than guessing one.
 */
const listEnvelopeSchema = z.union([
  z.object({ data: z.object({ collections: z.array(collectionSchema) }) }),
  z.object({ data: z.array(collectionSchema) }),
  z.object({ collections: z.array(collectionSchema) }),
  z.array(collectionSchema),
]);

function unwrapList(
  parsed: z.infer<typeof listEnvelopeSchema>,
): Array<z.infer<typeof collectionSchema>> {
  if (Array.isArray(parsed)) return parsed;
  if ('collections' in parsed) return parsed.collections;
  if (Array.isArray(parsed.data)) return parsed.data;
  return parsed.data.collections;
}

/**
 * Tolerant single-collection envelope — mirrors `ratio-products.service.ts`'s
 * per-id schema in `byIds`. Also unconfirmed; accepts a `data`-wrapped or bare
 * collection object.
 */
const singleEnvelopeSchema = z.union([z.object({ data: collectionSchema }), collectionSchema]);

// PROVISIONAL: see the note above `collectionSchema` — the same caveat
// applies to this mapping. `id` is coerced with `String(...)` here as well as
// in the schema itself: defense in depth so a numeric id is never leaked to
// the picker shape even if something upstream of this function (a schema
// change, a test double) skips the zod transform.
function normalise(c: z.infer<typeof collectionSchema>): FbtCatalogCollection {
  return {
    id: String(c.id),
    title: c.title,
    handle: c.handle ?? null,
  };
}

/**
 * Collection search + single-collection lookup against the Ratio API, for the
 * admin bundle editor's collection-scoping picker.
 *
 * Formerly served by a separate, unauthenticated OpenStore storefront service
 * (`FbtOsStorefrontClient`, deleted by this change) because the Ratio API had
 * no collections resource — see ADR 0007. The Ratio API now has one, which was
 * that ADR's named exit condition, so this mirrors `FbtRatioProductsService`
 * exactly: same client, same bearer-token merchant scoping (there is no
 * `storeId`/merchant request parameter — scoping comes entirely from the
 * access token), same doubled-`v1` path quirk.
 *
 * Unlike the deleted client, failures here PROPAGATE rather than degrading to
 * an empty list: this is the same first-party, OAuth-scoped Ratio API as
 * products, not an untrusted third party on a different host, so there is no
 * reason to hide an upstream failure from the caller.
 *
 * The path is `/api/v1/v1/collections` — the doubled `v1` is intentional and
 * matches every other Ratio-backed catalog call in this module.
 */
@Injectable()
export class FbtRatioCollectionsService {
  constructor(
    @Inject(FBT_RATIO) private readonly ratio: RatioClient,
    private readonly tokens: FbtRatioTokenProvider,
  ) {}

  async list(
    merchantId: string,
    opts: { page: number; limit: number; published?: boolean; includeProducts?: boolean },
  ): Promise<{ items: FbtCatalogCollection[]; page: number; limit: number }> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    const params = new URLSearchParams({
      page: String(opts.page),
      limit: String(opts.limit),
      // `??`, not `||` — an explicit `false` must survive, not get coerced
      // back to the default `true`.
      published: String(opts.published ?? true),
      includeProducts: String(opts.includeProducts ?? false),
    });

    const raw = await this.ratio.request(
      `/api/v1/v1/collections?${params.toString()}`,
      listEnvelopeSchema,
      { accessToken },
    );
    return { items: unwrapList(raw).map(normalise), page: opts.page, limit: opts.limit };
  }

  /**
   * Single-collection lookup by id.
   *
   * PROVISIONAL: the `| null` in the return type matches the interface this
   * service is built against, but there is no confirmed "not found" contract
   * for this endpoint yet, and design decision 2 (errors propagate) applies
   * here too — a missing/failed lookup throws via `RatioClient`, exactly like
   * every other failure, rather than resolving to `null`. Revisit once the
   * real not-found behaviour is confirmed.
   */
  async getById(
    merchantId: string,
    id: string,
    opts: { includeProducts?: boolean } = {},
  ): Promise<FbtCatalogCollection | null> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    const params = new URLSearchParams({
      includeProducts: String(opts.includeProducts ?? false),
    });

    const raw = await this.ratio.request(
      `/api/v1/v1/collections/${encodeURIComponent(id)}?${params.toString()}`,
      singleEnvelopeSchema,
      { accessToken },
    );
    const c = 'data' in raw ? raw.data : raw;
    return normalise(c);
  }
}
