import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { MetaRatioTokenProvider } from '../oauth/ratio-token.provider';
import { META_RATIO } from '../tokens';
import type { OsItemProduct } from './catalog.types';

type Rec = Record<string, unknown>;

const envelopeSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

function asArray(v: unknown): Rec[] | null {
  return Array.isArray(v) ? (v as Rec[]) : null;
}

function extractItems(env: unknown): Rec[] {
  if (Array.isArray(env)) return env as Rec[];
  if (!env || typeof env !== 'object') return [];
  const o = env as Rec;
  const data = o.data;
  const nested = data && typeof data === 'object' ? (data as Rec) : null;
  return (
    asArray(data) ??
    asArray(o.products) ??
    asArray(o.items) ??
    asArray(o.results) ??
    (nested
      ? (asArray(nested.products) ??
        asArray(nested.items) ??
        asArray(nested.data) ??
        asArray(nested.results))
      : null) ??
    []
  );
}

function paginationOf(env: unknown): Rec | null {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  const o = env as Rec;
  const nested = o.data && typeof o.data === 'object' ? (o.data as Rec) : null;
  const pag = o.pagination ?? o.meta ?? nested?.pagination;
  return pag && typeof pag === 'object' ? (pag as Rec) : null;
}

function extractTotalItems(env: unknown): number | null {
  const pag = paginationOf(env);
  const top = env && typeof env === 'object' && !Array.isArray(env) ? (env as Rec) : null;
  const t = pag?.total ?? pag?.totalItems ?? pag?.totalCount ?? pag?.count ?? top?.total;
  return typeof t === 'number' && t >= 0 ? t : null;
}

function hasNextPage(env: unknown): boolean {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return false;
  const o = env as Rec;
  // Explicit false = no more pages; undefined/true = keep going
  return o.hasNext !== false;
}

@Injectable()
export class CatalogSourceService {
  private readonly logger = new Logger(CatalogSourceService.name);
  // The products API caps the page size at 10. Requesting more returns page 1's
  // rows for every page, so always request exactly 10.
  private static readonly PAGE_SIZE = 10;
  private static readonly MAX_PAGES = 1000;
  private static readonly FILTERS = 'status=active&published=true&show_variants=true';

  constructor(
    private readonly tokenProvider: MetaRatioTokenProvider,
    @Inject(META_RATIO) private readonly ratio: RatioClient,
  ) {}

  async eachPage(
    merchantId: string,
    onPage: (products: OsItemProduct[]) => Promise<void>,
    isCancelled?: () => boolean,
  ): Promise<number> {
    const accessToken = await this.tokenProvider.getAccessToken(merchantId);
    let total = 0;

    // os-item caps page size at ~10 regardless of the requested limit.
    // Page via the API's own hasNext signal rather than "fewer items than limit".
    for (let page = 1; page <= CatalogSourceService.MAX_PAGES; page++) {
      if (isCancelled?.()) {
        this.logger.warn({ msg: 'ratio products paging cancelled', merchantId, page });
        break;
      }
      const env = await this.request(
        `page=${page}&limit=${CatalogSourceService.PAGE_SIZE}&${CatalogSourceService.FILTERS}`,
        accessToken,
      );
      const items = this.toProducts(extractItems(env));
      if (items.length === 0) break;
      total += items.length;
      await onPage(items);
      if (!hasNextPage(env)) break;
    }

    this.logger.log({ msg: 'streamed ratio products', merchantId, count: total });
    return total;
  }

  /**
   * Normalize a raw Ratio REST `/api/v1/v1/products` item into the
   * `OsItemProduct` shape the transformer expects.
   *
   * The only structural difference vs os-item is option handling:
   *   Ratio REST:  variant.option1/2/3  +  product.options[].name
   *   OsItemProduct: variant.option_values: [{name, value}]
   * All other fields (id, title, body_html, handle, vendor, product_type,
   * status, price, compare_at_price, images[].src, variants[].inventory_quantity)
   * are identical.
   */
  private normalize(raw: Rec): OsItemProduct | null {
    const id = typeof raw.id === 'string' ? raw.id : String(raw.id ?? '');
    if (!id) return null;

    const optionNames: (string | null)[] = Array.isArray(raw.options)
      ? (raw.options as Rec[]).map((o) => (typeof o.name === 'string' ? o.name : null))
      : [];

    const variants = Array.isArray(raw.variants)
      ? (raw.variants as Rec[]).map((v) => {
          const optionValues: { name: string; value: string }[] = [];
          for (const [i, key] of (['option1', 'option2', 'option3'] as const).entries()) {
            const val = v[key];
            const name = optionNames[i];
            if (typeof val === 'string' && val && val !== 'Default Title' && name && name !== 'Title') {
              optionValues.push({ name, value: val });
            }
          }
          return { ...v, option_values: optionValues };
        })
      : [];

    return { ...raw, id, variants } as unknown as OsItemProduct;
  }

  private toProducts(items: Rec[]): OsItemProduct[] {
    return items
      .map((p) => this.normalize(p))
      .filter((p): p is OsItemProduct => p !== null);
  }

  private request(query: string, accessToken: string): Promise<unknown> {
    return this.ratio.request(
      `/api/v1/v1/products?${query}`,
      envelopeSchema,
      { accessToken },
    );
  }
}
