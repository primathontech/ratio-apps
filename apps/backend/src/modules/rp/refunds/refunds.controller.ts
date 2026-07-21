import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpRefundsService } from './refunds.service';

@Controller('rp/shopify/orders/:id/refunds')
@UseGuards(RpRequestGuard)
export class RpRefundsController {
  constructor(private readonly refunds: RpRefundsService) {}

  @Get()
  list(@Req() req: RpRequest, @Param('id') orderId: string): Promise<unknown> {
    return this.refunds.getRefunds(req.rpMerchant.merchantId, orderId);
  }

  @Post()
  create(
    @Req() req: RpRequest,
    @Param('id') orderId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.refunds.createRefund(req.rpMerchant.merchantId, orderId, body);
  }

  @Post('calculate')
  calculate(
    @Req() req: RpRequest,
    @Param('id') orderId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.refunds.calculateRefund(req.rpMerchant.merchantId, orderId, body);
  }
}
