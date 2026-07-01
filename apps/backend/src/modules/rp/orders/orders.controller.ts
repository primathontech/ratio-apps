import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpOrdersService } from './orders.service';

@Controller('rp/shopify/orders')
@UseGuards(RpRequestGuard)
export class RpOrdersController {
  constructor(private readonly orders: RpOrdersService) {}

  @Get()
  list(@Req() req: RpRequest, @Query() query: Record<string, string>): Promise<unknown> {
    return this.orders.getOrders(req.rpMerchant.merchantId, query);
  }

  @Get(':id')
  get(@Req() req: RpRequest, @Param('id') id: string): Promise<unknown> {
    return this.orders.getOrder(req.rpMerchant.merchantId, id);
  }

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
