import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { FbtMerchantTokenGuard } from '../guards';
import { type FbtCatalogCollection, FbtRatioCollectionsService } from './ratio-collections.service';
import { type FbtCatalogProduct, FbtRatioProductsService } from './ratio-products.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Bound the by-ids fan-out: each id costs one upstream request. */
const MAX_IDS = 50;

function clampLimit(raw?: string): number {
  return Math.min(MAX_LIMIT, Math.max(1, Number(raw) || DEFAULT_LIMIT));
}

/** Parses a `'true'`/`'false'` query string to a boolean; anything else
 * (including absence) stays `undefined` so the service's own default applies. */
function parseBoolFlag(raw?: string): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/** Product and collection pickers for the admin's bundle editor. */
@Controller('fbt/api/catalog')
@UseGuards(FbtMerchantTokenGuard)
export class FbtCatalogController {
  constructor(
    private readonly products: FbtRatioProductsService,
    private readonly collections: FbtRatioCollectionsService,
  ) {}

  @Get('products')
  searchProducts(
    @CurrentMerchant() merchant: Merchant,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.products.search(merchant.id, {
      ...(search ? { search } : {}),
      page: Math.max(1, Number(page) || 1),
      limit: clampLimit(limit),
    });
  }

  /** Hydrate stored bundle product ids back into display rows. */
  @Get('products/by-ids')
  async productsByIds(
    @CurrentMerchant() merchant: Merchant,
    @Query('ids') ids?: string,
  ): Promise<{ items: FbtCatalogProduct[] }> {
    const parsed = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS);
    return { items: await this.products.byIds(merchant.id, parsed) };
  }

  // No `search` param: the two confirmed collections endpoints
  // (`GET /collections`, `GET /collections/{id}`) don't have one, so this
  // controller no longer accepts it — unlike `products`, which does.
  @Get('collections')
  listCollections(
    @CurrentMerchant() merchant: Merchant,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('published') published?: string,
    @Query('includeProducts') includeProducts?: string,
  ): Promise<{ items: FbtCatalogCollection[]; page: number; limit: number }> {
    const publishedFlag = parseBoolFlag(published);
    const includeProductsFlag = parseBoolFlag(includeProducts);
    return this.collections.list(merchant.id, {
      page: Math.max(1, Number(page) || 1),
      limit: clampLimit(limit),
      ...(publishedFlag !== undefined ? { published: publishedFlag } : {}),
      ...(includeProductsFlag !== undefined ? { includeProducts: includeProductsFlag } : {}),
    });
  }
}
