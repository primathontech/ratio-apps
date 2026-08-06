import { Controller, Get, Logger, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RawResponse } from '../../../core/common/decorators/raw-response.decorator';
import { UcApiKeyGuard } from '../guards';
import { UcCatalogService } from '../services/catalog.service';
import { UcEventLogService } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';

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
