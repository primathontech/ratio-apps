import { Controller, Get, Logger, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UcApiKeyGuard } from '../guards';
import { UcRatioApiService } from '../services/uc-ratio-api.service';

@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
export class UcOrdersReadController {
  private readonly logger = new Logger(UcOrdersReadController.name);

  constructor(private readonly ratio: UcRatioApiService) { }

  // TRD §2.3/§2.4, confirmed routing bug fix: UC calls the SAME path,
  // `GET /orders`, for both the mandatory bulk pull (`orderStatus=CREATED`)
  // and the single/multi-order status check (`orderIds=...`) — there is no
  // separate `/orders/status` path in UC's real contract. NestJS routes on
  // path, not query params, so these must be one handler that branches
  // internally, or the real `orderIds` request never reaches the status
  // logic at all.
  @Get('orders')
  async list(
    @Req() req: FastifyRequest & { ucMerchantId: string },
    @Query('pageNumber') pageNumber: string,
    @Query('pageSize') _ignoredCallerPageSize: string,
    @Query('orderStatus') orderStatus?: string,
    @Query('orderDateFrom') orderDateFrom?: string,
    @Query('orderDateTo') orderDateTo?: string,
    @Query('orderIds') orderIds?: string,
  ) {
    if (orderIds) {
      return this.statusLookup(req.ucMerchantId, orderIds);
    }

    const opts: { page: number; pageSize: number; orderStatus?: string; orderDateFrom?: string; orderDateTo?: string } = {
      page: Number(pageNumber) || 1,
      pageSize: 50,
    };
    if (orderStatus) opts.orderStatus = orderStatus;
    if (orderDateFrom) opts.orderDateFrom = orderDateFrom;
    if (orderDateTo) opts.orderDateTo = orderDateTo;
    // Never let a downstream failure (Ratio API error, expired OAuth token,
    // network blip) escape as an uncaught exception — UC's 10-minute bulk
    // pull just retries on its own next cycle, so degrading to an empty
    // list is safe; a raw 500 is not.
    try {
      const orders = await this.ratio.listOrders(req.ucMerchantId, opts);
      return { orders };
    } catch (err) {
      this.logger.error({ msg: 'failed to list orders from Ratio', err: err instanceof Error ? err.message : String(err) });
      return { orders: [] };
    }
  }

  // Confirmed by UC's team: `orderIds` accepts a comma-separated list, so
  // this can be a multi-order status check, not just one order per call.
  private async statusLookup(merchantId: string, orderIds: string) {
    const ids = orderIds.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (ids.length === 0) return { orders: [] };

    const mapToUcFormat = (order: Record<string, unknown>) => {
      const saleOrderCode = String(order.id);
      if (order.status === 'cancelled') return { saleOrderCode, orderStatus: 'CANCELLED', ...order };
      const fs = String(order.fulfillment_status || 'unfulfilled');
      let orderStatus = 'CREATED';
      if (fs === 'fulfilled' || fs === 'partially_fulfilled') orderStatus = 'DISPATCHED';
      else if (fs === 'delivered') orderStatus = 'DELIVERED';
      else if (fs === 'return_in_progress' || fs === 'return_pickup_scheduled') orderStatus = 'RETURN_REQUESTED';
      else if (fs === 'returned' || fs === 'restocked' || fs === 'return_failed') orderStatus = 'COURIER_RETURN';
      return { saleOrderCode, orderStatus, ...order };
    };

    if (ids.length === 1) {
      try {
        const order = await this.ratio.getOrder(merchantId, ids[0]!);
        return order ? { orders: [mapToUcFormat(order)] } : { orders: [] };
      } catch (err) {
        this.logger.error({ msg: 'failed to get order status from Ratio', orderId: ids[0], err: err instanceof Error ? err.message : String(err) });
        return { orders: [] };
      }
    }
    const results = await Promise.allSettled(ids.map((id) => this.ratio.getOrder(merchantId, id)));
    // A rejection here was previously dropped silently — indistinguishable
    // from a genuine "order not found". Logging it doesn't change the
    // response shape (still just the orders we DID resolve), but it stops
    // a real, ongoing Ratio-side failure from being invisible to ops.
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected.length > 0) {
      this.logger.error({
        msg: 'some order status lookups failed',
        count: rejected.length,
        errors: rejected.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))),
      });
    }
    return {
      orders: results
        .filter((r) => r.status === 'fulfilled' && r.value !== null)
        .map((r) => mapToUcFormat((r as PromiseFulfilledResult<Record<string, unknown>>).value)),
    };
  }
}
