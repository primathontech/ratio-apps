import { Controller, Get, Logger, Query, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RawResponse } from '../../../core/common/decorators/raw-response.decorator';
import { UcApiKeyGuard } from '../guards';
import { UcCatalogService } from '../services/catalog.service';
import { UcEventLogService } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';

@ApiTags('unicommerce')
@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
@RawResponse()
export class UcCatalogController {
  private readonly logger = new Logger(UcCatalogController.name);

  constructor(
    private readonly catalog: UcCatalogService,
    private readonly eventLog: UcEventLogService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  @Get('productsCount')
  @ApiOperation({
    summary: 'Total live product count (pre-pagination)',
    description:
      'Unicommerce calls this before pulling the catalog, to size its own paging loop.',
  })
  @ApiHeader({
    name: 'apikey',
    required: true,
    description: 'Access token issued by /authToken (TTL ~48h). Identifies the merchant.',
    example: 'pX7vK2mQ9nL4wR8tY5bH1cJ3dF6gS0zA7eU2iM4k',
  })
  @ApiResponse({
    status: 200,
    description:
      'Total count of live variants across all published, active products for the merchant.',
    schema: {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          example: 1274,
          description: 'Total variant count across all pages (never negative).',
        },
      },
      required: ['count'],
    },
  })
  async count(@Req() req: FastifyRequest & { ucMerchantId: string }) {
    // TRD §6: accept-and-no-op when disabled — never hard-reject, since UC
    // has no concept of a merchant-disabled flow.
    if (!(await this.featureFlags.isEnabled('product_sync', req.ucMerchantId))) {
      return { count: 0 };
    }
    // Never let a downstream failure (Ratio API error, expired OAuth token,
    // network blip) escape as an uncaught exception — degrade to a clean
    // count:0 (UC just sees nothing new this poll and retries later) rather
    // than an opaque 500. Still logged as a 'failed' event below — found via
    // manual testing that the old early-return skipped logging entirely,
    // making degraded pulls invisible in the admin app's Activity page.
    let result: { count: number };
    let logResult: 'success' | 'failed' = 'success';
    try {
      result = { count: await this.catalog.count(req.ucMerchantId) };
    } catch (err) {
      this.logger.error({
        msg: 'failed to fetch product count from Ratio',
        err: err instanceof Error ? err.message : String(err),
      });
      result = { count: 0 };
      logResult = 'failed';
    }
    // Fix 2: an event-log write failure must never turn this real success
    // into a 500 for Unicommerce — log-and-swallow instead of letting it
    // reject the handler.
    try {
      await this.eventLog.record({
        merchantId: req.ucMerchantId,
        direction: 'inbound',
        flow: 'catalog',
        reference: req.ucMerchantId,
        result: logResult,
        payload: {},
        response: result,
      });
    } catch (err) {
      this.logger.error({
        msg: 'event-log write failed for productsCount',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return result;
  }

  @Get('products')
  @ApiOperation({
    summary: 'Paginated catalog pull',
    description:
      'Unicommerce calls this to pull the live catalog, one 50 product page at a time.',
  })
  @ApiHeader({
    name: 'apikey',
    required: true,
    description: 'Access token issued by /authToken (TTL ~48h). Identifies the merchant.',
    example: 'pX7vK2mQ9nL4wR8tY5bH1cJ3dF6gS0zA7eU2iM4k',
  })
  @ApiQuery({
    name: 'pageNumber',
    required: false,
    description:
      '1-indexed page number. Defaults to 1 when absent or non-numeric. Page size is fixed at 50.',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description:
      "One page of the merchant's live catalog in UC's own shape. `products` is empty when the sync flag is disabled or a downstream pull failed.",
    schema: {
      type: 'object',
      properties: {
        products: {
          type: 'array',
          description: 'Up to 50 products for the requested page.',
          example: [
            {
              id: 'gid://shopify/Product/8123456789012',
              parentTitle: 'Classic Cotton T-Shirt',
              brand: 'Ratio Apparel',
              variants: [
                {
                  variantId: 'gid://shopify/Variant/4345678901234',
                  title: 'Classic Cotton T-Shirt / S / Navy',
                  sku: 'CCT-NAVY-S',
                  size: null,
                  live: true,
                  imageUrl:
                    'https://cdn.shopify.com/s/files/1/0123/4567/8901/products/cct-navy-s.jpg',
                  productUrl: 'https://shop.example.com/products/classic-cotton-t-shirt',
                  inventory: 42,
                  itemPrice: {
                    currency: 'INR',
                    listingPrice: 699,
                    mrp: 999,
                    msp: 599,
                    netSellerPayable: 699,
                  },
                },
                {
                  variantId: 'gid://shopify/Variant/4345678901235',
                  title: 'Classic Cotton T-Shirt / L / Navy',
                  sku: 'CCT-NAVY-L',
                  size: null,
                  live: true,
                  imageUrl:
                    'https://cdn.shopify.com/s/files/1/0123/4567/8901/products/cct-navy-l.jpg',
                  productUrl: 'https://shop.example.com/products/classic-cotton-t-shirt',
                  inventory: 18,
                  itemPrice: {
                    currency: 'INR',
                    listingPrice: 699,
                    mrp: 999,
                    msp: 599,
                    netSellerPayable: 699,
                  },
                },
              ],
            },
          ],
        },
      },
      required: ['products'],
    },
  })
  async list(
    @Req() req: FastifyRequest & { ucMerchantId: string },
    @Query('pageNumber') pageNumber: string,
  ) {
    if (!(await this.featureFlags.isEnabled('product_sync', req.ucMerchantId))) {
      return { products: [] };
    }
    let products: Awaited<ReturnType<UcCatalogService['list']>>;
    let logResult: 'success' | 'failed' = 'success';
    try {
      products = await this.catalog.list(req.ucMerchantId, Number(pageNumber) || 1);
    } catch (err) {
      this.logger.error({
        msg: 'failed to fetch products from Ratio',
        err: err instanceof Error ? err.message : String(err),
      });
      products = [];
      logResult = 'failed';
    }
    try {
      await this.eventLog.record({
        merchantId: req.ucMerchantId,
        direction: 'inbound',
        flow: 'catalog',
        reference: req.ucMerchantId,
        result: logResult,
        payload: { pageNumber },
        response: { count: products.length },
      });
    } catch (err) {
      this.logger.error({
        msg: 'event-log write failed for products list',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { products };
  }
}
