import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpOrdersService } from './orders.service';
import { RpCurlLoggingInterceptor } from '../curl-log.util';

@Controller('rp/shopify/orders')
@UseGuards(RpRequestGuard)
export class RpOrdersController {
  constructor(private readonly orders: RpOrdersService) {}

  @Get()
  list(@Req() req: RpRequest, @Query() query: Record<string, string>): Promise<unknown> {
    return this.orders.getOrders(req.rpMerchant.merchantId, query);
  }

  // Create an order (exchange fulfillment). Body is a Shopify REST order (`{order}` or bare).
  // TEMPORARY DEBUG LOGGING (remove once the OS order-create 400 investigation is closed):
  // logs the exact payload RP sends here, to confirm nothing is trimmed/missing (e.g.
  // product_id) before it reaches mapCreateOrder.
  @UseInterceptors(RpCurlLoggingInterceptor)
  @Post()
  create(@Req() req: RpRequest, @Body() body: unknown): Promise<unknown> {
    return this.orders.createOrder(req.rpMerchant.merchantId, body);
  }

  @Get(':id')
  get(@Req() req: RpRequest, @Param('id') id: string): Promise<unknown> {
    return this.orders.getOrder(req.rpMerchant.merchantId, id);
  }

  // Patch an order (used to mark it returned/exchanged/refunded via tags). TEMPORARY
  // DEBUG LOGGING (remove once the "still shows fulfilled" investigation is closed):
  // logs the exact payload RP sends here, same rationale as the create() logging above.
  @UseInterceptors(RpCurlLoggingInterceptor)
  @Patch(':id')
  patch(
    @Req() req: RpRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.orders.patchOrder(req.rpMerchant.merchantId, id, body);
  }

  @Get(':id/transactions')
  transactions(@Req() req: RpRequest, @Param('id') id: string): Promise<unknown> {
    return this.orders.getTransactions(req.rpMerchant.merchantId, id);
  }
}
