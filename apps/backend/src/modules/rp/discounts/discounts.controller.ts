import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpDiscountsService } from './discounts.service';

@Controller('rp/shopify/discount_codes')
@UseGuards(RpRequestGuard)
export class RpDiscountsController {
  constructor(private readonly discounts: RpDiscountsService) {}

  @Post()
  create(@Req() req: RpRequest, @Body() body: unknown): Promise<unknown> {
    return this.discounts.createDiscount(req.rpMerchant.merchantId, body);
  }
}
