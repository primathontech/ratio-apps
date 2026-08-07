import { Controller, Get, Logger, Query, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RawResponse } from '../../../core/common/decorators/raw-response.decorator';
import { UcApiKeyGuard } from '../guards';
import { UcRatioApiService } from '../services/uc-ratio-api.service';

@ApiTags('unicommerce')
@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
@RawResponse()
export class UcOrdersReadController {
  private readonly logger = new Logger(UcOrdersReadController.name);

  constructor(private readonly ratio: UcRatioApiService) {}

  // TRD §2.3/§2.4, confirmed routing bug fix: UC calls the SAME path,
  // `GET /orders`, for both the mandatory bulk pull (`orderStatus=CREATED`)
  // and the single/multi-order status check (`orderIds=...`) — there is no
  // separate `/orders/status` path in UC's real contract. NestJS routes on
  // path, not query params, so these must be one handler that branches
  // internally, or the real `orderIds` request never reaches the status
  // logic at all.
  @Get('orders')
  @ApiOperation({
    summary: 'Bulk order pull (orderStatus=CREATED) OR order status lookup (orderIds=...)',
    description:
      'Unicommerce calls this to bulk pull open orders, or to look up specific order statuses.',
  })
  @ApiHeader({
    name: 'apikey',
    required: true,
    description: 'Access token issued by /authToken (TTL ~48h). Identifies the merchant.',
    example: 'pX7vK2mQ9nL4wR8tY5bH1cJ3dF6gS0zA7eU2iM4k',
  })
  @ApiQuery({
    name: 'orderIds',
    required: false,
    description:
      'Comma-separated list of Ratio order ids to look up (status-lookup mode). When present, overrides the bulk-pull mode. Whitespace around ids is trimmed; an empty list returns `{ orders: [] }`.',
    example: 'gid://shopify/Order/5432109876543,gid://shopify/Order/5432109876544',
  })
  @ApiQuery({
    name: 'orderStatus',
    required: false,
    description:
      "Bulk-pull filter. Only `CREATED` is meaningful — it maps to Ratio's `status=open&fulfillment_status=unfulfilled` (Ratio's Orders API has no orderStatus filter of its own; any other value is ignored).",
    example: 'CREATED',
  })
  @ApiQuery({
    name: 'pageNumber',
    required: false,
    description:
      '1-indexed page for the bulk pull. Defaults to 1 when absent or non-numeric. Page size is fixed at 50 server-side.',
    example: 1,
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    description:
      'Accepted for UC contract compatibility but IGNORED — the page size is always 50 server-side.',
    example: 50,
  })
  @ApiQuery({
    name: 'orderDateFrom',
    required: false,
    description:
      "Bulk-pull lower bound on the order creation date, inclusive. Filtered client-side after the unfiltered Ratio request (Ratio's API has no date-range param). IST-fixed format like UC's other timestamp fields.",
    example: '2026-08-01T00:00:00+05:30',
  })
  @ApiQuery({
    name: 'orderDateTo',
    required: false,
    description:
      "Bulk-pull upper bound on the order creation date, inclusive. Filtered client-side after the unfiltered Ratio request (Ratio's API has no date-range param). IST-fixed format like UC's other timestamp fields.",
    example: '2026-08-05T23:59:59+05:30',
  })
  @ApiResponse({
    status: 200,
    description:
      'Bulk-pull mode returns raw Shopify-shaped Ratio order objects (see `bulkPull` example). Status-lookup mode ' +
      "returns each order as `{ saleOrderCode, orderStatus, ...order }` with UC's 6-value status vocabulary (see `statusLookup` example).",
    content: {
      'application/json': {
        examples: {
          bulkPull: {
            summary: 'Bulk pull — orderStatus=CREATED',
            description:
              'Raw Ratio order objects, page-limited to 50. No status translation is applied in this mode.',
            value: {
              orders: [
                {
                  id: 'gid://shopify/Order/5432109876543',
                  name: '#RAT-1001',
                  email: 'asha.sharma@example.in',
                  created_at: '2026-08-05T09:41:00+05:30',
                  updated_at: '2026-08-05T09:42:12+05:30',
                  status: 'open',
                  financial_status: 'paid',
                  fulfillment_status: 'unfulfilled',
                  payment_gateway_names: ['cash on delivery (COD)'],
                  subtotal_price: '2548.00',
                  total_discounts: 50,
                  total_price: '2598.00',
                  shipping_lines: [{ price: 100 }],
                  shipping_address: {
                    first_name: 'Asha',
                    last_name: 'Sharma',
                    address1: '42 MG Road',
                    city: 'Bengaluru',
                    province: 'Karnataka',
                    country: 'IN',
                    zip: '560001',
                    phone: '+919876543210',
                  },
                  line_items: [
                    {
                      id: 'gid://shopify/LineItem/1122334455667',
                      product_id: 'gid://shopify/Product/8123456789012',
                      variant_id: 'gid://shopify/Variant/4345678901234',
                      sku: 'CCT-NAVY-S',
                      title: 'Classic Cotton T-Shirt / S / Navy',
                      quantity: 2,
                      price: '699.00',
                    },
                  ],
                },
              ],
            },
          },
          statusLookup: {
            summary: 'Status lookup — orderIds=...',
            description:
              "Each resolved order is mapped to UC's 6-value `orderStatus` vocabulary; `saleOrderCode` is `String(order.id)`. Orders that could not be resolved are simply absent.",
            value: {
              orders: [
                {
                  saleOrderCode: '5432109876543',
                  orderStatus: 'DISPATCHED',
                  id: 'gid://shopify/Order/5432109876543',
                  name: '#RAT-1001',
                  email: 'asha.sharma@example.in',
                  created_at: '2026-08-05T09:41:00+05:30',
                  updated_at: '2026-08-06T14:05:00+05:30',
                  status: 'open',
                  financial_status: 'paid',
                  fulfillment_status: 'fulfilled',
                  payment_gateway_names: ['cash on delivery (COD)'],
                  subtotal_price: '2548.00',
                  total_discounts: 50,
                  total_price: '2598.00',
                  shipping_lines: [{ price: 100 }],
                  shipping_address: {
                    first_name: 'Asha',
                    last_name: 'Sharma',
                    address1: '42 MG Road',
                    city: 'Bengaluru',
                    province: 'Karnataka',
                    country: 'IN',
                    zip: '560001',
                    phone: '+919876543210',
                  },
                  line_items: [
                    {
                      id: 'gid://shopify/LineItem/1122334455667',
                      product_id: 'gid://shopify/Product/8123456789012',
                      variant_id: 'gid://shopify/Variant/4345678901234',
                      sku: 'CCT-NAVY-S',
                      title: 'Classic Cotton T-Shirt / S / Navy',
                      quantity: 2,
                      price: '699.00',
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  })
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

    const opts: {
      page: number;
      pageSize: number;
      orderStatus?: string;
      orderDateFrom?: string;
      orderDateTo?: string;
    } = {
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
      this.logger.error({
        msg: 'failed to list orders from Ratio',
        err: err instanceof Error ? err.message : String(err),
      });
      return { orders: [] };
    }
  }

  // Confirmed by UC's team: `orderIds` accepts a comma-separated list, so
  // this can be a multi-order status check, not just one order per call.
  private async statusLookup(merchantId: string, orderIds: string) {
    const ids = orderIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ids.length === 0) return { orders: [] };

    const mapToUcFormat = (order: Record<string, unknown>) => {
      const saleOrderCode = String(order.id);
      if (order.status === 'cancelled')
        return { saleOrderCode, orderStatus: 'CANCELLED', ...order };
      const fs = String(order.fulfillment_status || 'unfulfilled');
      let orderStatus = 'CREATED';
      if (fs === 'fulfilled' || fs === 'partially_fulfilled') orderStatus = 'DISPATCHED';
      else if (fs === 'delivered') orderStatus = 'DELIVERED';
      else if (fs === 'return_in_progress' || fs === 'return_pickup_scheduled')
        orderStatus = 'RETURN_REQUESTED';
      else if (fs === 'returned' || fs === 'restocked' || fs === 'return_failed')
        orderStatus = 'COURIER_RETURN';
      return { saleOrderCode, orderStatus, ...order };
    };

    if (ids.length === 1) {
      try {
        const order = await this.ratio.getOrder(merchantId, ids[0]!);
        return order ? { orders: [mapToUcFormat(order)] } : { orders: [] };
      } catch (err) {
        this.logger.error({
          msg: 'failed to get order status from Ratio',
          orderId: ids[0],
          err: err instanceof Error ? err.message : String(err),
        });
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
        errors: rejected.map((r) =>
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        ),
      });
    }
    return {
      orders: results
        .filter((r) => r.status === 'fulfilled' && r.value !== null)
        .map((r) => mapToUcFormat((r as PromiseFulfilledResult<Record<string, unknown>>).value)),
    };
  }
}
